import {
  MAX_ATTENTION_ITEMS,
  attentionAckUnreadRequestSchema,
  attentionAckUnreadResultSchema,
  attentionFollowEventSchema,
  attentionListResultSchema,
  attentionTargetSchema,
  attentionTokenSchema,
  compareAttentionItems,
  type AttentionAckUnreadResult,
  type AttentionDigest,
  type AttentionFollowEvent,
  type AttentionItem,
  type AttentionListResult,
  type AttentionTarget,
} from '@dsh-remote/protocol'
import { RemoteClientError } from './errors.js'
import type { RemoteClientCore } from './index.js'
import { RemoteGatewayError } from './remote-gateway.js'

const MAX_FOLLOW_HANDSHAKE_BUFFER = 512

export interface AttentionRpcCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface AttentionRpcTransport {
  call(method: string, params?: unknown, options?: AttentionRpcCallOptions): Promise<unknown>
  onEvent(event: string, listener: (payload: unknown) => void): () => void
}

export interface AttentionInboxState {
  revision: number
  digest: AttentionDigest | null
  items: AttentionItem[]
}

export interface AttentionFollowHandlers {
  onEvent: (event: AttentionFollowEvent) => void
  onError?: (err: unknown) => void
}

export interface AttentionFollowSubscription {
  initial: AttentionListResult
  stop: () => Promise<void>
}

export function createEmptyAttentionInboxState(): AttentionInboxState {
  return {
    revision: 0,
    digest: null,
    items: [],
  }
}

/**
 * Adapts a {@link RemoteClientCore} instance to the minimal {@link AttentionRpcTransport}
 * interface expected by {@link RemoteAttentionClient}.
 */
export function createAttentionRpcTransport(
  core: Pick<RemoteClientCore, 'rpc' | 'onEvent'>,
): AttentionRpcTransport {
  return {
    call: (method, params, options) => core.rpc(
      method,
      params,
      options?.signal,
      options?.timeoutMs === undefined ? undefined : { timeoutMs: options.timeoutMs },
    ),
    onEvent: (event, listener) => core.onEvent(envelope => {
      if (envelope.event === event) listener(envelope.data)
    }),
  }
}

/**
 * Pure reducer applying validated `attention.follow.event` payloads to local
 * Attention Inbox state while enforcing monotonic revisions, deterministic
 * priority ordering (`compareAttentionItems`), and `MAX_ATTENTION_ITEMS` capping.
 */
export function applyAttentionFollowEvent(
  current: AttentionInboxState,
  event: AttentionFollowEvent,
): AttentionInboxState {
  if (event.type === 'snapshot') {
    if (event.revision < current.revision) return current
    return {
      revision: event.revision,
      digest: event.digest,
      items: normalizeAttentionItems(event.items),
    }
  }

  if (event.revision < current.revision) return current

  if (event.type === 'upsert') {
    const nextItems = current.items.filter(item => item.id !== event.item.id)
    nextItems.push(event.item)
    return {
      revision: event.revision,
      digest: event.digest,
      items: sortAndCapAttentionItems(nextItems),
    }
  }

  return {
    revision: event.revision,
    digest: event.digest,
    items: sortAndCapAttentionItems(current.items.filter(item => item.id !== event.itemId)),
  }
}

/** Typed encrypted-tunnel client for `attention.inbox.v1` RPCs and follow streams. */
export class RemoteAttentionClient {
  constructor(private readonly transport: AttentionRpcTransport) {}

  async list(options?: AttentionRpcCallOptions): Promise<AttentionListResult> {
    const raw = await this.transport.call('attention.list', {}, options)
    const parsed = attentionListResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'The remote Host returned an invalid attention.list result.')
    }
    return parsed.data
  }

  async follow(
    handlers: AttentionFollowHandlers,
    options?: AttentionRpcCallOptions,
  ): Promise<AttentionFollowSubscription> {
    if (options?.signal?.aborted) {
      throw createFollowAbortedError(options.signal.reason)
    }

    let ready = false
    let stopped = false
    let stopPromise: Promise<void> | undefined
    const buffered: AttentionFollowEvent[] = []

    const emitEvent = (event: AttentionFollowEvent): void => {
      if (stopped) return
      try {
        handlers.onEvent(event)
      } catch (error) {
        handlers.onError?.(error)
      }
    }

    const unsubscribe = this.transport.onEvent('attention.follow.event', payload => {
      if (stopped) return
      const parsed = attentionFollowEventSchema.safeParse(payload)
      if (!parsed.success) {
        handlers.onError?.(new RemoteGatewayError('INVALID_MESSAGE', 'Received an invalid attention.follow.event payload.'))
        return
      }
      if (!ready) {
        if (buffered.length >= MAX_FOLLOW_HANDSHAKE_BUFFER) buffered.shift()
        buffered.push(parsed.data)
        return
      }
      emitEvent(parsed.data)
    })

    const onAbort = () => {
      void stop()
    }

    const cleanupLocal = () => {
      stopped = true
      buffered.length = 0
      unsubscribe()
      options?.signal?.removeEventListener('abort', onAbort)
    }

    const stop = (): Promise<void> => {
      if (stopPromise !== undefined) return stopPromise
      cleanupLocal()
      stopPromise = this.transport.call('attention.unfollow', {}).then(
        () => undefined,
        () => undefined,
      )
      return stopPromise
    }

    let rawInitial: unknown
    try {
      rawInitial = await this.transport.call('attention.follow', { enabled: true }, options)
    } catch (error) {
      cleanupLocal()
      throw error
    }

    if (options?.signal?.aborted) {
      await stop()
      throw createFollowAbortedError(options.signal.reason)
    }

    const parsedInitial = attentionListResultSchema.safeParse(rawInitial)
    if (!parsedInitial.success) {
      await stop()
      throw new RemoteGatewayError('INVALID_RESPONSE', 'The remote Host returned an invalid attention.follow result.')
    }
    const initial = parsedInitial.data

    while (!stopped && buffered.length > 0) {
      const batch = buffered.splice(0, buffered.length)
      for (const event of batch) {
        if (stopped) break
        if (event.revision > initial.revision) {
          emitEvent(event)
        }
      }
    }

    if (!stopped) {
      ready = true
      options?.signal?.addEventListener('abort', onAbort, { once: true })
    }

    return { initial, stop }
  }

  async resolveToken(token: string, options?: AttentionRpcCallOptions): Promise<AttentionTarget> {
    const parsedToken = attentionTokenSchema.safeParse(token)
    if (!parsedToken.success) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'Attention token must be a 32-character lowercase hex string.')
    }
    const raw = await this.transport.call('attention.resolveToken', { token: parsedToken.data }, options)
    const parsedTarget = attentionTargetSchema.safeParse(raw)
    if (!parsedTarget.success) {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'The remote Host returned an invalid attention.resolveToken result.')
    }
    return parsedTarget.data
  }

  async ackUnread(
    itemIds: readonly string[],
    options?: AttentionRpcCallOptions,
  ): Promise<AttentionAckUnreadResult> {
    const parsedRequest = attentionAckUnreadRequestSchema.safeParse({ itemIds: [...itemIds] })
    if (!parsedRequest.success) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'Invalid attention.ackUnread request.')
    }
    const raw = await this.transport.call('attention.ackUnread', parsedRequest.data, options)
    const parsedResult = attentionAckUnreadResultSchema.safeParse(raw)
    if (!parsedResult.success) {
      throw new RemoteGatewayError('INVALID_RESPONSE', 'The remote Host returned an invalid attention.ackUnread result.')
    }
    return parsedResult.data
  }
}

export function createRemoteAttentionClient(transport: AttentionRpcTransport): RemoteAttentionClient {
  return new RemoteAttentionClient(transport)
}

function normalizeAttentionItems(items: readonly AttentionItem[]): AttentionItem[] {
  const deduped = new Map<string, AttentionItem>()
  for (const item of items) deduped.set(item.id, item)
  return sortAndCapAttentionItems([...deduped.values()])
}

function sortAndCapAttentionItems(items: AttentionItem[]): AttentionItem[] {
  items.sort(compareAttentionItems)
  return items.length > MAX_ATTENTION_ITEMS ? items.slice(0, MAX_ATTENTION_ITEMS) : items
}

function createFollowAbortedError(reason: unknown): RemoteClientError {
  return new RemoteClientError(
    'RPC_ABORTED',
    'RPC attention.follow was aborted',
    reason === undefined ? undefined : { cause: reason },
  )
}
