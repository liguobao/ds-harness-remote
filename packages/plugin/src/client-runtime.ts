import type { ApiProxy, RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { CodexAppFrameData, CodexAppStreamClosedData } from '@dsh-remote/protocol'
import { CodexRemoteClient, RemoteClientCore } from '@dsh-remote/client-core'
import {
  AdaptiveTransport,
  stunOnlyIceServers,
  type RtcConnectionDiagnostics,
  type RtcIceServer,
  type RtcPeerConnectionFactory,
} from '@dsh-remote/webrtc'
import { ApiProxySwitch, type HarnessMode } from './api-proxy-switch.js'
import { ClientSecureTransport } from './client-secure-transport.js'
import type { ResolvedConfig } from './config.js'
import { registerControlRoute, type HostWebServerLike } from './control-route.js'
import type { HostIdentity, IdentityStore, TrustedPeer } from './identity-store.js'
import type { TypertGatewayLike } from './typert-gateway-contract.js'
import { uuidV7 } from './ids.js'
import type { SafeLogger } from './logging.js'
import { harnessSessionGeneration } from './harness-version.js'
import { RemoteHarnessApiProxy } from './remote-api-proxy.js'
import { RemoteTypertGateway } from './remote-typert-gateway.js'
import {
  codexProjectWorkspaceId,
  CodexVirtualHarness,
  discoverCodexVirtualWorkspaces,
  type CodexVirtualWorkspaceView,
} from './codex/virtual-harness.js'
import {
  ClientServerApi,
  ServerApiError,
  type AuthorizedPeerDevice,
  type OAuthProvider,
  type ServerHostDevice,
} from './server-api.js'
import { TypertGatewaySwitch } from './typert-gateway-switch.js'
import type { RemoteFileViewerEndpoint } from './file-viewer-contract.js'
import { loadNodeRtcFactory, type WeriftFactoryOptions } from './werift-rtc.js'

interface ConnectedRemote {
  client: RemoteClientCore
  target: TrustedPeer
  transport: AdaptiveTransport
  features: RemoteHostFeatures
  progressRunId: number
  clientVersion?: string
  harnessVersion?: string
}

export interface RemoteHostFeatures {
  commandList: boolean
  fileViewer: boolean
  apiProxy: boolean
  remoteGateway: boolean
  sessionFormat?: 3
  codex: boolean
}

interface CodexLoopbackStream {
  target: { kind: 'remote'; client: RemoteClientCore } | { kind: 'local' }
  frames: Array<{ method: string; params: unknown }>
  closed?: string
  unsubscribe: () => void
  close: () => Promise<void>
  wake: () => void
}

const REMOTE_COMMAND_LIST_MIN_VERSION = [0, 3, 16] as const
const REMOTE_FILE_VIEWER_MIN_VERSION = [0, 3, 17] as const
const DIRECT_WEBRTC_NEGOTIATE_TIMEOUT_MS = 12_000
const DIRECT_LAN_PROGRESS_DISPLAY_MS = 1_400

type TransportAttempt = 'direct' | 'turn' | 'relay'

interface ConnectionProgressState {
  runId: number
  targetDeviceId: string
  phase: 'checking-host' | 'authorizing-peer' | 'probing' | 'connected'
  activeTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>
}

export interface RemoteDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

export interface RemoteDirectoryListing {
  path: string
  home: string
  crumbs: RemoteDirectoryEntry[]
  entries: RemoteDirectoryEntry[]
  truncated: boolean
}

export interface RemoteWorkspaceView {
  workspaceId: string
  path: string
  title: string
}

interface RemoteWorkspaceSelection {
  targetDeviceId: string
  workspaceId: string
  backend?: 'harness' | 'codex'
  sessionId?: string
}

export interface RemoteDeviceView {
  deviceId: string
  name: string
  platform: string
  membershipId: string
  online: boolean
  lastSeenAt?: number
  clientVersion?: string
  harnessVersion?: string
}

export interface HostConnectionRpc {
  handle(
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>,
    options: { authority: 'loopback' | 'trusted-host' },
  ): () => Promise<void>
}

export interface HostConnectionHandle {
  requestRejection?(request: { headers: Record<string, string | string[] | undefined> }): number | undefined
  rpc: HostConnectionRpc
}

export interface HostAuthorizationControl {
  hostStatus(): {
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
  reconnectHost(): void
  clearHostAuthorization(): Promise<void>
  localHarnessVersion?(): string | undefined
  authorizeHostAsOwned(accessToken: string, account?: string): Promise<unknown>
  authorizeHostWithAccount(email: string, password: string): Promise<unknown>
  authorizeHostWithCode(code: string): Promise<unknown>
  codexStatus?(): { available: boolean }
  codexCall?(input: unknown, signal?: AbortSignal): Promise<unknown>
  codexRespond?(input: unknown, signal?: AbortSignal): Promise<{ resolved: true }>
  codexOpenStream?(
    input: unknown,
    publish: (event: 'codex.app.frame' | 'codex.app.stream.closed', data: CodexAppFrameData | CodexAppStreamClosedData) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<unknown>
  codexCloseStream?(input: unknown): Promise<unknown>
}

export class ClientModeRuntime {
  private identity?: HostIdentity
  private connected?: ConnectedRemote
  private pendingWorkspaceSelection?: RemoteWorkspaceSelection
  private codexVirtual?: CodexVirtualHarness
  private readonly proxySwitch?: ApiProxySwitch
  private readonly gatewaySwitch: TypertGatewaySwitch
  private readonly codexStreams = new Map<string, CodexLoopbackStream>()
  private connectionProgress?: ConnectionProgressState
  private connectionProgressRun = 0
  private closed = false

  constructor(
    private readonly config: ResolvedConfig,
    private readonly identities: IdentityStore,
    private readonly server: ClientServerApi,
    apiProxy: ApiProxy | undefined,
    typertGateway: TypertGatewayLike,
    private readonly logger: SafeLogger,
    private readonly host?: HostAuthorizationControl,
    private readonly rtcFactoryProvider: (options?: WeriftFactoryOptions) => Promise<RtcPeerConnectionFactory | undefined> = loadNodeRtcFactory,
  ) {
    this.proxySwitch = apiProxy === undefined ? undefined : new ApiProxySwitch(apiProxy)
    this.gatewaySwitch = new TypertGatewaySwitch(typertGateway)
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error('client remote-mode runtime is closed')
    this.identity = await this.identities.loadOrCreate(this.config.deviceName)
    this.server.bindIdentity(this.identity)
    this.proxySwitch?.install()
    this.gatewaySwitch.install()
    this.logger.info('client remote-mode identity ready', {
      deviceId: shortId(this.identity.deviceId),
      fingerprint: this.identity.fingerprint,
    })
  }

  registerControl(connection: HostConnectionHandle, webServer?: HostWebServerLike): () => Promise<void> {
    return registerControlRoute(connection, (endpoint, payload, signal) => this.handleControl(endpoint, payload, signal), webServer)
  }

  status(): Record<string, unknown> {
    const targetStatus = this.gatewaySwitch.supportsCarrier()
      ? this.gatewaySwitch.status()
      : this.proxySwitch?.status() ?? this.gatewaySwitch.status()
    return {
      available: this.config.serverUrl !== undefined,
      identityReady: this.identity !== undefined,
      deviceId: this.identity?.deviceId,
      deviceName: this.identity?.name,
      serverUrl: this.config.serverUrl,
      ...targetStatus,
      connected: this.connected !== undefined,
      transport: this.connected?.client.getStats().mode ?? 'Disconnected',
      connectedTargetDeviceId: this.connected?.target.deviceId,
      preferredTransports: this.config.forceRelay ? ['relay'] : ['lan', 'p2p', 'turn', 'relay'],
      ...(this.connectionProgress === undefined ? {} : {
        connectionProgress: {
          targetDeviceId: this.connectionProgress.targetDeviceId,
          phase: this.connectionProgress.phase,
          ...(this.connectionProgress.activeTransports === undefined
            ? {}
            : { activeTransports: [...this.connectionProgress.activeTransports] }),
        },
      }),
      remoteFeatures: this.connected?.features ?? remoteHostFeatures(),
      ...(this.pendingWorkspaceSelection === undefined
        ? {}
        : { workspaceSelection: { ...this.pendingWorkspaceSelection } }),
      backend: this.codexVirtual === undefined ? 'harness' : 'codex',
      hostAuthorizationAvailable: this.host !== undefined,
      ...(this.host === undefined ? {} : { host: this.host.hostStatus() }),
    }
  }

  private async detailedStatus(): Promise<Record<string, unknown>> {
    const connected = this.connected
    if (connected === undefined || this.identity === undefined) return this.status()
    const details = await connected.transport.connectionDetails()
    if (this.connected !== connected) return this.status()
    return {
      ...this.status(),
      network: {
        ...details,
        local: {
          deviceId: this.identity.deviceId,
          name: this.identity.name,
          platform: process.platform,
        },
        remote: {
          deviceId: connected.target.deviceId,
          name: connected.target.name,
          platform: connected.target.platform,
        },
      },
    }
  }

  async devices(): Promise<RemoteDeviceView[]> {
    this.requireIdentity()
    const serverDevices = await this.server.listDevices()
    const remoteDevices = serverDevices.filter(device => device.deviceId !== this.host?.hostStatus().deviceId)
    return Promise.all(remoteDevices.map(async device => {
      await this.authorizeHostPeer(device)
      const presence = await this.server.presenceFor(device.deviceId).catch(() => ({ online: false }))
      return { ...device, ...presence }
    }))
  }

  async authorizeClientWithAccount(email: string, password: string): Promise<unknown> {
    let authorization
    try {
      authorization = await this.server.authorizeWithAccount(this.requireIdentity(), email, password)
    } catch (error) {
      if (!(error instanceof ServerApiError) || error.code !== 'DEVICE_REVOKED') throw error
      this.identity = await this.identities.reset(this.config.deviceName)
      this.server.bindIdentity(this.identity)
      authorization = await this.server.authorizeWithAccount(this.identity, email, password)
    }
    this.logger.info('Client account authorized')
    return authorization
  }

  async startClientOAuthQrLogin(provider: OAuthProvider): Promise<unknown> {
    return this.server.startOAuthQrLogin(provider)
  }

  async pollClientOAuthQrLogin(qrId: string): Promise<unknown> {
    const result = await this.server.pollOAuthQrLogin(this.requireIdentity(), qrId, async () => {
      this.identity = await this.identities.reset(this.config.deviceName)
      this.server.bindIdentity(this.identity)
      this.logger.info('Rotated revoked Client identity before QR authorization retry')
      return this.identity
    })
    if (result.status === 'complete') this.logger.info('Client account authorized with QR login')
    return result
  }

  async clearClientAuthorization(): Promise<void> {
    const previous = this.connected
    this.connected = undefined
    this.connectionProgress = undefined
    this.pendingWorkspaceSelection = undefined
    await this.closeCodexVirtual()
    this.proxySwitch?.selectLocal()
    this.gatewaySwitch.selectLocal()
    await this.closeCodexStreams(previous?.client)
    await previous?.client.close().catch(() => undefined)
    await this.server.revokeCurrentDevice()
    this.identity = await this.identities.reset(this.config.deviceName)
    this.server.bindIdentity(this.identity)
  }

  async setHostAuthorization(enabled: boolean): Promise<unknown> {
    if (this.host === undefined) throw new ClientModeError('METHOD_NOT_ALLOWED', 'This plugin is not running as a Host.')
    if (!enabled) {
      await this.host.clearHostAuthorization()
      return this.status()
    }
    const credentials = await this.server.authenticate(this.requireIdentity())
    await this.host.authorizeHostAsOwned(credentials.accessToken, credentials.account)
    return this.status()
  }

  async setMode(mode: HarnessMode, targetDeviceId?: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (mode === 'local') {
      await this.closeCodexVirtual()
      this.proxySwitch?.selectLocal()
      this.gatewaySwitch.selectLocal()
      const previous = this.connected
      this.connected = undefined
      this.connectionProgress = undefined
      this.pendingWorkspaceSelection = undefined
      await this.closeCodexStreams(previous?.client)
      await previous?.client.close().catch(() => undefined)
      this.logger.info('Harness target switched', { mode: 'local' })
      return this.status()
    }
    if (targetDeviceId === undefined || targetDeviceId.length === 0) {
      throw new ClientModeError('INVALID_MESSAGE', 'A targetDeviceId is required for remote mode.')
    }
    const next = await this.connect(targetDeviceId, signal)
    try {
      this.assertRemoteCompatible(next)
    } catch (error) {
      this.clearConnectionProgress(next.progressRunId)
      await next.client.close().catch(() => undefined)
      throw error
    }
    const previous = this.connected
    this.connected = next
    this.clearConnectionProgress(next.progressRunId)
    this.pendingWorkspaceSelection = undefined
    await this.closeCodexVirtual()
    this.selectRemoteTarget(next)
    await this.closeCodexStreams(previous?.client)
    await previous?.client.close().catch(() => undefined)
    this.logger.info('Harness target switched', { mode: 'remote', targetDeviceId: shortId(next.target.deviceId) })
    return this.status()
  }

  async listRemoteDirectory(targetDeviceId: string, path?: string, signal?: AbortSignal): Promise<RemoteDirectoryListing> {
    const remote = await this.ensureConnected(targetDeviceId, signal)
    if (remote.features.remoteGateway) {
      const value = await new RemoteTypertGateway(remote.client).invoke({
        namespace: 'directoryPicker',
        method: 'list',
        args: path === undefined ? {} : { path },
        ...(signal === undefined ? {} : { signal }),
      })
      return value as RemoteDirectoryListing
    }
    const api = new RemoteHarnessApiProxy(remote.client).api
    const response = await api.host.listDirectory({
      rpcId: `remote-directory-${Date.now()}` as never,
      payload: path === undefined ? {} : { path },
    }, signal ?? new AbortController().signal)
    return unwrapNativeResult<RemoteDirectoryListing>(response)
  }

  async listRemoteWorkspaces(targetDeviceId: string, signal?: AbortSignal): Promise<RemoteWorkspaceView[]> {
    const remote = await this.ensureConnected(targetDeviceId, signal)
    if (remote.features.remoteGateway) {
      return readRemoteWorkspaceBaseline(new RemoteTypertGateway(remote.client), signal)
    }
    const api = new RemoteHarnessApiProxy(remote.client).api
    const response = await api.workspace.list({
      rpcId: `remote-workspaces-${Date.now()}` as never,
      payload: {},
    })
    const value = unwrapNativeResult<{ items: RemoteWorkspaceView[] }>(response)
    return value.items
  }

  async openRemoteWorkspace(targetDeviceId: string, path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (path.trim() === '') throw new ClientModeError('INVALID_MESSAGE', 'A remote working directory is required.')
    const remote = await this.ensureConnected(targetDeviceId, signal)
    this.assertRemoteCompatible(remote)
    let workspace: { workspace: unknown; created: boolean }
    if (remote.features.remoteGateway) {
      workspace = await new RemoteTypertGateway(remote.client).invoke({
        namespace: 'workspace',
        method: 'create',
        args: { request: { path } },
        ...(signal === undefined ? {} : { signal }),
      }) as { workspace: unknown; created: boolean }
    } else {
      const api = new RemoteHarnessApiProxy(remote.client).api
      const response = await api.workspace.create({
        rpcId: `remote-workspace-${Date.now()}` as never,
        payload: { path },
      })
      workspace = unwrapNativeResult<{ workspace: unknown; created: boolean }>(response)
    }
    await this.closeCodexVirtual()
    this.selectRemoteTarget(remote)
    const workspaceId = workspaceRecordId(workspace.workspace)
    this.pendingWorkspaceSelection = { targetDeviceId: remote.target.deviceId, workspaceId }
    this.logger.info('Remote workspace opened', { targetDeviceId: shortId(remote.target.deviceId) })
    return { ...this.status(), workspace }
  }

  async listCodexWorkspaces(targetDeviceId: string, signal?: AbortSignal): Promise<CodexVirtualWorkspaceView[]> {
    const remote = await this.ensureConnected(targetDeviceId, signal)
    remote.features = await probeRemoteHostFeatures(remote.client, remote.clientVersion)
    if (!remote.features.codex) {
      throw new ClientModeError('FEATURE_NOT_SUPPORTED', 'The selected Host does not provide CodeX workspaces.')
    }
    return discoverCodexVirtualWorkspaces(new CodexRemoteClient(remote.client), signal)
  }

  async openCodexWorkspace(
    targetDeviceId: string,
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const remote = await this.ensureConnected(targetDeviceId, signal)
    remote.features = await probeRemoteHostFeatures(remote.client, remote.clientVersion)
    if (!remote.features.codex) {
      throw new ClientModeError('FEATURE_NOT_SUPPORTED', 'The selected Host does not provide CodeX workspaces.')
    }
    this.assertRemoteCompatible(remote)
    const virtual = CodexVirtualHarness.remote(remote.client, {
      deviceId: remote.target.deviceId,
      name: remote.target.name,
    }, harnessSessionGeneration(this.host?.localHarnessVersion?.()))
    let workspace: CodexVirtualWorkspaceView
    try {
      workspace = await virtual.selectWorkspace(workspaceId, signal)
    } catch {
      await virtual.close()
      throw new ClientModeError('WORKSPACE_NOT_FOUND', 'The selected CodeX workspace is no longer available.')
    }
    await this.closeCodexVirtual()
    this.codexVirtual = virtual
    this.selectCodexTarget(virtual, remote)
    const preferredSessionId = await virtual.preferredSessionId(signal)
    this.pendingWorkspaceSelection = {
      targetDeviceId: remote.target.deviceId,
      workspaceId,
      backend: 'codex',
      ...(preferredSessionId === undefined ? {} : { sessionId: preferredSessionId }),
    }
    this.logger.info('CodeX virtual workspace opened', { targetDeviceId: shortId(remote.target.deviceId) })
    return { ...this.status(), workspace }
  }

  async createCodexWorkspace(
    targetDeviceId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const trimmedPath = path.trim()
    if (trimmedPath === '') throw new ClientModeError('INVALID_MESSAGE', 'A CodeX project directory is required.')
    const remote = await this.ensureConnected(targetDeviceId, signal)
    remote.features = await probeRemoteHostFeatures(remote.client, remote.clientVersion)
    if (!remote.features.codex) {
      throw new ClientModeError('FEATURE_NOT_SUPPORTED', 'The selected Host does not provide CodeX workspaces.')
    }
    this.assertRemoteCompatible(remote)
    const result = record(await new CodexRemoteClient(remote.client).request('project/create', {
      name: remoteWorkspaceTitle(trimmedPath),
      roots: [{ path: trimmedPath }],
      idempotencyKey: uuidV7(),
    }, signal))
    const project = record(result.project)
    if (typeof project.id !== 'string' || project.id.length === 0) {
      throw new ClientModeError('INVALID_MESSAGE', 'The Host returned an invalid CodeX project.')
    }
    return this.openCodexWorkspace(targetDeviceId, codexProjectWorkspaceId(project.id), signal)
  }

  private consumeWorkspaceSelection(selection: RemoteWorkspaceSelection): Record<string, unknown> {
    const pending = this.pendingWorkspaceSelection
    if (pending?.targetDeviceId === selection.targetDeviceId
      && pending.workspaceId === selection.workspaceId
      && (pending.backend ?? 'harness') === (selection.backend ?? 'harness')) {
      this.pendingWorkspaceSelection = undefined
    }
    return this.status()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.proxySwitch?.selectLocal()
    this.gatewaySwitch.selectLocal()
    this.pendingWorkspaceSelection = undefined
    await this.closeCodexVirtual()
    await this.closeCodexStreams(this.connected?.client)
    await this.connected?.client.close().catch(() => undefined)
    this.connected = undefined
    this.connectionProgress = undefined
    this.proxySwitch?.restore()
    this.gatewaySwitch.restore()
  }

  private async callRemoteFileViewer(
    endpoint: RemoteFileViewerEndpoint,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const remote = this.connected
    if (remote === undefined || this.status().mode !== 'remote') {
      throw new ClientModeError('REMOTE_NOT_CONNECTED', 'No Remote Host is selected.', true)
    }
    if (!remote.features.fileViewer) {
      throw new ClientModeError('FEATURE_NOT_SUPPORTED', 'The selected Remote Host does not support remote file viewing.')
    }
    return remote.client.rpc('fileviewer.call', { endpoint, payload }, signal)
  }

  private activeRemote(): ConnectedRemote | undefined {
    return this.connected
  }

  private activeCodexRemote(): ConnectedRemote | undefined {
    const remote = this.activeRemote()
    if (remote === undefined) return undefined
    if (!remote.features.codex) {
      return undefined
    }
    return remote
  }

  private async openCodexStream(payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const remote = this.activeCodexRemote()
    const value = record(payload)
    if (typeof value.streamId !== 'string' || value.streamId.length === 0 || value.streamId.length > 128
      || typeof value.threadId !== 'string' || value.threadId.length === 0) {
      throw new ClientModeError('INVALID_MESSAGE', 'A Codex stream and thread are required.')
    }
    if (this.codexStreams.has(value.streamId)) throw new ClientModeError('REQUEST_CONFLICT', 'The Codex stream is already open.')
    let wake = () => undefined
    const stream: CodexLoopbackStream = {
      target: remote === undefined ? { kind: 'local' } : { kind: 'remote', client: remote.client },
      frames: [],
      unsubscribe: () => undefined,
      close: async () => {
        if (remote === undefined) {
          await this.host?.codexCloseStream?.({ streamId: value.streamId }).catch(() => undefined)
          return
        }
        await remote.client.rpc('codex.app.stream.close', { streamId: value.streamId }).catch(() => undefined)
      },
      wake: () => wake(),
    }
    if (remote === undefined) {
      const host = this.requireLocalCodex()
      this.codexStreams.set(value.streamId, stream)
      try {
        const result = await host.codexOpenStream({ streamId: value.streamId, threadId: value.threadId }, this.publishLocalCodexFrame, signal)
        return result
      } catch (error) {
        this.codexStreams.delete(value.streamId)
        stream.wake()
        throw error
      }
    }
    stream.unsubscribe = remote.client.onEvent(event => {
      if (event.event === 'codex.app.frame' && isRecord(event.data) && event.data.streamId === value.streamId) {
        this.appendCodexFrame(stream, event.data)
      }
      if (event.event === 'codex.app.stream.closed' && isRecord(event.data) && event.data.streamId === value.streamId) {
        stream.closed = typeof event.data.reason === 'string' ? event.data.reason : 'closed'
        stream.wake()
      }
    })
    try {
      // Subscribe before opening the Host stream so the first App Server
      // notification cannot race past the loopback listener.
      await remote.client.rpc('codex.app.stream.open', { streamId: value.streamId, threadId: value.threadId }, signal)
    } catch (error) {
      stream.unsubscribe()
      throw error
    }
    this.codexStreams.set(value.streamId, stream)
    return { opened: true, streamId: value.streamId, threadId: value.threadId }
  }

  private readonly publishLocalCodexFrame = async (
    event: 'codex.app.frame' | 'codex.app.stream.closed',
    data: CodexAppFrameData | CodexAppStreamClosedData,
  ): Promise<void> => {
    const streamId = data.streamId
    const stream = this.codexStreams.get(streamId)
    if (stream === undefined || stream.target.kind !== 'local') return
    if (event === 'codex.app.frame') {
      this.appendCodexFrame(stream, data)
      return
    }
    const closed = data as CodexAppStreamClosedData
    stream.closed = typeof closed.reason === 'string' ? closed.reason : 'closed'
    stream.wake()
  }

  private appendCodexFrame(stream: CodexLoopbackStream, data: unknown): void {
    if (!isRecord(data) || !isRecord(data.frame) || typeof data.frame.method !== 'string') return
    if (stream.frames.length >= 256) {
      stream.closed = 'overflow'
    } else {
      stream.frames.push({ method: data.frame.method, params: data.frame.params })
    }
    stream.wake()
  }

  private localCodexAvailable(): boolean {
    return this.host?.codexStatus?.().available === true
  }

  private requireLocalCodex(): Required<Pick<HostAuthorizationControl,
    'codexCall' | 'codexRespond' | 'codexOpenStream' | 'codexCloseStream'
  >> {
    if (!this.localCodexAvailable()
      || this.host?.codexCall === undefined
      || this.host.codexRespond === undefined
      || this.host.codexOpenStream === undefined
      || this.host.codexCloseStream === undefined) {
      throw new ClientModeError('FEATURE_NOT_SUPPORTED', 'Local CodeX is disabled or unavailable on this Host.')
    }
    return {
      codexCall: this.host.codexCall.bind(this.host),
      codexRespond: this.host.codexRespond.bind(this.host),
      codexOpenStream: this.host.codexOpenStream.bind(this.host),
      codexCloseStream: this.host.codexCloseStream.bind(this.host),
    }
  }

  private async nextCodexFrames(payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const value = record(payload)
    if (typeof value.streamId !== 'string') throw new ClientModeError('INVALID_MESSAGE', 'A Codex stream is required.')
    const stream = this.codexStreams.get(value.streamId)
    if (stream === undefined) throw new ClientModeError('STREAM_NOT_FOUND', 'The Codex stream is not open.')
    if (stream.frames.length === 0 && stream.closed === undefined) await waitForCodexFrames(stream, signal)
    const frames = stream.frames.splice(0, 100)
    return {
      streamId: value.streamId,
      frames,
      closed: stream.closed !== undefined,
      ...(stream.closed === undefined ? {} : { reason: stream.closed }),
    }
  }

  private async closeCodexStream(payload: unknown): Promise<unknown> {
    const value = record(payload)
    if (typeof value.streamId !== 'string') throw new ClientModeError('INVALID_MESSAGE', 'A Codex stream is required.')
    const stream = this.codexStreams.get(value.streamId)
    if (stream === undefined) return { closed: false, streamId: value.streamId }
    this.codexStreams.delete(value.streamId)
    stream.unsubscribe()
    stream.wake()
    await stream.close()
    return { closed: true, streamId: value.streamId }
  }

  private async closeCodexStreams(client?: RemoteClientCore): Promise<void> {
    const targets = [...this.codexStreams.entries()].filter(([, stream]) => (
      client === undefined || (stream.target.kind === 'remote' && stream.target.client === client)
    ))
    await Promise.all(targets.map(async ([streamId, stream]) => {
      this.codexStreams.delete(streamId)
      stream.unsubscribe()
      stream.closed = 'peer-disconnected'
      stream.wake()
      await stream.close()
    }))
  }

  private selectRemoteTarget(remote: ConnectedRemote): void {
    const target = { deviceId: remote.target.deviceId, name: remote.target.name }
    if (this.gatewaySwitch.supportsCarrier()) {
      this.gatewaySwitch.selectRemote(new RemoteTypertGateway(remote.client), undefined, target)
      return
    }
    this.proxySwitch!.selectRemote(new RemoteHarnessApiProxy(remote.client).api, target)
    this.gatewaySwitch.selectRemote(request => invokeRemoteCommand(remote.client, request), {
      execute: true,
      list: remote.features.commandList,
    }, target)
  }

  private selectCodexTarget(virtual: CodexVirtualHarness, remote: ConnectedRemote): void {
    const target = { deviceId: remote.target.deviceId, name: remote.target.name }
    if (this.gatewaySwitch.supportsCarrier()) {
      this.gatewaySwitch.selectRemote(virtual, undefined, target)
      return
    }
    this.proxySwitch!.selectRemote(virtual.api, target)
    this.gatewaySwitch.selectRemote(request => virtual.invoke(request), { execute: true, list: true }, target)
  }

  private async closeCodexVirtual(): Promise<void> {
    const virtual = this.codexVirtual
    this.codexVirtual = undefined
    await virtual?.close()
  }

  private assertRemoteCompatible(remote: ConnectedRemote): void {
    const localRemoteGateway = this.gatewaySwitch.supportsCarrier()
    if (localRemoteGateway && remote.features.remoteGateway) {
      const localSessionGeneration = harnessSessionGeneration(this.host?.localHarnessVersion?.())
      const remoteSessionGeneration = remote.features.sessionFormat === 3 ? 'v3' : 'legacy'
      if (localSessionGeneration === remoteSessionGeneration) return
      throw new ClientModeError(
        'HARNESS_VERSION_INCOMPATIBLE',
        `The local and remote Harness Session formats differ (${localSessionGeneration} vs ${remoteSessionGeneration}).`,
      )
    }
    if (!localRemoteGateway && this.proxySwitch !== undefined && remote.features.apiProxy) return
    throw new ClientModeError(
      'HARNESS_VERSION_INCOMPATIBLE',
      localRemoteGateway
        ? 'The selected Host does not provide the Harness v0.1.2 Typert Remote Gateway transport.'
        : 'The selected Host does not provide the legacy Harness ApiProxy transport.',
    )
  }

  private async connect(targetDeviceId: string, signal?: AbortSignal): Promise<ConnectedRemote> {
    signal?.throwIfAborted()
    const progressRunId = this.connectionProgressRun + 1
    this.connectionProgressRun = progressRunId
    this.connectionProgress = { runId: progressRunId, targetDeviceId, phase: 'checking-host' }
    const identity = this.requireIdentity()
    let client: RemoteClientCore | undefined
    try {
      const serverDevice = (await this.server.listDevices()).find(device => device.deviceId === targetDeviceId)
      if (serverDevice === undefined) {
        throw new ClientModeError('MEMBERSHIP_REQUIRED', 'The selected Host is not authorized for this account.')
      }
      this.updateConnectionProgress(progressRunId, 'authorizing-peer')
      const target = await this.authorizeHostPeer(serverDevice)
      const presence = await this.server.presenceFor(targetDeviceId)
      if (!presence.online) throw new ClientModeError('HOST_OFFLINE', 'The selected Host is offline.', true)
      const credentials = await this.server.authenticate(identity)
      const rtcFactory = this.config.forceRelay
        ? undefined
        : await this.rtcFactoryProvider({ routeTargets: [this.server.baseUrl] }).catch(() => undefined)
      if (!this.config.forceRelay && rtcFactory === undefined) {
        this.logger.warn('remote Harness WebRTC backend unavailable; using relay', {
          targetDeviceId: shortId(target.deviceId),
        })
      }
      let webRtcFallback = false
      const createTransport = (attempt: TransportAttempt): AdaptiveTransport => new AdaptiveTransport(
        websocketUrl(this.server.baseUrl),
        {
          role: 'client',
          deviceId: identity.deviceId,
          accessToken: credentials.accessToken,
          targetDeviceId,
          forceRelay: this.config.forceRelay || attempt === 'relay',
          preferredTransports: preferredTransportsForAttempt(attempt),
          negotiateTimeoutMs: attempt === 'direct' ? DIRECT_WEBRTC_NEGOTIATE_TIMEOUT_MS : undefined,
          ...(rtcFactory === undefined || attempt === 'relay' ? {} : { rtcFactory }),
          fetchIceServers: async connectionId => iceServersForAttempt(attempt, await this.server.turnCredentials(connectionId)),
          onWebRtcFallback: (error, diagnostics) => {
            webRtcFallback = true
            this.logger.warn(attempt === 'direct'
              ? 'remote Harness direct WebRTC failed; trying TURN'
              : 'remote Harness TURN WebRTC failed; using relay', {
              targetDeviceId: shortId(target.deviceId),
              attempt,
              reason: diagnosticReason(error),
            })
            if (diagnostics !== undefined) {
              this.logger.debug('remote Harness WebRTC fallback diagnostics', {
                targetDeviceId: shortId(target.deviceId),
                attempt,
                ...webrtcDiagnosticsLogFields(diagnostics),
              })
            }
          },
        },
      )
      const attempts: TransportAttempt[] = this.config.forceRelay || rtcFactory === undefined
        ? ['relay']
        : ['direct', 'turn', 'relay']
      let transport: AdaptiveTransport | undefined
      for (const attempt of attempts) {
        webRtcFallback = false
        const stopProgressTimer = this.beginAttemptProgress(progressRunId, attempt)
        try {
          transport = createTransport(attempt)
          client = new RemoteClientCore(new ClientSecureTransport(transport, identity, target), 60_000)
          await client.connect()
          signal?.throwIfAborted()
        } finally {
          stopProgressTimer()
        }
        if (attempt === 'relay' || !webRtcFallback) break
        await client.close()
        client = undefined
        transport = undefined
        if (attempt === 'turn') {
          this.logger.info('remote Harness relay fallback re-established', {
            targetDeviceId: shortId(target.deviceId),
          })
        }
      }
      if (client === undefined || transport === undefined) {
        throw new ClientModeError('CONNECTION_FAILED', 'Unable to establish a remote transport.', true)
      }
      const connectedClient = client
      const connectedTransport = transport
      const connectedPreference = transportPreferenceForMode(connectedClient.getStats().mode)
      this.updateConnectionProgress(
        progressRunId,
        'connected',
        connectedPreference === undefined ? undefined : [connectedPreference],
      )
      connectedClient.onClose(() => {
        if (this.connected?.client !== connectedClient) return
        this.connected = undefined
        this.connectionProgress = undefined
        this.pendingWorkspaceSelection = undefined
        void this.closeCodexVirtual()
        this.proxySwitch?.selectLocal()
        this.gatewaySwitch.selectLocal()
        void connectedClient.close().catch(() => undefined)
        this.logger.warn('remote Harness transport closed; falling back to local mode', {
          targetDeviceId: shortId(target.deviceId),
        })
      })
      const connectionDetails = await connectedTransport.connectionDetails().catch(() => undefined)
      this.logger.info('remote Harness transport ready', {
        targetDeviceId: shortId(target.deviceId),
        transport: connectedClient.getStats().mode,
        ...(connectionDetails === undefined ? {} : {
          preferredTransports: connectionDetails.preferredTransports,
          negotiatedCapabilities: connectionDetails.negotiatedCapabilities,
          webRtcEnabled: connectionDetails.webRtcEnabled,
        }),
      })
      if (connectionDetails?.webRtc?.diagnostics !== undefined) {
        this.logger.debug('remote Harness transport diagnostics', {
          targetDeviceId: shortId(target.deviceId),
          ...webrtcDiagnosticsLogFields(connectionDetails.webRtc.diagnostics),
        })
      }
      const features = await probeRemoteHostFeatures(connectedClient, serverDevice.clientVersion)
      return {
        client: connectedClient,
        target,
        transport: connectedTransport,
        features,
        progressRunId,
        ...(serverDevice.clientVersion === undefined ? {} : { clientVersion: serverDevice.clientVersion }),
        ...(serverDevice.harnessVersion === undefined ? {} : { harnessVersion: serverDevice.harnessVersion }),
      }
    } catch (error) {
      this.clearConnectionProgress(progressRunId)
      await client?.close().catch(() => undefined)
      throw error
    }
  }

  private async ensureConnected(targetDeviceId: string, signal?: AbortSignal): Promise<ConnectedRemote> {
    if (this.connected?.target.deviceId === targetDeviceId) return this.connected
    const next = await this.connect(targetDeviceId, signal)
    const previous = this.connected
    this.connected = next
    this.clearConnectionProgress(next.progressRunId)
    await previous?.client.close().catch(() => undefined)
    return next
  }

  private beginAttemptProgress(runId: number, attempt: TransportAttempt): () => void {
    if (attempt !== 'direct') {
      this.updateConnectionProgress(runId, 'probing', [attempt])
      return () => undefined
    }
    this.updateConnectionProgress(runId, 'probing', ['lan'])
    // LAN and public P2P candidates are gathered inside one ICE attempt. The
    // linear Remote UI still needs a single active route, so advance the
    // visible cue if direct negotiation takes longer than a local probe.
    const timer = setTimeout(() => {
      if (this.connectionProgress?.runId === runId && this.connectionProgress.phase === 'probing') {
        this.updateConnectionProgress(runId, 'probing', ['p2p'])
      }
    }, DIRECT_LAN_PROGRESS_DISPLAY_MS)
    return () => clearTimeout(timer)
  }

  private updateConnectionProgress(
    runId: number,
    phase: ConnectionProgressState['phase'],
    activeTransports?: ConnectionProgressState['activeTransports'],
  ): void {
    if (this.connectionProgress?.runId !== runId) return
    this.connectionProgress = {
      runId,
      targetDeviceId: this.connectionProgress.targetDeviceId,
      phase,
      ...(activeTransports === undefined ? {} : { activeTransports }),
    }
  }

  private clearConnectionProgress(runId: number): void {
    if (this.connectionProgress?.runId === runId) this.connectionProgress = undefined
  }

  async handleControl(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> {
    try {
      if (endpoint === 'status') return ok(await this.detailedStatus())
      if (endpoint === 'devices') return ok(await this.devices())
      if (endpoint === 'client.account.login') {
        const value = record(payload)
        if (typeof value.email !== 'string' || typeof value.password !== 'string') {
          throw new ClientModeError('INVALID_MESSAGE', 'Email and password are required.')
        }
        return ok(await this.authorizeClientWithAccount(value.email, value.password))
      }
      if (endpoint === 'client.account.qr.start') {
        const value = record(payload)
        const provider = value.provider ?? 'zhihu'
        if (provider !== 'zhihu' && provider !== 'github') {
          throw new ClientModeError('INVALID_MESSAGE', 'A supported OAuth provider is required.')
        }
        return ok(await this.startClientOAuthQrLogin(provider))
      }
      if (endpoint === 'client.account.qr.poll') {
        const value = record(payload)
        if (typeof value.qrId !== 'string' || value.qrId.length < 20) {
          throw new ClientModeError('INVALID_MESSAGE', 'A QR login session is required.')
        }
        return ok(await this.pollClientOAuthQrLogin(value.qrId))
      }
      if (endpoint === 'directory.list') {
        const value = record(payload)
        if (typeof value.targetDeviceId !== 'string') throw new ClientModeError('INVALID_MESSAGE', 'A Host is required.')
        return ok(await this.listRemoteDirectory(
          value.targetDeviceId,
          typeof value.path === 'string' ? value.path : undefined,
          signal,
        ))
      }
      if (endpoint === 'workspaces.list') {
        const value = record(payload)
        if (typeof value.targetDeviceId !== 'string') throw new ClientModeError('INVALID_MESSAGE', 'A Host is required.')
        return ok(await this.listRemoteWorkspaces(value.targetDeviceId, signal))
      }
      if (endpoint === 'codex.workspaces.list') {
        const value = record(payload)
        if (typeof value.targetDeviceId !== 'string') throw new ClientModeError('INVALID_MESSAGE', 'A Host is required.')
        return ok(await this.listCodexWorkspaces(value.targetDeviceId, signal))
      }
      if (endpoint === 'workspace.open') {
        const value = record(payload)
        if (typeof value.targetDeviceId !== 'string' || typeof value.path !== 'string') {
          throw new ClientModeError('INVALID_MESSAGE', 'A Host and working directory are required.')
        }
        return ok(await this.openRemoteWorkspace(value.targetDeviceId, value.path, signal))
      }
      if (endpoint === 'codex.workspace.open') {
        const value = record(payload)
        if (typeof value.targetDeviceId !== 'string' || typeof value.workspaceId !== 'string') {
          throw new ClientModeError('INVALID_MESSAGE', 'A Host and CodeX Workspace are required.')
        }
        return ok(await this.openCodexWorkspace(value.targetDeviceId, value.workspaceId, signal))
      }
      if (endpoint === 'codex.workspace.create') {
        const value = record(payload)
        if (typeof value.targetDeviceId !== 'string' || typeof value.path !== 'string') {
          throw new ClientModeError('INVALID_MESSAGE', 'A Host and CodeX project directory are required.')
        }
        return ok(await this.createCodexWorkspace(value.targetDeviceId, value.path, signal))
      }
      if (endpoint === 'workspace.selection.consume') {
        const value = record(payload)
        if (typeof value.targetDeviceId !== 'string' || typeof value.workspaceId !== 'string') {
          throw new ClientModeError('INVALID_MESSAGE', 'A Host and Workspace are required.')
        }
        return ok(this.consumeWorkspaceSelection({
          targetDeviceId: value.targetDeviceId,
          workspaceId: value.workspaceId,
          ...(value.backend === 'codex' ? { backend: 'codex' } : {}),
          ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
        }))
      }
      if (endpoint === 'fileviewer.stat' || endpoint === 'fileviewer.readRange' || endpoint === 'fileviewer.list') {
        const method = endpoint === 'fileviewer.stat'
          ? 'stat'
          : endpoint === 'fileviewer.readRange' ? 'readRange' : 'list'
        return ok(await this.callRemoteFileViewer(method, payload, signal))
      }
      if (endpoint === 'codex.call') {
        const value = record(payload)
        if (typeof value.method !== 'string' || !('params' in value)) {
          throw new ClientModeError('INVALID_MESSAGE', 'A Codex method and params are required.')
        }
        const remote = this.activeCodexRemote()
        if (remote !== undefined) return ok(await new CodexRemoteClient(remote.client).request(value.method, value.params, signal))
        const host = this.requireLocalCodex()
        return ok(await host.codexCall(value, signal))
      }
      if (endpoint === 'codex.probe') {
        const local = this.localCodexAvailable()
        let remoteSupported = false
        const remote = this.activeRemote()
        if (remote !== undefined) {
          try {
            remote.features = await probeRemoteHostFeatures(remote.client, remote.clientVersion)
            remoteSupported = remote.features.codex
          } catch (error) {
            if (!local) throw error
          }
        }
        return ok({ supported: local || remoteSupported, local, remote: remoteSupported })
      }
      if (endpoint === 'codex.respond') {
        const value = record(payload)
        const remote = this.activeCodexRemote()
        if (remote !== undefined) return ok(await remote.client.rpc('codex.app.respond', value, signal))
        const host = this.requireLocalCodex()
        return ok(await host.codexRespond(value, signal))
      }
      if (endpoint === 'codex.stream.open') return ok(await this.openCodexStream(payload, signal))
      if (endpoint === 'codex.stream.next') return ok(await this.nextCodexFrames(payload, signal))
      if (endpoint === 'codex.stream.close') return ok(await this.closeCodexStream(payload))
      if (endpoint === 'host.account.login') {
        if (this.host === undefined) throw new ClientModeError('METHOD_NOT_ALLOWED', 'This plugin is not running as a Host.')
        const value = record(payload)
        if (typeof value.email !== 'string' || typeof value.password !== 'string') {
          throw new ClientModeError('INVALID_MESSAGE', 'Email and password are required.')
        }
        return ok(await this.host.authorizeHostWithAccount(value.email, value.password))
      }
      if (endpoint === 'host.authorization.set') {
        const value = record(payload)
        if (typeof value.enabled !== 'boolean') {
          throw new ClientModeError('INVALID_MESSAGE', 'Host authorization state is required.')
        }
        return ok(await this.setHostAuthorization(value.enabled))
      }
      if (endpoint === 'host.registration-code.submit') {
        if (this.host === undefined) throw new ClientModeError('METHOD_NOT_ALLOWED', 'This plugin is not running as a Host.')
        const value = record(payload)
        if (typeof value.code !== 'string' || value.code.trim() === '') {
          throw new ClientModeError('INVALID_MESSAGE', 'A Host registration code is required.')
        }
        return ok(await this.host.authorizeHostWithCode(value.code))
      }
      if (endpoint === 'mode.set') {
        const value = record(payload)
        if (value.mode !== 'local' && value.mode !== 'remote') throw new ClientModeError('INVALID_MESSAGE', 'Mode must be local or remote.')
        return ok(await this.setMode(value.mode, typeof value.targetDeviceId === 'string' ? value.targetDeviceId : undefined, signal))
      }
      throw new ClientModeError('METHOD_NOT_FOUND', 'The remote-mode control method does not exist.')
    } catch (error) {
      return fail(error)
    }
  }

  private requireIdentity(): HostIdentity {
    if (this.identity === undefined) throw new ClientModeError('IDENTITY_INVALID', 'The client identity is not ready.')
    return this.identity
  }

  private async authorizeHostPeer(serverDevice: ServerHostDevice): Promise<TrustedPeer> {
    const descriptor = await this.server.deviceFor(serverDevice.deviceId)
    assertAuthorizedHost(serverDevice, descriptor)
    const existing = this.identities.trustedPeer(descriptor.deviceId)
    if (existing !== undefined && existing.publicKey !== descriptor.identityKey) {
      throw new ClientModeError('PEER_IDENTITY_MISMATCH', 'The authorized Host identity key changed unexpectedly.')
    }
    if (existing !== undefined
      && existing.membershipId === descriptor.membershipId
      && existing.name === descriptor.name
      && existing.platform === descriptor.platform) {
      return existing
    }
    return this.identities.trustPeer({
      deviceId: descriptor.deviceId,
      name: descriptor.name,
      platform: descriptor.platform,
      publicKey: descriptor.identityKey,
      membershipId: descriptor.membershipId,
    })
  }
}

export class ClientModeError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) { super(message) }
}

function assertAuthorizedHost(listed: ServerHostDevice, descriptor: AuthorizedPeerDevice): void {
  if (descriptor.role !== 'host' || descriptor.deviceId !== listed.deviceId
    || descriptor.membershipId !== listed.membershipId) {
    throw new ClientModeError('PEER_IDENTITY_MISMATCH', 'Server Host details do not match the authorized device list.')
  }
}

function websocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/v1/connect`
  return url.toString()
}

function webrtcDiagnosticsLogFields(diagnostics: RtcConnectionDiagnostics | undefined): Record<string, unknown> {
  if (diagnostics === undefined) return {}
  return {
    rtcConnectionState: diagnostics.connectionState,
    rtcIceConnectionState: diagnostics.iceConnectionState,
    rtcIceGatheringState: diagnostics.iceGatheringState,
    rtcLocalCandidates: diagnostics.localCandidates,
    rtcRemoteCandidates: diagnostics.remoteCandidates,
    rtcCandidatePairs: diagnostics.candidatePairs,
    rtcFilteredLocalCandidates: diagnostics.filteredLocalCandidates,
    rtcFilteredCandidatePairs: diagnostics.filteredCandidatePairs,
    ...(diagnostics.selectedPath === undefined ? {} : { rtcSelectedPath: diagnostics.selectedPath }),
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ClientModeError('INVALID_MESSAGE', 'The control request payload is invalid.')
  }
  return value as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok(value: unknown): RpcResult<unknown> { return { ok: true, value } }

async function invokeRemoteCommand(
  client: RemoteClientCore,
  request: Parameters<TypertGatewayLike['invoke']>[0],
): Promise<unknown> {
  const rpcId = uuidV7()
  const response = await client.rpc<{ rpcId: string; result: unknown }>('harness.api.call', {
    method: `${request.namespace}.${request.method}`,
    rpcId,
    payload: request.args,
  }, request.signal)
  if (response.rpcId !== rpcId) {
    throw new ClientModeError('INVALID_MESSAGE', 'The remote Host returned an invalid command response.')
  }
  return unwrapNativeResult(response)
}

async function readRemoteWorkspaceBaseline(
  gateway: RemoteTypertGateway,
  signal?: AbortSignal,
): Promise<RemoteWorkspaceView[]> {
  const lifetime = new AbortController()
  const activeSignal = signal === undefined
    ? lifetime.signal
    : AbortSignal.any([signal, lifetime.signal])
  const source = await gateway.open('workspace/follow', { args: {} }, activeSignal)
  const iterator = source[Symbol.asyncIterator]()
  try {
    const first = await iterator.next()
    if (first.done || !isRecord(first.value) || first.value.type !== 'baseline'
      || !isRecord(first.value.value) || !Array.isArray(first.value.value.items)) {
      throw new ClientModeError('INVALID_MESSAGE', 'The remote Host returned an invalid Workspace baseline.')
    }
    return first.value.value.items.map((item: unknown) => {
      if (!isRecord(item) || typeof item.workspaceId !== 'string'
        || typeof item.path !== 'string' || typeof item.title !== 'string') {
        throw new ClientModeError('INVALID_MESSAGE', 'The remote Host returned an invalid Workspace row.')
      }
      return { workspaceId: item.workspaceId, path: item.path, title: item.title }
    })
  } finally {
    lifetime.abort('workspace-baseline-read')
    await iterator.return?.()
  }
}

function unwrapNativeResult<T>(response: { result: unknown }): T {
  const result = response.result
  if (typeof result !== 'object' || result === null || !('ok' in result)) {
    throw new ClientModeError('INVALID_MESSAGE', 'The remote Host returned an invalid response.')
  }
  if (result.ok !== true || !('value' in result)) {
    const message = 'error' in result && typeof result.error === 'object' && result.error !== null
      && 'message' in result.error && typeof result.error.message === 'string'
      ? result.error.message
      : 'The remote Host rejected the request.'
    throw new ClientModeError('REMOTE_API_ERROR', message)
  }
  return result.value as T
}

function workspaceRecordId(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('workspaceId' in value)
    || typeof value.workspaceId !== 'string' || value.workspaceId.length === 0) {
    throw new ClientModeError('INVALID_MESSAGE', 'The remote Host returned an invalid Workspace.')
  }
  return value.workspaceId
}

function remoteWorkspaceTitle(path: string): string {
  const normalized = path.replace(/[\\/]+$/u, '')
  return normalized.split(/[\\/]+/u).filter(Boolean).at(-1) ?? path
}

function fail(error: unknown): RpcResult<unknown> {
  const source = error instanceof Error ? error : undefined
  const remoteCode = source !== undefined && 'code' in source && typeof source.code === 'string'
    ? source.code
    : source instanceof ClientModeError ? source.code : undefined
  const retryable = source !== undefined && 'retryable' in source && typeof source.retryable === 'boolean'
    ? source.retryable
    : source instanceof ClientModeError ? source.retryable : false
  return {
    ok: false,
    error: {
      code: 'internal',
      message: source?.message ?? 'The remote-mode operation failed.',
      details: remoteCode === undefined ? {} : { remoteCode, retryable },
    },
  }
}

function shortId(value: string): string { return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}` }

/** Conservative feature profile for Hosts that predate fine-grained capability discovery. */
export function remoteHostFeatures(clientVersion?: string): RemoteHostFeatures {
  return {
    commandList: isVersionAtLeast(clientVersion, REMOTE_COMMAND_LIST_MIN_VERSION),
    fileViewer: isVersionAtLeast(clientVersion, REMOTE_FILE_VIEWER_MIN_VERSION),
    apiProxy: true,
    remoteGateway: false,
    codex: false,
  }
}

export async function probeRemoteHostFeatures(
  client: RemoteClientCore,
  clientVersion?: string,
): Promise<RemoteHostFeatures> {
  const fallback = remoteHostFeatures(clientVersion)
  let value: unknown
  try {
    value = await client.rpc('harness.transport.describe', {})
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'METHOD_NOT_FOUND') return fallback
    throw error
  }
  if (!isRecord(value) || !Array.isArray(value.capabilities)
    || value.capabilities.some(capability => typeof capability !== 'string')) {
    throw new ClientModeError('INVALID_MESSAGE', 'The remote Host returned invalid transport capabilities.')
  }
  const capabilities = new Set(value.capabilities as string[])
  const apiProxy = capabilities.has('harness.api.v1')
  const remoteV1 = capabilities.has('harness.remote.v1')
  const remoteV3 = capabilities.has('harness.remote.v3')
  if (remoteV1 && remoteV3) {
    throw new ClientModeError('INVALID_MESSAGE', 'The remote Host advertised conflicting Harness Session formats.')
  }
  const sessionFormat = remoteV3 ? 3 as const : undefined
  const remoteGateway = remoteV3 || remoteV1
  if (!apiProxy && !remoteGateway) {
    throw new ClientModeError('FEATURE_NOT_SUPPORTED', 'The remote Host exposes no supported Harness transport.')
  }
  return {
    commandList: remoteGateway || (apiProxy && fallback.commandList),
    fileViewer: capabilities.has('fileviewer.read.v1'),
    apiProxy,
    remoteGateway,
    ...(sessionFormat === undefined ? {} : { sessionFormat }),
    codex: capabilities.has('codex.appserver.v1'),
  }
}

async function waitForCodexFrames(stream: CodexLoopbackStream, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new ClientModeError('RPC_ABORTED', 'The Codex event poll was cancelled.')
  await new Promise<void>((resolve, reject) => {
    const previousWake = stream.wake
    const timer = setTimeout(done, 25_000)
    const onAbort = () => {
      cleanup()
      reject(new ClientModeError('RPC_ABORTED', 'The Codex event poll was cancelled.'))
    }
    function cleanup() {
      clearTimeout(timer)
      stream.wake = previousWake
      signal?.removeEventListener('abort', onAbort)
    }
    function done() {
      cleanup()
      resolve()
    }
    stream.wake = () => {
      previousWake()
      done()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function isVersionAtLeast(value: string | undefined, minimum: readonly [number, number, number]): boolean {
  const match = value?.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (match === undefined || match === null) return false
  const version = match.slice(1, 4).map(part => Number(part))
  for (let index = 0; index < minimum.length; index += 1) {
    const part = version[index] ?? 0
    const expected = minimum[index] ?? 0
    if (part > expected) return true
    if (part < expected) return false
  }
  return true
}

function diagnosticReason(error: Error): string {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  const message = error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 240)
  return code === undefined ? message : `${code}: ${message}`
}

function preferredTransportsForAttempt(attempt: TransportAttempt): Array<'lan' | 'p2p' | 'turn' | 'relay'> {
  if (attempt === 'direct') return ['lan', 'p2p', 'relay']
  if (attempt === 'turn') return ['turn', 'relay']
  return ['relay']
}

function transportPreferenceForMode(
  mode: 'LAN' | 'P2P' | 'TURN' | 'Relay' | 'Disconnected',
): 'lan' | 'p2p' | 'turn' | 'relay' | undefined {
  if (mode === 'LAN') return 'lan'
  if (mode === 'P2P') return 'p2p'
  if (mode === 'TURN') return 'turn'
  if (mode === 'Relay') return 'relay'
  return undefined
}

function iceServersForAttempt(attempt: TransportAttempt, iceServers: RtcIceServer[]): RtcIceServer[] {
  return attempt === 'direct' ? stunOnlyIceServers(iceServers) : iceServers
}
