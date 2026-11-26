import { create } from 'zustand'
import {
  MAX_ATTENTION_COUNT,
  MAX_ATTENTION_ITEMS,
  MAX_ATTENTION_SUMMARY_CHARS,
  MAX_ATTENTION_TITLE_CHARS,
  attentionTokenSchema,
  compareAttentionItems,
  type AttentionBackend,
  type AttentionDigest,
  type AttentionItem,
  type AttentionStatus,
  type AttentionTarget,
  type AttentionUrgency,
  type AttentionUrgentKind,
} from '@dsh-remote/protocol'
import {
  applyAttentionFollowEvent,
  createEmptyAttentionInboxState,
  type AttentionFollowSubscription,
  type RemoteAttentionClient,
} from '@dsh-remote/client-core'
import { harnessDisplayName, parseHandoffPreview, sanitizeHandoffDisplayTitle, type SessionHandoffOrigin } from '../lib/handoff-preview'
import { isAcpManagedBackend } from '../lib/workspace-key'
import { strings } from '../locales/i18n'
import { resolveSessionDisplayTitle } from '../screens/session-title'
import type { BotObject, BotState } from '../services/bot-catalog'
import type { ChatItem, RemoteDevice, RemoteSession, WorkspaceView } from '../types'

export interface AttentionGroups {
  /** `waiting_question`, `waiting_approval`, `failed_unread` */
  attention: AttentionItem[]
  /** `completed_unread` */
  finished: AttentionItem[]
  /** `running` */
  running: AttentionItem[]
}

export interface AttentionCounts {
  pendingApprovals: number
  pendingQuestions: number
  runningSessions: number
  completedUnread: number
  failedUnread: number
  totalUrgent: number
  totalActive: number
}

export interface LegacyAttentionSources {
  sessions?: readonly RemoteSession[]
  sessionLifecycles?: Readonly<Record<string, { seq?: number; running?: boolean; turn?: string; finished?: 'completed' | 'failed' }>>
  messages?: Readonly<Record<string, readonly ChatItem[]>>
  workspaces?: readonly WorkspaceView[]
  botState?: BotState
  ackedIds?: ReadonlySet<string> | readonly string[]
  /** Optional locally observed `completed_unread` session IDs from running -> idle transitions. */
  completedSessionIds?: ReadonlySet<string>
  handoffOrigins?: Readonly<Record<string, SessionHandoffOrigin>>
  now?: number
}

export interface HostAttentionSnapshot {
  hostId: string
  items: AttentionItem[]
  digest: AttentionDigest | null
  revision: number
  supported: boolean
  syncedAt: number
}

export type HostAttentionFreshness =
  | 'live'
  | 'digest-match'
  | 'digest-stale'
  | 'digest-cleared'
  | 'digest-only'
  | 'offline-cache'
  | 'none'

export interface HostAttentionOverview {
  deviceId: string
  isConnectedHost: boolean
  pendingApprovals: number
  pendingQuestions: number
  runningSessions: number
  completedUnread: number
  failedUnread: number
  totalUrgent: number
  totalActive: number
  hasFailedSignal: boolean
  freshness: HostAttentionFreshness
  syncedAt?: number
  items: readonly AttentionItem[]
}

export interface CrossHostAttentionCounts extends AttentionCounts {
  otherHostsUrgent: number
  otherHostsActive: number
}

export interface AttachAttentionConnectionParams {
  hostId: string
  generation: number
  advertisedSupported: boolean
  client?: RemoteAttentionClient
  /**
   * When `advertisedSupported` is false but a `client` is available, safely probe
   * `attention.follow` once (default true). Older Hosts reject with METHOD_NOT_FOUND
   * / CAPABILITY_NOT_SUPPORTED and cleanly enter legacy fallback mode.
   */
  probeIfUnadvertised?: boolean
}

export interface AttentionStoreState {
  hostId?: string
  connectionGeneration: number
  items: AttentionItem[]
  digest: AttentionDigest | null
  revision: number
  supported: boolean
  loading: boolean
  inboxOpen: boolean
  localAckedIds: string[]
  cachedByHost: Readonly<Record<string, HostAttentionSnapshot>>
  setInboxOpen: (open: boolean) => void
  attachConnection: (params: AttachAttentionConnectionParams) => Promise<void>
  detachConnection: (generation?: number) => Promise<void>
  syncLegacyFallback: (sources: LegacyAttentionSources) => void
  ackUnread: (itemIds: readonly string[]) => Promise<void>
  ackAllUnread: () => Promise<void>
  resolveToken: (token: string) => Promise<AttentionTarget>
  evictHost: (hostId: string) => void
  reset: () => void
}

const PROBE_FOLLOW_TIMEOUT_MS = 5_000
const MAX_CACHED_HOSTS = 16
const UNREAD_STATUSES: ReadonlySet<AttentionStatus> = new Set(['completed_unread', 'failed_unread'])

let activeGeneration = 0
let activeClient: RemoteAttentionClient | undefined
let activeSubscription: AttentionFollowSubscription | undefined
let activeAbort: AbortController | undefined
let activeAttachPromise: Promise<void> | undefined

/** A raw session id is never a title: DS-Bot sessions get their platform label, others the local default. */
function attentionFallbackTitle(item: Pick<AttentionItem, 'backend' | 'mode'>): string {
  return item.mode === 'bot' || item.backend === 'ds-bot'
    ? 'DS-Bot'
    : strings.comfort.liveTaskDefaultTitle
}

function matchesBareId(trimmed: string, id: string): boolean {
  return trimmed === id || (id.length > MAX_ATTENTION_TITLE_CHARS && trimmed === id.slice(0, MAX_ATTENTION_TITLE_CHARS))
}

function isBareSessionId(title: string | undefined, sessionId: string): boolean {
  if (title === undefined) return false
  const trimmed = title.trim()
  const id = sessionId.trim()
  if (trimmed.length === 0 || id.length === 0) return false
  if (matchesBareId(trimmed, id)) return true
  const colonIndex = id.indexOf(':')
  if (colonIndex <= 0) return false
  const afterFirst = id.slice(colonIndex + 1)
  if (afterFirst.length > 0 && matchesBareId(trimmed, afterFirst)) return true
  if (id.startsWith('acp:')) {
    const secondColon = afterFirst.indexOf(':')
    if (secondColon > 0) {
      const nativeId = afterFirst.slice(secondColon + 1)
      if (nativeId.length > 0 && matchesBareId(trimmed, nativeId)) return true
    }
  }
  return false
}

/** Normalizes any AttentionItem title: rejects bare session ids, sanitizes handoff markers, and caps length. */
export function normalizeAttentionTitle(
  item: Pick<AttentionItem, 'backend' | 'mode' | 'sessionId' | 'sessionTitle'>,
): string {
  const raw = item.sessionTitle.trim()
  if (raw.length === 0 || isBareSessionId(raw, item.sessionId)) {
    return attentionFallbackTitle(item).slice(0, MAX_ATTENTION_TITLE_CHARS)
  }
  const preview = parseHandoffPreview(raw)
  const fallback = preview?.sourceBackend && preview?.targetBackend
    ? `${harnessDisplayName(preview.sourceBackend)} → ${harnessDisplayName(preview.targetBackend)}`
    : strings.handoff.title
  return (sanitizeHandoffDisplayTitle(raw, fallback) ?? raw).slice(0, MAX_ATTENTION_TITLE_CHARS)
}

function sanitizeAttentionItem(item: AttentionItem): AttentionItem {
  const nextTitle = normalizeAttentionTitle(item)
  return nextTitle === item.sessionTitle ? item : { ...item, sessionTitle: nextTitle }
}

function sanitizeAttentionItems(items: readonly AttentionItem[]): AttentionItem[] {
  let changed = false
  const next = items.map(item => {
    const clean = sanitizeAttentionItem(item)
    if (clean !== item) changed = true
    return clean
  })
  return changed ? next : (items as AttentionItem[])
}

function capCount(value: number): number {
  return Math.max(0, Math.min(MAX_ATTENTION_COUNT, Math.floor(value)))
}

function trimSnippet(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const collapsed = value
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/[`*_>#|]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (collapsed.length === 0) return undefined
  return collapsed.slice(0, maxChars)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapSessionBackend(backend?: string): { backend: AttentionBackend; acpAdapter?: string } {
  const normalized = (backend ?? 'harness').trim().toLowerCase()
  if (normalized === 'codex') return { backend: 'codex' }
  if (normalized === 'harness' || normalized === '') return { backend: 'harness' }
  if (isAcpManagedBackend(normalized)) {
    return { backend: 'acp', acpAdapter: normalized }
  }
  return { backend: 'acp', acpAdapter: normalized }
}

function isPendingChatApproval(session: RemoteSession, item: ChatItem): boolean {
  if (item.kind !== 'approval' || item.outcome !== undefined) return false
  return session.backend === 'codex'
    || isAcpManagedBackend(session.backend)
    || item.frameRpcId !== undefined
}

function isPendingChatQuestion(item: ChatItem): boolean {
  return item.kind === 'question' && item.outcome === undefined && item.questionState !== 'continued'
}

function latestAssistantSnippet(items: readonly ChatItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === 'message' && item.role === 'assistant') {
      const snippet = trimSnippet(item.text, MAX_ATTENTION_SUMMARY_CHARS)
      if (snippet !== undefined) return snippet
    }
  }
  return undefined
}

/**
 * Splits items into the three exclusive Attention Inbox buckets while preserving
 * deterministic `compareAttentionItems` priority ordering within each bucket.
 */
export function selectAttentionGroups(items: readonly AttentionItem[]): AttentionGroups {
  const sorted = [...items].sort(compareAttentionItems)
  const attention: AttentionItem[] = []
  const finished: AttentionItem[] = []
  const running: AttentionItem[] = []
  for (const item of sorted) {
    if (
      item.status === 'waiting_question'
      || item.status === 'waiting_approval'
      || item.status === 'failed_unread'
    ) {
      attention.push(item)
    } else if (item.status === 'completed_unread') {
      finished.push(item)
    } else if (item.status === 'running') {
      running.push(item)
    }
  }
  return { attention, finished, running }
}

/** Computes aggregate counts used by header pills, badges, and live surfaces. */
export function selectAttentionCounts(items: readonly AttentionItem[]): AttentionCounts {
  let pendingApprovals = 0
  let pendingQuestions = 0
  let runningSessions = 0
  let completedUnread = 0
  let failedUnread = 0
  for (const item of items) {
    switch (item.status) {
      case 'waiting_approval':
        pendingApprovals += 1
        break
      case 'waiting_question':
        pendingQuestions += 1
        break
      case 'running':
        runningSessions += 1
        break
      case 'completed_unread':
        completedUnread += 1
        break
      case 'failed_unread':
        failedUnread += 1
        break
    }
  }
  const totalUrgent = pendingApprovals + pendingQuestions
  return {
    pendingApprovals,
    pendingQuestions,
    runningSessions,
    completedUnread,
    failedUnread,
    totalUrgent,
    totalActive: items.length,
  }
}

/** Total non-negative count reported by a blind Server AttentionDigest. */
export function totalAttentionDigestCount(digest?: AttentionDigest | null): number {
  if (digest === undefined || digest === null) return 0
  return Math.max(0, digest.pendingApprovals)
    + Math.max(0, digest.pendingQuestions)
    + Math.max(0, digest.runningSessions)
    + Math.max(0, digest.completedUnread)
}

/**
 * Resolves display counts, freshness, and previewable E2EE items (live or
 * cached) for a given Host inside the multi-host Attention Inbox.
 */
export function resolveHostAttentionOverview(params: {
  device: Pick<RemoteDevice, 'deviceId' | 'online' | 'trusted' | 'attentionDigest'>
  connectedHostId?: string
  activeItems: readonly AttentionItem[]
  cachedSnapshot?: HostAttentionSnapshot
}): HostAttentionOverview {
  const { device, connectedHostId, activeItems, cachedSnapshot } = params
  const isConnectedHost = connectedHostId === device.deviceId
  if (isConnectedHost) {
    const counts = selectAttentionCounts(activeItems)
    return {
      deviceId: device.deviceId,
      isConnectedHost: true,
      ...counts,
      hasFailedSignal: counts.failedUnread > 0,
      freshness: 'live',
      syncedAt: cachedSnapshot?.syncedAt,
      items: activeItems,
    }
  }

  const cachedItems = cachedSnapshot?.items ?? []
  const digest = device.online ? device.attentionDigest : undefined
  if (device.online && digest !== undefined) {
    const pendingApprovals = Math.max(0, digest.pendingApprovals)
    const pendingQuestions = Math.max(0, digest.pendingQuestions)
    const runningSessions = Math.max(0, digest.runningSessions)
    const completedUnread = Math.max(0, digest.completedUnread)
    const totalUrgent = pendingApprovals + pendingQuestions
    const totalActive = totalAttentionDigestCount(digest)

    let freshness: HostAttentionFreshness = 'digest-only'
    let previewItems: readonly AttentionItem[] = []
    if (totalActive === 0) {
      freshness = 'digest-cleared'
      previewItems = []
    } else if (cachedItems.length > 0 && cachedSnapshot?.digest?.revision === digest.revision) {
      freshness = 'digest-match'
      previewItems = cachedItems
    } else if (cachedItems.length > 0) {
      freshness = 'digest-stale'
      previewItems = cachedItems
    }

    return {
      deviceId: device.deviceId,
      isConnectedHost: false,
      pendingApprovals,
      pendingQuestions,
      runningSessions,
      completedUnread,
      failedUnread: 0,
      totalUrgent,
      totalActive,
      hasFailedSignal: digest.urgentKind === 'turn_failed',
      freshness,
      syncedAt: cachedSnapshot?.syncedAt,
      items: previewItems,
    }
  }

  if (cachedItems.length > 0) {
    const cachedCounts = selectAttentionCounts(cachedItems)
    return {
      deviceId: device.deviceId,
      isConnectedHost: false,
      ...cachedCounts,
      hasFailedSignal: cachedCounts.failedUnread > 0,
      freshness: device.online ? 'digest-stale' : 'offline-cache',
      syncedAt: cachedSnapshot?.syncedAt,
      items: cachedItems,
    }
  }

  return {
    deviceId: device.deviceId,
    isConnectedHost: false,
    pendingApprovals: 0,
    pendingQuestions: 0,
    runningSessions: 0,
    completedUnread: 0,
    failedUnread: 0,
    totalUrgent: 0,
    totalActive: 0,
    hasFailedSignal: false,
    freshness: 'none',
    syncedAt: cachedSnapshot?.syncedAt,
    items: [],
  }
}

/**
 * Aggregates connected-host live counts with other online trusted hosts'
 * blind `attentionDigest` counts (avoiding double-counting the connected host).
 */
export function selectCrossHostAttentionCounts(params: {
  devices: readonly Pick<RemoteDevice, 'deviceId' | 'online' | 'trusted' | 'attentionDigest'>[]
  connectedHostId?: string
  activeItems: readonly AttentionItem[]
}): CrossHostAttentionCounts {
  const base = selectAttentionCounts(params.activeItems)
  let otherApprovals = 0
  let otherQuestions = 0
  let otherRunning = 0
  let otherCompleted = 0

  for (const device of params.devices) {
    if (device.deviceId === params.connectedHostId || !device.trusted || !device.online) continue
    const digest = device.attentionDigest
    if (digest === undefined) continue
    otherApprovals += Math.max(0, digest.pendingApprovals)
    otherQuestions += Math.max(0, digest.pendingQuestions)
    otherRunning += Math.max(0, digest.runningSessions)
    otherCompleted += Math.max(0, digest.completedUnread)
  }

  const otherHostsUrgent = otherApprovals + otherQuestions
  const otherHostsActive = otherHostsUrgent + otherRunning + otherCompleted
  return {
    pendingApprovals: base.pendingApprovals + otherApprovals,
    pendingQuestions: base.pendingQuestions + otherQuestions,
    runningSessions: base.runningSessions + otherRunning,
    completedUnread: base.completedUnread + otherCompleted,
    failedUnread: base.failedUnread,
    totalUrgent: base.totalUrgent + otherHostsUrgent,
    totalActive: base.totalActive + otherHostsActive,
    otherHostsUrgent,
    otherHostsActive,
  }
}

/** Derives a zero-plaintext `AttentionDigest` from an item list (used for legacy fallback & local ack updates). */
export function deriveAttentionDigest(
  items: readonly AttentionItem[],
  revision: number,
  now = Date.now(),
): AttentionDigest {
  const counts = selectAttentionCounts(items)
  let urgentKind: AttentionUrgentKind | null = null
  let urgency: AttentionUrgency = 'silent'

  if (counts.pendingApprovals > 0) {
    urgentKind = 'approval_needed'
    urgency = 'critical'
  } else if (counts.pendingQuestions > 0) {
    urgentKind = 'question_needed'
    urgency = 'critical'
  } else if (counts.failedUnread > 0) {
    urgentKind = 'turn_failed'
    urgency = 'normal'
  } else if (counts.completedUnread > 0) {
    urgentKind = 'turn_completed'
    urgency = 'normal'
  } else if (counts.runningSessions === 0) {
    urgentKind = 'clear'
    urgency = 'silent'
  }

  return {
    revision: Math.max(0, Math.floor(revision)),
    pendingApprovals: capCount(counts.pendingApprovals),
    pendingQuestions: capCount(counts.pendingQuestions),
    runningSessions: capCount(counts.runningSessions),
    completedUnread: capCount(counts.completedUnread + counts.failedUnread),
    urgentKind,
    urgency,
    updatedAt: Math.max(0, Math.floor(now)),
  }
}

function validBotTitle(name: string | undefined, ...sessionIds: ReadonlyArray<string | undefined>): string | undefined {
  if (typeof name !== 'string') return undefined
  const trimmed = name.trim()
  if (trimmed.length === 0) return undefined
  for (const id of sessionIds) {
    if (id !== undefined && isBareSessionId(trimmed, id)) return undefined
  }
  return trimmed.slice(0, MAX_ATTENTION_TITLE_CHARS)
}

function botSessionTitle(botState: BotState, sessionId: string, botId?: string, roomId?: string): string {
  if (roomId) {
    const room = botState.rooms.find(r => r.id === roomId)
    const title = validBotTitle(room?.name, sessionId, room?.sessionId)
    if (title !== undefined) return title
  }
  if (botId) {
    const bot = botState.bots.find(b => b.id === botId)
    const title = validBotTitle(bot?.name, sessionId, bot?.sessionId)
    if (title !== undefined) return title
  }
  const matchedRoom = botState.rooms.find(
    r => r.sessionId === sessionId || r.parts?.includes(sessionId) || r.ownParts?.includes(sessionId),
  )
  const matchedRoomTitle = validBotTitle(matchedRoom?.name, sessionId, matchedRoom?.sessionId)
  if (matchedRoomTitle !== undefined) return matchedRoomTitle
  const matchedBot = botState.bots.find(
    b => b.sessionId === sessionId || b.parts?.includes(sessionId),
  )
  const matchedBotTitle = validBotTitle(matchedBot?.name, sessionId, matchedBot?.sessionId)
  if (matchedBotTitle !== undefined) return matchedBotTitle
  return 'DS-Bot'
}

function botSessionPreview(botState: BotState, sessionId: string): string | undefined {
  const matchedRoom = botState.rooms.find(
    r => r.sessionId === sessionId || r.parts?.includes(sessionId) || r.ownParts?.includes(sessionId),
  )
  const matchedBot = botState.bots.find(
    b => b.sessionId === sessionId || b.parts?.includes(sessionId),
  )
  return trimSnippet(matchedRoom?.preview || matchedBot?.preview, MAX_ATTENTION_SUMMARY_CHARS)
}

function collectBotSessionIds(botState: BotState | undefined): Set<string> {
  const ids = new Set<string>()
  if (!botState) return ids
  for (const bot of botState.bots) {
    if (bot.sessionId) ids.add(bot.sessionId)
    for (const part of bot.parts ?? []) ids.add(part)
  }
  for (const room of botState.rooms) {
    if (room.sessionId) ids.add(room.sessionId)
    for (const part of room.parts ?? []) ids.add(part)
    for (const part of room.ownParts ?? []) ids.add(part)
  }
  for (const agent of botState.agents) {
    for (const sid of agent.sessions ?? []) ids.add(sid)
  }
  return ids
}

function extractBotTimestamp(entry: BotObject, fallback: number): number {
  const raw = entry.updatedAt ?? entry.createdAt ?? entry.time ?? entry.timestamp
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : fallback
}

function isTruthyWorkEntry(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') return value.trim().length > 0 && value !== 'idle' && value !== 'done'
  if (isRecord(value)) {
    if (value.running === true || value.active === true || value.busy === true) return true
    if (typeof value.status === 'string' && !['idle', 'done', 'completed', 'stopped', 'failed'].includes(value.status)) {
      return true
    }
    return Object.keys(value).length > 0 && value.running !== false && value.active !== false
  }
  return false
}

/**
 * Graceful legacy Host fallback: derives `AttentionItem[]` locally from `useAppStore`
 * sessions/messages/lifecycles and `useBotTeamStore` approvals/questions/work when
 * connected to an older Host without `attention.inbox.v1`.
 */
export function deriveLegacyAttentionItems(sources: LegacyAttentionSources): AttentionItem[] {
  const now = sources.now ?? Date.now()
  const acked = sources.ackedIds instanceof Set
    ? sources.ackedIds
    : new Set<string>(sources.ackedIds ?? [])
  const completedSessionIds = sources.completedSessionIds ?? new Set<string>()
  const sessions = sources.sessions ?? []
  const lifecycles = sources.sessionLifecycles ?? {}
  const messagesMap = sources.messages ?? {}
  const workspaces = sources.workspaces ?? []
  const botState = sources.botState

  const workspaceBySession = new Map<string, WorkspaceView>()
  for (const ws of workspaces) {
    for (const sid of ws.sessionIds ?? []) {
      workspaceBySession.set(sid, ws)
    }
  }

  const botSessionIds = collectBotSessionIds(botState)
  const itemsById = new Map<string, AttentionItem>()
  const coveredBotSessions = new Set<string>()

  // 1. DS-Bot approvals, questions, and active work
  if (botState !== undefined) {
    for (const approval of botState.approvals ?? []) {
      if (!isRecord(approval)) continue
      if (approval.resolved === true || approval.answerable === false) continue
      const statusStr = typeof approval.status === 'string' ? approval.status : undefined
      if (statusStr === 'resolved' || statusStr === 'approved' || statusStr === 'rejected' || statusStr === 'cancelled') {
        continue
      }
      const roomId = typeof approval.roomId === 'string' && approval.roomId.length > 0 ? approval.roomId : undefined
      const botId = typeof approval.botId === 'string' && approval.botId.length > 0 ? approval.botId : undefined
      const matchedRoom = roomId ? botState.rooms.find(r => r.id === roomId) : undefined
      const matchedBot = botId ? botState.bots.find(b => b.id === botId) : undefined
      const sessionId = (typeof approval.sessionId === 'string' && approval.sessionId.length > 0)
        ? approval.sessionId
        : (matchedRoom?.sessionId ?? matchedBot?.sessionId)
      if (!sessionId) continue
      const approvalKey = typeof approval.id === 'string' && approval.id.length > 0 ? approval.id : sessionId
      const id = `legacy:bot:approval:${approvalKey}`
      const summary = trimSnippet(
        approval.summary ?? approval.reason ?? approval.title ?? approval.toolName ?? approval.tool,
        MAX_ATTENTION_SUMMARY_CHARS,
      )
      itemsById.set(id, {
        id,
        backend: 'ds-bot',
        mode: 'bot',
        sessionId,
        sessionTitle: botSessionTitle(botState, sessionId, botId, roomId),
        status: 'waiting_approval',
        ...(summary !== undefined ? { summary } : {}),
        updatedAt: extractBotTimestamp(approval, now),
      })
      coveredBotSessions.add(sessionId)
    }

    if (isRecord(botState.questions)) {
      for (const [key, rawQuestion] of Object.entries(botState.questions)) {
        if (!isRecord(rawQuestion) || Object.keys(rawQuestion).length === 0) continue
        if (rawQuestion.answered === true || rawQuestion.dismissed === true || rawQuestion.resolved === true) continue
        const matchedBot = botState.bots.find(b => b.id === key || b.sessionId === key || b.parts?.includes(key))
        const matchedRoom = botState.rooms.find(r => r.id === key || r.sessionId === key || r.parts?.includes(key))
        const sessionId = (typeof rawQuestion.sessionId === 'string' && rawQuestion.sessionId.length > 0)
          ? rawQuestion.sessionId
          : (matchedRoom?.sessionId ?? matchedBot?.sessionId ?? key)
        if (!sessionId) continue
        const qId = typeof rawQuestion.id === 'string' && rawQuestion.id.length > 0 ? rawQuestion.id : key
        const id = `legacy:bot:question:${qId}`
        const summary = trimSnippet(
          rawQuestion.question ?? rawQuestion.prompt ?? rawQuestion.title ?? rawQuestion.text,
          MAX_ATTENTION_SUMMARY_CHARS,
        )
        itemsById.set(id, {
          id,
          backend: 'ds-bot',
          mode: 'bot',
          sessionId,
          sessionTitle: botSessionTitle(botState, sessionId, matchedBot?.id, matchedRoom?.id),
          status: 'waiting_question',
          ...(summary !== undefined ? { summary } : {}),
          updatedAt: extractBotTimestamp(rawQuestion, now),
        })
        coveredBotSessions.add(sessionId)
      }
    }

    const work = botState.work
    if (isRecord(work)) {
      if (isRecord(work.bots)) {
        for (const [botId, entry] of Object.entries(work.bots)) {
          if (!isTruthyWorkEntry(entry)) continue
          const bot = botState.bots.find(b => b.id === botId)
          const sessionId = bot?.sessionId
          if (!sessionId || coveredBotSessions.has(sessionId)) continue
          const id = `legacy:bot:running:${sessionId}`
          const preview = trimSnippet(bot?.preview, MAX_ATTENTION_SUMMARY_CHARS)
          itemsById.set(id, {
            id,
            backend: 'ds-bot',
            mode: 'bot',
            sessionId,
            sessionTitle: validBotTitle(bot?.name, sessionId) ?? 'DS-Bot',
            status: 'running',
            ...(preview !== undefined ? { summary: preview } : {}),
            updatedAt: isRecord(entry) ? extractBotTimestamp(entry, now) : now,
          })
          coveredBotSessions.add(sessionId)
        }
      }
      if (isRecord(work.rooms)) {
        for (const [roomId, entry] of Object.entries(work.rooms)) {
          if (!isTruthyWorkEntry(entry)) continue
          const room = botState.rooms.find(r => r.id === roomId)
          const sessionId = room?.sessionId
          if (!sessionId || coveredBotSessions.has(sessionId)) continue
          const id = `legacy:bot:running:${sessionId}`
          const preview = trimSnippet(room?.preview, MAX_ATTENTION_SUMMARY_CHARS)
          itemsById.set(id, {
            id,
            backend: 'ds-bot',
            mode: 'bot',
            sessionId,
            sessionTitle: validBotTitle(room?.name, sessionId) ?? 'DS-Bot',
            status: 'running',
            ...(preview !== undefined ? { summary: preview } : {}),
            updatedAt: isRecord(entry) ? extractBotTimestamp(entry, now) : now,
          })
          coveredBotSessions.add(sessionId)
        }
      }
    }
  }

  // 2. Harness / Codex / ACP sessions from useAppStore
  for (const session of sessions) {
    if (!session || typeof session.sessionId !== 'string' || session.sessionId.length === 0) continue
    if (botSessionIds.has(session.sessionId) && coveredBotSessions.has(session.sessionId)) continue

    const lifecycle = lifecycles[session.sessionId]
    const sessionMessages = messagesMap[session.sessionId] ?? []
    const isBotSession = botSessionIds.has(session.sessionId) || session.backend === 'ds-bot'
    const workspace = workspaceBySession.get(session.sessionId)
    const mapped = isBotSession
      ? { backend: 'ds-bot' as AttentionBackend }
      : mapSessionBackend(session.backend)
    const mode = isBotSession ? 'bot' as const : 'agent' as const
    const resolvedTitle = resolveSessionDisplayTitle(
      session,
      sources.handoffOrigins?.[session.sessionId],
      sessionMessages,
    )
    const title = (resolvedTitle !== undefined && resolvedTitle.trim().length > 0 && !isBareSessionId(resolvedTitle, session.sessionId)
      ? resolvedTitle.trim()
      : (isBotSession && botState ? botSessionTitle(botState, session.sessionId) : attentionFallbackTitle({ backend: mapped.backend, mode }))
    ).slice(0, MAX_ATTENTION_TITLE_CHARS)
    const botSummary = isBotSession && botState ? botSessionPreview(botState, session.sessionId) : undefined
    const updatedAt = typeof session.updatedAt === 'number' && Number.isSafeInteger(session.updatedAt) && session.updatedAt > 0
      ? session.updatedAt
      : now

    const pendingQuestion = sessionMessages.find(isPendingChatQuestion)
    const pendingApproval = sessionMessages.find(item => isPendingChatApproval(session, item))
    const active = Boolean(lifecycle?.running ?? session.running)

    let status: AttentionStatus | undefined
    let itemId = `legacy:${mapped.backend}:${session.sessionId}`
    let summary: string | undefined

    if (pendingQuestion !== undefined && pendingQuestion.kind === 'question') {
      status = 'waiting_question'
      itemId = `legacy:question:${session.sessionId}:${pendingQuestion.id}`
      summary = trimSnippet(pendingQuestion.questions?.[0]?.question, MAX_ATTENTION_SUMMARY_CHARS)
    } else if (pendingApproval !== undefined && pendingApproval.kind === 'approval') {
      status = 'waiting_approval'
      itemId = `legacy:approval:${session.sessionId}:${pendingApproval.id}`
      summary = trimSnippet(pendingApproval.reason ?? pendingApproval.toolName, MAX_ATTENTION_SUMMARY_CHARS)
    } else if (active) {
      status = 'running'
      itemId = `legacy:running:${session.sessionId}`
      summary = latestAssistantSnippet(sessionMessages) ?? botSummary
    } else if (lifecycle?.finished === 'failed') {
      itemId = `legacy:failed:${session.sessionId}`
      if (!acked.has(itemId)) {
        status = 'failed_unread'
        summary = latestAssistantSnippet(sessionMessages) ?? botSummary
      }
    } else if (lifecycle?.finished === 'completed' || completedSessionIds.has(session.sessionId)) {
      itemId = `legacy:completed:${session.sessionId}`
      if (!acked.has(itemId)) {
        status = 'completed_unread'
        summary = latestAssistantSnippet(sessionMessages) ?? botSummary
      }
    }

    if (status === undefined) continue
    itemsById.set(itemId, {
      id: itemId,
      backend: mapped.backend,
      ...(mapped.acpAdapter !== undefined ? { acpAdapter: mapped.acpAdapter } : {}),
      mode,
      ...(workspace?.workspaceId ? { workspaceId: workspace.workspaceId } : {}),
      ...(workspace?.title ? { workspaceLabel: workspace.title.slice(0, MAX_ATTENTION_TITLE_CHARS) } : {}),
      sessionId: session.sessionId,
      sessionTitle: title,
      status,
      ...(summary !== undefined ? { summary } : {}),
      updatedAt,
    })
  }

  const items = [...itemsById.values()].sort(compareAttentionItems)
  return items.length > MAX_ATTENTION_ITEMS ? items.slice(0, MAX_ATTENTION_ITEMS) : items
}

function itemsEqual(a: readonly AttentionItem[], b: readonly AttentionItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!
    const right = b[i]!
    if (
      left.id !== right.id
      || left.status !== right.status
      || left.sessionId !== right.sessionId
      || left.sessionTitle !== right.sessionTitle
      || left.summary !== right.summary
      || left.updatedAt !== right.updatedAt
      || left.detachedExpiresAt !== right.detachedExpiresAt
      || left.backend !== right.backend
      || left.acpAdapter !== right.acpAdapter
      || left.mode !== right.mode
    ) {
      return false
    }
  }
  return true
}

function stopActiveSubscription(notifyRemote: boolean): Promise<void> {
  const sub = activeSubscription
  activeSubscription = undefined
  const abort = activeAbort
  activeAbort = undefined
  abort?.abort()
  if (sub === undefined || !notifyRemote) return Promise.resolve()
  return sub.stop().catch(() => undefined)
}

function withHostCache(
  current: Readonly<Record<string, HostAttentionSnapshot>>,
  snapshot: HostAttentionSnapshot,
): Record<string, HostAttentionSnapshot> {
  const next: Record<string, HostAttentionSnapshot> = {
    ...current,
    [snapshot.hostId]: snapshot,
  }
  const entries = Object.entries(next)
  if (entries.length <= MAX_CACHED_HOSTS) return next
  entries.sort((a, b) => b[1].syncedAt - a[1].syncedAt)
  return Object.fromEntries(entries.slice(0, MAX_CACHED_HOSTS))
}

export const useAttentionStore = create<AttentionStoreState>((set, get) => ({
  hostId: undefined,
  connectionGeneration: 0,
  items: [],
  digest: null,
  revision: 0,
  supported: false,
  loading: false,
  inboxOpen: false,
  localAckedIds: [],
  cachedByHost: {},

  setInboxOpen(open: boolean) {
    set({ inboxOpen: open })
  },

  async attachConnection({
    hostId,
    generation,
    advertisedSupported,
    client,
    probeIfUnadvertised = true,
  }) {
    await stopActiveSubscription(false)
    activeGeneration = generation
    activeClient = client

    const sameHost = get().hostId === hostId
    const shouldTryFollow = client !== undefined && (advertisedSupported || probeIfUnadvertised)

    set({
      hostId,
      connectionGeneration: generation,
      items: sameHost ? get().items : [],
      digest: sameHost ? get().digest : null,
      revision: 0,
      supported: advertisedSupported && client !== undefined,
      loading: shouldTryFollow,
      ...(sameHost ? {} : { localAckedIds: [] }),
    })

    if (!shouldTryFollow || client === undefined) {
      set({ supported: false, loading: false })
      return
    }

    const abort = new AbortController()
    activeAbort = abort

    const attachTask = (async () => {
      try {
        const subscription = await client.follow(
          {
            onEvent: event => {
              if (generation !== activeGeneration) return
              set(current => {
                if (current.connectionGeneration !== generation) return current
                const next = applyAttentionFollowEvent(
                  {
                    revision: current.revision,
                    digest: current.digest,
                    items: current.items,
                  },
                  event,
                )
                const cleanItems = sanitizeAttentionItems(next.items)
                return {
                  revision: next.revision,
                  digest: next.digest,
                  items: cleanItems,
                  supported: true,
                  loading: false,
                  cachedByHost: withHostCache(current.cachedByHost, {
                    hostId,
                    items: cleanItems,
                    digest: next.digest,
                    revision: next.revision,
                    supported: true,
                    syncedAt: Date.now(),
                  }),
                }
              })
            },
            onError: () => {
              // Keep last validated snapshot; never throw into transport receive path.
            },
          },
          {
            signal: abort.signal,
            ...(advertisedSupported ? {} : { timeoutMs: PROBE_FOLLOW_TIMEOUT_MS }),
          },
        )

        if (generation !== activeGeneration || abort.signal.aborted) {
          await subscription.stop().catch(() => undefined)
          return
        }

        activeSubscription = subscription
        const initialState = applyAttentionFollowEvent(createEmptyAttentionInboxState(), {
          type: 'snapshot',
          revision: subscription.initial.revision,
          digest: subscription.initial.digest,
          items: subscription.initial.items,
        })
        const cleanInitialItems = sanitizeAttentionItems(initialState.items)

        set(current => ({
          hostId,
          connectionGeneration: generation,
          revision: initialState.revision,
          digest: initialState.digest,
          items: cleanInitialItems,
          supported: true,
          loading: false,
          cachedByHost: withHostCache(current.cachedByHost, {
            hostId,
            items: cleanInitialItems,
            digest: initialState.digest,
            revision: initialState.revision,
            supported: true,
            syncedAt: Date.now(),
          }),
        }))
      } catch {
        if (generation !== activeGeneration) return
        if (activeAbort === abort) activeAbort = undefined
        set({
          supported: false,
          loading: false,
        })
      }
    })()

    activeAttachPromise = attachTask
    try {
      await attachTask
    } finally {
      if (activeAttachPromise === attachTask) activeAttachPromise = undefined
    }
  },

  async detachConnection(generation?: number) {
    if (generation !== undefined && generation !== activeGeneration) return
    activeGeneration += 1
    activeClient = undefined
    activeAttachPromise = undefined
    set({
      hostId: undefined,
      connectionGeneration: activeGeneration,
      items: [],
      digest: null,
      revision: 0,
      supported: false,
      loading: false,
      localAckedIds: [],
    })
    await stopActiveSubscription(false)
  },

  syncLegacyFallback(sources: LegacyAttentionSources) {
    const state = get()
    if (state.supported || state.loading) return
    const ackedSet = new Set<string>(state.localAckedIds)
    if (sources.ackedIds !== undefined) {
      for (const id of sources.ackedIds) ackedSet.add(id)
    }
    const nextItems = deriveLegacyAttentionItems({
      ...sources,
      ackedIds: ackedSet,
    })
    if (itemsEqual(state.items, nextItems) && state.digest !== null) return
    const nextRevision = state.revision + 1
    const nextDigest = deriveAttentionDigest(nextItems, nextRevision, sources.now)
    set(current => ({
      items: nextItems,
      digest: nextDigest,
      revision: nextRevision,
      ...(current.hostId !== undefined
        ? {
            cachedByHost: withHostCache(current.cachedByHost, {
              hostId: current.hostId,
              items: nextItems,
              digest: nextDigest,
              revision: nextRevision,
              supported: false,
              syncedAt: sources.now ?? Date.now(),
            }),
          }
        : {}),
    }))
  },

  async ackUnread(itemIds: readonly string[]) {
    const ids = [...new Set(itemIds.filter(id => typeof id === 'string' && id.length > 0))]
    if (ids.length === 0) return

    const idSet = new Set(ids)
    const generation = activeGeneration
    const client = activeClient
    const supported = get().supported

    set(current => {
      const nextAcked = [...new Set([...current.localAckedIds, ...ids])]
      const nextItems = current.items.filter(
        item => !(idSet.has(item.id) && UNREAD_STATUSES.has(item.status)),
      )
      const nextRevision = current.revision
      const nextDigest = current.digest === null
        ? null
        : {
            ...deriveAttentionDigest(nextItems, nextRevision),
            ...(current.digest.attentionToken !== undefined && nextItems.length > 0
              ? { attentionToken: current.digest.attentionToken }
              : {}),
          }
      return {
        localAckedIds: nextAcked,
        items: nextItems,
        digest: nextDigest,
        ...(current.hostId !== undefined
          ? {
              cachedByHost: withHostCache(current.cachedByHost, {
                hostId: current.hostId,
                items: nextItems,
                digest: nextDigest,
                revision: nextRevision,
                supported: current.supported,
                syncedAt: Date.now(),
              }),
            }
          : {}),
      }
    })

    if (supported && client !== undefined) {
      try {
        const result = await client.ackUnread(ids)
        if (generation !== activeGeneration) return
        set(current => (
          current.connectionGeneration === generation && result.revision > current.revision
            ? { revision: result.revision }
            : current
        ))
      } catch {
        // Optimistic local ack already cleared unread items; server snapshot will reconcile.
      }
    }
  },

  async ackAllUnread() {
    const unreadIds = get().items
      .filter(item => UNREAD_STATUSES.has(item.status))
      .map(item => item.id)
    if (unreadIds.length === 0) return
    await get().ackUnread(unreadIds)
  },

  async resolveToken(token: string): Promise<AttentionTarget> {
    const parsed = attentionTokenSchema.safeParse(token)
    if (!parsed.success) return { kind: 'inbox' }
    if (activeAttachPromise !== undefined) {
      await activeAttachPromise.catch(() => undefined)
    }
    const state = get()
    const generation = activeGeneration
    const client = activeClient
    if (!state.supported || client === undefined) return { kind: 'inbox' }
    try {
      const target = await client.resolveToken(parsed.data)
      if (generation !== activeGeneration) return { kind: 'inbox' }
      return target
    } catch {
      return { kind: 'inbox' }
    }
  },

  evictHost(hostId: string) {
    set(current => {
      if (!(hostId in current.cachedByHost)) return current
      const next = { ...current.cachedByHost }
      delete next[hostId]
      return { cachedByHost: next }
    })
  },

  reset() {
    activeGeneration += 1
    activeClient = undefined
    activeAttachPromise = undefined
    void stopActiveSubscription(false)
    set({
      hostId: undefined,
      connectionGeneration: 0,
      items: [],
      digest: null,
      revision: 0,
      supported: false,
      loading: false,
      inboxOpen: false,
      localAckedIds: [],
      cachedByHost: {},
    })
  },
}))
