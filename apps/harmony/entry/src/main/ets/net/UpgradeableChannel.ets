import { SequencedOutboundTransport } from './TransportLeg';

/** 一次中继↔直连切换前后的流量计数（仅用于升级打点，不记录帧内容）。 */
export class RelayTrafficBytes {
  sent: number = 0;
  received: number = 0;
}

/**
 * SecureTransport 暴露给 `TransportUpgrader` 的切腿能力。
 *
 * 语义与共享实现 `packages/client-core/src/transport-upgrader.ts` 的
 * `UpgradeableSecureChannel` 一致：先 attach 入站腿，再 switch 出站腿；
 * 切换时返回旧腿已发出的最后一帧序号，供 Host 侧 drain 使用。
 */
export interface UpgradeableSecureChannel {
  /** 当前 Noise 发送计数器（= 下一帧的 DSHU 序号）。 */
  outboundCounter(): number;

  /** 在收到 Host 激活结果之前先接上入站腿，避免切腿瞬间丢帧。 */
  attachIncomingLeg(leg: SequencedOutboundTransport): void;

  /** Host 在 activate 响应里给出的它自己旧腿最后一帧序号：到水位就回收旧腿。 */
  markPreviousLegEndCounter(previousLegEndCounter: number): void;

  /**
   * 原子切换出站腿并返回旧腿结束序号。`closePrevious` 为 true 时旧腿进入
   * 有界 drain 队列（默认 DEFAULT_PREVIOUS_LEG_DRAIN_MS 后强制关闭）。
   */
  switchOutboundLeg(leg: SequencedOutboundTransport, closePrevious: boolean, drainMs?: number): Promise<number>;

  /** 拆除一条腿（失败/拒绝路径）。 */
  detachLeg(leg: SequencedOutboundTransport): Promise<void>;

  /** 中继流量累计，仅用于升级打点。 */
  relayTrafficBytes(): RelayTrafficBytes;
}
