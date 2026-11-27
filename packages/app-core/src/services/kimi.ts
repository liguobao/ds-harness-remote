import { loadAcpModels, selectAcpModel } from './acp-models'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadAcpDirectoryCatalog, mergeAcpDirectoryCatalog, type AcpCatalogFilterOptions } from '../lib/workspace-key'
import type { ModelSelection, RemoteSession, SessionModels, WorkspaceView } from '../types'
import { createKimiSession, createKimiWorkspace } from './cursor'

export interface KimiCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

/** Read the Host's Kimi Code catalog without spawning a spare ACP process for every directory. */
export async function loadKimiCatalog(
  client: AgentAcpClient,
  remembered: WorkspaceView[] = [],
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Promise<KimiCatalog> {
  return loadAcpDirectoryCatalog({
    backend: 'kimi',
    label: 'Kimi',
    client,
    remembered,
    warmPath,
    options,
    createWorkspace: createKimiWorkspace,
    createSession: createKimiSession,
  })
}

/** Preserve new empty sessions and active turns until the Host catalog reports them. */
export function mergeKimiCatalog(
  catalog: KimiCatalog,
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  options?: AcpCatalogFilterOptions,
): KimiCatalog {
  return mergeAcpDirectoryCatalog({
    backend: 'kimi',
    catalog,
    workspaces,
    sessions,
    options,
  })
}

/** History can contain multiple frames; always use the bounded ACP transfer response. */
export async function readKimiHistory(client: AgentAcpClient, sessionId: string): Promise<unknown[]> {
  const result = await client.transferCall('dsh/sessionHistory', { sessionId, backend: 'kimi' })
  if (!record(result) || !Array.isArray(result.events)) throw new Error('Invalid Kimi history response.')
  return result.events
}

export function loadKimiModels(client: AgentAcpClient, sessionId: string): Promise<SessionModels> {
  return loadAcpModels(client, sessionId, 'kimi')
}

export function selectKimiModel(client: AgentAcpClient, sessionId: string, selection: ModelSelection): Promise<SessionModels> {
  return selectAcpModel(client, sessionId, 'kimi', selection)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
