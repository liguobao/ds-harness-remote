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
  /** Legacy protobuf trajectory (older Antigravity desktop/CLI). */
  pb?: string
  /** Newer SQLite trajectory store: conversations/<id>.db plus its WAL/SHM. */
  db?: string
  /** mtime of the newest trajectory-related file inside conversations/. */
  trajectoryMtimeMs: number
}

interface TrajectoryFiles {
  /** Absolute path to <id>.db when it exists. */
  db?: string
  /** Absolute path to <id>.pb when it exists. */
  pb?: string
  /** Newest mtime among the main store file and its WAL/SHM sidecars. */
  mtimeMs: number
}

/**
 * Newer Antigravity releases store the session trajectory as a SQLite database
 * (`conversations/<id>.db`, WAL mode) instead of the legacy `<id>.pb`
 * protobuf. Detect both, including an uncheckpointed `-wal`, so a session whose
 * steps live only in the WAL is still recognised as present and fresh.
 */
async function trajectoryFiles(end: AntigravityEnd, conversationId: string): Promise<TrajectoryFiles> {
  const base = join(end.conversationsDir, conversationId)
  const db = `${base}.db`
  const pb = `${base}.pb`
  const stats = await Promise.all([
    fs.stat(db).catch(() => undefined),
    fs.stat(`${db}-wal`).catch(() => undefined),
    fs.stat(`${db}-shm`).catch(() => undefined),
    fs.stat(pb).catch(() => undefined),
  ])
  const [dbStat, walStat, shmStat, pbStat] = stats
  let mtimeMs = 0
  for (const stat of [dbStat, walStat, shmStat, pbStat]) {
    if (stat !== undefined) mtimeMs = Math.max(mtimeMs, stat.mtimeMs)
  }
  return {
    ...(dbStat === undefined ? {} : { db }),
    ...(pbStat === undefined ? {} : { pb }),
    mtimeMs,
  }
}

async function sessionStamp(end: AntigravityEnd, conversationId: string): Promise<SessionStamp> {
  const transcript = await resolveTranscriptPath(end.brainDir, conversationId)
  const trajectory = await trajectoryFiles(end, conversationId)
  const transcriptStat = transcript === undefined ? undefined : await fs.stat(transcript).catch(() => undefined)
  let mtimeMs = Math.max(transcriptStat?.mtimeMs ?? 0, trajectory.mtimeMs)
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
    present: transcript !== undefined || trajectory.db !== undefined || trajectory.pb !== undefined || hasDbRow,
    mtimeMs,
    trajectoryMtimeMs: trajectory.mtimeMs,
    ...(transcript === undefined ? {} : { transcript }),
    ...(trajectory.pb === undefined ? {} : { pb: trajectory.pb }),
    ...(trajectory.db === undefined ? {} : { db: trajectory.db }),
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

/** Result of exporting a live WAL-mode SQLite trajectory into a single file. */
interface SqliteExportResult {
  ok: boolean
  method?: string
  error?: unknown
}

/**
 * Export a WAL-mode SQLite store into a single self-contained file at `out`
 * WITHOUT opening the source for writing (which would risk checkpointing or
 * touching the live desktop WAL). Tries, in order:
 *   1. `sqlite3 "file:<src>?mode=ro" "VACUUM INTO '<out>'"` — a consistent
 *      read transaction that folds the WAL into one file (preferred).
 *   2. node:sqlite read-only `VACUUM INTO` for closed databases.
 *   3. a physical copy of `<src>`, `-wal`, `-shm` together; SQLite replays the
 *      WAL on next open, so steps not yet checkpointed are preserved.
 */
async function exportSqlite(dbPath: string, out: string): Promise<SqliteExportResult> {
  const removeOut = () => fs.rm(out, { force: true }).catch(() => undefined)
  let vacuumError: unknown
  await removeOut()

  try {
    await execFileAsync('sqlite3', ['-uri', `file:${dbPath}?mode=ro`, `VACUUM INTO '${out.replace(/'/g, "''")}'`], { timeout: 120_000 })
    const stat = await fs.stat(out).catch(() => undefined)
    if (stat !== undefined && stat.size > 0) return { ok: true, method: 'vacuum-into-cli' }
  } catch (error) {
    // Fall through to the node:sqlite attempt.
    await removeOut()
    vacuumError = error
  }

  try {
    const db = new (sqlite().DatabaseSync)(dbPath, { readOnly: true, timeout: 5_000 })
    try {
      db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`)
    } finally {
      db.close()
    }
    const stat = await fs.stat(out).catch(() => undefined)
    if (stat !== undefined && stat.size > 0) return { ok: true, method: 'vacuum-into-node' }
  } catch (error) {
    await removeOut()
    vacuumError = vacuumError ?? error
  }

  try {
    await fs.copyFile(dbPath, out)
    for (const suffix of ['-wal', '-shm']) {
      // Sidecars must coexist with the exported main file for WAL replay.
      const sidecar = `${out}${suffix}`
      await fs.copyFile(`${dbPath}${suffix}`, sidecar).catch(() => fs.rm(sidecar, { force: true }).catch(() => undefined))
    }
    return { ok: true, method: 'physical-copy-with-wal' }
  } catch (error) {
    await removeOut()
    return { ok: false, error: error ?? vacuumError }
  }
}

/**
 * Copy a SQLite trajectory into the destination without ever rewriting the
 * live source. Writes to a temp path then atomically renames, and clears any
 * stale destination `-wal`/`-shm` so a fresh export is not merged with leftover
 * pages from an older copy.
 */
async function copyTrajectoryDb(srcDb: string, dstDb: string, copiedFiles: string[], label: string): Promise<void> {
  await fs.mkdir(dirname(dstDb), { recursive: true })
  const temp = join(dirname(dstDb), `.${basename(dstDb)}.agy-sync-${randomUUID()}.tmp`)
  try {
    const result = await exportSqlite(srcDb, temp)
    if (!result.ok) {
      throw new AntigravitySessionSyncError('TRAJECTORY_EXPORT_FAILED',
        `Failed to export the desktop SQLite trajectory for ${label}.`, { cause: result.error })
    }
    // Drop stale sidecars before swapping in the new self-contained file.
    for (const suffix of ['-wal', '-shm']) {
      await fs.rm(`${dstDb}${suffix}`, { force: true }).catch(() => undefined)
    }
    await fs.rename(temp, dstDb)
    copiedFiles.push(`${label} (${result.method ?? 'sqlite'})`)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    await fs.rm(`${temp}-wal`, { force: true }).catch(() => undefined)
    await fs.rm(`${temp}-shm`, { force: true }).catch(() => undefined)
  }
}

/**
 * One-way copy between two Antigravity roots. The source is only ever read;
 * the destination database row is replaced inside a transaction with a
 * byte-level backup for rollback. Files already newer at the destination win.
 *
 * A "complete" trajectory session is only considered current when the
 * destination actually carries its trajectory store (`.db` or `.pb`). A prior
 * patch run could leave `brain/` and the summaries row on the destination while
 * the trajectory file is missing; that incomplete state must be completed
 * rather than skipped.
 */
async function copySession(
  source: AntigravityEnd,
  destination: AntigravityEnd,
  conversationId: string,
  sourceLabel: string,
  destinationLabel: string,
): Promise<SessionSyncResult> {
  const [sourceStamp, destinationStamp] = await Promise.all([
    sessionStamp(source, conversationId),
    sessionStamp(destination, conversationId),
  ])
  if (!sourceStamp.present) {
    return { status: 'noop', reason: `session is not present on ${sourceLabel}`, copiedFiles: [] }
  }
  const sourceTrajectory = sourceStamp.db ?? sourceStamp.pb
  const destinationTrajectory = destinationStamp.db ?? destinationStamp.pb
  // The destination is only truly current when it already carries a trajectory
  // store of the same kind as the source, and that store is not older than the
  // source's trajectory bytes. A summaries row or brain directory alone is not
  // enough: a prior partial sync can leave those behind while the trajectory
  // file is missing, which is exactly the state that must be completed here.
  const sameKind = (sourceStamp.db !== undefined && destinationStamp.db !== undefined)
    || (sourceStamp.db === undefined && sourceStamp.pb !== undefined && destinationStamp.pb !== undefined)
  const destinationComplete = sameKind
    && destinationTrajectory !== undefined
    && destinationStamp.trajectoryMtimeMs >= sourceStamp.trajectoryMtimeMs
  if (destinationComplete) {
    return { status: 'skipped', reason: `${destinationLabel} session is already current`, copiedFiles: [] }
  }

  const copiedFiles: string[] = []
  if (sourceStamp.db !== undefined) {
    await copyTrajectoryDb(
      sourceStamp.db,
      join(destination.conversationsDir, `${conversationId}.db`),
      copiedFiles,
      `conversations/${conversationId}.db`,
    )
  }
  if (sourceStamp.pb !== undefined) {
    await copyIfNewer(
      sourceStamp.pb,
      join(destination.conversationsDir, `${conversationId}.pb`),
      copiedFiles,
      `conversations/${conversationId}.pb`,
    )
  }
  await copyBrainTree(
    join(source.brainDir, conversationId),
    join(destination.brainDir, conversationId),
    copiedFiles,
  )
  await writeSummaryRow(source.dbPath, destination.dbPath, conversationId)
  return { status: 'synced', reason: `${sourceLabel} session copied into ${destinationLabel}`, copiedFiles }
}

function validSyncId(conversationId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,256}$/.test(conversationId)
}

/** Resume-time migration of a desktop-only session into the CLI data root. */
export async function syncDesktopSessionForResume(
  conversationId: string,
  options: SessionSyncOptions = {},
): Promise<SessionSyncResult> {
  if (!validSyncId(conversationId)) {
    return { status: 'noop', reason: 'invalid conversation id', copiedFiles: [] }
  }
  const { desktop, cli } = endsForSync(options)
  return copySession(desktop, cli, conversationId, 'desktop', 'CLI')
}

/**
 * Mirror a completed CLI turn back into the desktop data root so the desktop
 * application shows messages written by `agy --conversation <id>`.
 */
export async function syncCliSessionToDesktop(
  conversationId: string,
  options: SessionSyncOptions = {},
): Promise<SessionSyncResult> {
  if (!validSyncId(conversationId)) {
    return { status: 'noop', reason: 'invalid conversation id', copiedFiles: [] }
  }
  const { desktop, cli } = endsForSync(options)
  return copySession(cli, desktop, conversationId, 'CLI', 'desktop')
}

/** Whether the CLI root already has a usable copy of a conversation. */
export async function hasCliSession(conversationId: string, options: SessionSyncOptions = {}): Promise<boolean> {
  if (!validSyncId(conversationId)) return false
  const { cli } = endsForSync(options)
  const stamp = await sessionStamp(cli, conversationId)
  // A summaries row or a brain directory alone is not resumable: `agy` reloads
  // the trajectory store, so require an actual `.db`/`.pb` on the CLI side.
  return stamp.db !== undefined || stamp.pb !== undefined
}
