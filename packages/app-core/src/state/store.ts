import { isAcpManagedBackend } from '../lib/workspace-key'
import { chatImageAttachmentReference, createChatImageLoader } from '../services/chat-image-loader'
import { cursorNativeId, foldAcpHistory, readAcpHistory } from '../services/cursor'
import { loadWorkspacePreview } from '../services/workspace-file-preview'
import type { RemoteSession } from '../types'
import { create } from 'zustand'
import { getActiveLanguage } from '../locales/i18n'
import { DEFAULT_CHAT_APPEARANCE } from '../ui/theme'
import { createAccountActions } from './account-actions'
import { createConnectionActions } from './connection-actions'
import { createPreferenceActions } from './preference-actions'
import { createPromptActions } from './prompt-actions'
import { createScheduleActions } from './schedule-actions'
import { acpClientForBackend, createSessionActions, hasAcpBackendFor } from './session-actions'
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
export const requireConnectionRpc = () => runtime.connection.createRpcCaller()
export const getConnectionGeneration = () => runtime.connectionGeneration

export const stopConnectionRecovery = () => runtime.connection.stopRecovery().catch(() => undefined)

export const useAppStore = create<AppState>((set, get) => ({
  ...createConnectionActions({ set, get, runtime }),
  ...createSessionActions({ set, get, runtime }),
  ...createPromptActions({ set, get, runtime }),
  ...createSessionEventActions({ set, get, runtime }),
  ...createAccountActions({ set, get }),
  ...createPreferenceActions({ set, get, runtime }),
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
  hostSessionEvents: false,
  codexAvailable: false,
  cursorAvailable: false,
  antigravityAvailable: false,
  piAvailable: false,
  opencodeAvailable: false,
  claudeAvailable: false,
  hermesAvailable: false,
  customAcpBackends: [],
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
  chatAppearance: { ...DEFAULT_CHAT_APPEARANCE },
  activityDockMode: 'compact',
  drawerLayoutMode: 'compact',
  quickPromptActionMode: 'fill',
  busySendMode: 'queue',
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
    attachment: async (sessionId, image, signal) => {
      if (session.backend === 'codex') {
        if (image.attachmentId === undefined) throw new Error('Image attachment unavailable')
        return runtime.connection.requireCodex().request('dsh/sessionAttachment', {
          threadId: sessionId.replace(/^codex:/u, ''), attachmentId: image.attachmentId,
        }, signal)
      }
      if (isAcpManagedBackend(session.backend)) {
        if (image.attachmentId === undefined || !hasAcpBackendFor(runtime.connection, session.backend)) {
          throw new Error('Image attachment unavailable')
        }
        const acpClient = acpClientForBackend(runtime.connection, session.backend)
        const nativeId = cursorNativeId(session)
        let events: unknown[] = []
        if (typeof acpClient.loadSessionDetails === 'function') {
          events = (await readAcpHistory(acpClient, nativeId, session.backend, signal)).events
        } else {
          const result = await acpClient.transferCall('dsh/sessionHistory', { sessionId: nativeId, backend: session.backend }, signal)
          if (typeof result === 'object' && result !== null && Array.isArray((result as { events?: unknown }).events)) {
            events = (result as { events: unknown[] }).events
          }
        }
        for (const item of foldAcpHistory(events, session.sessionId)) {
          if (item.kind !== 'message' && item.kind !== 'tool') continue
          for (const candidate of item.images ?? []) {
            if (candidate.attachmentId !== image.attachmentId || !candidate.uri?.startsWith('data:')) continue
            const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/u.exec(candidate.uri)
            if (!match) continue
            return {
              attachment: {
                attachmentId: image.attachmentId,
                mediaType: candidate.mediaType ?? match[1],
                ...(candidate.bytes !== undefined ? { bytes: candidate.bytes } : {}),
                ...(candidate.width !== undefined ? { width: candidate.width } : {}),
                ...(candidate.height !== undefined ? { height: candidate.height } : {}),
                ...(candidate.name !== undefined ? { name: candidate.name } : {}),
              },
              data: match[2],
            }
          }
        }
        throw new Error('Image attachment unavailable')
      }
      if (session.backend !== undefined && session.backend !== 'harness') throw new Error('Image attachment unavailable')
      return runtime.connection.readSessionImageAttachment(sessionId, chatImageAttachmentReference(image), signal)
    },
    workspace: (path, signal) => {
      if (session.backend === 'codex') throw new Error('Image preview unavailable')
      return loadWorkspacePreview(runtime.connection.requireSessionTools(session.sessionId), session.sessionId, path, 'image', signal)
    },
  })
}
