import { z } from 'zod'

export const ATTENTION_SIGNAL_CAPABILITY = 'attention.signal.v1' as const
export const ATTENTION_INBOX_CAPABILITY = 'attention.inbox.v1' as const
export const PUSH_WAKE_CAPABILITY = 'push.wake.v1' as const

/** 128-bit random lowercase hex opaque token; strictly never a sessionId or free text. */
export const ATTENTION_TOKEN_PATTERN = /^[a-f0-9]{32}$/

export const MAX_ATTENTION_COUNT = 99
export const MAX_ATTENTION_ITEMS = 64
export const MAX_ATTENTION_SUMMARY_CHARS = 120
export const MAX_ATTENTION_TITLE_CHARS = 160

export const attentionRpcMethods = [
  'attention.list',
  'attention.follow',
  'attention.unfollow',
  'attention.resolveToken',
  'attention.ackUnread',
] as const

export const attentionUrgentKinds = [
  'approval_needed',
  'question_needed',
  'turn_completed',
  'turn_failed',
  'clear',
] as const
export type AttentionUrgentKind = typeof attentionUrgentKinds[number]

export const attentionUrgencies = ['critical', 'normal', 'silent'] as const
export type AttentionUrgency = typeof attentionUrgencies[number]

/**
 * Zero-plaintext attention summary permitted on the Control WebSocket,
 * `/api/v1/devices`, `/presence`, optional blind webhooks, and APNs/FCM wake payloads.
 */
export interface AttentionDigest {
  revision: number
  pendingApprovals: number
  pendingQuestions: number
  runningSessions: number
  completedUnread: number
  urgentKind: AttentionUrgentKind | null
  urgency: AttentionUrgency
  attentionToken?: string
  updatedAt: number
}

export interface HostAttentionSignalPayload {
  digest: AttentionDigest
}

const attentionCountSchema = z.number().int().min(0).max(MAX_ATTENTION_COUNT)
const nonNegativeSafeIntSchema = z.number().int().min(0).safe()
export const attentionTokenSchema = z.string().regex(ATTENTION_TOKEN_PATTERN)

/** Strict zero-plaintext schema: any extra/plaintext field fails closed. */
export const attentionDigestSchema: z.ZodType<AttentionDigest> = z.object({
  revision: nonNegativeSafeIntSchema,
  pendingApprovals: attentionCountSchema,
  pendingQuestions: attentionCountSchema,
  runningSessions: attentionCountSchema,
  completedUnread: attentionCountSchema,
  urgentKind: z.enum(attentionUrgentKinds).nullable(),
  urgency: z.enum(attentionUrgencies),
  attentionToken: attentionTokenSchema.optional(),
  updatedAt: nonNegativeSafeIntSchema,
}).strict()

export const hostAttentionSignalPayloadSchema: z.ZodType<HostAttentionSignalPayload> = z.object({
  digest: attentionDigestSchema,
}).strict()

// ────────────────────────────────────────────────────────────────────────────
// Encrypted-tunnel-only Attention Inbox contracts (NEVER sent on Control WS)
// ────────────────────────────────────────────────────────────────────────────

export const attentionBackends = ['harness', 'codex', 'acp', 'ds-bot'] as const
export type AttentionBackend = typeof attentionBackends[number]

export const attentionStatuses = [
  'waiting_approval',
  'waiting_question',
  'running',
  'failed_unread',
  'completed_unread',
] as const
export type AttentionStatus = typeof attentionStatuses[number]

export const attentionModes = ['agent', 'bot'] as const
export type AttentionMode = typeof attentionModes[number]

export interface AttentionItem {
  id: string
  backend: AttentionBackend
  acpAdapter?: string
  mode: AttentionMode
  workspaceId?: string
  workspaceLabel?: string
  sessionId: string
  sessionTitle: string
  status: AttentionStatus
  summary?: string
  detachedExpiresAt?: number
  updatedAt: number
}

export interface AttentionListResult {
  revision: number
  digest: AttentionDigest
  items: AttentionItem[]
}

export type AttentionFollowEvent =
  | { type: 'snapshot'; revision: number; digest: AttentionDigest; items: AttentionItem[] }
  | { type: 'upsert'; revision: number; digest: AttentionDigest; item: AttentionItem }
  | { type: 'remove'; revision: number; digest: AttentionDigest; itemId: string }

export type AttentionTarget =
  | {
      kind: 'session'
      backend: AttentionBackend
      acpAdapter?: string
      mode: AttentionMode
      workspaceId?: string
      sessionId: string
      itemId?: string
    }
  | { kind: 'inbox' }

export interface AttentionFollowRequest {
  enabled?: boolean
}

export interface AttentionAckUnreadRequest {
  itemIds: string[]
}

export interface AttentionAckUnreadResult {
  ok: true
  revision: number
}

export interface AttentionResolveTokenRequest {
  token: string
}

export const attentionItemSchema: z.ZodType<AttentionItem> = z.object({
  id: z.string().min(1).max(256),
  backend: z.enum(attentionBackends),
  acpAdapter: z.string().min(1).max(64).optional(),
  mode: z.enum(attentionModes),
  workspaceId: z.string().min(1).max(256).optional(),
  workspaceLabel: z.string().max(MAX_ATTENTION_TITLE_CHARS).optional(),
  sessionId: z.string().min(1).max(256),
  sessionTitle: z.string().max(MAX_ATTENTION_TITLE_CHARS),
  status: z.enum(attentionStatuses),
  summary: z.string().max(MAX_ATTENTION_SUMMARY_CHARS).optional(),
  detachedExpiresAt: nonNegativeSafeIntSchema.optional(),
  updatedAt: nonNegativeSafeIntSchema,
}).strict()

const attentionItemListSchema = z.array(attentionItemSchema).max(MAX_ATTENTION_ITEMS)

export const attentionListResultSchema: z.ZodType<AttentionListResult> = z.object({
  revision: nonNegativeSafeIntSchema,
  digest: attentionDigestSchema,
  items: attentionItemListSchema,
}).strict()

export const attentionFollowEventSchema: z.ZodType<AttentionFollowEvent> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    revision: nonNegativeSafeIntSchema,
    digest: attentionDigestSchema,
    items: attentionItemListSchema,
  }).strict(),
  z.object({
    type: z.literal('upsert'),
    revision: nonNegativeSafeIntSchema,
    digest: attentionDigestSchema,
    item: attentionItemSchema,
  }).strict(),
  z.object({
    type: z.literal('remove'),
    revision: nonNegativeSafeIntSchema,
    digest: attentionDigestSchema,
    itemId: z.string().min(1).max(256),
  }).strict(),
])

export const attentionTargetSchema: z.ZodType<AttentionTarget> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session'),
    backend: z.enum(attentionBackends),
    acpAdapter: z.string().min(1).max(64).optional(),
    mode: z.enum(attentionModes),
    workspaceId: z.string().min(1).max(256).optional(),
    sessionId: z.string().min(1).max(256),
    itemId: z.string().min(1).max(256).optional(),
  }).strict(),
  z.object({
    kind: z.literal('inbox'),
  }).strict(),
])

export const attentionFollowRequestSchema: z.ZodType<AttentionFollowRequest> = z.object({
  enabled: z.boolean().optional(),
}).strict()

export const attentionResolveTokenRequestSchema: z.ZodType<AttentionResolveTokenRequest> = z.object({
  token: attentionTokenSchema,
}).strict()

export const attentionAckUnreadRequestSchema: z.ZodType<AttentionAckUnreadRequest> = z.object({
  itemIds: z.array(z.string().min(1).max(256)).max(MAX_ATTENTION_ITEMS),
}).strict()

export const attentionAckUnreadResultSchema: z.ZodType<AttentionAckUnreadResult> = z.object({
  ok: z.literal(true),
  revision: nonNegativeSafeIntSchema,
}).strict()

const ATTENTION_STATUS_PRIORITY: Record<AttentionStatus, number> = {
  waiting_question: 0,
  waiting_approval: 1,
  running: 2,
  failed_unread: 3,
  completed_unread: 4,
}

/**
 * Deterministic priority comparator:
 * waiting_question (0) > waiting_approval (1) > running (2) > failed_unread (3) > completed_unread (4),
 * then updatedAt descending, then id lexical ascending.
 */
export function compareAttentionItems(
  a: Pick<AttentionItem, 'status' | 'updatedAt' | 'id'>,
  b: Pick<AttentionItem, 'status' | 'updatedAt' | 'id'>,
): number {
  const priorityDiff = ATTENTION_STATUS_PRIORITY[a.status] - ATTENTION_STATUS_PRIORITY[b.status]
  if (priorityDiff !== 0) return priorityDiff
  const updatedDiff = b.updatedAt - a.updatedAt
  if (updatedDiff !== 0) return updatedDiff
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

// ────────────────────────────────────────────────────────────────────────────
// Hosted Server Push Wake REST contracts (`push.wake.v1`)
// ────────────────────────────────────────────────────────────────────────────

export const pushTargetPlatforms = ['ios', 'android'] as const
export type PushTargetPlatform = typeof pushTargetPlatforms[number]

export const pushEnvironments = ['production', 'sandbox'] as const
export type PushEnvironment = typeof pushEnvironments[number]

export interface PushTargetRegistrationRequest {
  platform: PushTargetPlatform
  pushToken: string
  environment?: PushEnvironment
  appId?: string
  locale?: string
}

export interface LiveActivityTokenRegistrationRequest {
  activityPushToken: string
  pushToStartToken?: string
  environment?: PushEnvironment
  activityId?: string
}

export const pushTargetRegistrationRequestSchema: z.ZodType<PushTargetRegistrationRequest> = z.object({
  platform: z.enum(pushTargetPlatforms),
  pushToken: z.string().min(1).max(4096),
  environment: z.enum(pushEnvironments).optional(),
  appId: z.string().min(1).max(128).optional(),
  locale: z.string().min(2).max(32).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
}).strict()

export const liveActivityTokenRegistrationRequestSchema: z.ZodType<LiveActivityTokenRegistrationRequest> = z.object({
  activityPushToken: z.string().min(1).max(4096),
  pushToStartToken: z.string().min(1).max(4096).optional(),
  environment: z.enum(pushEnvironments).optional(),
  activityId: z.string().min(1).max(128).optional(),
}).strict()
