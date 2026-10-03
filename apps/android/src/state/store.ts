import * as Haptics from 'expo-haptics'
import { create } from 'zustand'
import {
  createCodexTimelineState,
  projectCodexThread,
  reduceCodexTimelineFrame,
  type AcpStream,
  type CodexStream,
  type CodexTimelineState,
} from '@dsh-remote/client-core'
import type { AgentAcpFrameData } from '@dsh-remote/protocol'
import {
  applyLanguagePreference,
  getActiveLanguage,
  strings as zhCN,
  updateSystemLocales,
  type AppLanguage,
  type LanguagePreference,
} from '../locales/i18n'
import { friendlyError, isRecoverableTransportError, isRpcTimeoutError, isSessionAuthError } from '../lib/errors'
import { initialProbeTransports } from '../lib/network-route'
import {
  loginFlow,
  oauthLoginChannel,
  passwordLoginChannel,
  redirectLoginChannelFor,
  githubOAuthLoginChannel,
  type LoginOutcome,
} from '../services/login'
import type { ChatMessage, RedirectLoginMethod } from '../types'
import { createNativeRpcId } from '../services/api-proxy'
import { forkMessage } from '../services/message-actions'
import {
  codexItemsToChat,
  codexPermissionPreset,
  codexPermissionPresetFromResponse,
  createCodexWorkspace,
  codexSession,
  codexThreadId,
  isCodexPermissionPreset,
  loadCodexCatalog,
  loadCodexModels,
  mergeCodexLive,
  readCodexHistoryPage,
  readCodexSession,
  updateCodexSession,
  withCodexPermission,
} from '../services/codex'
import {
  applyCursorFrame,
  createAntigravitySession,
  createAntigravityWorkspace,
  createCursorSession,
  createCursorWorkspace,
  cursorNativeId,
} from '../services/cursor'
import { AndroidRemoteConnection } from '../services/connection'
import { reconcileTrustedDevices } from '../services/device-directory'
import { resolveAutomaticPreferredTransports } from '../services/network-route'
import { serverSession } from '../services/server-session'
import { resolveAutoConnectDevice } from '../lib/auto-connect'
import { workspaceStableKey } from '../lib/workspace-key'
import {
  clearLocalData,
  clearCodexPermissionPresets,
  clearDeviceCredentials,
  clearLastConnectedDeviceId,
  forgetHost,
  loadFavoriteWorkspaces,
  loadLastConnectedDeviceId,
  loadOrCreateIdentity,
  loadLanguagePreference,
  loadCodexPermissionPresets,
  loadRecentWorkspaces,
  loadServerConfig,
  loadThemePreference,
  loadTransportPreference,
  loadTrustedHosts,
  saveFavoriteWorkspaces,
  saveLanguagePreference,
  saveLastConnectedDeviceId,
  saveRecentWorkspaces,
  saveCodexPermissionPreset,
  saveServerConfig,
  saveThemePreference,
  saveTransportPreference,
  trustHost,
} from '../services/storage'
import type { ThemePreference } from '../ui/theme'
import type {
  AgentPresetOption,
  ChatItem,
  CodexPermissionPreset,
  ConnectionProbeTransport,
  ConnectionNetworkDetails,
  ConnectionStage,
  ConnectionSnapshot,
  DeviceIdentity,
  WorkspaceShortcut,
  HistoryEntry,
  HostDescriptor,
  ModelSelection,
  MuxStreamFrame,
  PromptImage,
  RemoteDevice,
  RemoteSession,
  ServerConfig,
  SessionModels,
  TransportPreference,
  WorkspaceList,
  WorkspaceView,
} from '../types'
import { foldHistory, applyMuxFrameToMessages, sessionRunningForMuxFrame } from './event-reducer'
import { findApproval, findQuestion, mapApprovalOutcome, mapQuestionAnswered, mergeHistoryAndLive, oldestSeq, prependHistory } from './message-helpers'

function applyFeedback(items: ChatItem[], ratings?: Map<string, ChatMessage['feedback']>): ChatItem[] {
  return ratings === undefined ? items : items.map(item => item.kind === 'message'
    ? { ...item, feedback: ratings.get(item.id) } : item)
}

type BootPhase = 'loading' | 'ready' | 'error'
type AuthPhase = 'idle' | 'authenticating' | 'complete' | 'error'

interface AppState {
  bootPhase: BootPhase
  config?: ServerConfig
  identity?: DeviceIdentity
  account?: string
  devices: RemoteDevice[]
  selectedDevice?: RemoteDevice
  connection: ConnectionSnapshot
  connectionStage?: ConnectionStage
  connectionProbeOrder: ConnectionProbeTransport[]
  connectionNetworkDetails?: ConnectionNetworkDetails
  hostDescriptor?: HostDescriptor
  codexAvailable: boolean
  cursorAvailable: boolean
  antigravityAvailable: boolean
  workspaces: WorkspaceView[]
  favoriteWorkspaces: WorkspaceShortcut[]
  /** Newest first; the home screen falls back to these when Favorites is empty. */
  recentWorkspaces: WorkspaceShortcut[]
  archivedSessionIds: string[]
  sessions: RemoteSession[]
  selectedSession?: RemoteSession
  messages: Record<string, ChatItem[]>
  feedbackBySession: Record<string, Map<string, ChatMessage['feedback']>>
  sessionModels?: SessionModels
  modelSelecting: boolean
  permissionSelecting: boolean
  agentPresetOptions?: AgentPresetOption[]
  agentPresetLoading: boolean
  agentPresetSelecting: boolean
  historyHasMore: boolean
  historyLoadingOlder: boolean
  oldestLoadedSeq?: number
  transportPreference: TransportPreference
  languagePreference: LanguagePreference
  language: AppLanguage
  themePreference: ThemePreference
  pendingOAuthBaseUrl?: string
  pendingOAuthLoginMethod?: RedirectLoginMethod
  authPhase: AuthPhase
  refreshing: boolean
  busyAction?: string
  error?: string
  commandResult?: { sessionId: string; text: string }
  /** Remembered host from the last successful connect (persisted). */
  lastConnectedDeviceId?: string
  /**
   * Set during bootstrap when that host is trusted + online. Retained for the
   * auto-connect entry point; boot routing currently lands on the device list.
   */
  pendingAutoConnectDeviceId?: string
  /** True when credentials are invalid and the UI should show the sign-in screen. */
  reauthRequired: boolean

  bootstrap(): Promise<void>
  requireReauth(message?: string): Promise<void>
  consumePendingAutoConnect(): string | undefined
  configureServer(input: string, email: string, password: string): Promise<boolean>
  startOAuth(input: string): Promise<string | undefined>
  startGithubOAuth(input: string): Promise<string | undefined>
  completeOAuth(token: string): Promise<boolean>
  refreshDevices(): Promise<void>
  refreshWorkspaces(): Promise<void>
  refreshConnectionNetworkDetails(): Promise<void>
  trustDevice(device: RemoteDevice): Promise<boolean>
  forgetDevice(deviceId: string): Promise<boolean>
  connectDevice(device: RemoteDevice, options?: { forceRelay?: boolean }): Promise<boolean>
  reconnect(options?: { forceRelay?: boolean }): Promise<boolean>
  disconnect(): Promise<void>
  openSession(session: RemoteSession): Promise<boolean>
  sendMessage(text: string, images?: PromptImage[]): Promise<boolean>
  forkChatMessage(message: ChatMessage): Promise<boolean>
  rateMessage(message: ChatMessage, rating: 'positive' | 'negative'): Promise<boolean>
  stopSession(): Promise<void>
  respondApproval(itemId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>
  respondQuestion(itemId: string, selected: Record<string, string[]>): Promise<void>
  createSession(workspaceId?: string): Promise<boolean>
  archiveSession(sessionId: string): Promise<boolean>
  selectModel(selection: ModelSelection): Promise<boolean>
  selectPermission(preset: string): Promise<boolean>
  loadAgentPresets(): Promise<boolean>
  selectAgentPreset(preset: string): Promise<boolean>
  loadOlderHistory(): Promise<void>
  workspaceCreate(path: string, backend?: 'harness' | 'codex' | 'cursor' | 'antigravity'): Promise<WorkspaceView | undefined>
  workspaceRename(workspaceId: string, title: string): Promise<boolean>
  workspaceDelete(workspaceId: string): Promise<boolean>
  workspaceMove(workspaceId: string, beforeWorkspaceId?: string): Promise<boolean>
  /** Toggle the home-screen shortcut for a workspace; resolves to its new favorited state. */
  toggleFavoriteWorkspace(workspace: WorkspaceView): Promise<boolean>
  removeFavoriteWorkspace(deviceId: string, key: string): Promise<boolean>
  /** Open the most recently updated conversation of a saved workspace; undefined when it has none. */
  openFavoriteWorkspaceSession(key: string): Promise<RemoteSession | undefined>
  hostListDirectory(path?: string): Promise<import('../types').DirectoryListing | undefined>
  setTransportPreference(preference: TransportPreference): Promise<void>
  setLanguagePreference(preference: LanguagePreference): Promise<void>
  setThemePreference(preference: ThemePreference): Promise<void>
  syncSystemLocales(localeTags: readonly string[]): void
  resetLocalData(): Promise<void>
  signOut(): Promise<void>
  setOffline(): void
  clearError(): void
  handleMuxFrame(frame: MuxStreamFrame): void
  handleCodexFrame(frame: { method: string; params: unknown }): void
  handleCursorFrame(frame: AgentAcpFrameData): void
}

const disconnected: ConnectionSnapshot = {
  phase: 'disconnected',
  stats: { mode: 'Disconnected', connected: false },
}

const connection = new AndroidRemoteConnection()

/** Only exposes the authenticated native carrier of the current connection. */
export const requireSessionTools = () => connection.requireSessionTools()
let activeCodexStream: CodexStream | undefined
let activeCodexTimeline: CodexTimelineState | undefined
let activeCursorStream: AcpStream | undefined
const codexModelSelections = new Map<string, ModelSelection>()

export const useAppStore = create<AppState>((set, get) => ({
  bootPhase: 'loading',
  devices: [],
  connection: disconnected,
  connectionProbeOrder: [],
  codexAvailable: false,
  cursorAvailable: false,
  antigravityAvailable: false,
  workspaces: [],
  favoriteWorkspaces: [],
  recentWorkspaces: [],
  archivedSessionIds: [],
  sessions: [],
  messages: {},
  feedbackBySession: {},
  modelSelecting: false,
  permissionSelecting: false,
  agentPresetOptions: undefined,
  agentPresetLoading: false,
  agentPresetSelecting: false,
  historyHasMore: false,
  historyLoadingOlder: false,
  transportPreference: 'auto',
  languagePreference: 'system',
  language: getActiveLanguage(),
  themePreference: 'system',
  // Keep process rows available on a fresh install; their own disclosures
  // start closed so the conversation still opens at the answer.
  authPhase: 'idle',
  refreshing: false,
  reauthRequired: false,

  async bootstrap() {
    set({ bootPhase: 'loading', error: undefined, pendingAutoConnectDeviceId: undefined, reauthRequired: false })
    try {
      const [config, identity, transportPreference, languagePreference, themePreference, favoriteWorkspaces, recentWorkspaces, lastConnectedDeviceId] = await Promise.all([
        loadServerConfig(),
        loadOrCreateIdentity(),
        loadTransportPreference(),
        loadLanguagePreference(),
        loadThemePreference(),
        loadFavoriteWorkspaces(),
        loadRecentWorkspaces(),
        loadLastConnectedDeviceId(),
      ])
      const language = applyLanguagePreference(languagePreference)
      set({
        config,
        identity,
        account: config?.account,
        transportPreference,
        languagePreference,
        language,
        themePreference,
        favoriteWorkspaces,
        recentWorkspaces,
        lastConnectedDeviceId,
      })
      let pendingAutoConnectDeviceId: string | undefined
      if (config !== undefined) {
        await get().refreshDevices()
        if (!get().reauthRequired) {
          // Resolved but intentionally not routed on boot: the home screen is the
          // device list, and connecting stays an explicit user choice.
          pendingAutoConnectDeviceId = resolveAutoConnectDevice(get().devices, lastConnectedDeviceId)?.deviceId
        }
      }
      set({ bootPhase: 'ready', pendingAutoConnectDeviceId })
    } catch (error) {
      set({ bootPhase: 'error', error: friendlyError(error) })
    }
  },

  async requireReauth(message) {
    await get().disconnect()
    await clearDeviceCredentials()
    const config = get().config
    const nextConfig = config === undefined
      ? undefined
      : { baseUrl: config.baseUrl, ...(config.loginMethod === undefined ? {} : { loginMethod: config.loginMethod }) }
    if (nextConfig !== undefined) await saveServerConfig(nextConfig)
    set({
      config: nextConfig,
      account: undefined,
      devices: [],
      pendingAutoConnectDeviceId: undefined,
      refreshing: false,
      busyAction: undefined,
      reauthRequired: true,
      error: message,
    })
  },

  async configureServer(input, email, password) {
    set({ busyAction: passwordLoginChannel.busyAction, error: undefined })
    try {
      const identity = get().identity
      if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
      const context = await loginFlow.createContext(input, identity)
      const outcome = await loginFlow.signInWith(passwordLoginChannel, context, { email, password })
      return await finalizeLogin(get, set, context.baseUrl, outcome)
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async startOAuth(input) {
    set({ busyAction: oauthLoginChannel.prepareBusyAction, error: undefined })
    try {
      const identity = get().identity
      if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
      const context = await loginFlow.createContext(input, identity)
      set({ pendingOAuthBaseUrl: context.baseUrl, pendingOAuthLoginMethod: 'oauth', busyAction: undefined })
      return await loginFlow.prepareRedirect(oauthLoginChannel, context)
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return undefined
    }
  },

  async startGithubOAuth(input) {
    set({ busyAction: githubOAuthLoginChannel.prepareBusyAction, error: undefined })
    try {
      const identity = get().identity
      if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
      const context = await loginFlow.createContext(input, identity)
      set({
        pendingOAuthBaseUrl: context.baseUrl,
        pendingOAuthLoginMethod: 'github-oauth',
        busyAction: undefined,
      })
      return await loginFlow.prepareRedirect(githubOAuthLoginChannel, context)
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return undefined
    }
  },

  async completeOAuth(token) {
    const baseUrl = get().pendingOAuthBaseUrl
    const loginMethod = get().pendingOAuthLoginMethod
    const channel = redirectLoginChannelFor(loginMethod)
    if (baseUrl === undefined || token.length < 16) {
      set({ pendingOAuthBaseUrl: undefined, pendingOAuthLoginMethod: undefined })
      return false
    }
    set({ pendingOAuthBaseUrl: undefined, pendingOAuthLoginMethod: undefined })
    set({ busyAction: channel.completeBusyAction, error: undefined })
    try {
      const identity = get().identity
      if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
      const context = await loginFlow.createContext(baseUrl, identity)
      const outcome = await loginFlow.completeRedirect(channel, context, token)
      return await finalizeLogin(get, set, context.baseUrl, outcome)
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async refreshDevices() {
    const { config, identity } = get()
    if (config === undefined || identity === undefined) return
    set({ refreshing: true })
    try {
      const trusted = await loadTrustedHosts()
      const { api } = await serverSession.authenticate(config.baseUrl, identity)
      const result = await reconcileTrustedDevices(api, trusted)
      await Promise.all(result.missingTrustedDeviceIds.map(async deviceId => {
        await forgetHost(deviceId)
        await clearCodexPermissionPresets(deviceId)
      }))
      set({ devices: result.devices, refreshing: false })
    } catch (error) {
      if (isSessionAuthError(error)) {
        await get().requireReauth(friendlyError(error))
        return
      }
      set({ refreshing: false, error: friendlyError(error) })
    }
  },

  async refreshWorkspaces() {
    if (get().connection.phase !== 'connected') return
    try {
      const proxy = connection.requireProxy()
      const [workspaceList, sessions] = await Promise.all([
        proxy.workspaceList(),
        proxy.sessionList(),
      ])
      let codexCatalog = { workspaces: [] as WorkspaceView[], sessions: [] as RemoteSession[] }
      let codexError: string | undefined
      if (connection.hasCodex()) {
        try {
          codexCatalog = await loadCodexCatalog(connection.requireCodex())
        } catch (error) {
          codexError = friendlyError(error)
        }
      }
      const savedCodexPermissions = await loadSavedCodexPermissions(get().selectedDevice?.deviceId)
      set(state => {
        const codexWorkspaces = codexError === undefined
          ? codexCatalog.workspaces
          : state.workspaces.filter(workspace => workspace.backend === 'codex')
        const catalogSessions = codexError === undefined
          ? codexCatalog.sessions
          : state.sessions.filter(session => session.backend === 'codex')
        const codexSessions = catalogSessions.map(session => {
          const previous = state.sessions.find(item => item.sessionId === session.sessionId)
            ?? (state.selectedSession?.sessionId === session.sessionId ? state.selectedSession : undefined)
          return withBestCodexPermission(session, previous, savedCodexPermissions)
        })
        const cursorWorkspaces = state.workspaces.filter(workspace => workspace.backend === 'cursor')
        const antigravityWorkspaces = state.workspaces.filter(workspace => workspace.backend === 'antigravity')
        const cursorSessions = state.sessions.filter(session => session.backend === 'cursor')
        const antigravitySessions = state.sessions.filter(session => session.backend === 'antigravity')
        const combinedSessions = [...sessions, ...codexSessions, ...cursorSessions, ...antigravitySessions]
        return {
          workspaces: [...workspaceList.items, ...codexWorkspaces, ...cursorWorkspaces, ...antigravityWorkspaces],
          archivedSessionIds: workspaceList.archivedSessionIds,
          sessions: combinedSessions,
          selectedSession: state.selectedSession === undefined
            ? undefined
            : combinedSessions.find(session => session.sessionId === state.selectedSession?.sessionId) ?? state.selectedSession,
          ...(codexError === undefined ? {} : { error: codexError }),
        }
      })
    } catch (error) {
      set({ error: friendlyError(error) })
    }
  },

  async trustDevice(device) {
    if (device.identityKey.length === 0) return false
    await trustHost(device)
    set(state => ({
      devices: state.devices.map(item => item.deviceId === device.deviceId ? { ...item, trusted: true } : item),
    }))
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    return true
  },

  async connectDevice(device, options = {}) {
    const { config, identity } = get()
    if (config === undefined || identity === undefined) return false
    // Cursor sessions live only in Client memory (no Host catalog). Keep them
    // across reconnect so the open chat and workspace list survive.
    set(state => ({
      selectedDevice: device,
      connection: { phase: 'connecting', stats: { mode: 'Disconnected', connected: false } },
      connectionStage: 'authenticating',
      connectionProbeOrder: [],
      connectionNetworkDetails: undefined,
      hostDescriptor: undefined,
      codexAvailable: false,
      cursorAvailable: false,
      antigravityAvailable: false,
      workspaces: state.workspaces.filter(workspace => workspace.backend === 'cursor' || workspace.backend === 'antigravity'),
      sessions: state.sessions.filter(session => session.backend === 'cursor' || session.backend === 'antigravity'),
      archivedSessionIds: [],
      sessionModels: undefined,
      error: undefined,
    }))
    try {
      await closeActiveCodexStream(false)
      await closeActiveCursorStream(false)
      const { api, credentials } = await serverSession.authenticate(config.baseUrl, identity)
      const preference = get().transportPreference
      const forceRelay = options.forceRelay === true || preference === 'relay'
      const preferredTransports = forceRelay
        ? ['relay'] as const
        : preference === 'turn'
          ? ['turn', 'relay'] as const
          : await resolveAutomaticPreferredTransports()
      set({ connectionStage: 'transport', connectionProbeOrder: initialProbeTransports(preferredTransports) })
      await connection.connect(
        config.baseUrl,
        identity,
        device,
        credentials.accessToken,
        frame => get().handleMuxFrame(frame),
        {
          fetchIceServers: async connectionId => api.turnCredentials(connectionId),
          preferredTransports: [...preferredTransports],
          forceRelay,
          onSecureHandshake: () => set(state => ({
            connectionStage: 'secure',
            connection: {
              ...state.connection,
              stats: connection.getStats() ?? state.connection.stats,
            },
          })),
          onClose: () => {
            // Drop local Cursor/CodeX stream handles immediately. The underlying
            // RemoteClientCore is already gone; keeping them makes the next
            // prompt skip openStream and never receive agent.acp.frame events.
            void closeActiveCodexStream(false)
            void closeActiveCursorStream(false)
            if (get().connection.phase === 'connected' || get().connection.phase === 'reconnecting') {
              set({
                connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.hostClosed },
                codexAvailable: false,
                cursorAvailable: false,
                antigravityAvailable: false,
              })
            }
          },
        },
      )
      set({ connectionStage: 'loading' })
      const proxy = connection.requireProxy()
      const [hostDescriptor, workspaceList, sessions] = await Promise.all([
        proxy.hostDescribe(),
        proxy.workspaceList(),
        proxy.sessionList(),
      ])
      let codexCatalog = { workspaces: [] as WorkspaceView[], sessions: [] as RemoteSession[] }
      let codexError: string | undefined
      if (connection.hasCodex()) {
        try {
          codexCatalog = await loadCodexCatalog(connection.requireCodex())
        } catch (error) {
          codexError = friendlyError(error)
        }
      }
      const savedCodexPermissions = await loadSavedCodexPermissions(device.deviceId)
      const connectionNetworkDetails = await connection.getNetworkDetails().catch(() => undefined)
      set(state => {
        const codexSessions = codexCatalog.sessions.map(session => {
          const previous = state.sessions.find(item => item.sessionId === session.sessionId)
            ?? (state.selectedSession?.sessionId === session.sessionId ? state.selectedSession : undefined)
          return withBestCodexPermission(session, previous, savedCodexPermissions)
        })
        const cursorWorkspaces = state.workspaces.filter(workspace => workspace.backend === 'cursor')
        const antigravityWorkspaces = state.workspaces.filter(workspace => workspace.backend === 'antigravity')
        const cursorSessions = state.sessions.filter(session => session.backend === 'cursor')
        const antigravitySessions = state.sessions.filter(session => session.backend === 'antigravity')
        const combinedSessions = [...sessions, ...codexSessions, ...cursorSessions, ...antigravitySessions]
        const selectedSession = state.selectedSession === undefined
          ? undefined
          : combinedSessions.find(session => session.sessionId === state.selectedSession?.sessionId)
            ?? (state.selectedSession.backend === 'cursor' || state.selectedSession.backend === 'antigravity' ? state.selectedSession : undefined)
        return {
          hostDescriptor,
          codexAvailable: connection.hasCodex(),
          cursorAvailable: connection.hasCursor(),
          antigravityAvailable: connection.hasAntigravity(),
          workspaces: [...workspaceList.items, ...codexCatalog.workspaces, ...cursorWorkspaces, ...antigravityWorkspaces],
          archivedSessionIds: workspaceList.archivedSessionIds,
          sessions: combinedSessions,
          selectedSession,
          connectionStage: 'ready',
          connectionNetworkDetails,
          lastConnectedDeviceId: device.deviceId,
          pendingAutoConnectDeviceId: undefined,
          connection: { phase: 'connected', stats: connection.getStats() ?? { mode: 'Relay', connected: true } },
          ...(codexError === undefined ? {} : { error: codexError }),
        }
      })
      await saveLastConnectedDeviceId(device.deviceId)
      // Re-bind ACP stream after the secure channel is back so live frames resume
      // without requiring a fresh openSession tap.
      const resumed = get().selectedSession
      if ((resumed?.backend === 'cursor' && connection.hasCursor()) || (resumed?.backend === 'antigravity' && connection.hasAntigravity())) {
        await ensureCursorStream(resumed).catch(() => undefined)
      }
      return true
    } catch (error) {
      await connection.close()
      if (isSessionAuthError(error)) {
        await get().requireReauth(friendlyError(error))
        return false
      }
      const message = friendlyError(error)
      set({
        connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: message },
        codexAvailable: false,
        cursorAvailable: false,
        antigravityAvailable: false,
        error: message,
      })
      return false
    }
  },

  consumePendingAutoConnect() {
    const deviceId = get().pendingAutoConnectDeviceId
    if (deviceId !== undefined) set({ pendingAutoConnectDeviceId: undefined })
    return deviceId
  },

  async reconnect(options = {}) {
    const device = get().selectedDevice
    const phase = get().connection.phase
    if (device === undefined || phase === 'connecting' || phase === 'reconnecting') return false
    set(state => ({ connection: { ...state.connection, phase: 'reconnecting', error: undefined } }))
    return get().connectDevice(device, options)
  },

  async refreshConnectionNetworkDetails() {
    if (get().connection.phase !== 'connected') return
    const details = await connection.getNetworkDetails().catch(() => undefined)
    if (details !== undefined && get().connection.phase === 'connected') {
      set(state => ({
        connectionNetworkDetails: details,
        connection: { ...state.connection, stats: connection.getStats() ?? state.connection.stats },
      }))
    }
  },

  async disconnect() {
    await closeActiveCodexStream(false)
    await closeActiveCursorStream(false)
    await connection.close()
    codexModelSelections.clear()
    set({
      connection: disconnected,
      connectionStage: undefined,
      connectionProbeOrder: [],
      connectionNetworkDetails: undefined,
      selectedDevice: undefined,
      hostDescriptor: undefined,
      codexAvailable: false,
      cursorAvailable: false,
      workspaces: [],
      archivedSessionIds: [],
      sessions: [],
      selectedSession: undefined,
      sessionModels: undefined,
      historyHasMore: false,
      historyLoadingOlder: false,
      oldestLoadedSeq: undefined,
    })
  },

  async openSession(session) {
    set({ busyAction: `session:${session.sessionId}`, error: undefined })
    const load = async () => {
      if (session.backend === 'codex') {
        await closeActiveCodexStream()
        await closeActiveCursorStream()
        const client = connection.requireCodex()
        const threadId = codexThreadId(session)
        const savedPermissions = await loadSavedCodexPermissions(get().selectedDevice?.deviceId)
        const sessionWithPermission = withBestCodexPermission(session, undefined, savedPermissions)
        const permission = codexPermissionPreset(sessionWithPermission)
        const [read, history] = await Promise.all([
          readCodexSession(client, threadId, permission),
          readCodexHistoryPage(client, threadId),
        ])
        const timeline = createCodexTimelineState({ ...read.thread, turns: [] })
        if (timeline === undefined) throw new Error(zhCN.runtime.codexInvalidResponse)
        activeCodexTimeline = withActiveCodexTurn(timeline, history.activeTurnId)
        const stream = await client.subscribe(
          threadId,
          frame => get().handleCodexFrame(frame),
          undefined,
          reason => {
            if (activeCodexTimeline?.session.nativeId !== threadId) return
            activeCodexStream = undefined
            activeCodexTimeline = undefined
            set(state => ({
              sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
              selectedSession: state.selectedSession?.sessionId === session.sessionId
                ? { ...state.selectedSession, running: false }
                : state.selectedSession,
              ...(reason === 'failed' ? { error: zhCN.runtime.codexUnavailable } : {}),
            }))
          },
        )
        activeCodexStream = stream
        const items = foldHistory(history.events, session.sessionId, true)
        const nextSession = {
          ...sessionWithPermission,
          ...read.session,
          ...(history.activeTurnId === undefined ? {} : { running: true }),
        }
        set(state => ({
          selectedSession: nextSession,
          sessions: state.sessions.map(item => item.sessionId === session.sessionId ? nextSession : item),
          messages: {
            ...state.messages,
            [session.sessionId]: mergeHistoryAndLive(items, state.messages[session.sessionId] ?? []),
          },
          historyHasMore: history.hasMore,
          oldestLoadedSeq: oldestSeq(history.events),
          busyAction: undefined,
        }))
        void refreshCodexModels(session.sessionId)
        return
      }
      if (session.backend === 'cursor' || session.backend === 'antigravity') {
        await closeActiveCodexStream()
        await ensureCursorStream(session)
        set(state => ({
          selectedSession: session,
          sessions: state.sessions.some(item => item.sessionId === session.sessionId)
            ? state.sessions.map(item => item.sessionId === session.sessionId ? session : item)
            : [session, ...state.sessions],
          messages: {
            ...state.messages,
            [session.sessionId]: state.messages[session.sessionId] ?? [],
          },
          sessionModels: undefined,
          historyHasMore: false,
          oldestLoadedSeq: undefined,
          busyAction: undefined,
        }))
        return
      }
      await closeActiveCodexStream()
      await closeActiveCursorStream()
      const [history, feedback] = await Promise.all([
        connection.requireProxy().sessionHistory(session.sessionId),
        // Older carriers may not expose feedback; history must remain usable.
        connection.requireProxy().messageFeedbackList(session.sessionId).catch(() => undefined),
      ])
      const ratings = feedback === undefined ? undefined : new Map(feedback.map(row => [row.messageId, row.rating]))
      const items = foldHistory(history.events, session.sessionId, true)
      set(state => ({
        selectedSession: session,
        historyLoadingOlder: false,
        feedbackBySession: ratings === undefined ? state.feedbackBySession : { ...state.feedbackBySession, [session.sessionId]: ratings },
        messages: {
          ...state.messages,
          [session.sessionId]: applyFeedback(mergeHistoryAndLive(items, state.messages[session.sessionId] ?? []), ratings),
        },
        historyHasMore: history.hasMore,
        oldestLoadedSeq: oldestSeq(history.events),
        busyAction: undefined,
      }))
      void refreshSessionModels(session.sessionId)
    }
    try {
      await load()
      await rememberRecentWorkspace(session)
      return true
    } catch (error) {
      if (isRpcTimeoutError(error) || isRecoverableTransportError(error)) {
        // session.history is read-only, so it is safe to recover the stale
        // path with a fresh Relay-only connection and retry exactly once.
        // Mutating ApiProxy calls deliberately do not use this path because a
        // timeout leaves their result unknown.
        const recovered = await get().reconnect({ forceRelay: true })
        if (recovered) {
          try {
            await load()
            await rememberRecentWorkspace(session)
            return true
          } catch (retryError) {
            set({ busyAction: undefined, error: friendlyError(retryError) })
            return false
          }
        }
        set({ busyAction: undefined })
        return false
      }
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async forkChatMessage(message) {
    if (get().connection.phase !== 'connected' || get().busyAction !== undefined || get().selectedSession?.backend === 'codex') return false
    set({ busyAction: `fork:${message.id}`, error: undefined })
    try {
      const result = await forkMessage(message, connection.requireProxy())
      set({ sessions: result.sessions, workspaces: result.workspaces, busyAction: undefined })
      return await get().openSession(result.session)
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async rateMessage(message, rating) {
    if (get().connection.phase !== 'connected' || get().busyAction !== undefined || get().selectedSession?.backend === 'codex' || message.streaming) return false
    set({ busyAction: `feedback:${message.id}`, error: undefined })
    try {
      const saved = await connection.requireProxy().messageFeedbackPut(message.sessionId, message.id, rating)
      set(state => ({ busyAction: undefined,
        feedbackBySession: state.feedbackBySession[message.sessionId] === undefined ? state.feedbackBySession : {
          ...state.feedbackBySession,
          [message.sessionId]: new Map(state.feedbackBySession[message.sessionId]).set(message.id, saved.rating),
        },
        messages: { ...state.messages,
        [message.sessionId]: (state.messages[message.sessionId] ?? []).map(item => item.id === message.id && item.kind === 'message' ? { ...item, feedback: saved.rating } : item),
      } }))
      return true
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async createSession(workspaceId) {
    if (get().connection.phase !== 'connected') return false
    set({ busyAction: 'create-session', error: undefined })
    try {
      const workspace = workspaceId === undefined ? undefined : get().workspaces.find(item => item.workspaceId === workspaceId)
      if (workspace?.backend === 'codex') {
        const client = connection.requireCodex()
        const result = record(await client.request('thread/start', {
          cwd: workspace.path,
          permissionPreset: 'workspace-write',
        }))
        const display = projectCodexThread(result.thread)
        if (display === undefined) throw new Error(zhCN.runtime.codexInvalidResponse)
        const created = codexSession(display)
        set(state => ({
          sessions: [created, ...state.sessions.filter(item => item.sessionId !== created.sessionId)],
          workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
            ? { ...item, sessionIds: [created.sessionId, ...item.sessionIds.filter(id => id !== created.sessionId)] }
            : item),
          busyAction: undefined,
        }))
        return get().openSession(created)
      }
      if (workspace?.backend === 'cursor') {
        const created = await connection.requireCursor().createSession(workspace.path, 'agent', 'cursor')
        const session = createCursorSession({
          acpSessionId: created.sessionId,
          cwd: workspace.path,
          title: workspace.title,
        })
        set(state => ({
          sessions: [session, ...state.sessions.filter(item => item.sessionId !== session.sessionId)],
          workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
            ? {
                ...item,
                sessionIds: [session.sessionId, ...item.sessionIds.filter(id => id !== session.sessionId)],
                updatedAt: new Date().toISOString(),
              }
            : item),
          busyAction: undefined,
        }))
        return get().openSession(session)
      }
      if (workspace?.backend === 'antigravity') {
        const created = await connection.requireAntigravity().createSession(workspace.path, 'agent', 'antigravity')
        const session = createAntigravitySession({
          acpSessionId: created.sessionId,
          cwd: workspace.path,
          title: workspace.title,
        })
        set(state => ({
          sessions: [session, ...state.sessions.filter(item => item.sessionId !== session.sessionId)],
          workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
            ? {
                ...item,
                sessionIds: [session.sessionId, ...item.sessionIds.filter(id => id !== session.sessionId)],
                updatedAt: new Date().toISOString(),
              }
            : item),
          busyAction: undefined,
        }))
        return get().openSession(session)
      }
      const proxy = connection.requireProxy()
      const { sessionId } = await proxy.sessionCreate(workspaceId)
      const sessions = await proxy.sessionList()
      set(state => ({
        sessions,
        busyAction: undefined,
        ...(workspace === undefined ? {} : {
          workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
            ? { ...item, sessionIds: [sessionId, ...item.sessionIds.filter(id => id !== sessionId)] }
            : item),
        }),
      }))
      const created = sessions.find(session => session.sessionId === sessionId)
      if (created === undefined) return false
      return get().openSession(created)
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async archiveSession(sessionId) {
    if (get().connection.phase !== 'connected') return false
    set({ busyAction: `archive:${sessionId}`, error: undefined })
    try {
      const session = get().sessions.find(item => item.sessionId === sessionId)
      if (session?.backend === 'codex') {
        await connection.requireCodex().request('thread/archive', { threadId: codexThreadId(session) })
        if (activeCodexTimeline?.session.id === sessionId) await closeActiveCodexStream()
        set(state => ({
          sessions: state.sessions.filter(item => item.sessionId !== sessionId),
          workspaces: state.workspaces.map(workspace => ({
            ...workspace,
            sessionIds: workspace.sessionIds.filter(id => id !== sessionId),
          })),
          busyAction: undefined,
          selectedSession: state.selectedSession?.sessionId === sessionId ? undefined : state.selectedSession,
          sessionModels: state.selectedSession?.sessionId === sessionId ? undefined : state.sessionModels,
        }))
        return true
      }
      if (session?.backend === 'cursor' || session?.backend === 'antigravity') {
        if (get().selectedSession?.sessionId === sessionId) await closeActiveCursorStream()
        set(state => ({
          sessions: state.sessions.filter(item => item.sessionId !== sessionId),
          workspaces: state.workspaces.map(workspace => ({
            ...workspace,
            sessionIds: workspace.sessionIds.filter(id => id !== sessionId),
          })),
          messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => id !== sessionId)),
          busyAction: undefined,
          selectedSession: state.selectedSession?.sessionId === sessionId ? undefined : state.selectedSession,
          sessionModels: state.selectedSession?.sessionId === sessionId ? undefined : state.sessionModels,
        }))
        return true
      }
      const proxy = connection.requireProxy()
      const archivedSessionIds = await proxy.workspaceArchiveSession(sessionId)
      const sessions = await proxy.sessionList()
      set(state => ({
        archivedSessionIds,
        sessions,
        busyAction: undefined,
        workspaces: state.workspaces.map(workspace => ({
          ...workspace,
          sessionIds: workspace.sessionIds.filter(id => id !== sessionId),
        })),
        selectedSession: state.selectedSession?.sessionId === sessionId ? undefined : state.selectedSession,
        sessionModels: state.selectedSession?.sessionId === sessionId ? undefined : state.sessionModels,
      }))
      return true
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async selectModel(selection) {
    const session = get().selectedSession
    if (session === undefined || get().connection.phase !== 'connected') return false
    set({ modelSelecting: true, error: undefined })
    try {
      if (session.backend === 'codex') {
        if (selection.provider !== 'codex') throw new Error(zhCN.runtime.codexInvalidResponse)
        codexModelSelections.set(session.sessionId, selection)
        set(state => ({
          sessionModels: state.sessionModels === undefined ? undefined : { ...state.sessionModels, current: selection },
          modelSelecting: false,
        }))
        return true
      }
      const selected = await connection.requireProxy().sessionSelectModel(session.sessionId, selection)
      set(state => ({
        sessionModels: state.sessionModels === undefined ? undefined : { ...state.sessionModels, current: selected },
        modelSelecting: false,
      }))
      return true
    } catch (error) {
      set({ modelSelecting: false, error: friendlyError(error) })
      return false
    }
  },

  async selectPermission(preset) {
    const session = get().selectedSession
    if (session === undefined || get().connection.phase !== 'connected') return false
    set({ permissionSelecting: true, error: undefined })
    try {
      if (session.backend === 'codex') {
        if (!isCodexPermissionPreset(preset)) {
          throw new Error(zhCN.runtime.codexInvalidResponse)
        }
        const hostDeviceId = get().selectedDevice?.deviceId
        if (hostDeviceId === undefined) throw new Error(zhCN.runtime.connectHostFirst)
        const threadId = codexThreadId(session)
        const result = await connection.requireCodex().request('thread/resume', { threadId, permissionPreset: preset })
        const effectivePreset = codexPermissionPresetFromResponse(result) ?? preset
        await saveCodexPermissionPreset(hostDeviceId, threadId, effectivePreset)
        set(state => ({
          ...withCodexPermissionState(state, session.sessionId, effectivePreset),
          permissionSelecting: false,
        }))
        return true
      }
      await connection.requireProxy().sessionSelectPermission(session.sessionId, preset)
      set(state => {
        const update = (item: RemoteSession): RemoteSession => {
          if (item.sessionId !== session.sessionId || item.projections?.values === undefined) return item
          const permissions = item.projections.values.permissions
          if (typeof permissions !== 'object' || permissions === null) return item
          return {
            ...item,
            projections: { values: { ...item.projections.values, permissions: { ...permissions, currentValue: preset } } },
          }
        }
        return {
          sessions: state.sessions.map(update),
          selectedSession: state.selectedSession === undefined ? undefined : update(state.selectedSession),
          permissionSelecting: false,
        }
      })
      return true
    } catch (error) {
      set({ permissionSelecting: false, error: friendlyError(error) })
      return false
    }
  },

  async loadAgentPresets() {
    if (get().connection.phase !== 'connected') return false
    if (get().agentPresetLoading) return false
    set({ agentPresetLoading: true, error: undefined })
    try {
      const roster = await connection.requireProxy().agentPresetList()
      set({ agentPresetOptions: [...roster.presets], agentPresetLoading: false })
      return true
    } catch (error) {
      set({ agentPresetLoading: false, error: friendlyError(error) })
      return false
    }
  },

  async selectAgentPreset(preset) {
    const session = get().selectedSession
    if (session === undefined || get().connection.phase !== 'connected') return false
    if (session.backend === 'codex') return false
    set({ agentPresetSelecting: true, error: undefined })
    try {
      const committed = await connection.requireProxy().agentPresetSelect(session.sessionId, preset)
      set(state => {
        const update = (item: RemoteSession): RemoteSession =>
          item.sessionId === session.sessionId ? { ...item, agentPreset: committed } : item
        return {
          sessions: state.sessions.map(update),
          selectedSession: state.selectedSession === undefined ? undefined : update(state.selectedSession),
          agentPresetSelecting: false,
        }
      })
      return true
    } catch (error) {
      set({ agentPresetSelecting: false, error: friendlyError(error) })
      return false
    }
  },

  async workspaceRename(workspaceId, title) {
    if (get().connection.phase !== 'connected') return false
    set({ busyAction: `rename-workspace:${workspaceId}`, error: undefined })
    try {
      const target = get().workspaces.find(item => item.workspaceId === workspaceId)
      if (target?.backend === 'codex') {
        throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
      }
      if (target?.backend === 'cursor' || target?.backend === 'antigravity') {
        const nextTitle = title.trim()
        if (nextTitle.length === 0) throw new Error(zhCN.workspaces.namePlaceholder)
        set(state => ({
          workspaces: state.workspaces.map(item => item.workspaceId === workspaceId
            ? { ...item, title: nextTitle, updatedAt: new Date().toISOString() }
            : item),
          busyAction: undefined,
        }))
        return true
      }
      const proxy = connection.requireProxy()
      const workspace = await proxy.workspaceRename(workspaceId, title)
      set(state => ({
        workspaces: state.workspaces.map(item => item.workspaceId === workspaceId ? workspace : item),
        busyAction: undefined,
      }))
      return true
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async workspaceDelete(workspaceId) {
    if (get().connection.phase !== 'connected') return false
    set({ busyAction: `delete-workspace:${workspaceId}`, error: undefined })
    try {
      const target = get().workspaces.find(item => item.workspaceId === workspaceId)
      if (target?.backend === 'codex') {
        throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
      }
      if (target?.backend === 'cursor' || target?.backend === 'antigravity') {
        const sessionIds = new Set(target.sessionIds)
        const selected = get().selectedSession
        if (selected !== undefined && sessionIds.has(selected.sessionId)) {
          await closeActiveCursorStream()
        }
        set(state => ({
          workspaces: state.workspaces.filter(item => item.workspaceId !== workspaceId),
          sessions: state.sessions.filter(session => !sessionIds.has(session.sessionId)),
          messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => !sessionIds.has(id))),
          selectedSession: state.selectedSession !== undefined && sessionIds.has(state.selectedSession.sessionId)
            ? undefined
            : state.selectedSession,
          sessionModels: state.selectedSession !== undefined && sessionIds.has(state.selectedSession.sessionId)
            ? undefined
            : state.sessionModels,
          busyAction: undefined,
        }))
        return true
      }
      const proxy = connection.requireProxy()
      await proxy.workspaceDelete(workspaceId)
      set(state => ({
        workspaces: state.workspaces.filter(item => item.workspaceId !== workspaceId),
        sessions: state.sessions.filter(session => {
          const workspace = state.workspaces.find(item => item.workspaceId === workspaceId)
          return workspace === undefined || !workspace.sessionIds.includes(session.sessionId)
        }),
        busyAction: undefined,
      }))
      return true
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async workspaceMove(workspaceId, beforeWorkspaceId) {
    if (get().connection.phase !== 'connected') return false
    set({ busyAction: `move-workspace:${workspaceId}`, error: undefined })
    try {
      const target = get().workspaces.find(item => item.workspaceId === workspaceId)
      const before = beforeWorkspaceId === undefined
        ? undefined
        : get().workspaces.find(item => item.workspaceId === beforeWorkspaceId)
      if (target?.backend === 'codex' || before?.backend === 'codex') {
        throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
      }
      if (target?.backend === 'cursor' || target?.backend === 'antigravity' || before?.backend === 'cursor' || before?.backend === 'antigravity') {
        set(state => {
          const items = state.workspaces.slice()
          const from = items.findIndex(item => item.workspaceId === workspaceId)
          if (from < 0) return { busyAction: undefined }
          const [workspace] = items.splice(from, 1)
          if (workspace === undefined) return { busyAction: undefined }
          const to = beforeWorkspaceId === undefined
            ? items.length
            : items.findIndex(item => item.workspaceId === beforeWorkspaceId)
          items.splice(to < 0 ? items.length : to, 0, workspace)
          return { workspaces: items, busyAction: undefined }
        })
        return true
      }
      const proxy = connection.requireProxy()
      const workspaceIds = await proxy.workspaceInsertBefore(workspaceId, beforeWorkspaceId)
      const byId = new Map(get().workspaces.map(item => [item.workspaceId, item]))
      set({
        workspaces: [
          ...workspaceIds.flatMap(id => byId.get(id) === undefined ? [] : [byId.get(id)!]),
          ...get().workspaces.filter(item => item.backend === 'codex' || item.backend === 'cursor' || item.backend === 'antigravity'),
        ],
        busyAction: undefined,
      })
      return true
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async toggleFavoriteWorkspace(workspace) {
    const device = get().selectedDevice
    if (device === undefined) return false
    const key = workspaceStableKey(workspace, device.platform)
    const current = get().favoriteWorkspaces
    const existing = current.some(item => item.deviceId === device.deviceId && item.key === key)
    const next = existing
      ? current.filter(item => !(item.deviceId === device.deviceId && item.key === key))
      : [...current, {
          deviceId: device.deviceId,
          deviceName: device.name,
          key,
          workspaceId: workspace.workspaceId,
          backend: workspace.backend === 'codex' ? 'codex' as const : 'harness' as const,
          title: workspace.title,
          path: workspace.path,
          addedAt: Date.now(),
        }]
    try {
      await saveFavoriteWorkspaces(next)
    } catch (error) {
      set({ error: friendlyError(error) })
      return existing
    }
    set({ favoriteWorkspaces: next })
    await Haptics.notificationAsync(existing
      ? Haptics.NotificationFeedbackType.Warning
      : Haptics.NotificationFeedbackType.Success)
    return !existing
  },

  async removeFavoriteWorkspace(deviceId, key) {
    const current = get().favoriteWorkspaces
    const next = current.filter(item => !(item.deviceId === deviceId && item.key === key))
    if (next.length === current.length) return false
    try {
      await saveFavoriteWorkspaces(next)
    } catch (error) {
      set({ error: friendlyError(error) })
      return false
    }
    set({ favoriteWorkspaces: next })
    return true
  },

  async openFavoriteWorkspaceSession(key) {
    const state = get()
    if (state.connection.phase !== 'connected') return undefined
    const workspace = state.workspaces.find(item => workspaceStableKey(item, state.selectedDevice?.platform) === key)
    if (workspace === undefined) return undefined
    const session = latestWorkspaceSession(state.sessions, workspace)
    if (session === undefined) return undefined
    return await state.openSession(session) ? session : undefined
  },

  async hostListDirectory(path) {
    if (get().connection.phase !== 'connected') return undefined
    try {
      return await connection.requireProxy().hostListDirectory(path)
    } catch (error) {
      set({ error: friendlyError(error) })
      return undefined
    }
  },

  async loadOlderHistory() {
    const session = get().selectedSession
    const beforeSeq = get().oldestLoadedSeq
    if (session === undefined || beforeSeq === undefined || get().historyLoadingOlder || !get().historyHasMore) return
    if (session.backend === 'cursor') {
      set({ historyHasMore: false, historyLoadingOlder: false })
      return
    }
    set({ historyLoadingOlder: true })
    try {
      const page = session.backend === 'codex'
        ? await readCodexHistoryPage(connection.requireCodex(), codexThreadId(session), beforeSeq, 60)
        : await connection.requireProxy().sessionHistory(session.sessionId, beforeSeq, 60)
      const items = foldHistory(page.events, session.sessionId, true)
      const older = oldestSeq(page.events)
      set(state => ({
        messages: {
          ...state.messages,
          [session.sessionId]: applyFeedback(prependHistory(items, state.messages[session.sessionId] ?? []), session.backend === 'codex' ? undefined : state.feedbackBySession[session.sessionId]),
        },
        ...(state.selectedSession?.sessionId === session.sessionId ? {
          historyHasMore: page.hasMore,
          oldestLoadedSeq: older ?? state.oldestLoadedSeq,
          historyLoadingOlder: false,
        } : {}),
      }))
    } catch (error) {
      set(state => state.selectedSession?.sessionId === session.sessionId
        ? { historyLoadingOlder: false, error: friendlyError(error) } : {})
    }
  },

  async workspaceCreate(path, backend = 'harness') {
    if (get().connection.phase !== 'connected') return undefined
    set({
      busyAction: backend === 'codex'
        ? 'create-codex-workspace'
        : backend === 'cursor'
          ? 'create-cursor-workspace'
          : backend === 'antigravity'
            ? 'create-antigravity-workspace'
            : 'create-workspace',
      error: undefined,
    })
    try {
      if (backend === 'codex') {
        const workspace = await createCodexWorkspace(connection.requireCodex(), path, createNativeRpcId())
        set(state => ({
          workspaces: [...state.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace],
          busyAction: undefined,
        }))
        return workspace
      }
      if (backend === 'cursor') {
        if (!connection.hasCursor()) throw new Error(zhCN.runtime.cursorUnavailable)
        const workspace = createCursorWorkspace(path)
        set(state => ({
          workspaces: [...state.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace],
          busyAction: undefined,
        }))
        return workspace
      }
      if (backend === 'antigravity') {
        if (!connection.hasAntigravity()) throw new Error(zhCN.runtime.antigravityUnavailable)
        const workspace = createAntigravityWorkspace(path)
        set(state => ({
          workspaces: [...state.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace],
          busyAction: undefined,
        }))
        return workspace
      }
      const proxy = connection.requireProxy()
      const { workspace } = await proxy.workspaceCreate(path)
      set(state => ({
        workspaces: [...state.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace],
        busyAction: undefined,
      }))
      return workspace
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return undefined
    }
  },

  async sendMessage(input, images = []) {
    set({ commandResult: undefined })
    const session = get().selectedSession
    const text = input.trim()
    if (session === undefined || (text.length === 0 && images.length === 0)) return false
    if (session.backend !== 'codex' && /^\/(?:file|goal|plan|feedback|compact|export)(?:\s|$)/u.test(text)) {
      set({ busyAction: 'command', error: undefined })
      try {
        // Commands are not prompts: never fabricate an optimistic user turn.
        if (images.length > 0) throw new Error(zhCN.messageActions.unavailable)
        const result = await connection.requireProxy().sessionExecuteCommand(session.sessionId, text)
        if (result.kind === 'error') throw new Error(result.text ?? zhCN.messageActions.failed)
        set({ busyAction: undefined, commandResult: result.text?.trim()
          ? { sessionId: session.sessionId, text: result.text } : undefined })
        return true
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    }
    const requestRpcId = createNativeRpcId()
    const optimistic: ChatItem = {
      kind: 'message',
      id: `local:${Date.now()}`,
      sessionId: session.sessionId,
      role: 'user',
      text,
      ...(images.length === 0 ? {} : { images: images.map(image => ({ uri: image.uri, name: image.name })) }),
      createdAt: Date.now(),
      requestRpcId,
    }
    set(state => ({
      messages: { ...state.messages, [session.sessionId]: [...(state.messages[session.sessionId] ?? []), optimistic] },
      busyAction: 'send-message',
      error: undefined,
    }))
    try {
      if (session.backend === 'codex') {
        const client = connection.requireCodex()
        const threadId = codexThreadId(session)
        const promptInput = [
          ...(text.length === 0 ? [] : [{ type: 'text', text }]),
          ...images.map(image => ({ type: 'image', mediaType: image.mediaType, data: image.data })),
        ]
        const activeTurnId = activeCodexTimeline?.session.nativeId === threadId
          ? activeCodexTimeline.activeTurnId
          : undefined
        if (activeTurnId !== undefined) {
          await client.request('turn/steer', { threadId, expectedTurnId: activeTurnId, input: promptInput })
        } else {
          const selection = get().sessionModels?.current
          const latestSession = get().selectedSession?.sessionId === session.sessionId
            ? get().selectedSession
            : get().sessions.find(item => item.sessionId === session.sessionId)
          const savedPermissions = await loadSavedCodexPermissions(get().selectedDevice?.deviceId)
          let permissionPreset = latestSession?.backend === 'codex'
            ? codexPermissionPreset(latestSession)
            : savedPermissions[threadId]
          const resumeResult = await client.request('thread/resume', {
            threadId,
            ...(permissionPreset === undefined ? {} : { permissionPreset }),
            ...(selection?.provider === 'codex' ? { model: selection.model } : {}),
          })
          const serverPreset = codexPermissionPresetFromResponse(resumeResult)
          if (serverPreset !== undefined) {
            permissionPreset = serverPreset
            set(state => withCodexPermissionState(state, session.sessionId, serverPreset))
          }
          const result = record(await client.request('turn/start', {
            threadId,
            input: promptInput,
            ...(permissionPreset === undefined ? {} : { permissionPreset }),
            ...(selection?.provider === 'codex' ? {
              model: selection.model,
              ...(selection.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort }),
            } : {}),
          }))
          const turnId = stringValue(record(result.turn).id)
          if (activeCodexTimeline?.session.nativeId === threadId) {
            activeCodexTimeline = {
              ...activeCodexTimeline,
              ...(turnId === undefined ? {} : { activeTurnId: turnId }),
              session: { ...activeCodexTimeline.session, status: 'running' },
            }
          }
          set(state => ({
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: true } : item),
            selectedSession: state.selectedSession?.sessionId === session.sessionId
              ? { ...state.selectedSession, running: true }
              : state.selectedSession,
          }))
        }
      } else if (session.backend === 'cursor' || session.backend === 'antigravity') {
        if (images.length > 0) throw new Error(zhCN.runtime.cursorTextOnly)
        // Always re-bind the ACP stream on the current RemoteClientCore before
        // prompting. After WebRTC flaps / Metro reload the module-level handle
        // can point at a dead core while RPC still works on a new one.
        await ensureCursorStream(session)
        set(state => ({
          sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: true } : item),
          selectedSession: state.selectedSession?.sessionId === session.sessionId
            ? { ...state.selectedSession, running: true }
            : state.selectedSession,
        }))
        // Host may return immediately with stopReason=in_progress so frames can
        // interleave; keep running until prompt_completed / failure.
        const acpClient = session.backend === 'antigravity'
          ? connection.requireAntigravity()
          : connection.requireCursor()
        const promptResult = await acpClient.prompt(cursorNativeId(session), text)
        const inProgress = isRecord(promptResult)
          && promptResult.accepted === true
          && promptResult.stopReason === 'in_progress'
        if (!inProgress) {
          set(state => ({
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
            selectedSession: state.selectedSession?.sessionId === session.sessionId
              ? { ...state.selectedSession, running: false }
              : state.selectedSession,
          }))
        }
      } else {
        await connection.requireProxy().sessionPrompt(session.sessionId, text, requestRpcId, images)
        // Keep the sending state until the Host event stream confirms that
        // execution has actually started. `session.prompt` only acknowledges
        // receipt, so clearing busyAction here briefly re-enables the quick
        // actions before the first assistant/tool event arrives.
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        return true
      }
      set({ busyAction: undefined })
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      return true
    } catch (error) {
      set(state => ({
        messages: {
          ...state.messages,
          [session.sessionId]: (state.messages[session.sessionId] ?? []).filter(item => item.id !== optimistic.id),
        },
        busyAction: undefined,
        error: friendlyError(error),
      }))
      return false
    }
  },

  async stopSession() {
    const session = get().selectedSession
    if (session === undefined) return
    set({ busyAction: 'stop-session' })
    try {
      if (session.backend === 'codex') {
        const threadId = codexThreadId(session)
        const client = connection.requireCodex()
        let turnId = activeCodexTimeline?.session.nativeId === threadId
          ? activeCodexTimeline.activeTurnId
          : undefined
        if (turnId === undefined) {
          const history = await readCodexHistoryPage(client, threadId, undefined, 1)
          turnId = history.activeTurnId
          if (turnId !== undefined && activeCodexTimeline?.session.nativeId === threadId) {
            activeCodexTimeline = withActiveCodexTurn(activeCodexTimeline, turnId)
          }
        }
        if (turnId === undefined) throw new Error(zhCN.runtime.codexTurnUnavailable)
        await client.interrupt(threadId, turnId)
      } else if (session.backend === 'cursor' || session.backend === 'antigravity') {
        const acpClient = session.backend === 'antigravity'
          ? connection.requireAntigravity()
          : connection.requireCursor()
        await acpClient.cancel(cursorNativeId(session))
        set(state => ({
          sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
          selectedSession: state.selectedSession?.sessionId === session.sessionId
            ? { ...state.selectedSession, running: false }
            : state.selectedSession,
        }))
      } else {
        await connection.requireProxy().sessionCancel(session.sessionId)
      }
    } catch (error) {
      set({ error: friendlyError(error) })
    } finally {
      set({ busyAction: undefined })
    }
  },

  async respondApproval(itemId, outcome) {
    set({ busyAction: `approval:${itemId}`, error: undefined })
    try {
      const item = findApproval(get().messages, itemId)
      if (item === undefined) {
        throw new Error(zhCN.runtime.openSessionFirst)
      }
      const session = get().sessions.find(value => value.sessionId === item.sessionId) ?? get().selectedSession
      if (session?.backend === 'codex') {
        await connection.requireCodex().respond(item.approvalId, outcome === 'allowed-once' ? 'accept' : 'decline')
      } else if (session?.backend === 'cursor' || session?.backend === 'antigravity') {
        const acpClient = session.backend === 'antigravity'
          ? connection.requireAntigravity()
          : connection.requireCursor()
        await acpClient.respond(
          item.approvalId,
          outcome === 'allowed-once' ? 'allow-once' : 'reject-once',
        )
      } else {
        if (item.frameRpcId === undefined) throw new Error(zhCN.runtime.openSessionFirst)
        await connection.requireProxy().respondApproval(item.frameRpcId, item.sessionId, item.approvalId, outcome)
      }
      set(state => ({
        messages: mapApprovalOutcome(state.messages, itemId, outcome),
        busyAction: undefined,
      }))
      await Haptics.notificationAsync(outcome === 'rejected'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success)
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
    }
  },

  async respondQuestion(itemId, selected) {
    set({ busyAction: `question:${itemId}`, error: undefined })
    try {
      const proxy = connection.requireProxy()
      const item = findQuestion(get().messages, itemId)
      if (item === undefined || item.frameRpcId === undefined) {
        throw new Error(zhCN.runtime.openSessionFirst)
      }
      const answers = item.questions.map(question => ({
        id: question.id,
        selected: selected[question.id] ?? [],
      }))
      await proxy.respondQuestion(item.frameRpcId, item.sessionId, { answers })
      set(state => ({
        messages: mapQuestionAnswered(state.messages, itemId),
        busyAction: undefined,
      }))
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
    }
  },

  async forgetDevice(deviceId) {
    const { config, identity } = get()
    if (config === undefined || identity === undefined) return false
    set({ busyAction: `forget:${deviceId}`, error: undefined })
    try {
      if (get().selectedDevice?.deviceId === deviceId) await get().disconnect()
      await forgetHost(deviceId)
      await clearCodexPermissionPresets(deviceId)
      const clearedLast = get().lastConnectedDeviceId === deviceId
      if (clearedLast) await clearLastConnectedDeviceId()
      const favoriteWorkspaces = get().favoriteWorkspaces.filter(item => item.deviceId !== deviceId)
      if (favoriteWorkspaces.length !== get().favoriteWorkspaces.length) {
        await saveFavoriteWorkspaces(favoriteWorkspaces)
      }
      const recentWorkspaces = get().recentWorkspaces.filter(item => item.deviceId !== deviceId)
      if (recentWorkspaces.length !== get().recentWorkspaces.length) {
        await saveRecentWorkspaces(recentWorkspaces)
      }
      set(state => ({
        devices: state.devices.filter(device => device.deviceId !== deviceId),
        favoriteWorkspaces,
        recentWorkspaces,
        lastConnectedDeviceId: clearedLast ? undefined : state.lastConnectedDeviceId,
        pendingAutoConnectDeviceId: state.pendingAutoConnectDeviceId === deviceId
          ? undefined
          : state.pendingAutoConnectDeviceId,
        busyAction: undefined,
      }))
      return true
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
  },

  async resetLocalData() {
    await get().disconnect()
    await clearLocalData()
    const identity = await loadOrCreateIdentity()
    const language = applyLanguagePreference('system')
    set({
      ...initialData(),
      identity,
      languagePreference: 'system',
      language,
      themePreference: 'system',
      lastConnectedDeviceId: undefined,
      pendingAutoConnectDeviceId: undefined,
      reauthRequired: false,
      bootPhase: 'ready',
    })
  },

  async signOut() {
    const { config, identity, languagePreference, themePreference } = get()
    await get().disconnect()
    if (config !== undefined && identity !== undefined) {
      try {
        const { api } = await serverSession.authenticate(config.baseUrl, identity)
        await api.removeSelf()
      } catch {
        // Local sign-out must still complete if the server is unavailable.
      }
    }
    await clearLocalData()
    await saveLanguagePreference(languagePreference)
    await saveThemePreference(themePreference)
    const nextIdentity = await loadOrCreateIdentity()
    set({
      ...initialData(),
      identity: nextIdentity,
      lastConnectedDeviceId: undefined,
      pendingAutoConnectDeviceId: undefined,
      reauthRequired: false,
      bootPhase: 'ready',
    })
  },

  async setTransportPreference(preference) {
    await saveTransportPreference(preference)
    const wasConnected = get().connection.phase === 'connected' || get().connection.phase === 'reconnecting'
    set({ transportPreference: preference })
    if (wasConnected) await get().reconnect()
  },

  async setLanguagePreference(languagePreference) {
    await saveLanguagePreference(languagePreference)
    const language = applyLanguagePreference(languagePreference)
    set({ languagePreference, language })
  },

  async setThemePreference(themePreference) {
    await saveThemePreference(themePreference)
    set({ themePreference })
  },


  syncSystemLocales(localeTags) {
    const language = updateSystemLocales(localeTags)
    if (language !== get().language) set({ language })
  },

  setOffline() {
    if (get().connection.phase !== 'disconnected') {
      set({
        connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.networkUnavailable },
        codexAvailable: false,
        cursorAvailable: false,
      })
    }
  },

  clearError() {
    set({ error: undefined })
  },

  handleMuxFrame(frame) {
    set(state => {
      const sessionId = frame.payload.sessionId
      const running = sessionRunningForMuxFrame(frame)
      const releasePrompt = state.busyAction === 'send-message'
        && sessionId !== undefined
        && state.selectedSession?.sessionId === sessionId
        && (isHarnessPromptStarted(frame) || running !== undefined)
      const updateRunning = (session: RemoteSession): RemoteSession => (
        sessionId !== undefined && running !== undefined && session.sessionId === sessionId
          ? { ...session, running }
          : session
      )
      return {
        messages: applyMuxFrameToMessages(state.messages, frame),
        ...(sessionId === undefined || running === undefined ? {} : {
          sessions: state.sessions.map(updateRunning),
          selectedSession: state.selectedSession === undefined ? undefined : updateRunning(state.selectedSession),
        }),
        ...(releasePrompt ? { busyAction: undefined } : {}),
      }
    })
  },

  handleCodexFrame(frame) {
    const timeline = activeCodexTimeline
    if (timeline === undefined) return
    const framePermission = codexPermissionPresetFromResponse(record(frame).params)
    const next = reduceCodexTimelineFrame(timeline, frame)
    activeCodexTimeline = next
    const live = codexItemsToChat(next.items)
    set(state => {
      const current = state.sessions.find(item => item.sessionId === next.session.id)
        ?? state.selectedSession
      if (current === undefined || current.backend !== 'codex') return {}
      const session = framePermission === undefined
        ? updateCodexSession(current, next.session)
        : withCodexPermission(updateCodexSession(current, next.session), framePermission)
      return {
        sessions: state.sessions.map(item => item.sessionId === session.sessionId ? session : item),
        selectedSession: state.selectedSession?.sessionId === session.sessionId ? session : state.selectedSession,
        messages: {
          ...state.messages,
          [session.sessionId]: mergeCodexLive(state.messages[session.sessionId] ?? [], live),
        },
      }
    })
  },

  handleCursorFrame(frame) {
    const session = get().selectedSession
    if (session === undefined || (session.backend !== 'cursor' && session.backend !== 'antigravity')) return
    const params = isRecord(frame.frame.params) ? frame.frame.params : undefined
    const update = params === undefined
      ? undefined
      : (isRecord(params.update) ? params.update : params)
    let kind: string | undefined
    if (update !== undefined && typeof update.sessionUpdate === 'string') {
      kind = update.sessionUpdate
      const catchUpCount = Array.isArray(update.catchUp) ? update.catchUp.length : 0
      // Diagnostic only: kind + catch-up size, never prompt or tool payloads.
      console.info('[dsh-remote] acp frame:', session.backend, kind, catchUpCount > 0 ? `catchUp=${catchUpCount}` : '')
    }
    set(state => ({
      messages: {
        ...state.messages,
        [session.sessionId]: applyCursorFrame(state.messages[session.sessionId] ?? [], session.sessionId, frame),
      },
      ...(kind === 'prompt_completed' || kind === 'prompt_failed'
        ? {
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
            selectedSession: state.selectedSession?.sessionId === session.sessionId
              ? { ...state.selectedSession, running: false }
              : state.selectedSession,
            ...(kind === 'prompt_failed'
              ? { error: session.backend === 'antigravity' ? zhCN.runtime.antigravityUnavailable : zhCN.runtime.cursorUnavailable }
              : {}),
          }
        : {}),
    }))
  },
}))

async function closeActiveCodexStream(notifyRemote = true): Promise<void> {
  const stream = activeCodexStream
  activeCodexStream = undefined
  activeCodexTimeline = undefined
  if (notifyRemote && stream !== undefined) await stream.close().catch(() => undefined)
}

async function closeActiveCursorStream(notifyRemote = true): Promise<void> {
  const stream = activeCursorStream
  activeCursorStream = undefined
  if (notifyRemote && stream !== undefined) await stream.close().catch(() => undefined)
}

/** Open (or refresh) the ACP event stream for the active session. */
async function ensureCursorStream(session: RemoteSession): Promise<void> {
  await closeActiveCursorStream()
  const client = session.backend === 'antigravity'
    ? connection.requireAntigravity()
    : connection.requireCursor()
  const nativeId = cursorNativeId(session)
  const stream = await client.openStream(
    nativeId,
    frame => useAppStore.getState().handleCursorFrame(frame),
    closed => {
      if (useAppStore.getState().selectedSession?.sessionId !== session.sessionId) return
      if (activeCursorStream?.streamId !== stream.streamId) return
      activeCursorStream = undefined
      useAppStore.setState(state => ({
        sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
        selectedSession: state.selectedSession?.sessionId === session.sessionId
          ? { ...state.selectedSession, running: false }
          : state.selectedSession,
        ...(closed.reason === 'failed' ? { error: session.backend === 'antigravity' ? zhCN.runtime.antigravityUnavailable : zhCN.runtime.cursorUnavailable } : {}),
      }))
      // Transport flaps can close the ACP stream while the secure channel is
      // still up. Re-open so the next prompt does not miss live frames.
      if (closed.reason === 'peer-disconnected') return
      const phase = useAppStore.getState().connection.phase
      if (phase !== 'connected') return
      const current = useAppStore.getState().selectedSession
      if (current?.sessionId !== session.sessionId || (current.backend !== 'cursor' && current.backend !== 'antigravity')) return
      void ensureCursorStream(current).catch(() => undefined)
    },
  )
  activeCursorStream = stream
}

async function loadSavedCodexPermissions(hostDeviceId: string | undefined): Promise<Record<string, CodexPermissionPreset>> {
  if (hostDeviceId === undefined) return {}
  try {
    return await loadCodexPermissionPresets(hostDeviceId)
  } catch {
    return {}
  }
}

function withBestCodexPermission(
  session: RemoteSession,
  previous: RemoteSession | undefined,
  saved: Record<string, CodexPermissionPreset>,
): RemoteSession {
  if (session.backend !== 'codex') return session
  const savedPreset = session.nativeId === undefined ? undefined : saved[session.nativeId]
  const previousPreset = previous?.backend === 'codex' ? codexPermissionPreset(previous) : undefined
  const preset = savedPreset ?? previousPreset
  return preset === undefined ? session : withCodexPermission(session, preset)
}

function withCodexPermissionState(
  state: AppState,
  sessionId: string,
  preset: CodexPermissionPreset,
): Pick<AppState, 'sessions' | 'selectedSession'> {
  const update = (session: RemoteSession): RemoteSession => (
    session.sessionId === sessionId ? withCodexPermission(session, preset) : session
  )
  return {
    sessions: state.sessions.map(update),
    selectedSession: state.selectedSession === undefined ? undefined : update(state.selectedSession),
  }
}

function withActiveCodexTurn(timeline: CodexTimelineState, activeTurnId: string | undefined): CodexTimelineState {
  if (activeTurnId === undefined) return timeline
  return {
    ...timeline,
    activeTurnId,
    session: timeline.session.status === 'waiting'
      ? timeline.session
      : { ...timeline.session, status: 'running' },
  }
}

/**
 * `session.prompt` acknowledges enqueueing only. Keep the local sending state
 * until a meaningful event from that session proves that the turn has begun.
 */
function isHarnessPromptStarted(frame: MuxStreamFrame): boolean {
  const payload = frame.payload
  if (payload.type === 'approval/requested' || payload.type === 'question/requested') return true
  if (payload.type !== 'session/event' || payload.event === undefined) return false
  const event = payload.event
  if (event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result') return true
  if (event.type !== 'assistant/chunk') return false
  const chunk = event.data.chunk
  if (typeof chunk !== 'object' || chunk === null) return false
  const value = chunk as Record<string, unknown>
  if (value.type === 'text-delta' || value.type === 'reasoning-delta') {
    return typeof value.text === 'string' && value.text.length > 0
  }
  return value.type === 'tool-call-delta'
    && (typeof value.argumentsDelta !== 'string' || value.argumentsDelta.length > 0)
}

/** Number of recently visited workspaces kept for the home-screen fallback list. */
const RECENT_WORKSPACE_LIMIT = 3

/**
 * Remember the workspace a session was opened from. Favorites take precedence on
 * the home screen, so this list is the fallback shown while Favorites is empty.
 */
async function rememberRecentWorkspace(session: RemoteSession): Promise<void> {
  const state = useAppStore.getState()
  const device = state.selectedDevice
  const workspace = state.workspaces.find(item => item.sessionIds.includes(session.sessionId))
  if (device === undefined || workspace === undefined) return
  const key = workspaceStableKey(workspace, device.platform)
  const entry: WorkspaceShortcut = {
    deviceId: device.deviceId,
    deviceName: device.name,
    key,
    workspaceId: workspace.workspaceId,
    backend: workspace.backend === 'codex' ? 'codex' : 'harness',
    title: workspace.title,
    path: workspace.path,
    addedAt: Date.now(),
  }
  const next = [
    entry,
    ...state.recentWorkspaces.filter(item => !(item.deviceId === device.deviceId && item.key === key)),
  ].slice(0, RECENT_WORKSPACE_LIMIT)
  try {
    await saveRecentWorkspaces(next)
  } catch {
    // The shortcut list is a convenience; a storage failure must not fail the visit.
    return
  }
  useAppStore.setState({ recentWorkspaces: next })
}

/** Most recently updated conversation inside a workspace; undefined when it has none yet. */
function latestWorkspaceSession(sessions: RemoteSession[], workspace: WorkspaceView): RemoteSession | undefined {
  let latest: RemoteSession | undefined
  for (const sessionId of workspace.sessionIds) {
    const session = sessions.find(item => item.sessionId === sessionId)
    if (session === undefined) continue
    if (latest === undefined || session.updatedAt > latest.updatedAt) latest = session
  }
  return latest
}

/** Best-effort model catalog load; a failure must not block opening the session. */
async function refreshSessionModels(sessionId: string): Promise<void> {
  try {
    const models = await connection.requireProxy().sessionModels(sessionId)
    useAppStore.setState(state => state.selectedSession?.sessionId === sessionId
      ? { sessionModels: models }
      : {})
  } catch {
    // ignored: the chat stays usable without a model catalog
  }
}

/** Best-effort CodeX model directory load; the Thread remains usable if the Host cannot list models. */
async function refreshCodexModels(sessionId: string): Promise<void> {
  try {
    let models = await loadCodexModels(connection.requireCodex())
    const selected = codexModelSelections.get(sessionId)
    if (selected !== undefined && models.groups.some(provider => provider.id === selected.provider
      && provider.models.some(model => model.id === selected.model))) {
      models = { ...models, current: selected }
    }
    useAppStore.setState(state => state.selectedSession?.sessionId === sessionId
      ? { sessionModels: models }
      : {})
  } catch {
    // ignored: text/image prompts can use the Host's current CodeX default
  }
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function finalizeLogin(
  get: () => AppState,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  baseUrl: string,
  outcome: LoginOutcome,
): Promise<boolean> {
  const config: ServerConfig = {
    baseUrl,
    account: outcome.account,
    loginMethod: outcome.loginMethod,
  }
  await saveServerConfig(config)
  set({
    config,
    account: outcome.account,
    busyAction: undefined,
    devices: [],
    authPhase: 'complete',
    reauthRequired: false,
    error: undefined,
  })
  await get().refreshDevices()
  return !get().reauthRequired
}

function initialData(): Pick<AppState,
  'config' | 'account' | 'devices' | 'selectedDevice' | 'connection' | 'hostDescriptor' | 'codexAvailable' | 'cursorAvailable' | 'antigravityAvailable' | 'workspaces' |
  'favoriteWorkspaces' | 'recentWorkspaces' | 'archivedSessionIds' | 'sessions' | 'selectedSession' | 'messages' | 'sessionModels' | 'modelSelecting' | 'permissionSelecting' |
  'historyHasMore' | 'historyLoadingOlder' | 'oldestLoadedSeq' | 'transportPreference' | 'authPhase' | 'refreshing' | 'busyAction' | 'error' |
  'connectionProbeOrder' | 'connectionNetworkDetails' | 'reauthRequired' | 'feedbackBySession' | 'commandResult'> {
  return {
    config: undefined,
    account: undefined,
    devices: [],
    selectedDevice: undefined,
    connection: disconnected,
    connectionProbeOrder: [],
    connectionNetworkDetails: undefined,
    hostDescriptor: undefined,
    codexAvailable: false,
    cursorAvailable: false,
    antigravityAvailable: false,
    workspaces: [],
    favoriteWorkspaces: [],
    recentWorkspaces: [],
    archivedSessionIds: [],
    sessions: [],
    selectedSession: undefined,
    messages: {},
    feedbackBySession: {},
    commandResult: undefined,
    sessionModels: undefined,
    modelSelecting: false,
    permissionSelecting: false,
    historyHasMore: false,
    historyLoadingOlder: false,
    oldestLoadedSeq: undefined,
    transportPreference: 'auto',
    authPhase: 'idle',
    refreshing: false,
    busyAction: undefined,
    error: undefined,
    reauthRequired: false,
  }
}
