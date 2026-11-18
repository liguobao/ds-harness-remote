import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  RtcDataChannel,
  RtcDataChannelInit,
  RtcIceCandidateInit,
  RtcIceServer,
  RtcPeerConnection,
  RtcPeerConnectionConfiguration,
  RtcPeerConnectionFactory,
  RtcSessionDescriptionInit,
  RtcStats,
  RtcStatsEntry,
} from '@dsh-remote/webrtc'
import { normalizeSdpMLineIndex } from '@dsh-remote/protocol'

interface HelperResponse {
  id: number
  ok: boolean
  value?: unknown
  error?: string
}

type HelperEvent =
  | {
      event: 'state'
      connectionState: string
      iceConnectionState: string
      iceGatheringState: string
      signalingState: string
    }
  | { event: 'icecandidate'; candidate: RtcIceCandidateInit | null }
  | {
      event: 'datachannel'
      channelId: number
      label: string
      ordered: boolean
      readyState: RtcDataChannel['readyState']
      bufferedAmount: number
    }
  | {
      event: 'channel-state'
      channelId: number
      readyState: RtcDataChannel['readyState']
      bufferedAmount: number
    }
  | { event: 'channel-message'; channelId: number; text?: string; base64?: string }
  | { event: 'channel-error'; channelId: number }

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

let cachedExternalFactory: RtcPeerConnectionFactory | undefined
let cachedExternalFactoryResolved = false
let cachedNodeBinary: string | undefined
let cachedNodeBinaryResolved = false

export async function loadExternalNativeRtcFactory(): Promise<RtcPeerConnectionFactory | undefined> {
  if (cachedExternalFactory !== undefined) return cachedExternalFactory
  if (cachedExternalFactoryResolved) return undefined
  cachedExternalFactoryResolved = true
  const nodeBinary = resolveExternalNodeBinaryForRtc()
  if (nodeBinary === undefined) return undefined
  cachedExternalFactory = buildExternalNativeRtcFactory(nodeBinary)
  return cachedExternalFactory
}

export function buildExternalNativeRtcFactory(
  nodeBinary: string,
  requireFrom = resolveNativeRtcRequireFrom(),
): RtcPeerConnectionFactory {
  return {
    create(configuration) {
      return new ExternalNativePeerConnection(nodeBinary, requireFrom, configuration)
    },
  }
}

/**
 * Resolve dependencies from the plugin's physical package location.
 *
 * DSH profiles load plugins through a top-level symlink (or a Windows
 * junction), while pnpm links optional dependencies such as `@roamhq/wrtc`
 * beside the physical package under `.pnpm`. Using the surfaced plugin path
 * makes Node skip that virtual dependency directory and incorrectly reports
 * that the installed native backend is missing.
 */
export function resolveNativeRtcRequireFrom(moduleUrl = import.meta.url): string {
  const modulePath = fileURLToPath(moduleUrl)
  try {
    return realpathSync(modulePath)
  } catch {
    return modulePath
  }
}

function resolveExternalNodeBinaryForRtc(): string | undefined {
  if (cachedNodeBinaryResolved) return cachedNodeBinary
  cachedNodeBinaryResolved = true
  const requireFrom = resolveNativeRtcRequireFrom()
  for (const candidate of nodeBinaryCandidates()) {
    if (isUsableExternalNode(candidate, requireFrom)) {
      cachedNodeBinary = candidate
      return candidate
    }
  }
  return undefined
}

function nodeBinaryCandidates(): string[] {
  const candidates: string[] = []
  const add = (value: string | undefined): void => {
    if (value === undefined || value.trim() === '') return
    if (!candidates.includes(value)) candidates.push(value)
  }
  add(process.env.DSH_REMOTE_NODE)
  addBundledPrimaryRuntimeNode(candidates, process.env.DSH_PRIMARY_RUNTIME)
  addBundledPrimaryRuntimeNode(candidates, process.env.DSH_BUNDLED_PRIMARY_RUNTIME)
  add(process.env.NODE)
  add(process.execPath)
  for (const part of (process.env.PATH ?? '').split(delimiter)) add(join(part, process.platform === 'win32' ? 'node.exe' : 'node'))
  add('/opt/homebrew/bin/node')
  add('/usr/local/bin/node')
  add('/usr/bin/node')
  add(join(process.env.HOME ?? '', '.volta', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'))
  add(join(process.env.HOME ?? '', '.asdf', 'shims', process.platform === 'win32' ? 'node.exe' : 'node'))
  add(join(process.env.HOME ?? '', '.local', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'))
  for (const nvmNode of nvmNodeCandidates()) add(nvmNode)
  return candidates
}

function addBundledPrimaryRuntimeNode(candidates: string[], runtime: string | undefined): void {
  if (runtime === undefined || runtime.trim() === '') return
  addCandidate(candidates, join(runtime, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'))
}

function addCandidate(candidates: string[], value: string | undefined): void {
  if (value === undefined || value.trim() === '' || candidates.includes(value)) return
  candidates.push(value)
}

function nvmNodeCandidates(): string[] {
  const root = join(process.env.HOME ?? '', '.nvm', 'versions', 'node')
  if (root === '' || !existsSync(root)) return []
  try {
    return readdirSync(root)
      .map(version => join(root, version, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'))
      .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }))
  } catch {
    return []
  }
}

export function isUsableExternalNode(candidate: string, requireFrom: string): boolean {
  if (!isExecutableFile(candidate)) return false
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_REMOTE_RTC_HELPER_REQUIRE_FROM: requireFrom }
  // A candidate can be the Desktop's Electron executable or a launcher for it.
  // Probe in Node mode so it cannot open a second Desktop and leave its Host
  // writing into the probe's closed stdout pipe. Electron is still rejected below.
  env.ELECTRON_RUN_AS_NODE = '1'
  const probe = spawnSync(candidate, [
    '--input-type=module',
    '--eval',
    [
      "import { createRequire } from 'node:module';",
      "const require = createRequire(process.env.DSH_REMOTE_RTC_HELPER_REQUIRE_FROM);",
      "if (process.versions.electron) throw new Error('electron-node');",
      "const wrtc = require('@roamhq/wrtc');",
      "const RTCPeerConnection = wrtc.RTCPeerConnection ?? wrtc.default?.RTCPeerConnection;",
      "if (typeof RTCPeerConnection !== 'function') throw new Error('missing-rtc');",
      "console.log(`node:${process.versions.node}`);",
    ].join(''),
  ], {
    cwd: dirname(requireFrom),
    env,
    encoding: 'utf8',
    timeout: 3_000,
  })
  return probe.status === 0 && probe.stdout.startsWith('node:')
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = statSync(candidate)
    if (!stat.isFile()) return false
    if (process.platform === 'win32') return true
    return (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

class ExternalNativePeerConnection implements RtcPeerConnection {
  connectionState = 'new'
  iceConnectionState = 'new'
  iceGatheringState = 'new'
  signalingState = 'stable'
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onicegatheringstatechange: (() => void) | null = null
  onicecandidate: ((event: { candidate: RtcIceCandidateInit | null }) => void) | null = null
  ondatachannel: ((event: { channel: RtcDataChannel }) => void) | null = null

  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<number, PendingRequest>()
  private readonly channels = new Map<number, ExternalNativeDataChannel>()
  private nextRequestId = 1
  private nextChannelId = 1
  private stdout = ''
  private closed = false
  private readonly ready: Promise<void>

  constructor(
    private readonly nodeBinary: string,
    private readonly requireFrom: string,
    configuration: RtcPeerConnectionConfiguration,
  ) {
    this.child = spawn(this.nodeBinary, ['--input-type=module', '--eval', HELPER_SOURCE], {
      cwd: dirname(this.requireFrom),
      env: { ...process.env, DSH_REMOTE_RTC_HELPER_REQUIRE_FROM: this.requireFrom },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', chunk => this.handleStdout(String(chunk)))
    this.child.stderr.on('data', () => undefined)
    this.child.on('exit', () => this.handleExit())
    this.child.on('error', error => this.handleExit(error))
    this.child.stdin.on('error', error => this.handleExit(error))
    this.ready = this.request('init', { iceServers: configuration.iceServers ?? [] }).then(() => undefined)
  }

  createDataChannel(label: string, options?: RtcDataChannelInit): RtcDataChannel {
    const channelId = this.nextChannelId++
    const channel = new ExternalNativeDataChannel(this, channelId, label, options?.ordered ?? true)
    this.channels.set(channelId, channel)
    this.notify('createDataChannel', { channelId, label, options: { ordered: options?.ordered ?? true } })
    return channel
  }

  async createOffer(): Promise<RtcSessionDescriptionInit> {
    await this.ready
    return this.request('createOffer', {}) as Promise<RtcSessionDescriptionInit>
  }

  async createAnswer(): Promise<RtcSessionDescriptionInit> {
    await this.ready
    return this.request('createAnswer', {}) as Promise<RtcSessionDescriptionInit>
  }

  async setLocalDescription(description?: RtcSessionDescriptionInit): Promise<void> {
    await this.ready
    await this.request('setLocalDescription', { description })
  }

  async setRemoteDescription(description: RtcSessionDescriptionInit): Promise<void> {
    await this.ready
    await this.request('setRemoteDescription', { description })
  }

  async addIceCandidate(candidate?: RtcIceCandidateInit): Promise<void> {
    await this.ready
    await this.request('addIceCandidate', { candidate: candidate ?? null })
  }

  async getStats(): Promise<RtcStats> {
    await this.ready
    return this.request('getStats', {}) as Promise<Array<readonly [string, RtcStatsEntry]>>
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.notify('close', {})
    const timer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill()
    }, 1_000)
    timer.unref?.()
  }

  sendChannelData(channelId: number, data: ArrayBuffer | string): void {
    const payload = typeof data === 'string'
      ? { channelId, text: data }
      : { channelId, base64: Buffer.from(data).toString('base64') }
    this.notify('channelSend', payload)
  }

  closeChannel(channelId: number): void {
    this.notify('channelClose', { channelId })
  }

  private request(method: string, payload: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('native rtc helper is closed'))
    const id = this.nextRequestId++
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.write({ id, method, payload })
    return promise
  }

  private notify(method: string, payload: unknown): void {
    if (this.closed && method !== 'close') return
    this.write({ method, payload })
  }

  private write(message: unknown): void {
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch {
      this.handleExit(new Error('native rtc helper stdin is closed'))
    }
  }

  private handleStdout(chunk: string): void {
    this.stdout += chunk
    for (;;) {
      const newline = this.stdout.indexOf('\n')
      if (newline < 0) return
      const line = this.stdout.slice(0, newline)
      this.stdout = this.stdout.slice(newline + 1)
      if (line.trim() === '') continue
      try {
        this.handleMessage(JSON.parse(line) as HelperResponse | HelperEvent)
      } catch {
        this.handleExit(new Error('native rtc helper sent invalid JSON'))
      }
    }
  }

  private handleMessage(message: HelperResponse | HelperEvent): void {
    if ('id' in message) {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.value)
      else pending.reject(new Error(message.error ?? 'native rtc helper command failed'))
      return
    }
    if (message.event === 'state') {
      this.connectionState = message.connectionState
      this.iceConnectionState = message.iceConnectionState
      this.iceGatheringState = message.iceGatheringState
      this.signalingState = message.signalingState
      this.onconnectionstatechange?.()
      this.oniceconnectionstatechange?.()
      this.onicegatheringstatechange?.()
      return
    }
    if (message.event === 'icecandidate') {
      this.onicecandidate?.({ candidate: message.candidate })
      return
    }
    if (message.event === 'datachannel') {
      const channel = this.channelFor(message.channelId, message.label, message.ordered)
      this.ondatachannel?.({ channel })
      channel.updateState(message.readyState, message.bufferedAmount)
      return
    }
    if (message.event === 'channel-state') {
      this.channels.get(message.channelId)?.updateState(message.readyState, message.bufferedAmount)
      return
    }
    if (message.event === 'channel-message') {
      const channel = this.channels.get(message.channelId)
      if (channel === undefined) return
      if (message.text !== undefined) channel.emitMessage(message.text)
      else if (message.base64 !== undefined) channel.emitMessage(bufferToArrayBuffer(Buffer.from(message.base64, 'base64')))
      return
    }
    if (message.event === 'channel-error') {
      this.channels.get(message.channelId)?.emitError()
    }
  }

  private channelFor(channelId: number, label: string, ordered: boolean): ExternalNativeDataChannel {
    const existing = this.channels.get(channelId)
    if (existing !== undefined) return existing
    const channel = new ExternalNativeDataChannel(this, channelId, label, ordered)
    this.channels.set(channelId, channel)
    return channel
  }

  private handleExit(error?: Error): void {
    if (!this.closed) this.closed = true
    const reason = error ?? new Error('native rtc helper exited')
    for (const pending of this.pending.values()) pending.reject(reason)
    this.pending.clear()
    for (const channel of this.channels.values()) channel.updateState('closed', 0)
  }
}

class ExternalNativeDataChannel implements RtcDataChannel {
  readyState: RtcDataChannel['readyState'] = 'connecting'
  bufferedAmount = 0
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: ArrayBuffer | string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onbufferedamountlow: (() => void) | null = null

  constructor(
    private readonly owner: ExternalNativePeerConnection,
    private readonly channelId: number,
    readonly label: string,
    readonly ordered: boolean,
  ) {}

  send(data: ArrayBuffer | string): void {
    this.owner.sendChannelData(this.channelId, data)
  }

  close(): void {
    this.owner.closeChannel(this.channelId)
  }

  updateState(readyState: RtcDataChannel['readyState'], bufferedAmount: number): void {
    const previous = this.readyState
    this.readyState = readyState
    this.bufferedAmount = bufferedAmount
    if (previous !== 'open' && readyState === 'open') this.onopen?.()
    if (previous !== 'closed' && readyState === 'closed') this.onclose?.()
    if (bufferedAmount === 0) this.onbufferedamountlow?.()
  }

  emitMessage(data: ArrayBuffer | string): void {
    this.onmessage?.({ data })
  }

  emitError(): void {
    this.onerror?.()
  }
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

const HELPER_SOURCE = String.raw`
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'

const require = createRequire(process.env.DSH_REMOTE_RTC_HELPER_REQUIRE_FROM || (process.cwd() + '/package.json'))
const wrtc = require('@roamhq/wrtc')
const RTCPeerConnection = wrtc.RTCPeerConnection ?? wrtc.default?.RTCPeerConnection
if (typeof RTCPeerConnection !== 'function') throw new Error('missing RTCPeerConnection')

let pc
let nextRemoteChannelId = 100000
const channels = new Map()
let chain = Promise.resolve()

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function respond(id, ok, value, error) {
  if (id === undefined) return
  send(ok ? { id, ok: true, value } : { id, ok: false, error: String(error?.message ?? error ?? 'command failed') })
}

function state() {
  return {
    event: 'state',
    connectionState: pc?.connectionState ?? 'closed',
    iceConnectionState: pc?.iceConnectionState ?? 'closed',
    iceGatheringState: pc?.iceGatheringState ?? 'complete',
    signalingState: pc?.signalingState ?? 'closed',
  }
}

function emitState() {
  send(state())
}

function normalizeHelperSdpMLineIndex(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

function normalizeCandidate(candidate) {
  if (candidate === null || candidate === undefined) return null
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
    sdpMLineIndex: normalizeHelperSdpMLineIndex(json.sdpMLineIndex),
  }
}

function attachChannel(channelId, channel) {
  channels.set(channelId, channel)
  try { channel.binaryType = 'arraybuffer' } catch {}
  const emitChannel = () => send({
    event: 'channel-state',
    channelId,
    readyState: channel.readyState,
    bufferedAmount: channel.bufferedAmount ?? 0,
  })
  channel.onopen = emitChannel
  channel.onclose = emitChannel
  channel.onerror = () => send({ event: 'channel-error', channelId })
  channel.onmessage = event => {
    const data = event.data
    if (typeof data === 'string') {
      send({ event: 'channel-message', channelId, text: data })
      return
    }
    send({ event: 'channel-message', channelId, base64: Buffer.from(data).toString('base64') })
  }
  send({
    event: 'datachannel',
    channelId,
    label: channel.label,
    ordered: channel.ordered,
    readyState: channel.readyState,
    bufferedAmount: channel.bufferedAmount ?? 0,
  })
}

function serializeStats(stats) {
  const entries = []
  const push = (key, value) => {
    const copy = {}
    for (const [entryKey, entryValue] of Object.entries(value ?? {})) {
      if (typeof entryValue !== 'function') copy[entryKey] = entryValue
    }
    entries.push([String(key), copy])
  }
  if (typeof stats?.forEach === 'function') stats.forEach((value, key) => push(key, value))
  else for (const [key, value] of stats ?? []) push(key, value)
  return entries
}

async function handle(command) {
  const { id, method, payload = {} } = command
  try {
    if (method === 'init') {
      pc = new RTCPeerConnection({ iceServers: payload.iceServers ?? [] })
      pc.onconnectionstatechange = emitState
      pc.oniceconnectionstatechange = emitState
      pc.onicegatheringstatechange = emitState
      pc.onsignalingstatechange = emitState
      pc.onicecandidate = event => send({ event: 'icecandidate', candidate: normalizeCandidate(event.candidate) })
      pc.ondatachannel = event => attachChannel(nextRemoteChannelId++, event.channel)
      emitState()
      respond(id, true, {})
      return
    }
    if (method === 'createDataChannel') {
      const channel = pc.createDataChannel(payload.label, payload.options)
      attachChannel(payload.channelId, channel)
      respond(id, true, {})
      return
    }
    if (method === 'createOffer') {
      respond(id, true, await pc.createOffer())
      return
    }
    if (method === 'createAnswer') {
      respond(id, true, await pc.createAnswer())
      return
    }
    if (method === 'setLocalDescription') {
      await pc.setLocalDescription(payload.description)
      emitState()
      respond(id, true, {})
      return
    }
    if (method === 'setRemoteDescription') {
      await pc.setRemoteDescription(payload.description)
      emitState()
      respond(id, true, {})
      return
    }
    if (method === 'addIceCandidate') {
      await pc.addIceCandidate(payload.candidate)
      respond(id, true, {})
      return
    }
    if (method === 'getStats') {
      respond(id, true, serializeStats(await pc.getStats()))
      return
    }
    if (method === 'channelSend') {
      const channel = channels.get(payload.channelId)
      if (channel === undefined) throw new Error('unknown data channel')
      channel.send(payload.text ?? Buffer.from(payload.base64, 'base64'))
      respond(id, true, {})
      return
    }
    if (method === 'channelClose') {
      channels.get(payload.channelId)?.close()
      respond(id, true, {})
      return
    }
    if (method === 'close') {
      for (const channel of channels.values()) {
        try { channel.close() } catch {}
      }
      channels.clear()
      try { pc?.close() } catch {}
      respond(id, true, {})
      setTimeout(() => process.exit(0), 0)
      return
    }
    throw new Error('unknown method ' + method)
  } catch (error) {
    respond(id, false, undefined, error)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', line => {
  chain = chain.then(() => handle(JSON.parse(line))).catch(error => {
    send({ id: -1, ok: false, error: String(error?.message ?? error) })
  })
})
process.stdin.on('end', () => {
  try { pc?.close() } catch {}
  process.exit(0)
})
`
