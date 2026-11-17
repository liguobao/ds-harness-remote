import { describe, expect, it } from 'vitest'
import { parseUiBridgeMessage, UiActionGuard } from '../src/state/ui-action-guard'

describe('UI native confirmation boundary', () => {
  it('consumes IDs once, including busy and throttled messages, and sends once per confirmation', () => {
    const guard = new UiActionGuard()
    for (const id of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(guard.admit(id, 0)).toBeUndefined()
    }
    const first = guard.admit(1, 0)!
    expect(first).toBeDefined()
    expect(guard.admit(2, 2000)).toBeUndefined() // in-flight native confirmation
    expect(guard.submit(first)).toBe(true)
    expect(guard.submit(first)).toBe(false)
    guard.finish(first)
    expect(guard.admit(1, 3000)).toBeUndefined()
    expect(guard.admit(2, 3000)).toBeUndefined() // consumed while busy
    const next = guard.admit(3, 3000)!
    expect(next).toBeDefined()
    guard.finish(next) // native cancellation also consumes the ID
    expect(guard.admit(3, 5000)).toBeUndefined()
    expect(guard.admit(4, 3500)).toBeUndefined() // throttled even after cancellation
    expect(guard.admit(4, 5000)).toBeUndefined()
    expect(guard.admit(5, 5000)).toBeDefined()
  })

  it('revokes delayed confirmations and prevents old callbacks from clearing a newer action', () => {
    const guard = new UiActionGuard()
    const old = guard.admit(1, 0)!
    expect(guard.invalidate()).toBe(old) // caller can reject the original page's pending Promise
    expect(guard.invalidate()).toBeUndefined()
    expect(guard.submit(old)).toBe(false)
    expect(guard.admit(1, 2000)).toBeUndefined()
    const fresh = guard.admit(2, 2000)!
    guard.finish(old)
    expect(guard.isCurrent(fresh)).toBe(true)
    expect(guard.submit(fresh)).toBe(true)
    guard.invalidate() // late delivery completion cannot enter the new document
    expect(guard.isCurrent(fresh)).toBe(false)
  })

  it('rejects forged, malformed and oversized bridge messages before action admission', () => {
    const token = 'local-page-nonce'
    for (const raw of ['{', 'null', '[]', 'true', '{}', JSON.stringify({ token: 'other', type: 'prompt' }),
      JSON.stringify({ token, text: 'x'.repeat(32_768) })]) {
      expect(parseUiBridgeMessage(raw, token)).toBeUndefined()
    }
    const message = { token, type: 'prompt', id: 1, text: '\u0000'.repeat(4000) }
    expect(parseUiBridgeMessage(JSON.stringify(message), token)).toEqual(message)
  })
})
