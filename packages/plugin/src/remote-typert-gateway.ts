import { RemoteClientError, type RemoteClientCore } from '@dsh-remote/client-core'
import {
  HARNESS_API_TRANSFER_CHUNK_BYTES,
  MAX_HARNESS_API_TRANSFER_BYTES,
  type EventPayload,
  type HarnessApiTransferCommitResult,
  type HarnessApiTransferReadResult,
  type HarnessRemoteFrameData,
  type HarnessRemoteStreamClosedData,
} from '@dsh-remote/protocol'
import { uuidV7 } from './ids.js'
import {
  normalizeLegacySessionGatewayValue,
  type SessionFormatCompatibility,
} from './session-format-compat.js'
import type {
  RemoteTypertGatewayTarget,
  TypertGatewayRequest,
  TypertRpcResult,
} from './typert-gateway-contract.js'

const DIRECT_REMOTE_CALL_BYTES = 2 * 1024 * 1024

/** Client-side alpha Gateway carrier over the authenticated Remote channel. */
export class RemoteTypertGateway implements RemoteTypertGatewayTarget {
  constructor(
    private readonly client: RemoteClientCore,
    private readonly compatibility?: SessionFormatCompatibility,
  ) {}

  async invoke(request: TypertGatewayRequest): Promise<unknown> {
    const result = await this.dispatch(
      `${request.namespace}/${request.method}`,
      { args: request.args },
      request.signal ?? new AbortController().signal,
    )
    if (result.ok) return result.value
    throw remoteFailure(result.error)
  }

  async dispatch(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<TypertRpcResult> {
    const request = { endpoint, payload }
    const encoded = new TextEncoder().encode(JSON.stringify(request))
    let response: unknown
    if (encoded.byteLength > DIRECT_REMOTE_CALL_BYTES) {
      response = await this.callTransferred(encoded, signal)
    } else {
      try {
        response = await this.client.rpc<unknown>('harness.remote.call', request, signal)
      } catch (error) {
        if (!hasErrorCode(error, 'RESPONSE_TOO_LARGE')) throw error
        response = await this.callTransferred(encoded, signal)
      }
    }
    const result = parseRpcResult(response)
    if (result.ok && this.compatibility === 'legacy-to-v3') {
      return { ...result, value: normalizeLegacySessionGatewayValue(endpoint, result.value) }
    }
    return result
  }

  async open(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const streamId = uuidV7()
    const queue = new AsyncValueQueue()
    const unsubscribe = this.client.onEvent(event => routeStreamEvent(event, streamId, queue))
    const unsubscribeClose = this.client.onClose(() => {
      queue.fail(new RemoteClientError('TRANSPORT_CLOSED', 'The remote Harness stream transport closed.'))
    })
    const onAbort = () => queue.close()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await this.client.rpc('harness.remote.stream.open', { streamId, endpoint, payload }, signal)
    } catch (error) {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
      unsubscribeClose()
      throw error
    }
    return this.iterate(streamId, endpoint, queue, unsubscribe, unsubscribeClose, signal, onAbort)
  }

  private async *iterate(
    streamId: string,
    endpoint: string,
    queue: AsyncValueQueue,
    unsubscribe: () => void,
    unsubscribeClose: () => void,
    signal: AbortSignal,
    onAbort: () => void,
  ): AsyncGenerator<unknown> {
    try {
      for await (const value of queue) {
        yield this.compatibility === 'legacy-to-v3'
          ? normalizeLegacySessionGatewayValue(endpoint, value)
          : value
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
      unsubscribeClose()
      queue.close()
      await this.client.rpc('harness.remote.stream.close', { streamId }).catch(() => undefined)
    }
  }

  private async callTransferred(encoded: Uint8Array, signal: AbortSignal): Promise<unknown> {
    if (encoded.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new Error('The Harness Remote request exceeds the transfer limit.')
    }
    const transferId = uuidV7()
    const totalChunks = Math.ceil(encoded.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES)
    let opened = false
    try {
      await this.client.rpc('harness.remote.transfer.open', {
        transferId,
        totalBytes: encoded.byteLength,
        totalChunks,
      }, signal)
      opened = true
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * HARNESS_API_TRANSFER_CHUNK_BYTES
        const chunk = encoded.subarray(start, Math.min(start + HARNESS_API_TRANSFER_CHUNK_BYTES, encoded.byteLength))
        await this.client.rpc('harness.remote.transfer.chunk', {
          transferId,
          index,
          data: bytesToBase64(chunk),
        }, signal)
      }
      const committed = await this.client.rpc<HarnessApiTransferCommitResult>(
        'harness.remote.transfer.commit',
        { transferId },
        signal,
      )
      if (committed.kind === 'inline') return committed.response
      if (committed.transferId !== transferId
        || committed.totalBytes <= 0
        || committed.totalBytes > MAX_HARNESS_API_TRANSFER_BYTES
        || committed.totalChunks !== Math.ceil(committed.totalBytes / HARNESS_API_TRANSFER_CHUNK_BYTES)) {
        throw new Error('The remote Host returned an invalid Harness Remote transfer descriptor.')
      }
      const responseBytes = new Uint8Array(committed.totalBytes)
      let offset = 0
      for (let index = 0; index < committed.totalChunks; index += 1) {
        const result = await this.client.rpc<HarnessApiTransferReadResult>(
          'harness.remote.transfer.read',
          { transferId, index },
          signal,
        )
        if (result.transferId !== transferId || result.index !== index) {
          throw new Error('The remote Host returned an out-of-order Harness Remote transfer chunk.')
        }
        const chunk = base64ToBytes(result.data)
        const expectedBytes = Math.min(HARNESS_API_TRANSFER_CHUNK_BYTES, committed.totalBytes - offset)
        if (chunk.byteLength !== expectedBytes) {
          throw new Error('The remote Host returned an invalid Harness Remote transfer chunk.')
        }
        responseBytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(responseBytes)) as unknown
    } finally {
      if (opened) await this.client.rpc('harness.remote.transfer.close', { transferId }).catch(() => undefined)
    }
  }
}

class AsyncValueQueue implements AsyncIterable<unknown> {
  private readonly values: unknown[] = []
  private readonly waiters: Array<(result: IteratorResult<unknown>) => void> = []
  private closed = false
  private error?: Error

  push(value: unknown): void {
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

  fail(error: Error): void {
    if (this.closed) return
    this.error = error
    this.close()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift()
        continue
      }
      if (this.closed) {
        if (this.error !== undefined) throw this.error
        return
      }
      const next = await new Promise<IteratorResult<unknown>>(resolve => this.waiters.push(resolve))
      if (next.done) {
        if (this.error !== undefined) throw this.error
        return
      }
      yield next.value
    }
  }
}

function routeStreamEvent(event: EventPayload, streamId: string, queue: AsyncValueQueue): void {
  if (event.event === 'harness.remote.frame') {
    const data = event.data as Partial<HarnessRemoteFrameData>
    if (data.streamId === streamId && data.hasValue === true) queue.push(data.value)
    return
  }
  if (event.event !== 'harness.remote.stream.closed') return
  const data = event.data as Partial<HarnessRemoteStreamClosedData>
  if (data.streamId !== streamId) return
  if (data.reason === 'failed') {
    const failure = data.failure
    queue.fail(remoteFailure({
      code: typeof failure?.code === 'string' ? failure.code : 'internal',
      message: typeof failure?.message === 'string' ? failure.message : 'The remote Harness stream failed.',
      details: isRecord(failure?.details) ? failure.details : {},
    }))
  } else {
    queue.close()
  }
}

function parseRpcResult(value: unknown): TypertRpcResult {
  if (!isRecord(value)) throw new Error('The remote Host returned an invalid Gateway result.')
  if (value.ok === true) return Object.hasOwn(value, 'value') ? { ok: true, value: value.value } : { ok: true }
  if (value.ok !== false || !isRecord(value.error)
    || typeof value.error.code !== 'string'
    || typeof value.error.message !== 'string'
    || !isRecord(value.error.details)) {
    throw new Error('The remote Host returned an invalid Gateway failure.')
  }
  return {
    ok: false,
    error: { code: value.error.code, message: value.error.message, details: value.error.details },
  }
}

function remoteFailure(failure: { code: string; message: string; details: Record<string, unknown> }): Error {
  // v0.1.2-alpha.2+ identifies RemoteError values structurally across bundles and
  // realms. Keep this carrier dependency-free so the same build still runs on
  // older Harness releases, while preserving current stream failures at the local mux.
  return Object.assign(new Error(failure.message), {
    isDSHRemoteError: true as const,
    code: failure.code,
    details: failure.details,
  })
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
    throw new Error('The remote Host returned malformed Harness Remote transfer data.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (bytesToBase64(bytes) !== value) throw new Error('The remote Host returned non-canonical Harness Remote transfer data.')
  return bytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
