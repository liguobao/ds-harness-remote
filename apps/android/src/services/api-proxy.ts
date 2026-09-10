import type { RemoteClientCore } from '@dsh-remote/client-core'
import {
  HARNESS_API_TRANSFER_CHUNK_BYTES,
  MAX_HARNESS_API_TRANSFER_BYTES,
  type EventPayload,
  type HarnessApiCallParams,
  type HarnessApiFrameData,
  type HarnessApiRespondParams,
  type HarnessApiStreamOpenParams,
  type HarnessApiStreamClosedData,
  type HarnessApiTransferCommitResult,
  type HarnessApiTransferReadResult,
} from '@dsh-remote/protocol'
import type {
  AskUserQuestionAnswer,
  DirectoryListing,
  HistoryEntry,
  HostDescriptor,
  ModelSelection,
  MuxFrame,
  MuxStreamFrame,
  PromptImage,
  RemoteSession,
  SessionHistoryPage,
  SessionModels,
  WorkspaceList,
  WorkspaceView,
} from '../types'

const DIRECT_API_CALL_BYTES = 2 * 1024 * 1024
const LEGACY_AGENT_PRESET = 'code'
const LEGACY_AGENT_PRESET_TARGET = 'ptc'

/** Native ApiProxy RpcResult envelope (mirrors @deepseek-ai/dsh-host-apiproxy/api). */
export type NativeRpcResult<T> = {
  ok: true
  value: T
} | {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

/** Native ApiProxy RpcResponse envelope (mirrors @deepseek-ai/dsh-host-apiproxy/api). */
export interface NativeRpcResponse<T = unknown> {
  rpcId: string
  result: NativeRpcResult<T>
}

export interface ClientResponseMessage {
  type: 'client-response'
  rpcId: string
  result: NativeRpcResult<unknown>
}

interface NativeRpcReceipt {
  accepted: boolean
  reason?: 'not-pending' | 'bad-response'
}

/**
 * Android-side Remote ApiProxy tunnel client.
 *
 * Drives the Host's ApiProxy bridge through the four-tunnel contract
 * (`harness.api.call/respond/stream.open/stream.close`) and keeps the native
 * rpcId correlation semantics. Only allowlisted Harness methods are used;
 * the Host remains the authority for what a remote UI may call.
 */
export class RemoteApiProxy {
  private readonly streams = new Map<string, (frame: MuxStreamFrame) => void>()

  constructor(private readonly core: RemoteClientCore) {}

  /** Unary ApiProxy call; resolves with the native result value, rejects with the RPC error. */
  async call<TResult = unknown>(method: string, payload: unknown, signal?: AbortSignal): Promise<TResult> {
    return this.callWithRpcId(method, payload, createNativeRpcId(), signal)
  }

  private async callWithRpcId<TResult>(method: string, payload: unknown, rpcId: string, signal?: AbortSignal): Promise<TResult> {
    const params = {
      method,
      rpcId,
      payload,
    } satisfies HarnessApiCallParams
    const encoded = new TextEncoder().encode(JSON.stringify(params))
    const response = encoded.byteLength > DIRECT_API_CALL_BYTES
      ? await this.callTransferred<TResult>(encoded, signal)
      : await this.core.rpc<NativeRpcResponse<TResult>>('harness.api.call', params, signal)
    if (String(response.rpcId) !== rpcId) {
      throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an ApiProxy response for a different request.')
    }
    if (response.result.ok) return response.result.value
    throw new ApiProxyError(
      response.result.error.code,
      response.result.error.message,
      response.result.error.details,
    )
  }

  /** Send an oversized native ApiProxy envelope through the bounded image-transfer path. */
  private async callTransferred<TResult>(encoded: Uint8Array, signal?: AbortSignal): Promise<NativeRpcResponse<TResult>> {
    if (encoded.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new ApiProxyError('INVALID_MESSAGE', 'The image prompt exceeds the remote transfer limit.')
    }
    const transferId = createNativeRpcId()
    const totalChunks = Math.ceil(encoded.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES)
    let opened = false
    try {
      await this.core.rpc('harness.api.transfer.open', {
        transferId,
        totalBytes: encoded.byteLength,
        totalChunks,
      }, signal)
      opened = true
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * HARNESS_API_TRANSFER_CHUNK_BYTES
        const chunk = encoded.subarray(start, Math.min(start + HARNESS_API_TRANSFER_CHUNK_BYTES, encoded.byteLength))
        await this.core.rpc('harness.api.transfer.chunk', {
          transferId,
          index,
          data: bytesToBase64(chunk),
        }, signal)
      }
      const committed = await this.core.rpc<HarnessApiTransferCommitResult>(
        'harness.api.transfer.commit',
        { transferId },
        signal,
      )
      if (committed.kind === 'inline') return committed.response as NativeRpcResponse<TResult>
      if (committed.transferId !== transferId
        || committed.totalBytes <= 0
        || committed.totalBytes > MAX_HARNESS_API_TRANSFER_BYTES
        || committed.totalChunks !== Math.ceil(committed.totalBytes / HARNESS_API_TRANSFER_CHUNK_BYTES)) {
        throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an invalid image-transfer descriptor.')
      }
      const responseBytes = new Uint8Array(committed.totalBytes)
      let offset = 0
      for (let index = 0; index < committed.totalChunks; index += 1) {
        const result = await this.core.rpc<HarnessApiTransferReadResult>(
          'harness.api.transfer.read',
          { transferId, index },
          signal,
        )
        if (result.transferId !== transferId || result.index !== index) {
          throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an out-of-order image-transfer chunk.')
        }
        const chunk = base64ToBytes(result.data)
        const expectedBytes = Math.min(HARNESS_API_TRANSFER_CHUNK_BYTES, committed.totalBytes - offset)
        if (chunk.byteLength !== expectedBytes) {
          throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an invalid image-transfer chunk.')
        }
        responseBytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(responseBytes)) as NativeRpcResponse<TResult>
    } finally {
      if (opened) await this.core.rpc('harness.api.transfer.close', { transferId }).catch(() => undefined)
    }
  }

  /** Answer an approval/question ServerRequest frame emitted on this connection. */
  async respond(frameRpcId: string, result: NativeRpcResult<unknown>): Promise<void> {
    const message: ClientResponseMessage = {
      type: 'client-response',
      rpcId: frameRpcId,
      result,
    }
    const receipt = await this.core.rpc<NativeRpcReceipt>('harness.api.respond', {
      message,
    } satisfies HarnessApiRespondParams)
    if (receipt.accepted === true) return
    if (receipt.reason === 'not-pending') {
      throw new ApiProxyError('PERMISSION_NOT_PENDING', 'That Host request was already answered or expired.')
    }
    throw new ApiProxyError('INVALID_MESSAGE', 'The Host rejected the response payload.')
  }

  async respondApproval(frameRpcId: string, sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    await this.respond(frameRpcId, { ok: true, value: { sessionId, approvalId, outcome } })
  }

  async respondQuestion(frameRpcId: string, sessionId: string, answer: AskUserQuestionAnswer): Promise<void> {
    await this.respond(frameRpcId, { ok: true, value: { sessionId, answer } })
  }

  /**
   * Open the aggregated mux stream and route `harness.api.frame` events for
   * this stream to the handler. Returns a close function; the stream is
   * re-opened after reconnect, so callers must re-subscribe on connect.
   */
  async openMuxStream(handler: (frame: MuxStreamFrame) => void): Promise<(notifyRemote?: boolean) => Promise<void>> {
    const streamId = createNativeRpcId()
    this.streams.set(streamId, handler)
    const unsubscribe = this.core.onEvent(event => this.routeEvent(event, streamId))
    try {
      await this.core.rpc('harness.api.stream.open', {
        streamId,
        stream: 'mux',
        rpcId: createNativeRpcId(),
        payload: {},
      } satisfies HarnessApiStreamOpenParams)
    } catch (error) {
      this.streams.delete(streamId)
      unsubscribe()
      throw error
    }
    return async (notifyRemote = true) => {
      this.streams.delete(streamId)
      unsubscribe()
      if (notifyRemote) await this.core.rpc('harness.api.stream.close', { streamId }).catch(() => undefined)
    }
  }

  async sessionList(): Promise<RemoteSession[]> {
    const result = await this.call<{ items: RemoteSession[] }>('session.list', {})
    return Array.isArray(result.items) ? result.items.map(normalizeSession) : []
  }

  async sessionCreate(workspaceId?: string, cwd?: string): Promise<{ sessionId: string }> {
    return this.call('session.create', workspaceId !== undefined
      ? { workspaceId }
      : cwd !== undefined
        ? { cwd }
        : {})
  }

  async sessionModels(sessionId: string): Promise<SessionModels> {
    const result = await this.call<SessionModels>('session.models', { sessionId })
    if (!Array.isArray(result.groups) || typeof result.current?.provider !== 'string' || typeof result.current?.model !== 'string') {
      throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an invalid model catalog.')
    }
    return result
  }

  async sessionSelectModel(sessionId: string, selection: ModelSelection): Promise<ModelSelection> {
    const result = await this.call<{ selected: ModelSelection }>('session.selectModel', {
      sessionId,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    })
    if (typeof result.selected?.provider !== 'string' || typeof result.selected?.model !== 'string') {
      throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an invalid model selection.')
    }
    return result.selected
  }

  async sessionSelectPermission(sessionId: string, preset: string): Promise<void> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset)) {
      throw new ApiProxyError('INVALID_MESSAGE', 'Harness returned an invalid permission preset.')
    }
    const execution = await this.call<{
      result: { kind: 'success' | 'error'; text?: string }
    } | undefined>('commands.execute', { agentId: sessionId, line: `/permission ${preset}`, images: [] })
    if (execution === undefined) throw new ApiProxyError('UNSUPPORTED', 'The Host does not provide the permission command.')
    if (execution.result.kind === 'error') throw new ApiProxyError('COMMAND_FAILED', execution.result.text ?? 'The Host rejected the permission preset.')
  }

  async sessionHistory(sessionId: string, beforeSeq?: number, maxMessages = 60): Promise<SessionHistoryPage> {
    const result = await this.call<{ events: HistoryEntry[]; hasMore: boolean }>('session.history', {
      sessionId,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      maxMessages,
    })
    return { events: Array.isArray(result.events) ? result.events : [], hasMore: result.hasMore === true }
  }

  async sessionPrompt(sessionId: string, text: string, rpcId = createNativeRpcId(), images: PromptImage[] = []): Promise<void> {
    await this.callWithRpcId('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [
        ...(text.length === 0 ? [] : [{ type: 'text' as const, text }]),
        ...images.map(image => ({
          type: 'image' as const,
          mediaType: image.mediaType,
          data: image.data,
          ...(image.name === undefined ? {} : { name: image.name }),
        })),
      ],
    }, rpcId)
  }

  async sessionCancel(sessionId: string): Promise<void> {
    await this.call('session.cancel', { sessionId })
  }

  async hostDescribe(): Promise<HostDescriptor> {
    const result = await this.call<HostDescriptor>('host.describe', {})
    if (typeof result.version !== 'string' || typeof result.cwd !== 'string') {
      throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an invalid host descriptor.')
    }
    return result
  }

  async hostListDirectory(path?: string): Promise<DirectoryListing> {
    const result = await this.call<DirectoryListing>('host.listDirectory', path === undefined ? {} : { path })
    if (typeof result.path !== 'string' || !Array.isArray(result.entries)) {
      throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an invalid directory listing.')
    }
    return result
  }

  async workspaceList(): Promise<WorkspaceList> {
    const result = await this.call<WorkspaceList>('workspace.list', {})
    return {
      items: Array.isArray(result.items) ? result.items : [],
      archivedSessionIds: Array.isArray(result.archivedSessionIds) ? result.archivedSessionIds : [],
    }
  }

  async workspaceCreate(path: string): Promise<{ workspace: WorkspaceView; created: boolean }> {
    const result = await this.call<{ workspace: WorkspaceView; created: boolean }>('workspace.create', { path })
    if (typeof result.workspace?.workspaceId !== 'string') {
      throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an invalid workspace.')
    }
    return result
  }

  async workspaceRename(workspaceId: string, title: string): Promise<WorkspaceView> {
    const result = await this.call<{ workspace: WorkspaceView }>('workspace.rename', { workspaceId, title })
    if (typeof result.workspace?.workspaceId !== 'string') {
      throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned an invalid workspace.')
    }
    return result.workspace
  }

  async workspaceDelete(workspaceId: string): Promise<void> {
    await this.call('workspace.delete', { workspaceId })
  }

  async workspaceArchiveSession(sessionId: string): Promise<string[]> {
    const result = await this.call<{ archivedSessionIds: string[] }>('workspace.archiveSession', { sessionId })
    return Array.isArray(result.archivedSessionIds) ? result.archivedSessionIds : []
  }

  async workspaceInsertBefore(workspaceId: string, beforeWorkspaceId?: string): Promise<string[]> {
    const result = await this.call<{ workspaceIds: string[] }>('workspace.insertBefore', {
      workspaceId,
      ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
    })
    return Array.isArray(result.workspaceIds) ? result.workspaceIds : []
  }

  private routeEvent(event: EventPayload, streamId: string): void {
    if (event.event === 'harness.api.frame') {
      const data = event.data as Partial<HarnessApiFrameData>
      if (data.streamId !== streamId || typeof data.frame?.rpcId !== 'string' || !isRecord(data.frame.payload)) {
        return
      }
      const handler = this.streams.get(streamId)
      if (handler !== undefined) handler({ rpcId: data.frame.rpcId, payload: normalizeMuxFrame(data.frame.payload as unknown as MuxFrame) })
      return
    }
    if (event.event === 'harness.api.stream.closed') {
      const data = event.data as Partial<HarnessApiStreamClosedData>
      if (data.streamId === streamId) {
        const handler = this.streams.get(streamId)
        this.streams.delete(streamId)
        handler?.({ rpcId: '', payload: { type: 'stream/closed', reason: data.reason } })
      }
    }
  }
}

export class ApiProxyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) { super(message) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSession(session: RemoteSession): RemoteSession {
  return {
    ...session,
    ...(session.agentPreset === undefined ? {} : { agentPreset: normalizeAgentPreset(session.agentPreset) as string }),
    ...(session.projections === undefined
      ? {}
      : {
          projections: {
            ...session.projections,
            ...(isRecord(session.projections.values)
              ? { values: normalizeProjectionValues(session.projections.values) }
              : {}),
          },
        }),
  }
}

function normalizeMuxFrame(frame: MuxFrame): MuxFrame {
  const record = frame as unknown as Record<string, unknown>
  if (frame.type === 'session/projection' && typeof record.key === 'string') {
    return { ...record, value: normalizeProjectionValue(record.key, record.value) } as unknown as MuxFrame
  }
  if (frame.type === 'host/session-added' && isRecord(record.session)) {
    return { ...record, session: normalizeSession(record.session as unknown as RemoteSession) } as unknown as MuxFrame
  }
  return frame
}

function normalizeProjectionValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, normalizeProjectionValue(key, value)]),
  )
}

function normalizeProjectionValue(key: string, value: unknown): unknown {
  return key === 'agentPreset' ? normalizeAgentPreset(value) : value
}

function normalizeAgentPreset(value: unknown): unknown {
  return value === LEGACY_AGENT_PRESET ? LEGACY_AGENT_PRESET_TARGET : value
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.byteLength)))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned malformed image-transfer data.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (bytesToBase64(bytes) !== value) {
    throw new ApiProxyError('INVALID_MESSAGE', 'The Host returned non-canonical image-transfer data.')
  }
  return bytes
}

export function createNativeRpcId(): string {
  const g = globalThis.crypto
  if (g?.randomUUID !== undefined) return g.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
