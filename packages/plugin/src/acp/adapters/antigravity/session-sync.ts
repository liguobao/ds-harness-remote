import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import {
  antigravityEnds,
  resolveTranscriptPath,
  type AntigravityEnd,
  type AntigravityPathOverrides,
} from './antigravity-paths.js'

const nodeRequire = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const SUMMARY_TABLE = 'conversation_summaries'

export class AntigravitySessionSyncError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AntigravitySessionSyncError'
  }
}

export interface SessionSyncOptions extends AntigravityPathOverrides {
  /** Override individual CLI paths (used by the ACP client's isolated brainDir). */
  cliBrainDir?: string
  cliDbPath?: string
  cliConversationsDir?: string
  desktopBrainDir?: string
  desktopDbPath?: string
  desktopConversationsDir?: string
}

export interface SessionSyncResult {
  status: 'synced' | 'skipped' | 'noop'
  reason: string
  copiedFiles: string[]
}

interface SqliteBackup {
  tempDir: string
  present: readonly string[]
}

type SqlValue = string | number | bigint | null | Uint8Array

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean; timeout?: number }) => {
    prepare(sql: string): {
      all(...params: SqlValue[]): Record<string, unknown>[]
      run(...params: SqlValue[]): unknown
    }
    exec(sql: string): void
    close(): void
  }
}

function sqlite(): SqliteModule {
  try {
    return nodeRequire('node:sqlite') as SqliteModule
  } catch (error) {
    throw new AntigravitySessionSyncError('SQLITE_UNAVAILABLE', 'node:sqlite is unavailable for Antigravity session sync.', { cause: error })
  }
}

function endsForSync(options: SessionSyncOptions): { desktop: AntigravityEnd; cli: AntigravityEnd } {
  const [desktopDefault, cliDefault] = antigravityEnds(options)
  return {
    desktop: {
      ...desktopDefault!,
      dbPath: options.desktopDbPath ?? desktopDefault!.dbPath,
      brainDir: options.desktopBrainDir ?? desktopDefault!.brainDir,
      conversationsDir: options.desktopConversationsDir ?? desktopDefault!.conversationsDir,
    },
    cli: {
      ...cliDefault!,
      dbPath: options.cliDbPath ?? cliDefault!.dbPath,
      brainDir: options.cliBrainDir ?? cliDefault!.brainDir,
      conversationsDir: options.cliConversationsDir ?? cliDefault!.conversationsDir,
    },
  }
}

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return String(value)
}

function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new AntigravitySessionSyncError('SCHEMA_MISMATCH', `Unsafe column name in Antigravity summaries: ${name}`)
  }
  return `"${name}"`
}

/**
 * Read a row from a database without ever opening the source for writing.
 * A read-only node:sqlite connection handles normal WAL databases; when the
 * desktop WAL/SHM sidecars are incomplete we read a byte-for-byte snapshot in
 * a temporary directory instead of touching the live desktop files.
 */
async function readSqlite(dbPath: string, sql: string, params: SqlValue[] = []): Promise<Record<string, unknown>[]> {
  try {
    const db = new (sqlite().DatabaseSync)(dbPath, { readOnly: true, timeout: 2_000 })
    try {
      return db.prepare(sql).all(...params)
    } finally {
      db.close()
    }
  } catch {
    // Fall through to a read-only CLI URI, then to a snapshot copy.
  }

  try {
    let literalSql = sql
    for (const param of params) {
      const literal = param === null ? 'NULL'
        : typeof param === 'number' || typeof param === 'bigint' ? String(param)
          : `'${Buffer.from(param).toString('utf8').replace(/'/g, "''")}'`
      literalSql = literalSql.replace('?', literal)
    }
    const uri = `file:${dbPath}?mode=ro`
    const { stdout } = await execFileAsync('sqlite3', ['-uri', uri, '-json', literalSql], { timeout: 10_000 })
    return JSON.parse(stdout || '[]') as Record<string, unknown>[]
  } catch {
    // Last resort: copy db/WAL/SHM into a private temp dir and read there.
  }

  const tempDir = await fs.mkdtemp(join(tmpdir(), 'agy-sync-read-'))
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      await fs.copyFile(`${dbPath}${suffix}`, join(tempDir, `db${suffix}`)).catch(() => undefined)
    }
    const db = new (sqlite().DatabaseSync)(join(tempDir, 'db'), { timeout: 2_000 })
    try {
      return db.prepare(sql).all(...params)
    } finally {
      db.close()
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function readSummaryRow(dbPath: string, conversationId: string): Promise<Record<string, unknown> | undefined> {
  const rows = await readSqlite(dbPath,
    `SELECT * FROM ${SUMMARY_TABLE} WHERE conversation_id = ? LIMIT 1`, [conversationId])
  return rows[0]
}

async function readColumns(dbPath: string): Promise<string[]> {
  const rows = await readSqlite(dbPath, `PRAGMA table_info(${SUMMARY_TABLE})`)
  return rows.map(row => String(row.name)).filter(Boolean)
}

async function readTableSql(dbPath: string): Promise<string | undefined> {
  const rows = await readSqlite(dbPath,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [SUMMARY_TABLE])
  return typeof rows[0]?.sql === 'string' ? rows[0].sql : undefined
}

async function backupSqlite(dbPath: string): Promise<SqliteBackup> {
  const tempDir = await fs.mkdtemp(join(tmpdir(), 'agy-sync-backup-'))
  const present: string[] = []
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      await fs.copyFile(`${dbPath}${suffix}`, join(tempDir, suffix === '' ? 'db' : `db${suffix}`))
      present.push(suffix)
    } catch {
      // Sidecars are optional.
    }
  }
  return { tempDir, present }
}

async function restoreSqlite(dbPath: string, backup: SqliteBackup): Promise<void> {
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${dbPath}${suffix}`
    if (backup.present.includes(suffix)) {
      await fs.copyFile(join(backup.tempDir, suffix === '' ? 'db' : `db${suffix}`), target).catch(() => undefined)
    } else {
      await fs.rm(target, { force: true }).catch(() => undefined)
    }
  }
  await fs.rm(backup.tempDir, { recursive: true, force: true }).catch(() => undefined)
}

/** Replace exactly one summaries row inside a transaction; restore on any failure. */
async function writeSummaryRow(desktopDb: string, cliDb: string, conversationId: string): Promise<void> {
  const row = await readSummaryRow(desktopDb, conversationId)
  if (row === undefined) {
    throw new AntigravitySessionSyncError('ROW_MISSING', `Desktop summaries have no row for conversation ${conversationId}.`)
  }
  const desktopColumns = await readColumns(desktopDb)
  if (desktopColumns.length === 0) {
    throw new AntigravitySessionSyncError('SCHEMA_MISMATCH', 'Desktop conversation_summaries table has no readable columns.')
  }
  if (!existsSync(cliDb)) {
    const createSql = await readTableSql(desktopDb)
    if (createSql === undefined) {
      throw new AntigravitySessionSyncError('SCHEMA_MISMATCH', 'Desktop conversation_summaries schema is unavailable.')
    }
    await fs.mkdir(dirname(cliDb), { recursive: true })
    const fresh = new (sqlite().DatabaseSync)(cliDb)
    try { fresh.exec(createSql) } finally { fresh.close() }
  }
  const cliColumns = await readColumns(cliDb)
  const missing = desktopColumns.filter(column => !cliColumns.includes(column))
  if (missing.length > 0) {
    throw new AntigravitySessionSyncError('SCHEMA_MISMATCH',
      `CLI conversation_summaries is missing columns required by desktop: ${missing.join(', ')}`)
  }

  const columns = desktopColumns.filter(column => column in row)
  const backup = await backupSqlite(cliDb)
  let transactionStarted = false
  let rollbackVerified = true
  try {
    const db = new (sqlite().DatabaseSync)(cliDb, { timeout: 2_000 })
    try {
      db.exec('BEGIN IMMEDIATE')
      transactionStarted = true
      try {
        db.prepare(`DELETE FROM ${SUMMARY_TABLE} WHERE conversation_id = ?`).run(conversationId)
        db.prepare(`INSERT INTO ${SUMMARY_TABLE} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
          .run(...columns.map(column => toSqlValue(row[column])))
        db.exec('COMMIT')
        transactionStarted = false
      } catch (error) {
        try {
          db.exec('ROLLBACK')
          transactionStarted = false
        } catch {
          // The file-level backup is the last resort only when SQL rollback failed.
          rollbackVerified = false
        }
        throw error
      }
    } finally {
      db.close()
    }
  } catch (error) {
    // Never overwrite the whole CLI database after a clean SQL rollback: another
    // agy process may have written to it while this transaction was open.
    if (transactionStarted || !rollbackVerified) await restoreSqlite(cliDb, backup)
    throw new AntigravitySessionSyncError('DB_WRITE_FAILED', 'Failed to copy the desktop summary row into the CLI database.', { cause: error })
  } finally {
    await fs.rm(backup.tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

interface SessionStamp {
  present: boolean
  mtimeMs: number
  transcript?: string
  pb?: string
}

async function sessionStamp(end: AntigravityEnd, conversationId: string): Promise<SessionStamp> {
  const transcript = await resolveTranscriptPath(end.brainDir, conversationId)
  const pb = join(end.conversationsDir, `${conversationId}.pb`)
  const stats = await Promise.all([
    transcript === undefined ? Promise.resolve(undefined) : fs.stat(transcript).catch(() => undefined),
    fs.stat(pb).catch(() => undefined),
  ])
  let mtimeMs = Math.max(stats[0]?.mtimeMs ?? 0, stats[1]?.mtimeMs ?? 0)
  let hasDbRow = false
  try {
    const row = await readSummaryRow(end.dbPath, conversationId)
    if (row !== undefined) {
      hasDbRow = true
      const modified = typeof row.last_modified_time === 'string' ? Date.parse(row.last_modified_time) : Number.NaN
      if (Number.isFinite(modified)) mtimeMs = Math.max(mtimeMs, modified)
    }
  } catch {
    // A missing/unreadable database is not a session by itself.
  }
  return {
    present: transcript !== undefined || stats[1] !== undefined || hasDbRow,
    mtimeMs,
    ...(transcript === undefined ? {} : { transcript }),
    ...(stats[1] === undefined ? {} : { pb }),
  }
}

async function copyIfNewer(src: string, dst: string, copiedFiles: string[], label: string): Promise<void> {
  let srcStat
  try { srcStat = await fs.stat(src) } catch { return }
  let dstStat
  try { dstStat = await fs.stat(dst) } catch { /* missing destination */ }
  // An existing, equally fresh or newer CLI file wins: never overwrite a
  // session that agy has already advanced.
  if (dstStat !== undefined && dstStat.mtimeMs >= srcStat.mtimeMs) return
  await fs.mkdir(dirname(dst), { recursive: true })
  const temp = join(dirname(dst), `.${basename(dst)}.agy-sync-${randomUUID()}.tmp`)
  try {
    await fs.copyFile(src, temp)
    await fs.rename(temp, dst)
    copiedFiles.push(label)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined)
  }
}

async function copyBrainTree(srcDir: string, dstDir: string, copiedFiles: string[]): Promise<void> {
  let entries
  try { entries = await fs.readdir(srcDir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    // Symlinks can escape the brain root; never follow them during a sync.
    if (entry.isSymbolicLink()) continue
    const src = join(srcDir, entry.name)
    const dst = join(dstDir, entry.name)
    if (entry.isDirectory()) {
      await copyBrainTree(src, dst, copiedFiles)
    } else if (entry.isFile()) {
      await copyIfNewer(src, dst, copiedFiles, `brain/${entry.name}`)
    }
  }
}

/**
 * One-way, resume-time migration of a desktop-only Antigravity session into
 * the CLI data root. The desktop root is only ever read; the CLI database row
 * is replaced inside a transaction with a byte-level backup for rollback.
 */
export async function syncDesktopSessionForResume(
  conversationId: string,
  options: SessionSyncOptions = {},
): Promise<SessionSyncResult> {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(conversationId)) {
    return { status: 'noop', reason: 'invalid conversation id', copiedFiles: [] }
  }
  const { desktop, cli } = endsForSync(options)
  const [desktopStamp, cliStamp] = await Promise.all([
    sessionStamp(desktop, conversationId),
    sessionStamp(cli, conversationId),
  ])
  if (!desktopStamp.present) {
    return { status: 'noop', reason: 'session is not present on desktop', copiedFiles: [] }
  }
  if (cliStamp.present && cliStamp.mtimeMs >= desktopStamp.mtimeMs) {
    return { status: 'skipped', reason: 'CLI session is already current', copiedFiles: [] }
  }

  const copiedFiles: string[] = []
  await copyIfNewer(
    join(desktop.conversationsDir, `${conversationId}.pb`),
    join(cli.conversationsDir, `${conversationId}.pb`),
    copiedFiles,
    `conversations/${conversationId}.pb`,
  )
  await copyBrainTree(
    join(desktop.brainDir, conversationId),
    join(cli.brainDir, conversationId),
    copiedFiles,
  )
  await writeSummaryRow(desktop.dbPath, cli.dbPath, conversationId)
  return { status: 'synced', reason: 'desktop session copied into CLI', copiedFiles }
}

/** Whether the CLI root already has a usable copy of a conversation. */
export async function hasCliSession(conversationId: string, options: SessionSyncOptions = {}): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(conversationId)) return false
  const { cli } = endsForSync(options)
  return (await sessionStamp(cli, conversationId)).present
}
