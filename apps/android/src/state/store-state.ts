import type { AgentAcpFrameData } from '@dsh-remote/protocol'
import type { AppLanguage, LanguagePreference } from '../locales/i18n'
import type { OAuthProviderInfo, OAuthQrPollResult, OAuthQrSession } from '../services/api'
import type {
  AgentBackend,
  AgentPresetOption,
  ChatItem,
  ChatMessage,
  ConnectionNetworkDetails,
  ConnectionProbeTransport,
  ConnectionSnapshot,
  ConnectionStage,
  DefaultPermissionPreset,
  DeviceIdentity,
  HostDescriptor,
  ModelSelection,
  MuxStreamFrame,
  PromptImage,
  RedirectLoginMethod,
  RemoteDevice,
  RemoteSession,
  SendMessageResult,
  ServerConfig,
  SessionModels,
  TransportPreference,
  WorkspaceShortcut,
  WorkspaceView,
} from '../types'
import type { ThemePreference } from '../ui/theme'

type BootPhase = 'loading' | 'ready' | 'error'

type AuthPhase = 'idle' | 'authenticating' | 'complete' | 'error'

/** Provider discovery result for QR sign-in; the Base URL is already normalized. */
export interface QrProviderList {
  baseUrl: string
  providers: OAuthProviderInfo[]
}

/** A QR sign-in session bound to the Server and provider that created it. */
export interface QrLoginStart {
  baseUrl: string
  provider: OAuthProviderInfo
  session: OAuthQrSession
}

export interface AppState {
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
  piAvailable: boolean
  opencodeAvailable: boolean
  claudeAvailable: boolean
  workspaceCatalog?: { backend: AgentBackend; loading: boolean; error?: string }
  workspaces: WorkspaceView[]
  favoriteWorkspaces: WorkspaceShortcut[]
  /** Newest first; the home screen falls back to these when Favorites is empty. */
  recentWorkspaces: WorkspaceShortcut[]
  archivedSessionIds: string[]
  sessions: RemoteSession[]
  selectedSession?: RemoteSession
  /** History and the current connection's Codex event subscription are ready. */
  codexReadySessionId?: string
  /** Successfully opened in this remote-use lifecycle; retained across transport recovery. */
  currentWorkSessionIds: string[]
  messages: Record<string, ChatItem[]>
  sessionLifecycles: Record<string, { seq: number; running: boolean; turn?: string; finished?: 'completed' | 'failed' }>
  sessionProjectionSeqs: Record<string, Record<string, number>>
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
  statusBarVisible: boolean
  themePreference: ThemePreference
  defaultPermissionPreset: DefaultPermissionPreset
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
  listQrProviders(input: string): Promise<QrProviderList | undefined>
  startQrLogin(input: string, providerId: string): Promise<QrLoginStart | undefined>
  pollQrLogin(baseUrl: string, qrId: string): Promise<OAuthQrPollResult | undefined>
  completeQrLogin(baseUrl: string, token: string, method: RedirectLoginMethod): Promise<boolean>
  refreshDevices(): Promise<void>
  refreshWorkspaces(backend?: AgentBackend): Promise<void>
  refreshSessionStatus(): Promise<void>
  refreshConnectionNetworkDetails(): Promise<void>
  resumeConnection(): Promise<void>
  trustDevice(device: RemoteDevice): Promise<boolean>
  forgetDevice(deviceId: string): Promise<boolean>
  renameDevice(deviceId: string, name: string): Promise<boolean>
  connectDevice(device: RemoteDevice, options?: { forceRelay?: boolean }): Promise<boolean>
  reconnect(options?: { forceRelay?: boolean; restoreSession?: boolean }): Promise<boolean>
  disconnect(): Promise<void>
  openSession(session: RemoteSession): Promise<boolean>
  sendMessage(text: string, images?: PromptImage[], reuseRpcId?: string): Promise<SendMessageResult>
  retrySendMessage(itemId: string): Promise<boolean>
  updateQueueItem(itemId: string, action: 'remove' | 'steer', rpcId?: string): Promise<boolean>
  forkChatMessage(message: ChatMessage): Promise<boolean>
  rateMessage(message: ChatMessage, rating: 'positive' | 'negative'): Promise<boolean>
  stopSession(): Promise<void>
  respondApproval(itemId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>
  respondQuestion(itemId: string, selected: Record<string, string[]>, custom?: Record<string, string>): Promise<void>
  createSession(workspaceId?: string): Promise<boolean>
  archiveSession(sessionId: string): Promise<boolean>
  selectModel(selection: ModelSelection): Promise<boolean>
  selectPermission(preset: string): Promise<boolean>
  loadAgentPresets(): Promise<boolean>
  selectAgentPreset(preset: string): Promise<boolean>
  loadOlderHistory(): Promise<void>
  workspaceCreate(path: string, backend?: 'harness' | 'codex' | 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude'): Promise<WorkspaceView | undefined>
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
  setStatusBarVisible(visible: boolean): Promise<void>
  setThemePreference(preference: ThemePreference): Promise<void>
  setDefaultPermissionPreset(preset: DefaultPermissionPreset): Promise<void>
  syncSystemLocales(localeTags: readonly string[]): void
  resetLocalData(): Promise<void>
  signOut(): Promise<void>
  setOffline(): void
  clearError(): void
  handleMuxFrame(frame: MuxStreamFrame): void
  handleCodexFrame(frame: { method: string; params: unknown }): void
  handleCodexFrames(frames: { method: string; params: unknown }[]): void
  handleCursorFrame(frame: AgentAcpFrameData): void
}

export const disconnected: ConnectionSnapshot = {
  phase: 'disconnected',
  stats: { mode: 'Disconnected', connected: false },
}

export function initialData(): Pick<AppState,
  'config' | 'account' | 'devices' | 'selectedDevice' | 'connection' | 'hostDescriptor' | 'codexAvailable' | 'cursorAvailable' | 'antigravityAvailable' | 'piAvailable' | 'opencodeAvailable' | 'claudeAvailable' | 'workspaceCatalog' | 'workspaces' |
  'favoriteWorkspaces' | 'recentWorkspaces' | 'archivedSessionIds' | 'sessions' | 'selectedSession' | 'codexReadySessionId' | 'currentWorkSessionIds' | 'messages' | 'sessionModels' | 'modelSelecting' | 'permissionSelecting' |
  'historyHasMore' | 'historyLoadingOlder' | 'oldestLoadedSeq' | 'transportPreference' | 'authPhase' | 'refreshing' | 'busyAction' | 'error' |
  'connectionProbeOrder' | 'connectionNetworkDetails' | 'reauthRequired' | 'feedbackBySession' | 'commandResult' | 'sessionLifecycles' | 'sessionProjectionSeqs'> {
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
    piAvailable: false,
    opencodeAvailable: false,
    claudeAvailable: false,
    workspaceCatalog: undefined,
    workspaces: [],
    favoriteWorkspaces: [],
    recentWorkspaces: [],
    archivedSessionIds: [],
    sessions: [],
    selectedSession: undefined,
    codexReadySessionId: undefined,
    currentWorkSessionIds: [],
    messages: {},
    sessionLifecycles: {},
    sessionProjectionSeqs: {},
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

/** Shared action signatures; the connection and stream lifecycle remain owned by SessionRuntime. */
export interface StoreAccess {
  get: () => AppState
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void
}
