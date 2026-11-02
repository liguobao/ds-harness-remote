import { NoiseIkInitiator } from '../crypto/NoiseIk';
import { SecureMessageCodec } from '../protocol/SecureMessageCodec';
import { createNoisePrologue } from '../protocol/Protocol';
import { fromBase64Url, randomBytes } from '../crypto/Bytes';
import { RelayTransport } from './RelayTransport';
import { DeviceIdentity, AuthorizedPeerDevice } from '../model/Types';
import { logInfo, logWarn, logError } from '../util/Log';

export class SecureTransport {
  private inner: RelayTransport;
  private identity: DeviceIdentity;
  private host: AuthorizedPeerDevice;
  private noise: NoiseIkInitiator | undefined = undefined;
  private incoming: SecureMessageCodec = new SecureMessageCodec();
  private outgoing: SecureMessageCodec = new SecureMessageCodec();
  private closed: boolean = false;
  private sendTail: Promise<void> = Promise.resolve();
  public onClosed: (() => void) | undefined = undefined;

  constructor(inner: RelayTransport, identity: DeviceIdentity, host: AuthorizedPeerDevice) {
    this.inner = inner;
    this.identity = identity;
    this.host = host;
    if (host.identityKey.length === 0) {
      throw new Error('主机缺少身份公钥');
    }
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.incoming.reset();
    this.outgoing.reset();
    await this.inner.connect();
    const info = this.inner.connectionInfo();
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
  }

  private waitForResponder(noise: NoiseIkInitiator): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        logError('noise: timeout waiting msg2 (10s)');
        finish(new Error('安全握手超时'));
      }, 10000);
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

  send(data: Uint8Array): Promise<void> {
    const run = this.sendTail.then(() => this.sendNow(data));
    const swallow = (): void => {
      return;
    };
    this.sendTail = run.then(swallow, swallow);
    return run;
  }

  private async sendNow(data: Uint8Array): Promise<void> {
    const noise = this.noise;
    if (noise === undefined || this.closed) {
      throw new Error('安全通道未连接');
    }
    const plaintextFrames = this.outgoing.encode(data);
    for (const plaintext of plaintextFrames) {
      await this.inner.send(noise.encrypt(plaintext));
    }
  }

  setMessageHandler(handler: (data: Uint8Array) => void): void {
    this.inner.onMessage = (data: Uint8Array) => {
      const noise = this.noise;
      if (noise === undefined || !noise.isComplete() || this.closed) {
        return;
      }
      try {
        const plaintext = noise.decrypt(data);
        const message = this.incoming.decode(plaintext);
        if (message !== undefined) {
          handler(message);
        }
      } catch (e) {
        this.close();
      }
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.incoming.reset();
    this.outgoing.reset();
    this.noise = undefined;
    this.inner.close();
    const cb = this.onClosed;
    if (cb !== undefined) {
      cb();
    }
  }
}
