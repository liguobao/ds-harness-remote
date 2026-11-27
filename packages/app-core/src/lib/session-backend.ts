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

export function mergeBackendPinnedSessionIds(
  current: readonly string[] | undefined,
  backend: AgentBackend,
  nextForBackend: readonly string[],
): string[] {
  registerAcpBackendId(backend)
  const normalized = nextForBackend
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map(id => backend === 'harness' || id.startsWith(`${backend}:`) ? id : `${backend}:${id}`)
  const preserved = (current ?? []).filter(id => sessionBackendFromId(id) !== backend)
  return [...new Set([...preserved, ...normalized])]
}

// Shared by session actions and workspace refreshes on the same connection.
// A successful mutation invalidates metadata reads started before its acknowledgement.
const catalogMutationVersions = new WeakMap<object, Map<AgentBackend, number>>()

export function catalogMutationVersion(connection: object, backend: AgentBackend): number {
  return catalogMutationVersions.get(connection)?.get(backend) ?? 0
}

export function invalidateCatalogMetadata(connection: object, backend: AgentBackend): void {
  let versions = catalogMutationVersions.get(connection)
  if (versions === undefined) {
    versions = new Map()
    catalogMutationVersions.set(connection, versions)
  }
  versions.set(backend, catalogMutationVersion(connection, backend) + 1)
}
