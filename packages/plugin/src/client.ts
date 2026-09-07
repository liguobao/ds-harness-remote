import QRCode from 'qrcode'
import {
  REMOTE_FILE_SAVE_AS_MAX_BYTES,
  createRemoteFileContentProvider,
  remoteFileSaveAsMaxBytes,
  shouldAllowRemoteFileSaveAs,
  shouldUseRemoteFileViewer,
  type RemoteFileContentProvider,
} from './remote-file-content-provider.js'
import { CONTROL_RPC_PREFIX } from './control-route.js'

declare global {
  interface Window {
    __ModuleLoader__: {
      load(input: { id: string; factory: (require: (id: string) => unknown) => unknown }): void
    }
    __DS_HARNESS_REMOTE_CLIENT_ACTIVE__?: boolean
  }
}

declare const DSH_REMOTE_CLIENT_MODULE_ID: string | undefined

const clientModuleId = typeof DSH_REMOTE_CLIENT_MODULE_ID === 'string'
  ? DSH_REMOTE_CLIENT_MODULE_ID
  : 'ds-harness-remote'
const pendingWorkspaceSelectionKey = 'dsh-remote:pending-workspace-selection'
const deepSeekWorkspaceIcon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAACVBMVEUAAADy8vXx8fUsA3vyAAAAAXRSTlMAQObYZgAAAOxJREFUWMPtlsEOwyAMQxP+/6OnTZMGxHGcot3wDYgfhkJbs6urprzveGtu9d1NgEdto8w93GuA7zPS2RFg7ynsCOAokbtAmLr2YaeKgJ6fxpT8jCAC0qSqPyNoO5DXdvyouj4ClFAdYaDxK09uiBDCIYBf6CxLesnR0uF2pG+JmhCqrUb0AOvjjoQaYDTCEAAgMg5grhAeAQIB+/M15IcKlnUIp4CkTCd0AKb4zVsRSJVGYEVzT0agK107IMGMEurvromEpaX4wzk/IKw378kq4LafED6Oowxfk7AP2q8W16EdM3p29Eyvrv6vF0WIBfBziKyCAAAAAElFTkSuQmCC'
const gptWorkspaceIcon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAclBMVEX////v7+++wMf////s7O3k5OTExcrX2Ny6vMTv8PPW19yXmqRqboJmaHd3eoaqrLPs7fGMjpfb3eKlpq1eYXOxs7pWWWd+gY5HSVdRVGVub3k+QU74+Pg4OkcvMT1ISlUoKjUiIy4fICueoKkaGyUSFB21Bp+qAAAAAXRSTlMAQObYZgAABChJREFUWMPtl916qjoQhlsdEwIECEgMYCBxx/u/xT1DrFUL1LO1DtY8LSLJvPnmB4gfH//sr7TPDfvdebf/xXZbkE/4zZ0MVhGHd9zJDsv+7F3//Z69tT5wljAu3tXw+TIlzXKJlhflYmJ+5uF5WpWhb54X+C/zZCmT2wJA4dJZwus0UYjIGqWyMhVbEp4yKNRRqlv0opW5PJLJ4rFJXvP4JKDRMqturBZjkMVJFYjR6iHQDQDI4+k2k51wZbWrqwp4mR/1CVYATyko9TFGxBUqL5IvMbXSWt0T8bkGgFLqgqZBI/Uxbx5UAxLaNcCNLBpttM7wbCc1pmJOpWAsDtey68UaQMyrFgb9uxLPjqg3+nGluyKN0XUdWw0BJ0NvTFFqgzpr9J+Dh4w0Ga1qkqBNswagxdRgFPAbgHRQG5jumGWyMxrTIaRRa4AzFs0YrNMXgI4MJWnsKYFhGNMnIh/mBOPsV8CZBFjN9w8ArowxnZzDr5IcvxTaKpxJCVsoI3SWysz1UM4AqQdzlCgho1IKrK+x1mKFzisANtgEU8E7GwHDgOqxe4w9tnM166wbaA2xBMBLrTWcAGYGdCiYVUJUrMCF+7l6gklrW1RwPi8ByjuActANqhKzVWoYrFGcCFzbDgNaBrTWpncFQMcI2DfWoAiDqRCiHcYM/ZdCEKkZqfR8spj4F0CiJjv2gHL6URNoCQDaYacL6O1oFDO2eQDUFP7AKdCRdC4CRDZaNifbjA41l/uYb/SZMAFNTBGzY7sG4J2jTsJgToOzIzXF3HZqBpSOAGduXbkGEKV1OqVGqRJpRxtvwbSw5IqAiUJItwBCOT9R32FCGo3nCkAN3t0UTBRC6zDONcBeOee9pr4T+ASbnDOdc5OmtREwEEB5w8Wqgt4bOV5c7Lt9iiK8zdP/IsBbutUGX4gNwEVCqd3FUt/xYnRWt7BvPBYQjwjAGXa3ASguHVAZ/WXKlA3eZDX1wRegFsr7E2wAlB9xFbx/7MV70kFT8aqNgLL3F8nFBmA3hrn/IJHjKJOK2oj1WI4Z4FzwN/81AOhgYD6v2xbIvaZIurLC9AfvB1WLTYAoXejF1xeBL5cpBIyEbmxkZymIXwDQh1BAfOrhI1lfwtgz8tozF5T4ttf3+32AyxC6klwAgw/YVTHpoK82xYt3wLP/Bw4AAI4D7/01TLKXBj9NEz2wEuGiKpoy68S/FwCLMQAZ3gXhihaCa25vQo6RyToOz9PE6wYjJgGi1YnqZX8qMIK+TDlnargGzSv4NvFjlwXf/nfLLMrAB4O/Xl3BH0d+RIASFgDA8IYMIXgr2+cBsbDdPSwAAHjSZFmb3txETCKIxc0uWwI8rxsLJcTiVndNwyMgKljbbNN2/zcEAja2+4RgIDYN2Bu/WtAOaEodnu2dnzz/7I/Y/w/LaEcX/MdfAAAAAElFTkSuQmCC'

interface ControlResult<T = unknown> {
  ok: boolean
  value?: T
  error?: { message?: string }
}

interface FileViewerClientServiceLike {
  registerContentProvider(provider: RemoteFileContentProvider): () => void
}

type RemoteTransportPreference = 'lan' | 'p2p' | 'turn' | 'relay'

interface RemoteStatus {
  mode: 'local' | 'remote'
  backend?: 'harness' | 'codex'
  target?: { deviceId: string; name: string }
  workspaceSelection?: RemoteWorkspaceSelection
  available: boolean
  controlUnavailable?: boolean
  deviceName?: string
  serverUrl?: string
  connected?: boolean
  connectedTargetDeviceId?: string
  transport?: 'LAN' | 'P2P' | 'TURN' | 'Relay' | 'Disconnected'
  preferredTransports?: RemoteTransportPreference[]
  connectionProgress?: {
    targetDeviceId: string
    phase: 'checking-host' | 'authorizing-peer' | 'probing' | 'connected'
    activeTransports?: RemoteTransportPreference[]
  }
  remoteFeatures?: { commandList: boolean; fileViewer: boolean; codex?: boolean }
  network?: RemoteNetworkDetails
  hostAuthorizationAvailable: boolean
  host?: {
    deviceId?: string
    configured: boolean
    online: boolean
    reconnecting: boolean
    lastActiveAt?: number
    error?: string
    account?: string
    authorized: boolean
    accountRequired: boolean
  }
}

interface RemoteNetworkDetails {
  connectionId?: string
  connectedAt?: number
  controlChannelUrl: string
  controlChannelState: 'connecting' | 'open' | 'closing' | 'closed'
  preferredTransports: RemoteTransportPreference[]
  local: { deviceId: string; name: string; platform: string }
  remote: { deviceId: string; name: string; platform: string }
  webRtc?: {
    mode?: 'LAN' | 'P2P' | 'TURN'
    connectionState: string
    iceConnectionState: string
    dataChannelState?: string
    localCandidateType?: string
    remoteCandidateType?: string
    localAddress?: string
    remoteAddress?: string
    protocol?: string
    relayProtocol?: string
    currentRoundTripTimeMs?: number
    availableOutgoingBitrate?: number
    bytesSent?: number
    bytesReceived?: number
  }
}

interface RemoteDevice {
  deviceId: string
  name: string
  platform: string
  online: boolean
  clientVersion?: string
  harnessVersion?: string
}

interface OAuthQrSession {
  qrId: string
  scanUrl: string
  expiresIn: number
}

type OAuthProvider = 'zhihu' | 'github'
type LoginMethod = OAuthProvider | 'password'

interface OAuthQrPollResult {
  status: 'pending' | 'expired' | 'complete'
}

interface RemoteDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

interface RemoteDirectoryListing {
  path: string
  home: string
  crumbs: RemoteDirectoryEntry[]
  entries: RemoteDirectoryEntry[]
  truncated: boolean
}

interface RemoteWorkspaceView {
  workspaceId: string
  path: string
  title: string
}

interface CodexWorkspaceView extends RemoteWorkspaceView {
  sessionCount: number
}

interface RemoteWorkspaceSelection {
  targetDeviceId: string
  workspaceId: string
  backend?: 'harness' | 'codex'
  sessionId?: string
}

function storedWorkspaceSelection(): RemoteWorkspaceSelection | undefined {
  const raw = window.sessionStorage.getItem(pendingWorkspaceSelectionKey)
  if (raw === null) return undefined
  try {
    const value = JSON.parse(raw) as Partial<RemoteWorkspaceSelection>
    if (typeof value.targetDeviceId !== 'string' || typeof value.workspaceId !== 'string') throw new Error('invalid')
    if (value.backend !== undefined && value.backend !== 'harness' && value.backend !== 'codex') throw new Error('invalid')
    if (value.sessionId !== undefined && typeof value.sessionId !== 'string') throw new Error('invalid')
    return value as RemoteWorkspaceSelection
  } catch {
    window.sessionStorage.removeItem(pendingWorkspaceSelectionKey)
    return undefined
  }
}

interface WorkspacesClientServiceLike {
  list: {
    getSnapshot(): {
      items: ReadonlyArray<{ workspaceId: string }>
      baselinesReady?: boolean
      phase?: string
    }
    subscribe(listener: () => void): () => void
  }
  connectWorkspace(workspaceId: string): Promise<string>
}

interface SessionsClientServiceLike {
  list: {
    getSnapshot(): { ids: ReadonlyArray<string>; phase: string }
    subscribe(listener: () => void): () => void
  }
  open(sessionId: string): void
}

function workspacesReady(snapshot: ReturnType<WorkspacesClientServiceLike['list']['getSnapshot']>): boolean {
  return snapshot.baselinesReady === true || snapshot.phase === 'ready'
}

interface PluginSettings {
  enabled?: boolean
  role?: 'host' | 'client' | 'both'
  serverUrl?: string
  forceRelay?: boolean
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  reconnect?: boolean | {
    enabled?: boolean
    initialDelayMs?: number
    maxDelayMs?: number
    jitter?: number
  }
  codex?: {
    enabled?: boolean
    binary?: string
  }
}

interface PluginSettingsView {
  config: PluginSettings
  deviceName: string
  writable: boolean
  applies: 'restart'
  association?: PluginAssociation
  associations?: Partial<Record<'host' | 'client', PluginAssociation>>
}

interface PluginAssociation {
  method: 'account' | 'host_registration_code' | 'owned_device'
  account?: string
}

interface PluginConfigureResult {
  status: 'authorized'
  role: 'host' | 'client'
  account?: string
  settings: PluginSettingsView
}

const localeNamespace = 'ds-harness-remote'

const en = {
  pluginTitle: 'DeepSeek Remote',
  pluginDescription: 'Connect once. Available anytime.',
  expandSettings: 'Show settings: {name}',
  collapseSettings: 'Hide settings: {name}',
  unsaved: 'Unsaved',
  associated: 'Authorized',
  authorizationComplete: 'Authorization complete',
  loadingSettings: 'Loading DeepSeek Remote settings…',
  mode: 'Mode',
  pluginMode: 'Plugin mode',
  host: 'Host',
  client: 'Client',
  authorization: 'Authorization',
  account: 'Account',
  hostRegistrationCode: 'One-time device authorization code',
  ownedDeviceAuthorization: 'Owned device',
  authorizedOn: '{role} is authorized on {serverUrl}.',
  readOnly: 'This DSH profile does not provide writable user settings.',
  discard: 'Discard',
  save: 'Save',
  saving: 'Saving…',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  serverUrl: 'Server URL',
  serverUrlHint: 'HTTPS origin used for account authorization and encrypted relay.',
  serverSaved: 'Server address saved. Restart DSH to apply it.',
  codexRemote: 'Codex Remote',
  codexRemoteHint: 'Expose Codex projects through this Host. Restart DSH after changing this setting.',
  codexSaved: 'Codex Remote setting saved. Restart DSH to apply it.',
  authorizeFromRemote: 'Sign in from the Remote entry in the sidebar, then return here to manage this device.',
  authorizationMethod: 'Authorization method',
  accountPassword: 'Account password',
  registrationCode: 'Device authorization code',
  registrationCodeHint: 'Generate it after signing in on the Server website. Use it once to connect this device.',
  accountHint: 'The account must belong to the selected Server.',
  password: 'Password',
  passwordHint: 'Used only for this HTTPS authorization request and never saved.',
  modeSavedNeedsAuthorization: 'Mode saved. Authorize {role} before connecting. Existing registrations were kept.',
  modeSavedReused: 'Mode saved. Existing registration reused. Restart Harness to apply.',
  modeSavedOwnedRole: 'Mode saved. This owned device was authorized automatically. Restart Harness to apply.',
  enterRegistrationCode: 'Enter the device authorization code.',
  enterAccountPassword: 'Enter the Server account and password.',
  associationSaved: 'Associated. Restart Harness to apply.',
  signedOut: 'Signed out. Restart Harness to disconnect this mode.',
  remoteRequestFailed: 'Remote mode request failed.',
  remoteControlUnavailable: 'Remote plugin control is still starting. Restart DSH if it stays unavailable.',
  switchTarget: 'Switch Local / Remote Harness target',
  harnessTarget: 'Harness target',
  close: 'Close',
  refreshRemote: 'Refresh remote hosts',
  refreshRemoteShort: 'Refresh',
  local: 'Local',
  remoteTarget: 'Remote · {name}',
  thisMachineLocal: 'This machine (Local)',
  currentDevice: 'Current device',
  noRemoteHosts: 'No authorized remote Host for this account.',
  online: 'Online',
  offline: 'Offline',
  thisMachineHost: 'This machine as Remote Host',
  connected: 'Connected',
  connectedAs: 'Connected as {account}',
  connection: 'Connection',
  checkingConnection: 'Checking connection…',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  lastActive: 'Last active: {time}',
  neverConnected: 'No successful connection yet.',
  reconnect: 'Reconnect',
  reconnectingAction: 'Reconnecting…',
  reconnectStarted: 'Reconnect requested.',
  connectionAuthorizationExpired: 'Authorization expired. Sign out and authorize this Host again.',
  connectionDeviceRevoked: 'This Host was revoked on the Server. Sign out and authorize it again.',
  connectionOwnershipRequired: 'The Server no longer recognizes this Host as an owned device.',
  connectionRateLimited: 'The Server is receiving too many requests. Automatic retry will continue.',
  connectionVersionMismatch: 'The Plugin and Server protocol versions are incompatible.',
  connectionInvalidResponse: 'The Server returned an invalid control message.',
  connectionReachability: 'Cannot reach the Server. Check the network and Server address.',
  connectionUnexpected: 'The connection stopped unexpectedly. Automatic retry will continue.',
  hostSignInHint: 'Sign in to authorize this Host on the selected Server.',
  checkingHost: 'Checking Host registration…',
  hostUnavailable: 'Host unavailable: {error}',
  serverAccountEmail: 'Server account email',
  serverAccountPassword: 'Server account password',
  signInRegisterHost: 'Sign in and register Host',
  signingIn: 'Signing in…',
  useRegistrationCode: 'Use connection code',
  registering: 'Registering…',
  remoteEntry: 'Remote',
  remoteTitle: 'Open a remote workspace',
  remoteDescription: 'Choose one of your Hosts, then select a working directory. The Harness interface stays on this device.',
  chooseHost: 'Host',
  chooseDirectory: 'Working directory',
  selectHostHint: 'Select an online Host to browse its directories.',
  emptyDirectory: 'This directory has no visible subdirectories.',
  openWorkspace: 'Open workspace',
  openingWorkspace: 'Opening…',
  loadingDirectory: 'Loading directories…',
  remoteProgressCheckingHost: 'Checking Host',
  remoteProgressCheckingHostDetail: 'Finding the selected device and checking whether it is online.',
  remoteProgressAuthorizingPeer: 'Verifying authorization',
  remoteProgressAuthorizingPeerDetail: 'Confirming account membership and pinned Host identity.',
  remoteProgressOpeningChannel: 'Opening encrypted channel',
  remoteProgressOpeningChannelDetail: 'Trying LAN, P2P, TURN, then Relay if needed.',
  remoteProgressProbeLan: 'Probing LAN',
  remoteProgressProbeLanDetail: 'Checking whether the Host is reachable on the local network.',
  remoteProgressProbeP2p: 'Probing P2P',
  remoteProgressProbeP2pDetail: 'Checking direct internet candidates between this device and the Host.',
  remoteProgressProbeTurn: 'Probing TURN',
  remoteProgressProbeTurnDetail: 'Checking the TURN relay path for restricted networks.',
  remoteProgressProbeRelay: 'Preparing Relay',
  remoteProgressProbeRelayDetail: 'Preparing the encrypted Server Relay fallback if direct paths do not open.',
  remoteProgressTryingPrefix: 'Trying ',
  remoteProgressUsingPrefix: 'Using ',
  remoteProgressLoadingWorkspaces: 'Loading workspaces',
  remoteProgressLoadingWorkspacesDetail: 'Reading the remote Harness workspace list through the tunnel.',
  remoteProgressSwitchingWorkspace: 'Switching interface',
  remoteProgressSwitchingWorkspaceDetail: 'Handing the remote workspace to the local Harness UI.',
  remoteProgressReady: 'Ready',
  remoteProgressReadyDetail: 'The remote Host is connected and encrypted.',
  backToHosts: 'Choose another Host',
  currentDirectory: 'Selected directory',
  directoryTruncated: 'Only part of this directory could be shown.',
  pluginVersion: 'Plugin {version}',
  harnessVersion: 'Harness {version}',
  existingWorkspaces: 'Existing workspaces',
  remotePathPlaceholder: '/home/user/project',
  remotePathHint: 'Enter an absolute directory path on the selected Host.',
  noRemoteWorkspaces: 'No remote workspaces yet. Use + to add one.',
  activeRemote: '{name}',
  exitRemote: 'Exit',
  addRemoteWorkspace: 'Add remote workspace',
  addCodexWorkspace: 'Add CodeX workspace',
  noCodexWorkspaces: 'No CodeX workspaces yet.',
  cancelAddWorkspace: 'Cancel',
  confirmAddWorkspace: 'Add and open',
  showAllWorkspaces: 'Show all DSH workspaces',
  showAllCodexWorkspaces: 'Show all CodeX workspaces',
  remoteModeLabel: 'Remote mode · {name}',
  remoteNetworkP2p: 'P2P',
  remoteNetworkTurn: 'TURN',
  remoteNetworkRelay: 'Relay',
  remoteNetworkLan: 'LAN',
  remoteNetworkOffline: 'Disconnected',
  remoteLinkEncrypted: 'End-to-end encrypted',
  connectionRouteTitle: 'Connection route',
  connectionRouteFrom: 'From',
  connectionRouteVia: 'Via',
  connectionRouteTo: 'To',
  connectionRouteCurrentDevice: 'This device',
  connectionRouteLan: 'Local network',
  connectionRouteP2p: 'Direct internet path',
  connectionRouteTurn: 'TURN relay service',
  connectionRouteRelay: 'Remote Server',
  connectionRouteHost: 'Work computer running Harness',
  connectionRouteLanDetail: 'Direct transfer over the local network',
  connectionRouteP2pDetail: 'Direct transfer over the internet',
  connectionRouteTurnDetail: 'Encrypted transfer through the TURN service',
  connectionRouteRelayDetail: 'Encrypted transfer through the Remote Server',
  connectionRouteEncrypted: 'Application data remains end-to-end encrypted along this route.',
  connectionDetailsConnection: 'Connection',
  connectionDetailsWebRtc: 'Network details · WebRTC / ICE',
  connectionId: 'Connection ID',
  connectedAt: 'Established',
  preferredTransports: 'Attempt order',
  controlChannel: 'Control channel',
  controlAddress: 'Control address',
  controlStateConnecting: 'Connecting',
  controlStateOpen: 'Connected',
  controlStateClosing: 'Closing',
  controlStateClosed: 'Closed',
  peerState: 'Peer connection',
  dataChannel: 'DataChannel',
  localCandidate: 'Local candidate',
  remoteCandidate: 'Remote candidate',
  localAddress: 'Local address',
  remoteAddress: 'Remote address',
  networkProtocol: 'Network protocol',
  relayProtocol: 'TURN protocol',
  roundTripTime: 'Round-trip time',
  availableBitrate: 'Available outgoing bitrate',
  bytesSent: 'WebRTC bytes sent',
  bytesReceived: 'WebRTC bytes received',
  notProvided: 'Not provided',
  candidateHost: 'Local address · host',
  candidateSrflx: 'Public address · srflx',
  candidatePrflx: 'Peer address · prflx',
  candidateRelay: 'TURN address · relay',
  openLocalWorkspaces: 'Open local workspaces',
  clientSignInHint: 'Sign in to this Server to list your remote Hosts.',
  signInClient: 'DeepSeek Harness Remote',
  signInClientDescription: 'Connect once. Available anytime.',
  startSignIn: 'Start sign-in',
  allowControlCurrentDevice: 'Allow control of this device',
  exitRemoteAccount: 'Sign out',
  githubLogin: 'GitHub QR',
  zhihuLogin: 'Zhihu QR',
  scanWithGitHub: 'Scan to continue with GitHub',
  scanWithZhihu: 'Scan to continue with Zhihu',
  openInBrowser: 'Continue in browser',
  scanLoginHint: 'Authorize on your phone. This window will continue automatically.',
  currentServiceAddress: 'Current service address:',
  accountPasswordLogin: 'Password',
  qrLoginExpired: 'This QR code expired. Refresh it to continue.',
  refreshQrCode: 'Refresh QR code',
  codexVirtualWorkspace: 'CodeX virtual workspace',
  codexVirtualSessions: 'Sessions',
} as const

const zh: Record<keyof typeof en, string> = {
  pluginTitle: 'DeepSeek 远程连接',
  pluginDescription: '一次连接，随时可用。',
  expandSettings: '展开设置：{name}',
  collapseSettings: '收起设置：{name}',
  unsaved: '未保存',
  associated: '已授权',
  authorizationComplete: '已完成授权',
  loadingSettings: '正在加载 DeepSeek 远程连接设置…',
  mode: '模式',
  pluginMode: '插件模式',
  host: '主机',
  client: 'Client',
  authorization: '授权',
  account: '账号',
  hostRegistrationCode: '一次性设备授权码',
  ownedDeviceAuthorization: '自有设备',
  authorizedOn: '{role}已经在 {serverUrl} 完成授权。',
  readOnly: '此 DSH profile 不提供可写的用户设置。',
  discard: '放弃修改',
  save: '保存',
  saving: '保存中…',
  signOut: '退出授权',
  signingOut: '正在退出…',
  serverUrl: 'Server 地址',
  serverUrlHint: '用于账号授权和加密中继的 HTTPS 地址。',
  serverSaved: 'Server 地址已保存，重启 DSH 后生效。',
  codexRemote: 'Codex Remote',
  codexRemoteHint: '通过这台 Host 提供 Codex 项目；修改后需重启 DSH 生效。',
  codexSaved: 'Codex Remote 设置已保存，重启 DSH 后生效。',
  authorizeFromRemote: '请从侧栏 Remote 入口登录，登录后可在这里管理当前设备。',
  authorizationMethod: '授权方式',
  accountPassword: '账号密码',
  registrationCode: '设备授权码',
  registrationCodeHint: '登录 Server 网页后生成，用一次即可连接这台设备。',
  accountHint: '账号必须属于所选 Server。',
  password: '密码',
  passwordHint: '仅用于本次 HTTPS 授权请求，不会保存。',
  modeSavedNeedsAuthorization: '模式已保存。连接前请先授权 {role}；已有注册信息已保留。',
  modeSavedReused: '模式已保存并复用已有注册信息。重启 Harness 后生效。',
  modeSavedOwnedRole: '模式已保存，并已自动授权此自有设备。重启 Harness 后生效。',
  enterRegistrationCode: '请输入设备授权码。',
  enterAccountPassword: '请输入 Server 账号和密码。',
  associationSaved: '关联成功。重启 Harness 后生效。',
  signedOut: '已退出授权。重启 Harness 后将断开此模式。',
  remoteRequestFailed: '远程模式请求失败。',
  remoteControlUnavailable: 'Remote 插件控制通道仍在启动；如果一直不可用，请重启 DSH。',
  switchTarget: '切换本地或远程 Harness',
  harnessTarget: 'Harness 目标',
  close: '关闭',
  refreshRemote: '刷新远程主机',
  refreshRemoteShort: '刷新',
  local: '本地',
  remoteTarget: '远程 · {name}',
  thisMachineLocal: '此设备（本地）',
  currentDevice: '当前设备',
  noRemoteHosts: '此账号没有已授权的远程 Host。',
  online: '在线',
  offline: '离线',
  thisMachineHost: '将此设备作为远程 Host',
  connected: '已连接',
  connectedAs: '已使用 {account} 连接',
  connection: '连接状态',
  checkingConnection: '正在检查连接…',
  connecting: '正在连接',
  reconnecting: '正在重连',
  lastActive: '最后活跃：{time}',
  neverConnected: '尚未成功连接过。',
  reconnect: '手动重连',
  reconnectingAction: '正在重连…',
  reconnectStarted: '已发起重连。',
  connectionAuthorizationExpired: '授权已失效，请退出授权后重新连接此 Host。',
  connectionDeviceRevoked: '此 Host 已在 Server 上被撤销，请退出授权后重新连接。',
  connectionOwnershipRequired: 'Server 已不再将此 Host 识别为当前账号的设备。',
  connectionRateLimited: 'Server 请求过多，插件将继续自动重试。',
  connectionVersionMismatch: 'Plugin 与 Server 的协议版本不兼容。',
  connectionInvalidResponse: 'Server 返回了无效的控制消息。',
  connectionReachability: '无法连接 Server，请检查网络和 Server 地址。',
  connectionUnexpected: '连接意外中断，插件将继续自动重试。',
  hostSignInHint: '登录后在所选 Server 上授权此 Host。',
  checkingHost: '正在检查 Host 注册状态…',
  hostUnavailable: 'Host 不可用：{error}',
  serverAccountEmail: 'Server 账号邮箱',
  serverAccountPassword: 'Server 账号密码',
  signInRegisterHost: '登录并注册 Host',
  signingIn: '正在登录…',
  useRegistrationCode: '使用连接码',
  registering: '正在注册…',
  remoteEntry: 'Remote',
  remoteTitle: '打开远端工作区',
  remoteDescription: '选择想要连接主机和工作目录。',
  chooseHost: '主机',
  chooseDirectory: '工作目录',
  selectHostHint: '选择一台在线主机以浏览其目录。',
  emptyDirectory: '这个目录下没有可见的子目录。',
  openWorkspace: '打开工作区',
  openingWorkspace: '正在打开…',
  loadingDirectory: '正在加载目录…',
  remoteProgressCheckingHost: '正在检查 Host',
  remoteProgressCheckingHostDetail: '正在查找所选设备并确认是否在线。',
  remoteProgressAuthorizingPeer: '正在验证授权',
  remoteProgressAuthorizingPeerDetail: '正在确认账号成员关系和已固定的 Host 身份。',
  remoteProgressOpeningChannel: '正在建立加密通道',
  remoteProgressOpeningChannelDetail: '依次尝试局域网、P2P、TURN，必要时回落到 Relay。',
  remoteProgressProbeLan: '正在探测局域网',
  remoteProgressProbeLanDetail: '检查当前设备是否能通过本地网络直连 Host。',
  remoteProgressProbeP2p: '正在探测 P2P',
  remoteProgressProbeP2pDetail: '检查当前设备和 Host 之间的互联网直连候选路径。',
  remoteProgressProbeTurn: '正在探测 TURN',
  remoteProgressProbeTurnDetail: '检查受限网络下可用的 TURN 中继路径。',
  remoteProgressProbeRelay: '正在准备 Relay',
  remoteProgressProbeRelayDetail: '如果直连路径未打开，将回落到加密的 Server Relay。',
  remoteProgressTryingPrefix: '正在尝试 ',
  remoteProgressUsingPrefix: '已连接 ',
  remoteProgressLoadingWorkspaces: '正在加载工作区',
  remoteProgressLoadingWorkspacesDetail: '通过隧道读取远端 Harness 工作区列表。',
  remoteProgressSwitchingWorkspace: '正在切换界面',
  remoteProgressSwitchingWorkspaceDetail: '正在把远端工作区交给本地 Harness UI。',
  remoteProgressReady: '已就绪',
  remoteProgressReadyDetail: '远端 Host 已连接，端到端加密已建立。',
  backToHosts: '选择其他主机',
  currentDirectory: '已选目录',
  directoryTruncated: '目录内容较多，目前只显示了一部分。',
  pluginVersion: '插件 {version}',
  harnessVersion: 'Harness {version}',
  existingWorkspaces: '已有工作区',
  remotePathPlaceholder: '/home/user/project',
  remotePathHint: '输入所选主机上的绝对目录路径。',
  noRemoteWorkspaces: '这台主机还没有工作区，点击 + 添加。',
  activeRemote: '{name}',
  exitRemote: '退出',
  addRemoteWorkspace: '添加远程工作区',
  addCodexWorkspace: '添加 CodeX 工作区',
  noCodexWorkspaces: '还没有 CodeX 工作区。',
  cancelAddWorkspace: '取消',
  confirmAddWorkspace: '确认并打开',
  showAllWorkspaces: '显示全部 DSH 工作区',
  showAllCodexWorkspaces: '显示全部 CodeX 工作区',
  remoteModeLabel: '远程模式 · {name}',
  remoteNetworkP2p: 'P2P',
  remoteNetworkTurn: 'TURN',
  remoteNetworkRelay: '中继',
  remoteNetworkLan: '局域网',
  remoteNetworkOffline: '已断开',
  remoteLinkEncrypted: '端到端加密',
  connectionRouteTitle: '连接线路',
  connectionRouteFrom: '起点',
  connectionRouteVia: '经过',
  connectionRouteTo: '终点',
  connectionRouteCurrentDevice: '当前设备',
  connectionRouteLan: '同一局域网',
  connectionRouteP2p: '互联网直连',
  connectionRouteTurn: 'TURN 中继服务',
  connectionRouteRelay: 'Remote Server',
  connectionRouteHost: '运行 Harness 的工作电脑',
  connectionRouteLanDetail: '在本地网络中直接传输',
  connectionRouteP2pDetail: '通过互联网直接传输',
  connectionRouteTurnDetail: '通过 TURN 服务转发加密数据',
  connectionRouteRelayDetail: '通过 Remote Server 转发加密数据',
  connectionRouteEncrypted: '线路上的业务数据保持端到端加密。',
  connectionDetailsConnection: '连接',
  connectionDetailsWebRtc: '网络详情 · WebRTC / ICE',
  connectionId: '连接编号',
  connectedAt: '建立时间',
  preferredTransports: '尝试顺序',
  controlChannel: '控制通道',
  controlAddress: '控制地址',
  controlStateConnecting: '连接中',
  controlStateOpen: '已连接',
  controlStateClosing: '正在关闭',
  controlStateClosed: '已关闭',
  peerState: '连接状态',
  dataChannel: 'DataChannel',
  localCandidate: '本地候选',
  remoteCandidate: '远端候选',
  localAddress: '本地地址',
  remoteAddress: '远端地址',
  networkProtocol: '传输协议',
  relayProtocol: 'TURN 协议',
  roundTripTime: '往返时延',
  availableBitrate: '可用上行带宽',
  bytesSent: 'WebRTC 已发送',
  bytesReceived: 'WebRTC 已接收',
  notProvided: '未提供',
  candidateHost: '本地地址 · host',
  candidateSrflx: '公网地址 · srflx',
  candidatePrflx: '对端地址 · prflx',
  candidateRelay: 'TURN 地址 · relay',
  openLocalWorkspaces: '打开本地工作区',
  clientSignInHint: '登录 Server 后即可查看自己的远端主机。',
  signInClient: 'DeepSeek Harness Remote',
  signInClientDescription: '一次连接，随时可用。',
  startSignIn: '开始登录',
  allowControlCurrentDevice: '允许控制当前设备',
  exitRemoteAccount: '退出账号',
  githubLogin: 'GitHub 扫码',
  zhihuLogin: '知乎扫码',
  scanWithGitHub: '使用 GitHub 扫码登录',
  scanWithZhihu: '使用知乎扫码登录',
  openInBrowser: '在浏览器中继续',
  scanLoginHint: '请在手机上完成授权，此窗口会自动继续。',
  currentServiceAddress: '当前服务地址：',
  accountPasswordLogin: '账号密码',
  qrLoginExpired: '二维码已过期，请刷新后重试。',
  refreshQrCode: '刷新二维码',
  codexVirtualWorkspace: 'CodeX 工作区',
  codexVirtualSessions: 'Sessions',
}

type LocaleKey = keyof typeof en
type Translate = (key: LocaleKey, params?: Record<string, string | number>) => string
interface LocalizedMessage {
  key: LocaleKey
  params?: Record<string, string | number>
}

interface RemoteConnectionProgress {
  label: LocaleKey
  detail: LocaleKey
  percent: number
  transports?: RemoteTransportPreference[]
  activeTransports?: RemoteTransportPreference[]
  routeVerb?: 'trying' | 'using'
}

const defaultPreferredTransports: readonly RemoteTransportPreference[] = ['lan', 'p2p', 'turn', 'relay']
const controlRouteBackoffStepsMs = [1_000, 2_000, 5_000, 10_000, 30_000] as const

class ControlRouteUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ControlRouteUnavailableError'
  }
}

function controlRouteUnavailableStatus(): RemoteStatus {
  return {
    mode: 'local',
    available: false,
    controlUnavailable: true,
    connected: false,
    transport: 'Disconnected',
    remoteFeatures: { commandList: false, fileViewer: false, codex: false },
    hostAuthorizationAvailable: false,
  }
}

function normalizedPreferredTransports(value: readonly RemoteTransportPreference[] | undefined): RemoteTransportPreference[] {
  return value === undefined || value.length === 0 ? [...defaultPreferredTransports] : [...value]
}

function formatLocalTime(value: number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function formatByteSize(value: number): string {
  if (value < 1024) return `${value.toLocaleString()} B`
  const units = ['KiB', 'MiB', 'GiB']
  let amount = value
  let unit = 'B'
  for (const nextUnit of units) {
    amount /= 1024
    unit = nextUnit
    if (amount < 1024) break
  }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`
}

function formatBitrate(value: number): string {
  const units = ['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s']
  let amount = value
  let unitIndex = 0
  while (amount >= 1000 && unitIndex < units.length - 1) {
    amount /= 1000
    unitIndex += 1
  }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`
}

function shortDeviceId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}

function serverHostname(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function transportLabel(value: RemoteTransportPreference, t: Translate): string {
  if (value === 'lan') return t('remoteNetworkLan')
  if (value === 'p2p') return t('remoteNetworkP2p')
  if (value === 'turn') return t('remoteNetworkTurn')
  return t('remoteNetworkRelay')
}

function transportDiagnosticLabel(value: RemoteTransportPreference): string {
  if (value === 'lan') return 'LAN'
  if (value === 'p2p') return 'P2P'
  if (value === 'turn') return 'TURN'
  return 'Relay'
}

function transportProgressCopy(value: RemoteTransportPreference): { label: LocaleKey; detail: LocaleKey } {
  if (value === 'lan') return { label: 'remoteProgressProbeLan', detail: 'remoteProgressProbeLanDetail' }
  if (value === 'p2p') return { label: 'remoteProgressProbeP2p', detail: 'remoteProgressProbeP2pDetail' }
  if (value === 'turn') return { label: 'remoteProgressProbeTurn', detail: 'remoteProgressProbeTurnDetail' }
  return { label: 'remoteProgressProbeRelay', detail: 'remoteProgressProbeRelayDetail' }
}

function statusTransportPreference(status: RemoteStatus | undefined): RemoteTransportPreference | undefined {
  if (status?.transport === 'LAN') return 'lan'
  if (status?.transport === 'P2P') return 'p2p'
  if (status?.transport === 'TURN') return 'turn'
  if (status?.transport === 'Relay') return 'relay'
  return undefined
}

function connectedProgress(status: RemoteStatus | undefined): RemoteConnectionProgress | undefined {
  const activeTransport = statusTransportPreference(status)
  if (activeTransport === undefined) return undefined
  return {
    label: 'remoteProgressReady',
    detail: 'remoteProgressReadyDetail',
    percent: 100,
    transports: normalizedPreferredTransports(status?.preferredTransports),
    activeTransports: [activeTransport],
    routeVerb: 'using',
  }
}

function loadingProgressPercent(elapsedMs: number): number {
  if (elapsedMs >= 6_800) return 96
  if (elapsedMs >= 3_800) return 93
  if (elapsedMs >= 1_600) return 89
  return 84
}

function observedConnectionProgress(
  status: RemoteStatus,
  targetDeviceId: string,
  preferredTransports: readonly RemoteTransportPreference[] | undefined,
  connectedStep: Pick<RemoteConnectionProgress, 'label' | 'detail'>,
  connectedAt: number | undefined,
): RemoteConnectionProgress | undefined {
  const transports = normalizedPreferredTransports(status.preferredTransports ?? preferredTransports)
  const connection = status.connectionProgress
  if (connection?.targetDeviceId === targetDeviceId) {
    if (connection.phase === 'checking-host') {
      return { label: 'remoteProgressCheckingHost', detail: 'remoteProgressCheckingHostDetail', percent: 12 }
    }
    if (connection.phase === 'authorizing-peer') {
      return { label: 'remoteProgressAuthorizingPeer', detail: 'remoteProgressAuthorizingPeerDetail', percent: 30 }
    }
    const activeTransports = connection.activeTransports?.filter(transport => transports.includes(transport)) ?? []
    if (connection.phase === 'probing') {
      const activeIndex = Math.max(0, ...activeTransports.map(transport => transports.indexOf(transport)))
      const copy = activeTransports.length === 1
        ? transportProgressCopy(activeTransports[0]!)
        : { label: 'remoteProgressOpeningChannel' as const, detail: 'remoteProgressOpeningChannelDetail' as const }
      return {
        ...copy,
        percent: Math.min(76, 42 + activeIndex * 10),
        transports,
        activeTransports,
        routeVerb: 'trying',
      }
    }
    return {
      ...connectedStep,
      percent: loadingProgressPercent(connectedAt === undefined ? 0 : Date.now() - connectedAt),
      transports,
      activeTransports,
      routeVerb: 'using',
    }
  }
  if (status.connectedTargetDeviceId !== targetDeviceId) return undefined
  const activeTransport = statusTransportPreference(status)
  return {
    ...connectedStep,
    percent: loadingProgressPercent(connectedAt === undefined ? 0 : Date.now() - connectedAt),
    transports,
    ...(activeTransport === undefined ? {} : { activeTransports: [activeTransport], routeVerb: 'using' as const }),
  }
}

function connectionErrorMessage(code: string, t: Translate): string {
  if (code === 'ACCOUNT_AUTH_REQUIRED' || code === 'AUTH_INVALID' || code === 'TOKEN_EXPIRED') {
    return t('connectionAuthorizationExpired')
  }
  if (code === 'DEVICE_REVOKED') return t('connectionDeviceRevoked')
  if (code === 'DEVICE_OWNERSHIP_REQUIRED') return t('connectionOwnershipRequired')
  if (code === 'RATE_LIMITED') return t('connectionRateLimited')
  if (code === 'UNSUPPORTED_VERSION') return t('connectionVersionMismatch')
  if (code === 'INVALID_MESSAGE') return t('connectionInvalidResponse')
  if (code === 'CONNECTION_FAILED' || code === 'SERVER_NOT_CONFIGURED') return t('connectionReachability')
  return t('connectionUnexpected')
}

function connectionStatusLabel(status: RemoteStatus['host'] | undefined, t: Translate): string {
  if (status === undefined) return t('checkingConnection')
  if (status.online) return t('online')
  if (!status.reconnecting) return t('offline')
  return t(status.lastActiveAt === undefined && status.error === undefined ? 'connecting' : 'reconnecting')
}

function connectionStatusClass(status: RemoteStatus['host'] | undefined): string {
  if (status?.online) return ' isOnline'
  if (status?.reconnecting) return ' isReconnecting'
  return status === undefined ? '' : ' isOffline'
}

window.__ModuleLoader__.load({
  id: clientModuleId,
  factory: require => {
    const module = { exports: {} as Record<string, unknown> }
    const React = require('react') as {
      Fragment: unknown
      createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
      useEffect(effect: () => void | (() => void), deps: unknown[]): void
      useCallback<T>(callback: T, deps: unknown[]): T
      useMemo<T>(factory: () => T, deps: unknown[]): T
      useRef<T>(initial: T): { current: T }
      useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void]
    }
    const inject = [
      'connection', 'slots', 'locale', 'workspaces', 'sessions',
    ]

    function RemoteProgressView(props: {
      progress: RemoteConnectionProgress | undefined
      t: Translate
    }): unknown {
      const progress = props.progress
      if (progress === undefined) return null
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
      const activeTransports = new Set(progress.activeTransports ?? [])
      const detail = progress.transports !== undefined && activeTransports.size > 0
        ? React.createElement('span', { className: 'dshRemoteProgressRoute' },
          props.t(progress.routeVerb === 'using' ? 'remoteProgressUsingPrefix' : 'remoteProgressTryingPrefix'),
          progress.transports.map((transport, index) => React.createElement(React.Fragment, { key: `${transport}:${index}` },
            index === 0 ? null : React.createElement('span', { className: 'dshRemoteProgressRouteArrow', 'aria-hidden': true }, ' -> '),
            React.createElement('span', {
              className: activeTransports.has(transport) ? 'isActive' : undefined,
            }, transportDiagnosticLabel(transport)))))
        : props.t(progress.detail)
      return React.createElement('div', {
        className: 'dshRemoteProgress',
        role: 'status',
        'aria-live': 'polite',
      },
      React.createElement('div', { className: 'dshRemoteProgressHeader' },
        React.createElement('strong', null, props.t(progress.label)),
        React.createElement('span', null, `${percent}%`)),
      React.createElement('p', null, detail),
      React.createElement('div', {
        className: 'dshRemoteProgressBar',
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent,
        'aria-label': props.t(progress.label),
      }, React.createElement('span', { style: { transform: `scaleX(${percent / 100})` } })))
    }

    async function runConnectHostProgress<T>(
      preferredTransports: readonly RemoteTransportPreference[] | undefined,
      targetDeviceId: string,
      control: <R>(endpoint: string, payload?: unknown) => Promise<R>,
      connectedStep: Pick<RemoteConnectionProgress, 'label' | 'detail'>,
      setProgress: (value: RemoteConnectionProgress | undefined) => void,
      progressRun: { current: number },
      action: () => Promise<T>,
      readyProgress?: (result: T) => RemoteConnectionProgress | undefined,
    ): Promise<T> {
      const runId = progressRun.current + 1
      progressRun.current = runId
      let polling = true
      let pollTimer: number | undefined
      let connectedAt: number | undefined
      const apply = (next: RemoteConnectionProgress): void => {
        if (progressRun.current === runId) setProgress(next)
      }
      const poll = async (): Promise<void> => {
        try {
          const status = await control<RemoteStatus>('status')
          if (!polling || progressRun.current !== runId) return
          const isConnected = status.connectionProgress?.phase === 'connected'
            || status.connectedTargetDeviceId === targetDeviceId
          if (isConnected && connectedAt === undefined) connectedAt = Date.now()
          const next = observedConnectionProgress(status, targetDeviceId, preferredTransports, connectedStep, connectedAt)
          if (next !== undefined) apply(next)
        } catch {
          // The primary action owns failure reporting. A missed status sample
          // must not replace it with a secondary progress error.
        } finally {
          if (polling && progressRun.current === runId) {
            pollTimer = window.setTimeout(() => { void poll() }, 300)
          }
        }
      }

      apply({ label: 'remoteProgressCheckingHost', detail: 'remoteProgressCheckingHostDetail', percent: 12 })
      const pending = action()
      void poll()
      try {
        const result = await pending
        polling = false
        if (pollTimer !== undefined) window.clearTimeout(pollTimer)
        apply(readyProgress?.(result) ?? { label: 'remoteProgressReady', detail: 'remoteProgressReadyDetail', percent: 100 })
        await new Promise(resolve => window.setTimeout(resolve, 520))
        return result
      } finally {
        polling = false
        if (pollTimer !== undefined) window.clearTimeout(pollTimer)
        if (progressRun.current === runId) setProgress(undefined)
      }
    }

    function RemotePluginOptions(props: {
      control: <T>(endpoint: string, payload?: unknown) => Promise<T>
      t: Translate
    }): unknown {
      const { t } = props
      const [open, setOpen] = React.useState(false)
      const [serverUrl, setServerUrl] = React.useState('')
      const [codexEnabled, setCodexEnabled] = React.useState(true)
      const role = 'host' as const
      const [registrationCode, setRegistrationCode] = React.useState('')
      const [associations, setAssociations] = React.useState<Partial<Record<'host' | 'client', PluginAssociation>>>({})
      const [loaded, setLoaded] = React.useState(false)
      const [writable, setWritable] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [codexBusy, setCodexBusy] = React.useState(false)
      const [reconnectBusy, setReconnectBusy] = React.useState(false)
      const [hostStatus, setHostStatus] = React.useState<RemoteStatus['host'] | undefined>(undefined)
      const [notice, setNotice] = React.useState<LocalizedMessage | undefined>(undefined)
      const [error, setError] = React.useState<string | undefined>(undefined)
      const [settingsView, setSettingsView] = React.useState<PluginSettingsView | undefined>(undefined)
      const persistedServerUrl = settingsView?.config.serverUrl ?? 'https://dsh.r2049.cn'
      const association = associations.client ?? associations.host
      const serverDirty = settingsView !== undefined && serverUrl !== persistedServerUrl
      const draftDirty = serverDirty

      const applyView = (view: PluginSettingsView): void => {
        setSettingsView(view)
        setServerUrl(view.config.serverUrl ?? 'https://dsh.r2049.cn')
        setCodexEnabled(view.config.codex?.enabled ?? true)
        setAssociations(view.associations ?? (view.association === undefined ? {} : { host: view.association }))
        setWritable(view.writable)
        setLoaded(true)
      }

      const load = async (): Promise<void> => {
        const [view, status] = await Promise.all([
          props.control<PluginSettingsView>('settings.get'),
          props.control<RemoteStatus>('status').catch(() => undefined),
        ])
        applyView(view)
        setHostStatus(status?.host)
      }

      const refreshHostStatus = async (): Promise<void> => {
        setHostStatus((await props.control<RemoteStatus>('status')).host)
      }

      React.useEffect(() => {
        void load().catch(reason => setError(messageOf(reason)))
      }, [])

      React.useEffect(() => {
        if (association === undefined) return
        void refreshHostStatus().catch(() => undefined)
        const timer = window.setInterval(() => {
          void refreshHostStatus().catch(() => undefined)
        }, 30_000)
        return () => window.clearInterval(timer)
      }, [association !== undefined])

      const save = async (event?: Event): Promise<void> => {
        event?.preventDefault()
        if (!writable || !serverDirty) return
        setBusy(true)
        setNotice(undefined)
        setError(undefined)
        try {
          const view = await props.control<PluginSettingsView>('settings.server.set', {
            serverUrl,
          })
          applyView(view)
          setNotice({ key: 'serverSaved' })
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const logout = async (): Promise<void> => {
        setBusy(true)
        setError(undefined)
        setNotice(undefined)
        try {
          const view = await props.control<PluginSettingsView>('settings.logout')
          applyView(view)
          setRegistrationCode('')
          setNotice({ key: 'signedOut' })
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const reconnectHost = async (): Promise<void> => {
        setReconnectBusy(true)
        setError(undefined)
        setNotice(undefined)
        try {
          const status = await props.control<RemoteStatus>('host.reconnect')
          setHostStatus(status.host)
          setNotice({ key: 'reconnectStarted' })
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setReconnectBusy(false)
        }
      }

      const setCurrentDeviceControl = async (enabled: boolean): Promise<void> => {
        setBusy(true)
        setError(undefined)
        setNotice(undefined)
        try {
          const status = await props.control<RemoteStatus>('host.authorization.set', { enabled })
          setHostStatus(status.host)
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const setCodexRemote = async (enabled: boolean): Promise<void> => {
        const previous = codexEnabled
        setCodexEnabled(enabled)
        setCodexBusy(true)
        setError(undefined)
        setNotice(undefined)
        try {
          const view = await props.control<PluginSettingsView>('settings.codex.set', { enabled })
          applyView(view)
          setNotice({ key: 'codexSaved' })
        } catch (reason) {
          setCodexEnabled(previous)
          setError(messageOf(reason))
        } finally {
          setCodexBusy(false)
        }
      }

      const discard = (): void => {
        if (settingsView !== undefined) applyView(settingsView)
        setRegistrationCode('')
        setNotice(undefined)
        setError(undefined)
      }

      const codexSetting = React.createElement('div', { className: 'dshRemoteAuthorizationSetting' },
        React.createElement('div', null,
          React.createElement('strong', null, t('codexRemote')),
          React.createElement('p', null, t('codexRemoteHint'))),
        React.createElement('input', {
          type: 'checkbox', role: 'switch', disabled: busy || codexBusy || !writable,
          'aria-label': t('codexRemote'),
          checked: codexEnabled,
          onChange: (event: Event) => void setCodexRemote((event.target as HTMLInputElement).checked),
        }))

      return React.createElement('li', { className: `dshRemotePluginCard${open ? ' isOpen' : ''}` },
        React.createElement('div', { className: 'dshRemotePluginCardHeader' },
          React.createElement('button', {
            type: 'button',
            className: 'dshRemotePluginCardToggle',
            'aria-expanded': open,
            'aria-label': t(open ? 'collapseSettings' : 'expandSettings', { name: t('pluginTitle') }),
            onClick: () => setOpen(current => !current),
          },
          React.createElement('span', { className: 'dshRemotePluginCardHeading' },
            React.createElement('strong', null, t('pluginTitle')),
            React.createElement('span', null, t('pluginDescription'))),
          draftDirty
            ? React.createElement('span', { className: 'dshRemotePluginCardStatus' }, t('unsaved'))
            : association === undefined ? null : React.createElement('span', {
              className: `dshRemotePluginCardStatus${connectionStatusClass(hostStatus)}`,
            }, hostStatus === undefined ? t('associated') : connectionStatusLabel(hostStatus, t)),
          React.createElement('span', { className: 'dshRemotePluginCardChevron', 'aria-hidden': true }, '⌄'))),
        !open ? null : React.createElement('div', { className: 'dshRemotePluginCardBody' },
          !loaded
            ? React.createElement('p', { className: 'dshRemoteSettingsState' }, error ?? t('loadingSettings'))
            : association !== undefined
              ? React.createElement('div', { className: 'dshRemoteSettings' },
        React.createElement('div', { className: 'dshRemoteSettingsTop' },
          React.createElement('div', { className: 'dshRemoteAssociation' },
            React.createElement('span', null, t(association.account === undefined ? 'authorization' : 'account')),
            React.createElement('strong', null, association.account
              ?? t('authorizationComplete')),
            React.createElement('p', null, association.account === undefined
              ? serverUrl
              : t('authorizedOn', { role: 'Remote', serverUrl })))),
        React.createElement('div', { className: 'dshRemoteField' },
          React.createElement('label', { htmlFor: 'dsh-remote-server-url-authorized' }, t('serverUrl')),
          React.createElement('input', {
            id: 'dsh-remote-server-url-authorized',
            type: 'url',
            value: serverUrl,
            disabled: true,
            required: true,
            placeholder: 'https://dsh.r2049.cn',
            onChange: (event: Event) => { setServerUrl((event.target as HTMLInputElement).value); setNotice(undefined) },
          }),
          React.createElement('p', null, t('serverUrlHint'))),
        codexSetting,
        React.createElement('div', { className: 'dshRemoteAuthorizationSetting' },
          React.createElement('div', null,
            React.createElement('strong', null, t('allowControlCurrentDevice')),
            React.createElement('p', null, t('thisMachineHost'))),
          React.createElement('input', {
            type: 'checkbox', role: 'switch', disabled: busy,
            'aria-label': t('allowControlCurrentDevice'),
            checked: hostStatus?.authorized === true,
            onChange: (event: Event) => void setCurrentDeviceControl((event.target as HTMLInputElement).checked),
          })),
        React.createElement('div', { className: 'dshRemoteConnection', 'aria-live': 'polite' },
          React.createElement('div', { className: 'dshRemoteConnectionSummary' },
            React.createElement('span', null, t('connection')),
            React.createElement('strong', null,
              React.createElement('span', {
                className: `dshRemoteConnectionDot${connectionStatusClass(hostStatus)}`,
                'aria-hidden': true,
              }),
              connectionStatusLabel(hostStatus, t)),
            React.createElement('p', null, hostStatus === undefined
              ? t('checkingConnection')
              : hostStatus.lastActiveAt === undefined
                ? t('neverConnected')
                : t('lastActive', { time: formatLocalTime(hostStatus.lastActiveAt) }))),
          React.createElement('button', {
            type: 'button',
            className: 'dshRemoteReconnect',
            disabled: reconnectBusy || hostStatus?.configured === false,
            onClick: () => void reconnectHost(),
          }, t(reconnectBusy ? 'reconnectingAction' : 'reconnect'))),
        hostStatus?.error === undefined || hostStatus.online
          ? null
          : React.createElement('p', { className: 'dshRemoteConnectionIssue', role: 'status' }, connectionErrorMessage(hostStatus.error, t)),
        !writable ? React.createElement('p', { className: 'dshRemoteError' }, t('readOnly')) : null,
        React.createElement('div', { className: 'dshRemoteSettingsFooter' },
          error !== undefined
            ? React.createElement('p', { className: 'dshRemoteError', role: 'alert' }, error)
            : notice === undefined ? null : React.createElement('p', { className: 'dshRemoteNotice', role: 'status' }, t(notice.key, notice.params)),
          draftDirty
            ? React.createElement(React.Fragment, null,
              React.createElement('button', { type: 'button', className: 'dshRemoteDiscard', disabled: busy, onClick: discard }, t('discard')),
              React.createElement('button', { type: 'button', className: 'dshRemoteSave', disabled: busy || !writable, onClick: () => void save() }, t(busy ? 'saving' : 'save')))
            : React.createElement('button', {
              type: 'button',
              className: 'dshRemoteDiscard',
              disabled: busy || !writable,
              onClick: () => void logout(),
            }, t(busy ? 'signingOut' : 'signOut'))))
              : React.createElement('form', { className: 'dshRemoteSettings', noValidate: true, onSubmit: (event: Event) => void save(event) },
        React.createElement('div', { className: 'dshRemoteField' },
          React.createElement('label', { htmlFor: 'dsh-remote-server-url' }, t('serverUrl')),
          React.createElement('input', {
            id: 'dsh-remote-server-url',
            type: 'url',
            value: serverUrl,
            disabled: busy || !writable,
            required: true,
            placeholder: 'https://dsh.r2049.cn',
            onChange: (event: Event) => { setServerUrl((event.target as HTMLInputElement).value); setNotice(undefined) },
          }),
          React.createElement('p', null, t('serverUrlHint'))),
        codexSetting,
        React.createElement('p', { className: 'dshRemoteSettingsState' }, t('authorizeFromRemote')),
        !writable ? React.createElement('p', { className: 'dshRemoteError' }, t('readOnly')) : null,
        React.createElement('div', { className: 'dshRemoteSettingsFooter' },
          error !== undefined
            ? React.createElement('p', { className: 'dshRemoteError', role: 'alert' }, error)
            : notice === undefined ? null : React.createElement('p', { className: 'dshRemoteNotice', role: 'status' }, t(notice.key, notice.params)),
          React.createElement('button', { type: 'button', className: 'dshRemoteDiscard', disabled: busy || !draftDirty, onClick: discard }, t('discard')),
          React.createElement('button', { type: 'submit', className: 'dshRemoteSave', disabled: busy || !writable || !serverDirty }, t(busy ? 'saving' : 'save'))))))
    }

    function RemoteWorkspaceAction(props: {
      wide: boolean
      control: <T>(endpoint: string, payload?: unknown) => Promise<T>
      preferredQrProvider: OAuthProvider
      t: Translate
    }): unknown {
      const { t } = props
      const [open, setOpen] = React.useState(false)
      const [status, setStatus] = React.useState<RemoteStatus | undefined>(undefined)
      const [devices, setDevices] = React.useState<RemoteDevice[]>([])
      const [selectedHost, setSelectedHost] = React.useState<RemoteDevice | undefined>(undefined)
      const [workspaces, setWorkspaces] = React.useState<RemoteWorkspaceView[]>([])
      const [codexWorkspaces, setCodexWorkspaces] = React.useState<CodexWorkspaceView[]>([])
      const [workspaceBackend, setWorkspaceBackend] = React.useState<'harness' | 'codex'>('harness')
      const [codexWorkspaceId, setCodexWorkspaceId] = React.useState<string | undefined>(undefined)
      const [directory, setDirectory] = React.useState<RemoteDirectoryListing | undefined>(undefined)
      const [path, setPath] = React.useState('')
      const [addingWorkspace, setAddingWorkspace] = React.useState(false)
      const [showAllWorkspaces, setShowAllWorkspaces] = React.useState(false)
      const [showAllCodexWorkspaces, setShowAllCodexWorkspaces] = React.useState(false)
      const workspaceListId = 'dsh-remote-workspace-list'
      const codexWorkspaceHeadingId = 'dsh-remote-codex-workspace-heading'
      const codexWorkspaceListId = 'dsh-remote-codex-workspace-list'
      const [busy, setBusy] = React.useState(false)
      const [needsAuthorization, setNeedsAuthorization] = React.useState(false)
      const [email, setEmail] = React.useState('')
      const [password, setPassword] = React.useState('')
      const [loginMethod, setLoginMethod] = React.useState<LoginMethod>(props.preferredQrProvider)
      const [loginMethodManuallySelected, setLoginMethodManuallySelected] = React.useState(false)
      const [qrSession, setQrSession] = React.useState<OAuthQrSession | undefined>(undefined)
      const [qrImage, setQrImage] = React.useState<string | undefined>(undefined)
      const [qrExpired, setQrExpired] = React.useState(false)
      const [progress, setProgress] = React.useState<RemoteConnectionProgress | undefined>(undefined)
      const progressRun = React.useRef(0)
      const qrFlowRun = React.useRef(0)
      const [notice, setNotice] = React.useState<string | undefined>(undefined)
      const [error, setError] = React.useState<string | undefined>(undefined)

      React.useEffect(() => {
        if (!open) return
        const closeOnEscape = (event: KeyboardEvent): void => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
      }, [open])

      React.useEffect(() => {
        void props.control<RemoteStatus>('status').then(setStatus).catch(() => undefined)
      }, [])

      React.useEffect(() => {
        const remoteActive = status?.mode === 'remote'
        document.documentElement.classList.toggle('dshRemoteTargetActive', remoteActive)
        return () => {
          if (remoteActive) document.documentElement.classList.remove('dshRemoteTargetActive')
        }
      }, [status?.mode])

      const startQrLogin = async (provider: OAuthProvider): Promise<void> => {
        const run = ++qrFlowRun.current
        setBusy(true)
        setError(undefined)
        setQrExpired(false)
        try {
          const session = await props.control<OAuthQrSession>('client.account.qr.start', { provider })
          const image = await QRCode.toDataURL(session.scanUrl, {
            width: 184,
            margin: 1,
            errorCorrectionLevel: 'L',
          })
          if (run !== qrFlowRun.current) return
          setQrSession(session)
          setQrImage(image)
        } catch (reason) {
          if (run === qrFlowRun.current) setError(messageOf(reason))
        } finally {
          if (run === qrFlowRun.current) setBusy(false)
        }
      }

      React.useEffect(() => {
        if (!open || !needsAuthorization || loginMethod === 'password' || qrSession !== undefined || qrExpired) return
        void startQrLogin(loginMethod)
      }, [open, needsAuthorization, loginMethod, qrSession, qrExpired])

      React.useEffect(() => {
        if (!open || loginMethod === 'password' || qrSession === undefined) return
        let active = true
        let polling = false
        let settled = false
        const run = qrFlowRun.current
        let timer: number | undefined
        const poll = (): void => {
          if (polling || settled) return
          polling = true
          void props.control<OAuthQrPollResult>('client.account.qr.poll', { qrId: qrSession.qrId }).then(async result => {
            if (!active || settled || run !== qrFlowRun.current) return
            if (result.status === 'complete') {
              settled = true
              if (timer !== undefined) window.clearInterval(timer)
              setBusy(true)
              setError(undefined)
              setQrExpired(false)
              setNeedsAuthorization(false)
              try {
                const [nextDevices, nextStatus] = await Promise.all([
                  props.control<RemoteDevice[]>('devices'),
                  props.control<RemoteStatus>('status'),
                ])
                if (active && run === qrFlowRun.current) {
                  setDevices(nextDevices)
                  setStatus(nextStatus)
                }
              } catch (reason) {
                if (active && run === qrFlowRun.current) setError(messageOf(reason))
              } finally {
                if (run === qrFlowRun.current) {
                  setQrSession(undefined)
                  setQrImage(undefined)
                  setBusy(false)
                }
              }
            } else if (result.status === 'expired') {
              settled = true
              if (timer !== undefined) window.clearInterval(timer)
              setQrExpired(true)
              setQrSession(undefined)
              setQrImage(undefined)
            }
          }).catch(reason => {
            if (active && !settled && run === qrFlowRun.current) setError(messageOf(reason))
          }).finally(() => {
            polling = false
          })
        }
        poll()
        timer = window.setInterval(poll, 1_500)
        return () => {
          active = false
          if (timer !== undefined) window.clearInterval(timer)
        }
      }, [open, loginMethod, qrSession])

      React.useEffect(() => {
        if (loginMethodManuallySelected || loginMethod === props.preferredQrProvider) return
        qrFlowRun.current += 1
        setLoginMethod(props.preferredQrProvider)
        setQrSession(undefined)
        setQrImage(undefined)
        setQrExpired(false)
        setError(undefined)
      }, [props.preferredQrProvider, loginMethodManuallySelected])

      const selectLoginMethod = (method: LoginMethod): void => {
        setLoginMethodManuallySelected(true)
        if (method === loginMethod) return
        qrFlowRun.current += 1
        setLoginMethod(method)
        setQrSession(undefined)
        setQrImage(undefined)
        setQrExpired(false)
        setError(undefined)
      }

      const orderedQrProviders: OAuthProvider[] = props.preferredQrProvider === 'zhihu'
        ? ['zhihu', 'github']
        : ['github', 'zhihu']

      const qrLoginTab = (provider: OAuthProvider): unknown => React.createElement('button', {
        key: provider, type: 'button', role: 'tab', id: `dsh-remote-${provider}-tab`,
        'aria-selected': loginMethod === provider, 'aria-controls': `dsh-remote-${provider}-panel`,
        className: loginMethod === provider ? 'isActive' : '', disabled: busy,
        onClick: () => selectLoginMethod(provider),
      }, t(provider === 'github' ? 'githubLogin' : 'zhihuLogin'))

      const selectHost = async (host: RemoteDevice): Promise<void> => {
        setBusy(true)
        setError(undefined)
        setCodexWorkspaces([])
        setShowAllWorkspaces(false)
        setShowAllCodexWorkspaces(false)
        try {
          const result = await runConnectHostProgress(
            status?.preferredTransports,
            host.deviceId,
            props.control,
            { label: 'remoteProgressLoadingWorkspaces', detail: 'remoteProgressLoadingWorkspacesDetail' },
            setProgress,
            progressRun,
            async () => {
              // The first request establishes the selected Host connection.
              // Keep the optional CodeX probe on that same connection instead
              // of racing two initial handshakes for one target.
              const nextWorkspaces = await props.control<RemoteWorkspaceView[]>('workspaces.list', {
                targetDeviceId: host.deviceId,
              })
              const nextCodexWorkspaces = await props.control<CodexWorkspaceView[]>('codex.workspaces.list', {
                targetDeviceId: host.deviceId,
              }).catch(() => [])
              const nextStatus = await props.control<RemoteStatus>('status').catch(() => undefined)
              if (nextStatus !== undefined) setStatus(nextStatus)
              return { workspaces: nextWorkspaces, codexWorkspaces: nextCodexWorkspaces, status: nextStatus }
            },
            result => connectedProgress(result.status),
          )
          setWorkspaces(result.workspaces)
          setCodexWorkspaces(result.codexWorkspaces)
          setWorkspaceBackend('harness')
          setCodexWorkspaceId(undefined)
          setSelectedHost(host)
          setPath('')
          setAddingWorkspace(false)
          setDirectory(undefined)
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const browseDirectory = async (nextPath?: string): Promise<void> => {
        if (selectedHost === undefined) return
        setBusy(true)
        setError(undefined)
        try {
          const listing = await props.control<RemoteDirectoryListing>('directory.list', {
            targetDeviceId: selectedHost.deviceId,
            ...(nextPath === undefined ? {} : { path: nextPath }),
          })
          setDirectory(listing)
          setCodexWorkspaceId(undefined)
          setPath(listing.path)
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const startAddingWorkspace = (backend: 'harness' | 'codex'): void => {
        setAddingWorkspace(true)
        setWorkspaceBackend(backend)
        setCodexWorkspaceId(undefined)
        setShowAllWorkspaces(false)
        setShowAllCodexWorkspaces(false)
        setDirectory(undefined)
        setPath('')
        void browseDirectory()
      }

      const cancelAddingWorkspace = (): void => {
        setAddingWorkspace(false)
        setWorkspaceBackend('harness')
        setCodexWorkspaceId(undefined)
        setDirectory(undefined)
        setPath('')
      }

      const refreshRemote = async (): Promise<void> => {
        setBusy(true)
        setNotice(undefined)
        setError(undefined)
        try {
          const nextStatus = await props.control<RemoteStatus>('status')
          setStatus(nextStatus)
          if (!nextStatus.available) {
            setDevices([])
            setNeedsAuthorization(false)
            setSelectedHost(undefined)
            setWorkspaces([])
            setCodexWorkspaces([])
            setShowAllWorkspaces(false)
            setShowAllCodexWorkspaces(false)
            setWorkspaceBackend('harness')
            setCodexWorkspaceId(undefined)
            setPath('')
            setAddingWorkspace(false)
            setDirectory(undefined)
            return
          }
          try {
            const nextDevices = await props.control<RemoteDevice[]>('devices')
            setDevices(nextDevices)
            setNeedsAuthorization(false)
            if (selectedHost !== undefined) {
              const nextSelectedHost = nextDevices.find(device => device.deviceId === selectedHost.deviceId)
              if (nextSelectedHost === undefined) {
                setSelectedHost(undefined)
                setWorkspaces([])
                setCodexWorkspaces([])
                setShowAllWorkspaces(false)
                setShowAllCodexWorkspaces(false)
                setWorkspaceBackend('harness')
                setCodexWorkspaceId(undefined)
                setPath('')
                setAddingWorkspace(false)
                setDirectory(undefined)
              } else {
                setSelectedHost(nextSelectedHost)
              }
            }
          } catch {
            setDevices([])
            setNeedsAuthorization(true)
            setSelectedHost(undefined)
            setWorkspaces([])
            setCodexWorkspaces([])
            setShowAllWorkspaces(false)
            setShowAllCodexWorkspaces(false)
            setWorkspaceBackend('harness')
            setCodexWorkspaceId(undefined)
            setPath('')
            setAddingWorkspace(false)
            setDirectory(undefined)
          }
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const show = async (): Promise<void> => {
        setShowAllWorkspaces(false)
        setShowAllCodexWorkspaces(false)
        setOpen(true)
        await refreshRemote()
      }

      const chooseAnotherHost = (): void => {
        setSelectedHost(undefined)
        setWorkspaces([])
        setCodexWorkspaces([])
        setShowAllWorkspaces(false)
        setShowAllCodexWorkspaces(false)
        setWorkspaceBackend('harness')
        setCodexWorkspaceId(undefined)
        setDirectory(undefined)
        setPath('')
        setAddingWorkspace(false)
        setError(undefined)
      }

      const signInClient = async (): Promise<void> => {
        if (email.trim() === '' || password === '') return
        setBusy(true)
        setError(undefined)
        try {
          await props.control('client.account.login', { email: email.trim(), password })
          setDevices(await props.control<RemoteDevice[]>('devices'))
          setStatus(await props.control<RemoteStatus>('status'))
          setNeedsAuthorization(false)
          setPassword('')
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const openLocalWorkspaces = async (): Promise<void> => {
        setBusy(true)
        setError(undefined)
        try {
          await props.control('mode.set', { mode: 'local' })
          window.location.reload()
        } catch (reason) {
          setError(messageOf(reason))
          setBusy(false)
        }
      }

      const setCurrentDeviceControl = async (enabled: boolean): Promise<void> => {
        setBusy(true)
        setError(undefined)
        try {
          setStatus(await props.control<RemoteStatus>('host.authorization.set', { enabled }))
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const logoutRemote = async (): Promise<void> => {
        setBusy(true)
        setError(undefined)
        try {
          await props.control('settings.logout')
          setDevices([])
          setNeedsAuthorization(true)
          setQrSession(undefined)
          setQrImage(undefined)
          setQrExpired(false)
          setStatus(await props.control<RemoteStatus>('status'))
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const openWorkspace = async (selection?:
        | { backend: 'harness'; path: string }
        | { backend: 'codex'; path: string; workspaceId: string }): Promise<void> => {
        const targetBackend = selection?.backend ?? workspaceBackend
        const targetPath = (selection?.path ?? path).trim()
        const targetCodexWorkspaceId = selection?.backend === 'codex'
          ? selection.workspaceId
          : selection === undefined ? codexWorkspaceId : undefined
        const createWorkspace = selection === undefined && addingWorkspace
        if (selectedHost === undefined
          || targetPath === ''
          || !createWorkspace && targetBackend === 'codex' && targetCodexWorkspaceId === undefined) return
        setBusy(true)
        setError(undefined)
        try {
          const nextStatus = await (targetBackend === 'codex'
            ? createWorkspace
              ? props.control<RemoteStatus>('codex.workspace.create', {
                targetDeviceId: selectedHost.deviceId,
                path: targetPath,
              })
              : props.control<RemoteStatus>('codex.workspace.open', {
                targetDeviceId: selectedHost.deviceId,
                workspaceId: targetCodexWorkspaceId,
              })
            : props.control<RemoteStatus>('workspace.open', {
              targetDeviceId: selectedHost.deviceId,
              path: targetPath,
            }))
          setStatus(nextStatus)
          if (nextStatus.workspaceSelection !== undefined) {
            window.sessionStorage.setItem(pendingWorkspaceSelectionKey, JSON.stringify(nextStatus.workspaceSelection))
          }
          window.location.reload()
        } catch (reason) {
          setError(messageOf(reason))
          setBusy(false)
        }
      }

      const remoteLabel = status?.mode === 'remote'
        ? t('activeRemote', { name: status.target?.name ?? t('host') })
        : t('remoteEntry')
      const visibleWorkspaces = showAllWorkspaces ? workspaces : workspaces.slice(0, 3)
      const visibleCodexWorkspaces = showAllCodexWorkspaces ? codexWorkspaces : codexWorkspaces.slice(0, 3)
      const codexAvailable = status?.remoteFeatures?.codex === true
      const selectedHostDetails = selectedHost === undefined ? undefined : [
        formatPlatform(selectedHost.platform),
        selectedHost.harnessVersion === undefined ? undefined : t('harnessVersion', { version: selectedHost.harnessVersion }),
        selectedHost.clientVersion === undefined ? undefined : t('pluginVersion', { version: selectedHost.clientVersion }),
      ].filter(Boolean).join(' · ')

      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: `dshRemoteSidebarEntry${status?.mode === 'remote' ? ' isActive' : ''}${props.wide ? ' isWide' : ' isRail'}` },
        React.createElement(status?.mode === 'remote' ? 'div' : 'button', {
          ...(status?.mode === 'remote' ? {} : { type: 'button', onClick: () => void show() }),
          className: 'dshRemoteModeButton',
          title: remoteLabel,
          'aria-label': remoteLabel,
        }, React.createElement('svg', {
          className: 'dshRemoteComputerIcon',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        React.createElement('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
        React.createElement('path', { d: 'M8 21h8M12 17v4' })), props.wide
          ? React.createElement('span', { className: 'dshRemoteSidebarLabel' }, remoteLabel)
          : null),
        status?.mode === 'remote' && props.wide ? React.createElement('button', {
          type: 'button',
          className: 'dshRemoteExitLink',
          disabled: busy,
          onClick: () => void openLocalWorkspaces(),
        }, t('exitRemote')) : null),
        !open ? null : React.createElement('div', {
          className: 'dshRemoteBackdrop',
          role: 'presentation',
          onMouseDown: (event: MouseEvent) => { if (event.target === event.currentTarget) setOpen(false) },
        }, React.createElement('section', {
          className: `dshRemotePage${selectedHost === undefined ? '' : ' hasSelectedHost'}`,
          role: 'dialog',
          'aria-modal': true,
          'aria-label': selectedHost?.name ?? t('remoteTitle'),
        },
          React.createElement('header', { className: 'dshRemotePageHeader' },
            React.createElement('div', { className: 'dshRemotePageIntro' },
              React.createElement('strong', null, selectedHost?.name ?? t('remoteTitle')),
              React.createElement('p', null, selectedHostDetails ?? t('remoteDescription'))),
            React.createElement('div', { className: 'dshRemotePageActions' },
              selectedHost === undefined ? null : React.createElement('button', {
                type: 'button',
                className: 'dshRemotePageBack',
                disabled: busy,
                title: t('backToHosts'),
                onClick: chooseAnotherHost,
              }, t('backToHosts')),
              React.createElement('button', {
                type: 'button',
                className: 'dshRemotePageRefresh',
                disabled: busy,
                title: t('refreshRemote'),
                'aria-label': t('refreshRemote'),
                onClick: () => void refreshRemote(),
              }, t('refreshRemoteShort')),
              React.createElement('button', { type: 'button', className: 'dshRemotePageClose', onClick: () => setOpen(false), 'aria-label': t('close') }, '×'))),
          React.createElement('main', { className: 'dshRemotePageBody' },
            status?.mode === 'remote' ? React.createElement('button', {
              type: 'button',
              className: 'dshRemoteLocalLink',
              disabled: busy,
              onClick: () => void openLocalWorkspaces(),
            }, t('openLocalWorkspaces')) : null,
            React.createElement(React.Fragment, null,
                needsAuthorization ? React.createElement('section', { className: 'dshRemoteEnable' },
                  React.createElement('div', { className: 'dshRemoteLoginHeading' },
                    React.createElement('strong', { className: 'dshRemoteLoginTitle' }, t('signInClient')),
                    React.createElement('span', null, t('signInClientDescription'))),
                  React.createElement('div', { className: 'dshRemoteLoginTabs', role: 'tablist' },
                    ...orderedQrProviders.map(qrLoginTab),
                    React.createElement('button', {
                      type: 'button', role: 'tab', id: 'dsh-remote-password-tab',
                      'aria-selected': loginMethod === 'password', 'aria-controls': 'dsh-remote-password-panel',
                      className: loginMethod === 'password' ? 'isActive' : '', disabled: busy,
                      onClick: () => selectLoginMethod('password'),
                    }, t('accountPasswordLogin'))),
                  loginMethod !== 'password'
                    ? React.createElement('div', {
                      className: 'dshRemoteQrLogin', role: 'tabpanel', id: `dsh-remote-${loginMethod}-panel`,
                      'aria-labelledby': `dsh-remote-${loginMethod}-tab`,
                    },
                      qrImage === undefined
                        ? React.createElement('div', { className: 'dshRemoteQrPlaceholder', 'aria-busy': busy },
                          qrExpired ? React.createElement('p', null, t('qrLoginExpired')) : React.createElement('span', null, t('checkingConnection')))
                        : qrSession !== undefined
                          ? React.createElement('a', {
                            className: 'dshRemoteQrOpen', href: qrSession.scanUrl,
                            target: '_blank', rel: 'noopener noreferrer',
                            'aria-label': t('openInBrowser'),
                          },
                          React.createElement('img', {
                            src: qrImage, width: 184, height: 184,
                            alt: t(loginMethod === 'github' ? 'scanWithGitHub' : 'scanWithZhihu'),
                          }),
                          React.createElement('span', null, t('openInBrowser'), ' ↗'))
                          : null,
                      React.createElement('strong', null, t(loginMethod === 'github' ? 'scanWithGitHub' : 'scanWithZhihu')),
                      React.createElement('p', null, t('scanLoginHint')),
                      status?.serverUrl === undefined ? null : React.createElement('p', { className: 'dshRemoteServiceAddress' },
                        t('currentServiceAddress'), ' ', React.createElement('a', {
                          href: status.serverUrl, target: '_blank', rel: 'noreferrer',
                        }, status.serverUrl)),
                      qrExpired ? React.createElement('button', {
                        type: 'button', disabled: busy, onClick: () => setQrExpired(false),
                      }, t('refreshQrCode')) : null)
                    : React.createElement('div', {
                      className: 'dshRemoteClientLogin', role: 'tabpanel', id: 'dsh-remote-password-panel',
                      'aria-labelledby': 'dsh-remote-password-tab',
                    },
                      React.createElement('input', {
                        type: 'email', value: email, disabled: busy, autoComplete: 'username', placeholder: t('account'),
                        'aria-label': t('account'), onChange: (event: Event) => setEmail((event.target as HTMLInputElement).value),
                      }),
                      React.createElement('input', {
                        type: 'password', value: password, disabled: busy, autoComplete: 'current-password', placeholder: t('password'),
                        'aria-label': t('password'), onChange: (event: Event) => setPassword((event.target as HTMLInputElement).value),
                      }),
                      React.createElement('button', { type: 'button', disabled: busy || email.trim() === '' || password === '', onClick: () => void signInClient() }, t(busy ? 'signingIn' : 'startSignIn')))) : null,
                needsAuthorization ? null : React.createElement(React.Fragment, null,
                selectedHost === undefined ? React.createElement('section', { className: 'dshRemoteHosts', 'aria-label': t('chooseHost') },
                  React.createElement('div', { className: 'dshRemoteSectionHeading' },
                    React.createElement('div', { className: 'dshRemoteSectionTitle' },
                      React.createElement('strong', null, t('chooseHost')),
                      status?.hostAuthorizationAvailable ? React.createElement('div', { className: 'dshRemoteHostControlToggle' },
                        React.createElement('span', null, t('allowControlCurrentDevice')),
                        React.createElement('input', {
                          type: 'checkbox', role: 'switch', disabled: busy,
                          'aria-label': t('allowControlCurrentDevice'),
                          checked: status.host?.authorized === true,
                          onChange: (event: Event) => void setCurrentDeviceControl((event.target as HTMLInputElement).checked),
                        })) : null,
                      React.createElement('button', {
                        type: 'button', className: 'dshRemoteAccountExit', disabled: busy,
                        onClick: () => void logoutRemote(),
                      }, t('exitRemoteAccount')))),
                  React.createElement('div', { className: 'dshRemoteHostList' }, devices.length === 0
                      ? React.createElement('p', null, busy ? t('checkingConnection') : t('noRemoteHosts'))
                      : devices.map(device => React.createElement('button', {
                        type: 'button',
                        key: device.deviceId,
                        disabled: busy || !device.online,
                        onClick: () => void selectHost(device),
                      }, React.createElement('span', null,
                        React.createElement('strong', null, device.name),
                        React.createElement('small', null, [
                          formatPlatform(device.platform),
                          device.harnessVersion === undefined ? undefined : t('harnessVersion', { version: device.harnessVersion }),
                          device.clientVersion === undefined ? undefined : t('pluginVersion', { version: device.clientVersion }),
                        ].filter(Boolean).join(' · '))),
                      React.createElement('small', null, t(device.online ? 'online' : 'offline')))))) : null,
                React.createElement(RemoteProgressView, { progress, t }),
                selectedHost === undefined ? React.createElement('p', { className: 'dshRemoteHint' }, t('selectHostHint'))
                  : React.createElement('section', { className: 'dshRemoteBrowser', 'aria-label': t('chooseDirectory') },
                    React.createElement('div', { className: 'dshRemoteSectionHeading dshRemoteWorkspaceHeading' },
                      React.createElement('strong', null, t(addingWorkspace
                        ? workspaceBackend === 'codex' ? 'addCodexWorkspace' : 'addRemoteWorkspace'
                        : 'existingWorkspaces')),
                      addingWorkspace
                        ? React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteCancelWorkspace',
                          disabled: busy,
                          onClick: cancelAddingWorkspace,
                        }, t('cancelAddWorkspace'))
                        : React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteAddWorkspace',
                          disabled: busy,
                          title: t('addRemoteWorkspace'),
                          'aria-label': t('addRemoteWorkspace'),
                          onClick: () => startAddingWorkspace('harness'),
                        }, React.createElement('svg', {
                          className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                        }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                    addingWorkspace
                      ? React.createElement('div', { className: 'dshRemoteFolderBrowser' },
                        directory === undefined
                          ? React.createElement('p', null, t('loadingDirectory'))
                          : React.createElement(React.Fragment, null,
                            React.createElement('nav', { className: 'dshRemoteCrumbs', 'aria-label': t('currentDirectory') },
                              directory.crumbs.map(crumb => React.createElement('button', {
                                type: 'button', key: crumb.path, disabled: busy || crumb.path === directory.path,
                                onClick: () => void browseDirectory(crumb.path),
                              }, crumb.path === directory.home ? '⌂' : crumb.name))),
                            React.createElement('div', { className: 'dshRemoteFolderList' }, directory.entries.filter(entry => !entry.hidden).length === 0
                              ? React.createElement('p', null, t('emptyDirectory'))
                              : directory.entries.filter(entry => !entry.hidden).map(entry => React.createElement('button', {
                                type: 'button', key: entry.path, disabled: busy, onClick: () => void browseDirectory(entry.path),
                              }, React.createElement('span', { 'aria-hidden': true }, '▱'), React.createElement('span', null, entry.name)))),
                            directory.truncated ? React.createElement('small', null, t('directoryTruncated')) : null))
                      : React.createElement(React.Fragment, null,
                        React.createElement('div', { className: 'dshRemoteWorkspaceLists' },
                          React.createElement('div', { id: workspaceListId, className: 'dshRemoteDirectoryList' }, workspaces.length === 0
                            ? React.createElement('p', null, t('noRemoteWorkspaces'))
                            : visibleWorkspaces.map(workspace => React.createElement('button', {
                              type: 'button', key: workspace.workspaceId, disabled: busy,
                              className: workspaceBackend === 'harness' && path === workspace.path ? 'isSelected' : '',
                              'aria-pressed': workspaceBackend === 'harness' && path === workspace.path,
                              onClick: () => { setWorkspaceBackend('harness'); setCodexWorkspaceId(undefined); setPath(workspace.path) },
                              onDoubleClick: () => void openWorkspace({ backend: 'harness', path: workspace.path }),
                            }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon', src: deepSeekWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title), React.createElement('small', null, workspace.path))),
                            workspaces.length <= 3 || showAllWorkspaces ? null : React.createElement('button', {
                              type: 'button',
                              className: 'dshRemoteWorkspaceMore',
                              disabled: busy,
                              'aria-controls': workspaceListId,
                              'aria-label': t('showAllWorkspaces'),
                              onClick: () => setShowAllWorkspaces(true),
                            }, React.createElement('span', { 'aria-hidden': true }, '…')))),
                        !codexAvailable && codexWorkspaces.length === 0 ? null : React.createElement('section', { className: 'dshRemoteCodexWorkspaceGroup' },
                          React.createElement('div', {
                            id: codexWorkspaceHeadingId,
                            className: 'dshRemoteWorkspaceSourceHeading',
                          }, React.createElement('span', { className: 'dshRemoteWorkspaceSourceText' },
                            React.createElement('strong', null, t('codexVirtualWorkspace'))),
                          !codexAvailable ? null : React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteAddWorkspace',
                            disabled: busy,
                            title: t('addCodexWorkspace'),
                            'aria-label': t('addCodexWorkspace'),
                            onClick: () => startAddingWorkspace('codex'),
                          }, React.createElement('svg', {
                            className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                          }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                          React.createElement('div', {
                            id: codexWorkspaceListId,
                            className: 'dshRemoteDirectoryList dshRemoteCodexWorkspaceList',
                            'aria-labelledby': codexWorkspaceHeadingId,
                          }, visibleCodexWorkspaces.length === 0
                            ? React.createElement('p', null, t('noCodexWorkspaces'))
                            : visibleCodexWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button',
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === 'codex' && codexWorkspaceId === workspace.workspaceId ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'codex' && codexWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend('codex')
                              setCodexWorkspaceId(workspace.workspaceId)
                              setPath(workspace.path)
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: 'codex',
                              path: workspace.path,
                              workspaceId: workspace.workspaceId,
                            }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon isGpt', src: gptWorkspaceIcon, alt: '', 'aria-hidden': true }),
                          React.createElement('span', null, workspace.title),
                          React.createElement('small', null, `${workspace.path} · ${workspace.sessionCount}`)))),
                          codexWorkspaces.length <= 3 || showAllCodexWorkspaces ? null : React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteWorkspaceMore',
                            disabled: busy,
                            'aria-controls': codexWorkspaceListId,
                            'aria-label': t('showAllCodexWorkspaces'),
                            onClick: () => setShowAllCodexWorkspaces(true),
                          }, React.createElement('span', { 'aria-hidden': true }, '…')))),
                    React.createElement('footer', { className: 'dshRemoteOpenBar' },
                      React.createElement('div', null, React.createElement('span', null, t('currentDirectory')), React.createElement('strong', null, path || '—')),
                      React.createElement('button', {
                        type: 'button',
                        disabled: busy || path.trim() === '' || !addingWorkspace && workspaceBackend === 'codex' && codexWorkspaceId === undefined,
                        onClick: () => void openWorkspace(),
                      }, t(busy ? 'openingWorkspace' : addingWorkspace ? 'confirmAddWorkspace' : 'openWorkspace')))))),
            notice === undefined ? null : React.createElement('p', { className: 'dshRemoteNotice', role: 'status' }, notice),
            error === undefined ? null : React.createElement('p', { className: 'dshRemoteError', role: 'alert' }, error)))))
    }


    function RemoteModeAction(props: {
      wide: boolean
      control: <T>(endpoint: string, payload?: unknown) => Promise<T>
      t: Translate
    }): unknown {
      const { t } = props
      const [open, setOpen] = React.useState(false)
      const [status, setStatus] = React.useState<RemoteStatus | undefined>(undefined)
      const [devices, setDevices] = React.useState<RemoteDevice[]>([])
      const [hostRegistrationCode, setHostRegistrationCode] = React.useState('')
      const [email, setEmail] = React.useState('')
      const [password, setPassword] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [progress, setProgress] = React.useState<RemoteConnectionProgress | undefined>(undefined)
      const progressRun = React.useRef(0)
      const [error, setError] = React.useState<string | undefined>(undefined)
      const [supported, setSupported] = React.useState(true)

      const refresh = async (): Promise<void> => {
        const [nextStatus, nextDevices] = await Promise.all([
          props.control<RemoteStatus>('status'),
          props.control<RemoteDevice[]>('devices').catch(() => []),
        ])
        setStatus(nextStatus)
        setDevices(nextDevices)
      }

      const refreshStatus = async (): Promise<void> => {
        setStatus(await props.control<RemoteStatus>('status'))
      }

      React.useEffect(() => {
        void refresh().catch(reason => {
          setError(messageOf(reason))
          setSupported(false)
        })
      }, [])

      React.useEffect(() => {
        if (!open) return
        void refreshStatus()
        const timer = window.setInterval(() => {
          void refreshStatus()
        }, 1500)
        return () => window.clearInterval(timer)
      }, [open])

      const switchMode = async (mode: 'local' | 'remote', targetDeviceId?: string): Promise<void> => {
        setBusy(true)
        setError(undefined)
        try {
          const action = (): Promise<RemoteStatus> => props.control<RemoteStatus>('mode.set', { mode, ...(targetDeviceId === undefined ? {} : { targetDeviceId }) })
          if (mode === 'remote' && targetDeviceId !== undefined) {
            setStatus(await runConnectHostProgress(
              status?.preferredTransports,
              targetDeviceId,
              props.control,
              { label: 'remoteProgressSwitchingWorkspace', detail: 'remoteProgressSwitchingWorkspaceDetail' },
              setProgress,
              progressRun,
              action,
              connectedProgress,
            ))
          } else {
            setStatus(await action())
          }
          window.location.reload()
        } catch (reason) {
          setError(messageOf(reason))
          setBusy(false)
        }
      }

      const loginHost = async (): Promise<void> => {
        if (email.trim() === '' || password === '') return
        setBusy(true)
        setError(undefined)
        try {
          await props.control('host.account.login', { email: email.trim(), password })
          await refreshStatus()
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setPassword('')
          setBusy(false)
        }
      }

      const registerHostWithCode = async (): Promise<void> => {
        if (hostRegistrationCode.trim() === '') return
        setBusy(true)
        setError(undefined)
        try {
          await props.control('host.registration-code.submit', { code: hostRegistrationCode.trim() })
          setHostRegistrationCode('')
          await refreshStatus()
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setBusy(false)
        }
      }

      const label = status?.mode === 'remote'
        ? t('remoteTarget', { name: status.target?.name ?? t('host') })
        : t('local')
      if (!supported) return null
      return React.createElement(React.Fragment, null,
        React.createElement('button', {
          type: 'button',
          className: 'dshRemoteModeButton',
          title: t('switchTarget'),
          'aria-label': t('switchTarget'),
          onClick: () => setOpen(true),
        }, React.createElement('span', { 'aria-hidden': true }, '◎'), props.wide
          ? React.createElement('span', null, label)
          : null),
        open ? React.createElement('div', { className: 'dshRemoteBackdrop', role: 'presentation' },
          React.createElement('section', {
            className: 'dshRemoteDialog',
            role: 'dialog',
            'aria-modal': true,
            'aria-label': t('harnessTarget'),
          },
          React.createElement('div', { className: 'dshRemoteHeader' },
            React.createElement('strong', null, t('harnessTarget')),
            React.createElement('button', { type: 'button', onClick: () => setOpen(false), 'aria-label': t('close') }, '×')),
          React.createElement('button', {
            type: 'button',
            disabled: busy || status?.mode === 'local',
            onClick: () => void switchMode('local'),
          }, t('thisMachineLocal')),
          React.createElement('div', { className: 'dshRemoteDevices' }, devices.length === 0
            ? React.createElement('p', null, t('noRemoteHosts'))
            : devices.map(device => React.createElement('button', {
              type: 'button',
              key: device.deviceId,
              disabled: busy || !device.online || status?.target?.deviceId === device.deviceId,
              onClick: () => void switchMode('remote', device.deviceId),
            }, `${device.name} · ${t(device.online ? 'online' : 'offline')}`))),
          React.createElement(RemoteProgressView, { progress, t }),
          status?.hostAuthorizationAvailable && status.host !== undefined
            ? React.createElement('div', { className: 'dshRemoteHostAccount' },
              React.createElement('strong', null, t('thisMachineHost')),
              React.createElement('p', null, status.host.online
                ? status.host.account === undefined ? t('connected') : t('connectedAs', { account: status.host.account })
                : status.host.accountRequired
                  ? t('hostSignInHint')
                  : status.host.error === undefined
                    ? t('checkingHost')
                    : t('hostUnavailable', { error: connectionErrorMessage(status.host.error, t) })),
              status.host.accountRequired ? React.createElement('div', { className: 'dshRemoteLogin' },
                React.createElement('input', {
                  type: 'email',
                  value: email,
                  disabled: busy,
                  autoComplete: 'username',
                  placeholder: t('serverAccountEmail'),
                  'aria-label': t('serverAccountEmail'),
                  onChange: (event: Event) => setEmail((event.target as HTMLInputElement).value),
                }),
                React.createElement('input', {
                  type: 'password',
                  value: password,
                  disabled: busy,
                  autoComplete: 'current-password',
                  placeholder: t('password'),
                  'aria-label': t('serverAccountPassword'),
                  onChange: (event: Event) => setPassword((event.target as HTMLInputElement).value),
                }),
                React.createElement('button', {
                  type: 'button',
                  disabled: busy || email.trim() === '' || password === '',
                  onClick: () => void loginHost(),
                }, t(busy ? 'signingIn' : 'signInRegisterHost')),
                React.createElement('input', {
                  value: hostRegistrationCode,
                  disabled: busy,
                  autoComplete: 'one-time-code',
                  placeholder: t('hostRegistrationCode'),
                  'aria-label': t('hostRegistrationCode'),
                  onChange: (event: Event) => setHostRegistrationCode((event.target as HTMLInputElement).value),
                }),
                React.createElement('button', {
                  type: 'button',
                  disabled: busy || hostRegistrationCode.trim() === '',
                  onClick: () => void registerHostWithCode(),
                }, t(busy ? 'registering' : 'useRegistrationCode'))) : null)
            : null,
          error === undefined ? null : React.createElement('p', { className: 'dshRemoteError', role: 'alert' }, error)))
          : null)
    }

    function RemoteSessionHeaderAction(props: {
      control: <T>(endpoint: string, payload?: unknown) => Promise<T>
      t: Translate
    }): unknown {
      const { t } = props
      const [status, setStatus] = React.useState<RemoteStatus | undefined>(undefined)
      const [busy, setBusy] = React.useState(false)
      const [routeOpen, setRouteOpen] = React.useState(false)

      React.useEffect(() => {
        let active = true
        const refresh = (): void => {
          void props.control<RemoteStatus>('status').then(next => {
            if (active) setStatus(next)
          }).catch(() => undefined)
        }
        refresh()
        const timer = window.setInterval(refresh, 1_500)
        return () => {
          active = false
          window.clearInterval(timer)
        }
      }, [])

      React.useEffect(() => {
        if (status?.mode !== 'remote') return
        return hideLocalSessionActions()
      }, [status?.mode])

      React.useEffect(() => {
        document.documentElement.classList.toggle(
          'dshRemoteCodexTargetActive',
          status?.mode === 'remote' && status.backend === 'codex',
        )
        return () => document.documentElement.classList.remove('dshRemoteCodexTargetActive')
      }, [status?.mode, status?.backend])

      React.useEffect(() => {
        if (!routeOpen) return
        const closeOnEscape = (event: KeyboardEvent): void => {
          if (event.key === 'Escape') setRouteOpen(false)
        }
        document.addEventListener('keydown', closeOnEscape)
        return () => document.removeEventListener('keydown', closeOnEscape)
      }, [routeOpen])

      if (status?.mode !== 'remote') return null
      const exit = async (): Promise<void> => {
        setBusy(true)
        try {
          await props.control('mode.set', { mode: 'local' })
          window.location.reload()
        } finally {
          setBusy(false)
        }
      }
      const transport = status.network?.webRtc?.mode ?? status.transport ?? 'Disconnected'
      const networkLabel = transport === 'P2P'
        ? t('remoteNetworkP2p')
        : transport === 'TURN'
          ? t('remoteNetworkTurn')
          : transport === 'Relay'
            ? t('remoteNetworkRelay')
            : transport === 'LAN'
              ? t('remoteNetworkLan')
              : t('remoteNetworkOffline')
      const networkOnline = status.connected === true && transport !== 'Disconnected'
      const routeVia = transport === 'P2P'
        ? t('connectionRouteP2p')
        : transport === 'TURN'
          ? t('connectionRouteTurn')
          : transport === 'Relay'
            ? t('connectionRouteRelay')
            : t('connectionRouteLan')
      const routeViaDetail = transport === 'P2P'
        ? t('connectionRouteP2pDetail')
        : transport === 'TURN'
          ? t('connectionRouteTurnDetail')
          : transport === 'Relay'
            ? t('connectionRouteRelayDetail')
            : t('connectionRouteLanDetail')
      const network = status.network
      const webRtc = network?.webRtc
      const controlStateLabel = network?.controlChannelState === 'connecting'
        ? t('controlStateConnecting')
        : network?.controlChannelState === 'open'
          ? t('controlStateOpen')
          : network?.controlChannelState === 'closing'
            ? t('controlStateClosing')
            : t('controlStateClosed')
      const detailValue = (value: string | number | undefined): string => value === undefined || value === ''
        ? t('notProvided')
        : String(value)
      const candidateLabel = (value: string | undefined): string => value === 'host'
        ? t('candidateHost')
        : value === 'srflx'
          ? t('candidateSrflx')
          : value === 'prflx'
            ? t('candidatePrflx')
            : value === 'relay'
              ? t('candidateRelay')
              : detailValue(value)
      const fact = (label: string, value: string, mono = false): unknown => React.createElement('div', null,
        React.createElement('dt', null, label),
        React.createElement('dd', { className: mono ? 'isMono' : undefined, title: mono ? value : undefined }, value))
      return React.createElement('div', { className: 'dshRemoteSessionHeader', role: 'status' },
        React.createElement('svg', {
          viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        }, React.createElement('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }), React.createElement('path', { d: 'M8 21h8M12 17v4' })),
        React.createElement('span', { className: 'dshRemoteSessionTarget' }, t('remoteModeLabel', { name: status.target?.name ?? t('host') })),
        React.createElement('button', {
          type: 'button',
          className: `dshRemoteNetwork${networkOnline ? ' isOnline' : ' isOffline'}`,
          title: networkLabel,
          disabled: !networkOnline,
          'aria-haspopup': 'dialog',
          'aria-expanded': routeOpen,
          onClick: () => setRouteOpen(value => !value),
        }, React.createElement('i', { 'aria-hidden': true }), networkLabel),
        networkOnline ? React.createElement('span', { className: 'dshRemoteEncrypted' }, t('remoteLinkEncrypted')) : null,
        React.createElement('button', { type: 'button', className: 'dshRemoteHeaderExitLink', disabled: busy, onClick: () => void exit() }, t('exitRemote')),
        !routeOpen ? null : React.createElement('div', {
          className: 'dshRemoteRouteBackdrop',
          role: 'presentation',
          onMouseDown: (event: MouseEvent) => { if (event.target === event.currentTarget) setRouteOpen(false) },
        }, React.createElement('section', {
          className: 'dshRemoteRoutePanel',
          role: 'dialog',
          'aria-label': t('connectionRouteTitle'),
        }, React.createElement('header', null,
          React.createElement('strong', null, t('connectionRouteTitle')),
          React.createElement('button', { type: 'button', 'aria-label': t('close'), onClick: () => setRouteOpen(false) }, '×')),
        React.createElement('ol', null,
          React.createElement('li', null,
            React.createElement('small', null, t('connectionRouteFrom')),
            React.createElement('strong', null, network?.local.name ?? t('connectionRouteCurrentDevice')),
            network === undefined ? null : React.createElement('span', null, `${network.local.platform} · ${shortDeviceId(network.local.deviceId)}`)),
          React.createElement('li', null,
            React.createElement('small', null, t('connectionRouteVia')),
            React.createElement('strong', null, routeVia),
            React.createElement('span', null, routeViaDetail)),
          React.createElement('li', null,
            React.createElement('small', null, t('connectionRouteTo')),
            React.createElement('strong', null, network?.remote.name ?? status.target?.name ?? t('host')),
            React.createElement('span', null, network === undefined
              ? t('connectionRouteHost')
              : `${network.remote.platform} · ${shortDeviceId(network.remote.deviceId)}`))),
        network === undefined ? null : React.createElement('section', { className: 'dshRemoteRouteSection' },
          React.createElement('h3', null, t('connectionDetailsConnection')),
          React.createElement('dl', null,
            fact(t('connectionId'), detailValue(network.connectionId), true),
            fact(t('connectedAt'), network.connectedAt === undefined ? t('notProvided') : formatLocalTime(network.connectedAt)),
            fact(t('preferredTransports'), network.preferredTransports.map(value => transportLabel(value, t)).join(' → ')),
            fact(t('controlChannel'), `WebSocket · ${controlStateLabel}`),
            fact(t('controlAddress'), network.controlChannelUrl, true))),
        webRtc === undefined ? null : React.createElement('section', { className: 'dshRemoteRouteSection' },
          React.createElement('h3', null, t('connectionDetailsWebRtc')),
          React.createElement('dl', null,
            fact(t('peerState'), `${webRtc.connectionState} · ICE ${webRtc.iceConnectionState}`),
            fact(t('dataChannel'), detailValue(webRtc.dataChannelState)),
            fact(t('localCandidate'), candidateLabel(webRtc.localCandidateType)),
            fact(t('remoteCandidate'), candidateLabel(webRtc.remoteCandidateType)),
            fact(t('localAddress'), detailValue(webRtc.localAddress), true),
            fact(t('remoteAddress'), detailValue(webRtc.remoteAddress), true),
            fact(t('networkProtocol'), detailValue(webRtc.protocol?.toUpperCase())),
            fact(t('relayProtocol'), detailValue(webRtc.relayProtocol?.toUpperCase())),
            fact(t('roundTripTime'), webRtc.currentRoundTripTimeMs === undefined
              ? t('notProvided')
              : `${webRtc.currentRoundTripTimeMs.toLocaleString()} ms`),
            fact(t('availableBitrate'), webRtc.availableOutgoingBitrate === undefined
              ? t('notProvided')
              : formatBitrate(webRtc.availableOutgoingBitrate)),
            fact(t('bytesSent'), webRtc.bytesSent === undefined ? t('notProvided') : formatByteSize(webRtc.bytesSent)),
            fact(t('bytesReceived'), webRtc.bytesReceived === undefined ? t('notProvided') : formatByteSize(webRtc.bytesReceived)))),
        React.createElement('p', null, t('connectionRouteEncrypted')))))
    }

    function hideLocalSessionActions(): () => void {
      const selector = 'button,a,[role="button"]'
      const hiddenAttribute = 'data-dsh-remote-hidden-action'
      const localAction = /(?:open|打开).{0,12}vs\s*code|vs\s*code.{0,12}(?:open|打开)|session\s*logs?|download.{0,12}session\s*logs?|会话日志|下载.{0,8}日志/i
      const inspect = (root: ParentNode): void => {
        const candidates = root instanceof Element && root.matches(selector)
          ? [root, ...Array.from(root.querySelectorAll(selector))]
          : Array.from(root.querySelectorAll(selector))
        for (const candidate of candidates) {
          if (candidate.closest('.dshRemoteSessionHeader') !== null) continue
          const label = [
            candidate.getAttribute('aria-label'),
            candidate.getAttribute('title'),
            candidate.getAttribute('data-tooltip'),
            candidate.textContent,
          ].filter(Boolean).join(' ')
          if (localAction.test(label)) candidate.setAttribute(hiddenAttribute, '')
        }
      }
      inspect(document.body)
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') inspect(record.target as Element)
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof Element) inspect(node)
          }
        }
      })
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-label', 'title', 'data-tooltip'],
      })
      return () => {
        observer.disconnect()
        document.querySelectorAll(`[${hiddenAttribute}]`).forEach(element => element.removeAttribute(hiddenAttribute))
      }
    }


    function installStyle(): () => void {
      const style = document.createElement('style')
      style.dataset.plugin = clientModuleId
      style.dataset.pluginCss = 'dsh-remote'
      style.textContent = [
        'html.dshRemoteTargetActive button[aria-label="添加工作区"],html.dshRemoteTargetActive button[aria-label="Add workspace"]{display:none!important}',
        'html.dshRemoteCodexTargetActive [data-composer-card] button[aria-haspopup="listbox"][aria-label="指令"],html.dshRemoteCodexTargetActive [data-composer-card] button[aria-haspopup="listbox"][aria-label="Commands"]{display:none!important}',
        '[data-dsh-remote-hidden-action]{display:none!important}',
        '.dshRemoteModeButton{min-height:36px;border:0;background:transparent;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px;padding:0 10px;border-radius:8px}.dshRemoteModeButton:is(button){cursor:pointer}',
        '.dshRemoteModeButton:is(button):hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dshRemoteSidebarEntry{box-sizing:border-box;position:relative;min-width:0;display:block;overflow:hidden}.dshRemoteSidebarEntry .dshRemoteModeButton{box-sizing:border-box;width:100%;min-width:0}.dshRemoteSidebarEntry.isWide{width:calc(100% + 8px);height:34px;margin:4px -4px}.dshRemoteSidebarEntry.isWide .dshRemoteModeButton{height:34px;min-height:34px;padding:6px 48px 6px 10px;border-radius:12px}.dshRemoteSidebarEntry.isRail{width:36px;height:54px}.dshRemoteSidebarEntry.isRail .dshRemoteModeButton{width:36px;height:36px;min-height:36px;justify-content:center;gap:0;margin:8px 0 10px;padding:0;border-radius:50%}.dshRemoteSidebarEntry.isActive .dshRemoteModeButton{color:var(--dsw-alias-label-secondary);background:transparent}.dshRemoteSidebarLabel{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshRemoteExitLink{position:absolute;top:50%;right:10px;transform:translateY(-50%);white-space:nowrap;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;font:inherit;font-size:12px;line-height:20px;cursor:pointer}.dshRemoteExitLink:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteExitLink:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:2px}.dshRemoteExitLink:disabled{opacity:.45;cursor:default;text-decoration:none}',
        '.dshRemoteComputerIcon{box-sizing:border-box;width:18px;height:18px;flex:0 0 18px;color:var(--dsw-alias-label-secondary)}',
        '.dshRemoteSessionHeader{position:fixed;z-index:25;top:12px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 360px);height:28px;display:inline-flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}.dshRemoteSessionHeader>svg{width:15px;height:15px;flex:0 0 auto}.dshRemoteSessionTarget{min-width:0;max-width:260px;overflow:hidden;text-overflow:ellipsis}.dshRemoteNetwork{flex:0 0 auto;border:0;background:transparent;color:inherit;font:inherit;padding:3px 2px;display:inline-flex;align-items:center;gap:5px;cursor:pointer}.dshRemoteNetwork:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteNetwork:disabled{cursor:default}.dshRemoteNetwork>i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.dshRemoteNetwork.isOnline>i{background:var(--dsw-alias-state-success-primary)}.dshRemoteNetwork.isOffline{color:var(--dsw-alias-state-error-primary)}.dshRemoteNetwork.isOffline>i{background:currentColor}.dshRemoteEncrypted{flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}.dshRemoteHeaderExitLink{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:3px 2px;font:inherit;text-decoration:none;cursor:pointer}.dshRemoteHeaderExitLink:hover{text-decoration:underline;color:var(--dsw-alias-label-primary)}.dshRemoteHeaderExitLink:disabled{opacity:.45;cursor:default;text-decoration:none}.dshRemoteNetwork:focus-visible,.dshRemoteHeaderExitLink:focus-visible,.dshRemoteRoutePanel>header button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshRemoteRouteBackdrop{position:fixed;inset:0;z-index:26}.dshRemoteRoutePanel{box-sizing:border-box;position:absolute;top:48px;right:28px;width:min(680px,calc(100vw - 32px));max-height:calc(100vh - 72px);overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;white-space:normal}.dshRemoteRoutePanel>header{position:sticky;top:-16px;z-index:1;display:flex;align-items:center;justify-content:space-between;margin:-16px -16px 0;padding:16px;background:var(--dsw-alias-bg-layer-1)}.dshRemoteRoutePanel>header strong{font-size:14px}.dshRemoteRoutePanel>header button{width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:inherit;font-size:20px;cursor:pointer}.dshRemoteRoutePanel>header button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteRoutePanel ol{display:flex;align-items:stretch;margin:12px 0 0;padding:0 0 16px;border-bottom:1px solid var(--dsw-alias-border-l2);list-style:none}.dshRemoteRoutePanel li{position:relative;min-width:0;flex:1;display:flex;flex-direction:column;gap:4px;padding-right:20px}.dshRemoteRoutePanel li:not(:last-child)::after{content:"→";position:absolute;right:7px;top:21px;color:var(--dsw-alias-label-tertiary)}.dshRemoteRoutePanel li small{color:var(--dsw-alias-label-tertiary)}.dshRemoteRoutePanel li strong,.dshRemoteRoutePanel li span{overflow:hidden;text-overflow:ellipsis}.dshRemoteRoutePanel li strong{font-size:13px}.dshRemoteRoutePanel li span{color:var(--dsw-alias-label-secondary);font-size:11px}.dshRemoteRouteSection{padding-top:16px}.dshRemoteRouteSection h3{margin:0 0 10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}.dshRemoteRouteSection dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px;margin:0}.dshRemoteRouteSection dl>div{min-width:0;display:grid;grid-template-columns:minmax(104px,auto) minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;line-height:1.45}.dshRemoteRouteSection dt{color:var(--dsw-alias-label-tertiary)}.dshRemoteRouteSection dd{min-width:0;margin:0;text-align:right;overflow-wrap:anywhere}.dshRemoteRouteSection dd.isMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}.dshRemoteRoutePanel>p{margin:16px 0 0;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}@media(max-width:620px){.dshRemoteSessionHeader{top:8px;max-width:calc(100vw - 112px)}.dshRemoteSessionHeader>svg{display:none}.dshRemoteSessionTarget{max-width:130px}.dshRemoteEncrypted{display:none}.dshRemoteRoutePanel{top:42px;right:12px;max-height:calc(100vh - 56px)}.dshRemoteRoutePanel ol{flex-direction:column;gap:18px}.dshRemoteRoutePanel li:not(:last-child)::after{content:"↓";top:auto;right:auto;bottom:-16px;left:3px}.dshRemoteRouteSection dl{grid-template-columns:1fr}.dshRemoteRouteSection dl>div{grid-template-columns:1fr;gap:2px}.dshRemoteRouteSection dd{text-align:left}}',
        '.dshRemoteSessionHeader{left:auto;right:148px;transform:none;max-width:calc(100vw - 420px)}@media(max-width:760px){.dshRemoteSessionHeader{left:auto;right:104px;transform:none;max-width:calc(100vw - 124px)}}',
        '.dshRemoteModeButton:focus-visible,.dshRemotePage button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        '.dshRemotePage{width:min(720px,100%);max-height:min(760px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:14px;overflow:hidden;animation:dshRemotePageIn .18s cubic-bezier(.25,1,.5,1)}',
        '.dshRemotePageHeader{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dshRemotePageIntro{min-width:0;flex:1}.dshRemotePageHeader strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:18px;line-height:1.4}.dshRemotePageHeader p{min-width:0;max-width:70ch;margin:3px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}.dshRemotePageActions{flex:0 0 auto;display:flex;align-items:center;gap:4px}.dshRemotePageActions>button{height:40px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border:0;border-radius:8px;background:transparent;color:inherit;line-height:1;cursor:pointer}.dshRemotePageActions>button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshRemotePageActions>button:disabled{opacity:.45;cursor:default}.dshRemotePageBack,.dshRemotePageRefresh{min-width:48px;padding:0 10px;font:inherit;font-size:13px}.dshRemotePageBack{color:var(--dsw-alias-label-secondary)!important}.dshRemotePageClose{width:40px;padding:0;font-size:24px}',
        '.dshRemotePageBody{padding:24px;overflow:auto;display:flex;flex-direction:column;gap:24px}.dshRemotePageBody button{font:inherit;color:inherit}',
        '.dshRemoteSectionHeading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:10px}.dshRemoteSectionTitle{min-width:0;display:flex;align-items:center;gap:10px}.dshRemoteSectionTitle>strong{font-size:14px}.dshRemoteSectionActions{display:flex;align-items:center;gap:14px}.dshRemoteSectionActions>button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:5px 0;font-size:12px}.dshRemoteSectionActions>button:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}',
        '.dshRemoteCancelWorkspace{min-height:36px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 0;cursor:pointer}.dshRemoteCancelWorkspace:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteCancelWorkspace:disabled{opacity:.5;cursor:default}',
        '.dshRemoteHostList{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}.dshRemoteHostList>button{min-height:58px;display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;padding:10px 4px;cursor:pointer}.dshRemoteHostList>button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteHostList>button:disabled{opacity:.5;cursor:default}.dshRemoteHostList>button>span{min-width:0;display:flex;flex-direction:column;gap:3px}.dshRemoteHostList>button strong{font-size:14px;font-weight:500}.dshRemoteHostList small{color:var(--dsw-alias-label-secondary);font-size:12px}',
        '.dshRemoteProgress{display:flex;flex-direction:column;gap:8px;margin:12px 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dshRemoteProgressHeader{display:flex;align-items:center;justify-content:space-between;gap:12px}.dshRemoteProgressHeader strong{font-size:13px;font-weight:600}.dshRemoteProgressHeader span{color:var(--dsw-alias-label-secondary);font-size:12px}.dshRemoteProgressBar{height:6px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-bg-layer-3)}.dshRemoteProgressBar>span{display:block;width:100%;height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary);transform-origin:left center;transition:transform .22s ease-out}[dir="rtl"] .dshRemoteProgressBar>span{transform-origin:right center}.dshRemoteProgress p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45}.dshRemoteProgressRoute{font-weight:500}.dshRemoteProgressRoute .isActive{color:var(--dsw-alias-state-success-primary);font-weight:700}.dshRemoteProgressRouteArrow{color:var(--dsw-alias-label-tertiary)}@media(prefers-reduced-motion:reduce){.dshRemoteProgressBar>span{transition:none}}',
        '.dshRemoteBrowser{display:flex;flex-direction:column}.dshRemoteCrumbs{display:flex;align-items:center;gap:4px;overflow:auto;padding:2px 0 10px}.dshRemoteCrumbs>button{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 7px;border-radius:6px;cursor:pointer}.dshRemoteCrumbs>button:not(:last-child)::after{content:" /";color:var(--dsw-alias-label-tertiary)}.dshRemoteCrumbs>button:disabled{color:var(--dsw-alias-label-primary);font-weight:600}',
        '.dshRemoteWorkspaceLists{overflow:visible}',
        '.dshRemoteDirectoryList{min-height:72px;display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l2)}.dshRemoteDirectoryList>button{min-height:52px;display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px;text-align:left;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;padding:8px 4px;cursor:pointer}.dshRemoteDirectoryList>button:hover,.dshRemoteDirectoryList>button.isSelected{background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteDirectoryList>button.isSelected{color:var(--dsw-alias-label-primary)}.dshRemoteDirectoryList>button>span:first-child,.dshRemoteDirectoryList>button>.dshRemoteWorkspaceIcon{grid-row:1/3}.dshRemoteWorkspaceIcon{box-sizing:border-box;width:22px;height:22px;align-self:center;object-fit:contain}.dshRemoteWorkspaceIcon.isGpt{border-radius:6px}.dshRemoteDirectoryList>button>span:not(:first-child),.dshRemoteDirectoryList>button>small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshRemoteDirectoryList>button>small{grid-column:2;color:var(--dsw-alias-label-secondary)}.dshRemoteDirectoryList>p,.dshRemoteHint{margin:12px 0;color:var(--dsw-alias-label-secondary);font-size:13px}',
        '.dshRemoteAddWorkspace{box-sizing:border-box;width:40px;height:40px;display:inline-grid;place-items:center;flex:0 0 auto;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;cursor:pointer}.dshRemoteAddWorkspace:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteAddWorkspace:disabled{opacity:.5;cursor:default}.dshRemoteAddWorkspaceIcon{width:20px;height:20px}.dshRemoteCodexWorkspaceGroup{margin-top:16px}.dshRemoteWorkspaceSourceHeading{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 4px 7px}.dshRemoteWorkspaceSourceText{min-width:0;display:flex;flex-direction:column;gap:2px}.dshRemoteWorkspaceSourceText>strong{font-size:13px}.dshRemoteWorkspaceSourceText>small{color:var(--dsw-alias-label-secondary);font-size:11px}.dshRemoteCodexWorkspaceList{min-height:0}.dshRemoteDirectoryList>.dshRemoteWorkspaceMore,.dshRemoteCodexWorkspaceGroup>.dshRemoteWorkspaceMore{box-sizing:border-box;width:100%;min-height:48px;display:flex;align-items:center;justify-content:center;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);padding:8px 4px;text-align:center;font-size:16px;cursor:pointer}.dshRemoteWorkspaceMore>span{display:block;line-height:1;transform:translateY(-2px)}.dshRemoteWorkspaceMore:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:transparent}.dshRemoteWorkspaceMore:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dshRemoteWorkspaceMore:disabled{opacity:.5;cursor:default}',
        '.dshRemoteFolderBrowser{margin-top:14px}.dshRemoteFolderBrowser>p,.dshRemoteFolderList>p{margin:12px 0;color:var(--dsw-alias-label-secondary);font-size:13px}.dshRemoteFolderList{max-height:260px;overflow:auto;border-block:1px solid var(--dsw-alias-border-l2)}.dshRemoteFolderList>button{width:100%;min-height:42px;display:flex;align-items:center;gap:9px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);background:transparent;padding:7px 6px;text-align:left;cursor:pointer}.dshRemoteFolderList>button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteFolderBrowser>small{display:block;margin-top:8px;color:var(--dsw-alias-state-warn-label)}',
        '.dshRemotePathField{display:flex;flex-direction:column;gap:6px;margin-top:20px}.dshRemotePathField>span{font-size:13px;font-weight:600}.dshRemotePathField>input{min-height:40px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:inherit;padding:0 12px;font:inherit}.dshRemotePathField>small{color:var(--dsw-alias-label-secondary)}',
        '.dshRemoteOpenBar{position:sticky;bottom:-96px;display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:20px;padding:14px 0;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l2)}.dshRemoteOpenBar>div{min-width:0;display:flex;flex-direction:column;gap:3px}.dshRemoteOpenBar span{color:var(--dsw-alias-label-secondary);font-size:12px}.dshRemoteOpenBar strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.dshRemoteOpenBar>button,.dshRemoteEnable>button{min-height:40px;flex:0 0 auto;border:0;border-radius:8px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);padding:8px 16px;cursor:pointer}.dshRemoteOpenBar>button:disabled,.dshRemoteEnable>button:disabled{opacity:.5;cursor:default}',
        '.dshRemoteEnable{box-sizing:border-box;width:min(440px,100%);max-width:100%;min-height:388px;margin:0 auto;display:flex;flex-direction:column;align-items:stretch;gap:10px}.dshRemoteEnable p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}',
        '.dshRemoteLoginTabs{width:min(440px,100%);display:flex;border-bottom:1px solid var(--dsw-alias-border-l2)}.dshRemoteLoginTabs>button{position:relative;min-height:38px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}.dshRemoteLoginTabs>button:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.dshRemoteLoginTabs>button.isActive{color:var(--dsw-alias-label-primary);font-weight:600}.dshRemoteLoginTabs>button.isActive::after{content:"";position:absolute;right:12px;bottom:-1px;left:12px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary)}.dshRemoteLoginTabs>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:6px}',
        '.dshRemoteClientLogin{width:min(440px,100%);display:flex;flex-direction:column;gap:8px}.dshRemoteClientLogin input{min-height:40px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:inherit;padding:0 12px;font:inherit}.dshRemoteClientLogin button{align-self:flex-start;min-height:40px;border:0;border-radius:8px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);padding:8px 16px;cursor:pointer}',
        '.dshRemoteQrLogin{width:min(440px,100%);display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px 0 2px;text-align:center}.dshRemoteQrLogin img,.dshRemoteQrPlaceholder{box-sizing:border-box;width:200px;height:200px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:#fff;padding:8px}.dshRemoteQrOpen{display:flex;flex-direction:column;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;text-decoration:none}.dshRemoteQrOpen:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteQrOpen:hover img{border-color:var(--dsw-alias-label-dimmed)}.dshRemoteQrOpen:focus-visible{border-radius:12px;outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.dshRemoteQrPlaceholder{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}.dshRemoteQrLogin>strong{font-size:14px}.dshRemoteQrLogin>p{max-width:48ch;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.dshRemoteQrLogin>.dshRemoteServiceAddress{margin-top:2px;color:var(--dsw-alias-label-tertiary)}.dshRemoteServiceAddress>a{color:var(--dsw-alias-label-secondary);text-decoration:none}.dshRemoteServiceAddress>a:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteQrLogin>button,.dshRemoteClientLogin>.dshRemoteLoginSwitch{min-height:32px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 8px;font:inherit;font-size:12px;cursor:pointer}.dshRemoteQrLogin>button:hover,.dshRemoteClientLogin>.dshRemoteLoginSwitch:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteClientLogin>.dshRemoteLoginSwitch{align-self:flex-start;background:transparent;color:var(--dsw-alias-label-secondary);padding-left:0}',
        '.dshRemoteLoginHeading{box-sizing:border-box;width:100%;display:flex;align-items:baseline;gap:10px;overflow:hidden;white-space:nowrap}.dshRemoteLoginTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshRemoteLoginHeading>span{flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:400}.dshRemoteLoginTabs{box-sizing:border-box;width:100%}.dshRemoteLoginTabs>button{min-width:0;flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}.dshRemoteLoginTabs>button.isActive::after{right:0;left:0;border-radius:0}.dshRemoteClientLogin,.dshRemoteQrLogin{box-sizing:border-box;width:100%;height:300px;min-height:300px}.dshRemoteClientLogin{align-items:stretch;padding-top:16px}.dshRemoteClientLogin>button{align-self:stretch;width:100%}.dshRemoteQrLogin{padding-top:12px}',
        '.dshRemoteHostControlToggle{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap;cursor:default}.dshRemoteHostControlToggle>input{appearance:none;box-sizing:border-box;position:relative;width:32px;height:18px;flex:0 0 auto;margin:0;border:1px solid var(--dsw-alias-label-secondary);border-radius:999px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);transition:background .16s ease-out,border-color .16s ease-out,box-shadow .16s ease-out}.dshRemoteHostControlToggle>input::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .16s ease-out,background .16s ease-out}.dshRemoteHostControlToggle>input:checked{border-color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-primary);box-shadow:none}.dshRemoteHostControlToggle>input:checked::after{transform:translateX(14px);background:var(--dsw-alias-bg-layer-1)}.dshRemoteHostControlToggle>input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshRemoteHostControlToggle>input:disabled{opacity:.5;cursor:default}@media(prefers-reduced-motion:reduce){.dshRemoteHostControlToggle>input,.dshRemoteHostControlToggle>input::after{transition:none}}',
        '.dshRemoteAccountExit{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:5px 0;font-size:12px;line-height:1.5;white-space:nowrap}.dshRemoteAccountExit:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}.dshRemoteAccountExit:disabled{opacity:.5;cursor:default;text-decoration:none}',
        '.dshRemoteLocalLink{align-self:flex-start;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 0;cursor:pointer}.dshRemoteLocalLink:hover{color:var(--dsw-alias-label-primary)}',
        '@keyframes dshRemotePageIn{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.dshRemotePage{animation:none}}@media(max-width:620px){.dshRemoteBackdrop{padding:12px}.dshRemotePage{max-height:calc(100vh - 24px)}.dshRemotePageHeader{gap:8px;padding:12px 16px}.dshRemotePage.hasSelectedHost .dshRemotePageBack{max-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshRemoteSectionHeading{align-items:flex-start;flex-direction:column;gap:8px}.dshRemoteWorkspaceHeading{align-items:center;flex-direction:row}.dshRemoteSectionActions{width:100%;justify-content:space-between}.dshRemotePageBody{padding:20px 16px}.dshRemoteOpenBar{align-items:flex-end}.dshRemoteOpenBar>button{min-height:48px}}',
        '.dshRemoteBackdrop{position:fixed;inset:0;z-index:1000;background:var(--dsw-alias-bg-mask-3);display:grid;place-items:center;padding:20px}',
        '.dshRemoteDialog{width:min(460px,100%);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px;display:grid;gap:12px;box-shadow:var(--dsw-shadow-lv2)}',
        '.dshRemoteDialog button,.dshRemoteDialog input{font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 10px;background:transparent;color:inherit}',
        '.dshRemoteDialog button:not(:disabled){cursor:pointer}.dshRemoteDialog button:disabled{opacity:.5}',
        '.dshRemoteHeader{display:flex;align-items:center;justify-content:space-between}.dshRemoteHeader button{border:0;font-size:22px;padding:0 6px}',
        '.dshRemoteDevices{display:grid;gap:8px}.dshRemoteDevices p{margin:4px 0;color:var(--dsw-alias-label-secondary)}',
        '.dshRemoteError{margin:0;color:var(--dsw-alias-state-error-primary)}',
        '.dshRemoteHostAccount{display:grid;gap:8px;border-top:1px solid var(--dsw-alias-border-l3);padding-top:12px}.dshRemoteHostAccount p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}',
        '.dshRemoteLogin{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dshRemoteLogin button{grid-column:1/-1}',
        '.dshRemotePluginCard{list-style:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s}',
        '.dshRemotePluginCard:hover{border-color:var(--dsw-alias-label-dimmed)}.dshRemotePluginCard.isOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
        '.dshRemotePluginCardHeader{display:flex;align-items:center}.dshRemotePluginCardToggle{appearance:none;width:100%;min-width:0;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}.dshRemotePluginCardToggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
        '.dshRemotePluginCardHeading{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.dshRemotePluginCardHeading>strong{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dshRemotePluginCardHeading>span{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dshRemotePluginCardStatus{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.dshRemotePluginCardStatus.isOnline{color:var(--dsw-alias-state-success-primary)}.dshRemotePluginCardStatus.isReconnecting{color:var(--dsw-alias-state-warn-label)}.dshRemotePluginCardStatus.isOffline{color:var(--dsw-alias-state-error-primary)}.dshRemotePluginCardChevron{color:var(--dsw-alias-label-tertiary);font-size:18px;line-height:14px;transition:transform .16s}.dshRemotePluginCard.isOpen .dshRemotePluginCardChevron{transform:rotate(180deg)}',
        '.dshRemotePluginCardBody{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.dshRemoteSettings{display:flex;flex-direction:column;max-width:720px}.dshRemoteSettingsTop{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0}.dshRemoteSettingsState{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
        '.dshRemoteField{display:flex;flex-direction:column;gap:6px;padding:12px 0}.dshRemoteField+.dshRemoteField{border-top:1px solid var(--dsw-alias-border-l2)}.dshRemoteField label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}.dshRemoteField input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.dshRemoteField input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.dshRemoteField input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.dshRemoteField p{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
        '.dshRemoteAuthorizationSetting{border-top:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0}.dshRemoteAuthorizationSetting>div{min-width:0}.dshRemoteAuthorizationSetting strong{font-size:13px;font-weight:500}.dshRemoteAuthorizationSetting p{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}.dshRemoteAuthorizationSetting>input{appearance:none;position:relative;width:38px;height:22px;flex:0 0 auto;margin:0;border:1px solid var(--dsw-alias-label-secondary);border-radius:999px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);transition:background .16s ease-out,border-color .16s ease-out,box-shadow .16s ease-out}.dshRemoteAuthorizationSetting>input::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .16s ease-out,background .16s ease-out}.dshRemoteAuthorizationSetting>input:checked{border-color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-primary);box-shadow:none}.dshRemoteAuthorizationSetting>input:checked::after{transform:translateX(16px);background:var(--dsw-alias-bg-layer-1)}.dshRemoteAuthorizationSetting>input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dshRemoteAuthorizationSetting>input:disabled{opacity:.5;cursor:default}@media(prefers-reduced-motion:reduce){.dshRemoteAuthorizationSetting>input,.dshRemoteAuthorizationSetting>input::after{transition:none}}',
        '.dshRemoteAssociation{min-width:0;flex:1;display:flex;flex-direction:column;gap:4px}.dshRemoteAssociation>span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dshRemoteAssociation strong{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:1.5}.dshRemoteAssociation p{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
        '.dshRemoteConnection{border-top:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0}.dshRemoteConnectionSummary{min-width:0;display:flex;flex-direction:column;gap:4px}.dshRemoteConnectionSummary>span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dshRemoteConnectionSummary strong{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:1.5}.dshRemoteConnectionSummary p,.dshRemoteConnectionIssue{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.dshRemoteConnectionDot{width:8px;height:8px;flex:0 0 auto;border-radius:999px;background:var(--dsw-alias-label-tertiary)}.dshRemoteConnectionDot.isOnline{background:var(--dsw-alias-state-success-primary)}.dshRemoteConnectionDot.isReconnecting{background:var(--dsw-alias-state-warn-primary)}.dshRemoteConnectionDot.isOffline{background:var(--dsw-alias-state-error-primary)}.dshRemoteConnectionIssue{color:var(--dsw-alias-state-error-primary);padding:0 0 12px}.dshRemoteReconnect{appearance:none;flex:0 0 auto;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);min-height:34px;padding:5px 14px;font-size:13px;line-height:1.5}.dshRemoteReconnect:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}.dshRemoteReconnect:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dshRemoteReconnect:disabled{opacity:.4;cursor:default}',
        '.dshRemoteSettingsFooter{border-top:1px solid var(--dsw-alias-border-l2);display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px}.dshRemoteSettingsFooter .dshRemoteError,.dshRemoteNotice{min-width:0;flex:1;margin:0;font-size:12px;line-height:1.5}.dshRemoteNotice{color:var(--dsw-alias-label-tertiary)}.dshRemoteDiscard,.dshRemoteSave{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.dshRemoteDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent}.dshRemoteDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.dshRemoteSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dshRemoteDiscard:disabled,.dshRemoteSave:disabled{opacity:.4;cursor:default}.dshRemoteDiscard:focus-visible,.dshRemoteSave:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
        '@media(max-width:620px){.dshRemotePluginCardStatus{display:none}.dshRemoteSettingsTop{gap:10px}.dshRemoteConnection{align-items:flex-start}.dshRemoteReconnect{min-height:40px}}',
      ].join('')
      document.head.append(style)
      return () => style.remove()
    }

    function apply(ctx: {
      connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<ControlResult> } }
      effect(effect: () => (() => void), label: string): void
      inject(services: string[], callback: (ctx: {
        effect(effect: () => (() => void), label: string): void
        get<T = unknown>(name: string): T | undefined
      }) => void): void
      get<T = unknown>(name: string): T | undefined
      workspaces: WorkspacesClientServiceLike
      sessions: SessionsClientServiceLike
      locale: {
        bind(namespace: string): Translate
        getLocale(): { active: 'zh' | 'en' }
        register(namespace: string, dictionaries: { zh: typeof zh; en: typeof en }): () => void
      }
      slots: {
        inject(name: string, factory: () => unknown): void
        register(options: Record<string, unknown>, component: unknown): unknown
      }
    }): void {
      if (window.__DS_HARNESS_REMOTE_CLIENT_ACTIVE__) return
      window.__DS_HARNESS_REMOTE_CLIENT_ACTIVE__ = true
      ctx.effect(() => () => { window.__DS_HARNESS_REMOTE_CLIENT_ACTIVE__ = false }, 'ds-harness-remote: client singleton')

      const t = ctx.locale.bind(localeNamespace)
      let controlRouteRetryAfter = 0
      let controlRouteBackoffIndex = 0
      const control = async <T,>(endpoint: string, payload: unknown = {}): Promise<T> => {
        if (endpoint === 'status' && Date.now() < controlRouteRetryAfter) {
          return controlRouteUnavailableStatus() as T
        }
        let result: ControlResult
        try {
          result = await ctx.connection.rpc.call(CONTROL_RPC_PREFIX, endpoint, payload)
          controlRouteRetryAfter = 0
          controlRouteBackoffIndex = 0
        } catch (reason) {
          if (!isMissingControlRoute(reason)) throw reason
          const delayMs = controlRouteBackoffStepsMs[Math.min(controlRouteBackoffIndex, controlRouteBackoffStepsMs.length - 1)]!
          controlRouteBackoffIndex += 1
          controlRouteRetryAfter = Date.now() + delayMs
          if (endpoint === 'status') return controlRouteUnavailableStatus() as T
          throw new ControlRouteUnavailableError(t('remoteControlUnavailable'))
        }
        if (!result.ok) throw new Error(result.error?.message ?? t('remoteRequestFailed'))
        return result.value as T
      }
      ctx.effect(() => {
        let disposed = false
        let unsubscribeWorkspaces: (() => void) | undefined
        let unsubscribeSessions: (() => void) | undefined
        let selection: RemoteWorkspaceSelection | undefined
        let opening = false

        const reconcile = (): void => {
          if (disposed || opening || selection === undefined) return
          const pending = selection
          const workspaceSnapshot = ctx.workspaces.list.getSnapshot()
          if (!workspacesReady(workspaceSnapshot)
            || !workspaceSnapshot.items.some(workspace => workspace.workspaceId === pending.workspaceId)) return
          const sessionSnapshot = ctx.sessions.list.getSnapshot()
          if (pending.backend === 'codex' && pending.sessionId !== undefined
            && sessionSnapshot.phase !== 'ready') return

          opening = true
          unsubscribeWorkspaces?.()
          unsubscribeSessions?.()
          unsubscribeWorkspaces = undefined
          unsubscribeSessions = undefined
          const open = pending.backend === 'codex' && pending.sessionId !== undefined
            ? sessionSnapshot.ids.includes(pending.sessionId)
              ? Promise.resolve(pending.sessionId)
              : ctx.workspaces.connectWorkspace(pending.workspaceId)
            : ctx.workspaces.connectWorkspace(pending.workspaceId)
          void open.then(async sessionId => {
            if (disposed) return
            ctx.sessions.open(sessionId)
            window.sessionStorage.removeItem(pendingWorkspaceSelectionKey)
            await control('workspace.selection.consume', pending).catch(() => undefined)
          }).catch(reason => {
            if (!disposed) console.warn('remote workspace selection failed:', reason)
          })
        }

        void control<RemoteStatus>('status').then(status => {
          const pending = status.workspaceSelection ?? storedWorkspaceSelection()
          if (disposed || status.mode !== 'remote' || pending === undefined
            || status.target?.deviceId !== pending.targetDeviceId) return
          selection = pending
          unsubscribeWorkspaces = ctx.workspaces.list.subscribe(reconcile)
          unsubscribeSessions = ctx.sessions.list.subscribe(reconcile)
          reconcile()
        }).catch(() => undefined)

        return () => {
          disposed = true
          unsubscribeWorkspaces?.()
          unsubscribeSessions?.()
        }
      }, 'ds-harness-remote: resume selected workspace')
      ctx.inject(['fileViewer'], fileViewerContext => {
        const viewer = fileViewerContext.get<FileViewerClientServiceLike>('fileViewer')
        if (viewer === undefined) return
        fileViewerContext.effect(() => {
          let active = true
          let unregister: (() => void) | undefined
          let latestSaveAsAllowed = false
          let latestSaveAsMaxBytes = REMOTE_FILE_SAVE_AS_MAX_BYTES
          const sync = async (): Promise<void> => {
            try {
              const status = await control<RemoteStatus>('status')
              if (!active) return
              const supported = shouldUseRemoteFileViewer(status)
              latestSaveAsAllowed = shouldAllowRemoteFileSaveAs(status)
              latestSaveAsMaxBytes = remoteFileSaveAsMaxBytes(status)
              if (supported && unregister === undefined) {
                unregister = viewer.registerContentProvider(createRemoteFileContentProvider(
                  (endpoint, payload) => control(endpoint, payload),
                  { saveAsAllowed: () => latestSaveAsAllowed, saveAsMaxBytes: () => latestSaveAsMaxBytes },
                ))
              } else if (!supported && unregister !== undefined) {
                unregister()
                unregister = undefined
                latestSaveAsAllowed = false
                latestSaveAsMaxBytes = REMOTE_FILE_SAVE_AS_MAX_BYTES
              }
            } catch {
              // Keep the last known registration while the loopback control
              // route is temporarily unavailable. Remote calls still fail
              // closed at the authenticated Host bridge.
            }
          }
          void sync()
          const timer = window.setInterval(() => { void sync() }, 1_500)
          return () => {
            active = false
            window.clearInterval(timer)
            unregister?.()
          }
        }, 'ds-harness-remote: remote file viewer provider')
      })
      ctx.effect(() => ctx.locale.register(localeNamespace, { zh, en }), 'ds-harness-remote: dictionaries')
      ctx.effect(installStyle, 'ds-harness-remote: client styles')
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'ds-harness-remote-global-context',
        order: 20,
        locale: localeNamespace,
        inject: () => ({ control }),
      }, RemoteSessionHeaderAction))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'ds-harness-remote-workspace',
        order: -20,
        locale: localeNamespace,
        inject: () => ({
          control,
          preferredQrProvider: ctx.locale.getLocale().active === 'zh' ? 'zhihu' : 'github',
        }),
      }, RemoteWorkspaceAction))
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: 'ds-harness-remote',
        id: 'ds-harness-remote',
        order: 30,
        locale: localeNamespace,
        inject: () => ({ control }),
      }, RemotePluginOptions))
    }

    function isMissingControlRoute(reason: unknown): boolean {
      return reason instanceof Error
        && reason.message.startsWith(`transport failure for ${CONTROL_RPC_PREFIX}/`)
        && (reason.message.endsWith(': HTTP 404') || reason.message.endsWith(': HTTP 405'))
    }

    function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }

    function formatPlatform(value: string): string {
      const normalized = value.toLowerCase()
      if (normalized === 'darwin' || normalized === 'macos') return 'macOS'
      if (normalized === 'win32' || normalized === 'windows') return 'Windows'
      if (normalized === 'linux') return 'Linux'
      return value
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
