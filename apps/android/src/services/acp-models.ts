import type { AgentAcpClient } from '@dsh-remote/client-core'
import type { ModelSelection, SessionModels } from '../types'

type ModelBackend = 'cursor' | 'claude' | 'pi' | 'opencode' | 'antigravity' | 'hermes'

export async function loadAcpModels(client: AgentAcpClient, sessionId: string, backend: ModelBackend): Promise<SessionModels> {
  const result = await client.sessionModels(sessionId, backend as Parameters<AgentAcpClient['sessionModels']>[1])
  if (!record(result) || !record(result.current) || result.current.provider !== backend
    || typeof result.current.model !== 'string' || !Array.isArray(result.groups)) throw new Error('Invalid ACP model catalog.')
  const groups = result.groups.flatMap(group => {
    if (!record(group) || group.id !== backend || !Array.isArray(group.models)) return []
    const models = group.models.flatMap(model => {
      if (!record(model) || typeof model.id !== 'string' || typeof model.name !== 'string') return []
      const reasoning = record(model.reasoning) && Array.isArray(model.reasoning.efforts)
        ? { efforts: model.reasoning.efforts.flatMap(effort => record(effort) && typeof effort.id === 'string' && typeof effort.name === 'string'
          ? [{ id: effort.id, name: effort.name }] : []),
          ...(typeof model.reasoning.defaultEffort === 'string' ? { defaultEffort: model.reasoning.defaultEffort } : {}) }
        : undefined
      return [{ id: model.id, name: model.name, ...(reasoning === undefined ? {} : { reasoning }) }]
    })
    return [{ id: backend, name: typeof group.name === 'string' ? group.name : { cursor: 'Cursor', claude: 'Claude', pi: 'Pi', opencode: 'OpenCode', antigravity: 'Antigravity', hermes: 'Hermes' }[backend], models }]
  })
  return { current: { provider: backend, model: result.current.model,
    ...(typeof result.current.reasoningEffort === 'string' ? { reasoningEffort: result.current.reasoningEffort } : {}) },
    routable: result.routable === true, groups, failures: [] }
}

export async function selectAcpModel(client: AgentAcpClient, sessionId: string, backend: ModelBackend, selection: ModelSelection): Promise<SessionModels> {
  if (selection.provider !== backend) throw new Error('Invalid ACP model provider.')
  await client.selectModel(sessionId, backend as Parameters<AgentAcpClient['selectModel']>[1], selection)
  // Re-read the authoritative selection; never fabricate a successful mode switch.
  return loadAcpModels(client, sessionId, backend)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
