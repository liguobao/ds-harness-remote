import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeCore {
  private readonly closeHandlers = new Set<() => void>()
  private readonly eventHandlers = new Set<(event: unknown) => void>()
  readonly calls: string[] = []
  readonly rpcCalls: Array<{ method: string; params?: unknown }> = []
  closeCount = 0
  private closeNotified = false
  private rejectPendingRpc?: (error: Error) => void

  async connect(): Promise<void> {}
  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.calls.push(method)
    this.rpcCalls.push({ method, params })
    if (method === 'harness.transport.describe') return { capabilities: testState.capabilities }
    if (method === 'harness.api.stream.open' && testState.blockStreamOpen) {
      return new Promise((_, reject) => { this.rejectPendingRpc = reject })
    }
    if (method === 'harness.api.call') {
      const request = params as { method?: unknown; rpcId?: unknown }
      if (request.method === 'commands.execute') {
        return {
          rpcId: String(request.rpcId),
          result: { ok: true, value: { commandId: 'permission', result: { kind: 'success' } } },
        }
      }
    }
    if (method === 'harness.remote.stream.open') return {}
    if (method === 'harness.remote.stream.close') return {}
    if (method === 'harness.remote.call') {
      const request = params as { endpoint?: unknown }
      if (request.endpoint === 'commands/execute') {
        return { ok: true, value: { commandId: 'permission', result: { kind: 'success' } } }
      }
      return { ok: true, value: undefined }
    }
    return {}
  }
  onEvent(handler: (event: unknown) => void): () => void { this.eventHandlers.add(handler); return () => this.eventHandlers.delete(handler) }
  onClose(handler: () => void): () => void { this.closeHandlers.add(handler); return () => this.closeHandlers.delete(handler) }
  getStats() { return { mode: 'Relay', connected: true } }
  async close(): Promise<void> { this.closeCount += 1; this.notifyClose() }
  drop(): void {
    this.rejectPendingRpc?.(new Error('Connection closed.'))
    this.rejectPendingRpc = undefined
    this.notifyClose()
  }

  private notifyClose(): void {
    if (this.closeNotified) return
    this.closeNotified = true
    for (const handler of this.closeHandlers) handler()
  }
}

const testState = vi.hoisted(() => ({
  cores: [] as FakeCore[],
  blockStreamOpen: false,
  capabilities: ['harness.api.v1'] as string[],
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

vi.mock('@dsh-remote/webrtc', () => ({ AdaptiveTransport: class {} }))
vi.mock('../src/server-api.js', () => ({
  ServerApi: class { async turnCredentials(): Promise<never[]> { return [] } },
}))
vi.mock('../src/werift-rtc.js', () => ({ loadNodeRtcFactory: async () => undefined }))

import { RemoteConnection } from '../src/remote.js'

const identity = {
  deviceId: 'client-1',
  name: 'VS Code',
  platform: 'vscode' as const,
  publicKey: 'client-public',
  privateKey: 'client-private',
}

const host = {
  deviceId: 'host-1',
  name: 'Host',
  platform: 'linux',
  identityKey: 'host-public',
  membershipId: 'membership-1',
  online: true,
}

describe('RemoteConnection close state', () => {
  const prepareContract1 = () => {
    testState.cores.length = 0
    testState.blockStreamOpen = false
    testState.capabilities = ['harness.api.v1']
  }
beforeEach(prepareContract1)

  it('disposes closed connections during streaming and initialization', async () => {
    await runScenarios(
      [
        {
          name: 'cleans the core and notifies the UI after an unexpected close',
          run: async () => {
            const connection = new RemoteConnection()
            const closed = vi.fn()
            connection.onClose(closed)
            await connection.connect('https://server.example.com', identity, host, 'access-token', true)
            const core = testState.cores[0]!

            core.drop()
            await vi.waitFor(() => expect(core.closeCount).toBe(1))

            expect(connection.connectedHost).toBeUndefined()
            expect(core.calls).toContain('harness.api.stream.close')
            expect(closed).toHaveBeenCalledOnce()
          },
        },
        {
          name: 'does not report an explicit close as an unexpected close',
          run: async () => {
            const connection = new RemoteConnection()
            const closed = vi.fn()
            connection.onClose(closed)
            await connection.connect('https://server.example.com', identity, host, 'access-token', true)

            await connection.close()

            expect(connection.connectedHost).toBeUndefined()
            expect(closed).not.toHaveBeenCalled()
          },
        },
        {
          name: 'cleans connection state when the core closes during mux initialization',
          run: async () => {
            testState.blockStreamOpen = true
            const connection = new RemoteConnection()
            const closed = vi.fn()
            connection.onClose(closed)

            const connecting = connection.connect(
              'https://server.example.com',
              identity,
              host,
              'access-token',
              true,
            )
            await vi.waitFor(() => expect(testState.cores[0]?.calls).toContain('harness.api.stream.open'))
            const core = testState.cores[0]!
            core.drop()

            await expect(connecting).rejects.toThrow('Connection closed.')
            expect(connection.connectedHost).toBeUndefined()
            expect(core.closeCount).toBe(1)
            expect(closed).toHaveBeenCalledOnce()
          },
        },
        {
          name: 'clears the alpha client after an unexpected close',
          run: async () => {
            testState.capabilities = ['harness.remote.v1', 'harness.remote.transfer.v1']
            const connection = new RemoteConnection()
            await connection.connect('https://server.example.com', identity, host, 'access-token', true)
            const core = testState.cores[0]!

            core.drop()
            await vi.waitFor(() => expect(core.closeCount).toBe(1))

            await expect(connection.sessions()).rejects.toThrow('Connect to a host first.')
            expect(core.rpcCalls.filter((call) => call.method === 'harness.remote.call')).toHaveLength(0)
          },
        },
      ],
      async () => {
        await prepareContract1()
      },
    )
  }, 20000)

  it('sends authoritative permission commands through both Harness carriers', async () => {
    await runScenarios(
      [
        {
          name: 'sends the complete Host command payload when changing approval mode',
          run: async () => {
            const connection = new RemoteConnection()
            await connection.connect('https://server.example.com', identity, host, 'access-token', true)
            const core = testState.cores[0]!

            await connection.selectPermission('session-1', 'default')

            expect(core.rpcCalls).toContainEqual({
              method: 'harness.api.call',
              params: expect.objectContaining({
                method: 'commands.execute',
                payload: { agentId: 'session-1', line: '/permission default', images: [] },
              }),
            })
          },
        },
        {
          name: 'uses the v0.1.2 Typert Remote command payload when changing approval mode',
          run: async () => {
            testState.capabilities = ['harness.remote.v1', 'harness.remote.transfer.v1']
            const connection = new RemoteConnection()
            await connection.connect('https://server.example.com', identity, host, 'access-token', true)
            const core = testState.cores[0]!

            await connection.selectPermission('session-1', 'default')

            expect(core.calls).not.toContain('harness.api.stream.open')
            expect(core.rpcCalls).toContainEqual({
              method: 'harness.remote.call',
              params: {
                endpoint: 'commands/execute',
                payload: { args: { agentId: 'session-1', line: '/permission default', images: [] } },
              },
            })
          },
        },
      ],
      async () => {
        await prepareContract1()
      },
    )
  }, 10000)

})
