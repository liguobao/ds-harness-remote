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

/**
 * Bound on the optional archive read.
 *
 * `session/list` has already produced its result when this runs, so a slow or
 * stalled `workspace/follow` must not delay the list. Short enough to be
 * invisible to a caller, long enough for a healthy local Host to answer.
 */
export const ARCHIVE_READ_TIMEOUT_MS = 1_000

/**
 * Bound on the stream teardown after the read is done or has timed out.
 *
 * Shorter than the read timeout: the result has already been decided, so a
 * slow close earns nothing and must not extend the caller's wait.
 */
export const ARCHIVE_CLOSE_TIMEOUT_MS = 250

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
 * This read is optional: `session/list` has already succeeded by the time it
 * runs, so it must never hold the list open. A short timeout bounds the whole
 * read (`open()`, the first frame, and the stream teardown).
 *
 * The teardown is ordered abort → `return()`, and the `return()` is itself
 * bounded. Aborting first is necessary but not sufficient: an iterator whose
 * `return()` waits for the abort signal will never see it if the signal was
 * already aborted before `return()` attached its listener, so the teardown
 * must not be awaited unbounded.
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
  const timer = setTimeout(() => lifetime.abort('archive-baseline-timeout'), ARCHIVE_READ_TIMEOUT_MS)
  let iterator: AsyncIterator<unknown> | undefined
  try {
    // Every await below is raced against the deadline rather than relying on
    // the Host honouring `lifetime.signal`: a carrier that ignores cancellation
    // would otherwise keep `session/list` pending forever.
    const source = await boundedRead(
      gateway.open('workspace/follow', { args: {} }, lifetime.signal),
      lifetime.signal,
    )
    iterator = source[Symbol.asyncIterator]()
    const first = await boundedRead(iterator.next(), lifetime.signal)
    const ids = first.done ? undefined : archivedIdsFromBaseline(first.value)
    if (ids === undefined) return cache.value.ids
    cache.value = { at: now, ids }
    return ids
  } catch {
    return cache.value.ids
  } finally {
    clearTimeout(timer)
    await closeStream(iterator, lifetime)
  }
}

/**
 * Settle a promise or give up when the signal fires, whichever comes first.
 *
 * Used instead of trusting the far side to honour cancellation: the point of
 * the deadline is to bound the wait even when a stalled carrier never reacts to
 * the abort. Rejects with the `cancelled` truthy marker so callers can treat it
 * like any other failed read.
 */
async function boundedRead<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('cancelled'))
      return
    }
    const onAbort = (): void => reject(new Error('cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/**
 * Tear down the single-use `workspace/follow` stream without ever blocking the
 * caller: abort first, then close, with the close itself time-bounded.
 *
 * Exported so the exit paths can be tested without a Host.
 */
export async function closeStream(iterator: AsyncIterator<unknown> | undefined, lifetime: AbortController): Promise<void> {
  lifetime.abort('archive-baseline-read')
  if (iterator?.return === undefined) return
  // `setTimeout` returns `number` under lib.dom and `NodeJS.Timeout` under
  // @types/node; this project compiles with both, so the handle is kept opaque
  // and cancelled through a closure rather than typed by `ReturnType`.
  let cancel: (() => void) | undefined
  try {
    await Promise.race([
      iterator.return().catch(() => undefined),
      new Promise<void>(resolve => {
        const handle = setTimeout(resolve, ARCHIVE_CLOSE_TIMEOUT_MS)
        cancel = () => { clearTimeout(handle) }
      }),
    ])
  } catch {
    // A failing close must not surface: the read is best-effort by design.
  } finally {
    // Cleared on both branches so a fast close leaves no pending timer behind.
    cancel?.()
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
