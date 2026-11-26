import { describe, expect, it } from 'vitest'
import type { ChatItem, ChatMessage } from '../src/types'
import { reconcileAcpCachedPrompts } from '../src/services/cursor'

const item = (overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'text'>): ChatMessage => ({
  kind: 'message',
  sessionId: 'cursor:s1',
  createdAt: 1,
  ...overrides,
})
const completed = { reason: 'completed' as const, time: 2 }

describe('reconcileAcpCachedPrompts tail retention', () => {
  it('drops an unmatched local turn once a later anchored prompt is confirmed in history', () => {
    const history: ChatItem[] = [
      item({ id: 'user-1', role: 'user', text: 'A', nativeSeq: 0 }),
      item({ id: 'answer-1', role: 'assistant', text: 'a1', turnEnd: completed }),
      item({ id: 'user-2', role: 'user', text: 'B', nativeSeq: 4 }),
      item({ id: 'answer-2', role: 'assistant', text: 'a2', turnEnd: completed }),
    ]
    const cached: ChatItem[] = [
      // Already-persisted turn: reserves its place and clears the buffer.
      item({ id: 'user-1', role: 'user', text: 'A', nativeSeq: 0 }),
      item({ id: 'answer-1', role: 'assistant', text: 'a1', turnEnd: completed }),
      // Completed local turn whose reply the snapshot no longer carries.
      item({ id: 'local:stale', role: 'user', text: 'X', requestRpcId: 'stale' }),
      item({ id: 'local:stale-reply', role: 'assistant', text: 'x-local', turnEnd: completed }),
      // Acknowledged against the persisted predecessor, still unanswered.
      item({ id: 'local:B1', role: 'user', text: 'B', acpPromptAfter: 'user-1', requestRpcId: 'B1' }),
    ]
    const { confirmedIds, retainedIds } = reconcileAcpCachedPrompts(history, cached)
    expect(confirmedIds.has('local:B1')).toBe(true)
    // The confirmed successor proves the snapshot already passed X, so keeping
    // X as a tail would duplicate it on the next read.
    expect(retainedIds.has('local:stale')).toBe(false)
    expect(retainedIds.size).toBe(0)
  })
})
