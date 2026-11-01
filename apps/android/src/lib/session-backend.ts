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

export function sessionBackendFromId(id: string): AgentBackend {
  for (const [prefix, backend] of PREFIXES) {
    if (id.startsWith(prefix)) return backend
  }
  return 'harness'
}
