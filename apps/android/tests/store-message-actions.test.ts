import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, RemoteSession } from '../src/types'

const { proxy } = vi.hoisted(() => ({ proxy: {
  sessionHistory: vi.fn(), messageFeedbackList: vi.fn(), sessionModels: vi.fn(),
  sessionExecuteCommand: vi.fn(), messageFeedbackPut: vi.fn(),
} }))
vi.mock('expo-haptics', () => ({}))
vi.mock('../src/services/network-route', () => ({}))
vi.mock('../src/services/connection', () => ({ AndroidRemoteConnection: class { requireProxy() { return proxy } } }))
vi.mock('../src/services/storage', () => ({ saveRecentWorkspaces: vi.fn() }))
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: {} }))
import { useAppStore } from '../src/state/store'

const session = { sessionId: 's1', backend: 'harness' } as RemoteSession
const cached = (id: string, feedback: 'positive' | 'negative'): ChatMessage => ({
  kind: 'message', sessionId: 's1', id, role: 'assistant', text: 'live', createdAt: 1, feedback,
})
const page = (id: string, seq: number, hasMore = false) => ({ hasMore, events: [{ event: {
  type: 'assistant/message', seq, time: 1, data: { message: { id, content: [{ type: 'text', text: 'history' }] } },
} }] })
beforeEach(() => {
  vi.resetAllMocks()
  useAppStore.setState({ ...useAppStore.getInitialState(), selectedSession: session })
  proxy.sessionHistory.mockResolvedValue(page('new', 10, true))
  proxy.messageFeedbackList.mockResolvedValue([{ messageId: 'new', rating: 'negative' }, { messageId: 'old', rating: 'positive' }])
})
describe('store authoritative feedback', () => {
  it('applies the official rating after merging a stale live cache and retains it for pagination', async () => {
    useAppStore.setState({ messages: { s1: [cached('new', 'positive')] } })
    expect(await useAppStore.getState().openSession(session)).toBe(true)
    expect(useAppStore.getState().messages.s1![0]).toMatchObject({ text: 'live', feedback: 'negative' })
    proxy.sessionHistory.mockResolvedValueOnce(page('old', 1))
    await useAppStore.getState().loadOlderHistory()
    expect(useAppStore.getState().messages.s1![0]).toMatchObject({ id: 'old', feedback: 'positive' })
  })
  it('clears absent ratings on successful list, including older pages', async () => {
    proxy.messageFeedbackList.mockResolvedValueOnce([])
    useAppStore.setState({ messages: { s1: [cached('new', 'positive'), cached('old', 'negative')] } })
    await useAppStore.getState().openSession(session)
    expect(useAppStore.getState().messages.s1!.every(item => item.kind !== 'message' || item.feedback === undefined)).toBe(true)
    proxy.sessionHistory.mockResolvedValueOnce(page('old', 1))
    await useAppStore.getState().loadOlderHistory()
    expect(useAppStore.getState().messages.s1!.find(item => item.id === 'old')).toMatchObject({ feedback: undefined })
  })
  it('preserves cached ratings when an older host cannot list feedback', async () => {
    proxy.messageFeedbackList.mockRejectedValueOnce(new Error('UNSUPPORTED'))
    useAppStore.setState({ messages: { s1: [cached('new', 'positive')] } })
    expect(await useAppStore.getState().openSession(session)).toBe(true)
    expect(useAppStore.getState().messages.s1![0]).toMatchObject({ feedback: 'positive' })
  })
})

describe('feedback pagination updates', () => {
  it('retains a newly saved rating when paging with the session feedback map', async () => {
    await useAppStore.getState().openSession(session)
    useAppStore.setState({ connection: { phase: 'connected' } as never })
    proxy.messageFeedbackPut.mockResolvedValueOnce({ rating: 'positive' })
    expect(await useAppStore.getState().rateMessage(useAppStore.getState().messages.s1![0] as ChatMessage, 'positive')).toBe(true)
    proxy.sessionHistory.mockResolvedValueOnce(page('old', 1))
    await useAppStore.getState().loadOlderHistory()
    expect(useAppStore.getState().messages.s1!.find(item => item.id === 'new')).toMatchObject({ feedback: 'positive' })
  })
  it('does not publish another session pagination state when an earlier page finishes late', async () => {
    await useAppStore.getState().openSession(session)
    let finish!: (value: ReturnType<typeof page>) => void
    proxy.sessionHistory.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const loading = useAppStore.getState().loadOlderHistory()
    await useAppStore.getState().openSession({ ...session, sessionId: 's2' })
    finish(page('old', 1))
    await loading
    expect(useAppStore.getState()).toMatchObject({ selectedSession: { sessionId: 's2' }, historyHasMore: true, oldestLoadedSeq: 10, historyLoadingOlder: false })
  })
})

describe('store slash command results', () => {
  it.each([undefined, '', '  '])('does not expose an empty success result (%s)', async text => {
    useAppStore.setState({ commandResult: { sessionId: 's1', text: 'stale result' } })
    proxy.sessionExecuteCommand.mockResolvedValueOnce({ kind: 'success', text })
    expect(await useAppStore.getState().sendMessage('/compact')).toBe(true)
    expect(useAppStore.getState().commandResult).toBeUndefined()
    expect(useAppStore.getState().messages).toEqual({})
  })
  it('returns false on a command error so the composer can restore input', async () => {
    proxy.sessionExecuteCommand.mockResolvedValueOnce({ kind: 'error', text: 'Command refused' })
    expect(await useAppStore.getState().sendMessage('/compact')).toBe(false)
    expect(useAppStore.getState().error).toContain('Command refused')
    expect(useAppStore.getState().commandResult).toBeUndefined()
    expect(useAppStore.getState().messages).toEqual({})
  })
  it('exposes successful text separately without fabricating a chat message', async () => {
    proxy.sessionExecuteCommand.mockResolvedValueOnce({ kind: 'success', text: 'Export saved to /tmp/result.md' })
    expect(await useAppStore.getState().sendMessage('/export')).toBe(true)
    expect(useAppStore.getState()).toMatchObject({ commandResult: { sessionId: 's1', text: 'Export saved to /tmp/result.md' }, messages: {} })
  })
})
