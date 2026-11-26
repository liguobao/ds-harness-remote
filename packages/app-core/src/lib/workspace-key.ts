import type { AgentBackend, RemoteSession, WorkspaceView } from '../types'

export type AcpManagedBackend = Exclude<AgentBackend, 'harness' | 'codex'>

export interface AcpCatalogFilterOptions {
  deletedKeys?: ReadonlySet<string>
  platform?: string
}

export function isAcpManagedBackend(backend?: AgentBackend): backend is AcpManagedBackend {
  return backend !== undefined && backend !== 'harness' && backend !== 'codex'
}

/** Harness and ACP workspaces support manage actions; CodeX projects are host-derived and read-only. */
export function canManageWorkspace(target?: { backend?: AgentBackend }): boolean {
  return target !== undefined && target.backend !== 'codex'
}

function isWindowsWorkspacePath(path: string): boolean {
  return /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\)/.test(path.trim())
}

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

/** Scope-local key used to suppress deleted ACP workspaces across refreshes and restarts. */
export function acpWorkspaceSuppressionKey(backend: AgentBackend, path: string, platform?: string): string {
  const effectivePlatform = platform ?? (isWindowsWorkspacePath(path) ? 'win32' : undefined)
  return `${backend}:path:${normalizeWorkspacePath(path, effectivePlatform)}`
}

export function isDeletedAcpWorkspace(
  deletedKeys: ReadonlySet<string> | undefined,
  backend: AgentBackend,
  path: string,
  platform?: string,
): boolean {
  if (!deletedKeys || deletedKeys.size === 0) return false
  const key = acpWorkspaceSuppressionKey(backend, path, platform)
  if (deletedKeys.has(key)) return true
  const effectivePlatform = platform ?? (isWindowsWorkspacePath(path) ? 'win32' : undefined)
  if (effectivePlatform === 'win32') {
    for (const existing of deletedKeys) {
      if (existing.toLocaleLowerCase() === key) return true
    }
  }
  return false
}

export function isMissingHostDirectoryError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'CURSOR_PATH_NOT_ALLOWED'
}

export function isAbsoluteHostPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path)
}

export function normalizeAcpWorkspacePath(path: string, platform?: string): string {
  return normalizeWorkspacePath(path, platform ?? (isWindowsWorkspacePath(path) ? 'win32' : undefined))
}

/** Collect deduplicated remembered + discovered ACP workspaces while honoring delete tombstones. */
export function collectAcpWorkspaceMap(
  backend: AcpManagedBackend,
  remembered: WorkspaceView[],
  roots: unknown[],
  createWorkspace: (path: string, title?: string) => WorkspaceView,
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Map<string, WorkspaceView> {
  const effectivePlatform = options?.platform
  const warmKey = warmPath === undefined ? undefined : normalizeAcpWorkspacePath(warmPath, effectivePlatform)
  const workspaces = new Map<string, WorkspaceView>()
  for (const item of remembered) {
    if (item.backend !== backend) continue
    if (isDeletedAcpWorkspace(options?.deletedKeys, backend, item.path, effectivePlatform)) continue
    const key = normalizeAcpWorkspacePath(item.path, effectivePlatform)
    if (!workspaces.has(key)) workspaces.set(key, item)
  }
  for (const root of roots) {
    if (typeof root !== 'object' || root === null || Array.isArray(root)) continue
    const entry = root as Record<string, unknown>
    if (typeof entry.path !== 'string' || !isAbsoluteHostPath(entry.path)) continue
    const key = normalizeAcpWorkspacePath(entry.path, effectivePlatform)
    if (key !== warmKey && isDeletedAcpWorkspace(options?.deletedKeys, backend, entry.path, effectivePlatform)) continue
    if (!workspaces.has(key)) {
      workspaces.set(key, createWorkspace(entry.path, typeof entry.title === 'string' ? entry.title : undefined))
    }
  }
  return workspaces
}

export function filterVisibleAcpCatalog<W extends WorkspaceView, S extends RemoteSession>(
  backend: AgentBackend,
  workspaces: W[],
  sessions: S[],
  deletedKeys?: ReadonlySet<string>,
  platform?: string,
): { workspaces: W[]; sessions: S[] } {
  if (!deletedKeys || deletedKeys.size === 0) return { workspaces, sessions }
  const keptWorkspaces = workspaces.filter(item => !isDeletedAcpWorkspace(deletedKeys, backend, item.path, platform))
  const keptSessionIds = new Set(keptWorkspaces.flatMap(item => item.sessionIds))
  const keptSessions = sessions.filter(session => {
    if (keptSessionIds.has(session.sessionId)) return true
    if (session.cwd !== undefined && isDeletedAcpWorkspace(deletedKeys, backend, session.cwd, platform)) return false
    return true
  })
  return { workspaces: keptWorkspaces, sessions: keptSessions }
}

interface AcpCatalogRpcClient {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Shared ACP workspace+session catalog loader with delete-tombstone suppression and stale-dir resilience. */
export async function loadAcpDirectoryCatalog(spec: {
  backend: AcpManagedBackend
  label: string
  client: AcpCatalogRpcClient
  remembered?: WorkspaceView[]
  warmPath?: string
  options?: AcpCatalogFilterOptions
  createWorkspace: (path: string, title?: string) => WorkspaceView
  createSession: (input: { acpSessionId: string; cwd?: string; title?: string }) => RemoteSession
}): Promise<{ workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] }> {
  const roots = await spec.client.call('dsh/workspaceList', { backend: spec.backend })
  if (!Array.isArray(roots)) throw new Error(`Invalid ${spec.label} workspace catalog.`)
  const workspaces = collectAcpWorkspaceMap(
    spec.backend,
    spec.remembered ?? [],
    roots,
    spec.createWorkspace,
    spec.warmPath,
    spec.options,
  )
  const warmKey = spec.warmPath === undefined ? undefined : normalizeAcpWorkspacePath(spec.warmPath, spec.options?.platform)
  const sessions = new Map<string, RemoteSession>()
  let hasPinnedField = false
  const pinnedSessionIds = new Set<string>()
  const entries = [...workspaces]
  const results: Array<{ value?: unknown; missing?: true }> = new Array(entries.length)
  let next = 0
  let failed = false
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (!failed) {
      const index = next++
      if (index >= entries.length) return
      const [key, workspace] = entries[index]!
      const isWarm = workspace.path === spec.warmPath || key === warmKey
      try {
        results[index] = { value: await spec.client.call('dsh/sessionList', {
          backend: spec.backend,
          path: workspace.path,
          limit: 100,
          prewarm: isWarm,
        }) }
      } catch (error) {
        // Keep stale remembered directories selectable for deletion.
        if (!isWarm && isMissingHostDirectoryError(error)) {
          results[index] = { missing: true }
          continue
        }
        failed = true
        throw error
      }
    }
  }))
  for (const [index, [key, workspace]] of entries.entries()) {
    if (results[index]?.missing) {
      workspaces.set(key, { ...workspace, sessionIds: [] })
      continue
    }
    const result = results[index]?.value
    if (!isObjectRecord(result) || !Array.isArray(result.items)) {
      throw new Error(`Invalid ${spec.label} session catalog.`)
    }
    if (Array.isArray(result.pinnedSessionIds)) {
      hasPinnedField = true
      for (const rawId of result.pinnedSessionIds) {
        if (typeof rawId !== 'string' || !rawId) continue
        pinnedSessionIds.add(rawId.includes(':') ? rawId : spec.createSession({ acpSessionId: rawId }).sessionId)
      }
    }
    const ids: string[] = []
    for (const row of result.items) {
      if (!isObjectRecord(row) || typeof row.conversationId !== 'string' || !row.conversationId) continue
      const session = spec.createSession({
        acpSessionId: row.conversationId,
        cwd: workspace.path,
        ...(typeof row.title === 'string' && row.title.trim() ? { title: row.title } : {}),
      })
      if (typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)) session.updatedAt = row.updatedAt
      sessions.set(session.sessionId, session)
      ids.push(session.sessionId)
    }
    workspaces.set(key, { ...workspace, sessionIds: [...new Set(ids)] })
  }
  return {
    workspaces: [...workspaces.values()],
    sessions: [...sessions.values()],
    ...(hasPinnedField ? { pinnedSessionIds: [...pinnedSessionIds] } : {}),
  }
}

/** Shared ACP catalog merge preserving active turns/blank sessions while enforcing deleted workspace suppression. */
export function mergeAcpDirectoryCatalog(spec: {
  backend: Exclude<AcpManagedBackend, 'cursor'>
  catalog: { workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] }
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
  options?: AcpCatalogFilterOptions
  keepExistingSession?: (session: RemoteSession, catalogIds: ReadonlySet<string>) => boolean
}): { workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] } {
  const catalogIds = new Set(spec.catalog.sessions.map(item => item.sessionId))
  const byId = new Map(
    spec.sessions
      .filter(item => item.backend === spec.backend && (spec.keepExistingSession ? spec.keepExistingSession(item, catalogIds) : true))
      .map(item => [item.sessionId, item]),
  )
  for (const session of spec.catalog.sessions) {
    const previous = byId.get(session.sessionId)
    byId.set(session.sessionId, { ...previous, ...session, running: previous?.running ?? false })
  }
  const roots = new Map(spec.workspaces.filter(item => item.backend === spec.backend).map(item => [item.workspaceId, item]))
  for (const workspace of spec.catalog.workspaces) {
    const previous = roots.get(workspace.workspaceId)
    const previousIds = (previous?.sessionIds ?? []).filter(id => (spec.keepExistingSession ? byId.has(id) : true))
    roots.set(workspace.workspaceId, { ...workspace, sessionIds: [...new Set([...workspace.sessionIds, ...previousIds])] })
  }
  return {
    ...filterVisibleAcpCatalog(
      spec.backend,
      [...roots.values()],
      [...byId.values()],
      spec.options?.deletedKeys,
      spec.options?.platform,
    ),
    ...(spec.catalog.pinnedSessionIds !== undefined ? { pinnedSessionIds: spec.catalog.pinnedSessionIds } : {}),
  }
}
