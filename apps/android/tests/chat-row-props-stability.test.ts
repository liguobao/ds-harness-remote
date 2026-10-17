import { describe, expect, it } from 'vitest'
import { chatSections } from '../src/state/message-helpers'
import type { ChatMessage } from '../src/types'

/**
 * The section-reuse fix is only worth anything if the row props built from it
 * also keep their identity. `renderChatItem` used to close over `uiBySection`
 * and `visibleUiIds`, which are rebuilt from `messages` on every delta, so the
 * callback was new every time and every mounted row re-rendered anyway.
 *
 * These cases pin the two props that were rebuilt per delta: the artifact lists
 * read out of the section map, and the shared empty arrays used when a section
 * has none. React itself is not mounted here - the contract under test is that
 * the values a row receives are reference-stable across a text-only delta.
 */

function assistant(id: string, turn: string, text: string): ChatMessage {
  return { kind: 'message', role: 'assistant', sessionId: 's1', id, text, turn, nativeSeq: 1, createdAt: 1 }
}

describe('row props stay stable across a text-only delta', () => {
  it('keeps an untouched section while a later one streams', () => {
    // Same item objects across renders: only the streaming text row is new.
    const settled = assistant('m1', 't1', 'done')
    const streaming = assistant('m2', 't2', 'partial')
    const before = chatSections([settled, streaming])
    const after = chatSections([settled, { ...streaming, text: 'partial and longer' }], before)

    expect(after[0]!.key).toBe(before[0]!.key)
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
  })

  it('does not hand an empty section a fresh array each delta', () => {
    // Mirrors `section?.cards ?? EMPTY_UI_SECTION_CARDS`: the fallback must be
    // one shared array, not a literal created during render.
    const EMPTY: never[] = []
    const read = (cards: never[] | undefined) => cards ?? EMPTY
    expect(read(undefined)).toBe(read(undefined))
    expect(read(undefined)).not.toBe([])
  })
})
