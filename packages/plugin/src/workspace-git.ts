import {
  WORKSPACE_GIT_DEFAULT_CONTEXT_LINES,
  WORKSPACE_GIT_MAX_CONCURRENT,
  WORKSPACE_GIT_MAX_DIFF_BYTES,
  WORKSPACE_GIT_MAX_DIFF_LINES,
  WORKSPACE_GIT_MAX_FILES,
  WORKSPACE_GIT_MAX_STATUS_STDOUT_BYTES,
  WORKSPACE_GIT_TIMEOUT_MS,
  isSafeWorkspaceGitRelativePath,
  workspaceGitDiffParamsSchema,
  workspaceGitStatusParamsSchema,
  type WorkspaceGitDiffResult,
  type WorkspaceGitFileEntry,
  type WorkspaceGitFileStatus,
  type WorkspaceGitScope,
  type WorkspaceGitStatusResult,
} from '@dsh-remote/protocol'
import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path'
import { RpcError, workspaceFileFailure } from './safe-error.js'

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const ROOT_CACHE_TTL_MS = 5_000
const ROOT_CACHE_MAX_ENTRIES = 64
const MAX_STDERR_BYTES = 16 * 1024
const MAX_FILTER_CONFIG_BYTES = 64 * 1024
const MAX_FILTER_DRIVERS = 128
const MAX_GITDIR_BACKLINK_BYTES = 4 * 1024
const UNTRACKED_STAT_LIMIT = 50
const UNTRACKED_MAX_BYTES = 256 * 1024
const BINARY_SNIFF_BYTES = 8 * 1024
const CLOSE_GRACE_MS = 2_000
const COMBINED_HUNK_HEADER_RE = /^(@{3,}) (?:-\d+(?:,\d+)? )+\+\d+(?:,\d+)? \1/

const SAFE_GIT_ARGS = [
  '--no-pager',
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotepath=false',
  '-c', 'core.sshCommand=false',
  '-c', 'credential.helper=',
  '-c', 'protocol.allow=never',
  '-c', 'protocol.ext.allow=never',
  '-c', 'diff.external=',
  '-c', 'diff.noprefix=false',
  '-c', 'diff.mnemonicPrefix=false',
  '-c', 'diff.submodule=short',
  '-c', 'status.submoduleSummary=false',
  '-c', 'color.ui=never',
  '-c', 'safe.bareRepository=explicit',
  '-c', 'i18n.logOutputEncoding=UTF-8',
] as const

export interface ResolveGitExecutableOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export interface WorkspaceGitHostOptions {
  timeoutMs?: number
  maxConcurrent?: number
  rootCacheTtlMs?: number
  now?: () => number
  gitExecutable?: string | (() => Promise<string | undefined>)
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  spawnProcess?: typeof spawn
}

interface GitRunResult {
  exitCode: number
  stdout: Buffer
  stderr: string
  stdoutTruncated: boolean
}

interface FilterOverrides {
  args: readonly string[]
  env: NodeJS.ProcessEnv
}

interface RepoInspection {
  isGitRepo: boolean
  canonicalToplevel?: string
  prefix: string
  hasHead: boolean
  headShortSha?: string
  branch?: string
  filterOverrides?: FilterOverrides
}

interface ParsedPorcelainEntry {
  x: string
  y: string
  rawPath: string
  rawOldPath?: string
}

interface TrackedNumstat {
  additions: number | null
  deletions: number | null
  isBinary: boolean
}

interface CachedRoot {
  sourceRoot: string
  root: string
  checkedAt: number
}

interface ActiveChild {
  child: ChildProcess
  done: Promise<void>
}

interface TargetPathCheck {
  exists: boolean
  isFile: boolean
  absolutePath: string
}

/**
 * Strip git/pager/askpass overrides from the child process environment so a
 * repository or host shell cannot inject hooks, pagers, or interactive prompts.
 */
export function buildSanitizedGitEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    if (/^GIT_/i.test(key) || /^PAGER$/i.test(key) || /^SSH_ASKPASS$/i.test(key)) continue
    sanitized[key] = value
  }
  sanitized.GIT_TERMINAL_PROMPT = '0'
  sanitized.GIT_OPTIONAL_LOCKS = '0'
  sanitized.GIT_NO_LAZY_FETCH = '1'
  sanitized.GIT_ALLOW_PROTOCOL = ''
  sanitized.GIT_PAGER = 'cat'
  sanitized.LC_ALL = 'C'
  return sanitized
}

/**
 * Resolve the `git` binary by scanning PATH entries explicitly while rejecting
 * empty entries, relative directories, the workspace `cwd`, and non-`.exe`
 * Windows command wrappers (`.cmd`/`.bat`/`.com`).
 */
export async function resolveGitExecutable(options: ResolveGitExecutableOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const rawPath = readPathEnv(env, platform)
  if (!rawPath) return undefined

  const delimiter = platform === 'win32' ? ';' : ':'
  const excludedDirs = await collectExcludedDirs(options.cwd, platform)
  const binaryName = platform === 'win32' ? 'git.exe' : 'git'

  for (const rawEntry of rawPath.split(delimiter)) {
    const dir = stripOuterQuotes(rawEntry, platform)
    if (dir.length === 0 || dir.trim().length === 0) continue
    if (!isStrictAbsolutePath(dir, platform)) continue
    if (excludedDirs.has(normalizeDirForCompare(dir, platform))) continue

    let realDir: string
    try {
      realDir = await realpath(dir)
    } catch {
      continue
    }
    if (excludedDirs.has(normalizeDirForCompare(realDir, platform))) continue

    const candidate = join(dir, binaryName)
    let info
    try {
      info = await stat(candidate)
    } catch {
      continue
    }
    if (!info.isFile()) continue

    if (excludedDirs.size > 0) {
      try {
        const realCandidate = await realpath(candidate)
        if (excludedDirs.has(normalizeDirForCompare(dirname(realCandidate), platform))) continue
      } catch {
        continue
      }
    }

    try {
      await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
    } catch {
      continue
    }
    return candidate
  }

  return undefined
}

/** Per-connection read-only Git status & diff service bound to Host workspace authority. */
export class WorkspaceGitHost {
  private readonly lifetime = new AbortController()
  private readonly activeChildren = new Set<ActiveChild>()
  private readonly rootCache = new Map<string, CachedRoot>()
  private readonly timeoutMs: number
  private readonly maxConcurrent: number
  private readonly rootCacheTtlMs: number
  private readonly now: () => number
  private readonly env: NodeJS.ProcessEnv
  private readonly sanitizedEnv: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly gitExecutableOverride?: string | (() => Promise<string | undefined>)
  private readonly spawnProcess: typeof spawn
  private cachedGitBin?: string
  private inFlight = 0
  private closed = false

  constructor(
    private readonly resolveRoot: (sessionId: string, signal: AbortSignal) => Promise<string | undefined>,
    options: WorkspaceGitHostOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? WORKSPACE_GIT_TIMEOUT_MS
    this.maxConcurrent = options.maxConcurrent ?? WORKSPACE_GIT_MAX_CONCURRENT
    this.rootCacheTtlMs = options.rootCacheTtlMs ?? ROOT_CACHE_TTL_MS
    this.now = options.now ?? Date.now
    this.env = options.env ?? process.env
    this.sanitizedEnv = buildSanitizedGitEnv(this.env)
    this.platform = options.platform ?? process.platform
    this.gitExecutableOverride = options.gitExecutable
    this.spawnProcess = options.spawnProcess ?? spawn
  }

  async status(input: unknown): Promise<WorkspaceGitStatusResult> {
    const params = workspaceGitStatusParamsSchema.parse(input)
    const scope: WorkspaceGitScope = params.scope ?? 'all'
    return this.withConcurrencySlot(async () => {
      const deadlineMs = this.now() + this.timeoutMs
      const canonicalRoot = await this.resolveCanonicalRoot(params.sessionId, deadlineMs)
      const repo = await this.inspectRepo(canonicalRoot, true, deadlineMs)
      if (!repo.isGitRepo) {
        return emptyStatusResult(scope)
      }

      const porcelain = await this.runGit(
        ['--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all', '--', '.'],
        {
          cwd: canonicalRoot,
          allowTruncate: true,
          maxStdoutBytes: WORKSPACE_GIT_MAX_STATUS_STDOUT_BYTES,
          filterOverrides: repo.filterOverrides,
          deadlineMs,
        },
      )
      if (porcelain.exitCode !== 0) {
        if (isNotGitRepoStderr(porcelain.stderr)) return emptyStatusResult(scope)
        throw new RpcError('WORKSPACE_GIT_FAILED', 'The workspace git status command failed.')
      }

      const parsedPorcelain = parsePorcelainZ(porcelain.stdout, porcelain.stdoutTruncated)
      let truncated = parsedPorcelain.truncated
      const entries: WorkspaceGitFileEntry[] = []
      const seenPaths = new Set<string>()
      const untrackedDirRelPaths: string[] = []
      let hasTrackedChanges = false

      for (const item of parsedPorcelain.entries) {
        const isIgnored = item.x === '!' && item.y === '!'
        if (isIgnored) continue

        const isUntracked = item.x === '?' && item.y === '?'
        if (isUntracked) {
          if (scope === 'staged') continue
          if (item.rawPath.endsWith('/')) {
            const dirRel = stripUntrackedDirPrefix(item.rawPath, repo.prefix)
            if (dirRel !== undefined) untrackedDirRelPaths.push(dirRel)
            continue
          }
          const relPath = stripRepoPrefix(item.rawPath, repo.prefix)
          if (relPath === undefined || !isAllowedWorkspaceGitPath(relPath) || seenPaths.has(relPath)) continue
          if (entries.length >= WORKSPACE_GIT_MAX_FILES) {
            if (!truncated && (await isRegularUntrackedFile(canonicalRoot, relPath))) {
              truncated = true
            }
            continue
          }
          if (!(await isRegularUntrackedFile(canonicalRoot, relPath))) continue
          seenPaths.add(relPath)
          entries.push({
            path: relPath,
            status: 'untracked',
            staged: false,
            unstaged: true,
            additions: null,
            deletions: null,
            isBinary: false,
          })
          continue
        }

        const isUnmerged = isUnmergedPair(item.x, item.y)
        const staged = item.x !== ' ' && item.x !== '?'
        const unstaged = item.y !== ' ' && item.y !== '?'

        if (scope === 'staged' && !staged) continue
        if (scope === 'unstaged' && !unstaged) continue
        if (scope === 'all' && !staged && !unstaged) continue

        const relPath = stripRepoPrefix(item.rawPath, repo.prefix)
        if (relPath === undefined || !isAllowedWorkspaceGitPath(relPath) || seenPaths.has(relPath)) continue

        let oldPath: string | undefined
        if (item.rawOldPath !== undefined && scope !== 'unstaged') {
          const strippedOld = stripRepoPrefix(item.rawOldPath, repo.prefix)
          if (strippedOld !== undefined && isAllowedWorkspaceGitPath(strippedOld)) {
            oldPath = strippedOld
          }
        }

        const status = classifyTrackedStatus(item.x, item.y, isUnmerged, scope)
        seenPaths.add(relPath)
        hasTrackedChanges = true
        entries.push({
          path: relPath,
          ...(oldPath === undefined ? {} : { oldPath }),
          status,
          staged,
          unstaged,
          additions: null,
          deletions: null,
          isBinary: false,
        })
      }

      if (scope !== 'staged' && untrackedDirRelPaths.length > 0) {
        const expanded = await this.expandUntrackedDirs(
          canonicalRoot,
          untrackedDirRelPaths,
          seenPaths,
          Math.max(0, WORKSPACE_GIT_MAX_FILES - entries.length),
          repo.filterOverrides,
          deadlineMs,
        )
        if (expanded.truncated) truncated = true
        for (const relPath of expanded.files) {
          entries.push({
            path: relPath,
            status: 'untracked',
            staged: false,
            unstaged: true,
            additions: null,
            deletions: null,
            isBinary: false,
          })
        }
      }

      const totalFiles = entries.length
      if (entries.length > WORKSPACE_GIT_MAX_FILES) {
        truncated = true
      }
      const files = entries.slice(0, WORKSPACE_GIT_MAX_FILES)

      if (hasTrackedChanges) {
        const numstatArgs = [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--ignore-submodules=all',
          '--numstat',
          '-z',
          '-M',
          '--relative',
        ]
        if (scope === 'staged') {
          numstatArgs.push('--cached')
        } else if (scope === 'all') {
          numstatArgs.push(repo.hasHead ? 'HEAD' : EMPTY_TREE_SHA)
        }
        numstatArgs.push('--', '.')

        const numstat = await this.runGit(numstatArgs, {
          cwd: canonicalRoot,
          allowTruncate: true,
          maxStdoutBytes: WORKSPACE_GIT_MAX_STATUS_STDOUT_BYTES,
          filterOverrides: repo.filterOverrides,
          deadlineMs,
        })
        if (numstat.exitCode === 0) {
          const statsMap = parseNumstatZ(numstat.stdout, numstat.stdoutTruncated)
          for (const entry of files) {
            if (entry.status === 'untracked') continue
            const statEntry = statsMap.get(entry.path)
            if (statEntry !== undefined) {
              entry.additions = statEntry.additions
              entry.deletions = statEntry.deletions
              entry.isBinary = statEntry.isBinary
            }
          }
        } else if (isNotGitRepoStderr(numstat.stderr)) {
          return emptyStatusResult(scope)
        }
      }

      let untrackedCounted = 0
      for (const entry of files) {
        if (entry.status !== 'untracked') continue
        if (untrackedCounted >= UNTRACKED_STAT_LIMIT) break
        untrackedCounted += 1
        const stats = await inspectUntrackedFile(canonicalRoot, entry.path)
        if (stats !== undefined) {
          entry.additions = stats.additions
          entry.deletions = stats.deletions
          entry.isBinary = stats.isBinary
        }
      }

      let totalAdditions = 0
      let totalDeletions = 0
      for (const entry of files) {
        if (entry.additions !== null) totalAdditions += entry.additions
        if (entry.deletions !== null) totalDeletions += entry.deletions
      }

      return {
        isGitRepo: true,
        ...(repo.branch === undefined ? {} : { branch: repo.branch }),
        ...(repo.headShortSha === undefined ? {} : { headShortSha: repo.headShortSha }),
        hasHead: repo.hasHead,
        scope,
        files,
        totalFiles,
        truncated,
        totalAdditions,
        totalDeletions,
      }
    })
  }

  async diff(input: unknown): Promise<WorkspaceGitDiffResult> {
    const params = workspaceGitDiffParamsSchema.parse(input)
    const scope: WorkspaceGitScope = params.scope ?? 'all'
    const contextLines = params.contextLines ?? WORKSPACE_GIT_DEFAULT_CONTEXT_LINES
    const requestedPath = params.path

    if (requestedPath !== undefined && !isAllowedWorkspaceGitPath(requestedPath)) {
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is invalid.', 'outside-root')
    }

    return this.withConcurrencySlot(async () => {
      const deadlineMs = this.now() + this.timeoutMs
      const canonicalRoot = await this.resolveCanonicalRoot(params.sessionId, deadlineMs)
      let targetCheck: TargetPathCheck | undefined
      if (requestedPath !== undefined) {
        targetCheck = await validateTargetPath(canonicalRoot, requestedPath)
      }

      const repo = await this.inspectRepo(canonicalRoot, false, deadlineMs)
      if (!repo.isGitRepo) {
        return emptyDiffResult(scope, requestedPath, false)
      }

      if (requestedPath !== undefined && scope !== 'staged' && targetCheck?.exists && targetCheck.isFile) {
        const [tracked, ignored] = await Promise.all([
          this.isPathTrackedInIndexOrHead(
            canonicalRoot,
            requestedPath,
            repo.prefix,
            repo.hasHead,
            repo.filterOverrides,
            deadlineMs,
          ),
          this.isPathIgnored(canonicalRoot, requestedPath, repo.filterOverrides, deadlineMs),
        ])
        if (!tracked) {
          if (ignored) {
            return emptyDiffResult(scope, requestedPath, true)
          }
          return synthesizeUntrackedFileDiff(targetCheck.absolutePath, requestedPath, scope)
        }
      }

      const args = [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--ignore-submodules=all',
        '--no-color',
        '--relative',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        `--unified=${contextLines}`,
      ]
      if (scope === 'staged') {
        args.push('--cached')
      } else if (scope === 'all') {
        args.push(repo.hasHead ? 'HEAD' : EMPTY_TREE_SHA)
      }
      args.push('--', requestedPath ?? '.')

      const diffResult = await this.runGit(args, {
        cwd: canonicalRoot,
        allowTruncate: true,
        maxStdoutBytes: WORKSPACE_GIT_MAX_DIFF_BYTES,
        filterOverrides: repo.filterOverrides,
        deadlineMs,
      })
      if (diffResult.exitCode !== 0) {
        if (isNotGitRepoStderr(diffResult.stderr)) {
          return emptyDiffResult(scope, requestedPath, false)
        }
        throw new RpcError('WORKSPACE_GIT_FAILED', 'The workspace git diff command failed.')
      }

      return formatDiffOutput(diffResult.stdout, diffResult.stdoutTruncated, scope, requestedPath)
    })
  }

  async closeAll(): Promise<void> {
    this.closed = true
    this.lifetime.abort()
    this.rootCache.clear()
    const pending: Promise<void>[] = []
    for (const active of this.activeChildren) {
      killProcess(active.child)
      pending.push(active.done)
    }
    if (pending.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, CLOSE_GRACE_MS)
        timer.unref?.()
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
  }

  private async withConcurrencySlot<T>(operation: () => Promise<T>): Promise<T> {
    this.assertLive()
    if (this.inFlight >= this.maxConcurrent) {
      throw new RpcError('RATE_LIMITED', 'Too many workspace git requests are pending.', undefined, true)
    }
    this.inFlight += 1
    try {
      return await operation()
    } finally {
      this.inFlight -= 1
    }
  }

  private assertLive(): void {
    if (this.closed || this.lifetime.signal.aborted) {
      throw new RpcError('WORKSPACE_GIT_CLOSED', 'The workspace git service is closed.')
    }
  }

  private remainingTimeoutMs(deadlineMs?: number): number {
    if (deadlineMs === undefined) return this.timeoutMs
    const remaining = deadlineMs - this.now()
    if (remaining <= 0) {
      throw new RpcError('RPC_TIMEOUT', 'The workspace git command timed out.', undefined, true)
    }
    return Math.min(this.timeoutMs, remaining)
  }

  private async resolveCanonicalRoot(sessionId: string, deadlineMs?: number): Promise<string> {
    this.assertLive()
    const cached = this.rootCache.get(sessionId)
    if (cached !== undefined && this.now() - cached.checkedAt < this.rootCacheTtlMs) {
      try {
        const canonical = await validateCanonicalDirectory(cached.sourceRoot)
        if (canonical === cached.root) return canonical
      } catch {
        // Fall through to re-resolve through authority on mismatch or change.
      }
      this.rootCache.delete(sessionId)
    }

    const remainingMs = this.remainingTimeoutMs(deadlineMs)
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(remainingMs)])
    let sourceRoot: string | undefined
    try {
      sourceRoot = await this.resolveRoot(sessionId, signal)
    } catch {
      this.assertLive()
      throw workspaceFileFailure('WORKSPACE_UNAVAILABLE', 'The session workspace is unavailable.', 'authority-unavailable')
    }
    this.assertLive()

    if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) {
      throw workspaceFileFailure('WORKSPACE_UNAVAILABLE', 'The session workspace is unavailable.', 'authority-unavailable')
    }
    if (!isAbsolute(sourceRoot)) {
      throw workspaceFileFailure('WORKSPACE_UNAVAILABLE', 'The session workspace is unavailable.', 'root-invalid')
    }

    let canonical: string
    try {
      canonical = await validateCanonicalDirectory(sourceRoot)
    } catch {
      throw workspaceFileFailure('WORKSPACE_UNAVAILABLE', 'The session workspace is unavailable.', 'root-invalid')
    }

    this.rootCache.delete(sessionId)
    this.rootCache.set(sessionId, { sourceRoot, root: canonical, checkedAt: this.now() })
    if (this.rootCache.size > ROOT_CACHE_MAX_ENTRIES) {
      const oldest = this.rootCache.keys().next().value
      if (oldest !== undefined) this.rootCache.delete(oldest)
    }
    return canonical
  }

  private async getGitBin(cwd: string): Promise<string> {
    if (typeof this.gitExecutableOverride === 'string') {
      return this.gitExecutableOverride
    }
    if (typeof this.gitExecutableOverride === 'function') {
      const resolved = await this.gitExecutableOverride()
      if (!resolved) {
        throw new RpcError('WORKSPACE_GIT_UNAVAILABLE', 'Git is unavailable on this Host.')
      }
      return resolved
    }
    if (this.cachedGitBin !== undefined) {
      const binDir = dirname(this.cachedGitBin)
      if (!(await isSameDirectory(binDir, cwd, this.platform))) {
        return this.cachedGitBin
      }
    }
    const resolved = await resolveGitExecutable({ cwd, env: this.env, platform: this.platform })
    if (resolved === undefined) {
      throw new RpcError('WORKSPACE_GIT_UNAVAILABLE', 'Git is unavailable on this Host.')
    }
    this.cachedGitBin = resolved
    return resolved
  }

  private async inspectRepo(
    canonicalRoot: string,
    includeBranchInfo: boolean,
    deadlineMs?: number,
  ): Promise<RepoInspection> {
    const toplevelResult = await this.runGit(['rev-parse', '--show-toplevel', '--absolute-git-dir'], {
      cwd: canonicalRoot,
      allowTruncate: false,
      maxStdoutBytes: 16 * 1024,
      deadlineMs,
    })
    if (toplevelResult.exitCode !== 0) {
      if (isNotGitRepoStderr(toplevelResult.stderr)) {
        return { isGitRepo: false, prefix: '', hasHead: false }
      }
      throw new RpcError('WORKSPACE_GIT_FAILED', 'Failed to inspect the Git repository.')
    }

    const revLines = toplevelResult.stdout
      .toString('utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\n$/, '')
      .split('\n')
    const rawToplevel = revLines[0] ?? ''
    const rawGitDir = revLines[1] ?? ''
    if (rawToplevel.length === 0) {
      return { isGitRepo: false, prefix: '', hasHead: false }
    }

    let canonicalToplevel: string
    try {
      canonicalToplevel = await realpath(rawToplevel)
    } catch {
      throw workspaceFileFailure('WORKSPACE_UNAVAILABLE', 'The session workspace is unavailable.', 'root-invalid')
    }

    if (this.platform === 'win32' && process.platform === 'win32') {
      if (parse(canonicalToplevel).root.toLowerCase() !== parse(canonicalRoot).root.toLowerCase()) {
        throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The workspace is outside its Git repository.', 'outside-root')
      }
    }
    const rel = relative(canonicalToplevel, canonicalRoot)
    if (isPathOutside(rel)) {
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The workspace is outside its Git repository.', 'outside-root')
    }
    const prefix = rel.length === 0 ? '' : `${rel.split(sep).join('/')}/`

    await this.verifyGitDirOwnership(canonicalToplevel, rawGitDir, deadlineMs)

    const [headResult, branchResult, filterOverrides] = await Promise.all([
      this.runGit(['rev-parse', '--verify', '--quiet', '--short', 'HEAD'], {
        cwd: canonicalRoot,
        allowTruncate: false,
        maxStdoutBytes: 1024,
        deadlineMs,
      }),
      includeBranchInfo
        ? this.runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
            cwd: canonicalRoot,
            allowTruncate: false,
            maxStdoutBytes: 1024,
            deadlineMs,
          })
        : Promise.resolve(undefined),
      this.collectFilterOverrides(canonicalRoot, deadlineMs),
    ])

    const hasHead = headResult.exitCode === 0
    const rawSha = hasHead ? headResult.stdout.toString('utf8').replace(/\r?\n$/, '') : ''
    const headShortSha = rawSha.length > 0 ? rawSha.slice(0, 64) : undefined

    let branch: string | undefined
    if (branchResult !== undefined && branchResult.exitCode === 0) {
      const rawBranch = branchResult.stdout.toString('utf8').replace(/\r?\n$/, '')
      if (rawBranch.length > 0) branch = rawBranch.slice(0, 256)
    }

    return {
      isGitRepo: true,
      canonicalToplevel,
      prefix,
      hasHead,
      headShortSha,
      branch,
      filterOverrides,
    }
  }

  /**
   * Prevent forged `.git` gitfile escapes pointing at an unrelated repository on
   * the host: allow `.git` inside `canonicalToplevel`, or external gitdirs only
   * when a host-owned backlink (`<gitdir>/gitdir` for linked worktrees or
   * `<gitdir>/config` `core.worktree` for submodules) resolves back to
   * `canonicalToplevel`.
   */
  private async verifyGitDirOwnership(
    canonicalToplevel: string,
    rawGitDir: string,
    deadlineMs?: number,
  ): Promise<void> {
    if (rawGitDir.length === 0) {
      throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Git directory does not match the workspace repository.')
    }
    let canonicalGitDir: string
    try {
      canonicalGitDir = await realpath(rawGitDir)
    } catch {
      throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Git directory does not match the workspace repository.')
    }

    const sameDrive = !(this.platform === 'win32' && process.platform === 'win32')
      || parse(canonicalToplevel).root.toLowerCase() === parse(canonicalGitDir).root.toLowerCase()
    if (sameDrive && !isPathOutside(relative(canonicalToplevel, canonicalGitDir))) {
      return
    }

    // External gitdir: require `<toplevel>/.git` to be a non-symlink file and verify host-side backlink.
    let dotGitInfo
    try {
      dotGitInfo = await lstat(join(canonicalToplevel, '.git'))
    } catch {
      throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Git directory does not match the workspace repository.')
    }
    if (dotGitInfo.isSymbolicLink() || !dotGitInfo.isFile()) {
      throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Git directory does not match the workspace repository.')
    }

    // 1. Linked worktree backlink: `<gitdir>/gitdir` must point back to `<canonicalToplevel>/.git`.
    const backlink = await readBoundedRegularText(join(canonicalGitDir, 'gitdir'), MAX_GITDIR_BACKLINK_BYTES)
    if (backlink !== undefined) {
      const trimmed = backlink.trim()
      if (trimmed.length > 0) {
        const resolvedBacklink = resolve(canonicalGitDir, trimmed)
        const expectedName = basename(resolvedBacklink)
        const nameMatches = this.platform === 'win32'
          ? expectedName.toLowerCase() === '.git'
          : expectedName === '.git'
        if (nameMatches) {
          try {
            const backlinkParent = await realpath(dirname(resolvedBacklink))
            if (normalizeDirForCompare(backlinkParent, this.platform) === normalizeDirForCompare(canonicalToplevel, this.platform)) {
              return
            }
          } catch {
            // Fall through to submodule check / rejection.
          }
        }
      }
    }

    // 2. Submodule backlink: `<gitdir>/config` `core.worktree` must resolve back to `canonicalToplevel`.
    const configPath = join(canonicalGitDir, 'config')
    let configInfo
    try {
      configInfo = await lstat(configPath)
    } catch {
      configInfo = undefined
    }
    if (configInfo !== undefined && !configInfo.isSymbolicLink() && configInfo.isFile()) {
      const wtResult = await this.runGit(['config', '--no-includes', '--file', configPath, '--get', 'core.worktree'], {
        cwd: canonicalToplevel,
        allowTruncate: false,
        maxStdoutBytes: MAX_GITDIR_BACKLINK_BYTES,
        deadlineMs,
      })
      if (wtResult.exitCode === 0) {
        const rawWorktree = wtResult.stdout.toString('utf8').trim()
        if (rawWorktree.length > 0) {
          try {
            const resolvedWt = await realpath(resolve(canonicalGitDir, rawWorktree))
            if (normalizeDirForCompare(resolvedWt, this.platform) === normalizeDirForCompare(canonicalToplevel, this.platform)) {
              return
            }
          } catch {
            // Fall through to rejection.
          }
        }
      }
    }

    throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Git directory does not match the workspace repository.')
  }

  private async collectFilterOverrides(
    canonicalRoot: string,
    deadlineMs?: number,
  ): Promise<FilterOverrides | undefined> {
    const configResult = await this.runGit(
      ['config', '--includes', '--null', '--name-only', '--get-regexp', '^(filter\\.|extensions\\.partialclone$|remote\\..*\\.promisor$)'],
      {
        cwd: canonicalRoot,
        allowTruncate: false,
        maxStdoutBytes: MAX_FILTER_CONFIG_BYTES,
        deadlineMs,
      },
    )
    if (configResult.stdoutTruncated) {
      throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Repository filter configuration exceeded safe limits.')
    }
    if (configResult.exitCode === 1) {
      return undefined
    }
    if (configResult.exitCode !== 0) {
      throw new RpcError('WORKSPACE_GIT_FAILED', 'Failed to inspect repository filter configuration.')
    }

    const { tokens } = splitNulTerminated(configResult.stdout)
    const names = new Set<string>()
    for (const key of tokens) {
      if (key.length === 0) continue
      const lower = key.toLowerCase()
      if (lower === 'extensions.partialclone' || (lower.startsWith('remote.') && lower.endsWith('.promisor'))) {
        throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Partial-clone promisor repositories are not supported for read-only inspection.')
      }
      const firstDot = key.indexOf('.')
      const lastDot = key.lastIndexOf('.')
      if (firstDot <= 0 || lastDot <= firstDot) continue
      const subsection = key.slice(firstDot + 1, lastDot)
      if (subsection.length === 0) continue
      if (/[\r\n\0]/.test(subsection)) {
        throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Repository filter configuration contains an unsafe filter name.')
      }
      names.add(subsection)
      if (names.size > MAX_FILTER_DRIVERS) {
        throw new RpcError('WORKSPACE_GIT_UNSAFE_REPO', 'Repository filter configuration exceeded safe limits.')
      }
    }

    if (names.size === 0) return undefined

    const args: string[] = []
    const env: NodeJS.ProcessEnv = { ...this.sanitizedEnv }
    let count = 0
    for (const name of names) {
      for (const [field, value] of [
        ['clean', ''],
        ['smudge', ''],
        ['process', ''],
        ['required', 'false'],
      ] as const) {
        const key = `filter.${name}.${field}`
        env[`GIT_CONFIG_KEY_${count}`] = key
        env[`GIT_CONFIG_VALUE_${count}`] = value
        count += 1
        if (!name.includes('=')) {
          args.push('-c', `${key}=${value}`)
        }
      }
    }
    env.GIT_CONFIG_COUNT = String(count)
    return { args, env }
  }

  private async isPathTrackedInIndexOrHead(
    canonicalRoot: string,
    relPath: string,
    prefix: string,
    hasHead: boolean,
    filterOverrides?: FilterOverrides,
    deadlineMs?: number,
  ): Promise<boolean> {
    const lsFiles = await this.runGit(['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relPath], {
      cwd: canonicalRoot,
      allowTruncate: false,
      maxStdoutBytes: 8 * 1024,
      filterOverrides,
      deadlineMs,
    })
    if (lsFiles.exitCode === 0) return true
    if (!hasHead) return false

    const repoPath = `${prefix}${relPath}`
    const inHead = await this.runGit(['cat-file', '-e', `HEAD:${repoPath}`], {
      cwd: canonicalRoot,
      allowTruncate: false,
      maxStdoutBytes: 1024,
      filterOverrides,
      deadlineMs,
    })
    return inHead.exitCode === 0
  }

  private async isPathIgnored(
    canonicalRoot: string,
    relPath: string,
    filterOverrides?: FilterOverrides,
    deadlineMs?: number,
  ): Promise<boolean> {
    const check = await this.runGit(['check-ignore', '-q', '--', relPath], {
      cwd: canonicalRoot,
      allowTruncate: false,
      maxStdoutBytes: 4 * 1024,
      filterOverrides,
      deadlineMs,
    })
    if (check.exitCode === 0) return true
    if (check.exitCode === 1) return false
    return true
  }

  private async expandUntrackedDirs(
    canonicalRoot: string,
    dirRelPaths: readonly string[],
    seenPaths: Set<string>,
    remainingBudget: number,
    filterOverrides?: FilterOverrides,
    deadlineMs?: number,
  ): Promise<{ files: string[]; truncated: boolean }> {
    const verifiedDirs: string[] = []
    let includeWholeWorkspace = false

    for (const dirRel of dirRelPaths) {
      if (dirRel.length === 0) {
        includeWholeWorkspace = true
        break
      }
      if (!isAllowedWorkspaceGitPath(dirRel)) continue
      if (dirRel.split('/').includes('node_modules')) continue
      const verified = await verifyDirectoryNoSymlinks(canonicalRoot, dirRel)
      if (verified !== undefined) {
        verifiedDirs.push(dirRel)
      }
    }

    const targets = includeWholeWorkspace ? ['.'] : verifiedDirs
    if (targets.length === 0) {
      return { files: [], truncated: false }
    }

    const lsResult = await this.runGit(
      ['--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z', '--', ...targets],
      {
        cwd: canonicalRoot,
        allowTruncate: true,
        maxStdoutBytes: WORKSPACE_GIT_MAX_STATUS_STDOUT_BYTES,
        filterOverrides,
        deadlineMs,
      },
    )
    if (lsResult.exitCode !== 0 && !lsResult.stdoutTruncated) {
      return { files: [], truncated: false }
    }

    const { tokens, hadTrailingRemainder } = splitNulTerminated(lsResult.stdout)
    const collected: string[] = []
    let truncated = lsResult.stdoutTruncated || hadTrailingRemainder

    for (const rawPath of tokens) {
      this.assertLive()
      if (rawPath.length === 0) continue
      const relPath = rawPath.replace(/\/+$/, '')
      if (!isAllowedWorkspaceGitPath(relPath)) continue
      if (relPath.split('/').includes('node_modules')) continue
      if (seenPaths.has(relPath)) continue
      if (!(await isRegularUntrackedFile(canonicalRoot, relPath))) continue
      if (collected.length >= remainingBudget) {
        truncated = true
        break
      }
      seenPaths.add(relPath)
      collected.push(relPath)
    }

    return { files: collected, truncated }
  }

  private async runGit(
    args: readonly string[],
    options: {
      cwd: string
      allowTruncate: boolean
      maxStdoutBytes: number
      filterOverrides?: FilterOverrides
      deadlineMs?: number
    },
  ): Promise<GitRunResult> {
    this.assertLive()
    const remainingMs = this.remainingTimeoutMs(options.deadlineMs)
    const gitBin = await this.getGitBin(options.cwd)
    this.assertLive()
    const childTimeoutMs = this.remainingTimeoutMs(options.deadlineMs)
    const spawnArgs = options.filterOverrides !== undefined
      ? [...SAFE_GIT_ARGS, ...options.filterOverrides.args, ...args]
      : [...SAFE_GIT_ARGS, ...args]
    const spawnEnv = options.filterOverrides !== undefined
      ? options.filterOverrides.env
      : this.sanitizedEnv

    return new Promise<GitRunResult>((resolvePromise, rejectPromise) => {
      const child = this.spawnProcess(gitBin, spawnArgs, {
        cwd: options.cwd,
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let settled = false
      let timedOut = false
      let aborted = false
      let stdoutTruncated = false
      let stdoutBytes = 0
      let stderrBytes = 0
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      let markDone!: () => void
      const done = new Promise<void>(resolveDone => {
        markDone = resolveDone
      })
      const activeEntry: ActiveChild = { child, done }
      this.activeChildren.add(activeEntry)

      const cleanup = () => {
        clearTimeout(timer)
        this.lifetime.signal.removeEventListener('abort', onAbort)
        this.activeChildren.delete(activeEntry)
        markDone()
      }

      const onAbort = () => {
        aborted = true
        killProcess(child)
      }
      this.lifetime.signal.addEventListener('abort', onAbort, { once: true })
      if (this.lifetime.signal.aborted) {
        onAbort()
      }

      const timer = setTimeout(() => {
        timedOut = true
        killProcess(child)
      }, Math.min(remainingMs, childTimeoutMs))
      timer.unref?.()

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdoutTruncated) return
        if (stdoutBytes + chunk.length > options.maxStdoutBytes) {
          const remaining = options.maxStdoutBytes - stdoutBytes
          if (remaining > 0) {
            stdoutChunks.push(chunk.subarray(0, remaining))
            stdoutBytes += remaining
          }
          stdoutTruncated = true
          killProcess(child)
          return
        }
        stdoutChunks.push(chunk)
        stdoutBytes += chunk.length
      })

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes >= MAX_STDERR_BYTES) return
        const remaining = MAX_STDERR_BYTES - stderrBytes
        const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
        stderrChunks.push(slice)
        stderrBytes += slice.length
      })

      child.once('error', (error: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        cleanup()
        if (aborted) {
          rejectPromise(new RpcError('WORKSPACE_GIT_CLOSED', 'The workspace git service is closed.'))
          return
        }
        if (error.code === 'ENOENT') {
          rejectPromise(new RpcError('WORKSPACE_GIT_UNAVAILABLE', 'Git is unavailable on this Host.'))
          return
        }
        rejectPromise(new RpcError('WORKSPACE_GIT_FAILED', 'The workspace git command failed.'))
      })

      child.once('close', (code) => {
        if (settled) return
        settled = true
        cleanup()
        const stdout = Buffer.concat(stdoutChunks)
        const stderr = Buffer.concat(stderrChunks).toString('utf8')

        if (aborted) {
          rejectPromise(new RpcError('WORKSPACE_GIT_CLOSED', 'The workspace git service is closed.'))
          return
        }
        if (timedOut) {
          rejectPromise(new RpcError('RPC_TIMEOUT', 'The workspace git command timed out.', undefined, true))
          return
        }
        if (stdoutTruncated && options.allowTruncate) {
          resolvePromise({ exitCode: 0, stdout, stderr, stdoutTruncated: true })
          return
        }
        if (code !== 0 && isDubiousOwnershipStderr(stderr)) {
          rejectPromise(new RpcError(
            'WORKSPACE_GIT_UNSAFE_REPO',
            'Git rejected this workspace because of repository ownership checks.',
          ))
          return
        }
        resolvePromise({
          exitCode: code ?? 1,
          stdout,
          stderr,
          stdoutTruncated,
        })
      })
    })
  }
}

function emptyStatusResult(scope: WorkspaceGitScope): WorkspaceGitStatusResult {
  return {
    isGitRepo: false,
    hasHead: false,
    scope,
    files: [],
    totalFiles: 0,
    truncated: false,
    totalAdditions: 0,
    totalDeletions: 0,
  }
}

function emptyDiffResult(
  scope: WorkspaceGitScope,
  path: string | undefined,
  isGitRepo: boolean,
): WorkspaceGitDiffResult {
  return {
    isGitRepo,
    ...(path === undefined ? {} : { path }),
    scope,
    diff: '',
    bytes: 0,
    lines: 0,
    additions: 0,
    deletions: 0,
    isBinary: false,
    truncated: false,
  }
}

function readPathEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env.PATH
  if (typeof env.PATH === 'string') return env.PATH
  if (typeof env.Path === 'string') return env.Path
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === 'path' && typeof value === 'string') return value
  }
  return undefined
}

function stripOuterQuotes(value: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return value
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

function isStrictAbsolutePath(value: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') {
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) return true
    if (process.platform !== 'win32' && value.startsWith('/')) return true
    return false
  }
  return value.startsWith('/')
}

function normalizeDirForCompare(dir: string, platform: NodeJS.Platform): string {
  let normalized = normalize(dir)
  if (platform === 'win32') {
    normalized = normalized.replaceAll('/', '\\').replace(/[\\]+$/, '')
    if (/^[A-Za-z]:$/.test(normalized)) normalized += '\\'
    return normalized.toLowerCase()
  }
  normalized = normalized.replace(/\/+$/, '')
  return normalized.length === 0 ? '/' : normalized
}

async function collectExcludedDirs(cwd: string | undefined, platform: NodeJS.Platform): Promise<Set<string>> {
  const excluded = new Set<string>()
  if (!cwd) return excluded
  excluded.add(normalizeDirForCompare(cwd, platform))
  try {
    const canonical = await realpath(cwd)
    excluded.add(normalizeDirForCompare(canonical, platform))
  } catch {
    // Missing cwd still excludes the literal path string.
  }
  return excluded
}

async function isSameDirectory(left: string, right: string, platform: NodeJS.Platform): Promise<boolean> {
  if (normalizeDirForCompare(left, platform) === normalizeDirForCompare(right, platform)) return true
  try {
    const [realLeft, realRight] = await Promise.all([realpath(left), realpath(right)])
    return normalizeDirForCompare(realLeft, platform) === normalizeDirForCompare(realRight, platform)
  } catch {
    return false
  }
}

function killProcess(child: ChildProcess): void {
  try {
    child.kill('SIGKILL')
  } catch {
    // Process may have already exited.
  }
}

function isDubiousOwnershipStderr(stderr: string): boolean {
  return /dubious ownership/i.test(stderr)
}

function isNotGitRepoStderr(stderr: string): boolean {
  return /not a git repository/i.test(stderr)
    || /must be run in a work tree/i.test(stderr)
    || /cannot use bare repository/i.test(stderr)
}

function isPathOutside(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

function isAllowedWorkspaceGitPath(relPath: string): boolean {
  if (!isSafeWorkspaceGitRelativePath(relPath)) return false
  return !relPath.split('/').some(segment => segment.toLowerCase() === '.git')
}

async function validateCanonicalDirectory(sourceRoot: string): Promise<string> {
  if (!isAbsolute(sourceRoot)) {
    throw new Error('Workspace root must be absolute.')
  }
  const canonical = await realpath(sourceRoot)
  const info = await lstat(canonical)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('Workspace root must be a directory.')
  }
  return canonical
}

async function verifyDirectoryNoSymlinks(canonicalRoot: string, relDir: string): Promise<string | undefined> {
  const segments = relDir.split('/')
  let current = canonicalRoot
  for (const segment of segments) {
    current = join(current, segment)
    if (isPathOutside(relative(canonicalRoot, current))) return undefined
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) return undefined
    } catch {
      return undefined
    }
  }
  try {
    const canonical = await realpath(current)
    if (isPathOutside(relative(canonicalRoot, canonical))) return undefined
    return canonical
  } catch {
    return undefined
  }
}

async function validateTargetPath(canonicalRoot: string, relPath: string): Promise<TargetPathCheck> {
  const segments = relPath.split('/')
  let current = canonicalRoot
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = join(current, segments[index]!)
    if (isPathOutside(relative(canonicalRoot, current))) {
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is outside the workspace.', 'outside-root')
    }
    let dirInfo
    try {
      dirInfo = await lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { exists: false, isFile: false, absolutePath: join(canonicalRoot, ...segments) }
      }
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is unavailable.', 'io')
    }
    if (dirInfo.isSymbolicLink()) {
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'Symbolic links are not supported.', 'symlink')
    }
    if (!dirInfo.isDirectory()) {
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'An ancestor path is not a directory.', 'not-regular-file')
    }
  }

  const target = join(current, segments[segments.length - 1]!)
  if (isPathOutside(relative(canonicalRoot, target))) {
    throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is outside the workspace.', 'outside-root')
  }

  let targetInfo
  try {
    targetInfo = await lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, isFile: false, absolutePath: target }
    }
    throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is unavailable.', 'io')
  }

  if (targetInfo.isSymbolicLink()) {
    throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'Symbolic links are not supported.', 'symlink')
  }

  try {
    const canonicalTarget = await realpath(target)
    if (process.platform === 'win32') {
      if (parse(canonicalRoot).root.toLowerCase() !== parse(canonicalTarget).root.toLowerCase()) {
        throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is outside the workspace.', 'outside-root')
      }
    }
    if (isPathOutside(relative(canonicalRoot, canonicalTarget))) {
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is outside the workspace.', 'outside-root')
    }
  } catch (error) {
    if (error instanceof RpcError) throw error
    throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is unavailable.', 'io')
  }

  return {
    exists: true,
    isFile: targetInfo.isFile(),
    absolutePath: target,
  }
}

async function isRegularUntrackedFile(canonicalRoot: string, relPath: string): Promise<boolean> {
  try {
    const check = await validateTargetPath(canonicalRoot, relPath)
    return check.exists && check.isFile
  } catch {
    return false
  }
}

async function readBoundedRegularText(filePath: string, maxBytes: number): Promise<string | undefined> {
  let info
  try {
    info = await lstat(filePath)
  } catch {
    return undefined
  }
  if (info.isSymbolicLink() || !info.isFile()) return undefined

  let handle
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch {
    return undefined
  }
  try {
    const statInfo = await handle.stat()
    if (!statInfo.isFile() || statInfo.size > maxBytes) return undefined
    const readResult = await readHandleBounded(handle, maxBytes)
    if (readResult.exceededLimit) return undefined
    return readResult.data.toString('utf8')
  } catch {
    return undefined
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function splitNulTerminated(buffer: Buffer): { tokens: string[]; hadTrailingRemainder: boolean } {
  const tokens: string[] = []
  let start = 0
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) {
      tokens.push(buffer.subarray(start, index).toString('utf8'))
      start = index + 1
    }
  }
  return {
    tokens,
    hadTrailingRemainder: start < buffer.length,
  }
}

function parsePorcelainZ(
  buffer: Buffer,
  stdoutTruncated: boolean,
): { entries: ParsedPorcelainEntry[]; truncated: boolean } {
  const { tokens, hadTrailingRemainder } = splitNulTerminated(buffer)
  let truncated = stdoutTruncated || hadTrailingRemainder
  const entries: ParsedPorcelainEntry[] = []

  let index = 0
  while (index < tokens.length) {
    const token = tokens[index++]!
    if (token.length < 4 || token[2] !== ' ') {
      if (stdoutTruncated) truncated = true
      continue
    }
    const x = token[0]!
    const y = token[1]!
    const rawPath = token.slice(3)
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const rawOldPath = tokens[index++]
      if (rawOldPath === undefined) {
        truncated = true
        break
      }
      entries.push({ x, y, rawPath, rawOldPath })
    } else {
      entries.push({ x, y, rawPath })
    }
  }

  return { entries, truncated }
}

function parseNumstatZ(buffer: Buffer, stdoutTruncated: boolean): Map<string, TrackedNumstat> {
  const { tokens } = splitNulTerminated(buffer)
  const map = new Map<string, TrackedNumstat>()

  let index = 0
  while (index < tokens.length) {
    const token = tokens[index++]!
    const firstTab = token.indexOf('\t')
    if (firstTab < 0) continue
    const secondTab = token.indexOf('\t', firstTab + 1)
    if (secondTab < 0) continue

    const addStr = token.slice(0, firstTab)
    const delStr = token.slice(firstTab + 1, secondTab)
    let filePath = token.slice(secondTab + 1)

    if (filePath.length === 0) {
      const oldPath = tokens[index++]
      const newPath = tokens[index++]
      if (oldPath === undefined || newPath === undefined) {
        if (stdoutTruncated) break
        break
      }
      filePath = newPath
    }

    if (!isAllowedWorkspaceGitPath(filePath)) continue
    const isBinary = addStr === '-' || delStr === '-'
    const parsedAdd = isBinary ? null : Number.parseInt(addStr, 10)
    const parsedDel = isBinary ? null : Number.parseInt(delStr, 10)
    map.set(filePath, {
      additions: parsedAdd !== null && Number.isSafeInteger(parsedAdd) && parsedAdd >= 0 ? parsedAdd : null,
      deletions: parsedDel !== null && Number.isSafeInteger(parsedDel) && parsedDel >= 0 ? parsedDel : null,
      isBinary,
    })
  }

  return map
}

function stripRepoPrefix(repoRelativePath: string, prefix: string): string | undefined {
  if (prefix.length === 0) return repoRelativePath
  if (!repoRelativePath.startsWith(prefix)) return undefined
  return repoRelativePath.slice(prefix.length)
}

function stripUntrackedDirPrefix(repoDirPath: string, prefix: string): string | undefined {
  if (prefix.length === 0) {
    const stripped = repoDirPath.replace(/\/+$/, '')
    return stripped.length === 0 ? undefined : stripped
  }
  if (repoDirPath === prefix) return ''
  if (!repoDirPath.startsWith(prefix)) return undefined
  const stripped = repoDirPath.slice(prefix.length).replace(/\/+$/, '')
  return stripped.length === 0 ? '' : stripped
}

function isUnmergedPair(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

function mapPorcelainChar(ch: string): WorkspaceGitFileStatus {
  switch (ch) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    default: return 'modified'
  }
}

function classifyTrackedStatus(
  x: string,
  y: string,
  isUnmerged: boolean,
  scope: WorkspaceGitScope,
): WorkspaceGitFileStatus {
  if (isUnmerged) return 'unmerged'
  if (scope === 'staged') return mapPorcelainChar(x)
  if (scope === 'unstaged') return mapPorcelainChar(y)
  if (x === 'R') return 'renamed'
  if (x === 'C') return 'copied'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x !== ' ') return mapPorcelainChar(x)
  return mapPorcelainChar(y)
}

async function inspectUntrackedFile(
  canonicalRoot: string,
  relPath: string,
): Promise<{ additions: number | null; deletions: number | null; isBinary: boolean } | undefined> {
  let check: TargetPathCheck
  try {
    check = await validateTargetPath(canonicalRoot, relPath)
  } catch {
    return undefined
  }
  if (!check.exists || !check.isFile) return undefined

  let handle
  try {
    handle = await open(check.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch {
    return undefined
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > UNTRACKED_MAX_BYTES) return undefined
    const readResult = await readHandleBounded(handle, UNTRACKED_MAX_BYTES)
    if (readResult.exceededLimit) return undefined
    const data = readResult.data
    if (isBinaryBuffer(data)) {
      return { additions: null, deletions: null, isBinary: true }
    }
    return {
      additions: countBufferLines(data),
      deletions: 0,
      isBinary: false,
    }
  } catch {
    return undefined
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function synthesizeUntrackedFileDiff(
  absolutePath: string,
  relPath: string,
  scope: WorkspaceGitScope,
): Promise<WorkspaceGitDiffResult> {
  let handle
  try {
    handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ELOOP') {
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'Symbolic links are not supported.', 'symlink')
    }
    throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is unavailable.', 'io')
  }

  let data: Buffer
  let exceededBytes: boolean
  try {
    const info = await handle.stat()
    if (!info.isFile()) {
      throw workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is not a regular file.', 'not-regular-file')
    }
    const readResult = await readHandleBounded(handle, WORKSPACE_GIT_MAX_DIFF_BYTES)
    data = readResult.data
    exceededBytes = readResult.exceededLimit
  } finally {
    await handle.close().catch(() => undefined)
  }

  if (isBinaryBuffer(data)) {
    return {
      isGitRepo: true,
      path: relPath,
      scope,
      diff: '',
      bytes: 0,
      lines: 0,
      additions: 0,
      deletions: 0,
      isBinary: true,
      truncated: false,
    }
  }

  const oldHeaderPath = formatGitDiffPath('a/', relPath)
  const newHeaderPath = formatGitDiffPath('b/', relPath)

  if (data.length === 0) {
    const emptyDiff = `diff --git ${oldHeaderPath} ${newHeaderPath}\nnew file mode 100644\n`
    return {
      isGitRepo: true,
      path: relPath,
      scope,
      diff: emptyDiff,
      bytes: Buffer.byteLength(emptyDiff, 'utf8'),
      lines: 2,
      additions: 0,
      deletions: 0,
      isBinary: false,
      truncated: false,
    }
  }

  let text = (exceededBytes ? trimIncompleteUtf8Tail(data) : data).toString('utf8')
  let truncated = exceededBytes
  let truncatedReason: 'max-bytes' | 'max-lines' | undefined = exceededBytes ? 'max-bytes' : undefined

  if (exceededBytes && !text.endsWith('\n')) {
    const lastNewline = text.lastIndexOf('\n')
    if (lastNewline >= 0) {
      text = text.slice(0, lastNewline + 1)
    }
  }

  const hasTrailingNewline = text.endsWith('\n')
  const contentLines = (hasTrailingNewline ? text.slice(0, -1) : text).split('\n')
  const candidateLines: string[] = [
    `diff --git ${oldHeaderPath} ${newHeaderPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ ${newHeaderPath}`,
    `@@ -0,0 +1,${contentLines.length} @@`,
    ...contentLines.map(line => `+${line}`),
  ]
  if (!hasTrailingNewline && !exceededBytes) {
    candidateLines.push('\\ No newline at end of file')
  }

  const keptLines: string[] = []
  let keptBytes = 0
  let endedWithNewline = true
  for (const line of candidateLines) {
    if (keptLines.length >= WORKSPACE_GIT_MAX_DIFF_LINES) {
      truncated = true
      truncatedReason = 'max-lines'
      break
    }
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1
    if (keptBytes + lineBytes > WORKSPACE_GIT_MAX_DIFF_BYTES) {
      const remaining = WORKSPACE_GIT_MAX_DIFF_BYTES - keptBytes
      const hasAddedContentLine = keptLines.some(existing => existing.startsWith('+') && !existing.startsWith('+++ '))
      if (remaining > 1 && line.startsWith('+') && !hasAddedContentLine) {
        const sliced = trimIncompleteUtf8Tail(Buffer.from(line, 'utf8').subarray(0, remaining)).toString('utf8')
        if (sliced.length > 0) {
          keptLines.push(sliced)
          keptBytes += Buffer.byteLength(sliced, 'utf8')
          endedWithNewline = false
        }
      }
      truncated = true
      truncatedReason = 'max-bytes'
      break
    }
    keptLines.push(line)
    keptBytes += lineBytes
  }

  const diff = keptLines.length === 0
    ? ''
    : endedWithNewline ? `${keptLines.join('\n')}\n` : keptLines.join('\n')
  const { additions, deletions } = countUnifiedDiffChanges(keptLines)

  return {
    isGitRepo: true,
    path: relPath,
    scope,
    diff,
    bytes: Buffer.byteLength(diff, 'utf8'),
    lines: keptLines.length,
    additions,
    deletions,
    isBinary: false,
    truncated,
    ...(truncated && truncatedReason !== undefined ? { truncatedReason } : {}),
  }
}

async function readHandleBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
): Promise<{ data: Buffer; exceededLimit: boolean }> {
  const chunks: Buffer[] = []
  let total = 0
  const chunkSize = 32 * 1024
  while (total <= maxBytes) {
    const remaining = maxBytes + 1 - total
    const buffer = Buffer.allocUnsafe(Math.min(chunkSize, remaining))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, total)
    if (bytesRead === 0) break
    chunks.push(buffer.subarray(0, bytesRead))
    total += bytesRead
  }
  const combined = Buffer.concat(chunks)
  if (combined.length > maxBytes) {
    return { data: combined.subarray(0, maxBytes), exceededLimit: true }
  }
  return { data: combined, exceededLimit: false }
}

function isBinaryBuffer(data: Buffer): boolean {
  const sniffLength = Math.min(data.length, BINARY_SNIFF_BYTES)
  return data.subarray(0, sniffLength).includes(0)
}

function countBufferLines(data: Buffer): number {
  if (data.length === 0) return 0
  let count = 0
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] === 0x0a) count += 1
  }
  if (data[data.length - 1] !== 0x0a) count += 1
  return count
}

function trimIncompleteUtf8Tail(buffer: Buffer): Buffer {
  if (buffer.length === 0) return buffer
  let index = buffer.length - 1
  let continuations = 0
  while (index >= 0 && continuations < 3 && (buffer[index]! & 0xc0) === 0x80) {
    index -= 1
    continuations += 1
  }
  if (index < 0) return buffer.subarray(0, 0)
  const lead = buffer[index]!
  let expectedLength = 1
  if ((lead & 0x80) === 0x00) {
    expectedLength = 1
  } else if ((lead & 0xe0) === 0xc0) {
    expectedLength = 2
  } else if ((lead & 0xf0) === 0xe0) {
    expectedLength = 3
  } else if ((lead & 0xf8) === 0xf0) {
    expectedLength = 4
  } else {
    return buffer.subarray(0, index)
  }
  const actualLength = buffer.length - index
  return actualLength < expectedLength ? buffer.subarray(0, index) : buffer
}

function formatGitDiffPath(prefix: 'a/' | 'b/', relPath: string): string {
  const full = `${prefix}${relPath}`
  if (!/[\x00-\x1f\x7f"\\]/.test(relPath)) return full
  let escaped = ''
  for (const ch of full) {
    const code = ch.charCodeAt(0)
    if (ch === '\\') escaped += '\\\\'
    else if (ch === '"') escaped += '\\"'
    else if (ch === '\t') escaped += '\\t'
    else if (ch === '\n') escaped += '\\n'
    else if (ch === '\r') escaped += '\\r'
    else if (code < 0x20 || code === 0x7f) escaped += `\\${code.toString(8).padStart(3, '0')}`
    else escaped += ch
  }
  return `"${escaped}"`
}

function unquoteGitHeaderPath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(["\\tnr])/g, (_, ch: string) => {
        if (ch === 't') return '\t'
        if (ch === 'n') return '\n'
        if (ch === 'r') return '\r'
        return ch
      })
  }
  return trimmed
}

function extractDiffSectionPaths(headerLine: string): string[] {
  if (headerLine.startsWith('diff --cc ')) {
    const p = unquoteGitHeaderPath(headerLine.slice('diff --cc '.length))
    return p.length > 0 ? [p] : []
  }
  if (headerLine.startsWith('diff --combined ')) {
    const p = unquoteGitHeaderPath(headerLine.slice('diff --combined '.length))
    return p.length > 0 ? [p] : []
  }
  if (!headerLine.startsWith('diff --git ')) return []
  const rest = headerLine.slice('diff --git '.length)
  const paths: string[] = []
  const stripPrefix = (raw: string, prefix: 'a/' | 'b/'): string => {
    const unquoted = unquoteGitHeaderPath(raw)
    return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted
  }
  if (rest.startsWith('"')) {
    let idx = 1
    while (idx < rest.length) {
      if (rest[idx] === '\\') { idx += 2; continue }
      if (rest[idx] === '"') { idx += 1; break }
      idx += 1
    }
    const left = rest.slice(0, idx)
    const right = rest.slice(idx + 1)
    if (left.length > 0) paths.push(stripPrefix(left, 'a/'))
    if (right.length > 0) paths.push(stripPrefix(right, 'b/'))
    return paths
  }
  if (rest.endsWith('"')) {
    const split = rest.indexOf(' "b/')
    if (split > 0) {
      paths.push(stripPrefix(rest.slice(0, split), 'a/'))
      paths.push(stripPrefix(rest.slice(split + 1), 'b/'))
      return paths
    }
  }
  if (rest.startsWith('a/') && (rest.length - 1) % 2 === 0) {
    const half = (rest.length - 1) / 2
    if (rest[half] === ' ' && rest.slice(half + 1, half + 3) === 'b/' && rest.slice(2, half) === rest.slice(half + 3)) {
      const same = rest.slice(2, half)
      return [same, same]
    }
  }
  const plain = /^a\/(.+?) b\/(.+)$/.exec(rest)
  if (plain !== null && plain[1] !== undefined && plain[2] !== undefined) {
    return [plain[1], plain[2]]
  }
  return []
}

function isDiffFileHeaderLine(line: string): boolean {
  return line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined ')
}

function filterAllowedDiffSections(lines: readonly string[]): string[] {
  const result: string[] = []
  let keepCurrent = true
  for (const line of lines) {
    if (isDiffFileHeaderLine(line)) {
      const paths = extractDiffSectionPaths(line)
      keepCurrent = paths.length > 0 && paths.every(p => isAllowedWorkspaceGitPath(p))
    }
    if (keepCurrent) result.push(line)
  }
  return result
}

function formatDiffOutput(
  rawStdout: Buffer,
  stdoutTruncated: boolean,
  scope: WorkspaceGitScope,
  path: string | undefined,
): WorkspaceGitDiffResult {
  let truncated = stdoutTruncated
  let truncatedReason: 'max-bytes' | 'max-lines' | undefined = stdoutTruncated ? 'max-bytes' : undefined

  const cleanBuffer = stdoutTruncated ? trimIncompleteUtf8Tail(rawStdout) : rawStdout
  let text = cleanBuffer.toString('utf8')

  if (stdoutTruncated && !text.endsWith('\n')) {
    const lastNewline = text.lastIndexOf('\n')
    if (lastNewline >= 0) {
      text = text.slice(0, lastNewline + 1)
    }
  }

  let linesList = text.length === 0
    ? []
    : (text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n'))

  if (path === undefined && linesList.length > 0) {
    const filtered = filterAllowedDiffSections(linesList)
    if (filtered.length !== linesList.length) {
      linesList = filtered
      text = linesList.length === 0 ? '' : `${linesList.join('\n')}\n`
    }
  }

  if (linesList.length > WORKSPACE_GIT_MAX_DIFF_LINES) {
    linesList = linesList.slice(0, WORKSPACE_GIT_MAX_DIFF_LINES)
    text = `${linesList.join('\n')}\n`
    truncated = true
    truncatedReason = 'max-lines'
  }

  const isBinary = linesList.some(
    line => /^Binary files .* differ$/.test(line) || line === 'GIT binary patch',
  )
  const { additions, deletions } = countUnifiedDiffChanges(linesList)

  return {
    isGitRepo: true,
    ...(path === undefined ? {} : { path }),
    scope,
    diff: text,
    bytes: Buffer.byteLength(text, 'utf8'),
    lines: linesList.length,
    additions,
    deletions,
    isBinary,
    truncated,
    ...(truncated && truncatedReason !== undefined ? { truncatedReason } : {}),
  }
}

function countUnifiedDiffChanges(lines: readonly string[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  let hunkPrefixWidth = 0
  for (const line of lines) {
    if (isDiffFileHeaderLine(line)) {
      hunkPrefixWidth = 0
      continue
    }
    if (line.startsWith('@@ ')) {
      hunkPrefixWidth = 1
      continue
    }
    const combinedMatch = COMBINED_HUNK_HEADER_RE.exec(line)
    if (combinedMatch !== null && combinedMatch[1] !== undefined) {
      hunkPrefixWidth = combinedMatch[1].length - 1
      continue
    }
    if (hunkPrefixWidth === 0) continue
    if (line.startsWith('\\')) continue
    if (hunkPrefixWidth === 1) {
      if (line.startsWith('+')) {
        additions += 1
      } else if (line.startsWith('-')) {
        deletions += 1
      } else if (!line.startsWith(' ')) {
        hunkPrefixWidth = 0
      }
      continue
    }
    if (line.length < hunkPrefixWidth) {
      hunkPrefixWidth = 0
      continue
    }
    const prefix = line.slice(0, hunkPrefixWidth)
    if (!/^[ +-]+$/.test(prefix)) {
      hunkPrefixWidth = 0
      continue
    }
    if (prefix.includes('+')) {
      additions += 1
    } else if (prefix.includes('-')) {
      deletions += 1
    }
  }
  return { additions, deletions }
}
