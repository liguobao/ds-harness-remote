import type { AcpClientLike } from './virtual-contract.js'

const CURSOR_WORKSPACE_PREFIX = 'cursor:cwd:'

const AGY_WORKSPACE_PREFIX = 'antigravity:cwd:'

const OPENCODE_WORKSPACE_PREFIX = 'opencode:cwd:'

const CLAUDE_WORKSPACE_PREFIX = 'claude:cwd:'

const HERMES_WORKSPACE_PREFIX = 'hermes:cwd:'

const CURSOR_PROVIDER = 'cursor'

const OPENCODE_PROVIDER = 'opencode'

/** Every ACP backend the Host can project into the Client's virtual Harness. */
export type AcpCatalogBackend = 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes'

const WORKSPACE_PREFIXES: Record<AcpCatalogBackend, string> = {
  cursor: CURSOR_WORKSPACE_PREFIX,
  antigravity: AGY_WORKSPACE_PREFIX,
  pi: 'pi:cwd:',
  opencode: OPENCODE_WORKSPACE_PREFIX,
  claude: CLAUDE_WORKSPACE_PREFIX,
  hermes: HERMES_WORKSPACE_PREFIX,
}

const BACKEND_LABELS: Record<AcpCatalogBackend, string> = {
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  pi: 'Pi',
  opencode: 'OpenCode',
  claude: 'Claude',
  hermes: 'Hermes',
}

const BACKEND_PROVIDERS: Record<AcpCatalogBackend, string> = {
  cursor: CURSOR_PROVIDER,
  antigravity: 'antigravity',
  pi: 'pi',
  opencode: OPENCODE_PROVIDER,
  claude: 'claude',
  hermes: 'hermes',
}

export function acpWorkspacePrefix(backend: AcpCatalogBackend): string {
  return WORKSPACE_PREFIXES[backend]
}

export function acpBackendLabel(backend: AcpCatalogBackend): string {
  return BACKEND_LABELS[backend]
}

export function acpBackendProvider(backend: AcpCatalogBackend): string {
  return BACKEND_PROVIDERS[backend]
}

export const ACP_CATALOG_BACKENDS: readonly AcpCatalogBackend[] = ['cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes']

export interface AcpVirtualWorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  sessionCount: number
  createdAt: string
  updatedAt: string
}

/** Build a backend-scoped virtual Workspace id for an absolute Host cwd. */
export function acpCwdWorkspaceId(path: string, backend: AcpCatalogBackend): string {
  if (!(backend in WORKSPACE_PREFIXES)) throw new Error("An explicit ACP workspace backend is required.")
  return `${acpWorkspacePrefix(backend)}${encodeURIComponent(path)}`
}

export function createAcpWorkspaceView(path: string, backend: AcpCatalogBackend, title?: string): AcpVirtualWorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: acpCwdWorkspaceId(path, backend),
    path,
    title: label,
    sessionIds: [],
    sessionCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** Discover ACP virtual workspaces visible on the Host. */
export async function discoverAcpVirtualWorkspaces(
  client: AcpClientLike,
  backend: AcpCatalogBackend,
  signal?: AbortSignal,
): Promise<AcpVirtualWorkspaceView[]> {
  if (client?.listWorkspaces !== undefined) {
    try {
      const items = await client.listWorkspaces(backend, signal)
      if (Array.isArray(items) && items.length > 0) {
        return items
          .filter(item => typeof item?.path === 'string' && item.path.trim() !== '')
          .map(item => {
            const view = createAcpWorkspaceView(item.path, backend, item.title)
            if (typeof item.sessionCount === 'number') view.sessionCount = item.sessionCount
            return view
          })
      }
    } catch (error) {
      if (backend === 'pi' || backend === 'claude' || backend === 'hermes') throw error
      // Discovery is optional for legacy backends; an unavailable Host returns no workspaces.
    }
  }
  return []
}

export function recreateWorkspaceFromId(workspaceId: string, backend: AcpCatalogBackend): AcpVirtualWorkspaceView | undefined {
  const prefix = acpWorkspacePrefix(backend)
  if (!workspaceId.startsWith(prefix)) return undefined
  try {
    const path = decodeURIComponent(workspaceId.slice(prefix.length))
    if (path.length > 0) return createAcpWorkspaceView(path, backend)
  } catch {
    return undefined
  }
  return undefined
}

export function nativeWorkspace(view: AcpVirtualWorkspaceView): Omit<AcpVirtualWorkspaceView, 'sessionCount'> {
  return {
    workspaceId: view.workspaceId,
    path: view.path,
    title: view.title,
    sessionIds: view.sessionIds,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  }
}

export interface AcpModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface AcpModelView {
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

export function modelCatalog(backend: AcpCatalogBackend = "cursor"): {
  default: AcpModelSelection
  routableProviders: string[]
  groups: Array<{ id: string; name: string; models: AcpModelView[] }>
  failures: Array<{ id: string; name: string; message: string }>
} {
  const provider = acpBackendProvider(backend)
  const name = acpBackendLabel(backend)
  const models: AcpModelView[] = []
  const defaultModel = models[0]?.id ?? 'host-settings'
  return {
    default: { provider, model: defaultModel },
    routableProviders: [],
    groups: [{
      id: provider,
      name,
      models,
    }],
    failures: [],
  }
}
