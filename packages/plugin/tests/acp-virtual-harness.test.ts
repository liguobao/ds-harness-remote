import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import {
  AcpVirtualHarness,
  discoverAcpVirtualWorkspaces,
  acpCwdWorkspaceId,
  type AcpClientLike,
} from '../src/acp/virtual-harness.js'
import { AcpSessionHistoryCache } from '../src/session-history-cache.js'
import { utf8JsonByteLength, VIRTUAL_HISTORY_MAX_BYTES, VIRTUAL_HISTORY_MAX_MESSAGES } from '../src/virtual-history-pagination.js'
import {
  createRpcResponse,
  encodeMessage,
  MAX_SECURE_MESSAGE_BYTES,
  SecureMessageCodec,
  type AcpSessionArchivedData,
  type AgentAcpFrameData,
} from '@dsh-remote/protocol'

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

  it('deduplicates concurrent ACP history hydration across backends and reuses cached history across workspace switches', async () => {
    await runScenarios((['claude', 'hermes', 'kimi', 'opencode', 'pi'] as const).map(backend => ({ name: backend, run: async () => {
      const event = { type: 'event', event: { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 'Cached project prompt' }] } } }
      let resolveHistory!: (value: unknown[]) => void
      const client = {
        ...fakeAcp(),
        listSessions: vi.fn(async () => [{ conversationId: 's1', cwd: '/repo-a', title: 'Repo A', createdAt: 10, updatedAt: 20 }]),
        loadSessionHistory: vi.fn(() => new Promise<unknown[]>(resolve => { resolveHistory = resolve })),
      }
      const cache = new AcpSessionHistoryCache()
      const signal = new AbortController().signal
      const first = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, backend, undefined, cache)
      try {
        const workspace = await first.selectWorkspace(`${backend}:cwd:/repo-a`)
        const request = { sessionId: workspace.sessionIds[0]!, address: { sessionId: workspace.sessionIds[0]! } }
        const projections = first.dispatch('session/projections', { args: { request } }, signal)
        const history = first.dispatch('session/history', { args: { request } }, signal)
        const page = first.dispatch('session/page', { args: { request } }, signal)
        expect(client.loadSessionHistory).toHaveBeenCalledTimes(1)
        resolveHistory([event])
        await expect(projections).resolves.toMatchObject({ ok: true })
        await expect(history).resolves.toMatchObject({ ok: true, value: { records: [event] } })
        await expect(page).resolves.toMatchObject({ ok: true, value: { records: [event] } })
        expect(first.openedSessionId).toBe(workspace.sessionIds[0]!)
      } finally {
        await first.close()
      }

      const second = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, backend, undefined, cache)
      try {
        const workspace = await second.selectWorkspace(`${backend}:cwd:/repo-a`)
        const request = { sessionId: workspace.sessionIds[0]!, address: { sessionId: workspace.sessionIds[0]! } }
        await expect(second.dispatch('session/history', { args: { request } }, signal)).resolves.toMatchObject({
          ok: true,
          value: { records: [event] },
        })
        expect(client.loadSessionHistory).toHaveBeenCalledTimes(1)
      } finally {
        await second.close()
      }
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
        expect(client.selectModel).toHaveBeenCalledWith('remote-history', backend, { provider: backend, model: 'host/b' })
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
    const initialProjection = await target.dispatch('session/projections', { args: { request: { sessionId: 'acp:new' } } }, signal) as {
      ok: true; value: { kind: string; asOfSeq: number }
    }
    expect(initialProjection).toMatchObject({ ok: true, value: { kind: 'sequenced' } })
    expect(initialProjection.value.asOfSeq).toBeGreaterThanOrEqual(0)
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
      // 0.2.2 clients send the full image reference instead of the bare id.
      expect(await target.dispatch('session/attachment', { args: { request: { sessionId: 'acp:acp_1', attachment: image.attachment } } }, signal)).toMatchObject({ ok: true, value: { data } })
      expect(await target.dispatch('session/attachment', { args: { request: { sessionId: 'acp:old', attachmentId: image.attachment.attachmentId } } }, signal)).toMatchObject({ ok: false })
      onFrame!({ frame: { method: 'session/update', params: { sessionId: 'acp_1', update: { sessionUpdate: 'prompt_completed' } } } } as AgentAcpFrameData)
    } finally { await target.close() }
  })

  it('passes images and exposes attachments in Hermes and Kimi sessions', async () => {
    await runScenarios((['hermes', 'kimi'] as const).map(backend => ({
      name: backend,
      run: async () => {
        const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
        let onFrame: ((frame: AgentAcpFrameData) => void) | undefined
        const nativeSessionId = `${backend}_1`
        const publicSessionId = `${backend}:${nativeSessionId}`
        const client = {
          ...fakeAcp(),
          createSession: vi.fn(async (cwd: string) => ({ sessionId: nativeSessionId, cwd })),
          prompt: vi.fn(async () => ({})),
          openStream: vi.fn(async (_id: string, handler: (frame: AgentAcpFrameData) => void) => { onFrame = handler; return { close: async () => undefined } }),
        }
        const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, backend)
        const signal = new AbortController().signal
        try {
          const workspace = await target.selectOrCreateWorkspace('/test')
          await target.dispatch('session/create', { args: { request: { workspaceId: workspace.workspaceId } } }, signal)
          expect(await target.dispatch('session/prompt', { args: { request: { sessionId: publicSessionId, content: [{ type: 'image', mediaType: 'image/png', data }] } } }, signal)).toMatchObject({ ok: true })
          expect(client.prompt).toHaveBeenCalledWith(nativeSessionId, '', signal, [{ type: 'image', mimeType: 'image/png', data }], backend)
          const history = await target.dispatch('session/history', { args: { request: { sessionId: publicSessionId } } }, signal) as any
          const image = history.value.records.find((entry: any) => entry.event.type === 'user/message').event.data.content[0]
          expect(image).toMatchObject({ type: 'image', attachment: { mediaType: 'image/png', width: 1, height: 1 } })
          expect(await target.dispatch('session/attachment', { args: { request: { sessionId: publicSessionId, attachmentId: image.attachment.attachmentId } } }, signal)).toMatchObject({ ok: true, value: { data } })
          onFrame!({ frame: { method: 'session/update', params: { sessionId: nativeSessionId, update: { sessionUpdate: 'prompt_completed' } } } } as AgentAcpFrameData)
        } finally { await target.close() }
      },
    })))
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

  it('maps Typert approval outcomes to ACP respond decisions', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo', 'cursor') } },
    }, new AbortController().signal)

    // Seed a pending approval the same way stream frames would.
    ;(target as unknown as { pendingApprovals: Map<string, { requestHandle: string; sessionId: string }> })
      .pendingApprovals.set('req_1', { requestHandle: 'req_1', sessionId: 'cursor:acp_1' })

    await expect(target.dispatch('$events/result', { args: { eventId: 'req_1', outcome: { kind: 'result', value: 'allowed-once' } } }, new AbortController().signal)).resolves.toMatchObject({ ok: true })
    expect(client.respond).toHaveBeenCalledWith('req_1', 'allow-once', undefined, expect.any(AbortSignal))
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

  it('projects and toggles ACP permission presets and auto-approves requests under danger-full-access', async () => {
    let onFrame!: (frame: AgentAcpFrameData) => void
    const client = {
      ...fakeAcp(),
      openStream: vi.fn(async (_id: string, handler: typeof onFrame) => { onFrame = handler; return { close: async () => undefined } }),
      respond: vi.fn(async () => ({})),
      selectPermission: vi.fn(async () => ({})),
    }
    const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, 'opencode')
    const signal = new AbortController().signal
    try {
      const workspace = await target.selectOrCreateWorkspace('/test')
      const sessionId = workspace.sessionIds[0]!
      const request = { sessionId }

      const initial = await target.dispatch('session/projections', { args: { request } }, signal)
      expect(initial).toMatchObject({
        ok: true,
        value: {
          values: {
            permissions: {
              options: [
                { value: 'workspace-write' },
                { value: 'danger-full-access' },
              ],
              currentValue: 'Host settings (not reported)',
            },
          },
        },
      })

      const commands = await target.dispatch('commands/list', { args: { request } }, signal)
      expect(commands).toMatchObject({ ok: true, value: [{ name: 'permission' }] })

      const switchResult = await target.dispatch('commands/execute', { args: { agentId: sessionId, line: '/permission danger-full-access', images: [] } }, signal)
      expect(switchResult).toMatchObject({ ok: true, value: { result: { kind: 'success', text: 'preset danger-full-access' } } })
      expect(client.selectPermission).toHaveBeenCalledWith('remote-history', 'opencode', 'danger-full-access')

      const updated = await target.dispatch('session/projections', { args: { request } }, signal)
      expect(updated).toMatchObject({
        ok: true,
        value: {
          values: {
            permissions: {
              currentValue: 'danger-full-access',
            },
          },
        },
      })

      const followStream = await target.open('session/follow', { args: { request } }, signal)
      const iterator = followStream[Symbol.asyncIterator]()
      await iterator.next()

      onFrame({
        frame: {
          method: 'session/request_permission',
          params: {
            requestHandle: 'handle_1',
            toolName: 'bash',
            reason: 'execute command',
          },
        },
      } as AgentAcpFrameData)

      expect(client.respond).toHaveBeenCalledWith('handle_1', 'allow-once')

      await target.dispatch('commands/execute', { args: { agentId: sessionId, line: '/permission workspace-write', images: [] } }, signal)
      const reverted = await target.dispatch('session/projections', { args: { request } }, signal)
      expect(reverted).toMatchObject({
        ok: true,
        value: {
          values: {
            permissions: {
              currentValue: 'workspace-write',
            },
          },
        },
      })
    } finally {
      await target.close()
    }
  })

  it('maintains a single stream per session across ensureFollow, sessionFollow, replacement and onClosed', async () => {
    await runScenarios(['overlap mid-turn', 'supersede consumer', 'background release', 'remote onClosed', 'openStream failure'].map(name => ({ name, run: async () => {
      const streamClose = vi.fn(async () => undefined)
      let onFrame!: (frame: AgentAcpFrameData) => void
      let onClosed!: (closed: { streamId: string; reason: 'completed' | 'cancelled' | 'peer-disconnected' | 'failed' }) => void
      const client = {
        ...fakeAcp(),
        openStream: vi.fn(async (_id: string, handler: typeof onFrame, closed?: typeof onClosed) => {
          onFrame = handler
          onClosed = closed!
          return { close: streamClose }
        }),
      }
      const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode')
      const signal = new AbortController().signal
      const emit = (update: Record<string, unknown>) =>
        onFrame({ streamId: 's1', frame: { method: 'session/update', params: { sessionId: 'remote-history', update } } })
      try {
        await target.selectOrCreateWorkspace('/test')
        const sessionId = 'opencode:remote-history'
        const eventsStream = await target.open('$events', {}, signal)
        const eventsIter = eventsStream[Symbol.asyncIterator]()
        await eventsIter.next() // ready

        if (name === 'openStream failure') {
          client.openStream.mockRejectedValueOnce(new Error('stream limit reached'))
          await expect(target.dispatch('session/prompt', { args: { request: { sessionId, content: [{ type: 'text', text: 'first' }] } } }, signal))
            .resolves.toMatchObject({ ok: false })
          expect(await target.dispatch('session/prompt', { args: { request: { sessionId, content: [{ type: 'text', text: 'retry' }] } } }, signal))
            .toMatchObject({ ok: true })
          expect(client.openStream).toHaveBeenCalledTimes(2)
          emit({ sessionUpdate: 'prompt_completed', stopReason: 'end_turn' })
          await eventsIter.return?.()
          return
        }

        if (name === 'overlap mid-turn') {
          await target.dispatch('session/prompt', { args: { request: { sessionId, content: [{ type: 'text', text: 'hi' }] } } }, signal)
          emit({ sessionUpdate: 'agent_message_chunk', text: 'part 1 ' })
          const controller = new AbortController()
          const followStream = await target.open('session/follow', { args: { request: { sessionId, assistantStream: true } } }, controller.signal)
          const iter = followStream[Symbol.asyncIterator]()
          const snap = (await iter.next()).value as { type: string; assistantStream: { activeAttempt?: { nextIndex: number; stream: unknown[] } } }
          expect(snap.type).toBe('snapshot')
          expect(snap.assistantStream.activeAttempt).toMatchObject({ nextIndex: 2, turn: 1, step: 1 })
          expect(snap.assistantStream.activeAttempt?.stream).toHaveLength(2)
          expect(client.openStream).toHaveBeenCalledTimes(1)

          emit({ sessionUpdate: 'agent_message_chunk', text: 'part 2' })
          emit({ sessionUpdate: 'prompt_completed', stopReason: 'end_turn' })
          const received: Array<{ type: string; event?: { type: string } }> = []
          for (let i = 0; i < 7; i++) received.push((await iter.next()).value as never)
          expect(received.filter(item => item.event?.type === 'assistant/message')).toHaveLength(1)
          expect(received.filter(item => item.event?.type === 'turn/end')).toHaveLength(1)
          // Stream stays open across turns because a consumer is attached.
          expect(streamClose).not.toHaveBeenCalled()
          controller.abort()
          while (!(await iter.next()).done) { /* drain */ }
          expect(streamClose).toHaveBeenCalledTimes(1)
          await eventsIter.return?.()
          return
        }

        if (name === 'supersede consumer') {
          const c1 = new AbortController()
          const c2 = new AbortController()
          const s1 = await target.open('session/follow', { args: { request: { sessionId } } }, c1.signal)
          const it1 = s1[Symbol.asyncIterator]()
          await it1.next()
          const s2 = await target.open('session/follow', { args: { request: { sessionId } } }, c2.signal)
          const it2 = s2[Symbol.asyncIterator]()
          await it2.next()
          expect(client.openStream).toHaveBeenCalledTimes(1)
          expect(await it1.next()).toEqual({ done: true, value: undefined })
          expect(streamClose).not.toHaveBeenCalled()
          emit({ sessionUpdate: 'agent_message_chunk', text: 'still alive' })
          expect((await it2.next()).value).toMatchObject({ type: 'event', event: { type: 'turn/start' } })
          c2.abort()
          while (!(await it2.next()).done) { /* drain */ }
          expect(streamClose).toHaveBeenCalledTimes(1)
          await eventsIter.return?.()
          return
        }

        if (name === 'background release') {
          await target.dispatch('session/prompt', { args: { request: { sessionId, content: [{ type: 'text', text: 'bg' }] } } }, signal)
          emit({ sessionUpdate: 'agent_message_chunk', text: 'done' })
          emit({ sessionUpdate: 'prompt_completed', stopReason: 'end_turn' })
          expect(streamClose).toHaveBeenCalledTimes(1)
          expect((target as unknown as { follows: Set<unknown> }).follows.size).toBe(0)
          await eventsIter.return?.()
          return
        }

        if (name === 'remote onClosed') {
          const c = new AbortController()
          const followStream = await target.open('session/follow', { args: { request: { sessionId } } }, c.signal)
          const iter = followStream[Symbol.asyncIterator]()
          await iter.next()
          await target.dispatch('session/prompt', { args: { request: { sessionId, content: [{ type: 'text', text: 'run' }] } } }, signal)
          emit({ sessionUpdate: 'agent_message_chunk', text: 'partial' })
          onClosed({ streamId: 's1', reason: 'failed' })
          const items: Array<Record<string, unknown>> = []
          while (true) {
            const next = await iter.next()
            if (next.done) break
            items.push(next.value as Record<string, unknown>)
          }
          expect(items.some(item => item.type === 'event' && (item.event as { type: string; data: { reason?: { kind: string } } }).type === 'turn/end'
            && (item.event as { data: { reason: { kind: string } } }).data.reason.kind === 'error')).toBe(true)
          expect((target as unknown as { follows: Set<unknown> }).follows.size).toBe(0)
          const statusFrames: unknown[] = []
          for (let i = 0; i < 2; i++) statusFrames.push((await eventsIter.next()).value)
          expect(statusFrames.at(-1)).toEqual({ type: 'emit', event: 'api-session/status', args: [sessionId, false] })
          await eventsIter.return?.()
        }
      } finally { await target.close() }
    } })))
  })

  it('projects non-pi reasoning, tool results and terminal outcomes accurately', async () => {
    await runScenarios([
      { name: 'max_tokens with reasoning and tools', update: { sessionUpdate: 'prompt_completed', stopReason: 'max_tokens' }, finish: 'max-tokens', end: 'max-tokens' },
      { name: 'cancelled', update: { sessionUpdate: 'prompt_completed', stopReason: 'cancelled' }, finish: 'aborted', end: 'aborted' },
      { name: 'prompt_failed', update: { sessionUpdate: 'prompt_failed' }, finish: 'error', end: 'error' },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      let onFrame!: (frame: AgentAcpFrameData) => void
      const client = {
        ...fakeAcp(),
        openStream: vi.fn(async (_id: string, handler: typeof onFrame) => { onFrame = handler; return { close: async () => undefined } }),
      }
      const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode')
      const signal = new AbortController().signal
      const sessionId = 'opencode:remote-history'
      const emit = (update: Record<string, unknown>) =>
        onFrame({ streamId: 's1', frame: { method: 'session/update', params: { sessionId: 'remote-history', update } } })
      try {
        await target.selectOrCreateWorkspace('/test')
        await target.dispatch('session/prompt', { args: { request: { sessionId, content: [{ type: 'text', text: 'inspect' }] } } }, signal)
        emit({ sessionUpdate: 'agent_thought_chunk', text: 'step 1 ' })
        emit({ sessionUpdate: 'agent_thought_chunk', text: 'step 2' })
        emit({ sessionUpdate: 'agent_message_chunk', text: 'answer' })
        emit({ sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'bash', status: 'in_progress', rawInput: { cmd: 'ls' } })
        emit({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed', rawOutput: 'file.txt' })
        emit({ sessionUpdate: 'tool_call', toolCallId: 'call-2', title: 'read', status: 'failed', rawOutput: 'missing' })
        emit(scenario.update)

        const history = await target.dispatch('session/history', { args: { request: { sessionId } } }, signal) as {
          ok: true; value: { records: Array<{ event: { type: string; data: Record<string, unknown> } }> }
        }
        const events = history.value.records.map(r => r.event)
        expect(events.filter(e => e.type === 'tool/call')).toHaveLength(2)
        const results = events.filter(e => e.type === 'tool/result').map(e => (e.data.message as { content: unknown[] }).content[0])
        expect(results).toEqual([
          { type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'file.txt' }] },
          { type: 'tool-result', toolCallId: 'call-2', content: [{ type: 'text', text: 'missing' }], isError: true },
        ])
        const assistant = events.find(e => e.type === 'assistant/message')!.data as {
          message: { content: unknown[] }; stream: Array<{ chunk: { type: string; block?: unknown; reason?: { kind: string } } }>
        }
        expect(assistant.message.content).toEqual([
          { type: 'reasoning', text: 'step 1 step 2' },
          { type: 'text', text: 'answer' },
        ])
        expect(assistant.stream.find(c => c.chunk.type === 'block-end')?.chunk.block).toEqual({ type: 'reasoning', text: 'step 1 step 2' })
        expect(assistant.stream.at(-1)?.chunk).toMatchObject({ type: 'finish', reason: { kind: scenario.finish } })
        expect(events.find(e => e.type === 'turn/end')?.data).toMatchObject({ reason: { kind: scenario.end } })
      } finally { await target.close() }
    } })))
  })

  it('restricts hostCarrier to global allowlists and serves job/kill and skills/list locally', async () => {
    const hostCarrier = {
      invoke: vi.fn(async () => undefined),
      dispatch: vi.fn(async (endpoint: string) => ({ ok: true as const, value: { endpoint } })),
      open: vi.fn(async () => (async function* () { yield { type: 'ready' } })()),
    }
    const target = new AcpVirtualHarness(fakeAcp(), { deviceId: 'host-1', name: 'Host' }, 'antigravity', hostCarrier)
    const signal = new AbortController().signal
    try {
      await target.selectOrCreateWorkspace('/test')
      await expect(target.dispatch('skills/list', { args: { request: { sessionId: 'acp:remote-history' } } }, signal))
        .resolves.toEqual({ ok: true, value: { skills: [] } })
      await expect(target.dispatch('job/kill', { args: { request: { jobId: 'job-1' } } }, signal))
        .resolves.toEqual({ ok: true, value: { outcome: 'already-finished' } })
      expect(hostCarrier.dispatch).not.toHaveBeenCalled()

      for (const blocked of ['schedule/list', 'workspaceFiles/readRelated', 'workspace/unarchiveSession', 'speech/follow', 'speech/arbitrary']) {
        await expect(target.dispatch(blocked, { args: {} }, signal))
          .resolves.toMatchObject({ ok: false, error: { code: 'method-not-found' } })
      }
      expect(hostCarrier.dispatch).not.toHaveBeenCalled()

      for (const allowed of [
        'pluginInventory/list',
        'permissionPresets/catalog',
        'credentials/list',
        'speech/catalog',
        'speech/transcribe',
        'speech/prepare',
        'speech/configure',
        'speech/cancelPreparation',
      ]) {
        await expect(target.dispatch(allowed, { args: {} }, signal))
          .resolves.toEqual({ ok: true, value: { endpoint: allowed } })
      }
      expect(hostCarrier.dispatch).toHaveBeenCalledTimes(8)

      for (const blockedOpen of ['schedule/watch', 'speech/transcribe', 'speech/arbitrary']) {
        await expect(target.open(blockedOpen, { args: {} }, signal)).rejects.toMatchObject({ code: 'method-not-found' })
      }
      expect(hostCarrier.open).not.toHaveBeenCalled()
      for (const allowedOpenEndpoint of ['remoteAccess/follow', 'speech/follow']) {
        const allowedOpen = await target.open(allowedOpenEndpoint, { args: {} }, signal)
        await expect(allowedOpen[Symbol.asyncIterator]().next()).resolves.toEqual({ done: false, value: { type: 'ready' } })
      }
      expect(hostCarrier.open).toHaveBeenCalledTimes(2)
      expect(hostCarrier.open).toHaveBeenLastCalledWith('speech/follow', { args: {} }, signal)
    } finally { await target.close() }
  })

  it('rejects unknown session IDs without creating ghost sessions', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode')
    const signal = new AbortController().signal
    try {
      const workspace = await target.selectOrCreateWorkspace('/test')
      const before = [...workspace.sessionIds]
      await expect(target.dispatch('session/prompt', { args: { request: { sessionId: 'opencode:ghost', content: [{ type: 'text', text: 'hi' }] } } }, signal))
        .resolves.toMatchObject({ ok: false, error: { code: 'session-not-found' } })
      await expect(target.dispatch('session/cancel', { args: { request: { sessionId: 'opencode:ghost' } } }, signal))
        .resolves.toMatchObject({ ok: false, error: { code: 'session-not-found' } })
      await expect(target.dispatch('session/rename', { args: { request: { sessionId: 'opencode:ghost', title: 'X' } } }, signal))
        .resolves.toMatchObject({ ok: false, error: { code: 'session-not-found' } })
      await expect(target.dispatch('session/history', { args: { request: { sessionId: 'opencode:ghost' } } }, signal))
        .resolves.toMatchObject({ ok: false, error: { code: 'session-not-found' } })
      await expect(target.dispatch('session/page', { args: { request: { sessionId: 'opencode:ghost' } } }, signal))
        .resolves.toMatchObject({ ok: false, error: { code: 'session-not-found' } })
      await expect(target.dispatch('session/projections', { args: { request: { sessionId: 'opencode:ghost' } } }, signal))
        .resolves.toEqual({ ok: true, value: null })
      await expect(target.open('session/follow', { args: { request: { sessionId: 'opencode:ghost' } } }, signal))
        .rejects.toThrow('not found')
      expect(workspace.sessionIds).toEqual(before)
      expect(client.prompt).not.toHaveBeenCalled()
    } finally { await target.close() }
  })

  it('rolls back pre-stream prompt failures and settles post-stream prompt failures', async () => {
    await runScenarios(['pre-stream without follow', 'pre-stream with follow', 'post-stream failure'].map(name => ({ name, run: async () => {
      const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
      const streamClose = vi.fn(async () => undefined)
      let onFrame!: (frame: AgentAcpFrameData) => void
      const client = {
        ...fakeAcp(),
        listSessions: vi.fn(async () => []),
        openStream: vi.fn(async (_id: string, handler: typeof onFrame) => { onFrame = handler; return { close: streamClose } }),
        prompt: vi.fn(async (): Promise<unknown> => {
          if (name === 'post-stream failure') {
            onFrame({ streamId: 's1', frame: { method: 'session/update', params: { sessionId: 'acp_1', update: { sessionUpdate: 'agent_message_chunk', text: 'partial' } } } })
          }
          throw Object.assign(new Error('Prompt failed'), { code: 'PROMPT_ERR' })
        }),
      }
      const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
      const signal = new AbortController().signal
      try {
        const workspace = await target.selectOrCreateWorkspace('/test')
        const sessionId = workspace.sessionIds[0]!
        let followIter: AsyncIterator<unknown> | undefined
        if (name === 'pre-stream with follow') {
          const s = await target.open('session/follow', { args: { request: { sessionId } } }, signal)
          followIter = s[Symbol.asyncIterator]()
          await followIter.next()
        }
        const res = await target.dispatch('session/prompt', {
          args: { request: { sessionId, content: [{ type: 'text', text: 'Hello' }, { type: 'image', mediaType: 'image/png', data }] } },
        }, signal)
        expect(res).toMatchObject({ ok: false, error: { code: 'PROMPT_ERR' } })
        const history = await target.dispatch('session/history', { args: { request: { sessionId } } }, signal) as {
          ok: true; value: { records: Array<{ event: { type: string; data: unknown } }> }
        }
        if (name === 'post-stream failure') {
          expect(history.value.records.map(r => r.event.type)).toContain('assistant/message')
          expect(history.value.records.find(r => r.event.type === 'turn/end')?.event.data).toMatchObject({
            reason: { kind: 'error', error: { code: 'PROMPT_ERR', message: 'Prompt failed' } },
          })
          return
        }
        expect(history.value.records).toEqual([])
        expect((target as unknown as { imageAttachments: Map<string, unknown> }).imageAttachments.size).toBe(0)
        expect((target as unknown as { follows: Set<unknown> }).follows.size).toBe(0)
        expect(streamClose).toHaveBeenCalledTimes(1)
        if (followIter) {
          // Consuming the closed follow iterator drains queued pre-prompt items and finishes so UI resyncs cleanly.
          while (!(await followIter.next()).done) { /* drain */ }
        }
        client.prompt.mockResolvedValueOnce({})
        expect(await target.dispatch('session/prompt', { args: { request: { sessionId, content: [{ type: 'text', text: 'Retry' }] } } }, signal))
          .toMatchObject({ ok: true })
      } finally { await target.close() }
    } })))
  })

  it('keeps projection asOfSeq monotonic with seq after >10 history events, validates session/rename and syncs title cache', async () => {
    let onFrame!: (frame: AgentAcpFrameData) => void
    const client = {
      ...fakeAcp(),
      listSessions: vi.fn(async () => [{ conversationId: 'remote-history', title: 'New session - 2026-10-18T14:29:07.000Z', createdAt: 1, updatedAt: 2 }]),
      openStream: vi.fn(async (_id: string, handler: typeof onFrame) => { onFrame = handler; return { close: async () => undefined } }),
    }
    const cache = new AcpSessionHistoryCache()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode', undefined, cache)
    const signal = new AbortController().signal
    const sessionId = 'opencode:remote-history'
    try {
      await target.selectOrCreateWorkspace('/test')
      const followStream = await target.open('session/follow', { args: { request: { sessionId } } }, signal)
      const iter = followStream[Symbol.asyncIterator]()
      await iter.next()
      for (let i = 0; i < 4; i++) {
        await target.dispatch('session/prompt', { args: { request: { sessionId, content: [{ type: 'text', text: `msg ${i}` }] } } }, signal)
        onFrame({ streamId: 's1', frame: { method: 'session/update', params: { sessionId: 'remote-history', update: { sessionUpdate: 'agent_message_chunk', text: `reply ${i}` } } } })
        onFrame({ streamId: 's1', frame: { method: 'session/update', params: { sessionId: 'remote-history', update: { sessionUpdate: 'prompt_completed', stopReason: 'end_turn' } } } })
      }
      // >10 durable events in history; asOfSeq remains in projection seq space.
      const history = await target.dispatch('session/history', { args: { request: { sessionId } } }, signal) as {
        ok: true; value: { cursor: number; projections: { asOfSeq: number } }
      }
      expect(history.value.cursor).toBeGreaterThan(10)
      expect(history.value.projections.asOfSeq).toBeLessThan(history.value.cursor)
      await expect(target.dispatch('session/list', { args: {} }, signal)).resolves.toMatchObject({
        ok: true,
        value: { items: [expect.objectContaining({ projections: expect.objectContaining({ asOfSeq: history.value.projections.asOfSeq }) })] },
      })

      await expect(target.dispatch('session/rename', { args: { request: { sessionId, title: '   ' } } }, signal))
        .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
      const renamed = await target.dispatch('session/rename', { args: { request: { sessionId, title: '  Renamed Title  ' } } }, signal) as {
        ok: true; value: { title: string; seq: number }
      }
      expect(renamed).toEqual({ ok: true, value: { title: 'Renamed Title', seq: expect.any(Number) } })
      expect(renamed.value.seq).toBeGreaterThan(history.value.projections.asOfSeq)

      // Native title update via live update syncs the history cache.
      const s2 = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode', undefined, cache)
      const client2 = { ...fakeAcp(), listSessions: vi.fn(async () => [{ conversationId: 'c2', title: 'Initial', createdAt: 1, updatedAt: 2 }]) }
      const h2 = new AcpVirtualHarness(client2, { deviceId: 'host-1', name: 'Host' }, 'opencode', undefined, cache)
      await h2.selectOrCreateWorkspace('/test2')
      const liveTitles = (h2 as unknown as { titles: { applyNative: (s: unknown, t: string) => void }; sessions: Map<string, unknown> })
      liveTitles.titles.applyNative(liveTitles.sessions.get('opencode:c2'), 'Recovered Title')
      expect(cache.getStale('opencode:c2')?.title).toBe('Recovered Title')
      await h2.close()
      await s2.close()
      await iter.return?.()
    } finally { await target.close() }
  })

  it('bounds large ACP history pages by message cap, turnWindow, and byte budget without gaps or loops', async () => {
    const buildTurns = (turnCount: number, replySize: number) => {
      const events: Array<{ type: 'event'; event: { type: string; seq: number; time: number; data: unknown; surfaceOp?: 'append' } }> = []
      let seq = 0
      for (let turn = 1; turn <= turnCount; turn += 1) {
        const payload = `turn-${turn}:` + 'x'.repeat(replySize)
        events.push(
          { type: 'event', event: { type: 'turn/start', seq: seq++, time: turn, data: { turn } } },
          { type: 'event', event: { type: 'step/start', seq: seq++, time: turn, data: { turn, step: 1 } } },
          { type: 'event', event: { type: 'user/message', seq: seq++, time: turn, data: { id: `u-${turn}`, role: 'user', content: [{ type: 'text', text: `Prompt ${turn}` }] }, surfaceOp: 'append' } },
          { type: 'event', event: { type: 'assistant/message', seq: seq++, time: turn, data: { turn, step: 1, message: { id: `a-${turn}`, role: 'assistant', content: [{ type: 'text', text: payload }] } }, surfaceOp: 'append' } },
          { type: 'event', event: { type: 'step/end', seq: seq++, time: turn, data: { turn, step: 1 } } },
          { type: 'event', event: { type: 'turn/end', seq: seq++, time: turn, data: { turn, reason: { kind: 'completed' } } } },
        )
      }
      return events
    }

    await runScenarios([
      {
        name: 'clamps maxMessages=500 and enforces 256 KiB budget across follow, history, and page with lossless cursor walk',
        run: async () => {
          const events = buildTurns(80, 4 * 1024)
          const client = { ...fakeAcp(), loadSessionHistory: vi.fn(async () => events) }
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode')
          const controller = new AbortController()
          let iterator: AsyncIterator<unknown> | undefined
          try {
            const workspace = await target.selectOrCreateWorkspace('/test')
            const sessionId = workspace.sessionIds[0]!
            const followStream = await target.open(
              'session/follow',
              { args: { request: { address: { kind: 'session', sessionId }, maxMessages: 500 } } },
              controller.signal,
            )
            iterator = followStream[Symbol.asyncIterator]()
            const snapshot = (await iterator.next()).value as {
              type: string
              cursor: number
              hasMore: boolean
              records: Array<{ event: { seq: number } }>
            }
            expect(snapshot.type).toBe('snapshot')
            expect(snapshot.hasMore).toBe(true)
            expect(snapshot.records.length).toBeGreaterThan(0)
            expect(snapshot.records.length).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_MESSAGES)
            expect(snapshot.cursor).toBe(snapshot.records.at(-1)!.event.seq)
            expect(utf8JsonByteLength(snapshot)).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_BYTES)

            const history = await target.dispatch(
              'session/history',
              { args: { request: { sessionId, maxMessages: 500 } } },
              controller.signal,
            )
            expect(history.ok).toBe(true)
            if (!history.ok) throw new Error('history failed')
            expect(utf8JsonByteLength(history.value)).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_BYTES)
            expect((history.value as { hasMore: boolean }).hasMore).toBe(true)

            const collected: number[] = []
            let beforeSeq: number | undefined
            let guard = 0
            while (guard++ < 100) {
              const page = await target.dispatch(
                'session/page',
                { args: { request: { address: { kind: 'session', sessionId }, maxMessages: 500, ...(beforeSeq === undefined ? {} : { beforeSeq }) } } },
                controller.signal,
              )
              expect(page.ok).toBe(true)
              if (!page.ok) throw new Error('page failed')
              const value = page.value as { records: Array<{ event: { seq: number } }>; hasMore: boolean }
              expect(value.records.length).toBeGreaterThan(0)
              expect(value.records.length).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_MESSAGES)
              expect(utf8JsonByteLength(value)).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_BYTES)
              collected.unshift(...value.records.map(entry => entry.event.seq))
              if (!value.hasMore) break
              beforeSeq = value.records[0]!.event.seq
            }
            expect(collected).toEqual(events.map(entry => entry.event.seq))
          } finally {
            controller.abort()
            await iterator?.return?.()
            await target.close()
          }
        },
      },
      {
        name: 'aligns integer and object turnWindow to turn boundaries and snaps cleanly under byte budget',
        run: async () => {
          const smallEvents = buildTurns(5, 32)
          const smallClient = { ...fakeAcp(), loadSessionHistory: vi.fn(async () => smallEvents) }
          const smallTarget = new AcpVirtualHarness(smallClient, { deviceId: 'host-1', name: 'Host' }, 'opencode')
          const signal = new AbortController().signal
          try {
            const workspace = await smallTarget.selectOrCreateWorkspace('/test')
            const sessionId = workspace.sessionIds[0]!

            const p1 = await smallTarget.dispatch('session/page', { args: { request: { sessionId, turnWindow: 2 } } }, signal)
            expect(p1.ok).toBe(true)
            if (!p1.ok) throw new Error('p1 failed')
            const v1 = p1.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(v1.records[0]!.event.type).toBe('turn/start')
            expect(v1.records.map(entry => entry.event.seq)).toEqual(smallEvents.slice(18, 30).map(e => e.event.seq))
            expect(v1.hasMore).toBe(true)

            const p2 = await smallTarget.dispatch('session/page', { args: { request: { sessionId, beforeSeq: 18, turnWindow: 2 } } }, signal)
            expect(p2.ok).toBe(true)
            if (!p2.ok) throw new Error('p2 failed')
            const v2 = p2.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(v2.records[0]!.event.type).toBe('turn/start')
            expect(v2.records.map(entry => entry.event.seq)).toEqual(smallEvents.slice(6, 18).map(e => e.event.seq))
            expect(v2.hasMore).toBe(true)

            const p3 = await smallTarget.dispatch('session/page', { args: { request: { sessionId, beforeSeq: 6, turnWindow: 2 } } }, signal)
            expect(p3.ok).toBe(true)
            if (!p3.ok) throw new Error('p3 failed')
            const v3 = p3.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(v3.records[0]!.event.type).toBe('turn/start')
            expect(v3.records.map(entry => entry.event.seq)).toEqual(smallEvents.slice(0, 6).map(e => e.event.seq))
            expect(v3.hasMore).toBe(false)

            const objPage = await smallTarget.dispatch(
              'session/page',
              { args: { request: { sessionId, maxMessages: 500, turnWindow: { minMessages: 15, minTurns: 2 } } } },
              signal,
            )
            expect(objPage.ok).toBe(true)
            if (!objPage.ok) throw new Error('objPage failed')
            const objValue = objPage.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(objValue.records[0]!.event.type).toBe('turn/start')
            expect(objValue.records.map(entry => entry.event.seq)).toEqual(smallEvents.slice(12, 30).map(e => e.event.seq))
            expect(objValue.hasMore).toBe(true)
          } finally {
            await smallTarget.close()
          }

          const heavyEvents = buildTurns(3, 150 * 1024)
          const heavyClient = { ...fakeAcp(), loadSessionHistory: vi.fn(async () => heavyEvents) }
          const heavyTarget = new AcpVirtualHarness(heavyClient, { deviceId: 'host-1', name: 'Host' }, 'opencode')
          try {
            const workspace = await heavyTarget.selectOrCreateWorkspace('/heavy')
            const sessionId = workspace.sessionIds[0]!
            const first = await heavyTarget.dispatch('session/page', { args: { request: { sessionId, turnWindow: 2 } } }, signal)
            expect(first.ok).toBe(true)
            if (!first.ok) throw new Error('heavy first failed')
            const firstVal = first.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(firstVal.records[0]!.event.type).toBe('turn/start')
            expect(firstVal.records.map(entry => entry.event.seq)).toEqual(heavyEvents.slice(12, 18).map(e => e.event.seq))
            expect(firstVal.hasMore).toBe(true)
            expect(utf8JsonByteLength(firstVal)).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_BYTES)
          } finally {
            await heavyTarget.close()
          }
        },
      },
      {
        name: 'returns a single oversized newest event without empty-page infinite loops',
        run: async () => {
          const events = [
            ...buildTurns(1, 32),
            {
              type: 'event' as const,
              event: {
                type: 'assistant/message',
                seq: 6,
                time: 2,
                data: { turn: 2, step: 1, message: { id: 'giant', role: 'assistant', content: [{ type: 'text', text: 'z'.repeat(320 * 1024) }] } },
                surfaceOp: 'append' as const,
              },
            },
          ]
          const client = { ...fakeAcp(), loadSessionHistory: vi.fn(async () => events) }
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode')
          const signal = new AbortController().signal
          try {
            const workspace = await target.selectOrCreateWorkspace('/oversized')
            const sessionId = workspace.sessionIds[0]!
            const first = await target.dispatch('session/page', { args: { request: { sessionId, maxMessages: 200 } } }, signal)
            expect(first.ok).toBe(true)
            if (!first.ok) throw new Error('oversized first failed')
            const firstVal = first.value as { records: Array<{ event: { seq: number } }>; hasMore: boolean }
            expect(firstVal.records.map(entry => entry.event.seq)).toEqual([6])
            expect(firstVal.hasMore).toBe(true)

            const second = await target.dispatch('session/page', { args: { request: { sessionId, beforeSeq: 6, maxMessages: 200 } } }, signal)
            expect(second.ok).toBe(true)
            if (!second.ok) throw new Error('oversized second failed')
            const secondVal = second.value as { records: Array<{ event: { seq: number } }>; hasMore: boolean }
            expect(secondVal.records.map(entry => entry.event.seq)).toEqual([0, 1, 2, 3, 4, 5])
            expect(secondVal.hasMore).toBe(false)
          } finally {
            await target.close()
          }
        },
      },
      {
        name: 'compacts a >4 MiB newest ACP record on session/history below MAX_SECURE_MESSAGE_BYTES without mutating session.events and advances cursor',
        run: async () => {
          const hugePayload = 'q'.repeat(4 * 1024 * 1024 + 64 * 1024)
          const events = [
            ...buildTurns(1, 32),
            {
              type: 'event' as const,
              event: {
                type: 'assistant/message',
                seq: 6,
                time: 2,
                data: {
                  turn: 2,
                  step: 1,
                  message: {
                    id: 'acp-giant-4m',
                    role: 'assistant',
                    content: [{ type: 'text', text: hugePayload }],
                  },
                },
                surfaceOp: 'append' as const,
              },
            },
          ]
          const client = { ...fakeAcp(), loadSessionHistory: vi.fn(async () => events) }
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode')
          const signal = new AbortController().signal
          try {
            const workspace = await target.selectOrCreateWorkspace('/oversized-4m')
            const sessionId = workspace.sessionIds[0]!
            const history = await target.dispatch('session/history', { args: { request: { sessionId, maxMessages: 200 } } }, signal)
            expect(history.ok).toBe(true)
            if (!history.ok) throw new Error('oversized 4m history failed')
            const historyVal = history.value as {
              records: Array<{ event: { seq: number; data: Record<string, unknown> } }>
              events: Array<{ event: { seq: number; data: Record<string, unknown> } }>
              hasMore: boolean
            }
            expect(historyVal.records).toHaveLength(1)
            expect(historyVal.events).toHaveLength(1)
            expect(historyVal.records[0]!.event.seq).toBe(6)
            expect(historyVal.records[0]!.event.data.truncated).toBe(true)
            expect(historyVal.hasMore).toBe(true)

            const rpcBytes = encodeMessage(createRpcResponse('req-acp-4m', history.value))
            expect(rpcBytes.byteLength).toBeLessThanOrEqual(MAX_SECURE_MESSAGE_BYTES)
            expect(() => new SecureMessageCodec().encode(rpcBytes)).not.toThrow()

            // Source session.events must remain untouched.
            const storedSession = (target as unknown as {
              sessions: Map<string, { events: Array<{ event: { data: { message?: { content?: Array<{ text?: string }> } } } }> }>
            }).sessions.get(sessionId)!
            expect(storedSession.events[6]!.event.data.message!.content![0]!.text).toBe(hugePayload)

            // Next page via beforeSeq advances cleanly to older records.
            const older = await target.dispatch('session/page', { args: { request: { sessionId, beforeSeq: 6, maxMessages: 200 } } }, signal)
            expect(older.ok).toBe(true)
            if (!older.ok) throw new Error('oversized 4m older page failed')
            const olderVal = older.value as { records: Array<{ event: { seq: number } }>; hasMore: boolean }
            expect(olderVal.records.map(entry => entry.event.seq)).toEqual([0, 1, 2, 3, 4, 5])
            expect(olderVal.hasMore).toBe(false)
          } finally {
            await target.close()
          }
        },
      },
      {
        name: 'returns explicit response-too-large when ACP projections envelope exceeds transport hard cap',
        run: async () => {
          const events = buildTurns(1, 32)
          const client = { ...fakeAcp(), loadSessionHistory: vi.fn(async () => events) }
          const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'opencode')
          const signal = new AbortController().signal
          try {
            const workspace = await target.selectOrCreateWorkspace('/oversized-envelope')
            const sessionId = workspace.sessionIds[0]!
            const session = (target as unknown as {
              sessions: Map<string, { title?: string }>
            }).sessions.get(sessionId)!
            session.title = 'T'.repeat(MAX_SECURE_MESSAGE_BYTES)

            const history = await target.dispatch('session/history', { args: { request: { sessionId } } }, signal)
            expect(history).toMatchObject({
              ok: false,
              error: { code: 'response-too-large' },
            })

            await expect(
              target.open('session/follow', { args: { request: { sessionId } } }, signal),
            ).rejects.toMatchObject({
              code: 'response-too-large',
              retryable: false,
            })
          } finally {
            await target.close()
          }
        },
      },
    ])
  })
})

it.each(['claude', 'hermes', 'kimi'] as const)('%s routes direct files and terminal streams through ACP tools', async backend => {
  const client = { ...fakeAcp(), workspaceToolCall: vi.fn(async () => ({ entries: [] })) }
  const target = new AcpVirtualHarness(client, { deviceId: 'host', name: 'Host' }, backend)
  const signal = new AbortController().signal
  const scope = `${backend}:saved`
  try {
    const args = { workspaceFileScopeId: scope, path: '.' }
    expect(await target.dispatch('workspaceFiles/list', { args }, signal)).toMatchObject({ ok: true })
    expect(client.workspaceToolCall).toHaveBeenCalledWith('saved', backend, 'workspaceFiles/list', args, signal)
    await target.open('terminal/follow', { args: { agentId: scope, id: 'term', attachmentId: 'attachment' } }, signal)
    expect(client.openStream).toHaveBeenLastCalledWith('saved', expect.any(Function), expect.any(Function), signal,
      { backend, endpoint: 'terminal/follow', args: { agentId: scope, id: 'term', attachmentId: 'attachment' } })
  } finally { await target.close() }
})
