import { randomBytes } from 'node:crypto'
import {
  MAX_ATTENTION_COUNT,
  MAX_ATTENTION_ITEMS,
  MAX_ATTENTION_SUMMARY_CHARS,
  MAX_ATTENTION_TITLE_CHARS,
  attentionDigestSchema,
  attentionItemSchema,
  compareAttentionItems,
  type AttentionAckUnreadResult,
  type AttentionBackend,
  type AttentionDigest,
  type AttentionFollowEvent,
  type AttentionItem,
  type AttentionListResult,
  type AttentionMode,
  type AttentionStatus,
  type AttentionTarget,
  type AttentionUrgency,
  type AttentionUrgentKind,
  type PluginRouteCallResult,
} from '@dsh-remote/protocol'
import { isLiveSessionEventsHarnessVersion } from './harness-version.js'
import type { SafeLogger } from './logging.js'
import type { LocalTypertGateway } from './typert-gateway-contract.js'

export const DEFAULT_ATTENTION_TOKEN_TTL_MS = 15 * 60_000
export const MAX_ATTENTION_TOKENS = 128
export const DEFAULT_DIGEST_DEBOUNCE_MS = 1_500
export const NORMAL_TURN_COMPLETED_MIN_MS = 15_000
const DEFAULT_OBSERVER_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000, 60_000] as const
const TERMINAL_OBSERVER_ERROR_CODES = new Set([
  'gateway/interactions-forbidden',
  'gateway/not-found',
  'gateway/invocation-unavailable',
])
const MAX_SESSION_METADATA_ENTRIES = 512

export interface AttentionSessionInfo {
  backend: AttentionBackend
  acpAdapter?: string
  mode: AttentionMode
  workspaceId?: string
  workspaceLabel?: string
  sessionId: string
  sessionTitle?: string
  summary?: string
}

export interface AttentionInteractionInfo extends AttentionSessionInfo {
  id: string
  status: 'waiting_approval' | 'waiting_question'
  detachedExpiresAt?: number
}

export interface AttentionBackendObserver {
  onSessionRunning(info: AttentionSessionInfo): void
  onSessionCompleted(info: AttentionSessionInfo & { failed?: boolean; durationMs?: number }): void
  onSessionCancelled(backend: AttentionBackend, sessionId: string, acpAdapter?: string): void
  onSessionRemoved(backend: AttentionBackend, sessionId: string, acpAdapter?: string): void
  onInteractionPending(info: AttentionInteractionInfo): void
  onInteractionDetached(itemId: string, detachedExpiresAt: number): void
  onInteractionResolved(itemId: string): void
  onBackendCleared(backend: AttentionBackend, acpAdapter?: string): void
}

export interface AttentionPeerRoute {
  list(): AttentionListResult
  follow(enabled?: boolean): AttentionListResult
  unfollow(): { following: false; revision: number }
  resolveToken(token: string): AttentionTarget
  ackUnread(itemIds: readonly string[]): AttentionAckUnreadResult
  close(): void
}

export interface AttentionTrackerOptions {
  localGateway?: LocalTypertGateway
  onDigest?: (digest: AttentionDigest) => void
  logger?: SafeLogger
  now?: () => number
  tokenTtlMs?: number
  maxTokens?: number
  debounceMs?: number
  normalTurnMinMs?: number
  observerBackoffMs?: readonly number[]
}

interface StoredToken {
  target: Extract<AttentionTarget, { kind: 'session' }>
  expiresAt: number
}

interface SessionMetadata {
  sessionTitle?: string
  workspaceId?: string
  workspaceLabel?: string
}

interface Follower {
  send: (event: AttentionFollowEvent) => Promise<void>
  chain: Promise<void>
}

export class HostAttentionTracker implements AttentionBackendObserver {
  private readonly items = new Map<string, AttentionItem>()
  private readonly tokens = new Map<string, StoredToken>()
  private readonly followers = new Map<string, Follower>()
  private readonly sessionMeta = new Map<string, SessionMetadata>()
  private readonly turnStartedAt = new Map<string, number>()
  private readonly harnessTurnFailed = new Set<string>()
  private readonly projectedHarnessQuestionIds = new Map<string, Set<string>>()
  private readonly harnessQuestionProjectionSeqs = new Map<string, number>()
  private readonly harnessQuestionEventToItemId = new Map<string, string>()
  private readonly criticalNotifiedIds = new Set<string>()
  private readonly now: () => number
  private readonly tokenTtlMs: number
  private readonly maxTokens: number
  private readonly debounceMs: number
  private readonly normalTurnMinMs: number
  private readonly observerBackoffMs: readonly number[]

  private revision = 0
  private previousBlockingCount = 0
  private activeHarnessEventStreams = 0
  private lastDigest: AttentionDigest
  private debounceTimer?: ReturnType<typeof setTimeout>
  private pendingSilentHint?: { urgentKind: AttentionUrgentKind | null; itemId?: string }

  private closed = false
  private started = false
  private observerGateway?: LocalTypertGateway
  private observerController?: AbortController
  private observerIterator?: AsyncIterator<unknown>
  private observerTask?: Promise<void>
  private observerRetryTimer?: ReturnType<typeof setTimeout>
  private observerRetryWake?: () => void

  constructor(private readonly options: AttentionTrackerOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.tokenTtlMs = options.tokenTtlMs ?? DEFAULT_ATTENTION_TOKEN_TTL_MS
    this.maxTokens = options.maxTokens ?? MAX_ATTENTION_TOKENS
    this.debounceMs = options.debounceMs ?? DEFAULT_DIGEST_DEBOUNCE_MS
    this.normalTurnMinMs = options.normalTurnMinMs ?? NORMAL_TURN_COMPLETED_MIN_MS
    this.observerBackoffMs = options.observerBackoffMs ?? DEFAULT_OBSERVER_BACKOFF_MS
    this.lastDigest = this.buildDigest(null, 'silent')
  }

  /** Start passive read-only `session/control` observation when the Host Harness supports it. */
  start(harnessVersion?: string): void {
    if (this.closed || this.started) return
    const gateway = this.options.localGateway
    if (gateway?.supportsCarrier !== true || !isLiveSessionEventsHarnessVersion(harnessVersion)) return
    // NEVER reuse `localGateway` (which holds the shared `fallbackPeer` with
    // `interactions: 'answer'`). Require a dedicated read-only owner peer.
    const observerGateway = gateway.createPeer?.({ interactions: 'none' })
    if (observerGateway === undefined || observerGateway === gateway) return
    this.started = true
    this.observerGateway = observerGateway
    this.observerTask = this.runHarnessObserver(observerGateway).finally(() => {
      if (this.observerTask !== undefined) this.observerTask = undefined
    })
  }

  /** Observe live Harness `$events` frames forwarded through an authenticated client bridge. */
  observeHarnessEventFrame(frame: unknown): void {
    if (this.closed) return
    this.handleHarnessEventFrame(frame)
  }

  /**
   * Observe a settled `$events/result` RPC forwarded by an authenticated client bridge.
   * The official Gateway removes the answering client from `deliveries` before
   * sending `cancel` frames, so a sole answering client never receives `cancel`
   * back on its own `$events` stream.
   */
  observeHarnessEventResult(eventId: string, outcomeKind?: string): void {
    if (this.closed || eventId.length === 0) return
    const settles = outcomeKind === undefined
      || outcomeKind === 'result'
      || outcomeKind === 'rejected'
      || (outcomeKind === 'next' && this.activeHarnessEventStreams <= 1)
    if (!settles) return
    this.resolveHarnessEventId(eventId)
  }

  /** Track active forwarded `$events` streams across all authenticated bridges. */
  onHarnessEventStreamOpened(): void {
    if (this.closed) return
    this.activeHarnessEventStreams += 1
  }

  /**
   * When the last forwarded `$events` stream closes, purge `$events`-sourced
   * transient waterfall items and `running` projections so they cannot linger as
   * zombies if resolved while zero clients are attached. Still-pending waterfalls
   * are re-delivered by the Gateway with the same `eventId` on reconnect, while
   * durable `session/control` projected `userQuestions` remain tracked.
   */
  onHarnessEventStreamClosed(): void {
    if (this.closed) return
    this.activeHarnessEventStreams = Math.max(0, this.activeHarnessEventStreams - 1)
    if (this.activeHarnessEventStreams > 0) return

    this.harnessQuestionEventToItemId.clear()
    this.harnessTurnFailed.clear()
    for (const key of [...this.turnStartedAt.keys()]) {
      if (key.startsWith('harness:')) this.turnStartedAt.delete(key)
    }
    const staleIds: string[] = []
    for (const item of this.items.values()) {
      if (item.backend !== 'harness') continue
      if (item.status === 'waiting_approval' || item.status === 'running') {
        staleIds.push(item.id)
      } else if (item.status === 'waiting_question' && !this.isProjectedHarnessQuestion(item.id)) {
        staleIds.push(item.id)
      }
    }
    for (const id of staleIds) {
      this.removeItem(id)
    }
  }

  /** Create the read-only lifecycle observer passed to each `HarnessRemoteBridge`. */
  createHarnessBridgeObserver(): {
    onStreamOpened: () => void
    onFrame: (frame: unknown) => void
    onEventResult: (eventId: string, outcomeKind?: string) => void
    onDsBotCall: (body: { endpoint: string; payload?: Record<string, unknown> | null }, botResult: unknown) => void
    onStreamClosed: () => void
  } {
    return {
      onStreamOpened: () => this.onHarnessEventStreamOpened(),
      onFrame: frame => this.observeHarnessEventFrame(frame),
      onEventResult: (eventId, outcomeKind) => this.observeHarnessEventResult(eventId, outcomeKind),
      onDsBotCall: (body, botResult) => this.observeBotResponse('api/bot', body, { status: 200, json: botResult }),
      onStreamClosed: () => this.onHarnessEventStreamClosed(),
    }
  }

  /** Publish the current digest when Control WS connects/reconnects with `attention.signal.v1`. */
  publishCurrentDigestIfActive(): void {
    if (this.closed) return
    if (this.revision === 0 && this.items.size === 0) return
    const digest = this.buildDigest(null, 'silent')
    this.emitDigest(digest)
  }

  /** Create a connection-scoped RPC route for Noise tunnel `attention.*` calls. */
  createPeerRoute(
    connectionId: string,
    sendEvent: (event: AttentionFollowEvent) => Promise<void>,
  ): AttentionPeerRoute {
    return {
      list: () => this.list(),
      follow: (enabled = true) => this.follow(connectionId, sendEvent, enabled),
      unfollow: () => this.unfollow(connectionId),
      resolveToken: token => this.resolveToken(token),
      ackUnread: itemIds => this.ackUnread(itemIds),
      close: () => { this.unfollow(connectionId) },
    }
  }

  list(): AttentionListResult {
    const items = this.sortedItems()
    return {
      revision: this.revision,
      digest: this.currentDigest(),
      items,
    }
  }

  currentDigest(): AttentionDigest {
    return { ...this.lastDigest }
  }

  follow(
    connectionId: string,
    send: (event: AttentionFollowEvent) => Promise<void>,
    enabled = true,
  ): AttentionListResult {
    if (this.closed || !enabled) {
      this.unfollow(connectionId)
      return this.list()
    }
    const follower: Follower = { send, chain: Promise.resolve() }
    this.followers.set(connectionId, follower)
    const initial = this.list()
    const snapshot: AttentionFollowEvent = {
      type: 'snapshot',
      revision: initial.revision,
      digest: initial.digest,
      items: initial.items,
    }
    this.enqueueFollowerEvent(connectionId, follower, snapshot)
    return initial
  }

  unfollow(connectionId: string): { following: false; revision: number } {
    this.followers.delete(connectionId)
    return { following: false, revision: this.revision }
  }

  resolveToken(token: string): AttentionTarget {
    this.pruneExpiredTokens()
    const entry = this.tokens.get(token)
    if (entry === undefined || entry.expiresAt <= this.now()) {
      this.tokens.delete(token)
      return { kind: 'inbox' }
    }
    if (entry.target.itemId !== undefined && !this.items.has(entry.target.itemId)) {
      this.tokens.delete(token)
      return { kind: 'inbox' }
    }
    return { ...entry.target }
  }

  ackUnread(itemIds: readonly string[]): AttentionAckUnreadResult {
    const removedIds: string[] = []
    for (const itemId of new Set(itemIds)) {
      const existing = this.items.get(itemId)
      if (existing === undefined) continue
      if (existing.status !== 'completed_unread' && existing.status !== 'failed_unread') continue
      this.items.delete(itemId)
      this.invalidateTokensForItem(itemId)
      removedIds.push(itemId)
    }
    if (removedIds.length > 0) {
      this.revision += 1
      const digest = this.buildDigest(null, 'silent')
      for (const itemId of removedIds) {
        this.broadcastFollowEvent({ type: 'remove', revision: this.revision, digest, itemId })
      }
      this.scheduleDebouncedDigest(null)
    }
    return { ok: true, revision: this.revision }
  }

  // ── Backend push hooks (Codex / ACP / Harness) ────────────────────────────

  onSessionRunning(info: AttentionSessionInfo): void {
    if (this.closed) return
    const key = sessionItemId(info.backend, info.sessionId, info.acpAdapter)
    this.rememberMeta(key, info)
    if (!this.turnStartedAt.has(key)) this.turnStartedAt.set(key, this.now())
    this.harnessTurnFailed.delete(info.sessionId)
    const item = this.buildItem(key, { ...info, status: 'running' })
    this.upsertItem(item, { mode: 'debounced', silentKind: null })
  }

  onSessionCompleted(info: AttentionSessionInfo & { failed?: boolean; durationMs?: number }): void {
    if (this.closed) return
    const key = sessionItemId(info.backend, info.sessionId, info.acpAdapter)
    this.rememberMeta(key, info)
    const startedAt = this.turnStartedAt.get(key)
    this.turnStartedAt.delete(key)
    const durationMs = info.durationMs ?? (startedAt === undefined ? 0 : Math.max(0, this.now() - startedAt))
    const status: AttentionStatus = info.failed === true ? 'failed_unread' : 'completed_unread'
    const item = this.buildItem(key, { ...info, status })
    if (info.failed === true) {
      this.upsertItem(item, { mode: 'immediate', urgentKind: 'turn_failed', urgency: 'normal' })
    } else if (durationMs >= this.normalTurnMinMs) {
      this.upsertItem(item, { mode: 'immediate', urgentKind: 'turn_completed', urgency: 'normal' })
    } else {
      this.upsertItem(item, { mode: 'debounced', silentKind: 'turn_completed', silentItemId: item.id })
    }
  }

  onSessionCancelled(backend: AttentionBackend, sessionId: string, acpAdapter?: string): void {
    if (this.closed) return
    const key = sessionItemId(backend, sessionId, acpAdapter)
    this.turnStartedAt.delete(key)
    this.harnessTurnFailed.delete(sessionId)
    const existing = this.items.get(key)
    if (existing !== undefined && existing.status === 'running') {
      this.removeItem(key)
    }
  }

  onSessionRemoved(backend: AttentionBackend, sessionId: string, acpAdapter?: string): void {
    if (this.closed) return
    const sessionKey = sessionItemId(backend, sessionId, acpAdapter)
    this.turnStartedAt.delete(sessionKey)
    this.sessionMeta.delete(sessionKey)
    if (backend === 'harness') {
      this.harnessTurnFailed.delete(sessionId)
      this.projectedHarnessQuestionIds.delete(sessionId)
      this.harnessQuestionProjectionSeqs.delete(sessionId)
    }
    this.invalidateTokensForSession(backend, sessionId, acpAdapter)
    const matching = [...this.items.values()].filter(item =>
      item.backend === backend
      && item.sessionId === sessionId
      && (acpAdapter === undefined || item.acpAdapter === acpAdapter))
    for (const item of matching) {
      this.removeItem(item.id)
    }
  }

  onInteractionPending(info: AttentionInteractionInfo): void {
    if (this.closed) return
    const sessionKey = sessionItemId(info.backend, info.sessionId, info.acpAdapter)
    this.rememberMeta(sessionKey, info)
    const item = this.buildItem(info.id, info, sessionKey)
    const alreadyNotified = this.criticalNotifiedIds.has(item.id)
    if (!alreadyNotified) {
      this.criticalNotifiedIds.add(item.id)
      const urgentKind: AttentionUrgentKind = item.status === 'waiting_question' ? 'question_needed' : 'approval_needed'
      this.upsertItem(item, { mode: 'immediate', urgentKind, urgency: 'critical' })
    } else {
      this.upsertItem(item, { mode: 'debounced', silentKind: null })
    }
  }

  onInteractionDetached(itemId: string, detachedExpiresAt: number): void {
    if (this.closed) return
    const existing = this.items.get(itemId)
    if (existing === undefined) return
    if (existing.detachedExpiresAt === detachedExpiresAt) return
    const updated: AttentionItem = attentionItemSchema.parse({
      ...existing,
      detachedExpiresAt: Math.max(0, Math.floor(detachedExpiresAt)),
      updatedAt: this.now(),
    })
    this.upsertItem(updated, { mode: 'debounced', silentKind: null })
  }

  onInteractionResolved(itemId: string): void {
    if (this.closed) return
    for (const [eventId, mappedId] of this.harnessQuestionEventToItemId) {
      if (mappedId === itemId) this.harnessQuestionEventToItemId.delete(eventId)
    }
    this.removeItem(itemId)
  }

  onBackendCleared(backend: AttentionBackend, acpAdapter?: string): void {
    if (this.closed) return
    const matching = [...this.items.values()].filter(item =>
      item.backend === backend && (acpAdapter === undefined || item.acpAdapter === acpAdapter))
    for (const item of matching) {
      this.removeItem(item.id)
    }
    const prefix = acpAdapter === undefined ? `${backend}:` : `${backend}:${acpAdapter}:`
    for (const key of [...this.turnStartedAt.keys()]) {
      if (key.startsWith(prefix)) this.turnStartedAt.delete(key)
    }
  }

  // ── DS-Bot live PluginRouteBridge observation (zero idle polling) ─────────

  observeBotResponse(
    route: string,
    body: { endpoint: string; payload?: Record<string, unknown> | null },
    result: PluginRouteCallResult,
  ): void {
    if (this.closed || route !== 'api/bot' || result.status !== 200) return
    if (!isRecord(result.json) || result.json.ok !== true) return
    const value = result.json.value

    if (body.endpoint === 'approval-answer') {
      const approvalId = isRecord(body.payload) && typeof body.payload.id === 'string' ? body.payload.id : undefined
      if (approvalId !== undefined) this.onInteractionResolved(botApprovalItemId(approvalId))
      return
    }

    if (body.endpoint === 'answer-question' || body.endpoint === 'dismiss-question') {
      const sessionId = isRecord(body.payload) && typeof body.payload.sessionId === 'string' ? body.payload.sessionId : undefined
      const questionId = isRecord(body.payload) && typeof body.payload.questionId === 'string' ? body.payload.questionId : undefined
      if (sessionId !== undefined && questionId !== undefined) {
        this.onInteractionResolved(botQuestionItemId(sessionId, questionId))
      } else if (sessionId !== undefined) {
        const prefix = `ds-bot:question:${sessionId}:`
        for (const id of [...this.items.keys()]) {
          if (id.startsWith(prefix)) this.onInteractionResolved(id)
        }
      }
      return
    }

    if (body.endpoint === 'state' && isRecord(value)) {
      this.observeBotState(value)
      return
    }

    if (body.endpoint === 'notices') {
      this.observeBotNotices(value)
    }
  }

  private observeBotState(state: Record<string, unknown>): void {
    const botNamesById = new Map<string, { name: string; sessionId: string }>()
    const roomNamesById = new Map<string, { name: string; sessionId: string }>()
    const titleBySessionId = new Map<string, string>()
    const workspaceId = typeof state.workspaceId === 'string' && state.workspaceId.length > 0 ? state.workspaceId : undefined

    if (Array.isArray(state.bots)) {
      for (const entry of state.bots) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.sessionId !== 'string') continue
        const name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : entry.id
        botNamesById.set(entry.id, { name, sessionId: entry.sessionId })
        titleBySessionId.set(entry.sessionId, name)
        this.rememberMeta(sessionItemId('ds-bot', entry.sessionId), {
          backend: 'ds-bot',
          mode: 'bot',
          sessionId: entry.sessionId,
          sessionTitle: name,
          ...(workspaceId === undefined ? {} : { workspaceId }),
        })
      }
    }

    if (Array.isArray(state.rooms)) {
      for (const entry of state.rooms) {
        if (!isRecord(entry) || typeof entry.id !== 'string') continue
        const sessionId = typeof entry.sessionId === 'string' && entry.sessionId.length > 0 ? entry.sessionId : entry.id
        const name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : entry.id
        roomNamesById.set(entry.id, { name, sessionId })
        titleBySessionId.set(sessionId, name)
        this.rememberMeta(sessionItemId('ds-bot', sessionId), {
          backend: 'ds-bot',
          mode: 'bot',
          sessionId,
          sessionTitle: name,
          ...(workspaceId === undefined ? {} : { workspaceId }),
        })
      }
    }

    // Reconcile pending approvals only when the snapshot includes an approvals array.
    const work = isRecord(state.work) ? state.work : undefined
    const rawApprovals = Array.isArray(work?.approvals)
      ? work.approvals
      : Array.isArray(state.approvals)
        ? state.approvals
        : undefined
    if (rawApprovals !== undefined) {
      const activeApprovalIds = new Set<string>()
      for (const approval of rawApprovals) {
        if (!isRecord(approval) || typeof approval.id !== 'string' || approval.id.length === 0) continue
        const bot = typeof approval.botId === 'string' ? botNamesById.get(approval.botId) : undefined
        const sessionId = (typeof approval.sessionId === 'string' && approval.sessionId.length > 0 ? approval.sessionId : undefined)
          ?? bot?.sessionId
          ?? (typeof approval.botId === 'string' && approval.botId.length > 0 ? approval.botId : approval.id)
        const itemId = botApprovalItemId(approval.id)
        activeApprovalIds.add(itemId)
        const tool = typeof approval.tool === 'string' ? approval.tool.trim() : ''
        const reason = typeof approval.reason === 'string' ? approval.reason.trim() : ''
        const summary = [tool, reason].filter(Boolean).join(': ') || undefined
        this.onInteractionPending({
          id: itemId,
          backend: 'ds-bot',
          mode: 'bot',
          ...(workspaceId === undefined ? {} : { workspaceId }),
          sessionId,
          sessionTitle: bot?.name ?? titleBySessionId.get(sessionId) ?? 'DS-Bot',
          status: 'waiting_approval',
          ...(summary === undefined ? {} : { summary }),
        })
      }
      for (const id of [...this.items.keys()]) {
        if (id.startsWith('ds-bot:approval:') && !activeApprovalIds.has(id)) {
          this.onInteractionResolved(id)
        }
      }
    }

    // Reconcile pending questions only when the snapshot includes a questions record.
    if (isRecord(state.questions)) {
      const activeQuestionIds = new Set<string>()
      for (const [sessionId, rawQuestion] of Object.entries(state.questions)) {
        if (!isRecord(rawQuestion) || typeof rawQuestion.id !== 'string' || rawQuestion.id.length === 0) continue
        const itemId = botQuestionItemId(sessionId, rawQuestion.id)
        activeQuestionIds.add(itemId)
        const summary = firstNonEmptyString(rawQuestion.question, rawQuestion.title, rawQuestion.prompt, rawQuestion.text)
        this.onInteractionPending({
          id: itemId,
          backend: 'ds-bot',
          mode: 'bot',
          ...(workspaceId === undefined ? {} : { workspaceId }),
          sessionId,
          sessionTitle: titleBySessionId.get(sessionId) ?? 'DS-Bot',
          status: 'waiting_question',
          ...(summary === undefined ? {} : { summary }),
        })
      }
      for (const id of [...this.items.keys()]) {
        if (id.startsWith('ds-bot:question:') && !activeQuestionIds.has(id)) {
          this.onInteractionResolved(id)
        }
      }
    }

    // Reconcile active bot/room work when work maps are present.
    if (work !== undefined && (isRecord(work.bots) || isRecord(work.rooms))) {
      const activeSessionIds = new Set<string>()
      if (isRecord(work.bots)) {
        for (const [botId, workEntry] of Object.entries(work.bots)) {
          if (!isBotWorkActive(workEntry)) continue
          const bot = botNamesById.get(botId)
          const sessionId = bot?.sessionId ?? botId
          activeSessionIds.add(sessionId)
          this.onSessionRunning({
            backend: 'ds-bot',
            mode: 'bot',
            ...(workspaceId === undefined ? {} : { workspaceId }),
            sessionId,
            sessionTitle: bot?.name ?? titleBySessionId.get(sessionId) ?? botId,
          })
        }
      }
      if (isRecord(work.rooms)) {
        for (const [roomId, workEntry] of Object.entries(work.rooms)) {
          if (!isBotWorkActive(workEntry)) continue
          const room = roomNamesById.get(roomId)
          const sessionId = room?.sessionId ?? roomId
          activeSessionIds.add(sessionId)
          this.onSessionRunning({
            backend: 'ds-bot',
            mode: 'bot',
            ...(workspaceId === undefined ? {} : { workspaceId }),
            sessionId,
            sessionTitle: room?.name ?? titleBySessionId.get(sessionId) ?? roomId,
          })
        }
      }
      for (const item of [...this.items.values()]) {
        if (item.backend === 'ds-bot' && item.status === 'running' && !activeSessionIds.has(item.sessionId)) {
          this.onSessionCompleted({
            backend: 'ds-bot',
            mode: 'bot',
            ...(item.workspaceId === undefined ? {} : { workspaceId: item.workspaceId }),
            sessionId: item.sessionId,
            sessionTitle: item.sessionTitle,
          })
        }
      }
    }
  }

  private observeBotNotices(value: unknown): void {
    const entries = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.notices)
        ? value.notices
        : isRecord(value) && Array.isArray(value.items)
          ? value.items
          : []
    for (const entry of entries) {
      if (!isRecord(entry)) continue
      const sessionId = firstNonEmptyString(entry.sessionId, entry.botId, entry.roomId, entry.id)
      if (sessionId === undefined) continue
      const title = firstNonEmptyString(entry.title, entry.botName, entry.roomName) ?? 'DS-Bot'
      const summary = firstNonEmptyString(entry.summary, entry.message, entry.reason, entry.text)
      const kind = typeof entry.kind === 'string' ? entry.kind : typeof entry.type === 'string' ? entry.type : ''
      if (kind === 'approval' || kind === 'waiting_approval') {
        const noticeId = firstNonEmptyString(entry.approvalId, entry.id) ?? sessionId
        this.onInteractionPending({
          id: botApprovalItemId(noticeId),
          backend: 'ds-bot',
          mode: 'bot',
          sessionId,
          sessionTitle: title,
          status: 'waiting_approval',
          ...(summary === undefined ? {} : { summary }),
        })
      } else if (kind === 'question' || kind === 'waiting_question') {
        const questionId = firstNonEmptyString(entry.questionId, entry.id) ?? 'notice'
        this.onInteractionPending({
          id: botQuestionItemId(sessionId, questionId),
          backend: 'ds-bot',
          mode: 'bot',
          sessionId,
          sessionTitle: title,
          status: 'waiting_question',
          ...(summary === undefined ? {} : { summary }),
        })
      } else if (kind === 'error' || kind === 'failed' || kind === 'turn_failed') {
        this.onSessionCompleted({
          backend: 'ds-bot',
          mode: 'bot',
          sessionId,
          sessionTitle: title,
          failed: true,
          ...(summary === undefined ? {} : { summary }),
        })
      } else if (kind === 'completed' || kind === 'turn_completed') {
        this.onSessionCompleted({
          backend: 'ds-bot',
          mode: 'bot',
          sessionId,
          sessionTitle: title,
          ...(summary === undefined ? {} : { summary }),
        })
      }
    }
  }

  // ── Lifecycle cleanup ─────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    if (this.observerRetryTimer !== undefined) {
      clearTimeout(this.observerRetryTimer)
      this.observerRetryTimer = undefined
    }
    this.observerRetryWake?.()
    this.observerRetryWake = undefined

    const controller = this.observerController
    const iterator = this.observerIterator
    const task = this.observerTask
    const gateway = this.observerGateway
    this.observerController = undefined
    this.observerIterator = undefined
    this.observerTask = undefined
    this.observerGateway = undefined

    // Strict lifecycle sequence: abort signal -> iterator.return() -> peer.dispose()
    controller?.abort('attention-tracker-closed')
    await iterator?.return?.().catch(() => undefined)
    await task?.catch(() => undefined)
    await gateway?.dispose?.().catch(() => undefined)

    this.followers.clear()
    this.tokens.clear()
    this.items.clear()
    this.sessionMeta.clear()
    this.turnStartedAt.clear()
    this.harnessTurnFailed.clear()
    this.projectedHarnessQuestionIds.clear()
    this.harnessQuestionProjectionSeqs.clear()
    this.harnessQuestionEventToItemId.clear()
    this.criticalNotifiedIds.clear()
    this.activeHarnessEventStreams = 0
  }

  // ── Harness passive read-only `session/control` observer ──────────────────

  private async runHarnessObserver(gateway: LocalTypertGateway): Promise<void> {
    let attempt = 0
    try {
      while (!this.closed) {
        const controller = new AbortController()
        this.observerController = controller
        let iterator: AsyncIterator<unknown> | undefined
        let terminal = false
        try {
          const stream = await gateway.open('session/control', { args: {} }, controller.signal)
          if (this.closed || controller.signal.aborted) break
          iterator = stream[Symbol.asyncIterator]()
          this.observerIterator = iterator
          while (!this.closed && !controller.signal.aborted) {
            const next = await iterator.next()
            if (next.done || this.closed || controller.signal.aborted) break
            if (isRecord(next.value) && (next.value.type === 'baseline' || next.value.type === 'projection')) {
              attempt = 0
            }
            this.handleHarnessControlFrame(next.value)
          }
        } catch (error) {
          if (this.closed || controller.signal.aborted) break
          const failure = gateway.failure(error)
          this.options.logger?.debug('harness attention observer degraded', {
            code: failure.code,
            attempt,
          })
          if (TERMINAL_OBSERVER_ERROR_CODES.has(failure.code)) {
            terminal = true
          } else if (failure.code === 'gateway/service-unavailable' && attempt >= this.observerBackoffMs.length) {
            terminal = true
          }
        } finally {
          if (this.observerIterator === iterator) this.observerIterator = undefined
          if (this.observerController === controller) this.observerController = undefined
          controller.abort()
          await iterator?.return?.().catch(() => undefined)
        }
        if (this.closed || terminal) break
        const delayMs = this.observerBackoffMs[Math.min(attempt, this.observerBackoffMs.length - 1)] ?? 60_000
        attempt += 1
        await this.waitBackoff(delayMs)
      }
    } finally {
      if (this.observerGateway === gateway) {
        this.observerGateway = undefined
        await gateway.dispose?.().catch(() => undefined)
      }
    }
  }

  private handleHarnessControlFrame(frame: unknown): void {
    if (!isRecord(frame) || typeof frame.type !== 'string') return
    if (frame.type === 'baseline' && isRecord(frame.value) && isRecord(frame.value.projections)) {
      const sessionsWithUserQuestions = new Set<string>()
      for (const [sessionId, block] of Object.entries(frame.value.projections)) {
        if (sessionId.length === 0 || !isRecord(block) || !isRecord(block.values)) continue
        const seq = typeof block.asOfSeq === 'number' ? block.asOfSeq : undefined
        if (Object.hasOwn(block.values, 'title')) {
          this.applyHarnessControlProjection(sessionId, 'title', block.values.title, seq)
        }
        if (Object.hasOwn(block.values, 'userQuestions')) {
          sessionsWithUserQuestions.add(sessionId)
          this.applyHarnessControlProjection(sessionId, 'userQuestions', block.values.userQuestions, seq)
        }
      }
      for (const [sessionId, ids] of [...this.projectedHarnessQuestionIds.entries()]) {
        if (sessionsWithUserQuestions.has(sessionId)) continue
        this.projectedHarnessQuestionIds.delete(sessionId)
        for (const id of ids) this.onInteractionResolved(id)
      }
      return
    }
    if (frame.type === 'projection' && typeof frame.sessionId === 'string' && frame.sessionId.length > 0) {
      const seq = typeof frame.seq === 'number' ? frame.seq : undefined
      if (Array.isArray(frame.changes)) {
        for (const change of frame.changes) {
          if (isRecord(change) && change.key === 'title') {
            this.applyHarnessControlProjection(frame.sessionId, 'title', change.val, seq)
          }
        }
        for (const change of frame.changes) {
          if (isRecord(change) && change.key === 'userQuestions') {
            this.applyHarnessControlProjection(frame.sessionId, 'userQuestions', change.val, seq)
          }
        }
        return
      }
      if (typeof frame.key === 'string') {
        this.applyHarnessControlProjection(frame.sessionId, frame.key, frame.value, seq)
      }
    }
  }

  private applyHarnessControlProjection(sessionId: string, key: string, value: unknown, seq?: number): void {
    if (key === 'title') {
      const sessionTitle = firstNonEmptyString(value)
      if (sessionTitle === undefined) return
      this.rememberMeta(sessionItemId('harness', sessionId), {
        backend: 'harness',
        mode: 'agent',
        sessionId,
        sessionTitle,
      })
      return
    }
    if (key !== 'userQuestions') return
    const previousSeq = this.harnessQuestionProjectionSeqs.get(sessionId)
    if (seq !== undefined && previousSeq !== undefined && seq < previousSeq) return
    if (value === null || value === undefined) {
      if (seq !== undefined) this.rememberHarnessQuestionSeq(sessionId, seq)
      const previous = this.projectedHarnessQuestionIds.get(sessionId)
      if (previous !== undefined) {
        this.projectedHarnessQuestionIds.delete(sessionId)
        for (const id of previous) this.onInteractionResolved(id)
      }
      return
    }
    if (!isRecord(value) || !Array.isArray(value.active)) return
    if ('settled' in value && value.settled !== undefined && !Array.isArray(value.settled)) return
    if (seq !== undefined) this.rememberHarnessQuestionSeq(sessionId, seq)

    const nextActiveIds = new Set<string>()
    for (const row of value.active) {
      if (!isRecord(row) || typeof row.callId !== 'string' || row.callId.length === 0) continue
      if (row.state !== 'open' && row.state !== 'continued') continue
      if (row.questions !== undefined && !Array.isArray(row.questions)) continue
      const itemId = harnessProjectedQuestionItemId(sessionId, row.callId)
      nextActiveIds.add(itemId)
      const summary = extractHarnessQuestionSummary(row)
      this.onInteractionPending({
        id: itemId,
        backend: 'harness',
        mode: 'agent',
        sessionId,
        status: 'waiting_question',
        ...(summary === undefined ? {} : { summary }),
      })
    }

    const previous = this.projectedHarnessQuestionIds.get(sessionId)
    if (previous !== undefined) {
      for (const prevId of previous) {
        if (!nextActiveIds.has(prevId)) this.onInteractionResolved(prevId)
      }
    }
    if (Array.isArray(value.settled)) {
      for (const row of value.settled) {
        if (!isRecord(row) || typeof row.callId !== 'string' || row.callId.length === 0) continue
        const settledId = harnessProjectedQuestionItemId(sessionId, row.callId)
        if (!nextActiveIds.has(settledId)) this.onInteractionResolved(settledId)
      }
    }
    if (nextActiveIds.size === 0) this.projectedHarnessQuestionIds.delete(sessionId)
    else this.projectedHarnessQuestionIds.set(sessionId, nextActiveIds)
  }

  private waitBackoff(delayMs: number): Promise<void> {
    if (this.closed) return Promise.resolve()
    return new Promise<void>(resolve => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        if (this.observerRetryTimer !== undefined) {
          clearTimeout(this.observerRetryTimer)
          this.observerRetryTimer = undefined
        }
        this.observerRetryWake = undefined
        resolve()
      }
      this.observerRetryWake = done
      this.observerRetryTimer = setTimeout(done, Math.max(0, delayMs))
      this.observerRetryTimer.unref?.()
    })
  }

  private handleHarnessEventFrame(frame: unknown): void {
    if (!isRecord(frame) || typeof frame.type !== 'string') return
    if (frame.type === 'emit' && typeof frame.event === 'string' && Array.isArray(frame.args)) {
      this.handleHarnessEmit(frame.event, frame.args)
      return
    }
    if (frame.type === 'waterfall' && typeof frame.eventId === 'string'
      && typeof frame.agentId === 'string' && isRecord(frame.request)) {
      this.handleHarnessWaterfall(frame.event, frame.eventId, frame.agentId, frame.request)
      return
    }
    if (frame.type === 'cancel' && typeof frame.eventId === 'string') {
      this.resolveHarnessEventId(frame.eventId)
    }
  }

  private resolveHarnessEventId(eventId: string): void {
    this.onInteractionResolved(harnessApprovalItemId(eventId))
    this.onInteractionResolved(harnessQuestionItemId(eventId))
    const mappedQuestionId = this.harnessQuestionEventToItemId.get(eventId)
    if (mappedQuestionId !== undefined) {
      this.harnessQuestionEventToItemId.delete(eventId)
      if (!this.isProjectedHarnessQuestion(mappedQuestionId)) {
        this.onInteractionResolved(mappedQuestionId)
      }
    }
  }

  private isProjectedHarnessQuestion(itemId: string): boolean {
    for (const ids of this.projectedHarnessQuestionIds.values()) {
      if (ids.has(itemId)) return true
    }
    return false
  }

  private handleHarnessEmit(event: string, args: unknown[]): void {
    switch (event) {
      case 'api-session/added':
      case 'api-session/updated': {
        const raw = args[0]
        if (!isRecord(raw) || typeof raw.sessionId !== 'string' || raw.sessionId.length === 0) return
        const sessionId = raw.sessionId
        const projections = isRecord(raw.projections) && isRecord(raw.projections.values) ? raw.projections.values : undefined
        const sessionTitle = firstNonEmptyString(projections?.title, raw.title, raw.name)
        const workspaceId = firstNonEmptyString(raw.workspaceId)
        const workspaceLabel = firstNonEmptyString(raw.workspaceLabel, raw.workspaceName)
        const key = sessionItemId('harness', sessionId)
        this.rememberMeta(key, {
          backend: 'harness',
          mode: 'agent',
          sessionId,
          ...(sessionTitle === undefined ? {} : { sessionTitle }),
          ...(workspaceId === undefined ? {} : { workspaceId }),
          ...(workspaceLabel === undefined ? {} : { workspaceLabel }),
        })
        if (raw.running === true) {
          this.onSessionRunning({
            backend: 'harness',
            mode: 'agent',
            sessionId,
            ...(sessionTitle === undefined ? {} : { sessionTitle }),
            ...(workspaceId === undefined ? {} : { workspaceId }),
            ...(workspaceLabel === undefined ? {} : { workspaceLabel }),
          })
        }
        return
      }
      case 'api-session/removed': {
        const sessionId = args[0]
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        this.onSessionRemoved('harness', sessionId)
        return
      }
      case 'api-session/status': {
        const sessionId = args[0]
        const running = args[1]
        if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof running !== 'boolean') return
        const key = sessionItemId('harness', sessionId)
        if (running) {
          this.onSessionRunning({ backend: 'harness', mode: 'agent', sessionId })
        } else {
          const wasRunning = this.turnStartedAt.has(key) || this.items.get(key)?.status === 'running'
          const failed = this.harnessTurnFailed.delete(sessionId)
          if (!wasRunning && !failed) return
          if (failed && this.items.get(key)?.status === 'failed_unread') {
            this.turnStartedAt.delete(key)
            return
          }
          this.onSessionCompleted({ backend: 'harness', mode: 'agent', sessionId, failed })
        }
        return
      }
      case 'api-session/activity': {
        const sessionId = args[0]
        const updatedAt = args[1]
        if (typeof sessionId !== 'string' || sessionId.length === 0
          || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) return
        const key = sessionItemId('harness', sessionId)
        const existing = this.items.get(key)
        if (existing === undefined || existing.status !== 'running' || updatedAt <= existing.updatedAt) return
        this.items.set(key, { ...existing, updatedAt: Math.floor(updatedAt) })
        return
      }
      case 'api-session/error': {
        const sessionId = args[0]
        const message = typeof args[1] === 'string' ? args[1] : undefined
        if (typeof sessionId !== 'string' || sessionId.length === 0) return
        this.harnessTurnFailed.add(sessionId)
        this.onSessionCompleted({
          backend: 'harness',
          mode: 'agent',
          sessionId,
          failed: true,
          ...(message === undefined ? {} : { summary: message }),
        })
      }
    }
  }

  private handleHarnessWaterfall(
    event: unknown,
    eventId: string,
    sessionId: string,
    request: Record<string, unknown>,
  ): void {
    if (event === 'approval/request') {
      const toolName = firstNonEmptyString(request.toolName)
      const reason = firstNonEmptyString(request.reason)
      const summary = [toolName, reason].filter(Boolean).join(': ') || undefined
      this.onInteractionPending({
        id: harnessApprovalItemId(eventId),
        backend: 'harness',
        mode: 'agent',
        sessionId,
        status: 'waiting_approval',
        ...(summary === undefined ? {} : { summary }),
      })
      return
    }
    if (event === 'user-questions/request') {
      const summary = extractHarnessQuestionSummary(request)
      const wait = isRecord(request.wait) ? request.wait : undefined
      const callId = typeof wait?.callId === 'string' && wait.callId.length > 0 ? wait.callId : undefined
      const itemId = callId === undefined
        ? harnessQuestionItemId(eventId)
        : harnessProjectedQuestionItemId(sessionId, callId)
      if (callId !== undefined) {
        this.harnessQuestionEventToItemId.delete(eventId)
        this.harnessQuestionEventToItemId.set(eventId, itemId)
        while (this.harnessQuestionEventToItemId.size > MAX_SESSION_METADATA_ENTRIES) {
          const oldest = this.harnessQuestionEventToItemId.keys().next().value
          if (oldest === undefined) break
          this.harnessQuestionEventToItemId.delete(oldest)
        }
      }
      this.onInteractionPending({
        id: itemId,
        backend: 'harness',
        mode: 'agent',
        sessionId,
        status: 'waiting_question',
        ...(summary === undefined ? {} : { summary }),
      })
    }
  }

  // ── Internal item/digest/token mechanics ──────────────────────────────────

  private rememberHarnessQuestionSeq(sessionId: string, seq: number): void {
    this.harnessQuestionProjectionSeqs.delete(sessionId)
    this.harnessQuestionProjectionSeqs.set(sessionId, seq)
    while (this.harnessQuestionProjectionSeqs.size > MAX_SESSION_METADATA_ENTRIES) {
      const oldest = this.harnessQuestionProjectionSeqs.keys().next().value
      if (oldest === undefined) break
      this.harnessQuestionProjectionSeqs.delete(oldest)
    }
  }

  private rememberMeta(key: string, info: AttentionSessionInfo): void {
    const prev = this.sessionMeta.get(key)
    const next: SessionMetadata = {
      sessionTitle: info.sessionTitle ?? prev?.sessionTitle,
      workspaceId: info.workspaceId ?? prev?.workspaceId,
      workspaceLabel: info.workspaceLabel ?? prev?.workspaceLabel,
    }
    if (next.sessionTitle === undefined && next.workspaceId === undefined && next.workspaceLabel === undefined) return
    this.sessionMeta.delete(key)
    this.sessionMeta.set(key, next)
    while (this.sessionMeta.size > MAX_SESSION_METADATA_ENTRIES) {
      const oldest = this.sessionMeta.keys().next().value
      if (oldest === undefined) break
      this.sessionMeta.delete(oldest)
    }
  }

  private buildItem(
    id: string,
    info: AttentionSessionInfo & { status: AttentionStatus; detachedExpiresAt?: number },
    metaKey = id,
  ): AttentionItem {
    const meta = this.sessionMeta.get(metaKey)
    const workspaceId = info.workspaceId ?? meta?.workspaceId
    const workspaceLabel = info.workspaceLabel ?? meta?.workspaceLabel
    const sessionTitle = truncateText(info.sessionTitle ?? meta?.sessionTitle ?? info.sessionId, MAX_ATTENTION_TITLE_CHARS)
    const summary = info.summary === undefined ? undefined : truncateText(info.summary, MAX_ATTENTION_SUMMARY_CHARS)
    const candidate: AttentionItem = {
      id: truncateId(id, 256),
      backend: info.backend,
      ...(info.acpAdapter === undefined ? {} : { acpAdapter: truncateId(info.acpAdapter, 64) }),
      mode: info.mode,
      ...(workspaceId === undefined || workspaceId.length === 0 ? {} : { workspaceId: truncateId(workspaceId, 256) }),
      ...(workspaceLabel === undefined || workspaceLabel.length === 0 ? {} : { workspaceLabel: truncateText(workspaceLabel, MAX_ATTENTION_TITLE_CHARS) }),
      sessionId: truncateId(info.sessionId, 256),
      sessionTitle,
      status: info.status,
      ...(summary === undefined || summary.length === 0 ? {} : { summary }),
      ...(info.detachedExpiresAt === undefined ? {} : { detachedExpiresAt: Math.max(0, Math.floor(info.detachedExpiresAt)) }),
      updatedAt: Math.max(0, Math.floor(this.now())),
    }
    return attentionItemSchema.parse(candidate)
  }

  private upsertItem(
    item: AttentionItem,
    signal:
      | { mode: 'immediate'; urgentKind: AttentionUrgentKind; urgency: AttentionUrgency }
      | { mode: 'debounced'; silentKind: AttentionUrgentKind | null; silentItemId?: string },
  ): void {
    const existing = this.items.get(item.id)
    if (existing !== undefined && itemsEquivalent(existing, item)) return

    this.items.set(item.id, item)
    const evictedIds = this.enforceItemCap()
    const itemRetained = this.items.has(item.id)
    this.revision += 1

    const blockingNow = this.countBlocking()
    const droppedToZero = this.previousBlockingCount > 0 && blockingNow === 0
    this.previousBlockingCount = blockingNow

    let immediateDigest: AttentionDigest | undefined
    if (signal.mode === 'immediate' && itemRetained) {
      const token = this.mintToken(item)
      immediateDigest = this.buildDigest(signal.urgentKind, signal.urgency, token)
    } else if (droppedToZero) {
      immediateDigest = this.buildDigest('clear', 'silent')
    }

    const followDigest = immediateDigest ?? this.buildDigest(null, 'silent')
    for (const evictedId of evictedIds) {
      if (evictedId !== item.id) {
        this.broadcastFollowEvent({ type: 'remove', revision: this.revision, digest: followDigest, itemId: evictedId })
      }
    }
    if (itemRetained) {
      this.broadcastFollowEvent({ type: 'upsert', revision: this.revision, digest: followDigest, item })
    }

    if (immediateDigest !== undefined) {
      this.cancelDebounceTimer()
      this.emitDigest(immediateDigest)
    } else {
      this.scheduleDebouncedDigest(
        signal.mode === 'debounced' ? signal.silentKind : null,
        signal.mode === 'debounced' ? signal.silentItemId : undefined,
      )
    }
  }

  private removeItem(itemId: string): void {
    const existing = this.items.get(itemId)
    if (existing === undefined) return
    this.items.delete(itemId)
    this.criticalNotifiedIds.delete(itemId)
    this.invalidateTokensForItem(itemId)
    this.revision += 1

    const blockingNow = this.countBlocking()
    const droppedToZero = this.previousBlockingCount > 0 && blockingNow === 0
    this.previousBlockingCount = blockingNow

    const digest = droppedToZero
      ? this.buildDigest('clear', 'silent')
      : this.buildDigest(null, 'silent')

    this.broadcastFollowEvent({ type: 'remove', revision: this.revision, digest, itemId })

    if (droppedToZero) {
      this.cancelDebounceTimer()
      this.emitDigest(digest)
    } else {
      this.scheduleDebouncedDigest(null)
    }
  }

  private enforceItemCap(): string[] {
    if (this.items.size <= MAX_ATTENTION_ITEMS) return []
    const sorted = this.sortedItems()
    const evicted: string[] = []
    for (let index = MAX_ATTENTION_ITEMS; index < sorted.length; index += 1) {
      const removed = sorted[index]!
      this.items.delete(removed.id)
      this.criticalNotifiedIds.delete(removed.id)
      this.invalidateTokensForItem(removed.id)
      evicted.push(removed.id)
    }
    return evicted
  }

  private sortedItems(): AttentionItem[] {
    return [...this.items.values()].sort(compareAttentionItems)
  }

  private countBlocking(): number {
    let count = 0
    for (const item of this.items.values()) {
      if (item.status === 'waiting_approval' || item.status === 'waiting_question') count += 1
    }
    return count
  }

  private buildDigest(
    urgentKind: AttentionUrgentKind | null,
    urgency: AttentionUrgency,
    attentionToken?: string,
  ): AttentionDigest {
    let pendingApprovals = 0
    let pendingQuestions = 0
    let runningSessions = 0
    let completedUnread = 0
    for (const item of this.items.values()) {
      if (item.status === 'waiting_approval') pendingApprovals += 1
      else if (item.status === 'waiting_question') pendingQuestions += 1
      else if (item.status === 'running') runningSessions += 1
      else if (item.status === 'completed_unread' || item.status === 'failed_unread') completedUnread += 1
    }
    const digest = attentionDigestSchema.parse({
      revision: this.revision,
      pendingApprovals: Math.min(MAX_ATTENTION_COUNT, pendingApprovals),
      pendingQuestions: Math.min(MAX_ATTENTION_COUNT, pendingQuestions),
      runningSessions: Math.min(MAX_ATTENTION_COUNT, runningSessions),
      completedUnread: Math.min(MAX_ATTENTION_COUNT, completedUnread),
      urgentKind,
      urgency,
      ...(attentionToken === undefined ? {} : { attentionToken }),
      updatedAt: Math.max(0, Math.floor(this.now())),
    })
    this.lastDigest = digest
    return digest
  }

  private scheduleDebouncedDigest(urgentKind: AttentionUrgentKind | null, itemId?: string): void {
    if (this.closed) return
    if (urgentKind !== null || this.pendingSilentHint === undefined) {
      this.pendingSilentHint = { urgentKind, ...(itemId === undefined ? {} : { itemId }) }
    }
    if (this.debounceTimer !== undefined) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      if (this.closed) return
      const hint = this.pendingSilentHint
      this.pendingSilentHint = undefined
      const item = hint?.itemId === undefined ? undefined : this.items.get(hint.itemId)
      const token = item === undefined ? undefined : this.mintToken(item)
      const digest = this.buildDigest(hint?.urgentKind ?? null, 'silent', token)
      this.emitDigest(digest)
    }, this.debounceMs)
    this.debounceTimer.unref?.()
  }

  private cancelDebounceTimer(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    this.pendingSilentHint = undefined
  }

  private emitDigest(digest: AttentionDigest): void {
    if (this.closed) return
    try {
      this.options.onDigest?.(attentionDigestSchema.parse(digest))
    } catch {
      // Publishing a blind signal must never disrupt Host business state.
    }
  }

  private mintToken(item: AttentionItem): string {
    this.pruneExpiredTokens()
    while (this.tokens.size >= this.maxTokens) {
      const oldest = this.tokens.keys().next().value
      if (oldest === undefined) break
      this.tokens.delete(oldest)
    }
    const token = randomBytes(16).toString('hex')
    this.tokens.set(token, {
      target: {
        kind: 'session',
        backend: item.backend,
        ...(item.acpAdapter === undefined ? {} : { acpAdapter: item.acpAdapter }),
        mode: item.mode,
        ...(item.workspaceId === undefined ? {} : { workspaceId: item.workspaceId }),
        sessionId: item.sessionId,
        itemId: item.id,
      },
      expiresAt: this.now() + this.tokenTtlMs,
    })
    return token
  }

  private pruneExpiredTokens(): void {
    const now = this.now()
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt <= now) this.tokens.delete(token)
    }
  }

  private invalidateTokensForItem(itemId: string): void {
    for (const [token, entry] of this.tokens) {
      if (entry.target.itemId === itemId) this.tokens.delete(token)
    }
  }

  private invalidateTokensForSession(backend: AttentionBackend, sessionId: string, acpAdapter?: string): void {
    for (const [token, entry] of this.tokens) {
      if (entry.target.backend === backend
        && entry.target.sessionId === sessionId
        && (acpAdapter === undefined || entry.target.acpAdapter === acpAdapter)) {
        this.tokens.delete(token)
      }
    }
  }

  private broadcastFollowEvent(event: AttentionFollowEvent): void {
    for (const [connectionId, follower] of this.followers) {
      this.enqueueFollowerEvent(connectionId, follower, event)
    }
  }

  private enqueueFollowerEvent(
    connectionId: string,
    follower: Follower,
    event: AttentionFollowEvent,
  ): void {
    const next = follower.chain.then(async () => {
      if (this.closed || this.followers.get(connectionId) !== follower) return
      try {
        await follower.send(event)
      } catch {
        if (this.followers.get(connectionId) === follower) {
          this.followers.delete(connectionId)
        }
      }
    })
    follower.chain = next.catch(() => undefined)
  }
}

export function sessionItemId(backend: AttentionBackend, sessionId: string, acpAdapter?: string): string {
  return acpAdapter === undefined
    ? truncateId(`${backend}:session:${sessionId}`, 256)
    : truncateId(`${backend}:${acpAdapter}:session:${sessionId}`, 256)
}

export function codexApprovalItemId(requestHandle: string): string {
  return truncateId(`codex:approval:${requestHandle}`, 256)
}

export function acpApprovalItemId(backend: string, requestHandle: string): string {
  return truncateId(`acp:${backend}:approval:${requestHandle}`, 256)
}

function harnessApprovalItemId(eventId: string): string {
  return truncateId(`harness:approval:${eventId}`, 256)
}

function harnessQuestionItemId(eventId: string): string {
  return truncateId(`harness:question:${eventId}`, 256)
}

function harnessProjectedQuestionItemId(sessionId: string, callId: string): string {
  return truncateId(`harness:question:${sessionId}:${callId}`, 256)
}

function botApprovalItemId(approvalId: string): string {
  return truncateId(`ds-bot:approval:${approvalId}`, 256)
}

function botQuestionItemId(sessionId: string, questionId: string): string {
  return truncateId(`ds-bot:question:${sessionId}:${questionId}`, 256)
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars)
}

function truncateId(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars)
}

function itemsEquivalent(left: AttentionItem, right: AttentionItem): boolean {
  return left.id === right.id
    && left.backend === right.backend
    && left.acpAdapter === right.acpAdapter
    && left.mode === right.mode
    && left.workspaceId === right.workspaceId
    && left.workspaceLabel === right.workspaceLabel
    && left.sessionId === right.sessionId
    && left.sessionTitle === right.sessionTitle
    && left.status === right.status
    && left.summary === right.summary
    && left.detachedExpiresAt === right.detachedExpiresAt
}

function isBotWorkActive(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') return value.trim().length > 0 && value !== 'idle'
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) {
    if (value.active === false || value.running === false || value.status === 'idle') return false
    return Object.keys(value).length > 0
  }
  return false
}

function extractHarnessQuestionSummary(request: Record<string, unknown>): string | undefined {
  if (Array.isArray(request.questions)) {
    for (const entry of request.questions) {
      if (isRecord(entry)) {
        const text = firstNonEmptyString(entry.question, entry.header, entry.prompt, entry.title)
        if (text !== undefined) return text
      } else if (typeof entry === 'string' && entry.trim().length > 0) {
        return entry.trim()
      }
    }
  }
  return firstNonEmptyString(request.question, request.prompt, request.title)
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
