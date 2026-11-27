import { strings as zhCN } from '../locales/i18n'
import type { RemoteSession } from '../types'
import type { SessionAccess } from './session-runtime'

/** Check whether the active Host connection advertises support for an ACP backend. */
export function hasAcpBackendFor(connection: SessionAccess['runtime']['connection'], backend: string): boolean {
  if (backend === 'claude') return connection.hasClaude()
  if (backend === 'hermes') return connection.hasHermes()
  if (backend === 'kimi') return connection.hasKimi()
  if (backend === 'opencode') return connection.hasOpencode()
  if (backend === 'pi') return connection.hasPi()
  if (backend === 'antigravity') return connection.hasAntigravity()
  if (backend === 'cursor') return connection.hasCursor()
  return connection.hasAcpBackend(backend)
}

/** Resolve the authenticated Host ACP client instance for a managed ACP backend. */
export function acpClientForBackend(connection: SessionAccess['runtime']['connection'], backend: string) {
  if (backend === 'claude') return connection.requireClaude()
  if (backend === 'hermes') return connection.requireHermes()
  if (backend === 'kimi') return connection.requireKimi()
  if (backend === 'opencode') return connection.requireOpencode()
  if (backend === 'pi') return connection.requirePi()
  if (backend === 'antigravity') return connection.requireAntigravity()
  if (backend === 'cursor') return connection.requireCursor()
  return connection.requireAcpBackend(backend)
}

/** Localized fallback error text when an ACP backend stream or prompt fails without details. */
export function acpUnavailableMessage(backend?: RemoteSession['backend']): string {
  switch (backend) {
    case 'claude': return zhCN.runtime.claudeUnavailable
    case 'hermes': return zhCN.runtime.hermesUnavailable
    case 'kimi': return zhCN.runtime.kimiUnavailable
    case 'opencode': return zhCN.runtime.opencodeUnavailable
    case 'pi': return zhCN.runtime.piUnavailable
    case 'antigravity': return zhCN.runtime.antigravityUnavailable
    default: return zhCN.runtime.cursorUnavailable
  }
}
