import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import {
  AcpVirtualHarness,
  discoverAcpVirtualWorkspaces,
  acpCwdWorkspaceId,
  type AcpClientLike,
} from '../src/acp/virtual-harness.js'
import type { AcpSessionArchivedData, AgentAcpFrameData } from '@dsh-remote/protocol'

type AgentAcpClientLike = AcpClientLike

function fakeAcp() {
  return {
    createSession: vi.fn(async (cwd: string) => ({ sessionId: 'acp_1', cwd })),
    listSessions: vi.fn(async () => [{ conversationId: 'remote-history', title: 'Remote history', createdAt: 1, updatedAt: 2 }]),
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
  it('recovers delayed ACP titles without stale catalog reads replacing newer metadata', async () => {
    await runScenarios(['delayed catalog', 'live rename', 'workspace refresh', 'manual rename', 'closed projection', 'retry exhausted', 'read timeout'].map(name => ({ name, run: async () => {
      vi.useFakeTimers()
      const catalog = (title: string) => [{ conversationId: 'remote-history', title, createdAt: 1, updatedAt: 2 }]
      const placeholder = 'New session - 2026-10-18T14:29:07.000Z'
      let onFrame!: (frame: AgentAcpFrameData) => void
      let resolveRead!: (items: ReturnType<typeof catalog>) => void
      let readSignal: AbortSignal | undefined
      const listSessions = vi.fn(async (_path: string, _backend?: string, _limit?: number, _signal?: AbortSignal) => catalog('Native title'))
        .mockResolvedValueOnce(catalog(placeholder))
        .mockImplementationOnce((_path, _backend, _limit, signal) => {
          readSignal = signal
          return new Promise(resolve => { resolveRead = resolve })
        })
      const client = { ...fakeAcp(), listSessions,
        openStream: vi.fn(async (_id: string, handler: typeof onFrame) => { onFrame = handler; return { close: async () => undefined } }),
      }
      const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'opencode')
      const signal = new AbortController().signal
      const request = { sessionId: 'opencode:remote-history' }
      const emit = (update: Record<string, unknown>) => onFrame({ frame: { method: 'session/update', params: { sessionId: 'remote-history', update } } } as AgentAcpFrameData)
      const projection = () => target.dispatch('session/projections', { args: { request } }, signal)
      try {
        await target.selectOrCreateWorkspace('/test')
        await target.dispatch('session/prompt', { args: { request: { ...request, content: [{ type: 'text', text: 'First request' }] } } }, signal)
        const rediscovery = name === 'workspace refresh' ? target.dispatch('session/list', { args: {} }, signal) : undefined
        if (!rediscovery) emit({ sessionUpdate: 'prompt_completed' })
        expect(await projection()).toMatchObject({ ok: true, value: { values: { title: 'First request' } } })
        expect(listSessions).toHaveBeenCalledTimes(2)
        if (name === 'live rename' || name === 'workspace refresh') emit({ sessionUpdate: 'session_info_update', title: 'Live title' })
        if (name === 'manual rename') await target.dispatch('session/rename', { args: { request: { ...request, title: 'Manual title' } } }, signal)
        if (name === 'closed projection') {
          await target.close()
          expect(readSignal?.aborted).toBe(true)
        }
        if (name === 'retry exhausted') listSessions.mockResolvedValue(catalog(placeholder))
        if (name !== 'read timeout') resolveRead(catalog(name === 'delayed catalog' || name === 'retry exhausted' ? placeholder : 'Stale title'))
        await rediscovery
        await vi.advanceTimersByTimeAsync(20_000)
        if (name === 'read timeout') {
          expect(readSignal?.aborted).toBe(true)
          resolveRead(catalog('Late title'))
          await vi.advanceTimersByTimeAsync(0)
        }
        if (name !== 'closed projection') {
          const title = name === 'live rename' || name === 'workspace refresh' ? 'Live title' : name === 'manual rename' ? 'Manual title'
            : name === 'retry exhausted' || name === 'read timeout' ? 'First request' : 'Native title'
          expect(await projection()).toMatchObject({ ok: true, value: { values: { title } } })
        }
        expect(listSessions).toHaveBeenCalledTimes(name === 'delayed catalog' ? 3 : name === 'retry exhausted' ? 6 : 2)
        expect(vi.getTimerCount()).toBe(0)
      } finally { await target.close(); vi.useRealTimers() }
    } })))
  })

  it('restores OpenCode title metadata from history and accepts only its own live updates', async () => {
    await runScenarios(['New session - 2026-10-18T14:29:07.000Z', 'Native title'].map(title => ({ name: title, run: async () => {
      const client = { ...fakeAcp(),
        listSessions: vi.fn(async () => [{ conversationId: 'remote-history', title, createdAt: 1, updatedAt: 2 }]),
        loadSessionHistory: vi.fn(async () => ['Original request', 'Later request'].map((text, seq) => ({ type: 'event', event: {
          type: 'user/message', seq, time: 0, data: { content: [{ type: 'text', text }] },
        } }))),
        openStream: vi.fn(async (_id: string, handler: (frame: AgentAcpFrameData) => void) => { onFrame = handler; return { close: async () => undefined } }),
      }
      let onFrame!: (frame: AgentAcpFrameData) => void
      const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'opencode')
      const controller = new AbortController()
      const request = { sessionId: 'opencode:remote-history' }
      const projection = () => target.dispatch('session/projections', { args: { request } }, controller.signal)
      let iterator: AsyncIterator<unknown> | undefined
      try {
        await target.selectOrCreateWorkspace('/test')
        const stream = await target.open('session/follow', { args: { request } }, controller.signal)
        iterator = stream[Symbol.asyncIterator]()
        const expected = title === 'Native title' ? title : 'Original request'
        expect((await iterator.next()).value).toMatchObject({ type: 'snapshot', projections: { values: { title: expected } } })
        // A stale placeholder catalog cannot overwrite the recovered title.
        await target.dispatch('session/list', { args: {} }, controller.signal)
        expect(await projection()).toMatchObject({ ok: true, value: { values: { title: expected } } })
        for (const [sessionId, update] of [
          ['other', { sessionUpdate: 'session_info_update', title: 'Other session' }],
          ['remote-history', { sessionUpdate: 'session_info_update', _meta: { retry: true } }],
        ] as const) onFrame({ frame: { method: 'session/update', params: { sessionId, update } } } as AgentAcpFrameData)
        expect(await projection()).toMatchObject({ ok: true, value: { values: { title: expected } } })
        onFrame({ frame: { method: 'session/update', params: { sessionId: 'remote-history', update: { sessionUpdate: 'session_info_update', title: 'Confirmed title' } } } } as AgentAcpFrameData)
        expect(await projection()).toMatchObject({ ok: true, value: { values: { title: 'Confirmed title' } } })
      } finally { controller.abort(); await iterator?.return?.(); await target.close() }
    } })))
  })

  it('requires exact registered session identities for model reads and changes', async () => {
    await runScenarios([
      { id: 'opencode:remote-history', nativeId: 'remote-history' },
      { id: 'other-history', nativeId: 'other-history' },
      { id: 'history' },
      { id: 'opencode:missing' },
      { id: 'claude:remote-history' },
    ].map(scenario => ({ name: scenario.id, run: async () => {
      const current = { provider: 'opencode', model: 'host/a' }
      const selected = { provider: 'opencode', model: 'host/b' }
      const client = { ...fakeAcp(),
        listSessions: vi.fn(async () => ['remote-history', 'other-history'].map(conversationId => ({ conversationId, title: conversationId, createdAt: 1, updatedAt: 2 }))),
        sessionModels: vi.fn(async () => ({ current, routable: true, failures: [],
          groups: [{ id: 'opencode', name: 'OpenCode', models: [{ id: 'host/a', name: 'A' }, { id: 'host/b', name: 'B' }] }] })),
        selectModel: vi.fn(async () => selected),
      }
      const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'opencode')
      const signal = new AbortController().signal
      try {
        await target.selectOrCreateWorkspace('/test')
        const request = { sessionId: scenario.id, ...selected }
        const models = await target.dispatch('session/models', { args: { request } }, signal)
        const selection = await target.dispatch('session/selectModel', { args: { request } }, signal)
        if (scenario.nativeId) {
          expect(models).toMatchObject({ ok: true, value: { current } })
          expect(selection).toMatchObject({ ok: true, value: { selected } })
          expect(client.sessionModels).toHaveBeenCalledWith(scenario.nativeId, 'opencode')
          expect(client.selectModel).toHaveBeenCalledTimes(1)
          expect(client.selectModel).toHaveBeenCalledWith(scenario.nativeId, 'opencode', selected)
        } else {
          expect(models).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
          expect(selection).toMatchObject({ ok: false, error: { code: 'session-not-found' } })
          expect(client.sessionModels).not.toHaveBeenCalled()
          expect(client.selectModel).not.toHaveBeenCalled()
        }
      } finally { await target.close() }
    } })))
  })

  it('prefers exact model IDs and rejects ambiguous aliases before upstream mutation', async () => {
    await runScenarios([
      { model: 'openrouter/anthropic/sonnet', expected: 'openrouter/anthropic/sonnet' },
      { model: 'anthropic/sonnet', expected: 'anthropic/sonnet' },
      { model: 'haiku', expected: 'vendor/haiku' },
      { model: 'router/vendor/haiku', expected: 'vendor/haiku' },
      { model: 'sonnet' },
      { model: 'router/openrouter/anthropic/sonnet' },
      { model: 'missing' },
    ].map(scenario => ({ name: scenario.model, run: async () => {
      const client = { ...fakeAcp(),
        sessionModels: vi.fn(async () => ({ current: { provider: 'opencode', model: 'anthropic/sonnet' }, routable: true, failures: [],
          groups: [{ id: 'opencode', name: 'OpenCode', models: ['anthropic/sonnet', 'openrouter/anthropic/sonnet', 'vendor/haiku'].map(id => ({ id, name: id })) }] })),
        selectModel: vi.fn(async (_id: string, _backend: string, selection: { provider: string; model: string }) => selection),
      }
      const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'opencode')
      const signal = new AbortController().signal
      try {
        const workspace = await target.selectOrCreateWorkspace('/test')
        const request = { sessionId: workspace.sessionIds[0]!, provider: 'opencode', model: scenario.model }
        const result = await target.dispatch('session/selectModel', { args: { request } }, signal)
        if (scenario.expected) {
          const selected = { provider: 'opencode', model: scenario.expected }
          expect(result).toMatchObject({ ok: true, value: { selected } })
          expect(client.selectModel).toHaveBeenCalledTimes(1)
          expect(client.selectModel).toHaveBeenCalledWith('remote-history', 'opencode', selected)
          expect(await target.dispatch('session/projections', { args: { request } }, signal)).toMatchObject({ ok: true,
            value: { values: { modelSelection: { next: selected } } } })
        } else {
          expect(result).toMatchObject({ ok: false, error: { code: 'model-unavailable' } })
          expect(client.selectModel).not.toHaveBeenCalled()
        }
      } finally { await target.close() }
    } })))
  })

  it('preserves authoritative history failures and permits recovery after retry', async () => {
    await runScenarios((['pi', 'claude', 'opencode'] as const).map(backend => ({ name: backend, run: async () => {
      const client = { ...fakeAcp(), loadSessionHistory: vi.fn(async () => [] as unknown[]) }
      const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, backend)
      const signal = new AbortController().signal
      try {
        const workspace = await target.selectOrCreateWorkspace('/test')
        const request = { sessionId: workspace.sessionIds[0]! }
        for (const endpoint of ['session/history', 'session/page']) {
          client.loadSessionHistory.mockRejectedValueOnce(Object.assign(new Error('History reader is busy'), { code: 'ACP_HISTORY_BUSY' }))
          expect(await target.dispatch(endpoint, { args: { request } }, signal)).toMatchObject({ ok: false, error: { code: 'ACP_HISTORY_BUSY' } })
          expect(await target.dispatch(endpoint, { args: { request } }, signal)).toMatchObject({ ok: true, value: { records: [] } })
        }
        const events = [{ type: 'event', event: { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 'Saved prompt' }] } } }]
        client.loadSessionHistory.mockResolvedValueOnce(events)
        expect(await target.dispatch('session/history', { args: { request } }, signal)).toMatchObject({ ok: true, value: { records: events } })
      } finally { await target.close() }
    } })))
  })

  it('commits ACP model projections only after Host confirmation and fails closed on discovery errors', async () => {
    await runScenarios((['cursor', 'claude', 'pi', 'opencode', 'antigravity'] as const).map(backend => ({ name: backend, run: async () => {
      const current = { provider: backend, model: 'host/a' }
      const client = { ...fakeAcp(),
        sessionModels: vi.fn(async () => ({ current, routable: true, failures: [],
          groups: [{ id: backend, name: backend, models: [{ id: 'host/a', name: 'A' }, { id: 'host/b', name: 'B' }] }] })),
        selectModel: vi.fn(async () => { throw new Error('upstream rejected') }),
      }
      const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, backend)
      const signal = new AbortController().signal
      try {
        const workspace = await target.selectOrCreateWorkspace('/test')
        const sessionId = workspace.sessionIds[0]!
        const request = { sessionId, provider: backend, model: 'host/b' }
        expect(await target.dispatch('session/models', { args: { request } }, signal)).toMatchObject({ ok: true, value: { current } })
        expect(await target.dispatch('session/selectModel', { args: { request } }, signal)).toMatchObject({ ok: false })
        expect(client.selectModel).toHaveBeenCalledWith(backend === 'cursor' ? 'acp_1' : 'remote-history', backend, { provider: backend, model: 'host/b' })
        expect(await target.dispatch('session/projections', { args: { request } }, signal)).toMatchObject({ ok: true,
          value: { values: { modelSelection: { next: current } } } })
        client.sessionModels.mockRejectedValueOnce(new Error('catalog failed'))
        expect(await target.dispatch('session/models', { args: { request } }, signal)).toMatchObject({ ok: false })
      } finally { await target.close() }
    } })))
  })

  it('requires native archive confirmation, retains history and applies shared catalog events', async () => {
    let notify!: (data: AcpSessionArchivedData) => void
    const unsubscribe = vi.fn()
    const client = { ...fakeAcp(), supportsArchive: () => true,
      archiveSession: vi.fn(async () => { throw new Error('native rejected') }),
      onSessionArchived: (handler: typeof notify) => { notify = handler; return unsubscribe },
      loadSessionHistory: vi.fn(async () => []),
    }
    const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'opencode')
    const signal = new AbortController().signal
    try {
      const workspace = await target.selectOrCreateWorkspace('/test')
      const sessionId = workspace.sessionIds[0]!
      const invoke = (endpoint: string) => target.dispatch(endpoint, { args: { request: { sessionId } } }, signal)
      expect(await invoke('workspace/archiveSession')).toMatchObject({ ok: false })
      expect(workspace.sessionIds).toContain(sessionId)
      client.archiveSession.mockImplementationOnce(async () => undefined as never)
      expect(await invoke('workspace/archiveSession')).toMatchObject({ ok: true, value: { archivedSessionIds: [sessionId] } })
      expect(client.archiveSession).toHaveBeenLastCalledWith('remote-history', 'opencode')
      expect(await invoke('session/history')).toMatchObject({ ok: true })
      notify({ backend: 'opencode', sessionId: 'other', archived: true })
      expect(await target.dispatch('workspace/list', { args: {} }, signal)).toMatchObject({ ok: true,
        value: { archivedSessionIds: [sessionId, 'opencode:other'] } })
    } finally { await target.close() }
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps a new AGY follow empty and reuses only the requested blank session', async () => {
    const client = { ...fakeAcp(),
      listSessions: vi.fn(async () => [{ conversationId: 'old', title: 'Old history', createdAt: 1, updatedAt: 2 }]),
      loadSessionHistory: vi.fn(async () => [{ type: 'event', event: { type: 'user/message', seq: 0, time: 1, data: {} } }]),
    }
    client.createSession.mockResolvedValue({ sessionId: 'new', cwd: '/test' })
    const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'antigravity')
    const workspace = await target.selectOrCreateWorkspace('/test')
    const signal = new AbortController().signal
    const created = await target.dispatch('session/create', { args: { request: { workspaceId: workspace.workspaceId } } }, signal)
    expect(created).toMatchObject({ ok: true, value: { sessionId: 'acp:new' } })
    const stream = await target.open('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'acp:new' } } } }, signal)
    const iterator = stream[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ type: 'snapshot', header: { id: 'acp:new' }, records: [], cursor: -1 })
    await expect(target.dispatch('session/projections', { args: { request: { sessionId: 'acp:new' } } }, signal))
      .resolves.toMatchObject({ ok: true, value: { kind: 'sequenced', asOfSeq: -1 } })
    expect(client.loadSessionHistory).not.toHaveBeenCalled()
    const calls = client.createSession.mock.calls.length
    expect(await target.dispatch('session/create', { args: { request: { workspaceId: workspace.workspaceId, sessionId: 'acp:new' } } }, signal))
      .toMatchObject({ ok: true, value: { sessionId: 'acp:new' } })
    expect(client.createSession.mock.calls).toHaveLength(calls)
    expect(await target.dispatch('session/create', { args: { request: { workspaceId: workspace.workspaceId } } }, signal))
      .toMatchObject({ ok: false, error: { code: 'session-already-exists' } })
    await iterator.return?.()
    await target.close()
  })

  it('passes AGY images and exposes attachments only in their own Session', async () => {
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    let onFrame: ((frame: AgentAcpFrameData) => void) | undefined
    const client = { ...fakeAcp(), listSessions: vi.fn(async () => [{ conversationId: 'old', title: 'Old', createdAt: 1, updatedAt: 2 }]),
      openStream: vi.fn(async (_id: string, handler: (frame: AgentAcpFrameData) => void) => { onFrame = handler; return { close: async () => undefined } }),
    }
    const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'antigravity')
    const signal = new AbortController().signal
    try {
      const workspace = await target.selectOrCreateWorkspace('/test')
      await target.dispatch('session/create', { args: { request: { workspaceId: workspace.workspaceId } } }, signal)
      expect(await target.dispatch('session/prompt', { args: { request: { sessionId: 'acp:acp_1', content: [{ type: 'image', mediaType: 'image/png', data }] } } }, signal)).toMatchObject({ ok: true })
      expect(client.prompt).toHaveBeenCalledWith('acp_1', '', signal, [{ type: 'image', mimeType: 'image/png', data }], 'antigravity')
      const history = await target.dispatch('session/history', { args: { request: { sessionId: 'acp:acp_1' } } }, signal) as any
      const image = history.value.records.find((entry: any) => entry.event.type === 'user/message').event.data.content[0]
      expect(image).toMatchObject({ type: 'image', attachment: { mediaType: 'image/png', width: 1, height: 1 } })
      expect(await target.dispatch('session/attachment', { args: { request: { sessionId: 'acp:acp_1', attachmentId: image.attachment.attachmentId } } }, signal)).toMatchObject({ ok: true, value: { data } })
      expect(await target.dispatch('session/attachment', { args: { request: { sessionId: 'acp:old', attachmentId: image.attachment.attachmentId } } }, signal)).toMatchObject({ ok: false })
      onFrame!({ frame: { method: 'session/update', params: { sessionId: 'acp_1', update: { sessionUpdate: 'prompt_completed' } } } } as AgentAcpFrameData)
    } finally { await target.close() }
  })

  it('delegates unprojected global surfaces to the Host gateway', async () => {
    const hostCarrier = {
      invoke: vi.fn(async () => undefined),
      dispatch: vi.fn(async (endpoint: string) => ({ ok: true as const, value: { endpoint } })),
      open: vi.fn(async () => (async function* () { yield { type: 'ready' } })()),
    }
    const target = new AcpVirtualHarness(fakeAcp(), { deviceId: 'host-1', name: 'Host' }, 'antigravity', hostCarrier)
    const signal = new AbortController().signal
    await expect(target.dispatch('settings/describe', { args: {} }, signal))
      .resolves.toEqual({ ok: true, value: { endpoint: 'settings/describe' } })
    expect(hostCarrier.dispatch).toHaveBeenCalledWith('settings/describe', { args: {} }, signal)
    const stream = await target.open('account/watch', { args: {} }, signal)
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({ done: false, value: { type: 'ready' } })
    expect(hostCarrier.open).toHaveBeenCalledWith('account/watch', { args: {} }, signal)
    await target.close()
  })

  it('provides the required native carrier stream baselines', async () => {
    await runScenarios([
      {
        name: 'opens the Session control stream with the required baseline',
        run: async () => {
          const client = fakeAcp()
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const stream = await target.open('session/control', {}, new AbortController().signal)
          const first = await stream[Symbol.asyncIterator]().next()
          expect(first.value).toEqual({ type: 'baseline', value: { projections: {} } })
          await target.close()
        },
      },
      {
        name: 'opens the Workspace follow stream with the complete 0.2 baseline',
        run: async () => {
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
        },
      },
      {
        name: 'opens the event stream with the required ready frame',
        run: async () => {
          const client = fakeAcp()
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          await target.selectOrCreateWorkspace('/workspace/repo')
          const stream = await target.open('$events', {}, new AbortController().signal)
          const first = await stream[Symbol.asyncIterator]().next()
          expect(first.value).toMatchObject({ type: 'ready', host: { home: '/workspace/repo' } })
          await target.close()
        },
      },
      {
        name: 'answers the background-job roster without a terminal stream failure',
        run: async () => {
          const client = fakeAcp()
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
          const rosterController = new AbortController()
          const roster = await target.open('job/list', { args: { request: { sessionId: 'acp:job' } } }, rosterController.signal)
          const rosterIterator = roster[Symbol.asyncIterator]()
          await expect(rosterIterator.next()).resolves.toEqual({ done: false, value: { type: 'rows', jobs: [] } })
          rosterController.abort()
          await expect(rosterIterator.next()).resolves.toMatchObject({ done: true })

          const followController = new AbortController()
          const follow = await target.open('job/follow', { args: { request: { jobId: 'job-1' } } }, followController.signal)
          followController.abort()
          await expect(follow[Symbol.asyncIterator]().next()).resolves.toMatchObject({ done: true })
          await target.close()
        },
      },
      {
        name: 'emits opening snapshot with assistantStream baseline in session/follow',
        run: async () => {
          const client = fakeAcp()
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
          await target.selectOrCreateWorkspace('/workspace/repo')
          const created = (await target.dispatch(
            'session/create',
            {
              args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo', 'antigravity') } },
            },
            new AbortController().signal,
          )) as { ok: true; value: { sessionId: string } }

          const controller = new AbortController()
          const source = await target.open(
            'session/follow',
            {
              args: {
                request: {
                  address: { kind: 'session', sessionId: created.value.sessionId },
                  assistantStream: true,
                },
              },
            },
            controller.signal,
          )
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
        },
      },
    ])
  }, 20000)

  it('forwards text prompts to Agent ACP', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo', 'cursor') } },
    }, new AbortController().signal)

    const prompted = await target.dispatch('session/prompt', {
      args: { request: {
        sessionId: 'cursor:acp_1',
        content: [{ type: 'text', text: 'List files' }],
      } },
    }, new AbortController().signal)
    expect(prompted.ok).toBe(true)
    expect(client.prompt).toHaveBeenCalledWith('acp_1', 'List files', expect.any(AbortSignal), [], 'cursor')
    expect(client.openStream).toHaveBeenCalled()
    await target.close()
  })

  it('maps ApiProxy approval outcomes to ACP respond decisions', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo', 'cursor') } },
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

  it('loads and pages history only through the remote ACP authority', async () => {
    await runScenarios([
      {
        name: 'loads session/page with address object from DSH session controller',
        run: async () => {
          const client = fakeAcp()
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
          await target.selectOrCreateWorkspace('/workspace/repo')
          const created = (await target.dispatch(
            'session/create',
            {
              args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo', 'antigravity') } },
            },
            new AbortController().signal,
          )) as { ok: true; value: { sessionId: string } }
          const sessionId = created.value.sessionId

          // DSH SessionController sends address instead of sessionId:
          const pageResult = (await target.dispatch(
            'session/page',
            {
              args: {
                request: {
                  address: { kind: 'session', sessionId },
                  throughSeq: 0,
                },
              },
            },
            new AbortController().signal,
          )) as { ok: true; value: { records: unknown[]; hasMore: boolean } }

          expect(pageResult.ok).toBe(true)
          expect(pageResult.value.records).toEqual([])
          expect(pageResult.value.hasMore).toBe(false)

          // Send a prompt to create history events and verify follow snapshot cursor matches tail record seq
          await target.dispatch(
            'session/prompt',
            {
              args: {
                request: {
                  sessionId,
                  content: [{ type: 'text', text: 'Hello Antigravity' }],
                },
              },
            },
            new AbortController().signal,
          )

          const followStream = await target.open(
            'session/follow',
            {
              args: {
                request: {
                  address: { kind: 'session', sessionId },
                  assistantStream: true,
                },
              },
            },
            new AbortController().signal,
          )

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
          const pageWithThrough = (await target.dispatch(
            'session/page',
            {
              args: {
                request: {
                  address: { kind: 'session', sessionId },
                  throughSeq: 0,
                },
              },
            },
            new AbortController().signal,
          )) as { ok: true; value: { records: Array<{ event: { seq: number } }> } }
          expect(pageWithThrough.ok).toBe(true)
          expect(pageWithThrough.value.records.at(-1)!.event.seq).toBe(0)

          await target.close()
        },
      },
      {
        name: 'uses only the remote ACP history, including empty or unavailable history',
        run: async () => {
          const client = {
            ...fakeAcp(),
            listSessions: vi.fn(async () => [
              { conversationId: 'remote-only', title: 'Remote', createdAt: 1, updatedAt: 2 },
            ]),
            loadSessionHistory: vi.fn(async () => [] as unknown[]),
          }
          const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'antigravity')
          try {
            await target.selectOrCreateWorkspace('/workspace/repo')
            const history = () =>
              target.dispatch(
                'session/history',
                { args: { sessionId: 'acp:remote-only' } },
                new AbortController().signal,
              )
            expect(await history()).toMatchObject({ ok: true, value: { records: [] } })
            client.loadSessionHistory.mockRejectedValueOnce(new Error('remote unavailable'))
            expect(await history()).toMatchObject({ ok: true, value: { records: [] } })
            expect(client.loadSessionHistory).toHaveBeenCalledWith('acp:remote-only', 'antigravity')
          } finally {
            await target.close()
          }
        },
      },
      {
        name: 'hydrates session history via client.loadSessionHistory RPC when available',
        run: async () => {
          const mockEvents = [
            { type: 'event', event: { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } } },
            { type: 'event', event: { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } } },
            {
              type: 'event',
              event: {
                type: 'user/message',
                seq: 2,
                time: 1000,
                data: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
                surfaceOp: 'append',
              },
            },
            {
              type: 'event',
              event: {
                type: 'assistant/message',
                seq: 3,
                time: 1001,
                data: { role: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
                surfaceOp: 'append',
              },
            },
            { type: 'event', event: { type: 'step/end', seq: 4, time: 1001, data: { turn: 1, step: 1 } } },
            { type: 'event', event: { type: 'turn/end', seq: 5, time: 1001, data: { turn: 1 } } },
          ]
          const client: AcpClientLike = {
            createSession: vi.fn(async () => ({ sessionId: 'new-session' })),
            prompt: vi.fn(async () => {}),
            cancel: vi.fn(async () => {}),
            listDirectory: vi.fn(async () => []),
            openStream: vi.fn(async () => ({ close: async () => {} })),
            respond: vi.fn(async () => {}),
            listSessions: vi.fn(async () => [
              {
                conversationId: 'remote-conv-1',
                title: 'Remote conversation',
                createdAt: 1000,
                updatedAt: 2000,
              },
            ]),
            loadSessionHistory: vi.fn(async () => mockEvents),
          }

          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
          const workspaceId = acpCwdWorkspaceId('/var/lib/dsh/workspace/ds-harness-remote', 'antigravity')
          const ws = await target.selectWorkspace(workspaceId)
          expect(client.listSessions).toHaveBeenCalled()
          expect(ws.sessionIds).toContain('acp:remote-conv-1')

          const historyRes = await target.dispatch(
            'session/history',
            {
              args: { sessionId: 'acp:remote-conv-1', maxMessages: 50 },
            },
            new AbortController().signal,
          )

          expect(client.loadSessionHistory).toHaveBeenCalledWith('acp:remote-conv-1', 'antigravity')
          expect(historyRes.ok).toBe(true)
          if (historyRes.ok) {
            const records = (historyRes.value as any).records
            expect(records.length).toBe(6)
            const types = records.map((r: any) => r.event.type)
            expect(types).toContain('user/message')
            expect(types).toContain('assistant/message')
          }
          await target.close()
        },
      },
    ])
  }, 15000)

  it('projects ordered ACP assistant and user turns into native events', async () => {
    await runScenarios([
      {
        name: 'streams assistant response via assistant-stream frames and commits assistant/message event',
        run: async () => {
          let inboundHandler: ((frame: { frame: { method: string; params: unknown } }) => void) | undefined
          const client = {
            ...fakeAcp(),
            openStream: vi.fn(async (_sessionId: string, onFrame: (frame: unknown) => void) => {
              inboundHandler = onFrame as never
              return { close: vi.fn(async () => undefined) }
            }),
          }
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
          await target.selectOrCreateWorkspace('/workspace/repo')
          const created = (await target.dispatch(
            'session/create',
            {
              args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo', 'antigravity') } },
            },
            new AbortController().signal,
          )) as { ok: true; value: { sessionId: string } }
          const sessionId = created.value.sessionId

          const followController = new AbortController()
          const followStream = await target.open(
            'session/follow',
            {
              args: {
                request: {
                  address: { kind: 'session', sessionId },
                  assistantStream: true,
                },
              },
            },
            followController.signal,
          )
          const iterator = followStream[Symbol.asyncIterator]()
          const snapshot = await iterator.next()
          expect(snapshot.value).toMatchObject({ type: 'snapshot' })

          // Simulate ACP inbound events: agent_message_chunk -> prompt_completed
          expect(inboundHandler).toBeDefined()
          inboundHandler!({
            frame: {
              method: 'session/update',
              params: {
                sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  text: 'Hello, World!',
                },
              },
            },
          })

          // Should receive turn/start and step/start events before assistant-stream frames
          const turnStart = await iterator.next()
          expect(turnStart.value).toMatchObject({ type: 'event', event: { type: 'turn/start' } })

          const stepStart = await iterator.next()
          expect(stepStart.value).toMatchObject({ type: 'event', event: { type: 'step/start' } })

          // Should receive assistant-stream start and chunk frames
          const startFrame = await iterator.next()
          expect(startFrame.value).toMatchObject({
            type: 'assistant-stream',
            frame: { type: 'start', turn: 1 },
          })

          const chunk1 = await iterator.next()
          expect(chunk1.value).toMatchObject({
            type: 'assistant-stream',
            frame: { type: 'chunk', chunk: { type: 'block-start', blockType: 'text' } },
          })

          const chunk2 = await iterator.next()
          expect(chunk2.value).toMatchObject({
            type: 'assistant-stream',
            frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'Hello, World!' } },
          })

          // Now emit prompt_completed
          inboundHandler!({
            frame: {
              method: 'session/update',
              params: {
                sessionId,
                update: {
                  sessionUpdate: 'prompt_completed',
                  stopReason: 'end_turn',
                },
              },
            },
          })

          // Should receive block-end, finish, assistant/message event, and end frame
          const blockEnd = await iterator.next()
          expect(blockEnd.value).toMatchObject({
            type: 'assistant-stream',
            frame: { type: 'chunk', chunk: { type: 'block-end', block: { text: 'Hello, World!' } } },
          })

          const finish = await iterator.next()
          expect(finish.value).toMatchObject({
            type: 'assistant-stream',
            frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } },
          })

          const msgEvent = await iterator.next()
          expect(msgEvent.value).toMatchObject({
            type: 'event',
            event: {
              type: 'assistant/message',
              surfaceOp: 'append',
              data: {
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: 'Hello, World!' }],
                },
              },
            },
          })

          const endFrame = await iterator.next()
          expect(endFrame.value).toMatchObject({
            type: 'assistant-stream',
            frame: {
              type: 'end',
              outcome: {
                kind: 'committed',
                eventType: 'assistant/message',
              },
            },
          })

          // Verify session/page returns the committed assistant/message in history
          const pageResult = (await target.dispatch(
            'session/page',
            {
              args: {
                request: {
                  address: { kind: 'session', sessionId },
                  cursor: -1,
                },
              },
            },
            new AbortController().signal,
          )) as { ok: true; value: { records: Array<{ event: { type: string; data: unknown } }> } }
          expect(pageResult.ok).toBe(true)
          const assistantRecord = pageResult.value.records.find((r) => r.event.type === 'assistant/message')
          expect(assistantRecord).toBeDefined()
          expect(assistantRecord?.event.data).toMatchObject({
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hello, World!' }],
            },
            stream: [
              {
                type: 'chunk',
                time: expect.any(Number),
                chunk: { type: 'block-start', index: 0, blockType: 'text' },
              },
              {
                type: 'chunk',
                time: expect.any(Number),
                chunk: { type: 'text-delta', index: 0, text: 'Hello, World!' },
              },
              {
                type: 'chunk',
                time: expect.any(Number),
                chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello, World!' } },
              },
              { type: 'chunk', time: expect.any(Number), chunk: { type: 'finish', reason: { kind: 'stop' } } },
            ],
          })

          followController.abort()
          await iterator.return?.()
          await target.close()
        },
      },
      {
        name: 'encloses user/message in turn/step and associates rpcId across multiple turns',
        run: async () => {
          let inboundHandler: ((frame: AgentAcpFrameData) => void) | undefined
          const client: AgentAcpClientLike = {
            createSession: vi.fn(async () => ({ sessionId: 'acp_multiturn' })),
            prompt: vi.fn(async () => {}),
            cancel: vi.fn(async () => {}),
            listDirectory: vi.fn(async () => []),
            openStream: vi.fn(async (_sid, onFrame) => {
              inboundHandler = onFrame
              return { close: async () => {} }
            }),
            respond: vi.fn(async () => {}),
          }

          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
          await target.selectOrCreateWorkspace('/workspace/repo')
          const created = (await target.dispatch(
            'session/create',
            {
              args: {
                request: {
                  workspaceId: acpCwdWorkspaceId('/workspace/repo', 'antigravity'),
                  sessionId: 'acp:acp_multiturn',
                },
              },
            },
            new AbortController().signal,
          )) as { ok: true; value: { sessionId: string } }
          const sessionId = created.value.sessionId

          const followController = new AbortController()
          const followStream = await target.open(
            'session/follow',
            {
              args: {
                request: {
                  address: { kind: 'session', sessionId },
                  assistantStream: true,
                },
              },
            },
            followController.signal,
          )
          const iterator = followStream[Symbol.asyncIterator]()
          await iterator.next() // snapshot

          // Turn 1 prompt
          await target.dispatch(
            'session/prompt',
            {
              args: {
                request: {
                  sessionId,
                  requestId: 'req_turn_1',
                  content: [{ type: 'text', text: 'First question' }],
                },
              },
            },
            new AbortController().signal,
          )

          // Should receive turn/start, step/start, user/message with rpcId
          const t1TurnStart = await iterator.next()
          expect(t1TurnStart.value).toMatchObject({
            type: 'event',
            event: { type: 'turn/start', data: { turn: 1 } },
          })
          const t1StepStart = await iterator.next()
          expect(t1StepStart.value).toMatchObject({
            type: 'event',
            event: { type: 'step/start', data: { turn: 1, step: 1 } },
          })
          const t1UserMsg = await iterator.next()
          expect(t1UserMsg.value).toMatchObject({
            type: 'event',
            event: {
              type: 'user/message',
              surfaceOp: 'append',
              data: {
                role: 'user',
                content: [{ type: 'text', text: 'First question' }],
                source: { kind: 'user', rpcId: 'req_turn_1' },
              },
            },
          })

          // Reply turn 1
          inboundHandler!({
            streamId: 'stream-1',
            frame: {
              method: 'session/update',
              params: {
                sessionId,
                update: { sessionUpdate: 'agent_message_chunk', text: 'First answer' },
              },
            },
          })
          inboundHandler!({
            streamId: 'stream-1',
            frame: {
              method: 'session/update',
              params: {
                sessionId,
                update: { sessionUpdate: 'prompt_completed', stopReason: 'end_turn' },
              },
            },
          })

          // Consume stream frames for turn 1
          let frame = await iterator.next()
          while (
            !frame.done &&
            !(frame.value as { event?: { type: string } }).event?.type?.includes('turn/end')
          ) {
            frame = await iterator.next()
          }

          // Turn 2 prompt
          await target.dispatch(
            'session/prompt',
            {
              args: {
                request: {
                  sessionId,
                  requestId: 'req_turn_2',
                  content: [{ type: 'text', text: 'Second question' }],
                },
              },
            },
            new AbortController().signal,
          )

          // Should receive turn/start (turn 2), step/start (turn 2), user/message with rpcId req_turn_2
          const t2TurnStart = await iterator.next()
          expect(t2TurnStart.value).toMatchObject({
            type: 'event',
            event: { type: 'turn/start', data: { turn: 2 } },
          })
          const t2StepStart = await iterator.next()
          expect(t2StepStart.value).toMatchObject({
            type: 'event',
            event: { type: 'step/start', data: { turn: 2, step: 1 } },
          })
          const t2UserMsg = await iterator.next()
          expect(t2UserMsg.value).toMatchObject({
            type: 'event',
            event: {
              type: 'user/message',
              surfaceOp: 'append',
              data: {
                role: 'user',
                content: [{ type: 'text', text: 'Second question' }],
                source: { kind: 'user', rpcId: 'req_turn_2' },
              },
            },
          })

          followController.abort()
          await iterator.return?.()
          await target.close()
        },
      },
    ])
  }, 10000)

  it('scopes workspace IDs by backend and rejects unscoped or other backend IDs', async () => {
    const cursorId = acpCwdWorkspaceId('/workspace/repo', 'cursor')
    const agyId = acpCwdWorkspaceId('/workspace/repo', 'antigravity')
    expect(cursorId).toBe('cursor:cwd:%2Fworkspace%2Frepo')
    expect(agyId).toBe('antigravity:cwd:%2Fworkspace%2Frepo')
    expect(agyId).not.toBe(cursorId)
    expect(() => acpCwdWorkspaceId('/workspace/repo', undefined as never)).toThrow('explicit ACP workspace backend')
    const catalog = { ...fakeAcp(), listWorkspaces: vi.fn(async () => [{ path: '/workspace/repo' }]) }
    expect((await discoverAcpVirtualWorkspaces(catalog, 'cursor'))[0].workspaceId).toBe(cursorId)
    expect((await discoverAcpVirtualWorkspaces(catalog, 'antigravity'))[0].workspaceId).toBe(agyId)
    const agy = new AcpVirtualHarness(fakeAcp(), { deviceId: 'host', name: 'Host' }, 'antigravity')
    const cursor = new AcpVirtualHarness(fakeAcp(), { deviceId: 'host', name: 'Host' })
    try {
      expect((await agy.selectWorkspace(agyId)).workspaceId).toBe(agyId)
      expect((await cursor.selectWorkspace(cursorId)).workspaceId).toBe(cursorId)
      await expect(agy.selectWorkspace(cursorId)).rejects.toThrow('no longer available')
      await expect(agy.selectWorkspace('/workspace/repo')).rejects.toThrow('no longer available')
      await expect(cursor.selectWorkspace('/workspace/repo')).rejects.toThrow('no longer available')
      await expect(cursor.selectWorkspace(agyId)).rejects.toThrow('no longer available')
    } finally { await agy.close(); await cursor.close() }
  })

})
