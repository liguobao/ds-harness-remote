import type {
  CodexAppFrameData,
  CodexAppStreamClosedData,
  CodexAppTransferCommitResult,
  CodexAppTransferReadResult,
} from '@dsh-remote/protocol'
import {
  CODEX_APP_TRANSFER_CHUNK_BYTES,
  MAX_CODEX_APP_TRANSFER_BYTES,
} from '@dsh-remote/protocol'
import type { RemoteClientCore } from './index.js'
import { createRemoteId, RemoteGatewayError } from './remote-gateway.js'

export type AgentBackend = 'harness' | 'codex'

export interface DisplaySession {
  id: string
  backend: AgentBackend
  nativeId: string
  sessionTreeId?: string
  title?: string
  preview?: string
  cwd?: string
  createdAt: number
  updatedAt: number
  status: 'idle' | 'running' | 'waiting' | 'failed'
  archived?: boolean
  pinned?: boolean
}

export interface CodexCwdWorkspace {
  id: string
  name: string
  path: string
  position: number
  createdAt: number
  updatedAt: number
}

export interface DisplayImage {
  uri: string
  name?: string
}

export interface DisplayHistoryItem {
  id: string
  sessionId: string
  backend: AgentBackend
  kind: 'message' | 'tool' | 'file-change' | 'approval' | 'status' | 'error' | 'unknown'
  role?: 'user' | 'assistant'
  text?: string
  images?: DisplayImage[]
  status?: 'running' | 'completed' | 'failed' | 'declined'
  createdAt?: number
  nativeRef: {
    threadId?: string
    turnId?: string
    itemId?: string
    requestHandle?: string
  }
  details?: Record<string, unknown>
}

export interface CodexThreadListPage {
  sessions: DisplaySession[]
  nextCursor?: string
}

export interface CodexHistoryView {
  session: DisplaySession
  items: DisplayHistoryItem[]
}

export interface CodexPendingApproval {
  requestHandle: string
  kind: 'command' | 'file-change'
  command?: string
  reason?: string
}

export interface CodexTimelineState {
  session: DisplaySession
  items: DisplayHistoryItem[]
  activeTurnId?: string
  approval?: CodexPendingApproval
}

export interface CodexStream {
  streamId: string
  close(): Promise<void>
}

const MAX_DISPLAY_ITEM_TEXT = 256 * 1024
const CODEX_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const DATA_IMAGE_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u

/** Shared Web/Android client for the independent Codex domain in Remote. */
export class CodexRemoteClient {
  constructor(private readonly core: RemoteClientCore, private readonly historyPreview = false) {}

  /** Low-level allowlisted request used by the Desktop Web loopback facade. */
  private previewSupported = true
  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (method === 'dsh/sessionHistory' && this.historyPreview && this.previewSupported) {
      try {return await this.core.rpc('codex.app.call', {method, params, previewHistory: true}, signal)}
      catch (error) {
        const code = (error as {code?: string})?.code
        if (code !== 'INVALID_MESSAGE' && code !== 'RESPONSE_TOO_LARGE') throw error
        if (code === 'INVALID_MESSAGE') this.previewSupported = false
      }
    }
    const largeHistory = method === 'dsh/historyDetail' || method === 'dsh/sessionHistory'
      || method === 'thread/read' && isRecord(params) && params.includeTurns === true
    return this.call(method, params, largeHistory || hasImageInput(params), signal)
  }

  async account(signal?: AbortSignal): Promise<unknown> {
    return this.call('account/read', { refreshToken: false }, false, signal)
  }

  async models(signal?: AbortSignal): Promise<unknown> {
    return this.call('model/list', {}, false, signal)
  }

  async threads(params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<CodexThreadListPage> {
    const result = await this.call('thread/list', params, false, signal)
    if (!isRecord(result) || !Array.isArray(result.data)) throw invalidResponse('thread list')
    return {
      sessions: result.data.map(projectCodexThread).filter((value): value is DisplaySession => value !== undefined),
      ...(typeof result.nextCursor === 'string' ? { nextCursor: result.nextCursor } : {}),
    }
  }

  async history(threadId: string, signal?: AbortSignal): Promise<CodexHistoryView> {
    const result = await this.call('thread/read', { threadId, includeTurns: true }, true, signal)
    if (!isRecord(result) || !isRecord(result.thread)) throw invalidResponse('thread history')
    const session = projectCodexThread(result.thread)
    if (session === undefined) throw invalidResponse('thread history')
    return { session, items: projectCodexHistory(result.thread) }
  }

  async start(cwd: string, model?: string, signal?: AbortSignal): Promise<DisplaySession> {
    const result = await this.call('thread/start', { cwd, ...(model === undefined ? {} : { model }) }, false, signal)
    return requireProjectedThread(result)
  }

  async resume(threadId: string, signal?: AbortSignal): Promise<DisplaySession> {
    return requireProjectedThread(await this.call('thread/resume', { threadId }, false, signal))
  }

  async fork(threadId: string, lastTurnId?: string, signal?: AbortSignal): Promise<DisplaySession> {
    return requireProjectedThread(await this.call('thread/fork', {
      threadId,
      ...(lastTurnId === undefined ? {} : { lastTurnId }),
    }, false, signal))
  }

  async rename(threadId: string, name: string, signal?: AbortSignal): Promise<void> {
    await this.call('thread/name/set', { threadId, name }, false, signal)
  }

  async prompt(threadId: string, text: string, signal?: AbortSignal): Promise<unknown> {
    return this.call('turn/start', { threadId, input: [{ type: 'text', text }] }, false, signal)
  }

  async steer(threadId: string, expectedTurnId: string, text: string, signal?: AbortSignal): Promise<unknown> {
    return this.call('turn/steer', {
      threadId,
      expectedTurnId,
      input: [{ type: 'text', text }],
    }, false, signal)
  }

  async interrupt(threadId: string, turnId: string, signal?: AbortSignal): Promise<void> {
    await this.call('turn/interrupt', { threadId, turnId }, false, signal)
  }

  async respond(requestHandle: string, decision: 'accept' | 'decline' | 'cancel', signal?: AbortSignal): Promise<void> {
    await this.core.rpc('codex.app.respond', { requestHandle, decision }, signal)
  }

  async subscribe(
    threadId: string,
    onFrame: (frame: CodexAppFrameData['frame']) => void,
    signal?: AbortSignal,
    onClose?: (reason: CodexAppStreamClosedData['reason']) => void,
  ): Promise<CodexStream> {
    const streamId = createRemoteId()
    let closed = false
    let unsubscribe: () => void = () => undefined
    const markClosed = () => {
      if (closed) return false
      closed = true
      unsubscribe()
      return true
    }
    unsubscribe = this.core.onEvent(event => {
      if (!isRecord(event.data) || event.data.streamId !== streamId) return
      if (event.event === 'codex.app.stream.closed') {
        if (!markClosed()) return
        onClose?.(codexStreamCloseReason(event.data.reason))
        return
      }
      if (event.event !== 'codex.app.frame' || !isRecord(event.data.frame)
        || typeof event.data.frame.method !== 'string') return
      onFrame(event.data.frame as CodexAppFrameData['frame'])
    })
    try {
      await this.core.rpc('codex.app.stream.open', { streamId, threadId }, signal)
    } catch (error) {
      unsubscribe()
      throw error
    }
    return {
      streamId,
      close: async () => {
        if (!markClosed()) return
        await this.core.rpc('codex.app.stream.close', { streamId }).catch(() => undefined)
      },
    }
  }

  private async call(
    method: string,
    params: unknown,
    transfer: boolean,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const envelope = { method, params }
    if (!transfer) return this.core.rpc('codex.app.call', envelope, signal)
    return this.callTransferred(new TextEncoder().encode(JSON.stringify(envelope)), signal)
  }

  private async callTransferred(encoded: Uint8Array, signal?: AbortSignal): Promise<unknown> {
    if (encoded.byteLength === 0 || encoded.byteLength > MAX_CODEX_APP_TRANSFER_BYTES) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Codex request exceeds the transfer limit.')
    }
    const transferId = createCodexTransferId()
    const totalChunks = Math.ceil(encoded.byteLength / CODEX_APP_TRANSFER_CHUNK_BYTES)
    let opened = false
    try {
      await this.core.rpc('codex.app.transfer.open', { transferId, totalBytes: encoded.byteLength, totalChunks }, signal)
      opened = true
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * CODEX_APP_TRANSFER_CHUNK_BYTES
        const chunk = encoded.subarray(start, Math.min(start + CODEX_APP_TRANSFER_CHUNK_BYTES, encoded.byteLength))
        await this.core.rpc('codex.app.transfer.chunk', { transferId, index, data: bytesToBase64(chunk) }, signal)
      }
      const committed = await this.core.rpc<CodexAppTransferCommitResult>(
        'codex.app.transfer.commit',
        { transferId },
        signal,
      )
      if (committed.kind === 'inline') return committed.response
      if (committed.transferId !== transferId
        || committed.totalBytes <= 0
        || committed.totalBytes > MAX_CODEX_APP_TRANSFER_BYTES
        || committed.totalChunks !== Math.ceil(committed.totalBytes / CODEX_APP_TRANSFER_CHUNK_BYTES)) {
        throw invalidResponse('transfer descriptor')
      }
      const response = new Uint8Array(committed.totalBytes)
      let offset = 0
      for (let index = 0; index < committed.totalChunks; index += 1) {
        const result = await this.core.rpc<CodexAppTransferReadResult>(
          'codex.app.transfer.read',
          { transferId, index },
          signal,
        )
        if (result.transferId !== transferId || result.index !== index) throw invalidResponse('transfer ordering')
        const chunk = base64ToBytes(result.data)
        const expected = Math.min(CODEX_APP_TRANSFER_CHUNK_BYTES, committed.totalBytes - offset)
        if (chunk.byteLength !== expected) throw invalidResponse('transfer chunk')
        response.set(chunk, offset)
        offset += chunk.byteLength
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response)) as unknown
    } finally {
      if (opened) await this.core.rpc('codex.app.transfer.close', { transferId }).catch(() => undefined)
    }
  }
}

function hasImageInput(params: unknown): boolean {
  return isRecord(params) && Array.isArray(params.input)
    && params.input.some(value => isRecord(value) && value.type === 'image')
}

export function projectCodexThread(value: unknown): DisplaySession | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined
  const createdAt = normalizeTimestamp(value.createdAt)
  const updatedAt = normalizeTimestamp(value.updatedAt) || createdAt
  return {
    id: `codex:${value.id}`,
    backend: 'codex',
    nativeId: value.id,
    ...(typeof value.sessionId === 'string' ? { sessionTreeId: value.sessionId } : {}),
    ...(typeof value.name === 'string' && value.name.length > 0 ? { title: value.name } : {}),
    ...(typeof value.preview === 'string' && value.preview.length > 0 ? { preview: value.preview } : {}),
    ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
    createdAt,
    updatedAt,
    status: projectThreadStatus(value.status),
    ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {}),
    ...(typeof value.isPinned === 'boolean' ? { pinned: value.isPinned } : {}),
  }
}

/**
 * Builds a deterministic, bounded Workspace fallback from cwd values that the
 * App Server already exposed through thread/list. Callers should use this only
 * when project/list has no usable projects.
 */
export function deriveCodexCwdWorkspaces(values: unknown[]): CodexCwdWorkspace[] {
  const byPath = new Map<string, CodexCwdWorkspace>()
  const usedIds = new Set<string>()
  for (const value of values) {
    const session = projectCodexThread(value)
    if (session === undefined || session.cwd === undefined || session.cwd.length === 0) continue
    const path = session.cwd
    if (!isAbsoluteWorkspacePath(path)) continue
    const key = normalizeWorkspacePath(path)
    const existing = byPath.get(key)
    if (existing !== undefined) {
      existing.createdAt = earliestTimestamp(existing.createdAt, session.createdAt)
      existing.updatedAt = Math.max(existing.updatedAt, session.updatedAt)
      continue
    }
    const baseId = `cwd-${hashWorkspacePath(key)}`
    let id = baseId
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${baseId}-${suffix}`
    usedIds.add(id)
    byPath.set(key, {
      id,
      name: workspaceBasename(path),
      path,
      position: byPath.size,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
  }
  return [...byPath.values()]
}

export function projectCodexHistory(thread: unknown): DisplayHistoryItem[] {
  if (!isRecord(thread) || typeof thread.id !== 'string' || !Array.isArray(thread.turns)) return []
  const sessionId = `codex:${thread.id}`
  const output: DisplayHistoryItem[] = []
  for (const turn of thread.turns) {
    if (!isRecord(turn) || typeof turn.id !== 'string' || !Array.isArray(turn.items)) continue
    for (let index = 0; index < turn.items.length; index += 1) {
      const item = turn.items[index]
      output.push(projectCodexItem(item, thread.id, turn.id, sessionId, index))
    }
  }
  return output
}

/** Creates a replaceable persisted baseline before live notifications are reduced. */
export function createCodexTimelineState(thread: unknown): CodexTimelineState | undefined {
  const session = projectCodexThread(thread)
  if (session === undefined) return undefined
  const record = isRecord(thread) ? thread : {}
  const activeTurnId = findActiveTurnId(record.turns)
  return {
    session,
    items: projectCodexHistory(thread),
    ...(activeTurnId === undefined ? {} : { activeTurnId }),
  }
}

/**
 * Reduces official App Server notifications into the DSH display projection.
 * Persisted baselines replace this state after reconnect; mutations are never
 * replayed by the reducer.
 */
export function reduceCodexTimelineFrame(
  state: CodexTimelineState,
  frame: { method: string; params: unknown },
): CodexTimelineState {
  const params = isRecord(frame.params) ? frame.params : {}
  if (frame.method === 'thread/status/changed') {
    return { ...state, session: { ...state.session, status: projectThreadStatus(params.status) } }
  }
  if (frame.method === 'thread/name/updated' && typeof params.threadName === 'string') {
    return { ...state, session: { ...state.session, title: params.threadName } }
  }
  if (frame.method === 'thread/archived') return { ...state, session: { ...state.session, archived: true } }
  if (frame.method === 'thread/unarchived') return { ...state, session: { ...state.session, archived: false } }

  if (frame.method === 'turn/started') {
    const turn = isRecord(params.turn) ? params.turn : undefined
    const turnId = typeof turn?.id === 'string' ? turn.id : undefined
    return {
      ...state,
      items: turn === undefined ? state.items : upsertItems(state.items, projectTurn(turn, state.session.nativeId)),
      ...(turnId === undefined ? {} : { activeTurnId: turnId }),
      session: { ...state.session, status: 'running' },
    }
  }

  if (frame.method === 'item/started' || frame.method === 'item/completed') {
    const item = params.item
    const turnId = extractNotificationTurnId(params)
    if (turnId === undefined) return state
    return {
      ...state,
      items: upsertItems(state.items, [projectCodexItem(item, state.session.nativeId, turnId, state.session.id, state.items.length)]),
    }
  }

  if (frame.method === 'item/agentMessage/delta'
    && typeof params.itemId === 'string'
    && typeof params.delta === 'string') {
    const turnId = extractNotificationTurnId(params) ?? state.activeTurnId ?? 'active'
    const itemId = params.itemId
    const id = `codex:${state.session.nativeId}:${turnId}:${itemId}`
    const index = state.items.findIndex(item => item.id === id || item.nativeRef.itemId === itemId)
    if (index < 0) {
      return {
        ...state,
        items: [...state.items, {
          id,
          sessionId: state.session.id,
          backend: 'codex',
          kind: 'message',
          role: 'assistant',
          text: params.delta,
          status: 'running',
          nativeRef: { threadId: state.session.nativeId, turnId, itemId },
        }],
      }
    }
    const next = [...state.items]
    const current = next[index]!
    next[index] = { ...current, text: `${current.text ?? ''}${params.delta}`, status: 'running' }
    return { ...state, items: next }
  }

  if ((frame.method === 'item/reasoning/summaryTextDelta'
    || frame.method === 'item/reasoning/textDelta'
    || frame.method === 'item/plan/delta')
    && typeof params.itemId === 'string'
    && typeof params.delta === 'string') {
    const turnId = extractNotificationTurnId(params) ?? state.activeTurnId ?? 'active'
    const type = frame.method === 'item/plan/delta' ? 'plan' : 'reasoning'
    return appendOrCreateStatusItem(state, params.itemId, turnId, type, params.delta)
  }

  if (frame.method === 'turn/plan/updated' && Array.isArray(params.plan)) {
    const turnId = extractNotificationTurnId(params) ?? state.activeTurnId ?? 'active'
    const text = params.plan.flatMap(value => {
      const item = isRecord(value) ? value : undefined
      if (typeof item?.step !== 'string') return []
      const marker = item.status === 'completed' ? '[x]' : item.status === 'inProgress' ? '[~]' : '[ ]'
      return [`${marker} ${item.step}`]
    }).join('\n')
    return replaceOrCreateStatusItem(state, `plan:${turnId}`, turnId, 'plan', text)
  }

  if ((frame.method === 'item/commandExecution/outputDelta'
    || frame.method === 'item/fileChange/outputDelta')
    && typeof params.itemId === 'string'
    && typeof params.delta === 'string') {
    return appendItemText(state, params.itemId, params.delta)
  }

  if (frame.method === 'item/mcpToolCall/progress'
    && typeof params.itemId === 'string'
    && typeof params.message === 'string') {
    return appendItemText(state, params.itemId, `\n${params.message}`)
  }

  if (frame.method === 'item/fileChange/patchUpdated'
    && typeof params.itemId === 'string'
    && Array.isArray(params.changes)) {
    return replaceItemText(state, params.itemId, fileChangeText(params.changes))
  }

  if (frame.method === 'serverRequest/resolved' && state.approval !== undefined) {
    const requestHandle = state.approval.requestHandle
    return {
      ...state,
      approval: undefined,
      items: state.items.map(item => item.nativeRef.requestHandle === requestHandle
        ? { ...item, status: 'completed' as const }
        : item),
      session: { ...state.session, status: state.activeTurnId === undefined ? 'idle' : 'running' },
    }
  }

  if (frame.method === 'turn/completed') {
    const turn = isRecord(params.turn) ? params.turn : undefined
    const failed = turn?.status === 'failed' || turn?.error !== null && turn?.error !== undefined
    const next = {
      ...state,
      session: { ...state.session, status: failed ? 'failed' as const : 'idle' as const },
      items: turn === undefined ? state.items : upsertItems(state.items, projectTurn(turn, state.session.nativeId)),
      approval: undefined,
    }
    delete next.activeTurnId
    return next
  }

  if ((frame.method === 'item/commandExecution/requestApproval'
    || frame.method === 'item/fileChange/requestApproval')
    && typeof params.requestHandle === 'string') {
    const command = commandText(params.command)
    const approval: CodexPendingApproval = {
      requestHandle: params.requestHandle,
      kind: frame.method === 'item/commandExecution/requestApproval' ? 'command' : 'file-change',
      ...(command === undefined ? {} : { command }),
      ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
    }
    const turnId = extractNotificationTurnId(params)
    const approvalItem: DisplayHistoryItem = {
      id: `codex:${state.session.nativeId}:${turnId ?? 'approval'}:${params.requestHandle}`,
      sessionId: state.session.id,
      backend: 'codex',
      kind: 'approval',
      text: command ?? (approval.kind === 'file-change' ? 'File change approval' : 'Command approval'),
      status: 'running',
      nativeRef: {
        threadId: state.session.nativeId,
        ...(turnId === undefined ? {} : { turnId }),
        requestHandle: params.requestHandle,
      },
      details: {
        kind: approval.kind,
        ...(approval.reason === undefined ? {} : { reason: approval.reason }),
      },
    }
    return { ...state, approval, items: upsertItems(state.items, [approvalItem]), session: { ...state.session, status: 'waiting' } }
  }
  return state
}

export function projectCodexItem(
  value: unknown,
  threadId: string,
  turnId: string,
  sessionId: string,
  index: number,
): DisplayHistoryItem {
  const item = isRecord(value) ? value : {}
  const itemId = typeof item.id === 'string' ? item.id : `${turnId}:${index}`
  const type = typeof item.type === 'string' ? item.type : 'unknown'
  const base = {
    id: `codex:${threadId}:${turnId}:${itemId}`,
    sessionId,
    backend: 'codex' as const,
    nativeRef: { threadId, turnId, ...(typeof item.id === 'string' ? { itemId: item.id } : {}) },
    ...(normalizeTimestamp(item.createdAt) > 0 ? { createdAt: normalizeTimestamp(item.createdAt) } : {}),
  }
  if (type === 'userMessage') {
    const images = itemImages(item)
    return {
      ...base,
      kind: 'message',
      role: 'user',
      text: itemText(item),
      ...(images.length === 0 ? {} : { images }),
    }
  }
  if (type === 'agentMessage') {
    const images = itemImages(item)
    return {
      ...base,
      kind: 'message',
      role: 'assistant',
      text: itemText(item),
      ...(images.length === 0 ? {} : { images }),
      status: projectItemStatus(item.status),
    }
  }
  if (type === 'commandExecution') {
    return { ...base, kind: 'tool', text: commandExecutionText(item), status: projectItemStatus(item.status), details: { type } }
  }
  if (isToolItemType(type)) {
    const images = toolItemImages(item)
    return {
      ...base,
      kind: 'tool',
      text: toolCallText(item),
      ...(images.length === 0 ? {} : { images }),
      status: projectItemStatus(item.status),
      details: { type },
    }
  }
  if (type === 'fileChange') {
    return { ...base, kind: 'file-change', text: fileChangeText(item.changes), status: projectItemStatus(item.status), details: { type } }
  }
  if (type === 'plan' || type === 'reasoning') {
    return { ...base, kind: 'status', text: itemText(item) ?? textArray(item.summary) ?? type, details: { type } }
  }
  if (type === 'error') return { ...base, kind: 'error', text: itemText(item), status: 'failed', details: { type } }
  return { ...base, kind: 'unknown', text: `Unsupported Codex item: ${type}`, details: { type } }
}

function projectTurn(turn: Record<string, unknown>, threadId: string): DisplayHistoryItem[] {
  if (typeof turn.id !== 'string' || !Array.isArray(turn.items)) return []
  const sessionId = `codex:${threadId}`
  return turn.items.map((item, index) => projectCodexItem(item, threadId, turn.id as string, sessionId, index))
}

function upsertItems(current: DisplayHistoryItem[], incoming: DisplayHistoryItem[]): DisplayHistoryItem[] {
  if (incoming.length === 0) return current
  const next = [...current]
  for (const item of incoming) {
    const index = next.findIndex(value => value.id === item.id)
    if (index < 0) next.push(item)
    else next[index] = item
  }
  return next
}

function appendItemText(state: CodexTimelineState, itemId: string, delta: string): CodexTimelineState {
  const index = state.items.findIndex(item => item.nativeRef.itemId === itemId)
  if (index < 0) return state
  const items = [...state.items]
  const current = items[index]!
  items[index] = { ...current, text: boundedText(`${current.text ?? ''}${delta}`), status: 'running' }
  return { ...state, items }
}

function replaceItemText(state: CodexTimelineState, itemId: string, text: string): CodexTimelineState {
  const index = state.items.findIndex(item => item.nativeRef.itemId === itemId)
  if (index < 0) return state
  const items = [...state.items]
  items[index] = { ...items[index]!, text: boundedText(text), status: 'running' }
  return { ...state, items }
}

function appendOrCreateStatusItem(
  state: CodexTimelineState,
  itemId: string,
  turnId: string,
  type: 'reasoning' | 'plan',
  delta: string,
): CodexTimelineState {
  const index = state.items.findIndex(item => item.nativeRef.itemId === itemId && item.details?.type === type)
  if (index < 0) return replaceOrCreateStatusItem(state, itemId, turnId, type, delta)
  const items = [...state.items]
  const current = items[index]!
  items[index] = { ...current, text: boundedText(`${current.text ?? ''}${delta}`), status: 'running' }
  return { ...state, items }
}

function replaceOrCreateStatusItem(
  state: CodexTimelineState,
  itemId: string,
  turnId: string,
  type: 'reasoning' | 'plan',
  text: string,
): CodexTimelineState {
  const id = `codex:${state.session.nativeId}:${turnId}:${itemId}`
  const incoming: DisplayHistoryItem = {
    id,
    sessionId: state.session.id,
    backend: 'codex',
    kind: 'status',
    text: boundedText(text),
    status: 'running',
    nativeRef: { threadId: state.session.nativeId, turnId, itemId },
    details: { type },
  }
  const index = state.items.findIndex(item => item.id === id || item.nativeRef.itemId === itemId)
  if (index < 0) return { ...state, items: [...state.items, incoming] }
  const items = [...state.items]
  items[index] = incoming
  return { ...state, items }
}

function findActiveTurnId(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const turn = isRecord(value[index]) ? value[index] : undefined
    if (typeof turn?.id === 'string' && (turn.status === 'inProgress' || turn.status === 'running')) return turn.id
  }
  return undefined
}

function extractNotificationTurnId(params: Record<string, unknown>): string | undefined {
  if (typeof params.turnId === 'string') return params.turnId
  if (isRecord(params.turn) && typeof params.turn.id === 'string') return params.turn.id
  return undefined
}

function commandText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every(part => typeof part === 'string')) return value.join(' ')
  return undefined
}

function requireProjectedThread(result: unknown): DisplaySession {
  if (!isRecord(result)) throw invalidResponse('thread')
  const session = projectCodexThread(result.thread)
  if (session === undefined) throw invalidResponse('thread')
  return session
}

function projectThreadStatus(value: unknown): DisplaySession['status'] {
  if (!isRecord(value) || typeof value.type !== 'string') return 'idle'
  if (value.type === 'systemError') return 'failed'
  if (value.type !== 'active') return 'idle'
  return Array.isArray(value.activeFlags) && value.activeFlags.includes('waitingOnApproval') ? 'waiting' : 'running'
}

function projectItemStatus(value: unknown): DisplayHistoryItem['status'] {
  if (value === 'inProgress') return 'running'
  if (value === 'failed') return 'failed'
  if (value === 'declined') return 'declined'
  return 'completed'
}

function itemText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === 'string') return boundedText(item.text)
  if (typeof item.content === 'string') return boundedText(item.content)
  const content = Array.isArray(item.content)
    ? item.content
    : Array.isArray(item.input) ? item.input : undefined
  if (content === undefined) return undefined
  const parts = content.flatMap(value => {
    if (typeof value === 'string') return [value]
    if (!isRecord(value)) return []
    if (typeof value.text === 'string') return [value.text]
    return typeof value.content === 'string' ? [value.content] : []
  })
  return parts.length > 0 ? boundedText(parts.join('\n')) : undefined
}

function itemImages(item: Record<string, unknown>): DisplayImage[] {
  const content = Array.isArray(item.content)
    ? item.content
    : Array.isArray(item.input) ? item.input : []
  return content.flatMap(value => {
    if (!isRecord(value) || !isImageContent(value)) return []
    const uri = imageDataUri(value)
    if (uri === undefined) return []
    return [{
      uri,
      ...(typeof value.name === 'string' && value.name.length > 0 ? { name: value.name } : {}),
    }]
  })
}

function toolItemImages(item: Record<string, unknown>): DisplayImage[] {
  const candidates = [
    isRecord(item.result) ? item.result : undefined,
    isRecord(item.output) ? item.output : undefined,
    Array.isArray(item.contentItems) ? { content: item.contentItems } : undefined,
    Array.isArray(item.output) ? { content: item.output } : undefined,
  ]
  for (const candidate of candidates) {
    if (candidate === undefined || !Array.isArray(candidate.content)) continue
    const images = itemImages(candidate)
    if (images.length > 0) return images
  }
  return []
}

function isImageContent(value: Record<string, unknown>): boolean {
  return value.type === 'image' || value.type === 'input_image'
}

function imageDataUri(value: Record<string, unknown>): string | undefined {
  const url = typeof value.url === 'string'
    ? value.url
    : typeof value.image_url === 'string'
      ? value.image_url
      : isRecord(value.image_url) && typeof value.image_url.url === 'string'
        ? value.image_url.url
        : undefined
  const parsed = url === undefined ? undefined : parseDataImageUrl(url)
  if (parsed !== undefined) return parsed.url

  if (typeof value.data !== 'string' || !isCanonicalBase64(value.data)) return undefined
  const mediaType = typeof value.mediaType === 'string'
    ? value.mediaType
    : typeof value.mimeType === 'string' ? value.mimeType : sniffImageMediaType(value.data)
  return mediaType !== undefined && CODEX_IMAGE_MEDIA_TYPES.has(mediaType)
    ? `data:${mediaType};base64,${value.data}`
    : undefined
}

function parseDataImageUrl(value: string): { url: string; mediaType: string; data: string } | undefined {
  const match = DATA_IMAGE_URL.exec(value)
  if (match === null) return undefined
  const mediaType = match[1]!
  const data = match[2]!
  if (!CODEX_IMAGE_MEDIA_TYPES.has(mediaType) || !isCanonicalBase64(data)) return undefined
  return { url: `data:${mediaType};base64,${data}`, mediaType, data }
}

function isCanonicalBase64(value: string): boolean {
  return value.length >= 4 && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
}

function sniffImageMediaType(data: string): string | undefined {
  const bytes = base64PrefixBytes(data, 32)
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61) return 'image/gif'
  if (bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

function base64PrefixBytes(value: string, maxBytes: number): Uint8Array {
  const chars = value.slice(0, Math.ceil(maxBytes / 3) * 4)
  let binary: string
  try {
    binary = atob(chars)
  } catch {
    return new Uint8Array()
  }
  const bytes = new Uint8Array(Math.min(binary.length, maxBytes))
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function isToolItemType(type: string): boolean {
  return type === 'mcpToolCall'
    || type === 'dynamicToolCall'
    || type === 'functionCallOutput'
    || type === 'hookPrompt'
    || type === 'collabAgentToolCall'
    || type === 'subAgentActivity'
    || type === 'webSearch'
    || type === 'imageView'
    || type === 'imageGeneration'
    || type === 'sleep'
    || type === 'enteredReviewMode'
    || type === 'exitedReviewMode'
    || type === 'contextCompaction'
}

function toolLabel(item: Record<string, unknown>): string | undefined {
  if (typeof item.tool === 'string') return item.tool
  if (typeof item.server === 'string' && typeof item.name === 'string') return `${item.server}: ${item.name}`
  if (typeof item.command === 'string') return item.command
  if (Array.isArray(item.command) && item.command.every(value => typeof value === 'string')) return item.command.join(' ')
  return typeof item.type === 'string' ? item.type : undefined
}

function commandExecutionText(item: Record<string, unknown>): string | undefined {
  const command = toolLabel(item)
  const output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : undefined
  if (command === undefined) return output === undefined ? undefined : boundedText(output)
  return boundedText(output === undefined || output === '' ? command : `${command}\n\n${output}`)
}

function toolCallText(item: Record<string, unknown>): string | undefined {
  const type = typeof item.type === 'string' ? item.type : undefined
  if (type === 'webSearch') {
    const count = Array.isArray(item.results) ? item.results.length : 0
    return count === 0 ? 'Web search completed.' : `Web search returned ${count} result${count === 1 ? '' : 's'}.`
  }
  if (type === 'imageView') return `Viewed image: ${typeof item.path === 'string' ? item.path : 'image'}`
  if (type === 'imageGeneration') {
    return typeof item.savedPath === 'string'
      ? `Generated image: ${item.savedPath}`
      : `Image generation ${typeof item.status === 'string' ? item.status : 'completed'}.`
  }
  if (type === 'contextCompaction') return 'CodeX compacted the conversation context.'
  if (type === 'enteredReviewMode' || type === 'exitedReviewMode') {
    const action = type === 'enteredReviewMode' ? 'Entered' : 'Exited'
    return `${action} review mode${typeof item.review === 'string' ? `: ${item.review}` : '.'}`
  }
  if (type === 'sleep') return `Waited ${typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? item.durationMs : 0} ms.`
  if (type === 'subAgentActivity') {
    const kind = isRecord(item.kind) && typeof item.kind.type === 'string'
      ? item.kind.type
      : typeof item.kind === 'string' ? item.kind : 'Subagent activity'
    return [kind, typeof item.agentPath === 'string' ? item.agentPath : undefined]
      .filter((value): value is string => value !== undefined).join(': ')
  }
  const label = toolLabel(item)
  const error = compactUnknown(item.error)
  const rawResult = item.result ?? item.contentItems
  const result = itemText(isRecord(rawResult) ? rawResult : {})
    ?? (toolItemImages(item).length > 0 ? undefined : compactUnknown(rawResult))
  return boundedText([label, error, result].filter((value): value is string => value !== undefined && value !== '').join('\n\n')) || undefined
}

function fileChangeText(value: unknown): string {
  if (!Array.isArray(value)) return 'File changes'
  const changes = value.flatMap(change => {
    if (!isRecord(change) || typeof change.path !== 'string') return []
    const kind = typeof change.kind === 'string' ? change.kind : 'update'
    return [`[${kind}] ${change.path}`]
  })
  return boundedText(changes.length === 0 ? 'File changes' : changes.join('\n'))
}

function textArray(value: unknown): string | undefined {
  return Array.isArray(value) && value.every(part => typeof part === 'string')
    ? boundedText(value.join('\n'))
    : undefined
}

function compactUnknown(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return boundedText(value)
  try {
    return boundedText(JSON.stringify(value, undefined, 2))
  } catch {
    return undefined
  }
}

function boundedText(value: string): string {
  return value.length <= MAX_DISPLAY_ITEM_TEXT
    ? value
    : `${value.slice(0, MAX_DISPLAY_ITEM_TEXT)}\n…`
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/[\\/]+$/u, '') || value
}

function isAbsoluteWorkspacePath(value: string): boolean {
  return value.startsWith('/')
    || /^\\\\[^\\]+\\[^\\]+/u.test(value)
    || /^[A-Za-z]:[\\/]/u.test(value)
}

function workspaceBasename(value: string): string {
  const normalized = normalizeWorkspacePath(value)
  return normalized.split(/[\\/]/u).at(-1) || value
}

function earliestTimestamp(left: number, right: number): number {
  if (left <= 0) return right
  if (right <= 0) return left
  return Math.min(left, right)
}

function hashWorkspacePath(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value < 10_000_000_000 ? value * 1_000 : value
}

function bytesToBase64(value: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < value.length; index += 1) binary += String.fromCharCode(value[index]!)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw invalidResponse('transfer data')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (bytesToBase64(bytes) !== value) throw invalidResponse('transfer data')
  return bytes
}

function invalidResponse(part: string): RemoteGatewayError {
  return new RemoteGatewayError('INVALID_MESSAGE', `The Host returned an invalid Codex ${part}.`)
}

function codexStreamCloseReason(value: unknown): CodexAppStreamClosedData['reason'] {
  return value === 'cancelled'
    || value === 'completed'
    || value === 'failed'
    || value === 'peer-disconnected'
    ? value
    : 'failed'
}

function createCodexTransferId(): string {
  if (globalThis.crypto?.randomUUID !== undefined) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues !== undefined) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
