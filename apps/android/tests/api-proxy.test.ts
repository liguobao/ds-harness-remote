import { describe, expect, it, vi } from 'vitest'
import type { RemoteClientCore } from '@dsh-remote/client-core'
import { ApiProxyError, RemoteApiProxy } from '../src/services/api-proxy'

type CoreRpc = (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>
type CoreRpcMock = ReturnType<typeof vi.fn<CoreRpc>>

function fakeCore(): RemoteClientCore & { rpcCalls: CoreRpcMock; emitEvent(event: unknown): void } {
  const eventHandlers = new Set<(event: unknown) => void>()
  const transferChunks: Uint8Array[] = []
  const rpcCalls = vi.fn<CoreRpc>(async (method: string, params: unknown) => {
    if (method === 'harness.api.stream.open') {
      if (params !== null && typeof params === 'object' && 'streamId' in params) {
        queueMicrotask(() => {
          const streamId = String((params as { streamId: unknown }).streamId)
          const frame = {
            event: 'harness.api.frame',
            data: {
              streamId,
              frame: { rpcId: 'host-rpc-1', payload: { type: 'approval/requested', sessionId: 's1', approvalId: 'a1' } },
            },
          }
          for (const handler of eventHandlers) handler(frame)
        })
      }
      return { ok: true, value: { opened: true } }
    }
    if (method === 'harness.api.call') {
      const paramsRecord = params as { method: string; rpcId: string; payload: unknown }
      if (paramsRecord.method === 'session.list') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { items: [{ sessionId: 's1' }] } } }
      }
      if (paramsRecord.method === 'session.create') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { sessionId: 's-new' } } }
      }
      if (paramsRecord.method === 'session.history') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { events: [], hasMore: false } } }
      }
      if (paramsRecord.method === 'session.models') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, routable: true, groups: [], failures: [] } } }
      }
      if (paramsRecord.method === 'session.selectModel') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { selected: { provider: 'deepseek-official', model: 'deepseek-v3' } } } }
      }
      if (paramsRecord.method === 'commands.execute') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { commandId: 'permission', result: { kind: 'success' } } } }
      }
      if (paramsRecord.method === 'session.prompt') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { accepted: true } } }
      }
      if (paramsRecord.method === 'workspace.list') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { items: [{ workspaceId: 'w1' }], archivedSessionIds: ['s-old'] } } }
      }
      if (paramsRecord.method === 'workspace.create') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { workspace: { workspaceId: 'w2', path: '/p', title: 'P', sessionIds: [], createdAt: 't', updatedAt: 't' }, created: true } } }
      }
      if (paramsRecord.method === 'workspace.rename') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { workspace: { workspaceId: 'w1', path: '/p', title: 'Renamed', sessionIds: [], createdAt: 't', updatedAt: 't' } } } }
      }
      if (paramsRecord.method === 'workspace.delete') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { deleted: true } } }
      }
      if (paramsRecord.method === 'workspace.archiveSession') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { archivedSessionIds: ['s-old', 's2'] } } }
      }
      if (paramsRecord.method === 'workspace.insertBefore') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { workspaceIds: ['w2', 'w1'] } } }
      }
      if (paramsRecord.method === 'host.listDirectory') {
        return { rpcId: paramsRecord.rpcId, result: { ok: true, value: { path: '/', home: '/home/u', crumbs: [], entries: [{ name: 'src', path: '/src', hidden: false }], truncated: false } } }
      }
      return { rpcId: paramsRecord.rpcId, result: { ok: false, error: { code: 'method-not-found', message: 'nope' } } }
    }
    if (method === 'harness.api.respond') {
      return { accepted: true }
    }
    if (method === 'harness.api.transfer.open') {
      transferChunks.length = 0
      return { opened: true }
    }
    if (method === 'harness.api.transfer.chunk') {
      const data = String((params as { data: unknown }).data)
      transferChunks.push(Uint8Array.from(atob(data), character => character.charCodeAt(0)))
      return { accepted: true }
    }
    if (method === 'harness.api.transfer.commit') {
      const bytes = new Uint8Array(transferChunks.reduce((total, chunk) => total + chunk.byteLength, 0))
      let offset = 0
      for (const chunk of transferChunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      const request = JSON.parse(new TextDecoder().decode(bytes)) as { rpcId: string }
      return { kind: 'inline', response: { rpcId: request.rpcId, result: { ok: true, value: { accepted: true } } } }
    }
    if (method === 'harness.api.transfer.close') return { closed: true }
    return { ok: true, value: {} }
  })
  const onEvent = vi.fn((handler: (event: unknown) => void) => {
    eventHandlers.add(handler)
    return () => eventHandlers.delete(handler)
  })
  const emitEvent = (event: unknown) => {
    for (const handler of eventHandlers) handler(event)
  }
  const core = { rpc: rpcCalls, onEvent } as unknown as RemoteClientCore
  return { ...core, rpcCalls, emitEvent } as unknown as RemoteClientCore & { rpcCalls: CoreRpcMock; emitEvent(event: unknown): void }
}

describe('Remote ApiProxy tunnel client', () => {
  it('calls allowlisted Harness methods and validates the echoed rpcId', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    const sessions = await proxy.sessionList()
    expect(sessions).toEqual([{ sessionId: 's1' }])
    expect(core.rpcCalls).toHaveBeenCalledWith(
      'harness.api.call',
      expect.objectContaining({ method: 'session.list' }),
      undefined,
    )
  })

  it('normalizes legacy code preset in session list projections', async () => {
    const core = fakeCore()
    core.rpcCalls.mockImplementationOnce(async (_method, params) => {
      const request = params as { rpcId: string }
      return {
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: {
            items: [{
              sessionId: 'legacy-session',
              agentPreset: 'code',
              projections: {
                asOfSeq: 4,
                values: { agentPreset: 'code', other: 'code' },
              },
            }],
          },
        },
      }
    })
    const proxy = new RemoteApiProxy(core)

    await expect(proxy.sessionList()).resolves.toEqual([{
      sessionId: 'legacy-session',
      agentPreset: 'ptc',
      projections: {
        asOfSeq: 4,
        values: { agentPreset: 'ptc', other: 'code' },
      },
    }])
  })

  it('surfaces native RpcResult errors as ApiProxyError', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    await expect(proxy.call('session.unknown', {})).rejects.toMatchObject({
      code: 'method-not-found',
      message: 'nope',
    })
    await expect(proxy.call('session.unknown', {})).rejects.toBeInstanceOf(ApiProxyError)
  })

  it('rejects an ApiProxy response whose rpcId was not echoed', async () => {
    const core = fakeCore()
    core.rpcCalls.mockImplementationOnce(async () => ({ rpcId: 'different-id', result: { ok: true, value: {} } }))
    const proxy = new RemoteApiProxy(core)
    await expect(proxy.call('session.list', {})).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  })

  it('uses the optimistic message rpcId for session.prompt correlation', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    await proxy.sessionPrompt('s1', 'Check the repo', 'prompt-rpc-1')
    expect(core.rpcCalls).toHaveBeenCalledWith(
      'harness.api.call',
      expect.objectContaining({ method: 'session.prompt', rpcId: 'prompt-rpc-1' }),
      undefined,
    )
  })

  it('uses the bounded transfer path for a large image prompt', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)

    await proxy.sessionPrompt('s1', 'Inspect this image', 'prompt-image-1', [{
      uri: 'file:///selected.png',
      mediaType: 'image/png',
      data: 'A'.repeat(2 * 1024 * 1024),
      bytes: 1536 * 1024,
      width: 1200,
      height: 800,
      name: 'selected.png',
    }])

    const methods = core.rpcCalls.mock.calls.map(call => call[0])
    expect(methods[0]).toBe('harness.api.transfer.open')
    expect(methods).toContain('harness.api.transfer.chunk')
    expect(methods).toContain('harness.api.transfer.commit')
    expect(methods.at(-1)).toBe('harness.api.transfer.close')
  })

  it('opens the mux stream and routes harness.api.frame events', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    const frames: unknown[] = []
    const close = await proxy.openMuxStream(frame => frames.push(frame))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(frames).toEqual([expect.objectContaining({
      rpcId: 'host-rpc-1',
      payload: expect.objectContaining({ type: 'approval/requested', approvalId: 'a1' }),
    })])
    await close()
  })

  it('normalizes legacy code preset in mux projection frames', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    const frames: unknown[] = []
    const close = await proxy.openMuxStream(frame => frames.push(frame))
    const open = core.rpcCalls.mock.calls.find(call => call[0] === 'harness.api.stream.open')
    const streamId = String((open?.[1] as { streamId: unknown }).streamId)

    core.emitEvent({
      event: 'harness.api.frame',
      data: {
        streamId,
        frame: {
          rpcId: '',
          payload: { type: 'session/projection', sessionId: 'legacy-session', key: 'agentPreset', value: 'code', seq: 7 },
        },
      },
    })

    expect(frames).toContainEqual({
      rpcId: '',
      payload: { type: 'session/projection', sessionId: 'legacy-session', key: 'agentPreset', value: 'ptc', seq: 7 },
    })
    await close()
  })

  it('can detach a stale mux stream without sending a close RPC', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    const close = await proxy.openMuxStream(() => undefined)
    core.rpcCalls.mockClear()

    await close(false)

    expect(core.rpcCalls).not.toHaveBeenCalled()
  })

  it('answers approvals and questions through harness.api.respond', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    await proxy.respondApproval('rpc-1', 's1', 'a1', 'allowed-once')
    expect(core.rpcCalls).toHaveBeenCalledWith('harness.api.respond', expect.objectContaining({
      message: expect.objectContaining({
        type: 'client-response',
        rpcId: 'rpc-1',
        result: { ok: true, value: { sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once' } },
      }),
    }))
    await proxy.respondQuestion('rpc-2', 's1', { answers: [{ id: 'q1', selected: ['Yes'] }] })
  })

  it('rejects a Host receipt that did not accept the response', async () => {
    const core = fakeCore()
    core.rpcCalls.mockImplementationOnce(async () => ({ accepted: false, reason: 'not-pending' }))
    const proxy = new RemoteApiProxy(core)
    await expect(proxy.respondApproval('rpc-expired', 's1', 'a1', 'rejected')).rejects.toMatchObject({
      code: 'PERMISSION_NOT_PENDING',
    })
  })

  it('creates sessions and passes workspace or cwd through', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    await expect(proxy.sessionCreate()).resolves.toEqual({ sessionId: 's-new' })
    await proxy.sessionCreate('w1')
    expect(core.rpcCalls).toHaveBeenCalledWith('harness.api.call', expect.objectContaining({
      method: 'session.create',
      payload: { workspaceId: 'w1' },
    }), undefined)
  })

  it('loads and selects session models with reasoning effort passthrough', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    const models = await proxy.sessionModels('s1')
    expect(models.current.model).toBe('deepseek-v4-flash')
    const selected = await proxy.sessionSelectModel('s1', { provider: 'deepseek-official', model: 'deepseek-v3', reasoningEffort: 'high' })
    expect(selected.model).toBe('deepseek-v3')
    expect(core.rpcCalls).toHaveBeenCalledWith('harness.api.call', expect.objectContaining({
      method: 'session.selectModel',
      payload: { sessionId: 's1', provider: 'deepseek-official', model: 'deepseek-v3', reasoningEffort: 'high' },
    }), undefined)
  })

  it('changes the native Harness approval mode through the permission command', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    await proxy.sessionSelectPermission('s1', 'default')
    expect(core.rpcCalls).toHaveBeenCalledWith('harness.api.call', expect.objectContaining({
      method: 'commands.execute',
      payload: { agentId: 's1', line: '/permission default', images: [] },
    }), undefined)
    await expect(proxy.sessionSelectPermission('s1', '../unsafe')).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  })

  it('lists workspaces with archived session ids', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    const list = await proxy.workspaceList()
    expect(list.items[0]).toMatchObject({ workspaceId: 'w1' })
    expect(list.archivedSessionIds).toEqual(['s-old'])
  })

  it('manages workspaces and archives sessions', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    const created = await proxy.workspaceCreate('/tmp/p')
    expect(created.workspace.workspaceId).toBe('w2')
    await proxy.workspaceRename('w1', 'Renamed')
    await proxy.workspaceDelete('w1')
    await expect(proxy.workspaceArchiveSession('s2')).resolves.toEqual(['s-old', 's2'])
    await proxy.workspaceInsertBefore('w2', 'w1')
    expect(core.rpcCalls).toHaveBeenCalledWith('harness.api.call', expect.objectContaining({
      method: 'workspace.insertBefore',
      payload: { workspaceId: 'w2', beforeWorkspaceId: 'w1' },
    }), undefined)
  })

  it('lists host directories with optional path', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    const listing = await proxy.hostListDirectory('/src')
    expect(listing.entries[0]).toMatchObject({ name: 'src' })
    expect(core.rpcCalls).toHaveBeenCalledWith('harness.api.call', expect.objectContaining({
      method: 'host.listDirectory',
      payload: { path: '/src' },
    }), undefined)
  })

  it('passes beforeSeq for paged history', async () => {
    const core = fakeCore()
    const proxy = new RemoteApiProxy(core)
    await proxy.sessionHistory('s1', 42, 20)
    expect(core.rpcCalls).toHaveBeenCalledWith('harness.api.call', expect.objectContaining({
      method: 'session.history',
      payload: { sessionId: 's1', beforeSeq: 42, maxMessages: 20 },
    }), undefined)
  })
})
