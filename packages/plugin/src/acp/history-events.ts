import { Buffer } from 'node:buffer'
import type { CursorAcpInbound } from './adapters/cursor-process.js'
import { acpImageContent, parseAcpImage } from './image-content.js'
import { piToolResult } from './pi-tool-result.js'

type Block = Record<string, unknown>

interface Tool {
  id: string
  name: string
  input: unknown
  output: Array<{ type: string; text: string }>
  outputBytes: number
  failed: boolean
  terminal: boolean
  emitted: boolean
}

interface HistoryEventEnvelope {
  type: 'event'
  event: {
    type: string
    seq: number
    time: number
    data: unknown
    surfaceOp?: 'append'
  }
}

interface TurnBucket {
  events: HistoryEventEnvelope[]
  bytes: number
}

/** Optional retention and fail-closed ceilings for streaming ACP history replay. */
export interface AcpHistoryLimits {
  /** Soft byte budget for retained folded history across multi-turn sessions; older complete turns are evicted FIFO. */
  maxBytes?: number
  /** Hard byte ceiling enforced fail-closed when even the newest single turn exceeds transfer safety bounds. */
  hardMaxBytes?: number
  /** Soft folded event count budget across multi-turn sessions; older complete turns are evicted FIFO. */
  maxEvents?: number
  /** Hard folded event ceiling enforced fail-closed when a single turn exceeds maxEvents. */
  hardMaxEvents?: number
}

/** Result returned by {@link AcpHistoryAccumulator.finish}. */
export interface AcpHistoryResult {
  events: unknown[]
  truncated: boolean
  overflow: boolean
}

const MESSAGE_ENVELOPE_OVERHEAD_BYTES = 192

/**
 * Incrementally fold replayed ACP `session/update` notifications into DSH
 * history events, optionally retaining only a trailing window of complete
 * turns within memory and transfer limits.
 */
export class AcpHistoryAccumulator {
  private readonly completedTurns: TurnBucket[] = []
  private readonly tools = new Map<string, Tool>()
  private currentTurn: TurnBucket | undefined
  private completedBytes = 0
  private completedEventCount = 0
  private emittedCount = 0
  private turn = 0
  private step = 1
  private afterTools = false
  private pending: { role: 'user' | 'assistant'; content: Block[]; bytes: number } | undefined
  private toolPendingBytes = 0
  private truncated = false
  private overflowed = false

  constructor(
    private readonly sessionId: string,
    private readonly provider: string,
    private readonly limits: AcpHistoryLimits = {},
  ) {}

  /**
   * Consume one inbound ACP message during `session/load` replay.
   * Returns `false` if a hard single-turn safety limit was exceeded.
   */
  push(message: CursorAcpInbound): boolean {
    if (this.overflowed) return false
    const params = message.params as { sessionId?: string; update?: Record<string, any> } | undefined
    if (message.kind !== 'notification' || message.method !== 'session/update' || params?.sessionId !== this.sessionId) {
      return true
    }
    const update = params.update
    if (!update) return true
    const kind = update.sessionUpdate
    if (kind === 'user_message_chunk' || kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const content = update.content
      const isText = content?.type === 'text' && typeof content.text === 'string'
      const isImage = kind === 'user_message_chunk' && content?.type === 'image' && typeof content.mimeType === 'string' && typeof content.data === 'string'
      if (!isText && !isImage) return true
      const role = kind === 'user_message_chunk' ? 'user' : 'assistant'
      if (role === 'user' && this.pending?.role !== 'user') {
        this.startNewTurn(true)
      } else if (!this.turn) {
        this.startNewTurn(false)
      }
      if (this.pending && this.pending.role !== role) this.flushMessage()
      this.flushTools()
      if (role === 'assistant' && this.afterTools) {
        this.pushEvent('step/end', { turn: this.turn, step: this.step })
        this.step++
        this.pushEvent('step/start', { turn: this.turn, step: this.step })
        this.afterTools = false
      }
      this.pending ??= { role, content: [], bytes: MESSAGE_ENVELOPE_OVERHEAD_BYTES }
      if (isImage) {
        try {
          const parsed = parseAcpImage(content)
          const ext = parsed.mimeType === 'image/jpeg' ? 'jpg' : parsed.mimeType.slice(6)
          const attachmentId = `agy-image:history-${this.sessionId}-${this.emittedCount}-${this.pending.content.length}.${ext}`
          const block = {
            ...acpImageContent(parsed, attachmentId),
            mimeType: parsed.mimeType,
          }
          this.pending.content.push(block)
          this.pending.bytes += Buffer.byteLength(JSON.stringify(block), 'utf8')
        } catch {
          const block = {
            type: 'image',
            mimeType: content.mimeType,
            mediaType: content.mimeType,
            data: content.data,
          }
          this.pending.content.push(block)
          this.pending.bytes += Buffer.byteLength(content.data, 'utf8') + Buffer.byteLength(content.mimeType, 'utf8') + 64
        }
      } else {
        const type = kind === 'agent_thought_chunk' ? 'reasoning' : 'text'
        const previous = this.pending.content.at(-1)
        const textBytes = Buffer.byteLength(content.text, 'utf8')
        if (previous?.type === type && typeof previous.text === 'string') {
          previous.text += content.text
          this.pending.bytes += textBytes
        } else {
          this.pending.content.push({ type, text: content.text })
          this.pending.bytes += textBytes + 32
        }
      }
      return this.enforceLimits()
    }
    if ((kind === 'tool_call' || kind === 'tool_call_update') && typeof update.toolCallId === 'string') {
      this.flushMessage()
      if (!this.turn) this.startNewTurn(false)
      this.afterTools = true
      let tool = this.tools.get(update.toolCallId)
      if (!tool) {
        tool = {
          id: update.toolCallId,
          name: typeof update.title === 'string' ? update.title : typeof update.name === 'string' ? update.name : 'tool',
          input: update.rawInput ?? update.args,
          output: [],
          outputBytes: 0,
          failed: false,
          terminal: false,
          emitted: false,
        }
        this.tools.set(tool.id, tool)
        this.pushEvent('tool/call', {
          turn: this.turn,
          step: this.step,
          callId: tool.id,
          name: tool.name,
          arguments: typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input ?? {}),
        })
      }
      const decoded = piToolResult(update)
      if (!decoded.content.length && update.rawOutput !== undefined) {
        decoded.content.push({
          type: 'text',
          text: typeof update.rawOutput === 'string' ? update.rawOutput : JSON.stringify(update.rawOutput),
        })
      }
      if (decoded.content.length) {
        if (!tool.emitted) {
          const nextOutputBytes = Buffer.byteLength(JSON.stringify(decoded.content), 'utf8')
          this.toolPendingBytes += nextOutputBytes - tool.outputBytes
          tool.outputBytes = nextOutputBytes
        }
        tool.output = decoded.content
      }
      tool.failed ||= decoded.isError || update.status === 'failed'
      tool.terminal ||= update.status === 'completed' || update.status === 'failed'
      // Emit once a tool_call_update completes, or let flushTools emit a completed tool_call.
      if (kind === 'tool_call_update' && tool.terminal) this.emitToolResult(tool)
      return this.enforceLimits()
    }
    return true
  }

  /** Finalize any open turn, enforce limits on serialized output, and return retained events. */
  finish(): AcpHistoryResult {
    if (this.overflowed) {
      return { events: [], truncated: this.truncated, overflow: true }
    }
    this.endTurn()
    if (!this.enforceLimits()) {
      return { events: [], truncated: this.truncated, overflow: true }
    }
    const events: HistoryEventEnvelope[] = []
    for (const bucket of this.completedTurns) events.push(...bucket.events)
    if (this.currentTurn) events.push(...this.currentTurn.events)
    if (this.truncated) {
      for (let i = 0; i < events.length; i += 1) {
        events[i]!.event.seq = i
      }
    }
    return { events, truncated: this.truncated, overflow: false }
  }

  private nextId(): string {
    return `${this.provider}-history:${this.sessionId}:${this.emittedCount}`
  }

  private pushEvent(type: string, data: unknown, surface = false): void {
    this.currentTurn ??= { events: [], bytes: 0 }
    const entry: HistoryEventEnvelope = {
      type: 'event',
      event: {
        type,
        seq: this.emittedCount,
        time: 0,
        data,
        ...(surface ? { surfaceOp: 'append' } : {}),
      },
    }
    this.emittedCount++
    this.currentTurn.events.push(entry)
    this.currentTurn.bytes += Buffer.byteLength(JSON.stringify(entry), 'utf8')
  }

  private flushMessage(): void {
    if (!this.pending) return
    const message = { id: this.nextId(), role: this.pending.role, content: this.pending.content }
    if (this.pending.role === 'user') this.pushEvent('user/message', { ...message, source: { kind: 'user' } }, true)
    else this.pushEvent('assistant/message', { turn: this.turn, step: this.step, message: { ...message, source: { kind: 'model', provider: this.provider, model: '' } }, stream: [] }, true)
    this.pending = undefined
  }

  private emitToolResult(tool: Tool): void {
    if (tool.emitted || !tool.terminal) return
    tool.emitted = true
    if (tool.outputBytes > 0) {
      this.toolPendingBytes -= tool.outputBytes
      tool.outputBytes = 0
    }
    this.pushEvent('tool/result', {
      turn: this.turn,
      step: this.step,
      message: {
        id: this.nextId(),
        role: 'user',
        source: { kind: 'tool', callId: tool.id },
        content: [{
          type: 'tool-result',
          toolCallId: tool.id,
          content: tool.output,
          ...(tool.failed ? { isError: true } : {}),
        }],
      },
    }, true)
  }

  private flushTools(): void {
    for (const tool of this.tools.values()) this.emitToolResult(tool)
  }

  private endTurn(): void {
    this.flushMessage()
    this.flushTools()
    if (this.turn) {
      this.pushEvent('step/end', { turn: this.turn, step: this.step })
      this.pushEvent('turn/end', { turn: this.turn, reason: { kind: 'completed' } })
    }
    this.tools.clear()
    this.toolPendingBytes = 0
    this.afterTools = false
  }

  private startNewTurn(resetStep: boolean): void {
    this.endTurn()
    if (this.currentTurn && this.currentTurn.events.length > 0) {
      this.completedTurns.push(this.currentTurn)
      this.completedBytes += this.currentTurn.bytes
      this.completedEventCount += this.currentTurn.events.length
    }
    this.currentTurn = { events: [], bytes: 0 }
    this.turn++
    if (resetStep) this.step = 1
    this.pushEvent('turn/start', { turn: this.turn })
    this.pushEvent('step/start', { turn: this.turn, step: this.step })
  }

  private totalBytes(): number {
    return this.completedBytes + (this.currentTurn?.bytes ?? 0) + (this.pending?.bytes ?? 0) + this.toolPendingBytes
  }

  private totalEvents(): number {
    return this.completedEventCount + (this.currentTurn?.events.length ?? 0)
  }

  private enforceLimits(): boolean {
    const { maxBytes, maxEvents } = this.limits
    while (this.completedTurns.length > 0 && (
      (maxBytes !== undefined && this.totalBytes() > maxBytes)
      || (maxEvents !== undefined && this.totalEvents() > maxEvents)
    )) {
      const evicted = this.completedTurns.shift()!
      this.completedBytes -= evicted.bytes
      this.completedEventCount -= evicted.events.length
      this.truncated = true
    }
    const hardMaxBytes = this.limits.hardMaxBytes ?? maxBytes
    const hardMaxEvents = this.limits.hardMaxEvents ?? maxEvents
    if ((hardMaxBytes !== undefined && this.totalBytes() > hardMaxBytes)
      || (hardMaxEvents !== undefined && this.totalEvents() > hardMaxEvents)) {
      this.overflowed = true
      return false
    }
    return true
  }
}

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
  const accumulator = new AcpHistoryAccumulator(sessionId, provider)
  for (const message of messages) accumulator.push(message)
  return accumulator.finish().events
}
