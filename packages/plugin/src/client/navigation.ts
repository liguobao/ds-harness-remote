import type { RemoteWorkspaceSelection, WorkspacesClientServiceLike } from './types.js'

export const pendingWorkspaceSelectionKey = 'dsh-remote:pending-workspace-selection'

export function storedWorkspaceSelection(): RemoteWorkspaceSelection | undefined {
  const raw = window.sessionStorage.getItem(pendingWorkspaceSelectionKey)
  if (raw === null) return undefined
  try {
    const value = JSON.parse(raw) as Partial<RemoteWorkspaceSelection>
    if (typeof value.targetDeviceId !== 'string' || typeof value.workspaceId !== 'string') throw new Error('invalid')
    if (value.backend !== undefined
      && value.backend !== 'harness'
      && value.backend !== 'codex'
      && (typeof value.backend !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value.backend) || value.backend.toLowerCase() === 'acp')) throw new Error('invalid')
    if (value.sessionId !== undefined && typeof value.sessionId !== 'string') throw new Error('invalid')
    return value as RemoteWorkspaceSelection
  } catch {
    window.sessionStorage.removeItem(pendingWorkspaceSelectionKey)
    return undefined
  }
}

export function workspacesReady(snapshot: ReturnType<WorkspacesClientServiceLike['list']['getSnapshot']>): boolean {
  return snapshot.baselinesReady === true || snapshot.phase === 'ready'
}
