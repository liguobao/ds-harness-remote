import { z } from 'zod'

export const TRANSPORT_UPGRADE_CAPABILITY = 'remote.transport.upgrade.v1' as const

export const UPGRADE_SEQUENCE_HEADER_BYTES = 12
export const MAX_REORDER_BUFFERED_FRAMES = 256
export const MAX_REORDER_BUFFERED_BYTES = 4 * 1024 * 1024
export const DEFAULT_REORDER_GAP_TIMEOUT_MS = 5_000
export const DEFAULT_PREVIOUS_LEG_DRAIN_MS = 3_000

const UPGRADE_SEQ_MAGIC = [0x44, 0x53, 0x48, 0x55] as const // 'DSHU'

export const transportUpgradeCandidateSchema = z.object({
  candidate: z.string().max(4096).optional(),
  sdpMid: z.string().max(128).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict()

export const transportUpgradeOfferSchema = z.object({
  attemptId: z.string().min(1).max(64),
  sdp: z.string().min(1).max(128 * 1024),
}).strict()

export const transportUpgradeIceSchema = z.object({
  attemptId: z.string().min(1).max(64),
  candidate: transportUpgradeCandidateSchema,
}).strict()

export const transportUpgradeActivateSchema = z.object({
  attemptId: z.string().min(1).max(64),
  transport: z.enum(['lan', 'p2p', 'turn']).optional(),
  previousLegEndCounter: z.number().int().min(0).optional(),
}).strict()

export const transportUpgradeDrainSchema = z.object({
  attemptId: z.string().min(1).max(64),
  previousLegEndCounter: z.number().int().min(0),
}).strict()

export const transportUpgradeAbortSchema = z.object({
  attemptId: z.string().min(1).max(64).optional(),
}).strict()

export type TransportTier = 'Relay' | 'TURN' | 'P2P' | 'LAN'

export function transportTierRank(mode: TransportTier | undefined): number {
  switch (mode) {
    case 'LAN': return 3
    case 'P2P': return 2
    case 'TURN': return 1
    default: return 0
  }
}

export function wireFromTransportTier(mode: 'LAN' | 'P2P' | 'TURN'): 'lan' | 'p2p' | 'turn' {
  return mode === 'LAN' ? 'lan' : mode === 'P2P' ? 'p2p' : 'turn'
}

export function wrapUpgradedTransportFrame(counter: number, ciphertext: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error('Upgraded transport counter must be a non-negative safe integer.')
  }
  const out = new Uint8Array(UPGRADE_SEQUENCE_HEADER_BYTES + ciphertext.byteLength)
  out.set(UPGRADE_SEQ_MAGIC, 0)
  const view = new DataView(out.buffer, out.byteOffset, UPGRADE_SEQUENCE_HEADER_BYTES)
  view.setBigUint64(4, BigInt(counter), false)
  out.set(ciphertext, UPGRADE_SEQUENCE_HEADER_BYTES)
  return out
}

export function unwrapUpgradedTransportFrame(frame: Uint8Array): { counter: number; ciphertext: Uint8Array } {
  if (
    frame.byteLength < UPGRADE_SEQUENCE_HEADER_BYTES
    || frame[0] !== UPGRADE_SEQ_MAGIC[0]
    || frame[1] !== UPGRADE_SEQ_MAGIC[1]
    || frame[2] !== UPGRADE_SEQ_MAGIC[2]
    || frame[3] !== UPGRADE_SEQ_MAGIC[3]
  ) {
    throw new Error('Invalid upgraded transport frame header.')
  }
  const view = new DataView(frame.buffer, frame.byteOffset, UPGRADE_SEQUENCE_HEADER_BYTES)
  const rawCounter = view.getBigUint64(4, false)
  if (rawCounter > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Upgraded transport frame counter overflowed.')
  }
  return {
    counter: Number(rawCounter),
    ciphertext: frame.subarray(UPGRADE_SEQUENCE_HEADER_BYTES),
  }
}

/**
 * Bounded out-of-order ciphertext reorder buffer for cross-leg Noise switchovers.
 * Enforces strict frame count, byte budget, and gap deadline limits.
 */
export class SequencedCiphertextReorderBuffer {
  private readonly pending = new Map<number, Uint8Array>()
  private bufferedBytes = 0
  private gapTimer?: ReturnType<typeof setTimeout>
  private gapCounter?: number

  constructor(
    private readonly options: {
      maxFrames?: number
      maxBytes?: number
      gapTimeoutMs?: number
      onGapTimeout: (missingCounter: number) => void
    },
  ) {}

  get size(): number { return this.pending.size }
  get bytes(): number { return this.bufferedBytes }

  push(counter: number, expectedCounter: number, ciphertext: Uint8Array): void {
    if (!Number.isSafeInteger(counter) || counter <= expectedCounter) {
      throw new Error('Ciphertext counter is duplicated or out of order.')
    }
    if (this.pending.has(counter)) {
      throw new Error('Duplicate buffered ciphertext counter.')
    }
    const maxFrames = this.options.maxFrames ?? MAX_REORDER_BUFFERED_FRAMES
    const maxBytes = this.options.maxBytes ?? MAX_REORDER_BUFFERED_BYTES
    if (this.pending.size >= maxFrames || this.bufferedBytes + ciphertext.byteLength > maxBytes) {
      throw new Error('Cross-transport reorder buffer exceeded its limit.')
    }
    const copy = new Uint8Array(ciphertext)
    this.pending.set(counter, copy)
    this.bufferedBytes += copy.byteLength
    this.armGapTimer(expectedCounter)
  }

  takeNext(expectedCounter: number): Uint8Array | undefined {
    const hit = this.pending.get(expectedCounter)
    if (hit === undefined) {
      if (this.pending.size === 0) this.clearGapTimer()
      else this.armGapTimer(expectedCounter)
      return undefined
    }
    this.pending.delete(expectedCounter)
    this.bufferedBytes -= hit.byteLength
    if (this.pending.size === 0) this.clearGapTimer()
    else this.armGapTimer(expectedCounter + 1)
    return hit
  }

  onExpectedAdvanced(nextExpectedCounter: number): void {
    if (this.pending.size === 0) {
      this.clearGapTimer()
      return
    }
    this.armGapTimer(nextExpectedCounter)
  }

  clear(): void {
    this.clearGapTimer()
    this.pending.clear()
    this.bufferedBytes = 0
  }

  private armGapTimer(expectedCounter: number): void {
    if (this.gapCounter === expectedCounter && this.gapTimer !== undefined) return
    this.clearGapTimer()
    this.gapCounter = expectedCounter
    const timeoutMs = this.options.gapTimeoutMs ?? DEFAULT_REORDER_GAP_TIMEOUT_MS
    this.gapTimer = setTimeout(() => {
      this.gapTimer = undefined
      if (this.pending.size > 0) {
        this.options.onGapTimeout(expectedCounter)
      }
    }, timeoutMs)
    ;(this.gapTimer as { unref?: () => void }).unref?.()
  }

  private clearGapTimer(): void {
    if (this.gapTimer !== undefined) {
      clearTimeout(this.gapTimer)
      this.gapTimer = undefined
    }
    this.gapCounter = undefined
  }
}
