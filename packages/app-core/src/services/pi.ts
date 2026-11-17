import { loadAcpModels, selectAcpModel } from './acp-models'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadAcpDirectoryCatalog, mergeAcpDirectoryCatalog, type AcpCatalogFilterOptions } from '../lib/workspace-key'
import type { ModelSelection, RemoteSession, SessionModels, WorkspaceView } from '../types'
import { createPiSession, createPiWorkspace } from './cursor'

export interface PiCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

/** Read the Host's Pi catalog without spawning a spare CLI for every directory. */
export async function loadPiCatalog(
  client: AgentAcpClient,
  remembered: WorkspaceView[] = [],
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Promise<PiCatalog> {
  return loadAcpDirectoryCatalog({
    backend: 'pi',
    label: 'Pi',
    client,
    remembered,
    warmPath,
    options,
    createWorkspace: createPiWorkspace,
    createSession: createPiSession,
  })
}

/** Preserve new empty sessions and active turns until Pi writes its durable summary. */
export function mergePiCatalog(
  catalog: PiCatalog,
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  options?: AcpCatalogFilterOptions,
): PiCatalog {
  return mergeAcpDirectoryCatalog({
    backend: 'pi',
    catalog,
    workspaces,
    sessions,
    options,
  })
}

/** History can contain several images; always use the bounded ACP transfer response. */
export async function readPiHistory(client: AgentAcpClient, sessionId: string): Promise<unknown[]> {
  const result = await client.transferCall('dsh/sessionHistory', { sessionId, backend: 'pi' })
  if (!record(result) || !Array.isArray(result.events)) throw new Error('Invalid Pi history response.')
  return result.events
}

export function loadPiModels(client: AgentAcpClient, sessionId: string): Promise<SessionModels> {
  return loadAcpModels(client, sessionId, 'pi')
}

export function selectPiModel(client: AgentAcpClient, sessionId: string, selection: ModelSelection): Promise<SessionModels> {
  return selectAcpModel(client, sessionId, 'pi', selection)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
