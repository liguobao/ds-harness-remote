import type { SafeLogger } from '../../logging.js'
import { execFileCommand } from '../windows-spawn.js'
import { ClaudeAcpClient } from './claude-process.js'
import type { CursorAcpOptions, SpawnCursorAcp } from './cursor-process.js'

const NEGATIVE_CACHE_TTL_MS = 30_000
const NATIVE_PROBE_TIMEOUT_MS = 5_000
const nativeAcpSupportCache = new Map<string, { promise: Promise<boolean>; expiresAt?: number }>()

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

/**
 * Native Antigravity ACP stdio client (`agy acp`).
 * Uses standard JSON-RPC ACP (`session/list`, `session/load`, `session/new`,
 * `session/prompt` with image blocks, `session/set_mode`, `session/set_config_option`,
 * `usage_update`, `available_commands_update`, and `session/cancel` notifications).
 */
export class AntigravityNativeAcpClient extends ClaudeAcpClient {
  constructor(
    binary = 'agy',
    logger?: SafeLogger,
    spawnAcp?: SpawnCursorAcp,
    options: Pick<CursorAcpOptions, 'args' | 'cwd'> = {},
  ) {
    super(binary, logger, spawnAcp, {
      ...options,
      args: options.args && options.args.length > 0 && !isLegacyAntigravityStreamJsonArgs(options.args)
        ? options.args
        : ['acp'],
    }, 'antigravity')
  }
}
