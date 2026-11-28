import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() }, Platform: { OS: 'android' } }))
vi.mock('expo-modules-core', () => ({}))
vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
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
vi.mock('../src/services/rpc-id', () => ({ createNativeRpcId: () => 'rpc-test-1' }))

import { registerAcpBackendId } from '../src/lib/session-backend'
import { strings as zhCN } from '../src/locales/i18n'
import { acpUnavailableMessage } from '../src/state/acp-backend-helpers'
import { createPromptActions } from '../src/state/prompt-actions'
import { createSessionActions } from '../src/state/session-actions'
import type { ChatItem, RemoteSession } from '../src/types'

describe('prompt-actions ACP dispatch', () => {
  it.each(['kimi', 'my-agent'] as const)(
    'routes sendMessage, stopSession, respondApproval, and respondQuestion through %s ACP client',
    async backend => {
      registerAcpBackendId('my-agent')
      const session: RemoteSession = {
        sessionId: `${backend}:native-1`,
        nativeId: 'native-1',
        backend,
        updatedAt: 1,
        running: false,
        blank: false,
      }
      const approvalItem: ChatItem = {
        id: 'approval-1',
        kind: 'approval',
        sessionId: session.sessionId,
        approvalId: 'req-app-1',
        frameRpcId: 'rpc-app-1',
        toolName: 'bash',
        reason: 'echo hi',
        createdAt: 1,
      }
      const questionItem: ChatItem = {
        id: 'question-1',
        kind: 'question',
        sessionId: session.sessionId,
        frameRpcId: 'rpc-q-1',
        questions: [{ id: 'q1', question: 'Proceed?', options: [{ label: 'Yes', description: 'Continue' }] }],
        createdAt: 2,
      }
      let state: Record<string, any> = {
        connection: { phase: 'connected' },
        selectedSession: session,
        sessions: [session],
        messages: { [session.sessionId]: [approvalItem, questionItem] },
        busyAction: undefined,
        acpReadOnlySessionId: undefined,
        error: undefined,
        commandResult: undefined,
      }
      const set = (updater: any) => {
        const patch = typeof updater === 'function' ? updater(state) : updater
        state = { ...state, ...patch }
      }
      const client = {
        prompt: vi.fn(async () => ({ accepted: true, stopReason: 'in_progress' })),
        cancel: vi.fn(async () => undefined),
        respond: vi.fn(async () => undefined),
      }
      const requireKimi = vi.fn(() => client)
      const requireAcpBackend = vi.fn(() => client)
      const actions = createPromptActions({
        get: () => state as never,
        set,
        runtime: {
          sessionLoadGeneration: 1,
          flushPendingMuxFrames: vi.fn(),
          ensureCursorStream: vi.fn(async () => undefined),
          connection: {
            requireKimi,
            requireAcpBackend,
          },
        } as never,
      })

      expect(await actions.sendMessage('hello world')).toBe('sent')
      expect(client.prompt).toHaveBeenCalledWith('native-1', 'hello world', undefined, [], backend)

      await actions.stopSession()
      expect(client.cancel).toHaveBeenCalledWith('native-1')

      await actions.respondApproval('approval-1', 'allowed-once')
      expect(client.respond).toHaveBeenCalledWith('req-app-1', 'allow-once')

      await actions.respondQuestion('question-1', { q1: ['Yes'] })
      expect(client.respond).toHaveBeenCalledWith('rpc-q-1', 'allow-once', {
        answers: [{ id: 'q1', selected: ['Yes'] }],
      })

      if (backend === 'kimi') {
        expect(requireKimi).toHaveBeenCalledTimes(4)
        expect(requireAcpBackend).not.toHaveBeenCalled()
        expect(acpUnavailableMessage('kimi')).toBe(zhCN.runtime.kimiUnavailable)
      } else {
        expect(requireAcpBackend).toHaveBeenCalledTimes(4)
        expect(requireAcpBackend).toHaveBeenCalledWith('my-agent')
        expect(requireKimi).not.toHaveBeenCalled()
        expect(acpUnavailableMessage('my-agent')).toBe(zhCN.runtime.cursorUnavailable)
      }

      // Issue #5: selectModel routes custom ACP and kimi through shared acpClientForBackend + selectAcpModel.
      const selectModelCall = vi.fn(async () => ({
        selected: { provider: backend, model: 'm1' },
      }))
      const sessionModelsCall = vi.fn(async () => ({
        current: { provider: backend, model: 'm1' },
        routable: true,
        groups: [{ id: backend, name: backend, models: [{ id: 'm1', name: 'M1' }] }],
      }))
      const acpModelClient = { selectModel: selectModelCall, sessionModels: sessionModelsCall }
      const sessionActions = createSessionActions({
        get: () => ({
          ...state,
          selectedSession: session,
          sessions: [session],
          sessionModels: {
            current: { provider: backend, model: 'm0' },
            routable: true,
            groups: [{ id: backend, name: backend, models: [{ id: 'm0', name: 'M0' }, { id: 'm1', name: 'M1' }] }],
            failures: [],
          },
          modelSelecting: false,
        }) as never,
        set,
        runtime: {
          connectionGeneration: 1,
          sessionLoadGeneration: 1,
          connection: {
            requireKimi: () => acpModelClient,
            requireAcpBackend: () => acpModelClient,
          },
        } as never,
      })
      expect(await sessionActions.selectModel({ provider: backend, model: 'm1' })).toBe(true)
      expect(selectModelCall).toHaveBeenCalledWith('native-1', backend, { provider: backend, model: 'm1' })
    },
  )

  it('settles stale approval to unavailable on APPROVAL_NOT_FOUND errors and keeps pending on transient errors', async () => {
    const scenarios = [
      { name: 'ACP CURSOR_APPROVAL_NOT_FOUND', backend: 'cursor' as const, code: 'CURSOR_APPROVAL_NOT_FOUND', expectedOutcome: 'unavailable' },
      { name: 'Codex CODEX_APPROVAL_NOT_FOUND', backend: 'codex' as const, code: 'CODEX_APPROVAL_NOT_FOUND', expectedOutcome: 'unavailable' },
      { name: 'Harness APPROVAL_NOT_FOUND', backend: 'harness' as const, code: 'APPROVAL_NOT_FOUND', expectedOutcome: 'unavailable' },
      { name: 'transient error keeps pending', backend: 'cursor' as const, code: 'TIMEOUT', expectedOutcome: undefined },
    ]

    for (const scenario of scenarios) {
      const session: RemoteSession = {
        sessionId: `${scenario.backend}:s1`,
        nativeId: 's1',
        backend: scenario.backend,
        updatedAt: 1,
        running: false,
        blank: false,
      }
      const approvalItem: ChatItem = {
        id: 'approval-1',
        kind: 'approval',
        sessionId: session.sessionId,
        approvalId: 'req-1',
        frameRpcId: 'rpc-1',
        toolName: 'bash',
        createdAt: 1,
      }
      let state: Record<string, any> = {
        connection: { phase: 'connected' },
        selectedSession: session,
        sessions: [session],
        messages: { [session.sessionId]: [approvalItem] },
        busyAction: undefined,
        error: undefined,
      }
      const set = (updater: any) => {
        const patch = typeof updater === 'function' ? updater(state) : updater
        state = { ...state, ...patch }
      }
      const err = Object.assign(new Error(`failed: ${scenario.code}`), { code: scenario.code })
      const rejectFn = vi.fn(async () => { throw err })
      const actions = createPromptActions({
        get: () => state as never,
        set,
        runtime: {
          flushPendingMuxFrames: vi.fn(),
          connection: {
            requireCursor: () => ({ respond: rejectFn }),
            requireCodex: () => ({ respond: rejectFn }),
            requireProxy: () => ({ respondApproval: rejectFn }),
          },
        } as never,
      })

      await actions.respondApproval('approval-1', 'allowed-once')
      expect(state.busyAction).toBeUndefined()
      expect(state.error).toBeTruthy()
      const updated = state.messages[session.sessionId][0] as Extract<ChatItem, { kind: 'approval' }>
      expect(updated.outcome, scenario.name).toBe(scenario.expectedOutcome)
    }
  })
})
