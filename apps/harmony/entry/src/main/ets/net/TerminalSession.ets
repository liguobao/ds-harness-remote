import { randomId } from '../crypto/Bytes';
import { util } from '@kit.ArkTS';
import { asArray, asRecord, jsonStr } from '../protocol/Types';
import { RemoteGateway, RemoteGatewayStream, StreamHandler } from './RemoteGateway';

export class TerminalInfo {
  id: string = '';
  title: string = '';
}

export class TerminalDimensions {
  cols: number = 80;
  rows: number = 24;
}

function terminalInfo(value: Object): TerminalInfo {
  const record = asRecord(value);
  const id = record === undefined ? '' : jsonStr(record, 'id', '');
  if (record === undefined || id.length === 0) {
    throw new Error('INVALID_TERMINAL');
  }
  const terminal = new TerminalInfo();
  terminal.id = id;
  const shell = asRecord(record['shell']);
  terminal.title = shell === undefined ? jsonStr(record, 'title', 'Terminal')
    : jsonStr(shell, 'name', jsonStr(record, 'title', 'Terminal'));
  return terminal;
}

/** Official Session Terminal endpoints over the authenticated Typert carrier. */
export class TerminalSession {
  private gateway: RemoteGateway;
  private sessionId: string;
  private maxCols: number = 80;
  private maxRows: number = 24;
  private maxInputBytes: number = 0;

  constructor(gateway: RemoteGateway, sessionId: string) {
    this.gateway = gateway;
    this.sessionId = sessionId;
  }

  async load(): Promise<TerminalInfo[]> {
    const environment = asRecord(await this.call('terminal/environment', { 'agentId': this.sessionId }));
    const cols = environment?.['maxCols'];
    const rows = environment?.['maxRows'];
    const bytes = environment?.['maxInputBytes'];
    if (typeof cols !== 'number' || !Number.isSafeInteger(cols) || cols < 1 ||
      typeof rows !== 'number' || !Number.isSafeInteger(rows) || rows < 1 ||
      typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1) {
      throw new Error('INVALID_TERMINAL_ENVIRONMENT');
    }
    this.maxCols = cols;
    this.maxRows = rows;
    this.maxInputBytes = bytes;
    const items = asArray(await this.call('terminal/list', { 'sessionId': this.sessionId }));
    if (items === undefined) {
      throw new Error('INVALID_TERMINAL_LIST');
    }
    return items.map((item: Object) => terminalInfo(item));
  }

  async create(size: TerminalDimensions): Promise<TerminalInfo> {
    const dimensions = this.limit(size);
    const request: Record<string, Object> = {
      'id': randomId(), 'cols': dimensions.cols, 'rows': dimensions.rows
    };
    return terminalInfo(await this.call('terminal/create', { 'agentId': this.sessionId, 'request': request }));
  }

  close(id: string): Promise<Object> {
    return this.call('terminal/close', { 'agentId': this.sessionId, 'id': id });
  }

  attachment(id: string): TerminalAttachment {
    return new TerminalAttachment(this, id, this.maxInputBytes);
  }

  retain(id: string, handler: StreamHandler): Promise<RemoteGatewayStream> {
    const args: Record<string, Object> = { 'sessionId': this.sessionId, 'id': id };
    const payload: Record<string, Object> = { 'args': args };
    return this.gateway.open('terminal/retain', payload, handler);
  }

  follow(id: string, attachmentId: string, handler: StreamHandler): Promise<RemoteGatewayStream> {
    const args: Record<string, Object> = { 'agentId': this.sessionId, 'id': id, 'attachmentId': attachmentId };
    const payload: Record<string, Object> = { 'args': args };
    return this.gateway.open('terminal/follow', payload, handler);
  }

  write(id: string, attachmentId: string, data: string): Promise<Object> {
    return this.call('terminal/write', {
      'agentId': this.sessionId, 'id': id, 'attachmentId': attachmentId, 'data': data
    });
  }

  resize(id: string, attachmentId: string, size: TerminalDimensions): Promise<Object> {
    const dimensions = this.limit(size);
    return this.call('terminal/resize', {
      'agentId': this.sessionId, 'id': id, 'attachmentId': attachmentId,
      'cols': dimensions.cols, 'rows': dimensions.rows
    });
  }

  private limit(size: TerminalDimensions): TerminalDimensions {
    const result = new TerminalDimensions();
    result.cols = Math.min(size.cols, this.maxCols);
    result.rows = Math.min(size.rows, this.maxRows);
    return result;
  }

  private async call(endpoint: string, args: Record<string, Object>): Promise<Object> {
    const payload: Record<string, Object> = { 'args': args };
    const value = await this.gateway.call(endpoint, payload);
    const envelope = asRecord(value);
    if (envelope?.['ok'] === false) {
      throw new Error('TERMINAL_REJECTED');
    }
    return envelope?.['ok'] === true ? envelope['value'] ?? new Object() : value;
  }
}

export class TerminalAttachment {
  private session: TerminalSession;
  private id: string;
  private attachmentId: string = randomId();
  private maxInputBytes: number;
  private retained: RemoteGatewayStream | undefined = undefined;
  private followed: RemoteGatewayStream | undefined = undefined;
  private disposed: boolean = false;
  private writable: boolean = false;
  private sequence: number = -1;
  private snapshotApplied: boolean = false;
  private queuedOutput: number = 0;
  private queuedInput: number = 0;
  private output: Promise<void> = Promise.resolve();
  private input: Promise<void> = Promise.resolve();
  onOutput: (data: string, reset: boolean) => Promise<void> = async () => {};
  onState: (writable: boolean, running: boolean) => void = () => {};
  onFailure: () => void = () => {};

  constructor(session: TerminalSession, id: string, maxInputBytes: number) {
    this.session = session;
    this.id = id;
    this.maxInputBytes = maxInputBytes;
  }

  async open(): Promise<void> {
    const retain = new StreamHandler();
    let acknowledge: (retained: boolean) => void = () => {};
    const ready = new Promise<boolean>((resolve) => { acknowledge = resolve; });
    retain.onFrame = (value: Object) => {
      acknowledge(asRecord(value)?.['type'] === 'retained');
    };
    retain.onClosed = () => {
      acknowledge(false);
      this.fail();
    };
    const deadline = setTimeout(() => { acknowledge(false); }, 10000);
    try {
      const stream = await this.session.retain(this.id, retain);
      if (this.disposed) {
        stream.close(true);
        return;
      }
      this.retained = stream;
      if (!await ready) {
        throw new Error('TERMINAL_NOT_RETAINED');
      }
      if (this.disposed) {
        return;
      }
      const handler = new StreamHandler();
      handler.onFrame = (value: Object) => { this.receive(value); };
      handler.onClosed = () => { this.fail(); };
      const followed = await this.session.follow(this.id, this.attachmentId, handler);
      if (this.disposed) {
        followed.close(true);
        return;
      }
      this.followed = followed;
    } catch {
      this.fail();
    } finally {
      clearTimeout(deadline);
    }
  }

  write(data: string): void {
    const size = util.TextEncoder.create().encodeInto(data).byteLength;
    if (!this.writable || this.disposed || size === 0 ||
      size > this.maxInputBytes || this.queuedInput + size > 65536) {
      return;
    }
    this.queuedInput += size;
    this.input = this.input.then(async () => {
      if (this.writable && !this.disposed) {
        await this.session.write(this.id, this.attachmentId, data);
      }
    }).catch(() => { this.fail(); }).finally(() => { this.queuedInput -= size; });
  }

  resize(size: TerminalDimensions): void {
    if (this.writable && !this.disposed) {
      this.session.resize(this.id, this.attachmentId, size).catch(() => { this.fail(); });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.writable = false;
    this.followed?.close(true);
    this.retained?.close(true);
  }

  private fail(): void {
    if (!this.disposed) {
      this.dispose();
      this.onFailure();
    }
  }

  private receive(value: Object): void {
    const frame = asRecord(value);
    if (this.disposed || frame === undefined) {
      return;
    }
    const type = jsonStr(frame, 'type', '');
    if (type !== 'snapshot' && type !== 'output' && type !== 'state') {
      this.fail();
      return;
    }
    const reset = type === 'snapshot';
    const data = reset ? frame['screen'] : type === 'output' ? frame['data'] : '';
    const seq = frame['sequence'];
    if (type !== 'state' && (!Number.isSafeInteger(seq) || typeof seq !== 'number' || seq < 0
      || typeof data !== 'string' || (reset ? this.sequence >= 0 : (this.sequence < 0 || seq !== this.sequence + 1)))) {
      this.fail();
      return;
    }
    const size = typeof data === 'string' ? data.length * 2 : 0;
    if (this.queuedOutput + size > 1048576) {
      this.fail();
      return;
    }
    this.queuedOutput += size;
    if (typeof seq === 'number' && type !== 'state') {
      this.sequence = seq;
    }
    this.output = this.output.then(async () => {
      if (this.disposed) {
        return;
      }
      if (type !== 'state' && typeof data === 'string') {
        await this.onOutput(data, reset);
        this.snapshotApplied = this.snapshotApplied || reset;
      }
      if (!this.disposed && (reset || type === 'state')) {
        const info = asRecord(frame['info']);
        if (info?.['id'] !== this.id) {
          throw new Error('INVALID_TERMINAL_ID');
        }
        const running = info?.['state'] === 'running';
        this.writable = running && this.snapshotApplied && info?.['controllerId'] === this.attachmentId;
        this.onState(this.writable, running);
      }
    }).catch(() => { this.fail(); }).finally(() => { this.queuedOutput -= size; });
  }
}
