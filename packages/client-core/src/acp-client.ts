import type {
  AcpModelSelection,
  AcpSessionModels,
  AcpWorkspaceToolCallEndpoint,
  AgentAcpStreamOpenParams,
  AgentAcpFrameData,
  AgentAcpStreamClosedData,
  AgentAcpTransferCommitResult,
  AgentAcpTransferReadResult,
} from '@dsh-remote/protocol'
import {
  AGENT_ACP_TRANSFER_CHUNK_BYTES,
  MAX_AGENT_ACP_TRANSFER_BYTES,
} from '@dsh-remote/protocol'
import type { RemoteClientCore } from './index.js'
import { createRemoteId, RemoteGatewayError } from './remote-gateway.js'

export type AcpAgentBackend = 'cursor' | 'antigravity' | (string & {})

/**
 * `session/prompt` blocks until the upstream turn finishes. Keep this well above
 * the default RemoteClientCore timeout (Android uses ~35s for ApiProxy).
 */
export const ACP_PROMPT_RPC_TIMEOUT_MS = 10 * 60_000

export interface AcpRemoteSession {
  sessionId: string
  cwd?: string
  mode?: 'agent' | 'plan' | 'ask'
}

export interface AcpStream {
  streamId: string
  close(): Promise<void>
}

/** Shared Web/Android client for the generic Agent ACP domain in Remote. */
export class AgentAcpClient {
  constructor(private readonly core: RemoteClientCore, private readonly capabilities: readonly string[] = []) {}

  async call(method: string, params: unknown = {}, signal?: AbortSignal): Promise<unknown> {
    const timeoutMs = method === 'session/prompt' ? ACP_PROMPT_RPC_TIMEOUT_MS : undefined
    return this.core.rpc('agent.acp.call', { method, params }, signal, timeoutMs)
  }

  async initialize(
    params: { protocolVersion?: number; clientInfo?: { name?: string; version?: string } } = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.call('initialize', params, signal)
  }

  async respond(
    requestHandle: string,
    decision: 'allow-once' | 'allow-always' | 'reject-once' | 'cancel',
    result?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.core.rpc('agent.acp.respond', {
      requestHandle,
      decision,
      ...(result === undefined ? {} : { result }),
    }, signal)
  }

  async sessionModels(sessionId: string, backend: 'antigravity', signal?: AbortSignal): Promise<AcpSessionModels> {
    return this.call('dsh/sessionModels', { sessionId, backend }, signal) as Promise<AcpSessionModels>
  }

  async selectModel(sessionId: string, backend: 'antigravity', selection: AcpModelSelection, signal?: AbortSignal): Promise<AcpModelSelection> {
    if (selection.provider !== backend) throw new RemoteGatewayError('INVALID_MESSAGE', 'The model provider does not match the ACP backend.')
    if (!this.capabilities.includes('agent.acp.antigravity.model-load.v1')) {
      await this.call('session/load', { sessionId, backend }, signal)
    }
    const result = await this.call('dsh/selectModel', { sessionId, backend, model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }) }, signal)
    if (!isRecord(result) || !isRecord(result.selected) || result.selected.provider !== backend || typeof result.selected.model !== 'string') {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP did not confirm the selected model.')
    }
    return result.selected as unknown as AcpModelSelection
  }

  async workspaceToolCall(sessionId: string, backend: 'cursor' | 'antigravity', endpoint: AcpWorkspaceToolCallEndpoint, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.call('dsh/toolCall', { sessionId, backend, endpoint, args }, signal)
  }

  async listWorkspaces(
    backend?: AcpAgentBackend,
    signal?: AbortSignal,
  ): Promise<Array<{ path: string; title?: string; sessionCount?: number }>> {
    const result = await this.call('dsh/workspaceList', {
      ...(backend === undefined ? {} : { backend }),
    }, signal).catch(() => [])
    return Array.isArray(result) ? result as Array<{ path: string; title?: string; sessionCount?: number }> : []
  }

  async listSessions(
    path: string,
    backend?: AcpAgentBackend,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<Array<{ conversationId: string; title: string; createdAt: number; updatedAt: number }>> {
    const result = await this.call('dsh/sessionList', {
      path,
      ...(backend === undefined ? {} : { backend }),
      ...(limit === undefined ? {} : { limit }),
    }, signal).catch(() => ({ items: [] }))
    return isRecord(result) && Array.isArray(result.items) ? result.items as Array<{
      conversationId: string
      title: string
      createdAt: number
      updatedAt: number
    }> : []
  }

  async loadSessionHistory(
    sessionId: string,
    backend?: AcpAgentBackend,
    signal?: AbortSignal,
  ): Promise<unknown[]> {
    const result = await this.transferCall('dsh/sessionHistory', {
      sessionId,
      ...(backend === undefined ? {} : { backend }),
    }, signal).catch(() => ({ events: [] }))
    return isRecord(result) && Array.isArray(result.events) ? result.events : []
  }

  async createSession(
    cwd: string,
    mode?: 'agent' | 'plan' | 'ask',
    backend?: AcpAgentBackend,
    signal?: AbortSignal,
  ): Promise<AcpRemoteSession> {
    const result = await this.call('session/new', {
      cwd,
      mcpServers: [],
      ...(mode === undefined ? {} : { mode }),
      ...(backend === undefined ? {} : { backend }),
    }, signal)
    const sessionId = readString(result, 'sessionId')
    if (sessionId === undefined) throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP session/new did not return sessionId.')
    return {
      sessionId,
      cwd,
      ...(mode === undefined ? {} : { mode }),
    }
  }

  async prompt(sessionId: string, text: string, signal?: AbortSignal, images: Array<{ type: 'image'; mimeType: string; data: string }> = [], backend?: AcpAgentBackend): Promise<unknown> {
    const params = { sessionId, ...(backend === undefined ? {} : { backend }), prompt: [...(text.length > 0 ? [{ type: 'text', text }] : []), ...images] }
    return images.length > 0 ? this.transferCall('session/prompt', params, signal) : this.call('session/prompt', params, signal)
  }

  async cancel(sessionId: string, signal?: AbortSignal): Promise<unknown> {
    return this.call('session/cancel', { sessionId }, signal)
  }

  async listDirectory(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.call('dsh/directoryList', { path }, signal)
  }

  async openStream(
    sessionId: string,
    onFrame: (frame: AgentAcpFrameData) => void,
    onClosed?: (closed: AgentAcpStreamClosedData) => void,
    signal?: AbortSignal,
    tool?: AgentAcpStreamOpenParams['tool'],
  ): Promise<AcpStream> {
    const streamId = createRemoteId()
    const unsubscribe = this.core.onEvent(event => {
      if (event.event === 'agent.acp.frame' && isRecord(event.data)) {
        const data = event.data as unknown as AgentAcpFrameData
        if (tool ? data.streamId !== streamId : !frameMatchesSubscription(data, streamId, sessionId)) return
        onFrame(data)
      }
      if (event.event === 'agent.acp.stream.closed' && isRecord(event.data) && event.data.streamId === streamId) {
        onClosed?.(event.data as unknown as AgentAcpStreamClosedData)
      }
    })
    try {
      await this.core.rpc('agent.acp.stream.open', { streamId, sessionId, ...(tool ? { tool } : {}) }, signal)
      if (signal?.aborted) { unsubscribe(); await this.core.rpc('agent.acp.stream.close', { streamId }).catch(() => undefined); throw signal.reason }
    } catch (error) {
      unsubscribe()
      throw error
    }
    return {
      streamId,
      close: async () => {
        unsubscribe()
        await this.core.rpc('agent.acp.stream.close', { streamId }).catch(() => undefined)
      },
    }
  }

  async transferCall(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const requestBytes = new TextEncoder().encode(JSON.stringify({ method, params }))
    if (requestBytes.byteLength > MAX_AGENT_ACP_TRANSFER_BYTES) {
      throw new RemoteGatewayError('REQUEST_TOO_LARGE', 'The ACP transfer request exceeds the bounded limit.')
    }
    const transferId = createRemoteId()
    const totalChunks = Math.ceil(requestBytes.byteLength / AGENT_ACP_TRANSFER_CHUNK_BYTES)
    try {
      await this.core.rpc('agent.acp.transfer.open', {
        transferId,
        totalBytes: requestBytes.byteLength,
        totalChunks,
      }, signal)
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * AGENT_ACP_TRANSFER_CHUNK_BYTES
        const end = Math.min(start + AGENT_ACP_TRANSFER_CHUNK_BYTES, requestBytes.byteLength)
        await this.core.rpc('agent.acp.transfer.chunk', {
          transferId,
          index,
          data: bytesToCanonicalBase64(requestBytes.subarray(start, end)),
        }, signal)
      }
      const commit = await this.core.rpc('agent.acp.transfer.commit', { transferId }, signal,
        method === 'session/prompt' ? ACP_PROMPT_RPC_TIMEOUT_MS : undefined) as AgentAcpTransferCommitResult
      if (commit.kind === 'inline') return commit.response
      if (commit.kind !== 'chunked' || commit.transferId !== transferId || !Number.isSafeInteger(commit.totalBytes) || commit.totalBytes < 1 || commit.totalBytes > MAX_AGENT_ACP_TRANSFER_BYTES
        || commit.totalChunks !== Math.ceil(commit.totalBytes / AGENT_ACP_TRANSFER_CHUNK_BYTES)) throw new RemoteGatewayError('INVALID_RESPONSE', 'Invalid ACP transfer descriptor.')
      const chunks: Uint8Array[] = []
      for (let index = 0; index < commit.totalChunks; index += 1) {
        const part = await this.core.rpc('agent.acp.transfer.read', { transferId, index }, signal) as AgentAcpTransferReadResult
        if (part.transferId !== transferId || part.index !== index || typeof part.data !== 'string' || part.data.length > Math.ceil(AGENT_ACP_TRANSFER_CHUNK_BYTES / 3) * 4) throw new RemoteGatewayError('INVALID_RESPONSE', 'Invalid ACP transfer chunk.')
        const chunk = canonicalBase64ToBytes(part.data)
        const expected = Math.min(AGENT_ACP_TRANSFER_CHUNK_BYTES, commit.totalBytes - index * AGENT_ACP_TRANSFER_CHUNK_BYTES)
        if (chunk.length !== expected || bytesToCanonicalBase64(chunk) !== part.data) throw new RemoteGatewayError('INVALID_RESPONSE', 'Invalid ACP transfer chunk size or encoding.')
        chunks.push(chunk)
      }
      const bytes = concat(chunks, commit.totalBytes)
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    } finally {
      await this.core.rpc('agent.acp.transfer.close', { transferId }).catch(() => undefined)
    }
  }
}

function readString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Match Host frames by explicit stream id or by ACP session id (fallback delivery). */
function frameMatchesSubscription(
  data: AgentAcpFrameData,
  streamId: string,
  sessionId: string,
): boolean {
  if (data.streamId === streamId) return true
  if (data.streamId === sessionScopedStreamId(sessionId)) return true
  const params = isRecord(data.frame.params) ? data.frame.params : undefined
  if (params === undefined) return false
  if (params.sessionId === sessionId) return true
  return isRecord(params.update) && params.update.sessionId === sessionId
}

export function sessionScopedStreamId(sessionId: string): string {
  return `session:${sessionId}`
}

function concat(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function bytesToCanonicalBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary)
}

function canonicalBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
