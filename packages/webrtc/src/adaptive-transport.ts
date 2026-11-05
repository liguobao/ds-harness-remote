import { ControlLease } from './control-lease.js'
import { waitForRelayCapacity } from './websocket-backpressure.js'
import {
  PROTOCOL_VERSION,
  WEBRTC_RESUME_CAPABILITY,
  RELAY_RESUME_CAPABILITY,
  type ConnectionLeaseAck,
  acceptNegotiatedCapabilities,
  createControlFrame,
  createRelayDataFrame,
  decodeControlFrame,
  decodeRelayDataFrame,
  encodeControlFrame,
  encodeRelayDataFrame,
  type ControlFrameByteLimits,
  type ConnectAcceptedPayload,
  type HelloAckPayload,
  type RelayPayload,
  type SecureHandshakePayload,
  type SelectedTransport,
  type TransportSelectedPayload,
  type TransportStats,
} from '@dsh-remote/protocol'
import { browserRtcFactory, type RtcIceServer, type RtcPeerConnectionFactory } from './rtc-adapter.js'
import {
  RtcConnectError,
  RtcDataChannelTransport,
  type RtcConnectionDiagnostics,
  type RtcConnectionDetails,
  type RtcDiagnosticEvent,
  type RtcSelectedTransport,
  type RtcSignal,
} from './rtc-data-channel.js'
import { BaseTransport } from './transport.js'
import { fromBase64Url, toBase64Url } from './util.js'

type RelayAssignment = Pick<ConnectAcceptedPayload, 'relayEndpoint' | 'relayTicket' | 'relayNodeId' | 'relayEpoch'>

export interface AdaptiveTransportOptions {
  role: 'client'
  deviceId: string
  accessToken: string
  refreshAccessToken?: () => Promise<string>
  targetDeviceId: string
  capabilities?: string[]
  preferredTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>
  forceRelay?: boolean
  /** Control authorization only, ending at connect.accepted. */
  handshakeTimeoutMs?: number
  negotiateTimeoutMs?: number
  iceServersTimeoutMs?: number
  signal?: AbortSignal
  rtcFactory?: RtcPeerConnectionFactory
  fetchIceServers?: (connectionId: string, signal?: AbortSignal) => Promise<RtcIceServer[]>
  onWebRtcFallback?: (error: Error, diagnostics?: RtcConnectionDiagnostics) => void
  onWebRtcDiagnostic?: (event: RtcDiagnosticEvent) => void
  /** Payload-free diagnostics for an established carrier closing. */
  onDisconnect?: (event: AdaptiveDisconnectDiagnostic) => void
}

export interface AdaptiveDisconnectDiagnostic {
  reason: 'control-closed' | 'control-error' | 'invalid-control-frame' | 'webrtc-closed'
  closeCode?: number
  closeReason?: string
}

export interface AdaptiveConnectionDetails {
  connectionId?: string
  connectedAt?: number
  heartbeatIntervalMs?: number
  lastControlReceivedAt?: number
  lastControlSentAt?: number
  recoveryExpiresAt?: number
  controlChannelUrl: string
  controlChannelState: 'connecting' | 'open' | 'closing' | 'closed'
  preferredTransports: Array<'lan' | 'p2p' | 'turn' | 'relay'>
  negotiatedCapabilities: string[]
  webRtcEnabled: boolean
  webRtc?: RtcConnectionDetails
}

const DEFAULT_CAPABILITIES = [WEBRTC_RESUME_CAPABILITY, RELAY_RESUME_CAPABILITY, 'transport.lan', 'transport.p2p', 'transport.turn', 'transport.relay', 'transport.relay.attach', 'harness.api.v1']
const DEFAULT_PREFERRED_TRANSPORTS = ['lan', 'p2p', 'turn', 'relay'] as const

/**
 * Client-side adaptive transport: `p2p -> turn -> relay` (webrtc plan §4/§6.4).
 *
 * Owns the Server control WebSocket and negotiates the data plane after
 * `connect.accepted`. WebRTC (initiator) is attempted first unless
 * `forceRelay` is set or no RTC backend is available; every failure path
 * closes the RTC state and falls back to the WebSocket Relay data plane.
 * Noise IK always runs over `secure.handshake` control frames; only the Noise
 * ciphertext moves to the DataChannel once WebRTC is established.
 */
export class AdaptiveTransport extends BaseTransport {
  private readonly handshakeHandlers = new Set<(step: number, data: Uint8Array) => void>()
  private socket?: WebSocket
  private dataSocket?: WebSocket
  private connectionId?: string
  private relayCounter = 0
  private bytesSent = 0
  private bytesReceived = 0
  private dataMode: 'relay' | 'webrtc' = 'relay'
  private selected?: SelectedTransport
  private rtc?: RtcDataChannelTransport
  private readyResolve?: () => void
  private readyReject?: (error: Error) => void
  private handshakeTimer?: ReturnType<typeof setTimeout>
  private lifetime?: AbortController
  private removeAbort?: () => void
  private webrtcEnabled = true
  private serverNegotiateTimeoutMs?: number
  private negotiatedCapabilities: string[] = ['transport.relay']
  private controlFrameLimits: ControlFrameByteLimits = {}
  private connectedAt?: number
  private heartbeatIntervalMs?: number
  private lastControlReceivedAt?: number
  private lastControlSentAt?: number
  private lastRtcDiagnostics?: RtcConnectionDiagnostics
  private relayAssignment?: RelayAssignment
  private dataReady = false
  private recoveryTicket?: string
  private relayRecoveryTicket?: string
  private lease?: ControlLease
  private recoveryTimer?: ReturnType<typeof setTimeout>
  private recoveryOpeningTimer?: ReturnType<typeof setTimeout>
  private recoveryAttempt = 0
  private controlReady = false

  constructor(
    private readonly url: string,
    private readonly options: AdaptiveTransportOptions,
  ) {
    super()
  }

  async connect(): Promise<void> {
    if (this.socket !== undefined || this.connectedAt !== undefined) return
    throwIfAborted(this.options.signal)
    const lifetime = new AbortController()
    this.lifetime = lifetime
    this.webrtcEnabled = true
    this.serverNegotiateTimeoutMs = undefined
    this.dataMode = 'relay'
    this.selected = undefined
    this.connectedAt = undefined
    this.relayCounter = 0
    this.socket = new WebSocket(this.url)
    this.controlFrameLimits = {}
    this.socket.binaryType = 'arraybuffer'
    await new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
      const onAbort = () => this.failConnection(new Error('Adaptive connection was aborted'))
      this.options.signal?.addEventListener('abort', onAbort, { once: true })
      this.removeAbort = () => this.options.signal?.removeEventListener('abort', onAbort)
      this.handshakeTimer = setTimeout(
        () => this.failConnection(new Error('Adaptive control handshake timed out')),
        this.options.handshakeTimeoutMs ?? 15_000,
      )
      const socket = this.socket!
      socket.onmessage = event => { if (this.socket === socket) void this.handleSocketMessage(event.data, lifetime) }
      socket.onopen = () => {
        if (this.lifetime !== lifetime) return
        this.sendControl('hello', {
          role: this.options.role,
          deviceId: this.options.deviceId,
          accessToken: this.options.accessToken,
          protocols: [PROTOCOL_VERSION],
          capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES,
        })
      }
      socket.onerror = () => {
        if (this.lifetime === lifetime && this.socket === socket) this.controlLost(new Error('Control socket failed'), { reason: 'control-error' })
      }
      socket.onclose = event => {
        if (this.lifetime === lifetime && this.socket === socket) this.controlLost(adaptiveControlCloseError(event), { reason: 'control-closed', closeCode: event.code, closeReason: event.reason })
      }
    })
  }

  async send(data: Uint8Array): Promise<void> {
    if (this.lease && !this.lease.valid()) throw new Error('Control lease expired')
    if (this.connectionId === undefined) throw new Error('adaptive transport has not been authorized')
    if (this.dataMode === 'webrtc') {
      const rtc = this.rtc
      if (rtc === undefined) throw new Error('webrtc data channel is not available')
      this.bytesSent += data.byteLength
      await rtc.send(data)
      return
    }
    const socket = this.dataSocket ?? this.socket
    if (socket?.readyState !== WebSocket.OPEN) throw new Error('adaptive transport is not connected')
    await waitForRelayCapacity(socket)
    const payload = {
      connectionId: this.connectionId,
      targetDeviceId: this.options.targetDeviceId,
      counter: this.relayCounter,
      ciphertext: toBase64Url(data),
    } satisfies RelayPayload
    if (this.dataSocket !== undefined) {
      this.dataSocket.send(encodeRelayDataFrame(createRelayDataFrame('relay', payload), this.controlFrameLimits))
    }
    else this.sendControl('relay', payload)
    this.bytesSent += data.byteLength
    this.relayCounter += 1
  }

  connectionInfo(): { connectionId: string; localDeviceId: string; remoteDeviceId: string } {
    if (this.connectionId === undefined) throw new Error('adaptive transport has not been authorized')
    return {
      connectionId: this.connectionId,
      localDeviceId: this.options.deviceId,
      remoteDeviceId: this.options.targetDeviceId,
    }
  }

  async connectionDetails(): Promise<AdaptiveConnectionDetails> {
    const remainingMs = this.lease?.remainingMs()
    return {
      ...(this.connectionId === undefined ? {} : { connectionId: this.connectionId }),
      ...(this.connectedAt === undefined ? {} : { connectedAt: this.connectedAt }),
      ...(this.heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs: this.heartbeatIntervalMs }),
      ...(this.lastControlReceivedAt === undefined ? {} : { lastControlReceivedAt: this.lastControlReceivedAt }),
      ...(this.lastControlSentAt === undefined ? {} : { lastControlSentAt: this.lastControlSentAt }),
      recoveryExpiresAt: remainingMs === undefined ? undefined : Date.now() + remainingMs,
      controlChannelUrl: this.url,
      controlChannelState: socketState(this.socket?.readyState),
      preferredTransports: this.options.forceRelay === true
        ? ['relay']
        : [...(this.options.preferredTransports ?? DEFAULT_PREFERRED_TRANSPORTS)],
      negotiatedCapabilities: [...this.negotiatedCapabilities],
      webRtcEnabled: this.webrtcEnabled,
      ...(this.rtc === undefined ? {} : { webRtc: await this.rtc.connectionDetails() }),
    }
  }

  async sendHandshake(step: number, data: Uint8Array): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN || this.connectionId === undefined) {
      throw new Error('adaptive transport has not been authorized')
    }
    this.sendControl('secure.handshake', {
      connectionId: this.connectionId,
      targetDeviceId: this.options.targetDeviceId,
      step,
      data: toBase64Url(data),
    } satisfies SecureHandshakePayload)
  }

  onHandshake(cb: (step: number, data: Uint8Array) => void): () => void {
    this.handshakeHandlers.add(cb)
    return () => this.handshakeHandlers.delete(cb)
  }

  async close(): Promise<void> {
    this.failConnection(new Error('Adaptive transport closed'))
  }

  getStats(): TransportStats {
    const webrtcConnected = this.dataMode === 'webrtc' && this.rtc?.getStats().connected === true
    const relayConnected = this.dataMode === 'relay'
      && (this.dataSocket?.readyState === WebSocket.OPEN && this.dataReady || this.socket?.readyState === WebSocket.OPEN)
      && this.connectionId !== undefined
    const connected = webrtcConnected || relayConnected
    let mode: TransportStats['mode'] = 'Disconnected'
    if (this.selected === 'relay') mode = relayConnected ? 'Relay' : 'Disconnected'
    else if (this.selected === 'lan' || this.selected === 'turn' || this.selected === 'p2p') {
      mode = webrtcConnected ? this.rtc!.getStats().mode : 'Disconnected'
    }
    return { mode, connected, bytesSent: this.bytesSent, bytesReceived: this.bytesReceived }
  }

  private async handleSocketMessage(raw: string | ArrayBuffer | Blob, lifetime: AbortController): Promise<void> {
    if (this.lifetime !== lifetime) return
    try {
      if (typeof raw !== 'string') throw new Error('Adaptive control frames must be text JSON')
      const frame = decodeControlFrame(raw, this.controlFrameLimits)
      this.lastControlReceivedAt = Date.now()
      if (frame.type === 'hello.ack') {
        this.controlReady = true
        const payload = frame.payload as Partial<HelloAckPayload>
        if (payload.protocol !== PROTOCOL_VERSION) throw new Error('Server selected an unsupported protocol version')
        this.heartbeatIntervalMs = payload.heartbeatIntervalMs
        const offered = this.options.capabilities ?? DEFAULT_CAPABILITIES
        this.negotiatedCapabilities = acceptNegotiatedCapabilities(offered, payload.capabilities)
        this.controlFrameLimits = {
          maxControlFrameBytes: payload.maxControlFrameBytes,
          maxRelayFrameBytes: payload.maxRelayFrameBytes,
        }
        const preferredTransports = this.negotiatedTransports()
        if (preferredTransports.length === 0) {
          throw new Error('Server did not negotiate a supported transport capability')
        }
        if (payload.webrtcEnabled === false) this.webrtcEnabled = false
        if (typeof payload.webrtcFallbackTimeoutMs === 'number'
          && Number.isSafeInteger(payload.webrtcFallbackTimeoutMs)
          && payload.webrtcFallbackTimeoutMs > 0) {
          this.serverNegotiateTimeoutMs = payload.webrtcFallbackTimeoutMs
        }
        if (this.lease) {
          if (!this.negotiatedCapabilities.includes(this.dataMode === 'webrtc' ? WEBRTC_RESUME_CAPABILITY : RELAY_RESUME_CAPABILITY)) throw new Error('Server no longer supports control recovery')
          clearTimeout(this.recoveryOpeningTimer)
          this.recoveryAttempt = 0
          this.lease.tick(true)
          return
        }
        this.sendControl('connect.request', {
          hostDeviceId: this.options.targetDeviceId,
          preferredTransports,
        })
        return
      }
      if (frame.type === 'connect.accepted') {
        if (this.connectionId !== undefined) throw new Error('Duplicate connect.accepted')
        const payload = frame.payload as Partial<ConnectAcceptedPayload>
        if (typeof payload.connectionId !== 'string' || payload.connectionId.length === 0) {
          throw new Error('connect.accepted did not include a connectionId')
        }
        this.connectionId = payload.connectionId
        if (this.negotiatedCapabilities.includes(WEBRTC_RESUME_CAPABILITY)) this.recoveryTicket = payload.recoveryTicket
        if (this.negotiatedCapabilities.includes(RELAY_RESUME_CAPABILITY)) this.relayRecoveryTicket = payload.relayRecoveryTicket
        const assignment = payload as RelayAssignment
        if (typeof assignment.relayEndpoint === 'string' && typeof assignment.relayTicket === 'string') {
          this.relayAssignment = assignment
        }
        this.clearHandshake()
        void this.negotiate(lifetime.signal).catch(error => {
          if (this.lifetime === lifetime) this.failConnection(error instanceof Error ? error : new Error('Adaptive transport negotiation failed'))
        })
        return
      }
      if (frame.type === 'connection.lease.ack') {
        if (!this.lease) throw new Error('Unexpected connection lease')
        this.lease.acknowledge(frame.payload as ConnectionLeaseAck)
        return
      }
      if (frame.type === 'connect.rejected' || frame.type === 'error') {
        const payload = frame.payload as { message?: unknown; code?: unknown; retryable?: unknown }
        const message = typeof payload.message === 'string' ? payload.message : 'Server rejected the connection'
        throw Object.assign(new Error(message), { code: payload.code, retryable: payload.retryable })
      }
      if (frame.type === 'relay') {
        if (this.dataSocket !== undefined) return
        if (this.dataMode !== 'relay') return
        this.handleRelay(frame.payload as Partial<RelayPayload>)
        return
      }
      if (frame.type === 'secure.handshake') {
        const payload = frame.payload as Partial<SecureHandshakePayload>
        if (payload.connectionId !== this.connectionId
          || payload.targetDeviceId !== this.options.deviceId
          || !Number.isSafeInteger(payload.step)
          || typeof payload.data !== 'string') {
          throw new Error('Received a secure handshake frame for an unknown connection')
        }
        const data = fromBase64Url(payload.data)
        for (const handler of this.handshakeHandlers) handler(payload.step!, data)
        return
      }
      if (frame.type === 'signal.answer') {
        const payload = frame.payload as { connectionId?: unknown; targetDeviceId?: unknown; sdp?: unknown }
        if (payload.connectionId === this.connectionId && typeof payload.sdp === 'string') {
          this.rtc?.handleSignal({ type: 'answer', sdp: payload.sdp })
        }
        return
      }
      if (frame.type === 'signal.ice') {
        const payload = frame.payload as { connectionId?: unknown; candidate?: unknown }
        if (payload.connectionId === this.connectionId && isObject(payload.candidate)) {
          this.rtc?.handleSignal({ type: 'ice', candidate: payload.candidate })
        }
        return
      }
      if (frame.type === 'signal.offer' || frame.type === 'transport.selected') return
      if (frame.type === 'ping') this.sendControl('pong', frame.payload)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Invalid adaptive control frame')
      if (!('code' in failure)) Object.assign(failure, { code: 'INVALID_MESSAGE' })
      this.failConnection(failure, { reason: 'invalid-control-frame' })
    }
  }

  private handleRelay(payload: Partial<RelayPayload>): void {
    if (payload.connectionId !== this.connectionId
      || payload.targetDeviceId !== this.options.deviceId
      || !Number.isSafeInteger(payload.counter)
      || typeof payload.ciphertext !== 'string') {
      throw new Error('Received a relay frame for an unknown connection')
    }
    const data = fromBase64Url(payload.ciphertext)
    this.bytesReceived += data.byteLength
    this.emit(data)
  }

  private async negotiate(signal: AbortSignal): Promise<void> {
    if (this.connectionId === undefined) return
    const preferred = this.negotiatedTransports()
    const wantWebRtc = !this.options.forceRelay && this.webrtcEnabled
      && (preferred.includes('lan') || preferred.includes('p2p') || preferred.includes('turn'))
    let selected: SelectedTransport = 'relay'
    this.lastRtcDiagnostics = undefined
    if (wantWebRtc) {
      try {
        const rtcSelected = (await this.tryWebRtc(signal)).transport
        throwIfAborted(signal)
        const wireSelected = rtcSelected === 'lan' && !preferred.includes('lan') && preferred.includes('p2p')
          ? 'p2p'
          : rtcSelected
        if (!preferred.includes(wireSelected)) {
          await this.rtc?.close()
          throwIfAborted(signal)
          this.rtc = undefined
          if (!preferred.includes('relay')) {
            throw new Error(`WebRTC selected unnegotiated transport: ${rtcSelected}`)
          }
          this.dataMode = 'relay'
          selected = 'relay'
        } else {
          this.dataMode = 'webrtc'
          selected = wireSelected
        }
      } catch (error) {
        throwIfAborted(signal)
        const reason = error instanceof Error ? error : new Error('WebRTC negotiation failed.')
        try { this.options.onWebRtcFallback?.(reason, this.lastRtcDiagnostics) } catch { /* diagnostics must not block fallback */ }
        await this.rtc?.close()
        throwIfAborted(signal)
        this.rtc = undefined
        if (!preferred.includes('relay')) throw reason
        this.dataMode = 'relay'
        selected = 'relay'
      }
    } else {
      if (!preferred.includes('relay')) throw new Error('No negotiated transport is available')
      this.dataMode = 'relay'
      selected = 'relay'
    }
    this.selected = selected
    if (selected === 'relay' && this.relayAssignment !== undefined) {
      await this.openDataSocket(this.relayAssignment)
    }
    const turnNode = selected === 'turn' ? this.rtc?.selectedRelayUrl() : undefined
    this.sendControl('transport.selected', {
      connectionId: this.connectionId,
      targetDeviceId: this.options.targetDeviceId,
      transport: selected,
      ...(turnNode === undefined ? {} : { turnNode }),
    } satisfies TransportSelectedPayload)
    this.finishConnection()
  }

  private negotiatedTransports(): Array<'lan' | 'p2p' | 'turn' | 'relay'> {
    const preferred = this.options.forceRelay === true
      ? ['relay'] as const
      : this.options.preferredTransports ?? DEFAULT_PREFERRED_TRANSPORTS
    return preferred.filter(transport => {
      if (transport === 'lan') return this.negotiatedCapabilities.includes('transport.lan')
      if (transport === 'p2p') return this.negotiatedCapabilities.includes('transport.p2p')
      return this.negotiatedCapabilities.includes(`transport.${transport}`)
    })
  }

  private async tryWebRtc(signal: AbortSignal): Promise<{ transport: RtcSelectedTransport, relayUrl?: string }> {
    const connectionId = this.connectionId
    if (connectionId === undefined) throw new RtcConnectError('RTC_UNAVAILABLE', 'No connection id for WebRTC negotiation.')
    const factory = this.options.rtcFactory
      ?? (typeof RTCPeerConnection === 'undefined' ? undefined : browserRtcFactory())
    if (factory === undefined) {
      throw new RtcConnectError('RTC_UNAVAILABLE', 'No RTC backend is available in this environment.')
    }
    let iceServers: RtcIceServer[] = []
    try {
      iceServers = await this.fetchIceServers(connectionId, signal)
    } catch {
      // TURN/STUN unavailable: still attempt direct P2P with host candidates.
      iceServers = []
    }
    throwIfAborted(signal)
    const rtc = new RtcDataChannelTransport({
      role: 'initiator',
      factory,
      iceServers,
      onSignal: signal => this.sendRtcSignal(signal),
      negotiateTimeoutMs: negotiateTimeout(this.serverNegotiateTimeoutMs, this.options.negotiateTimeoutMs),
      label: `client->${this.options.targetDeviceId}`,
      onDiagnostic: event => {
        this.lastRtcDiagnostics = event.diagnostics
        try { this.options.onWebRtcDiagnostic?.(event) } catch { /* diagnostics must not block negotiation */ }
      },
    })
    this.rtc = rtc
    rtc.onMessage(data => {
      if (this.lease && !this.lease.valid()) return
      this.bytesReceived += data.byteLength
      this.emit(data)
    })
    rtc.onClose(() => {
      // A negotiation failure closes the provisional data channel before this
      // transport switches to Relay. That is not a loss of the established
      // Adaptive transport, so only surface closes from an active WebRTC path.
      if (this.rtc === rtc && this.dataMode === 'webrtc') {
        this.failConnection(new Error('Active WebRTC channel closed'), { reason: 'webrtc-closed' })
      }
    })
    try {
      await rtc.connect(signal)
    } catch (error) {
      throwIfAborted(signal)
      this.lastRtcDiagnostics = rtc.diagnostics()
      await rtc.close()
      if (this.rtc === rtc) this.rtc = undefined
      throwIfAborted(signal)
      throw error
    }
    throwIfAborted(signal)
    this.lastRtcDiagnostics = rtc.diagnostics()
    return { transport: rtc.selectedTransport() ?? 'p2p', relayUrl: rtc.selectedRelayUrl() }
  }

  markSecureReady(): void {
    const ticket = this.dataMode === 'webrtc' ? this.recoveryTicket : this.dataReady && this.dataSocket?.readyState === WebSocket.OPEN ? this.relayRecoveryTicket : undefined
    if (!ticket || !this.connectionId || this.lease) return
    this.lease = new ControlLease(this.connectionId, ticket, payload => {
      if (this.controlReady && this.lastControlReceivedAt !== undefined && Date.now() - this.lastControlReceivedAt >= 75_000) {
        this.controlLost(new Error('Control heartbeat timed out'), { reason: 'control-error' })
        throw new Error('Control heartbeat timed out')
      }
      this.sendControl('connection.lease.request', payload)
    }, () => this.failConnection(Object.assign(new Error('Control authorization lease expired'), { code: 'TRANSPORT_CLOSED', retryable: true })))
    this.lease.start()
  }

  private controlLost(error: Error, diagnostic: AdaptiveDisconnectDiagnostic): void {
    if ((error as Error & { retryable?: boolean }).retryable === false || !this.lease?.canDetach()
      || !(this.dataMode === 'webrtc' ? this.rtc?.getStats().connected : this.dataReady && this.dataSocket?.readyState === WebSocket.OPEN)) {
      this.failConnection(error, diagnostic)
      return
    }
    const socket = this.socket
    this.controlReady = false
    this.socket = undefined
    clearTimeout(this.recoveryOpeningTimer)
    socket?.close()
    if (this.recoveryTimer !== undefined) return
    const delay = recoveryDelayMs(this.recoveryAttempt, diagnostic)
    this.recoveryAttempt++
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined
      void this.reopenControl()
    }, delay)
  }

  private async reopenControl(): Promise<void> {
    const lifetime = this.lifetime
    if (!lifetime || !this.lease?.canDetach()) return
    try {
      const token = this.options.refreshAccessToken ? await this.options.refreshAccessToken() : this.options.accessToken
      if (this.lifetime !== lifetime || !this.lease?.canDetach()) return
      const socket = new WebSocket(this.url)
      this.socket = socket
      socket.binaryType = 'arraybuffer'
      this.recoveryOpeningTimer = setTimeout(() => {
        if (this.socket === socket) this.controlLost(new Error('Control recovery handshake timed out'), { reason: 'control-error' })
      }, 15_000)
      socket.onopen = () => {
        if (this.socket !== socket || this.lifetime !== lifetime) return
        this.sendControl('hello', { role: this.options.role, deviceId: this.options.deviceId,
          accessToken: token, protocols: [PROTOCOL_VERSION], capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES })
      }
      socket.onmessage = event => {
        if (this.socket === socket && this.lifetime === lifetime) void this.handleSocketMessage(event.data, lifetime)
      }
      socket.onerror = () => {
        if (this.socket === socket) this.controlLost(new Error('Control recovery failed'), { reason: 'control-error' })
      }
      socket.onclose = event => {
        if (this.socket === socket) this.controlLost(adaptiveControlCloseError(event), { reason: 'control-closed', closeCode: event.code, closeReason: event.reason })
      }
    } catch (error) {
      if (this.lifetime !== lifetime) return
      if (typeof error === 'object' && error && (('retryable' in error && error.retryable === false)
        || ('code' in error && ['AUTH_INVALID', 'DEVICE_REVOKED', 'MEMBERSHIP_REQUIRED', 'PEER_IDENTITY_MISMATCH', 'DEVICE_NOT_FOUND', 'TOKEN_REUSED'].includes(String(error.code))))) {
        this.failConnection(error instanceof Error ? error : new Error('Control recovery authorization failed'))
      } else this.controlLost(new Error('Control recovery unavailable'), { reason: 'control-error' })
    }
  }

  private async fetchIceServers(connectionId: string, signal: AbortSignal): Promise<RtcIceServer[]> {
    if (this.options.fetchIceServers === undefined) return []
    return new Promise<RtcIceServer[]>((resolve, reject) => {
      const request = new AbortController()
      let settled = false
      const finish = (error?: Error, servers: RtcIceServer[] = []) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(servers)
      }
      const onAbort = () => {
        finish(new Error('ICE configuration request was aborted'))
        request.abort()
      }
      const timer = setTimeout(() => {
        finish(new Error('ICE configuration request timed out'))
        request.abort()
      }, this.options.iceServersTimeoutMs ?? 10_000)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) { onAbort(); return }
      Promise.resolve().then(() => {
        throwIfAborted(request.signal)
        return this.options.fetchIceServers!(connectionId, request.signal)
      }).then(
        servers => finish(undefined, servers),
        error => finish(error instanceof Error ? error : new Error('ICE configuration request failed')),
      )
    })
  }

  private sendRtcSignal(signal: RtcSignal): void {
    if (this.connectionId === undefined) return
    if (signal.type === 'offer') {
      this.sendControl('signal.offer', {
        connectionId: this.connectionId,
        targetDeviceId: this.options.targetDeviceId,
        sdp: signal.sdp,
      })
    } else if (signal.type === 'answer') {
      this.sendControl('signal.answer', {
        connectionId: this.connectionId,
        targetDeviceId: this.options.targetDeviceId,
        sdp: signal.sdp,
      })
    } else {
      this.sendControl('signal.ice', {
        connectionId: this.connectionId,
        targetDeviceId: this.options.targetDeviceId,
        candidate: signal.candidate,
      })
    }
  }

  private async openDataSocket(assignment: RelayAssignment): Promise<void> {
    if (this.connectionId === undefined || this.dataSocket !== undefined) return
    const socket = new WebSocket(assignment.relayEndpoint!)
    socket.binaryType = 'arraybuffer'
    this.dataSocket = socket
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Relay data attach timed out'))
        socket.close()
      }, this.options.handshakeTimeoutMs ?? 15_000)
      socket.onopen = () => socket.send(encodeRelayDataFrame(createRelayDataFrame('relay.attach', {
        connectionId: this.connectionId,
        deviceId: this.options.deviceId,
        peerDeviceId: this.options.targetDeviceId,
        ticket: assignment.relayTicket,
      }), this.controlFrameLimits))
      socket.onmessage = event => {
        try {
          if (typeof event.data !== 'string') throw new Error('Relay data frames must be text JSON')
          const data = decodeRelayDataFrame(event.data, this.controlFrameLimits)
          if (data.type === 'relay.ready') {
            if (data.payload.connectionId !== this.connectionId
              || (assignment.relayEpoch !== undefined && data.payload.epoch !== assignment.relayEpoch)) {
              throw new Error('Relay data attach assignment mismatch')
            }
            clearTimeout(timer)
            this.dataReady = true
            resolve()
            return
          }
          void this.handleDataSocketFrame(data.type, data.payload).catch(error => {
            this.failConnection(error instanceof Error ? error : new Error('Invalid Relay data frame'))
          })
        } catch (error) {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error('Invalid Relay data frame'))
          this.failConnection(error instanceof Error ? error : new Error('Invalid Relay data frame'))
        }
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Relay data socket failed'))
      }
      socket.onclose = () => {
        clearTimeout(timer)
        if (!this.dataReady) reject(new Error('Relay data socket closed before attach'))
        else this.failConnection(new Error('Relay data socket closed'))
      }
    })
  }

  private async handleDataSocketFrame(type: string, payload: Record<string, unknown>): Promise<void> {
    if (type === 'relay.detach') {
      this.failConnection(new Error('Relay peer detached'))
      return
    }
    if (type === 'ping') {
      if (this.dataSocket?.readyState === WebSocket.OPEN) {
        this.dataSocket.send(encodeRelayDataFrame(createRelayDataFrame('pong', payload), this.controlFrameLimits))
      }
      return
    }
    if (type === 'relay') {
      if (payload.connectionId !== this.connectionId || payload.targetDeviceId !== this.options.deviceId
        || !Number.isSafeInteger(payload.counter) || typeof payload.ciphertext !== 'string') {
        throw new Error('Received a relay frame for an unknown connection')
      }
      const data = fromBase64Url(payload.ciphertext)
      this.bytesReceived += data.byteLength
      this.emit(data)
      return
    }
    if (type === 'secure.handshake') {
      if (payload.connectionId !== this.connectionId || payload.targetDeviceId !== this.options.deviceId
        || !Number.isSafeInteger(payload.step) || typeof payload.data !== 'string') {
        throw new Error('Received a secure handshake frame for an unknown connection')
      }
      const data = fromBase64Url(payload.data)
      for (const handler of this.handshakeHandlers) handler(payload.step as number, data)
    }
  }

  private sendControl(type: Parameters<typeof createControlFrame>[0], payload: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) throw Object.assign(new Error('adaptive control socket is not open'), { code: 'TRANSPORT_CLOSED' })
    this.socket.send(encodeControlFrame(createControlFrame(type, payload), this.controlFrameLimits))
    this.lastControlSentAt = Date.now()
  }

  private finishConnection(): void {
    this.clearHandshake()
    this.removeAbort?.()
    this.removeAbort = undefined
    this.connectedAt ??= Date.now()
    this.readyResolve?.()
    this.readyResolve = undefined
    this.readyReject = undefined
  }

  private failConnection(error: Error, diagnostic?: AdaptiveDisconnectDiagnostic): void {
    if (this.lease && this.connectionId && this.socket?.readyState === WebSocket.OPEN) {
      try { this.sendControl('connection.lease.close', { connectionId: this.connectionId }) } catch { /* local cleanup proceeds */ }
    }
    const established = this.connectedAt !== undefined
    this.controlReady = false
    this.lease?.stop()
    this.lease = undefined
    this.recoveryTicket = undefined
    this.relayRecoveryTicket = undefined
    clearTimeout(this.recoveryTimer)
    clearTimeout(this.recoveryOpeningTimer)
    this.recoveryTimer = undefined
    this.clearHandshake()
    const reject = this.readyReject
    this.readyResolve = undefined
    this.readyReject = undefined
    this.removeAbort?.()
    this.removeAbort = undefined
    const lifetime = this.lifetime
    this.lifetime = undefined
    const rtc = this.rtc
    const socket = this.socket
    const dataSocket = this.dataSocket
    this.rtc = undefined
    this.socket = undefined
    this.dataSocket = undefined
    this.dataReady = false
    this.relayAssignment = undefined
    this.connectionId = undefined
    this.connectedAt = undefined
    lifetime?.abort()
    reject?.(error)
    void rtc?.close()
    dataSocket?.close()
    socket?.close()
    if (established && diagnostic !== undefined) {
      try { this.options.onDisconnect?.(diagnostic) } catch { /* diagnostics must not prevent close */ }
    }
    if (socket !== undefined || established) this.emitClose(error)
  }

  private clearHandshake(): void {
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = undefined
  }
}

function adaptiveControlCloseError(event: CloseEvent): Error {
  // Self-hosted heartbeat expiry closes the socket without an error frame.
  // 4001 also carries authorization failures, so only this exact reason retries.
  const heartbeatTimeout = (event.code === 4001 && (event.reason === 'CONNECTION_FAILED' || event.reason === 'server shutdown')) || event.code === 4009
  const reason = event.reason.trim().slice(0, 300)
  const detail = reason.length > 0
    ? `${reason} (WebSocket ${event.code})`
    : `WebSocket closed with code ${event.code}`
  return Object.assign(new Error(`Adaptive control channel closed: ${detail}`), {
    code: event.code === 4003 ? 'CONNECTION_REPLACED' : 'TRANSPORT_CLOSED',
    retryable: heartbeatTimeout || event.code === 1000 || event.code === 1001 || event.code === 1006 || event.code === 1011 || event.code === 1012 || event.code === 1013,
  })
}

export function recoveryDelayMs(attempt: number, diagnostic: AdaptiveDisconnectDiagnostic): number {
  if (attempt === 0) {
    return diagnostic.closeCode === 4001 && diagnostic.closeReason === 'server shutdown'
      ? Math.random() * 15_000
      : 0
  }
  const step = Math.min(attempt + 1, 4)
  return Math.min(15_000, 1_000 * 2 ** step) * (0.8 + Math.random() * 0.4)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function socketState(readyState: number | undefined): AdaptiveConnectionDetails['controlChannelState'] {
  if (readyState === 0) return 'connecting'
  if (readyState === 1) return 'open'
  if (readyState === 2) return 'closing'
  return 'closed'
}

function negotiateTimeout(serverMs: number | undefined, localMs: number | undefined): number | undefined {
  if (serverMs === undefined) return localMs
  if (localMs === undefined) return serverMs
  return Math.max(serverMs, localMs)
}

// React Native AbortSignal implementations may omit throwIfAborted().
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Adaptive connection was aborted')
}
