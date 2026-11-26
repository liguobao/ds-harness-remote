import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SafeLogger } from '../../logging.js'
import { execFileCommand } from '../windows-spawn.js'
import { loadTranscriptEvents } from './antigravity/transcript-loader.js'
import { ClaudeAcpClient } from './claude-process.js'
import { CursorAcpError, type CursorAcpClient, type CursorAcpOptions, type SpawnCursorAcp } from './cursor-process.js'

const NEGATIVE_CACHE_TTL_MS = 30_000
const NATIVE_PROBE_TIMEOUT_MS = 5_000
const nativeAcpSupportCache = new Map<string, { promise: Promise<boolean>; expiresAt?: number }>()

function defaultAntigravityBrainDirs(): string[] {
  const home = homedir()
  return [
    join(home, '.gemini', 'antigravity', 'brain'),
    join(home, '.gemini', 'antigravity-cli', 'brain'),
  ]
}

async function pickFreshestTranscriptDir(brainDirs: readonly string[], sessionId: string): Promise<string | undefined> {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(sessionId)) return undefined
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
}

/**
 * Native Antigravity ACP stdio client (`agy acp`).
 * Uses standard JSON-RPC ACP (`session/list`, `session/load`, `session/resume`, `session/new`,
 * `session/prompt` with image blocks, `session/set_mode`, `session/set_config_option`,
 * `usage_update`, `available_commands_update`, and `session/cancel` notifications).
 *
 * Antigravity Desktop sessions are returned by `agy acp` `session/list` and attach
 * immediately via `session/resume`, whereas `session/load` can reject them with
 * `-32002 Session not found`. We therefore prefer `session/resume` for live attach
 * (falling back to `session/load`) and pair `session/resume` with the local brain
 * transcript when available for history hydration.
 */
export class AntigravityNativeAcpClient extends ClaudeAcpClient {
  private readonly brainDirs: readonly string[]

  constructor(
    binary = 'agy',
    logger?: SafeLogger,
    spawnAcp?: SpawnCursorAcp,
    options: AntigravityNativeAcpOptions = {},
  ) {
    super(binary, logger, spawnAcp, {
      args: options.args && options.args.length > 0 && !isLegacyAntigravityStreamJsonArgs(options.args)
        ? options.args
        : ['acp'],
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    }, 'antigravity')
    this.brainDirs = options.brainDirs ?? defaultAntigravityBrainDirs()
  }

  protected override async attachSession(params: unknown, timeoutMs?: number): Promise<unknown> {
    try {
      return await this.callUnderlying('session/resume', params, timeoutMs)
    } catch (error) {
      if (isUpstreamRejection(error)) {
        return this.callUnderlying('session/load', params, timeoutMs)
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

    try {
      const result = await client.call('session/load', { sessionId, cwd, mcpServers: [] })
      return { result }
    } catch (error) {
      if (!isUpstreamRejection(error)) throw error
      signal?.throwIfAborted()
      const result = await client.call('session/resume', { sessionId, cwd, mcpServers: [] })
      signal?.throwIfAborted()
      const fallbackDir = transcriptDir ?? await pickFreshestTranscriptDir(this.brainDirs, sessionId)
      const events = fallbackDir !== undefined
        ? await loadTranscriptEvents(sessionId, sessionId, fallbackDir)
        : []
      return { result, events }
    }
  }
}
