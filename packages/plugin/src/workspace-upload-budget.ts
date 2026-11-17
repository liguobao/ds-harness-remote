import { statfs } from 'node:fs/promises'
import { RpcError } from './safe-error.js'

export const HOST_UPLOAD_ACTIVE_LIMIT = 4
export const HOST_UPLOAD_RESERVED_BYTES = 4 * 1024 * 1024 * 1024
export const SESSION_UPLOAD_RESERVED_BYTES = 2 * 1024 * 1024 * 1024
export const UPLOAD_DISK_FREE_BYTES = 32 * 1024 * 1024

type Entry = { sessionId: string; dev: number; remaining: number; total: number }

export class WorkspaceUploadBudget {
  private readonly active = new Set<Entry>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly limits = {
      active: HOST_UPLOAD_ACTIVE_LIMIT,
      reservedBytes: HOST_UPLOAD_RESERVED_BYTES,
      sessionBytes: SESSION_UPLOAD_RESERVED_BYTES,
      diskFreeBytes: UPLOAD_DISK_FREE_BYTES,
    },
    private readonly freeBytes: (root: string) => Promise<number> = async root => {
      const disk = await statfs(root)
      return disk.bavail * disk.bsize
    },
  ) {}

  reserve(root: string, dev: number, sessionId: string, bytes: number) {
    // Serialize disk checks and reservations across all peer upload hosts.
    const next = this.queue.then(async () => {
      const free = await this.freeBytes(root)
      const active = [...this.active]
      const reserved = active.reduce((sum, entry) => sum + entry.total, 0)
      const onDisk = active.filter(entry => entry.dev === dev).reduce((sum, entry) => sum + entry.remaining, 0)
      const session = active.filter(entry => entry.sessionId === sessionId).reduce((sum, entry) => sum + entry.total, 0)
      if (active.length >= this.limits.active || reserved + bytes > this.limits.reservedBytes
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
          done = true
          this.active.delete(entry)
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
