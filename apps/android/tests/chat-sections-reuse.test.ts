/**
 * P2 · chatSections reference reuse and the caches that ride on it.
 *
 * The streaming path rebuilds `visibleMessages` on every delta. Unless the
 * unchanged groups keep their object identity, every memoized row re-renders
 * for a single appended character. These tests pin that contract, the
 * negative cases where reuse must NOT happen, the artifact/id caches the
 * rows rely on, and the cross-session safety of the screen-lifetime caches.
 */
import { describe, expect, it } from 'vitest'

import { chatSections, type ChatSection } from '../src/state/message-helpers'
import type { UiArtifact } from '../src/state/ui-artifacts'
import type { ChatItem, ChatMessage, ToolActivity } from '../src/types'

const SESSION = 'session-1'

function userMessage(id: string, session: string = SESSION): ChatMessage {
  return { kind: 'message', id, sessionId: session, createdAt: 0, role: 'user', text: id }
}

function assistantMessage(id: string, turn: string, text: string, session: string = SESSION): ChatMessage {
  return {
    kind: 'message', id, sessionId: session, createdAt: 0, turn,
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

  it('does not reuse across sessions with colliding keys, then resumes reuse within a session', () => {
    const sessionA: ChatItem[] = [userMessage('u1', 'A'), assistantMessage('a1', 't1', 'hello from A', 'A')]
    const sessionB: ChatItem[] = [userMessage('u1', 'B'), assistantMessage('a1', 't1', 'hello from B', 'B')]

    const first = chatSections(sessionA)
    // Same keys by construction (u1 / process:t1:a1), different objects.
    const second = chatSections(sessionB, first)

    expect(second.map(section => section.key)).toEqual(first.map(section => section.key))
    // Same key is not enough: the item references differ, so nothing may be reused.
    for (let index = 0; index < second.length; index += 1) {
      expect(second[index]).not.toBe(first[index])
    }

    // Back to A with an unchanged input: the previous list is reused again.
    const backToA = chatSections(sessionA, first)
    expect(backToA[0]).toBe(first[0])
    expect(backToA[1]).toBe(first[1])
  })

  it('handles a session that carries no user rows', () => {
    const systemOnly: ChatItem[] = [
      { kind: 'message', id: 's1', sessionId: 'X', createdAt: 0, role: 'system', text: 'boot' },
    ]
    const sections = chatSections(systemOnly, chatSections(systemOnly))
    expect(sections.map(section => section.key)).toEqual(['s1'])
  })
})

describe('screen cache comparisons', () => {
  // Mirror of `sameArtifacts` in chat-screen.tsx.
  function sameArtifacts(a: readonly UiArtifact[], b: readonly UiArtifact[]): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      const left = a[index]
      const right = b[index]
      if (left === right) continue
      if (left === undefined || right === undefined) return false
      if (left.uiId !== right.uiId || left.version !== right.version) return false
    }
    return true
  }

  function artifact(uiId: string, version: number): UiArtifact {
    return {
      kind: 'declarative', hostId: 'host-1', sessionId: 'session-1',
      uiId, version, definition: {}, originSeq: 1,
    }
  }

  // Mirror of the visibleUiIds comparison in chat-screen.tsx.
  function sameIdSet(cached: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
    if (cached.size !== next.size) return false
    for (const id of next) {
      if (!cached.has(id)) return false
    }
    return true
  }

  it('reuses artifact buckets only when every uiId+version matches', () => {
    // projectUiArtifacts rebuilds the object each run; identity is uiId+version.
    const before = [artifact('ui-1', 1), artifact('ui-2', 2)]
    const rebuilt = [artifact('ui-1', 1), artifact('ui-2', 2)]
    const identical = before
    const versionBumped = [artifact('ui-1', 2)]
    const differentId = [artifact('ui-9', 1)]
    const longer = [artifact('ui-1', 1), artifact('ui-2', 1)]

    const cases: { a: readonly UiArtifact[]; b: readonly UiArtifact[]; same: boolean }[] = [
      { a: before, b: rebuilt, same: true },          // equal identity, new objects
      { a: identical, b: identical, same: true },     // identical array, short-circuit
      { a: [], b: [], same: true },                   // two empty lists
      { a: before, b: versionBumped, same: false },   // version advanced
      { a: before, b: differentId, same: false },     // different uiId at same index
      { a: before, b: longer, same: false },          // length change
    ]
    expect(rebuilt[0]).not.toBe(before[0])
    for (const { a, b, same } of cases) {
      expect(sameArtifacts(a, b)).toBe(same)
    }
  })

  it('reuses the uiId set only when the member set is identical', () => {
    const reordered: [ReadonlySet<string>, ReadonlySet<string>, boolean] =
      [new Set(['x', 'y', 'z']), new Set(['z', 'x', 'y']), true]
    const differentMember: [ReadonlySet<string>, ReadonlySet<string>, boolean] =
      [new Set(['x', 'y', 'z']), new Set(['x', 'y', 'w']), false]
    const differentSize: [ReadonlySet<string>, ReadonlySet<string>, boolean] =
      [new Set(['x']), new Set(['x', 'y']), false]
    // Two sessions can only collide if they produced the same tool ids; the
    // set carries the whole uiId list, not a session tag, so a genuine
    // difference always changes a member.
    const crossSession: [ReadonlySet<string>, ReadonlySet<string>, boolean] =
      [new Set(['tool-1', 'tool-2']), new Set(['tool-1', 'tool-3']), false]

    for (const [a, b, same] of [reordered, differentMember, differentSize, crossSession]) {
      expect(sameIdSet(a, b)).toBe(same)
    }
  })
})
