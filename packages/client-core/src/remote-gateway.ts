import {
  HARNESS_API_TRANSFER_CHUNK_BYTES,
  MAX_HARNESS_API_TRANSFER_BYTES,
  type EventPayload,
  type HarnessRemoteFrameData,
  type HarnessRemoteStreamClosedData,
  type HarnessTransportDescription,
  type HarnessApiTransferCommitResult,
  type HarnessApiTransferReadResult,
} from '@dsh-remote/protocol'
import type { RemoteClientCore } from './index.js'

const DIRECT_REMOTE_CALL_BYTES = 2 * 1024 * 1024
const REMOTE_COMMAND_LIST_MIN_VERSION = [0, 3, 16] as const
const REMOTE_FILE_VIEWER_MIN_VERSION = [0, 3, 17] as const

export interface RemoteHostFeatures {
  commandList: boolean
  fileViewer: boolean
  apiProxy: boolean
  apiTransfer: boolean
  remoteGateway: boolean
  sessionFormat?: 3
  remoteTransfer: boolean
  capabilities: readonly string[]
}

export interface RemoteGatewayFailure {
  code: string
  message: string
  details: Record<string, unknown>
}

export type RemoteGatewayResult<T = unknown> =
  | { ok: true; value?: T }
  | { ok: false; error: RemoteGatewayFailure }

export interface RemoteGatewayStream extends AsyncIterable<unknown> {
  close(notifyRemote?: boolean): Promise<void>
}

export interface TypertGatewayRequest {
  namespace: string
  method: string
  args: Readonly<Record<string, unknown>>
  signal?: AbortSignal
}

export class RemoteGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RemoteGatewayError'
  }
}

/** Conservative feature profile for Hosts that predate capability discovery. */
export function remoteHostFeatures(clientVersion?: string): RemoteHostFeatures {
  return {
    commandList: isVersionAtLeast(clientVersion, REMOTE_COMMAND_LIST_MIN_VERSION),
    fileViewer: isVersionAtLeast(clientVersion, REMOTE_FILE_VIEWER_MIN_VERSION),
    apiProxy: true,
    apiTransfer: true,
    remoteGateway: false,
    remoteTransfer: false,
    capabilities: ['harness.api.v1'],
  }
}

export async function probeRemoteHostFeatures(
  client: RemoteClientCore,
  clientVersion?: string,
): Promise<RemoteHostFeatures> {
  const fallback = remoteHostFeatures(clientVersion)
  let value: unknown
  try {
    value = await client.rpc('harness.transport.describe', {})
  } catch (error) {
    if (hasErrorCode(error, 'METHOD_NOT_FOUND')) return fallback
    throw error
  }
  if (!isRecord(value) || !Array.isArray(value.capabilities)
    || value.capabilities.some(capability => typeof capability !== 'string')) {
    throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned invalid transport capabilities.')
  }
  const description = value as unknown as HarnessTransportDescription
  const capabilities = new Set(description.capabilities)
  const apiProxy = capabilities.has('harness.api.v1')
  const remoteV1 = capabilities.has('harness.remote.v1')
  const remoteV3 = capabilities.has('harness.remote.v3')
  if (remoteV1 && remoteV3) {
    throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host advertised conflicting Harness Session formats.')
  }
  const sessionFormat = remoteV3 ? 3 as const : undefined
  const remoteGateway = remoteV3 || remoteV1
  if (!apiProxy && !remoteGateway) {
    throw new RemoteGatewayError('FEATURE_NOT_SUPPORTED', 'The remote Host exposes no supported Harness transport.')
  }
  return {
    commandList: remoteGateway || (apiProxy && fallback.commandList),
    fileViewer: capabilities.has('fileviewer.read.v1'),
    apiProxy,
    apiTransfer: capabilities.has('harness.api.transfer.v1') || apiProxy,
    remoteGateway,
    ...(sessionFormat === undefined ? {} : { sessionFormat }),
    remoteTransfer: capabilities.has('harness.remote.transfer.v1'),
    capabilities: description.capabilities,
  }
}

/** Client-side alpha Gateway carrier over the authenticated Remote channel. */
export class RemoteTypertGateway {
  constructor(private readonly client: RemoteClientCore) {}

  async invoke(request: TypertGatewayRequest): Promise<unknown> {
    const result = await this.dispatch(
      `${request.namespace}/${request.method}`,
      { args: request.args },
      request.signal,
    )
    if (result.ok) return result.value
    throw remoteFailure(result.error)
  }

  async call<T = unknown>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const result = await this.dispatch<T>(endpoint, payload, signal)
    if (result.ok) return result.value as T
    throw remoteFailure(result.error)
  }

  async dispatch<T = unknown>(
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RemoteGatewayResult<T>> {
    const request = { endpoint, payload }
    const encoded = new TextEncoder().encode(JSON.stringify(request))
    let response: unknown
    const activeSignal = signal ?? new AbortController().signal
    if (encoded.byteLength > DIRECT_REMOTE_CALL_BYTES) {
      response = await this.callTransferred(encoded, activeSignal)
    } else {
      try {
        response = await this.client.rpc<unknown>('harness.remote.call', request, activeSignal)
      } catch (error) {
        if (!hasErrorCode(error, 'RESPONSE_TOO_LARGE')) throw error
        response = await this.callTransferred(encoded, activeSignal)
      }
    }
    return parseRpcResult<T>(response)
  }

  async open(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RemoteGatewayStream> {
    const activeSignal = signal ?? new AbortController().signal
    const streamId = createRemoteId()
    const queue = new AsyncValueQueue()
    const remoteClose = { enabled: true }
    const unsubscribe = this.client.onEvent(event => routeStreamEvent(event, streamId, queue))
    const unsubscribeClose = this.client.onClose(() => {
      queue.fail(new RemoteGatewayError('TRANSPORT_CLOSED', 'The remote Harness stream transport closed.'))
    })
    const onAbort = () => queue.close()
    activeSignal.addEventListener('abort', onAbort, { once: true })
    try {
      await this.client.rpc('harness.remote.stream.open', { streamId, endpoint, payload }, activeSignal)
    } catch (error) {
      activeSignal.removeEventListener('abort', onAbort)
      unsubscribe()
      unsubscribeClose()
      throw error
    }
    return new RemoteGatewayStreamController(this.iterate(
      streamId,
      queue,
      unsubscribe,
      unsubscribeClose,
      activeSignal,
      onAbort,
      remoteClose,
    ), queue, remoteClose)
  }

  failure(error: unknown): RemoteGatewayFailure {
    if (error instanceof RemoteGatewayError) {
      return { code: error.code, message: error.message, details: error.details }
    }
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      return {
        code: error.code,
        message: error.message,
        details: 'details' in error && isRecord(error.details) ? error.details : {},
      }
    }
    return {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    }
  }

  private async *iterate(
    streamId: string,
    queue: AsyncValueQueue,
    unsubscribe: () => void,
    unsubscribeClose: () => void,
    signal: AbortSignal,
    onAbort: () => void,
    remoteClose: { enabled: boolean },
  ): AsyncGenerator<unknown> {
    try {
      yield* queue
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
      unsubscribeClose()
      queue.close()
      if (remoteClose.enabled) await this.client.rpc('harness.remote.stream.close', { streamId }).catch(() => undefined)
    }
  }

  private async callTransferred(encoded: Uint8Array, signal: AbortSignal): Promise<unknown> {
    if (encoded.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Harness Remote request exceeds the transfer limit.')
    }
    const transferId = createRemoteId()
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
        throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned an invalid Harness Remote transfer descriptor.')
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
          throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned an out-of-order Harness Remote transfer chunk.')
        }
        const chunk = base64ToBytes(result.data)
        const expectedBytes = Math.min(HARNESS_API_TRANSFER_CHUNK_BYTES, committed.totalBytes - offset)
        if (chunk.byteLength !== expectedBytes) {
          throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned an invalid Harness Remote transfer chunk.')
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

class RemoteGatewayStreamController implements RemoteGatewayStream {
  constructor(
    private readonly generator: AsyncGenerator<unknown>,
    private readonly queue: AsyncValueQueue,
    private readonly remoteClose: { enabled: boolean },
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this.generator
  }

  async close(notifyRemote = true): Promise<void> {
    this.remoteClose.enabled = notifyRemote
    this.queue.close()
    await this.generator.return(undefined)
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

function parseRpcResult<T>(value: unknown): RemoteGatewayResult<T> {
  if (!isRecord(value)) throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned an invalid Gateway result.')
  if (value.ok === true) return Object.hasOwn(value, 'value') ? { ok: true, value: value.value as T } : { ok: true }
  if (value.ok !== false || !isRecord(value.error)
    || typeof value.error.code !== 'string'
    || typeof value.error.message !== 'string'
    || !isRecord(value.error.details)) {
    throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned an invalid Gateway failure.')
  }
  return {
    ok: false,
    error: { code: value.error.code, message: value.error.message, details: value.error.details },
  }
}

function remoteFailure(failure: RemoteGatewayFailure): RemoteGatewayError {
  return new RemoteGatewayError(failure.code, failure.message, failure.details)
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
    throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned malformed Harness Remote transfer data.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (bytesToBase64(bytes) !== value) {
    throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned non-canonical Harness Remote transfer data.')
  }
  return bytes
}

export function createRemoteId(): string {
  const crypto = globalThis.crypto
  if (crypto?.randomUUID !== undefined) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function isVersionAtLeast(value: string | undefined, minimum: readonly [number, number, number]): boolean {
  const match = value?.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (match === undefined || match === null) return false
  const version = match.slice(1, 4).map(part => Number(part))
  for (let index = 0; index < minimum.length; index += 1) {
    const part = version[index] ?? 0
    const expected = minimum[index] ?? 0
    if (part > expected) return true
    if (part < expected) return false
  }
  return true
}
