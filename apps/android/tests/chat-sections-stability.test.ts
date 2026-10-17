import { describe, expect, it } from 'vitest'
import { chatSections, type ChatSection } from '../src/state/message-helpers'
import type { ChatMessage } from '../src/types'

/** One assistant turn's activity, as the timeline holds it while a reply streams. */
function turnActivity(turn: string, ids: readonly string[]): ChatMessage[] {
  return ids.map((id, index) => ({
    kind: 'message' as const,
    role: 'assistant' as const,
    sessionId: 's1',
    id,
    text: `step ${index}`,
    turn,
    nativeSeq: index + 1,
    createdAt: index + 1,
  }))
}

function userRow(id: string): ChatMessage {
  return { kind: 'message', role: 'user', sessionId: 's1', id, text: 'prompt', nativeSeq: 0, createdAt: 0 }
}

function processSection(sections: readonly ChatSection[], turn: string) {
  const found = sections.find(section => section.kind === 'process' && section.turn === turn)
  if (found?.kind !== 'process') throw new Error(`no process section for turn ${turn}`)
  return found
}

describe('chatSections reference stability', () => {
  it('keeps an untouched finished group identical while the last reply streams', () => {
    const finished = turnActivity('t1', ['a1', 'a2'])
    const streamingFirst = turnActivity('t2', ['b1'])
    const before = [...finished, ...streamingFirst].map(item => ({ ...item, text: 'streamed' }))
    const first = chatSections([userRow('u0'), ...before])

    // One more character on the last reply only: every earlier item keeps its identity.
    const after = [...before.slice(0, -1), { ...before.at(-1)!, text: 'streamed!' }]
    const second = chatSections([userRow('u0'), ...after], first)

    const oldGroup = processSection(first, 't1')
    const newGroup = processSection(second, 't1')
    expect(newGroup).toBe(oldGroup)
    expect(newGroup.items).toBe(oldGroup.items)
    expect(newGroup.items[0]).toBe(oldGroup.items[0])
  })

  it('replaces the group that actually changed instead of reusing it', () => {
    const finished = turnActivity('t1', ['a1', 'a2'])
    const first = chatSections([...finished])
    const changed = [{ ...finished[0]!, text: 'edited' }, finished[1]!]
    const second = chatSections(changed, first)

    const oldGroup = processSection(first, 't1')
    const newGroup = processSection(second, 't1')
    expect(newGroup).not.toBe(oldGroup)
    expect(newGroup.items).not.toBe(oldGroup.items)
    expect(newGroup.items[1]).toBe(oldGroup.items[1])
  })

  it('does not reuse a group whose item count changed', () => {
    const first = chatSections(turnActivity('t1', ['a1']))
    const second = chatSections(turnActivity('t1', ['a1', 'a2']), first)
    expect(processSection(second, 't1')).not.toBe(processSection(first, 't1'))
  })

  it('reuses standalone rows and never mutates the previous result', () => {
    const prompt = userRow('u0')
    const first = chatSections([prompt])
    const second = chatSections([prompt], first)
    expect(second[0]).toBe(first[0])

    const orphan: ChatMessage = { ...userRow('x1'), role: 'assistant', id: 'x1' }
    const third = chatSections([prompt, orphan], second)
    // The earlier section list is a historical value and must stay untouched.
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(third).toHaveLength(2)
  })

  it('keeps keys stable when history is prepended in front of the timeline', () => {
    const live = [...turnActivity('t1', ['a1', 'a2'])]
    const first = chatSections(live)
    const older = [...turnActivity('h1', ['p1', 'p2']), ...live]
    const second = chatSections(older, first)

    // The prepended group is new; the live group keeps its key so FlatList can
    // match it across the prepend (a shifted key would remount every row).
    const oldKey = processSection(first, 't1').key
    const newKey = processSection(second, 't1').key
    expect(newKey).toBe(oldKey)
    expect(processSection(second, 'h1').key).not.toBe(oldKey)
  })
})
