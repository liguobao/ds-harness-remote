import { logInfo, logWarn } from '../util/Log';
import { RemoteClientCore } from '../net/RemoteClientCore';
import { RemoteHostFeatures } from '../net/RemoteGateway';
import { HarnessHistoryEntry, HarnessRemoteSession, HarnessWorkspace } from '../net/HarnessClient';
import {
  CodexHistoryBundle, CodexRemoteClient, CodexStreamHandle, CodexTimelineItem, buildCodexWorkspaces
} from '../net/CodexClient';
import {
  AcpHistoryBundle, AcpStreamHandle, AcpTimelineItem, AgentAcpClient, detectSupportedAcpBackends, reduceAcpFrame
} from '../net/AcpClient';
import { asArray, asRecord, jsonStr } from '../protocol/Types';

export class UnifiedModelEntry {
  provider: string = '';
  model: string = '';
  name: string = '';
  description: string = '';
  efforts: string[] = [];
}

export class BackendCatalogMerge {
  workspaces: HarnessWorkspace[] = [];
  sessions: HarnessRemoteSession[] = [];
}

export function backendOfSessionId(sessionId: string): string {
  const prefixes: string[] = ['codex:', 'cursor:', 'antigravity:', 'claude:', 'opencode:', 'pi:', 'hermes:'];
  for (const p of prefixes) {
    if (sessionId.startsWith(p)) {
      return p.slice(0, p.length - 1);
    }
  }
  return 'harness';
}

export function nativeSessionIdOf(sessionId: string): string {
  const cut = sessionId.indexOf(':');
  return cut > 0 ? sessionId.slice(cut + 1) : sessionId;
}

export function backendDisplayName(backend: string): string {
  if (backend === 'codex') return 'Codex';
  if (backend === 'cursor') return 'Cursor';
  if (backend === 'antigravity') return 'AntiGravity';
  if (backend === 'claude') return 'Claude';
  if (backend === 'opencode') return 'OpenCode';
  if (backend === 'pi') return 'Pi';
  if (backend === 'hermes') return 'Hermes';
  return 'Harness';
}

/**
 * Orchestrates optional multi-backend clients (CodeX App Server + ACP Cursor/AntiGravity/
 * Claude/OpenCode/Pi/Hermes) cleanly outside AppRuntime.ets.
 */
export class BackendsRouter {
  private codex: CodexRemoteClient | undefined = undefined;
  private acp: AgentAcpClient | undefined = undefined;
  private acpBackends: string[] = [];
  private codexAvailable: boolean = false;

  private activeCodexStream: CodexStreamHandle | undefined = undefined;
  private streamVersion: number = 0;
  private activeCodexThreadId: string = '';
  private resolvedCodexApprovals: Set<string> = new Set();
  private activeAcpStream: AcpStreamHandle | undefined = undefined;
  private activeCodexItems: CodexTimelineItem[] = [];
  private activeAcpItems: AcpTimelineItem[] = [];
  activeCodexTurnId: string = '';

  configure(core: RemoteClientCore, features: RemoteHostFeatures): void {
    this.codexAvailable = features.hasCapability('codex.appserver.transfer.v1')
      && features.supportsWorkspaceType('codex', 'codex.appserver.v1');
    this.codex = this.codexAvailable ? new CodexRemoteClient(core) : undefined;
    this.acpBackends = detectSupportedAcpBackends(features);
    this.acp = this.acpBackends.length > 0 ? new AgentAcpClient(core, features.capabilities) : undefined;
  }

  availableBackends(): string[] {
    const out: string[] = ['harness'];
    if (this.codexAvailable) out.push('codex');
    for (const b of this.acpBackends) {
      out.push(b);
    }
    return out;
  }

  isBackendAvailable(backend: string): boolean {
    if (backend === 'harness') return true;
    if (backend === 'codex') return this.codexAvailable;
    return this.acpBackends.includes(backend);
  }

  closeActiveStreams(): void {
    this.streamVersion++;
    this.activeCodexThreadId = '';
    this.resolvedCodexApprovals.clear();
    if (this.activeCodexStream !== undefined) {
      this.activeCodexStream.close(true);
      this.activeCodexStream = undefined;
    }
    if (this.activeAcpStream !== undefined) {
      this.activeAcpStream.close(true);
      this.activeAcpStream = undefined;
    }
    this.activeCodexTurnId = '';
  }

  async loadExtraCatalog(existingSessions: HarnessRemoteSession[],
    existingWorkspaces: HarnessWorkspace[]): Promise<BackendCatalogMerge> {
    const merged = new BackendCatalogMerge();
    merged.workspaces = existingWorkspaces.slice();
    merged.sessions = existingSessions.slice();
    const seenSid: Set<string> = new Set();
    for (const s of merged.sessions) seenSid.add(s.sessionId);
    const seenWid: Set<string> = new Set();
    for (const w of merged.workspaces) seenWid.add(w.workspaceId);

    if (this.codex !== undefined) {
      try {
        const threads = await this.codex.threads();
        for (const t of threads) {
          if (!seenSid.has(t.sessionId)) {
            merged.sessions.push(t);
            seenSid.add(t.sessionId);
          }
        }
        const cws = buildCodexWorkspaces(threads);
        for (const w of cws) {
          if (!seenWid.has(w.workspaceId)) {
            merged.workspaces.push(w);
            seenWid.add(w.workspaceId);
          }
        }
        logInfo('catalog codex -> ' + threads.length + ' threads');
      } catch (error) {
        logWarn('catalog codex failed');
      }
    }

    if (this.acp !== undefined) {
      for (const backend of this.acpBackends) {
        try {
          const wsList = await this.acp.listWorkspaces(backend);
          for (const w of wsList) {
            const list = await this.acp.listSessions(w.path, backend, 100);
            for (const s of list) {
              w.sessionIds.push(s.sessionId);
              if (!seenSid.has(s.sessionId)) {
                merged.sessions.push(s);
                seenSid.add(s.sessionId);
              }
            }
            if (!seenWid.has(w.workspaceId)) {
              merged.workspaces.push(w);
              seenWid.add(w.workspaceId);
            }
          }
          logInfo('catalog ' + backend + ' -> ' + wsList.length + ' workspaces');
        } catch (error) {
          logWarn('catalog ' + backend + ' failed');
          // One ACP backend error does not block the rest.
        }
      }
    }
    return merged;
  }

  async openCodexSession(
    sessionId: string,
    onUpdate: (items: CodexTimelineItem[], generating: boolean) => void
  ): Promise<CodexTimelineItem[]> {
    this.closeActiveStreams();
    if (this.codex === undefined) throw new Error('Codex backend unavailable');
    const version = this.streamVersion;
    const nativeId = nativeSessionIdOf(sessionId);
    const hist: CodexHistoryBundle = await this.codex.history(nativeId);
    if (version !== this.streamVersion) return [];
    this.activeCodexThreadId = nativeId;
    this.activeCodexItems = hist.items.slice();
    this.activeCodexTurnId = hist.activeTurnId;
    const stream = await this.codex.subscribe(nativeId, (method: string, params: Record<string, Object>) => {
      if (version === this.streamVersion) this.reduceCodexLive(method, params, onUpdate);
    }, () => {
      if (version === this.streamVersion) onUpdate(this.activeCodexItems, false);
    });
    if (version !== this.streamVersion) {
      stream.close();
      return [];
    }
    this.activeCodexStream = stream;
    // The session callback is installed and the stream is open before reclaiming.
    await stream.claimApprovals((method: string, params: Record<string, Object>) => {
      if (version === this.streamVersion && this.activeCodexStream === stream) {
        this.reduceCodexLive(method, params, onUpdate);
      }
    });
    return version === this.streamVersion ? this.activeCodexItems : [];
  }

  private reduceCodexLive(
    method: string,
    params: Record<string, Object>,
    onUpdate: (items: CodexTimelineItem[], generating: boolean) => void
  ): void {
    const out = this.activeCodexItems.slice();
    let generating = this.activeCodexTurnId.length > 0;
    if (method === 'turn/started') {
      const turn = asRecord(params['turn']);
      if (turn !== undefined) this.activeCodexTurnId = jsonStr(turn, 'id', 'active');
      generating = true;
    } else if (method === 'turn/completed' || method === 'thread/status/changed') {
      const st = asRecord(params['status']);
      const stType = st !== undefined ? jsonStr(st, 'type', '') : '';
      if (method === 'turn/completed' || stType === 'idle' || stType === 'systemError') {
        this.activeCodexTurnId = '';
        generating = false;
        for (const item of out) item.streaming = false;
      }
    } else if (method === 'item/agentMessage/delta') {
      const delta = jsonStr(params, 'delta', '');
      const itemId = jsonStr(params, 'itemId', 'live');
      if (delta.length > 0) {
        let target: CodexTimelineItem | undefined = undefined;
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].itemId === itemId && out[i].kind === 'assistant') {
            target = out[i];
            break;
          }
        }
        if (target === undefined) {
          target = new CodexTimelineItem();
          target.id = 'codex:live:' + itemId;
          target.itemId = itemId;
          target.kind = 'assistant';
          target.streaming = true;
          target.timestamp = Date.now();
          out.push(target);
        }
        target.text += delta;
        target.streaming = true;
      }
    } else if (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
      const delta = jsonStr(params, 'delta', '');
      const itemId = jsonStr(params, 'itemId', 'live');
      if (delta.length > 0) {
        let target: CodexTimelineItem | undefined = undefined;
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].itemId === itemId && out[i].kind === 'assistant') {
            target = out[i];
            break;
          }
        }
        if (target === undefined) {
          target = new CodexTimelineItem();
          target.id = 'codex:live:' + itemId;
          target.itemId = itemId;
          target.kind = 'assistant';
          target.streaming = true;
          target.timestamp = Date.now();
          out.push(target);
        }
        target.reasoning += delta;
      }
    } else if (method === 'dsh/approval/resolved') {
      const handle = jsonStr(params, 'requestHandle', '');
      const threadId = jsonStr(params, 'threadId', '');
      if (handle.length > 0 && threadId === this.activeCodexThreadId && threadId.length > 0) {
        this.resolvedCodexApprovals.add(handle);
        for (const item of out) {
          if (item.kind === 'approval' && item.approvalId === handle && item.approvalOutcome.length === 0) {
            item.approvalOutcome = 'cancelled';
          }
        }
      }
    } else if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const handle = jsonStr(params, 'requestHandle', '');
      if (handle.length > 0 && !this.resolvedCodexApprovals.has(handle)
        && !out.some((item: CodexTimelineItem) => item.approvalId === handle)) {
        const app = new CodexTimelineItem();
        app.id = 'codex:approval:' + handle;
        app.kind = 'approval';
        app.approvalId = handle;
        app.toolName = method === 'item/fileChange/requestApproval' ? 'File change' : 'Command';
        app.reason = jsonStr(params, 'reason', jsonStr(params, 'command', ''));
        app.timestamp = Date.now();
        out.push(app);
      }
    }
    this.activeCodexItems = out;
    onUpdate(out, generating);
  }

  async openAcpSession(
    sessionId: string,
    onUpdate: (items: AcpTimelineItem[], generating: boolean) => void
  ): Promise<AcpHistoryBundle> {
    this.closeActiveStreams();
    if (this.acp === undefined) throw new Error('ACP backend unavailable');
    const backend = backendOfSessionId(sessionId);
    const nativeId = nativeSessionIdOf(sessionId);
    const bundle = await this.acp.loadSessionHistoryBundle(nativeId, backend);
    this.activeAcpItems = bundle.items.slice();
    this.activeAcpStream = await this.acp.openStream(nativeId, (method: string, params: Record<string, Object>) => {
      if ((method === 'dsh/approval_resolved' || method === 'dsh/approval_snapshot')
        && jsonStr(params, 'sessionId', '') !== nativeId) return;
      this.activeAcpItems = reduceAcpFrame(this.activeAcpItems, method, params);
      const anyStreaming = this.activeAcpItems.some((it: AcpTimelineItem) => it.streaming);
      onUpdate(this.activeAcpItems, anyStreaming);
    }, () => {
      this.activeAcpItems = this.activeAcpItems.filter((item: AcpTimelineItem) => item.kind !== 'approval');
      onUpdate(this.activeAcpItems, false);
    });
    return bundle;
  }

  async createSession(backend: string, cwd: string): Promise<HarnessRemoteSession> {
    if (backend === 'codex') {
      if (this.codex === undefined) throw new Error('Codex backend unavailable');
      return this.codex.start(cwd);
    }
    if (this.acp === undefined) throw new Error('ACP backend unavailable');
    return this.acp.createSession(cwd, backend, 'agent');
  }

  async prompt(sessionId: string, text: string, steer: boolean, images: Record<string, Object>[] = []): Promise<void> {
    const backend = backendOfSessionId(sessionId);
    const nativeId = nativeSessionIdOf(sessionId);
    if (backend === 'codex') {
      if (this.codex === undefined) throw new Error('Codex unavailable');
      if (steer && this.activeCodexTurnId.length > 0) {
        await this.codex.steer(nativeId, this.activeCodexTurnId, text);
      } else {
        await this.codex.prompt(nativeId, text);
      }
      return;
    }
    if (this.acp === undefined) throw new Error('ACP unavailable');
    await this.acp.prompt(nativeId, text, backend, images);
  }

  async stop(sessionId: string): Promise<void> {
    const backend = backendOfSessionId(sessionId);
    const nativeId = nativeSessionIdOf(sessionId);
    if (backend === 'codex' && this.codex !== undefined && this.activeCodexTurnId.length > 0) {
      await this.codex.interrupt(nativeId, this.activeCodexTurnId);
      return;
    }
    if (backend !== 'harness' && this.acp !== undefined) {
      await this.acp.cancel(nativeId);
    }
  }

  async respondApproval(sessionId: string, approvalId: string, allowed: boolean): Promise<void> {
    const backend = backendOfSessionId(sessionId);
    if (backend === 'codex' && this.codex !== undefined) {
      await this.codex.respond(approvalId, allowed ? 'accept' : 'decline');
      return;
    }
    if (backend !== 'harness' && this.acp !== undefined) {
      await this.acp.respond(approvalId, allowed ? 'allow-once' : 'reject-once');
    }
  }

  async listModels(sessionId: string): Promise<UnifiedModelEntry[]> {
    const backend = backendOfSessionId(sessionId);
    const nativeId = nativeSessionIdOf(sessionId);
    const out: UnifiedModelEntry[] = [];
    if (backend === 'codex' && this.codex !== undefined) {
      const raw = await this.codex.models();
      const rec = asRecord(raw);
      const data = rec !== undefined ? (asArray(rec['data']) ?? asArray(rec['models']) ?? []) : [];
      for (const item of data) {
        const m = asRecord(item);
        if (m === undefined) continue;
        const id = jsonStr(m, 'id', jsonStr(m, 'model', ''));
        if (id.length === 0) continue;
        const entry = new UnifiedModelEntry();
        entry.provider = 'codex';
        entry.model = id;
        entry.name = jsonStr(m, 'displayName', jsonStr(m, 'name', id));
        out.push(entry);
      }
      return out;
    }
    if (backend !== 'harness' && this.acp !== undefined) {
      const raw = await this.acp.sessionModels(nativeId, backend);
      const rec = asRecord(raw);
      const groups = rec !== undefined ? (asArray(rec['groups']) ?? []) : [];
      for (const g of groups) {
        const gRec = asRecord(g);
        if (gRec === undefined) continue;
        const models = asArray(gRec['models']) ?? [];
        for (const m of models) {
          const mRec = asRecord(m);
          if (mRec === undefined) continue;
          const id = jsonStr(mRec, 'id', '');
          if (id.length === 0) continue;
          const entry = new UnifiedModelEntry();
          entry.provider = backend;
          entry.model = id;
          entry.name = jsonStr(mRec, 'name', id);
          out.push(entry);
        }
      }
    }
    return out;
  }

  async selectModel(sessionId: string, model: string, effort: string): Promise<void> {
    const backend = backendOfSessionId(sessionId);
    const nativeId = nativeSessionIdOf(sessionId);
    if (backend !== 'harness' && backend !== 'codex' && this.acp !== undefined) {
      await this.acp.selectModel(nativeId, backend, model, effort);
    }
  }
}
