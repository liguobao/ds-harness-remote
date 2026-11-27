import {
  WORKSPACE_GIT_CAPABILITY,
  WORKSPACE_GIT_MAX_DIFF_BYTES,
  WORKSPACE_GIT_MAX_DIFF_LINES,
  WORKSPACE_GIT_MAX_FILES,
  createRpcRequest,
  workspaceGitDiffResultSchema,
  workspaceGitStatusResultSchema,
} from '@dsh-remote/protocol'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SafeLogger } from '../src/logging.js'
import { RpcRouter } from '../src/rpc-router.js'
import { RpcError } from '../src/safe-error.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'
import {
  WorkspaceGitHost,
  buildSanitizedGitEnv,
  resolveGitExecutable,
  type WorkspaceGitHostOptions,
} from '../src/workspace-git.js'
import {
  resolveSessionWorkspaceRoot,
  workspaceUploadRootResolver,
} from '../src/workspace-upload-authority.js'
import { WorkspaceUploadHost } from '../src/workspace-upload.js'

const hosts: WorkspaceGitHost[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.closeAll()))
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })))
})

async function createTempDir(prefix = 'dsh-git-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  directories.push(dir)
  return dir
}

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c', 'user.name=Test User',
      '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.autocrlf=false',
      '-c', 'core.quotepath=false',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      env: buildSanitizedGitEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
}

async function initRepo(initialCommit = true): Promise<string> {
  const root = await createTempDir('dsh-git-repo-')
  git(root, ['init', '-b', 'main'])
  if (initialCommit) {
    await writeFile(join(root, 'README.md'), 'hello\nworld\n')
    git(root, ['add', 'README.md'])
    git(root, ['commit', '-m', 'initial'])
  }
  return root
}

function createHost(
  resolve: (sessionId: string, signal: AbortSignal) => Promise<string | undefined>,
  options?: WorkspaceGitHostOptions,
): WorkspaceGitHost {
  const host = new WorkspaceGitHost(resolve, options)
  hosts.push(host)
  return host
}

async function createSymlinkOrSkip(target: string, linkPath: string, type: 'file' | 'dir' | 'junction'): Promise<boolean> {
  try {
    await symlink(target, linkPath, type)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
      return false
    }
    throw error
  }
}

describe('WorkspaceGitHost', { timeout: 30_000 }, () => {
  it('reports modified, added, deleted, renamed, untracked, nested dirs, staged+unstaged, binary, and CJK/space paths accurately', async () => {
    const root = await initRepo(false)
    await mkdir(join(root, '文档 笔记'), { recursive: true })
    await writeFile(join(root, 'keep.txt'), 'line1\nline2\nline3\n')
    await writeFile(join(root, 'to-delete.txt'), 'bye1\nbye2\n')
    await writeFile(join(root, 'to-rename.txt'), 'same1\nsame2\n')
    await writeFile(join(root, 'both.txt'), 'v1\n')
    await writeFile(join(root, 'asset.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    await writeFile(join(root, '文档 笔记', '测试 文件.txt'), '第一行\n第二行\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'seed'])

    // Unstaged modification
    await writeFile(join(root, 'keep.txt'), 'line1\nline2-changed\nline3\nline4\n')
    // Staged new file
    await writeFile(join(root, 'staged-new.txt'), 'alpha\nbeta\n')
    git(root, ['add', 'staged-new.txt'])
    // Both staged and unstaged changes
    await writeFile(join(root, 'both.txt'), 'v2-staged\n')
    git(root, ['add', 'both.txt'])
    await writeFile(join(root, 'both.txt'), 'v2-staged\nv3-unstaged\n')
    // Deleted tracked file (working tree)
    await rm(join(root, 'to-delete.txt'))
    // Renamed tracked file
    git(root, ['mv', 'to-rename.txt', 'renamed.txt'])
    // Modified binary file
    await writeFile(join(root, 'asset.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xee, 0xdd]))
    // CJK + space filename modified
    await writeFile(join(root, '文档 笔记', '测试 文件.txt'), '第一行\n第二行修改\n第三行\n')
    // Untracked text file, binary file, and nested directory (with ignored .git / node_modules skipped)
    await writeFile(join(root, 'untracked.txt'), 'u1\nu2\nu3')
    await writeFile(join(root, 'untracked.bin'), Buffer.from([0x01, 0x00, 0x02, 0x03]))
    await mkdir(join(root, 'new-dir', 'sub'), { recursive: true })
    await mkdir(join(root, 'new-dir', 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'new-dir', 'sub', 'leaf.ts'), 'export const x = 1\n')
    await writeFile(join(root, 'new-dir', 'node_modules', 'pkg', 'ignored.js'), 'module.exports = 1\n')

    const host = createHost(async id => (id === 's1' ? root : undefined))

    const allStatus = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 's1' }))
    expect(allStatus.isGitRepo).toBe(true)
    expect(allStatus.hasHead).toBe(true)
    expect(allStatus.branch).toBe('main')
    expect(allStatus.headShortSha).toMatch(/^[0-9a-f]{7,}$/)
    expect(allStatus.scope).toBe('all')
    expect(allStatus.truncated).toBe(false)

    const byPath = new Map(allStatus.files.map(entry => [entry.path, entry]))
    expect(byPath.get('keep.txt')).toMatchObject({ status: 'modified', staged: false, unstaged: true, additions: 2, deletions: 1, isBinary: false })
    expect(byPath.get('staged-new.txt')).toMatchObject({ status: 'added', staged: true, unstaged: false, additions: 2, deletions: 0, isBinary: false })
    expect(byPath.get('both.txt')).toMatchObject({ status: 'modified', staged: true, unstaged: true, additions: 2, deletions: 1, isBinary: false })
    expect(byPath.get('to-delete.txt')).toMatchObject({ status: 'deleted', staged: false, unstaged: true, additions: 0, deletions: 2, isBinary: false })
    expect(byPath.get('renamed.txt')).toMatchObject({ status: 'renamed', oldPath: 'to-rename.txt', staged: true, unstaged: false, additions: 0, deletions: 0, isBinary: false })
    expect(byPath.get('asset.bin')).toMatchObject({ status: 'modified', additions: null, deletions: null, isBinary: true })
    expect(byPath.get('文档 笔记/测试 文件.txt')).toMatchObject({ status: 'modified', additions: 2, deletions: 1, isBinary: false })
    expect(byPath.get('untracked.txt')).toMatchObject({ status: 'untracked', staged: false, unstaged: true, additions: 3, deletions: 0, isBinary: false })
    expect(byPath.get('untracked.bin')).toMatchObject({ status: 'untracked', additions: null, deletions: null, isBinary: true })
    expect(byPath.get('new-dir/sub/leaf.ts')).toMatchObject({ status: 'untracked', additions: 1, deletions: 0, isBinary: false })
    expect(byPath.has('new-dir/node_modules/pkg/ignored.js')).toBe(false)

    // Staged scope excludes untracked and unstaged-only files
    const stagedStatus = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 's1', scope: 'staged' }))
    const stagedPaths = stagedStatus.files.map(entry => entry.path)
    expect(stagedPaths).toContain('staged-new.txt')
    expect(stagedPaths).toContain('both.txt')
    expect(stagedPaths).toContain('renamed.txt')
    expect(stagedPaths).not.toContain('keep.txt')
    expect(stagedPaths).not.toContain('untracked.txt')
    expect(stagedPaths).not.toContain('new-dir/sub/leaf.ts')

    // Unstaged scope includes unstaged edits and untracked files
    const unstagedStatus = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 's1', scope: 'unstaged' }))
    const unstagedPaths = unstagedStatus.files.map(entry => entry.path)
    expect(unstagedPaths).toContain('keep.txt')
    expect(unstagedPaths).toContain('both.txt')
    expect(unstagedPaths).toContain('untracked.txt')
    expect(unstagedPaths).not.toContain('staged-new.txt')

    // Diff for tracked modified file
    const modDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 's1', path: 'keep.txt', contextLines: 1 }))
    expect(modDiff.isGitRepo).toBe(true)
    expect(modDiff.isBinary).toBe(false)
    expect(modDiff.additions).toBe(2)
    expect(modDiff.deletions).toBe(1)
    expect(modDiff.diff).toContain('--- a/keep.txt')
    expect(modDiff.diff).toContain('+++ b/keep.txt')
    expect(modDiff.diff).toContain('+line2-changed')

    // Diff for deleted file (ENOENT on disk, read from git)
    const deletedDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 's1', path: 'to-delete.txt' }))
    expect(deletedDiff.deletions).toBe(2)
    expect(deletedDiff.diff).toContain('-bye1')

    // Diff for CJK + space path
    const cjkDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 's1', path: '文档 笔记/测试 文件.txt' }))
    expect(cjkDiff.diff).toContain('+第三行')

    // Diff for tracked binary file
    const binDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 's1', path: 'asset.bin' }))
    expect(binDiff.isBinary).toBe(true)

    // Diff for untracked text file synthesizes unified diff in all/unstaged and stays empty in staged
    const untrackedDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 's1', path: 'untracked.txt' }))
    expect(untrackedDiff.isBinary).toBe(false)
    expect(untrackedDiff.additions).toBe(3)
    expect(untrackedDiff.deletions).toBe(0)
    expect(untrackedDiff.diff).toContain('--- /dev/null')
    expect(untrackedDiff.diff).toContain('+++ b/untracked.txt')
    expect(untrackedDiff.diff).toContain('+u1\n+u2\n+u3')
    expect(untrackedDiff.diff).toContain('\\ No newline at end of file')

    const untrackedStagedDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 's1', path: 'untracked.txt', scope: 'staged' }))
    expect(untrackedStagedDiff.diff).toBe('')
    expect(untrackedStagedDiff.additions).toBe(0)

    // Diff for untracked binary file
    const untrackedBinDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 's1', path: 'untracked.bin' }))
    expect(untrackedBinDiff.isBinary).toBe(true)
    expect(untrackedBinDiff.diff).toBe('')
  })

  it('supports unborn HEAD repositories before the first commit', async () => {
    const root = await initRepo(false)
    await writeFile(join(root, 'staged.ts'), 'const a = 1\nconst b = 2\n')
    git(root, ['add', 'staged.ts'])
    await writeFile(join(root, 'untracked.ts'), 'const c = 3\n')

    const host = createHost(async () => root)
    const status = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'unborn' }))
    expect(status.isGitRepo).toBe(true)
    expect(status.hasHead).toBe(false)
    expect(status.headShortSha).toBeUndefined()
    expect(status.branch).toBe('main')
    const byPath = new Map(status.files.map(entry => [entry.path, entry]))
    expect(byPath.get('staged.ts')).toMatchObject({ status: 'added', staged: true, additions: 2, deletions: 0 })
    expect(byPath.get('untracked.ts')).toMatchObject({ status: 'untracked', additions: 1, deletions: 0 })

    const allDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'unborn', scope: 'all' }))
    expect(allDiff.diff).toContain('+const a = 1')
    expect(allDiff.additions).toBe(2)

    const untrackedDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'unborn', path: 'untracked.ts', scope: 'all' }))
    expect(untrackedDiff.diff).toContain('+const c = 3')
    expect(untrackedDiff.additions).toBe(1)
  })

  it('scopes subdirectory workspaces strictly and omits cross-boundary rename oldPath', async () => {
    const parent = await initRepo(false)
    const subDir = join(parent, 'packages', 'app')
    const siblingDir = join(parent, 'packages', 'secret-sibling')
    await mkdir(subDir, { recursive: true })
    await mkdir(siblingDir, { recursive: true })
    await writeFile(join(parent, 'outside.txt'), 'outside-origin\n')
    await writeFile(join(siblingDir, 'secret.txt'), 'sibling-secret\n')
    await writeFile(join(subDir, 'inside.txt'), 'inside-v1\n')
    await writeFile(join(subDir, 'moving-out.txt'), 'leaving-sub\n')
    git(parent, ['add', '-A'])
    git(parent, ['commit', '-m', 'seed'])

    await writeFile(join(siblingDir, 'secret.txt'), 'sibling-secret-modified\n')
    await writeFile(join(subDir, 'inside.txt'), 'inside-v2\n')
    git(parent, ['mv', 'outside.txt', 'packages/app/moved-in.txt'])
    git(parent, ['mv', 'packages/app/moving-out.txt', 'moved-outside.txt'])

    const host = createHost(async () => subDir)
    const status = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'sub' }))
    expect(status.isGitRepo).toBe(true)

    const paths = status.files.map(entry => entry.path)
    expect(paths).toContain('inside.txt')
    expect(paths).toContain('moved-in.txt')
    expect(paths).not.toContain('outside.txt')
    expect(paths).not.toContain('moved-outside.txt')
    expect(paths.some(p => p.includes('secret-sibling'))).toBe(false)

    const movedIn = status.files.find(entry => entry.path === 'moved-in.txt')
    expect(movedIn).toBeDefined()
    expect(movedIn?.oldPath).toBeUndefined()

    const fullDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'sub' }))
    expect(fullDiff.diff).toContain('inside-v2')
    expect(fullDiff.diff).not.toContain('sibling-secret-modified')
    expect(fullDiff.diff).not.toContain('outside.txt')
  })

  it('returns isGitRepo: false for non-Git directories', async () => {
    const dir = await createTempDir('dsh-non-git-')
    await writeFile(join(dir, 'plain.txt'), 'hello\n')
    const host = createHost(async () => dir)

    const status = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'plain' }))
    expect(status).toEqual({
      isGitRepo: false,
      hasHead: false,
      scope: 'all',
      files: [],
      totalFiles: 0,
      truncated: false,
      totalAdditions: 0,
      totalDeletions: 0,
    })

    const diff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'plain', path: 'plain.txt' }))
    expect(diff).toEqual({
      isGitRepo: false,
      path: 'plain.txt',
      scope: 'all',
      diff: '',
      bytes: 0,
      lines: 0,
      additions: 0,
      deletions: 0,
      isBinary: false,
      truncated: false,
    })
  })

  it('denies symlink ancestors and targets, and does not read untracked symlinks', async () => {
    const repo = await initRepo(true)
    const outside = await createTempDir('dsh-git-outside-')
    await writeFile(join(outside, 'secret.txt'), 'TOP-SECRET-LINE-1\nTOP-SECRET-LINE-2\n')

    const dirLinkCreated = await createSymlinkOrSkip(
      outside,
      join(repo, 'escape-dir'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const fileLinkCreated = await createSymlinkOrSkip(
      join(outside, 'secret.txt'),
      join(repo, 'escape-file.txt'),
      'file',
    )
    await mkdir(join(repo, 'untracked-dir'), { recursive: true })
    await writeFile(join(repo, 'untracked-dir', 'normal.txt'), 'ok\n')
    if (dirLinkCreated) {
      await createSymlinkOrSkip(
        outside,
        join(repo, 'untracked-dir', 'nested-link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    }

    const host = createHost(async () => repo)

    if (dirLinkCreated) {
      await expect(host.diff({ sessionId: 'sym', path: 'escape-dir/secret.txt' })).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_DENIED',
        details: { reason: 'symlink' },
      })
    }

    if (fileLinkCreated) {
      await expect(host.diff({ sessionId: 'sym', path: 'escape-file.txt' })).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_DENIED',
        details: { reason: 'symlink' },
      })
    }

    const status = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'sym' }))
    expect(status.files.some(entry => entry.path.includes('nested-link'))).toBe(false)
    expect(status.files.some(entry => entry.path === 'untracked-dir/normal.txt')).toBe(true)
    if (fileLinkCreated) {
      const linkEntry = status.files.find(entry => entry.path === 'escape-file.txt')
      if (linkEntry) {
        expect(linkEntry.additions).toBeNull()
        expect(linkEntry.deletions).toBeNull()
      }
    }
  })

  it('neutralizes malicious .git/config settings (diff.external, core.fsmonitor, diff.noprefix, diff.mnemonicPrefix)', async () => {
    const repo = await initRepo(true)
    const markerDir = await createTempDir('dsh-git-marker-')
    const fsmonitorMarker = join(markerDir, 'fsmonitor-ran')
    const externalDiffMarker = join(markerDir, 'extdiff-ran')

    const maliciousNode = (marker: string) =>
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(marker)}, 'pwned')`)}`

    git(repo, ['config', 'core.fsmonitor', maliciousNode(fsmonitorMarker)])
    git(repo, ['config', 'diff.external', maliciousNode(externalDiffMarker)])
    git(repo, ['config', 'diff.noprefix', 'true'])
    git(repo, ['config', 'diff.mnemonicPrefix', 'true'])

    await writeFile(join(repo, 'README.md'), 'hello\nmodified\n')
    const host = createHost(async () => repo)

    const status = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'cfg' }))
    expect(status.files).toHaveLength(1)
    expect(status.files[0]?.path).toBe('README.md')

    const diff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'cfg', path: 'README.md' }))
    expect(diff.diff).toContain('--- a/README.md')
    expect(diff.diff).toContain('+++ b/README.md')
    expect(diff.diff).toContain('+modified')

    const { existsSync } = await import('node:fs')
    expect(existsSync(fsmonitorMarker)).toBe(false)
    expect(existsSync(externalDiffMarker)).toBe(false)
  })

  it('classifies dubious ownership stderr as WORKSPACE_GIT_UNSAFE_REPO without leaking stderr paths', async () => {
    const repo = await createTempDir('dsh-git-dubious-')
    const secretPath = '/private/owner/secret-project'
    const fakeSpawn = vi.fn((_cmd: string, _args: readonly string[], options: Parameters<typeof spawn>[2]) =>
      spawn(
        process.execPath,
        [
          '-e',
          `process.stderr.write("fatal: detected dubious ownership in repository at '${secretPath}'\\n"); process.exit(128)`,
        ],
        options,
      ),
    ) as unknown as typeof spawn

    const host = createHost(async () => repo, {
      gitExecutable: 'fake-git',
      spawnProcess: fakeSpawn,
    })

    let caught: unknown
    try {
      await host.status({ sessionId: 'dubious' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RpcError)
    const rpcErr = caught as RpcError
    expect(rpcErr.code).toBe('WORKSPACE_GIT_UNSAFE_REPO')
    expect(rpcErr.message).not.toContain(secretPath)
    expect(JSON.stringify(rpcErr.details ?? '')).not.toContain(secretPath)
  })

  it('rejects path injection payloads and .git metadata paths before invoking git', async () => {
    const repo = await initRepo(true)
    const resolveRoot = vi.fn(async () => repo)
    const spawnSpy = vi.fn(spawn) as unknown as typeof spawn
    const host = createHost(resolveRoot, { spawnProcess: spawnSpy })

    const maliciousPaths = [
      '../secret',
      'a/../../secret',
      '/etc/passwd',
      '-p',
      '--output=/tmp/pwn',
      'a:b',
      'a\\b',
      'file\0name',
      'file\nname',
      '.git/config',
      'sub/.GIT/HEAD',
    ]

    for (const badPath of maliciousPaths) {
      await expect(host.diff({ sessionId: 'inject', path: badPath })).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_DENIED',
      })
    }
    expect(resolveRoot).not.toHaveBeenCalled()
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('truncates status file lists at WORKSPACE_GIT_MAX_FILES and diffs at max-bytes and max-lines', async () => {
    const repo = await initRepo(true)
    await mkdir(join(repo, 'many'), { recursive: true })
    for (let index = 0; index < WORKSPACE_GIT_MAX_FILES + 12; index += 1) {
      await writeFile(join(repo, 'many', `f-${String(index).padStart(3, '0')}.txt`), `v${index}\n`)
    }

    const host = createHost(async () => repo)
    const status = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'trunc' }))
    expect(status.files).toHaveLength(WORKSPACE_GIT_MAX_FILES)
    expect(status.truncated).toBe(true)

    // Large tracked file triggering max-bytes truncation with multi-byte UTF-8 characters
    const largeUtf8Line = `${'中文测试数据'.repeat(80)}\n`
    await writeFile(join(repo, 'large-bytes.txt'), 'init\n')
    await writeFile(join(repo, 'many-lines.txt'), 'init\n')
    git(repo, ['add', 'large-bytes.txt', 'many-lines.txt'])
    git(repo, ['commit', '-m', 'add large targets'])

    await writeFile(join(repo, 'large-bytes.txt'), largeUtf8Line.repeat(300))
    const bytesDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'trunc', path: 'large-bytes.txt' }))
    expect(bytesDiff.truncated).toBe(true)
    expect(bytesDiff.truncatedReason).toBe('max-bytes')
    expect(bytesDiff.bytes).toBeLessThanOrEqual(WORKSPACE_GIT_MAX_DIFF_BYTES)
    expect(bytesDiff.diff).not.toContain('\uFFFD')

    // Many short lines triggering max-lines truncation
    const manyLinesContent = Array.from({ length: WORKSPACE_GIT_MAX_DIFF_LINES + 400 }, (_, i) => `L${i}`).join('\n') + '\n'
    await writeFile(join(repo, 'many-lines.txt'), manyLinesContent)
    const linesDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'trunc', path: 'many-lines.txt' }))
    expect(linesDiff.truncated).toBe(true)
    expect(linesDiff.truncatedReason).toBe('max-lines')
    expect(linesDiff.lines).toBeLessThanOrEqual(WORKSPACE_GIT_MAX_DIFF_LINES)

    // Untracked file hitting max-lines truncation
    await writeFile(join(repo, 'untracked-many-lines.txt'), manyLinesContent)
    const untrackedLinesDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'trunc', path: 'untracked-many-lines.txt' }))
    expect(untrackedLinesDiff.truncated).toBe(true)
    expect(untrackedLinesDiff.truncatedReason).toBe('max-lines')
    expect(untrackedLinesDiff.lines).toBeLessThanOrEqual(WORKSPACE_GIT_MAX_DIFF_LINES)
  })

  it('enforces per-connection concurrency limit and kills in-flight child processes on closeAll()', async () => {
    const repo = await createTempDir('dsh-git-conc-')
    const children: Array<ReturnType<typeof spawn>> = []
    let spawnedCount = 0
    let allSpawned!: () => void
    const fourSpawned = new Promise<void>(resolve => {
      allSpawned = resolve
    })

    const sleepingSpawn = vi.fn((_cmd: string, _args: readonly string[], options: Parameters<typeof spawn>[2]) => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options)
      children.push(child)
      spawnedCount += 1
      if (spawnedCount === 4) allSpawned()
      return child
    }) as unknown as typeof spawn

    const host = createHost(async () => repo, {
      gitExecutable: 'fake-git',
      spawnProcess: sleepingSpawn,
      maxConcurrent: 4,
    })

    const inFlight = [
      host.status({ sessionId: 'c1' }),
      host.status({ sessionId: 'c2' }),
      host.status({ sessionId: 'c3' }),
      host.status({ sessionId: 'c4' }),
    ]
    await fourSpawned

    // 5th concurrent request must be rate limited immediately
    await expect(host.status({ sessionId: 'c5' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    })

    // closeAll kills every active child process and rejects pending calls
    const settledPromise = Promise.allSettled(inFlight)
    await host.closeAll()
    const settled = await settledPromise
    for (const outcome of settled) {
      expect(outcome.status).toBe('rejected')
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({ code: 'WORKSPACE_GIT_CLOSED' })
    }
    for (const child of children) {
      expect(child.exitCode !== null || child.signalCode !== null || child.killed).toBe(true)
    }

    await expect(host.status({ sessionId: 'after-close' })).rejects.toMatchObject({ code: 'WORKSPACE_GIT_CLOSED' })
  })

  it('caches verified session roots for 5s and masks authority errors without exposing UPLOAD_* codes', async () => {
    const repo = await createTempDir('dsh-git-cache-')
    let nowMs = 10_000
    const resolveRoot = vi.fn(async (id: string) => {
      if (id === 'bad') throw new RpcError('UPLOAD_WORKSPACE_UNAVAILABLE', 'upload denied')
      return repo
    })
    const host = createHost(resolveRoot, { now: () => nowMs })

    await host.status({ sessionId: 'cached' })
    expect(resolveRoot).toHaveBeenCalledTimes(1)

    nowMs += 4_999
    await host.status({ sessionId: 'cached' })
    expect(resolveRoot).toHaveBeenCalledTimes(1)

    nowMs += 2
    await host.status({ sessionId: 'cached' })
    expect(resolveRoot).toHaveBeenCalledTimes(2)

    await expect(host.status({ sessionId: 'bad' })).rejects.toMatchObject({
      code: 'WORKSPACE_UNAVAILABLE',
      details: { reason: 'authority-unavailable' },
    })
  })

  it('isolates Windows CWD fake git.exe and rejects .cmd/.bat/.com wrappers in resolveGitExecutable', async () => {
    const cwdDir = await createTempDir('dsh-git-cwd-')
    const shimDir = await createTempDir('dsh-git-shim-')
    const realBinDir = await createTempDir('dsh-git-bin-')

    await writeFile(join(cwdDir, 'git.exe'), 'fake-cwd-git')
    await writeFile(join(shimDir, 'git.cmd'), '@echo off\r\n')
    await writeFile(join(shimDir, 'git.bat'), '@echo off\r\n')
    await writeFile(join(shimDir, 'git.com'), 'fake-com')
    await writeFile(join(shimDir, 'git'), 'no-ext')
    await writeFile(join(realBinDir, 'git.exe'), 'real-git-exe')

    // Rejects shim-only / cwd-only / relative PATHs
    const onlyShims = await resolveGitExecutable({
      cwd: cwdDir,
      env: { PATH: `${cwdDir};.;relative/path;;${shimDir}` },
      platform: 'win32',
    })
    expect(onlyShims).toBeUndefined()

    // Skips cwdDir, empty, relative, and shimDir, then selects realBinDir/git.exe
    const resolved = await resolveGitExecutable({
      cwd: cwdDir,
      env: { PATH: `${cwdDir};.;relative/path;;${shimDir};"${realBinDir}"` },
      platform: 'win32',
    })
    expect(resolved).toBe(join(realBinDir, 'git.exe'))

    // Environment sanitizer removes GIT_*, PAGER, SSH_ASKPASS regardless of case
    const sanitized = buildSanitizedGitEnv({
      PATH: '/usr/bin',
      GIT_DIR: '/evil/.git',
      git_work_tree: '/evil',
      GIT_SSH_COMMAND: 'evil',
      PAGER: 'less',
      SSH_ASKPASS: '/evil/askpass',
      SAFE_KEEP: 'ok',
    })
    expect(sanitized.GIT_DIR).toBeUndefined()
    expect(sanitized.git_work_tree).toBeUndefined()
    expect(sanitized.GIT_SSH_COMMAND).toBeUndefined()
    expect(sanitized.PAGER).toBeUndefined()
    expect(sanitized.SSH_ASKPASS).toBeUndefined()
    expect(sanitized.SAFE_KEEP).toBe('ok')
    expect(sanitized.GIT_TERMINAL_PROMPT).toBe('0')
    expect(sanitized.GIT_OPTIONAL_LOCKS).toBe('0')
    expect(sanitized.GIT_NO_LAZY_FETCH).toBe('1')
    expect(sanitized.GIT_ALLOW_PROTOCOL).toBe('')
    expect(sanitized.GIT_PAGER).toBe('cat')
    expect(sanitized.LC_ALL).toBe('C')
  })

  it('resolves custom ACP backend sessionIds via resolveSessionWorkspaceRoot and preserves upload error codes', async () => {
    const codexSpy = vi.fn(async (threadId: string) => `/codex/${threadId}`)
    const acpSpy = vi.fn((publicId: string) => `/acp/${publicId}`)
    const dispatch = vi.fn(async () => ({
      ok: true as const,
      value: {
        items: [
          { sessionId: 'native-1', cwd: '/native/workspace' },
          { sessionId: 'harness:h1', cwd: '/harness/workspace' },
        ],
      },
    }))
    const gateway = { supportsCarrier: true, dispatch } as unknown as LocalTypertGateway

    const resolver = resolveSessionWorkspaceRoot(gateway, () => true, codexSpy, acpSpy)
    const signal = new AbortController().signal

    expect(await resolver('my-acp:sess-1', signal)).toBe('/acp/my-acp:sess-1')
    expect(await resolver('acp:sess-2', signal)).toBe('/acp/acp:sess-2')
    expect(await resolver('cursor:sess-3', signal)).toBe('/acp/cursor:sess-3')
    expect(await resolver('kimi:k1', signal)).toBe('/acp/kimi:k1')
    expect(acpSpy).toHaveBeenCalledTimes(4)

    expect(await resolver('codex:thread-1', signal)).toBe('/codex/thread-1')
    expect(codexSpy).toHaveBeenCalledWith('thread-1')

    expect(await resolver('native-1', signal)).toBe('/native/workspace')
    expect(await resolver('harness:h1', signal)).toBe('/harness/workspace')
    expect(dispatch).toHaveBeenCalledTimes(2)

    // Legacy upload wrapper retains UPLOAD_WORKSPACE_UNAVAILABLE
    const uploadResolver = workspaceUploadRootResolver(undefined, () => false, codexSpy, acpSpy)
    await expect(uploadResolver('native-1', signal)).rejects.toMatchObject({
      code: 'UPLOAD_WORKSPACE_UNAVAILABLE',
    })
  })

  it('advertises workspace.git.read.v1 and routes workspace.git.* RPCs through RpcRouter', async () => {
    const repo = await initRepo(true)
    await writeFile(join(repo, 'README.md'), 'hello\nrouter-edit\n')
    const gitHost = createHost(async id => (id === 'r1' ? repo : undefined))
    const closeSpy = vi.spyOn(gitHost, 'closeAll')
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as SafeLogger

    const router = new RpcRouter(
      undefined,
      logger,
      undefined,
      undefined,
      () => ['transport.relay'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      gitHost,
    )

    const describeResp = await router.handle(createRpcRequest('harness.transport.describe', {}))
    expect(describeResp).toMatchObject({
      type: 'rpc.response',
      payload: { result: { capabilities: expect.arrayContaining([WORKSPACE_GIT_CAPABILITY]) } },
    })

    const statusResp = await router.handle(createRpcRequest('workspace.git.status', { sessionId: 'r1' }))
    expect(statusResp).toMatchObject({
      type: 'rpc.response',
      payload: { result: { isGitRepo: true, totalFiles: 1 } },
    })

    const diffResp = await router.handle(createRpcRequest('workspace.git.diff', { sessionId: 'r1', path: 'README.md' }))
    expect(diffResp).toMatchObject({
      type: 'rpc.response',
      payload: { result: { isGitRepo: true, additions: 1, deletions: 1 } },
    })

    // Extra endpoint field in failed git call must not leak to warn logs
    const invalidResp = await router.handle(createRpcRequest('workspace.git.status', {
      sessionId: 'r1',
      endpoint: '/private/secret-path',
    }))
    expect(invalidResp).toMatchObject({ type: 'rpc.error', payload: { code: 'INVALID_MESSAGE' } })
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('secret-path')

    await router.closePeerStreams()
    expect(closeSpy).toHaveBeenCalledOnce()

    // Router without WorkspaceGitHost omits capability and returns FEATURE_NOT_SUPPORTED
    const disabledRouter = new RpcRouter(undefined, undefined, undefined, undefined, () => ['transport.relay'])
    const disabledDescribe = await disabledRouter.handle(createRpcRequest('harness.transport.describe', {}))
    expect((disabledDescribe.payload as { result: { capabilities: string[] } }).result.capabilities).not.toContain(WORKSPACE_GIT_CAPABILITY)
    expect(await disabledRouter.handle(createRpcRequest('workspace.git.status', { sessionId: 'r1' }))).toMatchObject({
      type: 'rpc.error',
      payload: { code: 'FEATURE_NOT_SUPPORTED' },
    })
    expect(await disabledRouter.handle(createRpcRequest('workspace.git.diff', { sessionId: 'r1' }))).toMatchObject({
      type: 'rpc.error',
      payload: { code: 'FEATURE_NOT_SUPPORTED' },
    })
  })

  it('neutralizes repository filter.<name>.clean and filter.<name>.process RCE vectors', async () => {
    const repo = await initRepo(true)
    const markerClean = join(repo, 'pwn-clean.flag')
    const markerProc = join(repo, 'pwn-proc.flag')
    const helperDir = await createTempDir('dsh-git-filter-helper-')
    const cleanScript = join(helperDir, 'clean.mjs')
    const procScript = join(helperDir, 'proc.mjs')
    await writeFile(cleanScript, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(markerClean)}, '1'); process.stdin.pipe(process.stdout);\n`)
    await writeFile(procScript, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(markerProc)}, '1'); process.exit(1);\n`)

    await writeFile(join(repo, '.gitattributes'), '*.txt filter=evil.A=1\n*.md filter=procEvil\n')
    await writeFile(join(repo, 'clean.txt'), 'v1\n')
    git(repo, ['add', '.gitattributes', 'clean.txt'])
    git(repo, ['commit', '-m', 'add filter attrs'])

    const nodeBin = process.execPath.replaceAll('\\', '/')
    git(repo, ['config', 'filter.evil.A=1.clean', `"${nodeBin}" "${cleanScript.replaceAll('\\', '/')}"`])
    git(repo, ['config', 'filter.evil.A=1.required', 'true'])
    git(repo, ['config', 'filter.procEvil.process', `"${nodeBin}" "${procScript.replaceAll('\\', '/')}"`])
    git(repo, ['config', 'filter.procEvil.required', 'true'])

    await writeFile(join(repo, 'clean.txt'), 'v2\n')
    await writeFile(join(repo, 'README.md'), 'updated-md\n')

    const host = createHost(async () => repo)
    const st = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'flt' }))
    expect(st.files.map(f => f.path).sort()).toEqual(['README.md', 'clean.txt'])

    const diffTxt = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'flt', path: 'clean.txt' }))
    const diffMd = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'flt', path: 'README.md' }))
    expect(diffTxt.diff).toContain('+v2')
    expect(diffMd.diff).toContain('+updated-md')
    expect(existsSync(markerClean)).toBe(false)
    expect(existsSync(markerProc)).toBe(false)
  })

  it('respects .gitignore for untracked diff requests and untracked directory expansion', async () => {
    const repo = await initRepo(true)
    await writeFile(join(repo, '.gitignore'), '.env\n*.secret\nignored_dir/\n')
    git(repo, ['add', '.gitignore'])
    git(repo, ['commit', '-m', 'add gitignore'])

    await writeFile(join(repo, '.env'), 'SECRET_API_KEY=super-secret-value\n')
    await mkdir(join(repo, 'newdir', 'ignored_dir'), { recursive: true })
    await writeFile(join(repo, 'newdir', 'visible.txt'), 'visible\n')
    await writeFile(join(repo, 'newdir', 'creds.secret'), 'top-secret\n')
    await writeFile(join(repo, 'newdir', 'ignored_dir', 'token.txt'), 'hidden-token\n')

    const host = createHost(async () => repo)
    const st = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'ign' }))
    expect(st.files.map(f => f.path)).toEqual(['newdir/visible.txt'])

    const envDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'ign', path: '.env' }))
    expect(envDiff.isGitRepo).toBe(true)
    expect(envDiff.diff).toBe('')
    expect(envDiff.bytes).toBe(0)

    const secretDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'ign', path: 'newdir/creds.secret' }))
    expect(secretDiff.diff).toBe('')
  })

  it('handles unmerged combined diff, bare repositories, top-level untracked symlinks, and root leading-dash files consistently', async () => {
    // 1. Merge conflict combined diff (diff --cc / @@@)
    const conflictRepo = await initRepo(true)
    await writeFile(join(conflictRepo, 'conflict.txt'), 'line1\nbase\nline3\n')
    git(conflictRepo, ['add', 'conflict.txt'])
    git(conflictRepo, ['commit', '-m', 'base'])
    git(conflictRepo, ['checkout', '-b', 'feat'])
    await writeFile(join(conflictRepo, 'conflict.txt'), 'line1\nfeat-side\nline3\n')
    git(conflictRepo, ['commit', '-am', 'feat'])
    git(conflictRepo, ['checkout', '-'])
    await writeFile(join(conflictRepo, 'conflict.txt'), 'line1\nmain-side\nline3\n')
    git(conflictRepo, ['commit', '-am', 'main'])
    try {
      git(conflictRepo, ['merge', 'feat'])
    } catch {
      // Expected merge conflict
    }

    const hostConflict = createHost(async () => conflictRepo)
    const conflictSt = workspaceGitStatusResultSchema.parse(await hostConflict.status({ sessionId: 'c1', scope: 'unstaged' }))
    expect(conflictSt.files.find(f => f.path === 'conflict.txt')?.status).toBe('unmerged')
    const conflictDiff = workspaceGitDiffResultSchema.parse(
      await hostConflict.diff({ sessionId: 'c1', path: 'conflict.txt', scope: 'unstaged' }),
    )
    expect(conflictDiff.diff).toContain('diff --cc conflict.txt')
    expect(conflictDiff.diff).toContain('@@@')
    expect(conflictDiff.additions).toBeGreaterThan(0)

    // 2. Bare repository returns isGitRepo: false instead of WORKSPACE_GIT_FAILED
    const bareDir = await createTempDir('dsh-git-bare-')
    git(bareDir, ['init', '--bare'])
    const bareHost = createHost(async () => bareDir)
    const bareSt = workspaceGitStatusResultSchema.parse(await bareHost.status({ sessionId: 'bare' }))
    expect(bareSt.isGitRepo).toBe(false)
    const bareDiff = workspaceGitDiffResultSchema.parse(await bareHost.diff({ sessionId: 'bare' }))
    expect(bareDiff.isGitRepo).toBe(false)

    // 3. Top-level untracked symlink is omitted from status(); root leading-dash file is omitted from both status() and full diff()
    const repo = await initRepo(true)
    const outsideDir = await createTempDir('dsh-git-outside-top-')
    const outsideFile = join(outsideDir, 'secret.txt')
    await writeFile(outsideFile, 'outside-secret\n')
    try {
      await symlink(outsideFile, join(repo, 'top-escape.txt'))
    } catch {
      // Windows without symlink privilege may skip top-level symlink creation
    }
    await writeFile(join(repo, '-root-dash.txt'), 'v1\n')
    git(repo, ['add', '--', '-root-dash.txt'])
    git(repo, ['commit', '-m', 'add leading dash'])
    await writeFile(join(repo, '-root-dash.txt'), 'v2\n')
    await writeFile(join(repo, 'README.md'), 'hello\nok-edit\n')

    const host = createHost(async () => repo)
    const st = workspaceGitStatusResultSchema.parse(await host.status({ sessionId: 'cons' }))
    expect(st.files.map(f => f.path)).toEqual(['README.md'])
    const fullDiff = workspaceGitDiffResultSchema.parse(await host.diff({ sessionId: 'cons' }))
    expect(fullDiff.diff).toContain('README.md')
    expect(fullDiff.diff).not.toContain('-root-dash.txt')
  })

  it('rejects forged .git gitfile escapes, allows verified linked worktrees, and rejects partial-clone promisor configs', async () => {
    // 1. Forged .git gitfile pointing at an unrelated victim repository must be rejected
    const victimRepo = await initRepo(true)
    await writeFile(join(victimRepo, 'secret.txt'), 'TOP-SECRET-VICTIM-CONTENT\n')
    git(victimRepo, ['add', 'secret.txt'])
    git(victimRepo, ['commit', '-m', 'victim secret'])

    const forgedDir = await createTempDir('dsh-git-forged-')
    await writeFile(join(forgedDir, '.git'), `gitdir: ${join(victimRepo, '.git').replaceAll('\\', '/')}\n`)

    const forgedHost = createHost(async () => forgedDir)
    await expect(forgedHost.status({ sessionId: 'forged' })).rejects.toMatchObject({
      code: 'WORKSPACE_GIT_UNSAFE_REPO',
    })
    await expect(forgedHost.diff({ sessionId: 'forged' })).rejects.toMatchObject({
      code: 'WORKSPACE_GIT_UNSAFE_REPO',
    })

    // 2. Genuine linked worktree created via `git worktree add` succeeds, while a second forged dir pointing at that worktree's gitdir fails
    const wtParent = await createTempDir('dsh-git-wt-parent-')
    const linkedWt = join(wtParent, 'linked-wt')
    git(victimRepo, ['worktree', 'add', '-b', 'wt-branch', linkedWt])
    await writeFile(join(linkedWt, 'README.md'), 'hello\nwt-edit\n')

    const wtHost = createHost(async () => linkedWt)
    const wtStatus = workspaceGitStatusResultSchema.parse(await wtHost.status({ sessionId: 'wt' }))
    expect(wtStatus.isGitRepo).toBe(true)
    expect(wtStatus.branch).toBe('wt-branch')
    expect(wtStatus.files.map(entry => entry.path)).toEqual(['README.md'])
    const wtDiff = workspaceGitDiffResultSchema.parse(await wtHost.diff({ sessionId: 'wt', path: 'README.md' }))
    expect(wtDiff.diff).toContain('+wt-edit')

    const stolenWtDir = await createTempDir('dsh-git-forged-wt-')
    await writeFile(
      join(stolenWtDir, '.git'),
      `gitdir: ${join(victimRepo, '.git', 'worktrees', 'linked-wt').replaceAll('\\', '/')}\n`,
    )
    const stolenWtHost = createHost(async () => stolenWtDir)
    await expect(stolenWtHost.status({ sessionId: 'stolen-wt' })).rejects.toMatchObject({
      code: 'WORKSPACE_GIT_UNSAFE_REPO',
    })
    await expect(stolenWtHost.diff({ sessionId: 'stolen-wt' })).rejects.toMatchObject({
      code: 'WORKSPACE_GIT_UNSAFE_REPO',
    })

    // 3. Partial-clone / promisor repositories are rejected fail-closed
    const partialRepo = await initRepo(true)
    git(partialRepo, ['config', 'extensions.partialClone', 'origin'])
    const partialHost = createHost(async () => partialRepo)
    await expect(partialHost.status({ sessionId: 'partial' })).rejects.toMatchObject({
      code: 'WORKSPACE_GIT_UNSAFE_REPO',
    })
    await expect(partialHost.diff({ sessionId: 'partial' })).rejects.toMatchObject({
      code: 'WORKSPACE_GIT_UNSAFE_REPO',
    })

    const promisorRepo = await initRepo(true)
    git(promisorRepo, ['config', 'remote.origin.promisor', 'true'])
    const promisorHost = createHost(async () => promisorRepo)
    await expect(promisorHost.status({ sessionId: 'promisor' })).rejects.toMatchObject({
      code: 'WORKSPACE_GIT_UNSAFE_REPO',
    })
    await expect(promisorHost.diff({ sessionId: 'promisor' })).rejects.toMatchObject({
      code: 'WORKSPACE_GIT_UNSAFE_REPO',
    })
  })

  it('rejects .git filenames in WorkspaceUploadHost to prevent forged gitfile writes', async () => {
    const dir = await createTempDir('dsh-upload-dotgit-')
    const uploadHost = new WorkspaceUploadHost(async () => dir)
    try {
      for (const forbidden of ['.git', '.GIT', '.Git']) {
        await expect(uploadHost.call('workspace.upload.open', {
          sessionId: 'u1',
          uploadId: randomUUID(),
          name: forbidden,
          totalBytes: 32,
        })).rejects.toMatchObject({
          code: 'UPLOAD_INVALID_NAME',
        })
      }
    } finally {
      await uploadHost.closeAll()
    }
  })

  it('enforces a single call-level deadline across sequential git subprocesses', async () => {
    const repo = await initRepo(true)
    let nowMs = 50_000
    const steppingSpawn = ((cmd: string, args: readonly string[], options: Parameters<typeof spawn>[2]) => {
      nowMs += 600
      return spawn(cmd, args, options)
    }) as unknown as typeof spawn

    const host = createHost(async () => repo, {
      timeoutMs: 1_000,
      now: () => nowMs,
      spawnProcess: steppingSpawn,
    })

    await expect(host.status({ sessionId: 'deadline' })).rejects.toMatchObject({
      code: 'RPC_TIMEOUT',
      retryable: true,
    })
  })
})
