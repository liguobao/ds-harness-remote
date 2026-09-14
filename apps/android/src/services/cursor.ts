import type { AgentAcpClient } from '@dsh-remote/client-core'
import type { AgentAcpFrameData } from '@dsh-remote/protocol'
import type {
  ApprovalActivity,
  ChatItem,
  ChatMessage,
  RemoteSession,
  ToolActivity,
  WorkspaceView,
} from '../types'

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

export function cursorNativeId(session: RemoteSession): string {
  if (session.nativeId !== undefined && session.nativeId.length > 0) return session.nativeId
  if (session.sessionId.startsWith('cursor:')) return session.sessionId.slice('cursor:'.length)
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

/** In-flight assistant bubble; must be renamed on prompt_completed so turns do not merge. */
const CURSOR_ASSISTANT_LIVE_ID = 'cursor-assistant-live'
let cursorAssistantSeq = 0

export async function createCursorWorkspaceSession(
  client: AgentAcpClient,
  path: string,
  mode: 'agent' | 'plan' | 'ask' = 'agent',
): Promise<{ workspace: WorkspaceView; session: RemoteSession }> {
  const created = await client.createSession(path, mode)
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

function applySessionUpdate(messages: ChatItem[], sessionId: string, params: Record<string, unknown>): ChatItem[] {
  const update = isRecord(params.update) ? params.update : params
  const kind = stringValue(update.sessionUpdate) ?? stringValue(update.type)
  if (kind === 'agent_message_chunk' || kind === 'agent_message') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
    return appendAssistantDelta(messages, sessionId, text, CURSOR_ASSISTANT_LIVE_ID)
  }
  if (kind === 'agent_thought_chunk' || kind === 'agent_thought') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
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
    return finalizeAssistantLive(next)
  }
  if (kind === 'user_message_chunk') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
    return appendUserDelta(messages, sessionId, text, 'cursor-user-live')
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const toolName = stringValue(update.title) ?? stringValue(update.toolName) ?? stringValue(update.name) ?? 'tool'
    const state = stringValue(update.status) === 'failed' ? 'failed'
      : stringValue(update.status) === 'completed' ? 'finished'
        : 'running'
    const id = `cursor-tool:${stringValue(update.toolCallId) ?? toolName}`
    const next: ToolActivity = {
      kind: 'tool',
      id,
      sessionId,
      toolName,
      state,
      createdAt: Date.now(),
    }
    const existing = messages.findIndex(item => item.kind === 'tool' && item.id === id)
    if (existing >= 0) {
      const copy = messages.slice()
      copy[existing] = { ...messages[existing]!, ...next }
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
  const toolName = method === 'cursor/create_plan'
    ? (stringValue(params.name) ?? 'plan')
    : method === 'cursor/ask_question'
      ? (stringValue(params.title) ?? 'question')
      : (stringValue(params.toolName) ?? 'permission')
  const reason = method === 'cursor/create_plan'
    ? stringValue(params.overview) ?? stringValue(params.plan)
    : method === 'cursor/ask_question'
      ? summarizeQuestions(params)
      : stringValue(params.reason)
  const item: ApprovalActivity = {
    kind: 'approval',
    id,
    sessionId,
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
    text: '',
    reasoning: text,
    createdAt: Date.now(),
    streaming: true,
    streamingPhase: 'reasoning',
  }]
}

function finalizeAssistantLive(messages: ChatItem[]): ChatItem[] {
  let changed = false
  const next = messages.map(item => {
    if (item.kind !== 'message' || item.id !== CURSOR_ASSISTANT_LIVE_ID) return item
    changed = true
    return {
      ...item,
      id: `cursor-assistant:${++cursorAssistantSeq}`,
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
