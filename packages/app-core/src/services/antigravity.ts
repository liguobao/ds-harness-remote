import type { AgentAcpClient } from '@dsh-remote/client-core'
import type { RemoteSession, WorkspaceView } from '../types'
import { createAntigravitySession, createAntigravityWorkspace } from './cursor'

export interface AntigravityCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

/** Read the Host's AGY catalog without spawning a spare CLI for every directory. */
export async function loadAntigravityCatalog(client: AgentAcpClient, remembered: WorkspaceView[] = [], warmPath?: string): Promise<AntigravityCatalog> {
  const roots = await client.call('dsh/workspaceList', { backend: 'antigravity' })
  if (!Array.isArray(roots)) throw new Error('Invalid AGY workspace catalog.')
  const workspaces = new Map(remembered.filter(item => item.backend === 'antigravity').map(item => [item.path, item]))
  for (const root of roots) {
    if (!record(root) || typeof root.path !== 'string' || !absolutePath(root.path)) continue
    if (!workspaces.has(root.path)) workspaces.set(root.path, createAntigravityWorkspace(root.path, typeof root.title === 'string' ? root.title : undefined))
  }
  const sessions = new Map<string, RemoteSession>()
  for (const [path, workspace] of workspaces) {
    const result = await client.call('dsh/sessionList', { backend: 'antigravity', path, limit: 100, prewarm: path === warmPath })
    if (!record(result) || !Array.isArray(result.items)) throw new Error('Invalid AGY session catalog.')
    const ids: string[] = []
    for (const row of result.items) {
      if (!record(row) || typeof row.conversationId !== 'string' || !row.conversationId) continue
      const session = createAntigravitySession({ acpSessionId: row.conversationId, cwd: path,
        ...(typeof row.title === 'string' && row.title.trim() ? { title: row.title } : {}),
      })
      if (typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)) session.updatedAt = row.updatedAt
      sessions.set(session.sessionId, session)
      ids.push(session.sessionId)
    }
    workspaces.set(path, { ...workspace, sessionIds: [...new Set(ids)] })
  }
  return { workspaces: [...workspaces.values()], sessions: [...sessions.values()] }
}

/** Preserve new empty sessions and active turns until AGY writes its durable summary. */
export function mergeAntigravityCatalog(catalog: AntigravityCatalog, workspaces: WorkspaceView[], sessions: RemoteSession[]): AntigravityCatalog {
  const byId = new Map(sessions.filter(item => item.backend === 'antigravity').map(item => [item.sessionId, item]))
  for (const session of catalog.sessions) {
    const previous = byId.get(session.sessionId)
    byId.set(session.sessionId, { ...previous, ...session, running: previous?.running ?? false })
  }
  const roots = new Map(workspaces.filter(item => item.backend === 'antigravity').map(item => [item.workspaceId, item]))
  for (const workspace of catalog.workspaces) {
    const previous = roots.get(workspace.workspaceId)
    roots.set(workspace.workspaceId, { ...workspace, sessionIds: [...new Set([...workspace.sessionIds, ...(previous?.sessionIds ?? [])])] })
  }
  return { workspaces: [...roots.values()], sessions: [...byId.values()] }
}

/** History can contain several images; always use the bounded ACP transfer response. */
export async function readAntigravityHistory(client: AgentAcpClient, sessionId: string): Promise<unknown[]> {
  const result = await client.transferCall('dsh/sessionHistory', { sessionId, backend: 'antigravity' })
  if (!record(result) || !Array.isArray(result.events)) throw new Error('Invalid AGY history response.')
  return result.events
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function absolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path)
}
