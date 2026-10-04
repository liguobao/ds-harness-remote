import { describe, expect, it, vi } from 'vitest'
import {
  AcpVirtualHarness,
  createAcpWorkspaceView,
  acpCwdWorkspaceId,
} from '../src/acp/virtual-harness.js'

function fakeAcp() {
  return {
    createSession: vi.fn(async (cwd: string) => ({ sessionId: 'acp_1', cwd })),
    prompt: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
    listDirectory: vi.fn(async (path: string) => ({
      path,
      home: path,
      crumbs: [{ name: 'repo', path, hidden: false }],
      entries: [],
      truncated: false,
    })),
    openStream: vi.fn(async () => ({ close: async () => undefined })),
    respond: vi.fn(async () => ({})),
  }
}

describe('AcpVirtualHarness', () => {
  it('creates a cwd workspace and session with cursor ids', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const workspace = await target.selectOrCreateWorkspace('/workspace/repo')
    expect(workspace.workspaceId).toBe(acpCwdWorkspaceId('/workspace/repo'))
    expect(createAcpWorkspaceView('/workspace/repo').title).toBe('repo')

    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: workspace.workspaceId } },
    }, new AbortController().signal)
    expect(created).toMatchObject({ ok: true, value: { sessionId: 'cursor:acp_1' } })
    expect(client.createSession).toHaveBeenCalledWith('/workspace/repo', 'agent', 'cursor', expect.any(AbortSignal))

    const listed = await target.dispatch('session/list', { args: {} }, new AbortController().signal)
    expect(listed).toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({
          sessionId: 'cursor:acp_1',
          blank: true,
          cwd: '/workspace/repo',
          projections: expect.objectContaining({ kind: 'sequenced' }),
        })],
      },
    })
    await target.close()
  })

  it('opens the Session control stream with the required baseline', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const stream = await target.open('session/control', {}, new AbortController().signal)
    const first = await stream[Symbol.asyncIterator]().next()
    expect(first.value).toEqual({ type: 'baseline', value: { projections: {} } })
    await target.close()
  })

  it('opens the Workspace follow stream with the complete 0.2 baseline', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    const stream = await target.open('workspace/follow', {}, new AbortController().signal)
    const first = await stream[Symbol.asyncIterator]().next()
    expect(first.value).toMatchObject({
      type: 'baseline',
      value: { archivedSessionIds: [], pinnedSessionIds: [] },
    })
    await target.close()
  })

  it('opens the event stream with the required ready frame', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    const stream = await target.open('$events', {}, new AbortController().signal)
    const first = await stream[Symbol.asyncIterator]().next()
    expect(first.value).toMatchObject({ type: 'ready', host: { home: '/workspace/repo' } })
    await target.close()
  })

  it('forwards text prompts to Agent ACP', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal)

    const prompted = await target.dispatch('session/prompt', {
      args: { request: {
        sessionId: 'cursor:acp_1',
        content: [{ type: 'text', text: 'List files' }],
      } },
    }, new AbortController().signal)
    expect(prompted.ok).toBe(true)
    expect(client.prompt).toHaveBeenCalledWith('acp_1', 'List files', expect.any(AbortSignal))
    expect(client.openStream).toHaveBeenCalled()
    await target.close()
  })

  it('maps ApiProxy approval outcomes to ACP respond decisions', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal)

    // Seed a pending approval the same way stream frames would.
    ;(target as unknown as { pendingApprovals: Map<string, { requestHandle: string; sessionId: string }> })
      .pendingApprovals.set('req_1', { requestHandle: 'req_1', sessionId: 'cursor:acp_1' })

    await expect(target.api.respond({
      type: 'client-response',
      rpcId: 'req_1' as never,
      result: { ok: true, value: 'allowed-once' },
    })).resolves.toEqual({ accepted: true })
    expect(client.respond).toHaveBeenCalledWith('req_1', 'allow-once')
    await target.close()
  })

  it('emits opening snapshot with assistantStream baseline in session/follow', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }

    const controller = new AbortController()
    const source = await target.open('session/follow', {
      args: { request: {
        address: { kind: 'session', sessionId: created.value.sessionId },
        assistantStream: true,
      } },
    }, controller.signal)
    const iterator = source[Symbol.asyncIterator]()
    const snapshot = await iterator.next()
    expect(snapshot.value).toMatchObject({
      type: 'snapshot',
      header: { version: 3, id: created.value.sessionId },
      assistantStream: { revision: 0 },
    })
    controller.abort()
    await iterator.return?.()
    await target.close()
  })

  it('allows model selection and projects selected model for antigravity', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }
    const sessionId = created.value.sessionId

    const catalogResult = await target.dispatch('session/modelCatalog', {}, new AbortController().signal) as {
      ok: true
      value: { default: unknown; routableProviders: string[]; groups: Array<{ models: unknown[] }>; failures: unknown[] }
    }
    expect(catalogResult.ok).toBe(true)
    expect(catalogResult.value.routableProviders).toEqual(['antigravity'])
    expect(catalogResult.value.failures).toEqual([])

    const modelsResult = await target.dispatch('session/models', {
      args: { request: { sessionId } },
    }, new AbortController().signal) as { ok: true; value: { current: { provider: string; model: string }; routable: boolean; groups: Array<{ models: unknown[] }> } }
    expect(modelsResult.ok).toBe(true)
    expect(modelsResult.value.current.provider).toBe('antigravity')
    expect(modelsResult.value.routable).toBe(true)
    expect(modelsResult.value.groups[0]?.models.length).toBeGreaterThan(1)

    const selectResult = await target.dispatch('session/selectModel', {
      args: { request: { sessionId, provider: 'antigravity', model: 'claude-sonnet-4-6' } },
    }, new AbortController().signal) as { ok: true; value: { selected: { model: string } } }
    expect(selectResult.ok).toBe(true)
    expect(selectResult.value.selected.model).toBe('claude-sonnet-4-6')

    const modelsAfter = await target.dispatch('session/models', {
      args: { request: { sessionId } },
    }, new AbortController().signal) as { ok: true; value: { current: { model: string } } }
    expect(modelsAfter.value.current.model).toBe('claude-sonnet-4-6')
    await target.close()
  })

  it('loads session/page with address object from DSH session controller', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }
    const sessionId = created.value.sessionId

    // DSH SessionController sends address instead of sessionId:
    const pageResult = await target.dispatch('session/page', {
      args: { request: {
        address: { kind: 'session', sessionId },
        throughSeq: 0,
      } },
    }, new AbortController().signal) as { ok: true; value: { records: unknown[]; hasMore: boolean } }

    expect(pageResult.ok).toBe(true)
    expect(pageResult.value.records).toEqual([])
    expect(pageResult.value.hasMore).toBe(false)

    // Send a prompt to create history events and verify follow snapshot cursor matches tail record seq
    await target.dispatch('session/prompt', {
      args: { request: {
        sessionId,
        content: [{ type: 'text', text: 'Hello Antigravity' }],
      } },
    }, new AbortController().signal)

    const followStream = await target.open('session/follow', {
      args: { request: {
        address: { kind: 'session', sessionId },
        assistantStream: true,
      } },
    }, new AbortController().signal)

    const iterator = followStream[Symbol.asyncIterator]()
    const snapshotFrame = await iterator.next()
    expect(snapshotFrame.done).toBe(false)
    const snapshot = snapshotFrame.value as {
      type: string
      cursor: number
      records: Array<{ event: { seq: number } }>
    }
    expect(snapshot.type).toBe('snapshot')
    expect(snapshot.records.length).toBeGreaterThan(0)
    // The cursor MUST equal the tail entry's seq (assertPageThrough requirement)
    expect(snapshot.cursor).toBe(snapshot.records.at(-1)!.event.seq)

    // And session/page throughSeq returns records up to that seq
    const pageWithThrough = await target.dispatch('session/page', {
      args: { request: {
        address: { kind: 'session', sessionId },
        throughSeq: 0,
      } },
    }, new AbortController().signal) as { ok: true; value: { records: Array<{ event: { seq: number } }> } }
    expect(pageWithThrough.ok).toBe(true)
    expect(pageWithThrough.value.records.at(-1)!.event.seq).toBe(0)

    await target.close()
  })
})
