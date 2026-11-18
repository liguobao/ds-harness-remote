import { logInfo, logWarn } from '../util/Log';
import { RemoteClientCore, RemoteEvent } from './RemoteClientCore';
import { RemoteHostFeatures } from './RemoteGateway';
import { callChunkedTransfer } from './TransferCodec';
import {
  HarnessHistoryEntry, HarnessRemoteSession, HarnessSessionEvent, HarnessWorkspace, entriesFromRecords
} from './HarnessClient';
import { randomId, utf8Encode } from '../crypto/Bytes';
import { asArray, asRecord, jsonNum, jsonStr } from '../protocol/Types';

export const ACP_BACKENDS: string[] = ['cursor', 'antigravity', 'claude', 'opencode', 'pi', 'hermes'];
const ACP_PROMPT_TIMEOUT_MS = 600000;

export function detectSupportedAcpBackends(features: RemoteHostFeatures): string[] {
  const out: string[] = [];
  for (const backend of ACP_BACKENDS) {
    if (features.supportsWorkspaceType(backend, 'agent.acp.' + backend + '.v1')) {
      out.push(backend);
    }
  }
  return out;
}

export class AcpStreamHandle {
  readonly streamId: string;
  private core: RemoteClientCore;
  private unsubscribe: () => void;
  private closed: boolean = false;

  constructor(streamId: string, core: RemoteClientCore, unsubscribe: () => void) {
    this.streamId = streamId;
    this.core = core;
    this.unsubscribe = unsubscribe;
  }

  close(notifyRemote: boolean = true): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    if (notifyRemote) {
      this.core.rpc('agent.acp.stream.close', { 'streamId': this.streamId }, 5000).catch(() => undefined);
    }
  }
}

export class AcpTimelineItem {
  id: string = '';
  kind: string = 'assistant'; // 'user' | 'assistant' | 'tool' | 'approval'
  text: string = '';
  reasoning: string = '';
  toolName: string = '';
  toolState: string = '';
  summary: string = '';
  approvalId: string = '';
  reason: string = '';
  streaming: boolean = false;
  timestamp: number = 0;
}

export class AcpHistoryBundle {
  nativeEntries: HarnessHistoryEntry[] = [];
  items: AcpTimelineItem[] = [];
}

/** Client for ACP Agent backends (Cursor, AntiGravity, Claude, OpenCode, Pi, Hermes). */
export class AgentAcpClient {
  private core: RemoteClientCore;
  private capabilities: string[];

  constructor(core: RemoteClientCore, capabilities: string[]) {
    this.core = core;
    this.capabilities = capabilities;
  }

  async call(method: string, params: Record<string, Object>, timeoutMs?: number): Promise<Object> {
    const effective = method === 'session/prompt' ? ACP_PROMPT_TIMEOUT_MS : timeoutMs;
    return this.core.rpc('agent.acp.call', { 'method': method, 'params': params }, effective, 'acp:' + method);
  }

  async transferCall(method: string, params: Record<string, Object>, timeoutMs?: number): Promise<Object> {
    const encoded = utf8Encode(JSON.stringify({ 'method': method, 'params': params }));
    const effective = method === 'session/prompt' ? ACP_PROMPT_TIMEOUT_MS : timeoutMs;
    return callChunkedTransfer(this.core, 'agent.acp.transfer', randomId(), encoded, effective);
  }

  async listWorkspaces(backend: string): Promise<HarnessWorkspace[]> {
    let raw: Object;
    try {
      raw = await this.call('dsh/workspaceList', { 'backend': backend });
    } catch (error) {
      logWarn('dsh/workspaceList ' + backend + ' failed');
      return [];
    }
    const rootWs = asRecord(raw);
    const arr = asArray(raw) ?? (rootWs !== undefined ? (asArray(rootWs['workspaces']) ?? asArray(rootWs['items']) ?? []) : []);
    const out: HarnessWorkspace[] = [];
    for (const item of arr) {
      const rec = asRecord(item);
      if (rec === undefined) continue;
      const path = jsonStr(rec, 'path', '');
      if (path.length === 0) continue;
      const ws = new HarnessWorkspace();
      ws.workspaceId = backend + ':cwd:' + encodeURIComponent(path);
      ws.path = path;
      const fallbackCut = path.lastIndexOf('/');
      const tail = fallbackCut >= 0 && fallbackCut < path.length - 1 ? path.slice(fallbackCut + 1) : path;
      ws.title = jsonStr(rec, 'title', tail);
      ws.sessionIds = [];
      out.push(ws);
    }
    return out;
  }

  async listSessions(path: string, backend: string, limit: number = 40): Promise<HarnessRemoteSession[]> {
    let raw: Object;
    try {
      raw = await this.call('dsh/sessionList', { 'path': path, 'backend': backend, 'limit': limit });
    } catch (error) {
      logWarn('dsh/sessionList ' + backend + ' failed');
      return [];
    }
    const root = asRecord(raw);
    const items = asArray(raw) ?? (root !== undefined ? (asArray(root['items']) ?? asArray(root['sessions']) ?? []) : []);
    const out: HarnessRemoteSession[] = [];
    for (const item of items) {
      const rec = asRecord(item);
      if (rec === undefined) continue;
      const convId = jsonStr(rec, 'conversationId', jsonStr(rec, 'sessionId', ''));
      if (convId.length === 0) continue;
      const sess = new HarnessRemoteSession();
      sess.sessionId = backend + ':' + convId;
      sess.cwd = path;
      sess.title = jsonStr(rec, 'title', '');
      const updated = jsonNum(rec, 'updatedAt', jsonNum(rec, 'createdAt', 0));
      sess.updatedAt = updated > 0 && updated < 1e12 ? updated * 1000 : updated;
      sess.blank = false;
      if (sess.title.length === 0) sess.title = convId.slice(0, 8);
      out.push(sess);
    }
    return out;
  }

  async loadSessionHistoryBundle(nativeSessionId: string, backend: string): Promise<AcpHistoryBundle> {
    const res = await this.transferCall('dsh/sessionHistory', {
      'sessionId': nativeSessionId,
      'backend': backend
    });
    const root = asRecord(res);
    const events = root !== undefined ? (asArray(root['events']) ?? []) : [];
    const bundle = new AcpHistoryBundle();
    const wrappedNative: Object[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = asRecord(events[i]);
      if (ev === undefined) continue;
      const inner = asRecord(ev['event']);
      if (inner !== undefined && typeof inner['type'] === 'string') {
        const emptyData: Record<string, Object> = {};
        const dataRec: Record<string, Object> | undefined = asRecord(inner['data']);
        const normalizedEvent: Record<string, Object> = {
          'type': inner['type'] as string,
          'seq': typeof inner['seq'] === 'number' ? inner['seq'] as number : i,
          'time': typeof inner['time'] === 'number' && (inner['time'] as number) > 0 ? inner['time'] as number : Date.now(),
          'data': dataRec !== undefined ? dataRec : emptyData
        };
        const recordWrap: Record<string, Object> = {
          'type': jsonStr(ev, 'type', 'event'),
          'event': normalizedEvent
        };
        wrappedNative.push(recordWrap);
      }
    }
    if (wrappedNative.length > 0) {
      bundle.nativeEntries = entriesFromRecords(wrappedNative);
      return bundle;
    }
    let items: AcpTimelineItem[] = [];
    for (const rawEv of events) {
      const ev = asRecord(rawEv);
      if (ev === undefined) continue;
      const method = jsonStr(ev, 'method', jsonStr(ev, 'type', 'session/update'));
      const params = asRecord(ev['params']) ?? asRecord(ev['data']) ?? ev;
      items = reduceAcpFrame(items, method, params);
    }
    bundle.items = finalizeAcpStreaming(items);
    return bundle;
  }

  async loadSessionHistory(nativeSessionId: string, backend: string): Promise<AcpTimelineItem[]> {
    const bundle = await this.loadSessionHistoryBundle(nativeSessionId, backend);
    return bundle.items;
  }

  async createSession(cwd: string, backend: string, mode: string = 'agent'): Promise<HarnessRemoteSession> {
    const res = await this.call('session/new', {
      'cwd': cwd,
      'mcpServers': [],
      'mode': mode,
      'backend': backend
    });
    const rec = asRecord(res);
    const nativeId = rec !== undefined ? jsonStr(rec, 'sessionId', '') : '';
    if (nativeId.length === 0) {
      throw new Error('Host ACP did not return sessionId.');
    }
    const sess = new HarnessRemoteSession();
    sess.sessionId = backend + ':' + nativeId;
    sess.cwd = cwd;
    sess.updatedAt = Date.now();
    sess.blank = true;
    return sess;
  }

  async prompt(nativeSessionId: string, text: string, backend: string,
    images: Record<string, Object>[] = []): Promise<void> {
    const promptParts: Object[] = [];
    if (text.length > 0) {
      const part: Record<string, Object> = { 'type': 'text', 'text': text };
      promptParts.push(part);
    }
    for (const img of images) {
      promptParts.push(img);
    }
    const params: Record<string, Object> = {
      'sessionId': nativeSessionId,
      'backend': backend,
      'prompt': promptParts
    };
    if (images.length > 0) {
      await this.transferCall('session/prompt', params);
    } else {
      await this.call('session/prompt', params);
    }
  }

  async cancel(nativeSessionId: string): Promise<void> {
    await this.call('session/cancel', { 'sessionId': nativeSessionId });
  }

  async respond(requestHandle: string, decision: string): Promise<void> {
    await this.core.rpc('agent.acp.respond', {
      'requestHandle': requestHandle,
      'decision': decision
    });
  }

  async sessionModels(nativeSessionId: string, backend: string): Promise<Object> {
    return this.call('dsh/sessionModels', { 'sessionId': nativeSessionId, 'backend': backend });
  }

  async selectModel(nativeSessionId: string, backend: string, model: string, effort?: string): Promise<void> {
    if (backend === 'antigravity' && !this.capabilities.includes('agent.acp.antigravity.model-load.v1')) {
      await this.call('session/load', { 'sessionId': nativeSessionId, 'backend': backend }).catch(() => undefined);
    }
    const params: Record<string, Object> = {
      'sessionId': nativeSessionId,
      'backend': backend,
      'model': model
    };
    if (effort !== undefined && effort.length > 0) {
      params['reasoningEffort'] = effort;
    }
    await this.call('dsh/selectModel', params);
  }

  async openStream(
    nativeSessionId: string,
    onFrame: (method: string, params: Record<string, Object>) => void,
    onClose: (reason: string) => void
  ): Promise<AcpStreamHandle> {
    const streamId = randomId();
    let active = true;
    const unsub = this.core.onEvent((event: RemoteEvent) => {
      if (!active) return;
      const data = asRecord(event.data);
      if (data === undefined) return;
      const evStreamId = jsonStr(data, 'streamId', '');
      if (event.event === 'agent.acp.stream.closed' && evStreamId === streamId) {
        active = false;
        unsub();
        onClose(jsonStr(data, 'reason', 'closed'));
        return;
      }
      if (event.event === 'agent.acp.frame') {
        const frame = asRecord(data['frame']);
        if (frame === undefined) return;
        const params = asRecord(frame['params']) ?? {};
        const updateRec = asRecord(params['update']);
        const frameSid = jsonStr(params, 'sessionId', updateRec !== undefined ? jsonStr(updateRec, 'sessionId', '') : '');
        if (evStreamId === streamId || evStreamId === 'session:' + nativeSessionId
          || frameSid === nativeSessionId) {
          onFrame(jsonStr(frame, 'method', 'session/update'), params);
        }
      }
    });
    try {
      await this.core.rpc('agent.acp.stream.open', { 'streamId': streamId, 'sessionId': nativeSessionId });
    } catch (error) {
      active = false;
      unsub();
      throw error instanceof Error ? error : new Error(String(error));
    }
    return new AcpStreamHandle(streamId, this.core, unsub);
  }
}

function finalizeAcpStreaming(items: AcpTimelineItem[]): AcpTimelineItem[] {
  const out = items.slice();
  for (let i = 0; i < out.length; i++) {
    out[i].streaming = false;
    if (out[i].id === 'acp-assistant-live') {
      out[i].id = 'acp-assistant-' + i + '-' + Date.now();
    }
  }
  return out;
}

function extractAcpUpdateText(update: Record<string, Object>): string {
  const direct = jsonStr(update, 'text', '');
  if (direct.length > 0) return direct;
  const content = asRecord(update['content']);
  if (content !== undefined) {
    return jsonStr(content, 'text', '');
  }
  return '';
}

export function reduceAcpFrame(items: AcpTimelineItem[], method: string, params: Record<string, Object>): AcpTimelineItem[] {
  const out = items.slice();
  if (method === 'dsh/approval_resolved') {
    const handle = jsonStr(params, 'requestHandle', '');
    if (handle.length === 0 || jsonStr(params, 'sessionId', '').length === 0) return out;
    return out.filter((item: AcpTimelineItem) => item.kind !== 'approval' || item.approvalId !== handle);
  }
  if (method === 'dsh/approval_snapshot') {
    const handles = asArray(params['requestHandles']);
    if (jsonStr(params, 'sessionId', '').length === 0 || handles === undefined
      || !handles.every((handle: Object) => typeof handle === 'string')) return out;
    return out.filter((item: AcpTimelineItem) => item.kind !== 'approval' || handles.includes(item.approvalId));
  }
  if (method === 'session/request_permission' || method === 'cursor/create_plan'
    || method === 'cursor/ask_question') {
    const handle = jsonStr(params, 'requestHandle', '');
    if (handle.length === 0) return out;
    const item = new AcpTimelineItem();
    item.id = 'acp-approval:' + handle;
    item.kind = 'approval';
    item.approvalId = handle;
    const tc = asRecord(params['toolCall']);
    item.toolName = jsonStr(params, 'toolName',
      tc !== undefined ? jsonStr(tc, 'title', 'permission') : jsonStr(params, 'title', 'permission'));
    item.reason = jsonStr(params, 'reason', jsonStr(params, 'overview', ''));
    item.timestamp = Date.now();
    const existing = out.findIndex((entry: AcpTimelineItem) => entry.id === item.id);
    if (existing >= 0) out[existing] = item;
    else out.push(item);
    return out;
  }

  const update = asRecord(params['update']) ?? params;
  const kind = jsonStr(update, 'sessionUpdate', jsonStr(update, 'type', ''));
  if (kind === 'agent_message_chunk' || kind === 'agent_message') {
    const text = extractAcpUpdateText(update);
    if (text.length === 0) return out;
    const last = out.length > 0 ? out[out.length - 1] : undefined;
    if (last !== undefined && last.kind === 'assistant' && last.streaming) {
      last.text += text;
      return out;
    }
    const item = new AcpTimelineItem();
    item.id = 'acp-assistant-live';
    item.kind = 'assistant';
    item.text = text;
    item.streaming = true;
    item.timestamp = Date.now();
    out.push(item);
    return out;
  }

  if (kind === 'agent_thought_chunk' || kind === 'agent_thought') {
    const text = extractAcpUpdateText(update);
    if (text.length === 0) return out;
    const last = out.length > 0 ? out[out.length - 1] : undefined;
    if (last !== undefined && last.kind === 'assistant' && last.streaming) {
      last.reasoning += text;
      return out;
    }
    const item = new AcpTimelineItem();
    item.id = 'acp-assistant-live';
    item.kind = 'assistant';
    item.reasoning = text;
    item.streaming = true;
    item.timestamp = Date.now();
    out.push(item);
    return out;
  }

  if (kind === 'user_message_chunk' || kind === 'user_message') {
    const text = extractAcpUpdateText(update);
    if (text.length === 0) return out;
    const item = new AcpTimelineItem();
    item.id = 'acp-user-' + out.length;
    item.kind = 'user';
    item.text = text;
    item.timestamp = Date.now();
    out.push(item);
    return out;
  }

  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const callId = jsonStr(update, 'toolCallId', jsonStr(update, 'callId', jsonStr(update, 'name', 'tool')));
    const toolId = 'acp-tool:' + callId;
    let existingIdx = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].id === toolId) {
        existingIdx = i;
        break;
      }
    }
    const st = jsonStr(update, 'status', '');
    const nextState = st === 'failed' ? 'failed'
      : (st === 'completed' || update['output'] !== undefined || update['rawOutput'] !== undefined
        ? 'finished' : 'running');
    if (existingIdx >= 0) {
      out[existingIdx].toolState = nextState;
      const summaryText = jsonStr(update, 'rawOutput', jsonStr(update, 'output', ''));
      if (summaryText.length > 0) {
        out[existingIdx].summary = summaryText;
      }
      return out;
    }
    const item = new AcpTimelineItem();
    item.id = toolId;
    item.kind = 'tool';
    item.toolName = jsonStr(update, 'title', jsonStr(update, 'toolName', jsonStr(update, 'name', 'tool')));
    item.toolState = nextState;
    item.summary = jsonStr(update, 'rawOutput', jsonStr(update, 'output', ''));
    item.timestamp = Date.now();
    out.push(item);
    return out;
  }

  if (kind === 'prompt_completed' || kind === 'prompt_failed') {
    return finalizeAcpStreaming(out);
  }

  return out;
}
