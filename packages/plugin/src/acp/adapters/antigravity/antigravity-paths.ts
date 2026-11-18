import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Antigravity keeps the same session layout in two independent data roots:
 * the desktop language server (~/.gemini/antigravity) and the CLI/agy
 * (~/.gemini/antigravity-cli). Both roots own their own SQLite WAL and .pb
 * files, so they must be read as separate sources, never symlinked together.
 */
export type AntigravitySource = 'desktop' | 'cli'

/** Legacy single-path callers select one explicit root; they carry no source identity. */
export type AntigravityEndSource = AntigravitySource | 'custom'

export interface AntigravityEnd {
  readonly source: AntigravityEndSource
  readonly root?: string
  readonly dbPath: string
  readonly brainDir: string
  readonly conversationsDir: string
}

export interface AntigravityPathOverrides {
  desktopRoot?: string
  cliRoot?: string
  /** Environment to read DSH_ANTIGRAVITY_* overrides from. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
}

/** Identity marker used by the post-upgrade patch verifier in dist/index.js. */
export const DSH_AGY_DUAL_END_PATCH_V1 = 'DSH_AGY_DUAL_END_PATCH_V1'

export const ANTIGRAVITY_ROOTS_ENV = 'DSH_ANTIGRAVITY_ROOTS'
export const ANTIGRAVITY_DESKTOP_ROOT_ENV = 'DSH_ANTIGRAVITY_DESKTOP_ROOT'
export const ANTIGRAVITY_CLI_ROOT_ENV = 'DSH_ANTIGRAVITY_CLI_ROOT'

function makeEnd(source: AntigravityEndSource, root?: string, dbPath?: string, brainDir?: string, conversationsDir?: string): AntigravityEnd {
  return {
    source,
    ...(root === undefined ? {} : { root }),
    dbPath: dbPath ?? join(root ?? '', 'conversation_summaries.db'),
    brainDir: brainDir ?? join(root ?? '', 'brain'),
    conversationsDir: conversationsDir ?? join(root ?? '', 'conversations'),
  }
}

function defaultDesktopRoot(): string {
  return join(homedir(), '.gemini/antigravity')
}

function defaultCliRoot(): string {
  return join(homedir(), '.gemini/antigravity-cli')
}

/** DSH_ANTIGRAVITY_ROOTS accepts "desktop=/a,cli=/b" or "/a,/b" (desktop first). */
function parseRootsEnv(raw: string | undefined): Partial<Record<AntigravitySource, string>> {
  if (!raw?.trim()) return {}
  const result: Partial<Record<AntigravitySource, string>> = {}
  const parts = raw.split(/[,;]/).map(part => part.trim()).filter(Boolean)
  let positional = 0
  for (const part of parts) {
    const labelled = part.match(/^(desktop|cli)\s*[:=]\s*(.+)$/i)
    if (labelled) {
      const key = labelled[1]!.toLowerCase() as AntigravitySource
      result[key] = labelled[2]!.trim()
      continue
    }
    const key: AntigravitySource = positional++ === 0 ? 'desktop' : 'cli'
    result[key] ??= part
  }
  return result
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** All configured Antigravity data roots, desktop first and CLI second. */
export function antigravityEnds(overrides: AntigravityPathOverrides = {}): AntigravityEnd[] {
  const env = overrides.env ?? process.env
  const roots = parseRootsEnv(envValue(env, ANTIGRAVITY_ROOTS_ENV))
  const desktopRoot = overrides.desktopRoot ?? envValue(env, ANTIGRAVITY_DESKTOP_ROOT_ENV) ?? roots.desktop ?? defaultDesktopRoot()
  const cliRoot = overrides.cliRoot ?? envValue(env, ANTIGRAVITY_CLI_ROOT_ENV) ?? roots.cli ?? defaultCliRoot()
  return [makeEnd('desktop', desktopRoot), makeEnd('cli', cliRoot)]
}

export interface LegacyEndOptions {
  dbPath?: string
  brainDir?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Resolve the discovery/loader function arguments. When a caller passes an
 * explicit db/brain path we preserve the original single-source behavior;
 * only the default arguments expand to both Antigravity roots.
 */
export function resolveAntigravityEnds(options: LegacyEndOptions = {}): AntigravityEnd[] {
  if (options.dbPath === undefined && options.brainDir === undefined) return antigravityEnds({ env: options.env })
  const env = options.env ?? process.env
  const roots = parseRootsEnv(envValue(env, ANTIGRAVITY_ROOTS_ENV))
  const cliRoot = envValue(env, ANTIGRAVITY_CLI_ROOT_ENV) ?? roots.cli ?? defaultCliRoot()
  const fallback = makeEnd('custom', cliRoot)
  return [makeEnd('custom', undefined,
    options.dbPath ?? fallback.dbPath,
    options.brainDir ?? fallback.brainDir,
    fallback.conversationsDir)]
}

/** Brain roots used by transcript readers/watchers (default: both ends). */
export function resolveBrainDirs(baseDir?: string | readonly string[], env?: NodeJS.ProcessEnv): string[] {
  if (baseDir === undefined) return antigravityEnds({ env }).map(end => end.brainDir)
  if (typeof baseDir === 'string') return [baseDir]
  return [...baseDir]
}

/** Only real desktop/CLI roots carry a source label; custom overrides do not. */
export function publicSource(end: AntigravityEnd): AntigravitySource | undefined {
  return end.source === 'custom' ? undefined : end.source
}

/** Symlink-safe transcript lookup shared by the loader, watcher and resume sync. */
export async function resolveTranscriptPath(brainDir: string, conversationId: string): Promise<string | undefined> {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(conversationId)) return undefined
  try {
    const root = await fs.realpath(brainDir)
    const expected = join(root, conversationId, '.system_generated', 'logs', 'transcript.jsonl')
    return await fs.realpath(expected) === expected ? expected : undefined
  } catch {
    return undefined
  }
}
