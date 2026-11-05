import { SecureTransport } from './SecureTransport';
import { buildRpcRequestMessage, decodeRemoteMessage } from '../protocol/Protocol';
import { ParsedFrame, jsonStr, jsonValue } from '../protocol/Types';
import { randomId } from '../crypto/Bytes';

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

  rpc(method: string, params: Record<string, Object>, timeoutMs?: number): Promise<Object> {
    const effectiveTimeout: number =
      timeoutMs !== undefined && timeoutMs > 0 ? timeoutMs : this.timeoutMs;
    const requestId: string = randomId();
    return new Promise<Object>((resolve, reject) => {
      const timer: number = setTimeout(() => {
        this.rejectPending(requestId, new RemoteClientError('RPC_TIMEOUT',
          `RPC ${method} timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);
      const pending: PendingCall = {
        method: method,
        resolve: resolve,
        reject: reject,
        timer: timer
      };
      this.pending.set(requestId, pending);
      const sendFuture: Promise<void> = this.transport.send(buildRpcRequestMessage(method, params, requestId));
      sendFuture.catch((error: Error) => {
        this.rejectPending(requestId, new RemoteClientError('CONNECTION_FAILED',
          `RPC ${method} send failed: ${error.message}`));
      });
    });
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
