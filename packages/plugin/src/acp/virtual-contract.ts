import type {
  AcpSessionModels,
  AgentAcpFrameData,
  AgentAcpStreamClosedData,
  AgentAcpStreamOpenParams,
} from '@dsh-remote/protocol'
import { ACP_TOOL_CALL_ENDPOINTS } from '@dsh-remote/protocol'
import type { TypertRpcResult } from '../typert-gateway-contract.js'
import type { AcpImage } from './image-content.js'
import type { AcpCatalogBackend, AcpModelSelection } from './virtual-catalog.js'

const CURSOR_SESSION_PREFIX = 'cursor:'

const ACP_SESSION_PREFIX = 'acp:'

const OPENCODE_SESSION_PREFIX = 'opencode:'

const SESSION_PREFIXES: Record<AcpCatalogBackend, string> = {
  cursor: CURSOR_SESSION_PREFIX,
  antigravity: ACP_SESSION_PREFIX,
  pi: 'pi:',
  opencode: OPENCODE_SESSION_PREFIX,
  claude: 'claude:',
  hermes: 'hermes:',
}

export type JsonRecord = Record<string, unknown>

export type PiTurnOutcome = { kind: 'completed' } | { kind: 'max-tokens' }
  | { kind: 'aborted'; reason: { kind: 'user' | 'disposed' } }
  | { kind: 'error'; error: { code: string; message: string } }

export function piStreamOutcome(reason: AgentAcpStreamClosedData['reason']): PiTurnOutcome {
  if (reason === 'completed') return { kind: 'completed' }
  if (reason === 'cancelled' || reason === 'peer-disconnected') return { kind: 'aborted', reason: { kind: reason === 'cancelled' ? 'user' : 'disposed' } }
  return { kind: 'error', error: { code: 'ACP_STREAM_FAILED', message: 'Pi reply stream failed.' } }
}

export function piPromptOutcome(kind: string, update: JsonRecord): PiTurnOutcome {
  if (update.stopReason === 'cancelled') return { kind: 'aborted', reason: { kind: 'user' } }
  if (kind === 'prompt_failed' || update.stopReason === 'error') return {
    kind: 'error', error: { code: 'PI_PROMPT_FAILED', message: 'Pi reply failed.' },
  }
  if (update.stopReason === 'max_tokens') return { kind: 'max-tokens' }
  return { kind: 'completed' }
}

export interface AcpSessionState {
  sessionId: string
  acpSessionId: string
  cwd: string
  title?: string
  titleOverridden?: boolean
  titleFromPrompt?: boolean
  blank: boolean
  running: boolean
  createdAt: number
  updatedAt: number
  events: Array<{ type: 'event'; event: NativeEvent }>
}

export interface NativeEvent {
  type: string
  seq: number
  time: number
  data: unknown
  surfaceOp?: 'append' | { op: 'replace'; start: number; end: number }
}

interface AssistantStreamAttempt {
  attemptId: string
  startedAfterSeq: number
  nextIndex: number
  stream: Array<{ type: 'chunk'; time: number; chunk: JsonRecord }>
}

export interface FollowState {
  sessionId: string
  acpSessionId: string
  queue: AsyncValueQueue
  nextSeq: number
  turn: number
  stepOpen: boolean
  streamActive: boolean
  blockIndex?: number
  reasoningBlockIndex?: number
  assistantStreamRevision: number
  assistantAttempt?: AssistantStreamAttempt
  accumulatedText: string
  activeToolCalls: Set<string>
  piToolOutputs: Map<string, { text: string; overflow: boolean }>
  piToolCalls: Map<string, { name: string; input?: unknown }>
  piStep?: number
  piAfterTools?: boolean
  piReasoning?: string
  close?: () => Promise<void>
}

export interface PendingApproval {
  requestHandle: string
  sessionId: string
}

export interface AcpClientLike {
  supportsArchive?(backend: string): boolean
  archiveSession?(sessionId: string, backend: string, signal?: AbortSignal): Promise<unknown>
  onSessionArchived?(handler: (data: { backend: 'opencode'; sessionId: string; archived: true }) => void): () => void
  sessionModels?(sessionId: string, backend: AcpCatalogBackend, signal?: AbortSignal): Promise<AcpSessionModels>
  selectModel?(sessionId: string, backend: AcpCatalogBackend, selection: AcpModelSelection, signal?: AbortSignal): Promise<AcpModelSelection>
  selectPermission?(sessionId: string, backend: AcpCatalogBackend, preset: string, signal?: AbortSignal): Promise<unknown>
  workspaceToolCall?(sessionId: string, backend: "cursor" | "antigravity" | "pi" | "opencode", endpoint: typeof ACP_TOOL_CALL_ENDPOINTS[number], args: JsonRecord, signal?: AbortSignal): Promise<unknown>
  createSession(
    cwd: string,
    mode?: "agent" | "plan" | "ask",
    backend?: AcpCatalogBackend,
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; cwd?: string }>
  prompt(sessionId: string, text: string, signal?: AbortSignal, images?: AcpImage[], backend?: AcpCatalogBackend): Promise<unknown>
  cancel(sessionId: string, signal?: AbortSignal): Promise<unknown>
  listDirectory(path: string, signal?: AbortSignal): Promise<unknown>
  listWorkspaces?(backend?: string, signal?: AbortSignal): Promise<Array<{ path: string; title?: string; sessionCount?: number }>>
  listSessions?(path: string, backend?: string, limit?: number, signal?: AbortSignal): Promise<Array<{ conversationId: string; title: string; createdAt: number; updatedAt: number }>>
  loadSessionHistory?(sessionId: string, backend?: string, signal?: AbortSignal): Promise<unknown[]>
  openStream(
    sessionId: string,
    onFrame: (frame: AgentAcpFrameData) => void,
    onClosed?: (closed: AgentAcpStreamClosedData) => void,
    signal?: AbortSignal,
    tool?: AgentAcpStreamOpenParams['tool'],
  ): Promise<{ close(): Promise<void> }>
  respond(
    requestHandle: string,
    decision: 'allow-once' | 'reject-once' | 'cancel',
    result?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>
}

export function extractPromptText(content: unknown[]): string | undefined {
  const parts = content.flatMap(part => {
    const item = record(part)
    if (item.type === 'text' && typeof item.text === 'string') return [item.text]
    return []
  })
  const text = parts.join('')
  return text.length === 0 ? undefined : text
}

export function extractText(update: JsonRecord): string | undefined {
  const content = update.content
  if (typeof content === 'string') return content
  if (isRecord(content) && typeof content.text === 'string') return content.text
  if (Array.isArray(content)) {
    const parts = content
      .map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : undefined))
      .filter((part): part is string => part !== undefined)
    return parts.length === 0 ? undefined : parts.join('')
  }
  return typeof update.text === 'string' ? update.text : undefined
}

export function summarizeQuestions(params: JsonRecord): string | undefined {
  if (!Array.isArray(params.questions)) return undefined
  const lines = params.questions
    .map(question => (isRecord(question) ? string(question.prompt) : undefined))
    .filter((line): line is string => line !== undefined)
  return lines.length === 0 ? undefined : lines.join('\n')
}

function sessionIdFromAddress(address: JsonRecord): string {
  if (typeof address.sessionId === 'string' && address.sessionId.length > 0) return address.sessionId
  if (typeof address.childSessionId === 'string' && address.childSessionId.length > 0) return address.childSessionId
  if (address.kind === 'session' && typeof address.sessionId === 'string' && address.sessionId.length > 0) {
    return address.sessionId
  }
  throw new Error('The sessionId is required.')
}

export function extractSessionId(request: JsonRecord): string {
  if (typeof request.sessionId === 'string' && request.sessionId.length > 0) return request.sessionId
  if (isRecord(request.address)) return sessionIdFromAddress(request.address)
  throw new Error('The sessionId is required.')
}

export function sessionPrefix(backend: AcpCatalogBackend): string {
  return SESSION_PREFIXES[backend] ?? CURSOR_SESSION_PREFIX
}

export function nativeAcpId(sessionId: string, backend: AcpCatalogBackend): string {
  const prefix = sessionPrefix(backend)
  if (!sessionId.startsWith(prefix) || sessionId.length === prefix.length) {
    throw new Error('The selected Session does not belong to the virtual harness.')
  }
  return sessionId.slice(prefix.length)
}

export function isSurfaceEvent(type: string): boolean {
  return type === 'user/message' || type === 'assistant/message' || type === 'tool/result'
}

export function carrierArgs(payload: unknown): JsonRecord {
  return record(record(payload).args)
}

export function requestArg(args: JsonRecord): JsonRecord {
  return record(args.request ?? args._request ?? args)
}

export function success(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value }
}

export function failure(code: string, message: string, details: JsonRecord = {}): { ok: false; error: { code: string; message: string; details: JsonRecord } } {
  return { ok: false, error: { code, message, details } }
}

export function business(value: unknown): TypertRpcResult {
  if (isRecord(value) && value.ok === false && isRecord(value.error)) {
    return {
      ok: false, error: {
        code: string(value.error.code) ?? 'internal',
        message: string(value.error.message) ?? 'The virtual Harness request failed.',
        details: isRecord(value.error.details) ? value.error.details : {},
      }
    }
  }
  if (isRecord(value) && value.ok === true) return { ok: true, value: value.value }
  return { ok: true, value }
}

export function fail(code: string, message: string, details: JsonRecord = {}): TypertRpcResult {
  return { ok: false, error: { code, message, details } }
}

export function failFrom(error: unknown): TypertRpcResult {
  const source = error instanceof Error ? error : new Error(String(error))
  const code = 'code' in source && typeof source.code === 'string' ? source.code : 'internal'
  return fail(code, source.message)
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

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

export function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = integer(value)
  if (parsed === undefined) throw new Error('The History cursor is invalid.')
  return parsed
}

export function optionalPositiveInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value)
  if (parsed !== undefined && parsed <= 0) throw new Error('The History page size is invalid.')
  return parsed
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`The ${field} is required.`)
  return value
}

export class AsyncValueQueue implements AsyncIterable<unknown> {
  private readonly values: unknown[] = []
  private readonly waiters: Array<(result: IteratorResult<unknown>) => void> = []
  private closed = false
  private readonly onAbort: () => void

  constructor(private readonly signal: AbortSignal) {
    this.onAbort = () => this.close()
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.close()
  }

  push(value: unknown): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.values.push(value)
    else waiter({ done: false, value })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.signal.removeEventListener('abort', this.onAbort)
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  iterate(dispose: () => void): AsyncIterable<unknown> {
    const queue = this
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
        try {
          yield* queue
        } finally {
          dispose()
          queue.close()
        }
      },
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift()
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<unknown>>(resolve => this.waiters.push(resolve))
      if (next.done) return
      yield next.value
    }
  }
}

export type AcpPermissionPreset = 'workspace-write' | 'danger-full-access'

export function isAcpPermissionPreset(value: string): value is AcpPermissionPreset {
  return value === 'workspace-write' || value === 'danger-full-access'
}

export function acpPermissionsProjection(preset: AcpPermissionPreset | undefined): unknown {
  return {
    options: [
      {
        value: 'workspace-write',
        name: 'workspace-write',
        description: 'Interactive one-time approval for tool executions and commands.',
      },
      {
        value: 'danger-full-access',
        name: 'danger-full-access',
        description: 'Auto-approve tool requests for subsequent turns in this session.',
      },
    ],
    currentValue: preset ?? 'Host settings (not reported)',
  }
}
