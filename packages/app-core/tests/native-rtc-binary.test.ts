import { expect, it, vi } from 'vitest'
vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
import { createNativeRtcSender } from '../src/services/native-rtc-binary'
it('forwards ciphertext bytes to the existing peer/channel without base64 in JS', () => {
  const send = vi.fn()
  const sender = createNativeRtcSender({ isAvailable: () => true, send })!
  const data = new Uint8Array([0, 1, 127, 128, 255]).buffer
  expect(sender({ _peerConnectionId: 3, _reactTag: 'channel-1' }, data)).toBe(true)
  expect(send).toHaveBeenCalledWith(3, 'channel-1', new Uint8Array(data))
})
it('retains the regular sender when the module or channel implementation is unsupported', () => {
  expect(createNativeRtcSender(undefined)).toBeUndefined()
  expect(createNativeRtcSender({ isAvailable: () => false, send: vi.fn() })).toBeUndefined()
  const send = vi.fn(), sender = createNativeRtcSender({ isAvailable: () => true, send })!
  for (const channel of [null, {}, { _peerConnectionId: -1, _reactTag: 'bad' }, { _peerConnectionId: 1, _reactTag: '' }]) {
    expect(sender(channel, new ArrayBuffer(2))).toBe(false)
  }
  expect(send).not.toHaveBeenCalled()
})
it('propagates send failures without retry or fallback', () => {
  const send = vi.fn(() => { throw new Error('closed channel') })
  const sender = createNativeRtcSender({ isAvailable: () => true, send })!
  expect(() => sender({ _peerConnectionId: 1, _reactTag: 'channel-1' }, new ArrayBuffer(1))).toThrow('closed channel')
  expect(send).toHaveBeenCalledTimes(1)
})
