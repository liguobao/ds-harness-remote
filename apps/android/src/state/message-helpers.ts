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

/** One queued prompt as rendered in the queue dock. */
export interface InboxQueuedItem {
  /** Host queue item id — the target of `session.updateQueue` actions. */
  id?: string
  rpcId?: string
  preview: string
}

/**
 * Queued prompts from the Host `inbox` projection. Only `next-turn` entries are
 * user-visible queue items; `next-step` is the agent's internal continuation
 * input (mirrors the official QueueDock, which renders `next-turn` only).
 * In DS-Bot 0.3.0 (#663), only user-authored kinds (`user`, `schedule`,
 * `user-question-reply`) belong in the QueueDock; team Bot-to-Bot relays
 * (`source.kind === 'bot'`) are filtered out.
 */
const OWN_QUEUE_KINDS = new Set(['user', 'schedule', 'user-question-reply'])

export function inboxQueuedItems(inbox: unknown): InboxQueuedItem[] {
  const record = typeof inbox === 'object' && inbox !== null ? inbox as Record<string, unknown> : {}
  const rows = Array.isArray(record['next-turn']) ? record['next-turn'] : []
  const items: InboxQueuedItem[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) { items.push({ preview: '' }); continue }
    const source = (row as Record<string, unknown>).source
    const sourceKind = typeof source === 'object' && source !== null ? (source as Record<string, unknown>).kind : undefined
    if (typeof sourceKind === 'string' && !OWN_QUEUE_KINDS.has(sourceKind)) continue
    const rpcId = typeof source === 'object' && source !== null ? (source as Record<string, unknown>).rpcId : undefined
    const id = (row as Record<string, unknown>).id
    const content = (row as Record<string, unknown>).content
    const preview = Array.isArray(content)
      ? content.flatMap(block => typeof block === 'object' && block !== null
        && (block as Record<string, unknown>).type === 'text'
        && typeof (block as Record<string, unknown>).text === 'string'
        ? [(block as Record<string, unknown>).text as string] : []).join(' ')
      : ''
    items.push({
      ...(typeof id === 'string' && id.length > 0 ? { id } : {}),
      ...(typeof rpcId === 'string' && rpcId.length > 0 ? { rpcId } : {}),
      preview,
    })
  }
  return items
}

/** Extract queued-prompt rpcIds from the Host `inbox` projection (`next-turn`). */
export function inboxRpcIds(inbox: unknown): Set<string> {
  const ids = new Set<string>()
  for (const item of inboxQueuedItems(inbox)) {
    if (item.rpcId !== undefined) ids.add(item.rpcId)
  }
  return ids
}

/**
 * Delivery-state reconciliation against Host truth (no timers, no deletions):
 * after a fresh history load plus an `inbox` snapshot, an optimistic row whose
 * prompt is in neither source and that predates the current connection is
 * judged — `queued` becomes `canceled` (removed remotely / claimed and later
 * healed by its echo) and `unconfirmed` becomes `failed` (retryable). Rows are
 * always kept: a late `user/message` echo still replaces them by requestRpcId.
 */
export function reconcileDeliveryStates(
  items: ChatItem[],
  queuedRpcIds: ReadonlySet<string>,
  historyRpcIds: ReadonlySet<string>,
  sentBefore: number,
): ChatItem[] {
  return items.map(item => {
    // `failed` keeps its retry material and `canceled` is terminal (user
    // removal / authoritative drop) — re-judging either would resurrect a
    // removed prompt as resendable.
    if (item.kind !== 'message' || item.sendState === 'failed' || item.sendState === 'canceled') return item
    if (item.requestRpcId === undefined || item.createdAt >= sentBefore) return item
    if (historyRpcIds.has(item.requestRpcId) || queuedRpcIds.has(item.requestRpcId)) return item
    // A row without a local verdict only needs settling when the inbox adopted
    // it and its echo never landed (lost-echo hole: it would hide forever).
    if (item.sendState === undefined && item.queuedAdopted !== true) return item
    return { ...item, sendState: item.sendState === 'unconfirmed' ? 'failed' as const : 'canceled' as const }
  })
}

export function mergeHistoryAndLive(history: ChatItem[], live: ChatItem[], throughSeq?: number): ChatItem[] {
  const liveById = new Map(live.map(item => [item.id, item]))
  const historyIds = new Set(history.map(item => item.id))
  const boundary = throughSeq ?? Math.max(-1, ...history.map(item => item.nativeSeq ?? item.nativeOrderSeq ?? -1))
  const requests = new Set(history.flatMap(item => item.kind === 'message' && item.requestRpcId !== undefined ? [item.requestRpcId] : []))
  const closedTurns = new Set(history.flatMap(item => {
    if (item.turnEnd === undefined) return []
    const owner = item.turn ?? (item.kind === 'message' ? item.replyGroup : undefined)
    return owner === undefined ? [] : [owner]
  }))
  const activeHistoryTurn = (() => {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const item = history[index]!
      if (item.turnEnd !== undefined) return undefined
      const owner = item.turn ?? (item.kind === 'message' ? item.replyGroup : undefined)
      if (owner !== undefined) return owner
      if (item.kind === 'message' && item.role === 'user' && !item.context) return undefined
    }
    return undefined
  })()
  const resolveInteractionTurn = (item: Extract<ChatItem, { kind: 'approval' | 'question' }>): string | undefined => {
    if (item.callId !== undefined) {
      const matched = history.find(row => row.kind === 'tool' && row.id === item.callId)
      if (matched?.turn !== undefined) return matched.turn
    }
    if (item.outcome === undefined) {
      const runningTool = [...history].reverse().find(row => row.kind === 'tool' && row.state === 'running'
        && (item.kind === 'approval' || (row.toolKey ?? row.toolName) === 'ask_user_question'))
      if (runningTool?.turn !== undefined) return runningTool.turn
      if (activeHistoryTurn !== undefined && (item.turn === undefined || closedTurns.has(item.turn))) {
        return activeHistoryTurn
      }
    }
    return item.turn
  }
  const result = [
    ...history.map(item => {
      const cached = liveById.get(item.id)
      if (cached === undefined) return item
      const historySeq = item.nativeRevisionSeq ?? item.nativeSeq ?? item.nativeOrderSeq ?? -1
      const liveSeq = cached.nativeRevisionSeq ?? cached.nativeSeq ?? cached.nativeOrderSeq ?? -1
      const authoritative = liveSeq > historySeq ? cached : item
      return authoritative.kind === 'message' && cached.kind === 'message'
        ? { ...authoritative, ...(authoritative.feedback === undefined && cached.feedback !== undefined ? { feedback: cached.feedback } : {}),
            ...(authoritative.role === 'user' && authoritative.images === undefined && cached.images !== undefined ? { images: cached.images } : {}) }
        : authoritative
    }),
    ...live.filter(item => {
      if (historyIds.has(item.id)) return false
      if (item.kind === 'message' && item.requestRpcId !== undefined && requests.has(item.requestRpcId)) return false
      // A follow snapshot replaces transient chunks already covered by its cursor.
      if (item.kind === 'message' && item.streaming && (item.nativeRevisionSeq ?? item.nativeSeq ?? item.nativeOrderSeq ?? Infinity) <= boundary) return false
      return true
    }).map(item => {
      if (item.kind !== 'approval' && item.kind !== 'question') return item
      const turn = resolveInteractionTurn(item)
      return turn === item.turn ? item : { ...item, ...(turn === undefined ? {} : { turn }) }
    }),
  ]
  return result.sort((a, b) => {
    const left = a.nativeOrderSeq ?? a.nativeSeq
    const right = b.nativeOrderSeq ?? b.nativeSeq
    if (left === undefined && right === undefined) return 0
    if (left === undefined) return 1
    if (right === undefined) return -1
    return left - right
  })
}

/** Reconcile durable `userQuestions` projection rows into the session's chat items. */
export function reconcileUserQuestionsProjection(
  items: ChatItem[],
  sessionId: string,
  userQuestions: unknown,
  inbox?: unknown,
): ChatItem[] {
  if (typeof userQuestions !== 'object' || userQuestions === null || Array.isArray(userQuestions)) return items
  const view = userQuestions as Record<string, unknown>
  if (!Array.isArray(view.active) || !Array.isArray(view.settled)) return items
  const queuedReplyCallIds = new Set<string>()
  if (typeof inbox === 'object' && inbox !== null && !Array.isArray(inbox)) {
    const inboxRecord = inbox as Record<string, unknown>
    for (const row of [
      ...(Array.isArray(inboxRecord['next-step']) ? inboxRecord['next-step'] : []),
      ...(Array.isArray(inboxRecord['next-turn']) ? inboxRecord['next-turn'] : []),
    ]) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
      const source = (row as Record<string, unknown>).source
      if (typeof source !== 'object' || source === null || Array.isArray(source)) continue
      const sourceRecord = source as Record<string, unknown>
      if (sourceRecord.kind === 'user-question-reply' && typeof sourceRecord.callId === 'string') {
        queuedReplyCallIds.add(sourceRecord.callId)
      }
    }
  }
  const settledCallIds = new Set<string>()
  for (const row of view.settled) {
    if (typeof row === 'object' && row !== null && typeof (row as Record<string, unknown>).callId === 'string') {
      settledCallIds.add((row as Record<string, unknown>).callId as string)
    }
  }
  const activeRows = view.active.flatMap(row => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return []
    const item = row as Record<string, unknown>
    if (typeof item.callId !== 'string' || !Array.isArray(item.questions) || item.questions.length === 0
      || (item.state !== 'open' && item.state !== 'continued')) return []
    return [{
      callId: item.callId,
      questions: item.questions as import('../types').AskUserQuestionItem[],
      state: item.state as 'open' | 'continued',
    }]
  })
  const activeByCallId = new Map(activeRows.map(row => [row.callId, row]))
  const activeTurn = (() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]!
      if (item.turnEnd !== undefined) return undefined
      const owner = item.turn ?? (item.kind === 'message' ? item.replyGroup : undefined)
      if (owner !== undefined) return owner
      if (item.kind === 'message' && item.role === 'user' && !item.context) return undefined
    }
    return undefined
  })()
  const seenCallIds = new Set<string>()
  let changed = false
  const updated = items.map((item): ChatItem => {
    if (item.kind !== 'question' || item.callId === undefined) return item
    seenCallIds.add(item.callId)
    if (settledCallIds.has(item.callId)) {
      if (item.outcome === 'answered') return item
      changed = true
      return { ...item, outcome: 'answered' as const }
    }
    const active = activeByCallId.get(item.callId)
    if (active === undefined) {
      if (item.outcome !== undefined) return item
      changed = true
      return { ...item, outcome: 'cancelled' as const }
    }
    const rpcId = `timed-question:${JSON.stringify([sessionId, active.callId])}`
    const matchedTool = items.find(row => row.kind === 'tool' && row.id === active.callId)
    const turn = matchedTool?.turn ?? item.turn ?? activeTurn
    const nextOutcome = active.state === 'continued' && queuedReplyCallIds.has(active.callId)
      ? 'queued' as const
      : item.outcome === 'answered' || item.outcome === 'queued'
        ? item.outcome
        : undefined
    if (item.frameRpcId === rpcId && item.questionState === active.state && item.outcome === nextOutcome && item.turn === turn && item.questions === active.questions) {
      return item
    }
    changed = true
    return {
      ...item,
      frameRpcId: item.frameRpcId ?? rpcId,
      questions: active.questions,
      questionState: active.state,
      ...(turn === undefined ? {} : { turn }),
      outcome: nextOutcome,
    }
  })
  const appended: ChatItem[] = []
  for (const active of activeRows) {
    if (seenCallIds.has(active.callId)) continue
    if (active.state === 'continued' && queuedReplyCallIds.has(active.callId)) continue
    const rpcId = `timed-question:${JSON.stringify([sessionId, active.callId])}`
    const matchedTool = items.find(row => row.kind === 'tool' && row.id === active.callId)
    const turn = matchedTool?.turn ?? activeTurn
    appended.push({
      kind: 'question',
      id: `question:${rpcId}`,
      sessionId,
      callId: active.callId,
      questionState: active.state,
      frameRpcId: rpcId,
      questions: active.questions,
      ...(turn === undefined ? {} : { turn }),
      createdAt: Date.now(),
    })
  }
  return !changed && appended.length === 0 ? items : [...updated, ...appended]
}

export type ChatSection =
  | { kind: 'item'; key: string; item: ChatItem }
  | { kind: 'process'; key: string; turn: string; items: ChatItem[] }

/** Group adjacent activity from one native turn, leaving user rows in place. */
export function chatSections(items: ChatItem[], previous?: readonly ChatSection[]): ChatSection[] {
  // Two phases on purpose: build fresh buffers first, then hand back the old
  // object per key when nothing about it moved. Pushing into `sections.at(-1)`
  // while reusing a previous section would mutate the array the previous
  // render still holds, which is exactly the corruption this cache must avoid.
  const drafts: ChatSection[] = []
  for (const item of items) {
    const turn = item.kind === 'message' && item.role === 'user'
      ? undefined
      : item.turn ?? (item.kind === 'message' ? item.replyGroup : undefined)
    const last = drafts.at(-1)
    if (turn !== undefined && last?.kind === 'process' && last.turn === turn) {
      last.items.push(item)
    } else if (turn !== undefined) {
      drafts.push({ kind: 'process', key: `process:${turn}:${item.id}`, turn, items: [item] })
    } else {
      drafts.push({ kind: 'item', key: item.id, item })
    }
  }
  if (previous === undefined || previous.length === 0) return drafts
  const reusable = new Map<string, ChatSection>()
  for (const section of previous) reusable.set(section.key, section)
  const sections: ChatSection[] = []
  for (const draft of drafts) {
    const old = reusable.get(draft.key)
    if (old === undefined || old.kind !== draft.kind) {
      sections.push(draft)
    } else if (draft.kind === 'item') {
      sections.push(old.kind === 'item' && old.item === draft.item ? old : draft)
    } else {
      sections.push(old.kind === 'process' && sameItems(old.items, draft.items) ? old : draft)
    }
  }
  return sections
}

/** True when both lists carry the same objects in the same order. */
function sameItems(a: readonly ChatItem[], b: readonly ChatItem[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
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
    const textVisible = hasVisibleText(item.text) || (item.images?.length ?? 0) > 0
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
  return mergeHistoryAndLive(older, current)
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

/**
 * Distance from the newest row that still counts as "at the latest message".
 * Follow mode and the jump-to-latest button share this edge, so the button
 * appears exactly when the viewport has left the turn streaming appends to.
 */
export const LATEST_EDGE_PX = 80

/**
 * Cheap signature of the latest chat item so streaming token deltas trigger auto-scroll
 * without deep item re-rendering.
 */
export function computeStreamingSignature(items: readonly ChatItem[]): string {
  if (items.length === 0) return ''
  const last = items[items.length - 1]
  if (last === undefined) return ''
  if (last.kind === 'message') {
    return `${last.id}:${last.text.length}:${last.reasoning?.length ?? 0}:${last.turnEnd ? last.turnEnd.reason : ''}:${last.sendState ?? ''}`
  }
  return `${last.id}:${last.kind}`
}
