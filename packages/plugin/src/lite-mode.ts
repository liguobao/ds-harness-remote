/**
 * Lite mode: shrink what a remote client receives on first paint.
 *
 * Large sessions make the initial `snapshot` frame megabytes wide (hundreds of
 * records plus per-session projections such as the context-lens panel). Clients
 * that cannot chunk a frame (`transferFrames: false`, e.g. the web client) hit
 * "Oversized Harness Remote frame" and the whole connection drops. Lite mode
 * keeps the frame small instead:
 *
 * - `records` is trimmed to the newest few entries (the client still sees
 *   `hasMore: true`, so it can page back for older ones),
 * - projections above {@link LITE_PROJECTION_MAX_BYTES} are dropped, while a
 *   small keep-list of projections the UI needs to render survives regardless.
 *
 * Only data sent over the wire is affected; the session store and the agent
 * context are untouched.
 */

/** Projections the client needs to render its chrome; always kept. */
export const LITE_PROJECTION_KEEP_KEYS: ReadonlySet<string> = new Set([
  'title',
  'modelSelection',
  'permissions',
  'sessionListMetadata',
  'imageLimits',
])

/** Projections larger than this many bytes are dropped in lite mode. */
export const LITE_PROJECTION_MAX_BYTES = 16 * 1024

/** How many records the initial history page keeps in lite mode. */
export const LITE_HISTORY_RECORDS = 10

/**
 * Process-wide switch, mirroring how the plugin wires other runtime flags: the Host
 * and its bridges live in one process, so a single module-level value is enough and
 * a toggle applies to the next frame instead of requiring a reconnect.
 */
let enabled = false

/** Whether lite mode is currently on. */
export function isLiteModeEnabled(): boolean {
  return enabled
}

/** Flip lite mode for subsequent frames. */
export function setLiteModeEnabled(next: boolean): void {
  enabled = next === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sizeOf(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Keep the keep-list plus anything small; drop the rest. */
export function filterLiteProjections(projections: unknown): unknown {
  if (!isRecord(projections)) return projections
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(projections)) {
    if (LITE_PROJECTION_KEEP_KEYS.has(key) || sizeOf(value) <= LITE_PROJECTION_MAX_BYTES) kept[key] = value
  }
  return kept
}

/**
 * Apply lite-mode shaping to one history frame.
 * @returns the (possibly rewritten) frame, or `undefined` when the whole frame
 *   should be skipped because it carries only a dropped projection.
 */
export function applyLiteMode(frame: unknown): unknown {
  if (!isRecord(frame) || !isRecord(frame.value)) return frame
  const layer = frame.value
  if (layer.type === 'baseline' && isRecord(layer.value)) {
    const inner = layer.value
    if (!isRecord(inner.projections)) return frame
    const projections: Record<string, unknown> = {}
    for (const [sessionId, blob] of Object.entries(inner.projections)) {
      projections[sessionId] = isRecord(blob) ? filterLiteProjections(blob) : blob
    }
    return { ...frame, value: { ...layer, value: { ...inner, projections } } }
  }
  if (layer.type === 'snapshot') {
    // The snapshot payload is either the layer itself or nested under `value`,
    // depending on the backend that produced it.
    const nested = isRecord(layer.value)
    const inner: Record<string, unknown> = { ...(nested ? (layer.value as Record<string, unknown>) : layer) }
    if (Array.isArray(inner.records) && inner.records.length > LITE_HISTORY_RECORDS) {
      inner.records = inner.records.slice(-LITE_HISTORY_RECORDS)
      inner.hasMore = true
    }
    if (isRecord(inner.projections) && isRecord(inner.projections.values)) {
      inner.projections = { ...inner.projections, values: filterLiteProjections(inner.projections.values) }
    }
    return { ...frame, value: nested ? { ...layer, value: inner } : inner }
  }
  if (layer.type === 'projection' && sizeOf(layer.value) > LITE_PROJECTION_MAX_BYTES) return undefined
  return frame
}
