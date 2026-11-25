import type {
  AcpAvailableCommand,
  AcpModelSelection,
  AcpSessionModels,
  AcpSessionModes,
  AcpWorkspaceToolCallEndpoint,
  AgentAcpStreamOpenParams,
  AgentAcpFrameData,
  AgentAcpStreamClosedData,
  AgentAcpTransferCommitResult,
  AgentAcpTransferReadResult,
  AcpSessionArchivedData,
} from '@dsh-remote/protocol'
import {
  AGENT_ACP_TRANSFER_CHUNK_BYTES,
  MAX_AGENT_ACP_TRANSFER_BYTES,
} from '@dsh-remote/protocol'
import type { RemoteClientCore } from './index.js'
import { createRemoteId, RemoteGatewayError } from './remote-gateway.js'

export type AcpAgentBackend = 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes' | (string & {})

/**
 * `session/prompt` blocks until the upstream turn finishes. Keep this well above
 * the default RemoteClientCore timeout (Android uses ~35s for ApiProxy).
 */
export const ACP_PROMPT_RPC_TIMEOUT_MS = 10 * 60_000

/**
 * Replaying or loading long ACP sessions (especially OpenCode SQLite transcripts)
 * runs with up to 20s process start + 120s Host `session/load` budget; keep the
 * client RPC timeout above the combined Host budget.
 */
export const ACP_HISTORY_RPC_TIMEOUT_MS = 150_000

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

  supportsArchive(backend: string): boolean {
    return backend === 'opencode' && this.capabilities.includes('agent.acp.opencode.archive.v1')
  }

  onSessionArchived(handler: (data: AcpSessionArchivedData) => void): () => void {
    return this.core.onEvent(event => {
      if (event.event === 'agent.acp.catalog.changed' && isRecord(event.data) && event.data.backend === 'opencode'
        && event.data.archived === true && typeof event.data.sessionId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(event.data.sessionId)) handler(event.data as unknown as AcpSessionArchivedData)
    })
  }

  async archiveSession(sessionId: string, backend: string, signal?: AbortSignal): Promise<AcpSessionArchivedData> {
    if (!this.supportsArchive(backend)) throw new RemoteGatewayError('OPENCODE_ARCHIVE_UNAVAILABLE', 'Update the Host plugin to support OpenCode native archiving.')
    const result = await this.call('dsh/sessionArchive', { sessionId, backend }, signal)
    if (!isRecord(result) || result.backend !== backend || result.sessionId !== sessionId || result.archived !== true) throw new RemoteGatewayError('INVALID_RESPONSE', 'OpenCode did not confirm the session archive state.')
    return result as unknown as AcpSessionArchivedData
  }

  async call(method: string, params: unknown = {}, signal?: AbortSignal): Promise<unknown> {
    return this.core.rpc('agent.acp.call', { method, params }, signal, rpcTimeoutForMethod(method))
  }

  async initialize(
    params: { protocolVersion?: number; backend?: AcpAgentBackend; clientInfo?: { name?: string; version?: string } } = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.call('initialize', params, signal)
  }

  async respond(
    requestHandle: string,
    decision: 'allow-once' | 'reject-once' | 'cancel',
    result?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.core.rpc('agent.acp.respond', {
      requestHandle,
      decision,
      ...(result === undefined ? {} : { result }),
    }, signal)
  }

  async sessionModels(sessionId: string, backend: AcpAgentBackend, signal?: AbortSignal): Promise<AcpSessionModels> {
    return this.call('dsh/sessionModels', { sessionId, backend }, signal) as Promise<AcpSessionModels>
  }

  async selectModel(sessionId: string, backend: AcpAgentBackend, selection: AcpModelSelection, signal?: AbortSignal): Promise<AcpModelSelection> {
    if (selection.provider !== backend) throw new RemoteGatewayError('INVALID_MESSAGE', 'The model provider does not match the ACP backend.')
    if (backend === 'antigravity' && !this.capabilities.includes('agent.acp.antigravity.model-load.v1')) {
      await this.call('session/load', { sessionId, backend }, signal)
    }
    const result = await this.call('dsh/selectModel', { sessionId, backend, model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }) }, signal)
    if (!isRecord(result) || !isRecord(result.selected) || result.selected.provider !== backend || typeof result.selected.model !== 'string') {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP did not confirm the selected model.')
    }
    return result.selected as unknown as AcpModelSelection
  }

  async sessionModes(sessionId: string, backend: AcpAgentBackend, signal?: AbortSignal): Promise<AcpSessionModes> {
    const result = await this.call('dsh/sessionModes', { sessionId, backend }, signal)
    if (!isRecord(result) || !Array.isArray(result.availableModes)) {
      return { availableModes: [] }
    }
    return {
      ...(typeof result.currentModeId === 'string' ? { currentModeId: result.currentModeId } : {}),
      availableModes: result.availableModes.flatMap(item => (
        isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
          ? [{ id: item.id, name: item.name, ...(typeof item.description === 'string' ? { description: item.description } : {}) }]
          : []
      )),
    }
  }

  async setMode(sessionId: string, backend: AcpAgentBackend, modeId: string, signal?: AbortSignal): Promise<{ currentModeId?: string }> {
    const result = await this.call('session/set_mode', { sessionId, backend, modeId }, signal)
    return isRecord(result) && typeof result.currentModeId === 'string' ? { currentModeId: result.currentModeId } : { currentModeId: modeId }
  }

  async sessionCommands(sessionId: string, backend: AcpAgentBackend, signal?: AbortSignal): Promise<AcpAvailableCommand[]> {
    const result = await this.call('dsh/sessionCommands', { sessionId, backend }, signal)
    if (!isRecord(result) || !Array.isArray(result.commands)) return []
    return result.commands.flatMap(item => (
      isRecord(item) && typeof item.name === 'string'
        ? [{
            name: item.name,
            ...(typeof item.description === 'string' ? { description: item.description } : {}),
            ...(isRecord(item.input) && typeof item.input.hint === 'string' ? { input: { hint: item.input.hint } } : {}),
          }]
        : []
    ))
  }

  async forkSession(sessionId: string, backend: AcpAgentBackend, signal?: AbortSignal): Promise<{ sessionId: string }> {
    const result = await this.call('session/fork', { sessionId, backend }, signal)
    const forkedId = readString(result, 'sessionId')
    if (forkedId === undefined) throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP session/fork did not return sessionId.')
    return { sessionId: forkedId }
  }

  async createWorkspace(path: string, backend: AcpAgentBackend, title?: string, signal?: AbortSignal): Promise<{ path: string; title?: string }> {
    const result = await this.call('dsh/workspaceCreate', { backend, path, ...(title ? { title } : {}) }, signal)
    if (!isRecord(result) || typeof result.path !== 'string') {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP workspace creation failed.')
    }
    return result as { path: string; title?: string }
  }

  async renameWorkspace(path: string, backend: AcpAgentBackend, title: string, signal?: AbortSignal): Promise<{ path: string; title?: string }> {
    const result = await this.call('dsh/workspaceRename', { backend, path, title }, signal)
    if (!isRecord(result) || typeof result.path !== 'string') {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP workspace rename failed.')
    }
    return result as { path: string; title?: string }
  }

  async deleteWorkspace(path: string, backend: AcpAgentBackend, signal?: AbortSignal): Promise<void> {
    await this.call('dsh/workspaceDelete', { backend, path }, signal)
  }

  async reorderWorkspaces(backend: AcpAgentBackend, paths: string[], signal?: AbortSignal): Promise<string[]> {
    const result = await this.call('dsh/workspaceReorder', { backend, paths }, signal)
    return isRecord(result) && Array.isArray(result.paths)
      ? result.paths.filter((item): item is string => typeof item === 'string')
      : paths
  }

  async pinSession(sessionId: string, backend: AcpAgentBackend, signal?: AbortSignal): Promise<string[]> {
    const result = await this.call('dsh/sessionPin', { backend, sessionId }, signal)
    return isRecord(result) && Array.isArray(result.pinnedSessionIds)
      ? result.pinnedSessionIds.filter((item): item is string => typeof item === 'string')
      : []
  }

  async unpinSession(sessionId: string, backend: AcpAgentBackend, signal?: AbortSignal): Promise<string[]> {
    const result = await this.call('dsh/sessionUnpin', { backend, sessionId }, signal)
    return isRecord(result) && Array.isArray(result.pinnedSessionIds)
      ? result.pinnedSessionIds.filter((item): item is string => typeof item === 'string')
      : []
  }

  async selectPermission(sessionId: string, backend: AcpAgentBackend, preset: string, signal?: AbortSignal): Promise<unknown> {
    return this.call('dsh/selectPermission', { sessionId, backend, preset }, signal)
  }

  async workspaceToolCall(sessionId: string, backend: AcpAgentBackend, endpoint: AcpWorkspaceToolCallEndpoint, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.call('dsh/toolCall', { sessionId, backend, endpoint, args }, signal)
  }

  async listWorkspaces(
    backend?: AcpAgentBackend,
    signal?: AbortSignal,
  ): Promise<Array<{ path: string; title?: string; sessionCount?: number }>> {
    const result = await this.call('dsh/workspaceList', {
      ...(backend === undefined ? {} : { backend }),
    }, signal).catch(error => {
      if (backend === 'pi' || backend === 'claude' || backend === 'hermes') throw error
      return []
    })
    if ((backend === 'pi' || backend === 'claude' || backend === 'hermes') && !Array.isArray(result)) {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP workspace catalog is invalid.')
    }
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
    }, signal).catch(error => {
      if (backend === 'pi' || backend === 'claude' || backend === 'hermes') throw error
      return { items: [] }
    })
    if ((backend === 'pi' || backend === 'claude' || backend === 'hermes') && (!isRecord(result) || !Array.isArray(result.items))) {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP session catalog is invalid.')
    }
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
    const details = await this.loadSessionDetails(sessionId, backend, signal)
    return details.events
  }

  async loadSessionDetails(
    sessionId: string,
    backend?: AcpAgentBackend,
    signal?: AbortSignal,
  ): Promise<{
    events: unknown[]
    permissionPreset?: string
    modes?: AcpSessionModes
    commands?: AcpAvailableCommand[]
    running?: boolean
  }> {
    const strictHistoryBackend = backend === 'pi' || backend === 'claude' || backend === 'opencode' || backend === 'hermes' || backend === 'antigravity'
    const result = await this.transferCall('dsh/sessionHistory', {
      sessionId,
      ...(backend === undefined ? {} : { backend }),
    }, signal).catch(error => {
      if (strictHistoryBackend) throw error
      return { events: [] }
    })
    if (strictHistoryBackend && (!isRecord(result) || !Array.isArray(result.events))) {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP session history is invalid.')
    }
    if (!isRecord(result)) return { events: [] }
    const events = Array.isArray(result.events) ? result.events : []
    const permissionPreset = typeof result.permissionPreset === 'string' ? result.permissionPreset : undefined
    const running = typeof result.running === 'boolean' ? result.running : undefined
    const modes = isRecord(result.modes) && Array.isArray(result.modes.availableModes)
      ? {
          ...(typeof result.modes.currentModeId === 'string' ? { currentModeId: result.modes.currentModeId } : {}),
          availableModes: result.modes.availableModes.flatMap(item => (
            isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
              ? [{ id: item.id, name: item.name, ...(typeof item.description === 'string' ? { description: item.description } : {}) }]
              : []
          )),
        }
      : undefined
    const commands = Array.isArray(result.commands)
      ? result.commands.flatMap(item => (
          isRecord(item) && typeof item.name === 'string'
            ? [{
                name: item.name,
                ...(typeof item.description === 'string' ? { description: item.description } : {}),
                ...(isRecord(item.input) && typeof item.input.hint === 'string' ? { input: { hint: item.input.hint } } : {}),
              }]
            : []
        ))
      : undefined
    return {
      events,
      ...(permissionPreset ? { permissionPreset } : {}),
      ...(modes ? { modes } : {}),
      ...(commands ? { commands } : {}),
      ...(running !== undefined ? { running } : {}),
    }
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
    let closed = false
    let opened = false
    let coreClosed = false
    let callerClosed = false
    let pendingClosed: AgentAcpStreamClosedData | undefined
    let unsubscribe: () => void = () => undefined
    let unsubscribeCoreClose: () => void = () => undefined
    const onAbort = () => {
      callerClosed = true
      if (!markClosed()) return
      void this.core.rpc('agent.acp.stream.close', { streamId }).catch(() => undefined)
    }
    const markClosed = () => {
      if (closed) return false
      closed = true
      unsubscribe()
      unsubscribeCoreClose()
      signal?.removeEventListener('abort', onAbort)
      return true
    }
    unsubscribe = this.core.onEvent(event => {
      if (event.event === 'agent.acp.frame' && isRecord(event.data)) {
        const data = event.data as unknown as AgentAcpFrameData
        if (tool ? data.streamId !== streamId : !frameMatchesSubscription(data, streamId, sessionId)) return
        onFrame(data)
      }
      if (event.event === 'agent.acp.stream.closed' && isRecord(event.data) && event.data.streamId === streamId) {
        if (!markClosed()) return
        const closedData = event.data as unknown as AgentAcpStreamClosedData
        // Host may emit `stream.closed` before the `stream.open` RPC response arrives
        // (e.g. after replaying buffered frames for a downed backend). Defer `onClosed`
        // until `openStream` resolves so callers never observe a callback before receiving
        // the stream handle.
        if (!opened) {
          pendingClosed = closedData
          return
        }
        onClosed?.(closedData)
      }
    })
    unsubscribeCoreClose = this.core.onClose(() => {
      if (!opened) {
        coreClosed = true
        markClosed()
        return
      }
      if (!markClosed()) return
      onClosed?.({ streamId, reason: 'peer-disconnected' })
    })
    try {
      await this.core.rpc('agent.acp.stream.open', { streamId, sessionId, ...(tool ? { tool } : {}) }, signal)
      if (signal?.aborted) {
        callerClosed = true
        const shouldCloseRemote = !closed
        markClosed()
        if (shouldCloseRemote) {
          await this.core.rpc('agent.acp.stream.close', { streamId }).catch(() => undefined)
        }
        throw signal.reason
      }
      if (coreClosed) {
        markClosed()
        throw new RemoteGatewayError('TRANSPORT_CLOSED', 'The Remote connection closed while opening the ACP stream.')
      }
      opened = true
      if (!closed) {
        signal?.addEventListener('abort', onAbort, { once: true })
      }
    } catch (error) {
      markClosed()
      throw error
    }
    if (pendingClosed !== undefined) {
      const deferredClosed = pendingClosed
      pendingClosed = undefined
      // Two microtask ticks ensure the caller's `await openStream()` continuation
      // (and any synchronous assignment, `close()`, or `signal.abort()` right after it)
      // runs first.
      queueMicrotask(() => {
        queueMicrotask(() => {
          if (callerClosed || signal?.aborted) return
          try {
            onClosed?.(deferredClosed)
          } catch (error) {
            console.error('[dsh-remote] event handler error:', error instanceof Error ? error.name : 'unknown')
          }
        })
      })
    }
    return {
      streamId,
      close: async () => {
        callerClosed = true
        if (!markClosed()) return
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
        rpcTimeoutForMethod(method)) as AgentAcpTransferCommitResult
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

function rpcTimeoutForMethod(method: string): number | undefined {
  if (method === 'session/prompt') return ACP_PROMPT_RPC_TIMEOUT_MS
  if (method === 'dsh/sessionHistory' || method === 'session/load') return ACP_HISTORY_RPC_TIMEOUT_MS
  return undefined
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
