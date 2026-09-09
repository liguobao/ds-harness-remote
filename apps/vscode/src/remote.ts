import { HarnessAlphaClient, RemoteClientCore, probeRemoteHostFeatures } from '@dsh-remote/client-core'
import { NoiseIkSession, createNoisePrologue } from '@dsh-remote/crypto'
import { SecureMessageCodec, type HarnessApiCallParams } from '@dsh-remote/protocol'
import {
  AdaptiveTransport,
  stunOnlyIceServers,
  type RemoteTransport,
  type RtcIceServer,
  type SecureHandshakeTransport,
} from '@dsh-remote/webrtc'
import { ServerApi } from './server-api.js'
import type { ChatMessage, DeviceIdentity, DirectoryListing, HistoryEntry, HostDescriptor, ModelSelection, MuxFrame, RemoteHost, RemoteSession, RemoteWorkspace, SessionModels } from './types.js'
import { loadNodeRtcFactory } from './werift-rtc.js'

type NativeResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
interface NativeResponse<T> { rpcId: string; result: NativeResult<T> }

type TransportAttempt = 'direct' | 'turn' | 'relay'

const DIRECT_WEBRTC_NEGOTIATE_TIMEOUT_MS = 12_000

export class RemoteConnection {
  private core?: RemoteClientCore
  private alpha?: HarnessAlphaClient
  private host?: RemoteHost
  private closeMux?: () => Promise<void>
  private readonly frameHandlers = new Set<(frame: MuxFrame) => void>()
  private readonly closeHandlers = new Set<() => void>()

  get connectedHost(): RemoteHost | undefined { return this.host }

  async connect(serverUrl: string, identity: DeviceIdentity, host: RemoteHost, accessToken: string, forceRelay: boolean): Promise<void> {
    await this.close()
    const wsUrl = new URL('/ws/v1/connect', serverUrl)
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    const rtcFactory = forceRelay ? undefined : await loadNodeRtcFactory({ routeTargets: [serverUrl] })
    const server = new ServerApi(serverUrl, accessToken)
    let webRtcFallback = false
    const createCore = (attempt: TransportAttempt): RemoteClientCore => {
      const transport = new AdaptiveTransport(wsUrl.toString(), {
        role: 'client', deviceId: identity.deviceId, accessToken, targetDeviceId: host.deviceId,
        forceRelay: forceRelay || attempt === 'relay',
        preferredTransports: preferredTransportsForAttempt(attempt),
        negotiateTimeoutMs: attempt === 'direct' ? DIRECT_WEBRTC_NEGOTIATE_TIMEOUT_MS : undefined,
        ...(rtcFactory === undefined || attempt === 'relay' ? {} : { rtcFactory }),
        fetchIceServers: async connectionId => iceServersForAttempt(attempt, await server.turnCredentials(connectionId)),
        onWebRtcFallback: () => { webRtcFallback = true },
      })
      return new RemoteClientCore(new SecureTransport(transport, identity, host), 60_000)
    }
    const attempts: TransportAttempt[] = forceRelay || rtcFactory === undefined ? ['relay'] : ['direct', 'turn', 'relay']
    let core: RemoteClientCore | undefined
    const prepareCore = (nextCore: RemoteClientCore): void => {
      this.core = nextCore
      nextCore.onClose(() => this.handleCoreClose(nextCore))
    }
    try {
      for (const attempt of attempts) {
        webRtcFallback = false
        core = createCore(attempt)
        prepareCore(core)
        await core.connect()
        if (attempt === 'relay' || !webRtcFallback) break
        if (this.core === core) this.core = undefined
        await core.close()
        core = undefined
      }
      if (core === undefined) throw new Error('Unable to establish a remote transport.')
      const features = await probeRemoteHostFeatures(core, host.clientVersion)
      const closeMux = features.remoteGateway
        ? this.openAlphaClient(core, host, features.sessionFormat)
        : await this.openMuxStream(core)
      if (this.core !== core) {
        await closeMux().catch(() => undefined)
        throw new Error('The remote connection closed during initialization.')
      }
      this.closeMux = closeMux
      this.host = host
    } catch (error) {
      if (this.core === core) await this.close()
      throw error
    }
  }

  async sessions(): Promise<RemoteSession[]> {
    if (this.alpha !== undefined) return this.alpha.sessionList()
    const result = await this.call<{ items: RemoteSession[] }>('session.list', {})
    return Array.isArray(result.items) ? result.items : []
  }

  async workspaces(): Promise<RemoteWorkspace[]> {
    if (this.alpha !== undefined) return (await this.alpha.workspaceList()).items
    const result = await this.call<{ items: RemoteWorkspace[] }>('workspace.list', {})
    return Array.isArray(result.items) ? result.items : []
  }

  async listDirectory(path?: string): Promise<DirectoryListing> {
    if (this.alpha !== undefined) return this.alpha.hostListDirectory(path)
    const result = await this.call<DirectoryListing>('host.listDirectory', path ? { path } : {})
    if (typeof result.path !== 'string' || !Array.isArray(result.entries)) throw new Error('Host returned an invalid directory listing.')
    return result
  }

  async createWorkspace(path: string): Promise<RemoteWorkspace> {
    if (this.alpha !== undefined) return (await this.alpha.workspaceCreate(path)).workspace
    const result = await this.call<{ workspace: RemoteWorkspace }>('workspace.create', { path })
    if (typeof result.workspace?.workspaceId !== 'string') throw new Error('Host returned an invalid workspace.')
    return result.workspace
  }

  async models(sessionId: string): Promise<SessionModels> {
    if (this.alpha !== undefined) return this.alpha.sessionModels(sessionId)
    return this.call('session.models', { sessionId })
  }

  async selectModel(sessionId: string, selection: ModelSelection): Promise<ModelSelection> {
    if (this.alpha !== undefined) return this.alpha.sessionSelectModel(sessionId, selection)
    const result = await this.call<{ selected: ModelSelection }>('session.selectModel', { sessionId, ...selection })
    return result.selected
  }

  async selectPermission(sessionId: string, preset: string): Promise<void> {
    if (this.alpha !== undefined) return this.alpha.sessionSelectPermission(sessionId, preset)
    const execution = await this.call<{ result: { kind: 'success' | 'error'; text?: string } } | undefined>(
      'commands.execute',
      { agentId: sessionId, line: `/permission ${preset}`, images: [] },
    )
    if (execution === undefined) throw new Error('Harness does not provide the permission command.')
    if (execution.result.kind === 'error') throw new Error(execution.result.text ?? 'Harness rejected the permission preset.')
  }

  async hostDescriptor(): Promise<HostDescriptor> {
    if (this.alpha !== undefined) return this.alpha.hostDescribe()
    return this.call('host.describe', {})
  }
  stats() { return this.core?.getStats() }
  onFrame(handler: (frame: MuxFrame) => void): () => void { this.frameHandlers.add(handler); return () => this.frameHandlers.delete(handler) }
  onClose(handler: () => void): () => void { this.closeHandlers.add(handler); return () => this.closeHandlers.delete(handler) }

  async respondApproval(frameRpcId: string, sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    if (this.alpha !== undefined) return this.alpha.respondApproval(frameRpcId, sessionId, approvalId, outcome)
    await this.core?.rpc('harness.api.respond', { message: { type: 'client-response', rpcId: frameRpcId, result: { ok: true, value: { sessionId, approvalId, outcome } } } })
  }

  async history(sessionId: string): Promise<ChatMessage[]> {
    if (this.alpha !== undefined) return foldHistory(await this.alpha.sessionHistory(sessionId, undefined, 100).then(result => result.events as HistoryEntry[]))
    const result = await this.call<{ events: HistoryEntry[] }>('session.history', { sessionId, maxMessages: 100 })
    return foldHistory(Array.isArray(result.events) ? result.events : [])
  }

  async createSession(options: { workspaceId?: string; cwd?: string } = {}): Promise<{ sessionId: string }> {
    if (this.alpha !== undefined) return this.alpha.sessionCreate(options.workspaceId, options.cwd)
    return this.call('session.create', options.workspaceId ? { workspaceId: options.workspaceId } : options.cwd ? { cwd: options.cwd } : {})
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    if (this.alpha !== undefined) return this.alpha.sessionPrompt(sessionId, text)
    await this.call('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text }] })
  }

  async cancelSession(sessionId: string): Promise<void> {
    if (this.alpha !== undefined) return this.alpha.sessionCancel(sessionId)
    const result = await this.call<{ accepted: true }>('session.cancel', { sessionId })
    if (result.accepted !== true) throw new Error('Harness did not accept the stop request.')
  }

  async close(): Promise<void> {
    const closeMux = this.closeMux
    this.closeMux = undefined
    const core = this.core
    this.core = undefined
    this.alpha = undefined
    this.host = undefined
    await closeMux?.().catch(() => undefined)
    await core?.close()
  }

  private async call<T>(method: string, payload: unknown): Promise<T> {
    if (!this.core) throw new Error('Connect to a host first.')
    const rpcId = crypto.randomUUID()
    const response = await this.core.rpc<NativeResponse<T>>('harness.api.call', { method, rpcId, payload } satisfies HarnessApiCallParams)
    if (response.rpcId !== rpcId) throw new Error('Host returned a mismatched response.')
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value
  }

  private openAlphaClient(core: RemoteClientCore, host: RemoteHost, sessionFormat?: 3): () => Promise<void> {
    const alpha = new HarnessAlphaClient(
      core,
      {
        clientVersion: host.clientVersion,
        harnessVersion: host.harnessVersion,
        ...(sessionFormat === undefined ? {} : { sessionFormat }),
      },
      frame => this.dispatchFrame(frame as unknown as MuxFrame),
    )
    alpha.start()
    this.alpha = alpha
    return async () => { await alpha.close() }
  }

  private async openMuxStream(core: RemoteClientCore): Promise<() => Promise<void>> {
    const streamId = crypto.randomUUID()
    const unsubscribe = core.onEvent(event => {
      if (event.event !== 'harness.api.frame' || !isRecord(event.data)) return
      if (event.data.streamId !== streamId || !isRecord(event.data.frame) || typeof event.data.frame.rpcId !== 'string' || !isRecord(event.data.frame.payload)) return
      const frame = { rpcId: event.data.frame.rpcId, payload: event.data.frame.payload }
      this.dispatchFrame(frame)
    })
    try {
      await core.rpc('harness.api.stream.open', { streamId, stream: 'mux', rpcId: crypto.randomUUID(), payload: {} })
    } catch (error) {
      unsubscribe()
      throw error
    }
    return async () => { unsubscribe(); await core.rpc('harness.api.stream.close', { streamId }).catch(() => undefined) }
  }

  private dispatchFrame(frame: MuxFrame): void {
    for (const handler of this.frameHandlers) handler(frame)
  }

  private handleCoreClose(core: RemoteClientCore): void {
    if (this.core !== core) return
    const closeMux = this.closeMux
    this.closeMux = undefined
    this.core = undefined
    this.alpha = undefined
    this.host = undefined
    void closeMux?.().catch(() => undefined)
    void core.close().catch(() => undefined)
    for (const handler of this.closeHandlers) {
      try { handler() } catch { /* One UI handler must not block the remaining handlers. */ }
    }
  }
}

function preferredTransportsForAttempt(attempt: TransportAttempt): Array<'lan' | 'p2p' | 'turn' | 'relay'> {
  if (attempt === 'direct') return ['lan', 'p2p', 'relay']
  if (attempt === 'turn') return ['turn', 'relay']
  return ['relay']
}

function iceServersForAttempt(attempt: TransportAttempt, iceServers: RtcIceServer[]): RtcIceServer[] {
  return attempt === 'direct' ? stunOnlyIceServers(iceServers) : iceServers
}

function foldHistory(entries: HistoryEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  const toolRows = new Map<string, number>()
  let stream = ''
  for (const entry of entries) {
    const event = entry.event
    const data = isRecord(event.data) ? event.data : {}
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      if (stream) { messages.push({ role: 'assistant', text: stream }); stream = '' }
      const text = messageText(data)
      if (text) messages.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text })
    } else if (event.type === 'assistant/chunk') {
      const chunk = isRecord(data.chunk) ? data.chunk : {}
      if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && typeof chunk.text === 'string') stream += chunk.text
    } else if (event.type === 'tool/call') {
      if (stream) { messages.push({ role: 'assistant', text: stream }); stream = '' }
      const view = entry.view?.for === 'call' && isRecord(entry.view.view) ? entry.view.view : undefined
      const name = typeof view?.title === 'string' ? view.title : typeof data.name === 'string' ? data.name : typeof data.toolName === 'string' ? data.toolName : 'Tool'
      const callId = typeof data.callId === 'string' ? data.callId : undefined
      const detail = typeof view?.description === 'string' ? view.description : typeof view?.cwd === 'string' ? view.cwd : undefined
      messages.push({ role: 'tool', text: name, toolState: 'running', ...(callId === undefined ? {} : { toolCallId: callId }), ...(typeof view?.kind === 'string' ? { toolKind: view.kind } : {}), ...(typeof view?.card === 'string' ? { toolCard: view.card } : {}), ...(detail === undefined ? {} : { toolDetail: detail }) })
      if (callId !== undefined) toolRows.set(callId, messages.length - 1)
    } else if (event.type === 'tool/result') {
      if (stream) { messages.push({ role: 'assistant', text: stream }); stream = '' }
      const message = isRecord(data.message) ? data.message : {}
      const source = isRecord(message.source) ? message.source : {}
      const callId = typeof source.callId === 'string' ? source.callId : typeof data.callId === 'string' ? data.callId : undefined
      const failed = isRecord(data.error)
      const view = entry.view?.for === 'result' && isRecord(entry.view.view) ? entry.view.view : undefined
      const row = callId === undefined ? undefined : toolRows.get(callId)
      if (row !== undefined) {
        const current = messages[row]
        messages[row] = { ...current, ...(typeof view?.title === 'string' ? { text: view.title } : {}), toolState: failed ? 'failed' : 'completed', ...(typeof view?.card === 'string' ? { toolCard: view.card } : {}) }
      } else {
        const name = typeof view?.title === 'string' ? view.title : typeof data.name === 'string' ? data.name : typeof data.toolName === 'string' ? data.toolName : 'Tool'
        messages.push({ role: 'tool', text: name, toolState: failed ? 'failed' : 'completed', ...(callId === undefined ? {} : { toolCallId: callId }), ...(typeof view?.card === 'string' ? { toolCard: view.card } : {}) })
      }
    }
  }
  if (stream) messages.push({ role: 'assistant', text: stream })
  return messages
}

function messageText(data: Record<string, unknown>): string {
  const message = isRecord(data.message) ? data.message : data
  const content = Array.isArray(message.content) ? message.content : []
  return content.flatMap(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

class SecureTransport implements RemoteTransport {
  private noise?: NoiseIkSession
  private unsubscribe?: () => void
  private readonly incoming = new SecureMessageCodec()
  private readonly outgoing = new SecureMessageCodec()

  constructor(private readonly inner: SecureHandshakeTransport, private readonly identity: DeviceIdentity, private readonly host: RemoteHost) {}

  async connect(): Promise<void> {
    await this.inner.connect()
    const info = this.inner.connectionInfo()
    if (info.localDeviceId !== this.identity.deviceId || info.remoteDeviceId !== this.host.deviceId) throw new Error('Connection was bound to an unexpected device.')
    const noise = new NoiseIkSession({ role: 'initiator', localPrivateKey: this.identity.privateKey, localPublicKey: this.identity.publicKey, remotePublicKey: this.host.identityKey, prologue: createNoisePrologue(info.connectionId, this.host.deviceId, this.identity.deviceId) })
    this.noise = noise
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Noise handshake timed out.')), 10_000)
      const off = this.inner.onHandshake((step, data) => {
        try {
          if (step !== 2) throw new Error('Out-of-order Noise handshake.')
          noise.readHandshake(data)
          if (!noise.complete) throw new Error('Noise handshake did not complete.')
          finish()
        } catch (error) { finish(error instanceof Error ? error : new Error('Noise handshake failed.')) }
      })
      const finish = (error?: Error): void => { clearTimeout(timer); off(); error ? reject(error) : resolve() }
      void this.inner.sendHandshake(1, noise.writeHandshake()).catch(error => finish(error instanceof Error ? error : new Error('Noise handshake failed.')))
    })
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.noise?.complete) throw new Error('Secure channel is not connected.')
    const plaintextFrames = this.outgoing.encode(data)
    try {
      for (const plaintext of plaintextFrames) await this.inner.send(this.noise.encrypt(plaintext))
    } catch (error) {
      await this.close().catch(() => undefined)
      throw error
    }
  }
  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.unsubscribe = this.inner.onMessage(data => {
      try { const decoded = this.noise?.complete ? this.incoming.decode(this.noise.decrypt(data)) : undefined; if (decoded) handler(decoded) } catch { void this.close() }
    })
    return () => { this.unsubscribe?.(); this.unsubscribe = undefined }
  }
  onClose(handler: () => void): () => void { return this.inner.onClose?.(handler) ?? (() => undefined) }
  getStats() { return this.inner.getStats() }
  async close(): Promise<void> { this.unsubscribe?.(); this.unsubscribe = undefined; this.noise?.destroy(); this.noise = undefined; this.incoming.reset(); this.outgoing.reset(); await this.inner.close() }
}
