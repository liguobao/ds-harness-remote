import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ApprovalActivity,
  ChatItem,
  ChatMessage,
  HistoryEntry,
  QuestionActivity,
  RemoteSession,
  ToolActivity,
} from '../src/types'

const { proxy, transport, storage, authenticate, acp, codex } = vi.hoisted(() => ({
  proxy: {
    sessionHistory: vi.fn(),
    messageFeedbackList: vi.fn(),
    sessionModels: vi.fn(),
    sessionList: vi.fn(),
    sessionCreate: vi.fn(),
    hostDescribe: vi.fn(),
    workspaceList: vi.fn(),
    workspaceArchiveSession: vi.fn(),
    sessionSelectPermission: vi.fn(),
    sessionPrompt: vi.fn(),
    sessionUpdateQueue: vi.fn(),
  },
  transport: {
    connect: vi.fn(),
    close: vi.fn(),
    checkHealth: vi.fn(),
    refreshBackends: vi.fn(),
    hasCodex: vi.fn(),
    hasCursor: vi.fn(),
    hasAntigravity: vi.fn(),
    hasPi: vi.fn(),
    hasOpencode: vi.fn(),
    hasClaude: vi.fn(),
    hasHermes: vi.fn(),
    hasKimi: vi.fn(),
    requireClaude: vi.fn(),
    requireHermes: vi.fn(),
    requireKimi: vi.fn(),
  },
  acp: {
    call: vi.fn(),
    transferCall: vi.fn(),
    openStream: vi.fn(),
    prompt: vi.fn(),
    sessionModels: vi.fn(),
    selectModel: vi.fn(),
    archiveSession: vi.fn(),
    createSession: vi.fn(),
  },
  storage: {
    saveRecentWorkspaces: vi.fn(),
    saveLastConnectedDeviceId: vi.fn(),
    loadCodexPermissionPresets: vi.fn(),
    saveCodexPermissionPreset: vi.fn(),
  },
  codex: { request: vi.fn(), subscribe: vi.fn() },
  authenticate: vi.fn(),
}))

vi.mock('react-native', () => ({
  FlatList: {},
  Keyboard: { dismiss: vi.fn() },
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
    hasKimi = transport.hasKimi
    requireCursor() { return acp }
    requireAntigravity() { return acp }
    requirePi() { return acp }
    requireOpencode() { return acp }
    requireClaude() { transport.requireClaude(); return acp }
    requireHermes() { transport.requireHermes(); return acp }
    requireKimi() { transport.requireKimi(); return acp }
    getNetworkDetails() { return Promise.resolve(undefined) }
    getStats() { return { mode: 'Relay', connected: true } }
  },
}))
vi.mock('../src/services/storage', () => storage)
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate } }))

import { nextTailWindowLimit, resolveDisplaySections, TAIL_EXPAND_STEP, TAIL_WINDOW_SIZE } from '../src/screens/chat/use-chat-scroll'
import { useBrowseMemory } from '../src/services/browse-memory'
import { chatSections, reuseUnchangedChatItems, type ChatSection } from '../src/state/message-helpers'
import { useAppStore } from '../src/state/store'

function baseMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    kind: 'message',
    id: 'msg-1',
    sessionId: 's-1',
    createdAt: 1000,
    nativeSeq: 1,
    nativeOrderSeq: 1,
    nativeRevisionSeq: 1,
    role: 'assistant',
    text: 'hello world',
    turn: 't1',
    replyGroup: 't1',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    images: [{ attachmentId: 'att-1', sessionId: 's-1', uri: 'file:///a.png', width: 100, height: 100 }],
    files: [{ path: 'docs/report.pdf', name: 'report.pdf', bytes: 2048, attachmentId: 'file-1', source: 'upload' }],
    ...overrides,
  }
}

function baseTool(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    kind: 'tool',
    id: 'tool-1',
    sessionId: 's-1',
    createdAt: 1001,
    turn: 't1',
    toolName: 'Shell',
    toolKey: 'shell',
    state: 'finished',
    arguments: '{"cmd":"ls"}',
    summary: 'Listed files',
    callDetail: { text: 'ls -la', format: 'code' },
    resultDetail: { text: 'README.md', format: 'code', truncated: false },
    remoteDetail: { threadId: 'th-1', detailId: 'dt-1' },
    uiResultMeta: { card: { id: 'c1', tags: ['a', 'b'] } },
    ...overrides,
  }
}

function baseApproval(overrides: Partial<ApprovalActivity> = {}): ApprovalActivity {
  return {
    kind: 'approval',
    id: 'appr-1',
    sessionId: 's-1',
    createdAt: 1002,
    turn: 't1',
    approvalId: 'a-1',
    toolName: 'Shell',
    callId: 'tool-1',
    reason: 'Run command',
    outcome: undefined,
    ...overrides,
  }
}

function baseQuestion(overrides: Partial<QuestionActivity> = {}): QuestionActivity {
  return {
    kind: 'question',
    id: 'q-1',
    sessionId: 's-1',
    createdAt: 1003,
    turn: 't1',
    callId: 'tool-q',
    questionState: 'open',
    deadline: 5000,
    questions: [
      {
        id: 'opt-q',
        question: 'Proceed?',
        options: [{ label: 'Yes', description: 'Continue' }, { label: 'No' }],
        intent: { kind: 'plan-review', approve: 'Yes' },
      },
    ],
    ...overrides,
  }
}

function makeSections(count: number): ChatSection[] {
  const items: ChatItem[] = []
  for (let i = 0; i < count; i += 1) {
    items.push({
      kind: 'message',
      id: `u-${i}`,
      sessionId: 's-1',
      createdAt: i * 100,
      role: 'user',
      text: `Prompt ${i}`,
    })
  }
  return chatSections(items)
}

describe('reuseUnchangedChatItems', () => {
  it('returns next directly when previous is undefined or empty', () => {
    const next = [baseMessage()]
    expect(reuseUnchangedChatItems(undefined, next)).toBe(next)
    expect(reuseUnchangedChatItems([], next)).toBe(next)
  })

  it('preserves the original array reference when all items are structurally identical', () => {
    const previous: ChatItem[] = [baseMessage(), baseTool(), baseApproval(), baseQuestion()]
    const clonedNext: ChatItem[] = [
      // Include explicit undefined optional fields matching applyFeedback/sanitize behavior.
      { ...baseMessage(), feedback: undefined, reasoning: undefined },
      baseTool(),
      baseApproval(),
      baseQuestion(),
    ]

    const result = reuseUnchangedChatItems(previous, clonedNext)
    expect(result).toBe(previous)
    expect(result[0]).toBe(previous[0])
    expect(result[1]).toBe(previous[1])
    expect(result[2]).toBe(previous[2])
    expect(result[3]).toBe(previous[3])
  })

  it('replaces only changed items while reusing unchanged references on partial updates', () => {
    const previous: ChatItem[] = [baseMessage(), baseTool(), baseApproval()]
    const updatedTool = baseTool({ state: 'failed', summary: 'Command failed' })
    const next: ChatItem[] = [baseMessage(), updatedTool, baseApproval()]

    const result = reuseUnchangedChatItems(previous, next)
    expect(result).not.toBe(previous)
    expect(result[0]).toBe(previous[0])
    expect(result[1]).toBe(updatedTool)
    expect(result[1]).not.toBe(previous[1])
    expect(result[2]).toBe(previous[2])
  })

  it('never reuses when nested payloads or scalar facets differ', () => {
    const cases: Array<{ name: string; prev: ChatItem; next: ChatItem }> = [
      {
        name: 'usage.outputTokens changed',
        prev: baseMessage(),
        next: baseMessage({ usage: { inputTokens: 10, outputTokens: 25, totalTokens: 35 } }),
      },
      {
        name: 'images entry changed',
        prev: baseMessage(),
        next: baseMessage({
          images: [{ attachmentId: 'att-1', sessionId: 's-1', uri: 'file:///b.png', width: 100, height: 100 }],
        }),
      },
      {
        name: 'files added',
        prev: baseMessage({ files: undefined }),
        next: baseMessage(),
      },
      {
        name: 'files removed',
        prev: baseMessage(),
        next: baseMessage({ files: undefined }),
      },
      {
        name: 'files.path changed',
        prev: baseMessage(),
        next: baseMessage({
          files: [{ path: 'docs/other.pdf', name: 'report.pdf', bytes: 2048, attachmentId: 'file-1', source: 'upload' }],
        }),
      },
      {
        name: 'files.name changed',
        prev: baseMessage(),
        next: baseMessage({
          files: [{ path: 'docs/report.pdf', name: 'renamed.pdf', bytes: 2048, attachmentId: 'file-1', source: 'upload' }],
        }),
      },
      {
        name: 'files.bytes changed',
        prev: baseMessage(),
        next: baseMessage({
          files: [{ path: 'docs/report.pdf', name: 'report.pdf', bytes: 4096, attachmentId: 'file-1', source: 'upload' }],
        }),
      },
      {
        name: 'files.attachmentId changed',
        prev: baseMessage(),
        next: baseMessage({
          files: [{ path: 'docs/report.pdf', name: 'report.pdf', bytes: 2048, attachmentId: 'file-2', source: 'upload' }],
        }),
      },
      {
        name: 'files.source changed',
        prev: baseMessage(),
        next: baseMessage({
          files: [{ path: 'docs/report.pdf', name: 'report.pdf', bytes: 2048, attachmentId: 'file-1', source: 'attachment' }],
        }),
      },
      {
        name: 'promptImages changed',
        prev: baseMessage({
          promptImages: [{ uri: 'file:///p.png', mediaType: 'image/png', data: 'aaa', bytes: 3, width: 1, height: 1 }],
        }),
        next: baseMessage({
          promptImages: [{ uri: 'file:///p.png', mediaType: 'image/png', data: 'bbb', bytes: 3, width: 1, height: 1 }],
        }),
      },
      {
        name: 'feedback (rating) changed',
        prev: baseMessage({ feedback: 'positive' }),
        next: baseMessage({ feedback: 'negative' }),
      },
      {
        name: 'streaming changed',
        prev: baseMessage({ streaming: true, streamingPhase: 'text' }),
        next: baseMessage({ streaming: false, streamingPhase: undefined }),
      },
      {
        name: 'sendState changed',
        prev: baseMessage({ role: 'user', sendState: 'queued' }),
        next: baseMessage({ role: 'user', sendState: 'failed', sendError: 'timeout' }),
      },
      {
        name: 'turnEnd changed',
        prev: baseMessage({ turnEnd: { reason: 'completed', time: 2000 } }),
        next: baseMessage({ turnEnd: { reason: 'failed', time: 2000, detail: 'rate limit' } }),
      },
      {
        name: 'tool arguments changed',
        prev: baseTool(),
        next: baseTool({ arguments: '{"cmd":"pwd"}' }),
      },
      {
        name: 'tool uiResultMeta nested array changed',
        prev: baseTool(),
        next: baseTool({ uiResultMeta: { card: { id: 'c1', tags: ['a', 'c'] } } }),
      },
      {
        name: 'approval outcome changed',
        prev: baseApproval({ outcome: undefined }),
        next: baseApproval({ outcome: 'allowed-once' }),
      },
      {
        name: 'question outcome changed',
        prev: baseQuestion({ outcome: undefined }),
        next: baseQuestion({ outcome: 'answered' }),
      },
      {
        name: 'question option description changed',
        prev: baseQuestion(),
        next: baseQuestion({
          questions: [
            {
              id: 'opt-q',
              question: 'Proceed?',
              options: [{ label: 'Yes', description: 'Updated' }, { label: 'No' }],
              intent: { kind: 'plan-review', approve: 'Yes' },
            },
          ],
        }),
      },
    ]

    for (const testCase of cases) {
      const prevList = [testCase.prev]
      const result = reuseUnchangedChatItems(prevList, [testCase.next])
      expect(result, testCase.name).not.toBe(prevList)
      expect(result[0], testCase.name).toBe(testCase.next)
      expect(result[0], testCase.name).not.toBe(testCase.prev)
    }
  })

  it('fails closed on cyclic uiResultMeta without recursing infinitely', () => {
    const cycleA: Record<string, unknown> = { label: 'loop' }
    cycleA.self = cycleA
    const cycleB: Record<string, unknown> = { label: 'loop' }
    cycleB.self = cycleB

    const prevList: ChatItem[] = [baseTool({ uiResultMeta: cycleA })]
    const nextItem = baseTool({ uiResultMeta: cycleB })
    const result = reuseUnchangedChatItems(prevList, [nextItem])
    expect(result).not.toBe(prevList)
    expect(result[0]).toBe(nextItem)
  })

  it('returns a new array when item order changes even if every item is unchanged', () => {
    const first = baseMessage({ id: 'm-1', text: 'first' })
    const second = baseMessage({ id: 'm-2', text: 'second' })
    const previous: ChatItem[] = [first, second]
    const reorderedNext: ChatItem[] = [
      baseMessage({ id: 'm-2', text: 'second' }),
      baseMessage({ id: 'm-1', text: 'first' }),
    ]

    const result = reuseUnchangedChatItems(previous, reorderedNext)
    expect(result).not.toBe(previous)
    expect(result.map(item => item.id)).toEqual(['m-2', 'm-1'])
    expect(result[0]).toBe(second)
    expect(result[1]).toBe(first)
  })
})

describe('resolveDisplaySections tail window boundary', () => {
  it('returns the original reference untouched when section count is <= TAIL_WINDOW_SIZE', () => {
    for (const count of [0, 1, TAIL_WINDOW_SIZE]) {
      const sections = makeSections(count)
      const resolved = resolveDisplaySections(sections, TAIL_WINDOW_SIZE)
      expect(resolved).toBe(sections)
    }
  })

  it('slices to the last TAIL_WINDOW_SIZE sections when section count exceeds it', () => {
    const five = makeSections(5)
    const slicedFive = resolveDisplaySections(five, TAIL_WINDOW_SIZE)
    expect(slicedFive).not.toBe(five)
    expect(slicedFive.map(s => s.key)).toEqual(['u-3', 'u-4'])
    expect(slicedFive[0]).toBe(five[3])
    expect(slicedFive[1]).toBe(five[4])

    const twelve = makeSections(12)
    const slicedTwelve = resolveDisplaySections(twelve, TAIL_WINDOW_SIZE)
    expect(slicedTwelve).toHaveLength(TAIL_WINDOW_SIZE)
    expect(slicedTwelve.map(s => s.key)).toEqual(['u-10', 'u-11'])
  })

  it('returns the original reference when tail window is disabled (non-bottom restore or expanded)', () => {
    const twelve = makeSections(12)
    expect(resolveDisplaySections(twelve, undefined)).toBe(twelve)
  })

  it('advances progressive tail expansion in bounded chunks until all sections fit', () => {
    expect(nextTailWindowLimit(TAIL_WINDOW_SIZE, 14, TAIL_EXPAND_STEP)).toBe(6)
    expect(nextTailWindowLimit(6, 14, TAIL_EXPAND_STEP)).toBe(10)
    expect(nextTailWindowLimit(10, 14, TAIL_EXPAND_STEP)).toBeUndefined()
    expect(nextTailWindowLimit(TAIL_WINDOW_SIZE, 6, TAIL_EXPAND_STEP)).toBeUndefined()
    expect(nextTailWindowLimit(undefined, 14, TAIL_EXPAND_STEP)).toBeUndefined()
  })
})

describe('openSession reference reuse against authoritative history', () => {
  const harnessSession: RemoteSession = {
    sessionId: 's-harness',
    backend: 'harness',
    updatedAt: 100,
    running: false,
    blank: false,
  }
  const otherSession: RemoteSession = {
    sessionId: 's-other',
    backend: 'harness',
    updatedAt: 90,
    running: false,
    blank: false,
  }
  const codexSession: RemoteSession = {
    sessionId: 'codex:s-codex',
    nativeId: 's-codex',
    backend: 'codex',
    updatedAt: 80,
    running: false,
    blank: false,
  }
  const hermesSession: RemoteSession = {
    sessionId: 'hermes:s-hermes',
    nativeId: 's-hermes',
    backend: 'hermes',
    updatedAt: 70,
    running: false,
    blank: false,
  }

  const harnessHistoryEvents: HistoryEntry[] = [
    {
      event: {
        type: 'user/message',
        seq: 1,
        time: 1000,
        data: {
          message: {
            id: 'u1',
            role: 'user',
            source: { kind: 'user' },
            content: [{ type: 'text', text: 'Hello' }],
          },
        },
      },
    },
    {
      event: {
        type: 'assistant/message',
        seq: 2,
        time: 1001,
        data: {
          turn: 't1',
          message: {
            id: 'a1',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi there!' }],
          },
        },
      },
    },
  ]

  beforeEach(() => {
    vi.resetAllMocks()
    transport.checkHealth.mockResolvedValue(true)
    transport.hasCodex.mockReturnValue(true)
    transport.hasHermes.mockReturnValue(true)
    acp.openStream.mockResolvedValue({ streamId: 'stream-1', close: async () => undefined })
    codex.subscribe.mockResolvedValue({ streamId: 'codex-stream-1', close: async () => undefined })
    proxy.sessionList.mockResolvedValue([harnessSession, otherSession])
    proxy.workspaceList.mockResolvedValue({ items: [], archivedSessionIds: [] })
    proxy.hostDescribe.mockResolvedValue({})
    proxy.sessionModels.mockResolvedValue(undefined)
    proxy.messageFeedbackList.mockResolvedValue([])
    storage.loadCodexPermissionPresets.mockResolvedValue({})
    useBrowseMemory.setState({
      entries: {},
      catalogs: {},
      hostModes: {},
      resume: false,
      notifications: true,
      autoConnectHost: true,
      ready: true,
    })
    useAppStore.setState({
      ...useAppStore.getInitialState(),
      selectedDevice: { deviceId: 'dev-1', identityKey: 'key-1' } as never,
      config: { baseUrl: 'https://example.com', account: 'test' },
      sessions: [harnessSession, otherSession, codexSession, hermesSession],
      connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
    })
  })

  it('keeps the exact messages array reference when re-opening a cached Harness session with identical history', async () => {
    proxy.sessionHistory.mockImplementation(async (sessionId: string) => {
      if (sessionId === 's-harness') {
        return { events: structuredClone(harnessHistoryEvents), throughSeq: 2, hasMore: false }
      }
      return { events: [], throughSeq: 0, hasMore: false }
    })

    // First open populates state.messages['s-harness'] and snapshot cache.
    expect(await useAppStore.getState().openSession(harnessSession)).toBe(true)
    const firstMessages = useAppStore.getState().messages['s-harness']
    expect(firstMessages).toHaveLength(2)

    // Switch to another session, then switch back to s-harness with identical Host history.
    expect(await useAppStore.getState().openSession(otherSession)).toBe(true)
    const messagesMapBefore = useAppStore.getState().messages

    expect(await useAppStore.getState().openSession(harnessSession)).toBe(true)
    const stateAfter = useAppStore.getState()
    expect(stateAfter.busyAction).toBeUndefined()
    expect(stateAfter.selectedSession?.sessionId).toBe('s-harness')
    expect(stateAfter.messages).toBe(messagesMapBefore)
    expect(stateAfter.messages['s-harness']).toBe(firstMessages)
  })

  it('updates messages while preserving unchanged item references when Host appends a message or changes rating', async () => {
    proxy.sessionHistory.mockResolvedValueOnce({
      events: structuredClone(harnessHistoryEvents),
      throughSeq: 2,
      hasMore: false,
    })
    expect(await useAppStore.getState().openSession(harnessSession)).toBe(true)
    const initialList = useAppStore.getState().messages['s-harness']!
    expect(initialList).toHaveLength(2)

    // Host now returns a rating on assistant message + a newly appended user message.
    proxy.messageFeedbackList.mockResolvedValueOnce([{ messageId: initialList[1]!.id, rating: 'positive' }])
    proxy.sessionHistory.mockResolvedValueOnce({
      events: [
        ...structuredClone(harnessHistoryEvents),
        {
          event: {
            type: 'user/message',
            seq: 3,
            time: 2000,
            data: {
              message: {
                id: 'u2',
                role: 'user',
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'Follow-up' }],
              },
            },
          },
        },
      ],
      throughSeq: 3,
      hasMore: false,
    })

    expect(await useAppStore.getState().openSession(harnessSession)).toBe(true)
    const updatedList = useAppStore.getState().messages['s-harness']!
    expect(updatedList).not.toBe(initialList)
    expect(updatedList).toHaveLength(3)
    // First message is untouched -> exact reference reused.
    expect(updatedList[0]).toBe(initialList[0])
    // Second message gained feedback -> new object with updated feedback.
    expect(updatedList[1]).not.toBe(initialList[1])
    expect((updatedList[1] as ChatMessage).feedback).toBe('positive')
    // Third message is newly appended.
    expect((updatedList[2] as ChatMessage).text).toBe('Follow-up')
  })

  it('keeps the exact messages array reference when re-opening a cached Codex or ACP session with identical history', async () => {
    const thread = { id: 's-codex', cwd: '/project', status: { type: 'active', activeFlags: [] }, createdAt: 1, updatedAt: 2 }
    const codexHistory = {
      header: { id: 'codex:s-codex' },
      records: [
        {
          type: 'event',
          event: {
            type: 'user/message',
            seq: 1,
            time: 1000,
            data: {
              message: {
                id: 'cu1',
                role: 'user',
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'Codex prompt' }],
              },
            },
          },
        },
      ],
      hasMore: false,
    }
    codex.request.mockImplementation(async (method: string) => {
      if (method === 'thread/read') return { thread }
      if (method === 'dsh/sessionHistory') return structuredClone(codexHistory)
      return {}
    })

    expect(await useAppStore.getState().openSession(codexSession)).toBe(true)
    const codexFirst = useAppStore.getState().messages['codex:s-codex']
    expect(codexFirst).toHaveLength(1)

    expect(await useAppStore.getState().openSession(codexSession)).toBe(true)
    expect(useAppStore.getState().messages['codex:s-codex']).toBe(codexFirst)

    acp.transferCall.mockImplementation(async () => ({
      events: [
        {
          event: {
            type: 'user/message',
            seq: 1,
            time: 1000,
            data: {
              message: {
                id: 'hu1',
                role: 'user',
                source: { kind: 'user' },
                content: [{ type: 'text', text: 'Hermes prompt' }],
              },
            },
          },
        },
      ],
    }))

    expect(await useAppStore.getState().openSession(hermesSession)).toBe(true)
    const hermesFirst = useAppStore.getState().messages['hermes:s-hermes']
    expect(hermesFirst).toHaveLength(1)

    expect(await useAppStore.getState().openSession(hermesSession)).toBe(true)
    expect(useAppStore.getState().messages['hermes:s-hermes']).toBe(hermesFirst)
  })
})
