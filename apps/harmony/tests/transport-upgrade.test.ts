/**
 * Conformance tests for the in-band transport upgrade wire primitives
 * (`protocol/TransportUpgrade.ets`): `DSHU` sequence framing, Host authority tier
 * mapping, and the bounded cross-leg ciphertext reorder buffer.
 *
 * The ETS sources cannot be imported by Node directly, so esbuild transpiles the real
 * file on the fly. This module has no `@kit.*` imports, so no HarmonyOS stub is needed.
 */
import { build } from 'esbuild'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const entryPath = join(here, '.transport-upgrade-entry.ts')
const bundlePath = join(here, '.transport-upgrade-bundle.mjs')

interface UpgradedTransportFrame {
  counter: number
  ciphertext: Uint8Array
}

interface SequencedReorderBufferLike {
  size(): number
  bytes(): number
  push(counter: number, expectedCounter: number, ciphertext: Uint8Array): void
  takeNext(expectedCounter: number): Uint8Array | undefined
  onExpectedAdvanced(nextExpectedCounter: number): void
  clear(): void
}

interface TransportUpgradeModule {
  TRANSPORT_UPGRADE_CAPABILITY: string
  UPGRADE_SEQUENCE_HEADER_BYTES: number
  MAX_REORDER_BUFFERED_FRAMES: number
  MAX_REORDER_BUFFERED_BYTES: number
  DEFAULT_REORDER_GAP_TIMEOUT_MS: number
  DEFAULT_PREVIOUS_LEG_DRAIN_MS: number
  wrapUpgradedTransportFrame(counter: number, ciphertext: Uint8Array): Uint8Array
  unwrapUpgradedTransportFrame(frame: Uint8Array): UpgradedTransportFrame
  transportTierRank(mode: string): number
  wireFromTransportTier(mode: string): string
  SequencedReorderBuffer: new (
    onGapTimeout: (missingCounter: number) => void,
    maxFrames?: number,
    maxBytes?: number,
    gapTimeoutMs?: number
  ) => SequencedReorderBufferLike
}

let upgrade!: TransportUpgradeModule

beforeAll(async () => {
  writeFileSync(
    entryPath,
    `export * from ${JSON.stringify(join(etsRoot, 'protocol', 'TransportUpgrade.ets'))}\n`,
    'utf8'
  )
  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      write: false,
      platform: 'neutral',
      loader: { '.ets': 'ts' },
      resolveExtensions: ['.ets', '.ts', '.js']
    })
    writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8')
  } finally {
    rmSync(entryPath, { force: true })
  }
  upgrade = (await import(`file://${bundlePath}`)) as TransportUpgradeModule
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
})

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe('DSHU sequence framing', () => {
  it('wraps counter 0 as the exact golden header', () => {
    const frame = upgrade.wrapUpgradedTransportFrame(0, new Uint8Array(0))
    expect(hex(frame)).toBe('445348550000000000000000')
    expect(frame.byteLength).toBe(upgrade.UPGRADE_SEQUENCE_HEADER_BYTES)
  })

  it('wraps the 64-bit counter as two big-endian 32-bit words', () => {
    // A JS number counter must stay within the safe-integer range, so the high 16 bits of
    // the uint64 are zero here (`0x0102030405060708` itself is beyond MAX_SAFE_INTEGER and
    // is rejected by wrap, see the invalid-counter case below). This still exercises the
    // big-endian high/low word layout the wire format requires.
    const frame = upgrade.wrapUpgradedTransportFrame(0x0001020304050607, new Uint8Array(0))
    expect(hex(frame)).toBe('445348550001020304050607')
    expect(hex(frame.subarray(4, 8))).toBe('00010203')
    expect(hex(frame.subarray(8, 12))).toBe('04050607')
  })

  it('wraps counter 1 with a trailing low-word byte of 1', () => {
    const frame = upgrade.wrapUpgradedTransportFrame(1, new Uint8Array(0))
    expect(frame[11]).toBe(1)
    expect(hex(frame.subarray(0, 11))).toBe('4453485500000000000000')
  })

  it('appends ciphertext after the header without copying semantics changes', () => {
    const frame = upgrade.wrapUpgradedTransportFrame(7, bytes(0xaa, 0xbb))
    expect(frame.byteLength).toBe(14)
    expect(hex(frame.subarray(12))).toBe('aabb')
  })

  it('round-trips counters across the safe-integer range', () => {
    const counters = [
      0,
      1,
      2,
      0xffffffff,
      2 ** 32,
      2 ** 40,
      Number.MAX_SAFE_INTEGER - 1,
      Number.MAX_SAFE_INTEGER
    ]
    for (const counter of counters) {
      const ciphertext = bytes(1, 2, 3)
      const frame = upgrade.unwrapUpgradedTransportFrame(
        upgrade.wrapUpgradedTransportFrame(counter, ciphertext)
      )
      expect(frame.counter).toBe(counter)
      expect(frame.ciphertext).toEqual(ciphertext)
    }
  })

  it('round-trips an empty ciphertext', () => {
    const frame = upgrade.unwrapUpgradedTransportFrame(
      upgrade.wrapUpgradedTransportFrame(42, new Uint8Array(0))
    )
    expect(frame.counter).toBe(42)
    expect(frame.ciphertext.byteLength).toBe(0)
  })

  it('rejects a short frame', () => {
    expect(() => upgrade.unwrapUpgradedTransportFrame(new Uint8Array(11)))
      .toThrow('Invalid upgraded transport frame header.')
    expect(() => upgrade.unwrapUpgradedTransportFrame(new Uint8Array(0)))
      .toThrow('Invalid upgraded transport frame header.')
  })

  it('rejects a frame with corrupted magic', () => {
    for (const index of [0, 1, 2, 3]) {
      const frame = upgrade.wrapUpgradedTransportFrame(9, new Uint8Array(0))
      frame[index] ^= 0xff
      expect(() => upgrade.unwrapUpgradedTransportFrame(frame))
        .toThrow('Invalid upgraded transport frame header.')
    }
  })

  it('rejects a high word that would overflow the safe-integer counter', () => {
    const frame = new Uint8Array(12)
    frame.set(bytes(0x44, 0x53, 0x48, 0x55), 0)
    // high = 0x200000 > 0x1FFFFF; counter would exceed Number.MAX_SAFE_INTEGER.
    frame.set(bytes(0x00, 0x20, 0x00, 0x00), 4)
    frame.set(bytes(0x00, 0x00, 0x00, 0x00), 8)
    expect(() => upgrade.unwrapUpgradedTransportFrame(frame))
      .toThrow('Upgraded transport frame counter overflowed.')
  })

  it('accepts the largest representable safe-integer frame', () => {
    const frame = new Uint8Array(12)
    frame.set(bytes(0x44, 0x53, 0x48, 0x55), 0)
    frame.set(bytes(0x00, 0x1f, 0xff, 0xff), 4)
    frame.set(bytes(0xff, 0xff, 0xff, 0xff), 8)
    const unwrapped = upgrade.unwrapUpgradedTransportFrame(frame)
    expect(unwrapped.counter).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects negative, fractional and unsafe counters when wrapping', () => {
    const invalid = [
      -1,
      -0.5,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      // `0x0102030405060708` (> 2^53-1) cannot be carried by the Number-based counter path.
      0x0102030405060708
    ]
    for (const counter of invalid) {
      expect(() => upgrade.wrapUpgradedTransportFrame(counter, new Uint8Array(0)))
        .toThrow('Upgraded transport counter must be a non-negative safe integer.')
    }
  })
})

describe('transport tier rank and wire mapping', () => {
  it('ranks LAN above P2P above TURN above everything else', () => {
    expect(upgrade.transportTierRank('LAN')).toBe(3)
    expect(upgrade.transportTierRank('P2P')).toBe(2)
    expect(upgrade.transportTierRank('TURN')).toBe(1)
    expect(upgrade.transportTierRank('Relay')).toBe(0)
    expect(upgrade.transportTierRank('')).toBe(0)
    expect(upgrade.transportTierRank('lan')).toBe(0)
  })

  it('maps tiers to wire names with turn as the fallback', () => {
    expect(upgrade.wireFromTransportTier('LAN')).toBe('lan')
    expect(upgrade.wireFromTransportTier('P2P')).toBe('p2p')
    expect(upgrade.wireFromTransportTier('TURN')).toBe('turn')
    expect(upgrade.wireFromTransportTier('Relay')).toBe('turn')
    expect(upgrade.wireFromTransportTier('unknown')).toBe('turn')
  })

  it('exposes the shared upgrade constants', () => {
    expect(upgrade.TRANSPORT_UPGRADE_CAPABILITY).toBe('remote.transport.upgrade.v1')
    expect(upgrade.UPGRADE_SEQUENCE_HEADER_BYTES).toBe(12)
    expect(upgrade.MAX_REORDER_BUFFERED_FRAMES).toBe(256)
    expect(upgrade.MAX_REORDER_BUFFERED_BYTES).toBe(4 * 1024 * 1024)
    expect(upgrade.DEFAULT_REORDER_GAP_TIMEOUT_MS).toBe(5000)
    expect(upgrade.DEFAULT_PREVIOUS_LEG_DRAIN_MS).toBe(3000)
  })
})

describe('SequencedReorderBuffer', () => {
  it('starts empty and accounts buffered bytes', () => {
    const buffer = new upgrade.SequencedReorderBuffer(() => undefined)
    expect(buffer.size()).toBe(0)
    expect(buffer.bytes()).toBe(0)
    buffer.push(1, 0, bytes(1, 2, 3))
    expect(buffer.size()).toBe(1)
    expect(buffer.bytes()).toBe(3)
    buffer.clear()
  })

  it('copies pushed ciphertext so later mutation cannot corrupt the buffer', () => {
    const buffer = new upgrade.SequencedReorderBuffer(() => undefined)
    const source = bytes(0xaa, 0xbb)
    buffer.push(1, 0, source)
    source[0] = 0x00
    expect(buffer.takeNext(1)).toEqual(bytes(0xaa, 0xbb))
    expect(buffer.size()).toBe(0)
    expect(buffer.bytes()).toBe(0)
    buffer.clear()
  })

  it('releases out-of-order frames strictly in counter order', () => {
    const buffer = new upgrade.SequencedReorderBuffer(() => undefined)
    buffer.push(3, 0, utf8('c'))
    buffer.push(1, 0, utf8('a'))
    buffer.push(2, 0, utf8('b'))
    expect(buffer.size()).toBe(3)
    expect(buffer.takeNext(1)).toEqual(utf8('a'))
    expect(buffer.takeNext(2)).toEqual(utf8('b'))
    expect(buffer.takeNext(3)).toEqual(utf8('c'))
    expect(buffer.size()).toBe(0)
    expect(buffer.bytes()).toBe(0)
    buffer.clear()
  })

  it('returns undefined for a counter that is not buffered yet', () => {
    const buffer = new upgrade.SequencedReorderBuffer(() => undefined)
    expect(buffer.takeNext(0)).toBeUndefined()
    buffer.push(2, 0, utf8('b'))
    expect(buffer.takeNext(1)).toBeUndefined()
    expect(buffer.takeNext(2)).toEqual(utf8('b'))
    buffer.clear()
  })

  it('rejects counters that are duplicated or not ahead of expected', () => {
    const buffer = new upgrade.SequencedReorderBuffer(() => undefined)
    expect(() => buffer.push(0, 0, new Uint8Array(0)))
      .toThrow('Ciphertext counter is duplicated or out of order.')
    expect(() => buffer.push(-1, 0, new Uint8Array(0)))
      .toThrow('Ciphertext counter is duplicated or out of order.')
    expect(() => buffer.push(1.5, 0, new Uint8Array(0)))
      .toThrow('Ciphertext counter is duplicated or out of order.')
    buffer.push(2, 0, utf8('b'))
    expect(() => buffer.push(2, 0, utf8('b')))
      .toThrow('Duplicate buffered ciphertext counter.')
    buffer.clear()
  })

  it('rejects a frame beyond the configured frame budget', () => {
    const buffer = new upgrade.SequencedReorderBuffer(() => undefined, 2, 1024, 60_000)
    buffer.push(1, 0, utf8('a'))
    buffer.push(2, 0, utf8('b'))
    expect(() => buffer.push(3, 0, utf8('c')))
      .toThrow('Cross-transport reorder buffer exceeded its limit.')
    buffer.clear()
  })

  it('rejects a frame beyond the configured byte budget', () => {
    const single = new upgrade.SequencedReorderBuffer(() => undefined, 8, 4, 60_000)
    expect(() => single.push(1, 0, bytes(1, 2, 3, 4, 5)))
      .toThrow('Cross-transport reorder buffer exceeded its limit.')
    single.clear()

    const cumulative = new upgrade.SequencedReorderBuffer(() => undefined, 8, 4, 60_000)
    cumulative.push(1, 0, bytes(1, 2, 3))
    expect(() => cumulative.push(2, 0, bytes(4, 5)))
      .toThrow('Cross-transport reorder buffer exceeded its limit.')
    // Exactly filling the budget is still allowed.
    cumulative.push(2, 0, bytes(4))
    expect(cumulative.bytes()).toBe(4)
    cumulative.clear()
  })

  it('reports a missing counter exactly once through the gap timer', () => {
    vi.useFakeTimers()
    try {
      const missing: number[] = []
      const buffer = new upgrade.SequencedReorderBuffer(
        (counter: number) => missing.push(counter),
        256,
        4 * 1024 * 1024,
        20
      )
      buffer.push(2, 1, utf8('b'))
      vi.advanceTimersByTime(19)
      expect(missing).toEqual([])
      vi.advanceTimersByTime(1)
      expect(missing).toEqual([1])
      vi.advanceTimersByTime(1000)
      expect(missing).toEqual([1])
      buffer.clear()
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-arms the gap timer when the expected counter advances', () => {
    vi.useFakeTimers()
    try {
      const missing: number[] = []
      const buffer = new upgrade.SequencedReorderBuffer(
        (counter: number) => missing.push(counter),
        256,
        4 * 1024 * 1024,
        20
      )
      buffer.push(3, 1, utf8('c'))
      vi.advanceTimersByTime(10)
      buffer.onExpectedAdvanced(2)
      // The original counter-1 deadline (t=20) must have been cleared; only the
      // re-armed counter-2 deadline (t=30) may fire.
      vi.advanceTimersByTime(15)
      expect(missing).toEqual([])
      vi.advanceTimersByTime(5)
      expect(missing).toEqual([2])
      buffer.clear()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears pending frames and never fires the gap timer after clear()', () => {
    vi.useFakeTimers()
    try {
      const missing: number[] = []
      const buffer = new upgrade.SequencedReorderBuffer(
        (counter: number) => missing.push(counter),
        256,
        4 * 1024 * 1024,
        20
      )
      buffer.push(2, 1, utf8('b'))
      vi.advanceTimersByTime(10)
      buffer.clear()
      expect(buffer.size()).toBe(0)
      expect(buffer.bytes()).toBe(0)
      vi.advanceTimersByTime(1000)
      expect(missing).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire the gap timer when the buffer is empty', () => {
    vi.useFakeTimers()
    try {
      const missing: number[] = []
      const buffer = new upgrade.SequencedReorderBuffer(
        (counter: number) => missing.push(counter),
        256,
        4 * 1024 * 1024,
        20
      )
      buffer.push(2, 1, utf8('b'))
      expect(buffer.takeNext(1)).toBeUndefined()
      buffer.clear()
      vi.advanceTimersByTime(1000)
      expect(missing).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
