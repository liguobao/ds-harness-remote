/**
 * Noise IK 安全通道（支持带内传输升级 `remote.transport.upgrade.v1`）。
 *
 * 在原有「中继 / Control WS 上做 Noise IK」的实现之上加入升级客户端状态：
 * - 出站：每帧加密后用 Noise 发送计数器编号（`Number(sendingCounter - 1n)`）。当前出站腿
 *   是升级腿时走 `sendSequenced(counter, ciphertext)`（由腿自己加 `DSHU` 序号头），
 *   否则继续 `inner.send(ciphertext)`（中继/Control WS）。两条腿共用同一个 Noise 计数器空间。
 * - 入站：带序号的帧按 `SequencedReorderBuffer` 做有界重排；切腿瞬间「新腿快、旧腿慢」
 *   造成的乱序不会被误判成重放。旧中继帧没有 wire counter（`undefined`）时跳过序号校验，
 *   兼容改造前的 Host / 直连数据面。
 * - 旧腿 drain（两阶段）：activate 响应里 Host 给出它自己旧腿的结束水位
 *   （`markPreviousLegEndCounter`），切腿时本端返回自己旧腿的结束序号
 *   （`switchOutboundLeg` 的返回值，交给 `remote.transport.upgrade.drain` 上报）。
 *   两端都靠 Noise 计数器对齐：水位 n 表示「序号 n-1 的那一帧已经发出/收到」。
 * - 序号重复/过旧、解密失败、重排缓冲溢出、空洞超时都 fail-closed：关闭通道并上报
 *   `onClosed`，由上层走正常断线恢复。
 *
 * 公开面与改造前保持一致（connect/send/setMessageHandler/close/onClosed/constructor），
 * `RemoteClientCore` 不需要改动。
 */

import { NoiseIkInitiator } from '../crypto/NoiseIk';
import { SecureMessageCodec } from '../protocol/SecureMessageCodec';
import { createNoisePrologue } from '../protocol/Protocol';
import { fromBase64Url, randomBytes } from '../crypto/Bytes';
import { RelayConnectionInfo, RelayTransport } from './RelayTransport';
import { DeviceIdentity, AuthorizedPeerDevice } from '../model/Types';
import { logError, logInfo, logWarn } from '../util/Log';
import { DEFAULT_PREVIOUS_LEG_DRAIN_MS, SequencedReorderBuffer } from '../protocol/TransportUpgrade';
import { SequencedOutboundTransport } from './TransportLeg';
import { RelayTrafficBytes, UpgradeableSecureChannel } from './UpgradeableChannel';

/** 已 attach 的入站腿：成对保存取消订阅句柄，detach / close 时释放。 */
class AttachedLeg {
  leg: SequencedOutboundTransport;
  unsubscribeMsg: () => void;
  unsubscribeClose: () => void;

  constructor(leg: SequencedOutboundTransport, unsubscribeMsg: () => void, unsubscribeClose: () => void) {
    this.leg = leg;
    this.unsubscribeMsg = unsubscribeMsg;
    this.unsubscribeClose = unsubscribeClose;
  }
}

/** 正在 drain 的旧腿：到 Host 给出的水位即拆，另有兜底计时器防止无限挂着。 */
class DrainingLeg {
  leg: SequencedOutboundTransport;
  /** Host 旧腿结束水位（Host 自己最后发出帧 + 1）；undefined = 还没收到。 */
  endCounter: number | undefined = undefined;
  /** 兜底强制 detach 的计时器；-1 表示已清理。 */
  timer: number = -1;

  constructor(leg: SequencedOutboundTransport) {
    this.leg = leg;
  }
}

export class SecureTransport implements UpgradeableSecureChannel {
  private inner: RelayTransport;
  private identity: DeviceIdentity;
  private host: AuthorizedPeerDevice;
  /** Locally pinned Host identity key (protocol §2 / §12.1). Empty when the caller has no
   *  pin yet; when set it must match the Server-supplied key or the handshake is aborted. */
  private pinnedHostKey: string;
  private noise: NoiseIkInitiator | undefined = undefined;
  private incoming: SecureMessageCodec = new SecureMessageCodec();
  private outgoing: SecureMessageCodec = new SecureMessageCodec();
  private closed: boolean = false;
  private closeNotified: boolean = false;
  /** Noise + SecureMessageCodec counters are not re-entrant; serialize sends. */
  private sendTail: Promise<void> = Promise.resolve();
  private messageCb: ((data: Uint8Array) => void) | undefined = undefined;
  /** 当前出站腿；undefined = 仍走 inner（中继 / Control WS）。 */
  private activeLeg: SequencedOutboundTransport | undefined = undefined;
  private attachedLegs: Map<SequencedOutboundTransport, AttachedLeg> =
    new Map<SequencedOutboundTransport, AttachedLeg>();
  private drainingLegs: Map<SequencedOutboundTransport, DrainingLeg> =
    new Map<SequencedOutboundTransport, DrainingLeg>();
  private relayBytesSent: number = 0;
  private relayBytesReceived: number = 0;
  private reorderBuffer: SequencedReorderBuffer;
  public onClosed: (() => void) | undefined = undefined;

  constructor(inner: RelayTransport, identity: DeviceIdentity, host: AuthorizedPeerDevice,
    pinnedHostKey: string = '') {
    this.inner = inner;
    this.identity = identity;
    this.host = host;
    this.pinnedHostKey = pinnedHostKey;
    if (host.identityKey.length === 0) {
      throw new Error('主机缺少身份公钥');
    }
    this.reorderBuffer = new SequencedReorderBuffer((missingCounter: number): void => {
      logWarn('secure: reorder gap timed out at counter ' + missingCounter);
      this.failAndClose(new Error('Secure channel reorder gap timed out.')).catch(() => undefined);
    });
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.closeNotified = false;
    this.relayBytesSent = 0;
    this.relayBytesReceived = 0;
    this.activeLeg = undefined;
    this.reorderBuffer.clear();
    this.incoming.reset();
    this.outgoing.reset();
    // 中继自己死掉（WS close/error、看门狗判死、静默判死）必须往上报。
    // 这里以前没人订阅 inner.onClosed —— 于是断线是「无声」的：UI 一直显示已连接，
    // 只有发消息超时才露馅，用户只能杀进程重进。上层的判词、退避重连全靠这条链。
    this.inner.onClosed = (): void => {
      this.handleInnerClosed();
    };
    if (this.pinnedHostKey.length > 0 && this.pinnedHostKey !== this.host.identityKey) {
      logError('secure transport: host identity key differs from local pin, aborting handshake');
      this.inner.close();
      throw new Error('主机身份公钥与本地固定记录不一致，已中断安全握手');
    }
    await this.inner.connect();
    const info: RelayConnectionInfo = this.inner.connectionInfo();
    if (info.localDeviceId !== this.identity.deviceId || info.remoteDeviceId !== this.host.deviceId) {
      this.inner.close();
      throw new Error('Relay 连接指向了意外的设备');
    }
    const noise = new NoiseIkInitiator(
      fromBase64Url(this.identity.privateKey),
      fromBase64Url(this.identity.publicKey),
      fromBase64Url(this.host.identityKey),
      createNoisePrologue(info.connectionId, this.host.deviceId, this.identity.deviceId),
      randomBytes);
    this.noise = noise;
    try {
      await this.waitForResponder(noise);
    } catch (e) {
      this.noise = undefined;
      this.inner.close();
      throw e instanceof Error ? e : new Error('安全握手失败');
    }
    logInfo('secure: handshake complete');
  }

  private waitForResponder(noise: NoiseIkInitiator): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        logError('noise: timeout waiting msg2 (15s)');
        finish(new Error('安全握手超时'));
      }, 15000);
      logInfo('noise: waiting for msg2, sending msg1');
      this.inner.onHandshakeStep = (step: number, data: Uint8Array) => {
        logInfo('noise: got handshake step=' + step + ' len=' + data.length);
        if (settled) {
          return;
        }
        if (step !== 2) {
          finish(new Error('安全握手时序错误'));
          return;
        }
        try {
          noise.readHandshake(data);
          if (!noise.isComplete()) {
            finish(new Error('安全握手未完成'));
            return;
          }
          logInfo('noise: handshake complete');
          finish();
        } catch (e) {
          finish(e instanceof Error ? e : new Error('安全握手失败'));
        }
      };
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.inner.onHandshakeStep = undefined;
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      this.inner.sendHandshake(1, noise.writeHandshake(new Uint8Array(0))).catch((e: Error) => {
        finish(new Error('安全握手发送失败'));
      });
    });
  }

  /** 当前 Noise 发送计数器（= 下一帧的 DSHU 序号）。 */
  outboundCounter(): number {
    const noise = this.noise;
    return noise !== undefined ? Number(noise.sendingCounter()) : 0;
  }

  /** 中继流量累计（仅升级打点用，不记录帧内容）。 */
  relayTrafficBytes(): RelayTrafficBytes {
    const bytes = new RelayTrafficBytes();
    bytes.sent = this.relayBytesSent;
    bytes.received = this.relayBytesReceived;
    return bytes;
  }

  /**
   * 先接上入站腿，再等 Host 激活结果。closed / 重复 attach 直接忽略。
   * 入站腿在 subscribe 之后才可能收到帧，因此不会漏掉激活窗口内的第一帧。
   */
  attachIncomingLeg(leg: SequencedOutboundTransport): void {
    if (this.closed || this.attachedLegs.has(leg)) {
      return;
    }
    const unsubscribeMsg: () => void = leg.onSequencedMessage((counter: number, ciphertext: Uint8Array): void => {
      this.handleIncomingCiphertext(counter, ciphertext);
    });
    const unsubscribeClose: () => void = leg.onClose((error: Error | undefined): void => {
      // 升级腿是激活后的唯一数据面：它断掉就必须 fail-close，让上层重连。
      if (this.activeLeg === leg && !this.closed) {
        this.failAndClose(error !== undefined ? error : new Error('Upgraded WebRTC DataChannel closed.')).catch(() => undefined);
      }
    });
    this.attachedLegs.set(leg, new AttachedLeg(leg, unsubscribeMsg, unsubscribeClose));
  }

  /**
   * Host 在 activate 响应里给出它自己旧腿的结束水位：本端收到该水位之前的帧后，
   * 旧腿就再没有要等的帧，立即拆掉（否则等兜底计时器空转）。
   */
  markPreviousLegEndCounter(previousLegEndCounter: number): void {
    this.drainingLegs.forEach((entry: DrainingLeg, leg: SequencedOutboundTransport): void => {
      entry.endCounter = previousLegEndCounter;
      const noise = this.noise;
      if (noise !== undefined && Number(noise.receivingCounter()) >= previousLegEndCounter) {
        this.clearDrainTimer(entry);
        this.drainingLegs.delete(leg);
        this.detachLeg(leg).catch(() => undefined);
      }
    });
  }

  /**
   * 原子切换出站腿（在 sendTail 串行段里执行，避免与在途 send 交错）。
   *
   * 返回切换前（即旧腿最后一条已发帧之后）的 Noise sendingCounter，也就是 Host 侧
   * `confirmPreviousLegDrain` 比较用的水位：Host receivingCounter >= 该值即表示旧腿
   * 最后一帧已收到。因此上报值恒等于「旧腿最后一帧序号 + 1」，不是「最后一条帧序号」。
   */
  switchOutboundLeg(leg: SequencedOutboundTransport, closePrevious: boolean, drainMs?: number): Promise<number> {
    const run: Promise<number> = this.sendTail.then(async (): Promise<number> => {
      if (this.closed) {
        await this.detachLeg(leg);
        return this.outboundCounter();
      }
      const previous: SequencedOutboundTransport | undefined = this.activeLeg;
      this.activeLeg = leg;
      const endCounter: number = this.outboundCounter();
      // 只 drain 真正 attach 过的旧腿：未 attach 的旧腿（激活前就被 detach）没有在途帧，
      // 直接换掉即可，不必占一个兜底计时器。
      if (closePrevious && previous !== undefined && previous !== leg && this.attachedLegs.has(previous)) {
        const timeoutMs: number = drainMs !== undefined ? drainMs : DEFAULT_PREVIOUS_LEG_DRAIN_MS;
        const entry = new DrainingLeg(previous);
        entry.timer = setTimeout((): void => {
          this.drainingLegs.delete(previous);
          this.detachLeg(previous).catch(() => undefined);
        }, timeoutMs);
        this.drainingLegs.set(previous, entry);
        logInfo('secure: previous outbound leg draining');
      }
      return endCounter;
    });
    const swallow = (): void => {
      return;
    };
    this.sendTail = run.then(swallow, swallow);
    return run;
  }

  /** 拆一条腿：清 drain 计时器、取消订阅、关底层通道；重复调用安全。 */
  async detachLeg(leg: SequencedOutboundTransport): Promise<void> {
    const draining: DrainingLeg | undefined = this.drainingLegs.get(leg);
    if (draining !== undefined) {
      this.clearDrainTimer(draining);
      this.drainingLegs.delete(leg);
    }
    const attached: AttachedLeg | undefined = this.attachedLegs.get(leg);
    if (attached !== undefined) {
      this.attachedLegs.delete(leg);
      attached.unsubscribeMsg();
      attached.unsubscribeClose();
    }
    try {
      await leg.close();
    } catch (e) {
      // 拆除失败不改变「这条腿已经不可用」的事实，忽略即可。
    }
  }

  send(data: Uint8Array): Promise<void> {
    const run = this.sendTail.then(() => this.sendNow(data));
    const swallow = (): void => {
      return;
    };
    this.sendTail = run.then(swallow, swallow);
    return run;
  }

  private async sendNow(data: Uint8Array): Promise<void> {
    const plaintextFrames: Uint8Array[] = this.outgoing.encode(data);
    try {
      for (const plaintext of plaintextFrames) {
        const noise = this.requireNoise();
        const ciphertext: Uint8Array = noise.encrypt(plaintext);
        const counter: number = Number(noise.sendingCounter() - 1n);
        const leg = this.activeLeg;
        if (leg !== undefined) {
          await leg.sendSequenced(counter, ciphertext);
        } else {
          this.relayBytesSent += ciphertext.byteLength;
          await this.inner.send(ciphertext);
        }
      }
    } catch (e) {
      const error: Error = e instanceof Error ? e : new Error('Secure send failed.');
      logWarn('secure: send failed');
      await this.failAndClose(error);
      throw error;
    }
  }

  setMessageHandler(handler: (data: Uint8Array) => void): void {
    this.messageCb = handler;
    // 首选带 wire counter 的入站通道（升级后 relay 帧带 Noise 序号，用于跨腿重排）；
    // counter === undefined 的帧（旧直连数据面 / 旧 Host）跳过序号校验直接解密。
    this.inner.onMessageWithCounter = (counter: number | undefined, data: Uint8Array): void => {
      this.relayBytesReceived += data.byteLength;
      this.handleIncomingCiphertext(counter, data);
    };
    // 兼容没有 counter 能力的老 inner：新 RelayTransport 的 emitData 会优先走上面的回调。
    this.inner.onMessage = (data: Uint8Array): void => {
      this.relayBytesReceived += data.byteLength;
      this.handleIncomingCiphertext(undefined, data);
    };
  }

  /**
   * 统一入站入口：校验序号 → 必要时缓冲 → 解密派发 → 释放连续积压帧。
   * 任何异常都 fail-closed（Android 语义）。
   */
  private handleIncomingCiphertext(counter: number | undefined, ciphertext: Uint8Array): void {
    const noise = this.noise;
    if (noise === undefined || !noise.isComplete() || this.closed) {
      return;
    }
    try {
      if (counter !== undefined) {
        const expected: number = Number(noise.receivingCounter());
        if (!Number.isSafeInteger(counter) || counter < expected) {
          throw new Error('Ciphertext counter is duplicated or out of order.');
        }
        if (counter > expected) {
          this.reorderBuffer.push(counter, expected, ciphertext);
          return;
        }
      }
      this.decryptAndDeliver(noise, ciphertext);
      while (!this.closed) {
        const nextExpected: number = Number(noise.receivingCounter());
        const buffered: Uint8Array | undefined = this.reorderBuffer.takeNext(nextExpected);
        if (buffered === undefined) {
          break;
        }
        this.decryptAndDeliver(noise, buffered);
      }
    } catch (e) {
      const error: Error = e instanceof Error ? e : new Error('Secure receive failed.');
      logWarn('secure: receive failed');
      this.failAndClose(error).catch(() => undefined);
    }
  }

  private decryptAndDeliver(noise: NoiseIkInitiator, ciphertext: Uint8Array): void {
    const plaintext: Uint8Array = noise.decrypt(ciphertext);
    const currentReceiving: number = Number(noise.receivingCounter());
    this.reorderBuffer.onExpectedAdvanced(currentReceiving);
    // 收到 Host 旧腿水位之前的所有帧后，旧腿可以立即拆掉。
    this.drainingLegs.forEach((entry: DrainingLeg, leg: SequencedOutboundTransport): void => {
      if (entry.endCounter !== undefined && currentReceiving >= entry.endCounter) {
        this.clearDrainTimer(entry);
        this.drainingLegs.delete(leg);
        this.detachLeg(leg).catch(() => undefined);
      }
    });
    const message: Uint8Array | undefined = this.incoming.decode(plaintext);
    if (message !== undefined && this.messageCb !== undefined) {
      this.messageCb(message);
    }
  }

  /** 底层中继没了：清掉噪声状态并把关闭事件往上报（只会报一次）。 */
  private handleInnerClosed(): void {
    if (this.closed) {
      return;
    }
    this.failAndClose(new Error('Control transport closed.')).catch(() => undefined);
  }

  private async failAndClose(error?: Error): Promise<void> {
    if (error !== undefined) {
      logWarn('secure: channel failed (' + error.name + ')');
    }
    await this.close();
  }

  /** 关闭通道：清缓冲/计时器/所有腿，关 inner，并对 onClosed 只回调一次。幂等。 */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.reorderBuffer.clear();
    this.drainingLegs.forEach((entry: DrainingLeg): void => {
      this.clearDrainTimer(entry);
    });
    this.drainingLegs.clear();
    const attached: AttachedLeg[] = [];
    this.attachedLegs.forEach((entry: AttachedLeg): void => {
      attached.push(entry);
    });
    this.attachedLegs.clear();
    this.activeLeg = undefined;
    for (const entry of attached) {
      entry.unsubscribeMsg();
      entry.unsubscribeClose();
      try {
        await entry.leg.close();
      } catch (e) {
        // 关闭失败无需处理：连接本身已经在拆除。
      }
    }
    this.incoming.reset();
    this.outgoing.reset();
    this.noise = undefined;
    this.inner.onMessageWithCounter = undefined;
    this.inner.onMessage = undefined;
    this.inner.close();
    this.notifyClosed();
  }

  private notifyClosed(): void {
    if (this.closeNotified) {
      return;
    }
    this.closeNotified = true;
    const cb = this.onClosed;
    if (cb !== undefined) {
      cb();
    }
  }

  private clearDrainTimer(entry: DrainingLeg): void {
    if (entry.timer !== -1) {
      clearTimeout(entry.timer);
      entry.timer = -1;
    }
  }

  private requireNoise(): NoiseIkInitiator {
    const noise = this.noise;
    if (noise === undefined || !noise.isComplete() || this.closed) {
      throw new Error('安全通道未连接');
    }
    return noise;
  }
}
