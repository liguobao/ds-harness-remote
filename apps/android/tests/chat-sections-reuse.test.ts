/**
 * P2 · chatSections reference reuse
 *
 * The streaming path rebuilds `visibleMessages` on every delta. Unless the
 * unchanged groups keep their object identity, every memoized row re-renders
 * for a single appended character. These tests pin that contract, plus the
 * negative cases where reuse must NOT happen.
 */
import { describe, expect, it } from 'vitest'

import { chatSections, type ChatSection } from '../src/state/message-helpers'
import type { ChatItem, ChatMessage, ToolActivity } from '../src/types'

const SESSION = 'session-1'

function userMessage(id: string): ChatMessage {
  return { kind: 'message', id, sessionId: SESSION, createdAt: 0, role: 'user', text: id }
}

function assistantMessage(id: string, turn: string, text: string): ChatMessage {
  return {
    kind: 'message', id, sessionId: SESSION, createdAt: 0, turn,
    role: 'assistant', text, replyGroup: turn,
  }
}

function toolItem(id: string, turn: string): ToolActivity {
  return {
    kind: 'tool', id, sessionId: SESSION, createdAt: 0, turn,
    toolName: 'Shell', toolKey: 'shell', state: 'finished',
  }
}

/** Two finished turns plus a live one, the shape a long session has. */
function history(): ChatItem[] {
  return [
    userMessage('u1'),
    assistantMessage('a1', 't1', 'first'),
    toolItem('tool1', 't1'),
    userMessage('u2'),
    assistantMessage('a2', 't2', 'second'),
  ]
}

/** Narrow a section to the process variant, failing the test when it is not. */
function asProcess(section: ChatSection | undefined): Extract<ChatSection, { kind: 'process' }> {
  if (section === undefined || section.kind !== 'process') {
    throw new Error('expected a process section')
  }
  return section
}

describe('chatSections reference reuse', () => {
  it('keeps every section when the input is untouched', () => {
    const items = history()
    const first = chatSections(items)
    const second = chatSections(items, first)
    expect(second.length).toBe(first.length)
    for (let index = 0; index < first.length; index += 1) {
      expect(second[index]).toBe(first[index])
    }
  })

  it('reuses finished groups while the last reply streams one more character', () => {
    const items = history()
    const first = chatSections(items)

    // Append a character to the live assistant row, exactly like a text delta.
    const streamed: ChatItem[] = items.map(item =>
      item.id === 'a2' && item.kind === 'message' ? { ...item, text: item.text + '!' } : item)
    const second = chatSections(streamed, first)

    // The finished first turn must be the very same object, and its items array
    // must be the same array so ChatProcessGroup's shallow compare sees the
    // identical props.
    expect(second[1]).toBe(first[1])
    expect(asProcess(second[1]).items).toBe(asProcess(first[1]).items)

    // The live group did change, so it must be a new object.
    const liveBefore = first.find(section => section.kind === 'process' && section.turn === 't2')
    const liveAfter = second.find(section => section.kind === 'process' && section.turn === 't2')
    expect(liveBefore).toBeDefined()
    expect(liveAfter).not.toBe(liveBefore)
  })

  it('does not mutate the previous list', () => {
    const items = history()
    const first = chatSections(items)
    const snapshot = first.map(section => (section.kind === 'process' ? section.items.length : -1))

    const streamed = [...items, assistantMessage('a3', 't2', 'more')]
    chatSections(streamed, first)

    const after = first.map(section => (section.kind === 'process' ? section.items.length : -1))
    expect(after).toEqual(snapshot)
  })

  it('rebuilds when history is prepended above the existing turns', () => {
    const items = history()
    const first = chatSections(items)

    // loadOlderHistory prepends an earlier turn; every index shifts.
    const older: ChatItem[] = [userMessage('u0'), assistantMessage('a0', 't0', 'zeroth')]
    const prepended = [...older, ...items]
    const second = chatSections(prepended, first)

    expect(second.length).toBeGreaterThan(first.length)
    expect(second[0]).not.toBe(first[0])
    // The untouched t1 group keeps its key even though its index moved.
    const reused = second.find(section => section.key === 'process:t1:a1')
    expect(reused).toBe(asProcess(first.find(section => section.key === 'process:t1:a1')))
  })

  it('rebuilds a group when one of its items is replaced', () => {
    const items = history()
    const first = chatSections(items)

    const edited: ChatItem[] = items.map(item =>
      item.id === 'tool1' && item.kind === 'tool' ? { ...item, state: 'running' } : item)
    const second = chatSections(edited, first)

    // The group key is `process:<turn>:<first item id>`, so the t1 group is
    // keyed by a1 (its first row), not by the tool that was replaced.
    const before = first.find(section => section.key === 'process:t1:a1')
    const after = second.find(section => section.key === 'process:t1:a1')
    expect(before).toBeDefined()
    // Same key, but one member is a different object -> must NOT be reused.
    expect(after).not.toBe(before)
  })

  it('behaves identically when no previous list is supplied', () => {
    const withoutPrevious = chatSections(history())
    expect(withoutPrevious.map(section => section.key))
      .toEqual(['u1', 'process:t1:a1', 'u2', 'process:t2:a2'])
  })
})
