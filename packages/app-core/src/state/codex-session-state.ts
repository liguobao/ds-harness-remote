import { codexPermissionPreset, withCodexPermission } from '../services/codex'
import { loadCodexPermissionPresets } from '../services/storage'
import type { CodexPermissionPreset, RemoteSession } from '../types'
import type { AppState } from './store-state'

export async function loadSavedCodexPermissions(hostDeviceId: string | undefined): Promise<Record<string, CodexPermissionPreset>> {
  if (hostDeviceId === undefined) return {}
  try {
    return await loadCodexPermissionPresets(hostDeviceId)
  } catch {
    return {}
  }
}

export function withBestCodexPermission(
  session: RemoteSession,
  previous: RemoteSession | undefined,
  saved: Record<string, CodexPermissionPreset>,
): RemoteSession {
  if (session.backend !== 'codex') return session
  const savedPreset = session.nativeId === undefined ? undefined : saved[session.nativeId]
  const previousPreset = previous?.backend === 'codex' ? codexPermissionPreset(previous) : undefined
  const preset = savedPreset ?? previousPreset
  return preset === undefined ? session : withCodexPermission(session, preset)
}

export function withCodexPermissionState(
  state: AppState,
  sessionId: string,
  preset: CodexPermissionPreset,
): Pick<AppState, 'sessions' | 'selectedSession'> {
  const update = (session: RemoteSession): RemoteSession => (
    session.sessionId === sessionId ? withCodexPermission(session, preset) : session
  )
  return {
    sessions: state.sessions.map(update),
    selectedSession: state.selectedSession === undefined ? undefined : update(state.selectedSession),
  }
}
