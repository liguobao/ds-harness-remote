import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, HistoryEntry, MuxStreamFrame, RemoteSession } from '../src/types'
import { applyMuxFrame, foldHistory } from '../src/state/event-reducer'
import { mergeHistoryAndLive, prependHistory } from '../src/state/message-helpers'

const { proxy, transport, storage, authenticate, acp } = vi.hoisted(() => ({
  proxy: { sessionHistory: vi.fn(), messageFeedbackList: vi.fn(), sessionModels: vi.fn(),
    sessionList: vi.fn(), hostDescribe: vi.fn(), workspaceList: vi.fn(), sessionSelectPermission: vi.fn() },
  transport: { connect: vi.fn(), close: vi.fn(), hasCursor: vi.fn(), hasAntigravity: vi.fn() },
  acp: { call: vi.fn(), transferCall: vi.fn(), openStream: vi.fn() },
  storage: { saveRecentWorkspaces: vi.fn(), saveLastConnectedDeviceId: vi.fn(), loadCodexPermissionPresets: vi.fn() },
  authenticate: vi.fn(),
}))
vi.mock('expo-haptics', () => ({}))
vi.mock('../src/services/network-route', () => ({ resolveAutomaticPreferredTransports: async () => ['relay'] }))
vi.mock('../src/services/connection', () => ({ AndroidRemoteConnection: class {
  requireProxy() { return proxy }
  connect = transport.connect
  close = transport.close
  hasCodex() { return false }
  hasCursor = transport.hasCursor
  hasAntigravity = transport.hasAntigravity
  requireCursor() { return acp }
  requireAntigravity() { return acp }
  getNetworkDetails() { return Promise.resolve(undefined) }
  getStats() { return { mode: 'Relay', connected: true } }
} }))
vi.mock('../src/services/storage', () => storage)
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate } }))
import { useAppStore } from '../src/state/store'

const session: RemoteSession = { sessionId: 's1', updatedAt: 1, running: false, blank: false,
  projections: { values: { permissions: { currentValue: 'default' } } } }
const entry = (type: string, seq: number, data: Record<string, unknown>): HistoryEntry => ({
  event: { type, seq, time: 1000 + seq, data },
})
const call = (seq = 2, turn = 1, callId = 'c1') => entry('tool/call', seq, { turn, callId, name: 'bash' })
const result = (seq = 3, turn = 1, callId = 'c1') => entry('tool/result', seq, { turn, message: { source: { callId }, content: [] } })
const frame = (row: HistoryEntry): MuxStreamFrame => ({ rpcId: '', payload: { type: 'session/event', sessionId: 's1', event: row.event } })
const page = (events: HistoryEntry[], throughSeq = 10) => ({ events, throughSeq, hasMore: false })

beforeEach(() => {
  vi.resetAllMocks()
  transport.hasCursor.mockReturnValue(false)
  transport.hasAntigravity.mockReturnValue(false)
  acp.call.mockResolvedValue([])
  acp.transferCall.mockResolvedValue({ events: [] })
  acp.openStream.mockImplementation(async () => ({ streamId: 'acp-test', close: vi.fn(async () => undefined) }))
  useAppStore.setState({ ...useAppStore.getInitialState(), selectedSession: session, sessions: [session],
    connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } } })
  proxy.sessionHistory.mockResolvedValue(page([]))
  proxy.messageFeedbackList.mockResolvedValue([])
  proxy.sessionList.mockResolvedValue([session])
  proxy.workspaceList.mockResolvedValue({ items: [], archivedSessionIds: [] })
  proxy.hostDescribe.mockResolvedValue({})
  storage.loadCodexPermissionPresets.mockResolvedValue({})
  authenticate.mockResolvedValue({ api: {}, credentials: { accessToken: 'synthetic' } })
})

describe('ordered history recovery', () => {
  it('does not overwrite a completed history tool with its older running cache', () => {
    const live = foldHistory([call()], 's1')
    const history = foldHistory([call(), result()], 's1')
    expect(mergeHistoryAndLive(history, live)).toMatchObject([{ state: 'finished', nativeSeq: 3 }])
  })
  it('preserves a live result newer than the snapshot and rejects an older replayed call', () => {
    const history = foldHistory([call()], 's1')
    const live = foldHistory([call(), result()], 's1')
    expect(mergeHistoryAndLive(history, live)).toMatchObject([{ state: 'finished' }])
    expect(applyMuxFrame(live, frame(call()))).toEqual(live)
  })
  it('retains tool position and owner when a delayed result arrives in a later turn', () => {
    const rows = [call(), entry('user/message', 5, { turn: 2, message: { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] } }), result(6, 2)]
    expect(foldHistory(rows, 's1')[0]).toMatchObject({ turn: '1', nativeOrderSeq: 2, nativeSeq: 6 })
  })
  it('inserts cached older rows before new history instead of appending them after the answer', () => {
    const older = foldHistory([call()], 's1')
    const newer = foldHistory([call(20, 2, 'c2')], 's1')
    expect(mergeHistoryAndLive(newer, older).map(item => item.id)).toEqual(['c1', 'c2'])
  })
  it('drops covered transient streams but keeps new deltas beyond the snapshot cursor', () => {
    const chunk = (seq: number) => entry('assistant/chunk', seq, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'partial' } })
    expect(mergeHistoryAndLive([], foldHistory([chunk(2.5)], 's1'), 10)).toEqual([])
    expect(mergeHistoryAndLive([], foldHistory([chunk(11.5)], 's1'), 10)).toHaveLength(1)
  })
  it('settles closed turns without claiming a missing tool result succeeded', () => {
    const rows = [call(), entry('assistant/chunk', 4, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'partial' } }), entry('turn/end', 5, { turn: 1 })]
    expect(foldHistory(rows, 's1')).toMatchObject([{ state: 'failed' }, { streaming: false }])
  })
  it('recovers a missing older result during pagination without replaying a stale stream', () => {
    const incomplete = foldHistory([call(), entry('turn/end', 5, { turn: 1 })], 's1')
    expect(prependHistory(foldHistory([call(), result()], 's1'), incomplete)).toMatchObject([{ state: 'finished' }])
    const stream = foldHistory([entry('assistant/chunk', 10, { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'a' } }),
      entry('assistant/chunk', 10.5, { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'b' } })], 's1')
    expect(mergeHistoryAndLive([], stream, 10)).toMatchObject([{ text: 'ab' }])
  })
  it('does not close current-turn tools when an earlier turn ends', () => {
    expect(foldHistory([call(2, 1), call(4, 2, 'c2'), entry('turn/end', 5, { turn: 1 })], 's1')).toMatchObject([{ state: 'failed' }, { state: 'running' }])
  })
})

describe('session restore state machine', () => {
  it('restores a closed turn from history and clears stale generating rows', async () => {
    useAppStore.setState({ selectedSession: { ...session, running: true }, sessions: [{ ...session, running: true }], messages: { s1: foldHistory([call()], 's1') } })
    proxy.sessionHistory.mockResolvedValue(page([call(), result(), entry('turn/end', 4, { turn: 1 })]))
    expect(await useAppStore.getState().openSession({ ...session, running: true })).toBe(true)
    expect(useAppStore.getState().selectedSession?.running).toBe(false)
    expect(useAppStore.getState().messages.s1).toMatchObject([{ state: 'finished' }])
  })
  it('keeps live lifecycle events newer than the snapshot', async () => {
    proxy.sessionHistory.mockImplementation(async () => {
      useAppStore.getState().handleMuxFrame(frame(entry('turn/start', 11, { turn: 2 })))
      useAppStore.getState().handleMuxFrame(frame(call(12, 2, 'c2')))
      return page([entry('turn/end', 10, { turn: 1 })])
    })
    await useAppStore.getState().openSession(session)
    expect(useAppStore.getState().selectedSession?.running).toBe(true)
    expect(useAppStore.getState().messages.s1).toMatchObject([{ state: 'running', turn: '2' }])
  })
  it('ignores an earlier session load completing after a later navigation', async () => {
    let finish!: (value: ReturnType<typeof page>) => void
    proxy.sessionHistory.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const old = useAppStore.getState().openSession(session)
    await vi.waitFor(() => expect(proxy.sessionHistory).toHaveBeenCalled())
    const next = { ...session, sessionId: 's2' }
    expect(await useAppStore.getState().openSession(next)).toBe(true)
    finish(page([call()]))
    expect(await old).toBe(false)
    expect(useAppStore.getState().selectedSession?.sessionId).toBe('s2')
  })
  it('restores the selected conversation once for overlapping reconnect requests', async () => {
    useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
    const first = useAppStore.getState().reconnect()
    const second = useAppStore.getState().reconnect()
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(transport.connect).toHaveBeenCalledTimes(1)
    expect(proxy.sessionHistory).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().selectedSession?.sessionId).toBe('s1')
  })
  it.each(['cursor', 'antigravity'] as const)('restores %s once for overlapping reconnects and respects restoreSession=false', async backend => {
    const selected = { ...session, sessionId: `${backend}:native-session`, nativeId: 'native-session', backend }
    useAppStore.setState({ selectedSession: selected, sessions: [selected],
      selectedDevice: { deviceId: 'host' } as never, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
    transport.hasCursor.mockReturnValue(backend === 'cursor')
    transport.hasAntigravity.mockReturnValue(backend === 'antigravity')
    const first = useAppStore.getState().reconnect()
    const second = useAppStore.getState().reconnect()
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(transport.connect).toHaveBeenCalledTimes(1)
    expect(acp.openStream).toHaveBeenCalledTimes(1)
    expect(acp.transferCall).toHaveBeenCalledTimes(backend === 'antigravity' ? 1 : 0)
    expect(await useAppStore.getState().reconnect({ restoreSession: false })).toBe(true)
    expect(acp.openStream).toHaveBeenCalledTimes(1)
    expect(acp.transferCall).toHaveBeenCalledTimes(backend === 'antigravity' ? 1 : 0)
  })
  it('does not let an older turn-start reopen a completed turn', () => {
    useAppStore.getState().handleMuxFrame(frame(entry('turn/end', 20, { turn: 1 })))
    useAppStore.getState().handleMuxFrame(frame(entry('turn/start', 10, { turn: 1 })))
    expect(useAppStore.getState().selectedSession?.running).toBe(false)
  })
})

describe('authoritative permission projection', () => {
  const projection = (value: string, seq: number): MuxStreamFrame => ({ rpcId: '', payload: { type: 'session/projection', sessionId: 's1', key: 'permissions', value: { currentValue: value }, seq } })
  it('updates the selected session and rejects older permission projections', () => {
    useAppStore.getState().handleMuxFrame(projection('read-only', 20))
    useAppStore.getState().handleMuxFrame(projection('default', 10))
    expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({ currentValue: 'read-only' })
  })
  it('reads back a successful permission change from the Host', async () => {
    proxy.sessionList.mockResolvedValue([{ ...session, projections: { values: { permissions: { currentValue: 'read-only' } } } }])
    expect(await useAppStore.getState().selectPermission('read-only')).toBe(true)
    expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({ currentValue: 'read-only' })
  })
  it('does not invent a grant when the command succeeded but the Host did not confirm it', async () => {
    expect(await useAppStore.getState().selectPermission('full-access')).toBe(false)
    expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({ currentValue: 'default' })
  })
})
