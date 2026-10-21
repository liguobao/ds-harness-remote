import { describe, expect, it, vi } from 'vitest'
import { CodexRemoteClient, RemoteClientCore } from '@dsh-remote/client-core'
import { createRpcResponse, encodeMessage } from '@dsh-remote/protocol'
import { BaseTransport } from '@dsh-remote/webrtc'
import { CodexPeerBridge } from '../src/codex/peer-bridge.ts'

const { client } = vi.hoisted(() => ({ client: { request: vi.fn(), subscribe: vi.fn() } }))
vi.mock('../../../apps/android/src/services/storage', () => ({ loadCodexPermissionPresets: async () => ({}) }))
vi.mock('../../../apps/android/src/services/remote-runtime', () => ({ AndroidRemoteRuntime: class {
  requireCodex() { return client }
} }))
import { SessionRuntime } from '../../../apps/android/src/state/session-runtime.ts'
import { createSessionActions } from '../../../apps/android/src/state/session-actions.ts'

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const thread = id => ({ id, cwd: '/fixture', name: id, createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] })
const session = id => ({ sessionId: `codex:${id}`, nativeId: id,
  backend: 'codex', updatedAt: 1, running: false, blank: false })

describe('Android browsing through the Host bridge', () => {
  it('reclaims a cancelled pending open through the real RPC core and Host bridge', async () => {
    let state = { connection: { phase: 'connected' }, selectedDevice: { deviceId: 'host' },
      sessions: [], messages: {}, sessionLifecycles: {}, currentWorkSessionIds: [] }
    const access = { get: () => state,
      set: change => { state = { ...state, ...(typeof change === 'function' ? change(state) : change) } } }
    const runtime = new SessionRuntime(access)
    runtime.rememberRecentWorkspace = vi.fn(async () => undefined)
    runtime.refreshCodexModels = vi.fn(async () => undefined)
    Object.assign(state, createSessionActions({ ...access, runtime }))
    client.request.mockImplementation(async (_method, args) => ({ thread: thread(args.threadId),
      header: { id: `codex:${args.threadId}` }, records: [], hasMore: false }))
    const pendingRead = deferred()
    const domain = {
      call: vi.fn(async (_connectionId, input) => {
        if (input.params.threadId === 'a') await pendingRead.promise
        return { thread: thread(input.params.threadId) }
      }),
      detachPeer: vi.fn(async () => undefined),
    }
    const bridge = new CodexPeerBridge(domain,
      { connectionId: 'browse-peer', peerDeviceId: 'phone' }, async () => undefined)
    class HostTransport extends BaseTransport {
      async connect() {}
      async close() {}
      getStats() { return { mode: 'Relay', connected: true } }
      async send(data) {
        const request = JSON.parse(new TextDecoder().decode(data))
        const result = request.payload.method === 'codex.app.stream.open'
          ? await bridge.openStream(request.payload.params) : bridge.closeStream(request.payload.params)
        this.emit(encodeMessage(createRpcResponse(request.id, result)))
      }
    }
    const core = new RemoteClientCore(new HostTransport())
    await core.connect()
    const remote = new CodexRemoteClient(core)
    client.subscribe.mockImplementation(remote.subscribe.bind(remote))
    try {
      const old = state.openSession(session('a'))
      await tick()
      expect(domain.call).toHaveBeenCalledWith('browse-peer', {
        method: 'thread/read', params: { threadId: 'a', includeTurns: false },
      })
      const readSignal = client.request.mock.calls.find(c => c[0] === 'dsh/sessionHistory')[2]
      expect(await state.openSession(session('b'))).toBe(true)
      expect(readSignal.aborted).toBe(true)
      pendingRead.resolve()
      expect(await old).toBe(false)
      await tick()
      expect(bridge.hasThreadSubscription('a')).toBe(false)
      expect(bridge.hasThreadSubscription('b')).toBe(true)
      expect(state.codexReadySessionId).toBe('codex:b')
      await runtime.closeActiveCodexStream()
      expect(bridge.hasThreadSubscription('b')).toBe(false)
    } finally {
      pendingRead.resolve()
      await core.close()
      await bridge.closeAll()
    }
  })
})
