import { describe, expect, it } from 'vitest'
import type { ChatItem, ChatMessage, ToolActivity } from '../src/types'
import { limitToLatestTurn } from '../src/state/message-helpers'

/**
 * One-turn contract for the Android client.
 *
 * The Remote Host can replay only the newest turn, but that limit applies to
 * the history it sends when a session opens. A session left open keeps
 * appending deltas and regrows the transcript the Host tried to trim, so the
 * client trims the rendered transcript itself. These tests pin down what
 * "one turn" means and the cases where trimming must not blank the screen.
 */

function message(id: string, role: 'user' | 'assistant', turn?: string): ChatMessage {
  return {
    kind: 'message',
    id,
    role,
    text: id,
    ...(turn === undefined ? {} : { turn }),
  } as ChatMessage
}

function tool(id: string, turn?: string): ToolActivity {
  return {
    kind: 'tool',
    id,
    turn,
  } as unknown as ToolActivity
}

const ids = (items: ChatItem[]): string[] => items.map(item => item.id)

describe('limitToLatestTurn', () => {
  it('keeps only rows after the newest user message', () => {
    const items = [
      message('u1', 'user', 't1'),
      message('a1', 'assistant', 't1'),
      message('u2', 'user', 't2'),
      message('a2', 'assistant', 't2'),
    ]
    expect(ids(limitToLatestTurn(items))).toEqual(['u2', 'a2'])
  })

  it('drops older-turn tool rows that sit before the newest user row', () => {
    const items = [
      message('u1', 'user', 't1'),
      message('a1', 'assistant', 't1'),
      tool('tool1', 't1'),
      message('u2', 'user', 't2'),
      tool('tool2', 't2'),
      message('a2', 'assistant', 't2'),
    ]
    expect(ids(limitToLatestTurn(items))).toEqual(['u2', 'tool2', 'a2'])
  })

  it('keeps a leading assistant row when it belongs to the newest turn', () => {
    // The incoming page can start mid-turn: the user row already scrolled out.
    const items = [message('a1', 'assistant', 't9'), tool('tool1', 't9')]
    expect(ids(limitToLatestTurn(items))).toEqual(['a1', 'tool1'])
  })

  it('drops a stale assistant row when a newer turn is present', () => {
    const items = [
      message('a0', 'assistant', 't8'),
      message('u2', 'user', 't9'),
      message('a2', 'assistant', 't9'),
    ]
    expect(ids(limitToLatestTurn(items))).toEqual(['u2', 'a2'])
  })

  it('keeps rows that carry no turn evidence at all', () => {
    const items = [message('local1', 'assistant'), message('local2', 'assistant')]
    expect(ids(limitToLatestTurn(items))).toEqual(['local1', 'local2'])
  })

  it('never returns an empty list for a non-empty transcript', () => {
    const items = [
      message('u1', 'user', 't1'),
      message('a1', 'assistant', 't1'),
      tool('orphan', 'tX'),
    ]
    expect(limitToLatestTurn(items).length).toBeGreaterThan(0)
  })

  it('returns the same reference for an empty transcript', () => {
    const empty: ChatItem[] = []
    expect(limitToLatestTurn(empty)).toBe(empty)
  })

  it('leaves a single turn unchanged', () => {
    const items = [message('u1', 'user', 't1'), message('a1', 'assistant', 't1')]
    expect(ids(limitToLatestTurn(items))).toEqual(['u1', 'a1'])
  })

  it('keeps only the newest of many turns', () => {
    const items: ChatItem[] = []
    for (let t = 0; t < 50; t += 1) {
      items.push(message(`u${t}`, 'user', `t${t}`))
      items.push(message(`a${t}`, 'assistant', `t${t}`))
    }
    expect(ids(limitToLatestTurn(items))).toEqual(['u49', 'a49'])
  })

  it('keeps the streaming turn when the newest user row is the last row', () => {
    const items = [
      message('u1', 'user', 't1'),
      message('a1', 'assistant', 't1'),
      message('u2', 'user', 't2'),
    ]
    expect(ids(limitToLatestTurn(items))).toEqual(['u2'])
  })
})
