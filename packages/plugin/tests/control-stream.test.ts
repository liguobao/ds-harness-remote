import { createServer, type Server } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTROL_RPC_PREFIX,
  registerControlRoute,
  STATUS_STREAM_PATH,
  type ControlRouteHandler,
  type HostWebServerLike,
} from '../src/control-route.js'
import { ControlStatusStream } from '../src/control-stream.js'
import type { HostAuthorizationControl, HostConnectionHandle } from '../src/client-runtime.js'
import { resolveConfig } from '../src/config.js'
import { PluginControlRuntime } from '../src/control-runtime.js'

const servers: Server[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
})

describe('loopback status event stream', () => {
  it('writes the retry hint and the current status as the first frame', async () => {
    const stream = new ControlStatusStream(async () => ({ mode: 'remote', connected: true }), { retryMs: 3_000 })
    const response = fakeResponse()

    await stream.handle(response.response)

    expect(response.statusCode).toBe(200)
    expect(response.headers).toMatchObject({ 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    expect(response.chunks).toEqual([
      'retry: 3000\n\n',
      'data: {"mode":"remote","connected":true}\n\n',
    ])
    stream.close()
  })

  it('pushes a frame only when the sampled status changes', async () => {
    vi.useFakeTimers()
    let status: Record<string, unknown> = { mode: 'local' }
    const readStatus = vi.fn(async () => status)
    const stream = new ControlStatusStream(readStatus, { sampleIntervalMs: 10 })
    const response = fakeResponse()
    await stream.handle(response.response)

    await vi.advanceTimersByTimeAsync(35)
    expect(readStatus).toHaveBeenCalledTimes(4)
    expect(response.chunks).toHaveLength(2)

    status = { mode: 'remote' }
    await vi.advanceTimersByTimeAsync(10)
    expect(response.chunks.at(-1)).toBe('data: {"mode":"remote"}\n\n')
    stream.close()
  })

  it('keeps an idle connection alive with a comment frame', async () => {
    vi.useFakeTimers()
    const stream = new ControlStatusStream(async () => ({ mode: 'local' }), {
      sampleIntervalMs: 10,
      heartbeatIntervalMs: 50,
    })
    const response = fakeResponse()
    await stream.handle(response.response)

    await vi.advanceTimersByTimeAsync(60)

    expect(response.chunks.filter(chunk => chunk === ': keep-alive\n\n').length).toBeGreaterThan(0)
    stream.close()
  })

  it('stops sampling when the client disconnects', async () => {
    vi.useFakeTimers()
    const readStatus = vi.fn(async () => ({ mode: 'local' }))
    const stream = new ControlStatusStream(readStatus, { sampleIntervalMs: 10 })
    const response = fakeResponse()
    await stream.handle(response.response)

    response.disconnect()
    await vi.advanceTimersByTimeAsync(100)

    expect(readStatus).toHaveBeenCalledTimes(1)
    stream.close()
  })

  it('serves a late subscriber the current status without waiting for a change', async () => {
    const stream = new ControlStatusStream(async () => ({ mode: 'remote' }))
    const first = fakeResponse()
    await stream.handle(first.response)
    const second = fakeResponse()

    await stream.handle(second.response)

    expect(second.chunks.at(-1)).toBe('data: {"mode":"remote"}\n\n')
    stream.close()
  })

  it('keeps the connection open when the status read fails', async () => {
    vi.useFakeTimers()
    let readable = false
    const stream = new ControlStatusStream(async () => {
      if (!readable) throw new Error('transport stats unavailable')
      return { mode: 'remote' }
    }, { sampleIntervalMs: 10 })
    const response = fakeResponse()
    await stream.handle(response.response)

    expect(response.chunks).toEqual(['retry: 3000\n\n'])

    readable = true
    await vi.advanceTimersByTimeAsync(10)
    expect(response.chunks.at(-1)).toBe('data: {"mode":"remote"}\n\n')
    stream.close()
  })

  it('drops a subscriber whose response fails and ends every stream on close', async () => {
    vi.useFakeTimers()
    const broken = fakeResponse({ failWrites: true })
    const healthy = fakeResponse()
    const stream = new ControlStatusStream(async () => ({ mode: 'local' }), { sampleIntervalMs: 10 })
    await stream.handle(broken.response)
    await stream.handle(healthy.response)
    const writesBefore = broken.writes

    await vi.advanceTimersByTimeAsync(30)

    expect(broken.writes).toBe(writesBefore)
    expect(healthy.chunks.length).toBeGreaterThanOrEqual(2)

    stream.close()
    expect(healthy.ended).toBe(true)
    const refused = fakeResponse()
    await stream.handle(refused.response)
    expect(refused.statusCode).toBe(503)
  })

  it('serves the stream over the registered loopback route and keeps the RPC path intact', async () => {
    const calls: string[] = []
    const handler: ControlRouteHandler = async (endpoint, payload): Promise<RpcResult<unknown>> => {
      calls.push(`${endpoint}:${JSON.stringify(payload)}`)
      return { ok: true, value: { mode: 'local' } }
    }
    const stream = new ControlStatusStream(async () => ({ mode: 'remote', deviceName: 'host-one' }))
    const route = captureRoute()
    const dispose = registerControlRoute(connectionHandle(), handler, route.webServer, stream)
    const base = await listen((req, res) => { route.handle(req, res) })

    const response = await fetch(`${base}${STATUS_STREAM_PATH}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const head = await readText(reader, text => text.includes('data: '))
    expect(head).toContain('retry: 3000')
    expect(head).toContain('data: {"mode":"remote","deviceName":"host-one"}')

    // The RPC path keeps owning POST on the same endpoint name.
    await expect(fetch(`${base}${STATUS_STREAM_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: 'status.events', payload: {} }),
    })).resolves.toMatchObject({ status: 200 })
    await expect(fetch(`${base}${CONTROL_RPC_PREFIX}/settings.get`, { method: 'GET' })).resolves.toMatchObject({ status: 404 })
    expect(calls).toEqual(['status.events:{}'])

    await reader.cancel()
    await dispose()

    expect(route.registered).toBe(false)
    await expect(fetch(`${base}${STATUS_STREAM_PATH}`)).resolves.toMatchObject({ status: 404 })
  })

  it('streams the control runtime status and ends it with the control route', async () => {
    const runtime = new PluginControlRuntime(
      resolveConfig(),
      '/unused',
      undefined,
      undefined,
      hostControl(),
    )
    const route = captureRoute()
    const dispose = runtime.register(connectionHandle(), route.webServer)
    const response = fakeResponse()

    await route.dispatch({ method: 'GET', url: STATUS_STREAM_PATH, headers: {} }, response.response)

    expect(response.statusCode).toBe(200)
    const head = response.chunks.join('')
    expect(head).toContain('"mode":"local"')
    expect(head).toContain('"online":true')

    await dispose()

    expect(response.ended).toBe(true)
  })

  it('keeps the connection rejection policy in front of the stream', async () => {
    const stream = new ControlStatusStream(async () => ({ mode: 'local' }))
    const route = captureRoute()
    registerControlRoute(connectionHandle(401), async () => ({ ok: true, value: {} }), route.webServer, stream)
    const base = await listen((req, res) => { route.handle(req, res) })

    const response = await fetch(`${base}${STATUS_STREAM_PATH}`)

    expect(response.status).toBe(401)
    await expect(response.text()).resolves.toBe('unauthorized')
  })

  it('ends an open stream when the control route is disposed', async () => {
    const stream = new ControlStatusStream(async () => ({ mode: 'remote' }))
    const route = captureRoute()
    const dispose = registerControlRoute(connectionHandle(), async () => ({ ok: true, value: {} }), route.webServer, stream)
    const base = await listen((req, res) => { route.handle(req, res) })

    const response = await fetch(`${base}${STATUS_STREAM_PATH}`)
    const reader = response.body!.getReader()
    await readText(reader, text => text.includes('data: '))

    await dispose()

    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })
})

interface FakeResponse {
  response: ServerResponse
  readonly chunks: string[]
  readonly writes: number
  readonly statusCode: number | undefined
  readonly headers: Record<string, string> | undefined
  readonly ended: boolean
  disconnect(): void
}

function fakeResponse(options: { failWrites?: boolean } = {}): FakeResponse {
  const chunks: string[] = []
  const listeners = new Map<string, (() => void)[]>()
  let statusCode: number | undefined
  let headers: Record<string, string> | undefined
  let ended = false
  let writes = 0
  const response = {
    destroyed: false,
    writableEnded: false,
    writeHead(status: number, next?: Record<string, string>) {
      statusCode = status
      headers = next
    },
    write(chunk: string) {
      writes += 1
      if (options.failWrites === true) throw new Error('write failed')
      chunks.push(chunk)
      return true
    },
    end() {
      ended = true
      response.writableEnded = true
    },
    on(event: string, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return response
    },
  }
  return {
    response: response as unknown as ServerResponse,
    chunks,
    get writes() { return writes },
    get statusCode() { return statusCode },
    get headers() { return headers },
    get ended() { return ended },
    disconnect() {
      for (const listener of listeners.get('close') ?? []) listener()
    },
  }
}

function hostControl(): HostAuthorizationControl {
  return {
    hostStatus: () => ({
      configured: true,
      online: true,
      reconnecting: false,
      authorized: true,
      accountRequired: false,
    }),
    reconnectHost: () => undefined,
    clearHostAuthorization: async () => undefined,
    authorizeHostAsOwned: async () => undefined,
    authorizeHostWithAccount: async () => undefined,
    authorizeHostWithCode: async () => undefined,
  }
}

function connectionHandle(rejection?: number): HostConnectionHandle {
  return {
    requestRejection: () => rejection,
    rpc: { handle: () => async () => undefined },
  } as unknown as HostConnectionHandle
}

/** Stands in for the Host Web server prefix table. */
function captureRoute() {
  let handler: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined
  return {
    webServer: {
      register: (route: { handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => {
        handler = route.handler
        return () => { handler = undefined }
      },
    } as unknown as HostWebServerLike,
    get registered() { return handler !== undefined },
    /** Drive one request through the registered prefix route. */
    async dispatch(request: { method: string; url: string; headers: Record<string, string> }, res: ServerResponse): Promise<void> {
      if (handler === undefined) throw new Error('the loopback prefix route is not registered')
      await handler(request as unknown as IncomingMessage, res)
    },
    handle(req: IncomingMessage, res: ServerResponse): void {
      if (handler === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      void handler(req, res)
    },
  }
}

async function listen(serve: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(serve)
  servers.push(server)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}`
}

async function readText(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  until: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  for (let chunk = 0; chunk < 8 && !until(text); chunk += 1) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return text
}
