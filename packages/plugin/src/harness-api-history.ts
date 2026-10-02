import type { RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { createRpcResponse, encodeMessage, MAX_SECURE_MESSAGE_BYTES } from '@dsh-remote/protocol'
import { RpcError } from './rpc-router.js'

const SESSION_HISTORY_PAGE_SIZES = [50, 30, 20, 12, 6, 3, 1] as const

export function callSessionHistory(
  callWithTimeout: (payload: unknown) => Promise<RpcResponse<unknown>>,
  payload: unknown,
  rpcId: string,
): Promise<RpcResponse<unknown>> {
  const fallbackPageSizes = sessionHistoryFallbackPageSizes(payloadMaxMessages(payload))
  return callHistoryWithRetry(callWithTimeout, payload, rpcId, fallbackPageSizes)
}

async function callHistoryWithRetry(
  callWithTimeout: (payload: unknown) => Promise<RpcResponse<unknown>>,
  payload: unknown,
  rpcId: string,
  pageSizes: readonly number[],
): Promise<RpcResponse<unknown>> {
  for (const maxMessages of pageSizes) {
    const requestPayload = historyRequestPayload(payload, maxMessages)
    const response = await callWithTimeout(requestPayload)
    const request = createRpcResponse(rpcId, response.result)
    if (encodeMessage(request).byteLength <= MAX_SECURE_MESSAGE_BYTES) return response
    if (maxMessages === pageSizes[pageSizes.length - 1]) {
      throw new RpcError(
        'RESPONSE_TOO_LARGE',
        'The Host response is too large for the remote channel. Request a smaller page.',
        { maxBytes: MAX_SECURE_MESSAGE_BYTES },
        true,
      )
    }
  }
  throw new RpcError('INTERNAL_ERROR', 'Failed to load session history with a fallback page size.')
}

function sessionHistoryFallbackPageSizes(requestedMaxMessages: number | undefined): readonly number[] {
  const requested = normalizeSessionHistoryPageSize(requestedMaxMessages)
  const sizes: number[] = []
  if (requested === undefined) {
    sizes.push(...SESSION_HISTORY_PAGE_SIZES)
    return sizes
  }
  sizes.push(requested)
  for (const value of SESSION_HISTORY_PAGE_SIZES) {
    if (value < requested && !sizes.includes(value)) sizes.push(value)
  }
  return sizes
}

function normalizeSessionHistoryPageSize(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value)) return undefined
  if (value <= 0) return undefined
  return Math.max(1, value)
}

function payloadMaxMessages(payload: unknown): number | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const value = (payload as { maxMessages?: unknown }).maxMessages
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function historyRequestPayload(payload: unknown, maxMessages: number): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return { maxMessages }
  return { ...payload, maxMessages }
}
