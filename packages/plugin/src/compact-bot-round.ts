/**
 * ds-bot group rounds are conversation content, not tool diagnostics: one
 * `JSON.stringify({ replies, passed, failed? })` tool result carries every
 * Bot's spoken reply for the round. The generic compact projection would cut
 * that at 512 characters, which loses whole replies — the client can only
 * recover entries that close before the cut, so one long reply hides the
 * entire round and the conversation collapses into tool activity.
 *
 * Keeping the recognised shape as a bounded structural projection preserves the
 * reply contract while the frame stays small. This module is shape-only on
 * purpose: it whitelists primitive/bounded fields and never interprets `kind`,
 * so the client remains the semantic authority for reply presentation.
 */
const HEADER = '{"replies"'
const SAVE_TOKEN_SUFFIX_RE = /\n\n\[save-token #[\s\S]*$/u

const LIMITS = Object.freeze({
  /** How far into the detail the payload header may appear. */
  scan: 4096,
  /** Never attempt structural work on an absurdly large detail. */
  source: 1024 * 1024,
  /** Replies kept per round, in their original order. */
  entries: 32,
  /** Spoken text kept per reply. */
  text: 2048,
  /** Identifier/label fields kept per reply. */
  label: 256,
  /** Array items kept for names/claims/presented fields. */
  arrayItems: 16,
  presentedItems: 8,
  claimsItems: 8,
  /** Serialized projection ceiling for one round. */
  payload: 8 * 1024,
})

export const COMPACT_BOT_ROUND_LIMITS = LIMITS

/** Primitive fields a reply entry may carry. */
const STRING_FIELDS = ['botId', 'name', 'text', 'kind', 'via', 'code', 'status', 'color', 'cause', 'helper', 'stopReason'] as const
const LABEL_FIELDS = new Set<string>(['botId', 'name', 'kind', 'via', 'code', 'status', 'color', 'cause', 'helper', 'stopReason'])
const NUMBER_FIELDS = ['time', 'duration', 'count', 'limit'] as const

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function compactString(value: string, limit: number): { value: string; truncated: boolean } {
  return value.length > limit
    ? { value: value.slice(0, limit), truncated: true }
    : { value, truncated: false }
}

function compactPresented(raw: unknown): { value?: Record<string, unknown>[]; truncated: boolean } {
  if (!Array.isArray(raw)) return { truncated: false }
  const out: Record<string, unknown>[] = []
  let truncated = false
  for (const item of raw) {
    if (out.length >= LIMITS.presentedItems) { truncated = true; break }
    if (!object(item) || typeof item.path !== 'string') continue
    const path = compactString(item.path, LIMITS.label)
    if (path.truncated) truncated = true
    const entry: Record<string, unknown> = { path: path.value }
    if (typeof item.description === 'string') {
      const desc = compactString(item.description, LIMITS.label)
      entry.description = desc.value
      if (desc.truncated) truncated = true
    }
    if (typeof item.sessionId === 'string') {
      const sid = compactString(item.sessionId, LIMITS.label)
      entry.sessionId = sid.value
      if (sid.truncated) truncated = true
    }
    if (typeof item.seq === 'number') entry.seq = item.seq
    if (typeof item.index === 'number') entry.index = item.index
    out.push(entry)
  }
  return out.length > 0 ? { value: out, truncated } : { truncated }
}

function compactChanges(raw: unknown): unknown {
  if (typeof raw === 'boolean') return raw
  if (!object(raw)) return undefined
  const out: Record<string, unknown> = {}
  if (typeof raw.sessionId === 'string') out.sessionId = compactString(raw.sessionId, LIMITS.label).value
  if (typeof raw.turn === 'number') out.turn = raw.turn
  if (typeof raw.count === 'number') out.count = raw.count
  return Object.keys(out).length > 0 ? out : undefined
}

function compactStringArray(raw: unknown, maxItems: number): { value?: string[]; truncated: boolean } {
  if (!Array.isArray(raw)) return { truncated: false }
  const out: string[] = []
  let truncated = false
  for (const item of raw) {
    if (out.length >= maxItems) { truncated = true; break }
    if (typeof item !== 'string') continue
    const bounded = compactString(item, LIMITS.label)
    if (bounded.truncated) truncated = true
    out.push(bounded.value)
  }
  return out.length > 0 ? { value: out, truncated } : { truncated }
}

/**
 * Project one tool detail to a bounded group-round payload, or `undefined` when
 * the text does not carry the ds-bot round contract (the caller keeps its own
 * ordinary truncation). Never throws: compact history is a read-only projection,
 * so a malformed detail must stay on the generic path.
 */
export function compactBotRound(text: string): string | undefined {
  if (typeof text !== 'string' || text.length === 0 || text.length > LIMITS.source) return undefined
  const start = text.indexOf(HEADER)
  if (start < 0 || start > LIMITS.scan) return undefined
  const slice = text.slice(start).replace(SAVE_TOKEN_SUFFIX_RE, '')
  let parsed: unknown
  try { parsed = JSON.parse(slice) } catch { return undefined }
  if (!object(parsed) || !Array.isArray(parsed.replies)) return undefined
  const source = parsed.replies
  if (source.length === 0) return undefined
  const replies: Record<string, unknown>[] = []
  let truncated = parsed.truncated === true
  for (const entry of source) {
    if (replies.length >= LIMITS.entries) { truncated = true; break }
    if (!object(entry)) continue
    const reply: Record<string, unknown> = {}
    for (const field of STRING_FIELDS) {
      const value = entry[field]
      if (typeof value !== 'string') continue
      const limit = LABEL_FIELDS.has(field) ? LIMITS.label : LIMITS.text
      const bounded = compactString(value, limit)
      reply[field] = bounded.value
      if (bounded.truncated) truncated = true
    }
    for (const field of NUMBER_FIELDS) {
      if (typeof entry[field] === 'number') reply[field] = entry[field]
    }
    if (typeof entry.idle === 'boolean') reply.idle = entry.idle
    const names = compactStringArray(entry.names, LIMITS.arrayItems)
    if (names.value !== undefined) reply.names = names.value
    if (names.truncated) truncated = true
    const claims = compactStringArray(entry.claims, LIMITS.claimsItems)
    if (claims.value !== undefined) reply.claims = claims.value
    if (claims.truncated) truncated = true
    const presented = compactPresented(entry.presented)
    if (presented.value !== undefined) reply.presented = presented.value
    if (presented.truncated) truncated = true
    const changes = compactChanges(entry.changes)
    if (changes !== undefined) reply.changes = changes

    // Entries without spoken text, status kind, presented files, or changes cannot render.
    if (reply.text === undefined && reply.kind === undefined && reply.presented === undefined && reply.changes === undefined) continue
    replies.push(reply)
  }
  if (replies.length === 0) return undefined
  const envelope: Record<string, unknown> = { replies }
  if (typeof parsed.passed === 'number') envelope.passed = parsed.passed
  if (typeof parsed.failed === 'number') envelope.failed = parsed.failed
  const serialize = (cut: boolean): string => JSON.stringify(cut ? { ...envelope, truncated: true } : envelope)
  let json = serialize(truncated)
  // One reply is always below the payload ceiling because every string field is
  // capped above, so dropping trailing replies terminates on its own.
  while (json.length > LIMITS.payload && replies.length > 1) {
    replies.pop()
    truncated = true
    json = serialize(true)
  }
  return json.length > LIMITS.payload ? undefined : json
}
