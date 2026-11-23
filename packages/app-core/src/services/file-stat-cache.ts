import type { WorkspaceFileStat } from './session-tools'

const MAX_CACHE_ENTRIES = 256
const MAX_CONCURRENT_STATS = 3

export type StatLookupOutcome =
  | { status: 'ok'; bytes?: number }
  | { status: 'missing' }

export type StatFetcher = (sessionId: string, path: string, signal?: AbortSignal) => Promise<WorkspaceFileStat>

interface Waiter {
  run: () => void
  resolve: (outcome: StatLookupOutcome) => void
}

/**
 * Bounded in-memory LRU + deduplicated queue for lazy `workspaceFiles/stat`
 * byte lookups on historical `@path` user file cards. Cleared on disconnect.
 */
export class FileStatCache {
  private readonly cache = new Map<string, StatLookupOutcome>()
  private readonly inflight = new Map<string, Promise<StatLookupOutcome>>()
  private readonly queue: Waiter[] = []
  private activeCount = 0
  private generation = 0

  private key(generation: number, sessionId: string, path: string): string {
    return `${generation}\u0000${sessionId}\u0000${path}`
  }

  get(generation: number, sessionId: string, path: string): StatLookupOutcome | undefined {
    const key = this.key(generation, sessionId, path)
    const entry = this.cache.get(key)
    if (entry === undefined) return undefined
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry
  }

  set(generation: number, sessionId: string, path: string, outcome: StatLookupOutcome): void {
    const key = this.key(generation, sessionId, path)
    this.cache.delete(key)
    this.cache.set(key, outcome)
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
  }

  clear(): void {
    this.generation += 1
    this.cache.clear()
    this.inflight.clear()
    while (this.queue.length > 0) {
      const waiter = this.queue.shift()
      waiter?.resolve({ status: 'missing' })
    }
    this.activeCount = 0
  }

  async lookup(
    generation: number,
    sessionId: string,
    path: string,
    fetcher: StatFetcher,
  ): Promise<StatLookupOutcome> {
    const cached = this.get(generation, sessionId, path)
    if (cached !== undefined) return cached

    const key = this.key(generation, sessionId, path)
    const pending = this.inflight.get(key)
    if (pending !== undefined) return pending

    const epoch = this.generation
    const promise = new Promise<StatLookupOutcome>(resolve => {
      const run = () => {
        if (epoch !== this.generation) {
          resolve({ status: 'missing' })
          return
        }
        this.activeCount += 1
        void Promise.resolve()
          .then(() => fetcher(sessionId, path))
          .then(
            stat => {
              const outcome: StatLookupOutcome = typeof stat.bytes === 'number' && Number.isFinite(stat.bytes) && stat.bytes >= 0
                ? { status: 'ok', bytes: stat.bytes }
                : { status: 'ok' }
              if (epoch === this.generation) {
                this.set(generation, sessionId, path, outcome)
              }
              resolve(outcome)
            },
            () => {
              const outcome: StatLookupOutcome = { status: 'missing' }
              if (epoch === this.generation) {
                this.set(generation, sessionId, path, outcome)
              }
              resolve(outcome)
            },
          )
          .finally(() => {
            if (this.inflight.get(key) === promise) {
              this.inflight.delete(key)
            }
            if (epoch === this.generation) {
              this.activeCount = Math.max(0, this.activeCount - 1)
              this.drain(epoch)
            }
          })
      }

      if (this.activeCount < MAX_CONCURRENT_STATS) {
        run()
      } else {
        this.queue.push({ run, resolve })
      }
    })

    this.inflight.set(key, promise)
    return promise
  }

  private drain(epoch: number): void {
    while (epoch === this.generation && this.activeCount < MAX_CONCURRENT_STATS && this.queue.length > 0) {
      const next = this.queue.shift()
      next?.run()
    }
  }
}

export const sessionFileStatCache = new FileStatCache()
