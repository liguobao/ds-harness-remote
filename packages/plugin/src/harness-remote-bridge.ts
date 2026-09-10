import type {
  HarnessApiTransferChunkParams,
  HarnessApiTransferCommitResult,
  HarnessApiTransferOpenParams,
  HarnessApiTransferReadParams,
  HarnessApiTransferReadResult,
  HarnessRemoteCallParams,
  HarnessRemoteFrameData,
  HarnessRemoteStreamClosedData,
  HarnessRemoteStreamOpenParams,
} from '@dsh-remote/protocol'
import {
  HARNESS_API_TRANSFER_CHUNK_BYTES,
  MAX_ACTIVE_TRANSFERS_PER_DIRECTION,
  MAX_ALPHA_STREAMS_PER_CONNECTION,
  MAX_HARNESS_API_TRANSFER_BYTES,
  TRANSFER_IDLE_MS,
} from '@dsh-remote/protocol'
import { z } from 'zod'
import type { SafeLogger } from './logging.js'
import { listRemoteDirectory } from './remote-directory-browser.js'
import { RpcError } from './rpc-router.js'
import type { LocalTypertGateway, TypertRpcResult } from './typert-gateway-contract.js'

type PublishRemoteFrame = (
  event: 'harness.remote.frame' | 'harness.remote.stream.closed',
  data: HarnessRemoteFrameData | HarnessRemoteStreamClosedData,
) => Promise<void>

interface ActiveRemoteStream {
  controller: AbortController
}

interface IncomingTransfer {
  totalBytes: number
  totalChunks: number
  chunks: Uint8Array[]
  receivedBytes: number
  touchedAt: number
}

interface OutgoingTransfer {
  bytes: Uint8Array
  totalChunks: number
  nextIndex: number
  touchedAt: number
}

const endpointSchema = z.string().min(1).max(128).regex(/^(?:\$events(?:\/result)?|[A-Za-z0-9_$.-]+\/[A-Za-z0-9_$.-]+)$/)
const callSchema = z.object({ endpoint: endpointSchema, payload: z.unknown() }).strict()
const streamOpenSchema = z.object({
  streamId: z.string().min(1).max(128),
  endpoint: endpointSchema,
  payload: z.unknown(),
}).strict()
const streamCloseSchema = z.object({ streamId: z.string().min(1).max(128) }).strict()
const transferOpenSchema = z.object({
  transferId: z.string().uuid(),
  totalBytes: z.number().int().positive().max(MAX_HARNESS_API_TRANSFER_BYTES),
  totalChunks: z.number().int().positive(),
}).strict()
const transferChunkSchema = z.object({
  transferId: z.string().uuid(),
  index: z.number().int().nonnegative(),
  data: z.string().min(1),
}).strict()
const transferIdSchema = z.object({ transferId: z.string().uuid() }).strict()
const transferReadSchema = z.object({
  transferId: z.string().uuid(),
  index: z.number().int().nonnegative(),
}).strict()
const directoryListSchema = z.object({
  path: z.string().min(1).max(4096).optional(),
}).strict()

const MAX_ACTIVE_STREAMS = MAX_ALPHA_STREAMS_PER_CONNECTION
const MAX_ACTIVE_TRANSFERS = MAX_ACTIVE_TRANSFERS_PER_DIRECTION
const INLINE_TRANSFER_RESPONSE_BYTES = 2 * 1024 * 1024

/** Fixed v0.1.2 Typert Remote subset exposed to authenticated peers. */
export const HARNESS_REMOTE_ALLOWLIST = [
  '$events',
  '$events/result',
  'agentPresets/list',
  'agentPresets/read',
  'agentPresets/select',
  'commands/execute',
  'commands/list',
  'credentials/describe',
  'credentials/set',
  'credentials/unset',
  'directoryPicker/list',
  'fileReferences/list',
  'goals/clear',
  'goals/complete',
  'goals/create',
  'goals/edit',
  'goals/pause',
  'goals/resume',
  'llm/discoverModels',
  'llm/listConfigurableProviders',
  'llm/listProviders',
  'messageFeedback/delete',
  'messageFeedback/list',
  'messageFeedback/put',
  'pluginInventory/list',
  'session/attachment',
  'session/cancel',
  'session/canOpenWorkspacePath',
  'session/control',
  'session/create',
  'session/follow',
  'session/fork',
  'session/list',
  'session/modelCatalog',
  'session/page',
  'session/prompt',
  'session/rename',
  'session/search',
  'session/selectModel',
  'session/updateQueue',
  'sessionReferenceResolver/candidates',
  'settings/describe',
  'settings/mutate',
  'settings/replace',
  'settings/update',
  'skills/list',
  'subagents/interruptByParent',
  'subagents/list',
  'subagents/prompt',
  'workspace/archiveSession',
  'workspace/create',
  'workspace/delete',
  'workspace/follow',
  'workspace/insertBefore',
  'workspace/insertSessionBefore',
  'workspace/rename',
] as const

const allowedEndpoints = new Set<string>(HARNESS_REMOTE_ALLOWLIST)

/** Host-side adapter from the encrypted peer channel to the official alpha Gateway carrier. */
export class HarnessRemoteBridge {
  private readonly streams = new Map<string, ActiveRemoteStream>()
  private readonly incomingTransfers = new Map<string, IncomingTransfer>()
  private readonly outgoingTransfers = new Map<string, OutgoingTransfer>()

  constructor(
    private readonly gateway: LocalTypertGateway,
    private readonly publish: PublishRemoteFrame,
    private readonly logger?: SafeLogger,
  ) {}

  async call(input: unknown): Promise<TypertRpcResult> {
    const params = callSchema.parse(input) as HarnessRemoteCallParams
    this.assertAllowed(params.endpoint)
    if (params.endpoint === 'session/canOpenWorkspacePath') {
      return { ok: true, value: true }
    }
    const startedAt = performance.now()
    const signal = AbortSignal.timeout(60_000)
    try {
      const nativeResult = await this.gateway.dispatch(params.endpoint, params.payload, signal)
      const result = params.endpoint === 'directoryPicker/list' && needsDirectoryFallback(nativeResult)
        ? await this.directoryList(params.payload, signal)
        : nativeResult
      this.logger?.debug('harness remote call ok', {
        endpoint: params.endpoint,
        durationMs: Math.round(performance.now() - startedAt),
      })
      return result
    } catch (error) {
      if (params.endpoint === 'directoryPicker/list') {
        const result = await this.directoryList(params.payload, signal)
        this.logger?.debug('harness remote call ok', {
          endpoint: params.endpoint,
          durationMs: Math.round(performance.now() - startedAt),
          fallback: 'directory-browser',
        })
        return result
      }
      this.logger?.warn('harness remote call failed', {
        endpoint: params.endpoint,
        durationMs: Math.round(performance.now() - startedAt),
        code: this.gateway.failure(error).code,
      })
      throw error
    }
  }

  private async directoryList(payload: unknown, signal: AbortSignal): Promise<TypertRpcResult> {
    const args = requestArgs(payload)
    const params = directoryListSchema.parse(args)
    return { ok: true, value: await listRemoteDirectory(params.path, signal) }
  }

  openTransfer(input: unknown): { opened: true; transferId: string } {
    this.pruneTransfers()
    const params = transferOpenSchema.parse(input) as HarnessApiTransferOpenParams
    if (params.totalChunks !== Math.ceil(params.totalBytes / HARNESS_API_TRANSFER_CHUNK_BYTES)) {
      throw new RpcError('INVALID_MESSAGE', 'The Harness Remote transfer chunk count is invalid.')
    }
    if (this.incomingTransfers.has(params.transferId) || this.outgoingTransfers.has(params.transferId)) {
      throw new RpcError('REQUEST_CONFLICT', 'The Harness Remote transfer id is already active.')
    }
    if (this.incomingTransfers.size >= MAX_ACTIVE_TRANSFERS) {
      throw new RpcError('RATE_LIMITED', 'Too many Harness Remote transfers are active.', undefined, true)
    }
    this.incomingTransfers.set(params.transferId, {
      totalBytes: params.totalBytes,
      totalChunks: params.totalChunks,
      chunks: [],
      receivedBytes: 0,
      touchedAt: Date.now(),
    })
    return { opened: true, transferId: params.transferId }
  }

  appendTransfer(input: unknown): { accepted: true; transferId: string; index: number } {
    this.pruneTransfers()
    const params = transferChunkSchema.parse(input) as HarnessApiTransferChunkParams
    const transfer = this.incomingTransfers.get(params.transferId)
    if (transfer === undefined) throw new RpcError('TRANSFER_NOT_FOUND', 'The Harness Remote transfer is not active.')
    if (params.index !== transfer.chunks.length || params.index >= transfer.totalChunks) {
      this.incomingTransfers.delete(params.transferId)
      throw new RpcError('INVALID_MESSAGE', 'Harness Remote transfer chunks must arrive exactly once and in order.')
    }
    const chunk = decodeCanonicalBase64(params.data)
    const expectedBytes = Math.min(
      HARNESS_API_TRANSFER_CHUNK_BYTES,
      transfer.totalBytes - params.index * HARNESS_API_TRANSFER_CHUNK_BYTES,
    )
    if (chunk.byteLength !== expectedBytes) {
      this.incomingTransfers.delete(params.transferId)
      throw new RpcError('INVALID_MESSAGE', 'The Harness Remote transfer chunk size is invalid.')
    }
    transfer.chunks.push(chunk)
    transfer.receivedBytes += chunk.byteLength
    transfer.touchedAt = Date.now()
    return { accepted: true, transferId: params.transferId, index: params.index }
  }

  async commitTransfer(input: unknown): Promise<HarnessApiTransferCommitResult> {
    this.pruneTransfers()
    const params = transferIdSchema.parse(input)
    const transfer = this.incomingTransfers.get(params.transferId)
    if (transfer === undefined) throw new RpcError('TRANSFER_NOT_FOUND', 'The Harness Remote transfer is not active.')
    this.incomingTransfers.delete(params.transferId)
    if (transfer.chunks.length !== transfer.totalChunks || transfer.receivedBytes !== transfer.totalBytes) {
      throw new RpcError('INVALID_MESSAGE', 'The Harness Remote transfer is incomplete.')
    }
    let request: unknown
    try {
      request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(concatChunks(transfer.chunks, transfer.totalBytes)))
    } catch {
      throw new RpcError('INVALID_MESSAGE', 'The Harness Remote transfer does not contain a valid request.')
    }
    const response = await this.call(callSchema.parse(request))
    const responseBytes = new TextEncoder().encode(JSON.stringify(response))
    if (responseBytes.byteLength <= INLINE_TRANSFER_RESPONSE_BYTES) return { kind: 'inline', response }
    if (responseBytes.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new RpcError('RESPONSE_TOO_LARGE', 'The Harness Remote response exceeds the bounded transfer limit.')
    }
    if (this.outgoingTransfers.size >= MAX_ACTIVE_TRANSFERS) {
      throw new RpcError('RATE_LIMITED', 'Too many Harness Remote response transfers are active.', undefined, true)
    }
    const totalChunks = Math.ceil(responseBytes.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES)
    this.outgoingTransfers.set(params.transferId, {
      bytes: responseBytes,
      totalChunks,
      nextIndex: 0,
      touchedAt: Date.now(),
    })
    return { kind: 'chunked', transferId: params.transferId, totalBytes: responseBytes.byteLength, totalChunks }
  }

  readTransfer(input: unknown): HarnessApiTransferReadResult {
    this.pruneTransfers()
    const params = transferReadSchema.parse(input) as HarnessApiTransferReadParams
    const transfer = this.outgoingTransfers.get(params.transferId)
    if (transfer === undefined) throw new RpcError('TRANSFER_NOT_FOUND', 'The Harness Remote response transfer is not active.')
    if (params.index !== transfer.nextIndex || params.index >= transfer.totalChunks) {
      this.outgoingTransfers.delete(params.transferId)
      throw new RpcError('INVALID_MESSAGE', 'Harness Remote response chunks must be read exactly once and in order.')
    }
    const start = params.index * HARNESS_API_TRANSFER_CHUNK_BYTES
    const end = Math.min(start + HARNESS_API_TRANSFER_CHUNK_BYTES, transfer.bytes.byteLength)
    transfer.nextIndex += 1
    transfer.touchedAt = Date.now()
    return {
      transferId: params.transferId,
      index: params.index,
      data: Buffer.from(transfer.bytes.subarray(start, end)).toString('base64'),
    }
  }

  closeTransfer(input: unknown): { closed: boolean; transferId: string } {
    const params = transferIdSchema.parse(input)
    const closed = this.incomingTransfers.delete(params.transferId) || this.outgoingTransfers.delete(params.transferId)
    return { closed, transferId: params.transferId }
  }

  async openStream(input: unknown): Promise<{ opened: true; streamId: string }> {
    const params = streamOpenSchema.parse(input) as HarnessRemoteStreamOpenParams
    this.assertAllowed(params.endpoint)
    if (this.streams.has(params.streamId)) throw new RpcError('REQUEST_CONFLICT', 'The Harness Remote stream is already open.')
    if (this.streams.size >= MAX_ACTIVE_STREAMS) {
      throw new RpcError('RATE_LIMITED', 'Too many Harness Remote streams are open.', undefined, true)
    }
    const controller = new AbortController()
    const source = await this.gateway.open(params.endpoint, params.payload, controller.signal)
    this.streams.set(params.streamId, { controller })
    void this.pump(params.streamId, source, controller.signal)
    return { opened: true, streamId: params.streamId }
  }

  closeStream(input: unknown): { closed: boolean; streamId: string } {
    const params = streamCloseSchema.parse(input)
    const active = this.streams.get(params.streamId)
    if (active !== undefined) {
      this.streams.delete(params.streamId)
      active.controller.abort('client-closed')
    }
    return { closed: active !== undefined, streamId: params.streamId }
  }

  async closeAll(reason: HarnessRemoteStreamClosedData['reason'] = 'peer-disconnected'): Promise<void> {
    const streams = [...this.streams.entries()]
    this.streams.clear()
    this.incomingTransfers.clear()
    this.outgoingTransfers.clear()
    for (const [, stream] of streams) stream.controller.abort(reason)
  }

  private assertAllowed(endpoint: string): void {
    if (!allowedEndpoints.has(endpoint)) {
      throw new RpcError('METHOD_NOT_ALLOWED', 'The requested Harness Remote endpoint is not allowed.')
    }
    if (endpoint === '$events' && !this.gateway.supportsCarrier) {
      throw new RpcError('FEATURE_NOT_SUPPORTED', 'This Harness version does not support Remote event transport.')
    }
  }

  private async pump(streamId: string, source: AsyncIterable<unknown>, signal: AbortSignal): Promise<void> {
    let reason: HarnessRemoteStreamClosedData['reason'] = 'completed'
    let failure: HarnessRemoteStreamClosedData['failure']
    try {
      for await (const value of source) {
        if (signal.aborted) break
        await this.publish('harness.remote.frame', {
          streamId,
          hasValue: true,
          ...(value === undefined ? {} : { value }),
        })
      }
      if (signal.aborted) reason = 'cancelled'
    } catch (error) {
      reason = signal.aborted ? 'cancelled' : 'failed'
      if (!signal.aborted) failure = this.gateway.failure(error)
    } finally {
      this.streams.delete(streamId)
      await this.publish('harness.remote.stream.closed', {
        streamId,
        reason,
        ...(failure === undefined ? {} : { failure }),
      }).catch(() => undefined)
    }
  }

  private pruneTransfers(): void {
    const cutoff = Date.now() - TRANSFER_IDLE_MS
    for (const [id, transfer] of this.incomingTransfers) if (transfer.touchedAt < cutoff) this.incomingTransfers.delete(id)
    for (const [id, transfer] of this.outgoingTransfers) if (transfer.touchedAt < cutoff) this.outgoingTransfers.delete(id)
  }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new RpcError('INVALID_MESSAGE', 'The Harness Remote transfer chunk is invalid.')
  return bytes
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function needsDirectoryFallback(result: TypertRpcResult): boolean {
  if (result.ok) return false
  const code = result.error.code.toLocaleLowerCase()
  const message = result.error.message.toLocaleLowerCase()
  return code.includes('capability')
    || code === 'directory-picker/unavailable'
    || code === 'directory-picker-unavailable'
    || message.includes('browse capability')
    || message.includes('browser capability')
    || message.includes('brower capability')
    || message.includes('directory-picker-unavailable')
}

function requestArgs(payload: unknown): Record<string, unknown> {
  const root = record(payload)
  const args = isRecord(root.args) ? root.args : root
  return record(args.request ?? args._request ?? args)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
