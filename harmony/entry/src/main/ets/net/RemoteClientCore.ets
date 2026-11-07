import { SecureTransport } from './SecureTransport';
import { buildRpcRequestMessage, decodeRemoteMessage } from '../protocol/Protocol';
import { ParsedFrame, jsonStr, jsonValue } from '../protocol/Types';
import { randomId } from '../crypto/Bytes';
import { NetTrace } from '../util/NetTrace';
import { logInfo } from '../util/Log';

/** Wire-protocol level error raised by RemoteClientCore. */
export class RemoteClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** One `event` message decoded from the authenticated channel. */
export class RemoteEvent {
  seq: number = -1;
  event: string = '';
  sessionId: string = '';
  data: Object | undefined = undefined;
}

interface PendingCall {
  method: string;
  resolve: (value: Object) => void;
  reject: (error: RemoteClientError) => void;
  timer: number;
}

/**
 * RPC multiplexer over the Noise-authenticated transport.
 *
 * Wire format (DSH-REMOTE v1 secure messages):
 *   rpc.request  { id, type: 'rpc.request', payload: { method, params } }
 *   rpc.response { id, type: 'rpc.response', payload: { requestId, result } }
 *   rpc.error    { id, type: 'rpc.error', payload: { requestId, code, message } }
 *   event        { id, type: 'event', payload: { seq?, event, sessionId?, data } }
 */
export class RemoteClientCore {
  private transport: SecureTransport;
  private timeoutMs: number;
  private pending: Map<string, PendingCall> = new Map();
  private eventHandlers: ((event: RemoteEvent) => void)[] = [];
  private closeHandlers: ((error: Error | undefined) => void)[] = [];
  private closeNotified: boolean = false;
  private connected: boolean = false;

  constructor(transport: SecureTransport, timeoutMs: number = 30000) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.closeNotified = false;
    this.transport.setMessageHandler((data: Uint8Array) => {
      this.handleMessage(data);
    });
    this.transport.onClosed = () => {
      this.handleTransportClose();
    };
    await this.transport.connect();
    this.connected = true;
  }

  /**
   * One RPC round trip. `traceLabel` 是打点用的标签（上层传 endpoint 名），
   * 缺省就用 method：'harness.remote.call' 这个外号对排障没意义。
   */
  rpc(method: string, params: Record<string, Object>, timeoutMs?: number,
    traceLabel?: string): Promise<Object> {
    const startedAt: number = Date.now();
    const label: string = traceLabel !== undefined && traceLabel.length > 0 ? traceLabel : method;
    const effectiveTimeout: number =
      timeoutMs !== undefined && timeoutMs > 0 ? timeoutMs : this.timeoutMs;
    const requestId: string = randomId();
    return new Promise<Object>((resolve, reject) => {
      let sentAt: number = 0;
      let retries: number = 0;
      let finished: boolean = false;
      // 打点把「发出花了多久（含授权重发等待）」和「主机多久才回」分开记：
      // 前者大说明是链路授权窗口在拖，后者大说明是主机在算——收紧预算的位置不一样。
      const finish = (ok: boolean, detail: string): void => {
        if (finished) {
          return;
        }
        finished = true;
        const now: number = Date.now();
        const wait: string = sentAt > 0
          ? '发出 ' + (sentAt - startedAt) + 'ms · 等回 ' + (now - sentAt) + 'ms'
          : '一直没发出';
        NetTrace.record(label + (ok ? '' : ' ✗'), now - startedAt,
          wait + ' · 重发 ' + retries + (detail.length > 0 ? ' · ' + detail : ''), retries > 0);
      };
      const timer: number = setTimeout(() => {
        finish(false, '超时');
        this.rejectPending(requestId, new RemoteClientError('RPC_TIMEOUT',
          `RPC ${method} timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);
      const pending: PendingCall = {
        method: method,
        resolve: (value: Object) => {
          finish(true, '');
          resolve(value);
        },
        reject: (error: RemoteClientError) => {
          finish(false, error.code);
          reject(error);
        },
        timer: timer
      };
      this.pending.set(requestId, pending);
      // 中继刚 attach/换票、或重连间隙里 connectionId 还没就位时，send 会抛
      // 「relay connection has not been authorized」。这不是业务失败，等一小会儿重发同一帧即可；
      // 以前直接把它抛给上层，用户看到的就是「会话列表加载失败：… relay connection has not been authorized」。
      const message: Object = buildRpcRequestMessage(method, params, requestId);
      this.sendWithAuthRetry(message, (usedRetries: number) => {
        sentAt = Date.now();
        retries = usedRetries;
      }).catch((error: Error) => {
        finish(false, 'send failed');
        this.rejectPending(requestId, new RemoteClientError('CONNECTION_FAILED',
          `RPC ${method} send failed: ${error.message}`));
      });
    });
  }

  /**
   * 发送一帧 RPC；传输层「还没授权」时最多等 3 次（250ms 间隔）再重发。
   * 只在明文同一帧上重发，不会重复业务请求（requestId 不变，主机按 requestId 去重）。
   * `onSent(用掉的重发次数)` 在真正发出后回调一次，供上层打点。
   */
  private async sendWithAuthRetry(message: Object, onSent: (retries: number) => void): Promise<void> {
    const data: Uint8Array = message as Uint8Array;
    let lastError: Error = new Error('send failed');
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.transport.send(data);
        onSent(attempt);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const text: string = lastError.message.toLowerCase();
        const retriable: boolean = text.indexOf('not been authorized') >= 0
          || text.indexOf('relay connection') >= 0;
        if (!retriable || attempt === 3) {
          throw lastError;
        }
        NetTrace.authRetry();
        logInfo('rpc send: relay 还没授权，等 250ms 重发同一帧（第 ' + (attempt + 1) + '/3 次）');
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
          }, 250);
        });
      }
    }
    throw lastError;
  }

  onEvent(handler: (event: RemoteEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.removeEventHandler(handler);
    };
  }

  private removeEventHandler(handler: (event: RemoteEvent) => void): void {
    const index: number = this.eventHandlers.indexOf(handler);
    if (index >= 0) {
      this.eventHandlers.splice(index, 1);
    }
  }

  onClose(handler: (error: Error | undefined) => void): () => void {
    this.closeHandlers.push(handler);
    return () => {
      this.removeCloseHandler(handler);
    };
  }

  private removeCloseHandler(handler: (error: Error | undefined) => void): void {
    const index: number = this.closeHandlers.indexOf(handler);
    if (index >= 0) {
      this.closeHandlers.splice(index, 1);
    }
  }

  close(): void {
    this.connected = false;
    this.rejectAllPending('CLIENT_CLOSED', 'terminated because the remote client closed');
    this.notifyClose(undefined);
    this.transport.close();
  }

  private handleTransportClose(): void {
    this.connected = false;
    this.rejectAllPending('TRANSPORT_CLOSED', 'terminated because the remote transport closed');
    this.notifyClose(undefined);
  }

  private handleMessage(data: Uint8Array): void {
    let frame: ParsedFrame;
    try {
      frame = decodeRemoteMessage(data);
    } catch (e) {
      return;
    }
    if (frame.type === 'rpc.response') {
      this.handleResponse(frame);
      return;
    }
    if (frame.type === 'rpc.error') {
      this.handleError(frame);
      return;
    }
    if (frame.type === 'event') {
      this.dispatchEvent(frame);
    }
  }

  private handleResponse(frame: ParsedFrame): void {
    const requestId: string = jsonStr(frame.payload, 'requestId', '');
    const result: Object | undefined = jsonValue(frame.payload, 'result');
    const pending: PendingCall | undefined = this.takePending(requestId);
    if (pending === undefined) {
      return;
    }
    pending.resolve(result !== undefined ? result : new Object());
  }

  private handleError(frame: ParsedFrame): void {
    const requestId: string = jsonStr(frame.payload, 'requestId', '');
    const pending: PendingCall | undefined = this.takePending(requestId);
    if (pending === undefined) {
      return;
    }
    const code: string = jsonStr(frame.payload, 'code', 'INTERNAL_ERROR');
    const message: string = jsonStr(frame.payload, 'message', 'The remote request failed.');
    pending.reject(new RemoteClientError(code, message));
  }

  private dispatchEvent(frame: ParsedFrame): void {
    const event: RemoteEvent = new RemoteEvent();
    const seqValue: Object | undefined = frame.payload['seq'];
    if (typeof seqValue === 'number') {
      event.seq = seqValue;
    }
    event.event = jsonStr(frame.payload, 'event', '');
    event.sessionId = jsonStr(frame.payload, 'sessionId', '');
    event.data = jsonValue(frame.payload, 'data');
    const handlers: ((event: RemoteEvent) => void)[] = this.eventHandlers.slice();
    for (const handler of handlers) {
      handler(event);
    }
  }

  private takePending(requestId: string): PendingCall | undefined {
    const pending: PendingCall | undefined = this.pending.get(requestId);
    if (pending === undefined) {
      return undefined;
    }
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    return pending;
  }

  private rejectPending(requestId: string, error: RemoteClientError): void {
    const pending: PendingCall | undefined = this.takePending(requestId);
    if (pending === undefined) {
      return;
    }
    pending.reject(error);
  }

  private rejectAllPending(code: string, detail: string): void {
    this.pending.forEach((pending: PendingCall, key: string) => {
      this.pending.delete(key);
      clearTimeout(pending.timer);
      pending.reject(new RemoteClientError(code, `RPC ${pending.method} ${detail}`));
    });
  }

  private notifyClose(error: Error | undefined): void {
    if (this.closeNotified) {
      return;
    }
    this.closeNotified = true;
    const handlers: ((error: Error | undefined) => void)[] = this.closeHandlers.slice();
    for (const handler of handlers) {
      handler(error);
    }
  }
}
