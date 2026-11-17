import { isSubagentSession } from '../../lib/session-kind'
import { strings as zhCN } from '../../locales/i18n'
import type { RemoteSession } from '../../types'
import { resolveSessionDisplayTitle } from '../session-title'

export function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 60_000) return zhCN.time.justNow
  if (delta < 3_600_000) return zhCN.time.minutesAgo(Math.floor(delta / 60_000))
  if (delta < 86_400_000) return zhCN.time.hoursAgo(Math.floor(delta / 3_600_000))
  return new Date(timestamp).toLocaleDateString(zhCN.time.locale)
}

export function sessionTitle(session: RemoteSession): string {
  const title = resolveSessionDisplayTitle(session)
  if (title !== undefined) return title
  return isSubagentSession(session) ? zhCN.sessions.child : zhCN.sessions.untitled
}
