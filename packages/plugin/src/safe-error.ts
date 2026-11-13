import { z } from 'zod'

export class RpcError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown, readonly retryable = false) { super(message) }
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof RpcError) return error.code
  if (error instanceof z.ZodError) return 'INVALID_MESSAGE'
  return 'INTERNAL_ERROR'
}

/**
 * Stable, non-sensitive reasons for workspace file denials. They are safe to
 * expose on the wire and to log: they describe the rule, never a path, file
 * name, file body or raw filesystem error.
 */
export const WORKSPACE_FILE_FAILURE_REASONS = [
  'scope-missing',
  'authority-unavailable',
  'root-invalid',
  'outside-root',
  'symlink',
  'not-regular-file',
  'not-found',
  'too-large',
  'io',
] as const

export type WorkspaceFileFailureReason = typeof WORKSPACE_FILE_FAILURE_REASONS[number]

const workspaceFileFailureReasons = new Set<string>(WORKSPACE_FILE_FAILURE_REASONS)

export function workspaceFileFailureReason(error: unknown): WorkspaceFileFailureReason | undefined {
  if (typeof error !== 'object' || error === null || !('details' in error)) return undefined
  const details = (error as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return undefined
  const reason = (details as Record<string, unknown>).reason
  return typeof reason === 'string' && workspaceFileFailureReasons.has(reason)
    ? reason as WorkspaceFileFailureReason
    : undefined
}

export function workspaceFileFailure(
  code: 'WORKSPACE_UNAVAILABLE' | 'WORKSPACE_PATH_DENIED' | 'WORKSPACE_TOO_LARGE',
  message: string,
  reason: WorkspaceFileFailureReason,
): RpcError {
  return new RpcError(code, message, { reason })
}

const SAFE_STARTUP_CODES = new Set([
  'IDENTITY_INVALID',
  'IDENTITY_LOCKED',
  'STORAGE_CONFLICT',
  'SERVER_CREDENTIALS_INVALID',
  'SERVER_CREDENTIALS_BUSY',
])

const SAFE_STATIC_STARTUP_MESSAGES = new Set([
  'device identity is incomplete; repair it explicitly before reconnecting',
  'device public and private keys do not match',
  'device identity is locked by another process; stop other DSH instances and retry',
  'Remote storage fallback record is invalid; no credentials were changed.',
  'Both Remote storage directories exist; stop all Harness instances and resolve them manually. No credentials were overwritten.',
  'Legacy Remote storage changed after fallback; inspect it before reconnecting.',
  'Pinned Remote storage is missing; no replacement identity was created.',
  'Remote storage ownership could not be verified; nothing was moved. Inspect the legacy directory manually.',
  'Remote storage must be a real directory; symbolic links are not migrated.',
  'Remote storage contains a lock or symbolic link; stop all Harness instances and inspect it before migration.',
])

const SAFE_STORAGE_CONFLICT_ENTRY_MESSAGE = /^Remote storage ownership could not be verified; nothing was moved\. Inspect the legacy directory manually\. Unexpected entry "[A-Za-z0-9._-]{1,160}" was found\.$/

export function safeStartupError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' && SAFE_STARTUP_CODES.has(error.code)
    ? error.code
    : safeErrorCode(error)
  if (code === 'SERVER_CREDENTIALS_INVALID') {
    return { code, message: 'Local Remote server credentials are invalid.' }
  }
  if (code === 'SERVER_CREDENTIALS_BUSY') {
    return {
      code,
      message: 'Credential refresh is busy. The Host will retry. Remove a legacy refresh lock only after every instance stops.',
    }
  }
  if (code === 'IDENTITY_INVALID' || code === 'IDENTITY_LOCKED' || code === 'STORAGE_CONFLICT') {
    const rawMessage = error instanceof Error ? error.message : ''
    if (SAFE_STATIC_STARTUP_MESSAGES.has(rawMessage)
      || SAFE_STORAGE_CONFLICT_ENTRY_MESSAGE.test(rawMessage)
      || /^private key permissions must be 0600, got [0-7]{3,4}$/.test(rawMessage)) {
      return { code, message: rawMessage }
    }
    if (rawMessage.startsWith('device identity is invalid')) {
      return { code, message: 'device identity is invalid' }
    }
    if (rawMessage.startsWith('trusted peer ')) {
      return { code, message: 'trusted peer record is invalid' }
    }
    return {
      code,
      message: code === 'IDENTITY_LOCKED'
        ? 'device identity is locked by another process; stop other DSH instances and retry'
        : code === 'STORAGE_CONFLICT'
          ? 'Remote storage ownership could not be verified; nothing was moved. Inspect the legacy directory manually.'
          : 'device identity is invalid',
    }
  }
  return { code, message: 'Remote plugin failed to start.' }
}
