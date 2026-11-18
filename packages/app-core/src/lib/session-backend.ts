import type { AgentBackend } from '../types'

/** Session ids carry their backend prefix; an unprefixed id is a Harness session. */
const PREFIXES: ReadonlyArray<[string, AgentBackend]> = [
  ['codex:', 'codex'],
  ['cursor:', 'cursor'],
  ['antigravity:', 'antigravity'],
  ['pi:', 'pi'],
  ['opencode:', 'opencode'],
  ['claude:', 'claude'],
  ['hermes:', 'hermes'],
]

const REGISTERED_ACP_BACKENDS = new Set<string>()

export function registerAcpBackendId(backend: string): void {
  if (backend && backend !== 'harness' && backend !== 'codex') {
    REGISTERED_ACP_BACKENDS.add(backend)
  }
}

export function sessionBackendFromId(id: string): AgentBackend {
  for (const [prefix, backend] of PREFIXES) {
    if (id.startsWith(prefix)) return backend
  }
  const colon = id.indexOf(':')
  if (colon > 0) {
    const candidate = id.slice(0, colon)
    if (REGISTERED_ACP_BACKENDS.has(candidate)) return candidate
  }
  return 'harness'
}
