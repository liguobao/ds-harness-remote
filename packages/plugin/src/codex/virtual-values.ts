export const CODEX_SESSION_PREFIX = 'codex:'

/** The strict Remote history schema accepts at most 200 messages per page. */
export const CODEX_HISTORY_PAGE_MAX_MESSAGES = 200

export type JsonRecord = Record<string, unknown>

export interface CodexClientLike {
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>
  subscribe(
    threadId: string,
    onFrame: (frame: { method: string; params: unknown }) => void,
    signal?: AbortSignal,
    onClose?: (reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected') => void,
  ): Promise<{ streamId?: string; close(): Promise<void> }>
  claimApprovals?(streamId: string, signal?: AbortSignal): Promise<Array<{ method: string; params: unknown }>>
  respond(requestHandle: string, decision: 'accept' | 'decline' | 'cancel', signal?: AbortSignal): Promise<void>
}

export function nativeThreadId(sessionId: string): string {
  if (!sessionId.startsWith(CODEX_SESSION_PREFIX) || sessionId.length === CODEX_SESSION_PREFIX.length) {
    throw new Error('The selected Session does not belong to CodeX.')
  }
  return sessionId.slice(CODEX_SESSION_PREFIX.length)
}

export function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = integer(value)
  if (parsed === undefined) throw new Error('The CodeX History cursor is invalid.')
  return parsed
}

export function optionalNonNegativeInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value)
  if (parsed !== undefined && parsed < 0) throw new Error('The CodeX History cursor is invalid.')
  return parsed
}

export function optionalPositiveInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value)
  if (parsed !== undefined && parsed <= 0) throw new Error('The CodeX History page size is invalid.')
  return parsed
}

/** Cap native DSH's larger history window requests at the Remote page limit. */
export function boundedCodexHistoryPageSize(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.min(value, CODEX_HISTORY_PAGE_MAX_MESSAGES)
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`The CodeX ${field} is required.`)
  return value
}

export function normalizeTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value < 10_000_000_000 ? Math.floor(value * 1000) : Math.floor(value)
}

export function isoTime(value: unknown): string {
  return new Date(normalizeTime(value) || Date.now()).toISOString()
}

export function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/u, '')
  const parts = normalized.split(/[\\/]/u)
  return parts.at(-1) || path
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0;index < value.length;index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function errorCode(error: Error): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined
}
