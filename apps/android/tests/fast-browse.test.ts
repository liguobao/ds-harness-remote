import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type { AppState, StoreAccess } from '../src/state/store-state'
import type { HistoryEntry, RemoteSession } from '../src/types'
import { backendGroups, browseStatus } from '../src/lib/backend-groups'
import { foldHistory } from '../src/state/event-reducer'

const { client, proxy } = vi.hoisted(() => ({
  client: { request: vi.fn(), subscribe: vi.fn(), configureHistory: vi.fn() },
  proxy: { sessionHistory: vi.fn(), messageFeedbackList: vi.fn(), sessionPrompt: vi.fn() },
}))
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: 'light' } }))
vi.mock('../src/services/storage', () => ({ loadCodexPermissionPresets: async () => ({}), saveCodexPermissionPreset: vi.fn(), saveRecentWorkspaces: vi.fn() }))
vi.mock('../src/services/remote-runtime', () => ({ AndroidRemoteRuntime: class {
  async configureHistory(value: boolean) { await client.configureHistory(value) }
  requireCodex() { return client }
  requireProxy() { return proxy }
} }))
import { SessionRuntime } from '../src/state/session-runtime'
import { createSessionActions } from '../src/state/session-actions'
import { createPromptActions } from '../src/state/prompt-actions'
import { saveCodexPermissionPreset } from '../src/services/storage'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const thread = (id: string) => ({ id, cwd: '/fixture', name: id, createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] })
const session = (id: string, codex = true): RemoteSession => ({ sessionId: codex ? `codex:${id}` : id, nativeId: id,
  backend: codex ? 'codex' : 'harness', updatedAt: 1, running: false, blank: false,
  projections: { values: { remoteStatusKnown: true, codexStatus: 'idle' } } })
const event = (seq: number): HistoryEntry => ({ event: { type: 'assistant/message', seq, time: seq * 1000,
  data: { turn: seq, message: { id: `m${seq}`, content: [{ type: 'text', text: `message ${seq}` }] } } } })
const page = (id: string, seqs = [20], hasMore = false) => ({ header: { id: `codex:${id}` },
  records: seqs.map(seq => ({ type: 'event', ...event(seq) })), hasMore })
let state: AppState, runtime: SessionRuntime, access: StoreAccess
function prepareScenario() {
  vi.resetAllMocks()
  state = { connection: { phase: 'connected' }, selectedDevice: { deviceId: 'host' }, sessions: [], messages: {},
    sessionLifecycles: {}, feedbackBySession: {}, currentWorkSessionIds: [], historyHasMore: false, historyLoadingOlder: false,
    handleCodexFrame: vi.fn(), reconnect: vi.fn(async () => false) } as unknown as AppState
  access = { get: () => state, set: change => { state = { ...state, ...(typeof change === 'function' ? change(state) : change) } } }
  runtime = new SessionRuntime(access)
  runtime.rememberRecentWorkspace = vi.fn(async () => undefined)
  runtime.refreshCodexModels = vi.fn(async () => undefined)
  runtime.refreshSessionModels = vi.fn(async () => undefined)
  Object.assign(state, createSessionActions({ ...access, runtime }), createPromptActions({ ...access, runtime }))
  client.request.mockImplementation(async (method, args) => method === 'thread/read' ? { thread: thread(args.threadId) } : page(args.threadId))
  client.subscribe.mockImplementation(async () => ({ close: vi.fn(async () => undefined) }))
  proxy.messageFeedbackList.mockResolvedValue([])
  proxy.sessionHistory.mockResolvedValue({ events: [event(20)], hasMore: false })
}
beforeEach(prepareScenario)

describe('Codex permission inheritance', () => {
  const policy = (preset: string) => ({approvalPolicy: preset === 'danger-full-access' ? 'never' : 'on-request', sandbox: preset})
  async function openWithCachedPermission(preset: string) {
    const target = session('a')
    target.projections!.values!.permissions = {currentValue: preset}
    state.sessions = [target]
    expect(await state.openSession(target)).toBe(true)
  }

  it('inherits the Host permission when the phone cached a different preset', async () => {
    await runScenarios(['workspace-write', 'danger-full-access'].map(cached => ({name: cached, run: async () => {
      await openWithCachedPermission(cached)
      const original = cached === 'workspace-write' ? 'danger-full-access' : 'workspace-write'
      let effective = original
      client.request.mockImplementation(async (method, args) => {
        if (args.permissionPreset !== undefined) effective = args.permissionPreset
        if (method === 'thread/resume') return {thread: thread('a'), ...policy(effective)}
        return {turn: {id: 'next', status: 'inProgress'}}
      })
      client.request.mockClear()
      expect(await state.sendMessage('continue')).toBe('sent')
      expect(client.request.mock.calls.map(([method]) => method)).toEqual(['thread/resume', 'turn/start'])
      for (const [, args] of client.request.mock.calls) expect(args).not.toHaveProperty('permissionPreset')
      expect(effective).toBe(original)
      expect(state.selectedSession?.projections?.values?.permissions).toMatchObject({currentValue: original})
      expect(state.sessions[0]?.projections?.values?.permissions).toMatchObject({currentValue: original})
    }})), prepareScenario)
  })

  it('applies an explicit phone selection and inherits it on the following send', async () => {
    await runScenarios(['workspace-write', 'danger-full-access'].map(selected => ({name: selected, run: async () => {
      let effective = selected === 'workspace-write' ? 'danger-full-access' : 'workspace-write'
      await openWithCachedPermission(effective)
      client.request.mockImplementation(async (method, args) => {
        if (args.permissionPreset !== undefined) effective = args.permissionPreset
        if (method === 'thread/resume') return {thread: thread('a'), ...policy(effective)}
        return {turn: {id: 'next', status: 'inProgress'}}
      })
      client.request.mockClear()
      expect(await state.selectPermission(selected)).toBe(true)
      expect(client.request).toHaveBeenCalledWith('thread/resume', {threadId: 'a', permissionPreset: selected})
      expect(saveCodexPermissionPreset).toHaveBeenCalledWith('host', 'a', selected)
      expect(await state.sendMessage('continue')).toBe('sent')
      expect(client.request.mock.calls.filter(([, args]) => args.permissionPreset !== undefined)).toHaveLength(1)
      expect(effective).toBe(selected)
      expect(state.selectedSession?.projections?.values?.permissions).toMatchObject({currentValue: selected})
    }})), prepareScenario)
  })
})

describe('fast browsing without changing writer ownership', () => {
  it('reconfigures global history mode before reads and invalidates pagination across mode changes', async () => {
    const target = session('a')
    state.compactHistory = false
    await state.openSession(target)
    state.messages[target.sessionId] = foldHistory([event(1), event(20)], target.sessionId, true)
    state.oldestLoadedSeq = 1
    state.historyHasMore = true
    state.compactHistory = true
    const configure = deferred<void>()
    client.configureHistory.mockReturnValueOnce(configure.promise)
    const previousReads = client.request.mock.calls.length
    const opening = state.openSession(target)
    await tick()
    expect(client.request.mock.calls).toHaveLength(previousReads)
    configure.resolve()
    expect(await opening).toBe(true)
    expect(state.messages[target.sessionId]?.map(item => item.id)).toEqual(['m20'])
    expect(state.oldestLoadedSeq).toBe(20)
    expect(state.historyHasMore).toBe(false)
    state.compactHistory = false
    expect(await state.openSession(target)).toBe(true)
    expect(client.configureHistory.mock.calls).toEqual([[false], [true], [false]])
    expect(state.messages[target.sessionId]?.map(item => item.id)).toEqual(['m20'])
  })

  it('shows cached content synchronously and reads while previous unsubscribe is blocked', async () => {
    const a = session('a'), oldClose = deferred<void>(), fresh = deferred<ReturnType<typeof page>>()
    state.sessions = [a]; state.messages[a.sessionId] = foldHistory([event(20)], a.sessionId, true)
    runtime.activeCodexStream = { close: vi.fn(() => oldClose.promise) } as never
    client.request.mockImplementation(async (method, args) => method === 'thread/read' ? { thread: thread(args.threadId) } : fresh.promise)
    const pending = state.openSession(a)
    expect(state.selectedSession?.sessionId).toBe(a.sessionId)
    expect(state.messages[a.sessionId]?.length).toBe(1)
    expect(await state.sendMessage('do not dispatch')).toBe('rejected')
    expect(proxy.sessionPrompt).not.toHaveBeenCalled()
    await tick()
    expect(client.request).toHaveBeenCalledWith('dsh/sessionHistory', { threadId: 'a', maxMessages: 16 }, expect.any(AbortSignal))
    fresh.resolve(page('a', [20, 21])); expect(await pending).toBe(true)
    expect(state.messages[a.sessionId]?.length).toBe(2)
    expect(client.request.mock.calls.map(c => c[0])).not.toContain('thread/resume')
    oldClose.resolve()
  })

  it('renders a cold history page before new subscription acknowledgement', async () => {
    const subscribe = deferred<{ close: () => Promise<void> }>()
    client.subscribe.mockReturnValue(subscribe.promise)
    const a = session('a'), pending = state.openSession(a)
    expect(state.selectedSession?.sessionId).toBe(a.sessionId)
    await tick()
    expect(state.messages[a.sessionId]?.length).toBe(1)
    expect(state.busyAction).toBe(`session:${a.sessionId}`)
    expect(await state.sendMessage('not yet')).toBe('rejected')
    subscribe.resolve({ close: async () => undefined }); expect(await pending).toBe(true)
    expect(state.busyAction).toBeUndefined()
  })

  it.each(['success', 'failure'] as const)('ignores retired history %s after A to B switching', async outcome => {
    const delayed = deferred<ReturnType<typeof page>>(), a = session('a'), b = session('b')
    client.request.mockImplementation(async (method, args) => method === 'thread/read' ? { thread: thread(args.threadId) }
      : args.threadId === 'a' ? delayed.promise : page('b'))
    const openingA = state.openSession(a); await tick()
    const signal = client.request.mock.calls.find(c => c[0] === 'dsh/sessionHistory')![2] as AbortSignal
    expect(await state.openSession(b)).toBe(true)
    expect(signal.aborted).toBe(true)
    if (outcome === 'success') delayed.resolve(page('a')); else delayed.reject(new Error('late failure'))
    expect(await openingA).toBe(false)
    expect(state.selectedSession?.sessionId).toBe(b.sessionId)
    expect(state.messages[a.sessionId]).toBeUndefined()
    expect(state.error).toBeUndefined()
    expect(client.subscribe.mock.calls.map(c => c[0])).toEqual(['b'])
  })

  it('closes a late obsolete subscription without closing the current subscription', async () => {
    const delayed = deferred<{ close: () => Promise<void> }>(), oldClose = vi.fn(async () => undefined), newClose = vi.fn(async () => undefined)
    client.subscribe.mockImplementation(async id => id === 'a' ? delayed.promise : { close: newClose })
    const a = state.openSession(session('a')); await tick()
    expect(await state.openSession(session('b'))).toBe(true)
    delayed.resolve({ close: oldClose }); expect(await a).toBe(false)
    expect(oldClose).toHaveBeenCalledOnce(); expect(newClose).not.toHaveBeenCalled()
    expect(runtime.activeCodexStream?.close).toBe(newClose)
  })

  it('rejects sends after subscription failure until the same session is reopened successfully', async () => {
    const a = session('a')
    client.subscribe.mockRejectedValueOnce(Object.assign(new Error('Too many Codex streams'), { code: 'RATE_LIMITED' }))
    expect(await state.openSession(a)).toBe(false)
    expect(state.selectedSession?.sessionId).toBe(a.sessionId)
    expect(state.messages[a.sessionId]?.length).toBe(1)
    expect(state.busyAction).toBeUndefined()
    expect(state.codexReadySessionId).toBeUndefined()
    const beforeSend = state.messages[a.sessionId]
    client.request.mockClear()
    expect(await state.sendMessage('must not start unseen work')).toBe('rejected')
    expect(client.request).not.toHaveBeenCalled()
    expect(state.messages[a.sessionId]).toBe(beforeSend)
    expect(await state.openSession(a)).toBe(true)
    expect(state.codexReadySessionId).toBe(a.sessionId)
    expect(await state.sendMessage('now subscribed')).toBe('sent')
    expect(client.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ threadId: 'a' }))
    const onClose = client.subscribe.mock.calls.at(-1)![3] as (reason: string) => void
    onClose('failed')
    expect(state.codexReadySessionId).toBeUndefined()
    client.request.mockClear()
    expect(await state.sendMessage('stream closed')).toBe('rejected')
    expect(client.request).not.toHaveBeenCalled()
  })


  it.each([true, false])('keeps cached pagination only with overlapping history: %s', async overlap => {
    const a = session('a'), b = session('b')
    state.selectedSession = a; state.sessions = [a, b]
    state.messages[a.sessionId] = foldHistory([event(1), event(20)], a.sessionId, true)
    state.oldestLoadedSeq = 1; state.historyHasMore = false
    await state.openSession(b)
    client.request.mockImplementation(async (method, args) => method === 'thread/read' ? { thread: thread(args.threadId) } : page('a', overlap ? [20, 21] : [40, 41], true))
    await state.openSession(a)
    expect(state.oldestLoadedSeq).toBe(overlap ? 1 : 40)
    expect(state.historyHasMore).toBe(!overlap)
    expect(state.messages[a.sessionId]?.length).toBe(overlap ? 3 : 2)
    if (!overlap) {
      client.request.mockResolvedValueOnce(page('a', [30, 31], true))
      await state.loadOlderHistory()
      expect(state.oldestLoadedSeq).toBe(30)
      expect(state.messages[a.sessionId]?.length).toBe(4)
    }
  })

  it.each(['success', 'failure'] as const)('discards older-page %s after changing host generation', async outcome => {
    const a = session('a'), delayed = deferred<ReturnType<typeof page>>()
    state.selectedSession = a; state.oldestLoadedSeq = 20; state.historyHasMore = true
    client.request.mockReturnValue(delayed.promise)
    const pending = state.loadOlderHistory()
    runtime.connectionGeneration++
    state.selectedDevice = { deviceId: 'another-host' } as never
    state.messages = {}; state.historyLoadingOlder = false; state.error = 'new host'
    if (outcome === 'success') delayed.resolve(page('a', [1])); else delayed.reject(new Error('old host'))
    await pending
    expect(state.messages).toEqual({}); expect(state.error).toBe('new host')
    expect(state.historyLoadingOlder).toBe(false)
  })

  it('DSH switches without waiting for Codex unsubscribe, and remains send-blocked until fresh history', async () => {
    const old = deferred<void>(), history = deferred<{ events: HistoryEntry[]; hasMore: boolean }>()
    runtime.activeCodexStream = { close: () => old.promise } as never
    proxy.sessionHistory.mockReturnValue(history.promise)
    const a = session('dsh', false), pending = state.openSession(a)
    expect(state.selectedSession?.sessionId).toBe('dsh')
    await tick()
    expect(proxy.sessionHistory).toHaveBeenCalled()
    expect(await state.sendMessage('not yet')).toBe('rejected')
    history.resolve({ events: [event(20)], hasMore: false }); expect(await pending).toBe(true)
    expect(state.messages.dsh?.length).toBe(1); old.resolve()
  })

  it('recovers a read timeout only once with a new abort scope', async () => {
    const a = session('a'), timeout = Object.assign(new Error('RPC timed out'), { code: 'RPC_TIMEOUT' })
    client.request.mockRejectedValue(timeout)
    state.reconnect = vi.fn(async () => { runtime.connectionGeneration++; runtime.sessionLoadGeneration++; runtime.sessionReadAbort?.abort(); return true })
    expect(await state.openSession(a)).toBe(false)
    expect(state.reconnect).toHaveBeenCalledTimes(1)
    expect(state.error).toBeDefined()
  })

  it('does not reopen an abandoned conversation after a delayed reconnect', async () => {
    const reconnect = deferred<boolean>(), timeout = Object.assign(new Error('RPC timed out'), { code: 'RPC_TIMEOUT' })
    client.request.mockRejectedValue(timeout)
    state.reconnect = vi.fn(() => reconnect.promise)
    const old = state.openSession(session('a')); await tick()
    expect(state.reconnect).toHaveBeenCalledOnce()
    client.request.mockImplementation(async (method, args) => method === 'thread/read' ? { thread: thread(args.threadId) } : page(args.threadId))
    expect(await state.openSession(session('b'))).toBe(true)
    reconnect.resolve(true); expect(await old).toBe(false)
    expect(state.selectedSession?.sessionId).toBe('codex:b')
    expect(client.subscribe.mock.calls.map(c => c[0])).toEqual(['b'])
  })
})

describe('backend separated conversation drawer', () => {
  it('isolates same-named workspaces, unassigned sessions and recent lists', () => {
    const c = session('c'), active = { ...session('active'), running: true }, unknown = { ...session('unknown'), running: true, projections: {values: {remoteStatusKnown: false}} }
    const h = session('h', false), loose = session('loose', false), archived = session('archived')
    const input = { workspaces: [
      { workspaceId: 'same', title: 'Same name', backend: 'codex' as const, path: '/same', sessionIds: [c.sessionId, active.sessionId, unknown.sessionId, archived.sessionId], createdAt: '', updatedAt: '' },
      { workspaceId: 'same', title: 'Same name', backend: 'harness' as const, path: '/same', sessionIds: [h.sessionId], createdAt: '', updatedAt: '' },
    ], sessions: [c, active, unknown, h, loose, archived], archived: [archived.sessionId], recent: [h.sessionId, c.sessionId, unknown.sessionId], lifecycles: {} }
    const codex = backendGroups({ ...input, backend: 'codex' })
    expect(codex.flatMap(g => g.sessions).every(s => s.backend === 'codex')).toBe(true)
    expect(codex.flatMap(g => g.sessions)).not.toContain(archived)
    expect(codex.find(g => g.key === 'recent:codex')?.sessions.map(s => s.sessionId)).toEqual([unknown.sessionId, c.sessionId])
    const harness = backendGroups({ ...input, backend: 'harness' })
    expect(harness.flatMap(g => g.sessions).every(s => s.backend === 'harness')).toBe(true)
    expect(harness.find(g => g.key === 'unassigned:harness')?.sessions).toEqual([loose])
    expect(browseStatus({...unknown, projections: {values: {remoteStatusKnown: false}}}, { running: false })).toBe('unknown')
    expect(browseStatus(h, { running: true })).toBe('running')
  })
})
