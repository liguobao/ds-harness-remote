/**
 * Cross-session safety for the P2 caches.
 *
 * `previousSectionsRef` and `visibleUiIdsCache` live for the lifetime of the
 * screen, but the screen is also remounted per session. These tests pin what
 * happens when the *same* caches see a different session's items: the reuse
 * must not leak sections across sessions.
 */
import { describe, expect, it } from 'vitest'

import { chatSections } from '../src/state/message-helpers'
import type { ChatItem, ChatMessage } from '../src/types'

function user(id: string, session: string): ChatMessage {
  return { kind: 'message', id, sessionId: session, createdAt: 0, role: 'user', text: id }
}

function assistant(id: string, turn: string, session: string, text: string): ChatMessage {
  return {
    kind: 'message', id, sessionId: session, createdAt: 0, turn,
    role: 'assistant', text, replyGroup: turn,
  }
}

describe('chatSections cache across sessions', () => {
  it('does not reuse a section whose items belong to another session', () => {
    const sessionA: ChatItem[] = [user('u1', 'A'), assistant('a1', 't1', 'A', 'hello from A')]
    const sessionB: ChatItem[] = [user('u1', 'B'), assistant('a1', 't1', 'B', 'hello from B')]

    const first = chatSections(sessionA)
    // Same keys by construction (u1 / process:t1:a1), different objects.
    const second = chatSections(sessionB, first)

    expect(second.map(section => section.key)).toEqual(first.map(section => section.key))
    // Same key is not enough: the item references differ, so nothing may be reused.
    for (let index = 0; index < second.length; index += 1) {
      expect(second[index]).not.toBe(first[index])
    }
  })

  it('still reuses within the same session after a foreign list was seen', () => {
    const sessionA: ChatItem[] = [user('u1', 'A'), assistant('a1', 't1', 'A', 'hello')]
    const sessionB: ChatItem[] = [user('u1', 'B'), assistant('a1', 't1', 'B', 'other')]

    const a1 = chatSections(sessionA)
    chatSections(sessionB, a1)          // a foreign session churns the cache
    const a2 = chatSections(sessionA, a1)   // back to A, unchanged input

    expect(a2[0]).toBe(a1[0])
    expect(a2[1]).toBe(a1[1])
  })

  it('handles a session that carries no user rows', () => {
    const systemOnly: ChatItem[] = [
      { kind: 'message', id: 's1', sessionId: 'X', createdAt: 0, role: 'system', text: 'boot' },
    ]
    const sections = chatSections(systemOnly, chatSections(systemOnly))
    expect(sections.map(section => section.key)).toEqual(['s1'])
  })
})
