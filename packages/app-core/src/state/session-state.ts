import type { CodexTimelineState } from '@dsh-remote/client-core'
import type { ChatItem, ChatMessage, HistoryEntry, MuxStreamFrame } from '../types'
import type { AppState } from './store-state'

export function applyFeedback(items: ChatItem[], ratings?: Map<string, ChatMessage['feedback']>): ChatItem[] {
  return ratings === undefined ? items : items.map(item => item.kind === 'message'
    ? { ...item, feedback: ratings.get(item.id) } : item)
}

export function latestHistoryLifecycle(events: HistoryEntry[]): AppState['sessionLifecycles'][string] | undefined {
  let latest: AppState['sessionLifecycles'][string] | undefined
  for (const { event } of events) {
    if (event.type !== 'turn/start' && event.type !== 'turn/end') continue
    if (latest !== undefined && event.seq < latest.seq) continue
    latest = {
      seq: event.seq, running: event.type === 'turn/start',
      ...(event.data.turn === undefined ? {} : { turn: String(event.data.turn) })
    }
  }
  return latest
}

export function withActiveCodexTurn(timeline: CodexTimelineState, activeTurnId: string | undefined): CodexTimelineState {
  if (activeTurnId === undefined) return timeline
  return {
    ...timeline,
    activeTurnId,
    session: timeline.session.status === 'waiting'
      ? timeline.session
      : { ...timeline.session, status: 'running' },
  }
}

export function isHarnessPromptStarted(frame: MuxStreamFrame): boolean {
  const payload = frame.payload
  if (payload.type === 'approval/requested' || payload.type === 'question/requested') return true
  if (payload.type !== 'session/event' || payload.event === undefined) return false
  const event = payload.event
  if (event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result') return true
  if (event.type !== 'assistant/chunk') return false
  const chunk = event.data.chunk
  if (typeof chunk !== 'object' || chunk === null) return false
  const value = chunk as Record<string, unknown>
  if (value.type === 'text-delta' || value.type === 'reasoning-delta') {
    return typeof value.text === 'string' && value.text.length > 0
  }
  return value.type === 'tool-call-delta'
    && (typeof value.argumentsDelta !== 'string' || value.argumentsDelta.length > 0)
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
