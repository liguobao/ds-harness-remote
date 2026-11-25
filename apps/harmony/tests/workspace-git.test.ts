import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { beforeAll, expect, it, vi } from 'vitest'
import { WORKSPACE_GIT_CAPABILITY, workspaceGitStatusParamsSchema, workspaceGitDiffParamsSchema } from '../../../packages/protocol/src/workspace-git'

let HarnessAlphaClient: new (core: { rpc: (method: string, params: unknown) => Promise<unknown> },
  format: number, onFrame: () => void, capabilities: string[]) => {
  supportsWorkspaceGit: boolean
  workspaceGitStatus(sessionId: string, scope?: string): Promise<unknown>
  workspaceGitDiff(sessionId: string, path: string, scope?: string): Promise<unknown>
}

beforeAll(async () => {
  const entry = new URL('../entry/src/main/ets/net/HarnessClient.ets', import.meta.url)
  const result = await build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    format: 'esm',
    loader: { '.ets': 'ts' },
    resolveExtensions: ['.ets', '.ts', '.js'],
    plugins: [{
      name: 'unused-native-kits',
      setup(builder) {
        builder.onResolve({ filter: /^@kit\./ }, () => ({ path: 'kit', namespace: 'shim' }))
        builder.onLoad({ filter: /^kit$/, namespace: 'shim' }, () => ({
          contents: 'export const hilog = {}, util = {}, cryptoFramework = {}',
        }))
      },
    }],
  })
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  HarnessAlphaClient = module.HarnessAlphaClient
})

it('sends status and diff as top-level RPCs with the shared protocol parameters', async () => {
  const sessionId = 'session-1'
  const path = 'src/index.ts'
  const rpc = vi.fn(async (method: string, params: unknown) => {
    if (method === 'workspace.git.status') {
      expect(workspaceGitStatusParamsSchema.parse(params)).toEqual({ sessionId, scope: 'staged' })
      return { isGitRepo: true, files: [{ path, status: 'modified', staged: true }] }
    }
    expect(method).toBe('workspace.git.diff')
    expect(workspaceGitDiffParamsSchema.parse(params)).toEqual({ sessionId, path, scope: 'staged', contextLines: 3 })
    return { diff: '+hello', additions: 1, deletions: 0 }
  })
  const client = new HarnessAlphaClient({ rpc }, 3, () => {}, [WORKSPACE_GIT_CAPABILITY])
  expect(client.supportsWorkspaceGit).toBe(true)
  await expect(client.workspaceGitStatus(sessionId, 'staged')).resolves.toMatchObject({ isGitRepo: true, files: [{ path, staged: true }] })
  await expect(client.workspaceGitDiff(sessionId, path, 'staged')).resolves.toMatchObject({ diff: '+hello', additions: 1 })
  expect(rpc).toHaveBeenCalledTimes(2)
})

it('refuses both calls locally when the authenticated Host omits the capability', async () => {
  const rpc = vi.fn()
  const client = new HarnessAlphaClient({ rpc }, 3, () => {}, ['harness.remote.v3'])
  expect(client.supportsWorkspaceGit).toBe(false)
  await expect(client.workspaceGitStatus('session-1')).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' })
  await expect(client.workspaceGitDiff('session-1', 'file')).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' })
  expect(rpc).not.toHaveBeenCalled()
})
