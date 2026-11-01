import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteClientCore } from '@dsh-remote/client-core'
import { BaseTransport } from '@dsh-remote/webrtc'
import { createRpcResponse, decodeMessage, encodeMessage } from '@dsh-remote/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { ClientModeRuntime, remoteHostFeatures } from '../src/client-runtime.js'
import type { ConnectedRemote } from '../src/client-runtime-contract.js'
import { resolveConfig } from '../src/config.js'
import { IdentityStore } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import type { ClientServerApi } from '../src/server-api.js'
import type { TypertGatewayLike } from '../src/typert-gateway-contract.js'
import { subscribeRemoteRecovery } from '../src/client-recovery.js'
import type { RemoteStatus } from '../src/client/types.js'

class Carrier extends BaseTransport {
  connected = true
  reply = true
  sendGate?: Promise<void>
  sent: ReturnType<typeof decodeMessage>[] = []
  async connect() {}
  async close() { this.connected = false }
  async send(bytes: Uint8Array) {
    const request = decodeMessage(bytes)
    this.sent.push(request)
    await this.sendGate
    if (this.reply) this.emit(encodeMessage(createRpcResponse(request.id, { ok: true, value: 'existing-host-session' })))
  }
  getStats() { return { connected: this.connected, mode: this.connected ? 'Relay' as const : 'Disconnected' as const } }
  drop(error?: Error) { this.connected = false; this.emitClose(error) }
}

let directory: string | undefined
let runtime: ClientModeRuntime | undefined
const cleanup = async () => {
  await runtime?.close()
  runtime = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
}
afterEach(cleanup)

async function fixture(enabled = true) {
  directory = await mkdtemp(join(tmpdir(), 'remote-reconnect-'))
  const localInvoke = vi.fn(async () => 'local')
  const gateway: TypertGatewayLike & { dispatchRpc: (_endpoint: string, _payload: unknown, _signal: AbortSignal) => Promise<{ ok: true }> } = {
    invoke: localInvoke,
    dispatchRpc: async () => ({ ok: true }),
    wireStream: { open: async () => (async function* () {})(), failure: error => {
      const failure = error as { code?: unknown; message?: unknown }
      return {
        code: typeof failure?.code === 'string' ? failure.code : 'internal',
        message: typeof failure?.message === 'string' ? failure.message : '',
        details: {},
      }
    } },
  }
  runtime = new ClientModeRuntime(
    resolveConfig({ reconnect: enabled ? { initialDelayMs: 100, maxDelayMs: 1000, jitter: 0 } : false }),
    new IdentityStore({ directory }),
    { bindIdentity: vi.fn(), revokeCurrentDevice: vi.fn(async () => undefined) } as unknown as ClientServerApi,
    gateway, { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as SafeLogger,
  )
  await runtime.start()
  const remotes: Array<{ remote: ConnectedRemote; carrier: Carrier }> = []
  const makeRemote = async (deviceId: string) => {
    const carrier = new Carrier()
    const client = new RemoteClientCore(carrier)
    await client.connect()
    const remote = {
      client, target: { deviceId, name: deviceId }, progressRunId: remotes.length + 1,
      features: { ...remoteHostFeatures(), remoteGateway: true },
    } as ConnectedRemote
    remotes.push({ remote, carrier })
    return remote
  }
  const connection = (runtime as unknown as { connection: { connect(id: string, signal?: AbortSignal): Promise<ConnectedRemote> } }).connection
  const connect = vi.spyOn(connection, 'connect').mockImplementation(makeRemote)
  await runtime.setMode('remote', 'host-1')
  vi.useFakeTimers()
  return { runtime, gateway, localInvoke, connect, remotes, makeRemote }
}

it('recovers the selected Host with bounded backoff and fresh reads without replaying in-flight mutations', async () => {
  const f = await fixture()
  const first = f.remotes[0]!.carrier
  first.reply = false
  const prompt = f.gateway.invoke({ namespace: 'session', method: 'prompt', args: { sessionId: 'existing-host-session' } })
  const approval = f.gateway.dispatchRpc('$events/result', { args: {
    clientId: 'event-client', eventId: 'approval-1', outcome: { kind: 'result', value: 'allowed-once' },
  } }, new AbortController().signal)
  const rejectedPrompt = expect(prompt).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
  const rejectedApproval = expect(approval).resolves.toMatchObject({ ok: false, error: { code: 'TRANSPORT_CLOSED' } })
  expect(first.sent[1]).toMatchObject({ payload: { method: 'harness.remote.call', params: { endpoint: '$events/result' } } })
  f.connect.mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { code: 'INTERNAL_ERROR', retryable: true }))
    .mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
  first.drop()
  await Promise.all([rejectedPrompt, rejectedApproval])
  expect(f.runtime.status()).toMatchObject({ mode: 'remote', connected: false, target: { deviceId: 'host-1' } })
  await expect(f.gateway.invoke({ namespace: 'session', method: 'list', args: {} })).rejects.toMatchObject({ code: 'remote/disconnected' })
  await expect(f.gateway.dispatchRpc('$events/result', { args: {
    clientId: 'event-client', eventId: 'approval-1', outcome: { kind: 'result', value: 'allowed-once' },
  } }, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: { code: 'remote/disconnected' } })
  expect(first.sent).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(99)
  expect(f.connect).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.connect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(199)
  expect(f.connect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.connect).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(400)
  await vi.advanceTimersByTimeAsync(800)
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.connect).toHaveBeenCalledTimes(6)
  await vi.advanceTimersByTimeAsync(999)
  expect(f.connect).toHaveBeenCalledTimes(6)
  await vi.advanceTimersByTimeAsync(1)
  expect(f.runtime.status()).toMatchObject({ connected: true, recoveryGeneration: 1, target: { deviceId: 'host-1' } })
  expect(f.remotes[1]!.carrier.sent).toEqual([])
  await expect(f.gateway.invoke({ namespace: 'session', method: 'list', args: {} })).resolves.toBe('existing-host-session')
  expect(f.localInvoke).not.toHaveBeenCalled()
  expect(first.sent).toHaveLength(2)
  f.remotes[1]!.carrier.drop()
  await vi.advanceTimersByTimeAsync(100)
  expect(f.runtime.status()).toMatchObject({ connected: true, recoveryGeneration: 2 })
})

it('does not replay an approval whose old carrier send settles after recovery', async () => {
  const f = await fixture()
  const first = f.remotes[0]!.carrier
  let finishSend!: () => void
  first.sendGate = new Promise<void>(resolve => { finishSend = resolve })
  const approval = f.gateway.dispatchRpc('$events/result', { args: {
    clientId: 'event-client', eventId: 'approval-2', outcome: { kind: 'result', value: 'allowed-once' },
  } }, new AbortController().signal)
  const rejected = expect(approval).resolves.toMatchObject({ ok: false, error: { code: 'TRANSPORT_CLOSED' } })
  expect(first.sent).toHaveLength(1)
  expect(first.sent[0]).toMatchObject({ payload: { method: 'harness.remote.call', params: { endpoint: '$events/result' } } })

  first.drop()
  await rejected
  await vi.advanceTimersByTimeAsync(100)
  expect(f.runtime.status()).toMatchObject({ connected: true, recoveryGeneration: 1 })
  expect(f.remotes[1]!.carrier.sent).toEqual([])

  finishSend()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.remotes[1]!.carrier.sent).toEqual([])
  expect(f.localInvoke).not.toHaveBeenCalled()
})

it('stops timers and retires late candidates on exit, sign-out, shutdown and Host replacement', async () => {
  await runScenarios((['exit', 'sign-out', 'shutdown', 'switch'] as const).flatMap(action =>
    (['waiting', 'connecting'] as const).map(phase => ({ name: `${action}: ${phase}`, run: async () => {
      const f = await fixture()
      let resolve: ((remote: ConnectedRemote) => void) | undefined
      let signal: AbortSignal | undefined
      f.connect.mockImplementationOnce((_id, requestSignal) => {
        signal = requestSignal
        return new Promise(yes => { resolve = yes })
      })
      f.remotes[0]!.carrier.drop()
      if (phase === 'connecting') await vi.advanceTimersByTimeAsync(100)
      else f.connect.mockReset().mockImplementation(f.makeRemote)
      if (action === 'exit') await f.runtime.setMode('local')
      else if (action === 'sign-out') await f.runtime.clearClientAuthorization()
      else if (action === 'shutdown') await f.runtime.close()
      else await f.runtime.setMode('remote', 'host-2')
      if (resolve !== undefined) {
        expect(signal?.aborted).toBe(true)
        const late = await f.makeRemote('host-1')
        resolve(late)
        await vi.advanceTimersByTimeAsync(0)
        expect(late.client.getStats().connected).toBe(false)
      }
      const count = f.connect.mock.calls.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.connect).toHaveBeenCalledTimes(count)
      expect(f.runtime.status()).toMatchObject(action === 'switch'
        ? { mode: 'remote', connected: true, target: { deviceId: 'host-2' } }
        : { mode: 'local', connected: false })
    } }))), cleanup)
})

it('does not reclaim replaced identities, revoked membership, rejected encryption or disabled reconnect', async () => {
  await runScenarios(['CONNECTION_REPLACED', 'PEER_IDENTITY_MISMATCH', 'MEMBERSHIP_REQUIRED', 'DEVICE_REVOKED', 'SECURE_CHANNEL_FAILED', 'CLIENT_CLOSED', 'disabled'].flatMap(code =>
    ['drop', 'retry'].map(phase => ({ name: `${code}: ${phase}`, run: async () => {
      const f = await fixture(code !== 'disabled')
      const failure = Object.assign(new Error('rejected'), { code, retryable: true })
      if (phase === 'retry') f.connect.mockRejectedValueOnce(failure)
      f.remotes[0]!.carrier.drop(phase === 'drop' ? failure : undefined)
      await vi.advanceTimersByTimeAsync(5000)
      expect(f.connect).toHaveBeenCalledTimes(phase === 'retry' && code !== 'disabled' ? 2 : 1)
      expect(f.runtime.status()).toMatchObject({ mode: 'remote', connected: false, recoveryGeneration: 0 })
      expect(f.localInvoke).not.toHaveBeenCalled()
    } }))), cleanup)
})

it('reopens native read subscriptions once per recovered generation, without replay or page reload', () => {
  let listener!: (status: RemoteStatus) => void
  const unsubscribe = vi.fn()
  const reconnect = vi.fn()
  const stop = subscribeRemoteRecovery({ subscribe: next => { listener = next; return unsubscribe }, getSnapshot: () => undefined, close() {} }, reconnect)
  const status = (id: string, connected: boolean, recoveryGeneration: number): RemoteStatus => ({ mode: 'remote', target: { deviceId: id, name: id }, connected, recoveryGeneration, available: true, hostAuthorizationAvailable: false })
  listener(status('host-1', true, 0))
  listener(status('host-1', false, 0))
  listener(status('host-1', true, 1))
  listener(status('host-1', true, 1))
  expect(reconnect).toHaveBeenCalledTimes(1)
  listener(status('host-1', true, 2)) // Even when the short outage was between status samples.
  expect(reconnect).toHaveBeenCalledTimes(2)
  listener(status('host-2', true, 3))
  listener({ ...status('host-2', false, 3), mode: 'local' })
  listener(status('host-2', true, 4))
  expect(reconnect).toHaveBeenCalledTimes(2)
  stop()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
