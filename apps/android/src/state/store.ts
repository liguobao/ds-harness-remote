import * as Haptics from 'expo-haptics'
import { create } from 'zustand'
import {
  createCodexTimelineState,
  projectCodexThread,
  reduceCodexTimelineFrame,
  type CodexStream,
  type CodexTimelineState,
} from '@dsh-remote/client-core'
import {
  applyLanguagePreference,
  getActiveLanguage,
  strings as zhCN,
  updateSystemLocales,
  type AppLanguage,
  type LanguagePreference,
} from '../locales/i18n'
import { friendlyError, isRpcTimeoutError, isSessionAuthError } from '../lib/errors'
import { initialProbeTransports } from '../lib/network-route'
import {
  loginFlow,
  oauthLoginChannel,
  passwordLoginChannel,
  redirectLoginChannelFor,
  githubOAuthLoginChannel,
  type LoginOutcome,
} from '../services/login'
import type { RedirectLoginMethod } from '../types'
import { createNativeRpcId } from '../services/api-proxy'
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
import { AndroidRemoteConnection } from '../services/connection'
import { reconcileTrustedDevices } from '../services/device-directory'
import { resolveAutomaticPreferredTransports } from '../services/network-route'
import { serverSession } from '../services/server-session'
import { resolveAutoConnectDevice } from '../lib/auto-connect'
import {
  clearLocalData,
  clearCodexPermissionPresets,
  clearDeviceCredentials,
  clearLastConnectedDeviceId,
  forgetHost,
  loadLastConnectedDeviceId,
  loadOrCreateIdentity,
  loadLanguagePreference,
  loadCodexPermissionPresets,
  loadServerConfig,
  loadThemePreference,
  loadTransportPreference,
  loadTrustedHosts,
  saveLanguagePreference,
  saveLastConnectedDeviceId,
  saveCodexPermissionPreset,
  saveServerConfig,
  saveThemePreference,
  saveTransportPreference,
  trustHost,
} from '../services/storage'
import type { ThemePreference } from '../ui/theme'
import type {
  ChatItem,
  CodexPermissionPreset,
  ConnectionProbeTransport,
  ConnectionNetworkDetails,
  ConnectionStage,
  ConnectionSnapshot,
  DeviceIdentity,
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
import { foldHistory, applyMuxFrameToMessages } from './event-reducer'

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
  workspaces: WorkspaceView[]
  archivedSessionIds: string[]
  sessions: RemoteSession[]
  selectedSession?: RemoteSession
  messages: Record<string, ChatItem[]>
  sessionModels?: SessionModels
  modelSelecting: boolean
  permissionSelecting: boolean
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
  /** Remembered host from the last successful connect (persisted). */
  lastConnectedDeviceId?: string
  /** Set during bootstrap when that host is trusted + online; consumed by the navigator. */
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
  stopSession(): Promise<void>
  respondApproval(itemId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>
  respondQuestion(itemId: string, selected: Record<string, string[]>): Promise<void>
  createSession(workspaceId?: string): Promise<boolean>
  archiveSession(sessionId: string): Promise<boolean>
  selectModel(selection: ModelSelection): Promise<boolean>
  selectPermission(preset: string): Promise<boolean>
  loadOlderHistory(): Promise<void>
  workspaceCreate(path: string, backend?: 'harness' | 'codex'): Promise<WorkspaceView | undefined>
  workspaceRename(workspaceId: string, title: string): Promise<boolean>
  workspaceDelete(workspaceId: string): Promise<boolean>
  workspaceMove(workspaceId: string, beforeWorkspaceId?: string): Promise<boolean>
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
}

const disconnected: ConnectionSnapshot = {
  phase: 'disconnected',
  stats: { mode: 'Disconnected', connected: false },
}

const connection = new AndroidRemoteConnection()
let activeCodexStream: CodexStream | undefined
let activeCodexTimeline: CodexTimelineState | undefined
const codexModelSelections = new Map<string, ModelSelection>()

export const useAppStore = create<AppState>((set, get) => ({
  bootPhase: 'loading',
  devices: [],
  connection: disconnected,
  connectionProbeOrder: [],
  codexAvailable: false,
  workspaces: [],
  archivedSessionIds: [],
  sessions: [],
  messages: {},
  modelSelecting: false,
  permissionSelecting: false,
  historyHasMore: false,
  historyLoadingOlder: false,
  transportPreference: 'auto',
  languagePreference: 'system',
  language: getActiveLanguage(),
  themePreference: 'system',
  authPhase: 'idle',
  refreshing: false,
  reauthRequired: false,

  async bootstrap() {
    set({ bootPhase: 'loading', error: undefined, pendingAutoConnectDeviceId: undefined, reauthRequired: false })
    try {
      const [config, identity, transportPreference, languagePreference, themePreference, lastConnectedDeviceId] = await Promise.all([
        loadServerConfig(),
        loadOrCreateIdentity(),
        loadTransportPreference(),
        loadLanguagePreference(),
        loadThemePreference(),
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
        lastConnectedDeviceId,
      })
      let pendingAutoConnectDeviceId: string | undefined
      if (config !== undefined) {
        await get().refreshDevices()
        if (!get().reauthRequired) {
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
        const combinedSessions = [...sessions, ...codexSessions]
        return {
          workspaces: [...workspaceList.items, ...codexWorkspaces],
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
    set({
      selectedDevice: device,
      connection: { phase: 'connecting', stats: { mode: 'Disconnected', connected: false } },
      connectionStage: 'authenticating',
      connectionProbeOrder: [],
      connectionNetworkDetails: undefined,
      hostDescriptor: undefined,
      codexAvailable: false,
      workspaces: [],
      sessions: [],
      error: undefined,
    })
    try {
      await closeActiveCodexStream(false)
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
            if (get().connection.phase === 'connected' || get().connection.phase === 'reconnecting') {
              set({
                connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.hostClosed },
                codexAvailable: false,
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
        return {
          hostDescriptor,
          codexAvailable: connection.hasCodex(),
          workspaces: [...workspaceList.items, ...codexCatalog.workspaces],
          archivedSessionIds: workspaceList.archivedSessionIds,
          sessions: [...sessions, ...codexSessions],
          connectionStage: 'ready',
          connectionNetworkDetails,
          lastConnectedDeviceId: device.deviceId,
          pendingAutoConnectDeviceId: undefined,
          connection: { phase: 'connected', stats: connection.getStats() ?? { mode: 'Relay', connected: true } },
          ...(codexError === undefined ? {} : { error: codexError }),
        }
      })
      await saveLastConnectedDeviceId(device.deviceId)
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
    if (device === undefined || get().connection.phase === 'connecting') return false
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
        const items = foldHistory(history.events, session.sessionId)
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
      await closeActiveCodexStream()
      const history = await connection.requireProxy().sessionHistory(session.sessionId)
      const items = foldHistory(history.events, session.sessionId)
      set(state => ({
        selectedSession: session,
        messages: {
          ...state.messages,
          [session.sessionId]: mergeHistoryAndLive(items, state.messages[session.sessionId] ?? []),
        },
        historyHasMore: history.hasMore,
        oldestLoadedSeq: oldestSeq(history.events),
        busyAction: undefined,
      }))
      void refreshSessionModels(session.sessionId)
    }
    try {
      await load()
      return true
    } catch (error) {
      if (isRpcTimeoutError(error)) {
        // session.history is read-only, so it is safe to recover the stale
        // path with a fresh Relay-only connection and retry exactly once.
        // Mutating ApiProxy calls deliberately do not use this path because a
        // timeout leaves their result unknown.
        const recovered = await get().reconnect({ forceRelay: true })
        if (recovered) {
          try {
            await load()
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
      const proxy = connection.requireProxy()
      const { sessionId } = await proxy.sessionCreate(workspaceId)
      const sessions = await proxy.sessionList()
      set({ sessions, busyAction: undefined })
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
      const proxy = connection.requireProxy()
      const archivedSessionIds = await proxy.workspaceArchiveSession(sessionId)
      const sessions = await proxy.sessionList()
      set(state => ({
        archivedSessionIds,
        sessions,
        busyAction: undefined,
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

  async workspaceRename(workspaceId, title) {
    if (get().connection.phase !== 'connected') return false
    set({ busyAction: `rename-workspace:${workspaceId}`, error: undefined })
    try {
      if (get().workspaces.find(item => item.workspaceId === workspaceId)?.backend === 'codex') {
        throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
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
      if (get().workspaces.find(item => item.workspaceId === workspaceId)?.backend === 'codex') {
        throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
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
      if (get().workspaces.find(item => item.workspaceId === workspaceId)?.backend === 'codex'
        || beforeWorkspaceId !== undefined && get().workspaces.find(item => item.workspaceId === beforeWorkspaceId)?.backend === 'codex') {
        throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
      }
      const proxy = connection.requireProxy()
      const workspaceIds = await proxy.workspaceInsertBefore(workspaceId, beforeWorkspaceId)
      const byId = new Map(get().workspaces.map(item => [item.workspaceId, item]))
      set({
        workspaces: [
          ...workspaceIds.flatMap(id => byId.get(id) === undefined ? [] : [byId.get(id)!]),
          ...get().workspaces.filter(item => item.backend === 'codex'),
        ],
        busyAction: undefined,
      })
      return true
    } catch (error) {
      set({ busyAction: undefined, error: friendlyError(error) })
      return false
    }
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
    set({ historyLoadingOlder: true })
    try {
      const page = session.backend === 'codex'
        ? await readCodexHistoryPage(connection.requireCodex(), codexThreadId(session), beforeSeq, 60)
        : await connection.requireProxy().sessionHistory(session.sessionId, beforeSeq, 60)
      const items = foldHistory(page.events, session.sessionId)
      const older = oldestSeq(page.events)
      set(state => ({
        messages: {
          ...state.messages,
          [session.sessionId]: prependHistory(items, state.messages[session.sessionId] ?? []),
        },
        historyHasMore: page.hasMore,
        oldestLoadedSeq: older ?? state.oldestLoadedSeq,
        historyLoadingOlder: false,
      }))
    } catch (error) {
      set({ historyLoadingOlder: false, error: friendlyError(error) })
    }
  },

  async workspaceCreate(path, backend = 'harness') {
    if (get().connection.phase !== 'connected') return undefined
    set({ busyAction: backend === 'codex' ? 'create-codex-workspace' : 'create-workspace', error: undefined })
    try {
      if (backend === 'codex') {
        const workspace = await createCodexWorkspace(connection.requireCodex(), path, createNativeRpcId())
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
    const session = get().selectedSession
    const text = input.trim()
    if (session === undefined || (text.length === 0 && images.length === 0)) return false
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
      } else {
        await connection.requireProxy().sessionPrompt(session.sessionId, text, requestRpcId, images)
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
      set(state => ({
        devices: state.devices.filter(device => device.deviceId !== deviceId),
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
      })
    }
  },

  clearError() {
    set({ error: undefined })
  },

  handleMuxFrame(frame) {
    set(state => ({
      messages: applyMuxFrameToMessages(state.messages, frame),
    }))
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
}))

async function closeActiveCodexStream(notifyRemote = true): Promise<void> {
  const stream = activeCodexStream
  activeCodexStream = undefined
  activeCodexTimeline = undefined
  if (notifyRemote && stream !== undefined) await stream.close().catch(() => undefined)
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

function findApproval(messages: Record<string, ChatItem[]>, itemId: string) {
  for (const items of Object.values(messages)) {
    const found = items.find(item => item.kind === 'approval' && item.id === itemId)
    if (found !== undefined && found.kind === 'approval') return found
  }
  return undefined
}

function findQuestion(messages: Record<string, ChatItem[]>, itemId: string) {
  for (const items of Object.values(messages)) {
    const found = items.find(item => item.kind === 'question' && item.id === itemId)
    if (found !== undefined && found.kind === 'question') return found
  }
  return undefined
}

function mapApprovalOutcome(
  messages: Record<string, ChatItem[]>,
  itemId: string,
  outcome: 'allowed-once' | 'rejected',
): Record<string, ChatItem[]> {
  return mapItems(messages, item => item.kind === 'approval' && item.id === itemId
    ? { ...item, outcome }
    : item)
}

function mapQuestionAnswered(
  messages: Record<string, ChatItem[]>,
  itemId: string,
): Record<string, ChatItem[]> {
  return mapItems(messages, item => item.kind === 'question' && item.id === itemId
    ? { ...item, outcome: 'answered' as const }
    : item)
}

function mapItems(
  messages: Record<string, ChatItem[]>,
  map: (item: ChatItem) => ChatItem,
): Record<string, ChatItem[]> {
  return Object.fromEntries(Object.entries(messages).map(([sessionId, items]) => [sessionId, items.map(map)]))
}

function mergeHistoryAndLive(history: ChatItem[], live: ChatItem[]): ChatItem[] {
  const liveById = new Map(live.map(item => [item.id, item]))
  const historyIds = new Set(history.map(item => item.id))
  return [
    ...history.map(item => liveById.get(item.id) ?? item),
    ...live.filter(item => !historyIds.has(item.id)),
  ]
}

/** Prepend an older history page in front of the current chat items, deduplicated by id. */
function prependHistory(older: ChatItem[], current: ChatItem[]): ChatItem[] {
  const currentIds = new Set(current.map(item => item.id))
  return [...older.filter(item => !currentIds.has(item.id)), ...current]
}

/** Smallest event seq in a history page; drives the next `session.history` beforeSeq. */
function oldestSeq(events: HistoryEntry[]): number | undefined {
  let oldest: number | undefined
  for (const entry of events) {
    const seq = entry.event.seq
    if (Number.isSafeInteger(seq)) oldest = oldest === undefined ? seq : Math.min(oldest, seq)
  }
  return oldest
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
  'config' | 'account' | 'devices' | 'selectedDevice' | 'connection' | 'hostDescriptor' | 'codexAvailable' | 'workspaces' |
  'archivedSessionIds' | 'sessions' | 'selectedSession' | 'messages' | 'sessionModels' | 'modelSelecting' | 'permissionSelecting' |
  'historyHasMore' | 'historyLoadingOlder' | 'oldestLoadedSeq' | 'transportPreference' | 'authPhase' | 'refreshing' | 'busyAction' | 'error' |
  'connectionProbeOrder' | 'connectionNetworkDetails' | 'reauthRequired'> {
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
    workspaces: [],
    archivedSessionIds: [],
    sessions: [],
    selectedSession: undefined,
    messages: {},
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
