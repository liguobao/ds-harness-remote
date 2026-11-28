import type { ControlResult } from './types.js'

/** Preserve domain errors across the loopback RPC envelope for auth recovery. */
export function unwrapControlResult<T>(result: ControlResult<T>, fallbackMessage: string): T {
  if (!result.ok) {
    const remoteCode = result.error?.details?.remoteCode
    throw Object.assign(new Error(result.error?.message ?? fallbackMessage), {
      code: typeof remoteCode === 'string' ? remoteCode : result.error?.code,
      details: result.error?.details,
    })
  }
  return result.value as T
}

export function isNonRetryableControlError(reason: unknown): boolean {
  if (typeof reason !== 'object' || reason === null || !('details' in reason)) return false
  const details = (reason as { details?: unknown }).details
  return typeof details === 'object' && details !== null && (details as { retryable?: unknown }).retryable === false
}
