import type { RemoteSession } from '../types'

/** Forks also carry parentSessionId; only the explicit origin selects subagent routing. */
export function isSubagentSession(session: RemoteSession): session is RemoteSession & { origin: 'subagent'; parentSessionId: string } {
  return session.origin === 'subagent' && session.parentSessionId !== undefined
}
