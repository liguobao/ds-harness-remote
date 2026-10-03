import { createRpcRequest, type RemoteWorkspaceTypeDescription } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { HarnessApiBridge } from '../src/harness-api-bridge.js'
import type { RemoteFileViewerBridge } from '../src/file-viewer-bridge.js'
import type { SafeLogger } from '../src/logging.js'
import { RpcRouter } from '../src/rpc-router.js'
import type { CodexPeerBridge } from '../src/codex/peer-bridge.js'

describe('RpcRouter', () => {
  it('forwards only native ApiProxy traffic', async () => {
    const call = vi.fn(async () => ({ rpcId: 'native-1', result: { ok: true, value: [] } }))
    const router = createRouter({ call })
    const response = await router.handle(createRpcRequest('harness.api.call', {
      method: 'session.list', rpcId: 'native-1', payload: {},
    }))
    expect(call).toHaveBeenCalledWith({ method: 'session.list', rpcId: 'native-1', payload: {} })
    expect(response).toMatchObject({ type: 'rpc.response', payload: { result: { rpcId: 'native-1' } } })

    const legacy = await router.handle({
      v: 1, id: 'legacy-1', type: 'rpc.request', timestamp: Date.now(), payload: { method: 'sessions.list', params: {} },
    })
    expect(legacy).toMatchObject({ type: 'rpc.error', payload: { code: 'METHOD_NOT_FOUND' } })
    const unknown = await router.handle({
      v: 1, id: 'unknown-1', type: 'rpc.request', timestamp: Date.now(), payload: { method: 'shell.exec', params: {} },
    })
    expect(unknown).toMatchObject({ type: 'rpc.error', payload: { code: 'METHOD_NOT_FOUND' } })
  })

  it('describes only the Host transports available on this encrypted connection', async () => {
    const capabilities = () => ['transport.relay', 'harness.remote.v1']
    const router = createRouter({}, undefined, undefined, capabilities)

    const response = await router.handle(createRpcRequest('harness.transport.describe', {}))

    expect(response).toMatchObject({
      type: 'rpc.response',
      payload: { result: { capabilities: ['transport.relay', 'harness.remote.v1'] } },
    })
    const invalid = await router.handle(createRpcRequest('harness.transport.describe', { extra: true }))
    expect(invalid).toMatchObject({ type: 'rpc.error', payload: { code: 'INVALID_MESSAGE' } })
  })

  it('closes native streams with the peer connection', async () => {
    const closeAll = vi.fn(async () => undefined)
    const router = createRouter({ closeAll })
    await router.closePeerStreams()
    expect(closeAll).toHaveBeenCalledOnce()
  })

  it('routes only the explicit bounded Harness API transfer operations', async () => {
    const openTransfer = vi.fn(() => ({ opened: true, transferId: 'image-1' }))
    const appendTransfer = vi.fn(() => ({ accepted: true, transferId: 'image-1', index: 0 }))
    const router = createRouter({ openTransfer, appendTransfer })
    const opened = await router.handle(createRpcRequest('harness.api.transfer.open', {
      transferId: 'image-1', totalBytes: 3, totalChunks: 1,
    }))
    const chunked = await router.handle(createRpcRequest('harness.api.transfer.chunk', {
      transferId: 'image-1', index: 0, data: 'YWJj',
    }))
    expect(openTransfer).toHaveBeenCalledOnce()
    expect(appendTransfer).toHaveBeenCalledOnce()
    expect(opened).toMatchObject({ type: 'rpc.response', payload: { result: { opened: true } } })
    expect(chunked).toMatchObject({ type: 'rpc.response', payload: { result: { accepted: true } } })
  })

  it('routes only the explicit File Viewer call through its bridge', async () => {
    const fileViewer = { call: vi.fn(async () => ({ exists: true })) } as unknown as RemoteFileViewerBridge
    const router = createRouter({}, fileViewer)
    const response = await router.handle({
      v: 1,
      id: 'fileviewer-request',
      type: 'rpc.request',
      timestamp: Date.now(),
      payload: { method: 'fileviewer.call', params: { endpoint: 'stat', payload: { path: '/workspace/report.md' } } },
    })
    expect(fileViewer.call).toHaveBeenCalledWith({ endpoint: 'stat', payload: { path: '/workspace/report.md' } })
    expect(response).toMatchObject({ type: 'rpc.response', payload: { result: { exists: true } } })
  })

  it('does not log errors returned by Host bridges', async () => {
    const secret = 'prompt=/home/user/private.ts token=sk-secret'
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as SafeLogger
    const router = createRouter({ call: vi.fn(async () => { throw new Error(secret) }) }, undefined, logger)

    const response = await router.handle(createRpcRequest('harness.api.call', {
      method: 'session.list', rpcId: 'native-secret', payload: {},
    }))

    expect(response).toMatchObject({ type: 'rpc.error', payload: { code: 'INTERNAL_ERROR' } })
    expect(logger.warn).toHaveBeenCalledWith('host rpc failed', expect.objectContaining({
      method: 'harness.api.call',
      code: 'INTERNAL_ERROR',
    }))
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(secret)
  })

  it('routes Codex only through the optional independent domain bridge', async () => {
    const call = vi.fn(async () => ({ data: [] }))
    const closeAll = vi.fn(async () => undefined)
    const codex = { call, closeAll } as unknown as CodexPeerBridge
    const router = createRouter({}, undefined, undefined, () => ['codex.appserver.v1'], codex)

    const response = await router.handle(createRpcRequest('codex.app.call', {
      method: 'thread/list', params: {},
    }))
    expect(call).toHaveBeenCalledWith({ method: 'thread/list', params: {} })
    expect(response).toMatchObject({ type: 'rpc.response', payload: { result: { data: [] } } })
    await router.closePeerStreams()
    expect(closeAll).toHaveBeenCalledOnce()

    const disabled = createRouter()
    const unavailable = await disabled.handle(createRpcRequest('codex.app.call', {
      method: 'thread/list', params: {},
    }))
    expect(unavailable).toMatchObject({ type: 'rpc.error', payload: { code: 'FEATURE_NOT_SUPPORTED' } })
  })

  it('describes workspace types when supported and avoids leaking project paths or session contents', async () => {
    const capabilities = () => ['transport.relay', 'codex.appserver.v1', 'codex.appserver.transfer.v1']
    const workspaceTypes = () => [{
      id: 'codex',
      name: 'CodeX',
      capability: 'codex.appserver.v1',
      available: true,
    }]
    const router = createRouter({}, undefined, undefined, capabilities, undefined, workspaceTypes)

    const response = await router.handle(createRpcRequest('harness.transport.describe', {}))
    expect(response).toMatchObject({
      type: 'rpc.response',
      payload: {
        result: {
          capabilities: ['transport.relay', 'codex.appserver.v1', 'codex.appserver.transfer.v1'],
          workspaceTypes: [{
            id: 'codex',
            name: 'CodeX',
            capability: 'codex.appserver.v1',
            available: true,
          }],
        },
      },
    })

    const result = (response.payload as { result: Record<string, unknown> }).result
    // Guarantee no leaking of project path, prompt, file content, or tool output
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/(\/|\\)Users|(\/|\\)home|prompt|output|projectPath|cwd/i)
    expect(Object.keys(result)).toEqual(['capabilities', 'workspaceTypes'])
    const types = result.workspaceTypes as Array<Record<string, unknown>>
    expect(types).toHaveLength(1)
    expect(Object.keys(types[0])).toEqual(['id', 'name', 'capability', 'available'])
  })

  it('omits or returns empty workspace types when CodeX is unavailable or negotiation fails', async () => {
    const router = createRouter({}, undefined, undefined, () => ['transport.relay', 'harness.api.v1'], undefined, () => [])
    const response = await router.handle(createRpcRequest('harness.transport.describe', {}))
    expect(response).toMatchObject({
      type: 'rpc.response',
      payload: {
        result: {
          capabilities: ['transport.relay', 'harness.api.v1'],
          workspaceTypes: [],
        },
      },
    })
  })

  it('preserves legacy capability declaration when workspaceTypes provider is omitted', async () => {
    const router = createRouter({}, undefined, undefined, () => ['transport.relay', 'codex.appserver.v1'])
    const response = await router.handle(createRpcRequest('harness.transport.describe', {}))
    expect(response).toMatchObject({
      type: 'rpc.response',
      payload: {
        result: {
          capabilities: ['transport.relay', 'codex.appserver.v1'],
        },
      },
    })
    expect((response.payload as { result: Record<string, unknown> }).result.workspaceTypes).toBeUndefined()
  })

  it('safely handles malformed workspaceTypes without crashing the Host', async () => {
    const malformed = () => [
      { id: 'codex', name: 'CodeX', capability: 'codex.appserver.v1', available: true },
      { id: 123, name: 'Invalid' },
      null,
      'malformed string entry',
    ] as unknown as RemoteWorkspaceTypeDescription[]
    const router = createRouter({}, undefined, undefined, () => ['codex.appserver.v1'], undefined, malformed)
    const response = await router.handle(createRpcRequest('harness.transport.describe', {}))
    expect(response).toMatchObject({
      type: 'rpc.response',
      payload: {
        result: {
          capabilities: ['codex.appserver.v1'],
          workspaceTypes: [{
            id: 'codex',
            name: 'CodeX',
            capability: 'codex.appserver.v1',
            available: true,
          }],
        },
      },
    })

    const throwing = () => { throw new Error('Querying workspace types failed') }
    const throwingRouter = createRouter({}, undefined, undefined, () => ['codex.appserver.v1'], undefined, throwing)
    const throwingResponse = await throwingRouter.handle(createRpcRequest('harness.transport.describe', {}))
    expect(throwingResponse).toMatchObject({
      type: 'rpc.response',
      payload: {
        result: {
          capabilities: ['codex.appserver.v1'],
          workspaceTypes: [],
        },
      },
    })
  })
})

function createRouter(
  overrides: Record<string, unknown> = {},
  fileViewer?: RemoteFileViewerBridge,
  logger?: SafeLogger,
  capabilities?: () => readonly string[],
  codex?: CodexPeerBridge,
  workspaceTypes?: () => readonly RemoteWorkspaceTypeDescription[],
): RpcRouter {
  return new RpcRouter({
    call: vi.fn(),
    respond: vi.fn(),
    openStream: vi.fn(),
    closeStream: vi.fn(),
    openTransfer: vi.fn(),
    appendTransfer: vi.fn(),
    commitTransfer: vi.fn(),
    readTransfer: vi.fn(),
    closeTransfer: vi.fn(),
    closeAll: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as HarnessApiBridge, undefined, logger, fileViewer, undefined, capabilities, codex, undefined, undefined, workspaceTypes)
}
