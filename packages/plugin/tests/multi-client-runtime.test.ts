import { RpcId, type ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { createRpcRequest, type RemoteMessage } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig } from '../src/config.js'
import type { HostIdentity, IdentityStore } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import { HostPluginRuntime } from '../src/service.js'
import type { AuthenticatedPeerChannel } from '../src/types.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'

describe('HostPluginRuntime multi-Client routing', () => {
  it('advertises ApiProxy alongside Session V3 for older Remote Web clients', async () => {
    const runtime = new HostPluginRuntime(
      config(),
      identities(),
      apiProxy({}),
      logger(),
      localGateway(),
    )
    await runtime.start()
    ;(runtime as unknown as { harnessVersion: string }).harnessVersion = '0.1.5-rc.1'

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
    expect(phone.sent()).not.toContainEqual(expect.objectContaining({ type: 'rpc.error' }))
    expect(desktop.sent()).not.toContainEqual(expect.objectContaining({ type: 'rpc.error' }))

    await runtime.close()
    expect(streamSignals.every(signal => signal.aborted)).toBe(true)
  })
})

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
  return {
    loadOrCreate: vi.fn(async () => identity),
    isTrusted: vi.fn(() => true),
    listTrustedPeers: vi.fn(() => []),
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
    send,
    close: vi.fn(async () => undefined),
    onMessage: vi.fn(next => { handler = next; return () => { handler = () => undefined } }),
    push: message => handler(message),
    sent: () => [...sentMessages],
  }
}

function config(): ResolvedConfig {
  return {
    enabled: true,
    role: 'host',
    serverUrl: undefined,
    deviceName: 'Host',
    forceRelay: true,
    logLevel: 'error',
    reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 1_000, jitter: 0 },
    codex: { enabled: false, binary: 'codex' },
  }
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}
