import { statfs } from 'node:fs/promises'
import { RpcError } from './safe-error.js'

export const HOST_UPLOAD_ACTIVE_LIMIT = 4
export const HOST_UPLOAD_RESERVED_BYTES = 2 * 1024 * 1024 * 1024
export const HOST_UPLOAD_DAILY_BYTES = 4 * 1024 * 1024 * 1024
export const SESSION_UPLOAD_DAILY_BYTES = 2 * 1024 * 1024 * 1024
export const SESSION_UPLOAD_DAILY_RECORDS = 1024
export const UPLOAD_DISK_FREE_BYTES = 256 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

type Entry = { sessionId: string; dev: number; remaining: number; total: number }

export class WorkspaceUploadBudget {
  private readonly active = new Set<Entry>()
  private readonly completed = new Map<string, { at: number; bytes: number }>()
  private hostCompleted: { at: number | null; bytes: number } = { at: null, bytes: 0 }
  readonly activePaths = new Set<string>()
  readonly scannedRoots = new Map<string, number>()

  constructor(
    private readonly limits = {
      active: HOST_UPLOAD_ACTIVE_LIMIT,
      reservedBytes: HOST_UPLOAD_RESERVED_BYTES,
      hostDailyBytes: HOST_UPLOAD_DAILY_BYTES,
      sessionBytes: SESSION_UPLOAD_DAILY_BYTES,
      sessions: SESSION_UPLOAD_DAILY_RECORDS,
      diskFreeBytes: UPLOAD_DISK_FREE_BYTES,
    },
    private readonly freeBytes: (root: string) => Promise<number> = async root => {
      const disk = await statfs(root)
      return disk.bavail * disk.bsize
    },
    private readonly now: () => number = Date.now,
  ) {}

  private prune(now: number) {
    const cutoff = now - DAY_MS
    if (this.hostCompleted.at !== null && this.hostCompleted.at <= cutoff) this.hostCompleted = { at: null, bytes: 0 }
    for (const [id, entry] of this.completed) {
      if (entry.at > cutoff) break
      this.completed.delete(id)
    }
  }

  async reserve(root: string, dev: number, sessionId: string, bytes: number) {
    const free = await this.freeBytes(root)
    this.prune(this.now())
    const active = [...this.active]
    const reserved = active.reduce((sum, entry) => sum + entry.remaining, 0)
    const onDisk = active.filter(entry => entry.dev === dev).reduce((sum, entry) => sum + entry.remaining, 0)
    const session = active.filter(entry => entry.sessionId === sessionId).reduce((sum, entry) => sum + entry.total, 0)
      + (this.completed.get(sessionId)?.bytes ?? 0)
    const pendingSessions = new Set(active.filter(entry => !this.completed.has(entry.sessionId)).map(entry => entry.sessionId))
    const newSession = !this.completed.has(sessionId) && !pendingSessions.has(sessionId)
    if (active.length >= this.limits.active || reserved + bytes > this.limits.reservedBytes
      || this.hostCompleted.bytes + active.reduce((sum, entry) => sum + entry.total, 0) + bytes > this.limits.hostDailyBytes
      || session + bytes > this.limits.sessionBytes
      || (newSession && this.completed.size + pendingSessions.size >= this.limits.sessions)
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
        this.prune(now)
        done = true
        this.active.delete(entry)
        this.hostCompleted = { at: this.hostCompleted.at ?? now, bytes: this.hostCompleted.bytes + bytes }
        const prior = this.completed.get(sessionId)
        this.completed.set(sessionId, { at: prior?.at ?? now, bytes: (prior?.bytes ?? 0) + bytes })
      },
      release: () => {
        if (done) return
        done = true
        this.active.delete(entry)
      },
    }
  }
}

export type UploadReservation = Awaited<ReturnType<WorkspaceUploadBudget['reserve']>>
