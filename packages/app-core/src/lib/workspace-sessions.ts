import type { RemoteSession, WorkspaceView } from '../types'

/** Harness retains archived IDs in its workspace catalog for later restoration. */
export function getVisibleWorkspaceSessions(
  workspace: WorkspaceView,
  sessions: readonly RemoteSession[],
  archivedSessionIds: readonly string[],
): RemoteSession[] {
  const archived = new Set(archivedSessionIds)
  const byId = new Map(sessions.map(session => [session.sessionId, session]))
  return workspace.sessionIds.flatMap(id => {
    const session = byId.get(id)
    return session === undefined || archived.has(id) ? [] : [session]
  })
}
