import { AgentAcpClient, CodexRemoteClient, HarnessAlphaClient, RemoteClientCore, RemoteTypertGateway, probeRemoteHostFeatures, remoteWorkspaceTypeAvailable, type RemoteHostFeatures } from '@dsh-remote/client-core'
import { AdaptiveTransport, type AdaptiveConnectionDetails, type RtcIceServer } from '@dsh-remote/webrtc'
import { websocketUrl } from '../lib/server-url'
import { strings } from '../locales/i18n'
import type { DeviceIdentity, MuxStreamFrame, RemoteDevice } from '../types'
import { RemoteApiProxy } from './api-proxy'
import { HarnessSessionTools } from './session-tools'
import { SecureTransport } from './secure-transport'

export type MuxFrameHandler = (frame: MuxStreamFrame) => void
export type CloseHandler = () => void
type RemoteHarnessClient = RemoteApiProxy | HarnessAlphaClient

export interface AndroidConnectionOptions {
  preferredTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>
  forceRelay?: boolean
  fetchIceServers?: (connectionId: string) => Promise<RtcIceServer[]>
  onSecureHandshake?: () => void
  onClose?: CloseHandler
}

export class AndroidRemoteConnection {
  private core?: RemoteClientCore
  private proxy?: RemoteHarnessClient
  private codex?: CodexRemoteClient
  private cursor?: AgentAcpClient
  private acpBackends = new Set<string>()
  private codexAvailable = false
  private sessionTools?: HarnessSessionTools
  private closeMux?: (notifyRemote?: boolean) => Promise<void>
  private unsubscribeClose?: () => void
  private muxHandler?: MuxFrameHandler
  private transport?: AdaptiveTransport
  private connectionAttempt = 0

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
      // Host-side ApiProxy calls are capped at 30s. Leave a small delivery
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
        void this.closeMux?.(false)
        this.closeMux = undefined
        this.core = undefined
        this.proxy = undefined
        this.codex = undefined
        this.codexAvailable = false
        this.cursor = undefined
        this.acpBackends.clear()
        this.sessionTools = undefined
        if (!replacingFallback) options.onClose?.()
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
          // A live carrier failure is an offline channel, even if its socket
          // still answers. Reconnect will create a fresh follow subscription.
          void this.close()
          options.onClose?.()
          return
        }
        this.muxHandler?.(frame)
      }
      this.applyBackendFeatures(core, features)
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
      } else if (features.apiProxy) {
        const apiProxy = new RemoteApiProxy(core)
        this.proxy = apiProxy
        const closeMux = await apiProxy.openMuxStream(emitFrame)
        if (attempt !== this.connectionAttempt || this.core !== core) {
          await closeMux(false).catch(() => undefined)
          throw new Error('The connection attempt was superseded.')
        }
        this.closeMux = closeMux
      } else {
        throw new Error('The remote Host exposes no supported Harness transport.')
      }
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
    this.codexAvailable = features.capabilities.includes('codex.appserver.transfer.v1')
      && remoteWorkspaceTypeAvailable(features.capabilities, features.workspaceTypes, 'codex', 'codex.appserver.v1')
    if (this.codexAvailable) this.codex ??= new CodexRemoteClient(core)
    this.acpBackends.clear()
    for (const backend of ['cursor', 'antigravity'] as const) {
      if (remoteWorkspaceTypeAvailable(features.capabilities, features.workspaceTypes, backend, `agent.acp.${backend}.v1`)) {
        this.acpBackends.add(backend)
      }
    }
    if (this.acpBackends.size > 0) this.cursor ??= new AgentAcpClient(core)
  }

  /** Harness business client; only available while connected. */
  requireProxy(): RemoteHarnessClient {
    if (this.proxy === undefined) throw new Error(strings.runtime.connectHostFirst)
    return this.proxy
  }

  /** Optional CodeX business client; available only when the Host advertises both domain capabilities. */
  requireCodex(): CodexRemoteClient {
    if (this.codex === undefined || !this.codexAvailable) throw new Error(strings.runtime.codexUnavailable)
    return this.codex
  }

  requireSessionTools(): HarnessSessionTools {
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

  getStats() {
    return this.core?.getStats()
  }

  async getNetworkDetails(): Promise<AdaptiveConnectionDetails | undefined> {
    return await this.transport?.connectionDetails()
  }

  async close(): Promise<void> {
    ++this.connectionAttempt
    await this.clearConnection()
  }

  private async clearConnection(): Promise<void> {
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
