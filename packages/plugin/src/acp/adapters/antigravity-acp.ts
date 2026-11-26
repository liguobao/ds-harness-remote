import { randomUUID } from 'node:crypto'
import { constants as fsConstants, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { SafeLogger } from '../../logging.js'
import { execFileCommand } from '../windows-spawn.js'
import { loadTranscriptEvents } from './antigravity/transcript-loader.js'
import { ClaudeAcpClient } from './claude-process.js'
import { CursorAcpError, type CursorAcpClient, type CursorAcpOptions, type SpawnCursorAcp } from './cursor-process.js'

const NEGATIVE_CACHE_TTL_MS = 30_000
const NATIVE_PROBE_TIMEOUT_MS = 5_000
const SQLITE_BACKUP_TIMEOUT_MS = 15_000
const MAX_BRAIN_COPY_FILE_BYTES = 32 * 1024 * 1024
const MAX_BRAIN_COPY_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_BRAIN_COPY_FILES = 512
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,256}$/
const nativeAcpSupportCache = new Map<string, { promise: Promise<boolean>; expiresAt?: number }>()
const nodeRequire = createRequire(import.meta.url)

function readCliFlagValue(args: readonly string[] | undefined, names: readonly string[]): string | undefined {
  if (!args || args.length === 0) return undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    for (const name of names) {
      if (arg === name) {
        const next = args[i + 1]
        if (next !== undefined && next.trim() !== '') return next.trim()
      } else if (arg.startsWith(`${name}=`)) {
        const value = arg.slice(name.length + 1).trim()
        if (value !== '') return value
      }
    }
  }
  return undefined
}

function resolveAntigravityAppDirs(
  args: readonly string[] | undefined,
  options: Pick<AntigravityNativeAcpOptions, 'desktopAppDir' | 'cliAppDir'>,
): { desktopAppDir: string; cliAppDir: string } {
  const home = homedir()
  const geminiFlag = readCliFlagValue(args, ['--gemini-dir', '--gemini_dir']) ?? '.gemini'
  const geminiRoot = isAbsolute(geminiFlag) ? resolve(geminiFlag) : resolve(home, geminiFlag)
  const appDataFlag = readCliFlagValue(args, ['--app-data-dir', '--app_data_dir']) ?? 'antigravity-cli'
  const cliAppDir = options.cliAppDir ?? (isAbsolute(appDataFlag) ? resolve(appDataFlag) : join(geminiRoot, appDataFlag))
  const desktopAppDir = options.desktopAppDir ?? join(geminiRoot, 'antigravity')
  return { desktopAppDir, cliAppDir }
}

function defaultAntigravityBrainDirs(desktopAppDir: string, cliAppDir: string): string[] {
  const dirs = [join(desktopAppDir, 'brain')]
  const cliBrain = join(cliAppDir, 'brain')
  if (resolve(cliBrain) !== resolve(dirs[0]!)) {
    dirs.push(cliBrain)
  }
  return dirs
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function isRegularFileInside(rootDir: string, fileName: string): Promise<string | undefined> {
  try {
    const realRoot = await fs.realpath(rootDir)
    const candidate = join(realRoot, fileName)
    const stat = await fs.lstat(candidate)
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined
    const realCandidate = await fs.realpath(candidate)
    return realCandidate === candidate ? realCandidate : undefined
  } catch {
    return undefined
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch {
    return false
  }
}

async function hasNonEmptyWal(dbPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(`${dbPath}-wal`)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

async function snapshotSqliteDb(sourceDb: string, tempDb: string): Promise<void> {
  if (!await hasNonEmptyWal(sourceDb)) {
    await fs.copyFile(sourceDb, tempDb)
    return
  }

  let backedUp = false
  try {
    const sqlite = nodeRequire('node:sqlite') as typeof import('node:sqlite') & {
      backup?: (sourceDb: import('node:sqlite').DatabaseSync, destination: string) => Promise<number>
    }
    if (typeof sqlite.backup === 'function') {
      const src = new sqlite.DatabaseSync(sourceDb, { readOnly: true })
      try {
        await sqlite.backup(src, tempDb)
      } finally {
        src.close()
      }
      const dst = new sqlite.DatabaseSync(tempDb)
      try {
        dst.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;')
      } finally {
        dst.close()
      }
      backedUp = true
    }
  } catch {
    // Fall through to sqlite3 CLI or raw copy fallback.
  }

  if (!backedUp) {
    try {
      const escapedDest = tempDb.replace(/["\\]/g, '\\$&')
      await execFileCommand('sqlite3', [sourceDb, '.timeout 5000', `.backup "${escapedDest}"`], {
        timeout: SQLITE_BACKUP_TIMEOUT_MS,
        windowsHide: true,
      })
      backedUp = true
    } catch {
      await fs.copyFile(sourceDb, tempDb)
    }
  }

  await Promise.all([
    fs.unlink(`${tempDb}-wal`).catch(() => undefined),
    fs.unlink(`${tempDb}-shm`).catch(() => undefined),
  ])
}

async function installFileAtomically(tempPath: string, targetPath: string): Promise<boolean> {
  try {
    await fs.link(tempPath, targetPath)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EEXIST') return false
    if (code === 'EPERM' || code === 'EXDEV' || code === 'ENOTSUP' || code === 'EINVAL') {
      try {
        await fs.copyFile(tempPath, targetPath, fsConstants.COPYFILE_EXCL)
        return true
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') return false
        throw copyError
      }
    }
    throw error
  }
}

async function copyBrainTreeBestEffort(
  sourceRoot: string,
  targetRoot: string,
  budget: { files: number; bytes: number },
): Promise<void> {
  let realSourceRoot: string
  try {
    const stat = await fs.lstat(sourceRoot)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return
    realSourceRoot = await fs.realpath(sourceRoot)
  } catch {
    return
  }

  const walk = async (currentSource: string, currentTarget: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(currentSource, { withFileTypes: true })
    } catch {
      return
    }
    await fs.mkdir(currentTarget, { recursive: true }).catch(() => undefined)
    for (const entry of entries) {
      if (budget.files <= 0 || budget.bytes <= 0) return
      if (entry.isSymbolicLink()) continue
      const srcPath = join(currentSource, entry.name)
      const dstPath = join(currentTarget, entry.name)
      let realSrc: string
      try {
        realSrc = await fs.realpath(srcPath)
      } catch {
        continue
      }
      const rel = relative(realSourceRoot, realSrc)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue
      if (entry.isDirectory()) {
        await walk(srcPath, dstPath)
      } else if (entry.isFile()) {
        try {
          const info = await fs.lstat(srcPath)
          if (!info.isFile() || info.isSymbolicLink()) continue
          if (info.size > MAX_BRAIN_COPY_FILE_BYTES || info.size > budget.bytes) continue
          await fs.copyFile(srcPath, dstPath, fsConstants.COPYFILE_EXCL)
          budget.files -= 1
          budget.bytes -= info.size
        } catch {
          // Ignore existing files or transient read errors.
        }
      }
    }
  }

  await walk(realSourceRoot, targetRoot)
}

/**
 * Safely import an Antigravity Desktop conversation snapshot into the CLI app_data_dir store
 * so `agy acp` `session/load` and `session/prompt` can operate on it without mutating Desktop data.
 * Returns true if a new copy was imported, false if already present or unavailable.
 */
export async function importDesktopSessionToCli(
  sessionId: string,
  desktopAppDir: string,
  cliAppDir: string,
  logger?: SafeLogger,
): Promise<boolean> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return false
  if (resolve(desktopAppDir) === resolve(cliAppDir)) return false

  const cliConversationsDir = join(cliAppDir, 'conversations')
  const targetDb = join(cliConversationsDir, `${sessionId}.db`)
  if (await fileExists(targetDb)) return false

  const sourceDb = await isRegularFileInside(join(desktopAppDir, 'conversations'), `${sessionId}.db`)
  if (sourceDb === undefined) return false

  await fs.mkdir(cliConversationsDir, { recursive: true, mode: 0o700 })
  const tempDb = join(cliConversationsDir, `.${sessionId}.db.import-${process.pid}-${randomUUID()}.tmp`)
  let imported = false
  try {
    await snapshotSqliteDb(sourceDb, tempDb)
    await fs.chmod(tempDb, 0o600).catch(() => undefined)
    imported = await installFileAtomically(tempDb, targetDb)
  } finally {
    await Promise.all([
      fs.unlink(tempDb).catch(() => undefined),
      fs.unlink(`${tempDb}-wal`).catch(() => undefined),
      fs.unlink(`${tempDb}-shm`).catch(() => undefined),
    ])
  }

  if (imported) {
    // Best-effort copy of annotations and brain artifacts (never overwriting CLI-local files).
    const sourceAnnotation = await isRegularFileInside(join(desktopAppDir, 'annotations'), `${sessionId}.pbtxt`)
    if (sourceAnnotation !== undefined) {
      const cliAnnotationsDir = join(cliAppDir, 'annotations')
      await fs.mkdir(cliAnnotationsDir, { recursive: true }).catch(() => undefined)
      await fs.copyFile(sourceAnnotation, join(cliAnnotationsDir, `${sessionId}.pbtxt`), fsConstants.COPYFILE_EXCL).catch(() => undefined)
    }
    await copyBrainTreeBestEffort(
      join(desktopAppDir, 'brain', sessionId),
      join(cliAppDir, 'brain', sessionId),
      { files: MAX_BRAIN_COPY_FILES, bytes: MAX_BRAIN_COPY_TOTAL_BYTES },
    )
    logger?.info('Imported Antigravity Desktop conversation snapshot into CLI store')
  }

  return imported
}

async function pickFreshestTranscriptDir(brainDirs: readonly string[], sessionId: string): Promise<string | undefined> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return undefined
  let bestDir: string | undefined
  let bestMtime = -1
  for (const dir of brainDirs) {
    try {
      const stat = await fs.stat(join(dir, sessionId, '.system_generated', 'logs', 'transcript.jsonl'))
      if (stat.isFile() && stat.mtimeMs > bestMtime) {
        bestMtime = stat.mtimeMs
        bestDir = dir
      }
    } catch {
      // ignore missing transcript in this brain directory
    }
  }
  return bestDir
}

function isUpstreamRejection(error: unknown): boolean {
  if (error instanceof CursorAcpError) {
    return error.code === 'ANTIGRAVITY_UPSTREAM_ERROR' || error.code.endsWith('_UPSTREAM_ERROR')
  }
  return false
}

/**
 * Check whether the installed Antigravity CLI supports `agy acp`.
 * Positive results are cached for the process lifetime; negative probes expire
 * after a short TTL so an in-place AGY CLI upgrade is picked up without restart.
 */
export function supportsAntigravityNativeAcp(binary: string = 'agy'): Promise<boolean> {
  const key = binary.trim() || 'agy'
  const cached = nativeAcpSupportCache.get(key)
  if (cached && (cached.expiresAt === undefined || cached.expiresAt > Date.now())) {
    return cached.promise
  }
  const entry: { promise: Promise<boolean>; expiresAt?: number } = {
    promise: execFileCommand(key, ['acp', '--help'], {
      timeout: NATIVE_PROBE_TIMEOUT_MS,
      windowsHide: true,
    }).then(
      () => true,
      () => {
        entry.expiresAt = Date.now() + NEGATIVE_CACHE_TTL_MS
        return false
      },
    ),
  }
  nativeAcpSupportCache.set(key, entry)
  return entry.promise
}

export function isLegacyAntigravityStreamJsonArgs(args: readonly string[] | undefined): boolean {
  if (!args || args.length === 0) return false
  return args.includes('--input-format') || args.includes('stream-json')
}

export interface AntigravityNativeAcpOptions extends Pick<CursorAcpOptions, 'args' | 'cwd'> {
  brainDirs?: readonly string[]
  desktopAppDir?: string
  cliAppDir?: string
}

/**
 * Native Antigravity ACP stdio client (`agy acp`).
 * Uses standard JSON-RPC ACP (`session/list`, `session/load`, `session/resume`, `session/new`,
 * `session/prompt` with image blocks, `session/set_mode`, `session/set_config_option`,
 * `usage_update`, `available_commands_update`, and `session/cancel` notifications).
 *
 * Antigravity Desktop stores conversations under `~/.gemini/antigravity/conversations/<id>.db`,
 * whereas `agy acp` defaults to `~/.gemini/antigravity-cli/`. `agy acp` lists Desktop sessions
 * via fallback directories, but `session/load` and `session/prompt` fail unless the trajectory
 * database exists in the CLI store. To keep read-only history browsing side-effect-free while
 * letting users continue Desktop conversations over Remote:
 * - History reads for unimported Desktop sessions use `session/resume` + local brain transcript.
 * - Live session attach (before prompts/model/mode changes) atomically imports a WAL-safe
 *   snapshot of the Desktop `.db` into the CLI store (never mutating Desktop files) and then
 *   loads the full trajectory natively via `session/load`.
 */
export class AntigravityNativeAcpClient extends ClaudeAcpClient {
  private readonly brainDirs: readonly string[]
  private readonly desktopAppDir: string
  private readonly cliAppDir: string
  private readonly acpLogger?: SafeLogger

  constructor(
    binary = 'agy',
    logger?: SafeLogger,
    spawnAcp?: SpawnCursorAcp,
    options: AntigravityNativeAcpOptions = {},
  ) {
    const resolvedArgs = options.args && options.args.length > 0 && !isLegacyAntigravityStreamJsonArgs(options.args)
      ? options.args
      : ['acp']
    super(binary, logger, spawnAcp, {
      args: resolvedArgs,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    }, 'antigravity')
    const dirs = resolveAntigravityAppDirs(resolvedArgs, options)
    this.desktopAppDir = dirs.desktopAppDir
    this.cliAppDir = dirs.cliAppDir
    this.brainDirs = options.brainDirs ?? defaultAntigravityBrainDirs(this.desktopAppDir, this.cliAppDir)
    this.acpLogger = logger
  }

  private async hasCliConversationDb(sessionId: string): Promise<boolean> {
    if (!SESSION_ID_PATTERN.test(sessionId)) return false
    return await isRegularFileInside(join(this.cliAppDir, 'conversations'), `${sessionId}.db`) !== undefined
  }

  protected override async attachSession(params: unknown, timeoutMs?: number): Promise<unknown> {
    const sessionId = isRecord(params) && typeof params.sessionId === 'string' ? params.sessionId : undefined
    if (sessionId !== undefined) {
      try {
        await importDesktopSessionToCli(sessionId, this.desktopAppDir, this.cliAppDir, this.acpLogger)
      } catch (error) {
        this.acpLogger?.warn('Failed to import Antigravity Desktop conversation snapshot', {
          reason: error instanceof Error ? error.message : 'unknown',
        })
      }
    }
    try {
      return await this.callUnderlying('session/load', params, timeoutMs)
    } catch (error) {
      if (isUpstreamRejection(error)) {
        return this.callUnderlying('session/resume', params, timeoutMs)
      }
      throw error
    }
  }

  protected override async loadHistorySession(
    client: CursorAcpClient,
    sessionId: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ result: unknown; events?: unknown[] }> {
    const hasCliDb = await this.hasCliConversationDb(sessionId)
    signal?.throwIfAborted()

    // For unimported Desktop-only sessions, keep history reads strictly read-only:
    // pair `session/resume` (for model/mode metadata) with the local brain transcript
    // without copying the `.db` until the user actively attaches/prompts the session.
    if (!hasCliDb) {
      const transcriptDir = await pickFreshestTranscriptDir(this.brainDirs, sessionId)
      signal?.throwIfAborted()
      if (transcriptDir !== undefined) {
        try {
          const result = await client.call('session/resume', { sessionId, cwd, mcpServers: [] })
          signal?.throwIfAborted()
          const events = await loadTranscriptEvents(sessionId, sessionId, transcriptDir)
          return { result, events }
        } catch (error) {
          if (!isUpstreamRejection(error)) throw error
          // Fall through to standard session/load if session/resume is unsupported.
        }
      }
    }

    try {
      const result = await client.call('session/load', { sessionId, cwd, mcpServers: [] })
      return { result }
    } catch (error) {
      if (!isUpstreamRejection(error)) throw error
      signal?.throwIfAborted()
      const result = await client.call('session/resume', { sessionId, cwd, mcpServers: [] })
      signal?.throwIfAborted()
      const fallbackDir = await pickFreshestTranscriptDir(this.brainDirs, sessionId)
      const events = fallbackDir !== undefined
        ? await loadTranscriptEvents(sessionId, sessionId, fallbackDir)
        : []
      return { result, events }
    }
  }
}
