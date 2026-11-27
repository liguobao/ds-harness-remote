import { strings as zhCN } from '../locales/i18n'

export class AccountRequiredError extends Error {
  constructor(message: string) { super(message) }
}

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
  if (isSessionWriterHeldError(error)) return friendlyByCode['session/writer-held']!
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

/** Newer Harness exposes a code; older carriers retain only the native message. */
function isSessionWriterHeldError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: unknown }).code
  return code === 'session/writer-held'
    || error.name === 'SessionAlreadyOwnedError'
    || /^session "[^"\r\n]+" is already owned by an active write handle$/.test(error.message)
}

export function isRpcTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed?\s*out|timeout/i.test(error.message)
}

/** The bounded session-follow open/snapshot timeout (client-core STREAM_TIMEOUT). */
export function isStreamTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: unknown }).code === 'STREAM_TIMEOUT'
}

/** A request can race with the transport closing while Android resumes. */
export function isRecoverableTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: unknown }).code
  return code === 'TRANSPORT_CLOSED' || code === 'CLIENT_CLOSED'
}

const QUEUE_ITEM_NOT_FOUND_CODES = new Set([
  'queue-item-not-found',
  'session/queue-item-not-found',
  'queue_item_not_found',
])

/** True when the Host reports that a pending queue item has already been removed or consumed. */
export function isQueueItemNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const errorWithMeta = error as Error & { code?: unknown; details?: unknown }
  const code = errorWithMeta.code
  if (typeof code === 'string' && QUEUE_ITEM_NOT_FOUND_CODES.has(code.toLowerCase())) return true
  if (typeof errorWithMeta.details === 'object' && errorWithMeta.details !== null) {
    const remoteCode = (errorWithMeta.details as Record<string, unknown>).remoteCode
    if (typeof remoteCode === 'string' && QUEUE_ITEM_NOT_FOUND_CODES.has(remoteCode.toLowerCase())) return true
  }
  return /queue[\s_-]*item.*not[\s_-]*found/i.test(error.message)
}
