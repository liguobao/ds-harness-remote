import type { BotObject } from '../../services/bot-catalog'

/**
 * ds-bot group rounds return one compact `JSON.stringify({ replies, passed,
 * failed? })` tool result (ds-bot/src/host/groups.js). Each reply is either a
 * message (`{botId, name, color?, text, time}` or `{kind:'user', text, time}`)
 * or a status entry (`kind` of user/failed/approval/working/missed/done/
 * stopped/cut/resumed/schedule/lookup with optional name/text/code/status).
 * The Harness tool-result projection can wrap that JSON in text/content-block
 * envelopes or truncate the detail, so extraction peels envelopes first and
 * then salvages complete entries from a truncated array; entries that do not
 * match the plugin contract keep the text on the ordinary tool renderer.
 */
export interface BotReplyPayload {
  rows: BotObject[]
  /** Whole payload parsed. `false` means `rows` is a prefix recovered from a cut. */
  complete: boolean
  /** The Host's compact projection capped this payload itself. */
  truncated: boolean
}

export function parseBotReplyPayload(raw: string | undefined | null): BotReplyPayload | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const seen = new Set<string>()
  const queue = [raw]
  while (queue.length > 0) {
    const candidate = queue.shift()!
    const direct = parseReplyArray(candidate)
    if (direct !== undefined) return { rows: direct, complete: true, truncated: hostTruncated(candidate) }
    for (const inner of unwrapEnvelopes(candidate, seen)) queue.push(inner)
    const start = candidate.indexOf('{"replies"')
    if (start < 0) continue
    const embedded = candidate.slice(start)
    const whole = parseReplyArray(embedded)
    if (whole !== undefined) return { rows: whole, complete: true, truncated: hostTruncated(embedded) }
    const salvaged = salvageReplyArray(embedded)
    if (salvaged !== undefined) return { rows: salvaged, complete: false, truncated: hostTruncated(embedded) }
  }
  return undefined
}

export function parseBotReplies(raw: string | undefined | null): BotObject[] | undefined {
  return parseBotReplyPayload(raw)?.rows
}

/** The Host's bounded structural projection flags any reply it had to cut. */
function hostTruncated(candidate: string): boolean {
  try {
    const parsed: unknown = JSON.parse(candidate)
    if (typeof parsed !== 'object' || parsed === null) return false
    return (parsed as { truncated?: unknown }).truncated === true
  } catch { return false }
}

/** Parse a candidate only when it is an object carrying a non-empty replies array. */
function parseReplyArray(candidate: string): BotObject[] | undefined {
  try {
    const parsed: unknown = JSON.parse(candidate)
    if (isReplyEnvelope(parsed)) return parsed.replies.filter(isReplyEntry)
  } catch { /* Other detail text stays on the ordinary tool renderer. */ }
  return undefined
}

function isReplyEnvelope(parsed: unknown): parsed is { replies: unknown[] } {
  return typeof parsed === 'object' && parsed !== null
    && Array.isArray((parsed as { replies?: unknown }).replies)
}

const REPLY_KINDS = new Set(['user', 'failed', 'approval', 'working', 'missed', 'done', 'stopped', 'cut', 'resumed', 'schedule', 'lookup'])

/** ds-bot reply entries always carry a spoken text or a known status kind. */
function isReplyEntry(entry: unknown): entry is BotObject {
  if (typeof entry !== 'object' || entry === null) return false
  const record = entry as Record<string, unknown>
  return typeof record.text === 'string' || (typeof record.kind === 'string' && REPLY_KINDS.has(record.kind))
}

/** Peel common detail envelopes (text fields, nested content blocks). */
function unwrapEnvelopes(candidate: string, seen: Set<string>): string[] {
  let parsed: unknown
  try { parsed = JSON.parse(candidate) } catch { return [] }
  if (typeof parsed !== 'object' || parsed === null) return []
  const inner: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0 && !seen.has(value)) { seen.add(value); inner.push(value) }
  }
  const record = parsed as Record<string, unknown>
  push(record.text)
  collectBlocks(record.content, push)
  return inner
}

function collectBlocks(value: unknown, push: (text: string) => void, depth = 0): void {
  // Tool results are untrusted; deeper envelopes retain the ordinary renderer.
  if (depth >= 32 || !Array.isArray(value)) return
  for (const block of value) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    if (typeof record.text === 'string') push(record.text)
    collectBlocks(record.content, push, depth + 1)
  }
}

/**
 * Recover whole reply entries when the detail was truncated mid-array: scan
 * with string/escape awareness and close the array after the last entry that
 * ends at depth 1. Partial trailing entries are dropped, never guessed, and
 * every kept entry must still match the ds-bot reply contract.
 */
function salvageReplyArray(truncated: string): BotObject[] | undefined {
  const body = truncated.slice('{"replies"'.length).replace(/^\s*:\s*/, '')
  if (!body.startsWith('[')) return undefined
  const complete: string[] = []
  const brackets: string[] = []
  let start = -1, inString = false, escaped = false, expectEntry = true
  for (let i = 1; i < body.length; i++) {
    const char = body[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (brackets.length === 0) {
      if (/\s/u.test(char)) continue
      if (char === ']') break
      if (char === ',' && !expectEntry) { expectEntry = true; continue }
      // Recover only direct object entries, never nested arrays or later fields.
      if (char !== '{' || !expectEntry) break
      start = i
      brackets.push(char)
      expectEntry = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{' || char === '[') { brackets.push(char); continue }
    if (char === '}' || char === ']') {
      if (brackets.pop() !== (char === '}' ? '{' : '[')) break
      if (brackets.length === 0 && start >= 0) { complete.push(body.slice(start, i + 1)); start = -1 }
    }
  }
  const replies = complete.flatMap(item => {
    try {
      const parsed: unknown = JSON.parse(item)
      return isReplyEntry(parsed) ? [parsed] : []
    } catch { return [] }
  })
  return replies.length > 0 ? replies : undefined
}
