import type { HistoryEntry, ApprovalOutcome, ChatItem, ChatMessage, MuxStreamFrame, NativeSessionEvent, ToolActivity, ToolDisplayDetail } from '../types'

type UnknownRecord = Record<string, unknown>

const MAX_TOOL_DETAIL_CHARS = 64_000
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const DATA_IMAGE_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u

/** Fold a native history event window into ordered chat items. */
export function foldHistory(events: HistoryEntry[], sessionId: string, captureContext = false): ChatItem[] {
  let items: ChatItem[] = []
  for (const entry of events) {
    items = applyNativeEvent(items, entry.event, sessionId, entry.view, captureContext)
  }
  return items
}

/** Apply one live mux frame to the current chat items. */
export function applyMuxFrame(current: ChatItem[], frame: MuxStreamFrame, captureContext = false): ChatItem[] {
  const payload = frame.payload
  if (payload.type === 'session/event' && isRecord(payload.event)) {
    const sessionId = stringValue(payload.sessionId)
    if (sessionId === undefined) return current
    return applyNativeEvent(current, payload.event as NativeSessionEvent, sessionId, historyView(payload.view), captureContext)
  }
  if (payload.type === 'approval/requested') {
    return addApproval(current, payload as unknown as UnknownRecord, frame.rpcId)
  }
  if (payload.type === 'approval/resolved') {
    return resolveApproval(current, payload as unknown as UnknownRecord)
  }
  if (payload.type === 'question/requested') {
    return addQuestion(current, payload as unknown as UnknownRecord, frame.rpcId)
  }
  if (payload.type === 'question/resolved') {
    return resolveQuestion(current, payload as unknown as UnknownRecord)
  }
  return current
}

/**
 * Project the Harness turn lifecycle carried by a mux frame into the session
 * list state. The message reducer intentionally ignores lifecycle events, but
 * the UI still needs `turn/end` to clear its generating indicator after a
 * completed or cancelled turn.
 */
export function sessionRunningForMuxFrame(frame: MuxStreamFrame): boolean | undefined {
  const payload = frame.payload
  if (payload.type !== 'session/event' || payload.event === undefined) return undefined
  if (payload.event.type === 'turn/start') return true
  if (payload.event.type === 'turn/end') return false
  return undefined
}

/** Route one aggregated mux frame into the message bucket owned by its session. */
export function applyMuxFrameToMessages(
  current: Record<string, ChatItem[]>,
  frame: MuxStreamFrame,
): Record<string, ChatItem[]> {
  const sessionId = stringValue(frame.payload.sessionId)
  if (sessionId === undefined) return current
  return {
    ...current,
    [sessionId]: applyMuxFrame(current[sessionId] ?? [], frame, true),
  }
}

function applyNativeEvent(
  current: ChatItem[], event: NativeSessionEvent, sessionId: string, view?: HistoryEntry['view'], captureContext = false,
): ChatItem[] {
  const contextEvent = event.type === 'system/message' || event.type === 'developer/message' || (event.type === 'user/message' && !isHumanUserMessage(event.data))
  const next = captureContext && contextEvent
    ? current.some(item => item.id === messageId(event.data)) ? current : [...current, {
        kind: 'message' as const, id: messageId(event.data), sessionId, role: 'system' as const,
        context: event.type !== 'system/message', text: messageText(event.data), createdAt: event.time,
      }]
    : reduceNativeEvent(current, event, sessionId, view)
  const time = typeof event.time === 'number' && Number.isFinite(event.time) && event.time > 0 ? event.time : undefined
  const usage = nativeUsage(event.data)
  return next.map(item => current.includes(item) ? item : {
    ...item,
    ...(Number.isSafeInteger(event.seq) && event.seq >= 0 ? { nativeSeq: event.seq } : {}),
    ...(time === undefined ? {} : { createdAt: time, nativeTime: time }),
    ...(replyGroup(event.data) === undefined ? {} : { turn: replyGroup(event.data) }),
    ...(item.kind === 'message' && usage !== undefined ? { usage } : {}),
  })
}

function nativeUsage(data: UnknownRecord): ChatMessage['usage'] {
  const records = Array.isArray(data.stream) ? data.stream : []
  const last = [...records].reverse().find(row => isRecord(row) && row.type === 'chunk' && isRecord(row.chunk) && row.chunk.type === 'usage')
  const value = data.usage ?? (isRecord(last) && isRecord(last.chunk) ? last.chunk.usage : undefined)
  if (!isRecord(value)) return undefined
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
  if (!count(value.inputTokens) || !count(value.outputTokens)) return undefined
  const usage: NonNullable<ChatMessage['usage']> = { inputTokens: value.inputTokens, outputTokens: value.outputTokens }
  for (const key of ['totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    if (value[key] === undefined) continue
    if (!count(value[key])) return undefined
    usage[key] = value[key]
  }
  if (usage.reasoningTokens !== undefined && usage.reasoningTokens > usage.outputTokens) return undefined
  const knownPrompt = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  if (!Number.isSafeInteger(knownPrompt)) return undefined
  if (usage.totalTokens !== undefined && (usage.totalTokens < knownPrompt + usage.outputTokens
    || (usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined && usage.totalTokens !== knownPrompt + usage.outputTokens))) return undefined
  if (usage.totalTokens === undefined && usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined) {
    const total = knownPrompt + usage.outputTokens
    if (Number.isSafeInteger(total)) usage.totalTokens = total
  }
  return usage
}

function reduceNativeEvent(
  current: ChatItem[],
  event: NativeSessionEvent,
  sessionId: string,
  view?: HistoryEntry['view'],
): ChatItem[] {
  const data = isRecord(event.data) ? event.data : {}
  if (event.type === 'user/message') return addUserMessage(current, data, sessionId)
  if (event.type === 'assistant/message') return addAssistantMessage(current, data, sessionId, event)
  if (event.type === 'assistant/chunk') return applyAssistantChunk(current, data, sessionId, event)
  if (event.type === 'tool/call') return applyToolCall(current, data, sessionId, 'running', view)
  if (event.type === 'tool/result') return applyToolCall(current, data, sessionId, 'finished', view)
  return current
}

function addUserMessage(current: ChatItem[], data: UnknownRecord, sessionId: string): ChatItem[] {
  // Harness also records model-facing plugin context (instructions, snapshots,
  // notices, and similar injected material) as `user/message`. Only the
  // explicit human source belongs in the conversation transcript.
  if (!isHumanUserMessage(data)) return current
  const id = messageId(data)
  const text = messageText(data)
  const persistedImages = messageImages(data)
  if (text.length === 0 && persistedImages.length === 0) return current
  const rpcId = messageRequestRpcId(data)
  const optimisticIndex = rpcId === undefined
    ? -1
    : current.findIndex(item => item.kind === 'message' && item.requestRpcId === rpcId)
  const optimistic = optimisticIndex < 0 ? undefined : current[optimisticIndex]
  const images = optimistic?.kind === 'message' && optimistic.images !== undefined
    ? optimistic.images
    : persistedImages
  const message: ChatMessage = {
    kind: 'message', id, sessionId, role: 'user', text, createdAt: now(data),
    ...(images.length === 0 ? {} : { images }),
  }
  if (optimisticIndex >= 0) {
    return current.map((item, index) => index === optimisticIndex ? message : item)
  }
  const existing = current.find(item => item.id === id)
  if (existing !== undefined) return current
  return [...current, message]
}

function isHumanUserMessage(data: UnknownRecord): boolean {
  const message = isRecord(data.message) ? data.message : data
  const source = isRecord(message.source) ? message.source : undefined
  return source?.kind === 'user'
}

function addAssistantMessage(current: ChatItem[], data: UnknownRecord, sessionId: string, event: NativeSessionEvent): ChatItem[] {
  const id = messageId(data)
  const text = messageText(data)
  const reasoning = messageReasoning(data)
  const key = stepKey(event)
  const streamingIndex = current.findIndex(item =>
    item.kind === 'message' && item.streaming === true && item.id === `stream:${key}`)
  const streamed = streamingIndex < 0 ? undefined : current[streamingIndex]
  const finalText = hasVisibleMessageText(text)
    ? text
    : streamed?.kind === 'message' ? streamed.text : ''
  const finalReasoning = hasVisibleMessageText(reasoning)
    ? reasoning
    : streamed?.kind === 'message' ? streamed.reasoning : undefined
  const group = replyGroup(data) ?? (streamed?.kind === 'message' ? streamed.replyGroup : undefined)
  if (!hasVisibleMessageText(finalText) && !hasVisibleMessageText(finalReasoning ?? '')) {
    // Native assistant messages may contain only tool/content metadata. They
    // are not chat text and must not leave an empty avatar/"Remote" row.
    if (streamingIndex < 0) return current
    return current.filter((_, index) => index !== streamingIndex)
  }
  const message: ChatMessage = {
    kind: 'message', id, sessionId, role: 'assistant', text: finalText, createdAt: now(data),
    ...(group === undefined ? {} : { replyGroup: group }),
    ...(finalReasoning === undefined ? {} : { reasoning: finalReasoning }),
  }
  if (streamingIndex >= 0) {
    return current.map((item, index) => index === streamingIndex ? message : item)
  }
  const existing = current.find(item => item.id === id)
  if (existing !== undefined) return current
  return [...current, message]
}

function applyAssistantChunk(
  current: ChatItem[],
  data: UnknownRecord,
  sessionId: string,
  event: NativeSessionEvent,
): ChatItem[] {
  const chunk = isRecord(data.chunk) ? data.chunk : {}
  if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return current
  const delta = typeof chunk.text === 'string' ? chunk.text : ''
  if (delta.length === 0) return current
  const key = stepKey(event)
  const streamId = `stream:${key}`
  const index = current.findIndex(item => item.id === streamId && item.kind === 'message')
  if (index < 0) {
    // Whitespace and format-control-only chunks are framing noise. Waiting for
    // visible text avoids creating an empty avatar/"Remote" row.
    if (!hasVisibleMessageText(delta)) return current
    return [...current, {
      kind: 'message', id: streamId, sessionId, role: 'assistant',
      ...(replyGroup(data) === undefined ? {} : { replyGroup: replyGroup(data) }),
      text: chunk.type === 'text-delta' ? delta : '',
      ...(chunk.type === 'reasoning-delta' ? { reasoning: delta } : {}),
      streaming: true,
      streamingPhase: chunk.type === 'reasoning-delta' ? 'reasoning' : 'text',
      createdAt: now(data),
    } satisfies ChatMessage]
  }
  return current.map((item, itemIndex) => itemIndex === index && item.kind === 'message'
    ? chunk.type === 'reasoning-delta'
      ? { ...item, reasoning: `${item.reasoning ?? ''}${delta}`, streaming: true, streamingPhase: 'reasoning' }
      : { ...item, text: `${item.text}${delta}`, streaming: true, streamingPhase: 'text' }
    : item)
}

/** True when text contains something that can produce visible chat content. */
export function hasVisibleMessageText(text: string): boolean {
  return text.replace(/[\s\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '').length > 0
}

function applyToolCall(
  current: ChatItem[],
  data: UnknownRecord,
  sessionId: string,
  state: ToolActivity['state'],
  entryView?: HistoryEntry['view'],
): ChatItem[] {
  // Harness places the correlation id for a result on message.source. Using
  // only data.callId creates a second anonymous "Tool" row for every result.
  const message = isRecord(data.message) ? data.message : {}
  const source = isRecord(message.source) ? message.source : {}
  const id = stringValue(source.callId) ?? stringValue(data.callId) ?? stringValue(data.id) ?? localId('tool')
  const expectedView = state === 'running' ? 'call' : 'result'
  const view = entryView?.for === expectedView && isRecord(entryView.view) ? entryView.view : undefined
  const name = stringValue(view?.title) ?? stringValue(data.name) ?? stringValue(data.toolName) ?? 'Tool'
  const argumentsText = stringValue(data.arguments) ?? stringValue(data.argumentsDelta) ?? ''
  const summary = stringValue(view?.description) ?? stringValue(view?.cwd) ?? stringValue(data.summary)
  const detail = state === 'running'
    ? toolCallDetail(view, argumentsText)
    : toolResultDetail(view, data)
  const failed = state === 'finished' && toolResultFailed(data)
  const next: ToolActivity = {
    kind: 'tool',
    id,
    sessionId,
    toolName: name,
    ...(argumentsText.length > 0 ? { arguments: argumentsText } : {}),
    ...(summary === undefined ? {} : { summary }),
    ...(state === 'running' && detail !== undefined ? { callDetail: detail } : {}),
    ...(state === 'finished' && detail !== undefined ? { resultDetail: detail } : {}),
    state: failed ? 'failed' : state,
    createdAt: now(data),
  }
  const existing = current.find(item => item.id === id)
  if (existing?.kind !== 'tool') return [...current, next]
  return current.map(item => item.id === id && item.kind === 'tool'
    ? {
        ...item,
        toolName: name === 'Tool' ? item.toolName : name,
        ...(summary === undefined ? {} : { summary }),
        ...(next.callDetail === undefined ? {} : { callDetail: next.callDetail }),
        ...(next.resultDetail === undefined ? {} : { resultDetail: next.resultDetail }),
        state: next.state,
      }
    : item)
}

function toolCallDetail(view: UnknownRecord | undefined, argumentsText: string): ToolDisplayDetail | undefined {
  if (view !== undefined) {
    const card = stringValue(view.card)
    if (card === 'terminal') {
      const command = stringValue(view.title)
      const cwd = stringValue(view.cwd)
      const text = [cwd === undefined ? undefined : `cwd: ${cwd}`, command === undefined ? undefined : `$ ${command}`]
        .filter((value): value is string => value !== undefined).join('\n')
      const detail = boundedToolDetail(text, 'code')
      if (detail !== undefined) return detail
    }
    if (card === 'diff') {
      const detail = boundedToolDetail(formatDiffs(view.diffs), 'code')
      if (detail !== undefined) return detail
    }
    if (card === 'generic') {
      const rawInput = displayJson(view.rawInput)
      const content = contentBlocksText(view.content)
      const detail = boundedToolDetail([rawInput, content].filter(isVisibleString).join('\n\n'), content === undefined ? 'code' : 'markdown')
      if (detail !== undefined) return detail
    }
  }
  return boundedToolDetail(prettyJsonString(argumentsText), 'code')
}

function toolResultDetail(view: UnknownRecord | undefined, data: UnknownRecord): ToolDisplayDetail | undefined {
  if (view !== undefined) {
    const card = stringValue(view.card)
    if (card === 'terminal') {
      const output = stringValue(view.output)
      const exitCode = typeof view.exitCode === 'number' ? `exit: ${view.exitCode}` : undefined
      const signal = stringValue(view.signal)
      const detail = boundedToolDetail([output, exitCode, signal === undefined ? undefined : `signal: ${signal}`]
        .filter((value): value is string => value !== undefined).join('\n'), 'code')
      if (detail !== undefined) return detail
    }
    if (card === 'diff') {
      const detail = boundedToolDetail(formatDiffs(view.diffs), 'code')
      if (detail !== undefined) return detail
    }
    if (card === 'search') {
      const detail = boundedToolDetail(formatSearchResult(view), 'code')
      if (detail !== undefined) return detail
    }
    if (card === 'read') {
      const detail = boundedToolDetail(formatReadResult(view), 'code')
        ?? boundedToolDetail(contentBlocksText(view.content), 'markdown')
      if (detail !== undefined) return detail
    }
    if (card === 'web') {
      const detail = boundedToolDetail(formatWebResult(view), 'markdown')
      if (detail !== undefined) return detail
    }
    if (card === 'generic') {
      const detail = boundedToolDetail(contentBlocksText(view.content), 'markdown')
      if (detail !== undefined) return detail
    }
  }
  return boundedToolDetail(toolResultContentText(data), 'markdown')
}

function toolResultContentText(data: UnknownRecord): string | undefined {
  const message = isRecord(data.message) ? data.message : {}
  const blocks = Array.isArray(message.content) ? message.content : []
  const nested = blocks.flatMap(block => isRecord(block) && block.type === 'tool-result' && Array.isArray(block.content)
    ? block.content
    : [block])
  return contentBlocksText(nested)
}

function toolResultFailed(data: UnknownRecord): boolean {
  if (isRecord(data.error) || data.isError === true) return true
  const message = isRecord(data.message) ? data.message : {}
  const blocks = Array.isArray(message.content) ? message.content : []
  return blocks.some(block => isRecord(block) && block.type === 'tool-result' && block.isError === true)
}

function contentBlocksText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const chunks = value.flatMap(block => {
    if (!isRecord(block)) return []
    if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') return [block.text]
    if (block.type === 'image') return ['[图片]']
    if (block.type === 'tool-result') return [contentBlocksText(block.content) ?? '']
    const fallback = displayJson(block)
    return fallback === undefined ? [] : [fallback]
  }).filter(isVisibleString)
  return chunks.length === 0 ? undefined : chunks.join('\n\n')
}

function formatDiffs(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const diffs = value.flatMap(item => {
    if (!isRecord(item)) return []
    const path = stringValue(item.path)
    const newText = stringValue(item.newText)
    if (path === undefined || newText === undefined) return []
    const oldText = item.oldText === null ? '(新文件)' : stringValue(item.oldText) ?? ''
    return [`文件: ${path}\n\n--- 修改前 ---\n${oldText}\n\n+++ 修改后 +++\n${newText}`]
  })
  return diffs.length === 0 ? undefined : diffs.join('\n\n')
}

function formatSearchResult(view: UnknownRecord): string | undefined {
  if (view.shape === 'paths' && Array.isArray(view.paths)) {
    return view.paths.filter((path): path is string => typeof path === 'string').join('\n')
  }
  if (view.shape !== 'matches' || !Array.isArray(view.files)) return undefined
  const files = view.files.flatMap(file => {
    if (!isRecord(file) || typeof file.path !== 'string' || !Array.isArray(file.matches)) return []
    const matches = file.matches.flatMap(match => isRecord(match) && typeof match.line === 'string'
      ? [`${typeof match.lineNumber === 'number' ? `${match.lineNumber}: ` : ''}${match.line}`]
      : [])
    return [`${file.path}\n${matches.join('\n')}`]
  })
  return files.length === 0 ? undefined : files.join('\n\n')
}

function formatReadResult(view: UnknownRecord): string | undefined {
  if (!Array.isArray(view.lines)) return undefined
  const path = stringValue(view.path)
  const lines = view.lines.flatMap(line => isRecord(line) && typeof line.text === 'string'
    ? [`${typeof line.number === 'number' ? `${line.number} | ` : ''}${line.text}`]
    : [])
  const header = [path, typeof view.totalLines === 'number' ? `共 ${view.totalLines} 行` : undefined]
    .filter((value): value is string => value !== undefined).join(' · ')
  return [header, lines.join('\n')].filter(isVisibleString).join('\n')
}

function formatWebResult(view: UnknownRecord): string | undefined {
  if (view.kind === 'fetch') {
    const url = stringValue(view.url)
    const status = typeof view.statusCode === 'number' ? `HTTP ${view.statusCode}` : undefined
    return [status, url].filter((value): value is string => value !== undefined).join('\n')
  }
  if (view.kind !== 'search' || !Array.isArray(view.sources)) return undefined
  const answer = stringValue(view.answer)
  const sources = view.sources.flatMap(source => {
    if (!isRecord(source) || typeof source.url !== 'string') return []
    return [[stringValue(source.title), source.url, stringValue(source.snippet)]
      .filter((value): value is string => value !== undefined).join('\n')]
  })
  return [answer, ...sources].filter(isVisibleString).join('\n\n')
}

function prettyJsonString(value: string): string | undefined {
  if (!isVisibleString(value)) return undefined
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function displayJson(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function boundedToolDetail(text: string | undefined, format: ToolDisplayDetail['format']): ToolDisplayDetail | undefined {
  if (!isVisibleString(text)) return undefined
  if (text.length <= MAX_TOOL_DETAIL_CHARS) return { text, format }
  return { text: text.slice(0, MAX_TOOL_DETAIL_CHARS), format, truncated: true }
}

function isVisibleString(value: string | undefined): value is string {
  return value !== undefined && hasVisibleMessageText(value)
}

function addApproval(current: ChatItem[], payload: UnknownRecord, frameRpcId: string): ChatItem[] {
  const approvalId = stringValue(payload.approvalId)
  const sessionId = stringValue(payload.sessionId)
  if (approvalId === undefined || sessionId === undefined) return current
  const id = `approval:${approvalId}`
  const existing = current.find(item => item.id === id)
  const activity = {
    kind: 'approval' as const,
    id,
    sessionId,
    approvalId,
    toolName: stringValue(payload.toolName) ?? 'Harness',
    ...(stringValue(payload.reason) === undefined ? {} : { reason: stringValue(payload.reason) }),
    ...(frameRpcId.length === 0 ? {} : { frameRpcId }),
    createdAt: Date.now(),
  }
  return existing !== undefined ? current : [...current, activity]
}

function resolveApproval(current: ChatItem[], payload: UnknownRecord): ChatItem[] {
  const approvalId = stringValue(payload.approvalId)
  const outcome = stringValue(payload.outcome)
  if (approvalId === undefined || outcome === undefined) return current
  if (outcome !== 'allowed-once' && outcome !== 'rejected' && outcome !== 'cancelled' && outcome !== 'unavailable') return current
  return current.map(item => item.kind === 'approval' && item.approvalId === approvalId
    ? { ...item, outcome: outcome as ApprovalOutcome }
    : item)
}

function addQuestion(current: ChatItem[], payload: UnknownRecord, frameRpcId: string): ChatItem[] {
  const sessionId = stringValue(payload.sessionId)
  const questions = Array.isArray(payload.questions) ? payload.questions : []
  if (sessionId === undefined || questions.length === 0) return current
  const id = `question:${frameRpcId || questions[0]?.id || localId('question')}`
  const existing = current.find(item => item.id === id)
  const activity = {
    kind: 'question' as const,
    id,
    sessionId,
    ...(frameRpcId.length === 0 ? {} : { frameRpcId }),
    questions,
    createdAt: Date.now(),
  }
  return existing !== undefined ? current : [...current, activity]
}

function resolveQuestion(current: ChatItem[], payload: UnknownRecord): ChatItem[] {
  const questionRpcId = stringValue(payload.questionRpcId)
  const outcome = stringValue(payload.outcome)
  if (questionRpcId === undefined || outcome === undefined) return current
  return current.map(item => item.kind === 'question' && item.frameRpcId === questionRpcId
    ? { ...item, outcome: outcome === 'answered' ? 'answered' as const : 'cancelled' as const }
    : item)
}

function messageId(data: UnknownRecord): string {
  const message = isRecord(data.message) ? data.message : data
  return stringValue(message.id) ?? localId('message')
}

function messageText(data: UnknownRecord): string {
  const message = isRecord(data.message) ? data.message : data
  const content = Array.isArray(message.content) ? message.content : []
  return content.flatMap(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string'
    ? [block.text]
    : []).join('\n')
}

function messageReasoning(data: UnknownRecord): string {
  const message = isRecord(data.message) ? data.message : data
  const content = Array.isArray(message.content) ? message.content : []
  return content.flatMap(block => isRecord(block) && block.type === 'reasoning' && typeof block.text === 'string'
    ? [block.text]
    : []).join('\n')
}

function messageImages(data: UnknownRecord): NonNullable<ChatMessage['images']> {
  const message = isRecord(data.message) ? data.message : data
  const content = Array.isArray(message.content) ? message.content : []
  return content.flatMap(block => {
    if (!isRecord(block) || block.type !== 'image') return []
    const attachment = isRecord(block.attachment) ? block.attachment : {}
    const attachmentId = stringValue(block.attachmentId) ?? stringValue(attachment.attachmentId)
    const uri = imageDataUri(block)
    if (uri === undefined && attachmentId === undefined) return []
    const name = stringValue(block.name) ?? stringValue(attachment.name)
    return [{
      ...(uri === undefined ? {} : { uri }),
      ...(name === undefined ? {} : { name }),
    }]
  })
}

function imageDataUri(block: UnknownRecord): string | undefined {
  const url = stringValue(block.url) ?? stringValue(block.uri)
  const parsed = url === undefined ? undefined : parseDataImageUrl(url)
  if (parsed !== undefined) return parsed
  const data = stringValue(block.data)
  const mediaType = stringValue(block.mediaType)
  if (data === undefined || mediaType === undefined || !IMAGE_MEDIA_TYPES.has(mediaType) || !isCanonicalBase64(data)) {
    return undefined
  }
  return `data:${mediaType};base64,${data}`
}

function parseDataImageUrl(value: string): string | undefined {
  const match = DATA_IMAGE_URL.exec(value)
  if (match === null) return undefined
  const mediaType = match[1]!
  const data = match[2]!
  if (!IMAGE_MEDIA_TYPES.has(mediaType) || !isCanonicalBase64(data)) return undefined
  return `data:${mediaType};base64,${data}`
}

function isCanonicalBase64(value: string): boolean {
  return value.length >= 4 && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
}

function messageRequestRpcId(data: UnknownRecord): string | undefined {
  const message = isRecord(data.message) ? data.message : data
  const source = isRecord(message.source) ? message.source : undefined
  return source?.kind === 'user' ? stringValue(source.rpcId) : undefined
}

function historyView(value: unknown): HistoryEntry['view'] | undefined {
  if (!isRecord(value) || (value.for !== 'call' && value.for !== 'result')) return undefined
  return { for: value.for, view: value.view }
}

function stepKey(event: NativeSessionEvent): string {
  const data = isRecord(event.data) ? event.data : {}
  return `${keyPart(data.turn)}:${keyPart(data.step)}`
}

function replyGroup(data: UnknownRecord): string | undefined {
  const turn = data.turn
  return typeof turn === 'string' || typeof turn === 'number' ? String(turn) : undefined
}

function now(data: UnknownRecord): number {
  return typeof data.time === 'number' ? data.time : Date.now()
}

function keyPart(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '?'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function localId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`
}
