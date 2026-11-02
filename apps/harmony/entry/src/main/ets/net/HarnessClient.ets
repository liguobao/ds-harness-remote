import { RemoteClientCore } from './RemoteClientCore';
import { logInfo, logWarn } from '../util/Log';
import { RemoteGateway, RemoteGatewayError, RemoteGatewayStream, StreamHandler } from './RemoteGateway';
import { jsonStr, asRecord, asArray, asBool } from '../protocol/Types';

/** One remote Harness session row (`session/list` item). */
export class HarnessRemoteSession {
  sessionId: string = '';
  updatedAt: number = 0;
  running: boolean = false;
  blank: boolean = false;
  title: string = '';
  cwd: string = '';
  turns: number = 0;
  /** Projected context pressure in percent of the context window; 0 when unknown. */
  contextPercent: number = 0;
}

/** One aggregated frame delivered to the UI reducer. */
export class HarnessClientFrame {
  rpcId: string = '';
  payload: Record<string, Object> = {};
}

/** One native Harness session event. */
export class HarnessSessionEvent {
  type: string = '';
  seq: number = 0;
  time: number = 0;
  data: Record<string, Object> = {};
}

export class HarnessHistoryEntry {
  event: HarnessSessionEvent = new HarnessSessionEvent();
}

export class HistoryPage {
  entries: HarnessHistoryEntry[] = [];
  hasMore: boolean = false;
  throughSeq: number = -1;
}

class PendingRemoteEvent {
  event: string = '';
  eventId: string = '';
  sessionId: string = '';
}

class AssistantStreamState {
  attemptId: string = '';
  startedAfterSeq: number = 0;
  turn: number = 0;
  step: number = 0;
  nextIndex: number = 0;
}

/**
 * Remote Harness business client (subset of HarnessAlphaClient): session list,
 * create, prompt, cancel, history paging and the live `session/follow` stream.
 * Aggregated frames flow to `onFrame` for UI reduction.
 */
export class HarnessAlphaClient {
  private core: RemoteClientCore;
  private gateway: RemoteGateway;
  private onFrame: (frame: HarnessClientFrame) => void;
  private hostSessionFormat: number;
  private sessionsCache: Map<string, HarnessRemoteSession> = new Map();
  private followCursors: Map<string, number> = new Map();
  private pendingEvents: Map<string, PendingRemoteEvent> = new Map();
  private eventsStream: RemoteGatewayStream | undefined = undefined;
  private followStream: RemoteGatewayStream | undefined = undefined;
  private assistantState: AssistantStreamState | undefined = undefined;
  private followGeneration: number = 0;
  private eventClientId: string = '';

  constructor(core: RemoteClientCore, hostSessionFormat: number,
    onFrame: (frame: HarnessClientFrame) => void) {
    this.core = core;
    this.gateway = new RemoteGateway(core);
    this.onFrame = onFrame;
    this.hostSessionFormat = hostSessionFormat;
  }

  /** Open the `$events` stream (approval/question waterfalls). */
  async start(): Promise<void> {
    if (this.eventsStream !== undefined) {
      return;
    }
    const handler: StreamHandler = new StreamHandler();
    handler.onFrame = (value: Object) => {
      this.routeEventFrame(value);
    };
    handler.onClosed = (error: RemoteGatewayError | undefined) => {
      this.eventsStream = undefined;
      if (error !== undefined) {
        this.emitStreamFailure(error);
      }
    };
    const args: Record<string, Object> = {};
    const payload: Record<string, Object> = { 'args': args };
    this.eventsStream = await this.gateway.open('$events', payload, handler);
  }

  async close(notifyRemote: boolean): Promise<void> {
    this.followGeneration += 1;
    const follow: RemoteGatewayStream | undefined = this.followStream;
    this.followStream = undefined;
    this.assistantState = undefined;
    const events: RemoteGatewayStream | undefined = this.eventsStream;
    this.eventsStream = undefined;
    if (follow !== undefined) {
      follow.close(notifyRemote);
    }
    if (events !== undefined) {
      events.close(notifyRemote);
    }
    this.pendingEvents.clear();
    this.eventClientId = '';
  }

  async sessionList(timeoutMs?: number): Promise<HarnessRemoteSession[]> {
    const request: Record<string, Object> = {};
    const args: Record<string, Object> = { '_request': request };
    const value: Object = await this.callValue('session/list', args, timeoutMs);
    const root: Record<string, Object> | undefined = asRecord(value);
    const items: Object[] | undefined = root !== undefined ? asArray(root['items']) : undefined;
    const sessions: HarnessRemoteSession[] = [];
    if (items !== undefined) {
      for (const item of items) {
        const session: HarnessRemoteSession | undefined = normalizeSession(item);
        if (session !== undefined) {
          sessions.push(session);
          this.sessionsCache.set(session.sessionId, session);
        }
      }
    }
    logInfo('session/list -> ' + sessions.length + ' item(s)');
    for (const s0 of sessions) { logInfo('  session ' + s0.sessionId + ' blank=' + s0.blank + ' title=' + s0.title); }
    return sessions;
  }

  async sessionCreate(cwd: string): Promise<string> {
    const request: Record<string, Object> = {};
    if (cwd.length > 0) {
      request['cwd'] = cwd;
    }
    const args: Record<string, Object> = { 'request': request };
    const value: Object = await this.callValue('session/create', args);
    const root: Record<string, Object> | undefined = asRecord(value);
    const sessionId: string = root !== undefined ? jsonStr(root, 'sessionId', '') : '';
    logInfo('session/create -> ' + sessionId);
    if (sessionId.length === 0) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid session creation result.');
    }
    return sessionId;
  }

  async sessionPrompt(sessionId: string, text: string, requestId: string): Promise<void> {
    const block: Record<string, Object> = { 'type': 'text', 'text': text };
    const content: Object[] = [block];
    const request: Record<string, Object> = {
      'requestId': requestId,
      'sessionId': sessionId,
      'mode': 'queue',
      'content': content
    };
    const args: Record<string, Object> = { 'request': request };
    await this.callValue('session/prompt', args);
  }

  async sessionCancel(sessionId: string): Promise<void> {
    const request: Record<string, Object> = { 'sessionId': sessionId };
    const args: Record<string, Object> = { 'request': request };
    await this.callValue('session/cancel', args);
  }

  /** Page older history through `session/page` (needs a live follow cursor). */
  async sessionPage(sessionId: string, beforeSeq: number, maxMessages: number): Promise<HistoryPage> {
    const cursor: number | undefined = this.followCursors.get(sessionId);
    const throughSeq: number = cursor !== undefined ? cursor : beforeSeq;
    const address: Record<string, Object> = { 'kind': 'session', 'sessionId': sessionId };
    const request: Record<string, Object> = {
      'address': address,
      'throughSeq': throughSeq,
      'beforeSeq': beforeSeq,
      'maxMessages': maxMessages
    };
    const args: Record<string, Object> = { 'request': request };
    const value: Object = await this.callValue('session/page', args);
    const root: Record<string, Object> | undefined = asRecord(value);
    const records: Object[] | undefined = root !== undefined ? asArray(root['records']) : undefined;
    const page: HistoryPage = new HistoryPage();
    page.entries = records !== undefined ? entriesFromRecords(records) : [];
    page.hasMore = root !== undefined ? asBool(root['hasMore']) === true : false;
    page.throughSeq = throughSeq;
    return page;
  }

  /**
   * Load one session: without `beforeSeq` opens a fresh `session/follow`
   * stream (snapshot + live events); with `beforeSeq` pages older history.
   */
  async sessionHistory(sessionId: string, beforeSeq: number, maxMessages: number): Promise<HistoryPage> {
    if (beforeSeq >= 0) {
      return this.sessionPage(sessionId, beforeSeq, maxMessages);
    }
    const generation: number = ++this.followGeneration;
    await this.closeFollowStream();
    if (generation !== this.followGeneration) {
      throw new RemoteGatewayError('CANCELLED', 'The session follow was superseded.');
    }
    const page: HistoryPage = await this.openFollow(sessionId, maxMessages, generation);
    if (generation !== this.followGeneration) {
      throw new RemoteGatewayError('CANCELLED', 'The session follow was superseded.');
    }
    return page;
  }

  private async openFollow(sessionId: string, maxMessages: number, generation: number): Promise<HistoryPage> {
    logInfo('openFollow sessionId=' + sessionId + ' maxMessages=' + maxMessages);
    let firstFrameResolve: ((value: Object) => void) | undefined = undefined;
    let firstFrameReject: ((error: RemoteGatewayError) => void) | undefined = undefined;
    const firstFrame: Promise<Object> = new Promise<Object>((resolve, reject) => {
      firstFrameResolve = resolve;
      firstFrameReject = reject;
    });
    const handler: StreamHandler = new StreamHandler();
    handler.onFrame = (value: Object) => {
      const resolveFirst: ((value: Object) => void) | undefined = firstFrameResolve;
      if (resolveFirst !== undefined) {
        firstFrameResolve = undefined;
        firstFrameReject = undefined;
        resolveFirst(value);
        return;
      }
      if (this.followGeneration !== generation) {
        return;
      }
      for (const entry of this.entriesFromFollowFrame(value)) {
        const payload: Record<string, Object> = {
          'type': 'session/event',
          'sessionId': sessionId,
          'event': entry.event
        };
        this.emitFrame('', payload);
      }
    };
    handler.onClosed = (error: RemoteGatewayError | undefined) => {
      if (this.followStream !== undefined && this.followStream.isClosed()) {
        this.followStream = undefined;
      }
      const rejectFirst: ((error: RemoteGatewayError) => void) | undefined = firstFrameReject;
      if (rejectFirst !== undefined) {
        firstFrameResolve = undefined;
        firstFrameReject = undefined;
        rejectFirst(error !== undefined ? error
          : new RemoteGatewayError('CANCELLED', 'The session follow closed.'));
        return;
      }
      if (error !== undefined) {
        this.emitStreamFailure(error);
      }
    };
    const address: Record<string, Object> = { 'kind': 'session', 'sessionId': sessionId };
    const request: Record<string, Object> = {
      'address': address,
      'maxMessages': maxMessages
    };
    // The Host gateway requires the Typert argument envelope { args: { request } };
    // `assistantStream` is a response-side snapshot field, never a request flag.
    const inner: Record<string, Object> = { 'request': request };
    const payload: Record<string, Object> = { 'args': inner };
    const stream: RemoteGatewayStream = await this.gateway.open('session/follow', payload, handler);
    if (generation !== this.followGeneration) {
      stream.close(false);
      throw new RemoteGatewayError('CANCELLED', 'The session follow was superseded.');
    }
    this.followStream = stream;
    const first: Object = await withTimeout(firstFrame, 25000);
    if (generation !== this.followGeneration) {
      throw new RemoteGatewayError('CANCELLED', 'The session follow was superseded.');
    }
    const snapshot: Record<string, Object> | undefined = asRecord(first);
    if (snapshot === undefined || jsonStr(snapshot, 'type', '') !== 'snapshot') {
      await this.closeFollowStream();
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid session follow snapshot.');
    }
    const cursorRaw: Object | undefined = snapshot['cursor'];
    if (typeof cursorRaw === 'number') {
      this.followCursors.set(sessionId, cursorRaw);
    }
    if (this.hostSessionFormat === 3) {
      this.assistantState = assistantStreamBaseline(snapshot['assistantStream']);
    }
    const records: Object[] | undefined = asArray(snapshot['records']);
    const page: HistoryPage = new HistoryPage();
    page.entries = records !== undefined ? entriesFromRecords(records) : [];
    page.hasMore = asBool(snapshot['hasMore']) === true;
    if (typeof cursorRaw === 'number') {
      page.throughSeq = cursorRaw;
    }
    return page;
  }

  /** Answer an `approval/requested` frame ('allowed-once' | 'rejected'). */
  async respondApproval(frameRpcId: string, sessionId: string, approvalId: string, outcome: string): Promise<void> {
    const eventId: string = this.pendingEvents.has(frameRpcId) ? frameRpcId : approvalId;
    await this.respondEvent(eventId, outcome);
    this.pendingEvents.delete(eventId);
    const payload: Record<string, Object> = {
      'type': 'approval/resolved',
      'sessionId': sessionId,
      'approvalId': approvalId,
      'outcome': outcome
    };
    this.emitFrame('', payload);
  }

  /** Answer a `question/requested` frame with `{answers:[{id,selected,custom?}]}`. */
  async respondQuestion(frameRpcId: string, sessionId: string, answer: Record<string, Object>): Promise<void> {
    await this.respondEvent(frameRpcId, answer);
    this.pendingEvents.delete(frameRpcId);
    const payload: Record<string, Object> = {
      'type': 'question/resolved',
      'sessionId': sessionId,
      'questionRpcId': frameRpcId,
      'outcome': 'answered'
    };
    this.emitFrame('', payload);
  }

  private async respondEvent(eventId: string, value: Object): Promise<void> {
    if (this.eventClientId.length === 0) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host event stream is not ready.');
    }
    const outcome: Record<string, Object> = {
      'kind': 'result',
      'value': value
    };
    const args: Record<string, Object> = {
      'clientId': this.eventClientId,
      'eventId': eventId,
      'outcome': outcome
    };
    const payload: Record<string, Object> = { 'args': args };
    await this.gateway.call('$events/result', payload);
  }

  private async callValue(endpoint: string, args: Record<string, Object>, timeoutMs?: number): Promise<Object> {
    const payload: Record<string, Object> = { 'args': args };
    const value: Object = await this.gateway.call(endpoint, payload, timeoutMs);
    const root: Record<string, Object> | undefined = asRecord(value);
    if (root !== undefined) {
      const okValue: Object | undefined = root['ok'];
      if (okValue === true) {
        const inner: Object | undefined = root['value'];
        return inner !== undefined ? inner : new Object();
      }
      if (okValue === false) {
        const error: Record<string, Object> | undefined = asRecord(root['error']);
        if (error !== undefined) {
          throw new RemoteGatewayError(
            jsonStr(error, 'code', 'internal'),
            jsonStr(error, 'message', 'The Host rejected the Remote request.'));
        }
      }
    }
    return value;
  }

  private routeEventFrame(value: Object): void {
    const root: Record<string, Object> | undefined = asRecord(value);
    if (root === undefined) {
      return;
    }
    const type: string = jsonStr(root, 'type', '');
    if (type === 'ready') {
      this.eventClientId = jsonStr(root, 'clientId', '');
      return;
    }
    if (type === 'waterfall') {
      const eventId: string = jsonStr(root, 'eventId', '');
      const agentId: string = jsonStr(root, 'agentId', '');
      const event: string = jsonStr(root, 'event', '');
      const request: Record<string, Object> | undefined = asRecord(root['request']);
      if (eventId.length > 0 && agentId.length > 0 && request !== undefined) {
        this.routeWaterfall(event, eventId, agentId, request);
      }
      return;
    }
    if (type === 'cancel') {
      const eventId: string = jsonStr(root, 'eventId', '');
      if (eventId.length > 0) {
        this.cancelRemoteEvent(eventId);
      }
    }
  }

  private routeWaterfall(event: string, eventId: string, sessionId: string,
    request: Record<string, Object>): void {
    if (event === 'approval/request') {
      const pending: PendingRemoteEvent = new PendingRemoteEvent();
      pending.event = event;
      pending.eventId = eventId;
      pending.sessionId = sessionId;
      this.pendingEvents.set(eventId, pending);
      const payload: Record<string, Object> = {
        'type': 'approval/requested',
        'sessionId': sessionId,
        'approvalId': eventId,
        'toolName': jsonStr(request, 'toolName', 'Harness tool')
      };
      const callId: string = jsonStr(request, 'callId', '');
      if (callId.length > 0) {
        payload['callId'] = callId;
      }
      const reason: string = jsonStr(request, 'reason', '');
      if (reason.length > 0) {
        payload['reason'] = reason;
      }
      this.emitFrame(eventId, payload);
      return;
    }
    if (event === 'user-questions/request') {
      const pending: PendingRemoteEvent = new PendingRemoteEvent();
      pending.event = event;
      pending.eventId = eventId;
      pending.sessionId = sessionId;
      this.pendingEvents.set(eventId, pending);
      const questions: Object | undefined = request['questions'];
      const payload: Record<string, Object> = {
        'type': 'question/requested',
        'sessionId': sessionId,
        'questions': questions !== undefined ? questions : []
      };
      this.emitFrame(eventId, payload);
    }
  }

  private cancelRemoteEvent(eventId: string): void {
    const pending: PendingRemoteEvent | undefined = this.pendingEvents.get(eventId);
    if (pending === undefined) {
      return;
    }
    this.pendingEvents.delete(eventId);
    if (pending.event === 'approval/request') {
      const payload: Record<string, Object> = {
        'type': 'approval/resolved',
        'sessionId': pending.sessionId,
        'approvalId': eventId,
        'outcome': 'cancelled'
      };
      this.emitFrame('', payload);
      return;
    }
    const payload: Record<string, Object> = {
      'type': 'question/resolved',
      'sessionId': pending.sessionId,
      'questionRpcId': eventId,
      'outcome': 'cancelled'
    };
    this.emitFrame('', payload);
  }

  /** Follow frames: `event`/`chunks` records or v3 `assistant-stream` frames. */
  private entriesFromFollowFrame(value: Object): HarnessHistoryEntry[] {
    const root: Record<string, Object> | undefined = asRecord(value);
    if (root === undefined) {
      return [];
    }
    const type: string = jsonStr(root, 'type', '');
    if (this.hostSessionFormat === 3 && type === 'assistant-stream') {
      return this.entriesFromAssistantStream(root);
    }
    if (type === 'event') {
      const event: Record<string, Object> | undefined = asRecord(root['event']);
      return event !== undefined ? historyEntryFromEvent(event) : [];
    }
    if (type === 'chunks') {
      const event: Record<string, Object> | undefined = asRecord(root['event']);
      return event !== undefined ? entriesFromChunkRun(event) : [];
    }
    return [];
  }

  private entriesFromAssistantStream(frame: Record<string, Object>): HarnessHistoryEntry[] {
    const inner: Record<string, Object> | undefined = asRecord(frame['frame']);
    if (inner === undefined) {
      return [];
    }
    const type: string = jsonStr(inner, 'type', '');
    if (type === 'start') {
      const attempt: AssistantStreamState | undefined = assistantStreamAttempt(inner, 0);
      if (attempt !== undefined) {
        this.assistantState = attempt;
      }
      return [];
    }
    const attempt: AssistantStreamState | undefined = this.assistantState;
    if (type === 'end') {
      if (attempt !== undefined && jsonStr(inner, 'attemptId', '') === attempt.attemptId) {
        this.assistantState = undefined;
      }
      return [];
    }
    if (type !== 'chunk' || attempt === undefined
      || jsonStr(inner, 'attemptId', '') !== attempt.attemptId) {
      return [];
    }
    const indexRaw: Object | undefined = inner['index'];
    const timeRaw: Object | undefined = inner['time'];
    const chunk: Record<string, Object> | undefined = asRecord(inner['chunk']);
    if (typeof indexRaw !== 'number' || indexRaw !== attempt.nextIndex
      || typeof timeRaw !== 'number' || chunk === undefined) {
      return [];
    }
    attempt.nextIndex += 1;
    const data: Record<string, Object> = {
      'turn': attempt.turn,
      'step': attempt.step,
      'chunk': chunk
    };
    const event: HarnessSessionEvent = new HarnessSessionEvent();
    event.type = 'assistant/chunk';
    event.seq = attempt.startedAfterSeq + 1 - 1 / (attempt.nextIndex + 1);
    event.time = timeRaw;
    event.data = data;
    const entry: HarnessHistoryEntry = new HarnessHistoryEntry();
    entry.event = event;
    return [entry];
  }

  private emitStreamFailure(error: RemoteGatewayError): void {
    const errorObj: Record<string, Object> = {
      'code': error.code,
      'message': error.message
    };
    const payload: Record<string, Object> = {
      'type': 'stream/closed',
      'reason': 'failed',
      'error': errorObj
    };
    this.emitFrame('', payload);
  }

  private emitFrame(rpcId: string, payload: Record<string, Object>): void {
    const frame: HarnessClientFrame = new HarnessClientFrame();
    frame.rpcId = rpcId;
    frame.payload = payload;
    this.onFrame(frame);
  }

  private async closeFollowStream(): Promise<void> {
    const follow: RemoteGatewayStream | undefined = this.followStream;
    this.followStream = undefined;
    this.assistantState = undefined;
    if (follow !== undefined) {
      follow.close(true);
    }
  }
}

function withTimeout(work: Promise<Object>, budgetMs: number): Promise<Object> {
  return new Promise<Object>((resolve, reject) => {
    const timer: number = setTimeout(() => {
      reject(new RemoteGatewayError('STREAM_TIMEOUT', 'The session follow did not open in time.'));
    }, budgetMs);
    work.then((value: Object) => {
      clearTimeout(timer);
      resolve(value);
    }, (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function normalizeSession(value: Object): HarnessRemoteSession | undefined {
  const root: Record<string, Object> | undefined = asRecord(value);
  if (root === undefined) {
    return undefined;
  }
  const session: HarnessRemoteSession = new HarnessRemoteSession();
  session.sessionId = jsonStr(root, 'sessionId', '');
  const updatedAt: Object | undefined = root['updatedAt'];
  const running: Object | undefined = root['running'];
  const blank: Object | undefined = root['blank'];
  if (session.sessionId.length === 0 || typeof updatedAt !== 'number'
    || typeof running !== 'boolean' || typeof blank !== 'boolean') {
    return undefined;
  }
  session.updatedAt = updatedAt >= 1e12 ? updatedAt : updatedAt * 1000;
  session.running = running;
  session.blank = blank;
  session.title = jsonStr(root, 'title', '');
  session.cwd = jsonStr(root, 'cwd', '');
  const projections: Record<string, Object> | undefined = asRecord(root['projections']);
  const values: Record<string, Object> | undefined = projections !== undefined
    ? asRecord(projections['values']) : undefined;
  if (session.title.length === 0 && values !== undefined) {
    // Hosts surface the display title through the whitelisted projection values
    // (`title`, `sessionTitle`, `conversationTitle`) rather than the row top level.
    const candidates: string[] = ['title', 'sessionTitle', 'conversationTitle'];
    for (const key of candidates) {
      const projected: string = jsonStr(values, key, '');
      if (projected.length > 0) {
        session.title = projected;
        break;
      }
    }
  }
  if (values !== undefined) {
    const stats: Record<string, Object> | undefined = asRecord(values['sessionStats']);
    const turnsRaw: Object | undefined = stats !== undefined ? stats['turns'] : undefined;
    if (typeof turnsRaw === 'number' && turnsRaw > 0) {
      session.turns = Math.floor(turnsRaw);
    }
    const pressure: Record<string, Object> | undefined = asRecord(values['contextPressure']);
    const projectedTokens: Object | undefined = pressure !== undefined ? pressure['projectedTokens'] : undefined;
    const contextWindow: Object | undefined = pressure !== undefined ? pressure['contextWindow'] : undefined;
    if (typeof projectedTokens === 'number' && typeof contextWindow === 'number' && contextWindow > 0) {
      const pct: number = Math.round(projectedTokens * 100 / contextWindow);
      session.contextPercent = Math.min(100, Math.max(1, pct));
    }
  }
  return session;
}

function entriesFromRecords(records: Object[]): HarnessHistoryEntry[] {
  const entries: HarnessHistoryEntry[] = [];
  for (const record of records) {
    const root: Record<string, Object> | undefined = asRecord(record);
    if (root === undefined) {
      continue;
    }
    const type: string = jsonStr(root, 'type', '');
    const event: Record<string, Object> | undefined = asRecord(root['event']);
    if (event === undefined) {
      continue;
    }
    if (type === 'event') {
      const list: HarnessHistoryEntry[] = historyEntryFromEvent(event);
      for (const entry of list) {
        entries.push(entry);
      }
    } else if (type === 'chunks') {
      const list: HarnessHistoryEntry[] = entriesFromChunkRun(event);
      for (const entry of list) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

function historyEntryFromEvent(event: Record<string, Object>): HarnessHistoryEntry[] {
  const type: string = jsonStr(event, 'type', '');
  const seqRaw: Object | undefined = event['seq'];
  const timeRaw: Object | undefined = event['time'];
  if (type.length === 0 || typeof seqRaw !== 'number' || typeof timeRaw !== 'number') {
    return [];
  }
  const sessionEvent: HarnessSessionEvent = new HarnessSessionEvent();
  sessionEvent.type = type;
  sessionEvent.seq = seqRaw;
  sessionEvent.time = timeRaw;
  const data: Record<string, Object> | undefined = asRecord(event['data']);
  sessionEvent.data = data !== undefined ? data : {};
  const entry: HarnessHistoryEntry = new HarnessHistoryEntry();
  entry.event = sessionEvent;
  return [entry];
}

/** Expand one compact `chunkrow/*` history record into `assistant/chunk` events. */
function entriesFromChunkRun(event: Record<string, Object>): HarnessHistoryEntry[] {
  const type: string = jsonStr(event, 'type', '');
  const seqRaw: Object | undefined = event['seq'];
  const timeRaw: Object | undefined = event['time'];
  const data: Record<string, Object> | undefined = asRecord(event['data']);
  if (type.length === 0 || typeof seqRaw !== 'number' || typeof timeRaw !== 'number'
    || data === undefined) {
    return [];
  }
  const seq: number = seqRaw;
  const time: number = timeRaw;
  const turnRaw: Object | undefined = data['turn'];
  const stepRaw: Object | undefined = data['step'];
  const indexRaw: Object | undefined = data['index'];
  const dt: number[] = [];
  const dtRaw: Object[] | undefined = asArray(data['dt']);
  if (dtRaw !== undefined) {
    for (const item of dtRaw) {
      if (typeof item === 'number') {
        dt.push(item);
      }
    }
  }
  const entries: HarnessHistoryEntry[] = [];
  if (type === 'chunkrow/text-chunks' || type === 'chunkrow/reasoning-chunks') {
    const texts: string[] = [];
    const textsRaw: Object[] | undefined = asArray(data['texts']);
    if (textsRaw !== undefined) {
      for (const item of textsRaw) {
        if (typeof item === 'string') {
          texts.push(item);
        }
      }
    }
    let currentTime: number = time;
    for (let offset = 0; offset < texts.length; offset++) {
      if (offset > 0 && offset - 1 < dt.length) {
        currentTime += dt[offset - 1];
      }
      const chunk: Record<string, Object> = {
        'type': type === 'chunkrow/text-chunks' ? 'text-delta' : 'reasoning-delta',
        'text': texts[offset]
      };
      if (typeof indexRaw === 'number') {
        chunk['index'] = indexRaw;
      }
      entries.push(chunkEntry(chunk, seq + offset, currentTime, turnRaw, stepRaw));
    }
    return entries;
  }
  if (type !== 'chunkrow/tool-call-chunks') {
    return entries;
  }
  const args: string[] = [];
  const argsRaw: Object[] | undefined = asArray(data['args']);
  if (argsRaw !== undefined) {
    for (const item of argsRaw) {
      if (typeof item === 'string') {
        args.push(item);
      }
    }
  }
  let currentTime: number = time;
  for (let offset = 0; offset < args.length; offset++) {
    if (offset > 0 && offset - 1 < dt.length) {
      currentTime += dt[offset - 1];
    }
    const chunk: Record<string, Object> = {
      'type': 'tool-call-delta',
      'argumentsDelta': args[offset]
    };
    if (typeof indexRaw === 'number') {
      chunk['index'] = indexRaw;
    }
    const id: string = jsonStr(data, 'id', '');
    if (id.length > 0) {
      chunk['id'] = id;
    }
    const name: string = jsonStr(data, 'name', '');
    if (name.length > 0) {
      chunk['name'] = name;
    }
    entries.push(chunkEntry(chunk, seq + offset, currentTime, turnRaw, stepRaw));
  }
  return entries;
}

function chunkEntry(chunk: Record<string, Object>, seq: number, time: number,
  turnRaw: Object | undefined, stepRaw: Object | undefined): HarnessHistoryEntry {
  const data: Record<string, Object> = { 'chunk': chunk };
  if (typeof turnRaw === 'number') {
    data['turn'] = turnRaw;
  }
  if (typeof stepRaw === 'number') {
    data['step'] = stepRaw;
  }
  const event: HarnessSessionEvent = new HarnessSessionEvent();
  event.type = 'assistant/chunk';
  event.seq = seq;
  event.time = time;
  event.data = data;
  const entry: HarnessHistoryEntry = new HarnessHistoryEntry();
  entry.event = event;
  return entry;
}

function assistantStreamBaseline(value: Object | undefined): AssistantStreamState | undefined {
  const root: Record<string, Object> | undefined = asRecord(value);
  if (root === undefined) {
    return undefined;
  }
  const attempt: Record<string, Object> | undefined = asRecord(root['activeAttempt']);
  return attempt !== undefined ? assistantStreamAttempt(attempt, 0) : undefined;
}

function assistantStreamAttempt(value: Record<string, Object>, defaultNextIndex: number):
  AssistantStreamState | undefined {
  const nextIndexRaw: Object | undefined = value['nextIndex'];
  const nextIndex: number = typeof nextIndexRaw === 'number' ? nextIndexRaw : defaultNextIndex;
  const startedAfterSeq: Object | undefined = value['startedAfterSeq'];
  const turnRaw: Object | undefined = value['turn'];
  const stepRaw: Object | undefined = value['step'];
  if (typeof startedAfterSeq !== 'number' || typeof turnRaw !== 'number'
    || typeof stepRaw !== 'number') {
    return undefined;
  }
  const state: AssistantStreamState = new AssistantStreamState();
  state.attemptId = jsonStr(value, 'attemptId', '');
  state.startedAfterSeq = startedAfterSeq;
  state.turn = turnRaw;
  state.step = stepRaw;
  state.nextIndex = nextIndex;
  if (state.attemptId.length === 0) {
    return undefined;
  }
  return state;
}
