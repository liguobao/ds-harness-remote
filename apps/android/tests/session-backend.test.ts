import { describe, expect, it } from 'vitest'
import { sessionBackendFromId } from '../src/lib/session-backend'

describe('sessionBackendFromId', () => {
  it('routes every ACP session prefix to its own backend', () => {
    expect(sessionBackendFromId('codex:abc')).toBe('codex')
    expect(sessionBackendFromId('cursor:abc')).toBe('cursor')
    expect(sessionBackendFromId('antigravity:abc')).toBe('antigravity')
    expect(sessionBackendFromId('pi:abc')).toBe('pi')
    expect(sessionBackendFromId('opencode:abc')).toBe('opencode')
    expect(sessionBackendFromId('claude:abc')).toBe('claude')
    // A Hermes link must refresh the Hermes catalog, not fall back to Harness.
    expect(sessionBackendFromId('hermes:local-1')).toBe('hermes')
  })

  it('treats an unprefixed id as a Harness session', () => {
    expect(sessionBackendFromId('20261101_014936_61981b')).toBe('harness')
    expect(sessionBackendFromId('local-77c32310')).toBe('harness')
  })
})
