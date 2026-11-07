import { z } from 'zod'

export class RpcError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown, readonly retryable = false) { super(message) }
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof RpcError) return error.code
  if (error instanceof z.ZodError) return 'INVALID_MESSAGE'
  return 'INTERNAL_ERROR'
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
