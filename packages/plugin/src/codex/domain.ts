import { randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { deriveCodexCwdWorkspaces } from '@dsh-remote/client-core'
import type { CodexAppFrameData, CodexAppStreamClosedData, CodexPermissionPreset } from '@dsh-remote/protocol'
import { createEvent, encodeMessage, MAX_SECURE_MESSAGE_BYTES } from '@dsh-remote/protocol'
import {
  clampDetachedApprovalGraceSec,
  DEFAULT_DETACHED_APPROVAL_GRACE_SEC,
  type ResolvedCodexConfig,
} from '../config.js'
import { codexApprovalItemId, type AttentionBackendObserver } from '../attention-tracker.js'
import { DetachedApprovalBudget } from '../detached-approval-budget.js'
import type { PeerConnectionContext } from '../connection-controller.js'
import type { SafeLogger } from '../logging.js'
import { RpcError } from '../safe-error.js'
import {
  normalizeVirtualHistoryTurnWindow,
  VirtualHistoryResponseTooLargeError,
} from '../virtual-history-pagination.js'
import {
  CODEX_THREAD_UNMATERIALIZED,
  CodexAppServerClient,
  CodexAppServerError,
  type CodexAppServerInbound,
  type CodexAppServerLike,
} from './app-server.js'
import {
  isThreadMutation,
  parseCodexCall,
  threadIdFromParams,
  type AllowedCodexAppMethod,
} from './method-policy.js'
import { CodexPeerBridge, type PublishCodexFrame } from './peer-bridge.js'
import { codexPermissionPresetFromResponse } from './permissions.js'
import { CodexThreadLifecycle } from './thread-lifecycle.js'
import { paginateCodexNativeHistory, projectCodexNativeHistory } from './virtual-harness.js'

const APPROVAL_TTL_MS = 5 * 60_000
const MAX_THREAD_META_ENTRIES = 256
const DEFAULT_RESTART_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const
/** Fail closed when App Server goes silent mid-turn (e.g. HTTP 503 without turn/completed). */
const DEFAULT_TURN_SILENCE_TIMEOUT_MS = 10 * 60_000
const CODEX_PAGE_LIMIT = 100
const MAX_CODEX_PAGES = 32
const CODEX_HISTORY_PAGE_LIMIT = 25
const MAX_CODEX_HISTORY_PAGES = 64
const CODEX_DIRECTORY_ENTRY_LIMIT = 500
export const MAX_BUFFERED_CODEX_FRAMES = 200
const MAX_BUFFERED_CODEX_THREADS = 64
const CODEX_FRAME_BUFFER_TTL_MS = 5 * 60_000
const MAX_STREAM_ID_PROBE = 'x'.repeat(128)
const THREAD_METADATA_METHODS: ReadonlySet<string> = new Set([
  'thread/name/updated',
  'thread/settings/updated',
  'thread/status/changed',
  'thread/archived',
  'thread/unarchived',
  'model/rerouted',
])
const BUFFERABLE_CODEX_METHODS: ReadonlySet<string> = new Set([
  ...THREAD_METADATA_METHODS,
  'turn/started',
  'turn/plan/updated',
  'turn/completed',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/plan/delta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/mcpToolCall/progress',
  'item/fileChange/patchUpdated',
])
const TURN_SILENCE_MESSAGE = 'CodeX turn timed out waiting for the App Server. The model provider may be unavailable or rate-limited. Please try again later.'

interface BufferedCodexFrame {
  seq: number
  method: string
  params: unknown
  at: number
}

interface BufferedCodexThread {
  frames: BufferedCodexFrame[]
  truncated: boolean
  truncatedAtSeq: number
}

interface PendingApproval {
  upstreamId: string | number
  ownerConnectionId: string | null
  threadId: string
  method: 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval'
  params: unknown
  expiresAt: number
  detachedExpiresAt?: number
}

interface ActiveTurnOwner {
  connectionId: string
  peerDeviceId: string
  turnId?: string
}

interface CodexWorkspaceAuthority {
  projectIds: Set<string>
  roots: string[]
}

interface CodexDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

interface CodexDirectoryListing {
  path: string
  home: string
  crumbs: CodexDirectoryEntry[]
  entries: CodexDirectoryEntry[]
  truncated: boolean
}

type AppServerFactory = (binary: string, logger: SafeLogger) => CodexAppServerLike

/**
 * Optional Codex business domain inside the existing Remote Plugin. It shares
 * Remote identity/transport with Harness, but owns its App Server process,
 * method policy, subscriptions, leases, and approval handles.
 */
export class CodexRemoteDomain {
  private appServer?: CodexAppServerLike
  private unsubscribeInbound?: () => void
  private unsubscribeUnavailable?: () => void
  private readonly peers = new Map<string, CodexPeerBridge>()
  private readonly peerThreads = new Map<string, Set<string>>()
  private readonly threadGoals = new Map<string, { active: boolean }>()
  private readonly threadLifecycle = new CodexThreadLifecycle(
    threadId => this.hasSubscriber(threadId) || this.threadGoals.get(threadId)?.active === true
      || [...this.approvals.values()].some(approval => approval.threadId === threadId),
    threadId => this.callUpstream('thread/unsubscribe', { threadId }),
    threadId => {
      this.threadGoals.delete(threadId)
      for (const threads of this.peerThreads.values()) threads.delete(threadId)
    },
    error => this.logger.warn('Codex thread release could not be confirmed', { code: errorCode(error) }),
  )
  private readonly peerDeviceIds = new Map<string, string>()
  private readonly turnOwners = new Map<string, ActiveTurnOwner>()
  private readonly turnWatchdogs = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly approvals = new Map<string, PendingApproval>()
  private readonly permissionPresets = new Map<string, CodexPermissionPreset>()
  private readonly recentFrames = new Map<string, BufferedCodexThread>()
  private readonly threadMeta = new Map<string, { title?: string; cwd?: string }>()
  private readonly detachedApprovalGraceMs: number
  private nextBufferSeq = 1
  private readonly inboundChains = new Map<string, Promise<void>>()
  private readonly pendingRequestThreads = new Map<string | number, { id: string | number; threadId: string }>()
  private approvalExpiryTimer?: ReturnType<typeof setTimeout>
  private restartTimer?: ReturnType<typeof setTimeout>
  private restartAttempt = 0
  private lastOnDemandRecoveryAt = 0
  private available = false
  private closed = false
  /**
   * Workspace authority is intentionally not cached after a request finishes:
   * project roots can change outside this process and must stay fail-closed.
   * Concurrent calls during one catalog/history refresh do share this promise,
   * though, so they do not each page the same project list independently.
   */
  private workspaceAuthorityPromise?: Promise<CodexWorkspaceAuthority>
  /**
   * Authorization checks are intentionally not retained after they settle:
   * workspace roots can change outside this process and every new request must
   * still revalidate them.  Calls that overlap one another may share the same
   * bounded thread/read, though, which avoids duplicate first-open checks when
   * a session history and its first prompt arrive together.
   */
  private readonly knownThreadPromises = new Map<string, Promise<{ thread: Record<string, unknown>; cwd?: string }>>()
  private state: 'disabled' | 'starting' | 'ready' | 'restarting' | 'unavailable' = 'disabled'
  private unavailableCode?: string
  private lifecycleGeneration = 0
  private reconfigureDepth = 0

  constructor(
    public config: ResolvedCodexConfig,
    private readonly logger: SafeLogger,
    private readonly createAppServer: AppServerFactory = (binary, targetLogger) => new CodexAppServerClient(binary, targetLogger),
    private readonly restartDelaysMs: readonly number[] = DEFAULT_RESTART_DELAYS_MS,
    private readonly turnSilenceTimeoutMs: number = DEFAULT_TURN_SILENCE_TIMEOUT_MS,
    private readonly onDemandCooldownMs = 30_000,
    detachedApprovalGraceSec: number = DEFAULT_DETACHED_APPROVAL_GRACE_SEC,
    private readonly attention?: AttentionBackendObserver,
    private readonly detachedApprovalBudget: DetachedApprovalBudget = new DetachedApprovalBudget(),
  ) {
    this.detachedApprovalGraceMs = clampDetachedApprovalGraceSec(detachedApprovalGraceSec) * 1_000
  }

  private startPromise?: Promise<void>

  start(): Promise<void> {
    this.startPromise ??= this.startOnce().finally(() => { this.startPromise = undefined })
    return this.startPromise
  }

  tryRecoverOnDemand(): void {
    if (this.closed || !this.config.enabled || this.reconfigureDepth > 0 || this.isAvailable()) return
    if (this.startPromise !== undefined || this.restartTimer !== undefined) return
    if (this.state === 'starting' || this.state === 'restarting') return
    const now = Date.now()
    if (now - this.lastOnDemandRecoveryAt < this.onDemandCooldownMs) return
    this.lastOnDemandRecoveryAt = now
    void this.start().catch(() => undefined)
  }

  private async startOnce(): Promise<void> {
    if (this.closed) throw new RpcError('CODEX_CLOSED', 'The Codex Remote domain is closed.')
    if (!this.config.enabled) return
    const generation = this.lifecycleGeneration
    this.restartAttempt = 0
    try {
      this.state = 'starting'
      await this.launchAppServer(generation)
    } catch (error) {
      if (this.closed || generation !== this.lifecycleGeneration) return
      this.available = false
      this.lastOnDemandRecoveryAt = Date.now()
      this.unavailableCode = errorCode(error)
      await this.disposeAppServer(this.appServer)
      if (this.closed || generation !== this.lifecycleGeneration) return
      this.logger.warn('Codex Remote domain unavailable', { code: this.unavailableCode })
      if (this.config.enabled && isRetryableCodexStartError(error) && this.restartDelaysMs.length > 0) {
        this.scheduleRestart(generation)
      } else {
        this.state = 'unavailable'
      }
    }
  }

  isAvailable(): boolean { return this.available && this.appServer?.isReady() === true }

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

  /** Resolve a thread cwd for Host-owned workspace/terminal carriers. */
  async resolveThreadWorkspace(connectionId: string, threadId: string): Promise<string | undefined> {
    if (!this.peers.has(connectionId)) throw new RpcError('CODEX_THREAD_UNAVAILABLE', 'The CodeX thread is not available on this connection.')
    try {
      const assertCurrent = this.captureCallScope(connectionId)
      const known = await this.readKnownThread(threadId)
      assertCurrent()
      return known.cwd
    } catch (error) {
      if (error instanceof RpcError && error.code === 'CODEX_THREAD_NOT_ALLOWED') {
        throw new RpcError('CODEX_THREAD_UNAVAILABLE', 'The CodeX thread is not available.')
      }
      throw new RpcError('CODEX_THREAD_UNAVAILABLE', 'The CodeX thread is not available.')
    }
  }

  createPeer(context: PeerConnectionContext, publish: PublishCodexFrame): CodexPeerBridge | undefined {
    const bridge = new CodexPeerBridge(this, context, publish, this.logger)
    this.peers.set(context.connectionId, bridge)
    this.peerDeviceIds.set(context.connectionId, context.peerDeviceId)
    return bridge
  }

  async call(connectionId: string, input: unknown): Promise<unknown> {
    const envelope = parseCallEnvelope(input)
    const call = parseCodexCall(envelope.method, envelope.params)
    const assertCurrent = this.captureCallScope(connectionId)
    const action = async () => {
      const result = await this.callInternal(connectionId, call, assertCurrent)
      assertCurrent()
      return result
    }
    const threadId = threadIdFromParams(call.params)
    return threadId === undefined ? action() : this.threadLifecycle.use(threadId, action)
  }

  useThread<T>(threadId: string, action: () => Promise<T>): Promise<T> {
    return this.threadLifecycle.use(threadId, action)
  }

  releaseThread(threadId: string): Promise<void> {
    if (!this.isAvailable() || this.closed) return Promise.resolve()
    const tracked = this.threadGoals.has(threadId)
    return this.threadLifecycle.use(threadId, async () => {
      if (tracked && !this.threadGoals.has(threadId)) return
      if (await this.refreshThreadGoal(threadId)) await this.threadLifecycle.release(threadId)
    })
  }

  private async refreshThreadGoal(threadId: string): Promise<boolean> {
    const appServer = this.requireAppServer()
    const previous = this.threadGoals.get(threadId) ?? { active: true }
    this.threadGoals.set(threadId, previous)
    let active = true
    try {
      const result = await this.callUpstream('thread/goal/get', { threadId }, 5_000)
      if (!isRecord(result) || !('goal' in result)) {
        throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid Goal.')
      }
      active = result.goal === null ? false : goalRetainsThread(result.goal, threadId)
    } catch (error) {
      if (errorCode(error) === 'CODEX_GOALS_UNAVAILABLE') active = false
      else this.logger.warn('Codex Goal state could not be confirmed', { code: errorCode(error) })
    }
    if (this.closed || this.appServer !== appServer || !this.isAvailable() || !this.threadGoals.has(threadId)) return false
    if (this.threadGoals.get(threadId) === previous) this.threadGoals.set(threadId, { active })
    return true
  }

  private rememberThread(connectionId: string, threadId: string, releaseDetached = false): void {
    if (!this.peers.has(connectionId)) {
      if (releaseDetached) void this.releaseThread(threadId).catch(() => undefined)
      return
    }
    let threads = this.peerThreads.get(connectionId)
    if (threads === undefined) {
      threads = new Set()
      this.peerThreads.set(connectionId, threads)
    }
    threads.add(threadId)
  }

  private captureCallScope(connectionId: string): () => void {
    const appServer = this.requireAppServer()
    const peer = this.peers.get(connectionId)
    return () => {
      if (this.closed || this.appServer !== appServer || !this.isAvailable()) {
        throw new RpcError('CODEX_UNAVAILABLE', 'The Codex App Server changed while handling the request.')
      }
      if (peer !== undefined && this.peers.get(connectionId) !== peer) {
        throw new RpcError('CODEX_CONNECTION_CLOSED', 'The Codex connection is closed.')
      }
    }
  }

  private async callInternal(connectionId: string, call: ReturnType<typeof parseCodexCall>, assertCurrent: () => void): Promise<unknown> {
    assertCurrent()
    const attached = this.peers.has(connectionId)

    if (call.method === 'account/read') {
      return sanitizeAccount(await this.callUpstream(call.method, call.params))
    }
    if (call.method === 'project/list') {
      return sanitizeProjectList(await this.callUpstream(call.method, call.params))
    }
    if (call.method === 'project/create') {
      const roots = call.params.roots as Array<{ path: string }>
      const path = await this.requireNewCodexProjectPath(roots[0]!.path)
      assertCurrent()
      return sanitizeProjectCreate(await this.callUpstream(call.method, {
        name: call.params.name,
        roots: [{ path }],
        idempotencyKey: call.params.idempotencyKey,
      }))
    }
    if (call.method === 'thread/list') {
      const result = sanitizeThreadList(await this.callUpstream(call.method, call.params)) as {
        data: Record<string, unknown>[]
      }
      return filterThreadListByWorkspaceAuthority(
        result,
        await this.readWorkspaceAuthority(result.data),
      )
    }
    if (call.method === 'thread/start') {
      const cwd = await this.requireCodexWorkspacePath(call.params.cwd as string)
      assertCurrent()
      const permission = codexPermission(call.params, 'workspace-write')
      const result = await this.callUpstream(call.method, {
        ...permission.params,
        cwd,
        ...codexThreadPermissionParams(permission),
        serviceName: 'deepseek_harness_remote',
      })
      const createdId = extractThread(result)?.id
      if (typeof createdId === 'string') {
        this.rememberThread(connectionId, createdId, attached)
        this.rememberThreadMeta(createdId, extractThread(result))
      }
      assertCurrent()
      if (extractThread(result)?.id === undefined) {
        throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid thread.')
      }
      this.rememberPermission(extractThread(result)!.id as string, result)
      return result
    }

    const threadId = threadIdFromParams(call.params)

    if (call.method === 'dsh/sessionHistory') {
      const latestHistory = call.params.beforeSeq === undefined && call.params.throughSeq === undefined
      const watermark = latestHistory ? this.nextBufferSeq : undefined
      const thread = await this.readThreadForHistory(connectionId, threadId!)
      assertCurrent()
      if (watermark !== undefined) this.pruneBufferedFramesAgainstHistory(threadId!, thread, watermark)
      let page: ReturnType<typeof paginateCodexNativeHistory>
      try {
        page = paginateCodexNativeHistory(
          projectCodexNativeHistory(thread, `codex:${threadId}`),
          {
            beforeSeq: optionalInteger(call.params.beforeSeq),
            throughSeq: optionalInteger(call.params.throughSeq),
            maxMessages: optionalInteger(call.params.maxMessages),
            turnWindow: normalizeVirtualHistoryTurnWindow(call.params.turnWindow),
          },
        )
      } catch (error) {
        if (error instanceof VirtualHistoryResponseTooLargeError) {
          throw new RpcError(
            'RESPONSE_TOO_LARGE',
            error.message,
            { actualBytes: error.actualBytes, maxBytes: error.maxBytes },
            false,
          )
        }
        throw error
      }
      const activeTurnId = typeof page.activeTurnId === 'string'
        ? page.activeTurnId
        : this.turnOwners.get(threadId!)?.turnId
      return {
        ...page,
        ...(activeTurnId === undefined ? {} : { activeTurnId }),
        permissionPreset: this.permissionPresets.get(threadId!) ?? null,
      }
    }
    if (call.method === 'dsh/sessionAttachment') {
      const attachmentId = call.params.attachmentId as string
      const thread = await this.readThreadForHistory(connectionId, threadId!)
      const history = projectCodexNativeHistory(thread, `codex:${threadId}`)
      const found = findProjectedImageAttachment(history.entries, attachmentId)
      if (found === undefined) {
        throw new RpcError('CODEX_ATTACHMENT_NOT_FOUND', 'The CodeX image is not available in this Session.')
      }
      return found
    }
    if (call.method === 'dsh/directoryList') {
      return this.listCodexDirectory(call.params.path as string)
    }

    const allowedThread = threadId === undefined ? undefined : await this.readKnownThread(threadId)
    assertCurrent()
    if (threadId !== undefined) {
      this.rememberThread(connectionId, threadId)
      if (allowedThread !== undefined) this.rememberThreadMeta(threadId, allowedThread.thread, allowedThread.cwd)
    }

    if (call.method === 'thread/resume' && call.params.permissionPreset !== undefined) {
      const owner = this.turnOwners.get(threadId!)
      if (owner !== undefined && owner.connectionId !== connectionId) {
        throw new RpcError('CODEX_THREAD_BUSY', 'Another Remote client is writing to this CodeX thread.')
      }
      if (this.hasPendingApprovalForThread(threadId!)) {
        throw new RpcError('CODEX_THREAD_BUSY', 'Resolve pending CodeX approvals before changing permissions.')
      }
      return this.changeThreadPermission(threadId!, call.params, allowedThread!, assertCurrent)
    }

    if (call.method === 'thread/read') {
      // assertThreadAllowed already produced a bounded summary, but make the
      // requested read again so includeTurns has its official semantics.
      const watermark = call.params.includeTurns === true ? this.nextBufferSeq : undefined
      const result = await this.callUpstream(call.method, call.params)
      assertCurrent()
      if (watermark !== undefined) {
        const thread = extractThread(result)
        if (thread !== undefined && thread.id === threadId) {
          this.pruneBufferedFramesAgainstHistory(threadId!, thread, watermark)
        }
      }
      return result
    }
    if (call.method === 'thread/unsubscribe') {
      const bridge = this.peers.get(connectionId)
      bridge?.removeThreadSubscriptions(threadId!)
      await this.releaseThread(threadId!)
      if (!this.hasSubscriber(threadId!)) this.recentFrames.delete(threadId!)
      return { status: 'unsubscribed' }
    }

    let claimed = false
    let previousOwner: ActiveTurnOwner | undefined
    let claimedOwner: ActiveTurnOwner | undefined
    if (isThreadMutation(call.method) && threadId !== undefined) {
      if (call.method === 'turn/start' && this.hasPendingApprovalForThread(threadId)) {
        const currentOwner = this.turnOwners.get(threadId)
        const peerDeviceId = this.peerDeviceIds.get(connectionId) ?? connectionId
        if (currentOwner !== undefined && currentOwner.connectionId !== connectionId && currentOwner.peerDeviceId !== peerDeviceId) {
          throw new RpcError('CODEX_TURN_OWNED', 'Another Remote connection owns the active Codex turn.')
        }
        throw new RpcError('CODEX_THREAD_BUSY', 'Resolve pending CodeX approvals before starting a new turn.')
      }
      const claim = this.claimTurn(
        threadId,
        connectionId,
        call.method,
        typeof call.params.turnId === 'string' ? call.params.turnId : undefined,
      )
      claimed = claim.claimed
      previousOwner = claim.previous
      claimedOwner = this.turnOwners.get(threadId)
      if (call.method === 'turn/interrupt') {
        this.declineApprovalsForThreadSync(threadId)
      }
    }
    const finishStart = call.method === 'turn/start' && threadId !== undefined
      ? this.threadLifecycle.starting(threadId)
      : undefined
    try {
      const permission = codexPermission(call.params)
      const upstreamParams = call.method === 'thread/resume' && allowedThread !== undefined
        ? {
            ...permission.params,
            ...(allowedThread.cwd === undefined ? {} : { cwd: allowedThread.cwd }),
            ...codexThreadPermissionParams(permission),
            excludeTurns: true,
          }
        : call.method === 'thread/fork' && allowedThread !== undefined
          ? {
              ...permission.params,
              ...(allowedThread.cwd === undefined ? {} : { cwd: allowedThread.cwd }),
              ...codexThreadPermissionParams(permission),
            }
        : call.method === 'turn/start'
          ? {
              ...permission.params,
              ...(allowedThread?.cwd === undefined ? {} : { cwd: allowedThread.cwd }),
              ...codexTurnPermissionParams(permission, allowedThread?.cwd),
            }
          : permission.params
      let result: unknown
      try {
        result = await this.callUpstream(call.method, upstreamParams)
      } catch (error) {
        assertCurrent()
        // App Server rejects thread/resume when this process already has the
        // thread loaded. Remote callers should be able to resume defensively
        // before every turn, including immediately after thread/start.
        if (call.method === 'thread/resume'
          && allowedThread !== undefined
          && error instanceof RpcError
          && (error.code === 'CODEX_UPSTREAM_ERROR' || error.code === CODEX_THREAD_UNMATERIALIZED)
          && call.params.permissionPreset === undefined) {
          return { thread: allowedThread.thread }
        }
        throw error
      }
      finishStart?.(true)
      if (call.method === 'thread/fork') {
        const createdId = extractThread(result)?.id
        if (typeof createdId === 'string') this.rememberThread(connectionId, createdId, attached)
      }
      assertCurrent()
      if (call.method === 'thread/resume' || call.method === 'thread/fork' || call.method === 'thread/unarchive') {
        await this.assertResultThreadAllowed(result)
        assertCurrent()
      }
      if (call.method === 'thread/resume' || call.method === 'thread/fork') {
        const resultId = extractThread(result)?.id
        if (typeof resultId === 'string') {
          this.rememberPermission(resultId, result)
          if (call.params.permissionPreset !== undefined) await this.publishPermission(resultId, result)
        }
      }
      if (call.method === 'turn/start' && threadId !== undefined) {
        this.rememberTurnId(threadId, connectionId, extractTurnId(result))
        this.armTurnWatchdog(threadId)
        this.attention?.onSessionRunning(this.attentionSessionInfo(threadId))
        if (call.params.permissionPreset !== undefined) {
          await this.publishPermission(threadId, codexTurnPermissionParams(permission, allowedThread?.cwd))
        }
      }
      return result
    } catch (error) {
      finishStart?.(errorCode(error) === 'CODEX_REQUEST_TIMEOUT')
      if (claimed && threadId !== undefined && this.turnOwners.get(threadId) === claimedOwner) {
        if (previousOwner === undefined) this.turnOwners.delete(threadId)
        else this.turnOwners.set(threadId, previousOwner)
        if (previousOwner === undefined) this.clearTurnWatchdog(threadId)
      }
      throw mapAppServerError(error)
    }
  }

  async respond(connectionId: string, input: unknown): Promise<{ resolved: true }> {
    if (!this.peers.has(connectionId)) {
      throw new RpcError('CODEX_CONNECTION_CLOSED', 'The Codex connection is closed.')
    }
    const params = parseRespond(input)
    const approval = this.approvals.get(params.requestHandle)
    if (approval === undefined) {
      throw new RpcError('CODEX_APPROVAL_NOT_FOUND', 'The Codex approval is missing, expired, or belongs to another connection.')
    }
    if (approval.expiresAt <= Date.now()) {
      this.deleteApproval(params.requestHandle)
      this.scheduleApprovalExpiry()
      this.attention?.onInteractionResolved(codexApprovalItemId(params.requestHandle))
      const staleAppServer = this.appServer
      void staleAppServer?.respond(approval.upstreamId, { decision: 'decline' }).catch(() => undefined)
      void this.threadLifecycle.retry(approval.threadId)
      throw new RpcError('CODEX_APPROVAL_NOT_FOUND', 'The Codex approval is missing, expired, or belongs to another connection.')
    }
    if (approval.ownerConnectionId !== null && approval.ownerConnectionId !== connectionId) {
      throw new RpcError('CODEX_APPROVAL_NOT_FOUND', 'The Codex approval is missing, expired, or belongs to another connection.')
    }
    if (approval.ownerConnectionId === null) {
      const turnOwner = this.turnOwners.get(approval.threadId)
      if (turnOwner !== undefined && turnOwner.connectionId !== connectionId && this.peers.has(turnOwner.connectionId)) {
        throw new RpcError('CODEX_THREAD_BUSY', 'Another Remote connection owns the active Codex turn.')
      }
    }
    const appServer = this.requireAppServer()
    // True single-assignment: synchronously remove BEFORE the first await so
    // concurrent responses or expiry timers can never double-send upstream.
    this.deleteApproval(params.requestHandle)
    this.scheduleApprovalExpiry()
    this.attention?.onInteractionResolved(codexApprovalItemId(params.requestHandle))
    if (approval.ownerConnectionId === null && !this.turnOwners.has(approval.threadId)) {
      this.turnOwners.set(approval.threadId, {
        connectionId,
        peerDeviceId: this.peerDeviceIds.get(connectionId) ?? connectionId,
      })
    }
    if (!this.hasPendingApprovalForThread(approval.threadId) && this.turnOwners.has(approval.threadId)) {
      this.armTurnWatchdog(approval.threadId)
    }
    try {
      await appServer.respond(approval.upstreamId, { decision: params.decision })
    } finally {
      await this.threadLifecycle.retry(approval.threadId)
    }
    return { resolved: true }
  }

  async detachPeer(connectionId: string): Promise<void> {
    const threadIds = this.peerThreads.get(connectionId) ?? new Set<string>()
    this.peerThreads.delete(connectionId)
    const bridge = this.peers.get(connectionId)
    if (bridge !== undefined) this.peers.delete(connectionId)
    this.peerDeviceIds.delete(connectionId)
    for (const [threadId, owner] of this.turnOwners) {
      if (owner.connectionId !== connectionId) continue
      this.turnOwners.delete(threadId)
      this.clearTurnWatchdog(threadId)
    }
    const appServer = this.appServer
    const pending = [...this.approvals.entries()].filter(([, approval]) => approval.ownerConnectionId === connectionId)
    const toDecline: PendingApproval[] = []
    for (const [handle, approval] of pending) {
      if (this.detachedApprovalGraceMs > 0 && this.detachedApprovalBudget.tryAcquire(codexDetachedBudgetKey(handle))) {
        const detachedExpiresAt = Date.now() + this.detachedApprovalGraceMs
        approval.ownerConnectionId = null
        approval.detachedExpiresAt = detachedExpiresAt
        approval.expiresAt = detachedExpiresAt
        this.attention?.onInteractionDetached(codexApprovalItemId(handle), detachedExpiresAt)
      } else {
        this.deleteApproval(handle)
        this.attention?.onInteractionResolved(codexApprovalItemId(handle))
        toDecline.push(approval)
      }
    }
    this.scheduleApprovalExpiry()
    for (const approval of toDecline) {
      await appServer?.respond(approval.upstreamId, { decision: 'decline' }).catch(() => undefined)
      if (!threadIds.has(approval.threadId)) void this.threadLifecycle.retry(approval.threadId)
    }
    await Promise.allSettled([...threadIds].map(threadId => this.releaseThread(threadId)))
  }

  async reconfigure(config: ResolvedCodexConfig): Promise<void> {
    if (this.closed) throw new RpcError('CODEX_CLOSED', 'The Codex Remote domain is closed.')
    if (JSON.stringify(this.config) === JSON.stringify(config)) return
    this.reconfigureDepth += 1
    try {
      this.config = config
      this.lifecycleGeneration += 1
      this.available = false
      this.state = config.enabled ? 'starting' : 'disabled'
      this.threadLifecycle.reset()
      this.peerThreads.clear()
      this.threadGoals.clear()
      if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
      this.restartTimer = undefined
      await this.disposeAppServer(this.appServer)
      await this.startPromise?.catch(() => undefined)
      if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
      this.restartTimer = undefined
      this.available = false
      await Promise.all([...this.peers.values()].map(peer => peer.failStreams('failed')))
      this.clearAllTurnWatchdogs()
      this.turnOwners.clear()
      this.permissionPresets.clear()
      this.recentFrames.clear()
      this.knownThreadPromises.clear()
      const pendingOnReconfigure = [...this.approvals.values()]
      this.approvals.clear()
      this.detachedApprovalBudget.releasePrefix('codex:')
      if (this.approvalExpiryTimer !== undefined) clearTimeout(this.approvalExpiryTimer)
      this.approvalExpiryTimer = undefined
      this.attention?.onBackendCleared('codex')
      const reconfigureServer = this.appServer
      if (pendingOnReconfigure.length > 0 && reconfigureServer !== undefined) {
        await Promise.allSettled(pendingOnReconfigure.map(approval =>
          reconfigureServer.respond(approval.upstreamId, { decision: 'decline' })))
      }
      await this.disposeAppServer(this.appServer)
      this.inboundChains.clear()
      this.pendingRequestThreads.clear()
      this.lastOnDemandRecoveryAt = 0
      this.restartAttempt = 0
      this.unavailableCode = undefined
      this.state = 'disabled'
      if (this.closed) throw new RpcError('CODEX_CLOSED', 'The Codex Remote domain is closed.')
      await this.start()
    } finally {
      this.reconfigureDepth -= 1
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.lifecycleGeneration += 1
    this.available = false
    this.threadLifecycle.reset()
    this.peerThreads.clear()
    this.threadGoals.clear()
    this.state = this.config.enabled ? 'unavailable' : 'disabled'
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    if (this.approvalExpiryTimer !== undefined) clearTimeout(this.approvalExpiryTimer)
    this.approvalExpiryTimer = undefined
    const pendingOnClose = [...this.approvals.values()]
    this.approvals.clear()
    this.detachedApprovalBudget.releasePrefix('codex:')
    this.attention?.onBackendCleared('codex')
    const closingServer = this.appServer
    if (pendingOnClose.length > 0 && closingServer !== undefined) {
      await Promise.allSettled(pendingOnClose.map(approval =>
        closingServer.respond(approval.upstreamId, { decision: 'decline' })))
    }
    for (const bridge of [...this.peers.values()]) await bridge.closeAll()
    this.peers.clear()
    this.peerDeviceIds.clear()
    this.clearAllTurnWatchdogs()
    this.turnOwners.clear()
    this.permissionPresets.clear()
    this.recentFrames.clear()
    this.threadMeta.clear()
    this.inboundChains.clear()
    this.pendingRequestThreads.clear()
    this.unsubscribeInbound?.()
    this.unsubscribeInbound = undefined
    this.unsubscribeUnavailable?.()
    this.unsubscribeUnavailable = undefined
    await this.appServer?.close()
    this.appServer = undefined
  }

  private async launchAppServer(generation = this.lifecycleGeneration): Promise<void> {
    let lastError: unknown
    for (const binary of codexBinaryCandidates(this.config.binary)) {
      if (this.closed || generation !== this.lifecycleGeneration) return
      try {
        await this.launchAppServerCandidate(binary, generation)
        return
      } catch (error) {
        if (this.closed || generation !== this.lifecycleGeneration) return
        lastError = error
        if (!canTryNextBinary(error)) throw error
      }
    }
    throw lastError ?? new RpcError('CODEX_START_FAILED', 'Codex App Server could not be started.')
  }

  private async launchAppServerCandidate(binary: string, generation: number): Promise<void> {
    if (this.closed || generation !== this.lifecycleGeneration) return
    const appServer = this.createAppServer(binary, this.logger)
    this.appServer = appServer
    this.unsubscribeInbound = appServer.onInbound(message => {
      this.enqueueInbound(appServer, message)
    })
    this.unsubscribeUnavailable = appServer.onUnavailable(code => {
      if (this.available && this.appServer === appServer) {
        void this.handleAppServerUnavailable(appServer, code)
      }
    })
    try {
      await appServer.start()
      if (this.closed || generation !== this.lifecycleGeneration || this.appServer !== appServer) {
        await this.disposeAppServer(appServer)
        await appServer.close().catch(() => undefined)
        return
      }
      const account = await appServer.call('account/read', { refreshToken: false }, 15_000)
      if (!accountCanRun(account)) {
        throw new RpcError('CODEX_AUTH_REQUIRED', 'Codex is not signed in on this Host.')
      }
      if (this.closed || generation !== this.lifecycleGeneration || this.appServer !== appServer) {
        await this.disposeAppServer(appServer)
        await appServer.close().catch(() => undefined)
        return
      }
      this.available = true
      this.state = 'ready'
      this.restartAttempt = 0
      this.unavailableCode = undefined
      this.logger.info('Codex Remote domain ready')
    } catch (error) {
      await this.disposeAppServer(appServer)
      throw error
    }
  }

  private async handleAppServerUnavailable(appServer: CodexAppServerLike, code: string): Promise<void> {
    if (this.closed || this.appServer !== appServer) return
    const generation = this.lifecycleGeneration
    this.available = false
    this.threadLifecycle.reset()
    this.peerThreads.clear()
    this.threadGoals.clear()
    this.state = 'restarting'
    this.unavailableCode = code
    this.clearAllTurnWatchdogs()
    this.turnOwners.clear()
    this.permissionPresets.clear()
    this.recentFrames.clear()
    this.approvals.clear()
    this.detachedApprovalBudget.releasePrefix('codex:')
    if (this.approvalExpiryTimer !== undefined) clearTimeout(this.approvalExpiryTimer)
    this.approvalExpiryTimer = undefined
    this.attention?.onBackendCleared('codex')
    await Promise.all([...this.peers.values()].map(peer => peer.failStreams('failed')))
    if (this.closed || generation !== this.lifecycleGeneration) return
    await this.disposeAppServer(appServer)
    if (this.closed || generation !== this.lifecycleGeneration) return
    this.inboundChains.clear()
    this.pendingRequestThreads.clear()
    this.scheduleRestart(generation)
  }

  private scheduleRestart(generation = this.lifecycleGeneration): void {
    if (this.closed || this.restartTimer !== undefined || generation !== this.lifecycleGeneration) return
    if (this.restartAttempt >= this.restartDelaysMs.length) {
      this.state = 'unavailable'
      this.logger.warn('Codex App Server restart attempts exhausted', { attempts: this.restartAttempt })
      return
    }
    const delayMs = Math.max(0, this.restartDelaysMs[this.restartAttempt] ?? 0)
    this.restartAttempt += 1
    this.state = 'restarting'
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      void this.restartAfterFailure(generation)
    }, delayMs)
    this.restartTimer.unref?.()
    this.logger.warn('Codex App Server restart scheduled', { attempt: this.restartAttempt, delayMs })
  }

  private async restartAfterFailure(generation: number): Promise<void> {
    if (this.closed || generation !== this.lifecycleGeneration) return
    try {
      await this.launchAppServer(generation)
    } catch (error) {
      if (this.closed || generation !== this.lifecycleGeneration) return
      this.available = false
      this.lastOnDemandRecoveryAt = Date.now()
      this.unavailableCode = errorCode(error)
      this.logger.warn('Codex App Server restart failed', {
        attempt: this.restartAttempt,
        code: this.unavailableCode,
      })
      if (!isRetryableCodexStartError(error)) {
        this.state = 'unavailable'
        return
      }
      this.scheduleRestart(generation)
    }
  }

  private async disposeAppServer(appServer: CodexAppServerLike | undefined): Promise<void> {
    if (appServer === undefined || this.appServer !== appServer) return
    this.unsubscribeInbound?.()
    this.unsubscribeInbound = undefined
    this.unsubscribeUnavailable?.()
    this.unsubscribeUnavailable = undefined
    this.appServer = undefined
    await appServer.close().catch(() => undefined)
  }

  private async handleInbound(message: CodexAppServerInbound, receivedAt = Date.now()): Promise<void> {
    if (!this.available) return
    if (message.kind === 'request') {
      await this.handleServerRequest(message)
      return
    }
    const threadId = extractThreadId(message.params)
    if (threadId !== undefined && (message.method === 'thread/goal/updated' || message.method === 'thread/goal/cleared')) {
      const active = message.method !== 'thread/goal/cleared'
        && (!isRecord(message.params) || goalRetainsThread(message.params.goal, threadId))
      this.threadGoals.set(threadId, { active })
      void this.threadLifecycle.retry(threadId)
    }
    if (message.method === 'thread/name/updated' && threadId !== undefined && isRecord(message.params)) {
      const name = typeof message.params.name === 'string' ? message.params.name : undefined
      if (name !== undefined && name.trim().length > 0) this.rememberThreadMeta(threadId, { name })
    }
    if (message.method === 'thread/settings/updated' && threadId !== undefined) {
      this.rememberPermission(threadId, message.params)
    }
    if (message.method === 'thread/closed' && threadId !== undefined) {
      const releasing = this.threadLifecycle.isReleasing(threadId)
      this.permissionPresets.delete(threadId)
      this.turnOwners.delete(threadId)
      this.clearTurnWatchdog(threadId)
      this.declineApprovalsForThreadSync(threadId)
      this.threadLifecycle.closed(threadId)
      this.attention?.onSessionRemoved('codex', `codex:${threadId}`)
      if (!releasing) this.recentFrames.delete(threadId)
    }
    if (message.method === 'turn/completed' && threadId !== undefined) {
      this.turnOwners.delete(threadId)
      this.clearTurnWatchdog(threadId)
      this.threadLifecycle.active(threadId, false)
      const turn = isRecord(message.params) && isRecord(message.params.turn) ? message.params.turn : undefined
      const turnStatus = typeof turn?.status === 'string' ? turn.status : undefined
      if (turnStatus === 'interrupted' || turnStatus === 'cancelled') {
        this.attention?.onSessionCancelled('codex', `codex:${threadId}`)
      } else {
        const failed = turnStatus === 'failed'
        const errorMessage = failed && isRecord(turn?.error) && typeof turn.error.message === 'string'
          ? turn.error.message
          : undefined
        this.attention?.onSessionCompleted({
          ...this.attentionSessionInfo(threadId),
          failed,
          ...(errorMessage === undefined ? {} : { summary: errorMessage }),
        })
      }
    }
    if (message.method === 'thread/status/changed' && threadId !== undefined
      && isTerminalThreadStatus(message.params)) {
      // Some App Server failure/interruption paths publish only the terminal
      // Thread status and omit turn/completed. Release the Host-side writer
      // lease as soon as the authoritative status is no longer active, or a
      // later Prompt can be rejected as owned by a dead connection.
      const wasActive = this.turnOwners.has(threadId) || this.threadLifecycle.isActive(threadId)
      this.turnOwners.delete(threadId)
      this.clearTurnWatchdog(threadId)
      this.declineApprovalsForThreadSync(threadId)
      this.threadLifecycle.active(threadId, false)
      if (wasActive) {
        const statusType = isRecord(message.params) && isRecord(message.params.status) && typeof message.params.status.type === 'string'
          ? message.params.status.type
          : undefined
        if (statusType === 'systemError' || statusType === 'failed') {
          this.attention?.onSessionCompleted({ ...this.attentionSessionInfo(threadId), failed: true })
        }
      }
    }
    if (message.method === 'turn/started' && threadId !== undefined) {
      this.threadLifecycle.active(threadId, true)
      const owner = this.turnOwners.get(threadId)
      const turnId = extractTurnId(message.params)
      if (owner !== undefined) {
        this.turnOwners.set(threadId, { ...owner, ...(turnId === undefined ? {} : { turnId }) })
      }
      this.armTurnWatchdog(threadId)
      this.attention?.onSessionRunning(this.attentionSessionInfo(threadId))
    }
    if (message.method === 'thread/status/changed' && threadId !== undefined
      && isRecord(message.params) && isRecord(message.params.status) && message.params.status.type === 'active') {
      this.threadLifecycle.active(threadId, true)
    }
    if (message.method === 'serverRequest/resolved') {
      const resolved = this.resolveUpstreamApproval(message.params)
      if (resolved.length > 0) {
        for (const entry of resolved) {
          const targetThreadId = threadId ?? entry.threadId
          if (this.turnOwners.has(targetThreadId)) this.armTurnWatchdog(targetThreadId)
          const params = isRecord(message.params)
            ? { ...message.params, threadId: targetThreadId, requestHandle: entry.handle }
            : { threadId: targetThreadId, requestHandle: entry.handle }
          await this.publishToThread(targetThreadId, {
            method: message.method,
            params,
          }, receivedAt)
        }
        return
      }
    }
    if (threadId === undefined) return
    if (this.turnOwners.has(threadId)) this.armTurnWatchdog(threadId)
    await this.publishToThread(threadId, {
      method: message.method,
      params: message.params,
    }, receivedAt)
  }

  /** Synthesize live pending approvals for a newly attached stream without polluting `recentFrames`. */
  async deliverPendingApprovals(
    connectionId: string,
    streamId: string,
    threadId: string,
  ): Promise<void> {
    const peer = this.peers.get(connectionId)
    if (peer === undefined) return
    const expired = this.expireApprovalsSync()
    if (expired.length > 0) {
      const appServer = this.appServer
      for (const approval of expired) {
        void appServer?.respond(approval.upstreamId, { decision: 'decline' }).catch(() => undefined)
        void this.threadLifecycle.retry(approval.threadId)
      }
    }
    const turnOwner = this.turnOwners.get(threadId)
    const ownedByOtherLivePeer = turnOwner !== undefined
      && turnOwner.connectionId !== connectionId
      && this.peers.has(turnOwner.connectionId)
    const liveApprovals = [...this.approvals.values()].filter(approval =>
      approval.threadId === threadId
      && (approval.ownerConnectionId === connectionId
        || (approval.ownerConnectionId === null && !ownedByOtherLivePeer)))
    for (const approval of liveApprovals) {
      await peer.publishReplayFrame(streamId, {
        method: approval.method,
        params: approval.params,
      })
    }
  }

  /** Replay buffered real-time frames missed while no stream was subscribed. */
  async replayBufferedFrames(
    connectionId: string,
    streamId: string,
    threadId: string,
  ): Promise<{ count: number; truncated: boolean }> {
    const peer = this.peers.get(connectionId)
    if (peer === undefined) return { count: 0, truncated: false }
    this.pruneFrameBuffer(threadId)
    const buffered = this.recentFrames.get(threadId)
    if (buffered === undefined || buffered.frames.length === 0) return { count: 0, truncated: false }
    this.recentFrames.delete(threadId)
    const truncated = buffered.truncated
    let count = 0
    for (let index = 0; index < buffered.frames.length; index += 1) {
      const frame = buffered.frames[index]!
      try {
        await peer.publishReplayFrame(streamId, { method: frame.method, params: frame.params })
        count += 1
      } catch (error) {
        if (isResponseTooLargeError(error)) {
          this.logger.warn('Skipped oversized buffered Codex frame during replay', {
            threadId: maskId(threadId),
            method: frame.method,
          })
          continue
        }
        this.restoreBufferedFrames(threadId, buffered.frames.slice(index), truncated, buffered.truncatedAtSeq)
        throw error
      }
    }
    if (count > 0 || truncated) {
      this.logger.info('Replaying buffered Codex frames', {
        threadId: maskId(threadId),
        count,
        ...(truncated ? { truncated: true } : {}),
      })
    }
    return { count, truncated }
  }

  rebufferOpeningFrames(
    threadId: string,
    frames: ReadonlyArray<{ method: string; params: unknown }>,
    truncated: boolean,
  ): void {
    if (frames.length === 0 || this.hasSubscriber(threadId)) return
    for (const frame of frames) this.bufferFrame(threadId, frame)
    if (truncated) {
      const entry = this.recentFrames.get(threadId)
      if (entry !== undefined) {
        entry.truncated = true
        entry.truncatedAtSeq = this.nextBufferSeq
      }
    }
  }

  private async publishToThread(
    threadId: string,
    frame: { method: string; params: unknown },
    receivedAt = Date.now(),
  ): Promise<void> {
    const subscribers = [...this.peers.values()].filter(peer => peer.hasThreadSubscription(threadId))
    if (subscribers.length === 0) {
      this.bufferFrame(threadId, frame, receivedAt)
      return
    }
    let deliveryFailed = false
    await Promise.all(subscribers.map(async peer => {
      try {
        await peer.publishInbound(threadId, frame)
      } catch (error) {
        if (isResponseTooLargeError(error)) return
        deliveryFailed = true
        this.logger.warn('Codex frame publish failed', {
          threadId: maskId(threadId),
          method: frame.method,
          code: errorCode(error),
        })
      }
    }))
    if (deliveryFailed) this.bufferFrame(threadId, frame, receivedAt)
  }

  private bufferFrame(threadId: string, frame: { method: string; params: unknown }, receivedAt = Date.now()): void {
    if (!BUFFERABLE_CODEX_METHODS.has(frame.method)) return
    if (isOversizedCodexFrame(frame)) {
      this.logger.warn('Skipped buffering oversized Codex frame', {
        threadId: maskId(threadId),
        method: frame.method,
      })
      return
    }
    this.pruneFrameBuffer(undefined, receivedAt)
    const entry = this.recentFrames.get(threadId) ?? { frames: [], truncated: false, truncatedAtSeq: 0 }
    this.recentFrames.delete(threadId)
    entry.frames.push({ seq: this.nextBufferSeq++, method: frame.method, params: frame.params, at: receivedAt })
    while (entry.frames.length > MAX_BUFFERED_CODEX_FRAMES) {
      entry.frames.shift()
      entry.truncated = true
      entry.truncatedAtSeq = this.nextBufferSeq
    }
    this.recentFrames.set(threadId, entry)
    this.evictExcessBufferedThreads()
  }

  private restoreBufferedFrames(
    threadId: string,
    frames: BufferedCodexFrame[],
    truncated: boolean,
    truncatedAtSeq: number,
  ): void {
    if (frames.length === 0) return
    this.pruneFrameBuffer()
    const existing = this.recentFrames.get(threadId)
    const combined = [...frames, ...(existing?.frames ?? [])]
    let nextTruncated = truncated || existing?.truncated === true
    let nextTruncatedAtSeq = Math.max(truncatedAtSeq, existing?.truncatedAtSeq ?? 0)
    while (combined.length > MAX_BUFFERED_CODEX_FRAMES) {
      combined.shift()
      nextTruncated = true
      nextTruncatedAtSeq = this.nextBufferSeq
    }
    this.recentFrames.delete(threadId)
    this.recentFrames.set(threadId, { frames: combined, truncated: nextTruncated, truncatedAtSeq: nextTruncatedAtSeq })
    this.evictExcessBufferedThreads()
  }

  private pruneFrameBuffer(threadId?: string, now = Date.now()): void {
    const validAfter = now - CODEX_FRAME_BUFFER_TTL_MS
    const pruneEntry = (id: string, entry: BufferedCodexThread): void => {
      const next = entry.frames.filter(frame => frame.at >= validAfter)
      if (next.length === 0) {
        this.recentFrames.delete(id)
        return
      }
      if (next.length < entry.frames.length) {
        entry.truncated = true
        entry.truncatedAtSeq = this.nextBufferSeq
      }
      entry.frames = next
    }
    if (threadId !== undefined) {
      const entry = this.recentFrames.get(threadId)
      if (entry !== undefined) pruneEntry(threadId, entry)
      return
    }
    for (const [id, entry] of this.recentFrames) {
      pruneEntry(id, entry)
    }
  }

  private pruneBufferedFramesAgainstHistory(
    threadId: string,
    thread: Record<string, unknown>,
    watermark: number,
  ): void {
    this.pruneFrameBuffer(threadId)
    const entry = this.recentFrames.get(threadId)
    if (entry === undefined) return
    const turns = Array.isArray(thread.turns) ? thread.turns.filter(isRecord) : []
    if (turns.length === 0) return
    let activeTurn: Record<string, unknown> | undefined
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index]!
      if (turn.status === 'inProgress' || turn.status === 'running') {
        activeTurn = turn
        break
      }
    }
    if (activeTurn === undefined) {
      const next = entry.frames.filter(frame => frame.seq >= watermark)
      if (next.length === 0) this.recentFrames.delete(threadId)
      else {
        entry.frames = next
        if (entry.truncated && entry.truncatedAtSeq < watermark) {
          entry.truncated = false
          entry.truncatedAtSeq = 0
        }
      }
      return
    }
    const activeTurnId = typeof activeTurn.id === 'string' && activeTurn.id.length > 0 ? activeTurn.id : undefined
    const completedTurnIds = new Set<string>()
    const persistedItemIds = new Set<string>()
    for (const turn of turns) {
      if (turn !== activeTurn && typeof turn.id === 'string' && turn.id.length > 0) {
        completedTurnIds.add(turn.id)
      }
      if (Array.isArray(turn.items)) {
        for (const item of turn.items) {
          if (isRecord(item) && typeof item.id === 'string' && item.id.length > 0) {
            persistedItemIds.add(item.id)
          }
        }
      }
    }
    const next = entry.frames.filter(frame => {
      if (frame.seq >= watermark) return true
      if (THREAD_METADATA_METHODS.has(frame.method)) return false
      const frameTurnId = extractFrameTurnId(frame.params)
      if (frameTurnId !== undefined && completedTurnIds.has(frameTurnId)) return false
      if (frame.method === 'turn/started'
        && (activeTurnId === undefined || frameTurnId === undefined || frameTurnId === activeTurnId)) {
        return false
      }
      const frameItemId = extractFrameItemId(frame.params)
      if (frameItemId !== undefined && persistedItemIds.has(frameItemId)) return false
      return true
    })
    if (next.length === 0) this.recentFrames.delete(threadId)
    else entry.frames = next
  }

  private evictExcessBufferedThreads(): void {
    while (this.recentFrames.size > MAX_BUFFERED_CODEX_THREADS) {
      const oldest = this.recentFrames.keys().next().value
      if (oldest === undefined) break
      this.recentFrames.delete(oldest)
    }
  }

  private rememberPermission(threadId: string, value: unknown): void {
    const preset = codexPermissionPresetFromResponse(value)
    if (preset === undefined) this.permissionPresets.delete(threadId)
    else this.permissionPresets.set(threadId, preset)
  }

  private async changeThreadPermission(
    threadId: string,
    params: Record<string, unknown>,
    allowed: { thread: Record<string, unknown>; cwd?: string },
    assertCurrent: () => void,
  ): Promise<unknown> {
    const permission = codexPermission(params)
    const settings: Record<string, unknown> = {
      ...codexTurnPermissionParams(permission, allowed.cwd),
      ...(params.model === undefined ? {} : { model: params.model }),
    }
    let result: unknown
    try {
      // Loaded threads can reject resume or ignore its configuration overrides.
      await this.callUpstream('thread/settings/update', { threadId, ...settings })
      assertCurrent()
      result = { thread: allowed.thread, ...settings, sandbox: settings.sandboxPolicy }
    } catch (error) {
      assertCurrent()
      // Threads created in this App Server process may not be persisted yet;
      // the resume contract rejects them even though the thread is usable.
      // Treating that as a loaded thread keeps new-session permission changes
      // working while genuine upstream failures still fail closed.
      if (isUnpersistedThreadError(error)) {
        return { thread: allowed.thread, ...settings, sandbox: settings.sandboxPolicy }
      }
      // Unloaded threads and older App Servers still use the resume contract.
      // The resume contract also rejects threads created in this App Server
      // process before their rollout file exists; those threads are usable.
      try {
        result = await this.callUpstream('thread/resume', {
          ...permission.params,
          ...(allowed.cwd === undefined ? {} : { cwd: allowed.cwd }),
          ...codexThreadPermissionParams(permission),
          excludeTurns: true,
        })
        assertCurrent()
      } catch (resumeError) {
        assertCurrent()
        if (isUnpersistedThreadError(resumeError)) {
          return { thread: allowed.thread, ...settings, sandbox: settings.sandboxPolicy }
        }
        throw resumeError
      }
      await this.assertResultThreadAllowed(result)
      assertCurrent()
      if (codexPermissionPresetFromResponse(result) !== params.permissionPreset) {
        await this.callUpstream('thread/settings/update', { threadId, ...settings })
        assertCurrent()
        result = { ...(isRecord(result) ? result : {}), ...settings, sandbox: settings.sandboxPolicy }
      }
    }
    await this.publishPermission(threadId, result)
    return result
  }

  private async publishPermission(threadId: string, value: unknown): Promise<void> {
    if (!this.available) return
    const source = isRecord(value) ? value : {}
    const threadSettings = { approvalPolicy: source.approvalPolicy, sandboxPolicy: source.sandboxPolicy ?? source.sandbox }
    const params = { threadId, threadSettings }
    this.rememberPermission(threadId, params)
    await this.publishToThread(threadId, { method: 'thread/settings/updated', params })
  }

  private async handleServerRequest(message: Extract<CodexAppServerInbound, { kind: 'request' }>): Promise<void> {
    const appServer = this.requireAppServer()
    await this.expireApprovals()
    if (this.appServer !== appServer || !this.isAvailable()) return
    if (message.method !== 'item/commandExecution/requestApproval'
      && message.method !== 'item/fileChange/requestApproval') {
      await appServer.respondError(message.id, -32601, 'This Remote client does not support the server request.')
      return
    }
    const threadId = extractThreadId(message.params)
    const owner = threadId === undefined ? undefined : this.turnOwners.get(threadId)
    const peer = owner === undefined ? undefined : this.peers.get(owner.connectionId)
    const hasLiveOwner = threadId !== undefined && owner !== undefined && peer !== undefined && peer.hasThreadSubscription(threadId)
    if (!hasLiveOwner) {
      const requestHandle = randomUUID()
      const canDetach = threadId !== undefined
        && this.threadLifecycle.isActive(threadId)
        && this.detachedApprovalGraceMs > 0
        && this.detachedApprovalBudget.tryAcquire(codexDetachedBudgetKey(requestHandle))
      if (!canDetach) {
        await appServer.respond(message.id, { decision: 'decline' })
        return
      }
      const sanitizedParams = sanitizeApprovalParams(message.params, requestHandle)
      const detachedExpiresAt = Date.now() + this.detachedApprovalGraceMs
      this.approvals.set(requestHandle, {
        upstreamId: message.id,
        ownerConnectionId: null,
        threadId,
        method: message.method,
        params: sanitizedParams,
        expiresAt: detachedExpiresAt,
        detachedExpiresAt,
      })
      this.clearTurnWatchdog(threadId)
      this.scheduleApprovalExpiry()
      this.attention?.onInteractionPending({
        ...this.attentionSessionInfo(threadId),
        id: codexApprovalItemId(requestHandle),
        status: 'waiting_approval',
        detachedExpiresAt,
        ...(codexApprovalSummary(message.method, message.params) === undefined
          ? {}
          : { summary: codexApprovalSummary(message.method, message.params) }),
      })
      return
    }
    const requestHandle = randomUUID()
    const sanitizedParams = sanitizeApprovalParams(message.params, requestHandle)
    this.approvals.set(requestHandle, {
      upstreamId: message.id,
      ownerConnectionId: owner.connectionId,
      threadId,
      method: message.method,
      params: sanitizedParams,
      expiresAt: Date.now() + APPROVAL_TTL_MS,
    })
    // Pause silence watchdog while approval is pending so failSilentTurn never
    // kills an active approval mid-wait.
    this.clearTurnWatchdog(threadId)
    this.scheduleApprovalExpiry()
    this.attention?.onInteractionPending({
      ...this.attentionSessionInfo(threadId),
      id: codexApprovalItemId(requestHandle),
      status: 'waiting_approval',
      ...(codexApprovalSummary(message.method, message.params) === undefined
        ? {}
        : { summary: codexApprovalSummary(message.method, message.params) }),
    })
    try {
      await peer.publishInbound(threadId, {
        method: message.method,
        params: sanitizedParams,
      })
    } catch (error) {
      const current = this.approvals.get(requestHandle)
      if (current !== undefined && current.ownerConnectionId === owner.connectionId) {
        this.deleteApproval(requestHandle)
        this.scheduleApprovalExpiry()
        this.attention?.onInteractionResolved(codexApprovalItemId(requestHandle))
        if (!this.hasPendingApprovalForThread(threadId) && this.turnOwners.has(threadId)) {
          this.armTurnWatchdog(threadId)
        }
        await appServer.respond(message.id, { decision: 'decline' }).catch(() => undefined)
        await this.threadLifecycle.retry(threadId)
      }
      throw error
    }
  }

  private readKnownThread(threadId: string): Promise<{ thread: Record<string, unknown>; cwd?: string }> {
    const pending = this.knownThreadPromises.get(threadId)
    if (pending !== undefined) return pending
    const current = this.readKnownThreadUncached(threadId)
    this.knownThreadPromises.set(threadId, current)
    void current.finally(() => {
      if (this.knownThreadPromises.get(threadId) === current) this.knownThreadPromises.delete(threadId)
    }).catch(() => undefined)
    return current
  }

  private async readKnownThreadUncached(threadId: string): Promise<{ thread: Record<string, unknown>; cwd?: string }> {
    const authority = await this.readWorkspaceAuthority()
    let result: unknown
    try {
      result = await this.callUpstream('thread/read', { threadId, includeTurns: false })
    } catch (error) {
      if (!isHistoryReadRecoverable(error)) throw error
      const listed = await this.findKnownThreadInList(threadId, authority)
      if (listed === undefined) {
        throw new RpcError('CODEX_THREAD_NOT_ALLOWED', 'The Codex thread is not available through this Remote Host.')
      }
      return { thread: listed, ...(typeof listed.cwd === 'string' && listed.cwd.length > 0 ? { cwd: listed.cwd } : {}) }
    }
    const thread = extractThread(result)
    if (thread === undefined || thread.id !== threadId || !isThreadAllowedByWorkspaceAuthority(thread, authority)) {
      throw new RpcError('CODEX_THREAD_NOT_ALLOWED', 'The Codex thread is not available through this Remote Host.')
    }
    return { thread, ...(typeof thread.cwd === 'string' && thread.cwd.length > 0 ? { cwd: thread.cwd } : {}) }
  }

  private async readThreadForHistory(connectionId: string, threadId: string): Promise<Record<string, unknown>> {
    const { thread: metadata } = await this.readKnownThread(threadId)
    try {
      return { ...metadata, turns: await this.readThreadTurns(connectionId, threadId, 'full') }
    } catch (fullError) {
      if (!isHistoryFormatFallback(fullError)) throw fullError
      this.logHistoryFallback(connectionId, 'turns-full', fullError)
    }
    try {
      return { ...metadata, turns: await this.readThreadTurns(connectionId, threadId, 'summary') }
    } catch (summaryError) {
      if (!isHistoryFormatFallback(summaryError)) throw summaryError
      this.logHistoryFallback(connectionId, 'turns-summary', summaryError)
    }
    try {
      const legacyResult = await this.callUpstream('thread/read', { threadId, includeTurns: true })
      const legacyThread = extractThread(legacyResult)
      if (legacyThread === undefined || legacyThread.id !== threadId || !Array.isArray(legacyThread.turns)) {
        throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid Thread history.')
      }
      if (legacyThread.turns.some(turn => !isRecord(turn) || typeof turn.id !== 'string'
        || !Array.isArray(turn.items) || turn.items.some(item => !isRecord(item)))) {
        throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned invalid Thread history content.')
      }
      return legacyThread
    } catch (legacyError) {
      // Only a single legacy read happened here, so there is no earlier
      // baseline to protect: an unmaterialized Thread is empty history.
      if (isUnmaterializedThreadError(legacyError)) {
        this.logEmptyUnmaterializedHistory(connectionId, 'thread-read-full')
        return { ...metadata, turns: [] }
      }
      if (!isHistoryReadRecoverable(legacyError)) throw legacyError
      this.logHistoryFallback(connectionId, 'thread-read-full', legacyError)
      // A failed read is not an empty conversation. Let clients retry instead
      // of replacing a previously populated baseline with a successful blank.
      throw legacyError
    }
  }

  private async readThreadTurns(
    connectionId: string,
    threadId: string,
    itemsView: 'full' | 'summary',
  ): Promise<Record<string, unknown>[]> {
    const turns: Record<string, unknown>[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_CODEX_HISTORY_PAGES; page += 1) {
      let result: unknown
      try {
        result = await this.callUpstream('thread/turns/list', {
          threadId,
          limit: CODEX_HISTORY_PAGE_LIMIT,
          sortDirection: 'asc',
          itemsView,
          ...(cursor === undefined ? {} : { cursor }),
        })
      } catch (error) {
        // A Thread created in this App Server process has no turns until its
        // first user message materializes it. Only an empty first page is that
        // state; a later failure must not replace turns already read.
        if (page === 0 && isUnmaterializedThreadError(error)) {
          this.logEmptyUnmaterializedHistory(connectionId, `turns-${itemsView}`)
          return []
        }
        throw error
      }
      if (!isRecord(result) || !Array.isArray(result.data)) {
        throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid Turn page.')
      }
      const pageResult = result
      // Turn item pages are independent once the turn page is available. Fetch
      // them together to avoid making a long history wait for every prior turn;
      // Promise.all preserves the upstream turn order in the resulting array.
      const pageTurns = await Promise.all(result.data.map(async rawTurn => {
        if (!isRecord(rawTurn) || typeof rawTurn.id !== 'string' || rawTurn.id.length === 0
          || rawTurn.itemsView === 'full' && !Array.isArray(rawTurn.items)) {
          throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid history Turn.')
        }
        const inlineFull = rawTurn.itemsView === 'full'
          || rawTurn.itemsView === undefined && itemsView === 'full' && Array.isArray(rawTurn.items)
        const items = inlineFull ? rawTurn.items as unknown[] : await this.readThreadItems(threadId, rawTurn.id)
        if (items.some(item => !isRecord(item))) {
          throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid history Item.')
        }
        return { ...rawTurn, items }
      }))
      turns.push(...pageTurns)
      cursor = historyNextCursor(pageResult.nextCursor)
      if (cursor === undefined) return turns
    }
    throw new RpcError('PAYLOAD_TOO_LARGE', 'Codex history exceeds the Turn page limit.')
  }

  private async readThreadItems(threadId: string, turnId: string): Promise<unknown[]> {
    const items: unknown[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_CODEX_HISTORY_PAGES; page += 1) {
      const result = await this.callUpstream('thread/items/list', {
        threadId,
        turnId,
        limit: CODEX_HISTORY_PAGE_LIMIT,
        sortDirection: 'asc',
        ...(cursor === undefined ? {} : { cursor }),
      })
      if (!isRecord(result) || !Array.isArray(result.data)) {
        throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid Item page.')
      }
      for (const entry of result.data) {
        if (!isRecord(entry) || !isRecord(entry.item)) {
          throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid history Item.')
        }
        items.push(entry.item)
      }
      cursor = historyNextCursor(result.nextCursor)
      if (cursor === undefined) return items
    }
    // Summary inline Items cannot replace a failed full read: tool output and
    // message content may be omitted. Never publish a truncated baseline.
    throw new RpcError('PAYLOAD_TOO_LARGE', 'Codex history exceeds the Item page limit.')
  }

  private logHistoryFallback(connectionId: string, stage: string, error: unknown): void {
    this.logger.warn('Codex history read fallback', {
      connectionId: maskId(connectionId),
      stage,
      code: errorCode(error),
    })
  }

  private logEmptyUnmaterializedHistory(connectionId: string, stage: string): void {
    // Empty history is a normal state for a new Thread; keep this at debug so
    // the reason is still observable without warning noise on every open.
    this.logger.debug('Codex history projected as empty unmaterialized thread', {
      connectionId: maskId(connectionId),
      stage,
    })
  }

  private async assertResultThreadAllowed(result: unknown): Promise<void> {
    const thread = extractThread(result)
    if (thread === undefined || typeof thread.id !== 'string') {
      throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid thread.')
    }
    if (!isThreadAllowedByWorkspaceAuthority(thread, await this.readWorkspaceAuthority())) {
      throw new RpcError('CODEX_THREAD_NOT_ALLOWED', 'The Codex thread is not available through this Remote Host.')
    }
  }

  private claimTurn(
    threadId: string,
    connectionId: string,
    method: AllowedCodexAppMethod,
    turnId?: string,
  ): { claimed: boolean; previous?: ActiveTurnOwner } {
    const owner = this.turnOwners.get(threadId)
    const peerDeviceId = this.peerDeviceIds.get(connectionId) ?? connectionId
    const nextOwner: ActiveTurnOwner = { connectionId, peerDeviceId, ...(turnId === undefined ? {} : { turnId }) }
    if (method === 'turn/interrupt') {
      if (owner === undefined) {
        // A replacement connection may recover an already-running persisted
        // turn. Claim only for this explicit mutation; passive viewers still
        // remain observers and cannot steal a live connection's lease.
        this.turnOwners.set(threadId, nextOwner)
        return { claimed: true }
      }
      if (owner.connectionId !== connectionId && owner.peerDeviceId !== peerDeviceId) {
        throw new RpcError('CODEX_TURN_OWNED', 'Only the connection that started this Codex turn can interrupt it.')
      }
      if (owner.connectionId !== connectionId) {
        this.turnOwners.set(threadId, { ...owner, connectionId, peerDeviceId, ...(turnId === undefined ? {} : { turnId }) })
        return { claimed: true, previous: owner }
      }
      if (turnId !== undefined && owner.turnId === undefined) this.turnOwners.set(threadId, { ...owner, turnId })
      return { claimed: false }
    }
    if (owner !== undefined && owner.connectionId !== connectionId && owner.peerDeviceId !== peerDeviceId) {
      throw new RpcError('CODEX_TURN_OWNED', 'Another Remote connection owns the active Codex turn.')
    }
    if (owner?.connectionId === connectionId) return { claimed: false }
    this.turnOwners.set(threadId, owner === undefined ? nextOwner : { ...owner, connectionId, peerDeviceId })
    return { claimed: true, previous: owner }
  }

  private rememberTurnId(threadId: string, connectionId: string, turnId: string | undefined): void {
    if (turnId === undefined) return
    const owner = this.turnOwners.get(threadId)
    if (owner === undefined || owner.connectionId !== connectionId) return
    this.turnOwners.set(threadId, { ...owner, turnId })
  }

  private hasSubscriber(threadId: string): boolean {
    return [...this.peers.values()].some(peer => peer.hasThreadSubscription(threadId))
  }

  private enqueueInbound(appServer: CodexAppServerLike, message: CodexAppServerInbound): void {
    if (this.closed || this.appServer !== appServer) return
    const receivedAt = Date.now()
    const explicitThreadId = extractThreadId(message.params)
    const pendingToken = message.kind === 'request' && explicitThreadId !== undefined
      ? { id: message.id, threadId: explicitThreadId }
      : undefined
    if (pendingToken !== undefined) {
      this.pendingRequestThreads.set(pendingToken.id, pendingToken)
    }
    const chainThreadId = explicitThreadId
      ?? (message.kind === 'notification' && message.method === 'serverRequest/resolved'
        ? this.findInboundThreadForResolved(message.params)
        : undefined)
    const key = chainThreadId === undefined ? '__global__' : `thread:${chainThreadId}`
    const prev = this.inboundChains.get(key) ?? Promise.resolve()
    const next = prev.then(async () => {
      try {
        if (this.closed || this.appServer !== appServer) return
        await this.handleInbound(message, receivedAt)
      } catch (error) {
        this.logger.warn('Codex inbound handling failed', { code: errorCode(error) })
      } finally {
        if (pendingToken !== undefined && this.pendingRequestThreads.get(pendingToken.id) === pendingToken) {
          this.pendingRequestThreads.delete(pendingToken.id)
        }
      }
    })
    this.inboundChains.set(key, next)
    void next.finally(() => {
      if (this.inboundChains.get(key) === next) this.inboundChains.delete(key)
    })
  }

  private findInboundThreadForResolved(params: unknown): string | undefined {
    if (!isRecord(params) || (typeof params.requestId !== 'string' && typeof params.requestId !== 'number')) return undefined
    return this.pendingRequestThreads.get(params.requestId)?.threadId
      ?? this.findMatchingApprovals(params)[0]?.threadId
  }

  private findMatchingApprovals(params: unknown): Array<{ handle: string; threadId: string }> {
    if (!isRecord(params) || (typeof params.requestId !== 'string' && typeof params.requestId !== 'number')) return []
    const matches: Array<{ handle: string; threadId: string }> = []
    for (const [handle, approval] of this.approvals) {
      if (approval.upstreamId === params.requestId) {
        matches.push({ handle, threadId: approval.threadId })
      }
    }
    return matches
  }

  private resolveUpstreamApproval(params: unknown): Array<{ handle: string; threadId: string }> {
    const matches = this.findMatchingApprovals(params)
    if (matches.length === 0) return matches
    for (const match of matches) {
      this.deleteApproval(match.handle)
      this.attention?.onInteractionResolved(codexApprovalItemId(match.handle))
      void this.threadLifecycle.retry(match.threadId)
    }
    this.scheduleApprovalExpiry()
    return matches
  }

  private expireApprovalsSync(): PendingApproval[] {
    const now = Date.now()
    const expired: PendingApproval[] = []
    for (const [handle, approval] of [...this.approvals.entries()]) {
      if (approval.expiresAt > now) continue
      // True single-assignment: delete synchronously before any await.
      this.deleteApproval(handle)
      this.attention?.onInteractionResolved(codexApprovalItemId(handle))
      expired.push(approval)
    }
    if (expired.length > 0) {
      this.scheduleApprovalExpiry()
      for (const approval of expired) {
        if (!this.hasPendingApprovalForThread(approval.threadId) && this.turnOwners.has(approval.threadId)) {
          this.armTurnWatchdog(approval.threadId)
        }
      }
    }
    return expired
  }

  private async expireApprovals(): Promise<void> {
    const appServer = this.appServer
    const expired = this.expireApprovalsSync()
    for (const approval of expired) {
      await appServer?.respond(approval.upstreamId, { decision: 'decline' }).catch(() => undefined)
      // Must NOT await retry() here: expireApprovals() runs inside inboundChains,
      // and retry() waits for thread/closed arriving on the same thread chain.
      void this.threadLifecycle.retry(approval.threadId)
    }
  }

  private declineApprovalsForThreadSync(threadId: string): void {
    const removed: PendingApproval[] = []
    for (const [handle, approval] of [...this.approvals.entries()]) {
      if (approval.threadId !== threadId) continue
      this.deleteApproval(handle)
      this.attention?.onInteractionResolved(codexApprovalItemId(handle))
      removed.push(approval)
    }
    if (removed.length === 0) return
    this.scheduleApprovalExpiry()
    const appServer = this.appServer
    for (const approval of removed) {
      void appServer?.respond(approval.upstreamId, { decision: 'decline' }).catch(() => undefined)
    }
    void this.threadLifecycle.retry(threadId)
  }

  private deleteApproval(handle: string): boolean {
    const removed = this.approvals.delete(handle)
    this.detachedApprovalBudget.release(codexDetachedBudgetKey(handle))
    return removed
  }

  private hasPendingApprovalForThread(threadId: string): boolean {
    for (const approval of this.approvals.values()) {
      if (approval.threadId === threadId) return true
    }
    return false
  }

  private rememberThreadMeta(threadId: string, thread: Record<string, unknown> | undefined, cwd?: string): void {
    const prev = this.threadMeta.get(threadId)
    const rawTitle = typeof thread?.name === 'string' && thread.name.trim().length > 0
      ? thread.name.trim()
      : typeof thread?.preview === 'string' && thread.preview.trim().length > 0
        ? thread.preview.trim()
        : undefined
    const resolvedCwd = cwd ?? (typeof thread?.cwd === 'string' && thread.cwd.length > 0 ? thread.cwd : undefined)
    const next = {
      title: rawTitle ?? prev?.title,
      cwd: resolvedCwd ?? prev?.cwd,
    }
    if (next.title === undefined && next.cwd === undefined) return
    this.threadMeta.delete(threadId)
    this.threadMeta.set(threadId, next)
    while (this.threadMeta.size > MAX_THREAD_META_ENTRIES) {
      const oldest = this.threadMeta.keys().next().value
      if (oldest === undefined) break
      this.threadMeta.delete(oldest)
    }
  }

  private attentionSessionInfo(threadId: string) {
    const meta = this.threadMeta.get(threadId)
    const workspaceLabel = meta?.cwd === undefined ? undefined : (basename(meta.cwd) || meta.cwd)
    return {
      backend: 'codex' as const,
      mode: 'agent' as const,
      sessionId: `codex:${threadId}`,
      ...(meta?.title === undefined ? {} : { sessionTitle: meta.title }),
      ...(meta?.cwd === undefined ? {} : { workspaceId: `codex:cwd:${meta.cwd}` }),
      ...(workspaceLabel === undefined ? {} : { workspaceLabel }),
    }
  }

  private scheduleApprovalExpiry(): void {
    if (this.approvalExpiryTimer !== undefined) clearTimeout(this.approvalExpiryTimer)
    this.approvalExpiryTimer = undefined
    const nextExpiry = Math.min(...[...this.approvals.values()].map(approval => approval.expiresAt))
    if (!Number.isFinite(nextExpiry)) return
    this.approvalExpiryTimer = setTimeout(() => {
      this.approvalExpiryTimer = undefined
      void this.expireApprovals().catch(error => {
        this.logger.warn('Codex approval expiry failed', { code: errorCode(error) })
      })
    }, Math.max(0, nextExpiry - Date.now()))
    this.approvalExpiryTimer.unref?.()
  }

  private armTurnWatchdog(threadId: string): void {
    if (this.closed || this.turnSilenceTimeoutMs <= 0 || !this.turnOwners.has(threadId)) return
    if (this.hasPendingApprovalForThread(threadId)) {
      this.clearTurnWatchdog(threadId)
      return
    }
    this.clearTurnWatchdog(threadId)
    const timer = setTimeout(() => {
      this.turnWatchdogs.delete(threadId)
      void this.failSilentTurn(threadId).catch(error => {
        this.logger.warn('Codex turn silence watchdog failed', { code: errorCode(error) })
      })
    }, this.turnSilenceTimeoutMs)
    timer.unref?.()
    this.turnWatchdogs.set(threadId, timer)
  }

  private clearTurnWatchdog(threadId: string): void {
    const timer = this.turnWatchdogs.get(threadId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.turnWatchdogs.delete(threadId)
  }

  private clearAllTurnWatchdogs(): void {
    for (const timer of this.turnWatchdogs.values()) clearTimeout(timer)
    this.turnWatchdogs.clear()
  }

  /**
   * App Server can drop a turn without `turn/completed` (observed on HTTP 503).
   * Release the writer lease and project a failed turn/end so Remote clients
   * leave the forever-"thinking" state.
   */
  private async failSilentTurn(threadId: string): Promise<void> {
    if (this.hasPendingApprovalForThread(threadId)) return
    const owner = this.turnOwners.get(threadId)
    this.clearTurnWatchdog(threadId)
    if (owner === undefined || this.closed) return
    this.turnOwners.delete(threadId)
    this.declineApprovalsForThreadSync(threadId)
    this.attention?.onSessionCompleted({
      ...this.attentionSessionInfo(threadId),
      failed: true,
      summary: TURN_SILENCE_MESSAGE,
    })
    const turn = {
      id: owner.turnId ?? `silence:${threadId}`,
      status: 'failed',
      error: {
        message: TURN_SILENCE_MESSAGE,
        codex_error_info: 'remote_turn_silence',
      },
      items: [],
    }
    this.logger.warn('Codex turn silence watchdog fired', { code: 'remote_turn_silence' })
    await this.publishToThread(threadId, {
      method: 'turn/completed',
      params: { threadId, turn },
    })
  }

  private requireAppServer(): CodexAppServerLike {
    if (!this.config.enabled || !this.isAvailable() || this.appServer === undefined) {
      throw new RpcError('CODEX_UNAVAILABLE', 'Codex Remote is disabled or unavailable on this Host.')
    }
    return this.appServer
  }

  private async callUpstream(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const appServer = this.requireAppServer()
    try {
      const result = await appServer.call(method, params, timeoutMs)
      if (this.closed || this.appServer !== appServer || !this.isAvailable()) {
        throw new RpcError('CODEX_UNAVAILABLE', 'The Codex App Server changed while handling the request.')
      }
      return result
    } catch (error) {
      throw mapAppServerError(error)
    }
  }

  private readWorkspaceAuthority(
    listedThreads?: Record<string, unknown>[],
  ): Promise<CodexWorkspaceAuthority> {
    const pending = this.workspaceAuthorityPromise
    if (pending !== undefined) return pending
    const current = this.readWorkspaceAuthorityUncached(listedThreads)
    this.workspaceAuthorityPromise = current
    current.then(
      () => { if (this.workspaceAuthorityPromise === current) this.workspaceAuthorityPromise = undefined },
      () => { if (this.workspaceAuthorityPromise === current) this.workspaceAuthorityPromise = undefined },
    )
    return current
  }

  private async readWorkspaceAuthorityUncached(
    listedThreads?: Record<string, unknown>[],
  ): Promise<CodexWorkspaceAuthority> {
    const projectIds = new Set<string>()
    const roots: string[] = []
    let cursor: string | null | undefined
    try {
      for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
        const result = sanitizeProjectList(await this.callUpstream('project/list', {
          limit: CODEX_PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        })) as { data: Array<{ id: string; roots: Array<{ path: string }> }>; nextCursor?: string | null }
        for (const project of result.data) {
          const projectRoots = project.roots.map(root => root.path).filter(path => isAbsolute(path))
          if (projectRoots.length === 0) continue
          projectIds.add(project.id)
          roots.push(...projectRoots)
        }
        cursor = typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? result.nextCursor : undefined
        if (cursor === undefined) break
      }
    } catch (error) {
      if (!isProjectListFallbackError(error)) throw error
    }
    if (roots.length > 0) return { projectIds, roots }

    const threads: Record<string, unknown>[] = listedThreads === undefined ? [] : [...listedThreads]
    if (listedThreads === undefined) {
      cursor = undefined
      for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
        const result = sanitizeThreadList(await this.callUpstream('thread/list', {
          limit: CODEX_PAGE_LIMIT,
          sortKey: 'updated_at',
          sortDirection: 'desc',
          archived: false,
          ...(cursor === undefined ? {} : { cursor }),
        })) as { data: Record<string, unknown>[]; nextCursor?: string | null }
        threads.push(...result.data)
        cursor = typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? result.nextCursor : undefined
        if (cursor === undefined) break
      }
    }
    for (const workspace of deriveCodexCwdWorkspaces(threads)) {
      if (isAbsolute(workspace.path)) roots.push(workspace.path)
    }
    return { projectIds, roots }
  }

  private async findKnownThreadInList(
    threadId: string,
    authority: CodexWorkspaceAuthority,
  ): Promise<Record<string, unknown> | undefined> {
    let cursor: string | null | undefined
    for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
      const result = sanitizeThreadList(await this.callUpstream('thread/list', {
        limit: 100,
        sortKey: 'updated_at',
        sortDirection: 'desc',
        archived: false,
        ...(cursor === undefined ? {} : { cursor }),
      })) as { data: Record<string, unknown>[]; nextCursor?: string | null }
      const thread = result.data.find(item => item.id === threadId)
      if (thread !== undefined) {
        return isThreadAllowedByWorkspaceAuthority(thread, authority) ? thread : undefined
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? result.nextCursor : undefined
      if (cursor === undefined) break
    }
    return undefined
  }

  private async requireCodexWorkspacePath(path: string): Promise<string> {
    if (!isAbsolute(path)) {
      throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX working directory is not available as a Workspace.')
    }
    const paths = await this.listCodexWorkspacePaths()
    const lexicalCandidate = resolve(path)
    let candidate: string
    try {
      candidate = await realpath(path)
      if (!(await stat(candidate)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX working directory is not available as a Workspace.')
    }
    for (const root of paths.values()) {
      try {
        if (!containsCodexPath(resolve(root), lexicalCandidate)) continue
        const canonicalRoot = await realpath(root)
        if (containsCodexPath(canonicalRoot, candidate)) return lexicalCandidate
      } catch {
        // A stale project or Thread cwd is not authority for a new Thread.
      }
    }
    throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX working directory is not available as a Workspace.')
  }

  private async requireNewCodexProjectPath(path: string): Promise<string> {
    if (!isAbsolute(path)) {
      throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX project directory must be an existing absolute directory.')
    }
    try {
      const canonical = await realpath(resolve(path))
      if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory')
      return canonical
    } catch {
      throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX project directory must be an existing absolute directory.')
    }
  }

  private async listCodexDirectory(path: string): Promise<CodexDirectoryListing> {
    const target = await this.resolveCodexDirectory(path)
    const rows = await readdir(target.path, { withFileTypes: true }).catch(() => undefined)
    if (rows === undefined) {
      throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX working directory is not available as a Workspace.')
    }
    const entries: CodexDirectoryEntry[] = []
    for (const row of rows) {
      const child = resolve(target.path, row.name)
      let directory = row.isDirectory()
      if (!directory && row.isSymbolicLink()) {
        directory = await stat(child).then(value => value.isDirectory()).catch(() => false)
      }
      if (!directory) continue
      try {
        const canonicalChild = await realpath(child)
        if (!(await stat(canonicalChild)).isDirectory()) continue
        if (!containsCodexPath(target.canonicalRoot, canonicalChild)) continue
      } catch {
        continue
      }
      entries.push({
        name: row.name,
        path: child,
        hidden: process.platform !== 'win32' && row.name.startsWith('.'),
      })
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    return {
      path: target.path,
      home: target.root,
      crumbs: codexDirectoryCrumbs(target.root, target.path),
      entries: entries.slice(0, CODEX_DIRECTORY_ENTRY_LIMIT),
      truncated: entries.length > CODEX_DIRECTORY_ENTRY_LIMIT,
    }
  }

  private async resolveCodexDirectory(path: string): Promise<{ path: string; root: string; canonicalRoot: string }> {
    if (!isAbsolute(path)) {
      throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX working directory is not available as a Workspace.')
    }
    const authority = await this.readWorkspaceAuthority()
    const lexicalCandidate = resolve(path)
    let canonicalCandidate: string
    try {
      canonicalCandidate = await realpath(path)
      if (!(await stat(canonicalCandidate)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX working directory is not available as a Workspace.')
    }
    for (const root of authority.roots) {
      try {
        const lexicalRoot = resolve(root)
        if (!containsCodexPath(lexicalRoot, lexicalCandidate)) continue
        const canonicalRoot = await realpath(root)
        if (containsCodexPath(canonicalRoot, canonicalCandidate)) {
          return { path: lexicalCandidate, root: lexicalRoot, canonicalRoot }
        }
      } catch {
        // A stale project or Thread cwd is not authority for directory browsing.
      }
    }
    throw new RpcError('CODEX_PATH_NOT_ALLOWED', 'The CodeX working directory is not available as a Workspace.')
  }

  private async listCodexWorkspacePaths(): Promise<Map<string, string>> {
    const paths = new Map<string, string>()
    const authority = await this.readWorkspaceAuthority()
    for (const root of authority.roots) paths.set(normalizeCodexPathForCompare(root), root)
    return paths
  }
}

function findProjectedImageAttachment(
  entries: Array<{ event: { data: unknown } }>,
  attachmentId: string,
): { attachment: Record<string, unknown>; data: string } | undefined {
  for (const entry of entries) {
    const found = findImageBlock(entry.event.data, attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

function findImageBlock(
  value: unknown,
  attachmentId: string,
): { attachment: Record<string, unknown>; data: string } | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findImageBlock(child, attachmentId)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (value.type === 'image' && isRecord(value.attachment)
    && value.attachment.attachmentId === attachmentId && typeof value.data === 'string') {
    return { attachment: value.attachment, data: value.data }
  }
  for (const child of Object.values(value)) {
    const found = findImageBlock(child, attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

export type CodexDomainFrame = CodexAppFrameData | CodexAppStreamClosedData

/**
 * Prefer Codex bundled with the current ChatGPT desktop app on macOS when the
 * user kept the default command. Explicit binary configuration is never
 * rewritten or supplemented.
 */
export function codexBinaryCandidates(
  configured: string,
  hostPlatform: NodeJS.Platform = process.platform,
  userHome: string = homedir(),
): string[] {
  if (configured !== 'codex') return [configured]

  if (hostPlatform === 'darwin') return macOSCodexBinaryCandidates(userHome)

  // The Codex desktop app on Windows ships its own codex CLI under
  // %LOCALAPPDATA%\OpenAI\Codex\bin\<build-hash>\codex.exe. Prefer the newest
  // build so the app's current version is used; fall back to the configured
  // `codex` when the app is absent or unreadable.
  if (hostPlatform === 'win32') {
    return [...new Set([...windowsBundledCodexCandidates(userHome), configured])]
  }

  return [configured]
}

function macOSCodexBinaryCandidates(userHome: string): string[] {
  const bundledCandidates = [
    '/Applications/ChatGPT.app',
    join(userHome, 'Applications', 'ChatGPT.app'),
  ].flatMap(chatGptApp => {
    const codexCli = join(chatGptApp, 'Contents', 'Resources', 'codex-cli')
    try {
      const manifest = JSON.parse(readFileSync(join(codexCli, 'codex-package.json'), 'utf8')) as unknown
      if (!isRecord(manifest) || typeof manifest.entrypoint !== 'string' || manifest.entrypoint.length === 0) {
        return []
      }
      const candidate = join(codexCli, manifest.entrypoint)
      if (!existsSync(candidate)) return []
      accessSync(candidate, constants.X_OK)
      return [candidate]
    } catch {
      return []
    }
  })

  return [...new Set([
    ...bundledCandidates,
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    join(userHome, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
    'codex',
  ])]
}

/**
 * Codex desktop (ChatGPT/Codex for Windows) bundled CLI candidates, newest
 * build first. Reads `%LOCALAPPDATA%\OpenAI\Codex\bin`; returns an empty list
 * when the app is not installed. Never throws.
 */
function windowsBundledCodexCandidates(userHome: string): string[] {
  const localAppData = process.env.LOCALAPPDATA ?? join(userHome, 'AppData', 'Local')
  const binRoot = join(localAppData, 'OpenAI', 'Codex', 'bin')
  try {
    return readdirSync(binRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(binRoot, entry.name, 'codex.exe'))
      .filter(candidate => existsSync(candidate))
      .map(candidate => {
        try { return { candidate, mtime: statSync(candidate).mtimeMs } }
        catch { return { candidate, mtime: 0 } }
      })
      .sort((left, right) => right.mtime - left.mtime)
      .map(entry => entry.candidate)
  } catch {
    return []
  }
}

function parseCallEnvelope(input: unknown): { method: string; params: unknown } {
  if (!isRecord(input) || typeof input.method !== 'string' || !('params' in input)
    || Object.keys(input).some(key => key !== 'method' && key !== 'params')) {
    throw new RpcError('INVALID_MESSAGE', 'The Codex call envelope is invalid.')
  }
  return { method: input.method, params: input.params }
}

function parseRespond(input: unknown): { requestHandle: string; decision: 'accept' | 'decline' | 'cancel' } {
  if (!isRecord(input)
    || typeof input.requestHandle !== 'string'
    || !['accept', 'decline', 'cancel'].includes(String(input.decision))
    || Object.keys(input).some(key => key !== 'requestHandle' && key !== 'decision')) {
    throw new RpcError('INVALID_MESSAGE', 'The Codex approval response is invalid.')
  }
  return input as { requestHandle: string; decision: 'accept' | 'decline' | 'cancel' }
}

function accountCanRun(result: unknown): boolean {
  if (!isRecord(result) || typeof result.requiresOpenaiAuth !== 'boolean') return false
  return result.requiresOpenaiAuth === false || isRecord(result.account)
}

function sanitizeAccount(result: unknown): unknown {
  if (!isRecord(result)) throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned invalid account state.')
  const account = isRecord(result.account) ? result.account : undefined
  return {
    authenticated: account !== undefined || result.requiresOpenaiAuth === false,
    requiresOpenaiAuth: result.requiresOpenaiAuth === true,
    ...(account === undefined ? {} : {
      account: {
        ...(typeof account.type === 'string' ? { type: account.type } : {}),
        ...(typeof account.planType === 'string' ? { planType: account.planType } : {}),
      },
    }),
  }
}

function sanitizeThreadList(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid thread list.')
  }
  const data = result.data.flatMap(value => {
    if (!isRecord(value) || typeof value.id !== 'string') return []
    return [{
      id: value.id,
      ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
      ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
      ...(typeof value.preview === 'string' ? { preview: value.preview } : {}),
      ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
      ...(typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? { createdAt: value.createdAt } : {}),
      ...(typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
      ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {}),
      ...(typeof value.isPinned === 'boolean' ? { isPinned: value.isPinned } : {}),
      ...(isRecord(value.status) ? { status: value.status } : {}),
    }]
  })
  return {
    data,
    ...(typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? { nextCursor: result.nextCursor } : { nextCursor: null }),
    ...(typeof result.backwardsCursor === 'string' && result.backwardsCursor.length > 0
      ? { backwardsCursor: result.backwardsCursor }
      : {}),
  }
}

function filterThreadListByWorkspaceAuthority(result: unknown, authority: CodexWorkspaceAuthority): unknown {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid thread list.')
  }
  return {
    ...result,
    data: result.data
      .map(record => isRecord(record) ? record : undefined)
      .filter((thread): thread is Record<string, unknown> => (
        thread !== undefined && isThreadAllowedByWorkspaceAuthority(thread, authority)
      )),
  }
}

function sanitizeProject(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return undefined
  const roots = Array.isArray(value.roots)
    ? value.roots.flatMap(root => {
        const path = isRecord(root) && typeof root.path === 'string' && root.path.length > 0 ? root.path : undefined
        return path === undefined || !isAbsolute(path) ? [] : [{ path }]
      })
    : []
  if (roots.length === 0) return undefined
  return {
    id: value.id,
    name: value.name,
    roots,
    ...(typeof value.position === 'number' && Number.isFinite(value.position) ? { position: value.position } : {}),
    ...(typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt } : {}),
  }
}

function sanitizeProjectList(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid project list.')
  }
  const data = result.data.flatMap(value => sanitizeProject(value) ?? [])
  return {
    data,
    ...(typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? { nextCursor: result.nextCursor } : { nextCursor: null }),
  }
}

function sanitizeProjectCreate(result: unknown): unknown {
  const project = isRecord(result) ? sanitizeProject(result.project) : undefined
  if (project === undefined) {
    throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid created project.')
  }
  return { project }
}

function isThreadAllowedByWorkspaceAuthority(thread: Record<string, unknown>, authority: CodexWorkspaceAuthority): boolean {
  const projectId = typeof thread.projectId === 'string' ? thread.projectId : undefined
  if (projectId !== undefined && authority.projectIds.has(projectId)) return true
  const cwd = typeof thread.cwd === 'string' ? thread.cwd : undefined
  return cwd !== undefined && authority.roots.some(root => containsCodexPath(root, cwd))
}

function containsCodexPath(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeCodexPathForCompare(root)
  const normalizedCandidate = normalizeCodexPathForCompare(candidate)
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}/`)
    || normalizedCandidate.startsWith(`${normalizedRoot}\\`)
}

function normalizeCodexPathForCompare(path: string): string {
  return path.replace(/[\\/]+$/u, '') || path
}

function codexDirectoryCrumbs(root: string, path: string): CodexDirectoryEntry[] {
  const crumbs: CodexDirectoryEntry[] = [{ name: basename(root) || root, path: root, hidden: false }]
  const remainder = relative(root, path)
  if (remainder === '') return crumbs
  let current = root
  for (const segment of remainder.split(/[\\/]+/u).filter(Boolean)) {
    current = resolve(current, segment)
    crumbs.push({ name: segment, path: current, hidden: false })
  }
  return crumbs
}

function extractThread(result: unknown): Record<string, unknown> | undefined {
  return isRecord(result) && isRecord(result.thread) ? result.thread : undefined
}

function extractTurnId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined
  if (typeof result.turnId === 'string' && result.turnId.length > 0) return result.turnId
  if (isRecord(result.turn) && typeof result.turn.id === 'string' && result.turn.id.length > 0) return result.turn.id
  return undefined
}

function extractThreadId(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined
  if (typeof params.threadId === 'string') return params.threadId
  if (isRecord(params.thread) && typeof params.thread.id === 'string') return params.thread.id
  if (isRecord(params.turn) && typeof params.turn.threadId === 'string') return params.turn.threadId
  return undefined
}

function goalRetainsThread(goal: unknown, threadId: string): boolean {
  if (!isRecord(goal) || goal.threadId !== threadId || typeof goal.status !== 'string') return true
  return !['complete', 'paused', 'blocked', 'usageLimited', 'budgetLimited'].includes(goal.status)
}

function isTerminalThreadStatus(params: unknown): boolean {
  if (!isRecord(params) || !isRecord(params.status) || typeof params.status.type !== 'string') return false
  return params.status.type !== 'active'
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

interface CodexPermissionMapping {
  params: Record<string, unknown>
  approvalPolicy?: 'on-request' | 'never'
  sandbox?: CodexPermissionPreset
}

function codexPermission(
  params: Record<string, unknown>,
  fallbackPreset?: CodexPermissionPreset,
): CodexPermissionMapping {
  const { permissionPreset, ...rest } = params
  const preset = permissionPreset === 'workspace-write' || permissionPreset === 'danger-full-access'
    ? permissionPreset
    : fallbackPreset
  if (preset === undefined) return { params: mapCodexImageInputs(rest) }
  const fullAccess = preset === 'danger-full-access'
  return {
    params: mapCodexImageInputs(rest),
    approvalPolicy: fullAccess ? 'never' : 'on-request',
    sandbox: fullAccess ? 'danger-full-access' : 'workspace-write',
  }
}

function codexThreadPermissionParams(permission: CodexPermissionMapping): Record<string, unknown> {
  if (permission.approvalPolicy === undefined || permission.sandbox === undefined) return {}
  return {
    approvalPolicy: permission.approvalPolicy,
    sandbox: permission.sandbox,
  }
}

function codexTurnPermissionParams(permission: CodexPermissionMapping, cwd: string | undefined): Record<string, unknown> {
  if (permission.approvalPolicy === undefined || permission.sandbox === undefined) return {}
  return {
    approvalPolicy: permission.approvalPolicy,
    sandboxPolicy: permission.sandbox === 'danger-full-access'
      ? { type: 'dangerFullAccess' }
      : {
          type: 'workspaceWrite',
          writableRoots: cwd === undefined ? [] : [cwd],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
  }
}

function mapCodexImageInputs(params: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(params.input)) return params
  return {
    ...params,
    input: params.input.map(value => {
      if (!isRecord(value) || value.type !== 'image'
        || typeof value.mediaType !== 'string' || typeof value.data !== 'string') return value
      return { type: 'image', url: `data:${value.mediaType};base64,${value.data}` }
    }),
  }
}

function sanitizeApprovalParams(params: unknown, requestHandle: string): unknown {
  if (!isRecord(params)) return { requestHandle }
  const safe = { ...params }
  delete safe.proposedExecpolicyAmendment
  delete safe.additionalPermissions
  safe.availableDecisions = ['accept', 'decline', 'cancel']
  safe.requestHandle = requestHandle
  return safe
}

function codexApprovalSummary(
  method: 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval',
  params: unknown,
): string | undefined {
  if (isRecord(params)) {
    if (typeof params.command === 'string' && params.command.trim().length > 0) return params.command.trim()
    if (typeof params.reason === 'string' && params.reason.trim().length > 0) return params.reason.trim()
    if (typeof params.path === 'string' && params.path.trim().length > 0) return params.path.trim()
  }
  return method === 'item/fileChange/requestApproval' ? 'File change approval' : 'Command execution approval'
}

function mapAppServerError(error: unknown): Error {
  if (error instanceof RpcError) return error
  if (error instanceof CodexAppServerError) {
    if (error.code === 'CODEX_UPSTREAM_ERROR' && isActiveWriterMessage(error.message)) {
      return new RpcError('CODEX_THREAD_BUSY', 'The selected CodeX thread is already active in another CodeX client.')
    }
    return new RpcError(error.code, error.message, undefined, error.code === 'CODEX_REQUEST_TIMEOUT')
  }
  return new RpcError('CODEX_UPSTREAM_ERROR', 'Codex App Server could not complete the request.')
}

function errorCode(error: unknown): string {
  if (error instanceof RpcError || error instanceof CodexAppServerError) return error.code
  return 'CODEX_START_FAILED'
}

function isHistoryReadRecoverable(error: unknown): boolean {
  return error instanceof RpcError
    && ['METHOD_NOT_ALLOWED', 'METHOD_NOT_FOUND', 'CODEX_UPSTREAM_ERROR', 'CODEX_REQUEST_TIMEOUT', 'CODEX_THREAD_BUSY'].includes(error.code)
}

function historyNextCursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new RpcError('CODEX_INVALID_RESPONSE', 'Codex App Server returned an invalid history cursor.')
  }
  return value
}

// Only try another history API for version/format compatibility. Busy and
// timeout failures must remain errors, not successful empty/partial baselines.
function isHistoryFormatFallback(error: unknown): boolean {
  return error instanceof RpcError
    && ['METHOD_NOT_ALLOWED', 'METHOD_NOT_FOUND', 'CODEX_UPSTREAM_ERROR'].includes(error.code)
}

function isProjectListFallbackError(error: unknown): boolean {
  return error instanceof RpcError
    && ['METHOD_NOT_ALLOWED', 'METHOD_NOT_FOUND', 'CODEX_UPSTREAM_ERROR'].includes(error.code)
}

function canTryNextBinary(error: unknown): boolean {
  return !(error instanceof RpcError) || !['CODEX_AUTH_REQUIRED', 'CODEX_CLOSED'].includes(error.code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function maskId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}

function isActiveWriterMessage(message: string): boolean {
  return message.toLowerCase().includes('active writer')
}

function isUnpersistedThreadError(error: unknown): boolean {
  return error instanceof RpcError
    && error.code === 'CODEX_UPSTREAM_ERROR'
    && error.message.toLowerCase().includes('not persisted yet')
}

function extractFrameTurnId(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined
  if (typeof params.turnId === 'string' && params.turnId.length > 0) return params.turnId
  if (isRecord(params.turn) && typeof params.turn.id === 'string' && params.turn.id.length > 0) return params.turn.id
  return undefined
}

function extractFrameItemId(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined
  if (typeof params.itemId === 'string' && params.itemId.length > 0) return params.itemId
  if (isRecord(params.item) && typeof params.item.id === 'string' && params.item.id.length > 0) return params.item.id
  return undefined
}

function isOversizedCodexFrame(frame: { method: string; params: unknown }): boolean {
  return encodeMessage(createEvent('codex.app.frame', { streamId: MAX_STREAM_ID_PROBE, frame })).byteLength > MAX_SECURE_MESSAGE_BYTES
}

function isResponseTooLargeError(error: unknown): boolean {
  return isRecord(error) && error.code === 'RESPONSE_TOO_LARGE'
}

/** A new Thread is materialized by its first user message; before that its
 * turn list is unavailable and must be projected as an empty history. */
function isUnmaterializedThreadError(error: unknown): boolean {
  return error instanceof RpcError && error.code === CODEX_THREAD_UNMATERIALIZED
}

function isRetryableCodexStartError(error: unknown): boolean {
  return !['CODEX_BINARY_UNAVAILABLE', 'CODEX_AUTH_REQUIRED', 'CODEX_CLOSED'].includes(errorCode(error))
}

function codexDetachedBudgetKey(handle: string): string {
  return `codex:${handle}`
}
