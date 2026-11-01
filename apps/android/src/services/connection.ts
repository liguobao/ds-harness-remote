import { AgentAcpClient, CodexRemoteClient, HarnessAlphaClient, RemoteClientCore, RemoteTypertGateway, probeRemoteHostFeatures, remoteWorkspaceTypeAvailable, type RemoteHostFeatures } from '@dsh-remote/client-core'
import { AdaptiveTransport, type AdaptiveConnectionDetails, type RtcIceServer } from '@dsh-remote/webrtc'
import { websocketUrl } from '../lib/server-url'
import { strings } from '../locales/i18n'
import type { DeviceIdentity, MuxStreamFrame, RemoteDevice } from '../types'
import { AcpSessionTools, HarnessSessionTools, type SessionTools } from './session-tools'
import { SecureTransport } from './secure-transport'
import { BotRemoteClient } from './bot-catalog'

export type MuxFrameHandler = (frame: MuxStreamFrame) => void
export type CloseHandler = (options?: { retryable: boolean }) => void
type RemoteHarnessClient = HarnessAlphaClient

export interface AndroidConnectionOptions {
  onOpencodeArchived?: (sessionId: string) => void
  preferredTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>
  forceRelay?: boolean
  fetchIceServers?: (connectionId: string) => Promise<RtcIceServer[]>
  onSecureHandshake?: () => void
  onClose?: CloseHandler
}

export class AndroidRemoteConnection {
  private compactHistorySupported = false
  private pluginRouteSupported = false
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
  private connectionAttempt = 0
  private healthTimer?: ReturnType<typeof setTimeout>
  private healthFlight?: { core: RemoteClientCore; result: Promise<boolean> }

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
    await this.clearConnection()
    if (attempt !== this.connectionAttempt) throw new Error('The connection attempt was superseded.')
    this.muxHandler = onFrame
    let webRtcFallback = false
    let replacingFallback = false
    let retryableClose = true
    const createTransport = (relayOnly: boolean) => new AdaptiveTransport(websocketUrl(baseUrl), {
      role: 'client',
      deviceId: identity.deviceId,
      accessToken,
      targetDeviceId: host.deviceId,
      forceRelay: options.forceRelay || relayOnly,
      preferredTransports: options.forceRelay || relayOnly
        ? ['relay']
        : options.preferredTransports ?? ['lan', 'p2p', 'turn', 'relay'],
      fetchIceServers: options.fetchIceServers,
      onDisconnect: event => {
        // Refused/replaced credentials, protocol errors and malformed frames
        // need manual recovery; do not automatically compete for ownership.
        retryableClose = event.reason !== 'invalid-control-frame'
          && !(event.closeCode !== undefined && (event.closeCode >= 4000
            || [1002, 1003, 1007, 1008, 1009].includes(event.closeCode)))
        console.warn('[dsh-remote] Carrier closed:', JSON.stringify(event))
      },
      onWebRtcFallback: error => {
        webRtcFallback = true
        // Do not include credentials, SDP, prompts, or tunnel payloads.
        console.warn('[dsh-remote] WebRTC fallback:', error.message)
      },
      onWebRtcDiagnostic: event => {
        if (event.type !== 'selected-path') return
        // Selected-path telemetry contains candidate types and address scopes,
        // never the candidate IPs, SDP, credentials, or tunnel payloads.
        console.info('[dsh-remote] WebRTC selected path:', JSON.stringify({
          ...event.selectedPath,
          signaledRemoteCandidates: {
            total: event.diagnostics.remoteCandidates.total,
            byType: event.diagnostics.remoteCandidates.byType,
            byScope: event.diagnostics.remoteCandidates.byScope,
          },
        }))
      },
    })
    const connectCore = async (relayOnly: boolean) => {
      const transport = createTransport(relayOnly)
      this.transport = transport
      // Host-side Typert calls are capped at 30s. Leave a small delivery
      // margin, then treat silence as an unhealthy business channel.
      const core = new RemoteClientCore(
        new SecureTransport(transport, identity, host, options.onSecureHandshake),
        35_000,
      )
      this.core = core
      this.unsubscribeClose = core.onClose(() => {
        // A late close from a replaced connection must not tear down the new
        // connection that may already be stored on this instance.
        if (this.core !== core) return
        this.clearHealthTimer()
        void this.closeMux?.(false)
        this.closeMux = undefined
        this.core = undefined
        this.proxy = undefined
        this.codex = undefined
        this.codexAvailable = false
        this.cursor = undefined
        this.acpBackends.clear()
        this.sessionTools = undefined
        if (!replacingFallback) options.onClose?.({ retryable: retryableClose })
      })
      await core.connect()
      if (attempt !== this.connectionAttempt || this.core !== core) throw new Error('The connection attempt was superseded.')
      return core
    }
    try {
      let core = await connectCore(false)
      // Mirror the Desktop plugin: Hosts that accepted a WebRTC offer before
      // the client fell back can later close that logical Relay connection.
      // A new relay-only connection ID prevents that stale RTC state leaking
      // into the working fallback channel.
      if (webRtcFallback) {
        replacingFallback = true
        await core.close()
        this.unsubscribeClose?.()
        this.unsubscribeClose = undefined
        this.core = undefined
        replacingFallback = false
        webRtcFallback = false
        core = await connectCore(true)
      }
      const features = await probeRemoteHostFeatures(core, host.clientVersion)
      if (attempt !== this.connectionAttempt || this.core !== core) throw new Error('The connection attempt was superseded.')
      const emitFrame = (frame: MuxStreamFrame) => {
        if (this.core !== core) return
        if (frame.payload.type === 'stream/closed' && frame.payload.reason === 'failed') {
          console.warn('[dsh-remote] Harness stream failed; closing carrier')
          // A live carrier failure is an offline channel, even if its socket
          // still answers. Reconnect will create a fresh follow subscription.
          void this.close()
          options.onClose?.()
          return
        }
        this.muxHandler?.(frame)
      }
      this.compactHistorySupported = features.capabilities.includes('remote.history.compact.v1')
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
            ...(features.sessionFormat === undefined ? {} : { sessionFormat: features.sessionFormat }),
          },
          frame => emitFrame(frame as unknown as MuxStreamFrame),
        )
        alpha.start()
        this.proxy = alpha
        this.closeMux = async (notifyRemote = true) => { await alpha.close(notifyRemote) }
      } else {
        throw new Error('The remote Host exposes no supported Harness transport.')
      }
      this.scheduleHealthCheck(core)
    } catch (error) {
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
    this.pluginRouteSupported = features.pluginRoute
    this.codexAvailable = features.capabilities.includes('codex.appserver.transfer.v1')
      && remoteWorkspaceTypeAvailable(features.capabilities, features.workspaceTypes, 'codex', 'codex.appserver.v1')
    if (this.codexAvailable) this.codex ??= new CodexRemoteClient(core, true)
    this.acpBackends.clear()
    for (const backend of ['cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes'] as const) {
      if (remoteWorkspaceTypeAvailable(features.capabilities, features.workspaceTypes, backend, `agent.acp.${backend}.v1`)) {
        this.acpBackends.add(backend)
      }
    }
    if (this.acpBackends.size > 0) this.cursor ??= new AgentAcpClient(core, features.capabilities)
  }

  /** Harness business client; only available while connected. */
  requireProxy(): RemoteHarnessClient {
    if (this.proxy === undefined) throw new Error(strings.runtime.connectHostFirst)
    return this.proxy
  }

  /** Read an existing session reference through its native carrier; never accept a filesystem path. */
  async readSessionImageAttachment(sessionId: string, attachmentId: string, signal: AbortSignal): Promise<unknown> {
    const core = this.core
    const proxy = this.requireProxy()
    if (core === undefined) throw new Error(strings.runtime.connectHostFirst)
    const value = await new RemoteTypertGateway(core).call<unknown>('session/attachment', {
      args: { request: { sessionId, attachmentId } },
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

  /** Optional CodeX business client; available only when the Host advertises both domain capabilities. */
  requireCodex(): CodexRemoteClient {
    if (this.codex === undefined || !this.codexAvailable) throw new Error(strings.runtime.codexUnavailable)
    return this.codex
  }

  requireSessionTools(sessionId?: string): SessionTools {
    if (sessionId?.startsWith('cursor:') && this.cursor !== undefined) return new AcpSessionTools(this.cursor, 'cursor')
    if (sessionId?.startsWith('pi:')) return new AcpSessionTools(this.requirePi(), 'pi')
    if (sessionId?.startsWith('antigravity:') && this.cursor !== undefined) return new AcpSessionTools(this.cursor, 'antigravity')
    if (sessionId?.startsWith('claude:')) throw new Error('Claude workspace tools are not available.')
    if (sessionId?.startsWith('hermes:')) throw new Error('Hermes workspace tools are not available.')
    if (sessionId?.startsWith('opencode:') && this.cursor !== undefined) return new AcpSessionTools(this.cursor, 'opencode')
    if (this.sessionTools === undefined) throw Object.assign(new Error('Native session tools require a compatible Host.'), { code: 'FEATURE_NOT_SUPPORTED' })
    return this.sessionTools
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

  getStats() {
    return this.core?.getStats()
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

  private scheduleHealthCheck(core: RemoteClientCore): void {
    this.clearHealthTimer()
    this.healthTimer = setTimeout(() => {
      this.healthTimer = undefined
      if (this.core !== core) return
      void this.checkHealth().then(healthy => {
        if (this.core !== core) return
        if (healthy) this.scheduleHealthCheck(core)
        else {
          console.info('[dsh-remote] Carrier health check failed; closing carrier')
          // close() on the core publishes the same offline/recovery transition
          // as a socket close, including when the OS never delivered onclose.
          void core.close().catch(() => undefined)
        }
      })
    }, 25_000)
  }

  private clearHealthTimer(): void {
    if (this.healthTimer !== undefined) clearTimeout(this.healthTimer)
    this.healthTimer = undefined
  }

  async getNetworkDetails(): Promise<AdaptiveConnectionDetails | undefined> {
    return await this.transport?.connectionDetails()
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
    this.cursor = undefined
    this.acpBackends.clear()
    this.sessionTools = undefined
    if (mux !== undefined) await mux(false).catch(() => undefined)
    if (core !== undefined) await core.close()
  }
}
