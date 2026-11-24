import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadAcpDirectoryCatalog, mergeAcpDirectoryCatalog, type AcpCatalogFilterOptions } from '../lib/workspace-key'
import type { RemoteSession, WorkspaceView } from '../types'
import { createAntigravitySession, createAntigravityWorkspace } from './cursor'

export interface AntigravityCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

/** Read the Host's AGY catalog without spawning a spare CLI for every directory. */
export async function loadAntigravityCatalog(
  client: AgentAcpClient,
  remembered: WorkspaceView[] = [],
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Promise<AntigravityCatalog> {
  return loadAcpDirectoryCatalog({
    backend: 'antigravity',
    label: 'AGY',
    client,
    remembered,
    warmPath,
    options,
    createWorkspace: createAntigravityWorkspace,
    createSession: createAntigravitySession,
  })
}

/** Preserve new empty sessions and active turns until AGY writes its durable summary. */
export function mergeAntigravityCatalog(
  catalog: AntigravityCatalog,
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  options?: AcpCatalogFilterOptions,
): AntigravityCatalog {
  return mergeAcpDirectoryCatalog({
    backend: 'antigravity',
    catalog,
    workspaces,
    sessions,
    options,
  })
}

/** History can contain several images; always use the bounded ACP transfer response. */
export async function readAntigravityHistory(client: AgentAcpClient, sessionId: string, signal?: AbortSignal): Promise<unknown[]> {
  const result = await client.transferCall('dsh/sessionHistory', { sessionId, backend: 'antigravity' }, signal)
  if (!record(result) || !Array.isArray(result.events)) throw new Error('Invalid AGY history response.')
  return result.events
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
