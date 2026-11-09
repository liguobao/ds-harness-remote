import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ChatMessage, HistoryEntry, RemoteSession } from '../src/types'
import { browseKey, browseScope, saveSessionMessagesSnapshot, useBrowseMemory } from '../src/services/browse-memory'

const { proxy, transport, storage, authenticate, acp, codex } = vi.hoisted(() => ({
  proxy: {
    sessionHistory: vi.fn(), messageFeedbackList: vi.fn(), sessionModels: vi.fn(),
    sessionList: vi.fn(), sessionCreate: vi.fn(), hostDescribe: vi.fn(), workspaceList: vi.fn(),
    workspaceArchiveSession: vi.fn(), sessionSelectPermission: vi.fn(), sessionPrompt: vi.fn(), sessionUpdateQueue: vi.fn(),
  },
  transport: {
    connect: vi.fn(), close: vi.fn(), checkHealth: vi.fn(), refreshBackends: vi.fn(),
    hasCodex: vi.fn(), hasCursor: vi.fn(), hasAntigravity: vi.fn(), hasPi: vi.fn(),
    hasOpencode: vi.fn(), hasClaude: vi.fn(), hasHermes: vi.fn(), requireClaude: vi.fn(), requireHermes: vi.fn(),
  },
  acp: {
    call: vi.fn(), transferCall: vi.fn(), openStream: vi.fn(), prompt: vi.fn(),
    sessionModels: vi.fn(), selectModel: vi.fn(), archiveSession: vi.fn(), createSession: vi.fn(),
  },
  storage: {
    saveRecentWorkspaces: vi.fn(), saveLastConnectedDeviceId: vi.fn(), loadCodexPermissionPresets: vi.fn(), saveCodexPermissionPreset: vi.fn(),
  },
  codex: { request: vi.fn(), subscribe: vi.fn() },
  authenticate: vi.fn(),
}))

vi.mock('expo-haptics', () => ({ impactAsync: async () => undefined, ImpactFeedbackStyle: { Light: 'light' } }))
vi.mock('../src/services/network-route', () => ({ resolveAutomaticPreferredTransports: async () => ['relay'] }))
vi.mock('../src/services/connection', () => ({
  AndroidRemoteConnection: class {
    async configureHistory() {}
    requireProxy() { return proxy }
    connect = transport.connect
    close = transport.close
    checkHealth = transport.checkHealth
    refreshBackends = transport.refreshBackends
    hasCodex = transport.hasCodex
    requireCodex() { return codex }
    hasCursor = transport.hasCursor
    hasPi = transport.hasPi
    hasAntigravity = transport.hasAntigravity
    hasOpencode = transport.hasOpencode
    hasClaude = transport.hasClaude
    hasHermes = transport.hasHermes
    requireCursor() { return acp }
    requireAntigravity() { return acp }
    requirePi() { return acp }
    requireOpencode() { return acp }
    requireClaude() { transport.requireClaude(); return acp }
    requireHermes() { transport.requireHermes(); return acp }
    getNetworkDetails() { return Promise.resolve(undefined) }
    getStats() { return { mode: 'Relay', connected: true } }
  },
}))
vi.mock('../src/services/storage', () => storage)
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate } }))

import { useAppStore } from '../src/state/store'

const harnessSession: RemoteSession = {
  sessionId: 's-harness', backend: 'harness', updatedAt: 10, running: false, blank: false,
}

const hermesSession: RemoteSession = {
  sessionId: 'hermes:s-hermes', nativeId: 's-hermes', backend: 'hermes', updatedAt: 20, running: false, blank: false,
}

const codexSession: RemoteSession = {
  sessionId: 'codex:s-codex', nativeId: 's-codex', backend: 'codex', updatedAt: 30, running: false, blank: false,
}

const cachedMsg: ChatItem = {
  id: 'cached-1', sessionId: 's-harness', kind: 'message', role: 'assistant', text: 'Cached offline message', createdAt: 1000,
}

describe('Session Instant Open & Flicker-free Realignment', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    transport.checkHealth.mockResolvedValue(true)
    transport.hasCodex.mockReturnValue(true)
    transport.hasHermes.mockReturnValue(true)
    acp.openStream.mockResolvedValue({ streamId: 'stream-1', close: async () => undefined })
    codex.subscribe.mockResolvedValue({ streamId: 'codex-stream-1', close: async () => undefined })
    proxy.sessionList.mockResolvedValue([harnessSession])
    proxy.workspaceList.mockResolvedValue({ items: [], archivedSessionIds: [] })
    proxy.hostDescribe.mockResolvedValue({})
    storage.loadCodexPermissionPresets.mockResolvedValue({})
    useBrowseMemory.setState({
      entries: {}, catalogs: {}, hostModes: {}, resume: false, notifications: true, autoConnectHost: true, ready: true,
    })
    useAppStore.setState({
      ...useAppStore.getInitialState(),
      selectedDevice: { deviceId: 'dev-1', identityKey: 'key-1' } as never,
      config: { baseUrl: 'https://example.com', account: 'test' },
      sessions: [harnessSession, hermesSession, codexSession],
      connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
    })
  })

  it('instant open in offline/disconnected mode renders cached messages immediately and enables read-only', async () => {
    const store = useAppStore.getState()
    const scope = browseScope(store)
    saveSessionMessagesSnapshot(scope, 's-harness', [cachedMsg])

    useAppStore.setState({
      connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } },
      selectedSession: undefined,
      messages: {},
    })

    const opened = await useAppStore.getState().openSession(harnessSession)
    expect(opened).toBe(true)

    const state = useAppStore.getState()
    expect(state.selectedSession?.sessionId).toBe('s-harness')
    expect(state.messages['s-harness']).toBeDefined()
    expect(state.messages['s-harness']).toHaveLength(1)
    expect((state.messages['s-harness']![0] as ChatMessage).text).toBe('Cached offline message')
    expect(state.busyAction).toBeUndefined()
  })

  it('connected Harness openSession retains existing/cached messages while authoritative history loads and in-place merges', async () => {
    let resolveHistory!: (val: unknown) => void
    const historyPromise = new Promise(resolve => { resolveHistory = resolve })
    proxy.sessionHistory.mockReturnValue(historyPromise)
    proxy.messageFeedbackList.mockResolvedValue([])

    const scope = browseScope(useAppStore.getState())
    saveSessionMessagesSnapshot(scope, 's-harness', [cachedMsg])

    useAppStore.setState({
      selectedSession: undefined,
      messages: {},
    })

    const openPromise = useAppStore.getState().openSession(harnessSession)

    // Synchronously, the cached message is already on screen (no white flash!)
    const intermediateState = useAppStore.getState()
    expect(intermediateState.selectedSession?.sessionId).toBe('s-harness')
    expect(intermediateState.messages['s-harness']).toBeDefined()
    expect((intermediateState.messages['s-harness']![0] as ChatMessage).text).toBe('Cached offline message')
    expect(intermediateState.busyAction).toBe('session:s-harness')

    // Authoritative history returns from Host
    const authEvent: HistoryEntry = {
      event: {
        type: 'user/message', seq: 2, time: 2000,
        data: { message: { role: 'user', content: [{ type: 'text', text: 'Authoritative prompt' }] } },
      },
    }
    resolveHistory({ events: [authEvent], throughSeq: 2, hasMore: false })
    const ok = await openPromise
    expect(ok).toBe(true)

    const finalState = useAppStore.getState()
    expect(finalState.busyAction).toBeUndefined()
    expect(finalState.messages['s-harness']).toBeDefined()
    // Authoritative message in-place replaced without gap
    expect(finalState.messages['s-harness']!.some(m => m.kind === 'message' && (m as ChatMessage).text.includes('Authoritative prompt'))).toBe(true)

    // Snapshot is updated in browse memory
    const cached = useBrowseMemory.getState().entries[browseKey(scope, 's-harness')]?.messages
    expect(cached).toBeDefined()
    expect(cached!.some(m => m.kind === 'message' && (m as ChatMessage).text.includes('Authoritative prompt'))).toBe(true)
  })

  it('ACP backend (Hermes) openSession preserves existing messages without clearing to []', async () => {
    let resolveAcpHistory!: (val: unknown) => void
    const acpHistoryPromise = new Promise(resolve => { resolveAcpHistory = resolve })
    acp.transferCall.mockReturnValue(acpHistoryPromise)

    const existingLiveMsg: ChatItem = {
      id: 'live-1', sessionId: 'hermes:s-hermes', kind: 'message', role: 'user', text: 'In flight hermes prompt', createdAt: 3000,
    }

    useAppStore.setState({
      selectedSession: hermesSession,
      messages: { 'hermes:s-hermes': [existingLiveMsg] },
    })

    const openPromise = useAppStore.getState().openSession(hermesSession)

    // The live message must NOT be cleared to [] while history is pending
    const intermediateState = useAppStore.getState()
    expect(intermediateState.messages['hermes:s-hermes']).toBeDefined()
    expect(intermediateState.messages['hermes:s-hermes']).toHaveLength(1)
    expect((intermediateState.messages['hermes:s-hermes']![0] as ChatMessage).text).toBe('In flight hermes prompt')

    // Resolve ACP history
    resolveAcpHistory({
      events: [
        {
          event: {
            type: 'user/message', seq: 1, time: 1000,
            data: { message: { role: 'user', content: [{ type: 'text', text: 'Old Hermes message' }] } },
          },
        },
      ],
    })

    await openPromise
    const finalState = useAppStore.getState()
    expect(finalState.messages['hermes:s-hermes']).toBeDefined()
    expect(finalState.messages['hermes:s-hermes']!.length).toBeGreaterThanOrEqual(1)
  })

  it('Codex backend openSession retains cached messages and merges in-place', async () => {
    let resolveCodexPage!: (val: unknown) => void
    const codexPagePromise = new Promise(resolve => { resolveCodexPage = resolve })
    const thread = { id: 's-codex', cwd: '/project', status: { type: 'active', activeFlags: [] }, createdAt: 1, updatedAt: 2 }
    codex.request.mockImplementation(async (method: string) => {
      if (method === 'thread/read') return { thread }
      if (method === 'dsh/sessionHistory') return codexPagePromise
      return {}
    })

    const scope = browseScope(useAppStore.getState())
    const codexCached: ChatItem = {
      id: 'codex-c1', sessionId: 'codex:s-codex', kind: 'message', role: 'assistant', text: 'Codex cached text', createdAt: 1000,
    }
    saveSessionMessagesSnapshot(scope, 'codex:s-codex', [codexCached])

    useAppStore.setState({
      selectedSession: undefined,
      messages: {},
    })

    const openPromise = useAppStore.getState().openSession(codexSession)

    // Cached message is immediately visible
    expect(useAppStore.getState().messages['codex:s-codex']).toBeDefined()
    expect((useAppStore.getState().messages['codex:s-codex']![0] as ChatMessage).text).toBe('Codex cached text')

    // Authoritative history resolves
    resolveCodexPage({
      header: { id: 'codex:s-codex' },
      records: [
        {
          type: 'event',
          event: {
            type: 'user/message', seq: 1, time: 2000,
            data: { message: { role: 'user', content: [{ type: 'text', text: 'Authoritative Codex prompt' }] } },
          },
        },
      ],
      hasMore: false,
    })

    await openPromise
    const finalState = useAppStore.getState()
    expect(finalState.messages['codex:s-codex']!.some(m => m.kind === 'message' && (m as ChatMessage).text.includes('Authoritative Codex prompt'))).toBe(true)
  })
})
