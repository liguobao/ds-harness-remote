import { CodexRemoteClient, HarnessAlphaClient, RemoteClientCore, probeRemoteHostFeatures } from '@dsh-remote/client-core'
import { AdaptiveTransport, type AdaptiveConnectionDetails, type RtcIceServer } from '@dsh-remote/webrtc'
import { websocketUrl } from '../lib/server-url'
import { strings } from '../locales/i18n'
import type { DeviceIdentity, MuxStreamFrame, RemoteDevice } from '../types'
import { RemoteApiProxy } from './api-proxy'
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
  private closeMux?: (notifyRemote?: boolean) => Promise<void>
  private unsubscribeClose?: () => void
  private muxHandler?: MuxFrameHandler
  private transport?: AdaptiveTransport

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
    await this.close()
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
        if (!replacingFallback) options.onClose?.()
      })
      await core.connect()
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
      const capabilities = new Set(features.capabilities)
      if (capabilities.has('codex.appserver.v1') && capabilities.has('codex.appserver.transfer.v1')) {
        this.codex = new CodexRemoteClient(core)
      }
      if (features.remoteGateway) {
        const alpha = new HarnessAlphaClient(
          core,
          { clientVersion: host.clientVersion, harnessVersion: host.harnessVersion },
          frame => this.muxHandler?.(frame as unknown as MuxStreamFrame),
        )
        alpha.start()
        this.proxy = alpha
        this.closeMux = async (notifyRemote = true) => { await alpha.close(notifyRemote) }
      } else if (features.apiProxy) {
        const apiProxy = new RemoteApiProxy(core)
        this.proxy = apiProxy
        this.closeMux = await apiProxy.openMuxStream(frame => this.muxHandler?.(frame))
      } else {
        throw new Error('The remote Host exposes no supported Harness transport.')
      }
    } catch (error) {
      await this.close()
      throw error
    }
  }

  /** Harness business client; only available while connected. */
  requireProxy(): RemoteHarnessClient {
    if (this.proxy === undefined) throw new Error(strings.runtime.connectHostFirst)
    return this.proxy
  }

  /** Optional CodeX business client; available only when the Host advertises both domain capabilities. */
  requireCodex(): CodexRemoteClient {
    if (this.codex === undefined) throw new Error(strings.runtime.codexUnavailable)
    return this.codex
  }

  hasCodex(): boolean {
    return this.codex !== undefined
  }

  getStats() {
    return this.core?.getStats()
  }

  async getNetworkDetails(): Promise<AdaptiveConnectionDetails | undefined> {
    return await this.transport?.connectionDetails()
  }

  async close(): Promise<void> {
    this.muxHandler = undefined
    const mux = this.closeMux
    this.closeMux = undefined
    // Closing the whole transport makes a remote stream-close redundant.
    // Only remove the local subscription here so a half-open RTC path cannot
    // add another RPC timeout before recovery begins.
    if (mux !== undefined) await mux(false).catch(() => undefined)
    this.unsubscribeClose?.()
    this.unsubscribeClose = undefined
    const core = this.core
    this.core = undefined
    this.transport = undefined
    this.proxy = undefined
    this.codex = undefined
    if (core !== undefined) await core.close()
  }
}
