import {
  workspaceGitDiffResultSchema,
  workspaceGitStatusResultSchema,
  type WorkspaceGitDiffResult,
  type WorkspaceGitScope,
  type WorkspaceGitStatusResult,
} from '@dsh-remote/protocol'
import { requireConnectionRpc } from '../state/store'

export async function fetchWorkspaceGitStatus(
  sessionId: string,
  scope: WorkspaceGitScope,
  signal?: AbortSignal,
): Promise<WorkspaceGitStatusResult> {
  const rpc = requireConnectionRpc()
  const raw = await rpc('workspace.git.status', { sessionId, scope }, signal)
  const parsed = workspaceGitStatusResultSchema.safeParse(raw)
  if (!parsed.success) {
    throw Object.assign(new Error('Invalid workspace git status response.'), { code: 'INVALID_MESSAGE' })
  }
  return parsed.data
}

export async function fetchWorkspaceGitDiff(
  params: {
    sessionId: string
    path?: string
    scope: WorkspaceGitScope
    contextLines?: number
  },
  signal?: AbortSignal,
): Promise<WorkspaceGitDiffResult> {
  const rpc = requireConnectionRpc()
  const payload = {
    sessionId: params.sessionId,
    scope: params.scope,
    ...(params.path === undefined ? {} : { path: params.path }),
    ...(params.contextLines === undefined ? {} : { contextLines: params.contextLines }),
  }
  const raw = await rpc('workspace.git.diff', payload, signal)
  const parsed = workspaceGitDiffResultSchema.safeParse(raw)
  if (!parsed.success) {
    throw Object.assign(new Error('Invalid workspace git diff response.'), { code: 'INVALID_MESSAGE' })
  }
  return parsed.data
}
