import { strings as zhCN } from '../locales/i18n'
import { AccountRequiredError } from '../services/server-session-manager'

export class RemoteApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message)
    this.name = 'RemoteApiError'
  }
}

/** Server / credential failures that require the user to sign in again. */
const SESSION_AUTH_CODES = new Set([
  'ACCOUNT_AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_REQUIRED',
  'TOKEN_EXPIRED',
  'TOKEN_REUSED',
  'DEVICE_REVOKED',
  'DEVICE_OWNERSHIP_REQUIRED',
])

export function isSessionAuthError(error: unknown): boolean {
  if (error instanceof AccountRequiredError) return true
  if (error instanceof RemoteApiError) return SESSION_AUTH_CODES.has(error.code)
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    return typeof code === 'string' && SESSION_AUTH_CODES.has(code)
  }
  return false
}

export function friendlyError(error: unknown): string {
  const friendlyByCode: Record<string, string> = zhCN.errors
  if (error instanceof AccountRequiredError) return friendlyByCode.AUTH_REQUIRED ?? error.message
  if (error instanceof RemoteApiError) return friendlyByCode[error.code] ?? error.message
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    if (typeof code === 'string' && friendlyByCode[code] !== undefined) return friendlyByCode[code]!
    if (/network request failed|failed to fetch|websocket/i.test(error.message)) {
      return zhCN.errors.serverUnreachable
    }
    if (isRpcTimeoutError(error)) return friendlyByCode.RPC_TIMEOUT!
    return error.message
  }
  return zhCN.errors.unknown
}

export function isRpcTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed?\s*out|timeout/i.test(error.message)
}
