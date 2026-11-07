import { webSocket } from '@kit.NetworkKit';
import { buildControlFrameJson, buildRelayDataFrameJson, PROTOCOL_VERSION } from '../protocol/Protocol';
import { parseFrame, jsonStr, jsonNum, jsonValue, jsonStrArr, ParsedFrame } from '../protocol/Types';
import { toBase64Url, fromBase64Url } from '../crypto/Bytes';
import { logInfo, logWarn, logError } from '../util/Log';
import { RtcBridge } from '../services/RtcBridge';

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
  /**
   * LAN-only 直连（实验）：ArkWeb 里的 DataChannel 顶替中继数据面。
   * 拿不到就直接回落 relay，不需要任何开关。
   */
  rtc: RtcBridge | undefined = undefined;
  /** 取 ICE 配置（TURN/STUN）的回调；拿不到就退回 LAN-only。 */
  fetchIceServers: ((connectionId: string) => Promise<string>) | undefined = undefined;
  /** 等 ICE 配置最多等多久，超了就先 LAN-only 开协商。 */
  iceFetchTimeoutMs: number = 2500;
  /**
   * 等 signal.answer 的预算。主机自己的协商超时是 12s，我们取 16s：
   * 实测 12s 时出现过「我们刚放弃、主机 answer 后脚就到」的竞态，白丢一次直连。
   */
  webrtcSignalTimeoutMs: number = 16000;
  /** 收到 answer 之后等 DataChannel 打通的预算（ICE 连通性检查 + DTLS）。 */
  webrtcConnectTimeoutMs: number = 25000;
}

/**
 * 服务器只给一个 relayEndpoint。同一集群里还有 gz-turn / turn 等候选节点。
 *
 * 注意（2026-11-05 实测）：`connect.accepted.relayTicket` 是**绑节点**的，
 * 拿同一张票去 gz-turn / turn.r2049.cn 一律回 `4008 invalid relay ticket claims`。
 * 所以候选列表只用于日志与排障，真正 attach 只打服务端指定的那一台；
 * 那台满了就重新要票再试同一台，别把仅有的两次重试烧在必然被拒的节点上。
 */
export function buildRelayCandidates(endpoint: string): string[] {
  const out: string[] = [];
  // 上次连通的节点优先：服务端按区域分配，但它不知道哪台刚满过
  const preferred: string = hostOfRelay(preferredRelayHost(endpoint));
  if (preferred.length > 0 && preferred !== hostOfRelay(endpoint)) {
    out.push(withHost(endpoint, preferred));
  }
  out.push(endpoint);
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

/** 最近一次 attach 成功的中继 endpoint（同一次 App 运行内记忆）。 */
let lastGoodRelayEndpoint: string = '';

function preferredRelayHost(endpoint: string): string {
  return lastGoodRelayEndpoint;
}

function hostOfRelay(endpoint: string): string {
  const match: RegExpMatchArray | null = endpoint.match(/^wss?:\/\/([^/]+)/);
  return match === null ? '' : match[1];
}

function withHost(endpoint: string, host: string): string {
  const match: RegExpMatchArray | null = endpoint.match(/^(wss?:\/\/)([^/]+)(.*)$/);
  if (match === null) {
    return endpoint;
  }
  return match[1] + host + match[3];
}

/** attach 失败的具体原因（带「是否值得重试」），供上层决定要不要换票重来。 */
export class RelayAttachError extends Error {
  retryable: boolean = true;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

/** attach 失败的判词：一句人话 + 还值不值得重试。 */
export class AttachVerdict {
  message: string = '';
  /** false = 再重试也是同样结果（票据/声明对不上），别再烧重试。 */
  retryable: boolean = true;
}

/**
 * 把中继的关闭码翻译成一句人话。
 *
 * 注意 4008 是一个大桶：`relay capacity reached`（节点满）和
 * `invalid relay ticket claims`（票据与这条连接对不上）都报 4008，
 * 以前一律说成「没有可用容量」，看日志的人会被带偏。
 */
export function describeAttachFailure(code: number, reason: string): AttachVerdict {
  const verdict: AttachVerdict = new AttachVerdict();
  const text: string = reason.toLowerCase();
  if (code === 4008) {
    if (text.indexOf('capacity') >= 0) {
      verdict.message = '中继节点已满（4008 ' + reason + '），稍后重试；持续这样需要服务端给中继扩容';
      verdict.retryable = true;
      return verdict;
    }
    if (text.indexOf('ticket') >= 0 || text.indexOf('claim') >= 0) {
      verdict.message = '中继票据校验失败（4008 ' + reason + '）：票据和这条连接对不上，重连一次即可';
      verdict.retryable = false;
      return verdict;
    }
    verdict.message = '中继拒绝了这次连接（4008 ' + reason + '）';
    verdict.retryable = false;
    return verdict;
  }
  if (code === 4001 || code === 4003) {
    verdict.message = '中继票据已失效（' + code + ' ' + reason + '），重新连接即可';
    verdict.retryable = false;
    return verdict;
  }
  verdict.message = '中继连接失败（' + code + ' ' + reason + '）';
  return verdict;
}

/** Control 通道关闭的判词：一句人话 + 还值不值得自动重连。 */
export class CloseVerdict {
  /** WebSocket 关闭码；0 表示没拿到（本地主动 close 或对端没发 close 帧）。 */
  code: number = 0;
  reason: string = '';
  message: string = '';
  /**
   * false = 自动重连没有意义（授权失败 / 连接被顶掉 / 未知原因）。
   * protocol.md §22：只有 4001 + CONNECTION_FAILED 这一精确组合可重试。
   */
  stopAutoReconnect: boolean = false;
}

/**
 * 把 Control 通道的关闭码翻译成判词。
 *
 * 之前 ws.on('close') 把 CloseResult 整个丢掉，导致 4003（别的设备登录顶掉本机）
 * 也照样自动重连六次，用户看到的是「一直在重连、连不上、再重连」。
 * 4001 是双语义码：reason 为 CONNECTION_FAILED 才是心跳超时（可重试），其余按授权失败处理。
 */
export function describeControlClose(code: number, reason: string): CloseVerdict {
  const verdict: CloseVerdict = new CloseVerdict();
  verdict.code = code;
  verdict.reason = reason;
  const text: string = reason.toLowerCase();
  if (code === 4003) {
    verdict.message = '该主机已在其他设备上建立连接，本机已断开';
    verdict.stopAutoReconnect = true;
    return verdict;
  }
  if (code === 4001) {
    if (text.length === 0 || text.indexOf('connection_failed') >= 0) {
      verdict.message = '心跳超时，正在重新连接';
      return verdict;
    }
    verdict.message = '服务器拒绝了本次连接（4001 ' + reason + '），请重新登录后再试';
    verdict.stopAutoReconnect = true;
    return verdict;
  }
  if (code === 1000) {
    verdict.message = '连接已被服务器正常关闭';
    verdict.stopAutoReconnect = true;
    return verdict;
  }
  if (code === 1001) {
    verdict.message = '服务器正在重启，稍后自动重连';
    return verdict;
  }
  if (code === 1006) {
    verdict.message = '网络中断，连接被异常关闭';
    return verdict;
  }
  // 未知关闭码：协议要求停止自动恢复，交回用户手动重连
  verdict.message = code > 0
    ? '连接被服务器关闭（' + code + (reason.length > 0 ? ' ' + reason : '') + '）'
    : '连接已断开';
  verdict.stopAutoReconnect = true;
  return verdict;
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
  /** '' 未定 | 'relay' | 'lan' —— 决定数据帧往哪条路走。 */
  private dataMode: string = '';
  private rtcSignalTimer: number = -1;
  private rtcConnectTimer: number = -1;
  private rtcLocalCandidates: number = 0;
  /** 已经因为 WebRTC 失败回落过一次，避免来回抖。 */
  private rtcAttempted: boolean = false;
  /** DataChannel 实际选中的路径：'lan' | 'p2p' | 'turn'。 */
  private rtcTransport: string = '';
  /** 断开时的判词（含关闭码与「是否值得自动重连」），上层在 onClosed 之后读它。 */
  public closeVerdict: CloseVerdict | undefined = undefined;
  /** 最近一次收到服务器任何控制帧的时刻：链路还活着的唯一证据。 */
  private lastInboundAt: number = 0;
  /** 服务器 hello.ack 下发的心跳间隔（拿不到就用协议默认 25s）。 */
  private serverHeartbeatMs: number = 25000;
  private linkTimer: number = -1;
  private suspectLogged: boolean = false;

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
    this.closeVerdict = undefined;
    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      const ws = webSocket.createWebSocket();
      this.socket = ws;
      ws.on('open', (err: Error, value: Object) => {
        logInfo('control socket open ' + this.url);
        // 握手预算从 socket 打开才开始算：拨号本身慢（弱网/跨网）不该吃掉等 hello 的时间
        if (this.handshakeTimer === -1) {
          this.handshakeTimer = setTimeout(() => {
            this.fail(new Error('Relay control handshake timed out'));
          }, this.options.handshakeTimeoutMs);
        }
        this.startLinkWatchdog();
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
        this.handleControlClose(value);
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
    if (this.dataMode === 'lan') {
      // 直连数据面：Noise 密文直接进 DataChannel（分块在页面里做）
      const rtc = this.options.rtc;
      if (rtc === undefined) {
        throw new Error('webrtc bridge is gone');
      }
      this.relayCounter += 1;
      rtc.send(toBase64Url(data));
      return Promise.resolve();
    }
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

  /** 'lan' | 'p2p' | 'turn' | 'relay'（未连上时为空串）。 */
  transportKind(): string {
    if (this.dataMode === 'lan') {
      return this.rtcTransport.length > 0 ? this.rtcTransport : 'lan';
    }
    return this.dataMode;
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
      this.markLinkAlive();
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
      // WebRTC 信令只在 Control WS 上（协议 §14）
      if (frame.type === 'signal.answer') {
        const payload = frame.payload;
        const sdp: string = jsonStr(payload, 'sdp', '');
        const rtc = this.options.rtc;
        if (this.dataMode === 'relay') {
          // 已经回落到中继：peer 已关，迟到的 answer 只能丢掉（下次连接会重新协商）
          logInfo('webrtc: 忽略迟到的 signal.answer（已回落中继）');
          return;
        }
        if (rtc !== undefined && sdp.length > 0) {
          logInfo('webrtc: signal.answer 收到 len=' + sdp.length + '，等 DataChannel');
          this.clearRtcSignalTimer();
          if (this.rtcConnectTimer === -1) {
            this.rtcConnectTimer = setTimeout(() => {
              this.fallBackToRelay('DataChannel 没打通（' + this.options.webrtcConnectTimeoutMs + 'ms）');
            }, this.options.webrtcConnectTimeoutMs);
          }
          rtc.applyAnswer(sdp);
        }
        return;
      }
      if (frame.type === 'signal.ice') {
        const payload = frame.payload;
        const candidate: Object | undefined = payload['candidate'];
        const rtc = this.options.rtc;
        if (this.dataMode === 'relay') {
          return;
        }
        if (rtc !== undefined && candidate !== undefined && candidate !== null) {
          rtc.addRemoteIce(JSON.stringify(candidate));
        }
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
    // 服务端下发了心跳节奏就按它算静默预算：默认 25s 一跳，75s 没帧才判死。
    const heartbeat: number = jsonNum(frame.payload, 'heartbeatIntervalMs', 25000);
    if (heartbeat > 0) {
      this.serverHeartbeatMs = heartbeat;
      // 与 onLinkTick 的算法保持一致：判死预算 = max(3×心跳, 90s)
      const deadBudget: number = Math.max(heartbeat * 3, 90000);
      logInfo('link heartbeat budget interval=' + heartbeat + 'ms dead=' + deadBudget + 'ms');
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
        logInfo('relay candidates (仅排障参考，票据不通用): ' + this.relayCandidates.join(' , '));
      }
      // 先试 LAN 直连：成功就不用中继的数据面（中继节点满容量时这是唯一活路）
      if (this.startRtcAttempt()) {
        return;
      }
      this.attachRelayData(relayEndpoint, relayTicket, relayEpoch);
    } else {
      this.finishConnect('relay');
    }
  }

  /** 走中继数据面（原有的 attach + 换票重试逻辑）。 */
  private attachRelayData(relayEndpoint: string, relayTicket: string, relayEpoch: number): void {
    this.dataMode = 'relay';
    this.openDataSocket(relayEndpoint, relayTicket, relayEpoch)
      .then(() => {
        this.attachAttempt = 0;
        this.finishConnect('relay');
      })
      .catch((e: Error) => {
        // 把底层原因带出来，否则线上只能看到笼统的 attach failed
        const detail: string = e instanceof Error ? e.message : String(e);
        logError('relay data attach failed: ' + detail);
        if (e instanceof RelayAttachError && !e.retryable) {
          // 票据/声明对不上那种，换票重试还是同样的结果：直接报给用户
          logWarn('relay attach 不可重试，放弃重试：' + detail);
          this.fail(new Error('relay data attach failed: ' + detail));
          return;
        }
        this.retryWithFreshTicket(detail);
      });
  }

  /**
   * LAN-only WebRTC：让 ArkWeb 里的 peer 开 offer，信令走 Control WS。
   * 任何一步失败都由超时或 onError 兜底回落到中继。
   */
  private startRtcAttempt(): boolean {
    const rtc = this.options.rtc;
    if (rtc === undefined || this.rtcAttempted) {
      return false;
    }
    if (!rtc.isReady()) {
      logInfo('webrtc: 桥还没就绪，直接走中继');
      return false;
    }
    this.rtcAttempted = true;
    const connId = this.connectionId;
    if (connId === undefined) {
      return false;
    }
    logInfo('webrtc: 准备协商 conn=' + connId);
    // 先要 ICE 配置（TURN/STUN）；失败或太慢就 LAN-only，不能因为取票把连接卡住
    let iceSettled: boolean = false;
    const begin = (iceJson: string): void => {
      if (iceSettled) {
        return;
      }
      iceSettled = true;
      this.beginRtc(iceJson.length > 0 ? iceJson : '[]');
    };
    const fetcher = this.options.fetchIceServers;
    if (fetcher === undefined) {
      begin('[]');
    } else {
      fetcher(connId)
        .then((json: string) => begin(json))
        .catch(() => begin('[]'));
      setTimeout(() => {
        if (!iceSettled) {
          logWarn('webrtc: ICE 配置超时，先按 LAN-only 协商');
        }
        begin('[]');
      }, this.options.iceFetchTimeoutMs);
    }
    return true;
  }

  /** 真正开始 RTC 协商：挂回调、开 offer、起信号超时。 */
  private beginRtc(iceJson: string): void {
    const rtc = this.options.rtc;
    if (rtc === undefined || this.notifiedClosed) {
      return;
    }
    if (!rtc.beginOffer(iceJson)) {
      this.fallBackToRelay('桥拒绝开 offer');
      return;
    }
    logInfo('webrtc: 已开 offer（ICE 配置 ' + (iceJson.length > 2 ? '有' : '空，LAN-only') + '）');
    this.rtcSignalTimer = setTimeout(() => {
      this.fallBackToRelay('没等到 signal.answer（' + this.options.webrtcSignalTimeoutMs + 'ms）');
    }, this.options.webrtcSignalTimeoutMs);
    rtc.onLocalSdp = (sdp: string) => {
      try {
        const payload: Record<string, Object> = {
          'connectionId': this.connectionId !== undefined ? this.connectionId : '',
          'targetDeviceId': this.options.targetDeviceId,
          'sdp': sdp
        };
        this.sendControl('signal.offer', payload);
        logInfo('webrtc: signal.offer sent len=' + sdp.length);
      } catch (e) {
        this.fallBackToRelay('signal.offer 发送失败');
      }
    };
    rtc.onIce = (candidateJson: string) => {
      try {
        const candidate: Object = JSON.parse(candidateJson) as Object;
        const payload: Record<string, Object> = {
          'connectionId': this.connectionId !== undefined ? this.connectionId : '',
          'targetDeviceId': this.options.targetDeviceId,
          'candidate': candidate
        };
        this.sendControl('signal.ice', payload);
        this.rtcLocalCandidates += 1;
        if (this.rtcLocalCandidates === 1) {
          logInfo('webrtc: 首个 local candidate 已发出');
        }
      } catch (e) {
        logWarn('webrtc: signal.ice 发送失败');
      }
    };
    rtc.onTransport = (kind: string) => {
      if (kind.length > 0) {
        this.rtcTransport = kind;
      }
    };
    rtc.onDataOpen = () => {
      this.rtcOpened();
    };
    rtc.onDataBinary = (base64: string) => {
      if (this.dataMode !== 'lan') {
        return;
      }
      const cb = this.onMessage;
      if (cb !== undefined) {
        cb(fromBase64Url(base64));
      }
    };
    rtc.onError = (message: string) => {
      logWarn('webrtc: 错误 ' + message);
      this.fallBackToRelay(message);
    };
  }

  /** DataChannel 打开：先发 transport.selected，再让 Noise 握手继续。 */
  private rtcOpened(): void {
    if (this.dataMode === 'lan') {
      return;
    }
    this.clearRtcTimer();
    this.dataMode = 'lan';
    this.dataReady = true;
    // transport.selected 由 finishConnect('lan') 统一发，别发两遍
    const rtc = this.options.rtc;
    if (rtc !== undefined) {
      rtc.onLocalSdp = undefined;
      // onIce 继续挂着：后续 trickle candidate 还要发
    }
    const selected: string = this.rtcTransport.length > 0 ? this.rtcTransport : 'lan';
    logInfo('webrtc: 数据面路径=' + selected);
    this.finishConnect(selected);
  }

  /** WebRTC 没谈成：关掉 peer，回到中继数据面。 */
  private fallBackToRelay(reason: string): void {
    if (this.dataMode === 'lan' || this.notifiedClosed) {
      return;
    }
    if (this.dataMode === 'relay' && this.dataReady) {
      return;
    }
    this.clearRtcTimer();
    const rtc = this.options.rtc;
    if (rtc !== undefined) {
      rtc.onLocalSdp = undefined;
      rtc.onIce = undefined;
      rtc.onDataOpen = undefined;
      rtc.onDataBinary = undefined;
      rtc.onError = undefined;
      rtc.closeAll();
    }
    logWarn('webrtc: 回落中继（' + reason + '），重新要票');
    this.dataMode = '';
    // 重新走一次 connect.request：旧票据可能已经被这次协商占掉
    this.retryWithFreshTicket('webrtc fallback: ' + reason);
  }

  private clearRtcTimer(): void {
    this.clearRtcSignalTimer();
    if (this.rtcConnectTimer !== -1) {
      clearTimeout(this.rtcConnectTimer);
      this.rtcConnectTimer = -1;
    }
  }

  private clearRtcSignalTimer(): void {
    if (this.rtcSignalTimer !== -1) {
      clearTimeout(this.rtcSignalTimer);
      this.rtcSignalTimer = -1;
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
            lastGoodRelayEndpoint = relayEndpoint;
            logInfo('relay.ready epoch=' + relayEpoch + ' conn=' + this.connectionId
              + ' host=' + hostOfRelay(relayEndpoint));
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
          const verdict: AttachVerdict = describeAttachFailure(value.code, value.reason);
          reject(new RelayAttachError(verdict.message, verdict.retryable));
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
    // 数据面也有服务器帧（ping / relay），同样算链路活着的证据：
    // 只看控制通道会在「控制静默但数据还在流」时误判断线。
    this.markLinkAlive();
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

  /**
   * 收到 CloseResult 才能分辨「该不该自动重连」。
   * 这里只做判定与记录，真正的恢复策略在上层（AppRuntime.handleDisconnect）。
   */
  private handleControlClose(result: webSocket.CloseResult | undefined): void {
    const code: number = result !== undefined && typeof result.code === 'number' ? result.code : 0;
    const reason: string = result !== undefined && typeof result.reason === 'string' ? result.reason : '';
    const verdict: CloseVerdict = describeControlClose(code, reason);
    this.closeVerdict = verdict;
    logWarn('link close code=' + code + ' reason=' + (reason.length > 0 ? reason : '-')
      + ' stop=' + verdict.stopAutoReconnect
      + ' readiness=' + (this.connectReject !== undefined ? 'pending' : 'ready'));
    if (this.connectReject !== undefined) {
      this.fail(new Error(verdict.message));
      return;
    }
    this.stopLinkWatchdog();
    this.socket = undefined;
    this.connectionId = undefined;
    this.notifyClosed();
  }

  /**
   * 心跳看门狗：判断「链路还活着」的唯一可靠依据是**收到服务器帧**。
   *
   * 客户端不主动发 ping（协议里 Control 心跳由服务端驱动：25s 一跳，服务端 75s
   * 收不到 pong 就主动断开）。所以这里不改协议，只做静默检测：
   * 超过 2 个心跳周期标记可疑（只记日志，不拆连接），超过 3 个周期判死。
   * 判死阈值取 max(3×心跳, 90s)，留出比服务端 75s 更宽的余量，避免抢在服务端
   * 前面误杀健康连接——这条看门狗只负责兜住「close 帧永远到不了」的半开链路。
   */
  private startLinkWatchdog(): void {
    this.stopLinkWatchdog();
    this.lastInboundAt = Date.now();
    this.suspectLogged = false;
    this.linkTimer = setInterval(() => {
      this.onLinkTick();
    }, 5000);
  }

  private onLinkTick(): void {
    if (this.lastInboundAt <= 0) {
      return;
    }
    const interval: number = this.serverHeartbeatMs > 0 ? this.serverHeartbeatMs : 25000;
    const age: number = Date.now() - this.lastInboundAt;
    const suspectAfter: number = Math.max(interval * 2, 40000);
    const deadAfter: number = Math.max(interval * 3, 90000);
    if (age >= deadAfter) {
      logWarn('link state=dead silence=' + age + 'ms budget=' + deadAfter
        + 'ms transport=' + this.transportKind());
      // 给上层一句人话：断线文案由 AppRuntime 直接展示，别再是笼统的「连接已断开」。
      const verdict: CloseVerdict = new CloseVerdict();
      verdict.code = 0;
      verdict.reason = 'link-silent';
      verdict.message = '链路静默 ' + Math.round(age / 1000) + ' 秒，连接已断开';
      this.closeVerdict = verdict;
      this.fail(new Error(verdict.message));
      return;
    }
    if (age >= suspectAfter && !this.suspectLogged) {
      this.suspectLogged = true;
      logWarn('link state=suspect silence=' + age + 'ms budget=' + deadAfter
        + 'ms transport=' + this.transportKind());
    }
  }

  /** 服务端在 `hello.ack` 里给的心跳间隔（毫秒）；没读到返回 0。 */
  heartbeatIntervalMs(): number {
    return this.serverHeartbeatMs;
  }

  /** 距离上一帧服务器数据过了多久（毫秒）；从没收到过返回 -1。 */
  silenceMs(): number {
    if (this.lastInboundAt <= 0) {
      return -1;
    }
    return Date.now() - this.lastInboundAt;
  }

  /** 任何一帧服务器数据都算链路活着的证据。 */
  private markLinkAlive(): void {
    const wasSuspect: boolean = this.suspectLogged;
    this.lastInboundAt = Date.now();
    this.suspectLogged = false;
    if (wasSuspect) {
      logInfo('link state=healthy silence reset transport=' + this.transportKind());
    }
  }

  /**
   * 立刻做一次链路体检：回前台、网络刚恢复时由上层调用。
   * 静默已经超预算就直接判死（走统一断线重连），否则什么也不做。
   */
  recheckLink(): void {
    if (this.socket === undefined) {
      return;
    }
    this.onLinkTick();
  }

  /** 距离上一帧服务器数据的毫秒数；-1 表示还没有可用样本。 */
  linkSilenceMs(): number {
    return this.lastInboundAt > 0 ? Date.now() - this.lastInboundAt : -1;
  }

  private stopLinkWatchdog(): void {
    if (this.linkTimer !== -1) {
      clearInterval(this.linkTimer);
      this.linkTimer = -1;
    }
  }

  private finishConnect(mode: string): void {
    this.clearHandshakeTimer();
    // dataMode 是「数据面现在走哪条路」的唯一真相：之前只在这里发 transport.selected 却不赋值，
    // 走 else 分支（直接中继）时 dataMode 一直是空串 —— 传输徽标和诊断都显示空，
    // 而且迟到的 signal.answer 不会被「已回落中继」那条判断拦下，会把已关的 peer 再救活。
    if (mode.length > 0) {
      this.dataMode = mode;
    }
    // 主机只有在收到 transport.selected 之后才会 resumePendingHandshake（启动 Noise responder），
    // 少这一帧时客户端会一直等 msg2，最终表现为“安全握手超时”。
    const connId = this.connectionId;
    if (connId !== undefined) {
      try {
        const selected: Record<string, Object> = {
          'connectionId': connId,
          'targetDeviceId': this.options.targetDeviceId,
          'transport': mode
        };
        this.sendControl('transport.selected', selected);
        logInfo('transport.selected sent transport=' + mode + ' conn=' + connId);
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
    this.clearRtcTimer();
    if (this.dataMode === 'lan') {
      const rtc = this.options.rtc;
      if (rtc !== undefined) {
        rtc.closeAll();
      }
    }
    this.dataMode = '';
    this.stopLinkWatchdog();
    this.lastInboundAt = 0;
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
