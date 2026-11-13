import type { AgentBackend, ConnectionPhase } from '../types'
import { useAppStore } from './store'

export type SessionCatalogCommand =
  | { type: 'refresh-session-status' }
  | { type: 'refresh-catalog'; backend?: AgentBackend }

/**
 * Legacy Hosts and Hosts missing `@deepseek-ai/dsh-api-remotes` keep the 8s
 * `session/list` poll. Hosts advertising `remote.session.events.v1` drive
 * running state, activity, and catalog membership from `$events` + `session/control`.
 */
export function shouldPollSessionStatus(options: {
  enabled: boolean
  phase: ConnectionPhase
  hostSessionEvents: boolean
}): boolean {
  return options.enabled && options.phase === 'connected' && !options.hostSessionEvents
}

export async function dispatchSessionCatalogCommand(command: SessionCatalogCommand): Promise<void> {
  const state = useAppStore.getState()
  switch (command.type) {
    case 'refresh-session-status':
      await state.refreshSessionStatus()
      return
    case 'refresh-catalog':
      await state.refreshWorkspaces(command.backend)
      return
  }
}
