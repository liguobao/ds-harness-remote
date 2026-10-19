/**
 * F1 · per-section artifact bucket stability
 *
 * `ChatProcessGroup` is memoized with a custom comparator that compares
 * `artifacts` / `updatedArtifacts` by reference. `placeUiArtifacts` allocates
 * fresh arrays on every run, so without bucket-level reuse every group holding
 * an Intelligent UI card re-renders on every streaming delta.
 *
 * These tests pin the reuse predicate: same `uiId` + same `version` means the
 * same card, and a bumped version must invalidate it.
 */
import { describe, expect, it } from 'vitest'

import type { UiArtifact } from '../src/state/ui-artifacts'

/** Mirror of `sameArtifacts` in chat-screen.tsx. */
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

function artifact(uiId: string, version: number, definition: Record<string, unknown> = {}): UiArtifact {
  return {
    kind: 'declarative', hostId: 'host-1', sessionId: 'session-1',
    uiId, version, definition, originSeq: 1,
  }
}

describe('sameArtifacts', () => {
  it('treats rebuilt objects with equal identity as the same card', () => {
    // projectUiArtifacts rebuilds the object each run; identity is uiId+version.
    const before = [artifact('ui-1', 1), artifact('ui-2', 2)]
    const after = [artifact('ui-1', 1), artifact('ui-2', 2)]
    expect(after[0]).not.toBe(before[0])
    expect(sameArtifacts(before, after)).toBe(true)
  })

  it('invalidates a card whose version advanced', () => {
    expect(sameArtifacts([artifact('ui-1', 1)], [artifact('ui-1', 2)])).toBe(false)
  })

  it('invalidates when a different uiId appears at the same index', () => {
    expect(sameArtifacts([artifact('ui-1', 1)], [artifact('ui-9', 1)])).toBe(false)
  })

  it('invalidates on a length change', () => {
    expect(sameArtifacts([artifact('ui-1', 1)], [artifact('ui-1', 1), artifact('ui-2', 1)])).toBe(false)
  })

  it('accepts the identical array without walking it', () => {
    const list = [artifact('ui-1', 1)]
    expect(sameArtifacts(list, list)).toBe(true)
  })

  it('accepts two empty lists', () => {
    expect(sameArtifacts([], [])).toBe(true)
  })
})
