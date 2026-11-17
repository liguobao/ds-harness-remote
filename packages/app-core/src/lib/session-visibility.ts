import type { RemoteSession } from '../types'

/** Match Desktop sessionVisible / visibleSessionIds: only the current blank
 * placeholder is listed, and blank placeholders never match a search query. */
export function isVisibleSession(
  session: RemoteSession,
  currentSessionId: string | undefined,
  searchQuery = '',
): boolean {
  if (session.origin === 'subagent') return false
  if (session.blank && (session.sessionId !== currentSessionId || searchQuery.trim().length > 0)) return false
  return true
}
