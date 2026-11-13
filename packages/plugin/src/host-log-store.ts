import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LogLevel } from './logging.js'

export type PluginLogFilter = 'all' | 'warn'

export interface PluginLogEntry {
  seq: number
  timestamp: string
  level: LogLevel
  line: string
}

export interface HostLogReadOptions {
  filter?: PluginLogFilter
  limit?: number
}

export interface HostLogSnapshot {
  entries: PluginLogEntry[]
  totalBuffered: number
  filePath?: string
  fileError?: string
}

export interface HostLogStoreOptions {
  filePath?: string
  maxEntries?: number
  maxFileBytes?: number
  maxBackups?: number
}

export interface ResolveHostLogPathOptions {
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
  profile?: string
}

const DEFAULT_MAX_ENTRIES = 1000
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_BACKUPS = 2
const MAX_LINE_CHARS = 8192
const TAIL_READ_BYTES = 512 * 1024

export function resolveHostLogPath(options: ResolveHostLogPathOptions = {}): string {
  const env = options.env ?? process.env
  const home = env.DSH_HOME || join(options.homeDirectory ?? homedir(), '.dsh')
  const rawProfile = options.profile ?? env.DSH_PROFILE ?? ''
  const profileSlug = rawProfile
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'host'
  return join(home, 'logs', 'ds-harness-remote', `${profileSlug}.log`)
}

export class HostLogStore {
  readonly filePath?: string
  private readonly maxEntries: number
  private readonly maxFileBytes: number
  private readonly maxBackups: number
  private liveEntries: PluginLogEntry[] = []
  private persistedEntries: PluginLogEntry[] = []
  private nextSeq = 1
  private currentBytes = 0
  private fileError?: string
  private writeChain: Promise<void> = Promise.resolve()
  private readonly initPromise: Promise<void>
  private clearedBeforeInit = false
  private sizeVerified = false

  constructor(options: HostLogStoreOptions = {}) {
    this.filePath = options.filePath
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
    this.maxFileBytes = Math.max(1024, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)
    this.maxBackups = Math.max(0, options.maxBackups ?? DEFAULT_MAX_BACKUPS)
    this.initPromise = this.loadInitialFile()
    this.writeChain = this.initPromise.catch(() => undefined)
  }

  record(level: LogLevel, message: string, now: Date = new Date()): void {
    const timestamp = now.toISOString()
    const clean = sanitizeLogMessage(message)
    const line = `${timestamp} [${level.toUpperCase()}] ${clean}`
    const entry: PluginLogEntry = {
      seq: this.nextSeq++,
      timestamp,
      level,
      line,
    }
    this.liveEntries.push(entry)
    this.trimInMemory()

    if (this.filePath !== undefined) {
      const payload = `${line}\n`
      this.enqueueWrite(async () => {
        await this.appendToDisk(payload)
      })
    }
  }

  async snapshot(options: HostLogReadOptions = {}): Promise<HostLogSnapshot> {
    await this.initPromise.catch(() => undefined)
    const filter = options.filter ?? 'all'
    const limit = Math.min(this.maxEntries, Math.max(1, options.limit ?? 500))
    const combined = this.combinedEntries()
    const filtered = filter === 'warn'
      ? combined.filter(entry => entry.level === 'warn' || entry.level === 'error')
      : combined
    const entries = filtered.length > limit ? filtered.slice(-limit) : filtered
    return {
      entries,
      totalBuffered: combined.length,
      ...(this.filePath === undefined ? {} : { filePath: this.filePath }),
      ...(this.fileError === undefined ? {} : { fileError: this.fileError }),
    }
  }

  async clear(): Promise<HostLogSnapshot> {
    this.clearedBeforeInit = true
    this.persistedEntries = []
    this.liveEntries = []
    if (this.filePath !== undefined) {
      this.enqueueWrite(async () => {
        await this.clearDisk()
      })
      await this.writeChain
    }
    const entries = this.combinedEntries()
    return {
      entries,
      totalBuffered: entries.length,
      ...(this.filePath === undefined ? {} : { filePath: this.filePath }),
      ...(this.fileError === undefined ? {} : { fileError: this.fileError }),
    }
  }

  async flush(): Promise<void> {
    await this.writeChain
  }

  private enqueueWrite(task: () => Promise<void>): void {
    this.writeChain = this.writeChain.then(async () => {
      try {
        await task()
        this.fileError = undefined
      } catch (error) {
        this.fileError = safeFsErrorMessage(error)
      }
    })
  }

  private async loadInitialFile(): Promise<void> {
    if (this.filePath === undefined) return
    try {
      const info = await stat(this.filePath)
      this.currentBytes = info.size
      this.sizeVerified = true
      if (this.clearedBeforeInit || info.size === 0) return
      const text = await readTailUtf8(this.filePath, info.size, TAIL_READ_BYTES)
      if (this.clearedBeforeInit) return
      const lines = text.split(/\r?\n/).filter(line => line.length > 0)
      const tail = lines.slice(-this.maxEntries)
      const parsed: PluginLogEntry[] = []
      let seqBase = 1
      for (const line of tail) {
        parsed.push(parsePersistedLine(line, seqBase++))
      }
      this.persistedEntries = parsed
      let next = parsed.length + 1
      for (const entry of this.liveEntries) {
        entry.seq = next++
      }
      this.nextSeq = next
      this.trimInMemory()
    } catch (error) {
      if (isEnoent(error)) {
        this.currentBytes = 0
        this.sizeVerified = true
        return
      }
      this.fileError = safeFsErrorMessage(error)
    }
  }

  private async appendToDisk(payload: string): Promise<void> {
    const target = this.filePath!
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    if (!this.sizeVerified) {
      const existing = await stat(target).catch(err => (isEnoent(err) ? undefined : Promise.reject(err)))
      this.currentBytes = existing?.size ?? 0
      this.sizeVerified = true
    }
    const byteLength = Buffer.byteLength(payload, 'utf8')
    if (this.currentBytes > 0 && this.currentBytes + byteLength > this.maxFileBytes) {
      await this.rotateFiles(target)
    }
    await writeFile(target, payload, { encoding: 'utf8', flag: 'a', mode: 0o600 })
    this.currentBytes += byteLength
  }

  private async rotateFiles(target: string): Promise<void> {
    if (this.maxBackups === 0) {
      await writeFile(target, '', { encoding: 'utf8', mode: 0o600 })
      this.currentBytes = 0
      return
    }
    for (let index = this.maxBackups; index >= 1; index--) {
      const dest = `${target}.${index}`
      const src = index === 1 ? target : `${target}.${index - 1}`
      if (index === this.maxBackups) {
        await rm(dest, { force: true }).catch(() => undefined)
      }
      try {
        await rename(src, dest)
      } catch (error) {
        if (!isEnoent(error)) throw error
      }
    }
    this.currentBytes = 0
  }

  private async clearDisk(): Promise<void> {
    const target = this.filePath!
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, '', { encoding: 'utf8', mode: 0o600 })
    this.sizeVerified = true
    for (let index = 1; index <= this.maxBackups; index++) {
      await rm(`${target}.${index}`, { force: true }).catch(() => undefined)
    }
    this.currentBytes = 0
  }

  private combinedEntries(): PluginLogEntry[] {
    if (this.persistedEntries.length === 0) return [...this.liveEntries]
    const merged = [...this.persistedEntries, ...this.liveEntries]
    return merged.length > this.maxEntries ? merged.slice(-this.maxEntries) : merged
  }

  private trimInMemory(): void {
    const total = this.persistedEntries.length + this.liveEntries.length
    if (total <= this.maxEntries) return
    const overflow = total - this.maxEntries
    if (this.persistedEntries.length >= overflow) {
      this.persistedEntries.splice(0, overflow)
    } else {
      const remaining = overflow - this.persistedEntries.length
      this.persistedEntries = []
      this.liveEntries.splice(0, remaining)
    }
  }
}

function sanitizeLogMessage(message: string): string {
  const collapsed = message.replace(/[\r\n]+/g, ' ').trimEnd()
  if (collapsed.length <= MAX_LINE_CHARS) return collapsed
  return `${collapsed.slice(0, MAX_LINE_CHARS)}...`
}

function parsePersistedLine(line: string, seq: number): PluginLogEntry {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+\[(DEBUG|INFO|WARN|ERROR)\]\s+(.*)$/)
  if (match === null) {
    return { seq, timestamp: '', level: 'info', line }
  }
  const level = match[2]!.toLowerCase() as LogLevel
  return {
    seq,
    timestamp: match[1]!,
    level,
    line,
  }
}

async function readTailUtf8(filePath: string, totalSize: number, maxBytes: number): Promise<string> {
  if (totalSize <= maxBytes) {
    return readFile(filePath, 'utf8')
  }
  const handle = await open(filePath, 'r')
  try {
    const start = totalSize - maxBytes
    const buffer = Buffer.allocUnsafe(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, start)
    const raw = buffer.subarray(0, bytesRead).toString('utf8')
    const firstNewline = raw.indexOf('\n')
    return firstNewline === -1 ? raw : raw.slice(firstNewline + 1)
  } finally {
    await handle.close()
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

function safeFsErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return 'Failed to write log file.'
}
