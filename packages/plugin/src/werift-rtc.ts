/**
 * Node RTC factory (webrtc-implementation-plan.md §6.2).
 *
 * Native libwebrtc is preferred when present because its ICE behavior matches
 * browser Remote Web. werift remains the pure-TypeScript fallback for systems
 * without a loadable native addon. Both backends are loaded lazily so DSH
 * startup remains unaffected when WebRTC is unused or `forceRelay` is enabled.
 */

import { createSocket } from 'node:dgram'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type {
  RtcCandidateSummary,
  RtcDataChannel,
  RtcDataChannelInit,
  RtcIceCandidateInit,
  RtcIceServer,
  RtcPeerConnection,
  RtcPeerConnectionFactory,
  RtcSessionDescriptionInit,
  RtcStats,
} from '@dsh-remote/webrtc'
import { summarizeAddress, summarizeIceCandidate } from '@dsh-remote/webrtc'
import { normalizeSdpMLineIndex } from '@dsh-remote/protocol'
import { loadExternalNativeRtcFactory } from './native-rtc-helper.js'

interface WeriftModule {
  RTCPeerConnection: new (config?: WeriftConfig) => WeriftPeerConnection
}

interface WeriftConfig {
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>
  iceAdditionalHostAddresses?: string[]
  iceFilterCandidatePair?: (pair: WeriftCandidatePair) => boolean
  iceUseIpv4?: boolean
  iceUseIpv6?: boolean
  iceUseLinkLocalAddress?: boolean
  iceInterfaceAddresses?: { udp4?: string; udp6?: string }
}

interface WeriftCandidate {
  host?: string
  type?: string
  relatedAddress?: string
}

interface WeriftCandidatePair {
  localCandidate?: WeriftCandidate
}

interface WeriftPeerConnection {
  connectionState: string
  iceConnectionState: string
  iceGatheringState: string
  signalingState: string
  onconnectionstatechange: (() => void) | null
  oniceconnectionstatechange: (() => void) | null
  onicegatheringstatechange: (() => void) | null
  onicecandidate: ((event: { candidate?: { toJSON(): RtcIceCandidateInit } }) => void) | null
  ondatachannel: ((event: { channel: WeriftDataChannel }) => void) | null
  createDataChannel(label: string, options: { ordered: boolean }): WeriftDataChannel
  createOffer(): Promise<{ type: 'offer' | 'answer'; sdp: string }>
  createAnswer(): Promise<{ type: 'offer' | 'answer'; sdp: string }>
  setLocalDescription(description?: { type: string; sdp?: string }): Promise<unknown>
  setRemoteDescription(description: { type: string; sdp?: string }): Promise<void>
  addIceCandidate(candidate?: RtcIceCandidateInit | null): Promise<void>
  getStats(): Promise<RtcStats>
  close(): Promise<void>
}

interface WeriftDataChannel {
  readonly label: string
  readonly ordered: boolean
  readyState: string
  bufferedAmount: number
  onopen: (() => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  onmessage: ((event: { data: string | Uint8Array }) => void) | null
  send(data: Buffer | string): void
  close(): void
}

let cachedFactory: RtcPeerConnectionFactory | undefined
let cachedWerift: WeriftModule | undefined
let cachedNativeFactory: RtcPeerConnectionFactory | undefined

interface NativeRtcModule {
  RTCPeerConnection?: new (config?: { iceServers?: RtcIceServer[] }) => NativePeerConnection
  default?: {
    RTCPeerConnection?: new (config?: { iceServers?: RtcIceServer[] }) => NativePeerConnection
  }
}

interface NativePeerConnection {
  connectionState: string
  iceConnectionState: string
  iceGatheringState: string
  signalingState: string
  onconnectionstatechange: (() => void) | null
  oniceconnectionstatechange: (() => void) | null
  onicegatheringstatechange: (() => void) | null
  onicecandidate: ((event: { candidate: NativeIceCandidate | null }) => void) | null
  ondatachannel: ((event: { channel: NativeDataChannel }) => void) | null
  createDataChannel(label: string, options?: RtcDataChannelInit): NativeDataChannel
  createOffer(): Promise<RtcSessionDescriptionInit>
  createAnswer(): Promise<RtcSessionDescriptionInit>
  setLocalDescription(description?: RtcSessionDescriptionInit): Promise<void>
  setRemoteDescription(description: RtcSessionDescriptionInit): Promise<void>
  addIceCandidate(candidate?: RtcIceCandidateInit | null): Promise<void>
  getStats(): Promise<RtcStats>
  close(): void
}

interface NativeIceCandidate extends RtcIceCandidateInit {
  toJSON?: () => RtcIceCandidateInit
}

interface NativeDataChannel {
  readonly label: string
  readonly ordered: boolean
  readyState: string
  bufferedAmount: number
  binaryType: string
  onopen: (() => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onbufferedamountlow: (() => void) | null
  send(data: Buffer | ArrayBuffer | string): void
  close(): void
}

/**
 * Node RTC factory used by the Plugin/VS Code clients and Host. Native
 * libwebrtc is preferred because its ICE behavior matches browser Remote Web;
 * werift remains the no-native fallback for environments that cannot load it.
 */
export async function loadNodeRtcFactory(options: WeriftFactoryOptions = {}): Promise<RtcPeerConnectionFactory | undefined> {
  const nativeFactory = isElectronRuntime()
    ? await loadExternalNativeRtcFactory().catch(() => undefined)
    : await loadNativeRtcFactory().catch(() => undefined)
  return nativeFactory ?? await loadWeriftFactory(options)
}

/** Load (once) a werift-backed factory, or `undefined` when it cannot be loaded. */
export async function loadWeriftFactory(options: WeriftFactoryOptions = {}): Promise<RtcPeerConnectionFactory | undefined> {
  const cacheable = isCacheableFactoryOptions(options)
  if (cacheable && cachedFactory !== undefined) return cachedFactory
  try {
    const werift = cachedWerift ?? ((await import('werift')) as unknown as WeriftModule)
    cachedWerift = werift
    const routeCandidates = options.preferredHostIpv4Candidates
      ?? await detectRouteHostIpv4Candidates(options.routeTargets ?? [], options.routeProbeTimeoutMs)
    const factory = buildWeriftFactory(werift, { ...options, preferredHostIpv4Candidates: routeCandidates })
    if (cacheable) cachedFactory = factory
    return factory
  } catch {
    return undefined
  }
}

async function loadNativeRtcFactory(): Promise<RtcPeerConnectionFactory | undefined> {
  if (cachedNativeFactory !== undefined) return cachedNativeFactory
  try {
    const wrtc = (await import('@roamhq/wrtc')) as unknown as NativeRtcModule
    const RTCPeerConnection = wrtc.RTCPeerConnection ?? wrtc.default?.RTCPeerConnection
    if (RTCPeerConnection === undefined) return undefined
    cachedNativeFactory = buildNativeRtcFactory(RTCPeerConnection)
    return cachedNativeFactory
  } catch {
    return undefined
  }
}

function isElectronRuntime(): boolean {
  const versions = process.versions as NodeJS.ProcessVersions & { electron?: string }
  return typeof versions.electron === 'string' || process.env.ELECTRON_RUN_AS_NODE === '1'
}

function buildNativeRtcFactory(
  RTCPeerConnection: new (config?: { iceServers?: RtcIceServer[] }) => NativePeerConnection,
): RtcPeerConnectionFactory {
  return {
    create(configuration) {
      const raw = new RTCPeerConnection({ iceServers: configuration.iceServers })
      return {
        get connectionState(): string { return raw.connectionState },
        get iceConnectionState(): string { return raw.iceConnectionState },
        get iceGatheringState(): string { return raw.iceGatheringState },
        get signalingState(): string { return raw.signalingState },
        set onconnectionstatechange(value) { raw.onconnectionstatechange = value },
        get onconnectionstatechange() { return raw.onconnectionstatechange },
        set oniceconnectionstatechange(value) { raw.oniceconnectionstatechange = value },
        get oniceconnectionstatechange() { return raw.oniceconnectionstatechange },
        set onicegatheringstatechange(value) { raw.onicegatheringstatechange = value },
        get onicegatheringstatechange() { return raw.onicegatheringstatechange },
        set onicecandidate(value) {
          raw.onicecandidate = value === null ? null : event => value({
            candidate: event.candidate === null ? null : normalizeNativeCandidate(event.candidate),
          })
        },
        get onicecandidate() { return raw.onicecandidate as ((event: { candidate: RtcIceCandidateInit | null }) => void) | null },
        set ondatachannel(value) {
          raw.ondatachannel = value === null ? null : event => value({ channel: adaptNativeDataChannel(event.channel) })
        },
        get ondatachannel() { return raw.ondatachannel as ((event: { channel: RtcDataChannel }) => void) | null },
        createDataChannel(label, options) { return adaptNativeDataChannel(raw.createDataChannel(label, options)) },
        createOffer() { return raw.createOffer() },
        createAnswer() { return raw.createAnswer() },
        setLocalDescription(description) { return raw.setLocalDescription(description) },
        setRemoteDescription(description) { return raw.setRemoteDescription(description) },
        addIceCandidate(candidate) { return raw.addIceCandidate(candidate) },
        getStats() { return raw.getStats() },
        close() { raw.close() },
      }
    },
  }
}

export interface WeriftFactoryOptions {
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[] | undefined>
  preferredHostIpv4Candidates?: readonly string[]
  routeTargets?: readonly string[]
  routeProbeTimeoutMs?: number
}

/** Synchronous factory for tests and callers that already resolved werift. */
export function buildWeriftFactory(werift: WeriftModule, options: WeriftFactoryOptions = {}): RtcPeerConnectionFactory {
  return {
    create(configuration) {
      const hostIpv4Candidates = detectHostIpv4Candidates(
        options.interfaces ?? networkInterfaces(),
        options.preferredHostIpv4Candidates,
      )
      const allowedHostIpv4 = new Set(hostIpv4Candidates)
      const raw = new werift.RTCPeerConnection({
        iceServers: orderIceServersForWerift(configuration.iceServers ?? []) as RtcIceServer[],
        iceUseIpv4: true,
        iceUseIpv6: false,
        iceUseLinkLocalAddress: false,
        ...(hostIpv4Candidates.length === 0
          ? {}
          : {
              iceAdditionalHostAddresses: hostIpv4Candidates,
              iceFilterCandidatePair: pair => {
                const allowed = shouldUseCandidatePair(pair, allowedHostIpv4)
                if (!allowed) {
                  configuration.onDiagnostic?.({
                    type: 'candidate-pair-filtered',
                    localCandidate: summarizeWeriftCandidate(localCandidate(pair)),
                    reason: 'local-host-not-allowed',
                  })
                }
                return allowed
              },
            }),
      })

      let onIceCandidate: ((event: { candidate: RtcIceCandidateInit | null }) => void) | null = null
      let onDataChannel: ((event: { channel: RtcDataChannel }) => void) | null = null
      raw.onicecandidate = event => {
        if (onIceCandidate === null) return
        const candidate = event.candidate === undefined ? null : event.candidate.toJSON()
        if (candidate !== null && !shouldAdvertiseCandidate(candidate, allowedHostIpv4)) {
          configuration.onDiagnostic?.({
            type: 'local-candidate-filtered',
            candidate: summarizeIceCandidate(candidate),
            reason: 'local-host-not-allowed',
          })
          return
        }
        onIceCandidate({ candidate })
      }
      raw.ondatachannel = event => {
        if (onDataChannel === null) return
        onDataChannel({ channel: adaptDataChannel(event.channel) })
      }

      const pc: RtcPeerConnection = {
        get connectionState(): string { return raw.connectionState },
        get iceConnectionState(): string { return raw.iceConnectionState },
        get iceGatheringState(): string { return raw.iceGatheringState },
        get signalingState(): string { return raw.signalingState },
        set onconnectionstatechange(value) { raw.onconnectionstatechange = value },
        get onconnectionstatechange() { return raw.onconnectionstatechange },
        set oniceconnectionstatechange(value) { raw.oniceconnectionstatechange = value },
        get oniceconnectionstatechange() { return raw.oniceconnectionstatechange },
        set onicegatheringstatechange(value) { raw.onicegatheringstatechange = value },
        get onicegatheringstatechange() { return raw.onicegatheringstatechange },
        set onicecandidate(value) { onIceCandidate = value },
        get onicecandidate() { return onIceCandidate },
        set ondatachannel(value) { onDataChannel = value },
        get ondatachannel() { return onDataChannel },
        createDataChannel(label, options) {
          return adaptDataChannel(raw.createDataChannel(label, { ordered: options?.ordered ?? true }))
        },
        createOffer() { return raw.createOffer() },
        createAnswer() { return raw.createAnswer() },
        setLocalDescription(description) { return raw.setLocalDescription(description).then(() => undefined) },
        setRemoteDescription(description) { return raw.setRemoteDescription(description) },
        addIceCandidate(candidate) { return raw.addIceCandidate(candidate) },
        getStats() { return raw.getStats() },
        close() { void raw.close().catch(() => undefined) },
      }
      return pc
    },
  }
}

function adaptDataChannel(raw: WeriftDataChannel): RtcDataChannel {
  return {
    get label(): string { return raw.label },
    get ordered(): boolean { return raw.ordered },
    get readyState() { return raw.readyState as RtcDataChannel['readyState'] },
    get bufferedAmount(): number { return raw.bufferedAmount },
    binaryType: 'arraybuffer',
    set onopen(value: (() => void) | null) { raw.onopen = value },
    get onopen(): (() => void) | null { return raw.onopen },
    set onmessage(value: ((event: { data: ArrayBuffer | string }) => void) | null) {
      raw.onmessage = value === null ? null : event => value({ data: toArrayBuffer(event.data) })
    },
    get onmessage(): ((event: { data: ArrayBuffer | string }) => void) | null { return null },
    set onclose(value: (() => void) | null) { raw.onclose = value },
    get onclose(): (() => void) | null { return raw.onclose },
    set onerror(value: (() => void) | null) { raw.onerror = value },
    get onerror(): (() => void) | null { return raw.onerror },
    onbufferedamountlow: null,
    send(data: ArrayBuffer | string) {
      const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
      try {
        raw.send(typeof data === 'string' ? data : Buffer.from(data))
      } catch (error) {
        console.error('[werift-send-error] bytes=' + bytes, error instanceof Error ? error.message : error)
        throw error
      }
    },
    close() { raw.close() },
  }
}

function adaptNativeDataChannel(raw: NativeDataChannel): RtcDataChannel {
  let onmessage: ((event: { data: ArrayBuffer | string }) => void) | null = null
  return {
    get label(): string { return raw.label },
    get ordered(): boolean { return raw.ordered },
    get readyState() { return raw.readyState as RtcDataChannel['readyState'] },
    get bufferedAmount(): number { return raw.bufferedAmount },
    get binaryType(): string { return raw.binaryType },
    set binaryType(value: string) { raw.binaryType = value },
    set onopen(value: (() => void) | null) { raw.onopen = value },
    get onopen(): (() => void) | null { return raw.onopen },
    set onmessage(value: ((event: { data: ArrayBuffer | string }) => void) | null) {
      onmessage = value
      raw.onmessage = value === null ? null : event => value({ data: normalizeNativeMessageData(event.data) })
    },
    get onmessage(): ((event: { data: ArrayBuffer | string }) => void) | null { return onmessage },
    set onclose(value: (() => void) | null) { raw.onclose = value },
    get onclose(): (() => void) | null { return raw.onclose },
    set onerror(value: (() => void) | null) { raw.onerror = value },
    get onerror(): (() => void) | null { return raw.onerror },
    set onbufferedamountlow(value: (() => void) | null) { raw.onbufferedamountlow = value },
    get onbufferedamountlow(): (() => void) | null { return raw.onbufferedamountlow },
    send(data: ArrayBuffer | string) {
      raw.send(typeof data === 'string' ? data : Buffer.from(data))
    },
    close() { raw.close() },
  }
}

function toArrayBuffer(data: string | Uint8Array): ArrayBuffer | string {
  if (typeof data === 'string') return data
  // `Buffer.prototype.slice()` (unlike `Uint8Array.prototype.slice()`) returns a
  // *view* over the pooled 8 KiB receive buffer, so slicing the underlying
  // ArrayBuffer by byte offset/length is required to extract just the message.
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function normalizeNativeCandidate(candidate: NativeIceCandidate): RtcIceCandidateInit {
  const json = typeof candidate.toJSON === 'function'
    ? candidate.toJSON()
    : {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      }
  return {
    ...json,
    sdpMLineIndex: normalizeSdpMLineIndex(json.sdpMLineIndex),
  }
}

function normalizeNativeMessageData(data: unknown): ArrayBuffer | string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }
  return new Uint8Array().buffer
}

/**
 * Pick the safe IPv4 host addresses for ICE gathering.
 *
 * On macOS a host exposes many interfaces (WiFi `en0`, Thunderbolt `en1-4`,
 * `bridge*`, Apple Wireless Direct Link `awdl0`/`llw0`, and several VPN `utun*`
 * tunnels whose small MTUs drop large SCTP packets). Let werift/ICE compare
 * real physical interfaces, but filter virtual and link-local Host candidates
 * before they can become nominated paths.
 */
export function detectHostIpv4Candidates(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[] | undefined>,
  preferredHostIpv4Candidates: readonly string[] = [],
): string[] {
  const candidates: Array<{ name: string; ip: string; score: number }> = []
  const routePreference = new Map(preferredHostIpv4Candidates.map((ip, index) => [ip, 10_000 - index]))
  for (const [name, addresses] of Object.entries(interfaces)) {
    const interfaceScore = physicalInterfaceScore(name)
    if (interfaceScore === undefined) continue
    for (const address of addresses ?? []) {
      if (address.internal || !isIpv4Family(address.family)) continue
      const ip = address.address
      if (!isUsableIpv4(ip)) continue
      candidates.push({
        name,
        ip,
        score: interfaceScore + (isPrivate(ip) ? 1_000 : 0) + (routePreference.get(ip) ?? 0),
      })
    }
  }
  candidates.sort((left, right) => {
    const score = right.score - left.score
    if (score !== 0) return score
    const name = left.name.localeCompare(right.name, 'en')
    return name === 0 ? left.ip.localeCompare(right.ip, 'en', { numeric: true }) : name
  })
  return [...new Set(candidates.map(candidate => candidate.ip))]
}

export async function detectRouteHostIpv4Candidates(
  targets: readonly string[],
  timeoutMs = 500,
): Promise<string[]> {
  const detected = await Promise.all(targets.map(async target => {
    const routeTarget = parseRouteTarget(target)
    return routeTarget === undefined ? undefined : await detectRouteHostIpv4(routeTarget, timeoutMs).catch(() => undefined)
  }))
  return [...new Set(detected.filter((ip): ip is string => ip !== undefined && isUsableIpv4(ip)))]
}

function shouldUseCandidatePair(pair: WeriftCandidatePair, allowedHostIpv4: ReadonlySet<string>): boolean {
  if (allowedHostIpv4.size === 0) return true
  const candidate = localCandidate(pair)
  if (candidate === undefined) return true
  return shouldUseLocalCandidate(candidate, allowedHostIpv4)
}

export function shouldAdvertiseCandidate(candidate: RtcIceCandidateInit, allowedHostIpv4: ReadonlySet<string>): boolean {
  if (allowedHostIpv4.size === 0) return true
  const parsed = parseIceCandidate(candidate)
  if (parsed === undefined) return true
  return shouldUseLocalCandidate(parsed, allowedHostIpv4)
}

function shouldUseLocalCandidate(candidate: WeriftCandidate, allowedHostIpv4: ReadonlySet<string>): boolean {
  if (candidate.type === 'host') return candidate.host !== undefined && allowedHostIpv4.has(candidate.host)
  if (candidate.type === 'srflx' && candidate.relatedAddress !== undefined) {
    return allowedHostIpv4.has(candidate.relatedAddress)
  }
  return true
}

function localCandidate(pair: WeriftCandidatePair): WeriftCandidate | undefined {
  try {
    return pair.localCandidate
  } catch {
    return undefined
  }
}

function summarizeWeriftCandidate(candidate: WeriftCandidate | undefined): RtcCandidateSummary | undefined {
  if (candidate === undefined) return undefined
  const address = summarizeAddress(candidate.host)
  const related = summarizeAddress(candidate.relatedAddress)
  return {
    candidateType: candidate.type === 'host' || candidate.type === 'srflx' || candidate.type === 'prflx' || candidate.type === 'relay'
      ? candidate.type
      : 'unknown',
    ...address,
    ...(candidate.relatedAddress === undefined
      ? {}
      : { relatedAddressFamily: related.addressFamily, relatedAddressScope: related.addressScope }),
  }
}

export function orderIceServersForWerift(iceServers: readonly RtcIceServer[]): RtcIceServer[] {
  return iceServers.map(server => {
    const urls = Array.isArray(server.urls) ? [...server.urls] : [server.urls]
    urls.sort((left, right) => iceUrlScore(left) - iceUrlScore(right))
    return { ...server, urls: Array.isArray(server.urls) ? urls : urls[0] ?? server.urls }
  })
}

function iceUrlScore(url: string): number {
  const value = url.trim().toLowerCase()
  if (value.startsWith('stun:') || value.startsWith('stuns:')) return 0
  if (value.startsWith('turn:') && value.includes('transport=tcp')) return 10
  if (value.startsWith('turns:') && value.includes('transport=tcp')) return 20
  if (value.startsWith('turn:') && value.includes('transport=udp')) return 30
  if (value.startsWith('turns:')) return 40
  if (value.startsWith('turn:')) return 50
  return 100
}

interface ParsedRouteTarget {
  host: string
  port: number
}

function parseRouteTarget(value: string): ParsedRouteTarget | undefined {
  try {
    const url = new URL(value)
    const port = Number(url.port || (url.protocol === 'http:' ? '80' : '443'))
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535 || url.hostname.length === 0) return undefined
    return { host: url.hostname, port }
  } catch {
    return undefined
  }
}

async function detectRouteHostIpv4(target: ParsedRouteTarget, timeoutMs: number): Promise<string | undefined> {
  const socket = createSocket('udp4')
  try {
    return await new Promise<string | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve(undefined)
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        socket.off('error', onError)
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      socket.once('error', onError)
      socket.connect(target.port, target.host, () => {
        cleanup()
        const address = socket.address()
        resolve(typeof address === 'string' ? undefined : address.address)
      })
    })
  } finally {
    socket.close()
  }
}

function isCacheableFactoryOptions(options: WeriftFactoryOptions): boolean {
  return options.interfaces === undefined
    && options.preferredHostIpv4Candidates === undefined
    && options.routeTargets === undefined
}

function parseIceCandidate(candidate: RtcIceCandidateInit): WeriftCandidate | undefined {
  const value = candidate.candidate?.trim()
  if (value === undefined || value.length === 0) return undefined
  const parts = value.replace(/^candidate:/, '').split(/\s+/)
  const typeIndex = parts.indexOf('typ')
  if (typeIndex < 0) return undefined
  const host = parts[4]
  const type = parts[typeIndex + 1]
  const relatedAddressIndex = parts.indexOf('raddr')
  return {
    ...(host === undefined ? {} : { host }),
    ...(type === undefined ? {} : { type }),
    ...(relatedAddressIndex < 0 || parts[relatedAddressIndex + 1] === undefined
      ? {}
      : { relatedAddress: parts[relatedAddressIndex + 1] }),
  }
}

function physicalInterfaceScore(name: string): number | undefined {
  const value = name.toLowerCase()
  if (/^(utun|tun|tap|ppp|bridge|awdl|llw|gif|stf|anpi|ap\d|vmnet|veth|docker|br-|vboxnet|lo)/.test(value)) {
    return undefined
  }
  if (/^(eth|eno|ens|enp)/.test(value)) return 500
  if (/^(en|wlan|wl|wifi|wi-fi)/.test(value)) return 450
  return 300
}

function isIpv4Family(family: string | number): boolean {
  return family === 'IPv4' || family === 4
}

function isUsableIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  if (parts[0] === 0 || parts[0] === 127 || parts[0] >= 224) return false
  if (parts[0] === 169 && parts[1] === 254) return false
  return !isCgnat(ip)
}

function isCgnat(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

function isPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return false
  if (parts[0] === 10) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
}
