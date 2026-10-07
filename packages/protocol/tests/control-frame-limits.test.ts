import { describe, expect, it } from 'vitest'
import {
  MAX_CONTROL_FRAME_BYTES,
  MAX_RELAY_FRAME_BYTES,
  createControlFrame,
  decodeControlFrame,
  encodeControlFrame,
} from '../src/index.js'

describe('Control frame byte limits', () => {
  it('exports the protocol defaults', () => {
    expect(MAX_CONTROL_FRAME_BYTES).toBe(64 * 1024)
    expect(MAX_RELAY_FRAME_BYTES).toBe(1024 * 1024)
  })

  it('enforces a negotiated Control limit', () => {
    const frame = createControlFrame('ping', { nonce: 'nonce-1' })
    const encoded = encodeControlFrame(frame)
    const bytes = new TextEncoder().encode(encoded).byteLength

    expect(encodeControlFrame(frame, { maxControlFrameBytes: bytes })).toBe(encoded)
    expect(() => encodeControlFrame(frame, { maxControlFrameBytes: bytes - 1 })).toThrow('Control frame exceeds')
    expect(() => decodeControlFrame(encoded, { maxControlFrameBytes: bytes - 1 })).toThrow('Control frame exceeds')
  })

  it('uses the separate Relay limit', () => {
    const frame = createControlFrame('relay', {
      connectionId: 'connection-1',
      targetDeviceId: 'host-1',
      counter: 0,
      ciphertext: 'A'.repeat(MAX_CONTROL_FRAME_BYTES),
    })
    const encoded = encodeControlFrame(frame)
    expect(new TextEncoder().encode(encoded).byteLength).toBeGreaterThan(MAX_CONTROL_FRAME_BYTES)
    expect(decodeControlFrame(encoded)).toEqual(frame)
  })

  it('rejects frames above the protocol defaults', () => {
    const control = createControlFrame('signal.offer', {
      connectionId: 'connection-1',
      targetDeviceId: 'host-1',
      sdp: 'a'.repeat(MAX_CONTROL_FRAME_BYTES),
    })
    expect(() => encodeControlFrame(control)).toThrow('Control frame exceeds')

    const relay = createControlFrame('relay', {
      connectionId: 'connection-1',
      targetDeviceId: 'host-1',
      counter: 0,
      ciphertext: 'A'.repeat(MAX_RELAY_FRAME_BYTES),
    })
    expect(() => encodeControlFrame(relay)).toThrow('Relay frame exceeds')
  })
})
