import { Buffer } from 'node:buffer'
import type {
  CursorAppFrameData,
  CursorAppStreamClosedData,
  CursorAppTransferChunkParams,
  CursorAppTransferCommitResult,
  CursorAppTransferOpenParams,
  CursorAppTransferReadParams,
  CursorAppTransferReadResult,
} from '@dsh-remote/protocol'
import {
  CURSOR_APP_TRANSFER_CHUNK_BYTES,
  MAX_CURSOR_APP_TRANSFER_BYTES,
  MAX_SECURE_MESSAGE_BYTES,
} from '@dsh-remote/protocol'
import { z } from 'zod'
import type { PeerConnectionContext } from '../connection-controller.js'
import type { SafeLogger } from '../logging.js'
import { RpcError } from '../safe-error.js'
import type { CursorRemoteDomain } from './domain.js'

export type PublishCursorFrame = (
  event: 'cursor.app.frame' | 'cursor.app.stream.closed',
  data: CursorAppFrameData | CursorAppStreamClosedData,
) => Promise<void>

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

const streamOpenSchema = z.object({
  streamId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(256),
}).strict()
const streamCloseSchema = z.object({ streamId: z.string().min(1).max(128) }).strict()
const transferOpenSchema = z.object({
  transferId: z.string().uuid(),
  totalBytes: z.number().int().positive().max(MAX_CURSOR_APP_TRANSFER_BYTES),
  totalChunks: z.number().int().positive(),
}).strict()
const transferChunkSchema = z.object({
  transferId: z.string().uuid(),
  index: z.number().int().nonnegative(),
  data: z.string().min(1).max(Math.ceil(CURSOR_APP_TRANSFER_CHUNK_BYTES / 3) * 4),
}).strict()
const transferIdSchema = z.object({ transferId: z.string().uuid() }).strict()
const transferReadSchema = z.object({ transferId: z.string().uuid(), index: z.number().int().nonnegative() }).strict()

const MAX_ACTIVE_STREAMS = 16
const MAX_ACTIVE_TRANSFERS = 2
const TRANSFER_IDLE_MS = 2 * 60_000
const INLINE_TRANSFER_RESPONSE_BYTES = 2 * 1024 * 1024

/** Per-authenticated-connection state for the Cursor Remote domain. */
export class CursorPeerBridge {
  private readonly streams = new Map<string, string>()
  private readonly incomingTransfers = new Map<string, IncomingTransfer>()
  private readonly outgoingTransfers = new Map<string, OutgoingTransfer>()
  private closed = false

  constructor(
    private readonly domain: CursorRemoteDomain,
    private readonly context: PeerConnectionContext,
    private readonly publish: PublishCursorFrame,
    private readonly logger?: SafeLogger,
  ) {}

  async call(input: unknown): Promise<unknown> {
    return this.callDomain(input, true)
  }

  private async callDomain(input: unknown, logFailure: boolean): Promise<unknown> {
    this.requireOpen()
    try {
      return await this.domain.call(this.context.connectionId, input)
    } catch (error) {
      if (logFailure) {
        this.logger?.warn('Cursor call failed', {
          method: safeMethod(input),
          code: safeErrorCode(error),
        })
      }
      throw error
    }
  }

  respond(input: unknown): Promise<{ resolved: true }> {
    this.requireOpen()
    return this.domain.respond(this.context.connectionId, input)
  }

  async openStream(input: unknown): Promise<{ opened: true; streamId: string; sessionId: string }> {
    this.requireOpen()
    const params = streamOpenSchema.parse(input)
    if (this.streams.has(params.streamId)) throw new RpcError('REQUEST_CONFLICT', 'The Cursor stream id is already active.')
    if (this.streams.size >= MAX_ACTIVE_STREAMS) {
      throw new RpcError('RATE_LIMITED', 'Too many Cursor streams are active for this connection.', undefined, true)
    }
    this.domain.assertStreamable(this.context.connectionId, params.sessionId)
    this.streams.set(params.streamId, params.sessionId)
    return { opened: true, streamId: params.streamId, sessionId: params.sessionId }
  }

  closeStream(input: unknown): { closed: true; streamId: string } {
    const params = streamCloseSchema.parse(input)
    this.streams.delete(params.streamId)
    return { closed: true, streamId: params.streamId }
  }

  openTransfer(input: unknown): { opened: true; transferId: string } {
    this.requireOpen()
    this.pruneTransfers()
    const params = transferOpenSchema.parse(input) as CursorAppTransferOpenParams
    if (params.totalChunks !== Math.ceil(params.totalBytes / CURSOR_APP_TRANSFER_CHUNK_BYTES)) {
      throw new RpcError('INVALID_MESSAGE', 'The Cursor transfer chunk count is invalid.')
    }
    if (this.incomingTransfers.has(params.transferId) || this.outgoingTransfers.has(params.transferId)) {
      throw new RpcError('REQUEST_CONFLICT', 'The Cursor transfer id is already active.')
    }
    if (this.incomingTransfers.size >= MAX_ACTIVE_TRANSFERS) {
      throw new RpcError('RATE_LIMITED', 'Too many Cursor transfers are active.', undefined, true)
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
    this.requireOpen()
    this.pruneTransfers()
    const params = transferChunkSchema.parse(input) as CursorAppTransferChunkParams
    const transfer = this.incomingTransfers.get(params.transferId)
    if (transfer === undefined) throw new RpcError('TRANSFER_NOT_FOUND', 'The Cursor transfer is not active.')
    if (params.index !== transfer.chunks.length || params.index >= transfer.totalChunks) {
      this.incomingTransfers.delete(params.transferId)
      throw new RpcError('INVALID_MESSAGE', 'Cursor transfer chunks must arrive exactly once and in order.')
    }
    const chunk = decodeCanonicalBase64(params.data)
    const expectedBytes = Math.min(
      CURSOR_APP_TRANSFER_CHUNK_BYTES,
      transfer.totalBytes - params.index * CURSOR_APP_TRANSFER_CHUNK_BYTES,
    )
    if (chunk.byteLength !== expectedBytes) {
      this.incomingTransfers.delete(params.transferId)
      throw new RpcError('INVALID_MESSAGE', 'The Cursor transfer chunk size is invalid.')
    }
    transfer.chunks.push(chunk)
    transfer.receivedBytes += chunk.byteLength
    transfer.touchedAt = Date.now()
    return { accepted: true, transferId: params.transferId, index: params.index }
  }

  async commitTransfer(input: unknown): Promise<CursorAppTransferCommitResult> {
    this.requireOpen()
    this.pruneTransfers()
    const params = transferIdSchema.parse(input)
    const transfer = this.incomingTransfers.get(params.transferId)
    if (transfer === undefined) throw new RpcError('TRANSFER_NOT_FOUND', 'The Cursor transfer is not active.')
    this.incomingTransfers.delete(params.transferId)
    if (transfer.chunks.length !== transfer.totalChunks || transfer.receivedBytes !== transfer.totalBytes) {
      throw new RpcError('INVALID_MESSAGE', 'The Cursor transfer is incomplete.')
    }
    let request: unknown
    try {
      request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(concatChunks(transfer.chunks, transfer.totalBytes)))
    } catch {
      throw new RpcError('INVALID_MESSAGE', 'The Cursor transfer does not contain a valid request.')
    }
    let response: unknown
    try {
      response = await this.callDomain(request, false)
    } catch (error) {
      this.logger?.warn('Cursor transfer call failed', {
        method: safeMethod(request),
        code: safeErrorCode(error),
      })
      throw error
    }
    const responseBytes = new TextEncoder().encode(JSON.stringify(response))
    if (responseBytes.byteLength <= INLINE_TRANSFER_RESPONSE_BYTES) return { kind: 'inline', response }
    if (responseBytes.byteLength > MAX_CURSOR_APP_TRANSFER_BYTES) {
      throw new RpcError('RESPONSE_TOO_LARGE', 'The Cursor response exceeds the bounded transfer limit.')
    }
    if (this.outgoingTransfers.size >= MAX_ACTIVE_TRANSFERS) {
      throw new RpcError('RATE_LIMITED', 'Too many Cursor response transfers are active.', undefined, true)
    }
    const totalChunks = Math.ceil(responseBytes.byteLength / CURSOR_APP_TRANSFER_CHUNK_BYTES)
    this.outgoingTransfers.set(params.transferId, {
      bytes: responseBytes,
      totalChunks,
      nextIndex: 0,
      touchedAt: Date.now(),
    })
    return { kind: 'chunked', transferId: params.transferId, totalBytes: responseBytes.byteLength, totalChunks }
  }

  readTransfer(input: unknown): CursorAppTransferReadResult {
    this.requireOpen()
    this.pruneTransfers()
    const params = transferReadSchema.parse(input) as CursorAppTransferReadParams
    const transfer = this.outgoingTransfers.get(params.transferId)
    if (transfer === undefined) throw new RpcError('TRANSFER_NOT_FOUND', 'The Cursor response transfer is not active.')
    if (params.index !== transfer.nextIndex || params.index >= transfer.totalChunks) {
      this.outgoingTransfers.delete(params.transferId)
      throw new RpcError('INVALID_MESSAGE', 'Cursor response chunks must be read exactly once and in order.')
    }
    const start = params.index * CURSOR_APP_TRANSFER_CHUNK_BYTES
    const end = Math.min(start + CURSOR_APP_TRANSFER_CHUNK_BYTES, transfer.bytes.byteLength)
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

  async publishInbound(sessionId: string, frame: { method: string; params: unknown }): Promise<void> {
    if (this.closed) return
    const streamIds = [...this.streams.entries()]
      .filter(([, targetSessionId]) => targetSessionId === sessionId)
      .map(([streamId]) => streamId)
    for (const streamId of streamIds) {
      const data: CursorAppFrameData = { streamId, frame }
      if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_SECURE_MESSAGE_BYTES) {
        this.streams.delete(streamId)
        await this.publish('cursor.app.stream.closed', { streamId, reason: 'failed' })
        this.logger?.warn('Cursor stream closed after oversized frame', { streamId })
        continue
      }
      await this.publish('cursor.app.frame', data)
    }
  }

  async failStreams(reason: CursorAppStreamClosedData['reason'] = 'failed'): Promise<void> {
    if (this.closed) return
    const streamIds = [...this.streams.keys()]
    this.streams.clear()
    this.incomingTransfers.clear()
    this.outgoingTransfers.clear()
    await Promise.all(streamIds.map(streamId => this.publish('cursor.app.stream.closed', {
      streamId,
      reason,
    }).catch(() => undefined)))
  }

  async closeAll(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const streamIds = [...this.streams.keys()]
    this.streams.clear()
    this.incomingTransfers.clear()
    this.outgoingTransfers.clear()
    await Promise.all(streamIds.map(streamId => this.publish('cursor.app.stream.closed', {
      streamId,
      reason: 'peer-disconnected',
    }).catch(() => undefined)))
    this.domain.dropPeer(this.context.connectionId)
  }

  private pruneTransfers(): void {
    const staleBefore = Date.now() - TRANSFER_IDLE_MS
    for (const [id, transfer] of this.incomingTransfers) {
      if (transfer.touchedAt < staleBefore) this.incomingTransfers.delete(id)
    }
    for (const [id, transfer] of this.outgoingTransfers) {
      if (transfer.touchedAt < staleBefore) this.outgoingTransfers.delete(id)
    }
  }

  private requireOpen(): void {
    if (this.closed) throw new RpcError('CURSOR_CONNECTION_CLOSED', 'The Cursor connection is closed.')
  }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new RpcError('INVALID_MESSAGE', 'The Cursor transfer chunk is not canonical base64.')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new RpcError('INVALID_MESSAGE', 'The Cursor transfer chunk is not canonical base64.')
  }
  return decoded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string') return error.code
  return 'UNKNOWN'
}

function safeMethod(input: unknown): string {
  return isRecord(input) && typeof input.method === 'string' ? input.method : 'invalid'
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
