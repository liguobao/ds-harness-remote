import { loadAcpModels, selectAcpModel } from './acp-models'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import type { ModelSelection, RemoteSession, SessionModels, WorkspaceView } from '../types'
import { createPiSession, createPiWorkspace } from './cursor'

export interface PiCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

/** Read the Host's Pi catalog without spawning a spare CLI for every directory. */
export async function loadPiCatalog(client: AgentAcpClient, remembered: WorkspaceView[] = [], warmPath?: string): Promise<PiCatalog> {
  const roots = await client.call('dsh/workspaceList', { backend: 'pi' })
  if (!Array.isArray(roots)) throw new Error('Invalid Pi workspace catalog.')
  const workspaces = new Map(remembered.filter(item => item.backend === 'pi').map(item => [item.path, item]))
  for (const root of roots) {
    if (!record(root) || typeof root.path !== 'string' || !absolutePath(root.path)) continue
    if (!workspaces.has(root.path)) workspaces.set(root.path, createPiWorkspace(root.path, typeof root.title === 'string' ? root.title : undefined))
  }
  const sessions = new Map<string, RemoteSession>()
  for (const [path, workspace] of workspaces) {
    const result = await client.call('dsh/sessionList', { backend: 'pi', path, limit: 100, prewarm: path === warmPath })
    if (!record(result) || !Array.isArray(result.items)) throw new Error('Invalid Pi session catalog.')
    const ids: string[] = []
    for (const row of result.items) {
      if (!record(row) || typeof row.conversationId !== 'string' || !row.conversationId) continue
      const session = createPiSession({ acpSessionId: row.conversationId, cwd: path,
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

/** Preserve new empty sessions and active turns until Pi writes its durable summary. */
export function mergePiCatalog(catalog: PiCatalog, workspaces: WorkspaceView[], sessions: RemoteSession[]): PiCatalog {
  const byId = new Map(sessions.filter(item => item.backend === 'pi').map(item => [item.sessionId, item]))
  for (const session of catalog.sessions) {
    const previous = byId.get(session.sessionId)
    byId.set(session.sessionId, { ...previous, ...session, running: previous?.running ?? false })
  }
  const roots = new Map(workspaces.filter(item => item.backend === 'pi').map(item => [item.workspaceId, item]))
  for (const workspace of catalog.workspaces) {
    const previous = roots.get(workspace.workspaceId)
    roots.set(workspace.workspaceId, { ...workspace, sessionIds: [...new Set([...workspace.sessionIds, ...(previous?.sessionIds ?? [])])] })
  }
  return { workspaces: [...roots.values()], sessions: [...byId.values()] }
}

/** History can contain several images; always use the bounded ACP transfer response. */
export async function readPiHistory(client: AgentAcpClient, sessionId: string): Promise<unknown[]> {
  const result = await client.transferCall('dsh/sessionHistory', { sessionId, backend: 'pi' })
  if (!record(result) || !Array.isArray(result.events)) throw new Error('Invalid Pi history response.')
  return result.events
}

export function loadPiModels(client: AgentAcpClient, sessionId: string): Promise<SessionModels> {
  return loadAcpModels(client, sessionId, 'pi')
}

export function selectPiModel(client: AgentAcpClient, sessionId: string, selection: ModelSelection): Promise<SessionModels> {
  return selectAcpModel(client, sessionId, 'pi', selection)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function absolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path)
}
