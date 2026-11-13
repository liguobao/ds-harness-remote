import { compareVersions } from '../lib/version-compare'
import type { AgentBackend } from '../types'
import { useAppStore } from './store'

/**
 * Host plugin `clientVersion` floor for change-driven session catalog sync.
 * Older Hosts keep the legacy 8s `session/list` poll.
 */
export const SESSION_CATALOG_COMMANDS_MIN_HOST_VERSION = '0.6.5'

/**
 * Session-catalog pull commands (Host ≥ {@link SESSION_CATALOG_COMMANDS_MIN_HOST_VERSION}).
 *
 * Full `session/list` is never on a timer for new Hosts. Pull when:
 * - UI needs an initial/manual catalog (`refresh-catalog`)
 * - Host signals real membership change via `session/catalog-changed`
 */
export type SessionCatalogCommand =
  | { type: 'refresh-session-status' }
  | { type: 'refresh-catalog'; backend?: AgentBackend }

/** True when the connected Host plugin is new enough for command-driven catalog sync. */
export function supportsSessionCatalogCommands(hostClientVersion?: string): boolean {
  if (hostClientVersion === undefined || hostClientVersion.trim() === '') return false
  // compareVersions treats unparseable values as equal — do not enable the new path then.
  if (!/^\d+\.\d+\.\d+/.test(hostClientVersion.trim().replace(/^v/, ''))) return false
  return compareVersions(hostClientVersion, SESSION_CATALOG_COMMANDS_MIN_HOST_VERSION) >= 0
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

const CATALOG_CHANGE_DEBOUNCE_MS = 300

let catalogChangeTimer: ReturnType<typeof setTimeout> | undefined
let catalogChangeInFlight = false
let catalogChangeQueued = false

/** Coalesce Host catalog-change hints into one `session/list` pull (new Hosts only). */
export function requestSessionListOnCatalogChange(): void {
  const state = useAppStore.getState()
  if (state.connection.phase !== 'connected') return
  if (!supportsSessionCatalogCommands(state.selectedDevice?.clientVersion)) return
  catalogChangeQueued = true
  if (catalogChangeTimer !== undefined) clearTimeout(catalogChangeTimer)
  catalogChangeTimer = setTimeout(() => {
    catalogChangeTimer = undefined
    void flushCatalogChangePull()
  }, CATALOG_CHANGE_DEBOUNCE_MS)
}

async function flushCatalogChangePull(): Promise<void> {
  if (catalogChangeInFlight) return
  if (!catalogChangeQueued) return
  catalogChangeQueued = false
  catalogChangeInFlight = true
  try {
    await dispatchSessionCatalogCommand({ type: 'refresh-session-status' })
  } finally {
    catalogChangeInFlight = false
    if (catalogChangeQueued) void flushCatalogChangePull()
  }
}
