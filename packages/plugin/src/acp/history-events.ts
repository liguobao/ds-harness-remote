import type { CursorAcpInbound } from './adapters/cursor-process.js'
import { acpImageContent, parseAcpImage } from './image-content.js'
import { piToolResult } from './pi-tool-result.js'
import { extractText, isRecord } from './virtual-contract.js'

/**
 * Convert replayed ACP `session/update` notifications into DSH history events.
 * Upstream timestamps and message IDs are not replayed, so IDs are deterministic
 * and time stays unknown (0).
 */
export function acpHistoryEvents(
  messages: CursorAcpInbound[],
  sessionId: string,
  provider: string,
): unknown[] {
  type Block = Record<string, unknown>
  type Tool = { id: string; callSeq: number; name: string; input: unknown; output: Array<{ type: string; text: string }>; failed: boolean; terminal: boolean; emitted: boolean }
  const events: any[] = []
  const tools = new Map<string, Tool>()
  let turn = 0
  let step = 1
  let afterTools = false
  let pending: { role: 'user' | 'assistant'; content: Block[] } | undefined
  const push = (type: string, data: unknown, surface = false, sourceEventSeqs?: number[]) => events.push({
    type: 'event',
    event: {
      type,
      seq: events.length,
      time: 0,
      data,
      ...(sourceEventSeqs ? { sourceEventSeqs } : {}),
      ...(surface ? { surfaceOp: 'append' } : {}),
    },
  })
  const id = () => `${provider}-history:${sessionId}:${events.length}`
  const flushMessage = () => {
    if (!pending) return
    const message = { id: id(), role: pending.role, content: pending.content }
    if (pending.role === 'user') push('user/message', { ...message, source: { kind: 'user' } }, true)
    else push('assistant/message', { turn, step, message: { ...message, source: { kind: 'model', provider, model: '' } }, stream: [] }, true)
    pending = undefined
  }
  const result = (tool: Tool) => {
    if (tool.emitted || !tool.terminal) return
    tool.emitted = true
    push('tool/result', {
      turn,
      step,
      message: {
        id: id(),
        role: 'user',
        source: { kind: 'tool', callId: tool.id },
        content: [{
          type: 'tool-result',
          toolCallId: tool.id,
          content: tool.output,
          ...(tool.failed ? { isError: true } : {}),
        }],
      },
    }, true, [tool.callSeq])
  }
  const flushTools = () => { for (const tool of tools.values()) result(tool) }
  const endTurn = () => {
    flushMessage(); flushTools()
    if (turn) { push('step/end', { turn, step }); push('turn/end', { turn, reason: { kind: 'completed' } }) }
    tools.clear()
    afterTools = false
  }
  for (const message of messages) {
    const params = message.params as { sessionId?: string; update?: Record<string, any> } | undefined
    if (message.kind !== 'notification' || message.method !== 'session/update' || params?.sessionId !== sessionId) continue
    const update: Record<string, any> | undefined = isRecord(params.update)
      ? params.update
      : (isRecord(params) ? (params as Record<string, any>) : undefined)
    if (!update) continue
    const kind = typeof update.sessionUpdate === 'string'
      ? update.sessionUpdate
      : typeof update.type === 'string'
        ? update.type
        : undefined
    if (
      kind === 'user_message_chunk'
      || kind === 'user_message'
      || kind === 'agent_message_chunk'
      || kind === 'agent_message'
      || kind === 'agent_thought_chunk'
      || kind === 'agent_thought'
    ) {
      const content = update.content
      const isUser = kind === 'user_message_chunk' || kind === 'user_message'
      const isImage = isUser && isRecord(content) && content.type === 'image' && typeof content.mimeType === 'string' && typeof content.data === 'string'
      const text = isImage ? undefined : extractText(update)
      const isText = typeof text === 'string'
      if (!isText && !isImage) continue
      const role = isUser ? 'user' : 'assistant'
      if (role === 'user' && pending?.role !== 'user') {
        endTurn(); turn++; step = 1
        push('turn/start', { turn }); push('step/start', { turn, step })
      } else if (!turn) {
        turn++; push('turn/start', { turn }); push('step/start', { turn, step })
      }
      if (pending && pending.role !== role) flushMessage()
      flushTools()
      if (role === 'assistant' && afterTools) {
        push('step/end', { turn, step }); step++; push('step/start', { turn, step })
        afterTools = false
      }
      pending ??= { role, content: [] }
      if (isImage) {
        try {
          const parsed = parseAcpImage(content)
          const ext = parsed.mimeType === 'image/jpeg' ? 'jpg' : parsed.mimeType.slice(6)
          const attachmentId = `agy-image:history-${sessionId}-${events.length}-${pending.content.length}.${ext}`
          pending.content.push({
            ...acpImageContent(parsed, attachmentId),
            mimeType: parsed.mimeType,
          })
        } catch {
          pending.content.push({
            type: 'image',
            mimeType: content.mimeType,
            mediaType: content.mimeType,
            data: content.data,
          })
        }
      } else {
        const type = (kind === 'agent_thought_chunk' || kind === 'agent_thought') ? 'reasoning' : 'text'
        const previous = pending.content.at(-1)
        if (previous?.type === type && typeof previous.text === 'string') previous.text += text
        else pending.content.push({ type, text })
      }
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      const rawToolId = typeof update.toolCallId === 'string' && update.toolCallId.length > 0
        ? update.toolCallId
        : typeof update.callId === 'string' && update.callId.length > 0
          ? update.callId
          : undefined
      if (rawToolId === undefined) continue
      flushMessage()
      afterTools = true
      if (!turn) { turn++; push('turn/start', { turn }); push('step/start', { turn, step }) }
      let tool = tools.get(rawToolId)
      if (!tool) {
        const callSeq = events.length
        const name = typeof update.title === 'string' && update.title.length > 0
          ? update.title
          : typeof update.toolName === 'string' && update.toolName.length > 0
            ? update.toolName
            : typeof update.name === 'string' && update.name.length > 0
              ? update.name
              : 'tool'
        tool = {
          id: rawToolId,
          callSeq,
          name,
          input: update.rawInput ?? update.parameters ?? update.args,
          output: [],
          failed: false,
          terminal: false,
          emitted: false,
        }
        tools.set(tool.id, tool)
        push('tool/call', {
          turn,
          step,
          callId: tool.id,
          name: tool.name,
          arguments: typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input ?? {}),
        })
      } else {
        if (typeof update.title === 'string' && update.title.length > 0 && tool.name === 'tool') {
          tool.name = update.title
        }
        if (tool.input === undefined && (update.rawInput !== undefined || update.parameters !== undefined || update.args !== undefined)) {
          tool.input = update.rawInput ?? update.parameters ?? update.args
        }
      }
      const decoded = piToolResult(update)
      if (!decoded.content.length && update.rawOutput !== undefined && update.rawOutput !== null) {
        decoded.content.push({
          type: 'text',
          text: typeof update.rawOutput === 'string' ? update.rawOutput : JSON.stringify(update.rawOutput),
        })
      }
      if (!decoded.content.length && update.output !== undefined && update.output !== null) {
        decoded.content.push({
          type: 'text',
          text: typeof update.output === 'string' ? update.output : JSON.stringify(update.output),
        })
      }
      if (decoded.content.length) tool.output = decoded.content
      const exitCode = isRecord(update._meta) && isRecord(update._meta.terminal_exit) && typeof update._meta.terminal_exit.exit_code === 'number'
        ? update._meta.terminal_exit.exit_code
        : undefined
      tool.failed ||= decoded.isError || update.status === 'failed' || (exitCode !== undefined && exitCode !== 0)
      tool.terminal ||= update.status === 'completed' || update.status === 'failed' || exitCode !== undefined || (kind === 'tool_call_update' && update.output !== undefined)
      // Emit once a tool_call_update completes, or let flushTools emit a completed tool_call.
      if (kind === 'tool_call_update' && tool.terminal) result(tool)
    }
  }
  endTurn()
  return events
}
