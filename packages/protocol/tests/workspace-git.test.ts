import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_GIT_CAPABILITY,
  WORKSPACE_GIT_MAX_CONTEXT_LINES,
  WORKSPACE_GIT_MAX_FILES,
  WORKSPACE_GIT_MAX_PATH_LENGTH,
  WORKSPACE_GIT_METHODS,
  isSafeWorkspaceGitRelativePath,
  rpcMethods,
  workspaceGitDiffParamsSchema,
  workspaceGitDiffResultSchema,
  workspaceGitStatusParamsSchema,
  workspaceGitStatusResultSchema,
} from '../src/index.js'

describe('workspace git protocol contract', () => {
  it('registers workspace git methods in rpcMethods and exports capability constant', () => {
    expect(WORKSPACE_GIT_CAPABILITY).toBe('workspace.git.read.v1')
    for (const method of WORKSPACE_GIT_METHODS) {
      expect(rpcMethods).toContain(method)
    }
  })

  it('validates status and diff request schemas strictly', () => {
    expect(workspaceGitStatusParamsSchema.parse({ sessionId: 'sess-1' })).toEqual({ sessionId: 'sess-1' })
    expect(workspaceGitStatusParamsSchema.parse({ sessionId: 'sess-1', scope: 'staged' })).toEqual({
      sessionId: 'sess-1',
      scope: 'staged',
    })
    expect(() => workspaceGitStatusParamsSchema.parse({ sessionId: 'sess-1', cwd: '/tmp' })).toThrow()
    expect(() => workspaceGitStatusParamsSchema.parse({ sessionId: '', scope: 'all' })).toThrow()
    expect(() => workspaceGitStatusParamsSchema.parse({ sessionId: 'sess-1', scope: 'invalid' })).toThrow()

    expect(workspaceGitDiffParamsSchema.parse({
      sessionId: 'sess-1',
      path: 'src/index.ts',
      scope: 'unstaged',
      contextLines: 5,
    })).toEqual({
      sessionId: 'sess-1',
      path: 'src/index.ts',
      scope: 'unstaged',
      contextLines: 5,
    })
    expect(() => workspaceGitDiffParamsSchema.parse({
      sessionId: 'sess-1',
      contextLines: WORKSPACE_GIT_MAX_CONTEXT_LINES + 1,
    })).toThrow()
    expect(() => workspaceGitDiffParamsSchema.parse({
      sessionId: 'sess-1',
      extra: true,
    })).toThrow()
  })

  it('validates status and diff result schemas and enforces max file count', () => {
    const validStatus = {
      isGitRepo: true,
      branch: 'main',
      headShortSha: 'abc1234',
      hasHead: true,
      scope: 'all' as const,
      files: [{
        path: 'src/app.ts',
        status: 'modified' as const,
        staged: false,
        unstaged: true,
        additions: 10,
        deletions: 2,
        isBinary: false,
      }],
      totalFiles: 1,
      truncated: false,
      totalAdditions: 10,
      totalDeletions: 2,
    }
    expect(workspaceGitStatusResultSchema.parse(validStatus)).toEqual(validStatus)

    const oversized = Array.from({ length: WORKSPACE_GIT_MAX_FILES + 1 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      status: 'modified' as const,
      staged: false,
      unstaged: true,
      additions: 1,
      deletions: 0,
      isBinary: false,
    }))
    expect(() => workspaceGitStatusResultSchema.parse({ ...validStatus, files: oversized })).toThrow()

    const validDiff = {
      isGitRepo: true,
      path: 'src/app.ts',
      scope: 'all' as const,
      diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n',
      bytes: 54,
      lines: 5,
      additions: 1,
      deletions: 1,
      isBinary: false,
      truncated: false,
    }
    expect(workspaceGitDiffResultSchema.parse(validDiff)).toEqual(validDiff)
  })

  it('rejects unsafe workspace-relative git paths and accepts clean POSIX paths', () => {
    const allowed = [
      'README.md',
      'src/app/index.ts',
      'packages/app-core/src/screens/workspace-changes-panel.tsx',
      'docs/中文 文件.md',
      '.github/workflows/ci.yml',
      'dir/file-with-dash.ts',
    ]
    for (const candidate of allowed) {
      expect(isSafeWorkspaceGitRelativePath(candidate), candidate).toBe(true)
    }

    const rejected = [
      '',
      '/',
      '/etc/passwd',
      '../secret.ts',
      'src/../secret.ts',
      './src/a.ts',
      'src/./a.ts',
      'src//a.ts',
      'src/',
      '-p',
      '--output=/tmp/x',
      'src\\a.ts',
      'C:/Windows/win.ini',
      'file.txt:ads',
      'src/a.ts\0b',
      'src/a.ts\nb',
      'src/a.ts\rb',
      'a'.repeat(WORKSPACE_GIT_MAX_PATH_LENGTH + 1),
    ]
    for (const candidate of rejected) {
      expect(isSafeWorkspaceGitRelativePath(candidate), JSON.stringify(candidate)).toBe(false)
    }
  })
})
