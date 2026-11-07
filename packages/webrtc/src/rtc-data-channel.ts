import type { TransportStats } from '@dsh-remote/protocol'
import {
  RTC_DATA_CHANNEL_LABEL,
  RTC_DATA_CHANNEL_OPTIONS,
  summarizeAddress,
  summarizeIceCandidate,
  type RtcAddressFamily,
  type RtcAddressScope,
  type RtcCandidateSummary,
  type RtcCandidateType,
  type RtcDataChannel,
  type RtcIceCandidateInit,
  type RtcIceServer,
  type RtcPeerConnectionDiagnosticEvent,
  type RtcPeerConnection,
  type RtcPeerConnectionFactory,
  type RtcStats,
  type RtcStatsEntry,
} from './rtc-adapter.js'
import { RtcChunkCodec, RTC_CHUNK_MAX_MESSAGE_BYTES } from './rtc-chunking.js'

export type RtcRole = 'initiator' | 'responder'
export type RtcSelectedTransport = 'lan' | 'p2p' | 'turn'
export type RtcPathMode = 'LAN' | 'P2P' | 'TURN'

export interface RtcSelectedPath {
  transport: RtcSelectedTransport
  mode: RtcPathMode
}

export interface RtcPathDetails {
  transport?: RtcSelectedTransport
  mode?: RtcPathMode
  relayUrl?: string
  localCandidateType?: string
  remoteCandidateType?: string
  localAddressScope?: RtcAddressScope
  remoteAddressScope?: RtcAddressScope
  localAddress?: string
  remoteAddress?: string
  protocol?: string
  relayProtocol?: string
  currentRoundTripTimeMs?: number
  availableOutgoingBitrate?: number
  bytesSent?: number
  bytesReceived?: number
}

export interface RtcConnectionDetails extends RtcPathDetails {
  connectionState: string
  iceConnectionState: string
  dataChannelState?: RtcDataChannel['readyState']
  diagnostics: RtcConnectionDiagnostics
}

export interface RtcCandidateTelemetry {
  total: number
  byType: Partial<Record<RtcCandidateType, number>>
  byFamily: Partial<Record<RtcAddressFamily, number>>
  byScope: Partial<Record<RtcAddressScope, number>>
  byProtocol: Record<string, number>
}

export interface RtcCandidatePairTelemetry {
  total: number
  nominated: number
  selected: number
  byState: Record<string, number>
  byLocalType: Partial<Record<RtcCandidateType, number>>
  byRemoteType: Partial<Record<RtcCandidateType, number>>
  byLocalFamily: Partial<Record<RtcAddressFamily, number>>
  byRemoteFamily: Partial<Record<RtcAddressFamily, number>>
  byLocalScope: Partial<Record<RtcAddressScope, number>>
  byRemoteScope: Partial<Record<RtcAddressScope, number>>
}

export interface RtcSelectedPathTelemetry {
  transport?: RtcSelectedTransport
  mode?: RtcPathMode
  relayUrl?: string
  localCandidateType?: string
  remoteCandidateType?: string
  localAddressScope?: RtcAddressScope
  remoteAddressScope?: RtcAddressScope
  protocol?: string
  relayProtocol?: string
  currentRoundTripTimeMs?: number
  availableOutgoingBitrate?: number
}

export interface RtcConnectionDiagnostics {
  role: RtcRole
  label?: string
  connectionState: string
  iceConnectionState: string
  iceGatheringState: string
  localCandidates: RtcCandidateTelemetry
  remoteCandidates: RtcCandidateTelemetry
  candidatePairs: RtcCandidatePairTelemetry
  filteredLocalCandidates: RtcCandidateTelemetry
  filteredCandidatePairs: RtcCandidateTelemetry
  selectedPath?: RtcSelectedPathTelemetry
}

export type RtcDiagnosticEvent =
  | { type: 'local-candidate'; candidate: RtcCandidateSummary; diagnostics: RtcConnectionDiagnostics }
  | { type: 'remote-candidate'; candidate: RtcCandidateSummary; action: 'buffered' | 'added' | 'ignored'; diagnostics: RtcConnectionDiagnostics }
  | { type: 'local-candidate-filtered'; candidate: RtcCandidateSummary; reason: string; diagnostics: RtcConnectionDiagnostics }
  | { type: 'candidate-pair-filtered'; localCandidate?: RtcCandidateSummary; reason: string; diagnostics: RtcConnectionDiagnostics }
  | { type: 'state-change'; connectionState: string; iceConnectionState: string; iceGatheringState: string; diagnostics: RtcConnectionDiagnostics }
  | { type: 'selected-path'; selectedPath: RtcSelectedPathTelemetry; diagnostics: RtcConnectionDiagnostics }

export type RtcSignal =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RtcIceCandidateInit }

export interface RtcDataChannelTransportOptions {
  role: RtcRole
  iceServers?: RtcIceServer[]
  iceTransportPolicy?: 'all' | 'relay'
  factory: RtcPeerConnectionFactory
  onSignal: (signal: RtcSignal) => void
  negotiateTimeoutMs?: number
  channelLabel?: string
  /**
   * Optional send watchdog for RTC implementations whose `bufferedAmount`
   * reliably returns to zero. Disabled by default because React Native and
   * some werift versions retain a positive value after data was delivered.
   */
  sendTimeoutMs?: number
  /** Human-readable diagnostic label; never logged with sensitive content. */
  label?: string
  /** Candidate/state telemetry hook. Events never contain SDP, credentials, or payload bytes. */
  onDiagnostic?: (event: RtcDiagnosticEvent) => void
}

const DEFAULT_NEGOTIATE_TIMEOUT_MS = 8_000
const SELECTED_PATH_RETRY_COUNT = 5
const SELECTED_PATH_RETRY_DELAY_MS = 50

/**
 * Complete WebRTC DataChannel transport state machine (webrtc plan §6.1).
 *
 * Owns one `RTCPeerConnection` + ordered `dsh` DataChannel for a single
 * connection establishment. It emits offer/answer/trickle-ICE via `onSignal`
 * and consumes the peer's signaling through `handleSignal`; the owner wires
 * those two ends to the Server control channel. `connect()` resolves only
 * once the DataChannel reaches `open`.
 */
export class RtcDataChannelTransport {
  private readonly pc: RtcPeerConnection
  private readonly role: RtcRole
  private readonly onSignal: (signal: RtcSignal) => void
  private readonly negotiateTimeoutMs: number
  private readonly channelLabel: string
  private readonly sendTimeoutMs?: number
  private readonly label?: string
  private readonly onDiagnostic?: (event: RtcDiagnosticEvent) => void

  private channel?: RtcDataChannel
  private readonly remoteCandidates: RtcIceCandidateInit[] = []
  private remoteDescriptionSet = false
  private opened = false
  private closed = false

  private readonly messageHandlers = new Set<(data: Uint8Array) => void>()
  private readonly closeHandlers = new Set<() => void>()
  private readonly errorHandlers = new Set<(error: Error) => void>()

  private connectPromise?: Promise<void>
  private openResolve?: () => void
  private openReject?: (error: Error) => void
  private negotiateTimer?: ReturnType<typeof setTimeout>
  private removeAbort?: () => void
  private watchdogTimer?: ReturnType<typeof setTimeout>

  private readonly outgoing = new RtcChunkCodec()
  private readonly incoming = new RtcChunkCodec()
  private bytesSent = 0
  private bytesReceived = 0
  private selected?: RtcSelectedTransport
  private selectedMode?: RtcPathMode
  private selectedRelayUrlValue?: string
  private selectedPathTelemetry?: RtcSelectedPathTelemetry
  private readonly localCandidateTelemetry = emptyCandidateTelemetry()
  private readonly remoteCandidateTelemetry = emptyCandidateTelemetry()
  private candidatePairTelemetry = emptyCandidatePairTelemetry()
  private readonly filteredLocalCandidateTelemetry = emptyCandidateTelemetry()
  private readonly filteredCandidatePairTelemetry = emptyCandidateTelemetry()
  private lastBufferedAmount = 0

  constructor(options: RtcDataChannelTransportOptions) {
    this.role = options.role
    this.onSignal = options.onSignal
    this.negotiateTimeoutMs = options.negotiateTimeoutMs ?? DEFAULT_NEGOTIATE_TIMEOUT_MS
    this.channelLabel = options.channelLabel ?? RTC_DATA_CHANNEL_LABEL
    this.sendTimeoutMs = options.sendTimeoutMs
    this.label = options.label
    this.onDiagnostic = options.onDiagnostic

    this.pc = options.factory.create({
      iceServers: options.iceServers,
      iceTransportPolicy: options.iceTransportPolicy,
      onDiagnostic: event => this.handlePeerDiagnostic(event),
    })
    this.pc.ondatachannel = event => this.adoptChannel(event.channel)
    this.pc.onicecandidate = event => {
      if (event.candidate !== null && !this.closed) {
        const candidate = summarizeIceCandidate(event.candidate)
        recordCandidate(this.localCandidateTelemetry, candidate)
        this.emitDiagnostic({ type: 'local-candidate', candidate, diagnostics: this.diagnostics() })
        this.onSignal({ type: 'ice', candidate: event.candidate })
      }
    }
    this.pc.onconnectionstatechange = () => {
      this.emitStateChange()
      this.checkConnectionState()
    }
    this.pc.oniceconnectionstatechange = () => {
      this.emitStateChange()
      this.checkConnectionState()
    }
    this.pc.onicegatheringstatechange = () => this.emitStateChange()
  }

  /** Begin negotiation; resolves when the DataChannel is open. */
  connect(signal?: AbortSignal): Promise<void> {
    if (this.closed) return Promise.reject(new RtcConnectError('RTC_CLOSED', 'WebRTC transport closed.'))
    if (signal?.aborted) return Promise.reject(new RtcConnectError('RTC_ABORTED', 'WebRTC negotiation was aborted.'))
    if (this.opened) return Promise.resolve()
    if (this.connectPromise !== undefined) return this.connectPromise
    this.armAbort(signal)
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.openResolve = resolve
      this.openReject = reject
      this.negotiateTimer = setTimeout(() => {
        void this.failOpenAfterStats(new RtcConnectError('RTC_CONNECT_TIMEOUT', `WebRTC negotiation timed out after ${this.negotiateTimeoutMs}ms.`))
      }, this.negotiateTimeoutMs)
      if (this.role === 'initiator') {
        void this.startInitiator().catch(error => this.failOpen(asError(error)))
      }
    })
    return this.connectPromise
  }

  handleSignal(signal: RtcSignal): void {
    if (this.closed) return
    if (signal.type === 'offer') void this.handleOffer(signal.sdp)
    else if (signal.type === 'answer') void this.handleAnswer(signal.sdp)
    else void this.handleIce(signal.candidate)
  }

  async send(data: Uint8Array): Promise<void> {
    const channel = this.requireOpenChannel()
    if (channel.readyState !== 'open') throw new Error('WebRTC data channel is not open.')
    for (const frame of this.outgoing.encode(data)) {
      try {
        channel.send(toArrayBuffer(frame))
      } catch (error) {
        console.error('[rtc-send-error] bytes=' + frame.byteLength, error instanceof Error ? error.message : error)
        throw error
      }
    }
    this.bytesSent += data.byteLength
    this.armWatchdog(channel)
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  selectedTransport(): RtcSelectedTransport | undefined {
    return this.selected
  }

  selectedRelayUrl(): string | undefined {
    return this.selectedRelayUrlValue
  }

  selectedPathMode(): RtcPathMode | undefined {
    return this.selectedMode
  }

  diagnostics(): RtcConnectionDiagnostics {
    return {
      role: this.role,
      ...(this.label === undefined ? {} : { label: this.label }),
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      iceGatheringState: this.pc.iceGatheringState,
      localCandidates: cloneCandidateTelemetry(this.localCandidateTelemetry),
      remoteCandidates: cloneCandidateTelemetry(this.remoteCandidateTelemetry),
      candidatePairs: cloneCandidatePairTelemetry(this.candidatePairTelemetry),
      filteredLocalCandidates: cloneCandidateTelemetry(this.filteredLocalCandidateTelemetry),
      filteredCandidatePairs: cloneCandidateTelemetry(this.filteredCandidatePairTelemetry),
      ...(this.selectedPathTelemetry === undefined ? {} : { selectedPath: { ...this.selectedPathTelemetry } }),
    }
  }

  async connectionDetails(): Promise<RtcConnectionDetails> {
    let statsDetails: RtcPathDetails = {}
    try {
      statsDetails = await this.refreshStatsDiagnostics()
    } catch {
      // Peer/DataChannel state remains useful if the RTC backend withholds stats.
    }
    return {
      ...statsDetails,
      mode: statsDetails.mode ?? this.selectedMode,
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      dataChannelState: this.channel?.readyState,
      diagnostics: this.diagnostics(),
    }
  }

  getStats(): TransportStats {
    const connected = this.channel?.readyState === 'open'
    return {
      mode: !connected
        ? 'Disconnected'
        : this.selectedMode ?? (this.selected === 'turn' ? 'TURN' : this.selected === 'lan' ? 'LAN' : 'P2P'),
      connected,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
    }
  }

  /** Idempotent close: releases PeerConnection, DataChannel, timers and listeners. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearNegotiation()
    this.openReject?.(new RtcConnectError('RTC_CLOSED', 'WebRTC transport closed during negotiation.'))
    this.openResolve = undefined
    this.openReject = undefined
    this.clearWatchdog()
    const channel = this.channel
    this.channel = undefined
    if (channel !== undefined) {
      channel.onopen = null
      channel.onmessage = null
      channel.onclose = null
      channel.onerror = null
      channel.onbufferedamountlow = null
      try { channel.close() } catch { /* already closed */ }
    }
    this.pc.onicecandidate = null
    this.pc.ondatachannel = null
    this.pc.onconnectionstatechange = null
    this.pc.oniceconnectionstatechange = null
    try { this.pc.close() } catch { /* already closed */ }
    if (this.opened) {
      this.opened = false
      for (const handler of this.closeHandlers) handler()
    }
  }

  private armAbort(signal: AbortSignal | undefined): void {
    this.removeAbort?.()
    this.removeAbort = undefined
    if (signal === undefined) return
    const onAbort = () => {
      this.failOpen(new RtcConnectError('RTC_ABORTED', 'WebRTC negotiation was aborted.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    this.removeAbort = () => signal.removeEventListener('abort', onAbort)
    if (signal.aborted) onAbort()
  }

  private async startInitiator(): Promise<void> {
    const channel = this.pc.createDataChannel(this.channelLabel, RTC_DATA_CHANNEL_OPTIONS)
    this.adoptChannel(channel)
    const offer = await this.pc.createOffer()
    if (this.closed) return
    await this.pc.setLocalDescription(offer)
    if (this.closed) return
    this.onSignal({ type: 'offer', sdp: requireSdp(offer) })
  }

  private async handleOffer(sdp: string): Promise<void> {
    if (this.role !== 'responder' || this.remoteDescriptionSet) {
      this.failOpen(new RtcConnectError('RTC_INVALID_STATE', 'Received an unexpected WebRTC offer.'))
      return
    }
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp })
      this.remoteDescriptionSet = true
      await this.flushRemoteCandidates()
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.onSignal({ type: 'answer', sdp: requireSdp(answer) })
    } catch (error) {
      this.failOpen(asError(error))
    }
  }

  private async handleAnswer(sdp: string): Promise<void> {
    if (this.role !== 'initiator' || this.remoteDescriptionSet) {
      this.failOpen(new RtcConnectError('RTC_INVALID_STATE', 'Received an unexpected WebRTC answer.'))
      return
    }
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp })
      this.remoteDescriptionSet = true
      await this.flushRemoteCandidates()
    } catch (error) {
      this.failOpen(asError(error))
    }
  }

  private async handleIce(candidate: RtcIceCandidateInit): Promise<void> {
    const summary = summarizeIceCandidate(candidate)
    if (!this.remoteDescriptionSet) {
      recordCandidate(this.remoteCandidateTelemetry, summary)
      this.emitDiagnostic({ type: 'remote-candidate', candidate: summary, action: 'buffered', diagnostics: this.diagnostics() })
      this.remoteCandidates.push(candidate)
      return
    }
    try {
      await this.pc.addIceCandidate(candidate)
      recordCandidate(this.remoteCandidateTelemetry, summary)
      this.emitDiagnostic({ type: 'remote-candidate', candidate: summary, action: 'added', diagnostics: this.diagnostics() })
    } catch {
      this.emitDiagnostic({ type: 'remote-candidate', candidate: summary, action: 'ignored', diagnostics: this.diagnostics() })
      // Ignore malformed/duplicate candidates; the connection either proceeds
      // or the negotiation timeout surfaces the failure.
    }
  }

  private async flushRemoteCandidates(): Promise<void> {
    const buffered = this.remoteCandidates.splice(0, this.remoteCandidates.length)
    for (const candidate of buffered) {
      try { await this.pc.addIceCandidate(candidate) } catch { /* ignored */ }
    }
  }

  private adoptChannel(channel: RtcDataChannel): void {
    if (this.channel !== undefined && this.channel !== channel) {
      try { channel.close() } catch { /* ignored */ }
      return
    }
    this.channel = channel
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => {
      if (this.closed || this.opened) return
      this.opened = true
      const resolve = this.openResolve
      this.clearNegotiation()
      void this.resolveSelectedTransport().then(() => {
        if (this.closed) return
        this.openResolve = undefined
        this.openReject = undefined
        resolve?.()
      })
    }
    channel.onmessage = event => {
      if (this.closed || !this.opened) return
      const data = event.data
      const frame = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      this.bytesReceived += frame.byteLength
      try {
        const message = this.incoming.decode(frame)
        if (message === undefined) return
        for (const handler of this.messageHandlers) handler(message)
      } catch {
        void this.close()
      }
    }
    channel.onclose = () => {
      if (this.closed) return
      this.failOpen(new RtcConnectError('RTC_CLOSED', 'WebRTC data channel closed.'))
      if (this.opened) {
        this.opened = false
        for (const handler of this.closeHandlers) handler()
      }
    }
    channel.onerror = () => {
      const error = new RtcConnectError('RTC_FAILED', 'WebRTC data channel reported an error.')
      this.failOpen(error)
      for (const handler of this.errorHandlers) handler(error)
    }
  }

  private async resolveSelectedTransport(): Promise<void> {
    try {
      let selected = await this.refreshStatsDiagnostics()
      // Native libwebrtc can open the DataChannel one tick before the selected
      // candidate pair is exposed through getStats(). A one-shot read leaves
      // selectedMode undefined forever, which is then incorrectly presented as
      // generic P2P even when the eventual pair is LAN or TURN.
      for (let attempt = 0;
        attempt < SELECTED_PATH_RETRY_COUNT
          && !this.closed
          && (selected.transport === undefined || selected.mode === undefined || selected.mode === 'P2P');
        attempt += 1) {
        await sleep(SELECTED_PATH_RETRY_DELAY_MS)
        selected = await this.refreshStatsDiagnostics()
      }
      this.selected = selected?.transport
      this.selectedMode = selected?.mode
      this.selectedRelayUrlValue = selected?.relayUrl
      this.selectedPathTelemetry = selectedPathTelemetry(selected)
      this.emitDiagnostic({
        type: 'selected-path',
        selectedPath: this.selectedPathTelemetry,
        diagnostics: this.diagnostics(),
      })
    } catch {
      this.selected = undefined
      this.selectedMode = undefined
    }
  }

  private checkConnectionState(): void {
    if (this.closed || this.opened) return
    if (this.pc.connectionState === 'failed' || this.pc.iceConnectionState === 'failed'
      || this.pc.connectionState === 'closed' || this.pc.iceConnectionState === 'closed') {
      void this.failOpenAfterStats(new RtcConnectError('RTC_FAILED', 'WebRTC peer connection failed before the data channel opened.'))
    }
  }

  private async failOpenAfterStats(error: Error): Promise<void> {
    await this.refreshStatsDiagnostics().catch(() => undefined)
    this.failOpen(error)
  }

  private failOpen(error: Error): void {
    if (this.closed || this.opened || this.openReject === undefined) return
    const reject = this.openReject
    this.clearNegotiation()
    this.openResolve = undefined
    this.openReject = undefined
    reject(error)
    void this.close()
  }

  private clearNegotiation(): void {
    if (this.negotiateTimer !== undefined) clearTimeout(this.negotiateTimer)
    this.negotiateTimer = undefined
    this.removeAbort?.()
    this.removeAbort = undefined
  }

  private requireOpenChannel(): RtcDataChannel {
    const channel = this.channel
    if (channel === undefined || channel.readyState !== 'open' || this.closed || !this.opened) {
      throw new Error('WebRTC data channel is not open.')
    }
    return channel
  }

  private armWatchdog(channel: RtcDataChannel): void {
    if (this.closed || this.sendTimeoutMs === undefined || this.sendTimeoutMs <= 0) return
    if (this.watchdogTimer !== undefined) clearTimeout(this.watchdogTimer)
    this.watchdogTimer = undefined
    const baseline = channel.bufferedAmount
    if (baseline <= 0) {
      this.lastBufferedAmount = 0
      return
    }
    this.lastBufferedAmount = baseline
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = undefined
      if (this.closed || this.channel !== channel || channel.readyState !== 'open') return
      const current = channel.bufferedAmount
      if (current > 0 && current >= this.lastBufferedAmount) {
        // The outbound queue has not drained since the last check: the peer is
        // not ACKing. Treat the transport as unhealthy so the owner can fall
        // back instead of leaving the RPC sender queue blocked forever.
        const error = new RtcConnectError('RTC_SEND_TIMEOUT', 'DataChannel send stalled.')
        for (const handler of this.errorHandlers) handler(error)
        void this.close()
        return
      }
      this.lastBufferedAmount = current
      if (current > 0) this.armWatchdog(channel)
    }, this.sendTimeoutMs)
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== undefined) clearTimeout(this.watchdogTimer)
    this.watchdogTimer = undefined
    this.lastBufferedAmount = 0
  }

  private async refreshStatsDiagnostics(): Promise<RtcPathDetails> {
    // Native getStats() must not leave startup waiting after the channel opens.
    const stats = [...await new Promise<RtcStats>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebRTC statistics timed out.')), 250)
      Promise.resolve().then(() => this.pc.getStats()).then(resolve, reject).finally(() => clearTimeout(timer))
    })]
    if (this.closed) return {}
    this.candidatePairTelemetry = inspectCandidatePairs(stats)
    return inspectSelectedPath(stats)
  }

  private handlePeerDiagnostic(event: RtcPeerConnectionDiagnosticEvent): void {
    if (event.type === 'local-candidate-filtered') {
      recordCandidate(this.filteredLocalCandidateTelemetry, event.candidate)
      this.emitDiagnostic({
        type: event.type,
        candidate: event.candidate,
        reason: event.reason,
        diagnostics: this.diagnostics(),
      })
      return
    }
    if (event.localCandidate !== undefined) recordCandidate(this.filteredCandidatePairTelemetry, event.localCandidate)
    this.emitDiagnostic({
      type: event.type,
      localCandidate: event.localCandidate,
      reason: event.reason,
      diagnostics: this.diagnostics(),
    })
  }

  private emitStateChange(): void {
    this.emitDiagnostic({
      type: 'state-change',
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      iceGatheringState: this.pc.iceGatheringState,
      diagnostics: this.diagnostics(),
    })
  }

  private emitDiagnostic(event: RtcDiagnosticEvent): void {
    try { this.onDiagnostic?.(event) } catch { /* diagnostics must not affect transport state */ }
  }
}

export class RtcConnectError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

export function detectSelectedTransport(stats: RtcStats): RtcSelectedTransport | undefined {
  return detectSelectedPath(stats)?.transport
}

export function detectSelectedPath(stats: RtcStats): RtcSelectedPath | undefined {
  const details = inspectSelectedPath(stats)
  return details.transport === undefined || details.mode === undefined
    ? undefined
    : { transport: details.transport, mode: details.mode }
}

export function inspectSelectedPath(stats: RtcStats): RtcPathDetails {
  // candidate-pair `localCandidateId`/`remoteCandidateId` reference the `id`
  // member of the local/remote-candidate stats (not the report map key).
  const candidates = new Map<string, RtcStatsEntry>()
  const candidatePairs = new Map<string, RtcStatsEntry>()
  const selectedPairs: RtcStatsEntry[] = []
  const selectedPairIds = new Set<string>()
  for (const [reportId, entry] of stats) {
    if (entry.type === 'local-candidate' || entry.type === 'remote-candidate') {
      if (typeof entry.candidateType === 'string' && entry.id !== undefined) {
        candidates.set(String(entry.id), entry)
      }
    } else if (entry.type === 'candidate-pair') {
      candidatePairs.set(String(entry.id ?? reportId), entry)
      if (entry.selected === true || entry.nominated === true) selectedPairs.push(entry)
    } else if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') {
      selectedPairIds.add(entry.selectedCandidatePairId)
    }
  }
  const pairs = [
    ...[...selectedPairIds].map(id => candidatePairs.get(id)).filter((pair): pair is RtcStatsEntry => pair !== undefined),
    ...selectedPairs,
  ]
  for (const pair of pairs) {
    const local = candidates.get(String(pair.localCandidateId))
    const remote = candidates.get(String(pair.remoteCandidateId))
    const localType = local?.candidateType
    const remoteType = remote?.candidateType
    const localAddressScope = summarizeAddress(candidateAddressValue(local)).addressScope
    const remoteAddressScope = summarizeAddress(candidateAddressValue(remote)).addressScope
    let selected: RtcSelectedPath | undefined
    if (localType === 'relay' || remoteType === 'relay') selected = { transport: 'turn', mode: 'TURN' }
    const relayUrl = localType === 'relay' ? stringStat(local, 'url') : undefined
    if (local === undefined && remote === undefined) continue
    const lan = isLanCandidatePair(localType, remoteType, localAddressScope, remoteAddressScope)
    selected ??= { transport: lan ? 'lan' : 'p2p', mode: lan ? 'LAN' : 'P2P' }
    const currentRoundTripTime = numberStat(pair, 'currentRoundTripTime')
    return {
      ...selected,
      ...(relayUrl === undefined ? {} : { relayUrl }),
      localCandidateType: stringStat(local, 'candidateType'),
      remoteCandidateType: stringStat(remote, 'candidateType'),
      localAddressScope,
      remoteAddressScope,
      localAddress: candidateAddress(local),
      remoteAddress: candidateAddress(remote),
      protocol: stringStat(local, 'protocol') ?? stringStat(remote, 'protocol'),
      relayProtocol: stringStat(local, 'relayProtocol') ?? stringStat(remote, 'relayProtocol'),
      currentRoundTripTimeMs: currentRoundTripTime === undefined
        ? undefined
        : Math.round(currentRoundTripTime * 1000),
      availableOutgoingBitrate: numberStat(pair, 'availableOutgoingBitrate'),
      bytesSent: numberStat(pair, 'bytesSent'),
      bytesReceived: numberStat(pair, 'bytesReceived'),
    }
  }
  return {}
}

export function inspectCandidatePairs(stats: RtcStats): RtcCandidatePairTelemetry {
  const candidates = new Map<string, RtcStatsEntry>()
  const telemetry = emptyCandidatePairTelemetry()
  const pairs: RtcStatsEntry[] = []
  for (const [reportId, entry] of stats) {
    if (entry.type === 'local-candidate' || entry.type === 'remote-candidate') {
      if (typeof entry.candidateType === 'string' && entry.id !== undefined) {
        candidates.set(String(entry.id), entry)
      }
    } else if (entry.type === 'candidate-pair') {
      pairs.push({ ...entry, id: entry.id ?? reportId })
    }
  }
  for (const pair of pairs) {
    telemetry.total += 1
    if (pair.nominated === true) telemetry.nominated += 1
    if (pair.selected === true) telemetry.selected += 1
    increment(telemetry.byState, stringStat(pair, 'state') ?? (pair.selected === true ? 'selected' : 'unknown'))
    const local = candidates.get(String(pair.localCandidateId))
    const remote = candidates.get(String(pair.remoteCandidateId))
    recordCandidateStats(telemetry.byLocalType, telemetry.byLocalFamily, telemetry.byLocalScope, local)
    recordCandidateStats(telemetry.byRemoteType, telemetry.byRemoteFamily, telemetry.byRemoteScope, remote)
  }
  return telemetry
}

function candidateAddress(candidate: RtcStatsEntry | undefined): string | undefined {
  const address = stringStat(candidate, 'address') ?? stringStat(candidate, 'ip')
  if (address === undefined) return undefined
  const port = numberStat(candidate, 'port')
  return port === undefined ? address : `${address}:${port}`
}

function stringStat(entry: RtcStatsEntry | undefined, key: string): string | undefined {
  const value = entry?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberStat(entry: RtcStatsEntry | undefined, key: string): number | undefined {
  const value = entry?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function emptyCandidateTelemetry(): RtcCandidateTelemetry {
  return {
    total: 0,
    byType: {},
    byFamily: {},
    byScope: {},
    byProtocol: {},
  }
}

function cloneCandidateTelemetry(value: RtcCandidateTelemetry): RtcCandidateTelemetry {
  return {
    total: value.total,
    byType: { ...value.byType },
    byFamily: { ...value.byFamily },
    byScope: { ...value.byScope },
    byProtocol: { ...value.byProtocol },
  }
}

function emptyCandidatePairTelemetry(): RtcCandidatePairTelemetry {
  return {
    total: 0,
    nominated: 0,
    selected: 0,
    byState: {},
    byLocalType: {},
    byRemoteType: {},
    byLocalFamily: {},
    byRemoteFamily: {},
    byLocalScope: {},
    byRemoteScope: {},
  }
}

function cloneCandidatePairTelemetry(value: RtcCandidatePairTelemetry): RtcCandidatePairTelemetry {
  return {
    total: value.total,
    nominated: value.nominated,
    selected: value.selected,
    byState: { ...value.byState },
    byLocalType: { ...value.byLocalType },
    byRemoteType: { ...value.byRemoteType },
    byLocalFamily: { ...value.byLocalFamily },
    byRemoteFamily: { ...value.byRemoteFamily },
    byLocalScope: { ...value.byLocalScope },
    byRemoteScope: { ...value.byRemoteScope },
  }
}

function recordCandidate(telemetry: RtcCandidateTelemetry, candidate: RtcCandidateSummary): void {
  telemetry.total += 1
  increment(telemetry.byType, candidate.candidateType)
  increment(telemetry.byFamily, candidate.addressFamily)
  increment(telemetry.byScope, candidate.addressScope)
  if (candidate.protocol !== undefined) increment(telemetry.byProtocol, candidate.protocol)
}

function recordCandidateStats(
  byType: Partial<Record<RtcCandidateType, number>>,
  byFamily: Partial<Record<RtcAddressFamily, number>>,
  byScope: Partial<Record<RtcAddressScope, number>>,
  candidate: RtcStatsEntry | undefined,
): void {
  const candidateType = candidateTypeStat(candidate)
  const address = summarizeAddress(candidateAddressValue(candidate))
  increment(byType, candidateType)
  increment(byFamily, address.addressFamily)
  increment(byScope, address.addressScope)
}

function candidateTypeStat(candidate: RtcStatsEntry | undefined): RtcCandidateType {
  const value = stringStat(candidate, 'candidateType')
  if (value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay') return value
  return 'unknown'
}

function candidateAddressValue(candidate: RtcStatsEntry | undefined): string | undefined {
  return stringStat(candidate, 'address') ?? stringStat(candidate, 'ip')
}

function isLanCandidatePair(
  localType: unknown,
  remoteType: unknown,
  localScope: RtcAddressScope,
  remoteScope: RtcAddressScope,
): boolean {
  if (localType === 'host' && remoteType === 'host') {
    // Keep address-hidden/mDNS host pairs compatible, but do not label an
    // explicitly identified overlay or public host pair as physical LAN.
    return !isExplicitlyNonLanScope(localScope) && !isExplicitlyNonLanScope(remoteScope)
  }
  const directTypes = new Set(['host', 'prflx'])
  if (!directTypes.has(String(localType)) || !directTypes.has(String(remoteType))) return false
  if (isLocalNetworkScope(localScope) && isLocalNetworkScope(remoteScope)) return true
  // libwebrtc commonly represents an mDNS-obscured LAN endpoint as prflx and
  // withholds its address from getStats(). Keep an explicitly public/cgnat
  // peer-reflexive endpoint as P2P, but accept the private host + unknown prflx
  // shape emitted by Android and @roamhq/wrtc for a selected LAN path.
  return (localType === 'host' && isLocalNetworkScope(localScope)
      && remoteType === 'prflx' && remoteScope === 'unknown')
    || (remoteType === 'host' && isLocalNetworkScope(remoteScope)
      && localType === 'prflx' && localScope === 'unknown')
}

function isLocalNetworkScope(scope: RtcAddressScope): boolean {
  return scope === 'private' || scope === 'link-local' || scope === 'loopback'
}

function isExplicitlyNonLanScope(scope: RtcAddressScope): boolean {
  return scope === 'public' || scope === 'cgnat' || scope === 'reserved'
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

function selectedPathTelemetry(details: RtcPathDetails): RtcSelectedPathTelemetry {
  return {
    ...(details.transport === undefined ? {} : { transport: details.transport }),
    ...(details.mode === undefined ? {} : { mode: details.mode }),
    ...(details.relayUrl === undefined ? {} : { relayUrl: details.relayUrl }),
    ...(details.localCandidateType === undefined ? {} : { localCandidateType: details.localCandidateType }),
    ...(details.remoteCandidateType === undefined ? {} : { remoteCandidateType: details.remoteCandidateType }),
    ...(details.localAddressScope === undefined ? {} : { localAddressScope: details.localAddressScope }),
    ...(details.remoteAddressScope === undefined ? {} : { remoteAddressScope: details.remoteAddressScope }),
    ...(details.protocol === undefined ? {} : { protocol: details.protocol }),
    ...(details.relayProtocol === undefined ? {} : { relayProtocol: details.relayProtocol }),
    ...(details.currentRoundTripTimeMs === undefined ? {} : { currentRoundTripTimeMs: details.currentRoundTripTimeMs }),
    ...(details.availableOutgoingBitrate === undefined ? {} : { availableOutgoingBitrate: details.availableOutgoingBitrate }),
  }
}

function requireSdp(description: { type: 'offer' | 'answer'; sdp?: string }): string {
  if (typeof description.sdp !== 'string' || description.sdp.length === 0) {
    throw new RtcConnectError('RTC_FAILED', 'The RTC backend produced an empty session description.')
  }
  return description.sdp
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data.buffer as ArrayBuffer
  return data.slice().buffer as ArrayBuffer
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new RtcConnectError('RTC_FAILED', 'WebRTC negotiation failed.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
