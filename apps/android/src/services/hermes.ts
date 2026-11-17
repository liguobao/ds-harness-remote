import { loadAcpModels, selectAcpModel } from './acp-models'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadAcpDirectoryCatalog, mergeAcpDirectoryCatalog, type AcpCatalogFilterOptions } from '../lib/workspace-key'
import type { ModelSelection, RemoteSession, SessionModels, WorkspaceView } from '../types'
import { createHermesSession, createHermesWorkspace } from './cursor'

export interface HermesCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

/** Read the Host's Hermes Agent catalog without spawning a spare ACP process for every directory. */
export async function loadHermesCatalog(
  client: AgentAcpClient,
  remembered: WorkspaceView[] = [],
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Promise<HermesCatalog> {
  return loadAcpDirectoryCatalog({
    backend: 'hermes',
    label: 'Hermes',
    client,
    remembered,
    warmPath,
    options,
    createWorkspace: createHermesWorkspace,
    createSession: createHermesSession,
  })
}

/** Preserve new empty sessions and active turns until the Host catalog reports them. */
export function mergeHermesCatalog(
  catalog: HermesCatalog,
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  options?: AcpCatalogFilterOptions,
): HermesCatalog {
  return mergeAcpDirectoryCatalog({
    backend: 'hermes',
    catalog,
    workspaces,
    sessions,
    options,
  })
}

/** History can contain multiple frames; always use the bounded ACP transfer response. */
export async function readHermesHistory(client: AgentAcpClient, sessionId: string): Promise<unknown[]> {
  const result = await client.transferCall('dsh/sessionHistory', { sessionId, backend: 'hermes' })
  if (!record(result) || !Array.isArray(result.events)) throw new Error('Invalid Hermes history response.')
  return result.events
}

export function loadHermesModels(client: AgentAcpClient, sessionId: string): Promise<SessionModels> {
  return loadAcpModels(client, sessionId, 'hermes')
}

export function selectHermesModel(client: AgentAcpClient, sessionId: string, selection: ModelSelection): Promise<SessionModels> {
  return selectAcpModel(client, sessionId, 'hermes', selection)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
