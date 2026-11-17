/**
 * 带内传输升级（`remote.transport.upgrade.v1`）的客户端状态机。
 *
 * 与共享实现 `packages/client-core/src/transport-upgrader.ts` 对齐：在中继上已认证的
 * Noise 通道之上，用 ArkWeb 里的 RTCPeerConnection 协商一条 WebRTC DataChannel，
 * 再经 `remote.transport.upgrade.{ice,offer,activate,drain,abort}` RPC 把出站腿从
 * 中继原子切到 TURN/P2P/LAN（`Relay -> TURN -> P2P -> LAN`，只升不降）。
 *
 * 关键点：
 * - 先 `attachIncomingLeg` 接收入站帧，再让 Host 切出站腿，切换瞬间不丢帧；
 * - 切腿后把「旧腿最后一帧序号」（`switchOutboundLeg` 返回值）通过新腿 drain RPC
 *   回报 Host，Host 据此回收旧腿；
 * - 升级腿用 `DSHU` + 8 字节大端 Noise 计数器序号包帧，序号空间与中继腿共用；
 * - 所有协商定时器/桥回调在结束路径清理，`close()` 幂等，失败永远回落中继。
 *
 * 不记录 SDP、候选地址、密文等敏感内容，只记阶段/计数/mode 名。
 */

import { toBase64Url, fromBase64Url } from '../crypto/Bytes';
import {
  UpgradedTransportFrame,
  transportTierRank,
  unwrapUpgradedTransportFrame,
  wireFromTransportTier,
  wrapUpgradedTransportFrame
} from '../protocol/TransportUpgrade';
import { asBool, asNum, asRecord, asStr, jsonStr } from '../protocol/Types';
import { logInfo, logWarn } from '../util/Log';
import { RtcBridge } from '../services/RtcBridge';
import { RemoteClientCore, RemoteEvent } from './RemoteClientCore';
import { RelayTrafficBytes, UpgradeableSecureChannel } from './UpgradeableChannel';
import { SequencedOutboundTransport } from './TransportLeg';

/** `TransportUpgrader` 的构造参数；rpc/channel/rtc 为必填，经构造函数赋值。 */
export class TransportUpgraderOptions {
  connectionId: string = '';
  fetchIceServers: ((connectionId: string) => Promise<string>) | undefined = undefined;
  /** 等 DataChannel 打通的预算（ICE 连通性检查 + DTLS）。 */
  negotiateTimeoutMs: number = 6000;
  /** 取 ICE 配置的预算；超时按 LAN-only 空配置继续。 */
  iceServersTimeoutMs: number = 4000;
  /** 成功切腿后回调：mode 为 wire 小写名（'lan' | 'p2p' | 'turn'）。 */
  onUpgraded: ((mode: string) => void) | undefined = undefined;
  onTelemetry: ((telemetry: TransportUpgradeTelemetry) => void) | undefined = undefined;
  rpc: RemoteClientCore;
  channel: UpgradeableSecureChannel;
  rtc: RtcBridge;

  constructor(rpc: RemoteClientCore, channel: UpgradeableSecureChannel, rtc: RtcBridge) {
    this.rpc = rpc;
    this.channel = channel;
    this.rtc = rtc;
  }
}

/** 一次升级尝试的结构化打点：只含阶段/时长/计数，不含地址与密文。 */
export class TransportUpgradeTelemetry {
  attemptId: string = '';
  from: string = '';
  to: string = '';
  /** 'activated' | 'skipped-not-higher' | 'rejected' | 'failed' | 'aborted' */
  outcome: string = '';
  durationMs: number = 0;
  reason: string = '';
  relaySentBytes: number = 0;
  relayReceivedBytes: number = 0;
}

let nextUpgradeSeq: number = 1;

function createAttemptId(): string {
  const seq: number = nextUpgradeSeq;
  nextUpgradeSeq += 1;
  return 'upg_' + Date.now().toString(36) + '_' + seq.toString(36);
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

/** wire 小写名 -> 内部大写 tier；未知返回空串。 */
function tierFromWire(kind: string): string {
  const lower: string = kind.toLowerCase();
  if (lower === 'lan') {
    return 'LAN';
  }
  if (lower === 'p2p') {
    return 'P2P';
  }
  if (lower === 'turn') {
    return 'TURN';
  }
  return '';
}

/** Host 授权结果里的 mode 只认三个已知 tier。 */
function isKnownTier(mode: string): boolean {
  return mode === 'LAN' || mode === 'P2P' || mode === 'TURN';
}

/**
 * 升级后的 WebRTC 出站腿：实现 `SequencedOutboundTransport`。
 *
 * 出站把密文包成 `DSHU` 序号帧后转 base64url 交给 `RtcBridge.send`；入站由
 * `TransportUpgrader` 在 `rtc.onDataBinary` 回调里调用 `deliver(base64)` 投递。
 * 断链/解析失败只广播关闭，由 SecureTransport 决定 fail-close。
 */
export class UpgradedRtcLeg implements SequencedOutboundTransport {
  private readonly rtc: RtcBridge;
  private currentModeValue: string;
  private sequencedHandlers: ((counter: number, ciphertext: Uint8Array) => void)[] = [];
  private closeHandlers: ((error: Error | undefined) => void)[] = [];
  private closed: boolean = false;
  private closeEmitted: boolean = false;

  constructor(rtc: RtcBridge, mode: string) {
    this.rtc = rtc;
    this.currentModeValue = mode;
  }

  mode(): string {
    return this.currentModeValue;
  }

  selectedTransport(): string {
    return this.currentModeValue;
  }

  async sendSequenced(counter: number, ciphertext: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error('Upgraded WebRTC transport is closed.');
    }
    const frame: Uint8Array = wrapUpgradedTransportFrame(counter, ciphertext);
    this.rtc.send(toBase64Url(frame));
  }

  onSequencedMessage(cb: (counter: number, ciphertext: Uint8Array) => void): () => void {
    this.sequencedHandlers.push(cb);
    return (): void => {
      this.removeSequencedHandler(cb);
    };
  }

  onClose(cb: (error: Error | undefined) => void): () => void {
    this.closeHandlers.push(cb);
    return (): void => {
      this.removeCloseHandler(cb);
    };
  }

  /** 收到一帧 base64url 的 `DSHU` 帧：拆头后广播给 SecureTransport。 */
  deliver(base64: string): void {
    if (this.closed) {
      return;
    }
    let frame: UpgradedTransportFrame;
    try {
      frame = unwrapUpgradedTransportFrame(fromBase64Url(base64));
    } catch (error) {
      this.notifyClosed(new Error('Invalid upgraded WebRTC frame.'));
      return;
    }
    const handlers: ((counter: number, ciphertext: Uint8Array) => void)[] = this.sequencedHandlers.slice();
    for (const handler of handlers) {
      handler(frame.counter, frame.ciphertext);
    }
  }

  updateMode(mode: string): void {
    this.currentModeValue = mode;
  }

  /** Host/桥报告 DataChannel 关闭或帧不可解析：只广播一次关闭。 */
  notifyClosed(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rtc.closeAll();
    this.emitClose(error);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rtc.closeAll();
    this.emitClose(undefined);
  }

  private removeSequencedHandler(cb: (counter: number, ciphertext: Uint8Array) => void): void {
    const index: number = this.sequencedHandlers.indexOf(cb);
    if (index >= 0) {
      this.sequencedHandlers.splice(index, 1);
    }
  }

  private removeCloseHandler(cb: (error: Error | undefined) => void): void {
    const index: number = this.closeHandlers.indexOf(cb);
    if (index >= 0) {
      this.closeHandlers.splice(index, 1);
    }
  }

  private emitClose(error: Error | undefined): void {
    if (this.closeEmitted) {
      return;
    }
    this.closeEmitted = true;
    const handlers: ((error: Error | undefined) => void)[] = this.closeHandlers.slice();
    this.closeHandlers = [];
    for (const handler of handlers) {
      handler(error);
    }
  }
}

/**
 * 客户端侧带内传输升级状态机。
 *
 * `promote()` 一次只跑一个尝试（重复调用复用进行中的 promise）；失败/被拒一律
 * 回落中继并返回 false，不打断已有的加密流。
 */
export class TransportUpgrader {
  private readonly options: TransportUpgraderOptions;
  private readonly rpc: RemoteClientCore;
  private readonly channel: UpgradeableSecureChannel;
  private readonly rtc: RtcBridge;
  private currentLeg: UpgradedRtcLeg | undefined = undefined;
  /** 本轮尝试已创建、但还没正式切成的入站腿。 */
  private attachedLeg: UpgradedRtcLeg | undefined = undefined;
  private activeAttemptId: string | undefined = undefined;
  private pendingRemoteIce: Record<string, Object>[] = [];
  private remoteDescReady: boolean = false;
  private promoting: Promise<boolean> | undefined = undefined;
  private closed: boolean = false;
  private unsubscribeEvents: (() => void) | undefined = undefined;
  /** close() 唤醒仍在等 offer/DataChannel 的尝试，让它尽快走 aborted 收尾。 */
  private faultResolve: ((error: Error) => void) | undefined = undefined;

  constructor(options: TransportUpgraderOptions) {
    this.options = options;
    this.rpc = options.rpc;
    this.channel = options.channel;
    this.rtc = options.rtc;
    this.unsubscribeEvents = this.rpc.onEvent((event: RemoteEvent): void => {
      this.handleRemoteIceEvent(event);
    });
  }

  /** 'Relay' | 'LAN' | 'P2P' | 'TURN'：以已激活的升级腿为准，否则中继。 */
  currentMode(): string {
    const leg: UpgradedRtcLeg | undefined = this.currentLeg;
    if (leg === undefined) {
      return 'Relay';
    }
    const tier: string = tierFromWire(leg.mode());
    return tier.length > 0 ? tier : 'Relay';
  }

  /** 发起一次升级尝试；已在 LAN 或正在升级时直接返回（不重复协商）。 */
  promote(preferLan: boolean): Promise<boolean> {
    if (this.closed) {
      return Promise.resolve(false);
    }
    if (this.currentMode() === 'LAN') {
      return Promise.resolve(false);
    }
    const inFlight: Promise<boolean> | undefined = this.promoting;
    if (inFlight !== undefined) {
      return inFlight;
    }
    const run: Promise<boolean> = this.runAttempt(preferLan);
    this.promoting = run;
    void run.then((): void => {
      if (this.promoting === run) {
        this.promoting = undefined;
      }
    }, (): void => {
      if (this.promoting === run) {
        this.promoting = undefined;
      }
    });
    return run;
  }

  /**
   * 给快的直连路径一个短窗口：还在中继上时最多等 `windowMs`，让首批历史/目录
   * 大请求先走直连；超时或本来就非中继时返回 false/true 不阻塞。
   */
  async waitForInitialWindow(windowMs: number): Promise<boolean> {
    if (this.currentMode() !== 'Relay') {
      return true;
    }
    const inFlight: Promise<boolean> = this.promoting !== undefined ? this.promoting : this.promote(false);
    if (windowMs <= 0) {
      return false;
    }
    let timer: number | undefined = undefined;
    try {
      const timeout: Promise<boolean> = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, windowMs);
      });
      const outcome: boolean = await Promise.race([inFlight, timeout]);
      return outcome;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /** 收掉协商、桥回调与当前升级腿；重复调用安全。 */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const unsubscribe: (() => void) | undefined = this.unsubscribeEvents;
    this.unsubscribeEvents = undefined;
    if (unsubscribe !== undefined) {
      unsubscribe();
    }
    // 让还在等 offer/DataChannel 的尝试立即从 await 里退出。
    const fail: ((error: Error) => void) | undefined = this.faultResolve;
    this.faultResolve = undefined;
    if (fail !== undefined) {
      fail(new Error('Transport upgrader closed.'));
    }
    this.clearBridgeCallbacks();
    this.rtc.closeAll();
    this.pendingRemoteIce = [];
    this.remoteDescReady = false;
    const leg: UpgradedRtcLeg | undefined = this.currentLeg;
    this.currentLeg = undefined;
    this.attachedLeg = undefined;
    if (leg !== undefined) {
      await leg.close().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- 升级尝试

  private async runAttempt(preferLan: boolean): Promise<boolean> {
    const startedAt: number = Date.now();
    const fromMode: string = this.currentMode();
    const attemptId: string = createAttemptId();
    this.activeAttemptId = attemptId;
    this.pendingRemoteIce = [];
    this.remoteDescReady = false;
    this.attachedLeg = undefined;

    let offerSent: boolean = false;
    let detectedMode: string = '';
    let succeeded: boolean = false;
    const localIceQueue: string[] = [];

    let offerResolve: ((sdp: string) => void) | undefined = undefined;
    let openResolve: (() => void) | undefined = undefined;
    let faultResolve: ((error: Error) => void) | undefined = undefined;
    const offerReady: Promise<string> = new Promise<string>((resolve) => {
      offerResolve = resolve;
    });
    const dataOpenReady: Promise<void> = new Promise<void>((resolve) => {
      openResolve = resolve;
    });
    const fault: Promise<Error> = new Promise<Error>((resolve) => {
      faultResolve = resolve;
    });
    this.faultResolve = (error: Error): void => {
      if (faultResolve !== undefined) {
        faultResolve(error);
      }
    };
    const failLocally: (error: Error) => void = (error: Error): void => {
      if (faultResolve !== undefined) {
        faultResolve(error);
      }
    };
    const isCurrentAttempt: () => boolean = (): boolean => {
      return !this.closed && this.activeAttemptId === attemptId;
    };

    this.installAttemptCallbacks(isCurrentAttempt,
      (sdp: string): void => {
        if (offerResolve !== undefined) {
          offerResolve(sdp);
        }
      },
      (): void => {
        if (openResolve !== undefined) {
          openResolve();
        }
      },
      (error: Error): void => {
        failLocally(error);
      },
      (candidateJson: string): void => {
        if (!offerSent) {
          if (localIceQueue.length < 64) {
            localIceQueue.push(candidateJson);
          }
          return;
        }
        this.sendIce(attemptId, candidateJson);
      },
      (tier: string): void => {
        if (tier.length > 0) {
          detectedMode = tier;
        }
      });

    try {
      // 1) ICE 配置：LAN-only 不取；取不到/超时按空配置继续（只吃本地候选）。
      let iceServersJson: string = '[]';
      if (!preferLan && this.options.fetchIceServers !== undefined) {
        try {
          iceServersJson = await this.fetchIceServersWithTimeout(this.options.fetchIceServers,
            this.options.iceServersTimeoutMs);
        } catch (error) {
          iceServersJson = '[]';
        }
      }
      if (this.closed) {
        this.emitTelemetry(attemptId, fromMode, startedAt, 'aborted', '', '');
        return false;
      }

      // 2) 发起 offer：桥把本地 SDP 通过 onLocalSdp 回传。
      if (!this.rtc.beginOffer(iceServersJson)) {
        throw new Error('WebRTC bridge is not ready.');
      }
      const offerSdp: string = await this.waitForOffer(offerReady, fault, 5000);
      if (this.closed) {
        throw new Error('Transport upgrader closed.');
      }

      // 3) 交 Host 换 answer，再 applyAnswer；此前到达的远端 ICE 先暂存。
      const offerParams: Record<string, Object> = {
        'attemptId': attemptId,
        'sdp': offerSdp
      };
      const offerResponse: Object = await this.rpc.rpc('remote.transport.upgrade.offer', offerParams, 8000);
      offerSent = true;
      while (localIceQueue.length > 0) {
        const queued: string | undefined = localIceQueue.shift();
        if (queued === undefined) {
          break;
        }
        this.sendIce(attemptId, queued);
      }
      const answer: Record<string, Object> | undefined = asRecord(offerResponse);
      const answerSdp: string = answer !== undefined ? jsonStr(answer, 'sdp', '') : '';
      if (answerSdp.length === 0) {
        throw new Error('Invalid upgrade answer.');
      }
      this.rtc.applyAnswer(answerSdp);
      this.remoteDescReady = true;
      const buffered: Record<string, Object>[] = this.pendingRemoteIce;
      this.pendingRemoteIce = [];
      for (const candidate of buffered) {
        this.rtc.addRemoteIce(JSON.stringify(candidate));
      }

      // 4) 等 DataChannel 打通，再短暂轮询桥上报的选中路径。
      await this.waitForDataOpen(dataOpenReady, fault, this.options.negotiateTimeoutMs);
      if (this.closed) {
        throw new Error('Transport upgrader closed.');
      }
      for (let i = 0; i < 6; i += 1) {
        if (detectedMode === 'LAN') {
          break;
        }
        if (!preferLan && detectedMode.length > 0) {
          break;
        }
        if (i < 5) {
          await delay(40);
        }
      }

      // 5) Host 权威分级不比当前高：主动放弃，继续用中继。
      if (detectedMode.length > 0 && transportTierRank(detectedMode) <= transportTierRank(fromMode)) {
        this.abortAttempt(attemptId);
        this.rtc.closeAll();
        this.emitTelemetry(attemptId, fromMode, startedAt, 'skipped-not-higher', detectedMode, '');
        return false;
      }

      const provisionalMode: string = detectedMode.length > 0 ? detectedMode : 'P2P';
      const leg: UpgradedRtcLeg = new UpgradedRtcLeg(this.rtc, wireFromTransportTier(provisionalMode));
      this.attachedLeg = leg;

      // 6) 先接收入站，再请求 Host 切出站：切换瞬间到达的新腿帧不会丢。
      this.channel.attachIncomingLeg(leg);
      const activateParams: Record<string, Object> = {
        'attemptId': attemptId
      };
      if (detectedMode.length > 0) {
        activateParams['transport'] = wireFromTransportTier(detectedMode);
      }
      const activateResponse: Object = await this.rpc.rpc('remote.transport.upgrade.activate', activateParams, 6000);
      const activation: Record<string, Object> | undefined = asRecord(activateResponse);
      const activated: boolean = activation !== undefined && asBool(activation['activated']) === true;
      if (!activated) {
        this.attachedLeg = undefined;
        await this.channel.detachLeg(leg).catch(() => undefined);
        this.emitTelemetry(attemptId, fromMode, startedAt, 'rejected', '', '');
        return false;
      }

      const responseMode: string = activation !== undefined ? jsonStr(activation, 'mode', '') : '';
      const authoritativeMode: string = isKnownTier(responseMode) ? responseMode : provisionalMode;
      if (authoritativeMode !== provisionalMode) {
        leg.updateMode(wireFromTransportTier(authoritativeMode));
      }

      // 7) 先原子退役旧出站腿（此后旧腿不会再收到帧，其 close 也不会误伤新腿），
      // 再按 Host 水位回收旧入站腿；`switchOutboundLeg` 的返回值是旧腿最后一帧序号。
      const finalOldLegCounter: number = await this.channel.switchOutboundLeg(leg, true);
      if (activation !== undefined) {
        const previousLegEndCounter: number | undefined = asNum(activation['previousLegEndCounter']);
        if (previousLegEndCounter !== undefined) {
          this.channel.markPreviousLegEndCounter(previousLegEndCounter);
        }
      }
      this.currentLeg = leg;
      this.attachedLeg = undefined;

      // 8) 通过新腿把「旧腿真实末帧序号」回报 Host，Host 据此 drain 并关旧腿。
      const drainParams: Record<string, Object> = {
        'attemptId': attemptId,
        'previousLegEndCounter': finalOldLegCounter
      };
      void this.rpc.rpc('remote.transport.upgrade.drain', drainParams, 5000).catch(() => undefined);

      succeeded = true;
      this.emitTelemetry(attemptId, fromMode, startedAt, 'activated', authoritativeMode, '');
      this.notifyUpgraded(authoritativeMode.toLowerCase());
      logInfo('[upgrade] transport upgraded mode=' + authoritativeMode.toLowerCase());
      return true;
    } catch (error) {
      const detached: UpgradedRtcLeg | undefined = this.attachedLeg;
      this.attachedLeg = undefined;
      this.abortAttempt(attemptId);
      if (detached !== undefined) {
        await this.channel.detachLeg(detached).catch(() => undefined);
      }
      this.rtc.closeAll();
      const reason: string = error instanceof Error ? error.name : 'Error';
      this.emitTelemetry(attemptId, fromMode, startedAt, this.closed ? 'aborted' : 'failed', '', reason);
      return false;
    } finally {
      if (this.activeAttemptId === attemptId) {
        this.activeAttemptId = undefined;
        this.faultResolve = undefined;
        this.pendingRemoteIce = [];
        this.remoteDescReady = false;
      }
      if (succeeded) {
        this.installActiveLegCallbacks();
      } else {
        this.clearBridgeCallbacks();
      }
    }
  }

  // ---------------------------------------------------------------- 桥回调

  /**
   * 协商期间接管 RtcBridge 的回调。所有回调都带 attempt 代次校验，避免迟到的
   * 上一轮事件污染本轮；`onDataBinary` 始终按 attached/current 腿转发。
   */
  private installAttemptCallbacks(isCurrentAttempt: () => boolean,
    onOffer: (sdp: string) => void, onOpen: () => void, onFailure: (error: Error) => void,
    onLocalIce: (candidateJson: string) => void, onDetectedTier: (tier: string) => void): void {
    this.rtc.onLocalSdp = (description: string): void => {
      if (!isCurrentAttempt() || description.length === 0) {
        return;
      }
      onOffer(description);
    };
    this.rtc.onIce = (candidateJson: string): void => {
      if (!isCurrentAttempt() || candidateJson.length === 0) {
        return;
      }
      onLocalIce(candidateJson);
    };
    this.rtc.onDataOpen = (): void => {
      if (!isCurrentAttempt()) {
        return;
      }
      onOpen();
    };
    this.rtc.onDataClosed = (): void => {
      if (!isCurrentAttempt()) {
        return;
      }
      this.handleDataChannelClosed(onFailure);
    };
    this.rtc.onTransport = (kind: string): void => {
      if (!isCurrentAttempt()) {
        return;
      }
      onDetectedTier(tierFromWire(kind));
    };
    this.rtc.onError = (message: string): void => {
      if (!isCurrentAttempt()) {
        return;
      }
      // 桥的错误文案可能含实现细节，不落日志；telemetry 只记错误类型。
      logWarn('[upgrade] WebRTC bridge reported an error during negotiation');
      onFailure(new Error('WebRTC bridge reported an error.'));
    };
    this.rtc.onPath = (text: string): void => {
      if (!isCurrentAttempt()) {
        return;
      }
      // 只记诊断长度；桥给的文本含候选地址，禁止落日志。
      logInfo('[upgrade] selected-path diagnostic length=' + text.length);
    };
    this.rtc.onDataBinary = (base64: string): void => {
      this.deliverInbound(base64);
    };
  }

  /** 升级成功后只保留数据面入口：信令回调全部摘掉，避免污染后续连接。 */
  private installActiveLegCallbacks(): void {
    this.clearSignalCallbacks();
    this.rtc.onDataBinary = (base64: string): void => {
      this.deliverInbound(base64);
    };
    this.rtc.onDataClosed = (): void => {
      const leg: UpgradedRtcLeg | undefined = this.currentLeg;
      if (leg !== undefined) {
        leg.notifyClosed(new Error('Upgraded WebRTC DataChannel closed.'));
      }
    };
  }

  private handleDataChannelClosed(onFailure: (error: Error) => void): void {
    // 只认本轮尝试已 attach 的新腿：协商期间旧腿的 DataChannel 可能被桥重建而关闭，
    // 那属于预期噪声，不能把上一跳已激活的腿判死（否则第二跳会误杀当前数据面）。
    const leg: UpgradedRtcLeg | undefined = this.attachedLeg;
    if (leg !== undefined) {
      leg.notifyClosed(new Error('Upgraded WebRTC DataChannel closed.'));
      return;
    }
    onFailure(new Error('Upgraded WebRTC DataChannel closed during negotiation.'));
  }

  private deliverInbound(base64: string): void {
    const leg: UpgradedRtcLeg | undefined =
      this.attachedLeg !== undefined ? this.attachedLeg : this.currentLeg;
    if (leg !== undefined) {
      leg.deliver(base64);
    }
  }

  private clearSignalCallbacks(): void {
    this.rtc.onLocalSdp = undefined;
    this.rtc.onIce = undefined;
    this.rtc.onDataOpen = undefined;
    this.rtc.onTransport = undefined;
    this.rtc.onError = undefined;
    this.rtc.onPath = undefined;
  }

  private clearBridgeCallbacks(): void {
    this.clearSignalCallbacks();
    this.rtc.onDataBinary = undefined;
    this.rtc.onDataClosed = undefined;
  }

  // ---------------------------------------------------------------- 远端 ICE

  /** 处理 Host 经 RPC event 推送的 `remote.transport.upgrade.ice`。 */
  private handleRemoteIceEvent(event: RemoteEvent): void {
    if (this.closed || event.event !== 'remote.transport.upgrade.ice') {
      return;
    }
    const data: Record<string, Object> | undefined = asRecord(event.data);
    if (data === undefined) {
      return;
    }
    const attemptId: string | undefined = asStr(data['attemptId']);
    if (attemptId === undefined || attemptId !== this.activeAttemptId) {
      return;
    }
    const candidate: Record<string, Object> | undefined = asRecord(data['candidate']);
    if (candidate === undefined) {
      return;
    }
    if (!this.remoteDescReady) {
      // 还没 applyAnswer：先暂存（有界 64 条），等远端描述生效后补送。
      if (this.pendingRemoteIce.length < 64) {
        this.pendingRemoteIce.push(candidate);
      }
      return;
    }
    this.rtc.addRemoteIce(JSON.stringify(candidate));
  }

  // ---------------------------------------------------------------- 工具方法

  private sendIce(attemptId: string, candidateJson: string): void {
    let candidate: Object;
    try {
      candidate = JSON.parse(candidateJson) as Object;
    } catch (error) {
      logWarn('[upgrade] dropping unparsable local ICE candidate');
      return;
    }
    const params: Record<string, Object> = {
      'attemptId': attemptId,
      'candidate': candidate
    };
    void this.rpc.rpc('remote.transport.upgrade.ice', params, 5000).catch(() => undefined);
  }

  private abortAttempt(attemptId: string): void {
    const params: Record<string, Object> = {
      'attemptId': attemptId
    };
    void this.rpc.rpc('remote.transport.upgrade.abort', params, 3000).catch(() => undefined);
  }

  private async fetchIceServersWithTimeout(
    fetch: (connectionId: string) => Promise<string>, budgetMs: number): Promise<string> {
    let timer: number | undefined = undefined;
    try {
      const timeout: Promise<string> = new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          resolve('[]');
        }, budgetMs);
      });
      const result: string = await Promise.race([fetch(this.options.connectionId), timeout]);
      return typeof result === 'string' && result.length > 0 ? result : '[]';
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async waitForOffer(offer: Promise<string>, fault: Promise<Error>, budgetMs: number): Promise<string> {
    let timer: number | undefined = undefined;
    try {
      const timeout: Promise<Error> = new Promise<Error>((resolve) => {
        timer = setTimeout(() => {
          resolve(new Error('Timed out waiting for the WebRTC offer.'));
        }, budgetMs);
      });
      const outcome: string | Error = await Promise.race([offer, fault, timeout]);
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async waitForDataOpen(open: Promise<void>, fault: Promise<Error>, budgetMs: number): Promise<void> {
    let timer: number | undefined = undefined;
    try {
      const timeout: Promise<Error> = new Promise<Error>((resolve) => {
        timer = setTimeout(() => {
          resolve(new Error('Timed out waiting for the upgraded DataChannel.'));
        }, budgetMs);
      });
      const opened: Promise<boolean> = open.then((): boolean => {
        return true;
      });
      const outcome: boolean | Error = await Promise.race([opened, fault, timeout]);
      if (outcome instanceof Error) {
        throw outcome;
      }
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private emitTelemetry(attemptId: string, fromMode: string, startedAt: number, outcome: string,
    to: string, reason: string): void {
    const handler: ((telemetry: TransportUpgradeTelemetry) => void) | undefined = this.options.onTelemetry;
    if (handler === undefined) {
      return;
    }
    const telemetry: TransportUpgradeTelemetry = new TransportUpgradeTelemetry();
    telemetry.attemptId = attemptId;
    telemetry.from = fromMode;
    telemetry.to = to;
    telemetry.outcome = outcome;
    telemetry.durationMs = Math.max(0, Date.now() - startedAt);
    telemetry.reason = reason;
    try {
      const traffic: RelayTrafficBytes = this.channel.relayTrafficBytes();
      telemetry.relaySentBytes = traffic.sent;
      telemetry.relayReceivedBytes = traffic.received;
    } catch (trafficError) {
      // 打点读失败不能影响升级本身；原因只记类型。
      logWarn('[upgrade] relay traffic snapshot failed: '
        + (trafficError instanceof Error ? trafficError.name : 'Error'));
      telemetry.relaySentBytes = 0;
      telemetry.relayReceivedBytes = 0;
    }
    try {
      handler(telemetry);
    } catch (handlerError) {
      logWarn('[upgrade] telemetry handler failed: '
        + (handlerError instanceof Error ? handlerError.name : 'Error'));
    }
  }

  private notifyUpgraded(mode: string): void {
    const handler: ((mode: string) => void) | undefined = this.options.onUpgraded;
    if (handler === undefined) {
      return;
    }
    try {
      handler(mode);
    } catch (handlerError) {
      logWarn('[upgrade] upgraded handler failed: '
        + (handlerError instanceof Error ? handlerError.name : 'Error'));
    }
  }
}
