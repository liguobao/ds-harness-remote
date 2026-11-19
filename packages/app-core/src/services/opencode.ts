import { loadAcpModels, selectAcpModel } from './acp-models'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadAcpDirectoryCatalog, mergeAcpDirectoryCatalog, type AcpCatalogFilterOptions } from '../lib/workspace-key'
import type { ModelSelection, RemoteSession, SessionModels, WorkspaceView } from '../types'
import { createOpencodeSession, createOpencodeWorkspace } from './cursor'

export interface OpencodeCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

/** Read the Host's OpenCode catalog without spawning a spare CLI for every directory. */
export async function loadOpencodeCatalog(
  client: AgentAcpClient,
  remembered: WorkspaceView[] = [],
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Promise<OpencodeCatalog> {
  return loadAcpDirectoryCatalog({
    backend: 'opencode',
    label: 'OpenCode',
    client,
    remembered,
    warmPath,
    options,
    createWorkspace: createOpencodeWorkspace,
    createSession: createOpencodeSession,
  })
}

/** Preserve new empty sessions and active turns until OpenCode writes its durable summary. */
export function mergeOpencodeCatalog(
  catalog: OpencodeCatalog,
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  options?: AcpCatalogFilterOptions,
): OpencodeCatalog {
  return mergeAcpDirectoryCatalog({
    backend: 'opencode',
    catalog,
    workspaces,
    sessions,
    options,
    keepExistingSession: (item, catalogIds) =>
      catalogIds.has(item.sessionId) || item.blank || item.running || item.projections?.values?.pendingCatalog === true,
  })
}

/** History can contain multiple frames; always use the bounded ACP transfer response. */
export async function readOpencodeHistory(client: AgentAcpClient, sessionId: string): Promise<unknown[]> {
  const result = await client.transferCall('dsh/sessionHistory', { sessionId, backend: 'opencode' })
  if (!record(result) || !Array.isArray(result.events)) throw new Error('Invalid OpenCode history response.')
  return result.events
}

export function loadOpencodeModels(client: AgentAcpClient, sessionId: string): Promise<SessionModels> {
  return loadAcpModels(client, sessionId, 'opencode')
}

export function selectOpencodeModel(client: AgentAcpClient, sessionId: string, selection: ModelSelection): Promise<SessionModels> {
  return selectAcpModel(client, sessionId, 'opencode', selection)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
