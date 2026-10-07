import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeCore {
  private readonly closeHandlers = new Set<() => void>()
  private readonly eventHandlers = new Set<(event: unknown) => void>()
  readonly rpcCalls: Array<{ method: string; params?: unknown }> = []

  async connect(): Promise<void> { await testState.connectGate?.() }

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.rpcCalls.push({ method, params })
    if (method === 'harness.transport.describe') return { capabilities: testState.capabilities,
      ...(testState.workspaceTypes === undefined ? {} : { workspaceTypes: testState.workspaceTypes }) }
    if (method === 'harness.api.stream.open') return {}
    if (method === 'harness.api.stream.close') return {}
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
  capabilities: ['harness.api.v1'] as string[],
  workspaceTypes: undefined as unknown,
  cores: [] as FakeCore[],
  connectGate: undefined as undefined | (() => Promise<void>),
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
  beforeEach(() => {
    testState.capabilities = ['harness.api.v1']
    testState.workspaceTypes = undefined
    testState.cores.length = 0
    testState.connectGate = undefined
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

  it.each(['cursor', 'antigravity'] as const)('requires %s capability and readiness and refreshes Host switches live', async backend => {
    const capability = `agent.acp.${backend}.v1`
    const type = { id: backend, name: backend, capability, available: false }
    testState.capabilities = ['harness.api.v1', capability]
    testState.workspaceTypes = [type]
    const connection = new AndroidRemoteConnection()
    const available = () => backend === 'cursor' ? connection.hasCursor() : connection.hasAntigravity()
    await connection.connect('https://server.example.com', identity, host, 'access-token', () => undefined, { forceRelay: true })
    expect(available()).toBe(false)
    testState.workspaceTypes = [{ ...type, available: true }]
    await connection.refreshBackends()
    expect(available()).toBe(true)
    testState.capabilities = ['harness.api.v1', 'agent.acp.v1']
    await connection.refreshBackends()
    expect(available()).toBe(false)
    testState.capabilities = ['harness.api.v1', capability]
    await connection.refreshBackends()
    expect(available()).toBe(true)
    testState.workspaceTypes = [{ ...type, available: false }]
    await connection.refreshBackends()
    expect(available()).toBe(false)
    await connection.close()
  })

  it('preserves CodeX capability discovery for Hosts without workspaceTypes', async () => {
    testState.capabilities = ['harness.api.v1', 'codex.appserver.v1', 'codex.appserver.transfer.v1']
    const connection = new AndroidRemoteConnection()
    await connection.connect('https://server.example.com', identity, host, 'access-token', () => undefined, { forceRelay: true })
    expect(connection.hasCodex()).toBe(true)
    testState.workspaceTypes = [{ id: 'codex', name: 'CodeX', capability: 'codex.appserver.v1', available: false }]
    await connection.refreshBackends()
    expect(connection.hasCodex()).toBe(false)
    await connection.close()
  })

  it('opens the legacy ApiProxy mux for older Hosts', async () => {
    const connection = new AndroidRemoteConnection()
    await connection.connect('https://server.example.com', identity, host, 'access-token', () => undefined, { forceRelay: true })

    expect(testState.cores[0]?.rpcCalls.map(call => call.method)).toContain('harness.api.stream.open')

    await connection.close()
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
