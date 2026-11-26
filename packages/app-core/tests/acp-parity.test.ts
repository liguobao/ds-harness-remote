import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() }, Platform: { OS: 'android' } }))
vi.mock('expo-modules-core', () => ({}))
vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}))
vi.mock('expo-application', () => ({ applicationId: 'io.github.liguobao.dshremote' }))
vi.mock('expo-device', () => ({ modelName: 'TestPhone' }))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  randomUUID: () => globalThis.crypto.randomUUID(),
}))
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///app/',
  getInfoAsync: async () => ({ exists: false }),
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => undefined,
  moveAsync: async () => undefined,
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}))

import { registerAcpBackendId, sessionBackendFromId } from '../src/lib/session-backend'
import { loadAcpDirectoryCatalog } from '../src/lib/workspace-key'
import { applyCursorFrame, createAcpSession, createAcpWorkspace, createAntigravitySession, createAntigravityWorkspace } from '../src/services/cursor'
import { createSessionActions } from '../src/state/session-actions'
import { createSessionEventActions } from '../src/state/session-event-actions'
import type { ChatMessage, QuestionActivity, RemoteSession } from '../src/types'

describe('Issue #469 ACP parity (app-core)', () => {
  it('routes custom ACP backend prefixes and constructs custom workspaces/sessions', () => {
    registerAcpBackendId('my-agent')
    expect(sessionBackendFromId('my-agent:sess_1')).toBe('my-agent')
    expect(createAcpWorkspace('my-agent', '/tmp/proj').workspaceId).toBe('my-agent:cwd:%2Ftmp%2Fproj')
    expect(createAcpSession({ backend: 'my-agent', acpSessionId: 'sess_1', cwd: '/tmp/proj' })).toMatchObject({
      sessionId: 'my-agent:sess_1',
      backend: 'my-agent',
      nativeId: 'sess_1',
    })
  })

  it('keeps workspace results matched and ordered when catalog calls finish out of order', async () => {
    const paths = ['/a', '/b', '/c', '/d', '/e']
    const started: string[] = []
    const release = new Map<string, (value: unknown) => void>()
    const client = { call: vi.fn(async (method: string, params: unknown) => {
      if (method === 'dsh/workspaceList') return paths.map(path => ({ path }))
      const path = (params as { path: string }).path
      started.push(path)
      return new Promise(resolve => { release.set(path, resolve) })
    }) }
    const pending = loadAcpDirectoryCatalog({
      backend: 'opencode', label: 'OpenCode', client,
      createWorkspace: path => createAcpWorkspace('opencode', path),
      createSession: input => createAcpSession({ backend: 'opencode', ...input }),
    })
    await vi.waitFor(() => expect(started).toEqual(paths.slice(0, 4)))
    release.get('/b')!({ items: [{ conversationId: 'b' }] })
    await vi.waitFor(() => expect(started).toEqual(paths))
    for (const path of ['/e', '/d', '/c', '/a']) {
      release.get(path)!({ items: [{ conversationId: path.slice(1) }] })
    }
    const catalog = await pending
    expect(catalog.workspaces.map(item => item.path)).toEqual(paths)
    expect(catalog.sessions.map(item => item.sessionId)).toEqual(paths.map(path => `opencode:${path.slice(1)}`))
  })

  it('stops starting catalog calls after one workspace call fails', async () => {
    const paths = ['/a', '/b', '/c', '/d', '/e', '/f']
    const started: string[] = []
    const settle = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    const client = { call: vi.fn(async (method: string, params: unknown) => {
      if (method === 'dsh/workspaceList') return paths.map(path => ({ path }))
      const path = (params as { path: string }).path
      started.push(path)
      return new Promise((resolve, reject) => { settle.set(path, { resolve, reject }) })
    }) }
    const pending = loadAcpDirectoryCatalog({
      backend: 'opencode', label: 'OpenCode', client,
      createWorkspace: path => createAcpWorkspace('opencode', path),
      createSession: input => createAcpSession({ backend: 'opencode', ...input }),
    })
    await vi.waitFor(() => expect(started).toEqual(paths.slice(0, 4)))
    const rejected = expect(pending).rejects.toThrow('catalog failed')
    settle.get('/a')!.reject(new Error('catalog failed'))
    await rejected
    for (const path of ['/b', '/c', '/d']) settle.get(path)!.resolve({ items: [] })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toEqual(paths.slice(0, 4))
  })

  it('projects cursor/ask_question as QuestionActivity and attaches TurnUsage on prompt_completed', () => {
    const sid = 'antigravity:s1'
    let items = applyCursorFrame([], sid, {
      streamId: 's',
      frame: {
        method: 'session/update',
        params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Answer' } } },
      },
    })
    items = applyCursorFrame(items, sid, {
      streamId: 's',
      frame: {
        method: 'session/update',
        params: {
          sessionId: 's1',
          update: {
            sessionUpdate: 'prompt_completed',
            stopReason: 'end_turn',
            usage: { inputTokens: 120, outputTokens: 30, cachedReadTokens: 20, cachedWriteTokens: 5, thoughtTokens: 10, totalTokens: 150 },
          },
        },
      },
    })
    const assistant = items.find((i): i is ChatMessage => i.kind === 'message' && i.role === 'assistant')
    expect(assistant?.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      reasoningTokens: 10,
      totalTokens: 150,
    })

    const withQuestion = applyCursorFrame(items, sid, {
      streamId: 's',
      frame: {
        method: 'cursor/ask_question',
        params: {
          requestHandle: 'req_q1',
          title: 'Pick Option',
          questions: [{ id: 'q1', prompt: 'Proceed?', options: [{ id: 'yes', label: 'Yes' }], multiSelect: false }],
        },
      },
    })
    const qCard = withQuestion.find((i): i is QuestionActivity => i.kind === 'question')
    expect(qCard).toMatchObject({
      kind: 'question',
      frameRpcId: 'req_q1',
      questionState: 'open',
      questions: [{ id: 'q1', question: 'Proceed?', header: 'Pick Option', options: [{ label: 'Yes' }] }],
    })
  })

  it('updates live tool calls from tool_call to completed tool_call_update on ACP backends without breaking PI isolation', () => {
    const sid = 'antigravity:s1'
    let items = applyCursorFrame([], sid, {
      streamId: 's',
      frame: {
        method: 'session/update',
        params: {
          sessionId: 's1',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 't1',
            title: 'bash',
            status: 'in_progress',
          },
        },
      },
    })
    items = applyCursorFrame(items, sid, {
      streamId: 's',
      frame: {
        method: 'session/update',
        params: {
          sessionId: 's1',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 't1',
            status: 'completed',
            rawOutput: 'line 1\nline 2\n',
          },
        },
      },
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'tool',
      state: 'finished',
      resultDetail: { text: 'line 1\nline 2\n' },
    })
  })

  it('updates todos, contextPressure, agentPreset, and availableCommands on session projections in handleCursorFrame', () => {
    const session: RemoteSession = {
      sessionId: 'antigravity:s1',
      backend: 'antigravity',
      nativeId: 's1',
      updatedAt: 1,
      running: true,
      blank: false,
    }
    let state: Record<string, any> = {
      selectedSession: session,
      sessions: [session],
      messages: { [session.sessionId]: [] },
    }
    const actions = createSessionEventActions({
      get: () => state as any,
      set: (updater: any) => {
        const patch = typeof updater === 'function' ? updater(state) : updater
        state = { ...state, ...patch }
      },
      runtime: {
        connectionGeneration: 1,
        refreshAntigravityCatalog: vi.fn(),
        refreshCursorCatalog: vi.fn(),
      } as any,
    })

    actions.handleCursorFrame({
      streamId: 's',
      frame: { method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'usage_update', used: 50, size: 200 } } },
    })
    actions.handleCursorFrame({
      streamId: 's',
      frame: { method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'current_mode_update', currentModeId: 'plan' } } },
    })
    actions.handleCursorFrame({
      streamId: 's',
      frame: { method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact' }] } } },
    })
    actions.handleCursorFrame({
      streamId: 's',
      frame: { method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'plan', entries: [{ content: 'Write tests', status: 'completed' }] } } },
    })

    expect(state.selectedSession.agentPreset).toBe('plan')
    expect(state.selectedSession.availableCommands).toEqual([{ name: 'compact', description: 'Compact' }])
    expect(state.selectedSession.projections.values.contextPressure).toEqual({ used: 50, size: 200, ratio: 0.25 })
    expect(state.selectedSession.projections.values.todos).toEqual([{ content: 'Write tests', status: 'completed' }])
  })

  it('degrades loadAgentPresets without setting an error banner on ACP sessions and guards session changes + antigravity: pins', async () => {
    const agySession = createAntigravitySession({ acpSessionId: 'agy-1', cwd: '/tmp/repo' })
    const cursorSession: RemoteSession = {
      sessionId: 'cursor:c-1',
      backend: 'cursor',
      nativeId: 'c-1',
      updatedAt: 2,
      running: false,
      blank: false,
      cwd: '/tmp/repo',
    }
    let state: Record<string, any> = {
      connection: { phase: 'connected' },
      selectedSession: agySession,
      sessions: [agySession, cursorSession],
      workspaces: [{ workspaceId: 'antigravity:cwd:%2Ftmp%2Frepo', backend: 'antigravity', path: '/tmp/repo', title: 'repo', sessionIds: ['antigravity:agy-1'], createdAt: '1', updatedAt: '1' }],
      messages: {},
      pinnedSessionIds: ['harness-1'],
      agentPresetOptions: [{ id: 'stale', isDefault: false, name: 'Stale' }],
      agentPresetLoading: false,
      error: undefined,
    }
    const set = (updater: any) => {
      const patch = typeof updater === 'function' ? updater(state) : updater
      state = { ...state, ...patch }
    }
    const sessionModes = vi.fn(async (_sid: string, backend: string) => {
      if (backend === 'cursor') {
        throw Object.assign(new Error('Load the Cursor session before using it.'), { code: 'ACP_SESSION_NOT_LOADED' })
      }
      return { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }] }
    })
    const pinnedOnHost = new Set<string>()
    const pinSession = vi.fn(async (sid: string) => { pinnedOnHost.add(sid); return [...pinnedOnHost] })
    const unpinSession = vi.fn(async (sid: string) => { pinnedOnHost.delete(sid); return [...pinnedOnHost] })
    const setMode = vi.fn(async (_sid: string, _b: string, modeId: string) => ({ currentModeId: modeId }))

    const actions = createSessionActions({
      get: () => state as any,
      set,
      runtime: {
        connectionGeneration: 1,
        sessionLoadGeneration: 1,
        connection: {
          requireAcpBackend: () => ({ sessionModes, pinSession, unpinSession, setMode }),
          requireAntigravity: () => ({ sessionModes, pinSession, unpinSession, setMode }),
          requireCursor: () => ({ sessionModes, pinSession, unpinSession, setMode }),
        },
        rememberRecentWorkspace: vi.fn(async () => undefined),
      } as any,
    })

    expect(await actions.loadAgentPresets()).toBe(true)
    expect(state.agentPresetOptions).toHaveLength(2)
    expect(state.error).toBeUndefined()

    expect(await actions.selectAgentPreset('plan')).toBe(true)
    expect(state.selectedSession.agentPreset).toBe('plan')

    expect(await actions.pinSession('antigravity:agy-1', 'antigravity')).toBe(true)
    expect(state.pinnedSessionIds).toEqual(['harness-1', 'antigravity:agy-1'])

    const catalog = await loadAcpDirectoryCatalog({
      backend: 'antigravity',
      label: 'Antigravity',
      client: {
        call: vi.fn(async (method: string) => (
          method === 'dsh/workspaceList'
            ? [{ path: '/tmp/repo', title: 'repo' }]
            : { items: [{ conversationId: 'agy-1', title: 'Agy 1', updatedAt: 1 }], pinnedSessionIds: ['agy-1'] }
        )),
      },
      createWorkspace: createAntigravityWorkspace,
      createSession: createAntigravitySession,
    })
    expect(catalog.pinnedSessionIds).toEqual(['antigravity:agy-1'])

    expect(await actions.unpinSession('antigravity:agy-1', 'antigravity')).toBe(true)
    expect(state.pinnedSessionIds).toEqual(['harness-1'])

    state = { ...state, selectedSession: cursorSession }
    expect(await actions.loadAgentPresets()).toBe(false)
    expect(state.agentPresetOptions).toBeUndefined()
    expect(state.error).toBeUndefined()
  })
})
