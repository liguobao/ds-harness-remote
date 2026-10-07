import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { RpcId, type ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { createRpcRequest, type LoopbackRead, type LoopbackWsRead, type RemoteMessage, type RpcErrorPayload, type RpcResponsePayload } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import type { ResolvedConfig } from '../src/config.js'
import type { HostIdentity, IdentityStore } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import { HostPluginRuntime } from '../src/service.js'
import { CodexRemoteDomain } from '../src/codex/domain.js'
import { CodexAppServerError, type CodexAppServerLike } from '../src/codex/app-server.js'
import type { AuthenticatedPeerChannel } from '../src/types.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'

describe('HostPluginRuntime multi-Client routing', () => {
  it.each(['ready', 'disabled', 'protocol-failure', 'permission-denied', 'signed-out', 'account-failure', 'not-ready'] as const)(
    'advertises CodeX workspace types over the authenticated channel only when %s', async scenario => {
      const settings = { ...config(), codex: { enabled: scenario !== 'disabled', binary: '/test/codex' } }
      const runtime = new HostPluginRuntime(settings, identities(), apiProxy({}), logger())
      let ready = false
      const app: CodexAppServerLike = {
        start: vi.fn(async () => {
          if (scenario === 'protocol-failure' || scenario === 'permission-denied') {
            throw new CodexAppServerError('CODEX_START_FAILED', scenario)
          }
          ready = scenario !== 'not-ready'
        }),
        isReady: () => ready,
        call: vi.fn(async method => {
          if (method !== 'account/read') throw new Error('Capability discovery must not query projects or sessions.')
          if (scenario === 'account-failure') throw new CodexAppServerError('CODEX_REQUEST_TIMEOUT', 'account unavailable')
          return {
            requiresOpenaiAuth: true,
            account: scenario === 'signed-out' ? null : { type: 'chatgpt' },
            projectPath: '/private/workspace', prompt: 'private prompt',
            fileContent: 'private source', toolOutput: 'private output',
          }
        }),
        respond: vi.fn(async () => undefined),
        respondError: vi.fn(async () => undefined),
        onInbound: () => () => undefined,
        onUnavailable: () => () => undefined,
        close: vi.fn(async () => { ready = false }),
      }
      const factory = vi.fn(() => app)
      // Exercise the real domain startup/auth state machine with a controlled upstream.
      ;(runtime as unknown as { codex: CodexRemoteDomain }).codex = new CodexRemoteDomain(settings.codex, logger(), factory)
      const channel = fakeChannel('workspace-types', 'client-phone')
      const describe = async () => {
        const request = createRpcRequest('harness.transport.describe', {})
        channel.push(request)
        let response: RemoteMessage | undefined
        await vi.waitFor(() => {
          response = channel.sent().find(message => message.type === 'rpc.response'
            && (message.payload as RpcResponsePayload).requestId === request.id)
          expect(response).toBeDefined()
        })
        return (response!.payload as RpcResponsePayload).result as { capabilities: string[]; workspaceTypes: unknown[] }
      }
      try {
        await runtime.start()
        await runtime.acceptAuthenticatedPeer(channel)
        const result = await describe()
        expect(result.capabilities).toEqual(scenario === 'ready'
          ? ['harness.api.v1', 'harness.api.transfer.v1', 'codex.appserver.v1', 'codex.appserver.transfer.v1']
          : ['harness.api.v1', 'harness.api.transfer.v1'])
        expect(result.workspaceTypes).toEqual(scenario === 'ready'
          ? [{ id: 'codex', name: 'CodeX', capability: 'codex.appserver.v1', available: true }]
          : [])
        expect(JSON.stringify(result)).not.toMatch(/private|projectPath|prompt|fileContent|toolOutput/)
        if (scenario === 'disabled') expect(factory).not.toHaveBeenCalled()
        if (scenario === 'ready') {
          expect(app.call).toHaveBeenCalledWith('account/read', { refreshToken: false }, 15_000)
          // The advertisement must reflect a lost upstream immediately, without cached readiness.
          ready = false
          const disconnected = await describe()
          expect(disconnected.workspaceTypes).toEqual([])
          expect(disconnected.capabilities).not.toContain('codex.appserver.v1')
          expect(disconnected.capabilities).not.toContain('codex.appserver.transfer.v1')
        }
      } finally { await runtime.close() }
    },
  )

  it('starts the Harness Host without waiting for ACP and advertises enabled backend support during warmup', async () => {
    const settings = { ...config(), serverUrl: 'https://example.invalid', acp: { enabled: true, backends: [
      { id: 'antigravity', enabled: true, command: 'agy', args: [] },
      { id: 'cursor', enabled: false, command: 'agent', args: ['acp'] },
    ] } }
    const runtime = new HostPluginRuntime(settings, { ...identities(), directory: '/tmp/dsh-remote-startup-test' } as IdentityStore, apiProxy({}), logger(), localGateway())
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const start = vi.fn()
    const stop = vi.fn(async () => undefined)
    const internal = runtime as unknown as {
      acp: { start(): Promise<void> }
      readHarnessVersion(): Promise<string>
      createServerConnection(): unknown
    }
    vi.spyOn(internal.acp, 'start').mockReturnValue(pending)
    vi.spyOn(internal, 'readHarnessVersion').mockResolvedValue('0.2.0-rc.1')
    vi.spyOn(internal, 'createServerConnection').mockReturnValue({ start, stop, isOnline: () => true, lastError: () => undefined })
    try {
      await runtime.start()
      expect(start).toHaveBeenCalledTimes(1)
      const capabilities = runtime.diagnostics().capabilities
      expect(capabilities).toContain('harness.remote.v3')
      expect(capabilities).toContain('agent.acp.antigravity.v1')
      expect(capabilities).not.toContain('agent.acp.cursor.v1')
      expect(runtime.diagnostics().workspaceTypes).toEqual([{
        id: 'antigravity', name: 'Antigravity', capability: 'agent.acp.antigravity.v1', available: false,
      }])
    } finally {
      await runtime.close()
      release()
      await pending
    }
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it.each(['0.1.5-rc.1', '0.2.0-rc.1'])('advertises ApiProxy alongside Session V3 on %s', async version => {
    const runtime = new HostPluginRuntime(
      config(),
      identities(),
      apiProxy({}),
      logger(),
      localGateway(),
    )
    await runtime.start()
    ;(runtime as unknown as { harnessVersion: string }).harnessVersion = version

    expect(runtime.diagnostics()).toMatchObject({
      capabilities: expect.arrayContaining([
        'harness.remote.v3',
        'harness.remote.transfer.v1',
        'harness.api.v1',
        'harness.api.transfer.v1',
      ]),
    })
    await runtime.close()
  })

  it('allows identical stream ids on different Client connections without crossing frames', async () => {
    const streamSignals: AbortSignal[] = []
    const mux: ApiProxy['events']['mux'] = async function* (request, signal) {
      streamSignals.push(signal)
      yield {
        rpcId: RpcId(`frame-for-${String(request.rpcId)}`),
        payload: { type: 'session/subscribed', sessionId: 'session-1' as never, lastSeq: 0 },
      }
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    }
    const api = apiProxy({
      mux,
    })
    const runtime = new HostPluginRuntime(
      config(),
      identities(),
      api,
      logger(),
    )
    await runtime.start()

    const phone = fakeChannel('connection-phone', 'client-phone')
    const desktop = fakeChannel('connection-desktop', 'client-desktop')
    await runtime.acceptAuthenticatedPeer(phone)
    await runtime.acceptAuthenticatedPeer(desktop)

    phone.push(streamRequest('phone-open'))
    desktop.push(streamRequest('desktop-open'))

    await vi.waitFor(() => {
      expect(streamSignals).toHaveLength(2)
      expect(phone.sent()).toContainEqual(expect.objectContaining({ type: 'rpc.response' }))
      expect(desktop.sent()).toContainEqual(expect.objectContaining({ type: 'rpc.response' }))
      expect(streamFrameRpcIds(phone.sent())).toEqual(['frame-for-phone-open'])
      expect(streamFrameRpcIds(desktop.sent())).toEqual(['frame-for-desktop-open'])
    })
    expect(runtime.diagnostics()).toMatchObject({
      online: true,
      activeConnections: 2,
    })
    expect(runtime.connections.peerDeviceIds()).toEqual(['client-phone', 'client-desktop'])
    expect(runtime.hostStatus().connectedClients).toEqual([
      { deviceId: 'client-phone', name: 'Phone', platform: 'android', mode: 'LAN' },
      { deviceId: 'client-desktop', name: 'Laptop', platform: 'darwin', mode: 'P2P' },
    ])
    expect(phone.sent()).not.toContainEqual(expect.objectContaining({ type: 'rpc.error' }))
    expect(desktop.sent()).not.toContainEqual(expect.objectContaining({ type: 'rpc.error' }))

    await runtime.close()
    expect(streamSignals.every(signal => signal.aborted)).toBe(true)
  })

  it('isolates HTTP preview handles and keeps previews working after another Client disconnects or reconnects', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200)
      response.write(request.url!)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const settings = config()
    settings.loopback.ports = [port]
    const runtime = new HostPluginRuntime(settings, identities(), apiProxy({}), logger())
    try {
      await runtime.start()
      const phone = fakeChannel('connection-phone', 'client-phone')
      const desktop = fakeChannel('connection-desktop', 'client-desktop')
      await runtime.acceptAuthenticatedPeer(phone)
      await runtime.acceptAuthenticatedPeer(desktop)
      const id = randomUUID()
      const open = { op: 'http.open', id, port, path: '/phone', method: 'GET', headers: [] }
      await peerRpc(phone, open)
      await expect(peerRpc(desktop, { op: 'http.read', id })).rejects.toMatchObject({ code: 'LOOPBACK_CLOSED' })
      // Identical ids must be usable independently on different connections.
      await peerRpc(desktop, { ...open, path: '/desktop' })
      expect(await runtime.connections.closeConnection('connection-desktop')).toBe(true)
      const phoneRead = await peerRpc<LoopbackRead>(phone, { op: 'http.read', id })
      expect(Buffer.from(phoneRead.data, 'base64').toString()).toBe('/phone')

      const reconnected = fakeChannel('connection-desktop-2', 'client-desktop')
      await runtime.acceptAuthenticatedPeer(reconnected)
      await expect(peerRpc(reconnected, { op: 'http.read', id })).rejects.toMatchObject({ code: 'LOOPBACK_CLOSED' })
      await peerRpc(reconnected, { ...open, path: '/reconnected' })
      const reconnectRead = await peerRpc<LoopbackRead>(reconnected, { op: 'http.read', id })
      expect(Buffer.from(reconnectRead.data, 'base64').toString()).toBe('/reconnected')
      expect(await peerRpc(phone, { op: 'describe' })).toEqual({ ports: [port] })
    } finally {
      await runtime.close()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('keeps another Client WebSocket preview alive during connection replacement and closes sockets on Host shutdown', async () => {
    const server = createServer()
    const upstream = new WebSocketServer({ server })
    upstream.on('connection', socket => socket.on('message', (data, binary) => socket.send(data, { binary })))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const settings = config()
    settings.loopback.ports = [port]
    const runtime = new HostPluginRuntime(settings, identities(), apiProxy({}), logger())
    try {
      await runtime.start()
      const phone = fakeChannel('connection-phone', 'client-phone')
      const desktop = fakeChannel('connection-desktop', 'client-desktop')
      await runtime.acceptAuthenticatedPeer(phone)
      await runtime.acceptAuthenticatedPeer(desktop)
      const id = randomUUID()
      const open = { op: 'ws.open', id, port, path: '/', headers: [], protocols: [] }
      await peerRpc(phone, open)
      await peerRpc(desktop, open)
      const replacement = fakeChannel('connection-desktop-2', 'client-desktop')
      await runtime.acceptAuthenticatedPeer(replacement)
      await vi.waitFor(() => expect(upstream.clients.size).toBe(1))
      await peerRpc(phone, { op: 'ws.send', id, data: Buffer.from('phone still connected').toString('base64'), binary: false })
      const echo = await peerRpc<LoopbackWsRead>(phone, { op: 'ws.read', id })
      expect(echo.closed).toBe(false)
      expect(echo.messages.map(message => Buffer.from(message.data, 'base64').toString())).toEqual(['phone still connected'])
      await peerRpc(replacement, open)
      await runtime.close()
      await vi.waitFor(() => expect(upstream.clients.size).toBe(0))
    } finally {
      await runtime.close()
      for (const socket of upstream.clients) socket.terminate()
      upstream.close()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('applies changed preview ports to current and reconnected Clients', async () => {
    const settings = config()
    settings.loopback.ports = [5173]
    const runtime = new HostPluginRuntime(settings, identities(), apiProxy({}), logger())
    try {
      await runtime.start()
      const phone = fakeChannel('connection-phone', 'client-phone')
      const desktop = fakeChannel('connection-desktop', 'client-desktop')
      await runtime.acceptAuthenticatedPeer(phone)
      await runtime.acceptAuthenticatedPeer(desktop)
      runtime.setLoopbackPorts([8080])
      for (const client of [phone, desktop]) {
        expect(await peerRpc(client, { op: 'describe' })).toEqual({ ports: [8080] })
        await expect(peerRpc(client, { op: 'http.open', id: randomUUID(), port: 5173, path: '/', method: 'GET', headers: [] }))
          .rejects.toMatchObject({ code: 'LOOPBACK_PORT_DENIED' })
      }
      const replacement = fakeChannel('connection-desktop-2', 'client-desktop')
      await runtime.acceptAuthenticatedPeer(replacement)
      expect(await peerRpc(replacement, { op: 'describe' })).toEqual({ ports: [8080] })
      runtime.setLoopbackPorts([])
      expect(runtime.diagnostics().capabilities).not.toContain('loopback.http-ws.v1')
      expect(await peerRpc(phone, { op: 'describe' })).toEqual({ ports: [] })
      expect(await peerRpc(replacement, { op: 'describe' })).toEqual({ ports: [] })
    } finally {
      await runtime.close()
    }
  })

  it('revokes preview ports for every connected Client while retaining allowed sockets', async () => {
    const servers = [createServer(), createServer()]
    const upstreams = servers.map(server => new WebSocketServer({ server }))
    const runtime = new HostPluginRuntime(config(), identities(), apiProxy({}), logger())
    try {
      const ports = await Promise.all(servers.map(async server => {
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        return (server.address() as { port: number }).port
      }))
      runtime.setLoopbackPorts(ports)
      await runtime.start()
      const phone = fakeChannel('connection-phone', 'client-phone')
      const desktop = fakeChannel('connection-desktop', 'client-desktop')
      await runtime.acceptAuthenticatedPeer(phone)
      await runtime.acceptAuthenticatedPeer(desktop)
      const call = async (channel: typeof phone, params: unknown): Promise<unknown> => {
        const request = createRpcRequest('loopback.call', params)
        channel.push(request)
        let response: RemoteMessage | undefined
        await vi.waitFor(() => {
          response = channel.sent().find(message => (message.type === 'rpc.response' || message.type === 'rpc.error')
            && (message.payload as RpcResponsePayload | RpcErrorPayload).requestId === request.id)
          expect(response).toBeDefined()
        })
        if (response!.type === 'rpc.error') throw response!.payload
        return (response!.payload as RpcResponsePayload).result
      }
      const open = { op: 'ws.open', path: '/', headers: [], protocols: [] }
      const revokedIds = [randomUUID(), randomUUID()]; const keptId = randomUUID()
      await call(phone, { ...open, id: revokedIds[0], port: ports[0] })
      await call(desktop, { ...open, id: revokedIds[1], port: ports[0] })
      await call(desktop, { ...open, id: keptId, port: ports[1] })
      expect(upstreams[0]!.clients.size).toBe(2)
      runtime.setLoopbackPorts([ports[1]!])
      await vi.waitFor(() => expect(upstreams[0]!.clients.size).toBe(0))
      expect(upstreams[1]!.clients.size).toBe(1)
      for (const [index, channel] of [phone, desktop].entries()) {
        await expect(call(channel, { op: 'ws.send', id: revokedIds[index], data: '', binary: false }))
          .rejects.toMatchObject({ code: 'LOOPBACK_CLOSED' })
        await expect(call(channel, { ...open, id: randomUUID(), port: ports[0] }))
          .rejects.toMatchObject({ code: 'LOOPBACK_PORT_DENIED' })
      }
      await expect(call(desktop, { op: 'ws.send', id: keptId, data: '', binary: false })).resolves.toEqual({ sent: true })
    } finally {
      await runtime.close()
      for (const upstream of upstreams) { for (const socket of upstream.clients) socket.terminate(); upstream.close() }
      await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    }
  })
})

async function peerRpc<T = unknown>(channel: ReturnType<typeof fakeChannel>, params: unknown): Promise<T> {
  const request = createRpcRequest('loopback.call', params)
  channel.push(request)
  let response: RemoteMessage | undefined
  await vi.waitFor(() => {
    response = channel.sent().find(message => (message.type === 'rpc.response' || message.type === 'rpc.error')
      && (message.payload as RpcResponsePayload | RpcErrorPayload).requestId === request.id)
    expect(response).toBeDefined()
  })
  if (response!.type === 'rpc.error') {
    const error = response!.payload as RpcErrorPayload
    throw Object.assign(new Error(error.message), { code: error.code })
  }
  return (response!.payload as RpcResponsePayload).result as T
}

function streamRequest(rpcId: string): RemoteMessage {
  return createRpcRequest('harness.api.stream.open', {
    streamId: 'same-client-stream-id',
    stream: 'mux',
    rpcId,
    payload: {},
  })
}

function streamFrameRpcIds(messages: RemoteMessage[]): unknown[] {
  return messages
    .filter(message => message.type === 'event'
      && (message.payload as { event?: string }).event === 'harness.api.frame')
    .map(message => (
      message.payload as { data: { frame: { rpcId: unknown } } }
    ).data.frame.rpcId)
}

function identities(): IdentityStore {
  const identity: HostIdentity = {
    schemaVersion: 1,
    deviceId: 'host-1',
    name: 'Host',
    publicKey: 'host-public-key',
    privateKey: 'host-private-key',
    fingerprint: 'HOST',
  }
  const peers = new Map([
    ['client-phone', { deviceId: 'client-phone', name: 'Phone', platform: 'android' }],
    ['client-desktop', { deviceId: 'client-desktop', name: 'Laptop', platform: 'darwin' }],
  ])
  return {
    loadOrCreate: vi.fn(async () => identity),
    isTrusted: vi.fn(() => true),
    listTrustedPeers: vi.fn(() => [...peers.values()]),
    trustedPeer: vi.fn((deviceId: string) => peers.get(deviceId)),
  } as unknown as IdentityStore
}

function apiProxy(events: Partial<ApiProxy['events']>): ApiProxy {
  const empty = {}
  return {
    sessions: empty,
    subagents: empty,
    host: empty,
    workspace: empty,
    skills: empty,
    agentPresets: empty,
    goals: empty,
    settings: empty,
    credentials: empty,
    llm: empty,
    events: {
      mux: events.mux ?? (async function* () { return }),
      host: events.host ?? (async function* () { return }),
    },
    downloads: empty,
    respond: async () => ({ accepted: true }),
  } as unknown as ApiProxy
}

function localGateway(): LocalTypertGateway {
  return {
    invoke: vi.fn(async () => undefined),
    dispatch: vi.fn(async () => ({ ok: true as const })),
    open: vi.fn(async () => (async function* () { return })()),
    failure: vi.fn(() => ({ code: 'internal', message: 'failed', details: {} })),
    supportsCarrier: true,
  }
}

function fakeChannel(
  connectionId: string,
  peerDeviceId: string,
): AuthenticatedPeerChannel & { push(message: RemoteMessage): void; sent(): RemoteMessage[] } {
  let handler: (message: RemoteMessage) => void = () => undefined
  const sentMessages: RemoteMessage[] = []
  const send = vi.fn(async (message: RemoteMessage) => { sentMessages.push(message) })
  return {
    security: { protocol: 'Noise_IK_25519_ChaChaPoly_SHA256', connectionId, membershipId: 'membership-1' },
    peerDeviceId,
    peerIdentityKey: `key-${peerDeviceId}`,
    mode: peerDeviceId === 'client-desktop' ? 'P2P' : 'LAN',
    send,
    close: vi.fn(async () => undefined),
    onMessage: vi.fn(next => { handler = next; return () => { handler = () => undefined } }),
    push: message => handler(message),
    sent: () => [...sentMessages],
  }
}

function config(): ResolvedConfig {
  return {
    terminal: { enabled: false },
    loopback: { ports: [] },
    enabled: true,
    role: 'host',
    serverUrl: undefined,
    deviceName: 'Host',
    forceRelay: true,
    logLevel: 'error',
    reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 1_000, jitter: 0 },
    codex: { enabled: false, binary: 'codex' },
    cursor: { enabled: false, binary: 'agent' },
  }
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}
