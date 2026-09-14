import {
  createRpcRequest,
  decodeMessage,
  encodeMessage,
  type EventPayload,
  type RemoteEventName,
  type RemoteMessage,
  type RpcErrorPayload,
  type RpcMethod,
  type RpcResponsePayload,
} from '@dsh-remote/protocol'
import type { RemoteTransport } from '@dsh-remote/webrtc'

export type RemoteClientErrorCode =
  | 'RPC_TIMEOUT'
  | 'RPC_ABORTED'
  | 'TRANSPORT_CLOSED'
  | 'CLIENT_CLOSED'

export class RemoteClientError extends Error {
  constructor(
    readonly code: RemoteClientErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RemoteClientError'
  }
}

interface PendingCall {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  removeAbort?: () => void
}

export class RemoteClientCore {
  private readonly pending = new Map<string, PendingCall>()
  private readonly eventHandlers = new Set<(event: EventPayload) => void>()
  private unsubscribeTransport?: () => void
  private unsubscribeClose?: () => void
  private readonly closeHandlers = new Set<() => void>()
  private closeNotified = false

  constructor(private readonly transport: RemoteTransport, private readonly timeoutMs = 30_000) {}

  async connect(): Promise<void> {
    if (this.unsubscribeTransport !== undefined) return
    this.closeNotified = false
    this.unsubscribeTransport = this.transport.onMessage(data => this.handleMessage(data))
    this.unsubscribeClose = this.transport.onClose?.(() => this.handleTransportClose())
    try {
      await this.transport.connect()
    } catch (error) {
      this.unsubscribeTransport()
      this.unsubscribeTransport = undefined
      this.unsubscribeClose?.()
      this.unsubscribeClose = undefined
      throw error
    }
  }

  async rpc<TResult = unknown, TParams = unknown>(method: string, params: TParams, signal?: AbortSignal): Promise<TResult> {
    if (signal?.aborted) throw rpcAbortedError(method, signal.reason)

    const request = createRpcRequest(method as RpcMethod, params)
    const result = new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending(
          request.id,
          new RemoteClientError('RPC_TIMEOUT', `RPC ${method} timed out after ${this.timeoutMs}ms`),
        )
      }, this.timeoutMs)
      const pending: PendingCall = {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      }
      if (signal !== undefined) {
        const onAbort = () => {
          if (this.pending.get(request.id) !== pending) return
          this.rejectPending(request.id, rpcAbortedError(method, signal.reason))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending.removeAbort = () => signal.removeEventListener('abort', onAbort)
      }
      this.pending.set(request.id, pending)
    })

    // Do not await the write: timeout, abort, or close must be able to settle
    // the RPC even when the transport send itself never completes.
    try {
      const send = this.transport.send(encodeMessage(request))
      void send.catch(error => {
        this.rejectPending(request.id, transportSendError(error))
      })
    } catch (error) {
      this.rejectPending(request.id, transportSendError(error))
    }

    return result
  }

  onEvent(handler: (event: EventPayload) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  getStats() {
    return this.transport.getStats()
  }

  async close(): Promise<void> {
    this.unsubscribeTransport?.()
    this.unsubscribeTransport = undefined
    this.unsubscribeClose?.()
    this.unsubscribeClose = undefined
    this.rejectAllPending(
      pending => new RemoteClientError(
        'CLIENT_CLOSED',
        `RPC ${pending.method} terminated because the remote client closed`,
      ),
    )
    this.notifyClose()
    await this.transport.close()
  }

  private handleTransportClose(): void {
    this.rejectAllPending(
      pending => new RemoteClientError(
        'TRANSPORT_CLOSED',
        `RPC ${pending.method} terminated because the remote transport closed`,
      ),
    )
    this.notifyClose()
  }

  private handleMessage(data: Uint8Array): void {
    const message = decodeMessage(data)
    if (message.type === 'rpc.response') this.handleResponse(message as RemoteMessage<RpcResponsePayload>)
    if (message.type === 'rpc.error') this.handleError(message as RemoteMessage<RpcErrorPayload>)
    if (message.type === 'event') {
      const event = message.payload as EventPayload
      for (const handler of this.eventHandlers) handler(event)
    }
  }

  private handleResponse(message: RemoteMessage<RpcResponsePayload>): void {
    const pending = this.takePending(message.payload.requestId)
    if (pending === undefined) return
    pending.resolve(message.payload.result)
  }

  private handleError(message: RemoteMessage<RpcErrorPayload>): void {
    const pending = this.takePending(message.payload.requestId)
    if (pending === undefined) return
    pending.reject(Object.assign(new Error(message.payload.message), { code: message.payload.code }))
  }

  private takePending(requestId: string): PendingCall | undefined {
    const pending = this.pending.get(requestId)
    if (pending === undefined) return undefined
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.removeAbort?.()
    return pending
  }

  private rejectPending(requestId: string, error: Error): boolean {
    const pending = this.takePending(requestId)
    if (pending === undefined) return false
    pending.reject(error)
    return true
  }

  private rejectAllPending(createError: (pending: PendingCall) => Error): void {
    for (const requestId of [...this.pending.keys()]) {
      const pending = this.takePending(requestId)
      if (pending !== undefined) pending.reject(createError(pending))
    }
  }

  private notifyClose(): void {
    if (this.closeNotified) return
    this.closeNotified = true
    for (const handler of this.closeHandlers) handler()
  }
}

function rpcAbortedError(method: string, reason: unknown): RemoteClientError {
  return new RemoteClientError(
    'RPC_ABORTED',
    `RPC ${method} was aborted`,
    reason === undefined ? undefined : { cause: reason },
  )
}

function transportSendError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('remote transport send failed', { cause: error })
}

export type { EventPayload, RemoteEventName, RemoteTransport }
export * from './remote-gateway.js'
export * from './harness-alpha-client.js'
export * from './codex-client.js'
export * from './cursor-client.js'
