import type { CodexPermissionPreset } from '@dsh-remote/protocol'
import type { AcpModelSelection } from './acp/virtual-catalog.js'
import type { AcpPermissionPreset, NativeEvent as AcpNativeEvent } from './acp/virtual-contract.js'
import type { CodexModelSelection } from './codex/virtual-catalog.js'
import type { CodexNativeHistoryPage } from './codex/virtual-history.js'
import type { HarnessSessionGeneration } from './harness-version.js'

const MAX_CACHED_SESSIONS = 32
const MAX_CACHED_RECORDS_PER_SESSION = 200
const MAX_ACP_CACHED_EVENTS_PER_SESSION = 10_000
const MAX_UNARY_PAGES_PER_SESSION = 8
const MAX_INVALIDATION_KEYS = 256

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneStructured<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

function touchLru<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

interface SharedInFlightEntry<T> {
  client?: object
  controller: AbortController
  waiters: number
  settled: boolean
  promise: Promise<T>
}

function attachSharedInFlight<T>(
  entry: SharedInFlightEntry<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
  }
  entry.waiters += 1
  return new Promise<T>((resolve, reject) => {
    let finished = false
    const onAbort = () => {
      if (finished) return
      finished = true
      entry.waiters = Math.max(0, entry.waiters - 1)
      if (entry.waiters === 0 && !entry.settled) {
        entry.controller.abort(signal?.reason)
      }
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(
      value => {
        if (finished) return
        finished = true
        signal?.removeEventListener('abort', onAbort)
        resolve(cloneStructured(value))
      },
      error => {
        if (finished) return
        finished = true
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export function extractSessionIdFromGatewayPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const args = isRecord(payload.args) ? payload.args : payload
  const request = isRecord(args.request)
    ? args.request
    : isRecord(args._request)
      ? args._request
      : args
  if (typeof request.sessionId === 'string' && request.sessionId.length > 0) return request.sessionId
  if (typeof request.agentId === 'string' && request.agentId.length > 0) return request.agentId
  if (isRecord(request.address)) {
    const address = request.address
    if (typeof address.sessionId === 'string' && address.sessionId.length > 0) return address.sessionId
    if (typeof address.childSessionId === 'string' && address.childSessionId.length > 0) return address.childSessionId
  }
  return undefined
}

export function isSessionMutationEndpoint(endpoint: string): boolean {
  return endpoint === 'session/prompt'
    || endpoint === 'session/cancel'
    || endpoint === 'session/rename'
    || endpoint === 'session/selectModel'
    || endpoint === 'session/selectPermission'
    || endpoint === 'session/fork'
    || endpoint === 'agentPresets/select'
    || endpoint === 'commands/execute'
    || endpoint === 'workspace/archiveSession'
}

export function canonicalUnaryHistoryKey(endpoint: string, payload: unknown): string {
  if (!isRecord(payload)) return endpoint
  const args = isRecord(payload.args) ? payload.args : payload
  const request = isRecord(args.request)
    ? args.request
    : isRecord(args._request)
      ? args._request
      : args
  return JSON.stringify([
    endpoint,
    typeof request.beforeSeq === 'number' ? request.beforeSeq : null,
    typeof request.throughSeq === 'number' ? request.throughSeq : null,
    typeof request.maxMessages === 'number' ? request.maxMessages : typeof request.limit === 'number' ? request.limit : null,
    request.turnWindow ?? null,
  ])
}

interface CachedRemoteSessionEntry {
  client?: object
  snapshot?: JsonRecord
  unary: Map<string, { client: object; value: unknown }>
}

/**
 * Bounded LRU cache for Native Harness session follow snapshots and unary
 * history/page/projection reads across project and session switches.
 */
export class RemoteSessionHistoryCache {
  private readonly sessions = new Map<string, CachedRemoteSessionEntry>()
  private readonly pendingUnary = new Map<string, SharedInFlightEntry<unknown>>()
  private readonly invalidatedAt = new Map<string, number>()
  private epoch = 0
  private minValidEpoch = 0

  beginReadEpoch(): number {
    return ++this.epoch
  }

  isReadEpochValid(sessionId: string, readEpoch: number): boolean {
    return readEpoch > this.minValidEpoch && readEpoch > (this.invalidatedAt.get(sessionId) ?? 0)
  }

  getFollowSnapshot(
    client: object,
    sessionId: string,
  ): { snapshot: JsonRecord; sameClient: boolean; cursor: number } | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry?.snapshot === undefined) return undefined
    touchLru(this.sessions, sessionId, entry, MAX_CACHED_SESSIONS)
    const snapshot = cloneStructured(entry.snapshot)
    const cursor = typeof snapshot.cursor === 'number' ? snapshot.cursor : -1
    return {
      snapshot: {
        ...snapshot,
        ...(isRecord(snapshot.assistantStream) ? { assistantStream: { ...snapshot.assistantStream, revision: 0 } } : {}),
      },
      sameClient: entry.client === client,
      cursor,
    }
  }

  recordFollowSnapshot(client: object, sessionId: string, frame: unknown): void {
    if (!isRecord(frame) || frame.type !== 'snapshot') return
    const id = sessionId.length > 0
      ? sessionId
      : isRecord(frame.header) && typeof frame.header.id === 'string'
        ? frame.header.id
        : ''
    if (id.length === 0) return
    const existing: CachedRemoteSessionEntry = this.sessions.get(id) ?? { unary: new Map() }
    const cloned = cloneStructured(frame)
    if (Array.isArray(cloned.records) && cloned.records.length > MAX_CACHED_RECORDS_PER_SESSION) {
      cloned.records = cloned.records.slice(cloned.records.length - MAX_CACHED_RECORDS_PER_SESSION)
      cloned.hasMore = true
    }
    this.invalidateUnary(id, existing)
    existing.client = client
    existing.snapshot = cloned
    touchLru(this.sessions, id, existing, MAX_CACHED_SESSIONS)
  }

  prependBackfilledRecords(client: object, sessionId: string, backfilled: unknown[]): void {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined || entry.client !== client || entry.snapshot === undefined || !Array.isArray(entry.snapshot.records)) return
    const bySeq = new Map<number, unknown>()
    for (const item of [...backfilled, ...entry.snapshot.records]) {
      if (isRecord(item) && isRecord(item.event) && typeof item.event.seq === 'number') {
        bySeq.set(item.event.seq, cloneStructured(item))
      }
    }
    const sortedEntries = [...bySeq.entries()].sort((a, b) => a[0] - b[0])
    const merged = sortedEntries.map(([, item]) => item)
    if (merged.length > MAX_CACHED_RECORDS_PER_SESSION) {
      entry.snapshot.records = merged.slice(merged.length - MAX_CACHED_RECORDS_PER_SESSION)
      entry.snapshot.hasMore = true
    } else {
      entry.snapshot.records = merged
    }
    const highestSeq = sortedEntries.at(-1)?.[0]
    const currentCursor = typeof entry.snapshot.cursor === 'number' ? entry.snapshot.cursor : -1
    if (highestSeq !== undefined && highestSeq > currentCursor) {
      entry.snapshot.cursor = highestSeq
    }
    this.invalidateUnary(sessionId, entry)
  }

  recordFollowFrame(client: object, sessionId: string, frame: unknown): void {
    if (sessionId.length === 0 || !isRecord(frame)) return
    const entry = this.sessions.get(sessionId)
    if (entry === undefined || entry.client !== client || entry.snapshot === undefined) return
    if (frame.type === 'event' && isRecord(frame.event) && typeof frame.event.seq === 'number') {
      const seq = frame.event.seq
      const currentCursor = typeof entry.snapshot.cursor === 'number' ? entry.snapshot.cursor : -1
      if (seq <= currentCursor) return
      if (seq === currentCursor + 1 && Array.isArray(entry.snapshot.records)) {
        const records = [...entry.snapshot.records, cloneStructured(frame)]
        if (records.length > MAX_CACHED_RECORDS_PER_SESSION) {
          entry.snapshot.records = records.slice(records.length - MAX_CACHED_RECORDS_PER_SESSION)
          entry.snapshot.hasMore = true
        } else {
          entry.snapshot.records = records
        }
        entry.snapshot.cursor = seq
        this.invalidateUnary(sessionId, entry)
        touchLru(this.sessions, sessionId, entry, MAX_CACHED_SESSIONS)
      }
      return
    }
    if (frame.type === 'projection' && typeof frame.key === 'string') {
      const projections = isRecord(entry.snapshot.projections) ? entry.snapshot.projections : undefined
      if (projections !== undefined && isRecord(projections.values)) {
        projections.values[frame.key] = cloneStructured(frame.value)
        if (typeof frame.seq === 'number' && typeof projections.asOfSeq === 'number' && frame.seq > projections.asOfSeq) {
          projections.asOfSeq = frame.seq
        }
      }
      this.invalidateUnary(sessionId, entry)
    }
  }

  private invalidateUnary(sessionId: string, entry?: CachedRemoteSessionEntry): void {
    const invalidationEpoch = ++this.epoch
    this.invalidatedAt.delete(sessionId)
    this.invalidatedAt.set(sessionId, invalidationEpoch)
    while (this.invalidatedAt.size > MAX_INVALIDATION_KEYS) {
      const oldestKey = this.invalidatedAt.keys().next().value
      if (oldestKey === undefined) break
      const oldestEpoch = this.invalidatedAt.get(oldestKey) ?? 0
      this.minValidEpoch = Math.max(this.minValidEpoch, oldestEpoch)
      this.invalidatedAt.delete(oldestKey)
    }
    entry?.unary.clear()
    for (const [key, pending] of this.pendingUnary.entries()) {
      if (key.startsWith(`${sessionId}:`)) {
        pending.settled = true
        this.pendingUnary.delete(key)
      }
    }
  }

  getUnary(client: object, sessionId: string, key: string): unknown | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined || entry.client !== client) return undefined
    const cached = entry.unary.get(key)
    if (cached === undefined || cached.client !== client) return undefined
    touchLru(entry.unary, key, cached, MAX_UNARY_PAGES_PER_SESSION)
    touchLru(this.sessions, sessionId, entry, MAX_CACHED_SESSIONS)
    return cloneStructured(cached.value)
  }

  setUnary(client: object, sessionId: string, key: string, value: unknown, readEpoch?: number): void {
    if (readEpoch !== undefined && !this.isReadEpochValid(sessionId, readEpoch)) return
    const existing = this.sessions.get(sessionId)
    const entry: CachedRemoteSessionEntry = existing ?? { unary: new Map() }
    if (entry.client !== undefined && entry.client !== client) {
      entry.unary.clear()
    }
    entry.client = client
    touchLru(entry.unary, key, { client, value: cloneStructured(value) }, MAX_UNARY_PAGES_PER_SESSION)
    touchLru(this.sessions, sessionId, entry, MAX_CACHED_SESSIONS)
  }

  getFallbackUnary(sessionId: string, endpoint: string, key: string, payload: unknown): unknown | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) return undefined
    const exact = entry.unary.get(key)
    if (exact !== undefined) return cloneStructured(exact.value)
    if (entry.snapshot === undefined) return undefined
    const snapshot = entry.snapshot
    if (endpoint === 'session/projections') {
      return snapshot.projections !== undefined ? cloneStructured(snapshot.projections) : undefined
    }
    if (endpoint === 'session/history' && Array.isArray(snapshot.records)) {
      return {
        records: cloneStructured(snapshot.records),
        hasMore: Boolean(snapshot.hasMore),
        ...(typeof snapshot.cursor === 'number' ? { throughSeq: snapshot.cursor, cursor: snapshot.cursor } : {}),
        ...(snapshot.projections === undefined ? {} : { projections: cloneStructured(snapshot.projections) }),
      }
    }
    if (endpoint === 'session/page') {
      return this.sliceSnapshotRecords(snapshot, payload)
    }
    return undefined
  }

  slicePageFromSnapshot(client: object, sessionId: string, payload: unknown): unknown | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined || entry.client !== client || entry.snapshot === undefined) return undefined
    if (entry.snapshot.hasMore === true) return undefined
    return this.sliceSnapshotRecords(entry.snapshot, payload)
  }

  private sliceSnapshotRecords(snapshot: JsonRecord, payload: unknown): unknown | undefined {
    if (!Array.isArray(snapshot.records)) return undefined
    const args = isRecord(payload) && isRecord(payload.args) ? payload.args : isRecord(payload) ? payload : {}
    const request = isRecord(args.request)
      ? args.request
      : isRecord(args._request)
        ? args._request
        : args
    if (request.turnWindow !== undefined) return undefined
    const snapshotCursor = typeof snapshot.cursor === 'number' ? snapshot.cursor : -1
    const throughSeq = typeof request.throughSeq === 'number' ? request.throughSeq : snapshotCursor
    if (throughSeq > snapshotCursor) return undefined
    const beforeSeq = typeof request.beforeSeq === 'number' ? request.beforeSeq : undefined
    const endSeq = beforeSeq === undefined ? throughSeq : Math.min(throughSeq, beforeSeq - 1)
    const window = endSeq < 0
      ? []
      : snapshot.records.filter(item => isRecord(item) && isRecord(item.event) && typeof item.event.seq === 'number' && item.event.seq <= endSeq)
    if (throughSeq >= 0 && beforeSeq === undefined && window.length > 0) {
      const tail = window.at(-1)
      if (!isRecord(tail) || !isRecord(tail.event) || tail.event.seq !== throughSeq) return undefined
    }
    const maxMessages = typeof request.maxMessages === 'number' && request.maxMessages > 0
      ? request.maxMessages
      : typeof request.limit === 'number' && request.limit > 0
        ? request.limit
        : undefined
    const records = maxMessages === undefined
      ? window
      : window.slice(Math.max(0, window.length - maxMessages))
    const hasMore = Boolean(snapshot.hasMore) || window.length > records.length
    return cloneStructured({
      records,
      hasMore,
      ...(typeof snapshot.cursor === 'number' ? { cursor: snapshot.cursor } : {}),
    })
  }

  runSingleFlightUnary<T>(
    client: object,
    sessionId: string,
    key: string,
    signal: AbortSignal,
    factory: (sharedSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
    const composite = `${sessionId}:${key}`
    const existing = this.pendingUnary.get(composite)
    if (existing !== undefined && existing.client === client && !existing.settled) {
      return attachSharedInFlight(existing as SharedInFlightEntry<T>, signal)
    }
    const controller = new AbortController()
    const entry: SharedInFlightEntry<T> = {
      client,
      controller,
      waiters: 0,
      settled: false,
      promise: Promise.resolve() as unknown as Promise<T>,
    }
    entry.promise = factory(controller.signal).finally(() => {
      entry.settled = true
      if (this.pendingUnary.get(composite) === entry) {
        this.pendingUnary.delete(composite)
      }
    })
    void entry.promise.catch(() => undefined)
    this.pendingUnary.set(composite, entry as SharedInFlightEntry<unknown>)
    return attachSharedInFlight(entry, signal)
  }

  invalidateSession(sessionId: string): void {
    const invalidationEpoch = ++this.epoch
    this.invalidatedAt.delete(sessionId)
    this.invalidatedAt.set(sessionId, invalidationEpoch)
    while (this.invalidatedAt.size > MAX_INVALIDATION_KEYS) {
      const oldestKey = this.invalidatedAt.keys().next().value
      if (oldestKey === undefined) break
      const oldestEpoch = this.invalidatedAt.get(oldestKey) ?? 0
      this.minValidEpoch = Math.max(this.minValidEpoch, oldestEpoch)
      this.invalidatedAt.delete(oldestKey)
    }
    const entry = this.sessions.get(sessionId)
    if (entry !== undefined) {
      entry.unary.clear()
      entry.snapshot = undefined
      this.sessions.delete(sessionId)
    }
    for (const [key, pending] of this.pendingUnary.entries()) {
      if (key.startsWith(`${sessionId}:`)) {
        pending.settled = true
        this.pendingUnary.delete(key)
      }
    }
  }

  clear(): void {
    this.minValidEpoch = ++this.epoch
    this.invalidatedAt.clear()
    this.sessions.clear()
    for (const pending of this.pendingUnary.values()) {
      pending.settled = true
    }
    this.pendingUnary.clear()
  }
}

interface CachedCodexThreadHistory {
  updatedAt?: number
  stale: boolean
  pages: Map<string, CodexNativeHistoryPage>
  tailPage?: CodexNativeHistoryPage
  selectedModel?: CodexModelSelection
  permissionPreset?: CodexPermissionPreset
}

/**
 * Bounded LRU cache for Codex virtual session history pages across project
 * and session switches on the same remote Host.
 */
export class CodexSessionHistoryCache {
  private readonly threads = new Map<string, CachedCodexThreadHistory>()
  private readonly pendingPages = new Map<string, SharedInFlightEntry<CodexNativeHistoryPage>>()
  private readonly invalidatedAt = new Map<string, number>()
  private epoch = 0
  private minValidEpoch = 0

  static pageKey(
    generation: HarnessSessionGeneration,
    page: { beforeSeq?: number; throughSeq?: number; maxMessages?: number },
  ): string {
    return JSON.stringify([
      generation,
      page.beforeSeq ?? null,
      page.throughSeq ?? null,
      page.maxMessages ?? null,
    ])
  }

  beginReadEpoch(): number {
    return ++this.epoch
  }

  isReadEpochValid(threadId: string, readEpoch: number): boolean {
    return readEpoch > this.minValidEpoch && readEpoch > (this.invalidatedAt.get(threadId) ?? 0)
  }

  getFreshPage(
    threadId: string,
    generation: HarnessSessionGeneration,
    page: { beforeSeq?: number; throughSeq?: number; maxMessages?: number },
    knownUpdatedAt?: number,
  ): CodexNativeHistoryPage | undefined {
    const entry = this.threads.get(threadId)
    if (entry === undefined || entry.stale) return undefined
    if (knownUpdatedAt !== undefined && entry.updatedAt !== undefined && knownUpdatedAt > entry.updatedAt) {
      entry.stale = true
      return undefined
    }
    const key = CodexSessionHistoryCache.pageKey(generation, page)
    const cached = entry.pages.get(key)
    if (cached === undefined) return undefined
    touchLru(entry.pages, key, cached, MAX_UNARY_PAGES_PER_SESSION)
    touchLru(this.threads, threadId, entry, MAX_CACHED_SESSIONS)
    return cloneStructured(cached)
  }

  getFreshTailCursor(
    threadId: string,
    generation: HarnessSessionGeneration,
    knownUpdatedAt?: number,
  ): number | undefined {
    const entry = this.threads.get(threadId)
    if (entry === undefined || entry.stale || entry.tailPage === undefined) return undefined
    if (knownUpdatedAt !== undefined && entry.updatedAt !== undefined && knownUpdatedAt > entry.updatedAt) {
      entry.stale = true
      return undefined
    }
    if ((entry.tailPage.header.version === 3 ? 'v3' : 'legacy') !== generation) return undefined
    touchLru(this.threads, threadId, entry, MAX_CACHED_SESSIONS)
    return entry.tailPage.cursor
  }

  getStalePage(
    threadId: string,
    generation: HarnessSessionGeneration,
    page: { beforeSeq?: number; throughSeq?: number; maxMessages?: number },
  ): CodexNativeHistoryPage | undefined {
    const entry = this.threads.get(threadId)
    if (entry === undefined) return undefined
    const key = CodexSessionHistoryCache.pageKey(generation, page)
    const cached = entry.pages.get(key)
    return cached === undefined ? undefined : cloneStructured(cached)
  }

  setPage(
    threadId: string,
    generation: HarnessSessionGeneration,
    page: { beforeSeq?: number; throughSeq?: number; maxMessages?: number },
    value: CodexNativeHistoryPage,
    knownUpdatedAt?: number,
    readEpoch?: number,
  ): void {
    if (readEpoch !== undefined && !this.isReadEpochValid(threadId, readEpoch)) return
    const existing = this.threads.get(threadId)
    const entry: CachedCodexThreadHistory = existing ?? { stale: false, pages: new Map() }
    if (entry.stale) {
      entry.pages.clear()
      entry.tailPage = undefined
      entry.stale = false
    }
    if (knownUpdatedAt !== undefined) {
      entry.updatedAt = knownUpdatedAt
    }
    const cloned = cloneStructured(value)
    const key = CodexSessionHistoryCache.pageKey(generation, page)
    touchLru(entry.pages, key, cloned, MAX_UNARY_PAGES_PER_SESSION)
    if (page.beforeSeq === undefined && page.throughSeq === undefined) {
      entry.tailPage = cloned
    }
    touchLru(this.threads, threadId, entry, MAX_CACHED_SESSIONS)
  }

  runSingleFlightPage(
    threadId: string,
    generation: HarnessSessionGeneration,
    page: { beforeSeq?: number; throughSeq?: number; maxMessages?: number },
    signal: AbortSignal | undefined,
    factory: (sharedSignal: AbortSignal) => Promise<CodexNativeHistoryPage>,
  ): Promise<CodexNativeHistoryPage> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
    const composite = `${threadId}:${CodexSessionHistoryCache.pageKey(generation, page)}`
    const existing = this.pendingPages.get(composite)
    if (existing !== undefined && !existing.settled) {
      return attachSharedInFlight(existing, signal)
    }
    const controller = new AbortController()
    const entry: SharedInFlightEntry<CodexNativeHistoryPage> = {
      controller,
      waiters: 0,
      settled: false,
      promise: Promise.resolve() as unknown as Promise<CodexNativeHistoryPage>,
    }
    entry.promise = factory(controller.signal).finally(() => {
      entry.settled = true
      if (this.pendingPages.get(composite) === entry) {
        this.pendingPages.delete(composite)
      }
    })
    void entry.promise.catch(() => undefined)
    this.pendingPages.set(composite, entry)
    return attachSharedInFlight(entry, signal)
  }

  invalidateThread(threadId: string): void {
    const invalidationEpoch = ++this.epoch
    this.invalidatedAt.delete(threadId)
    this.invalidatedAt.set(threadId, invalidationEpoch)
    while (this.invalidatedAt.size > MAX_INVALIDATION_KEYS) {
      const oldestKey = this.invalidatedAt.keys().next().value
      if (oldestKey === undefined) break
      const oldestEpoch = this.invalidatedAt.get(oldestKey) ?? 0
      this.minValidEpoch = Math.max(this.minValidEpoch, oldestEpoch)
      this.invalidatedAt.delete(oldestKey)
    }
    const entry = this.threads.get(threadId)
    if (entry !== undefined) {
      entry.stale = true
    }
    for (const [key, pending] of this.pendingPages.entries()) {
      if (key.startsWith(`${threadId}:`)) {
        pending.settled = true
        this.pendingPages.delete(key)
      }
    }
  }

  removeThread(threadId: string): void {
    this.invalidateThread(threadId)
    this.threads.delete(threadId)
  }

  clear(): void {
    this.minValidEpoch = ++this.epoch
    this.invalidatedAt.clear()
    this.threads.clear()
    for (const pending of this.pendingPages.values()) {
      pending.settled = true
    }
    this.pendingPages.clear()
  }
}

export interface CachedAcpSessionHistory {
  events: Array<{ type: 'event'; event: AcpNativeEvent }>
  blank: boolean
  hydrated: boolean
  stale?: boolean
  truncated?: boolean
  title?: string
  titleOverridden?: boolean
  titleFromPrompt?: boolean
  hostUpdatedAt: number
  selectedModel?: AcpModelSelection
  permissionPreset?: AcpPermissionPreset
}

/**
 * Bounded LRU cache for ACP virtual session histories (Claude, Hermes,
 * OpenCode, Pi, Antigravity, Cursor) across project switches.
 */
export class AcpSessionHistoryCache {
  private readonly sessions = new Map<string, CachedAcpSessionHistory>()

  getFresh(sessionId: string): CachedAcpSessionHistory | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined || entry.stale || entry.truncated || !entry.hydrated || entry.events.length === 0) return undefined
    touchLru(this.sessions, sessionId, entry, MAX_CACHED_SESSIONS)
    return cloneStructured(entry)
  }

  getStale(sessionId: string): CachedAcpSessionHistory | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) return undefined
    return cloneStructured(entry)
  }

  set(sessionId: string, value: CachedAcpSessionHistory): void {
    const cloned = cloneStructured(value)
    if (cloned.events.length > MAX_ACP_CACHED_EVENTS_PER_SESSION) {
      cloned.events = cloned.events.slice(cloned.events.length - MAX_ACP_CACHED_EVENTS_PER_SESSION)
      cloned.truncated = true
    }
    touchLru(this.sessions, sessionId, cloned, MAX_CACHED_SESSIONS)
  }

  markStale(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (entry !== undefined) {
      entry.stale = true
    }
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  clear(): void {
    this.sessions.clear()
  }
}
