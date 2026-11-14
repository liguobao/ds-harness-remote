/**
 * Environment-agnostic RTC peer-connection surface.
 *
 * The transport state machine only talks to these narrow interfaces so the
 * browser native `RTCPeerConnection` and a future Node host backend can both
 * provide the underlying peer connection without the business code depending
 * on a specific RTC implementation (webrtc-implementation-plan.md §6.1/§6.2).
 */

export interface RtcIceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface RtcIceCandidateInit {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type RtcCandidateType = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown'
export type RtcAddressFamily = 'ipv4' | 'ipv6' | 'unknown'
export type RtcAddressScope = 'private' | 'public' | 'loopback' | 'link-local' | 'cgnat' | 'reserved' | 'unknown'

export interface RtcCandidateSummary {
  candidateType: RtcCandidateType
  protocol?: string
  addressFamily: RtcAddressFamily
  addressScope: RtcAddressScope
  relatedAddressFamily?: RtcAddressFamily
  relatedAddressScope?: RtcAddressScope
}

export type RtcPeerConnectionDiagnosticEvent =
  | { type: 'local-candidate-filtered'; candidate: RtcCandidateSummary; reason: string }
  | { type: 'candidate-pair-filtered'; localCandidate?: RtcCandidateSummary; reason: string }

export interface RtcPeerConnectionConfiguration {
  iceServers?: RtcIceServer[]
  iceTransportPolicy?: 'all' | 'relay'
  onDiagnostic?: (event: RtcPeerConnectionDiagnosticEvent) => void
}

export interface RtcSessionDescriptionInit {
  type: 'offer' | 'answer'
  sdp?: string
}

export interface RtcDataChannelInit {
  ordered?: boolean
}

export interface RtcDataChannel {
  readonly label: string
  readonly ordered: boolean
  readyState: 'connecting' | 'open' | 'closing' | 'closed'
  bufferedAmount: number
  binaryType: string
  onopen: (() => void) | null
  onmessage: ((event: { data: ArrayBuffer | string }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  onbufferedamountlow: (() => void) | null
  send(data: ArrayBuffer | string): void
  close(): void
}

export interface RtcPeerConnection {
  connectionState: string
  iceConnectionState: string
  iceGatheringState: string
  signalingState: string
  onconnectionstatechange: (() => void) | null
  oniceconnectionstatechange: (() => void) | null
  onicegatheringstatechange: (() => void) | null
  onicecandidate: ((event: { candidate: RtcIceCandidateInit | null }) => void) | null
  ondatachannel: ((event: { channel: RtcDataChannel }) => void) | null
  createDataChannel(label: string, options?: RtcDataChannelInit): RtcDataChannel
  createOffer(): Promise<RtcSessionDescriptionInit>
  createAnswer(): Promise<RtcSessionDescriptionInit>
  setLocalDescription(description?: RtcSessionDescriptionInit): Promise<void>
  setRemoteDescription(description: RtcSessionDescriptionInit): Promise<void>
  addIceCandidate(candidate?: RtcIceCandidateInit): Promise<void>
  getStats(): Promise<RtcStats>
  close(): void
}

/** A single WebRTC stats report entry (id -> typed record). */
export interface RtcStatsEntry {
  type?: string
  [key: string]: unknown
}

export type RtcStats = Iterable<readonly [string, RtcStatsEntry]>

export interface RtcPeerConnectionFactory {
  create(configuration: RtcPeerConnectionConfiguration): RtcPeerConnection
}

export const RTC_DATA_CHANNEL_LABEL = 'dsh'
export const RTC_DATA_CHANNEL_OPTIONS = { ordered: true } as const

/**
 * Default browser-backed factory. This module is the only place in the webrtc
 * package that references the DOM `RTCPeerConnection` global, so Node hosts
 * inject their own factory and never import browser natives.
 */
/** Return false only if no send was attempted. Errors propagate without replaying data. */
export type RtcBinarySender = (channel: unknown, data: ArrayBuffer) => boolean

export function browserRtcFactory(options: { sendBinary?: RtcBinarySender } = {}): RtcPeerConnectionFactory {
  const binarySender = options.sendBinary
  return {
    create(configuration) {
      // `any` keeps the DOM handler `this`/event typing out of the adapter.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = new RTCPeerConnection({
        iceServers: configuration.iceServers,
        iceTransportPolicy: configuration.iceTransportPolicy,
      }) as any
      return {
        get connectionState(): string { return raw.connectionState as string },
        get iceConnectionState(): string { return raw.iceConnectionState as string },
        get iceGatheringState(): string { return raw.iceGatheringState as string },
        get signalingState(): string { return raw.signalingState as string },
        set onconnectionstatechange(value) { raw.onconnectionstatechange = value },
        get onconnectionstatechange() { return raw.onconnectionstatechange as (() => void) | null },
        set oniceconnectionstatechange(value) { raw.oniceconnectionstatechange = value },
        get oniceconnectionstatechange() { return raw.oniceconnectionstatechange as (() => void) | null },
        set onicegatheringstatechange(value) { raw.onicegatheringstatechange = value },
        get onicegatheringstatechange() { return raw.onicegatheringstatechange as (() => void) | null },
        set onicecandidate(value) { raw.onicecandidate = value },
        get onicecandidate() { return raw.onicecandidate as ((event: { candidate: RtcIceCandidateInit | null }) => void) | null },
        set ondatachannel(value) { raw.ondatachannel = value },
        get ondatachannel() { return raw.ondatachannel as ((event: { channel: RtcDataChannel }) => void) | null },
        createDataChannel(label, options) { return adaptDataChannel(raw.createDataChannel(label, options), binarySender) },
        createOffer() { return raw.createOffer() },
        createAnswer() { return raw.createAnswer() },
        setLocalDescription(description) { return raw.setLocalDescription(description) },
        setRemoteDescription(description) { return raw.setRemoteDescription(description) },
        addIceCandidate(candidate) { return raw.addIceCandidate(candidate) },
        async getStats() { return await raw.getStats() },
        close() { raw.close() },
      }
    },
  }
}

export function summarizeIceCandidate(candidate: RtcIceCandidateInit | undefined): RtcCandidateSummary {
  const value = candidate?.candidate?.trim()
  if (value === undefined || value.length === 0) return emptyCandidateSummary()
  const parts = value.replace(/^candidate:/, '').split(/\s+/)
  const typeIndex = parts.indexOf('typ')
  const relatedAddressIndex = parts.indexOf('raddr')
  return {
    candidateType: parseCandidateType(parts[typeIndex + 1]),
    protocol: normalizeProtocol(parts[2]),
    ...summarizeAddress(parts[4]),
    ...(relatedAddressIndex < 0
      ? {}
      : relatedAddressSummary(parts[relatedAddressIndex + 1])),
  }
}

export function summarizeAddress(address: string | undefined): { addressFamily: RtcAddressFamily; addressScope: RtcAddressScope } {
  if (address === undefined || address.length === 0) return { addressFamily: 'unknown', addressScope: 'unknown' }
  if (address.includes(':')) return { addressFamily: 'ipv6', addressScope: summarizeIpv6Scope(address) }
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return { addressFamily: 'unknown', addressScope: 'unknown' }
  }
  return { addressFamily: 'ipv4', addressScope: summarizeIpv4Scope(parts) }
}

export function stunOnlyIceServers(iceServers: readonly RtcIceServer[]): RtcIceServer[] {
  const direct: RtcIceServer[] = []
  for (const server of iceServers) {
    const sourceUrls = Array.isArray(server.urls) ? server.urls : [server.urls]
    const urls = sourceUrls.filter(isStunUrl)
    if (urls.length === 0) continue
    direct.push({ urls: Array.isArray(server.urls) ? urls : urls[0]! })
  }
  return direct
}

function isStunUrl(url: string): boolean {
  const value = url.trim().toLowerCase()
  return value.startsWith('stun:') || value.startsWith('stuns:')
}

function emptyCandidateSummary(): RtcCandidateSummary {
  return { candidateType: 'unknown', addressFamily: 'unknown', addressScope: 'unknown' }
}

function parseCandidateType(value: string | undefined): RtcCandidateType {
  if (value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay') return value
  return 'unknown'
}

function normalizeProtocol(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  return value.toLowerCase()
}

function relatedAddressSummary(address: string | undefined): Pick<RtcCandidateSummary, 'relatedAddressFamily' | 'relatedAddressScope'> {
  const summary = summarizeAddress(address)
  return {
    relatedAddressFamily: summary.addressFamily,
    relatedAddressScope: summary.addressScope,
  }
}

function summarizeIpv4Scope(parts: number[]): RtcAddressScope {
  if (parts[0] === 0 || parts[0] >= 240) return 'reserved'
  if (parts[0] === 127) return 'loopback'
  if (parts[0] === 169 && parts[1] === 254) return 'link-local'
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return 'cgnat'
  if (parts[0] >= 224) return 'reserved'
  if (parts[0] === 10) return 'private'
  if (parts[0] === 192 && parts[1] === 168) return 'private'
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 'private'
  return 'public'
}

function summarizeIpv6Scope(address: string): RtcAddressScope {
  const value = address.toLowerCase()
  if (value === '::1') return 'loopback'
  if (value.startsWith('fe80:')) return 'link-local'
  // Tailscale assigns overlay addresses from fd7a:115c:a1e0::/48. They are
  // ULA-shaped, but a selected pair using them is not evidence of a physical
  // LAN path. Reuse the non-LAN cgnat scope used for Tailscale's IPv4 range.
  if (value.startsWith('fd7a:115c:a1e0:')) return 'cgnat'
  if (value.startsWith('fc') || value.startsWith('fd')) return 'private'
  if (value.startsWith('ff')) return 'reserved'
  return 'public'
}

function adaptDataChannel(raw: RTCDataChannel, sendBinary?: RtcBinarySender): RtcDataChannel {
  return {
    get label(): string { return raw.label },
    get ordered(): boolean { return raw.ordered },
    get readyState() { return raw.readyState },
    get bufferedAmount(): number { return raw.bufferedAmount },
    get binaryType(): string { return raw.binaryType },
    set binaryType(value: string) { raw.binaryType = value as typeof raw.binaryType },
    set onopen(value) { raw.onopen = value },
    get onopen() { return raw.onopen as (() => void) | null },
    set onmessage(value) { raw.onmessage = value },
    get onmessage() { return raw.onmessage as ((event: { data: ArrayBuffer | string }) => void) | null },
    set onclose(value) { raw.onclose = value },
    get onclose() { return raw.onclose as (() => void) | null },
    set onerror(value) { raw.onerror = value },
    get onerror() { return raw.onerror as (() => void) | null },
    set onbufferedamountlow(value) { raw.onbufferedamountlow = value },
    get onbufferedamountlow() { return raw.onbufferedamountlow as (() => void) | null },
    send(data) {
      if (data instanceof ArrayBuffer && sendBinary?.(raw, data)) return
      raw.send(data as never)
    },
    close() { raw.close() },
  }
}
