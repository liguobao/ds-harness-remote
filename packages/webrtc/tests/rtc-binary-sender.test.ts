import { afterEach, expect, it, vi } from 'vitest'
import { browserRtcFactory, type RtcBinarySender } from '../src/rtc-adapter.js'
afterEach(() => vi.unstubAllGlobals())
function channel(sender?: RtcBinarySender) {
  const raw = { send: vi.fn() }
  vi.stubGlobal('RTCPeerConnection', class { createDataChannel() { return raw } })
  return { raw, adapted: browserRtcFactory({ sendBinary: sender }).create({ iceServers: [] }).createDataChannel('data') }
}
it('uses the optional sender only for binary frames', () => {
  const send = vi.fn(() => true), { raw, adapted } = channel(send)
  const bytes = new ArrayBuffer(4)
  adapted.send(bytes); adapted.send('text')
  expect(send).toHaveBeenCalledWith(raw, bytes)
  expect(raw.send.mock.calls).toEqual([['text']])
})
it('preserves default/fallback behavior', () => {
  const fallback = channel(() => false), plain = channel()
  const bytes = new ArrayBuffer(4)
  fallback.adapted.send(bytes); plain.adapted.send(bytes)
  expect(fallback.raw.send).toHaveBeenCalledWith(bytes)
  expect(plain.raw.send).toHaveBeenCalledWith(bytes)
})
it('never replays through the default sender after an accelerated send error', () => {
  const { raw, adapted } = channel(() => { throw new Error('send failed') })
  expect(() => adapted.send(new ArrayBuffer(4))).toThrow('send failed')
  expect(raw.send).not.toHaveBeenCalled()
})
