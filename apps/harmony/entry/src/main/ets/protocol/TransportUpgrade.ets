/**
 * 带内传输升级（remote.transport.upgrade.v1）的客户端协议原语。
 *
 * 与共享实现 `packages/protocol/src/transport-upgrade.ts` 保持一致：
 * - `DSHU` + 8 字节大端序号的 12 字节帧头（序号空间 = Noise 发送/接收计数器）；
 * - Host 权威的传输分级（LAN > P2P > TURN > Relay）与 wire 名称映射；
 * - 有界乱序密文重排缓冲（帧数/字节/空洞超时三重上限），用于中继↔直连切腿时
 *   快速直连帧越过仍在途的中继帧到达的场景。
 *
 * 本文件只做纯逻辑，不依赖网络/定时器之外的运行时能力。
 */

export const TRANSPORT_UPGRADE_CAPABILITY: string = 'remote.transport.upgrade.v1';
export const UPGRADE_SEQUENCE_HEADER_BYTES: number = 12;
export const MAX_REORDER_BUFFERED_FRAMES: number = 256;
export const MAX_REORDER_BUFFERED_BYTES: number = 4 * 1024 * 1024;
export const DEFAULT_REORDER_GAP_TIMEOUT_MS: number = 5000;
export const DEFAULT_PREVIOUS_LEG_DRAIN_MS: number = 3000;

// 'D' 'S' 'H' 'U'
const UPGRADE_SEQ_MAGIC_D: number = 0x44;
const UPGRADE_SEQ_MAGIC_S: number = 0x53;
const UPGRADE_SEQ_MAGIC_H: number = 0x48;
const UPGRADE_SEQ_MAGIC_U: number = 0x55;
// 2^32：把安全整数序号拆成两个 32 位大端字，避免依赖 DataView.setBigUint64 的 BigInt 路径。
const COUNTER_LOW_WORD_SPAN: number = 4294967296;
// 8 字节大端 uint64 的高 32 位超过该值时，序号必然大于 Number.MAX_SAFE_INTEGER。
const COUNTER_MAX_HIGH_WORD: number = 0x1FFFFF;

/** 解包后的升级帧：Noise 计数器序号 + 密文（不含 12 字节帧头）。 */
export class UpgradedTransportFrame {
  counter: number = 0;
  ciphertext: Uint8Array = new Uint8Array(0);
}

/** 把一帧密文包装成 `DSHU` 序号帧。 */
export function wrapUpgradedTransportFrame(counter: number, ciphertext: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error('Upgraded transport counter must be a non-negative safe integer.');
  }
  const out = new Uint8Array(UPGRADE_SEQUENCE_HEADER_BYTES + ciphertext.byteLength);
  out[0] = UPGRADE_SEQ_MAGIC_D;
  out[1] = UPGRADE_SEQ_MAGIC_S;
  out[2] = UPGRADE_SEQ_MAGIC_H;
  out[3] = UPGRADE_SEQ_MAGIC_U;
  const view = new DataView(out.buffer, out.byteOffset, UPGRADE_SEQUENCE_HEADER_BYTES);
  const high: number = Math.floor(counter / COUNTER_LOW_WORD_SPAN);
  const low: number = counter % COUNTER_LOW_WORD_SPAN;
  view.setUint32(4, high, false);
  view.setUint32(8, low, false);
  out.set(ciphertext, UPGRADE_SEQUENCE_HEADER_BYTES);
  return out;
}

/** 校验并拆出升级帧序号与密文视图（密文为原数组 subarray，不复制）。 */
export function unwrapUpgradedTransportFrame(frame: Uint8Array): UpgradedTransportFrame {
  if (
    frame.byteLength < UPGRADE_SEQUENCE_HEADER_BYTES
    || frame[0] !== UPGRADE_SEQ_MAGIC_D
    || frame[1] !== UPGRADE_SEQ_MAGIC_S
    || frame[2] !== UPGRADE_SEQ_MAGIC_H
    || frame[3] !== UPGRADE_SEQ_MAGIC_U
  ) {
    throw new Error('Invalid upgraded transport frame header.');
  }
  const view = new DataView(frame.buffer, frame.byteOffset, UPGRADE_SEQUENCE_HEADER_BYTES);
  const high: number = view.getUint32(4, false);
  const low: number = view.getUint32(8, false);
  if (high > COUNTER_MAX_HIGH_WORD) {
    throw new Error('Upgraded transport frame counter overflowed.');
  }
  const result = new UpgradedTransportFrame();
  result.counter = high * COUNTER_LOW_WORD_SPAN + low;
  result.ciphertext = frame.subarray(UPGRADE_SEQUENCE_HEADER_BYTES);
  return result;
}

/** Host 权威分级排序：LAN=3、P2P=2、TURN=1，其它（Relay/未知）=0。 */
export function transportTierRank(mode: string): number {
  switch (mode) {
    case 'LAN': return 3;
    case 'P2P': return 2;
    case 'TURN': return 1;
    default: return 0;
  }
}

/** 把内部大写 tier 映射为 RPC/wire 使用的小写名字；非 LAN/P2P 一律 turn。 */
export function wireFromTransportTier(mode: string): string {
  if (mode === 'LAN') {
    return 'lan';
  }
  if (mode === 'P2P') {
    return 'p2p';
  }
  return 'turn';
}

/**
 * 跨腿切换用的有界乱序密文重排缓冲。
 *
 * 语义照共享实现：只缓冲 `counter > expectedCounter` 的帧，最多 256 帧 / 4 MiB；
 * 空洞超过 `gapTimeoutMs` 仍未补齐时回调一次 `onGapTimeout(missingCounter)`，由
 * 调用方 fail-close。所有定时器可被 `clear()` 清理。
 */
export class SequencedReorderBuffer {
  private pending: Map<number, Uint8Array> = new Map<number, Uint8Array>();
  private bufferedBytes: number = 0;
  private gapTimer: number | undefined = undefined;
  private gapCounter: number = -1;
  private readonly onGapTimeout: (missingCounter: number) => void;
  private readonly maxFrames: number;
  private readonly maxBytes: number;
  private readonly gapTimeoutMs: number;

  constructor(onGapTimeout: (missingCounter: number) => void,
    maxFrames?: number, maxBytes?: number, gapTimeoutMs?: number) {
    this.onGapTimeout = onGapTimeout;
    this.maxFrames = maxFrames !== undefined ? maxFrames : MAX_REORDER_BUFFERED_FRAMES;
    this.maxBytes = maxBytes !== undefined ? maxBytes : MAX_REORDER_BUFFERED_BYTES;
    this.gapTimeoutMs = gapTimeoutMs !== undefined ? gapTimeoutMs : DEFAULT_REORDER_GAP_TIMEOUT_MS;
  }

  /** 当前缓冲帧数。 */
  size(): number {
    return this.pending.size;
  }

  /** 当前缓冲密文字节数。 */
  bytes(): number {
    return this.bufferedBytes;
  }

  /**
   * 缓冲一个乱序帧。`counter` 必须大于 `expectedCounter`、不得重复、且不得突破
   * 帧数/字节预算；密文会被复制，调用方后续修改原数组不影响缓冲内容。
   */
  push(counter: number, expectedCounter: number, ciphertext: Uint8Array): void {
    if (!Number.isSafeInteger(counter) || counter <= expectedCounter) {
      throw new Error('Ciphertext counter is duplicated or out of order.');
    }
    if (this.pending.has(counter)) {
      throw new Error('Duplicate buffered ciphertext counter.');
    }
    if (this.pending.size >= this.maxFrames || this.bufferedBytes + ciphertext.byteLength > this.maxBytes) {
      throw new Error('Cross-transport reorder buffer exceeded its limit.');
    }
    const copy = new Uint8Array(ciphertext);
    this.pending.set(counter, copy);
    this.bufferedBytes += copy.byteLength;
    this.armGapTimer(expectedCounter);
  }

  /** 取出下一帧；命中即删除并重置空洞计时，未命中时按积压情况清理/重挂计时器。 */
  takeNext(expectedCounter: number): Uint8Array | undefined {
    const hit: Uint8Array | undefined = this.pending.get(expectedCounter);
    if (hit === undefined) {
      if (this.pending.size === 0) {
        this.clearGapTimer();
      } else {
        this.armGapTimer(expectedCounter);
      }
      return undefined;
    }
    this.pending.delete(expectedCounter);
    this.bufferedBytes -= hit.byteLength;
    if (this.pending.size === 0) {
      this.clearGapTimer();
    } else {
      this.armGapTimer(expectedCounter + 1);
    }
    return hit;
  }

  /** 直收路径确认 expected 前进：无积压时清表，否则按新水位重挂空洞计时。 */
  onExpectedAdvanced(nextExpectedCounter: number): void {
    if (this.pending.size === 0) {
      this.clearGapTimer();
      return;
    }
    this.armGapTimer(nextExpectedCounter);
  }

  /** 清空缓冲并停止计时器（幂等，清理后不会再触发 onGapTimeout）。 */
  clear(): void {
    this.clearGapTimer();
    this.pending.clear();
    this.bufferedBytes = 0;
  }

  private armGapTimer(expectedCounter: number): void {
    if (this.gapCounter === expectedCounter && this.gapTimer !== undefined) {
      return;
    }
    this.clearGapTimer();
    this.gapCounter = expectedCounter;
    this.gapTimer = setTimeout(() => {
      this.gapTimer = undefined;
      if (this.pending.size > 0) {
        this.onGapTimeout(expectedCounter);
      }
    }, this.gapTimeoutMs);
  }

  private clearGapTimer(): void {
    if (this.gapTimer !== undefined) {
      clearTimeout(this.gapTimer);
      this.gapTimer = undefined;
    }
    this.gapCounter = -1;
  }
}
