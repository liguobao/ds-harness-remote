import type {
  ApiProxy,
  ClientResponse,
  HostFrame,
  MuxFrame,
  RpcRequest,
  RpcResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RemoteClientError, type RemoteClientCore } from '@dsh-remote/client-core'
import {
  HARNESS_API_TRANSFER_CHUNK_BYTES,
  MAX_HARNESS_API_TRANSFER_BYTES,
  type EventPayload,
  type HarnessApiCallParams,
  type HarnessApiFrameData,
  type HarnessApiStreamClosedData,
  type HarnessApiTransferCommitResult,
  type HarnessApiTransferReadResult,
} from '@dsh-remote/protocol'
import { uuidV7 } from './ids.js'

type NativeRequest = RpcRequest<unknown>
type NativeResponse = RpcResponse<unknown>
type NativeCall = (request: NativeRequest, signal?: AbortSignal) => Promise<NativeResponse>

const DIRECT_API_CALL_BYTES = 2 * 1024 * 1024
const AGENT_PRESET_SETTINGS_NS = 'agent-presets'
const LEGACY_AGENT_PRESET_ALIASES: Record<string, string> = {
  code: 'ptc',
}

/** ApiProxy-compatible face that preserves the native Harness envelopes over Remote RPC. */
export class RemoteHarnessApiProxy {
  readonly api: ApiProxy

  constructor(private readonly client: RemoteClientCore) {
    const call = (method: string): NativeCall => (request, signal) => this.call(method, request, signal)
    this.api = {
      sessions: {
        list: call('session.list') as never,
        search: call('session.search') as never,
        create: call('session.create') as never,
        history: call('session.history') as never,
        models: call('session.models') as never,
        selectModel: call('session.selectModel') as never,
        rename: call('session.rename') as never,
        fork: call('session.fork') as never,
        prompt: call('session.prompt') as never,
        attachment: call('session.attachment') as never,
        updateQueue: call('session.updateQueue') as never,
        cancel: call('session.cancel') as never,
      },
      subagents: {
        list: call('subagent.list') as never,
        history: call('subagent.history') as never,
        prompt: call('subagent.prompt') as never,
        interrupt: call('subagent.interrupt') as never,
      },
      host: {
        describe: call('host.describe') as never,
        pickDirectory: call('host.pickDirectory') as never,
        listDirectory: call('host.listDirectory') as never,
        createDirectory: call('host.createDirectory') as never,
        openPath: call('host.openPath') as never,
      },
      workspace: {
        list: call('workspace.list') as never,
        create: call('workspace.create') as never,
        rename: call('workspace.rename') as never,
        delete: call('workspace.delete') as never,
        insertBefore: call('workspace.insertBefore') as never,
        insertSessionBefore: call('workspace.insertSessionBefore') as never,
        archiveSession: call('workspace.archiveSession') as never,
      },
      skills: { list: call('skill.list') as never },
      agentPresets: {
        list: call('agentPreset.list') as never,
        select: call('agentPreset.select') as never,
        read: call('agentPreset.read') as never,
        copy: call('agentPreset.copy') as never,
        openDocument: call('agentPreset.openDocument') as never,
        remove: call('agentPreset.remove') as never,
      },
      goals: {
        create: call('goal.create') as never,
        edit: call('goal.edit') as never,
        pause: call('goal.pause') as never,
        resume: call('goal.resume') as never,
        complete: call('goal.complete') as never,
        clear: call('goal.clear') as never,
      },
      settings: {
        describe: call('settings.describe') as never,
        openDocument: call('settings.openDocument') as never,
        update: call('settings.update') as never,
        replace: call('settings.replace') as never,
        mutate: call('settings.mutate') as never,
      },
      credentials: {
        describe: call('credentials.describe') as never,
        set: call('credentials.set') as never,
        unset: call('credentials.unset') as never,
      },
      llm: {
        providers: call('llm.providers') as never,
        models: call('llm.models') as never,
        discoverModels: call('llm.discoverModels') as never,
      },
      events: {
        mux: (request, signal) => this.stream<MuxFrame>('mux', request, signal),
        host: (request, signal) => this.stream<HostFrame>('host', request, signal),
      },
      downloads: {} as ApiProxy['downloads'],
      respond: message => this.respond(message),
    }
  }

  private async call(method: string, request: NativeRequest, signal?: AbortSignal): Promise<NativeResponse> {
    const params: HarnessApiCallParams = {
      method,
      rpcId: String(request.rpcId),
      payload: normalizeLegacyRequest(method, request.payload),
    }
    const encoded = new TextEncoder().encode(JSON.stringify(params))
    const response = method === 'session.attachment' || encoded.byteLength > DIRECT_API_CALL_BYTES
      ? await this.callTransferred(encoded, signal)
      : await this.client.rpc<NativeResponse>('harness.api.call', params, signal)
    if (String(response.rpcId) !== String(request.rpcId) || typeof response.result !== 'object' || response.result === null) {
      throw new Error('The remote Host returned an invalid Harness API response.')
    }
    return normalizeLegacyResponse(method, response)
  }

  private async callTransferred(
    encoded: Uint8Array,
    signal?: AbortSignal,
  ): Promise<NativeResponse> {
    if (encoded.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new Error('The Harness API request exceeds the remote image transfer limit.')
    }
    const transferId = uuidV7()
    const totalChunks = Math.ceil(encoded.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES)
    let opened = false
    try {
      await this.client.rpc('harness.api.transfer.open', {
        transferId,
        totalBytes: encoded.byteLength,
        totalChunks,
      }, signal)
      opened = true
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * HARNESS_API_TRANSFER_CHUNK_BYTES
        const chunk = encoded.subarray(start, Math.min(start + HARNESS_API_TRANSFER_CHUNK_BYTES, encoded.byteLength))
        await this.client.rpc('harness.api.transfer.chunk', {
          transferId,
          index,
          data: bytesToBase64(chunk),
        }, signal)
      }
      const committed = await this.client.rpc<HarnessApiTransferCommitResult>(
        'harness.api.transfer.commit',
        { transferId },
        signal,
      )
      if (committed.kind === 'inline') return committed.response as NativeResponse
      if (committed.transferId !== transferId
        || committed.totalBytes <= 0
        || committed.totalBytes > MAX_HARNESS_API_TRANSFER_BYTES
        || committed.totalChunks !== Math.ceil(committed.totalBytes / HARNESS_API_TRANSFER_CHUNK_BYTES)) {
        throw new Error('The remote Host returned an invalid Harness API transfer descriptor.')
      }
      const responseBytes = new Uint8Array(committed.totalBytes)
      let offset = 0
      for (let index = 0; index < committed.totalChunks; index += 1) {
        const result = await this.client.rpc<HarnessApiTransferReadResult>(
          'harness.api.transfer.read',
          { transferId, index },
          signal,
        )
        if (result.transferId !== transferId || result.index !== index) {
          throw new Error('The remote Host returned an out-of-order Harness API transfer chunk.')
        }
        const chunk = base64ToBytes(result.data)
        const expectedBytes = Math.min(HARNESS_API_TRANSFER_CHUNK_BYTES, committed.totalBytes - offset)
        if (chunk.byteLength !== expectedBytes) {
          throw new Error('The remote Host returned an invalid Harness API transfer chunk.')
        }
        responseBytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(responseBytes)) as NativeResponse
    } finally {
      if (opened) {
        await this.client.rpc('harness.api.transfer.close', { transferId }).catch(() => undefined)
      }
    }
  }

  private async respond(message: ClientResponse): Promise<Awaited<ReturnType<ApiProxy['respond']>>> {
    return this.client.rpc('harness.api.respond', { message }) as Promise<Awaited<ReturnType<ApiProxy['respond']>>>
  }

  private async *stream<TFrame extends MuxFrame | HostFrame>(
    stream: 'mux' | 'host',
    request: RpcRequest<unknown>,
    signal: AbortSignal,
  ): AsyncIterable<RpcRequest<TFrame>> {
    const streamId = uuidV7()
    const queue = new AsyncFrameQueue<TFrame>()
    const unsubscribe = this.client.onEvent(event => routeStreamEvent(event, streamId, queue))
    const unsubscribeClose = this.client.onClose(() => queue.close())
    const onAbort = () => queue.close()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      try {
        await this.client.rpc('harness.api.stream.open', {
          streamId,
          stream,
          rpcId: String(request.rpcId),
          payload: request.payload,
        }, signal)
        for await (const frame of queue) yield frame
      } catch (error) {
        // Native Harness event consumers treat a thrown stream iterator as a
        // fatal load failure. A remote disconnect is normal lifecycle here:
        // ClientModeRuntime has already switched ApiProxy back to local mode,
        // so finish this old iterator cleanly instead of terminating Harness.
        if (!isRemoteDisconnect(error)) throw error
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
      unsubscribeClose()
      queue.close()
      await this.client.rpc('harness.api.stream.close', { streamId }).catch(() => undefined)
    }
  }
}

/** RC7 host.describe did not include the home field made mandatory by RC8. */
function normalizeLegacyResponse(method: string, response: NativeResponse): NativeResponse {
  if (method !== 'host.describe' || !response.result.ok) return response
  const value = response.result.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return response
  const description = value as Record<string, unknown>
  if (typeof description.home === 'string' || typeof description.cwd !== 'string') return response
  return {
    ...response,
    result: {
      ...response.result,
      value: { ...description, home: description.cwd },
    },
  }
}

/** Older Remote Web clients persisted the pre-rc.1 coding preset id as `code`. */
function normalizeLegacyRequest(method: string, payload: unknown): unknown {
  if (!isRecord(payload)) return payload
  if (method === 'agentPreset.read') return replaceAgentPreset(payload, 'agentPreset')
  if (method === 'agentPreset.select') return replaceAgentPreset(payload, 'agentPreset')
  if (method === 'agentPreset.copy') return replaceAgentPreset(payload, 'from')
  if (method === 'settings.update' || method === 'settings.replace' || method === 'settings.mutate') {
    return replaceAgentPresetSettings(payload)
  }
  return payload
}

function replaceAgentPreset(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key]
  const replacement = typeof value === 'string' ? LEGACY_AGENT_PRESET_ALIASES[value] : undefined
  return replacement === undefined ? payload : { ...payload, [key]: replacement }
}

function replaceAgentPresetSettings(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.ns !== AGENT_PRESET_SETTINGS_NS || !isRecord(payload.patch)) return payload
  const patch = replaceAgentPreset(payload.patch, 'default')
  return patch === payload.patch ? payload : { ...payload, patch }
}

function isRemoteDisconnect(error: unknown): boolean {
  return error instanceof RemoteClientError
    && (error.code === 'TRANSPORT_CLOSED' || error.code === 'CLIENT_CLOSED')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class AsyncFrameQueue<TFrame> implements AsyncIterable<RpcRequest<TFrame>> {
  private readonly values: RpcRequest<TFrame>[] = []
  private readonly waiters: Array<(result: IteratorResult<RpcRequest<TFrame>>) => void> = []
  private closed = false

  push(value: RpcRequest<TFrame>): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.values.push(value)
    else waiter({ done: false, value })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RpcRequest<TFrame>> {
    while (true) {
      const value = this.values.shift()
      if (value !== undefined) {
        yield value
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<RpcRequest<TFrame>>>(resolve => this.waiters.push(resolve))
      if (next.done) return
      yield next.value
    }
  }
}

function routeStreamEvent<TFrame>(event: EventPayload, streamId: string, queue: AsyncFrameQueue<TFrame>): void {
  if (event.event === 'harness.api.frame') {
    const data = event.data as Partial<HarnessApiFrameData>
    if (data.streamId !== streamId || typeof data.frame !== 'object' || data.frame === null
      || typeof data.frame.rpcId !== 'string' || !('payload' in data.frame)) return
    queue.push(data.frame as RpcRequest<TFrame>)
  }
  if (event.event === 'harness.api.stream.closed') {
    const data = event.data as Partial<HarnessApiStreamClosedData>
    if (data.streamId === streamId) queue.close()
  }
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
    throw new Error('The remote Host returned a malformed Harness API transfer chunk.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (bytesToBase64(bytes) !== value) {
    throw new Error('The remote Host returned a non-canonical Harness API transfer chunk.')
  }
  return bytes
}
