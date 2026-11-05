import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoveryDelayMs } from '../src/adaptive-transport.js'

describe('recoveryDelayMs', () => {
  afterEach(() => vi.restoreAllMocks())

  it('backs off into the full window after any disconnect', () => {
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0.5)
    // Network loss, heartbeat expiry, unknown close, control errors and a
    // Server restart all draw from the same [0, 15s] window.
    for (const diagnostic of [
      { reason: 'control-error' } as const,
      { reason: 'control-closed', closeCode: 1006 } as const,
      { reason: 'control-closed', closeCode: 4009, closeReason: 'heartbeat timeout' } as const,
      { reason: 'control-closed', closeCode: 4001, closeReason: 'AUTH_INVALID' } as const,
      { reason: 'control-closed', closeCode: 4009, closeReason: 'server shutdown' } as const,
      { reason: 'control-closed', closeCode: 4001, closeReason: 'server shutdown' } as const,
    ]) {
      expect(recoveryDelayMs(0, diagnostic), JSON.stringify(diagnostic)).toBe(7_500)
    }
  })

  it('never retries immediately and never exceeds the cap', () => {
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0)
    expect(recoveryDelayMs(0, { reason: 'control-error' })).toBe(0)
    random.mockReturnValue(0.9999)
    for (const attempt of [0, 1, 2, 5, 99]) {
      const delay = recoveryDelayMs(attempt, { reason: 'control-error' })
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThan(15_000)
    }
  })

  it('keeps the same window for later attempts instead of shrinking', () => {
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0.5)
    for (const attempt of [1, 2, 5, 99]) {
      expect(recoveryDelayMs(attempt, { reason: 'control-error' })).toBe(7_500)
    }
  })
})
