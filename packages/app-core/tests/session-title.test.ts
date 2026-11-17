import { describe, expect, it } from 'vitest'
import { resolveSessionDisplayTitle } from '../src/screens/session-title'
import type { RemoteSession } from '../src/types'

describe('session display title', () => {
  const session: RemoteSession = {
    sessionId: 'codex:thread', backend: 'codex', updatedAt: 1, running: false, blank: false,
    projections: { values: { summary: 'Review the latest PR' } },
  }

  it('uses the thread preview until an official title is available', () => {
    expect(resolveSessionDisplayTitle(session)).toBe('Review the latest PR')
    expect(resolveSessionDisplayTitle({ ...session, title: 'PR review' })).toBe('PR review')
    expect(resolveSessionDisplayTitle({ ...session, projections: { values: { summary: 'Preview', title: 'Generated title' } } })).toBe('Generated title')
  })

  it('keeps empty new conversations untitled', () => {
    expect(resolveSessionDisplayTitle({ ...session, projections: { values: { summary: '  ' } } })).toBeUndefined()
  })
})
