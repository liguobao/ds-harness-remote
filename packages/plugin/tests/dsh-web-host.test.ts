import { TunnelError } from '../src/hostc/api.js'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import {
  createRpcRequest,
  DSH_WEB_LAN_CAPABILITY,
  dshWebLanGrantSchema,
  type RemoteMessage,
  type RpcResponsePayload,
} from '@dsh-remote/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type RawData, WebSocket, WebSocketServer } from 'ws'
import * as remotePlugin from '../src/index.js'
import { authorizeUpstream, DshWebPeer, resolveDshWebRuntime, type DshWebBrowserAuth } from '../src/dsh-web-host.js'
import { openDshWebUpstream } from '../src/dsh-web-upstream.js'
import { Connection } from '../src/hostc/connection.js'
import {
  CLOSE_SHUTDOWN,
  decodeClose,
  decodeFrame,
  decodeHead,
  decodeText,
  decodeWindow,
  encodeFrame,
  encodeOpen,
  encodeText,
  type Frame,
  FrameType,
  type HeaderList,
  MAX_STREAMS,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  type OpenMessage,
} from '../src/hostc/protocol/index.js'
import type { HostServerApi } from '../src/server-api.js'

const stripResponseHeaders = (headers: HeaderList): HeaderList =>
  headers.filter(([name, value]) => name.toLowerCase() !== 'set-cookie'
    && !(name.toLowerCase() === 'location' && /[?&]token=/i.test(value)))

function rawToUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data
}

async function listenHttp(handler: http.RequestListener): Promise<{ server: http.Server; origin: URL; close: () => Promise<void> }> {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    server,
    origin: new URL(`http://127.0.0.1:${port}`),
    close: () => new Promise<void>(resolve => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

async function listenWs(): Promise<{
  wss: WebSocketServer
  url: string
  nextClient: () => Promise<WebSocket>
  close: () => Promise<void>
}> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => wss.once('listening', resolve))
  const { port } = wss.address() as AddressInfo
  const queue: WebSocket[] = []
  const waiters: Array<(ws: WebSocket) => void> = []
  wss.on('connection', ws => {
    const waiter = waiters.shift()
    if (waiter) waiter(ws)
    else queue.push(ws)
  })
  return {
    wss,
    url: `ws://127.0.0.1:${port}`,
    nextClient: () => {
      const existing = queue.shift()
      if (existing) return Promise.resolve(existing)
      return new Promise<WebSocket>(resolve => waiters.push(resolve))
    },
    close: () => new Promise<void>(resolve => {
      for (const client of wss.clients) client.terminate()
      wss.close(() => resolve())
    }),
  }
}

function collectFrames(ws: WebSocket) {
  const frames: Frame[] = []
  const listeners = new Set<() => void>()
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return
    frames.push(decodeFrame(rawToUint8Array(data)))
    for (const notify of listeners) notify()
  })
  const waitFor = (predicate: (all: Frame[]) => boolean, timeoutMs = 5_000): Promise<void> => {
    if (predicate(frames)) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check)
        reject(new Error(`timed out waiting for tunnel frame (received ${frames.length} frames)`))
      }, timeoutMs)
      const check = () => {
        if (!predicate(frames)) return
        clearTimeout(timer)
        listeners.delete(check)
        resolve()
      }
      listeners.add(check)
    })
  }
  return { frames, waitFor }
}

describe('DSH Web Host forwarding boundary', () => {
  const url = new URL('https://test.tun-test.4ba.io/')
  const request: OpenMessage = { method: 'GET', path: '/api/web', headers: [], body: false }

  it.each(['/ds-harness-remote/api', '/%64s-harness-remote/api', '/%252e%252e/',
    '/api/../connect', '/connect', '/%2Fother.test/', '/?%74oken=bad'])('rejects sensitive target %s', path => {
    expect(authorizeUpstream({ ...request, path }, url, 'local=owned')).toBeUndefined()
  })

  it('replaces caller credentials and preserves an exact public Origin for normalization', () => {
    expect(authorizeUpstream({ ...request, headers: [
      ['cookie', 'fake=grant'], ['authorization', 'Bearer visitor'], ['x-forwarded-host', 'other.test'],
      ['origin', url.origin],
    ] }, url, 'local=owned')?.headers).toEqual([['origin', url.origin], ['cookie', 'local=owned']])
    expect(authorizeUpstream({ ...request, headers: [['origin', url.origin + '.other.test']] }, url, 'local=owned')).toBeUndefined()
  })
})

describe('hostc tunnel stream and lifecycle hardening', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    vi.restoreAllMocks()
    while (cleanups.length > 0) {
      await cleanups.pop()?.()
    }
  })

  it('ignores 0-byte HTTP Data frames without sending Window(0) and keeps the tunnel alive', async () => {
    const local = await listenHttp((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(req.url === '/echo' ? Buffer.concat(chunks) : 'alive')
      })
    })
    cleanups.push(local.close)

    const tunnel = await listenWs()
    cleanups.push(tunnel.close)

    const clientPromise = tunnel.nextClient()
    const conn = await Connection.open({
      tunnel: { id: 't22222222222', url: 'https://test.tun-test.4ba.io/', connectUrl: tunnel.url, token: 'tok' },
      target: local.origin,
      authorize: req => req,
      stripResponseHeaders,
      onRequest: () => undefined,
    })
    cleanups.push(() => { conn.close(CLOSE_SHUTDOWN, 'test') })
    const peerWs = await clientPromise
    const { frames, waitFor } = collectFrames(peerWs)

    peerWs.send(encodeFrame(FrameType.Open, 1, encodeOpen({ method: 'POST', path: '/echo', headers: [], body: true })))
    peerWs.send(encodeFrame(FrameType.Data, 1, new Uint8Array(0)))
    peerWs.send(encodeFrame(FrameType.Data, 1, encodeText('hello')))
    peerWs.send(encodeFrame(FrameType.End, 1))

    await waitFor(all => all.some(f => f.stream === 1 && f.type === FrameType.End))

    const windowFrames = frames.filter(f => f.stream === 1 && f.type === FrameType.Window)
    expect(windowFrames.length).toBeGreaterThan(0)
    for (const wf of windowFrames) {
      expect(decodeWindow(wf.payload)).toBeGreaterThan(0)
    }
    expect(windowFrames.reduce((sum, wf) => sum + decodeWindow(wf.payload), 0)).toBe(5)

    const stream1Body = Buffer.concat(
      frames.filter(f => f.stream === 1 && f.type === FrameType.Data).map(f => Buffer.from(f.payload)),
    ).toString('utf8')
    expect(stream1Body).toBe('hello')

    peerWs.send(encodeFrame(FrameType.Open, 2, encodeOpen({ method: 'GET', path: '/ping', headers: [], body: false })))
    await waitFor(all => all.some(f => f.stream === 2 && f.type === FrameType.End))
    const stream2Body = Buffer.concat(
      frames.filter(f => f.stream === 2 && f.type === FrameType.Data).map(f => Buffer.from(f.payload)),
    ).toString('utf8')
    expect(stream2Body).toBe('alive')
  })

  it('destroys an in-flight SSE response when the upstream request errors while preserving keep-alive on normal and 204 completions', async () => {
    let resolveServerClosed!: () => void
    const serverClosed = new Promise<void>(resolve => { resolveServerClosed = resolve })
    const keepAliveSockets: Array<import('node:net').Socket> = []

    const local = await listenHttp((req, res) => {
      if (req.url === '/sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: tick\n\n')
        res.on('close', resolveServerClosed)
        return
      }
      keepAliveSockets.push(req.socket)
      if (req.url === '/no-content') {
        res.writeHead(204)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
    cleanups.push(local.close)

    const realHttpRequest = http.request
    let sseRequest: http.ClientRequest | undefined
    let sseResponse: http.IncomingMessage | undefined
    vi.spyOn(http, 'request').mockImplementation(((...args: Parameters<typeof http.request>) => {
      const req = realHttpRequest(...args)
      const options = args[0] as http.RequestOptions
      if (options?.path === '/sse') {
        sseRequest = req
        req.on('response', res => { sseResponse = res })
      }
      return req
    }) as typeof http.request)

    const tunnel = await listenWs()
    cleanups.push(tunnel.close)

    const logs: Array<{ path: string; status: number }> = []
    const clientPromise = tunnel.nextClient()
    const conn = await Connection.open({
      tunnel: { id: 't22222222222', url: 'https://test.tun-test.4ba.io/', connectUrl: tunnel.url, token: 'tok' },
      target: local.origin,
      authorize: req => req,
      stripResponseHeaders,
      onRequest: entry => { logs.push({ path: entry.path, status: entry.status }) },
    })
    cleanups.push(() => { conn.close(CLOSE_SHUTDOWN, 'test') })
    const peerWs = await clientPromise
    const { frames, waitFor } = collectFrames(peerWs)

    // Sequential /normal -> /no-content (204) -> /normal must reuse the same keep-alive socket without Reset.
    peerWs.send(encodeFrame(FrameType.Open, 1, encodeOpen({ method: 'GET', path: '/normal', headers: [], body: false })))
    await waitFor(all => all.some(f => f.stream === 1 && f.type === FrameType.End))
    peerWs.send(encodeFrame(FrameType.Open, 2, encodeOpen({ method: 'GET', path: '/no-content', headers: [], body: false })))
    await waitFor(all => all.some(f => f.stream === 2 && f.type === FrameType.Head))
    await new Promise(resolve => setTimeout(resolve, 20))
    peerWs.send(encodeFrame(FrameType.Open, 3, encodeOpen({ method: 'GET', path: '/normal', headers: [], body: false })))
    await waitFor(all => all.some(f => f.stream === 3 && f.type === FrameType.End))

    expect(frames.filter(f => f.stream <= 3 && f.type === FrameType.Reset)).toHaveLength(0)
    expect(decodeHead(frames.find(f => f.stream === 2 && f.type === FrameType.Head)!.payload).status).toBe(204)
    expect(keepAliveSockets).toHaveLength(3)
    expect(keepAliveSockets[1]).toBe(keepAliveSockets[0])
    expect(keepAliveSockets[2]).toBe(keepAliveSockets[0])

    // Streaming SSE response where upstream request errors mid-stream.
    peerWs.send(encodeFrame(FrameType.Open, 4, encodeOpen({ method: 'GET', path: '/sse', headers: [], body: false })))
    await waitFor(all => all.some(f => f.stream === 4 && f.type === FrameType.Data))
    expect(sseRequest).toBeDefined()
    expect(sseResponse).toBeDefined()
    expect(sseResponse!.destroyed).toBe(false)

    sseRequest!.emit('error', new Error('simulated upstream error'))

    await waitFor(all => all.some(f => f.stream === 4 && f.type === FrameType.Reset))
    await serverClosed
    expect(sseResponse!.destroyed).toBe(true)
    expect(frames.filter(f => f.stream === 4 && f.type === FrameType.Reset)).toHaveLength(1)
    expect(frames.filter(f => f.stream === 4 && f.type === FrameType.End)).toHaveLength(0)
    expect(logs).toContainEqual({ path: '/sse', status: 502 })
  })

  it('strips sensitive headers and rewrites local Location on WebSocket unexpected-response', async () => {
    const local = await listenHttp((req, res) => {
      if (req.url === '/ws-redirect-safe') {
        res.writeHead(302, {
          'Set-Cookie': 'dsh=secret; HttpOnly',
          Location: `${local.origin.origin}/login`,
          'X-Safe': 'ok',
        })
        res.end()
        return
      }
      if (req.url === '/ws-redirect-token') {
        res.writeHead(302, {
          'Set-Cookie': 'dsh=secret',
          Location: `${local.origin.origin}/auth?token=leaked-secret`,
          'X-Keep': 'yes',
        })
        res.end()
        return
      }
      res.writeHead(401, {
        'Set-Cookie': 'sid=leak',
        'WWW-Authenticate': 'Bearer',
      })
      res.end()
    })
    cleanups.push(local.close)

    const tunnel = await listenWs()
    cleanups.push(tunnel.close)

    const clientPromise = tunnel.nextClient()
    const conn = await Connection.open({
      tunnel: { id: 't22222222222', url: 'https://test.tun-test.4ba.io/', connectUrl: tunnel.url, token: 'tok' },
      target: local.origin,
      authorize: req => req,
      stripResponseHeaders,
      onRequest: () => undefined,
    })
    cleanups.push(() => { conn.close(CLOSE_SHUTDOWN, 'test') })
    const peerWs = await clientPromise
    const { frames, waitFor } = collectFrames(peerWs)

    peerWs.send(encodeFrame(FrameType.Open, 1, encodeOpen({ method: 'GET', path: '/ws-redirect-safe', headers: [], body: false, websocket: [] })))
    peerWs.send(encodeFrame(FrameType.Open, 2, encodeOpen({ method: 'GET', path: '/ws-redirect-token', headers: [], body: false, websocket: [] })))
    peerWs.send(encodeFrame(FrameType.Open, 3, encodeOpen({ method: 'GET', path: '/ws-unauth', headers: [], body: false, websocket: [] })))

    await waitFor(all =>
      all.some(f => f.stream === 1 && f.type === FrameType.Head)
      && all.some(f => f.stream === 2 && f.type === FrameType.Head)
      && all.some(f => f.stream === 3 && f.type === FrameType.Head))

    const head1 = decodeHead(frames.find(f => f.stream === 1 && f.type === FrameType.Head)!.payload)
    expect(head1.status).toBe(302)
    expect(head1.headers.some(([k]) => k.toLowerCase() === 'set-cookie')).toBe(false)
    expect(head1.headers).toContainEqual(['Location', 'https://test.tun-test.4ba.io/login'])
    expect(head1.headers).toContainEqual(['X-Safe', 'ok'])

    const head2 = decodeHead(frames.find(f => f.stream === 2 && f.type === FrameType.Head)!.payload)
    expect(head2.status).toBe(302)
    expect(head2.headers.some(([k]) => k.toLowerCase() === 'set-cookie')).toBe(false)
    expect(head2.headers.some(([k]) => k.toLowerCase() === 'location')).toBe(false)
    expect(head2.headers).toContainEqual(['X-Keep', 'yes'])

    const head3 = decodeHead(frames.find(f => f.stream === 3 && f.type === FrameType.Head)!.payload)
    expect(head3.status).toBe(401)
    expect(head3.headers.some(([k]) => k.toLowerCase() === 'set-cookie')).toBe(false)
    expect(head3.headers).toContainEqual(['WWW-Authenticate', 'Bearer'])
  })

  it('resets Open frames beyond MAX_STREAMS without disturbing existing streams', async () => {
    const held: http.ServerResponse[] = []
    let overflowHits = 0

    const local = await listenHttp((req, res) => {
      if (req.url === '/overflow') {
        overflowHits++
        res.writeHead(200)
        res.end('should-not-hit')
        return
      }
      if (req.url === '/hold') {
        held.push(res)
        return
      }
      res.writeHead(200)
      res.end('after')
    })
    cleanups.push(local.close)

    const tunnel = await listenWs()
    cleanups.push(tunnel.close)

    const clientPromise = tunnel.nextClient()
    const conn = await Connection.open({
      tunnel: { id: 't22222222222', url: 'https://test.tun-test.4ba.io/', connectUrl: tunnel.url, token: 'tok' },
      target: local.origin,
      authorize: req => req,
      stripResponseHeaders,
      onRequest: () => undefined,
    })
    cleanups.push(() => { conn.close(CLOSE_SHUTDOWN, 'test') })
    const peerWs = await clientPromise
    const { frames, waitFor } = collectFrames(peerWs)

    const batchSize = 32
    for (let start = 1; start <= MAX_STREAMS; start += batchSize) {
      const end = Math.min(start + batchSize - 1, MAX_STREAMS)
      for (let id = start; id <= end; id++) {
        peerWs.send(encodeFrame(FrameType.Open, id, encodeOpen({ method: 'GET', path: '/hold', headers: [], body: false })))
      }
      const deadline = Date.now() + 5_000
      while (held.length < end && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(held.length).toBe(end)
    }
    const overflowId = MAX_STREAMS + 1
    peerWs.send(encodeFrame(FrameType.Open, overflowId, encodeOpen({ method: 'GET', path: '/overflow', headers: [], body: false })))

    await waitFor(all => all.some(f => f.stream === overflowId && f.type === FrameType.Reset))
    const resetFrame = frames.find(f => f.stream === overflowId && f.type === FrameType.Reset)!
    expect(decodeText(resetFrame.payload)).toContain('Too many concurrent streams')
    expect(overflowHits).toBe(0)

    expect(held.length).toBe(MAX_STREAMS)
    for (const res of held) {
      res.writeHead(200)
      res.end('ok')
    }

    await waitFor(all => all.filter(f => f.stream <= MAX_STREAMS && f.type === FrameType.End).length === MAX_STREAMS)
    expect(frames.filter(f => f.stream <= MAX_STREAMS && f.type === FrameType.Reset)).toHaveLength(0)

    const afterId = MAX_STREAMS + 2
    peerWs.send(encodeFrame(FrameType.Open, afterId, encodeOpen({ method: 'GET', path: '/after', headers: [], body: false })))
    await waitFor(all => all.some(f => f.stream === afterId && f.type === FrameType.End))
    expect(decodeHead(frames.find(f => f.stream === afterId && f.type === FrameType.Head)!.payload).status).toBe(200)
  })

  it('aborts an in-flight Connection.open handshake immediately on close() and lets an immediate re-open succeed', async () => {
    const preAborted = new AbortController()
    preAborted.abort(new Error('already cancelled'))
    await expect(Connection.open({
      tunnel: { id: 't22222222222', url: 'https://test.tun-test.4ba.io/', connectUrl: 'ws://127.0.0.1:1', token: 'tok' },
      target: new URL('http://127.0.0.1:1'),
      authorize: req => req,
      stripResponseHeaders,
      onRequest: () => undefined,
    }, preAborted.signal)).rejects.toThrow(/already cancelled/i)

    const localGui = await listenHttp((req, res) => {
      if (req.headers.cookie === 'dsh=local') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html>ok</html>')
        return
      }
      res.writeHead(401)
      res.end()
    })
    cleanups.push(localGui.close)

    let resolveUpgradeStarted!: () => void
    const upgradeStarted = new Promise<void>(resolve => { resolveUpgradeStarted = resolve })
    let resolveHangingClosed!: () => void
    const hangingClosed = new Promise<void>(resolve => { resolveHangingClosed = resolve })
    const hangingSockets = new Set<Duplex>()

    const hangingServer = http.createServer()
    hangingServer.on('upgrade', (_req, socket) => {
      hangingSockets.add(socket)
      socket.on('error', () => {})
      socket.once('end', () => socket.destroy())
      socket.once('close', () => {
        hangingSockets.delete(socket)
        resolveHangingClosed()
      })
      socket.resume()
      resolveUpgradeStarted()
    })
    await new Promise<void>(resolve => hangingServer.listen(0, '127.0.0.1', resolve))
    const hangingPort = (hangingServer.address() as AddressInfo).port
    cleanups.push(() => new Promise<void>(resolve => {
      for (const s of hangingSockets) s.destroy()
      hangingServer.close(() => resolve())
    }))

    const healthyTunnel = await listenWs()
    cleanups.push(healthyTunnel.close)

    const realOpen = Connection.open.bind(Connection)
    let dialAttempt = 0
    vi.spyOn(Connection, 'open').mockImplementation((options, signal) => {
      dialAttempt++
      expect(signal).toBeDefined()
      expect(signal?.aborted).toBe(false)
      const connectUrl = dialAttempt === 1 ? `ws://127.0.0.1:${hangingPort}` : healthyTunnel.url
      return realOpen({ ...options, tunnel: { ...options.tunnel, connectUrl } }, signal)
    })

    const closedSessions: string[] = []
    let allocateCount = 0
    const api = {
      async dshWebRequest(action: string, input: { leaseExpiresAt: number }) {
        if (action === 'allocate') {
          allocateCount++
          const sessionId = allocateCount === 1 ? 'p22222222222' : 'p33333333333'
          return {
            sessionId,
            url: `https://${sessionId}.tunnel.example/`,
            connectUrl: `wss://tunnel.example/api/tunnels/${sessionId}/connect`,
            connectToken: (allocateCount === 1 ? 'a' : 'b').repeat(43),
            leaseExpiresAt: input.leaseExpiresAt,
          }
        }
        if (action === 'grant') {
          const sessionId = allocateCount === 1 ? 'p22222222222' : 'p33333333333'
          return {
            url: `https://${sessionId}.tunnel.example/`,
            browserGrant: 'g'.repeat(43),
            expiresAt: input.leaseExpiresAt,
          }
        }
        return {}
      },
      async closeDshWeb(sessionId: string) {
        closedSessions.push(sessionId)
      },
    } as unknown as HostServerApi

    const auth: DshWebBrowserAuth = {
      authenticatedUrl: origin => `${origin}?token=boot`,
      authorizeIndex: (_req, res) => {
        res.writeHead(303, { 'set-cookie': 'dsh=local; Path=/; HttpOnly' })
        res.end()
        return true
      },
      requestRejection: req => (req.headers.cookie === 'dsh=local' ? undefined : 401),
    }

    const peer = new DshWebPeer(
      api,
      { clientDeviceId: 'dev-1', connectionId: 'conn-1' },
      () => ({ origin: localGui.origin, auth }),
    )
    cleanups.push(() => peer.dispose())

    const firstOpen = peer.open()
    const firstOpenResult = firstOpen.catch((error: unknown) => error)

    await Promise.race([
      upgradeStarted,
      firstOpenResult.then(err => Promise.reject(new Error(`first open settled before upgrade: ${String(err)}`))),
    ])
    const startedCloseAt = Date.now()
    await peer.close()
    const closeElapsedMs = Date.now() - startedCloseAt

    await hangingClosed
    expect(closeElapsedMs).toBeLessThan(2_000)
    expect(await firstOpenResult).toBeInstanceOf(Error)
    expect(closedSessions).toContain('p22222222222')

    const healthyClientPromise = healthyTunnel.nextClient()
    const secondGrant = await peer.open()
    await healthyClientPromise

    expect(secondGrant.url).toBe('https://p33333333333.tunnel.example/')
    expect(dialAttempt).toBe(2)

    await peer.dispose()
    expect(closedSessions).toContain('p33333333333')
  })

  it('serializes an unawaited async close() before an immediate concurrent open() without killing the new lease', async () => {
    const localGui = await listenHttp((req, res) => {
      if (req.headers.cookie === 'dsh=local') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html>ok</html>')
        return
      }
      res.writeHead(401)
      res.end()
    })
    cleanups.push(localGui.close)

    let resolveUpgradeStarted!: () => void
    const upgradeStarted = new Promise<void>(resolve => { resolveUpgradeStarted = resolve })
    const hangingSockets = new Set<Duplex>()
    const hangingServer = http.createServer()
    hangingServer.on('upgrade', (_req, socket) => {
      hangingSockets.add(socket)
      socket.on('error', () => {})
      socket.once('end', () => socket.destroy())
      socket.once('close', () => hangingSockets.delete(socket))
      socket.resume()
      resolveUpgradeStarted()
    })
    await new Promise<void>(resolve => hangingServer.listen(0, '127.0.0.1', resolve))
    const hangingPort = (hangingServer.address() as AddressInfo).port
    cleanups.push(() => new Promise<void>(resolve => {
      for (const s of hangingSockets) s.destroy()
      hangingServer.close(() => resolve())
    }))

    const healthyTunnel = await listenWs()
    cleanups.push(healthyTunnel.close)

    const realOpen = Connection.open.bind(Connection)
    let dialAttempt = 0
    vi.spyOn(Connection, 'open').mockImplementation((options, signal) => {
      dialAttempt++
      const connectUrl = dialAttempt === 1 ? `ws://127.0.0.1:${hangingPort}` : healthyTunnel.url
      return realOpen({ ...options, tunnel: { ...options.tunnel, connectUrl } }, signal)
    })

    let resolveCloseEntered!: () => void
    const closeEntered = new Promise<void>(resolve => { resolveCloseEntered = resolve })
    let releaseFirstClose!: () => void
    const firstCloseGate = new Promise<void>(resolve => { releaseFirstClose = resolve })

    const closedSessions: string[] = []
    let allocateCount = 0
    const api = {
      async dshWebRequest(action: string, input: { leaseExpiresAt: number }) {
        if (action === 'allocate') {
          allocateCount++
          const sessionId = allocateCount === 1 ? 'p22222222222' : 'p33333333333'
          return {
            sessionId,
            url: `https://${sessionId}.tunnel.example/`,
            connectUrl: `wss://tunnel.example/api/tunnels/${sessionId}/connect`,
            connectToken: (allocateCount === 1 ? 'a' : 'b').repeat(43),
            leaseExpiresAt: input.leaseExpiresAt,
          }
        }
        if (action === 'grant') {
          const sessionId = allocateCount === 1 ? 'p22222222222' : 'p33333333333'
          return {
            url: `https://${sessionId}.tunnel.example/`,
            browserGrant: 'g'.repeat(43),
            expiresAt: input.leaseExpiresAt,
          }
        }
        return {}
      },
      async closeDshWeb(sessionId: string) {
        closedSessions.push(sessionId)
        if (sessionId === 'p22222222222') {
          resolveCloseEntered()
          await firstCloseGate
        }
      },
    } as unknown as HostServerApi

    const auth: DshWebBrowserAuth = {
      authenticatedUrl: origin => `${origin}?token=boot`,
      authorizeIndex: (_req, res) => {
        res.writeHead(303, { 'set-cookie': 'dsh=local; Path=/; HttpOnly' })
        res.end()
        return true
      },
      requestRejection: req => (req.headers.cookie === 'dsh=local' ? undefined : 401),
    }

    const peer = new DshWebPeer(
      api,
      { clientDeviceId: 'dev-1', connectionId: 'conn-1' },
      () => ({ origin: localGui.origin, auth }),
    )
    cleanups.push(() => peer.dispose())

    const firstOpen = peer.open()
    const firstOpenResult = firstOpen.catch((error: unknown) => error)

    await Promise.race([
      upgradeStarted,
      firstOpenResult.then(err => Promise.reject(new Error(`first open settled before upgrade: ${String(err)}`))),
    ])

    // Fire close() without awaiting, then immediately open() on the same turn.
    const closePromise = peer.close()
    const secondOpen = peer.open()
    expect(secondOpen).not.toBe(firstOpen)

    await closeEntered
    expect(await firstOpenResult).toBeInstanceOf(Error)
    expect(allocateCount).toBe(1)

    const healthyClientPromise = healthyTunnel.nextClient()
    releaseFirstClose()
    await closePromise

    const secondGrant = await secondOpen
    const healthyClient = await healthyClientPromise

    expect(secondGrant.url).toBe('https://p33333333333.tunnel.example/')
    expect(dialAttempt).toBe(2)
    expect(healthyClient.readyState).toBe(WebSocket.OPEN)
    expect(closedSessions).toEqual(['p22222222222'])

    await peer.dispose()
    expect(closedSessions).toEqual(['p22222222222', 'p33333333333'])
  })

  it('forwards >4 MiB WebSocket frames bidirectionally without closing', async () => {
    const local = await listenWs()
    cleanups.push(local.close)

    const tunnel = await listenWs()
    cleanups.push(tunnel.close)

    const clientPromise = tunnel.nextClient()
    const conn = await Connection.open({
      tunnel: { id: 't22222222222', url: 'https://test.tun-test.4ba.io/', connectUrl: tunnel.url, token: 'tok' },
      target: new URL(local.url.replace('ws:', 'http:')),
      authorize: req => req,
      stripResponseHeaders,
      onRequest: () => undefined,
    })
    cleanups.push(() => { conn.close(CLOSE_SHUTDOWN, 'test') })
    const peerWs = await clientPromise
    const { frames, waitFor } = collectFrames(peerWs)

    const localClientPromise = local.nextClient()
    peerWs.send(encodeFrame(FrameType.Open, 1, encodeOpen({ method: 'GET', path: '/ws', headers: [], body: false, websocket: [] })))
    await waitFor(all => all.some(f => f.stream === 1 && f.type === FrameType.Head))
    expect(decodeHead(frames.find(f => f.stream === 1 && f.type === FrameType.Head)!.payload).status).toBe(101)
    const localWs = await localClientPromise

    const receivedAtLocal: Array<{ data: Uint8Array; isBinary: boolean }> = []
    localWs.on('message', (data, isBinary) => {
      receivedAtLocal.push({ data: rawToUint8Array(data), isBinary })
    })

    const largeSize = 5 * 1024 * 1024
    const ingressPayload = Buffer.alloc(largeSize, 0x41)
    peerWs.send(encodeFrame(FrameType.Text, 1, ingressPayload))

    const deadline = Date.now() + 10_000
    while (receivedAtLocal.length < 1 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(receivedAtLocal).toHaveLength(1)
    expect(receivedAtLocal[0]!.isBinary).toBe(false)
    expect(Buffer.from(receivedAtLocal[0]!.data).equals(ingressPayload)).toBe(true)
    expect(localWs.readyState).toBe(WebSocket.OPEN)

    const egressPayload = Buffer.alloc(largeSize, 0x42)
    localWs.send(egressPayload)
    await waitFor(all => all.some(f => f.stream === 1 && f.type === FrameType.Data), 10_000)

    const dataFrame = frames.find(f => f.stream === 1 && f.type === FrameType.Data)!
    expect(Buffer.from(dataFrame.payload).equals(egressPayload)).toBe(true)
    expect(frames.some(f => f.stream === 1 && (f.type === FrameType.End || f.type === FrameType.Reset))).toBe(false)
    expect(localWs.readyState).toBe(WebSocket.OPEN)
  }, 30_000)

  it('maps oversized local WebSocket payload errors to close code 1009', async () => {
    const local = await listenWs()
    cleanups.push(local.close)

    const tunnel = await listenWs()
    cleanups.push(tunnel.close)

    const clientPromise = tunnel.nextClient()
    const conn = await Connection.open({
      tunnel: { id: 't22222222222', url: 'https://test.tun-test.4ba.io/', connectUrl: tunnel.url, token: 'tok' },
      target: new URL(local.url.replace('ws:', 'http:')),
      authorize: req => req,
      stripResponseHeaders,
      onRequest: () => undefined,
    })
    cleanups.push(() => { conn.close(CLOSE_SHUTDOWN, 'test') })
    const peerWs = await clientPromise
    const { frames, waitFor } = collectFrames(peerWs)

    const localClientPromise = local.nextClient()
    peerWs.send(encodeFrame(FrameType.Open, 1, encodeOpen({ method: 'GET', path: '/ws', headers: [], body: false, websocket: [] })))
    await waitFor(all => all.some(f => f.stream === 1 && f.type === FrameType.Head))
    expect(decodeHead(frames.find(f => f.stream === 1 && f.type === FrameType.Head)!.payload).status).toBe(101)
    const localWs = await localClientPromise

    localWs.send(Buffer.alloc(MAX_WEBSOCKET_MESSAGE_BYTES + 1, 0x61), { binary: true })
    await waitFor(all => all.some(f => f.stream === 1 && f.type === FrameType.End), 10_000)

    const endFrame = frames.find(f => f.stream === 1 && f.type === FrameType.End)!
    expect(decodeClose(endFrame.payload)).toEqual({
      code: 1009,
      reason: 'Max payload size exceeded',
    })
  }, 30_000)
})

describe('DSH Web connector establishment', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['network_error', 'unauthorized'] as const)('handles initial %s without reallocating', async code => {
    const id = 'tbcdefghijkm'
    const url = `https://${id}.tun-test.4ba.io/`
    const leaseExpiresAt = Date.now() + 30 * 60_000
    const grant = { url, browserGrant: 'b'.repeat(43), expiresAt: Date.now() + 30_000 }
    const api = {
      dshWebRequest: vi.fn(async (action: string, _input: unknown) => action === 'allocate' ? {
        sessionId: id, url, connectUrl: `wss://tun-test.4ba.io/api/tunnels/${id}/connect`,
        connectToken: 't'.repeat(43), leaseExpiresAt,
      } : grant),
      closeDshWeb: vi.fn(async () => undefined),
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })))
    const connector = Object.assign(Object.create(Connection.prototype), {
      closed: new Promise(() => undefined),
      close: vi.fn(),
    })
    const dial = vi.spyOn(Connection, 'open').mockRejectedValueOnce(new TunnelError(code, 'synthetic failure')).mockResolvedValue(connector)
    const cordisOriginal = Symbol.for('cordis.original')
    let authInstance: DshWebBrowserAuth = {
      authenticatedUrl: origin => origin + '?token=local',
      authorizeIndex: (_request, response) => {
        response.writeHead(303, { 'set-cookie': 'local=session; Path=/' })
        return false
      },
      requestRejection: () => undefined,
    }
    const host = new DshWebPeer(api, { clientDeviceId: 'client', connectionId: 'connection' }, () => ({
      origin: new URL('http://127.0.0.1:3080/'),
      auth: new Proxy(authInstance, {
        get: (target, property, receiver) => property === cordisOriginal ? target : Reflect.get(target, property, receiver),
      }),
    }))
    try {
      if (code === 'network_error') {
        await expect(host.open()).resolves.toEqual(grant)
        expect(dial).toHaveBeenCalledTimes(2)
        expect(dial.mock.calls[0]?.[0].tunnel).toEqual(dial.mock.calls[1]?.[0].tunnel)
        expect(api.dshWebRequest.mock.calls.map(([action]) => action)).toEqual(['allocate', 'grant'])
        expect(api.dshWebRequest.mock.calls[0]?.[1]).toMatchObject({ useServerLease: true })
        expect(api.dshWebRequest.mock.calls[1]?.[1]).toMatchObject({ leaseExpiresAt })
        const authorize = dial.mock.calls[1]![0].authorize
        const index: OpenMessage = { method: 'GET', path: '/', headers: [], body: false }
        expect(authorize(index)?.headers).toEqual([['cookie', 'local=session']])
        authInstance = { ...authInstance }
        expect(authorize(index)).toBeUndefined()
      } else {
        await expect(host.open()).rejects.toMatchObject({ code: 'TUNNEL_UNAVAILABLE' })
        expect(dial).toHaveBeenCalledTimes(1)
        expect(api.dshWebRequest.mock.calls.map(([action]) => action)).toEqual(['allocate'])
      }
    } finally {
      await host.dispose()
    }
    expect(api.closeDshWeb).toHaveBeenCalledWith(id)
  })
})

describe('LAN Web connection ownership', () => {
  it.each([
    ['missing candidate', async (): Promise<string | undefined> => undefined],
    ['ineligible address', async (): Promise<string | undefined> => '192.0.2.1'],
    ['unavailable ICE stats', async (): Promise<string | undefined> => { throw new Error('RTC path unavailable') }],
  ] as const)('allows tunnel fallback for %s even while mode is LAN', async (_, address) => {
    const { DshWebLanPeer } = await import('../src/dsh-web-lan.js')
    const auth = { authenticatedUrl: vi.fn(), authorizeIndex: vi.fn(), requestRejection: vi.fn() }
    const peer = new DshWebLanPeer(() => ({ origin: new URL('http://127.0.0.1'), auth }), () => 'LAN', address)
    try {
      expect(await peer.onLan()).toBe(false)
      await expect(peer.open({})).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' })
      expect(auth.authorizeIndex).not.toHaveBeenCalled()
    } finally {
      peer.dispose()
    }
  })

  it.each(['private IPv4', 'loopback'])('requires a one-time Noise grant and retires the %s lease', async scope => {
    const { DshWebLanPeer } = await import('../src/dsh-web-lan.js')
    const { networkInterfaces } = await import('node:os')
    const { dshWebLanGrantSchema, isLanUploadAddress } = await import('@dsh-remote/protocol')
    const address = scope === 'loopback' ? '127.0.0.1' : Object.values(networkInterfaces()).flat().find(i => i && !i.internal && isLanUploadAddress(i.address))?.address
    const upstream = await listenHttp((req, res) => {
      res.writeHead(req.headers.cookie === 'local=owned' ? 200 : 401, { 'content-type': 'text/html', 'set-cookie': 'local=owned' })
      res.end('hello')
    })
    const wsServer = new WebSocketServer({ server: upstream.server })
    wsServer.on('connection', (ws, req) => ws.send(req.headers.cookie === 'local=owned' ? 'hello' : 'denied'))
    let mode = 'LAN'
    const auth: DshWebBrowserAuth = {
      authenticatedUrl: url => url,
      authorizeIndex: (_, res) => { res.writeHead(303, { 'set-cookie': 'local=owned' }); return true },
      requestRejection: () => undefined,
    }
    const peer = new DshWebLanPeer(() => ({ origin: upstream.origin, auth }), () => mode, async () => address)
    try {
      for (mode of ['P2P', 'TURN', 'Relay']) {
        expect(await peer.onLan()).toBe(false)
        await expect(peer.open({})).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' })
      }
      mode = 'LAN'
      expect(await peer.onLan()).toBe(true)
      const stale = await peer.open({})
      const current = dshWebLanGrantSchema.parse(await peer.open({}))
      expect(new URL(current.url).hostname).toBe(address)
      peer.close({ sessionId: stale.sessionId })
      const { url, browserGrant } = current
      for (const path of ['', 'api/test', '__remote/browser', '__remote/session-bootstrap', '__remote/lan-status']) {
        expect((await fetch(url + path)).status).toBe(401)
      }
      const wsUrl = url.replace('http:', 'ws:')
      const anonymous = new WebSocket(wsUrl)
      await expect(new Promise((_resolve, reject) => anonymous.once('error', reject))).rejects.toThrow('401')
      const redeem = () => fetch(url + '__remote/session', { method: 'POST', redirect: 'manual',
        headers: { origin: new URL(url).origin }, body: new URLSearchParams({ browserGrant }) })
      const [first, second] = await Promise.all([redeem(), redeem()])
      expect([first.status, second.status].sort()).toEqual([303, 401])
      const cookie = (first.status === 303 ? first : second).headers.get('set-cookie')!.split(';')[0]!
      const lanStatus = await fetch(url + '__remote/lan-status', { headers: { cookie } })
      expect(lanStatus.status).toBe(204)
      expect(lanStatus.headers.get('x-dsh-web-lan')).toBe('1')
      const bot = await fetch(url + 'api/bot', {
        method: 'POST', headers: { cookie, origin: new URL(url).origin }, body: '{}',
      })
      expect(await bot.text()).toBe('hello')
      const page = await fetch(url, { headers: { cookie } })
      expect(await page.text()).toBe('hello')
      expect(page.headers.has('set-cookie')).toBe(false)
      expect((await fetch(url + 'ds-harness-remote', { headers: { cookie } })).status).toBe(403)
      expect((await fetch(url, { method: 'POST', headers: { cookie, origin: 'http://example.invalid' } })).status).toBe(403)
      const ws = new WebSocket(wsUrl, { headers: { cookie, origin: new URL(url).origin } })
      expect(await new Promise((resolve, reject) => ws.once('message', data => resolve(data.toString())).once('error', reject))).toBe('hello')
      const closed = new Promise(resolve => ws.once('close', resolve))
      mode = 'TURN'
      await closed
      await expect(peer.open({})).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' })
      await expect(fetch(url, { headers: { cookie } })).rejects.toThrow()
    } finally {
      peer.dispose()
      wsServer.close()
      await upstream.close()
    }
  })
})

describe('DSH 0.2.3 token auth integration', () => {
  it('advertises DSH Web and authenticates upstream via webserver/entry-url + connection.admit', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-web-023-'))
    vi.stubEnv('DSH_HOME', dshHome)
    const localGui = await listenHttp((req, res) => {
      if (req.method === 'GET' && req.url === '/?token=launch-secret') {
        res.writeHead(303, {
          location: './',
          'set-cookie': ['dsh-auth-old=; Max-Age=0; Path=/', 'dsh-auth-test=signed; Path=/; HttpOnly'],
        })
        res.end()
        return
      }
      if (req.method === 'GET' && req.url === '/' && req.headers.cookie === 'dsh-auth-test=signed') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html>dsh-023</html>')
        return
      }
      res.writeHead(401)
      res.end()
    })

    const store = new remotePlugin.IdentityStore({ directory: join(dshHome, 'ds-harness-remote'), role: 'host' })
    await store.loadOrCreate('DSH 0.2.3 Host')
    await store.trustPeer({ deviceId: 'client-phone', name: 'Phone', publicKey: 'key-client-phone', platform: 'android' })

    const ctx = new Context()
    ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [{ ns: 'ds-harness-remote', value: { codex: { enabled: false }, acp: { enabled: false } } }],
      replace: async () => undefined,
    } as never)
    ctx.provide('typertGateway', {
      supportsCarrier: true,
      dispatchRpc: async () => ({ ok: false, error: { code: 'gateway/arguments-invalid', message: 'probe', details: {} } }),
      invoke: async () => undefined,
      openWireStream: async () => (async function* () {})(),
    } as never)
    ctx.provide('webApp', { getAdvertisedUrl: () => localGui.origin.href } as never)
    ctx.provide('webServer', {
      getOrigin: () => localGui.origin.href,
      register: () => async () => undefined,
    } as never)
    ctx.provide('connection', {
      admit: (req: { headers: Record<string, string> }) => (
        req.headers.cookie === 'dsh-auth-test=signed'
          ? { peer: { principal: { kind: 'owner' }, signal: new AbortController().signal } }
          : { rejection: 401 }
      ),
      rpc: {},
    } as never)
    ctx.on('webserver/entry-url' as never, ((baseUrl: string, entries: Array<{ label: string; url: string; open: boolean }>) => {
      entries.push({ label: 'dsh web', url: `${baseUrl}?token=launch-secret`, open: true })
    }) as never)

    const fiber = await ctx.plugin(remotePlugin, { codex: { enabled: false }, acp: { enabled: false } })
    try {
      await vi.waitFor(() => expect(ctx.dshRemote.currentIdentity()).toBeDefined())
      let onInbound: (message: RemoteMessage) => void = () => undefined
      const sent: RemoteMessage[] = []
      await ctx.dshRemote.acceptAuthenticatedPeer({
        security: { protocol: 'Noise_IK_25519_ChaChaPoly_SHA256', connectionId: 'conn-023', membershipId: 'mem-023' },
        peerDeviceId: 'client-phone',
        peerIdentityKey: 'key-client-phone',
        mode: 'LAN',
        lanWebAddress: async () => '127.0.0.1',
        send: async message => { sent.push(message) },
        onMessage: handler => { onInbound = handler; return () => { onInbound = () => undefined } },
        close: async () => undefined,
      })

      const call = async (method: Parameters<typeof createRpcRequest>[0], params: unknown) => {
        const req = createRpcRequest(method, params)
        onInbound(req)
        let response: RemoteMessage | undefined
        await vi.waitFor(() => {
          response = sent.find(m =>
            (m.type === 'rpc.response' || m.type === 'rpc.error')
            && (m.payload as { requestId?: string }).requestId === req.id)
          expect(response).toBeDefined()
        })
        if (response!.type === 'rpc.error') {
          throw new Error(`RPC error: ${JSON.stringify(response!.payload)}`)
        }
        return (response!.payload as RpcResponsePayload).result
      }

      const described = await call('harness.transport.describe', {}) as { capabilities: string[]; dshWebLanReady?: boolean }
      expect(described.capabilities).toContain(DSH_WEB_LAN_CAPABILITY)
      expect(described.dshWebLanReady).toBe(true)

      const grant = dshWebLanGrantSchema.parse(await call('dsh.web.lan.direct.open', {}))
      const bootstrap = await fetch(`${grant.url}__remote/session-bootstrap`, {
        redirect: 'manual',
        headers: { 'x-dsh-web-grant': grant.browserGrant },
      })
      expect(bootstrap.status).toBe(303)
      const sessionCookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!
      const page = await fetch(grant.url, { headers: { cookie: sessionCookie } })
      expect(page.status).toBe(200)
      expect(await page.text()).toBe('<html>dsh-023</html>')
    } finally {
      vi.unstubAllEnvs()
      await fiber.dispose()
      await ctx.fiber.dispose()
      await localGui.close()
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('invalidates entry-url upstream when listener, connection, or webServer changes', async () => {
    const localGui = await listenHttp((req, res) => {
      if (req.url === '/?token=launch-secret') {
        res.writeHead(303, { location: './', 'set-cookie': 'dsh-auth-test=signed; Path=/' })
        res.end()
        return
      }
      if (req.url === '/' && req.headers.cookie === 'dsh-auth-test=signed') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html>ok</html>')
        return
      }
      res.writeHead(401)
      res.end()
    })
    try {
      for (const change of ['dispose-listener', 'replace-connection', 'replace-webserver'] as const) {
        const ctx = new Context()
        ctx.provide('webApp', { getAdvertisedUrl: () => localGui.origin.href } as never)
        const wsFiber = await ctx.plugin({
          name: 'ws',
          apply(c) { c.provide('webServer', { getOrigin: () => localGui.origin.href } as never) },
        })
        const connFiber = await ctx.plugin({
          name: 'conn',
          apply(c) {
            c.provide('connection', {
              admit: () => ({ peer: { signal: new AbortController().signal } }),
            } as never)
          },
        })
        const disposeEntry = ctx.on('webserver/entry-url' as never, ((baseUrl: string, entries: Array<{ url: string }>) => {
          entries.push({ url: `${baseUrl}?token=launch-secret` })
        }) as never)

        const upstream = await openDshWebUpstream(() => resolveDshWebRuntime(ctx), AbortSignal.timeout(5_000))
        expect(upstream.isCurrent()).toBe(true)
        expect(upstream.authorize({ method: 'GET', path: '/', headers: [], body: false }, localGui.origin)?.headers)
          .toContainEqual(['cookie', 'dsh-auth-test=signed'])

        if (change === 'dispose-listener') {
          disposeEntry()
        } else if (change === 'replace-connection') {
          await connFiber.dispose()
          ctx.provide('connection', { admit: () => ({ peer: { signal: new AbortController().signal } }) } as never)
        } else {
          await wsFiber.dispose()
          ctx.provide('webServer', { getOrigin: () => localGui.origin.href } as never)
        }

        expect(upstream.isCurrent()).toBe(false)
        expect(upstream.authorize({ method: 'GET', path: '/', headers: [], body: false }, localGui.origin)).toBeUndefined()
        await ctx.fiber.dispose()
      }
    } finally {
      await localGui.close()
    }
  })

  it('unwraps Cordis tracing proxy before calling connection.admit', async () => {
    const localGui = await listenHttp((req, res) => {
      if (req.url === '/?token=launch-secret') {
        res.writeHead(303, { location: './', 'set-cookie': 'dsh-auth-test=signed; Path=/' })
        res.end()
        return
      }
      if (req.url === '/' && req.headers.cookie === 'dsh-auth-test=signed') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html>ok</html>')
        return
      }
      res.writeHead(401)
      res.end()
    })
    try {
      const target = {
        admit(this: unknown, req: { headers: Record<string, string> }) {
          if (this !== target) throw new Error('cannot get property "connection.authentication" without inject')
          return req.headers.cookie === 'dsh-auth-test=signed'
            ? { peer: { signal: new AbortController().signal } }
            : { rejection: 401 }
        },
      }
      const cordisOriginal = Symbol.for('cordis.original')
      const proxiedConnection = new Proxy(target, {
        get(obj, prop, receiver) {
          if (prop === cordisOriginal) return obj
          return Reflect.get(obj, prop, receiver)
        },
      })
      const ctx = new Context()
      ctx.provide('webApp', {} as never)
      ctx.provide('webServer', { getOrigin: () => localGui.origin.href } as never)
      ctx.provide('connection', proxiedConnection as never)
      ctx.on('webserver/entry-url' as never, ((b: string, e: unknown[]) => {
        e.push({ url: `${b}?token=launch-secret` })
      }) as never)
      try {
        const upstream = await openDshWebUpstream(() => resolveDshWebRuntime(ctx), AbortSignal.timeout(5_000))
        expect(upstream.isCurrent()).toBe(true)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      await localGui.close()
    }
  })

  it('fails closed on invalid entry-url discovery and token exchange boundaries', async () => {
    const { runScenarios } = await import('../../../scripts/test-scenarios.mjs')
    type BoundaryScenario =
      | { name: string; kind: 'resolve'; setup: (ctx: Context, origin: URL) => void }
      | { name: string; kind: 'open'; status: number; setCookie: string[]; admit: () => unknown }
    const scenarios: BoundaryScenario[] = [
      { name: 'missing webApp', kind: 'resolve', setup: (ctx, origin) => {
        ctx.provide('webServer', { getOrigin: () => origin.href } as never)
        ctx.provide('connection', { admit: () => ({ peer: { signal: new AbortController().signal } }) } as never)
        ctx.on('webserver/entry-url' as never, ((b: string, e: unknown[]) => { e.push({ url: `${b}?token=t` }) }) as never)
      } },
      { name: 'missing entry-url listener', kind: 'resolve', setup: (ctx, origin) => {
        ctx.provide('webApp', {} as never)
        ctx.provide('webServer', { getOrigin: () => origin.href } as never)
        ctx.provide('connection', { admit: () => ({ peer: { signal: new AbortController().signal } }) } as never)
      } },
      { name: 'wrong entry origin', kind: 'resolve', setup: (ctx, origin) => {
        ctx.provide('webApp', {} as never)
        ctx.provide('webServer', { getOrigin: () => origin.href } as never)
        ctx.provide('connection', { admit: () => ({ peer: { signal: new AbortController().signal } }) } as never)
        ctx.on('webserver/entry-url' as never, ((_b: string, e: unknown[]) => { e.push({ url: 'http://evil.invalid/?token=t' }) }) as never)
      } },
      { name: 'non-root entry pathname', kind: 'resolve', setup: (ctx, origin) => {
        ctx.provide('webApp', {} as never)
        ctx.provide('webServer', { getOrigin: () => origin.href } as never)
        ctx.provide('connection', { admit: () => ({ peer: { signal: new AbortController().signal } }) } as never)
        ctx.on('webserver/entry-url' as never, ((b: string, e: unknown[]) => { e.push({ url: `${b}sub?token=t` }) }) as never)
      } },
      { name: 'duplicate token parameter', kind: 'resolve', setup: (ctx, origin) => {
        ctx.provide('webApp', {} as never)
        ctx.provide('webServer', { getOrigin: () => origin.href } as never)
        ctx.provide('connection', { admit: () => ({ peer: { signal: new AbortController().signal } }) } as never)
        ctx.on('webserver/entry-url' as never, ((b: string, e: unknown[]) => { e.push({ url: `${b}?token=a&token=b` }) }) as never)
      } },
      { name: 'non-303 token exchange', kind: 'open', status: 200, setCookie: ['dsh-auth=ok; Path=/'], admit: () => ({ peer: { signal: new AbortController().signal } }) },
      { name: 'only deleted Max-Age=0 cookie', kind: 'open', status: 303, setCookie: ['dsh-auth-old=; Max-Age=0; Path=/'], admit: () => ({ peer: { signal: new AbortController().signal } }) },
      { name: 'admit rejects cookie', kind: 'open', status: 303, setCookie: ['dsh-auth=bad; Path=/'], admit: () => ({ rejection: 401 }) },
      { name: 'admit returns aborted peer', kind: 'open', status: 303, setCookie: ['dsh-auth=ok; Path=/'], admit: () => {
        const ac = new AbortController()
        ac.abort()
        return { peer: { signal: ac.signal } }
      } },
    ]
    await runScenarios(scenarios.map(scenario => ({
      name: scenario.name,
      run: async () => {
        if (scenario.kind === 'resolve') {
          const ctx = new Context()
          try {
            scenario.setup(ctx, new URL('http://127.0.0.1:3080/'))
            expect(resolveDshWebRuntime(ctx)).toBeUndefined()
          } finally {
            await ctx.fiber.dispose()
          }
          return
        }
        const server = await listenHttp((req, res) => {
          if (req.url === '/?token=launch-secret') {
            res.writeHead(scenario.status, { location: './', 'set-cookie': scenario.setCookie })
            res.end()
            return
          }
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end('<html>ok</html>')
        })
        const ctx = new Context()
        try {
          ctx.provide('webApp', {} as never)
          ctx.provide('webServer', { getOrigin: () => server.origin.href } as never)
          ctx.provide('connection', { admit: scenario.admit } as never)
          ctx.on('webserver/entry-url' as never, ((b: string, e: unknown[]) => {
            e.push({ url: `${b}?token=launch-secret` })
          }) as never)
          await expect(openDshWebUpstream(() => resolveDshWebRuntime(ctx), AbortSignal.timeout(5_000)))
            .rejects.toMatchObject({ code: 'DSH_WEB_NOT_READY' })
        } finally {
          await ctx.fiber.dispose()
          await server.close()
        }
      },
    })))
  })
})
