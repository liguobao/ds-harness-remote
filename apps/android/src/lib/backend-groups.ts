import { strings } from '../locales/i18n'
import type { AgentBackend, RemoteSession, WorkspaceView } from '../types'
import { getVisibleWorkspaceSessions } from './workspace-sessions'

export function sessionBackend(session: RemoteSession): AgentBackend { return session.backend ?? 'harness' }

export function browseStatus(session: RemoteSession, lifecycle?: { running: boolean }): 'running' | 'idle' | 'unknown' {
  if (session.backend === 'codex') {
    if (session.projections?.values?.remoteStatusKnown === false) return 'unknown'
    return session.running ? 'running' : 'idle'
  }
  return (lifecycle?.running ?? session.running) ? 'running' : 'idle'
}

export function backendGroups(input: {
  backend: AgentBackend; workspaces: WorkspaceView[]; sessions: RemoteSession[];
  archived: string[]; recent: string[]; selected?: RemoteSession;
  lifecycles: Record<string, { running: boolean }>;
}) {
  const archived = new Set(input.archived)
  const known = input.selected !== undefined && !input.sessions.some(s => s.sessionId === input.selected!.sessionId)
    ? [input.selected, ...input.sessions] : input.sessions
  const sessions = known.filter(s => sessionBackend(s) === input.backend && !archived.has(s.sessionId))
  const order = (a: RemoteSession, b: RemoteSession) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId)
  const workspaces = input.workspaces.filter(w => (w.backend ?? 'harness') === input.backend)
  const groups = workspaces.map(w => ({
    key: `workspace:${input.backend}:${w.workspaceId}`, title: w.title, backend: input.backend,
    sessions: getVisibleWorkspaceSessions(w, sessions, input.archived).sort(order),
  })).filter(g => g.sessions.length > 0)
  const assigned = new Set(workspaces.flatMap(w => w.sessionIds))
  const unassigned = sessions.filter(s => !assigned.has(s.sessionId)).sort(order)
  if (unassigned.length) groups.push({key: `unassigned:${input.backend}`, title: strings.comfort.other, backend: input.backend, sessions: unassigned})
  const active = sessions.filter(s => browseStatus(s, input.lifecycles[s.sessionId]) === 'running').sort(order)
  const recentOrder = new Map(input.recent.map((id, index) => [id, index]))
  const recent = sessions.filter(s => recentOrder.has(s.sessionId) && browseStatus(s, input.lifecycles[s.sessionId]) !== 'running')
    .sort((a, b) => recentOrder.get(b.sessionId)! - recentOrder.get(a.sessionId)!).slice(0, 5)
  return [
    {key: `active:${input.backend}`, title: strings.comfort.running, backend: input.backend, sessions: active},
    ...(recent.length ? [{key: `recent:${input.backend}`, title: strings.comfort.recent, backend: input.backend, sessions: recent}] : []),
    ...groups,
  ]
}
