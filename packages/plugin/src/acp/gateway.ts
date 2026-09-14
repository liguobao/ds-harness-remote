import { randomUUID } from 'node:crypto'
import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { ResolvedCursorConfig } from '../config.js'
import type { PeerConnectionContext } from '../connection-controller.js'
import type { SafeLogger } from '../logging.js'
import { RpcError } from '../safe-error.js'
import { PLUGIN_VERSION } from '../version.js'
import {
  CursorAcpClient,
  CursorAcpError,
  type CursorAcpInbound,
  type CursorAcpLike,
} from './adapters/cursor-process.js'
import {
  ACP_METHOD_ALLOWLIST,
  isSessionMutation,
  parseAcpCall,
  sessionIdFromParams,
  type AllowedAcpMethod,
} from './method-policy.js'
import { AcpPeerBridge, type PublishAcpFrame } from './peer-bridge.js'

const APPROVAL_TTL_MS = 5 * 60_000
const DEFAULT_RESTART_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const
const ACP_DIRECTORY_ENTRY_LIMIT = 500
const MAX_BUFFERED_ACP_FRAMES = 200
const ACP_FRAME_BUFFER_TTL_MS = 5 * 60_000
const MAX_TURN_CATCH_UP_FRAMES = 120
const CATCH_UP_SESSION_UPDATES = new Set([
  'agent_thought_chunk',
  'agent_thought',
  'agent_message_chunk',
  'agent_message',
  'user_message_chunk',
  'tool_call',
  'tool_call_update',
])

interface PendingApproval {
  upstreamId: string | number
  connectionId: string
  sessionId: string
  method: string
  expiresAt: number
}

interface BufferedAcpFrame {
  method: string
  params: unknown
  at: number
}

interface AcpDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

interface AcpDirectoryListing {
  path: string
  home: string
  crumbs: AcpDirectoryEntry[]
  entries: AcpDirectoryEntry[]
  truncated: boolean
}

type AcpFactory = (binary: string, logger: SafeLogger) => CursorAcpLike

/**
 * Host-side Agent ACP gateway (#65). Reuses the authenticated Remote channel and
 * delegates to a backend adapter (Cursor `agent acp` first). Owns method policy,
 * session ownership, subscriptions, and permission handles per connection.
 */
export class AcpRemoteGateway {
  private acp?: CursorAcpLike
  private unsubscribeInbound?: () => void
  private unsubscribeUnavailable?: () => void
  private readonly peers = new Map<string, AcpPeerBridge>()
  private readonly sessionOwners = new Map<string, string>()
  private readonly approvals = new Map<string, PendingApproval>()
  private approvalExpiryTimer?: ReturnType<typeof setTimeout>
  private restartTimer?: ReturnType<typeof setTimeout>
  private restartAttempt = 0
  private available = false
  private closed = false
  private state: 'disabled' | 'starting' | 'ready' | 'restarting' | 'unavailable' = 'disabled'
  private unavailableCode?: string
  /** Keep ACP → Client fanout ordered; concurrent publish races Noise sends. */
  private inboundChain: Promise<void> = Promise.resolve()
  /** Catch-up buffer for turns that finish while the Client is reconnecting. */
  private readonly recentFrames = new Map<string, BufferedAcpFrame[]>()
  /** Per-prompt live updates; attached to prompt_completed when streaming was lossy. */
  private readonly turnCatchUp = new Map<string, Array<{ method: string; params: unknown }>>()

  constructor(
    readonly config: ResolvedCursorConfig,
    private readonly logger: SafeLogger,
    private readonly createAcp: AcpFactory = (binary, targetLogger) => new CursorAcpClient(binary, targetLogger),
    private readonly restartDelaysMs: readonly number[] = DEFAULT_RESTART_DELAYS_MS,
  ) {}

  async start(): Promise<void> {
    if (this.closed) throw new RpcError('CURSOR_CLOSED', 'The Cursor Remote domain is closed.')
    if (!this.config.enabled) return
    try {
      this.state = 'starting'
      await this.launchAcp()
    } catch (error) {
      this.available = false
      this.state = 'unavailable'
      this.unavailableCode = errorCode(error)
      await this.disposeAcp(this.acp)
      this.logger.warn('Cursor Remote domain unavailable', { code: this.unavailableCode })
    }
  }

  isAvailable(): boolean { return this.available && this.acp?.isReady() === true }

  status(): {
    enabled: boolean
    available: boolean
    state: 'disabled' | 'starting' | 'ready' | 'restarting' | 'unavailable'
    restartAttempt: number
    error?: string
  } {
    return {
      enabled: this.config.enabled,
      available: this.isAvailable(),
      state: this.state,
      restartAttempt: this.restartAttempt,
      ...(this.unavailableCode === undefined ? {} : { error: this.unavailableCode }),
    }
  }

  createPeer(context: PeerConnectionContext, publish: PublishAcpFrame): AcpPeerBridge | undefined {
    if (!this.config.enabled) return undefined
    const bridge = new AcpPeerBridge(this, context, publish, this.logger)
    this.peers.set(context.connectionId, bridge)
    return bridge
  }

  async call(connectionId: string, input: unknown): Promise<unknown> {
    const envelope = parseCallEnvelope(input)
    const call = parseAcpCall(envelope.method, envelope.params)

    if (call.method === 'initialize') {
      this.requireAcp()
      return this.initializeResult(call.params)
    }

    this.requireAcp()

    if (call.method === 'dsh/directoryList') {
      return this.listDirectory(String(call.params.path))
    }

    if (call.method === 'session/new') {
      const cwd = await this.requireExistingDirectory(String(call.params.cwd))
      const result = await this.callUpstream('session/new', {
        cwd,
        mcpServers: [],
        ...(typeof call.params.mode === 'string' ? { mode: call.params.mode } : {}),
      })
      const sessionId = readSessionId(result)
      if (sessionId !== undefined) this.sessionOwners.set(sessionId, connectionId)
      return sanitizeSessionResult(result)
    }

    const sessionId = sessionIdFromParams(call.method, call.params)
    if (sessionId !== undefined) this.requireSessionAccess(connectionId, sessionId, call.method)

    if (call.method === 'session/load') {
      const result = await this.callUpstream(call.method, call.params)
      const loadedId = readSessionId(result) ?? sessionId
      if (loadedId !== undefined) this.sessionOwners.set(loadedId, connectionId)
      return sanitizeSessionResult(result)
    }

    if (isSessionMutation(call.method) && sessionId !== undefined) {
      this.requireSessionOwner(connectionId, sessionId)
    }

    // session/prompt blocks until the upstream turn ends. Returning that RPC
    // only after completion prevents some Client transports from delivering
    // interleaved agent.acp.frame events (Android stays on "正在回复" with no
    // thought/text). Accept immediately and finish via stream updates.
    if (call.method === 'session/prompt' && sessionId !== undefined) {
      const ownerPeer = this.peers.get(connectionId)
      if (ownerPeer !== undefined && !ownerPeer.hasStreamFor(sessionId)) {
        this.logger?.warn('Cursor prompt started without an open ACP stream', {
          sessionId: shortSessionId(sessionId),
        })
      }
      this.turnCatchUp.set(sessionId, [])
      void this.runPromptInBackground(sessionId, call.params)
      return { accepted: true, stopReason: 'in_progress' }
    }

    return sanitizeSessionResult(await this.callUpstream(call.method, call.params))
  }

  private async runPromptInBackground(sessionId: string, params: unknown): Promise<void> {
    try {
      const result = await this.callUpstream('session/prompt', params)
      // Cursor emits final session/update lines before the JSON-RPC result.
      // Those notifications are queued on inboundChain; drain it before we
      // snapshot catch-up or the Client only sees an empty prompt_completed.
      await this.inboundChain
      const stopReason = isRecord(result) && typeof result.stopReason === 'string'
        ? result.stopReason
        : 'end_turn'
      const catchUp = takeTurnCatchUp(this.turnCatchUp, sessionId)
      this.logger.info('Cursor prompt finished', {
        sessionId: shortSessionId(sessionId),
        stopReason,
        catchUp: catchUp.length,
      })
      await this.publishToSession(sessionId, {
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'prompt_completed',
            stopReason,
            ...(catchUp.length > 0 ? { catchUp } : {}),
          },
        },
      })
    } catch (error) {
      this.logger?.warn('Cursor session/prompt failed', { code: errorCode(error) })
      await this.inboundChain.catch(() => undefined)
      const catchUp = takeTurnCatchUp(this.turnCatchUp, sessionId)
      await this.publishToSession(sessionId, {
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'prompt_failed',
            code: errorCode(error),
            ...(catchUp.length > 0 ? { catchUp } : {}),
          },
        },
      }).catch(() => undefined)
    }
  }

  async respond(connectionId: string, input: unknown): Promise<{ resolved: true }> {
    const params = parseRespondEnvelope(input)
    const pending = this.approvals.get(params.requestHandle)
    if (pending === undefined || pending.expiresAt <= Date.now()) {
      this.approvals.delete(params.requestHandle)
      throw new RpcError('CURSOR_APPROVAL_NOT_FOUND', 'The Cursor approval is missing, expired, or belongs to another connection.')
    }
    if (pending.connectionId !== connectionId) {
      throw new RpcError('CURSOR_APPROVAL_NOT_FOUND', 'The Cursor approval is missing, expired, or belongs to another connection.')
    }
    this.approvals.delete(params.requestHandle)
    const acp = this.requireAcp()
    if (params.decision === 'cancel') {
      await acp.respondError(pending.upstreamId, -32800, 'Cancelled by Remote client.')
      return { resolved: true }
    }
    const result = params.result ?? mapPermissionDecision(params.decision, pending.method)
    await acp.respond(pending.upstreamId, result)
    return { resolved: true }
  }

  dropPeer(connectionId: string): void {
    this.peers.delete(connectionId)
    for (const [sessionId, owner] of this.sessionOwners) {
      if (owner === connectionId) this.sessionOwners.delete(sessionId)
    }
    for (const [handle, approval] of this.approvals) {
      if (approval.connectionId === connectionId) {
        this.approvals.delete(handle)
        void this.acp?.respondError(approval.upstreamId, -32800, 'Remote peer disconnected.')
      }
    }
  }

  /** Used by peer stream open to prove this connection may observe the session. */
  assertStreamable(connectionId: string, sessionId: string): void {
    this.claimSession(connectionId, sessionId)
  }

  /**
   * After a Client reconnect, session ownership may have been cleared with the
   * old peer. Reclaim the in-memory ACP session for the new connection so
   * stream open / prompt can resume and buffered frames can replay.
   */
  private claimSession(connectionId: string, sessionId: string): void {
    const owner = this.sessionOwners.get(sessionId)
    if (owner === undefined) {
      this.sessionOwners.set(sessionId, connectionId)
      return
    }
    if (owner !== connectionId) {
      throw new RpcError('CURSOR_SESSION_OWNED', 'Another Remote connection owns this Cursor session.')
    }
  }

  /** Replay frames buffered while no healthy peer could receive them. */
  async replayBufferedFrames(connectionId: string, sessionId: string): Promise<void> {
    const peer = this.peers.get(connectionId)
    if (peer === undefined) return
    this.pruneFrameBuffer(sessionId)
    const buffered = this.recentFrames.get(sessionId) ?? []
    if (buffered.length === 0) return
    this.recentFrames.delete(sessionId)
    this.logger.info('Replaying buffered ACP frames', {
      sessionId: shortSessionId(sessionId),
      count: buffered.length,
    })
    for (const frame of buffered) {
      await peer.publishInbound(sessionId, { method: frame.method, params: frame.params })
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    if (this.approvalExpiryTimer !== undefined) clearTimeout(this.approvalExpiryTimer)
    for (const peer of this.peers.values()) await peer.closeAll()
    this.peers.clear()
    this.sessionOwners.clear()
    this.recentFrames.clear()
    this.turnCatchUp.clear()
    this.approvals.clear()
    await this.disposeAcp(this.acp)
    this.acp = undefined
    this.available = false
    this.state = 'disabled'
  }

  private async launchAcp(): Promise<void> {
    let lastError: unknown
    for (const binary of cursorBinaryCandidates(this.config.binary)) {
      try {
        await this.launchAcpCandidate(binary)
        return
      } catch (error) {
        lastError = error
        this.logger.warn('Cursor ACP candidate failed', { code: errorCode(error) })
      }
    }
    throw lastError instanceof Error ? lastError : new CursorAcpError('CURSOR_BINARY_UNAVAILABLE', 'Cursor ACP binary is unavailable.')
  }

  private async launchAcpCandidate(binary: string): Promise<void> {
    const acp = this.createAcp(binary, this.logger)
    await acp.start()
    // Dispose the previous process first. disposeAcp() always clears the current
    // inbound/unavailable unsubscribers; registering handlers before that would
    // immediately drop them on first launch (this.acp is undefined) and leave
    // session/update notifications undelivered while RPC still succeeds.
    await this.disposeAcp(this.acp)
    this.unsubscribeInbound = acp.onInbound(message => {
      this.inboundChain = this.inboundChain
        .then(() => this.handleInbound(message))
        .catch(error => {
          this.logger.warn('ACP inbound fanout failed', { code: errorCode(error) })
        })
    })
    this.unsubscribeUnavailable = acp.onUnavailable(code => { void this.handleUnavailable(code) })
    this.acp = acp
    this.available = true
    this.state = 'ready'
    this.unavailableCode = undefined
    this.restartAttempt = 0
  }

  private async handleInbound(message: CursorAcpInbound): Promise<void> {
    // session/update is a stream notification even if a buggy agent attaches an id.
    if (message.kind === 'notification' || message.method === 'session/update') {
      const sessionId = readSessionId(message.params) ?? readNestedSessionId(message.params)
      if (sessionId === undefined) return
      await this.publishToSession(sessionId, { method: message.method, params: message.params })
      return
    }

    const sessionId = readSessionId(message.params) ?? readNestedSessionId(message.params) ?? 'unknown'
    const requestHandle = randomUUID()
    this.approvals.set(requestHandle, {
      upstreamId: message.id,
      connectionId: this.sessionOwners.get(sessionId) ?? [...this.peers.keys()][0] ?? 'unknown',
      sessionId,
      method: message.method,
      expiresAt: Date.now() + APPROVAL_TTL_MS,
    })
    this.scheduleApprovalExpiry()
    const owner = this.sessionOwners.get(sessionId)
    const frame = {
      method: message.method,
      params: {
        requestHandle,
        sessionId,
        upstreamMethod: message.method,
        ...(isRecord(message.params) ? message.params : {}),
      },
    }
    if (owner !== undefined) {
      const peer = this.peers.get(owner)
      if (peer !== undefined) {
        await peer.publishInbound(sessionId, frame)
        return
      }
    }
    await this.publishToSession(sessionId, frame)
  }

  private async publishToSession(sessionId: string, frame: { method: string; params: unknown }): Promise<void> {
    this.recordTurnCatchUp(sessionId, frame)
    const ownerId = this.sessionOwners.get(sessionId)
    const entries = [...this.peers.entries()]
    if (entries.length === 0) {
      this.bufferFrame(sessionId, frame)
      return
    }
    const deliveries = await Promise.all(entries.map(async ([connectionId, peer]) => {
      try {
        await peer.publishInbound(sessionId, frame)
        return { connectionId, ok: true as const }
      } catch {
        return { connectionId, ok: false as const }
      }
    }))
    const ownerDelivered = ownerId !== undefined
      && deliveries.some(item => item.connectionId === ownerId && item.ok)
    // Loopback peers resolve successfully while swallowing events. Only treat
    // the session owner's delivery as proof the Remote Client received the frame.
    if (ownerId !== undefined ? !ownerDelivered : deliveries.every(item => !item.ok)) {
      this.bufferFrame(sessionId, frame)
    }
  }

  private recordTurnCatchUp(sessionId: string, frame: { method: string; params: unknown }): void {
    const list = this.turnCatchUp.get(sessionId)
    if (list === undefined || frame.method !== 'session/update') return
    const params = isRecord(frame.params) ? frame.params : undefined
    const update = params !== undefined && isRecord(params.update) ? params.update : params
    const kind = update !== undefined && typeof update.sessionUpdate === 'string'
      ? update.sessionUpdate
      : undefined
    if (kind === undefined || !CATCH_UP_SESSION_UPDATES.has(kind)) return
    list.push({ method: frame.method, params: frame.params })
    while (list.length > MAX_TURN_CATCH_UP_FRAMES) list.shift()
  }

  private bufferFrame(sessionId: string, frame: { method: string; params: unknown }): void {
    this.pruneFrameBuffer(sessionId)
    const list = this.recentFrames.get(sessionId) ?? []
    list.push({ method: frame.method, params: frame.params, at: Date.now() })
    while (list.length > MAX_BUFFERED_ACP_FRAMES) list.shift()
    this.recentFrames.set(sessionId, list)
    this.logger.warn('Buffered ACP frame for later replay', {
      sessionId: shortSessionId(sessionId),
      method: frame.method,
      buffered: list.length,
    })
  }

  private pruneFrameBuffer(sessionId: string): void {
    const list = this.recentFrames.get(sessionId)
    if (list === undefined) return
    const validAfter = Date.now() - ACP_FRAME_BUFFER_TTL_MS
    const next = list.filter(frame => frame.at >= validAfter)
    if (next.length === 0) this.recentFrames.delete(sessionId)
    else this.recentFrames.set(sessionId, next)
  }

  private async handleUnavailable(code: string): Promise<void> {
    this.available = false
    this.state = 'restarting'
    this.unavailableCode = code
    await Promise.all([...this.peers.values()].map(peer => peer.failStreams('failed')))
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.closed || !this.config.enabled) return
    if (this.restartAttempt >= this.restartDelaysMs.length) {
      this.state = 'unavailable'
      return
    }
    const delay = this.restartDelaysMs[this.restartAttempt]!
    this.restartAttempt += 1
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      void this.start().catch(() => undefined)
    }, delay)
    this.restartTimer.unref?.()
  }

  private scheduleApprovalExpiry(): void {
    if (this.approvalExpiryTimer !== undefined) clearTimeout(this.approvalExpiryTimer)
    const next = [...this.approvals.values()].reduce<number | undefined>((min, item) => {
      if (min === undefined || item.expiresAt < min) return item.expiresAt
      return min
    }, undefined)
    if (next === undefined) return
    this.approvalExpiryTimer = setTimeout(() => {
      const now = Date.now()
      for (const [handle, approval] of this.approvals) {
        if (approval.expiresAt <= now) {
          this.approvals.delete(handle)
          void this.acp?.respondError(approval.upstreamId, -32800, 'Cursor approval expired.')
        }
      }
      this.scheduleApprovalExpiry()
    }, Math.max(0, next - Date.now()))
    this.approvalExpiryTimer.unref?.()
  }

  private requireAcp(): CursorAcpLike {
    if (!this.isAvailable() || this.acp === undefined) {
      throw new RpcError('CURSOR_UNAVAILABLE', 'Cursor ACP is disabled or unavailable on this Host.')
    }
    return this.acp
  }

  private initializeResult(params: Record<string, unknown>): Record<string, unknown> {
    const requested = typeof params.protocolVersion === 'number' ? params.protocolVersion : 1
    return {
      protocolVersion: requested,
      agentInfo: {
        name: 'dsh-remote-acp',
        version: PLUGIN_VERSION,
      },
      backend: 'cursor',
      authMethods: [],
      capabilities: {
        loadSession: true,
        promptTypes: ['text'],
        methods: [...ACP_METHOD_ALLOWLIST],
      },
    }
  }

  private callUpstream(method: string, params: unknown): Promise<unknown> {
    return this.requireAcp().call(method, params)
  }

  private requireSessionAccess(connectionId: string, sessionId: string, method: AllowedAcpMethod): void {
    if (method === 'session/load') return
    const owner = this.sessionOwners.get(sessionId)
    if (owner === undefined) {
      // Allow reclaim after the owning peer disconnected; the ACP process still
      // holds the session.
      this.sessionOwners.set(sessionId, connectionId)
      return
    }
    if (owner !== connectionId && isSessionMutation(method)) {
      throw new RpcError('CURSOR_SESSION_OWNED', 'Another Remote connection owns this Cursor session.')
    }
  }

  private requireSessionOwner(connectionId: string, sessionId: string): void {
    this.claimSession(connectionId, sessionId)
  }

  private async requireExistingDirectory(path: string): Promise<string> {
    if (!isAbsolute(path)) {
      throw new RpcError('CURSOR_PATH_NOT_ALLOWED', 'The Cursor working directory must be an absolute path.')
    }
    try {
      const canonical = await realpath(path)
      const info = await stat(canonical)
      if (!info.isDirectory()) {
        throw new RpcError('CURSOR_PATH_NOT_ALLOWED', 'The Cursor working directory must be an existing directory.')
      }
      return canonical
    } catch (error) {
      if (error instanceof RpcError) throw error
      throw new RpcError('CURSOR_PATH_NOT_ALLOWED', 'The Cursor working directory must be an existing directory.')
    }
  }

  private async listDirectory(path: string): Promise<AcpDirectoryListing> {
    const home = homedir()
    const target = path.trim() === '~' || path.trim() === ''
      ? home
      : path.startsWith('~/')
        ? join(home, path.slice(2))
        : path
    const canonical = await this.requireExistingDirectory(isAbsolute(target) ? target : resolve(target))
    const names = await readdir(canonical)
    const entries: AcpDirectoryEntry[] = []
    let truncated = false
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (entries.length >= ACP_DIRECTORY_ENTRY_LIMIT) {
        truncated = true
        break
      }
      const child = join(canonical, name)
      try {
        const info = await stat(child)
        if (!info.isDirectory()) continue
        entries.push({ name, path: child, hidden: name.startsWith('.') })
      } catch {
        // Skip unreadable entries.
      }
    }
    return {
      path: canonical,
      home,
      crumbs: buildCrumbs(canonical, home),
      entries,
      truncated,
    }
  }

  private async disposeAcp(acp: CursorAcpLike | undefined): Promise<void> {
    this.unsubscribeInbound?.()
    this.unsubscribeUnavailable?.()
    this.unsubscribeInbound = undefined
    this.unsubscribeUnavailable = undefined
    if (acp !== undefined) await acp.close()
  }
}

export type { PublishAcpFrame }

function parseCallEnvelope(input: unknown): { method: string; params: unknown } {
  if (!isRecord(input) || typeof input.method !== 'string') {
    throw new RpcError('INVALID_MESSAGE', 'The Cursor call envelope is invalid.')
  }
  return { method: input.method, params: input.params ?? {} }
}

function parseRespondEnvelope(input: unknown): {
  requestHandle: string
  decision: 'allow-once' | 'allow-always' | 'reject-once' | 'cancel'
  result?: unknown
} {
  if (!isRecord(input) || typeof input.requestHandle !== 'string' || typeof input.decision !== 'string') {
    throw new RpcError('INVALID_MESSAGE', 'The Cursor respond envelope is invalid.')
  }
  const decision = input.decision
  if (decision !== 'allow-once' && decision !== 'allow-always' && decision !== 'reject-once' && decision !== 'cancel') {
    throw new RpcError('INVALID_MESSAGE', 'The Cursor respond envelope is invalid.')
  }
  return {
    requestHandle: input.requestHandle,
    decision,
    ...(input.result === undefined ? {} : { result: input.result }),
  }
}

function mapPermissionDecision(
  decision: 'allow-once' | 'allow-always' | 'reject-once' | 'cancel',
  method: string,
): unknown {
  if (method === 'session/request_permission') {
    return { outcome: { outcome: 'selected', optionId: decision === 'cancel' ? 'reject-once' : decision } }
  }
  if (method === 'cursor/create_plan') {
    if (decision === 'allow-once' || decision === 'allow-always') return { outcome: { outcome: 'accepted' } }
    return { outcome: { outcome: decision === 'cancel' ? 'cancelled' : 'rejected' } }
  }
  if (method === 'cursor/ask_question') {
    return { outcome: { outcome: 'cancelled' } }
  }
  return { outcome: { outcome: 'selected', optionId: decision } }
}

function readSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return typeof value.sessionId === 'string' ? value.sessionId : undefined
}

function readNestedSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (isRecord(value.update) && typeof value.update.sessionId === 'string') return value.update.sessionId
  return undefined
}

function sanitizeSessionResult(value: unknown): unknown {
  if (!isRecord(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'sessionId' || key === 'stopReason' || key === 'mode') next[key] = entry
  }
  return Object.keys(next).length > 0 ? next : value
}

function buildCrumbs(path: string, home: string): AcpDirectoryEntry[] {
  const crumbs: AcpDirectoryEntry[] = []
  let current = path
  while (true) {
    crumbs.unshift({
      name: current === home ? '~' : basename(current) || current,
      path: current,
      hidden: false,
    })
    const parent = resolve(current, '..')
    if (parent === current) break
    if (home !== '' && relative(home, current) === '' && current !== home) break
    current = parent
    if (crumbs.length >= 32) break
  }
  return crumbs
}

/**
 * Prefer `~/.local/bin/agent` when the user kept the default command. Explicit
 * binary configuration is never rewritten.
 */
export function cursorBinaryCandidates(configured: string): string[] {
  if (configured !== 'agent') return [configured]
  const userHome = homedir()
  return [
    join(userHome, '.local', 'bin', 'agent'),
    'agent',
  ]
}

function errorCode(error: unknown): string {
  if (error instanceof CursorAcpError || error instanceof RpcError) return error.code
  return 'CURSOR_UNAVAILABLE'
}

function shortSessionId(sessionId: string): string {
  return sessionId.length <= 16 ? sessionId : `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`
}

function takeTurnCatchUp(
  turnCatchUp: Map<string, Array<{ method: string; params: unknown }>>,
  sessionId: string,
): Array<{ method: string; params: unknown }> {
  const list = turnCatchUp.get(sessionId) ?? []
  turnCatchUp.delete(sessionId)
  return list
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
