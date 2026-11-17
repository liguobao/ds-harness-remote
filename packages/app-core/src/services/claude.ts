import { loadAcpModels, selectAcpModel } from './acp-models'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadAcpDirectoryCatalog, mergeAcpDirectoryCatalog, type AcpCatalogFilterOptions } from '../lib/workspace-key'
import type { ModelSelection, RemoteSession, SessionModels, WorkspaceView } from '../types'
import { createClaudeSession, createClaudeWorkspace } from './cursor'

export interface ClaudeCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

/** Read the Host's Claude catalog without spawning a spare CLI for every directory. */
export async function loadClaudeCatalog(
  client: AgentAcpClient,
  remembered: WorkspaceView[] = [],
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Promise<ClaudeCatalog> {
  return loadAcpDirectoryCatalog({
    backend: 'claude',
    label: 'Claude',
    client,
    remembered,
    warmPath,
    options,
    createWorkspace: createClaudeWorkspace,
    createSession: createClaudeSession,
  })
}

/** Preserve new empty sessions and active turns until Claude writes its durable summary. */
export function mergeClaudeCatalog(
  catalog: ClaudeCatalog,
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  options?: AcpCatalogFilterOptions,
): ClaudeCatalog {
  return mergeAcpDirectoryCatalog({
    backend: 'claude',
    catalog,
    workspaces,
    sessions,
    options,
  })
}

/** History can contain multiple frames; always use the bounded ACP transfer response. */
export async function readClaudeHistory(client: AgentAcpClient, sessionId: string): Promise<unknown[]> {
  const result = await client.transferCall('dsh/sessionHistory', { sessionId, backend: 'claude' })
  if (!record(result) || !Array.isArray(result.events)) throw new Error('Invalid Claude history response.')
  return result.events
}

export function loadClaudeModels(client: AgentAcpClient, sessionId: string): Promise<SessionModels> {
  return loadAcpModels(client, sessionId, 'claude')
}

export function selectClaudeModel(client: AgentAcpClient, sessionId: string, selection: ModelSelection): Promise<SessionModels> {
  return selectAcpModel(client, sessionId, 'claude', selection)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
