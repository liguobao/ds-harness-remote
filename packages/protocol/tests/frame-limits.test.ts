import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  SECURE_FRAGMENT_CHUNK_BYTES,
  MAX_SECURE_MESSAGE_BYTES,
  HARNESS_API_TRANSFER_CHUNK_BYTES,
  MAX_HARNESS_API_TRANSFER_BYTES,
  CODEX_APP_TRANSFER_CHUNK_BYTES,
  MAX_CODEX_APP_TRANSFER_BYTES,
  SecureMessageCodec,
} from '../src/index.js'

const MAX_IN_FLIGHT_SECURE_MESSAGES = 8

describe('protocol limit constants', () => {
  it('preserves secure fragment and independent transfer budgets', async () => {
    await runScenarios([
      {
        name: 'PROTOCOL_VERSION is 1',
        run: () => {
          expect(PROTOCOL_VERSION).toBe(1)
        },
      },
      {
        name: 'SECURE_FRAGMENT_CHUNK_BYTES is 48 KiB',
        run: () => {
          expect(SECURE_FRAGMENT_CHUNK_BYTES).toBe(48 * 1024)
        },
      },
      {
        name: 'MAX_SECURE_MESSAGE_BYTES is 4 MiB',
        run: () => {
          expect(MAX_SECURE_MESSAGE_BYTES).toBe(4 * 1024 * 1024)
        },
      },
      {
        name: 'keeps image transfers bounded without raising the secure-message limit',
        run: () => {
          expect(HARNESS_API_TRANSFER_CHUNK_BYTES).toBe(512 * 1024)
          expect(MAX_HARNESS_API_TRANSFER_BYTES).toBe(288 * 1024 * 1024)
          expect(HARNESS_API_TRANSFER_CHUNK_BYTES).toBeLessThan(MAX_SECURE_MESSAGE_BYTES)
        },
      },
      {
        name: 'keeps Codex history transfers in an independent bounded domain',
        run: () => {
          expect(CODEX_APP_TRANSFER_CHUNK_BYTES).toBe(512 * 1024)
          expect(MAX_CODEX_APP_TRANSFER_BYTES).toBe(288 * 1024 * 1024)
          expect(CODEX_APP_TRANSFER_CHUNK_BYTES).toBeLessThan(MAX_SECURE_MESSAGE_BYTES)
        },
      },
    ])
  }, 25000)

})

describe('SecureMessageCodec message size limit', () => {
  it('enforces the secure message size boundary', async () => {
    await runScenarios([
      {
        name: 'accepts message at exactly MAX_SECURE_MESSAGE_BYTES',
        run: () => {
          const codec = new SecureMessageCodec()
          const message = new Uint8Array(MAX_SECURE_MESSAGE_BYTES)
          const frames = codec.encode(message)
          expect(frames.length).toBeGreaterThan(0)
        },
      },
      {
        name: 'rejects message exceeding MAX_SECURE_MESSAGE_BYTES',
        run: () => {
          const codec = new SecureMessageCodec()
          const message = new Uint8Array(MAX_SECURE_MESSAGE_BYTES + 1)
          expect(() => codec.encode(message)).toThrow('Secure message exceeds the reassembly limit.')
        },
      },
    ])
  }, 10000)

})

describe('SecureMessageCodec fragment reassembly limits', () => {
  it('rejects more than MAX_IN_FLIGHT_SECURE_MESSAGES concurrent assemblies', () => {
    const decoder = new SecureMessageCodec()
    const encoder = new SecureMessageCodec()

    const messages = Array.from({ length: 9 }, (_, i) =>
      new Uint8Array(SECURE_FRAGMENT_CHUNK_BYTES * 2 + i))

    const allFrames = messages.map(msg => encoder.encode(msg))

    for (let i = 0; i < 8; i++) {
      decoder.decode(allFrames[i]![0]!)
    }

    expect(() => decoder.decode(allFrames[8]![0]!)).toThrow('Secure fragment sequence is invalid.')
  })

  it('rejects repeated or unordered fragments', async () => {
    await runScenarios([
      {
        name: 'rejects out-of-order fragments',
        run: () => {
          const encoder = new SecureMessageCodec()
          const decoder = new SecureMessageCodec()

          const message = new Uint8Array(SECURE_FRAGMENT_CHUNK_BYTES * 3)
          const frames = encoder.encode(message)
          expect(frames).toHaveLength(3)

          decoder.decode(frames[0]!)
          expect(() => decoder.decode(frames[2]!)).toThrow('Secure fragment sequence is invalid.')
        },
      },
      {
        name: 'rejects duplicate fragment index',
        run: () => {
          const encoder = new SecureMessageCodec()
          const decoder = new SecureMessageCodec()

          const message = new Uint8Array(SECURE_FRAGMENT_CHUNK_BYTES * 2)
          const frames = encoder.encode(message)
          expect(frames).toHaveLength(2)

          decoder.decode(frames[0]!)
          expect(() => decoder.decode(frames[0]!)).toThrow('Secure fragment sequence is invalid.')
        },
      },
    ])
  }, 10000)

  it('rejects fragment with wrong chunk size', () => {
    const encoder = new SecureMessageCodec()
    const decoder = new SecureMessageCodec()

    const message = new Uint8Array(SECURE_FRAGMENT_CHUNK_BYTES * 2)
    const frames = encoder.encode(message)

    const corrupted = new Uint8Array(frames[0]!.byteLength + 10)
    corrupted.set(frames[0]!)

    expect(() => decoder.decode(corrupted)).toThrow('Secure fragment length is invalid.')
  })
})

describe('SecureMessageCodec fragment header validation', () => {
  it('rejects malformed fragment metadata', async () => {
    await runScenarios([
      {
        name: 'rejects fragment with invalid version',
        run: () => {
          const codec = new SecureMessageCodec()

          const message = new Uint8Array(SECURE_FRAGMENT_CHUNK_BYTES + 1)
          const frames = new SecureMessageCodec().encode(message)
          const corrupted = new Uint8Array(frames[0]!)
          corrupted[4] = 99

          expect(() => codec.decode(corrupted)).toThrow('Secure fragment header is invalid.')
        },
      },
      {
        name: 'rejects fragment with messageId = 0',
        run: () => {
          const codec = new SecureMessageCodec()

          const fragment = new Uint8Array(17 + 100)
          fragment.set([0x44, 0x53, 0x48, 0x46])
          fragment[4] = 1
          const view = new DataView(fragment.buffer)
          view.setUint32(5, 0)
          view.setUint16(9, 0)
          view.setUint16(11, 2)
          view.setUint32(13, SECURE_FRAGMENT_CHUNK_BYTES + 100)

          expect(() => codec.decode(fragment)).toThrow('Secure fragment metadata is invalid.')
        },
      },
      {
        name: 'rejects fragment with total < 2',
        run: () => {
          const codec = new SecureMessageCodec()

          const fragment = new Uint8Array(17 + 100)
          fragment.set([0x44, 0x53, 0x48, 0x46])
          fragment[4] = 1
          const view = new DataView(fragment.buffer)
          view.setUint32(5, 1)
          view.setUint16(9, 0)
          view.setUint16(11, 1)
          view.setUint32(13, SECURE_FRAGMENT_CHUNK_BYTES + 100)

          expect(() => codec.decode(fragment)).toThrow('Secure fragment metadata is invalid.')
        },
      },
      {
        name: 'rejects fragment with index >= total',
        run: () => {
          const codec = new SecureMessageCodec()

          const fragment = new Uint8Array(17 + 100)
          fragment.set([0x44, 0x53, 0x48, 0x46])
          fragment[4] = 1
          const view = new DataView(fragment.buffer)
          view.setUint32(5, 1)
          view.setUint16(9, 2)
          view.setUint16(11, 2)
          view.setUint32(13, SECURE_FRAGMENT_CHUNK_BYTES + 100)

          expect(() => codec.decode(fragment)).toThrow('Secure fragment metadata is invalid.')
        },
      },
      {
        name: 'rejects fragment with totalBytes <= SECURE_FRAGMENT_CHUNK_BYTES',
        run: () => {
          const codec = new SecureMessageCodec()

          const fragment = new Uint8Array(17 + 100)
          fragment.set([0x44, 0x53, 0x48, 0x46])
          fragment[4] = 1
          const view = new DataView(fragment.buffer)
          view.setUint32(5, 1)
          view.setUint16(9, 0)
          view.setUint16(11, 2)
          view.setUint32(13, SECURE_FRAGMENT_CHUNK_BYTES)

          expect(() => codec.decode(fragment)).toThrow('Secure fragment metadata is invalid.')
        },
      },
      {
        name: 'rejects fragment with totalBytes > MAX_SECURE_MESSAGE_BYTES',
        run: () => {
          const codec = new SecureMessageCodec()

          const totalBytes = MAX_SECURE_MESSAGE_BYTES + 1
          const total = Math.ceil(totalBytes / SECURE_FRAGMENT_CHUNK_BYTES)

          const fragment = new Uint8Array(17 + SECURE_FRAGMENT_CHUNK_BYTES)
          fragment.set([0x44, 0x53, 0x48, 0x46])
          fragment[4] = 1
          const view = new DataView(fragment.buffer)
          view.setUint32(5, 1)
          view.setUint16(9, 0)
          view.setUint16(11, total)
          view.setUint32(13, totalBytes)

          expect(() => codec.decode(fragment)).toThrow('Secure fragment metadata is invalid.')
        },
      },
    ])
  }, 30000)

  // KNOWN BUG: Same magic-prefix collision issue as above
  it.fails('treats message smaller than header size as non-fragment', () => {
    const codec = new SecureMessageCodec()

    const tiny = new Uint8Array([0x44, 0x53, 0x48, 0x46])
    // Messages smaller than SECURE_FRAGMENT_HEADER_BYTES (17) should not be fragments
    // even if they start with DSHF magic
    expect(codec.decode(tiny)).toEqual(tiny)
  })

})

describe('SecureMessageCodec round-trip integrity', () => {
  // KNOWN BUG: isSecureFragment() uses magic prefix detection, causing
  // unfragmented messages starting with DSHF (0x44534846) to be incorrectly
  // treated as fragments. This affects any message 4+ bytes starting with
  // those magic bytes.
  it.fails('round-trips an unfragmented message starting with fragment magic (8 bytes)', () => {
    const encoder = new SecureMessageCodec()
    const decoder = new SecureMessageCodec()

    const message = new Uint8Array([
      0x44, 0x53, 0x48, 0x46, // DSHF magic
      1, 2, 3, 4,
    ])

    const frames = encoder.encode(message)

    expect(frames).toHaveLength(1)
    expect(decoder.decode(frames[0]!)).toEqual(message)
  })

  it.fails('round-trips an unfragmented message starting with fragment magic (17 bytes)', () => {
    const encoder = new SecureMessageCodec()
    const decoder = new SecureMessageCodec()

    const message = new Uint8Array(17)
    message.set([0x44, 0x53, 0x48, 0x46, 1])

    const frames = encoder.encode(message)

    expect(frames).toHaveLength(1)
    expect(decoder.decode(frames[0]!)).toEqual(message)
  })

  it('round-trips various message sizes', () => {
    const sizes = [
      1,
      100,
      SECURE_FRAGMENT_CHUNK_BYTES - 1,
      SECURE_FRAGMENT_CHUNK_BYTES,
      SECURE_FRAGMENT_CHUNK_BYTES + 1,
      SECURE_FRAGMENT_CHUNK_BYTES * 2,
      SECURE_FRAGMENT_CHUNK_BYTES * 2 + 37,
    ]

    for (const size of sizes) {
      const encoder = new SecureMessageCodec()
      const decoder = new SecureMessageCodec()

      const message = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        message[i] = i % 251
      }

      const frames = encoder.encode(message)

      expect(frames).toHaveLength(Math.ceil(size / SECURE_FRAGMENT_CHUNK_BYTES))

      let result: Uint8Array | undefined
      for (const frame of frames) {
        result = decoder.decode(frame)
      }

      expect(result).toBeDefined()
      expect(result!.byteLength).toBe(size)
      expect(result).toEqual(message)
    }
  })

  it('resets state correctly', () => {
    const encoder = new SecureMessageCodec()
    const decoder = new SecureMessageCodec()

    const message1 = new Uint8Array(SECURE_FRAGMENT_CHUNK_BYTES * 2)
    const frames1 = encoder.encode(message1)

    for (const frame of frames1) {
      decoder.decode(frame)
    }

    decoder.reset()

    const message2 = new Uint8Array(SECURE_FRAGMENT_CHUNK_BYTES * 2 + 50)
    const frames2 = encoder.encode(message2)

    let result: Uint8Array | undefined
    for (const frame of frames2) {
      result = decoder.decode(frame)
    }

    expect(result).toBeDefined()
    expect(result!.byteLength).toBe(message2.byteLength)
  })
})
