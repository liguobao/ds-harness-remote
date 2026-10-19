/**
 * Mobile payload trimming for the Harness Remote bridge.
 *
 * Three independent reductions applied on the Host side, on the encrypted peer
 * channel only. The local Web client never crosses this code, so the desktop
 * experience is unchanged by construction.
 *
 *  1. turn window  - `session/follow` / `session/page` get a default
 *                    `turnWindow` so a long Session does not ship its entire
 *                    log in the opening snapshot.
 *  2. chat only    - tool-call events and tool-call stream blocks are removed
 *                    from history payloads and from live stream frames.
 *  3. archive list - `session/list` is filtered to the visible set.
 *
 * Every helper is total: on unexpected input it returns the input unchanged, so
 * a shape change upstream degrades to "no trimming", never to a failed call.
 */
import type { TypertRpcResult } from './typert-gateway-contract.js'

/** Durable event types the mobile surface keeps. Everything else is dropped. */
const CHAT_KEEP_TYPES = new Set(['user/message', 'assistant/message', 'turn/start', 'turn/end'])

/** Default window: the latest Turn, plus the message that opened it. */
const DEFAULT_TURN_WINDOW = { minMessages: 1, minTurns: 1 } as const

const HISTORY_ENDPOINTS = new Set(['session/follow', 'session/page'])

/**
 * Inject a default `turnWindow` into a history request that did not carry one.
 *
 * Clients send the request flat, under `args`, or nested one level deeper. The
 * Host reads the parameters from the innermost record, so the window is written
 * there and the reference chain is rebuilt outwards. A client-supplied
 * `turnWindow` is always respected, which keeps `maxMessages`-style paging and
 * older clients working exactly as before.
 */
export function withDefaultTurnWindow(endpoint: string, payload: unknown): unknown {
  if (!HISTORY_ENDPOINTS.has(endpoint)) return payload
  try {
    const layers: Record<string, unknown>[] = []
    let cursor: unknown = payload
    for (let depth = 0; depth < 4; depth += 1) {
      if (!isRecord(cursor)) break
      layers.push(cursor)
      cursor = isRecord(cursor.request) ? cursor.request : isRecord(cursor.args) ? cursor.args : undefined
    }
    if (layers.length === 0) return payload
    if (layers.some(layer => Object.hasOwn(layer, 'turnWindow'))) return payload
    let rebuilt: Record<string, unknown> = { ...layers[layers.length - 1]!, turnWindow: DEFAULT_TURN_WINDOW }
    for (let index = layers.length - 2; index >= 0; index -= 1) {
      const layer = layers[index]!
      const child = layers[index + 1]!
      rebuilt = { ...layer, [layer.request === child ? 'request' : 'args']: rebuilt }
    }
    return rebuilt
  } catch {
    return payload
  }
}

/** True for any stream entry that exists only to describe a tool call. */
function isToolStreamItem(item: unknown): boolean {
  if (!isRecord(item)) return false
  if (item.type === 'tool-call-chunks' || item.type === 'tool-call-delta' || item.type === 'tool-call') return true
  const chunk = item.chunk
  if (!isRecord(chunk)) return false
  if (chunk.blockType === 'tool-call') return true
  if (typeof chunk.type === 'string' && chunk.type.startsWith('tool-call')) return true
  const block = chunk.block
  if (isRecord(block) && block.type === 'tool-call') return true
  // `finish` carries `replayState`, which embeds the whole provider response
  // including tool-call blocks and their arguments. Dropping the block without
  // dropping this envelope would leave most of the bytes in place.
  if (chunk.type === 'finish' && isRecord(chunk.replayState)) return true
  return false
}

/** Strip tool-call blocks from one `assistant/message` event's stream. */
function stripToolStream(event: Record<string, unknown>): Record<string, unknown> {
  if (event.type !== 'assistant/message') return event
  const data = event.data
  if (!isRecord(data) || !Array.isArray(data.stream)) return event
  const kept = data.stream.filter((item: unknown) => !isToolStreamItem(item))
  if (kept.length === data.stream.length) return event
  return { ...event, data: { ...data, stream: kept } }
}

/** Keep chat events; drop the rest and trim surviving tool streams. */
export function filterChatRecords(records: unknown): unknown {
  if (!Array.isArray(records)) return records
  try {
    const kept: unknown[] = []
    for (const record of records) {
      const event = isRecord(record) && isRecord(record.event) ? record.event : undefined
      // Records without an `event` wrapper are structural placeholders; keep
      // them so a consumer that walks segments still finds what it expects.
      if (event === undefined) {
        kept.push(record)
        continue
      }
      if (typeof event.type === 'string' && !CHAT_KEEP_TYPES.has(event.type)) continue
      const trimmed = stripToolStream(event)
      kept.push(trimmed === event ? record : { ...record, event: trimmed })
    }
    return kept
  } catch {
    return records
  }
}

/** Apply the chat-only rule to a buffered `session/follow` / `session/page` result. */
export function filterChatResult(endpoint: string, result: TypertRpcResult): TypertRpcResult {
  if (!HISTORY_ENDPOINTS.has(endpoint)) return result
  try {
    const value = result.ok === true && isRecord(result.value) ? result.value : undefined
    const records = value?.records
    if (value === undefined || !Array.isArray(records)) return result
    const kept = filterChatRecords(records)
    if (kept === records) return result
    return { ...result, value: { ...value, records: kept } } as TypertRpcResult
  } catch {
    return result
  }
}

/** Apply the chat-only rule to a live frame coming off a follow stream. */
export function filterChatFrame(value: unknown): unknown {
  if (!isRecord(value) || value.type !== 'snapshot' || !Array.isArray(value.records)) return value
  const kept = filterChatRecords(value.records)
  return kept === value.records ? value : { ...value, records: kept }
}

/**
 * Drop archived Sessions from a `session/list` result.
 *
 * `session/list` returns the visible rows, but its payload carries no archived
 * flag, so an archived Session is still listed to a remote client while the
 * local Web UI hides it. The set comes from the Host's own archive projection
 * (`workspace/list` -> `archivedSessionIds`), which the caller refreshes.
 */
export function filterArchivedResult(
  endpoint: string,
  result: TypertRpcResult,
  archived: ReadonlySet<string>,
): TypertRpcResult {
  if (endpoint !== 'session/list' || archived.size === 0) return result
  try {
    const value = result.ok === true && isRecord(result.value) ? result.value : undefined
    const items = value?.items
    if (value === undefined || !Array.isArray(items)) return result
    const kept = items.filter((item: unknown) => {
      const sessionId = isRecord(item) ? item.sessionId : undefined
      if (typeof sessionId !== 'string') return true
      // The archive projection and the list rows do not always agree on the
      // `session-` prefix, so accept either spelling.
      if (archived.has(sessionId)) return false
      if (archived.has(`session-${sessionId}`)) return false
      if (sessionId.startsWith('session-') && archived.has(sessionId.slice('session-'.length))) return false
      return true
    })
    if (kept.length === items.length) return result
    return { ...result, value: { ...value, items: kept } } as TypertRpcResult
  } catch {
    return result
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
