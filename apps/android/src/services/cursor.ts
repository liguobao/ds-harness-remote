import type { AgentAcpClient } from '@dsh-remote/client-core'
import type { AgentAcpFrameData } from '@dsh-remote/protocol'
import type {
  ApprovalActivity,
  ChatItem,
  ChatMessage,
  HistoryEntry,
  NativeSessionEvent,
  RemoteSession,
  ToolActivity,
  WorkspaceView,
} from '../types'
import { foldHistory } from '../state/event-reducer'

export function cursorWorkspaceId(path: string): string {
  return `cursor:cwd:${encodeURIComponent(path)}`
}

export function cursorWorkspacePath(workspaceId: string): string | undefined {
  if (!workspaceId.startsWith('cursor:cwd:')) return undefined
  try {
    return decodeURIComponent(workspaceId.slice('cursor:cwd:'.length))
  } catch {
    return undefined
  }
}

export function antigravityWorkspaceId(path: string): string {
  return `antigravity:cwd:${encodeURIComponent(path)}`
}

export function antigravityWorkspacePath(workspaceId: string): string | undefined {
  if (!workspaceId.startsWith('antigravity:cwd:')) return undefined
  try {
    return decodeURIComponent(workspaceId.slice('antigravity:cwd:'.length))
  } catch {
    return undefined
  }
}

export function piWorkspaceId(path: string): string {
  return `pi:cwd:${encodeURIComponent(path)}`
}

export function piWorkspacePath(workspaceId: string): string | undefined {
  if (!workspaceId.startsWith('pi:cwd:')) return undefined
  try {
    return decodeURIComponent(workspaceId.slice('pi:cwd:'.length))
  } catch {
    return undefined
  }
}

export function opencodeWorkspaceId(path: string): string {
  return `opencode:cwd:${encodeURIComponent(path)}`
}

export function claudeWorkspaceId(path: string): string {
  return `claude:cwd:${encodeURIComponent(path)}`
}

export function hermesWorkspaceId(path: string): string {
  return `hermes:cwd:${encodeURIComponent(path)}`
}

export function opencodeWorkspacePath(workspaceId: string): string | undefined {
  if (!workspaceId.startsWith('opencode:cwd:')) return undefined
  try {
    return decodeURIComponent(workspaceId.slice('opencode:cwd:'.length))
  } catch {
    return undefined
  }
}

export function createCursorWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: cursorWorkspaceId(path),
    backend: 'cursor',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createPiWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: piWorkspaceId(path),
    backend: 'pi',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createAntigravityWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: antigravityWorkspaceId(path),
    backend: 'antigravity',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createOpencodeWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: opencodeWorkspaceId(path),
    backend: 'opencode',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createClaudeWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: claudeWorkspaceId(path),
    backend: 'claude',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function cursorNativeId(session: RemoteSession): string {
  if (session.nativeId !== undefined && session.nativeId.length > 0) return session.nativeId
  if (session.sessionId.startsWith('cursor:')) return session.sessionId.slice('cursor:'.length)
  if (session.sessionId.startsWith('pi:')) return session.sessionId.slice('pi:'.length)
  if (session.sessionId.startsWith('antigravity:')) return session.sessionId.slice('antigravity:'.length)
  if (session.sessionId.startsWith('claude:')) return session.sessionId.slice('claude:'.length)
  if (session.sessionId.startsWith('hermes:')) return session.sessionId.slice('hermes:'.length)
  if (session.sessionId.startsWith('opencode:')) return session.sessionId.slice('opencode:'.length)
  return session.sessionId
}

export function createCursorSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `cursor:${input.acpSessionId}`,
    backend: 'cursor',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'cursor' },
    },
  }
}

export function createPiSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `pi:${input.acpSessionId}`,
    backend: 'pi',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'pi' },
    },
  }
}

export function createAntigravitySession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `antigravity:${input.acpSessionId}`,
    backend: 'antigravity',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'antigravity', imageLimits: {
        maxImageBytes: 8 * 1024 * 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 32 * 1024 * 1024,
        maxImagePixels: 40_000_000, maxImageDimension: 8192, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      } },
    },
  }
}

export function createOpencodeSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `opencode:${input.acpSessionId}`,
    backend: 'opencode',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'opencode' },
    },
  }
}

export function createHermesWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: hermesWorkspaceId(path),
    backend: 'hermes',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createHermesSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `hermes:${input.acpSessionId}`,
    backend: 'hermes',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'hermes' },
    },
  }
}

export function createClaudeSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `claude:${input.acpSessionId}`,
    backend: 'claude',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'claude' },
    },
  }
}

/** In-flight assistant bubble; must be renamed on prompt_completed so turns do not merge. */
const CURSOR_ASSISTANT_LIVE_ID = 'cursor-assistant-live'
let cursorAssistantSeq = 0
let acpTurnSeq = 0

/** ACP has no native turn number; scope activity to one prompt in this session's projection. */
function activeAcpTurn(messages: ChatItem[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const item = messages[index]!
    if ((item.kind === 'message' && item.role === 'user') || item.turnEnd !== undefined) return undefined
    if (item.turn?.startsWith('acp-live:')) return item.turn
  }
  return undefined
}

function acpTurn(messages: ChatItem[]): string {
  return activeAcpTurn(messages) ?? `acp-live:${++acpTurnSeq}`
}

export async function createCursorWorkspaceSession(
  client: AgentAcpClient,
  path: string,
  mode: 'agent' | 'plan' | 'ask' = 'agent',
): Promise<{ workspace: WorkspaceView; session: RemoteSession }> {
  const created = await client.createSession(path, mode, 'cursor')
  const workspace = createCursorWorkspace(path)
  const session = createCursorSession({
    acpSessionId: created.sessionId,
    cwd: path,
    title: workspace.title,
  })
  return {
    workspace: { ...workspace, sessionIds: [session.sessionId], updatedAt: new Date().toISOString() },
    session,
  }
}

export async function createAntigravityWorkspaceSession(
  client: AgentAcpClient,
  path: string,
  mode: 'agent' | 'plan' | 'ask' = 'agent',
): Promise<{ workspace: WorkspaceView; session: RemoteSession }> {
  const created = await client.createSession(path, mode, 'antigravity')
  const workspace = createAntigravityWorkspace(path)
  const session = createAntigravitySession({
    acpSessionId: created.sessionId,
    cwd: path,
  })
  return {
    workspace: { ...workspace, sessionIds: [session.sessionId], updatedAt: new Date().toISOString() },
    session,
  }
}

export async function createOpencodeWorkspaceSession(
  client: AgentAcpClient,
  path: string,
  mode: 'agent' | 'plan' | 'ask' = 'agent',
): Promise<{ workspace: WorkspaceView; session: RemoteSession }> {
  const created = await client.createSession(path, mode, 'opencode')
  const workspace = createOpencodeWorkspace(path)
  const session = createOpencodeSession({
    acpSessionId: created.sessionId,
    cwd: path,
  })
  return {
    workspace: { ...workspace, sessionIds: [session.sessionId], updatedAt: new Date().toISOString() },
    session,
  }
}

/** Apply a live Agent ACP frame onto the in-memory Cursor chat list. */
export function applyCursorFrame(messages: ChatItem[], sessionId: string, frame: AgentAcpFrameData): ChatItem[] {
  const method = frame.frame.method
  const params = isRecord(frame.frame.params) ? frame.frame.params : {}
  if (method === 'session/update') return applySessionUpdate(messages, sessionId, params)
  if (method === 'session/request_permission' || method === 'cursor/ask_question' || method === 'cursor/create_plan') {
    return upsertApproval(messages, sessionId, params, method)
  }
  if (method === 'cursor/update_todos') {
    const text = summarizeTodos(params)
    if (text === undefined) return messages
    return appendAssistantDelta(messages, sessionId, `\n\n${text}`, `cursor-todo:${stringValue(params.toolCallId) ?? Date.now()}`)
  }
  return messages
}

/**
 * ACP history and live have different synthetic IDs and no shared sequence cursor.
 * Only reconcile the contiguous history suffix / new-subscription prefix, never
 * globally dedupe identical answers (which may belong to separate turns).
 */
export function mergeAcpHistoryAndLive(history: ChatItem[], live: ChatItem[]): ChatItem[] {
  const same = (a: ChatItem, b: ChatItem): boolean => {
    if (a.kind !== b.kind) return false
    if (a.kind === 'message' && b.kind === 'message') {
      return a.role === b.role && a.text === b.text && (a.reasoning ?? '') === (b.reasoning ?? '')
        && a.images === undefined && b.images === undefined
    }
    if (a.kind === 'tool' && b.kind === 'tool') {
      // ACP live tool IDs contain a local turn prefix; history uses the call ID.
      return b.id.endsWith(`:${a.id}`) && a.toolName === b.toolName
    }
    return a.id === b.id
  }
  for (let count = Math.min(history.length, live.length); count > 0; count--) {
    const suffix = history.slice(history.length - count)
    // Text alone is not identity: two independent turns can say the same thing.
    // Require a shared ID or a tool call anchor before collapsing an overlap.
    const anchored = live.slice(0, count).some((item, index) => {
      const previous = suffix[index]!
      return previous.id === item.id || (previous.kind === 'tool' && item.kind === 'tool' && same(previous, item))
    })
    if (anchored && live.slice(0, count).every((item, index) => same(suffix[index]!, item))) {
      // Prefer live rows at the boundary: preserve completion/stream state and
      // keep their IDs so subsequent chunks update rather than duplicate them.
      const overlap = live.slice(0, count).map((item, index) => {
        const previous = suffix[index]!
        const nativeTime = item.nativeTime ?? previous.nativeTime
        return item.kind === 'tool' && previous.kind === 'tool'
          ? { ...previous, ...item,
              state: item.state === 'running' && previous.state !== 'running' ? previous.state : item.state,
              arguments: item.arguments ?? previous.arguments,
              callDetail: item.callDetail ?? previous.callDetail, resultDetail: item.resultDetail ?? previous.resultDetail }
          : nativeTime === undefined ? item : { ...item, nativeTime }
      })
      return [...history.slice(0, history.length - count), ...overlap, ...live.slice(count)]
    }
  }
  return [...history, ...live]
}

/** Fold Host ACP transcript events into the Android chat projection. */
export function foldAcpHistory(events: unknown[], sessionId: string): ChatItem[] {
  const entries: HistoryEntry[] = []
  for (const [index, value] of events.entries()) {
    if (!isRecord(value) || !isRecord(value.event)) continue
    const raw = value.event
    if (typeof raw.type !== 'string' || !isRecord(raw.data)) continue
    const event: NativeSessionEvent = {
      type: raw.type,
      seq: typeof raw.seq === 'number' && Number.isSafeInteger(raw.seq) && raw.seq >= 0 ? raw.seq : index,
      time: typeof raw.time === 'number' && Number.isFinite(raw.time) && raw.time > 0 ? raw.time : 0,
      data: raw.data,
    }
    entries.push({ event })
  }
  return foldHistory(entries, sessionId, true)
}

function applySessionUpdate(messages: ChatItem[], sessionId: string, params: Record<string, unknown>): ChatItem[] {
  const update = isRecord(params.update) ? params.update : params
  const kind = stringValue(update.sessionUpdate) ?? stringValue(update.type)
  if (kind === 'agent_message_chunk' || kind === 'agent_message') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
    messages = retireAssistantBeforeActivity(messages)
    return appendAssistantDelta(messages, sessionId, text, CURSOR_ASSISTANT_LIVE_ID)
  }
  if (kind === 'agent_thought_chunk' || kind === 'agent_thought') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
    messages = retireAssistantBeforeActivity(messages)
    return appendAssistantReasoningDelta(messages, sessionId, text, CURSOR_ASSISTANT_LIVE_ID)
  }
  if (kind === 'prompt_completed' || kind === 'prompt_failed') {
    let next = messages
    const live = next.find(item => item.kind === 'message' && item.id === CURSOR_ASSISTANT_LIVE_ID)
    const hasLiveContent = live !== undefined
      && live.kind === 'message'
      && ((live.text?.length ?? 0) > 0 || (live.reasoning?.length ?? 0) > 0)
    if (!hasLiveContent && Array.isArray(update.catchUp)) {
      for (const item of update.catchUp) {
        if (!isRecord(item) || typeof item.method !== 'string') continue
        next = applyCursorFrame(next, sessionId, {
          streamId: 'catch-up',
          frame: { method: item.method, params: item.params },
        })
      }
    }
    // Retire the live id so the next turn opens a new left-side bubble instead
    // of appending into the previous assistant message.
    const reason = kind === 'prompt_failed' ? 'failed'
      : update.stopReason === 'cancelled' || update.stopReason === 'aborted' || update.stopReason === 'interrupted'
        ? 'stopped' : 'completed'
    const turn = activeAcpTurn(next)
    const time = Date.now()
    return finalizeAssistantLive(next).map(item => turn !== undefined && item.turn === turn
      ? { ...item, turnEnd: { reason, time },
          ...(item.kind === 'tool' && item.state === 'running' ? { state: reason === 'completed' ? 'finished' as const : 'failed' as const } : {}) }
      : item)
  }
  if (kind === 'user_message_chunk') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
    return appendUserDelta(messages, sessionId, text, 'cursor-user-live')
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    // A spoken reply closes the preceding activity range, as it does in DSH.
    // Retain its position when another tool starts instead of appending later text into it.
    const live = messages.find(item => item.id === CURSOR_ASSISTANT_LIVE_ID)
    if (kind === 'tool_call' && live?.kind === 'message' && live.text.trim() !== '') {
      messages = finalizeAssistantLive(messages)
    }
    const callId = stringValue(update.toolCallId) ?? stringValue(update.callId) ?? stringValue(update.name) ?? 'tool'
    const turn = acpTurn(messages)
    const id = `cursor-tool:${turn}:${callId}`
    const existing = messages.findIndex(item => item.kind === 'tool' && item.id === id)
    const previous = existing < 0 ? undefined : messages[existing] as ToolActivity
    const toolName = stringValue(update.title) ?? stringValue(update.toolName) ?? stringValue(update.name) ?? previous?.toolName ?? 'tool'
    // Pi streams bash output as deltas in ACP metadata, not rawOutput.
    // Keep this backend-specific until other adapters declare the same semantics.
    const meta = sessionId.startsWith('pi:') && isRecord(update._meta) ? update._meta : {}
    const terminalOutput = isRecord(meta.terminal_output) ? meta.terminal_output : {}
    const terminalExit = isRecord(meta.terminal_exit) ? meta.terminal_exit : {}
    const exitCode = typeof terminalExit.exit_code === 'number' && Number.isInteger(terminalExit.exit_code)
      ? terminalExit.exit_code : undefined
    const state = stringValue(update.status) === 'failed' || (exitCode !== undefined && exitCode !== 0)
      || (sessionId.startsWith('pi:') && previous?.state === 'failed') ? 'failed'
      : exitCode !== undefined || stringValue(update.status) === 'completed' || (kind === 'tool_call_update' && update.output !== undefined) ? 'finished'
        : sessionId.startsWith('pi:') ? previous?.state ?? 'running' : 'running'
    const argumentsText = boundedDetail(update.rawInput ?? update.parameters)
    const delta = typeof terminalOutput.data === 'string' ? terminalOutput.data : undefined
    const output = delta === undefined ? boundedDetail(update.rawOutput ?? update.output ?? update.content)
      : `${previous?.resultDetail?.text ?? ''}${delta}`.slice(-16_000)
    const next: ToolActivity = {
      ...previous,
      kind: 'tool', id, sessionId, turn, toolName, state,
      ...(stringValue(update.toolName) ?? stringValue(update.name) ? { toolKey: stringValue(update.toolName) ?? stringValue(update.name) } : {}),
      createdAt: previous?.createdAt ?? Date.now(),
      ...(argumentsText === undefined ? {} : { arguments: argumentsText, callDetail: { text: argumentsText, format: 'code' } }),
      ...(output === undefined ? {} : { resultDetail: { text: output, format: 'code' } }),
    }
    if (existing >= 0) {
      const copy = messages.slice()
      copy[existing] = next
      return copy
    }
    return [...messages, next]
  }
  return messages
}

function upsertApproval(
  messages: ChatItem[],
  sessionId: string,
  params: Record<string, unknown>,
  method: string,
): ChatItem[] {
  const requestHandle = stringValue(params.requestHandle)
  if (requestHandle === undefined) return messages
  const id = `cursor-approval:${requestHandle}`
  const toolCall = isRecord(params.toolCall) ? params.toolCall : {}
  const rawInput = isRecord(toolCall.rawInput) ? toolCall.rawInput : {}
  const toolName = method === 'cursor/create_plan'
    ? (stringValue(params.name) ?? 'plan')
    : method === 'cursor/ask_question'
      ? (stringValue(params.title) ?? 'question')
      : (stringValue(params.toolName) ?? stringValue(toolCall.title) ?? 'permission')
  const reason = method === 'cursor/create_plan'
    ? stringValue(params.overview) ?? stringValue(params.plan)
    : method === 'cursor/ask_question'
      ? summarizeQuestions(params)
      : boundedDetail(stringValue(params.reason) ?? stringValue(rawInput.message) ?? toolCall.rawInput)
  const item: ApprovalActivity = {
    kind: 'approval',
    id,
    sessionId,
    turn: acpTurn(messages),
    approvalId: requestHandle,
    toolName,
    ...(reason === undefined ? {} : { reason }),
    createdAt: Date.now(),
  }
  const existing = messages.findIndex(entry => entry.id === id)
  if (existing >= 0) {
    const copy = messages.slice()
    const previous = messages[existing]!
    copy[existing] = previous.kind === 'approval'
      ? { ...previous, ...item }
      : item
    return copy
  }
  return [...messages, item]
}

function appendAssistantDelta(messages: ChatItem[], sessionId: string, text: string, id: string): ChatItem[] {
  const existing = messages.findIndex(item => item.kind === 'message' && item.id === id)
  if (existing >= 0) {
    const current = messages[existing] as ChatMessage
    const copy = messages.slice()
    copy[existing] = {
      ...current,
      text: `${current.text ?? ''}${text}`,
      streaming: true,
      streamingPhase: 'text',
    }
    return copy
  }
  return [...messages, {
    kind: 'message',
    id,
    sessionId,
    role: 'assistant',
    turn: acpTurn(messages),
    text,
    createdAt: Date.now(),
    streaming: true,
    streamingPhase: 'text',
  }]
}

/** Map ACP `agent_thought_chunk` onto the same live assistant bubble as Harness reasoning. */
function appendAssistantReasoningDelta(
  messages: ChatItem[],
  sessionId: string,
  text: string,
  id: string,
): ChatItem[] {
  const existing = messages.findIndex(item => item.kind === 'message' && item.id === id)
  if (existing >= 0) {
    const current = messages[existing] as ChatMessage
    const copy = messages.slice()
    copy[existing] = {
      ...current,
      reasoning: `${current.reasoning ?? ''}${text}`,
      streaming: true,
      streamingPhase: current.text ? 'text' : 'reasoning',
    }
    return copy
  }
  return [...messages, {
    kind: 'message',
    id,
    sessionId,
    role: 'assistant',
    turn: acpTurn(messages),
    text: '',
    reasoning: text,
    createdAt: Date.now(),
    streaming: true,
    streamingPhase: 'reasoning',
  }]
}

function retireAssistantBeforeActivity(messages: ChatItem[]): ChatItem[] {
  const index = messages.findIndex(item => item.id === CURSOR_ASSISTANT_LIVE_ID)
  return index >= 0 && index < messages.length - 1 ? finalizeAssistantLive(messages) : messages
}

function finalizeAssistantLive(messages: ChatItem[]): ChatItem[] {
  let changed = false
  const next = messages.map(item => {
    if (item.kind !== 'message' || (item.id !== CURSOR_ASSISTANT_LIVE_ID && item.id !== 'cursor-user-live')) return item
    changed = true
    return {
      ...item,
      id: `${item.role === 'user' ? 'cursor-user' : 'cursor-assistant'}:${++cursorAssistantSeq}`,
      streaming: false,
      streamingPhase: undefined,
    }
  })
  return changed ? next : messages
}

function appendUserDelta(messages: ChatItem[], sessionId: string, text: string, id: string): ChatItem[] {
  const existing = messages.findIndex(item => item.kind === 'message' && item.id === id)
  if (existing >= 0) {
    const current = messages[existing] as ChatMessage
    const copy = messages.slice()
    copy[existing] = { ...current, text: `${current.text ?? ''}${text}` }
    return copy
  }
  return [...messages, {
    kind: 'message',
    id,
    sessionId,
    role: 'user',
    text,
    createdAt: Date.now(),
  }]
}

function boundedDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return text?.slice(0, 16_000)
  } catch { return undefined }
}

function extractText(update: Record<string, unknown>): string | undefined {
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

function summarizeTodos(params: Record<string, unknown>): string | undefined {
  if (!Array.isArray(params.todos)) return undefined
  const lines = params.todos
    .map(todo => {
      if (!isRecord(todo)) return undefined
      const content = stringValue(todo.content)
      const status = stringValue(todo.status) ?? 'pending'
      return content === undefined ? undefined : `- [${status}] ${content}`
    })
    .filter((line): line is string => line !== undefined)
  return lines.length === 0 ? undefined : `Todos:\n${lines.join('\n')}`
}

function summarizeQuestions(params: Record<string, unknown>): string | undefined {
  if (!Array.isArray(params.questions)) return undefined
  const lines = params.questions
    .map(question => (isRecord(question) ? stringValue(question.prompt) : undefined))
    .filter((line): line is string => line !== undefined)
  return lines.length === 0 ? undefined : lines.join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
