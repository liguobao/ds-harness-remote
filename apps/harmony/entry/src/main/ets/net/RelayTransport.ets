import { webSocket } from '@kit.NetworkKit';
import { buildControlFrameJson, buildRelayDataFrameJson, PROTOCOL_VERSION } from '../protocol/Protocol';
import { parseFrame, jsonStr, jsonNum, jsonValue, jsonStrArr, ParsedFrame } from '../protocol/Types';
import { toBase64Url, fromBase64Url } from '../crypto/Bytes';
import { logInfo, logWarn, logError } from '../util/Log';

export class RelayTransportOptions {
  deviceId: string = '';
  accessToken: string = '';
  targetDeviceId: string = '';
  /**
   * 与原项目 client 保持一致：声明完整数据面能力，别只留 relay。
   * 只声明 relay 时服务端只会下发中继端点，中继一满就彻底没路。
   */
  capabilities: string[] = ['transport.lan', 'transport.p2p', 'transport.turn',
    'transport.relay', 'transport.relay.attach'];
  /** 优先级照原项目 network.md：LAN -> P2P -> TURN -> Relay。 */
  preferredTransports: string[] = ['lan', 'p2p', 'turn', 'relay'];
  /**
   * 整个控制握手（含重新要票）的预算。服务端 connect.request 偶尔要十几秒才回
   * （网关刚重启时实测 16s），所以别按秒级预算掐死。
   */
  handshakeTimeoutMs: number = 60000;
  /** 中继容量会抖一下，快速补两次就够了；真被拒就别让用户干等。 */
  attachRetryDelaysMs: number[] = [1200, 2500];
}

/**
 * 服务器只给一个 relayEndpoint。同一集群里还有 gz-turn / turn 等节点，
 * 某个节点打满时换个域名再试——票据是服务端签的，换节点不影响校验。
 */
export function buildRelayCandidates(endpoint: string): string[] {
  const out: string[] = [endpoint];
  const match: RegExpMatchArray | null = endpoint.match(/^(wss?:\/\/)([^/]+)(.*)$/);
  if (match === null) {
    return out;
  }
  const scheme: string = match[1];
  const tail: string = match[3];
  const host: string = match[2];
  const suffixes: string[] = ['r2049.cn'];
  const dot: number = host.indexOf('.');
  if (dot > 0) {
    const suffix: string = host.substring(dot + 1);
    suffixes[0] = suffix;
  }
  const alternatives: string[] = ['gz-turn', 'turn', 'sh-turn'];
  for (const prefix of alternatives) {
    const candidate: string = scheme + prefix + '.' + suffixes[0] + tail;
    if (candidate !== endpoint && !out.includes(candidate)) {
      out.push(candidate);
    }
  }
  return out;
}

/** 把中继的关闭码翻译成一句人话，原始 code/reason 仍然带着，方便报障。 */
export function describeAttachFailure(code: number, reason: string): string {
  if (code === 4008) {
    return '中继当前没有可用容量（4008 ' + reason + '），请稍后重试或让主机侧重启中继';
  }
  if (code === 4001 || code === 4003) {
    return '中继拒绝了这次连接（' + code + ' ' + reason + '），票据可能已失效，重试即可';
  }
  return '中继连接失败（' + code + ' ' + reason + '）';
}

export class RelayConnectionInfo {
  connectionId: string = '';
  localDeviceId: string = '';
  remoteDeviceId: string = '';
}

export class RelayTransport {
  private url: string;
  private options: RelayTransportOptions;
  public onMessage: ((data: Uint8Array) => void) | undefined = undefined;
  public onHandshakeStep: ((step: number, data: Uint8Array) => void) | undefined = undefined;
  public onClosed: (() => void) | undefined = undefined;

  private socket: webSocket.WebSocket | undefined = undefined;
  private dataSocket: webSocket.WebSocket | undefined = undefined;
  private connectionId: string | undefined = undefined;
  /** 已经用掉几次 attach 机会（每次都会重新要 ticket）。 */
  private attachAttempt: number = 0;
  /** 服务器给的中继端点 + 同集群备选（节点打满时换一台试）。 */
  private relayCandidates: string[] = [];
  private relayCounter: number = 0;
  private connectResolve: (() => void) | undefined = undefined;
  private connectReject: ((err: Error) => void) | undefined = undefined;
  private handshakeTimer: number = -1;
  private dataAttachResolve: (() => void) | undefined = undefined;
  private dataAttachReject: ((err: Error) => void) | undefined = undefined;
  private dataReady: boolean = false;
  private notifiedClosed: boolean = false;

  constructor(url: string, options: RelayTransportOptions) {
    this.url = url;
    this.options = options;
  }

  connect(): Promise<void> {
    if (this.socket !== undefined) {
      return Promise.resolve();
    }
    this.notifiedClosed = false;
    this.attachAttempt = 0;
    this.relayCandidates = [];
    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.handshakeTimer = setTimeout(() => {
        this.fail(new Error('Relay control handshake timed out'));
      }, this.options.handshakeTimeoutMs);
      const ws = webSocket.createWebSocket();
      this.socket = ws;
      ws.on('open', (err: Error, value: Object) => {
        logInfo('control socket open ' + this.url);
        try {
          this.sendHello();
        } catch (e) {
          this.fail(new Error('relay hello send failed'));
        }
      });
      ws.on('message', (err: Error, value: string | ArrayBuffer) => {
        if (typeof value === 'string') {
          this.handleControlText(value);
        }
      });
      ws.on('close', (err: Error, value: webSocket.CloseResult) => {
        this.handleControlClose();
      });
      ws.on('error', (err: Error) => {
        this.fail(new Error(`RelayTransport failed to connect to ${this.url}`));
      });
      ws.connect(this.url, (err: Error, value: boolean) => {
        if (err) {
          this.fail(new Error(`RelayTransport failed to connect to ${this.url}`));
        }
      });
    });
  }

  send(data: Uint8Array): Promise<void> {
    const connId = this.connectionId;
    if (connId === undefined) {
      throw new Error('relay connection has not been authorized');
    }
    const payload: Record<string, Object> = {
      'connectionId': connId,
      'targetDeviceId': this.options.targetDeviceId,
      'counter': this.relayCounter,
      'ciphertext': toBase64Url(data)
    };
    const ds = this.dataSocket;
    if (ds !== undefined && this.dataReady) {
      try {
        ds.send(buildRelayDataFrameJson('relay', payload), (err: Error, value: boolean) => {
          if (err) {
            this.fail(new Error('relay data send failed'));
          }
        });
      } catch (e) {
        throw new Error('relay data send failed');
      }
    } else {
      this.sendControl('relay', payload);
    }
    this.relayCounter += 1;
    return Promise.resolve();
  }

  sendHandshake(step: number, data: Uint8Array): Promise<void> {
    const connId = this.connectionId;
    if (connId === undefined) {
      throw new Error('relay connection has not been authorized');
    }
    const payload: Record<string, Object> = {
      'connectionId': connId,
      'targetDeviceId': this.options.targetDeviceId,
      'step': step,
      'data': toBase64Url(data)
    };
    this.sendControl('secure.handshake', payload);
    return Promise.resolve();
  }

  connectionInfo(): RelayConnectionInfo {
    const connId = this.connectionId;
    if (connId === undefined) {
      throw new Error('relay connection has not been authorized');
    }
    const info = new RelayConnectionInfo();
    info.connectionId = connId;
    info.localDeviceId = this.options.deviceId;
    info.remoteDeviceId = this.options.targetDeviceId;
    return info;
  }

  close(): void {
    this.clearHandshakeTimer();
    this.closeInternal();
  }

  private sendHello(): void {
    const payload: Record<string, Object> = {
      'role': 'client',
      'deviceId': this.options.deviceId,
      'accessToken': this.options.accessToken,
      'protocols': [PROTOCOL_VERSION],
      'capabilities': this.options.capabilities
    };
    this.sendControl('hello', payload);
  }

  private sendControl(type: string, payload: Record<string, Object>): void {
    const ws = this.socket;
    if (ws === undefined) {
      throw new Error('relay control socket is not open');
    }
    try {
      ws.send(buildControlFrameJson(type, payload), (err: Error, value: boolean) => {
        if (err) {
          this.fail(new Error('relay control send failed'));
        }
      });
    } catch (e) {
      throw new Error('relay control send failed');
    }
  }

  /** 只从控制帧里取出 type 字段用于日志，其余内容一律不外泄。 */
  private frameTypeOfSafe(text: string): string {
    try {
      const parsed: Object = JSON.parse(text) as Object;
      const rec: Record<string, Object> = parsed as Record<string, Object>;
      const t: Object | undefined = rec['type'];
      return typeof t === 'string' ? t as string : '?';
    } catch (e) {
      return '?';
    }
  }

  private handleControlText(text: string): void {
    // 安全：控制帧里可能带 accessToken（hello 帧），禁止整帧落日志。
    // 只记录类型与长度——不依赖字段顺序，加字段也不会泄露。
    logInfo('ctl frame len=' + text.length + ' type=' + this.frameTypeOfSafe(text));
    try {
      const frame = parseFrame(text);
      if (frame.type === 'hello.ack') {
        this.handleHelloAck(frame);
        return;
      }
      if (frame.type === 'connect.accepted') {
        this.handleConnectAccepted(frame);
        return;
      }
      if (frame.type === 'connect.rejected' || frame.type === 'error') {
        const message = jsonStr(frame.payload, 'message', 'Server rejected the relay connection');
        this.fail(new Error(message));
        return;
      }
      if (frame.type === 'relay') {
        if (this.dataSocket !== undefined) {
          return;
        }
        this.handleRelayPayload(frame.payload);
        return;
      }
      if (frame.type === 'secure.handshake') {
        this.handleHandshakePayload(frame.payload);
        return;
      }
      if (frame.type === 'ping') {
        this.sendControl('pong', frame.payload);
      }
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error('Invalid relay control frame'));
    }
  }

  private handleHelloAck(frame: ParsedFrame): void {
    const protocol = jsonNum(frame.payload, 'protocol', 0);
    if (protocol !== PROTOCOL_VERSION) {
      throw new Error('Server selected an unsupported protocol version');
    }
    const capsRaw = jsonValue(frame.payload, 'capabilities');
    const negotiated: string[] = capsRaw === undefined ? ['transport.relay']
      : jsonStrArr(frame.payload, 'capabilities');
    let allOffered = true;
    for (const cap of negotiated) {
      if (!this.options.capabilities.includes(cap)) {
        allOffered = false;
      }
    }
    logInfo('server negotiated capabilities: ' + negotiated.join(','));
    if (!allOffered || !negotiated.includes('transport.relay')) {
      throw new Error('Server did not negotiate the required Relay capability');
    }
    const payload: Record<string, Object> = {
      'hostDeviceId': this.options.targetDeviceId,
      'preferredTransports': this.options.preferredTransports
    };
    this.sendControl('connect.request', payload);
  }

  private handleConnectAccepted(frame: ParsedFrame): void {
    const connectionId = jsonStr(frame.payload, 'connectionId', '');
    if (connectionId.length === 0) {
      throw new Error('connect.accepted did not include a connectionId');
    }
    this.connectionId = connectionId;
    const relayEndpoint = jsonStr(frame.payload, 'relayEndpoint', '');
    const relayTicket = jsonStr(frame.payload, 'relayTicket', '');
    const relayEpoch = jsonNum(frame.payload, 'relayEpoch', -1);
    const hints: string[] = [];
    for (const key of ['iceServers', 'rtcConfig', 'webrtc', 'candidates', 'lanAddress', 'transportHints']) {
      if (jsonValue(frame.payload, key) !== undefined) {
        hints.push(key);
      }
    }
    logInfo('connect.accepted hints=[' + hints.join(',') + '] relay=' + relayEndpoint);
    if (relayEndpoint.length > 0 && relayTicket.length > 0) {
      if (this.relayCandidates.length === 0) {
        this.relayCandidates = buildRelayCandidates(relayEndpoint);
        logInfo('relay candidates: ' + this.relayCandidates.join(' , '));
      }
      const target: string = this.relayCandidates[this.attachAttempt % this.relayCandidates.length];
      this.openDataSocket(target, relayTicket, relayEpoch)
        .then(() => {
          this.attachAttempt = 0;
          this.finishConnect();
        })
        .catch((e: Error) => {
          // 把底层原因带出来，否则线上只能看到笼统的 attach failed
          const detail: string = e instanceof Error ? e.message : String(e);
          logError('relay data attach failed: ' + detail);
          this.retryWithFreshTicket(detail);
        });
    } else {
      this.finishConnect();
    }
  }

  private handleRelayPayload(payload: Record<string, Object>): void {
    const connectionId = jsonStr(payload, 'connectionId', '');
    const targetDeviceId = jsonStr(payload, 'targetDeviceId', '');
    const ciphertext = jsonStr(payload, 'ciphertext', '');
    if (connectionId !== this.connectionId || targetDeviceId !== this.options.deviceId
      || ciphertext.length === 0) {
      throw new Error('Received a relay frame for an unknown connection');
    }
    const data = fromBase64Url(ciphertext);
    const cb = this.onMessage;
    if (cb !== undefined) {
      cb(data);
    }
  }

  private handleHandshakePayload(payload: Record<string, Object>): void {
    const connectionId = jsonStr(payload, 'connectionId', '');
    const targetDeviceId = jsonStr(payload, 'targetDeviceId', '');
    const data = jsonStr(payload, 'data', '');
    const step = jsonNum(payload, 'step', 0);
    if (connectionId !== this.connectionId || targetDeviceId !== this.options.deviceId
      || data.length === 0) {
      throw new Error('Received a secure handshake frame for an unknown connection');
    }
    const cb = this.onHandshakeStep;
    if (cb !== undefined) {
      cb(step, fromBase64Url(data));
    }
  }

  /**
   * attach 失败后不重用旧 ticket：服务端可能一发票就占了一个 relay 会话，
   * 拿旧票重试只会一直被拒，还越试越占。这里改为重新走一次 connect.request。
   */
  private retryWithFreshTicket(detail: string): void {
    const delays: number[] = this.options.attachRetryDelaysMs;
    if (this.attachAttempt >= delays.length || this.notifiedClosed) {
      this.fail(new Error('relay data attach failed: ' + detail));
      return;
    }
    const wait: number = delays[this.attachAttempt];
    this.attachAttempt = this.attachAttempt + 1;
    logWarn('relay attach retry ' + this.attachAttempt + '/' + delays.length
      + ' with a fresh ticket in ' + wait + 'ms: ' + detail);
    const stale: webSocket.WebSocket | undefined = this.dataSocket;
    this.dataSocket = undefined;
    this.dataReady = false;
    this.connectionId = undefined;
    if (stale !== undefined) {
      try {
        this.closeSocket(stale);
      } catch (e) {
      }
    }
    setTimeout(() => {
      if (this.notifiedClosed) {
        return;
      }
      const payload: Record<string, Object> = {
        'hostDeviceId': this.options.targetDeviceId,
        'preferredTransports': this.options.preferredTransports
      };
      try {
        this.sendControl('connect.request', payload);
      } catch (error) {
        this.fail(new Error('relay reconnect request failed'));
      }
    }, wait);
  }

  private openDataSocket(relayEndpoint: string, relayTicket: string, relayEpoch: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.dataAttachResolve = resolve;
      this.dataAttachReject = reject;
      const ws = webSocket.createWebSocket();
      this.dataSocket = ws;
      const timer = setTimeout(() => {
        this.dataAttachResolve = undefined;
        this.dataAttachReject = undefined;
        reject(new Error('Relay data attach timed out'));
        this.closeSocket(ws);
      }, this.options.handshakeTimeoutMs);
      ws.on('open', (err: Error, value: Object) => {
        const connectionId: string = this.connectionId !== undefined ? this.connectionId : '';
        const attachPayload: Record<string, Object> = {
          'connectionId': connectionId,
          'deviceId': this.options.deviceId,
          'peerDeviceId': this.options.targetDeviceId,
          'ticket': relayTicket
        };
        try {
          ws.send(buildRelayDataFrameJson('relay.attach', attachPayload), (err2: Error, value2: boolean) => {
          });
        } catch (e) {
          clearTimeout(timer);
          reject(new Error('relay attach send failed'));
        }
      });
      ws.on('message', (err: Error, value: string | ArrayBuffer) => {
        if (typeof value !== 'string') {
          return;
        }
        try {
          const frame = parseFrame(value);
          logInfo('relay data frame type=' + frame.type);
          if (frame.type === 'relay.ready') {
            const readyConn = jsonStr(frame.payload, 'connectionId', '');
            if (readyConn !== this.connectionId) {
              throw new Error('Relay data attach assignment mismatch');
            }
            if (relayEpoch >= 0) {
              const epoch = jsonNum(frame.payload, 'epoch', -1);
              if (epoch !== relayEpoch) {
                throw new Error('Relay data attach assignment mismatch');
              }
            }
            clearTimeout(timer);
            this.dataAttachResolve = undefined;
            this.dataAttachReject = undefined;
            this.dataReady = true;
            logInfo('relay.ready epoch=' + relayEpoch + ' conn=' + this.connectionId);
            resolve();
            return;
          }
          this.handleDataSocketFrame(frame);
        } catch (e) {
          this.fail(e instanceof Error ? e : new Error('Invalid Relay data frame'));
        }
      });
      ws.on('error', (err: Error) => {
        clearTimeout(timer);
        const detail: string = err instanceof Error ? err.message : 'unknown';
        logError('relay data socket error: ' + detail);
        reject(new Error('Relay data socket failed: ' + detail));
      });
      ws.on('close', (err: Error, value: webSocket.CloseResult) => {
        clearTimeout(timer);
        logWarn('relay data socket closed code=' + value.code + ' reason=' + value.reason
          + ' ready=' + this.dataReady);
        if (!this.dataReady) {
          reject(new Error(describeAttachFailure(value.code, value.reason)));
        } else {
          this.fail(new Error('Relay data socket closed'));
        }
      });
      ws.connect(relayEndpoint, (err: Error, value: boolean) => {
        if (err) {
          clearTimeout(timer);
          const detail: string = err instanceof Error ? err.message : 'unknown';
          logError('relay data socket connect failed: ' + detail + ' url=' + relayEndpoint);
          reject(new Error('Relay data socket connect failed: ' + detail));
        } else {
          logInfo('relay data socket connected url=' + relayEndpoint);
        }
      });
    });
  }

  private handleDataSocketFrame(frame: ParsedFrame): void {
    if (frame.type === 'relay.detach') {
      this.fail(new Error('Relay peer detached'));
      return;
    }
    if (frame.type === 'ping') {
      const ws = this.dataSocket;
      if (ws !== undefined) {
        try {
          ws.send(buildRelayDataFrameJson('pong', frame.payload), (err: Error, value: boolean) => {
          });
        } catch (e) {
        }
      }
      return;
    }
    if (frame.type === 'relay') {
      this.handleRelayPayload(frame.payload);
      return;
    }
    if (frame.type === 'secure.handshake') {
      this.handleHandshakePayload(frame.payload);
    }
  }

  private handleControlClose(): void {
    logWarn('control socket closed readiness=' + (this.connectReject !== undefined ? 'pending' : 'ready'));
    if (this.connectReject !== undefined) {
      this.fail(new Error('Relay control channel closed before it was ready'));
      return;
    }
    this.socket = undefined;
    this.connectionId = undefined;
    this.notifyClosed();
  }

  private finishConnect(): void {
    this.clearHandshakeTimer();
    // 主机只有在收到 transport.selected 之后才会 resumePendingHandshake（启动 Noise responder），
    // 少这一帧时客户端会一直等 msg2，最终表现为“安全握手超时”。
    const connId = this.connectionId;
    if (connId !== undefined) {
      try {
        const selected: Record<string, Object> = {
          'connectionId': connId,
          'targetDeviceId': this.options.targetDeviceId,
          'transport': 'relay'
        };
        this.sendControl('transport.selected', selected);
        logInfo('transport.selected sent transport=relay conn=' + connId);
      } catch (e) {
        logWarn('transport.selected send failed');
      }
    }
    const resolve = this.connectResolve;
    this.connectResolve = undefined;
    this.connectReject = undefined;
    if (resolve !== undefined) {
      resolve();
    }
  }

  private fail(error: Error): void {
    this.clearHandshakeTimer();
    const reject = this.connectReject;
    this.connectResolve = undefined;
    this.connectReject = undefined;
    const dr = this.dataAttachReject;
    this.dataAttachResolve = undefined;
    this.dataAttachReject = undefined;
    if (reject !== undefined) {
      reject(error);
    }
    if (dr !== undefined) {
      dr(error);
    }
    this.closeInternal();
    this.notifyClosed();
  }

  private notifyClosed(): void {
    if (this.notifiedClosed) {
      return;
    }
    this.notifiedClosed = true;
    const cb = this.onClosed;
    if (cb !== undefined) {
      cb();
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== -1) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = -1;
    }
  }

  private closeInternal(): void {
    const ds = this.dataSocket;
    this.dataSocket = undefined;
    this.dataReady = false;
    this.dataAttachResolve = undefined;
    this.dataAttachReject = undefined;
    if (ds !== undefined) {
      this.closeSocket(ds);
    }
    const cs = this.socket;
    this.socket = undefined;
    this.connectionId = undefined;
    if (cs !== undefined) {
      this.closeSocket(cs);
    }
  }

  private closeSocket(ws: webSocket.WebSocket): void {
    try {
      ws.off('open');
      ws.off('message');
      ws.off('close');
      ws.off('error');
      ws.close((err: Error, value: boolean) => {
      });
    } catch (e) {
    }
  }
}
