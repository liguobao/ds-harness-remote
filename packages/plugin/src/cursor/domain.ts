import { randomUUID } from 'node:crypto'
import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { ResolvedCursorConfig } from '../config.js'
import type { PeerConnectionContext } from '../connection-controller.js'
import type { SafeLogger } from '../logging.js'
import { RpcError } from '../safe-error.js'
import {
  CursorAcpClient,
  CursorAcpError,
  type CursorAcpInbound,
  type CursorAcpLike,
} from './acp-server.js'
import {
  isSessionMutation,
  parseCursorCall,
  sessionIdFromParams,
  type AllowedCursorAppMethod,
} from './method-policy.js'
import { CursorPeerBridge, type PublishCursorFrame } from './peer-bridge.js'

const APPROVAL_TTL_MS = 5 * 60_000
const DEFAULT_RESTART_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const
const CURSOR_DIRECTORY_ENTRY_LIMIT = 500

interface PendingApproval {
  upstreamId: string | number
  connectionId: string
  sessionId: string
  method: string
  expiresAt: number
}

interface CursorDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

interface CursorDirectoryListing {
  path: string
  home: string
  crumbs: CursorDirectoryEntry[]
  entries: CursorDirectoryEntry[]
  truncated: boolean
}

type AcpFactory = (binary: string, logger: SafeLogger) => CursorAcpLike

/**
 * Optional Cursor ACP domain inside the existing Remote Plugin. Shares Remote
 * identity/transport with Harness, but owns its `agent acp` process, method
 * policy, subscriptions, and permission handles. Sessions stay in ACP memory.
 */
export class CursorRemoteDomain {
  private acp?: CursorAcpLike
  private unsubscribeInbound?: () => void
  private unsubscribeUnavailable?: () => void
  private readonly peers = new Map<string, CursorPeerBridge>()
  private readonly sessionOwners = new Map<string, string>()
  private readonly approvals = new Map<string, PendingApproval>()
  private approvalExpiryTimer?: ReturnType<typeof setTimeout>
  private restartTimer?: ReturnType<typeof setTimeout>
  private restartAttempt = 0
  private available = false
  private closed = false
  private state: 'disabled' | 'starting' | 'ready' | 'restarting' | 'unavailable' = 'disabled'
  private unavailableCode?: string

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

  createPeer(context: PeerConnectionContext, publish: PublishCursorFrame): CursorPeerBridge | undefined {
    if (!this.config.enabled) return undefined
    const bridge = new CursorPeerBridge(this, context, publish, this.logger)
    this.peers.set(context.connectionId, bridge)
    return bridge
  }

  async call(connectionId: string, input: unknown): Promise<unknown> {
    const envelope = parseCallEnvelope(input)
    const call = parseCursorCall(envelope.method, envelope.params)
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

    return sanitizeSessionResult(await this.callUpstream(call.method, call.params))
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
    const owner = this.sessionOwners.get(sessionId)
    if (owner !== connectionId) {
      throw new RpcError('CURSOR_SESSION_NOT_FOUND', 'The Cursor session is not available to this connection.')
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
    this.unsubscribeInbound?.()
    this.unsubscribeUnavailable?.()
    this.unsubscribeInbound = acp.onInbound(message => { void this.handleInbound(message) })
    this.unsubscribeUnavailable = acp.onUnavailable(code => { void this.handleUnavailable(code) })
    await this.disposeAcp(this.acp)
    this.acp = acp
    this.available = true
    this.state = 'ready'
    this.unavailableCode = undefined
    this.restartAttempt = 0
  }

  private async handleInbound(message: CursorAcpInbound): Promise<void> {
    if (message.kind === 'notification') {
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
    await Promise.all([...this.peers.values()].map(peer => peer.publishInbound(sessionId, frame)))
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

  private callUpstream(method: string, params: unknown): Promise<unknown> {
    return this.requireAcp().call(method, params)
  }

  private requireSessionAccess(connectionId: string, sessionId: string, method: AllowedCursorAppMethod): void {
    if (method === 'session/load') return
    const owner = this.sessionOwners.get(sessionId)
    if (owner === undefined) {
      throw new RpcError('CURSOR_SESSION_NOT_FOUND', 'The Cursor session is not available to this connection.')
    }
    if (owner !== connectionId && isSessionMutation(method)) {
      throw new RpcError('CURSOR_SESSION_OWNED', 'Another Remote connection owns this Cursor session.')
    }
  }

  private requireSessionOwner(connectionId: string, sessionId: string): void {
    const owner = this.sessionOwners.get(sessionId)
    if (owner !== connectionId) {
      throw new RpcError('CURSOR_SESSION_OWNED', 'Another Remote connection owns this Cursor session.')
    }
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

  private async listDirectory(path: string): Promise<CursorDirectoryListing> {
    const home = homedir()
    const target = path.trim() === '~' || path.trim() === ''
      ? home
      : path.startsWith('~/')
        ? join(home, path.slice(2))
        : path
    const canonical = await this.requireExistingDirectory(isAbsolute(target) ? target : resolve(target))
    const names = await readdir(canonical)
    const entries: CursorDirectoryEntry[] = []
    let truncated = false
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (entries.length >= CURSOR_DIRECTORY_ENTRY_LIMIT) {
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

export type { PublishCursorFrame }

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

function buildCrumbs(path: string, home: string): CursorDirectoryEntry[] {
  const crumbs: CursorDirectoryEntry[] = []
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
