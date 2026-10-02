import type { ChatItem, HistoryEntry } from '../types'

export function findApproval(messages: Record<string, ChatItem[]>, itemId: string) {
  for (const items of Object.values(messages)) {
    const found = items.find(item => item.kind === 'approval' && item.id === itemId)
    if (found !== undefined && found.kind === 'approval') return found
  }
  return undefined
}

export function findQuestion(messages: Record<string, ChatItem[]>, itemId: string) {
  for (const items of Object.values(messages)) {
    const found = items.find(item => item.kind === 'question' && item.id === itemId)
    if (found !== undefined && found.kind === 'question') return found
  }
  return undefined
}

export function mapApprovalOutcome(
  messages: Record<string, ChatItem[]>,
  itemId: string,
  outcome: 'allowed-once' | 'rejected',
): Record<string, ChatItem[]> {
  return mapItems(messages, item => item.kind === 'approval' && item.id === itemId
    ? { ...item, outcome }
    : item)
}

export function mapQuestionAnswered(
  messages: Record<string, ChatItem[]>,
  itemId: string,
): Record<string, ChatItem[]> {
  return mapItems(messages, item => item.kind === 'question' && item.id === itemId
    ? { ...item, outcome: 'answered' as const }
    : item)
}

function mapItems(
  messages: Record<string, ChatItem[]>,
  map: (item: ChatItem) => ChatItem,
): Record<string, ChatItem[]> {
  return Object.fromEntries(Object.entries(messages).map(([sessionId, items]) => [sessionId, items.map(map)]))
}

export function mergeHistoryAndLive(history: ChatItem[], live: ChatItem[]): ChatItem[] {
  const liveById = new Map(live.map(item => [item.id, item]))
  const historyIds = new Set(history.map(item => item.id))
  return [
    ...history.map(item => liveById.get(item.id) ?? item),
    ...live.filter(item => !historyIds.has(item.id)),
  ]
}

export type ChatSection =
  | { kind: 'item'; key: string; item: ChatItem }
  | { kind: 'process'; key: string; turn: string; items: ChatItem[] }

/** Group adjacent activity from one native turn, leaving user rows in place. */
export function chatSections(items: ChatItem[]): ChatSection[] {
  const sections: ChatSection[] = []
  for (const item of items) {
    const turn = item.kind === 'message' && item.role === 'user'
      ? undefined
      : item.turn ?? (item.kind === 'message' ? item.replyGroup : undefined)
    const previous = sections.at(-1)
    if (turn !== undefined && previous?.kind === 'process' && previous.turn === turn) {
      previous.items.push(item)
    } else if (turn !== undefined) {
      sections.push({ kind: 'process', key: `process:${turn}:${item.id}`, turn, items: [item] })
    } else {
      sections.push({ kind: 'item', key: item.id, item })
    }
  }
  return sections
}

/**
 * Fold assistant reasoning fragments from one native turn into one disclosure.
 *
 * Native Harness and CodeX timelines can expose reasoning/plan items separately
 * from the final assistant message. Keeping those rows separate makes one
 * reply look like several unrelated answers. A reasoning-only row remains as
 * the live placeholder until text arrives; once there is an answer, all of the
 * turn's reasoning is attached to that answer and the placeholder is removed.
 */
export function mergeReplyReasoning(items: ChatItem[]): ChatItem[] {
  const output: ChatItem[] = []
  const groups = new Map<string, {
    reasoning: string[]
    pendingIndex?: number
    anchorIndex?: number
  }>()

  for (const item of items) {
    if (item.kind !== 'message' || item.role !== 'assistant' || item.replyGroup === undefined) {
      output.push(item)
      continue
    }

    const group = groups.get(item.replyGroup) ?? { reasoning: [] }
    groups.set(item.replyGroup, group)
    const textVisible = hasVisibleText(item.text)
    const reasoningVisible = hasVisibleText(item.reasoning ?? '')

    if (reasoningVisible) group.reasoning.push(item.reasoning!)

    if (textVisible) {
      // Reasoning may have arrived as one or more rows before the answer.
      // Remove those placeholders while leaving any intervening tool rows.
      if (group.pendingIndex !== undefined) {
        output.splice(group.pendingIndex, 1)
        if (group.anchorIndex !== undefined && group.anchorIndex > group.pendingIndex) {
          group.anchorIndex -= 1
        }
        group.pendingIndex = undefined
      }
      const merged = group.reasoning.length === 0
        ? item
        : { ...item, reasoning: joinReasoning(group.reasoning) }
      output.push(merged)
      group.anchorIndex = output.length - 1
      continue
    }

    if (!reasoningVisible) {
      output.push(item)
      continue
    }

    if (group.anchorIndex !== undefined) {
      // A later reasoning/plan item in the same turn belongs to the already
      // visible answer, even when a tool row occurred between the two.
      const anchor = output[group.anchorIndex]
      if (anchor?.kind === 'message') {
        output[group.anchorIndex] = {
          ...anchor,
          reasoning: joinReasoning(group.reasoning),
          ...(item.streaming === undefined ? {} : { streaming: item.streaming }),
          ...(item.streamingPhase === undefined ? {} : { streamingPhase: item.streamingPhase }),
        }
      }
      continue
    }

    if (group.pendingIndex === undefined) {
      output.push({ ...item, reasoning: joinReasoning(group.reasoning) })
      group.pendingIndex = output.length - 1
    } else {
      const pending = output[group.pendingIndex]
      if (pending?.kind === 'message') {
        output[group.pendingIndex] = {
          ...pending,
          reasoning: joinReasoning(group.reasoning),
          ...(item.streaming === undefined ? {} : { streaming: item.streaming }),
          ...(item.streamingPhase === undefined ? {} : { streamingPhase: item.streamingPhase }),
        }
      }
    }
  }

  return output
}

function hasVisibleText(value: string): boolean {
  return value.replace(/[\s\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '').length > 0
}

function joinReasoning(parts: string[]): string {
  return parts.filter(hasVisibleText).join('\n\n')
}

/** Prepend an older history page in front of the current chat items, deduplicated by id. */
export function prependHistory(older: ChatItem[], current: ChatItem[]): ChatItem[] {
  const currentIds = new Set(current.map(item => item.id))
  return [...older.filter(item => !currentIds.has(item.id)), ...current]
}

/** Smallest event seq in a history page; drives the next `session.history` beforeSeq. */
export function oldestSeq(events: HistoryEntry[]): number | undefined {
  let oldest: number | undefined
  for (const entry of events) {
    const seq = entry.event.seq
    if (Number.isSafeInteger(seq)) oldest = oldest === undefined ? seq : Math.min(oldest, seq)
  }
  return oldest
}
