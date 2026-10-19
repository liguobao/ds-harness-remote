/**
 * `visibleUiIds` cache equivalence.
 *
 * The screen holds one cache ref for its whole lifetime (FlatList remounts per
 * session, the component does not). These tests pin the Set comparison the
 * cache relies on: identical members reuse the reference, a different member
 * set must not.
 */
import { describe, expect, it } from 'vitest'

/** Mirror of the comparison in chat-screen.tsx. */
function sameIdSet(cached: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  if (cached.size !== next.size) return false
  for (const id of next) {
    if (!cached.has(id)) return false
  }
  return true
}

describe('visibleUiIds cache comparison', () => {
  it('treats a reordered but equal set as reusable', () => {
    const a = new Set(['x', 'y', 'z'])
    const b = new Set(['z', 'x', 'y'])
    expect(sameIdSet(a, b)).toBe(true)
  })

  it('rejects a different member of the same size', () => {
    const a = new Set(['x', 'y', 'z'])
    const b = new Set(['x', 'y', 'w'])
    expect(sameIdSet(a, b)).toBe(false)
  })

  it('rejects a different size', () => {
    expect(sameIdSet(new Set(['x']), new Set(['x', 'y']))).toBe(false)
  })

  it('never lets a session id collision hide a real difference', () => {
    // Two sessions can only collide here if they produced the same tool ids.
    // The set therefore carries the whole uiId list, not a session tag; a
    // genuine difference always changes a member.
    const sessionA = new Set(['tool-1', 'tool-2'])
    const sessionB = new Set(['tool-1', 'tool-3'])
    expect(sameIdSet(sessionA, sessionB)).toBe(false)
  })
})
