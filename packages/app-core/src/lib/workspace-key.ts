import type { AgentBackend } from '../types'

/** Normalize a host directory path for stable cross-platform comparison. */
export function normalizeWorkspacePath(path: string, platform?: string): string {
  const normalized = path.replace(/\\/gu, '/').replace(/\/+$/u, '') || '/'
  return platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

/**
 * Stable per-host workspace identity. Harness workspace ids never change; CodeX
 * project ids can when its catalog falls back to a thread cwd, so the authority
 * path is the durable identity there.
 */
export function workspaceStableKey(
  workspace: { workspaceId: string; backend?: AgentBackend; path: string },
  platform?: string,
): string {
  if (workspace.backend !== 'codex') return workspace.workspaceId
  return `codex:path:${normalizeWorkspacePath(workspace.path, platform)}`
}
