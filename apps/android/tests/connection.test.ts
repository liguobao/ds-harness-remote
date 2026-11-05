import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdaptiveTransportOptions } from '@dsh-remote/webrtc'

class FakeCore {
  private readonly closeHandlers = new Set<() => void>()
  private readonly eventHandlers = new Set<(event: unknown) => void>()
  readonly rpcCalls: Array<{ method: string; params?: unknown }> = []

  async connect(): Promise<void> { await testState.connectGate?.() }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.rpcCalls.push({ method, params })
    if (method === 'harness.transport.describe') return { capabilities: testState.capabilities,
      ...(testState.workspaceTypes === undefined ? {} : { workspaceTypes: testState.workspaceTypes }) }
    if (method === 'harness.remote.stream.open') return {}
    if (method === 'harness.remote.stream.close') return {}
    if (method === 'harness.remote.call') {
      const request = params as { endpoint?: string }
      if (request.endpoint === 'commands/execute') {
        return { ok: true, value: { commandId: 'permission', result: { kind: 'success' } } }
      }
      return { ok: true, value: undefined }
    }
    return {}
  }

  onEvent(handler: (event: unknown) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  emit(event: unknown): void {
    for (const handler of this.eventHandlers) handler(event)
  }

  getStats() { return { mode: 'Relay', connected: true } }

  async close(): Promise<void> {
    for (const handler of this.closeHandlers) handler()
  }
}

const testState = vi.hoisted(() => ({
  capabilities: ['harness.remote.v1'] as string[],
  workspaceTypes: undefined as unknown,
  cores: [] as FakeCore[],
  connectGate: undefined as undefined | (() => Promise<void>),
  transportOptions: [] as AdaptiveTransportOptions[],
}))

vi.mock('@dsh-remote/client-core', async () => {
  const actual = await vi.importActual<typeof import('@dsh-remote/client-core')>('@dsh-remote/client-core')
  return {
    ...actual,
    RemoteClientCore: class {
      constructor() {
        const core = new FakeCore()
        testState.cores.push(core)
        return core
      }
    },
  }
})

vi.mock('@dsh-remote/webrtc', () => ({ AdaptiveTransport: class {
  constructor(_url: string, options: AdaptiveTransportOptions) { testState.transportOptions.push(options) }
} }))
vi.mock('../src/services/secure-transport', () => ({ SecureTransport: class {} }))

import { AndroidRemoteConnection } from '../src/services/connection'
import type { DeviceIdentity, RemoteDevice } from '../src/types'

const identity: DeviceIdentity = {
  deviceId: 'client-1',
  name: 'Android',
  platform: 'android',
  publicKey: 'client-public',
  privateKey: 'client-private',
}

const host: RemoteDevice = {
  deviceId: 'host-1',
  name: 'Host',
  platform: 'darwin',
  identityKey: 'host-public',
  membershipId: 'membership-1',
  online: true,
  trusted: true,
}

describe('AndroidRemoteConnection Harness transport selection', () => {
  const prepareScenario1 = () => {
    testState.capabilities = ['harness.remote.v1']
    testState.workspaceTypes = undefined
    testState.cores.length = 0
    testState.connectGate = undefined
    testState.transportOptions.length = 0
  }
beforeEach(prepareScenario1)
afterEach(async () => {
  await Promise.all(testState.cores.map(core => core.close()))
  vi.useRealTimers()
})

  it('uses the native Typert attachment contract and rejects late images from retired connections', async () => {
    await runScenarios(['direct', 'business-result', 'denied', 'disconnected', 'cancelled'].map(mode => ({ name: mode, run: async () => {
      prepareScenario1()
      testState.capabilities = ['harness.remote.v1', 'harness.remote.transfer.v1']
      const connection = new AndroidRemoteConnection()
      await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined)
      const core = testState.cores[0]!
      const controller = new AbortController()
      const value = { attachment: { attachmentId: 'a1', mediaType: 'image/png' }, data: 'synthetic' }
      const rpc = core.rpc.bind(core)
      vi.spyOn(core, 'rpc').mockImplementation(async (method, params) => {
        if (method !== 'harness.remote.call') return rpc(method, params)
        expect(params).toEqual({ endpoint: 'session/attachment', payload: { args: { request: { sessionId: 's1', attachmentId: 'a1' } } } })
        if (mode === 'disconnected') await connection.close()
        if (mode === 'cancelled') controller.abort()
        return { ok: true, value: mode === 'business-result' ? { ok: true, value }
          : mode === 'denied' ? { ok: false, error: { code: 'not-found' } } : value }
      })
      try {
        const result = connection.readSessionImageAttachment('s1', 'a1', controller.signal)
        if (mode === 'direct' || mode === 'business-result') await expect(result).resolves.toEqual(value)
        else await expect(result).rejects.toThrow()
      } finally { await connection.close() }
    } })))
  })

  it('binds Bot requests to the advertised encrypted Host and rejects retired clients', async () => {
    await runScenarios(['unsupported', 'current', 'replaced', 'revoked'].map(outcome => ({ name: outcome, run: async () => {
      prepareScenario1()
      if (outcome !== 'unsupported') testState.capabilities.push('plugin.route.v1')
      const connection = new AndroidRemoteConnection()
      await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined)
      const core = testState.cores[0]!
      if (outcome === 'unsupported') {
        expect(() => connection.requireBotClient()).toThrow()
        expect(core.rpcCalls.some(call => call.method === 'plugin.route.call')).toBe(false)
      } else {
        const client = connection.requireBotClient()
        if (outcome === 'current') {
          vi.spyOn(core, 'rpc').mockResolvedValueOnce({ status: 200, json: { ok: true, value: { bots: [], rooms: [] } } })
          await expect(client.state()).resolves.toMatchObject({ bots: [], rooms: [] })
          expect(core.rpc).toHaveBeenCalledWith('plugin.route.call', { route: 'api/bot', body: { endpoint: 'state', payload: null } }, undefined)
        } else {
          if (outcome === 'replaced') await connection.connect('https://server.example.com', identity, { ...host, deviceId: 'host-2' }, 'synthetic', () => undefined)
          else { testState.capabilities = ['harness.remote.v1']; await connection.refreshBackends() }
          const spy = vi.spyOn(core, 'rpc')
          await expect(client.call('send', { sessionId: 'bot', text: 'hello' })).rejects.toThrow()
          expect(spy).not.toHaveBeenCalled()
        }
      }
      await connection.close()
    } })))
  })

  it('periodically verifies the encrypted Host path and retires silent carriers without touching replacements', async () => {
    await runScenarios(['healthy', 'silent', 'shared-probe', 'replaced', 'disconnected'].map(outcome => ({ name: outcome, run: async () => {
      vi.useFakeTimers()
      const connection = new AndroidRemoteConnection()
      const closed = vi.fn()
      await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined, { onClose: closed })
      const core = testState.cores[0]!
      const rpc = vi.spyOn(core, 'rpc')
      let finish!: (value: unknown) => void
      if (outcome === 'silent') rpc.mockImplementation(() => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('RPC_TIMEOUT')), 5_000)
      }))
      if (outcome === 'shared-probe' || outcome === 'replaced') {
        rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      }
      if (outcome === 'disconnected') await connection.close()
      await vi.advanceTimersByTimeAsync(25_000)
      if (outcome === 'silent') {
        // A single slow probe must not retire the carrier; one fast
        // confirmation probe follows before the connection is closed.
        expect(closed).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(5_000)
        expect(closed).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(10_000)
        expect(closed).toHaveBeenCalledOnce()
        expect(() => connection.requireProxy()).toThrow()
      } else if (outcome === 'shared-probe') {
        const resumed = connection.checkHealth()
        expect(rpc).toHaveBeenCalledTimes(1)
        finish({})
        expect(await resumed).toBe(true)
      } else if (outcome === 'replaced') {
        await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined)
        finish({})
        await vi.advanceTimersByTimeAsync(0)
        expect(closed).not.toHaveBeenCalled()
        expect(connection.requireProxy()).toBeDefined()
      } else if (outcome === 'healthy') {
        expect(rpc).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(25_000)
        expect(rpc).toHaveBeenCalledTimes(2)
        expect(closed).not.toHaveBeenCalled()
      } else expect(rpc.mock.calls.some(([method]) => method === 'harness.transport.describe')).toBe(false)
      await connection.close()
      const calls = rpc.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(rpc).toHaveBeenCalledTimes(calls)
      vi.useRealTimers()
    } })), async () => {
      await Promise.all(testState.cores.map(core => core.close()))
      vi.clearAllTimers()
      prepareScenario1()
    })
  })

  it('preserves transient versus refused carrier failures through the close callback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await runScenarios([
        { reason: 'webrtc-closed' as const, retryable: true },
        { reason: 'control-error' as const, retryable: true },
        { reason: 'control-closed' as const, closeCode: 1006, retryable: true },
        { reason: 'control-closed' as const, closeCode: 4003, retryable: false },
        { reason: 'control-closed' as const, closeCode: 1008, retryable: false },
        { reason: 'invalid-control-frame' as const, retryable: false },
      ].map(({ retryable, ...event }) => ({ name: `${event.reason}:${event.closeCode ?? ''}`, run: async () => {
        const connection = new AndroidRemoteConnection()
        const closed = vi.fn()
        await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined, { onClose: closed })
        testState.transportOptions[0]!.onDisconnect?.(event)
        await testState.cores[0]!.close()
        expect(closed).toHaveBeenCalledOnce()
        expect(closed).toHaveBeenCalledWith({ retryable })
        expect(() => connection.requireProxy()).toThrow()
        await connection.close()
      } })), prepareScenario1)
    } finally { warn.mockRestore() }
  })

  it('checks an encrypted round trip after resume and rejects stale or failed health replies', async () => {
    await runScenarios([
      {
        name: 'healthy carrier uses the existing bounded capability RPC',
        run: async () => {
          const connection = new AndroidRemoteConnection()
          expect(await connection.checkHealth()).toBe(false)
          await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined, { forceRelay: true })
          const rpc = vi.spyOn(testState.cores[0]!, 'rpc')
          expect(await connection.checkHealth()).toBe(true)
          expect(rpc).toHaveBeenLastCalledWith('harness.transport.describe', {}, undefined, { timeoutMs: 5_000 })
          await connection.close()
        },
      },
      {
        name: 'a failed round trip cannot claim that a locally open socket is healthy',
        run: async () => {
          const connection = new AndroidRemoteConnection()
          await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined, { forceRelay: true })
          vi.spyOn(testState.cores[0]!, 'rpc').mockRejectedValueOnce(new Error('RPC_TIMEOUT'))
          expect(await connection.checkHealth()).toBe(false)
          await connection.close()
        },
      },
      {
        name: 'rejects health replies from a Host that no longer provides capability discovery',
        run: async () => {
          const connection = new AndroidRemoteConnection()
          await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined, { forceRelay: true })
          vi.spyOn(testState.cores[0]!, 'rpc').mockRejectedValueOnce(Object.assign(new Error('unsupported'), { code: 'METHOD_NOT_FOUND' }))
          expect(await connection.checkHealth()).toBe(false)
          await connection.close()
        },
      },
      {
        name: 'a late successful reply cannot validate a replacement carrier',
        run: async () => {
          const connection = new AndroidRemoteConnection()
          await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined, { forceRelay: true })
          let finish!: (value: unknown) => void
          vi.spyOn(testState.cores[0]!, 'rpc').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
          const checking = connection.checkHealth()
          await connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined, { forceRelay: true })
          finish({})
          expect(await checking).toBe(false)
          await connection.close()
        },
      },
    ], prepareScenario1)
  })

  it('does not let a late connection attempt overwrite or close its replacement', async () => {
    const connection = new AndroidRemoteConnection()
    let release!: () => void
    testState.connectGate = () => new Promise<void>(resolve => { release = resolve })
    const first = connection.connect('https://server.example.com', identity, host, 'access-token', () => undefined, { forceRelay: true })
      .then(() => undefined, error => error)
    await vi.waitFor(() => expect(testState.cores).toHaveLength(1))
    testState.connectGate = undefined
    await connection.connect('https://server.example.com', identity, host, 'access-token', () => undefined, { forceRelay: true })
    const latest = connection.requireProxy()
    release()
    expect(await first).toBeInstanceOf(Error)
    expect(connection.requireProxy()).toBe(latest)
    await connection.close()
  })

  it('marks a failed native event stream offline instead of keeping a silent connected channel', async () => {
    testState.capabilities = ['harness.remote.v1', 'harness.remote.transfer.v1']
    const connection = new AndroidRemoteConnection()
    const closed = vi.fn()
    await connection.connect('https://server.example.com', identity, host, 'access-token', () => undefined, { forceRelay: true, onClose: closed })
    const core = testState.cores[0]!
    const opening = core.rpcCalls.find(call => call.method === 'harness.remote.stream.open'
      && (call.params as { endpoint?: string }).endpoint === '$events')!
    core.emit({ event: 'harness.remote.stream.closed', data: {
      streamId: (opening.params as { streamId: string }).streamId, reason: 'failed',
      failure: { code: 'TRANSPORT_CLOSED', message: 'synthetic', details: {} },
    } })
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
    expect(() => connection.requireProxy()).toThrow()
    await connection.close()
  })

  it('requires independent backend capability and readiness and refreshes Host switches live', async () => {
    const rows = ['cursor', 'antigravity', 'pi'] as const
    await runScenarios(
      rows.map((row, index) => {
        const backend = row
        return {
          name: scenarioName(
            'requires %s capability and readiness and refreshes Host switches live',
            row,
            index,
          ),
          run: async () => {
            const capability = `agent.acp.${backend}.v1`
            const type = { id: backend, name: backend, capability, available: false }
            testState.capabilities = ['harness.remote.v1', capability]
            testState.workspaceTypes = [type]
            const connection = new AndroidRemoteConnection()
            const available = () =>
              backend === 'pi' ? connection.hasPi() : backend === 'cursor' ? connection.hasCursor() : connection.hasAntigravity()
            await connection.connect(
              'https://server.example.com',
              identity,
              host,
              'access-token',
              () => undefined,
              { forceRelay: true },
            )
            expect(available()).toBe(false)
            testState.workspaceTypes = [{ ...type, available: true }]
            await connection.refreshBackends()
            expect(available()).toBe(true)
            testState.capabilities = ['harness.remote.v1', 'agent.acp.v1']
            await connection.refreshBackends()
            expect(available()).toBe(false)
            testState.capabilities = ['harness.remote.v1', capability]
            await connection.refreshBackends()
            expect(available()).toBe(true)
            testState.workspaceTypes = [{ ...type, available: false }]
            await connection.refreshBackends()
            expect(available()).toBe(false)
            await connection.close()
          },
        }
      }),
      async () => {
        await prepareScenario1()
      },
    )
  })

  it('preserves CodeX capability discovery for Hosts without workspaceTypes', async () => {
    testState.capabilities = ['harness.remote.v1', 'codex.appserver.v1', 'codex.appserver.transfer.v1']
    const connection = new AndroidRemoteConnection()
    await connection.connect('https://server.example.com', identity, host, 'access-token', () => undefined, { forceRelay: true })
    expect(connection.hasCodex()).toBe(true)
    testState.workspaceTypes = [{ id: 'codex', name: 'CodeX', capability: 'codex.appserver.v1', available: false }]
    await connection.refreshBackends()
    expect(connection.hasCodex()).toBe(false)
    await connection.close()
  })

  it('rejects ApiProxy-only and undiscoverable Hosts without sending legacy traffic', async () => {
    await runScenarios(['api-only', 'no-discovery'].map(mode => ({ name: mode, run: async () => {
      prepareScenario1()
      testState.capabilities = ['harness.api.v1', 'harness.api.transfer.v1']
      const spy = mode === 'no-discovery' ? vi.spyOn(FakeCore.prototype, 'rpc').mockRejectedValueOnce(
        Object.assign(new Error('unknown method'), { code: 'METHOD_NOT_FOUND' }),
      ) : undefined
      const connection = new AndroidRemoteConnection()
      try {
        await expect(connection.connect('https://server.example.com', identity, host, 'synthetic', () => undefined)).rejects.toThrow()
        expect(() => connection.requireProxy()).toThrow()
        expect(testState.cores[0]?.rpcCalls.some(call => call.method.startsWith('harness.api.'))).toBe(false)
      } finally { spy?.mockRestore(); await connection.close() }
    } })))
  })

  it('uses v0.1.2 Typert Remote without opening the ApiProxy mux', async () => {
    testState.capabilities = ['harness.remote.v1', 'harness.remote.transfer.v1']
    const connection = new AndroidRemoteConnection()
    await connection.connect('https://server.example.com', identity, host, 'access-token', () => undefined, { forceRelay: true })
    const proxy = connection.requireProxy()

    await proxy.sessionSelectPermission('session-1', 'default')

    const methods = testState.cores[0]?.rpcCalls.map(call => call.method) ?? []
    expect(methods).not.toContain('harness.api.stream.open')
    expect(testState.cores[0]?.rpcCalls).toContainEqual({
      method: 'harness.remote.call',
      params: {
        endpoint: 'commands/execute',
        payload: { args: { agentId: 'session-1', line: '/permission default', images: [] } },
      },
    })

    await connection.close()
  })
})
