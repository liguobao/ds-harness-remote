import { statfs } from 'node:fs/promises'
import { RpcError } from './safe-error.js'

export const HOST_UPLOAD_ACTIVE_LIMIT = 4
export const HOST_UPLOAD_RESERVED_BYTES = 2 * 1024 * 1024 * 1024
export const HOST_UPLOAD_DAILY_BYTES = 16 * 1024 * 1024 * 1024
export const SESSION_UPLOAD_DAILY_BYTES = 8 * 1024 * 1024 * 1024
export const UPLOAD_DISK_FREE_BYTES = 32 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

type Entry = { sessionId: string; dev: number; remaining: number; total: number }

export class WorkspaceUploadBudget {
  private readonly active = new Set<Entry>()
  private readonly completed = new Map<string, number>()
  private hostCompleted = 0
  private windowStart: number | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly limits = {
      active: HOST_UPLOAD_ACTIVE_LIMIT,
      reservedBytes: HOST_UPLOAD_RESERVED_BYTES,
      hostDailyBytes: HOST_UPLOAD_DAILY_BYTES,
      sessionBytes: SESSION_UPLOAD_DAILY_BYTES,
      diskFreeBytes: UPLOAD_DISK_FREE_BYTES,
    },
    private readonly freeBytes: (root: string) => Promise<number> = async root => {
      const disk = await statfs(root)
      return disk.bavail * disk.bsize
    },
    private readonly now: () => number = Date.now,
  ) {}

  private resetWindow(now: number) {
    if (this.windowStart !== null && now - this.windowStart < DAY_MS) return
    this.windowStart = now
    this.hostCompleted = 0
    this.completed.clear()
  }

  reserve(root: string, dev: number, sessionId: string, bytes: number) {
    // Serialize disk checks and reservations across all peer upload hosts.
    const next = this.queue.then(async () => {
      const free = await this.freeBytes(root)
      this.resetWindow(this.now())
      const active = [...this.active]
      const reserved = active.reduce((sum, entry) => sum + entry.remaining, 0)
      const onDisk = active.filter(entry => entry.dev === dev).reduce((sum, entry) => sum + entry.remaining, 0)
      const session = active.filter(entry => entry.sessionId === sessionId).reduce((sum, entry) => sum + entry.total, 0)
        + (this.completed.get(sessionId) ?? 0)
      if (active.length >= this.limits.active || reserved + bytes > this.limits.reservedBytes
        || this.hostCompleted + active.reduce((sum, entry) => sum + entry.total, 0) + bytes > this.limits.hostDailyBytes
        || session + bytes > this.limits.sessionBytes
        || !Number.isFinite(free)
        || free - onDisk - bytes < this.limits.diskFreeBytes) throw new RpcError('UPLOAD_LIMIT', 'The workspace upload could not be completed.')
      const entry: Entry = { sessionId, dev, remaining: bytes, total: bytes }
      this.active.add(entry)
      let done = false
      return {
        checkDisk: async () => {
          const current = await this.freeBytes(root)
          const other = [...this.active].filter(item => item.dev === dev).reduce((sum, item) => sum + item.remaining, 0)
          if (!Number.isFinite(current) || current - other < this.limits.diskFreeBytes)
            throw new RpcError('UPLOAD_LIMIT', 'The workspace upload could not be completed.')
        },
        consume: (amount: number) => { entry.remaining -= amount },
        commit: () => {
          if (done) return
          const now = this.now()
          this.resetWindow(now)
          done = true
          this.active.delete(entry)
          this.hostCompleted += bytes
          if (bytes > 0) this.completed.set(sessionId, (this.completed.get(sessionId) ?? 0) + bytes)
        },
        release: () => {
          if (done) return
          done = true
          this.active.delete(entry)
        },
      }
    })
    this.queue = next.catch(() => undefined)
    return next
  }
}

export type UploadReservation = Awaited<ReturnType<WorkspaceUploadBudget['reserve']>>
