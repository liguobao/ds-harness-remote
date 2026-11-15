import { describe, expect, it } from 'vitest'
import { isVisibleSession } from '../src/lib/session-visibility'
import type { RemoteSession } from '../src/types'

describe('session list visibility (#446)', () => {
  const blank: RemoteSession = {
    sessionId: 'blank', blank: true, running: false, updatedAt: 1, title: 'New conversation',
  }
  const populated: RemoteSession = { ...blank, sessionId: 'populated', blank: false }

  it('hides abandoned placeholders immediately on selection changes without deleting reusable sessions', () => {
    const sessions = [blank, { ...blank, sessionId: 'older' }, populated]
    for (const scenario of [
      { name: 'current blank', current: 'blank', expected: ['blank', 'populated'] },
      { name: 'switch to populated', current: 'populated', expected: ['populated'] },
      { name: 'no selection', current: undefined, expected: ['populated'] },
      { name: 'reopen blank', current: 'blank', expected: ['blank', 'populated'] },
    ]) {
      const visible = sessions.filter(session => isVisibleSession(session, scenario.current))
      expect(visible.map(session => session.sessionId), scenario.name).toEqual(scenario.expected)
      expect(visible.length, `${scenario.name}: count`).toBe(scenario.expected.length)
    }
    expect(sessions.filter(session => session.blank)).toEqual([blank, { ...blank, sessionId: 'older' }])
  })

  it('excludes every blank from search, including the current placeholder', () => {
    for (const query of ['New', ' new ', 'New conversation']) {
      expect(isVisibleSession(blank, blank.sessionId, query), query).toBe(false)
      expect(isVisibleSession(blank, populated.sessionId, query), query).toBe(false)
      expect(isVisibleSession(populated, blank.sessionId, query), query).toBe(true)
    }
    expect(isVisibleSession(blank, blank.sessionId, '  ')).toBe(true)
  })

  it('uses explicit blank and origin flags across backends while retaining ordinary forks', () => {
    for (const backend of ['harness', 'codex', 'claude'] as const) {
      expect(isVisibleSession({ ...blank, backend }, populated.sessionId), backend).toBe(false)
      expect(isVisibleSession({ ...populated, backend }, undefined), backend).toBe(true)
      expect(isVisibleSession({ ...populated, backend, parentSessionId: 'parent' }, undefined), backend).toBe(true)
      expect(isVisibleSession({ ...populated, backend, origin: 'subagent' }, populated.sessionId), backend).toBe(false)
    }
    expect(isVisibleSession({ ...blank, blank: false }, undefined)).toBe(true)
  })
})
