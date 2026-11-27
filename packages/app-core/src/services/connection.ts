import { MEMBER_RELAY_UPLOAD_CAPABILITY } from '@dsh-remote/protocol'
import {
  WORKSPACE_GIT_CAPABILITY,
  ATTENTION_INBOX_CAPABILITY,
  ATTENTION_SIGNAL_CAPABILITY,
  DSH_WEB_CAPABILITY,
  DSH_WEB_LAN_CAPABILITY,
  DSH_WEB_LAN_IPV6_CAPABILITY,
  LAN_UPLOAD_CAPABILITY,
  PUSH_WAKE_CAPABILITY,
  RELAY_RESUME_CAPABILITY,
  TRANSPORT_UPGRADE_CAPABILITY,
  WEBRTC_RESUME_CAPABILITY,
  classifyControlClose,
  dshWebLanGrantSchema,
  sameLinkIpv6PairSchema,
  wireFromTransportTier,
} from '@dsh-remote/protocol'
import { LanUploadRoutes } from './lan-upload'
import { nativeWebSocketSender } from './native-websocket-binary'
import {
  AgentAcpClient,
  ClientLiveTransportUpgrader,
  CodexRemoteClient,
  HarnessAlphaClient,
  RemoteClientCore,
  RemoteTypertGateway,
  createAttentionRpcTransport,
  createRemoteAttentionClient,
  probeRemoteHostFeatures,
  remoteWorkspaceTypeAvailable,
  type RemoteAttentionClient,
  type RemoteHostFeatures,
} from '@dsh-remote/client-core'
import { AdaptiveTransport, type AdaptiveConnectionDetails, type RtcIceServer } from '@dsh-remote/webrtc'
import { websocketUrl } from '../lib/server-url'
import { registerAcpBackendId } from '../lib/session-backend'
import { connectionFailure, connectionLog } from './connection-log'
import { strings } from '../locales/i18n'
import type { ConnectionNetworkDetails, DeviceIdentity, MuxStreamFrame, RemoteDevice } from '../types'
import { AcpSessionTools, HarnessSessionTools, type SessionTools } from './session-tools'
import { SecureTransport } from './secure-transport'
import { nativeRtcFactory } from './native-rtc-binary'
import { BotRemoteClient } from './bot-catalog'
import { compactionStore } from './compaction-store'

function getIpv6Pair(path: NonNullable<ConnectionNetworkDetails['webRtc']>) {
  if (path.transport !== 'p2p' || path.remoteAddressScope !== 'public' || path.localAddressScope !== 'public'
    || path.remoteAddress === undefined || path.localAddress === undefined) return undefined
  const hostSeparator = path.remoteAddress.lastIndexOf(':')
  const peerSeparator = path.localAddress.lastIndexOf(':')
  const pair = sameLinkIpv6PairSchema.safeParse({
    hostAddress: path.remoteAddress.slice(0, hostSeparator),
    hostPort: Number(path.remoteAddress.slice(hostSeparator + 1)),
    peerAddress: path.localAddress.slice(0, peerSeparator),
    peerPort: Number(path.localAddress.slice(peerSeparator + 1)),
  })
  return pair.success ? pair.data : undefined
}

export type MuxFrameHandler = (frame: MuxStreamFrame) => void
export type CloseHandler = (options?: { retryable: boolean; lastTransport?: 'lan' | 'p2p' | 'turn' | 'relay' }) => void
type RemoteHarnessClient = HarnessAlphaClient

export interface AndroidConnectionOptions {
  onOpencodeArchived?: (sessionId: string) => void
  preferredTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>
  forceRelay?: boolean
  refreshAccessToken?: () => Promise<string>
  fetchIceServers?: (connectionId: string) => Promise<RtcIceServer[]>
  /** Allow in-band upgrade after initial direct negotiation has fallen back to Relay. */
  liveTransportUpgrade?: boolean
  onTransportUpgraded?: () => void
  onSecureHandshake?: () => void
  onWebRtcFallback?: () => void
  onClose?: CloseHandler
}

export class AndroidRemoteConnection {
  private compactHistorySupported = false
  private memberRelayUpload = false
  private binaryUploads = false
  private lanWeb = false
  private lanWebIpv6 = false
  private sameLinkIpv6Endpoints: readonly string[] = []
  private sameLinkIpv6PairProbe = false
  private dshWeb = false
  private lanUploads?: LanUploadRoutes
  private sessionEventsSupported = false
  private workspaceGitSupported = false
  private pluginRouteSupported = false
  private attentionInboxSupported = false
  private pushWakeSupported = false
  private attentionClient?: RemoteAttentionClient
  private core?: RemoteClientCore
  private proxy?: RemoteHarnessClient
  private codex?: CodexRemoteClient
  private cursor?: AgentAcpClient
  private acpBackends = new Set<string>()
  private codexAvailable = false
  private sessionTools?: HarnessSessionTools
  private closeMux?: (notifyRemote?: boolean) => Promise<void>
  private unsubscribeClose?: () => void
  private unsubscribeArchived?: () => void
  private muxHandler?: MuxFrameHandler
  private transport?: AdaptiveTransport
  private secureChannel?: SecureTransport
  private upgrader?: ClientLiveTransportUpgrader
  private connectionAttempt = 0
  private healthTimer?: ReturnType<typeof setTimeout>
  private healthFlight?: { core: RemoteClientCore; result: Promise<boolean> }
  /** Consecutive failed health probes for the active core; reset per carrier and on success. */
  private healthCheckFailures = 0

  async configureHistory(compact: boolean): Promise<void> {
    if (this.core !== undefined && this.compactHistorySupported) {
      await this.core.rpc('remote.history.configure', { compact })
    }
  }

  async connect(
    baseUrl: string,
    identity: DeviceIdentity,
    host: RemoteDevice,
    accessToken: string,
    onFrame: MuxFrameHandler,
    options: AndroidConnectionOptions = {},
  ): Promise<void> {
    // Replacing a connection must not wait for a graceful stream-close RPC:
    // the old data path may be exactly what is being recovered from.
    const attempt = ++this.connectionAttempt
    connectionLog('connect', { attempt, phase: 'starting', forceRelay: options.forceRelay === true })
    await this.clearConnection()
    if (attempt !== this.connectionAttempt) throw new Error('The connection attempt was superseded.')
    this.muxHandler = onFrame
    let webRtcFallback = false
    let retryableClose = true
    let lastTransport: 'lan' | 'p2p' | 'turn' | 'relay' | undefined
    const createTransport = () => new AdaptiveTransport(websocketUrl(baseUrl), {
      role: 'client',
      rtcFactory: nativeRtcFactory(),
      deviceId: identity.deviceId,
      accessToken,
      refreshAccessToken: options.refreshAccessToken,
      targetDeviceId: host.deviceId,
      capabilities: [
        WEBRTC_RESUME_CAPABILITY,
        RELAY_RESUME_CAPABILITY,
        'transport.lan',
        'transport.p2p',
        'transport.turn',
        'transport.relay',
        'transport.relay.attach',
        'harness.api.v1',
        ATTENTION_SIGNAL_CAPABILITY,
        PUSH_WAKE_CAPABILITY,
      ],
      forceRelay: options.forceRelay === true,
      preferredTransports: options.forceRelay
        ? ['relay']
        : options.preferredTransports ?? ['lan', 'p2p', 'turn', 'relay'],
      // TURN-only attempts may need extra time for relay allocation and TCP
      // fallback. Keep automatic hole punching on its shorter mobile budget.
      negotiateTimeoutMs: !options.forceRelay
        && options.preferredTransports?.includes('turn')
        && !options.preferredTransports.some(transport => transport === 'lan' || transport === 'p2p')
        ? 12_000
        : 6_000,
      iceServersTimeoutMs: 5_000,
      fetchIceServers: options.fetchIceServers,
      onDisconnect: event => {
        // Refused/replaced credentials, protocol errors and malformed frames
        // need manual recovery; do not automatically compete for ownership.
        const retryableControlClose = event.closeCode !== undefined
          && classifyControlClose(event.closeCode, event.closeReason).retryable
        retryableClose = event.reason !== 'invalid-control-frame'
          && !(event.closeCode !== undefined && !retryableControlClose && (event.closeCode >= 4000
            || [1002, 1003, 1007, 1008, 1009].includes(event.closeCode)))
        if (event.transport !== undefined) lastTransport = event.transport
        connectionLog('disconnect', { reason: event.reason, closeCode: event.closeCode, transport: event.transport })
      },
      onWebRtcFallback: (error, diagnostics) => {
        webRtcFallback = true
        options.onWebRtcFallback?.()
        // Do not include credentials, SDP, prompts, or tunnel payloads.
        connectionLog('fallback', { reason: connectionFailure(error),
          connectionState: diagnostics?.connectionState,
          iceConnectionState: diagnostics?.iceConnectionState,
          localCandidates: diagnostics?.localCandidates.byType,
          remoteCandidates: diagnostics?.remoteCandidates.byType,
        })
      },
      onWebRtcDiagnostic: event => {
        if (event.type !== 'selected-path') return
        // Selected-path telemetry contains candidate types and address scopes,
        // never the candidate IPs, SDP, credentials, or tunnel payloads.
        connectionLog('selected-path', { transport: event.selectedPath.mode, protocol: event.selectedPath.protocol, localCandidateType: event.selectedPath.localCandidateType, remoteCandidateType: event.selectedPath.remoteCandidateType, localCandidates: event.diagnostics.localCandidates.byType,
          remoteCandidates: event.diagnostics.remoteCandidates.byType })
      },
    })
    const rtcFactory = nativeRtcFactory()
    const wantDirectUpgrade = options.liveTransportUpgrade === true
      && !options.forceRelay
      && rtcFactory !== undefined
      && (options.preferredTransports ?? ['lan', 'p2p', 'turn', 'relay']).some(t => t !== 'relay')
    const connectCore = async () => {
      const transport = createTransport()
      this.transport = transport
      const secure = new SecureTransport(transport, identity, host, options.onSecureHandshake)
      this.secureChannel = secure
      // Host-side Typert calls are capped at 30s. Leave a small delivery
      // margin, then treat silence as an unhealthy business channel.
      const core = new RemoteClientCore(
        secure,
        35_000,
      )
      this.core = core
      // A fresh carrier has no health history: a failure counted on the
      // previous connection must not retire this one after a single probe.
      this.healthCheckFailures = 0
      this.unsubscribeClose = core.onClose(() => {
        // A late close from a replaced connection must not tear down the new
        // connection that may already be stored on this instance.
        if (this.core !== core) return
        this.clearHealthTimer()
        void this.upgrader?.close()
        this.upgrader = undefined
        this.secureChannel = undefined
        void this.lanUploads?.close()
        this.lanUploads = undefined
        void this.closeMux?.(false)
        this.closeMux = undefined
        this.core = undefined
        this.proxy = undefined
        this.codex = undefined
        this.sessionEventsSupported = false
        this.workspaceGitSupported = false
        this.attentionInboxSupported = false
        this.pushWakeSupported = false
        this.attentionClient = undefined
        this.codexAvailable = false
        this.cursor = undefined
        this.acpBackends.clear()
        this.sessionTools = undefined
        options.onClose?.({ retryable: retryableClose, ...(lastTransport !== undefined ? { lastTransport } : {}) })
      })
      await core.connect()
      if (attempt !== this.connectionAttempt || this.core !== core) throw new Error('The connection attempt was superseded.')
      return core
    }
    try {
      // A WebRTC fallback continues on the same connection id: the Host keeps
      // the tunnel alive and switches its data plane to Relay. Rebuilding a
      // second relay-only connection doubled every fallback into two full
      // handshakes and added 10s+ to mobile connections.
      const core = await connectCore()
      const initialDetails = typeof this.transport?.connectionDetails === 'function'
        ? await this.transport.connectionDetails().catch(() => undefined)
        : undefined
      this.pushWakeSupported = Array.isArray(initialDetails?.negotiatedCapabilities)
        && initialDetails.negotiatedCapabilities.includes(PUSH_WAKE_CAPABILITY)
      const features = await probeRemoteHostFeatures(core, host.clientVersion)
      if (attempt !== this.connectionAttempt || this.core !== core) throw new Error('The connection attempt was superseded.')
      // Only Relay fallback needs an in-band upgrade. Initial WebRTC legs use
      // unsequenced framing and must not enter the sequenced upgrade path.
      if (wantDirectUpgrade && rtcFactory !== undefined && this.secureChannel !== undefined
        && this.transport?.getStats().mode === 'Relay'
        && features.capabilities.includes(TRANSPORT_UPGRADE_CAPABILITY)) {
        const preferLan = (options.preferredTransports ?? ['lan']).includes('lan')
        const upgrader = new ClientLiveTransportUpgrader({
          connectionId: this.transport!.connectionInfo().connectionId,
          rpc: core,
          channel: this.secureChannel,
          rtcFactory,
          fetchIceServers: options.fetchIceServers,
          negotiateTimeoutMs: 6_000,
          onUpgraded: mode => {
            lastTransport = wireFromTransportTier(mode)
            options.onTransportUpgraded?.()
          },
          onTelemetry: t => {
            connectionLog('transport-upgrade', {
              from: t.from,
              to: t.to,
              outcome: t.outcome,
              durationMs: t.durationMs,
              relaySentBytes: t.relayBytesAtOutcome?.sent,
              relayReceivedBytes: t.relayBytesAtOutcome?.received,
              errorName: t.reason,
            })
          },
        })
        this.upgrader = upgrader
        void upgrader.promote({ preferLan })
      }
      const emitFrame = (frame: MuxStreamFrame) => {
        if (this.core !== core) return
        if (frame.payload.type === 'stream/closed' && frame.payload.reason === 'failed') {
          connectionLog('stream-failed')
          // A live carrier failure is an offline channel, even if its socket
          // still answers. Reconnect will create a fresh follow subscription.
          void this.close()
          options.onClose?.()
          return
        }
        this.muxHandler?.(frame)
      }
      this.compactHistorySupported = features.capabilities.includes('remote.history.compact.v1')
      this.memberRelayUpload = features.capabilities.includes(MEMBER_RELAY_UPLOAD_CAPABILITY)
      this.binaryUploads = features.capabilities.includes('workspace.upload.v1') && features.capabilities.includes('workspace.upload.binary.v1')
      const sender = this.binaryUploads && features.capabilities.includes(LAN_UPLOAD_CAPABILITY) ? nativeWebSocketSender() : undefined
      const carrier = this.transport
      if(sender && carrier) this.lanUploads = new LanUploadRoutes({
        control: core, identity, host, sender,
        current: () => this.core === core && this.transport === carrier,
        mode: () => this.getStats()?.mode ?? carrier.getStats().mode,
        details: () => this.getNetworkDetails(),
        connectionId: () => carrier.connectionInfo().connectionId,
      })
      this.applyBackendFeatures(core, features)
      this.unsubscribeArchived = this.cursor?.onSessionArchived(data => {
        if (this.core === core) options.onOpencodeArchived?.(data.sessionId)
      })
      if (features.remoteGateway) {
        this.sessionTools = new HarnessSessionTools(new RemoteTypertGateway(core))
        const alpha = new HarnessAlphaClient(
          core,
          {
            clientVersion: host.clientVersion,
            harnessVersion: host.harnessVersion,
            capabilities: features.capabilities,
            ...(features.sessionFormat === undefined ? {} : { sessionFormat: features.sessionFormat }),
          },
          frame => emitFrame(frame as unknown as MuxStreamFrame),
          { store: compactionStore, scope: host.deviceId },
        )
        alpha.start()
        // Reconcile attempts persisted before the disconnect. This only queries
        // the Host; it never submits a new compaction.
        void alpha.resumeCompactions().catch(() => undefined)
        this.proxy = alpha
        this.closeMux = async (notifyRemote = true) => { await alpha.close(notifyRemote) }
      } else {
        throw new Error('The remote Host exposes no supported Harness transport.')
      }
      this.scheduleHealthCheck(core)
      connectionLog('connect', { attempt, phase: 'ready' })
    } catch (error) {
      connectionLog('connect', { attempt, phase: 'failed', reason: connectionFailure(error) })
      if (attempt === this.connectionAttempt) await this.clearConnection()
      throw error
    }
  }

  /** Reprobe readiness on workspace refresh so Host backend switches need no reconnect. */
  async refreshBackends(): Promise<void> {
    if (this.core === undefined) throw new Error(strings.runtime.connectHostFirst)
    const core = this.core
    const features = await probeRemoteHostFeatures(core)
    if (this.core !== core) return
    this.applyBackendFeatures(core, features)
  }

  private applyBackendFeatures(core: RemoteClientCore, features: RemoteHostFeatures): void {
    this.sessionEventsSupported = features.sessionEvents
    this.workspaceGitSupported = features.capabilities.includes(WORKSPACE_GIT_CAPABILITY)
    this.pluginRouteSupported = features.pluginRoute
    this.lanWeb = features.capabilities.includes(DSH_WEB_LAN_CAPABILITY)
    this.lanWebIpv6 = features.capabilities.includes(DSH_WEB_LAN_IPV6_CAPABILITY)
    this.sameLinkIpv6Endpoints = features.sameLinkIpv6Endpoints?.map(endpoint => endpoint.toLowerCase()) ?? []
    this.sameLinkIpv6PairProbe = features.sameLinkIpv6PairProbe === true
    this.attentionInboxSupported = features.capabilities.includes(ATTENTION_INBOX_CAPABILITY)
    this.attentionClient = createRemoteAttentionClient(createAttentionRpcTransport(core))
    this.dshWeb = features.capabilities.includes(DSH_WEB_CAPABILITY)
    this.codexAvailable = features.capabilities.includes('codex.appserver.transfer.v1')
      && remoteWorkspaceTypeAvailable(features.capabilities, features.workspaceTypes, 'codex', 'codex.appserver.v1')
    if (this.codexAvailable) this.codex ??= new CodexRemoteClient(core, true)
    this.acpBackends.clear()
    const candidateBackends = new Set<string>(['cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes', 'kimi'])
    for (const wt of features.workspaceTypes ?? []) {
      if (wt.id !== 'codex' && wt.id !== 'harness') candidateBackends.add(wt.id)
    }
    for (const backend of candidateBackends) {
      if (remoteWorkspaceTypeAvailable(features.capabilities, features.workspaceTypes, backend, `agent.acp.${backend}.v1`)) {
        this.acpBackends.add(backend)
        registerAcpBackendId(backend)
      }
    }
    this.cursor = this.acpBackends.size > 0 ? new AgentAcpClient(core, features.capabilities) : undefined
  }

  /** Harness business client; only available while connected. */
  requireProxy(): RemoteHarnessClient {
    if (this.proxy === undefined) throw new Error(strings.runtime.connectHostFirst)
    return this.proxy
  }

  /**
   * Read an existing session attachment through its native carrier; never accept
   * a filesystem path. 0.2.2 Hosts require the full image reference (id, media
   * type, byte length and dimensions are verified), while older Hosts only know
   * the durable id. Always carry that id: a 0.2.2 Host can recover the verified
   * reference from session events even when only partial fields are available.
   */
  async readSessionImageAttachment(
    sessionId: string,
    attachment: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const core = this.core
    const proxy = this.requireProxy()
    if (core === undefined) throw new Error(strings.runtime.connectHostFirst)
    const attachmentId = typeof attachment.attachmentId === 'string' ? attachment.attachmentId : undefined
    if (attachmentId === undefined) throw new Error(strings.common.unavailable)
    const fullReference = typeof attachment.mediaType === 'string' && typeof attachment.bytes === 'number'
      && typeof attachment.width === 'number' && typeof attachment.height === 'number'
    const request: Record<string, unknown> = { sessionId, attachmentId }
    if (fullReference) request.attachment = attachment
    const value = await new RemoteTypertGateway(core).call<unknown>('session/attachment', {
      args: { request },
    }, signal, { maxResponseBytes: 12 * 1024 * 1024 })
    if (this.core !== core || this.proxy !== proxy || signal.aborted) throw new Error(strings.runtime.connectHostFirst)
    // Typert versions may preserve the official business Result inside the carrier result.
    if (typeof value === 'object' && value !== null && 'ok' in value) {
      if (value.ok === true && 'value' in value) return value.value
      throw new Error(strings.common.unavailable)
    }
    return value
  }

  requireBotClient(): BotRemoteClient {
    const core = this.core
    const proxy = this.proxy
    if (core === undefined || proxy === undefined) throw new Error(strings.runtime.connectHostFirst)
    if (!this.pluginRouteSupported) throw new Error(strings.bots.unsupported)
    const current = () => {
      if (this.core !== core || this.proxy !== proxy) throw new Error(strings.runtime.connectHostFirst)
      if (!this.pluginRouteSupported) throw new Error(strings.bots.unsupported)
    }
    return new BotRemoteClient(
      (body, signal) => { current(); return core.rpc('plugin.route.call', { route: 'api/bot', body }, signal) },
      () => { current(); return proxy.sessionList() },
      current,
    )
  }

  openLanWeb(onFailure: () => void) {
    const core = this.core
    if (!core || !this.lanWeb) return undefined
    const mode = core.getStats().mode
    if (mode !== 'LAN' && (mode !== 'P2P' || !this.lanWebIpv6)) return undefined
    return (async () => {
      const path = mode === 'P2P' ? (await this.getNetworkDetails())?.webRtc : undefined
      const pair = path && getIpv6Pair(path)
      if (this.core !== core || core.getStats().mode !== mode || (mode === 'P2P' && !pair)) {
        throw Object.assign(new Error('LAN Web is unavailable.'), { code: 'FEATURE_NOT_SUPPORTED' })
      }
      const result = await core.rpc('dsh.web.lan.direct.open', pair ? { sameLinkIpv6Pair: pair } : {})
      const grant = dshWebLanGrantSchema.parse(result)
      const close = async () => {
        await core.rpc('dsh.web.lan.direct.close', { sessionId: grant.sessionId }).catch(() => undefined)
      }
      const hostname = new URL(grant.url).hostname
      const matchesHost = pair ? hostname === new URL(`http://[${pair.hostAddress}]`).hostname : !hostname.startsWith('[')
      if (this.core !== core || core.getStats().mode !== mode || !matchesHost || grant.expiresAt <= Date.now()) {
        await close()
        throw new Error('LAN Web session expired')
      }
      const unsubscribe = core.onClose(onFailure)
      return { ...grant, close: async () => { unsubscribe(); await close() } }
    })()
  }

  supportsDshWeb(): boolean {
    const mode = this.getStats()?.mode
    return this.core !== undefined && (this.dshWeb || (this.lanWeb && (mode === 'LAN' || (this.lanWebIpv6 && mode === 'P2P'))))
  }

  supportsDshWebTunnel(): boolean { return this.core !== undefined && this.dshWeb }

  supportsBinaryUpload(): boolean { return this.core !== undefined && this.binaryUploads }

  supportsPushWake(): boolean { return this.core !== undefined && this.pushWakeSupported }

  hasAttentionInbox(): boolean { return this.core !== undefined && this.attentionInboxSupported }

  getAttentionClient(): RemoteAttentionClient | undefined { return this.core !== undefined ? this.attentionClient : undefined }

  async rpc<T = unknown>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    if (this.core === undefined) throw new Error(strings.runtime.connectHostFirst)
    return this.lanUploads ? this.lanUploads.rpc<T>(method, params, signal) : this.core.rpc<T>(method, params, signal)
  }

  /** Optional CodeX business client; available only when the Host advertises both domain capabilities. */
  requireCodex(): CodexRemoteClient {
    if (this.codex === undefined || !this.codexAvailable) throw new Error(strings.runtime.codexUnavailable)
    return this.codex
  }

  requireSessionTools(sessionId?: string): SessionTools {
    for (const backend of this.acpBackends) {
      if (sessionId?.startsWith(`${backend}:`) && this.cursor !== undefined) {
        return new AcpSessionTools(this.cursor, backend)
      }
    }
    if (this.sessionTools === undefined) throw Object.assign(new Error('Native session tools require a compatible Host.'), { code: 'FEATURE_NOT_SUPPORTED' })
    return this.sessionTools
  }

  acpBackendIds(): string[] {
    return [...this.acpBackends]
  }

  customAcpBackends(): string[] {
    return [...this.acpBackends].filter(id => !['cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes', 'kimi'].includes(id))
  }

  hasAcpBackend(backend: string): boolean {
    return this.cursor !== undefined && this.acpBackends.has(backend)
  }

  requireAcpBackend(backend: string): AgentAcpClient {
    if (this.cursor === undefined || !this.acpBackends.has(backend)) {
      const messages: Record<string, string> = {
        claude: strings.runtime.claudeUnavailable,
        hermes: strings.runtime.hermesUnavailable,
        kimi: strings.runtime.kimiUnavailable,
        opencode: strings.runtime.opencodeUnavailable,
        pi: strings.runtime.piUnavailable,
        antigravity: strings.runtime.antigravityUnavailable,
        cursor: strings.runtime.cursorUnavailable,
      }
      throw new Error(messages[backend] ?? strings.runtime.cursorUnavailable)
    }
    return this.cursor
  }

  hasSessionEvents(): boolean {
    return this.sessionEventsSupported
  }

  hasWorkspaceGit(): boolean {
    return this.workspaceGitSupported
  }

  hasCodex(): boolean {
    return this.codex !== undefined && this.codexAvailable
  }

  /** Optional Agent ACP client (Cursor UI backend); available when the Host advertises agent.acp.cursor.v1. */
  requireCursor(): AgentAcpClient {
    if (this.cursor === undefined || !this.acpBackends.has('cursor')) throw new Error(strings.runtime.cursorUnavailable)
    return this.cursor
  }

  hasCursor(): boolean {
    return this.cursor !== undefined && this.acpBackends.has('cursor')
  }

  /** Optional Agent ACP client (Antigravity UI backend); available when the Host advertises agent.acp.antigravity.v1. */
  requireAntigravity(): AgentAcpClient {
    if (this.cursor === undefined || !this.acpBackends.has('antigravity')) throw new Error(strings.runtime.antigravityUnavailable)
    return this.cursor
  }

  hasAntigravity(): boolean {
    return this.cursor !== undefined && this.acpBackends.has('antigravity')
  }

  requirePi(): AgentAcpClient {
    if (this.cursor === undefined || !this.acpBackends.has('pi')) throw new Error(strings.runtime.piUnavailable)
    return this.cursor
  }

  hasPi(): boolean {
    return this.cursor !== undefined && this.acpBackends.has('pi')
  }

  /** Optional Agent ACP client (OpenCode UI backend); available when the Host advertises agent.acp.opencode.v1. */
  requireOpencode(): AgentAcpClient {
    if (this.cursor === undefined || !this.acpBackends.has('opencode')) throw new Error(strings.runtime.opencodeUnavailable)
    return this.cursor
  }

  hasOpencode(): boolean {
    return this.cursor !== undefined && this.acpBackends.has('opencode')
  }

  requireClaude(): AgentAcpClient {
    if (this.cursor === undefined || !this.acpBackends.has('claude')) throw new Error(strings.runtime.claudeUnavailable)
    return this.cursor
  }

  hasClaude(): boolean {
    return this.cursor !== undefined && this.acpBackends.has('claude')
  }

  /** Optional Agent ACP client (Hermes Agent UI backend); available when the Host advertises agent.acp.hermes.v1. */
  requireHermes(): AgentAcpClient {
    if (this.cursor === undefined || !this.acpBackends.has('hermes')) throw new Error(strings.runtime.hermesUnavailable)
    return this.cursor
  }

  hasHermes(): boolean {
    return this.cursor !== undefined && this.acpBackends.has('hermes')
  }

  /** Optional Agent ACP client (Kimi Code UI backend); available when the Host advertises agent.acp.kimi.v1. */
  requireKimi(): AgentAcpClient {
    if (this.cursor === undefined || !this.acpBackends.has('kimi')) throw new Error(strings.runtime.kimiUnavailable)
    return this.cursor
  }

  hasKimi(): boolean {
    return this.cursor !== undefined && this.acpBackends.has('kimi')
  }

  getStats() {
    const stats = this.core?.getStats()
    return stats && this.memberRelayUpload ? { ...stats, memberRelayUpload: true } : stats
  }

  /** A locally open socket can be half-open after Android suspends networking. */
  checkHealth(): Promise<boolean> {
    const core = this.core
    if (core === undefined || !core.getStats().connected) return Promise.resolve(false)
    if (this.healthFlight?.core === core) return this.healthFlight.result
    const result = this.probeHealth(core)
    this.healthFlight = { core, result }
    void result.finally(() => {
      if (this.healthFlight?.result === result) this.healthFlight = undefined
    })
    return result
  }

  private async probeHealth(core: RemoteClientCore): Promise<boolean> {
    try {
      // Existing authenticated, encrypted capability RPC; no new wire heartbeat.
      await core.rpc('harness.transport.describe', {}, undefined, { timeoutMs: 5_000 })
      return this.core === core
    } catch {
      return false
    }
  }

  private scheduleHealthCheck(core: RemoteClientCore, delayMs = 25_000): void {
    this.clearHealthTimer()
    this.healthTimer = setTimeout(() => {
      this.healthTimer = undefined
      if (this.core !== core) return
      void this.checkHealth().then(healthy => {
        if (this.core !== core) return
        if (healthy) {
          this.healthCheckFailures = 0
          this.scheduleHealthCheck(core)
          return
        }
        // A single slow probe (congested relay, brief radio gap) must not kill
        // a carrier that still delivers: every forced close sends the user
        // through a full reconnect + session history catch-up before live
        // streaming resumes. Confirm with one fast retry first.
        this.healthCheckFailures += 1
        if (this.healthCheckFailures >= 2) {
          connectionLog('health-failed', { phase: 'closed' })
          // close() on the core publishes the same offline/recovery transition
          // as a socket close, including when the OS never delivered onclose.
          void core.close().catch(() => undefined)
        } else {
          connectionLog('health-failed', { phase: 'checking' })
          this.scheduleHealthCheck(core, 5_000)
        }
      })
    }, delayMs)
  }

  private clearHealthTimer(): void {
    if (this.healthTimer !== undefined) clearTimeout(this.healthTimer)
    this.healthTimer = undefined
  }

  promoteTransport(options?: { preferLan?: boolean }): Promise<boolean> {
    return this.upgrader?.promote(options) ?? Promise.resolve(false)
  }

  async getNetworkDetails(): Promise<ConnectionNetworkDetails | undefined> {
    const core = this.core
    const base = await this.transport?.connectionDetails()
    const upgraded = await this.upgrader?.connectionDetails()
    if (base === undefined || this.core !== core) return undefined
    const details = upgraded === undefined ? base : { ...base, webRtcEnabled: true, webRtc: upgraded }
    const path = details.webRtc
    if (core?.getStats().mode === 'P2P' && path?.transport === 'p2p'
        && path.remoteAddressScope === 'public' && path.remoteAddress !== undefined) {
      const hostEndpoint = path.remoteAddress.toLowerCase()
      if (this.sameLinkIpv6Endpoints.includes(hostEndpoint)) return { ...details, sameLinkIpv6: true }
      if (this.sameLinkIpv6PairProbe && path.localAddressScope === 'public' && path.localAddress !== undefined) {
        const pair = getIpv6Pair(path)
        if (pair) {
          const reply = await core.rpc<{ sameLinkIpv6Endpoints?: string[] }>('harness.transport.describe',
            { sameLinkIpv6Pair: pair }, undefined, { timeoutMs: 2_500 }).catch(() => undefined)
          if (this.core !== core) return undefined
          if (core.getStats().mode === 'P2P' && Array.isArray(reply?.sameLinkIpv6Endpoints)
              && reply.sameLinkIpv6Endpoints.includes(hostEndpoint)) return { ...details, sameLinkIpv6: true }
        }
      }
    }
    return details
  }

  async close(): Promise<void> {
    ++this.connectionAttempt
    await this.clearConnection()
  }

  private async clearConnection(): Promise<void> {
    this.clearHealthTimer()
    this.muxHandler = undefined
    const mux = this.closeMux
    this.closeMux = undefined
    const core = this.core
    this.core = undefined
    this.sameLinkIpv6Endpoints = []
    this.sameLinkIpv6PairProbe = false
    this.lanWebIpv6 = false
    this.memberRelayUpload = false
    this.binaryUploads = false
    const upgrader = this.upgrader
    this.upgrader = undefined
    this.secureChannel = undefined
    await upgrader?.close()
    const lanUploads = this.lanUploads
    this.lanUploads = undefined
    await lanUploads?.close()
    // Closing the whole transport makes a remote stream-close redundant.
    // Only remove the local subscription here so a half-open RTC path cannot
    // add another RPC timeout before recovery begins.
    this.unsubscribeClose?.()
    this.unsubscribeClose = undefined
    this.unsubscribeArchived?.()
    this.unsubscribeArchived = undefined
    this.transport = undefined
    this.proxy = undefined
    this.codex = undefined
    this.codexAvailable = false
    this.workspaceGitSupported = false
    this.attentionInboxSupported = false
    this.pushWakeSupported = false
    this.attentionClient = undefined
    this.cursor = undefined
    this.acpBackends.clear()
    this.sessionTools = undefined
    if (mux !== undefined) await mux(false).catch(() => undefined)
    if (core !== undefined) await core.close()
  }
}
