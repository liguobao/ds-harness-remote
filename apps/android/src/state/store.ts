import { createChatImageLoader } from '../services/chat-image-loader'
import { loadWorkspacePreview } from '../services/workspace-file-preview'
import type { RemoteSession } from '../types'
import { create } from 'zustand'
import { getActiveLanguage } from '../locales/i18n'
import { createAccountActions } from './account-actions'
import { createConnectionActions } from './connection-actions'
import { createPreferenceActions } from './preference-actions'
import { createPromptActions } from './prompt-actions'
import { createScheduleActions } from './schedule-actions'
import { createSessionActions } from './session-actions'
import { createSessionEventActions } from './session-event-actions'
import { SessionRuntime } from './session-runtime'
import type { AppState } from './store-state'
import { disconnected } from './store-state'
import { createWorkspaceActions } from './workspace-actions'

const runtime: SessionRuntime = new SessionRuntime({
  get: (): AppState => useAppStore.getState(),
  set: partial => useAppStore.setState(partial),
})

/** Only exposes the authenticated native carrier of the current connection. */
export const requireProxy = () => runtime.connection.requireProxy()
export const requireSessionTools = (sessionId?: string) => runtime.connection.requireSessionTools(sessionId)
export const requireBotClient = () => runtime.connection.requireBotClient()

export const stopConnectionRecovery = () => runtime.connection.stopRecovery().catch(() => undefined)

export const useAppStore = create<AppState>((set, get) => ({
  ...createConnectionActions({ set, get, runtime }),
  ...createSessionActions({ set, get, runtime }),
  ...createPromptActions({ set, get, runtime }),
  ...createSessionEventActions({ set, get, runtime }),
  ...createAccountActions({ set, get }),
  ...createPreferenceActions({ set, get }),
  ...createScheduleActions({
    set,
    get,
    runtime,
    getConnectionGeneration: () => runtime.connectionGeneration,
  }),
  ...createWorkspaceActions({
    set, get, connection: runtime.connection,
    getConnectionGeneration: () => runtime.connectionGeneration,
    closeActiveCursorStream: notifyRemote => runtime.closeActiveCursorStream(notifyRemote),
  }),
  bootPhase: 'loading',
  devices: [],
  connection: disconnected,
  connectionProbeOrder: [],
  codexAvailable: false,
  cursorAvailable: false,
  antigravityAvailable: false,
  piAvailable: false,
  opencodeAvailable: false,
  claudeAvailable: false,
  hermesAvailable: false,
  workspaceCatalog: undefined,
  workspaces: [],
  favoriteWorkspaces: [],
  recentWorkspaces: [],
  archivedSessionIds: [],
  pinnedSessionIds: [],
  sessions: [],
  currentWorkSessionIds: [],
  messages: {},
  sessionLifecycles: {},
  sessionProjectionSeqs: {},
  feedbackBySession: {},
  modelSelecting: false,
  permissionSelecting: false,
  agentPresetOptions: undefined,
  agentPresetLoading: false,
  agentPresetSelecting: false,
  historyHasMore: false,
  historyLoadingOlder: false,
  previewImageUri: undefined,
  setPreviewImageUri(uri?: string) {
    set({ previewImageUri: uri })
  },
  scheduleTasks: [],
  scheduleLoading: false,
  scheduleError: undefined,
  transportPreference: 'auto',
  languagePreference: 'system',
  language: getActiveLanguage(),
  compactHistory: false,
  themePreference: 'system',
  typographyDensity: 'compact',
  statusBarVisible: true,
  defaultPermissionPreset: 'default',
  authPhase: 'idle',
  refreshing: false,
  reauthRequired: false,
  clearError() {
    set({ error: undefined })
  },
}))

export const readToolHistoryDetail = async (params: {threadId: string; detailId: string}, signal: AbortSignal): Promise<unknown> => {
  return runtime.connection.requireCodex().request('dsh/historyDetail', params, signal)
}

export const chatImageConnectionGeneration = () => runtime.connectionGeneration

/** A renderer cannot carry a Host/session image request across navigation or reconnection. */
export function sessionChatImageLoader(session: RemoteSession) {
  const generation = runtime.connectionGeneration
  const proxy = runtime.connection.requireProxy()
  return createChatImageLoader({
    sessionId: session.sessionId,
    assertCurrent: () => {
      const state = useAppStore.getState()
      if (runtime.connectionGeneration !== generation || state.connection.phase !== 'connected'
        || runtime.connection.requireProxy() !== proxy
        || state.selectedSession?.sessionId !== session.sessionId) throw new Error('Image connection expired')
    },
    attachment: (sessionId, attachmentId, signal) => {
      if (session.backend === 'codex') {
        return runtime.connection.requireCodex().request('dsh/sessionAttachment', {
          threadId: sessionId.replace(/^codex:/u, ''), attachmentId,
        }, signal)
      }
      if (session.backend !== undefined && session.backend !== 'harness') throw new Error('Image attachment unavailable')
      return runtime.connection.readSessionImageAttachment(sessionId, attachmentId, signal)
    },
    workspace: (path, signal) => {
      if (session.backend === 'codex' || session.backend === 'claude' || session.backend === 'hermes') throw new Error('Image preview unavailable')
      return loadWorkspacePreview(runtime.connection.requireSessionTools(session.sessionId), session.sessionId, path, 'image', signal)
    },
  })
}
