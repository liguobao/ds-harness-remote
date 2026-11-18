import { RemoteClientCore, RemoteEvent } from './RemoteClientCore';
import { callChunkedTransfer } from './TransferCodec';
import { HarnessRemoteSession, HarnessWorkspace } from './HarnessClient';
import { randomId, utf8Encode } from '../crypto/Bytes';
import { asArray, asRecord, jsonNum, jsonStr } from '../protocol/Types';

export class CodexTimelineItem {
  id: string = '';
  kind: string = 'assistant'; // 'user' | 'assistant' | 'tool' | 'approval'
  text: string = '';
  reasoning: string = '';
  toolName: string = '';
  toolState: string = ''; // '' | 'running' | 'finished' | 'failed'
  summary: string = '';
  approvalId: string = '';
  approvalOutcome: string = '';
  reason: string = '';
  streaming: boolean = false;
  timestamp: number = 0;
  itemId: string = '';
}

export class CodexHistoryBundle {
  session: HarnessRemoteSession = new HarnessRemoteSession();
  items: CodexTimelineItem[] = [];
  activeTurnId: string = '';
}

export class CodexStreamHandle {
  readonly streamId: string;
  private core: RemoteClientCore;
  private unsubscribe: () => void;
  private closed: boolean = false;
  private isActive: () => boolean;

  constructor(streamId: string, core: RemoteClientCore, unsubscribe: () => void, isActive: () => boolean) {
    this.streamId = streamId;
    this.core = core;
    this.unsubscribe = unsubscribe;
    this.isActive = isActive;
  }

  async claimApprovals(onFrame: (method: string, params: Record<string, Object>) => void): Promise<void> {
    try {
      const result = asRecord(await this.core.rpc('codex.app.approvals.claim', { 'streamId': this.streamId }));
      if (this.closed || !this.isActive() || result === undefined) return;
      const frames = asArray(result['frames']) ?? [];
      for (const raw of frames) {
        if (this.closed || !this.isActive()) return;
        const frame = asRecord(raw);
        if (frame === undefined) continue;
        const method = jsonStr(frame, 'method', '');
        const params = asRecord(frame['params']) ?? {};
        if (method.length > 0) onFrame(method, params);
      }
    } catch (error) {
      // Older Hosts lack this RPC; retain the live stream.
    }
  }

  close(notifyRemote: boolean = true): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    if (notifyRemote) {
      this.core.rpc('codex.app.stream.close', { 'streamId': this.streamId }, 5000).catch(() => undefined);
    }
  }
}

/** Client for CodeX App Server via `codex.app.*` RPCs & transfers. */
export class CodexRemoteClient {
  private core: RemoteClientCore;

  constructor(core: RemoteClientCore) {
    this.core = core;
  }

  private async call(method: string, params: Record<string, Object>, transfer: boolean = false): Promise<Object> {
    const envelope: Record<string, Object> = { 'method': method, 'params': params };
    if (!transfer) {
      return this.core.rpc('codex.app.call', envelope, undefined, 'codex:' + method);
    }
    const encoded = utf8Encode(JSON.stringify(envelope));
    return callChunkedTransfer(this.core, 'codex.app.transfer', randomId(), encoded);
  }

  async models(): Promise<Object> {
    return this.call('model/list', {}, false);
  }

  async threads(): Promise<HarnessRemoteSession[]> {
    const out: HarnessRemoteSession[] = [];
    let cursor: string = '';
    for (let page = 0; page < 5; page++) {
      const params: Record<string, Object> = {
        'limit': 100, 'sortKey': 'updated_at', 'sortDirection': 'desc', 'archived': false
      };
      if (cursor.length > 0) {
        params['cursor'] = cursor;
      }
      const res = await this.call('thread/list', params, false);
      const root = asRecord(res);
      const data = root !== undefined ? (asArray(root['data']) ?? []) : [];
      for (const raw of data) {
        const sess = projectCodexThread(raw);
        if (sess !== undefined) {
          out.push(sess);
        }
      }
      cursor = root !== undefined ? jsonStr(root, 'nextCursor', '') : '';
      if (cursor.length === 0 || data.length === 0) {
        break;
      }
    }
    return out;
  }

  async history(nativeThreadId: string): Promise<CodexHistoryBundle> {
    const res = await this.call('thread/read', { 'threadId': nativeThreadId, 'includeTurns': true }, true);
    const root = asRecord(res);
    const thread = root !== undefined ? asRecord(root['thread']) : undefined;
    if (thread === undefined) {
      throw new Error('Host returned an invalid Codex thread history.');
    }
    const sess = projectCodexThread(thread);
    if (sess === undefined) {
      throw new Error('Host returned an invalid Codex thread.');
    }
    const bundle = new CodexHistoryBundle();
    bundle.session = sess;
    const turns = asArray(thread['turns']) ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
      const turnRec = asRecord(turns[i]);
      if (turnRec !== undefined) {
        const st = jsonStr(turnRec, 'status', '');
        if (st === 'inProgress' || st === 'running') {
          bundle.activeTurnId = jsonStr(turnRec, 'id', '');
          break;
        }
      }
    }
    for (const rawTurn of turns) {
      const turnRec = asRecord(rawTurn);
      if (turnRec === undefined) continue;
      const turnItems = asArray(turnRec['items']) ?? [];
      for (const rawItem of turnItems) {
        const mapped = projectCodexItem(rawItem, jsonStr(turnRec, 'id', ''));
        if (mapped !== undefined) {
          bundle.items.push(mapped);
        }
      }
    }
    return bundle;
  }

  async start(cwd: string, model?: string): Promise<HarnessRemoteSession> {
    const params: Record<string, Object> = { 'cwd': cwd };
    if (model !== undefined && model.length > 0) {
      params['model'] = model;
    }
    const res = await this.call('thread/start', params, false);
    const root = asRecord(res);
    const sess = projectCodexThread(root !== undefined ? root['thread'] : undefined);
    if (sess === undefined) {
      throw new Error('Host failed to create Codex thread.');
    }
    return sess;
  }

  async fork(nativeThreadId: string): Promise<HarnessRemoteSession> {
    const res = await this.call('thread/fork', { 'threadId': nativeThreadId }, false);
    const root = asRecord(res);
    const sess = projectCodexThread(root !== undefined ? root['thread'] : undefined);
    if (sess === undefined) {
      throw new Error('Host failed to fork Codex thread.');
    }
    return sess;
  }

  async rename(nativeThreadId: string, name: string): Promise<void> {
    await this.call('thread/name/set', { 'threadId': nativeThreadId, 'name': name }, false);
  }

  async prompt(nativeThreadId: string, text: string): Promise<void> {
    const part: Record<string, Object> = { 'type': 'text', 'text': text };
    await this.call('turn/start', { 'threadId': nativeThreadId, 'input': [part] }, false);
  }

  async steer(nativeThreadId: string, expectedTurnId: string, text: string): Promise<void> {
    const part: Record<string, Object> = { 'type': 'text', 'text': text };
    await this.call('turn/steer', {
      'threadId': nativeThreadId,
      'expectedTurnId': expectedTurnId,
      'input': [part]
    }, false);
  }

  async interrupt(nativeThreadId: string, turnId: string): Promise<void> {
    await this.call('turn/interrupt', { 'threadId': nativeThreadId, 'turnId': turnId }, false);
  }

  async respond(requestHandle: string, decision: string): Promise<void> {
    await this.core.rpc('codex.app.respond', { 'requestHandle': requestHandle, 'decision': decision });
  }

  async subscribe(
    nativeThreadId: string,
    onFrame: (method: string, params: Record<string, Object>) => void,
    onClose: (reason: string) => void
  ): Promise<CodexStreamHandle> {
    const streamId = randomId();
    let active = true;
    const unsub = this.core.onEvent((event: RemoteEvent) => {
      if (!active) return;
      const data = asRecord(event.data);
      if (data === undefined || jsonStr(data, 'streamId', '') !== streamId) {
        return;
      }
      if (event.event === 'codex.app.stream.closed') {
        active = false;
        unsub();
        onClose(jsonStr(data, 'reason', 'closed'));
        return;
      }
      if (event.event === 'codex.app.frame') {
        const frame = asRecord(data['frame']);
        if (frame === undefined) return;
        const method = jsonStr(frame, 'method', '');
        const params = asRecord(frame['params']) ?? {};
        if (method.length > 0) {
          onFrame(method, params);
        }
      }
    });
    try {
      await this.core.rpc('codex.app.stream.open', { 'streamId': streamId, 'threadId': nativeThreadId });
    } catch (error) {
      active = false;
      unsub();
      throw error instanceof Error ? error : new Error(String(error));
    }
    return new CodexStreamHandle(streamId, this.core, unsub, () => active);
  }
}

export function codexWorkspaceId(path: string): string {
  return 'codex:cwd:' + encodeURIComponent(path);
}

export function buildCodexWorkspaces(sessions: HarnessRemoteSession[]): HarnessWorkspace[] {
  const byCwd: Map<string, HarnessWorkspace> = new Map();
  for (const s of sessions) {
    if (!s.sessionId.startsWith('codex:') || s.cwd.length === 0) continue;
    let ws = byCwd.get(s.cwd);
    if (ws === undefined) {
      ws = new HarnessWorkspace();
      ws.workspaceId = codexWorkspaceId(s.cwd);
      const cut = s.cwd.lastIndexOf('/');
      ws.title = cut >= 0 && cut < s.cwd.length - 1 ? s.cwd.slice(cut + 1) : s.cwd;
      ws.path = s.cwd;
      ws.sessionIds = [];
      byCwd.set(s.cwd, ws);
    }
    ws.sessionIds.push(s.sessionId);
  }
  const out: HarnessWorkspace[] = [];
  byCwd.forEach((ws: HarnessWorkspace) => {
    out.push(ws);
  });
  return out;
}

export function projectCodexThread(raw: Object | undefined): HarnessRemoteSession | undefined {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const nativeId = jsonStr(rec, 'id', '');
  if (nativeId.length === 0) return undefined;
  const sess = new HarnessRemoteSession();
  sess.sessionId = 'codex:' + nativeId;
  sess.cwd = jsonStr(rec, 'cwd', '');
  const nm = jsonStr(rec, 'name', '');
  const title = nm.length > 0 ? nm : jsonStr(rec, 'preview', '');
  sess.title = title;
  const created = jsonNum(rec, 'createdAt', 0);
  const updated = jsonNum(rec, 'updatedAt', created);
  sess.updatedAt = updated > 0 && updated < 1e12 ? updated * 1000 : updated;
  const st = asRecord(rec['status']);
  sess.running = st !== undefined && jsonStr(st, 'type', '') === 'active';
  sess.blank = title.length === 0;
  return sess;
}

function extractCodexText(rec: Record<string, Object>): string {
  const direct = jsonStr(rec, 'text', '');
  if (direct.length > 0) return direct;
  const contentStr = rec['content'];
  if (typeof contentStr === 'string') return contentStr;
  const arr = asArray(rec['content']) ?? asArray(rec['input']);
  if (arr === undefined) return '';
  const parts: string[] = [];
  for (const v of arr) {
    if (typeof v === 'string') {
      parts.push(v);
      continue;
    }
    const r = asRecord(v);
    if (r !== undefined) {
      const txt = jsonStr(r, 'text', '');
      if (txt.length > 0) parts.push(txt);
    }
  }
  return parts.join('\n');
}

export function projectCodexItem(raw: Object | undefined, turnId: string): CodexTimelineItem | undefined {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const itemType = jsonStr(rec, 'type', '');
  const itemId = jsonStr(rec, 'id', randomId());
  const out = new CodexTimelineItem();
  out.id = 'codex:' + turnId + ':' + itemId;
  out.itemId = itemId;
  if (itemType === 'userMessage') {
    out.kind = 'user';
    out.text = extractCodexText(rec);
    return out;
  }
  if (itemType === 'agentMessage') {
    out.kind = 'assistant';
    out.text = extractCodexText(rec);
    out.streaming = jsonStr(rec, 'status', '') === 'inProgress';
    return out;
  }
  if (itemType === 'reasoning' || itemType === 'plan') {
    out.kind = 'assistant';
    out.reasoning = extractCodexText(rec);
    return out;
  }
  if (itemType === 'commandExecution' || itemType === 'fileChange' || itemType === 'mcpToolCall') {
    out.kind = 'tool';
    out.toolName = itemType === 'fileChange' ? 'fileChange'
      : (jsonStr(rec, 'tool', jsonStr(rec, 'command', itemType)));
    const st = jsonStr(rec, 'status', '');
    out.toolState = st === 'inProgress' ? 'running' : (st === 'failed' ? 'failed' : 'finished');
    out.summary = jsonStr(rec, 'aggregatedOutput', extractCodexText(rec));
    return out;
  }
  return undefined;
}
