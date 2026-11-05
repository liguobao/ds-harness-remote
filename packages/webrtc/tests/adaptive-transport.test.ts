import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoveryDelayMs } from '../src/adaptive-transport.js'

describe('recoveryDelayMs', () => {
  afterEach(() => vi.restoreAllMocks())

  it('jitters the first retry only for a server shutdown close', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(recoveryDelayMs(0, { reason: 'control-closed', closeCode: 4001, closeReason: 'server shutdown' })).toBe(7_500)
    expect(recoveryDelayMs(0, { reason: 'control-closed', closeCode: 4001, closeReason: 'AUTH_INVALID' })).toBe(0)
    expect(recoveryDelayMs(0, { reason: 'control-closed', closeCode: 1006 })).toBe(0)
  })

  it('preserves the existing backoff sequence after the first attempt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(recoveryDelayMs(1, { reason: 'control-error' })).toBe(4_000)
    expect(recoveryDelayMs(2, { reason: 'control-error' })).toBe(8_000)
    expect(recoveryDelayMs(3, { reason: 'control-error' })).toBe(15_000)
    expect(recoveryDelayMs(4, { reason: 'control-error' })).toBe(15_000)
  })
})
