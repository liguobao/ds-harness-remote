/**
 * Hide archived Sessions from remote clients.
 *
 * `session/list` returns the visible rows, but a row carries no archived flag,
 * so an archived Session is still listed over the remote channel while the
 * local Web UI hides it. The archive set lives in the Workspace projection
 * (`workspace/follow` baseline -> `archivedSessionIds`), which the bridge reads
 * on a short cache and applies before the list leaves the Host.
 *
 * Every helper is total: on unexpected input it returns the input unchanged, so
 * a Host shape change degrades to "nothing hidden", never to a failed call.
 */
import type { LocalTypertGateway, TypertRpcResult } from './typert-gateway-contract.js'

/** How long the archive projection is reused before asking the Host again. */
export const ARCHIVE_CACHE_TTL_MS = 3_000

export interface ArchivedCache {
  readonly at: number
  readonly ids: ReadonlySet<string>
}

/** Mutable holder the bridge owns; `readArchivedSessionIds` refreshes it. */
export interface ArchivedCacheHolder {
  value: ArchivedCache
}

/** Fresh, empty cache holder for one bridge instance. */
export function emptyArchivedCache(): ArchivedCacheHolder {
  return { value: { at: 0, ids: new Set() } }
}

/**
 * Extract `archivedSessionIds` from the first `workspace/follow` frame.
 *
 * Split out from the bridge so the frame shape can be tested without a Host.
 * Returns `undefined` when the frame is not a usable baseline, which callers
 * treat as "nothing to hide".
 */
export function archivedIdsFromBaseline(frame: unknown): ReadonlySet<string> | undefined {
  if (!isRecord(frame) || frame.type !== 'baseline' || !isRecord(frame.value)) return undefined
  const list = frame.value.archivedSessionIds
  if (!Array.isArray(list)) return undefined
  return new Set(list.filter((id): id is string => typeof id === 'string'))
}

/**
 * Read the archive projection from the Host.
 *
 * Mirrors `readRemoteWorkspaceBaseline()` in `client-workspace-queries.ts`:
 * `workspace/follow` takes no parameters, but the carrier still wants the
 * payload wrapped as `{ args: {} }`, and the single-use stream must be closed
 * in `finally`. On any failure the previously cached set is returned rather
 * than throwing, so a transient Host error hides nothing new.
 *
 * `cache` is a mutable holder owned by the caller, so the TTL entry can be
 * refreshed in place without the bridge tracking timestamps itself.
 */
export async function readArchivedSessionIds(
  gateway: LocalTypertGateway,
  cache: ArchivedCacheHolder,
  now = Date.now(),
): Promise<ReadonlySet<string>> {
  if (now - cache.value.at < ARCHIVE_CACHE_TTL_MS) return cache.value.ids
  const lifetime = new AbortController()
  try {
    const source = await gateway.open('workspace/follow', { args: {} }, lifetime.signal)
    const iterator = source[Symbol.asyncIterator]()
    try {
      const first = await iterator.next()
      const ids = first.done ? undefined : archivedIdsFromBaseline(first.value)
      if (ids === undefined) return cache.value.ids
      cache.value = { at: now, ids }
      return ids
    } finally {
      await iterator.return?.()
    }
  } catch {
    return cache.value.ids
  } finally {
    lifetime.abort('archive-baseline-read')
  }
}

/**
 * Drop archived Sessions from a `session/list` result.
 *
 * Rows and the archive projection do not always agree on the `session-` prefix,
 * so all three spellings are matched.
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
