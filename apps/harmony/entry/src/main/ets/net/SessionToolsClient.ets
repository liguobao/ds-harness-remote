import {
  RemoteGateway, RemoteGatewayError, RemoteGatewayStream, StreamHandler, toGatewayError
} from './RemoteGateway';
import { RemoteClientCore } from './RemoteClientCore';
import { bytesToBase64, base64ToBytes } from './TransferCodec';
import { randomUuid } from '../crypto/Bytes';
import { asArray, asNum, asRecord, jsonBool, jsonNum, jsonStr, jsonValue } from '../protocol/Types';

export class WorkspaceFileEntry {
  name: string = '';
  type: string = 'file'; // 'file' | 'directory' | 'other'
  size: number = -1;
}

export class WorkspaceDirectory {
  path: string = '';
  entries: WorkspaceFileEntry[] = [];
  truncated: boolean = false;
}

export class WorkspaceText {
  absolutePath: string = '';
  version: string = '';
  text: string = '';
  offset: number = 1;
  lines: number = 0;
  eof: boolean = true;
}

export class WorkspaceFileStat {
  absolutePath: string = '';
  version: string = '';
  bytes: number = 0;
}

export class WorkspaceFileBytes {
  absolutePath: string = '';
  version: string = '';
  bytes: number = 0;
  offset: number = 0;
  data: Uint8Array = new Uint8Array(0);
  eof: boolean = true;
}

export class WorkspaceOfficeRender {
  absolutePath: string = '';
  version: string = '';
  bytes: number = 0;
  offset: number = 0;
  data: Uint8Array = new Uint8Array(0);
  eof: boolean = true;
  generation: string = '';
  missingFonts: string[] = [];
}

export class WorkspaceFileRef {
  path: string = '';
  kind: string = 'file'; // 'file' | 'directory'
}

export class SkillEntry {
  name: string = '';
  description: string = '';
  modelInvocable: boolean = false;
}

export class AgentPresetOption {
  id: string = '';
  name: string = '';
  description: string = '';
  isDefault: boolean = false;
  broken: string = '';
}

export class PermissionOption {
  value: string = '';
  name: string = '';
  description: string = '';
}

export class FeedbackEntry {
  messageId: string = '';
  rating: string = ''; // 'positive' | 'negative'
  version: string = '';
}

export class BackgroundJob {
  id: string = '';
  label: string = '';
  kind: string = '';
  owner: string = '';
  status: string = 'running'; // 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  progress: string = '';
  detail: string = '';
  startedAt: number = 0;
  finishedAt: number = 0;
  outputTotal: number = 0;
  outputEarliest: number = 0;
}

export class TerminalEnv {
  maxInputBytes: number = 4096;
  maxCols: number = 240;
  maxRows: number = 100;
}

export class TerminalInfo {
  id: string = '';
  title: string = '';
  shellName: string = '';
  cwd: string = '';
  state: string = 'running'; // 'running' | 'exited' | 'failed'
  controllerId: string = '';
  cols: number = 80;
  rows: number = 24;
  hasExitCode: boolean = false;
  exitCode: number = 0;
}

export class FileUploadReceipt {
  receiptId: string = '';
  name: string = '';
  bytes: number = 0;
}

export class WorkspaceUploadResult {
  name: string = '';
  path: string = '';
  bytes: number = 0;
}

export class PluginEntryInfo {
  id: string = '';
  name: string = '';
  description: string = '';
  enabled: boolean = true;
  status: string = '';
  bundleName: string = '';
}

export class PluginBundleInfo {
  name: string = '';
  version: string = '';
  description: string = '';
  enabled: boolean = true;
}

export class SettingsNamespaceInfo {
  ns: string = '';
  revision: number = 0;
  schema: Object | undefined = undefined;
  value: Record<string, Object> = {};
}

export class SettingsDescribeResult {
  writable: boolean = true;
  namespaces: SettingsNamespaceInfo[] = [];
}

export class SettingsPathOp {
  op: string = 'set'; // 'set' | 'delete'
  path: string = '';
  value: Object | undefined = undefined;
}

export class CompactionStatus {
  operationId: string = '';
  sessionId: string = '';
  state: string = ''; // 'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'unconfirmed'
  message: string = '';
}

export class CommandExecResult {
  kind: string = 'success'; // 'success' | 'error'
  text: string = '';
}

export const OFFICE_PREVIEW_TIMEOUT_MS = 120000;
export const OFFICE_PREVIEW_MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 64 * 1024;

/**
 * Modular client covering Android's `SessionTools` + `HarnessAlphaClient` RPC surface
 * missing from Harmony's slim `HarnessClient`:
 * workspaceFiles/*, officeToPdf/*, job/*, terminal/*, agentPresets/*, messageFeedback/*,
 * skills/list, fileUploads/upload, workspace.upload.*, pluginManager/*, settings/*,
 * schedule/{catalog,create,update}, compaction, session/updateQueue.
 */
export class SessionToolsClient {
  private gateway: RemoteGateway;
  private core: RemoteClientCore;

  constructor(gateway: RemoteGateway) {
    this.gateway = gateway;
    this.core = gateway.getClient();
  }

  private async callValue(endpoint: string, args: Record<string, Object>,
    timeoutMs?: number, maxResponseBytes?: number): Promise<Object> {
    if (endpoint.startsWith('workspaceFiles/') || endpoint.startsWith('terminal/')) {
      const scopeRaw: string = jsonStr(args, 'workspaceFileScopeId',
        jsonStr(args, 'agentId', jsonStr(args, 'sessionId', '')));
      const acpPrefixes: string[] = ['antigravity:', 'cursor:', 'claude:', 'opencode:', 'pi:', 'hermes:'];
      for (const prefix of acpPrefixes) {
        if (scopeRaw.startsWith(prefix)) {
          const backend: string = prefix.slice(0, prefix.length - 1);
          const nativeId: string = scopeRaw.slice(prefix.length);
          const acpScope: string = (backend === 'antigravity' ? 'acp' : backend) + ':' + nativeId;
          const scopedArgs: Record<string, Object> = {};
          for (const k of Object.keys(args)) {
            if (k === 'workspaceFileScopeId' || k === 'agentId' || k === 'sessionId') {
              scopedArgs[k] = acpScope;
            } else {
              scopedArgs[k] = args[k];
            }
          }
          const rpcParams: Record<string, Object> = {
            'sessionId': nativeId,
            'backend': backend,
            'endpoint': endpoint,
            'args': scopedArgs
          };
          const rpcPayload: Record<string, Object> = {
            'method': 'dsh/toolCall',
            'params': rpcParams
          };
          const rpcVal: Object = await this.core.rpc('agent.acp.call', rpcPayload,
            timeoutMs, 'acpTool:' + endpoint);
          const rpcRec: Record<string, Object> | undefined = asRecord(rpcVal);
          if (rpcRec !== undefined && rpcRec['ok'] === true && rpcRec['value'] !== undefined) {
            return rpcRec['value']!;
          }
          return rpcVal;
        }
      }
    }
    const payload: Record<string, Object> = { 'args': args };
    const value: Object = await this.gateway.call(endpoint, payload, timeoutMs, maxResponseBytes);
    const root: Record<string, Object> | undefined = asRecord(value);
    if (root !== undefined && root['ok'] !== undefined) {
      if (root['ok'] === true) {
        const inner: Object | undefined = root['value'];
        return inner !== undefined ? inner : new Object();
      }
      if (root['ok'] === false) {
        const err: Record<string, Object> | undefined = asRecord(root['error']);
        if (err !== undefined) {
          throw new RemoteGatewayError(
            jsonStr(err, 'code', 'internal'),
            jsonStr(err, 'message', 'The Host rejected the Remote request.')
          );
        }
      }
    }
    return value;
  }

  // -------------------- Permission / Skills / Agent Presets / Commands --------------------

  async permissionOptions(): Promise<PermissionOption[]> {
    const val: Object = await this.callValue('permissionPresets/catalog', {});
    const root: Record<string, Object> | undefined = asRecord(val);
    const rows: Object[] = root !== undefined ? (asArray(root['options']) ?? []) : [];
    const out: PermissionOption[] = [];
    for (const item of rows) {
      const rec: Record<string, Object> | undefined = asRecord(item);
      if (rec === undefined) {
        continue;
      }
      const valueStr: string = jsonStr(rec, 'value', '');
      const nameStr: string = jsonStr(rec, 'name', '');
      if (valueStr.length === 0 || nameStr.length === 0) {
        continue;
      }
      const opt = new PermissionOption();
      opt.value = valueStr;
      opt.name = nameStr;
      opt.description = jsonStr(rec, 'description', '');
      out.push(opt);
    }
    return out;
  }

  async listSkills(sessionId: string): Promise<SkillEntry[]> {
    const request: Record<string, Object> = { 'sessionId': sessionId };
    const args: Record<string, Object> = { 'request': request };
    const val: Object = await this.callValue('skills/list', args);
    const root: Record<string, Object> | undefined = asRecord(val);
    const rows: Object[] = root !== undefined ? (asArray(root['skills']) ?? []) : [];
    const out: SkillEntry[] = [];
    for (const item of rows) {
      const rec: Record<string, Object> | undefined = asRecord(item);
      if (rec === undefined) {
        continue;
      }
      const name: string = jsonStr(rec, 'name', '');
      if (name.length === 0) {
        continue;
      }
      const skill = new SkillEntry();
      skill.name = name;
      skill.description = jsonStr(rec, 'description', '');
      skill.modelInvocable = jsonBool(rec, 'modelInvocable', false);
      out.push(skill);
    }
    return out;
  }

  async executeCommand(sessionId: string, line: string): Promise<CommandExecResult> {
    const args: Record<string, Object> = {
      'agentId': sessionId,
      'line': line,
      'submittedAttachments': []
    };
    const val: Object = await this.callValue('commands/execute', args);
    const root: Record<string, Object> | undefined = asRecord(val);
    const resultRec: Record<string, Object> | undefined = root !== undefined ? asRecord(root['result']) : undefined;
    const out = new CommandExecResult();
    if (resultRec !== undefined) {
      out.kind = jsonStr(resultRec, 'kind', 'success');
      out.text = jsonStr(resultRec, 'text', '');
    } else if (root !== undefined) {
      out.kind = jsonStr(root, 'kind', 'success');
      out.text = jsonStr(root, 'text', '');
    }
    return out;
  }

  async agentPresetList(): Promise<AgentPresetOption[]> {
    const val: Object = await this.callValue('agentPresets/list', {});
    const root: Record<string, Object> | undefined = asRecord(val);
    const rows: Object[] = root !== undefined ? (asArray(root['presets']) ?? []) : [];
    const out: AgentPresetOption[] = [];
    for (const item of rows) {
      const rec: Record<string, Object> | undefined = asRecord(item);
      if (rec === undefined) {
        continue;
      }
      const id: string = jsonStr(rec, 'id', '');
      if (id.length === 0) {
        continue;
      }
      const opt = new AgentPresetOption();
      opt.id = id;
      opt.name = jsonStr(rec, 'name', id);
      opt.description = jsonStr(rec, 'description', '');
      opt.isDefault = jsonBool(rec, 'isDefault', false);
      opt.broken = jsonStr(rec, 'broken', '');
      out.push(opt);
    }
    return out;
  }

  async agentPresetSelect(sessionId: string, agentPreset: string): Promise<string> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentPreset)) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'Invalid agent preset identifier.');
    }
    const args: Record<string, Object> = {
      'agentId': sessionId,
      'agentPreset': agentPreset
    };
    const val: Object = await this.callValue('agentPresets/select', args);
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
    const root: Record<string, Object> | undefined = asRecord(val);
    const selected: string = root !== undefined ? jsonStr(root, 'agentPreset', '') : '';
    return selected.length > 0 ? selected : agentPreset;
  }

  // -------------------- Feedback & Queue & Compaction --------------------

  async messageFeedbackList(sessionId: string): Promise<FeedbackEntry[]> {
    const request: Record<string, Object> = { 'sessionId': sessionId };
    const args: Record<string, Object> = { 'request': request };
    const val: Object = await this.callValue('messageFeedback/list', args);
    const root: Record<string, Object> | undefined = asRecord(val);
    const items: Object[] = root !== undefined ? (asArray(root['items']) ?? []) : [];
    const out: FeedbackEntry[] = [];
    for (const item of items) {
      const rec: Record<string, Object> | undefined = asRecord(item);
      if (rec === undefined) {
        continue;
      }
      const messageId: string = jsonStr(rec, 'messageId', '');
      const rating: string = jsonStr(rec, 'rating', '');
      if (messageId.length === 0 || (rating !== 'positive' && rating !== 'negative')) {
        continue;
      }
      const entry = new FeedbackEntry();
      entry.messageId = messageId;
      entry.rating = rating;
      entry.version = jsonStr(rec, 'version', '');
      out.push(entry);
    }
    return out;
  }

  async messageFeedbackPut(sessionId: string, messageId: string, rating: string): Promise<FeedbackEntry> {
    if (rating !== 'positive' && rating !== 'negative') {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'Invalid feedback rating.');
    }
    const existing: FeedbackEntry[] = await this.messageFeedbackList(sessionId);
    let ifVersion: string = '';
    for (const item of existing) {
      if (item.messageId === messageId) {
        ifVersion = item.version;
        break;
      }
    }
    const request: Record<string, Object> = {
      'sessionId': sessionId,
      'messageId': messageId,
      'rating': rating,
      'ifVersion': ifVersion.length > 0 ? ifVersion : (JSON.parse('null') as Object)
    };
    const args: Record<string, Object> = { 'request': request };
    const val: Object = await this.callValue('messageFeedback/put', args);
    const rec: Record<string, Object> | undefined = asRecord(val);
    const saved = new FeedbackEntry();
    saved.messageId = messageId;
    saved.rating = rating;
    saved.version = rec !== undefined ? jsonStr(rec, 'version', '') : '';
    return saved;
  }

  async sessionUpdateQueue(sessionId: string, itemId: string, kind: string): Promise<void> {
    const action: Record<string, Object> = { 'kind': kind };
    const request: Record<string, Object> = {
      'sessionId': sessionId,
      'itemId': itemId,
      'action': action
    };
    const args: Record<string, Object> = { 'request': request };
    await this.callValue('session/updateQueue', args);
  }

  async submitCompaction(sessionId: string, requestId: string, budgetMs?: number): Promise<CompactionStatus> {
    const raw: Object = await this.gateway.submitCompaction(sessionId, requestId, budgetMs);
    const rec: Record<string, Object> | undefined = asRecord(raw);
    const status = new CompactionStatus();
    status.sessionId = sessionId;
    if (rec !== undefined) {
      status.operationId = jsonStr(rec, 'operationId', '');
      status.state = jsonStr(rec, 'state', 'accepted');
      status.message = jsonStr(rec, 'message', '');
    }
    return status;
  }

  async compactionStatus(sessionId: string, operationId: string): Promise<CompactionStatus> {
    const raw: Object = await this.gateway.compactionStatus(sessionId, operationId);
    const rec: Record<string, Object> | undefined = asRecord(raw);
    const status = new CompactionStatus();
    status.sessionId = sessionId;
    status.operationId = operationId;
    if (rec !== undefined) {
      status.state = jsonStr(rec, 'state', '');
      status.message = jsonStr(rec, 'message', '');
    }
    return status;
  }

  async cancelCompaction(sessionId: string, operationId: string): Promise<CompactionStatus> {
    const raw: Object = await this.gateway.cancelCompaction(sessionId, operationId);
    const rec: Record<string, Object> | undefined = asRecord(raw);
    const status = new CompactionStatus();
    status.sessionId = sessionId;
    status.operationId = operationId;
    if (rec !== undefined) {
      status.state = jsonStr(rec, 'state', 'cancelled');
      status.message = jsonStr(rec, 'message', '');
    }
    return status;
  }

  // -------------------- Workspace Files & Office Preview --------------------

  async listFiles(sessionId: string, dirPath: string): Promise<WorkspaceDirectory> {
    const args: Record<string, Object> = {
      'workspaceFileScopeId': sessionId,
      'path': dirPath.length === 0 ? '.' : dirPath
    };
    const val: Object = await this.callValue('workspaceFiles/list', args);
    const root: Record<string, Object> | undefined = asRecord(val);
    const out = new WorkspaceDirectory();
    if (root === undefined) {
      return out;
    }
    out.path = jsonStr(root, 'path', dirPath);
    out.truncated = jsonBool(root, 'truncated', false);
    const rawEntries: Object[] = asArray(root['entries']) ?? [];
    for (const item of rawEntries) {
      const rec: Record<string, Object> | undefined = asRecord(item);
      if (rec === undefined) {
        continue;
      }
      const name: string = jsonStr(rec, 'name', '');
      if (name.length === 0) {
        continue;
      }
      const entry = new WorkspaceFileEntry();
      entry.name = name;
      entry.type = jsonStr(rec, 'type', 'file');
      entry.size = jsonNum(rec, 'size', -1);
      out.entries.push(entry);
    }
    return out;
  }

  /** Shallow workspace tree for `@` file mention menu: root plus first-level subdirectories. */
  async loadWorkspaceFileRefs(sessionId: string): Promise<WorkspaceFileRef[]> {
    const refs: WorkspaceFileRef[] = [];
    const root: WorkspaceDirectory = await this.listFiles(sessionId, '');
    const dirs: WorkspaceFileEntry[] = [];
    for (const entry of root.entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const ref = new WorkspaceFileRef();
      ref.path = entry.name;
      ref.kind = entry.type === 'directory' ? 'directory' : 'file';
      refs.push(ref);
      if (entry.type === 'directory') {
        dirs.push(entry);
      }
    }
    const maxDirs: number = Math.min(dirs.length, 12);
    for (let i = 0; i < maxDirs; i++) {
      const dir = dirs[i];
      try {
        const sub: WorkspaceDirectory = await this.listFiles(sessionId, dir.name);
        for (const entry of sub.entries) {
          if (entry.name.startsWith('.')) {
            continue;
          }
          const ref = new WorkspaceFileRef();
          ref.path = dir.name + '/' + entry.name;
          ref.kind = entry.type === 'directory' ? 'directory' : 'file';
          refs.push(ref);
        }
      } catch {
        // Unreadable subdirectories are omitted from mentions.
      }
    }
    return refs;
  }

  async readFile(sessionId: string, filePath: string, offset: number = 1, limit: number = 200): Promise<WorkspaceText> {
    const range: Record<string, Object> = { 'offset': offset, 'limit': limit };
    const args: Record<string, Object> = {
      'workspaceFileScopeId': sessionId,
      'path': filePath,
      'range': range
    };
    const val: Object = await this.callValue('workspaceFiles/read', args);
    const root: Record<string, Object> | undefined = asRecord(val);
    const out = new WorkspaceText();
    if (root !== undefined) {
      out.absolutePath = jsonStr(root, 'absolutePath', filePath);
      out.version = jsonStr(root, 'version', '');
      out.text = jsonStr(root, 'text', '');
      out.offset = jsonNum(root, 'offset', offset);
      out.lines = jsonNum(root, 'lines', 0);
      out.eof = jsonBool(root, 'eof', true);
    }
    return out;
  }

  async statFile(sessionId: string, filePath: string): Promise<WorkspaceFileStat> {
    const args: Record<string, Object> = {
      'workspaceFileScopeId': sessionId,
      'path': filePath
    };
    const val: Object = await this.callValue('workspaceFiles/stat', args);
    const root: Record<string, Object> | undefined = asRecord(val);
    const out = new WorkspaceFileStat();
    if (root !== undefined) {
      out.absolutePath = jsonStr(root, 'absolutePath', filePath);
      out.version = jsonStr(root, 'version', '');
      out.bytes = jsonNum(root, 'bytes', 0);
    }
    return out;
  }

  async readBytes(sessionId: string, filePath: string, offset: number = 0,
    length: number = 512 * 1024): Promise<WorkspaceFileBytes> {
    const range: Record<string, Object> = { 'offset': offset, 'length': length };
    const args: Record<string, Object> = {
      'workspaceFileScopeId': sessionId,
      'path': filePath,
      'range': range
    };
    const maxBytes: number = 4 * Math.ceil(length / 3) + 64 * 1024;
    const val: Object = await this.callValue('workspaceFiles/readBytes', args, undefined, maxBytes);
    const root: Record<string, Object> | undefined = asRecord(val);
    const out = new WorkspaceFileBytes();
    if (root !== undefined) {
      out.absolutePath = jsonStr(root, 'absolutePath', filePath);
      out.version = jsonStr(root, 'version', '');
      out.bytes = jsonNum(root, 'bytes', 0);
      out.offset = jsonNum(root, 'offset', offset);
      out.eof = jsonBool(root, 'eof', true);
      const b64: string = jsonStr(root, 'data', '');
      if (b64.length > 0) {
        out.data = base64ToBytes(b64);
      }
    }
    return out;
  }

  async officeGeneration(): Promise<string> {
    const val: Object = await this.callValue('officeToPdf/generation', {}, OFFICE_PREVIEW_TIMEOUT_MS);
    if (typeof val === 'string') {
      return val;
    }
    const rec: Record<string, Object> | undefined = asRecord(val);
    return rec !== undefined ? jsonStr(rec, 'generation', '') : '';
  }

  async renderOfficePdf(sessionId: string, filePath: string): Promise<WorkspaceOfficeRender> {
    const args: Record<string, Object> = {
      'workspaceFileScopeId': sessionId,
      'path': filePath,
      'priority': 'foreground'
    };
    const val: Object = await this.callValue(
      'officeToPdf/render', args, OFFICE_PREVIEW_TIMEOUT_MS, OFFICE_PREVIEW_MAX_RESPONSE_BYTES);
    const root: Record<string, Object> | undefined = asRecord(val);
    const out = new WorkspaceOfficeRender();
    if (root !== undefined) {
      out.absolutePath = jsonStr(root, 'absolutePath', filePath);
      out.version = jsonStr(root, 'version', '');
      out.bytes = jsonNum(root, 'bytes', 0);
      out.offset = jsonNum(root, 'offset', 0);
      out.eof = jsonBool(root, 'eof', true);
      out.generation = jsonStr(root, 'generation', '');
      const fonts: Object[] = asArray(root['missingFonts']) ?? [];
      for (const f of fonts) {
        if (typeof f === 'string') {
          out.missingFonts.push(f);
        }
      }
      const b64: string = jsonStr(root, 'data', '');
      if (b64.length > 0) {
        out.data = base64ToBytes(b64);
      }
    }
    return out;
  }

  // -------------------- Prompt & Workspace File Uploads --------------------

  async fileUpload(sessionId: string, base64Data: string, name?: string): Promise<FileUploadReceipt> {
    const request: Record<string, Object> = { 'data': base64Data };
    if (name !== undefined && name.length > 0) {
      request['name'] = name;
    }
    const args: Record<string, Object> = {
      'agentId': sessionId,
      'request': request
    };
    const val: Object = await this.callValue('fileUploads/upload', args);
    const root: Record<string, Object> | undefined = asRecord(val);
    const receipt = new FileUploadReceipt();
    if (root !== undefined) {
      receipt.receiptId = jsonStr(root, 'receiptId', '');
      const fileRec: Record<string, Object> | undefined = asRecord(root['file']);
      if (fileRec !== undefined) {
        receipt.name = jsonStr(fileRec, 'name', name ?? '');
        receipt.bytes = jsonNum(fileRec, 'bytes', 0);
      }
    }
    return receipt;
  }

  /**
   * Upload a file into the Host workspace root via `workspace.upload.{open,chunk,commit,abort}`.
   */
  async workspaceUploadFile(
    sessionId: string,
    name: string,
    bytes: Uint8Array,
    onProgress?: (sent: number, total: number) => void
  ): Promise<WorkspaceUploadResult> {
    const uploadId: string = randomUuid();
    const totalBytes: number = bytes.byteLength;
    let opened = false;
    let committed = false;
    try {
      const openParams: Record<string, Object> = {
        'sessionId': sessionId,
        'uploadId': uploadId,
        'name': name,
        'totalBytes': totalBytes
      };
      const openResRaw: Object = await this.core.rpc('workspace.upload.open', openParams, undefined, 'workspace.upload.open');
      opened = true;
      const openRes: Record<string, Object> | undefined = asRecord(openResRaw);
      let chunkSize: number = openRes !== undefined ? jsonNum(openRes, 'chunkBytes', UPLOAD_CHUNK_BYTES) : UPLOAD_CHUNK_BYTES;
      if (chunkSize < 1 || chunkSize > UPLOAD_CHUNK_BYTES) {
        chunkSize = UPLOAD_CHUNK_BYTES;
      }
      if (onProgress !== undefined) {
        onProgress(0, totalBytes);
      }
      let offset = 0;
      while (offset < totalBytes) {
        const end: number = Math.min(offset + chunkSize, totalBytes);
        const slice: Uint8Array = bytes.subarray(offset, end);
        const chunkParams: Record<string, Object> = {
          'sessionId': sessionId,
          'uploadId': uploadId,
          'offset': offset,
          'data': bytesToBase64(slice)
        };
        await this.core.rpc('workspace.upload.chunk', chunkParams, undefined, 'workspace.upload.chunk');
        offset = end;
        if (onProgress !== undefined) {
          onProgress(offset, totalBytes);
        }
      }
      const commitParams: Record<string, Object> = {
        'sessionId': sessionId,
        'uploadId': uploadId
      };
      const commitRaw: Object = await this.core.rpc('workspace.upload.commit', commitParams, undefined, 'workspace.upload.commit');
      const commitRes: Record<string, Object> | undefined = asRecord(commitRaw);
      const result = new WorkspaceUploadResult();
      result.name = commitRes !== undefined ? jsonStr(commitRes, 'name', name) : name;
      result.path = commitRes !== undefined ? jsonStr(commitRes, 'path', './' + name) : './' + name;
      result.bytes = commitRes !== undefined ? jsonNum(commitRes, 'bytes', totalBytes) : totalBytes;
      committed = true;
      return result;
    } catch (error) {
      if (opened && !committed) {
        const abortParams: Record<string, Object> = { 'sessionId': sessionId, 'uploadId': uploadId };
        await this.core.rpc('workspace.upload.abort', abortParams, 5000, 'workspace.upload.abort')
          .catch(() => undefined);
      }
      throw toGatewayError(error as Object);
    }
  }

  // -------------------- Background Jobs --------------------

  async watchJobs(sessionId: string, handler: StreamHandler): Promise<RemoteGatewayStream> {
    const request: Record<string, Object> = { 'sessionId': sessionId };
    const args: Record<string, Object> = { 'request': request };
    const payload: Record<string, Object> = { 'args': args };
    return this.gateway.open('job/list', payload, handler);
  }

  async followJob(sessionId: string, jobId: string, handler: StreamHandler, fromOffset?: number): Promise<RemoteGatewayStream> {
    const request: Record<string, Object> = { 'sessionId': sessionId, 'jobId': jobId };
    if (fromOffset !== undefined && fromOffset >= 0) {
      request['from'] = fromOffset;
    }
    const args: Record<string, Object> = { 'request': request };
    const payload: Record<string, Object> = { 'args': args };
    return this.gateway.open('job/follow', payload, handler);
  }

  async killJob(sessionId: string, jobId: string): Promise<string> {
    const request: Record<string, Object> = { 'sessionId': sessionId, 'jobId': jobId };
    const args: Record<string, Object> = { 'request': request };
    const val: Object = await this.callValue('job/kill', args);
    const rec: Record<string, Object> | undefined = asRecord(val);
    return rec !== undefined ? jsonStr(rec, 'outcome', 'requested') : 'requested';
  }

  // -------------------- Interactive Terminals --------------------

  async terminalEnvironment(sessionId: string): Promise<TerminalEnv> {
    const args: Record<string, Object> = { 'agentId': sessionId };
    const val: Object = await this.callValue('terminal/environment', args);
    const rec: Record<string, Object> | undefined = asRecord(val);
    const env = new TerminalEnv();
    if (rec !== undefined) {
      env.maxInputBytes = jsonNum(rec, 'maxInputBytes', 4096);
      env.maxCols = jsonNum(rec, 'maxCols', 240);
      env.maxRows = jsonNum(rec, 'maxRows', 100);
    }
    return env;
  }

  async listTerminals(sessionId: string): Promise<TerminalInfo[]> {
    const args: Record<string, Object> = { 'sessionId': sessionId };
    const val: Object = await this.callValue('terminal/list', args);
    const direct: Object[] | undefined = asArray(val);
    const root: Record<string, Object> | undefined = asRecord(val);
    const rows: Object[] = direct !== undefined ? direct : (root !== undefined ? (asArray(root['items']) ?? []) : []);
    const out: TerminalInfo[] = [];
    for (const item of rows) {
      const info: TerminalInfo | undefined = parseTerminalInfo(item);
      if (info !== undefined) {
        out.push(info);
      }
    }
    return out;
  }

  async createTerminal(sessionId: string, id: string, cols: number, rows: number): Promise<TerminalInfo> {
    const request: Record<string, Object> = { 'id': id, 'cols': cols, 'rows': rows };
    const args: Record<string, Object> = { 'agentId': sessionId, 'request': request };
    const val: Object = await this.callValue('terminal/create', args);
    const parsed: TerminalInfo | undefined = parseTerminalInfo(val);
    if (parsed !== undefined) {
      return parsed;
    }
    const fallback = new TerminalInfo();
    fallback.id = id;
    fallback.title = id;
    fallback.cols = cols;
    fallback.rows = rows;
    return fallback;
  }

  async retainTerminal(sessionId: string, id: string, handler: StreamHandler): Promise<RemoteGatewayStream> {
    const args: Record<string, Object> = { 'sessionId': sessionId, 'id': id };
    const payload: Record<string, Object> = { 'args': args };
    return this.gateway.open('terminal/retain', payload, handler);
  }

  async followTerminal(sessionId: string, id: string, attachmentId: string, handler: StreamHandler): Promise<RemoteGatewayStream> {
    const args: Record<string, Object> = { 'agentId': sessionId, 'id': id, 'attachmentId': attachmentId };
    const payload: Record<string, Object> = { 'args': args };
    return this.gateway.open('terminal/follow', payload, handler);
  }

  async writeTerminal(sessionId: string, id: string, attachmentId: string, data: string): Promise<void> {
    const args: Record<string, Object> = {
      'agentId': sessionId,
      'id': id,
      'attachmentId': attachmentId,
      'data': data
    };
    await this.callValue('terminal/write', args);
  }

  async resizeTerminal(sessionId: string, id: string, attachmentId: string, cols: number, rows: number): Promise<void> {
    const args: Record<string, Object> = {
      'agentId': sessionId,
      'id': id,
      'attachmentId': attachmentId,
      'cols': cols,
      'rows': rows
    };
    await this.callValue('terminal/resize', args);
  }

  async closeTerminal(sessionId: string, id: string): Promise<void> {
    const args: Record<string, Object> = { 'sessionId': sessionId, 'id': id };
    await this.callValue('terminal/close', args);
  }

  // -------------------- Schedules / Automation Extras --------------------

  async scheduleCatalog(): Promise<Record<string, Object>[]> {
    const val: Object = await this.callValue('schedule/catalog', {});
    const direct: Object[] | undefined = asArray(val);
    const root: Record<string, Object> | undefined = asRecord(val);
    const items: Object[] = direct !== undefined ? direct : (root !== undefined ? (asArray(root['items']) ?? []) : []);
    const out: Record<string, Object>[] = [];
    for (const item of items) {
      const rec: Record<string, Object> | undefined = asRecord(item);
      if (rec !== undefined) {
        out.push(rec);
      }
    }
    return out;
  }

  async scheduleCreate(sessionId: string, request: Record<string, Object>): Promise<Record<string, Object>> {
    const fullReq: Record<string, Object> = { 'sessionId': sessionId };
    for (const key of Object.keys(request)) {
      fullReq[key] = request[key];
    }
    const args: Record<string, Object> = { 'request': fullReq };
    const val: Object = await this.callValue('schedule/create', args);
    return asRecord(val) ?? {};
  }

  async scheduleUpdate(request: Record<string, Object>): Promise<Record<string, Object>> {
    const args: Record<string, Object> = { 'request': request };
    const val: Object = await this.callValue('schedule/update', args);
    return asRecord(val) ?? {};
  }

  // -------------------- Plugins & Settings Management --------------------

  async pluginListBundles(): Promise<PluginBundleInfo[]> {
    const val: Object = await this.callValue('pluginManager/listBundles', {});
    const rows: Object[] = asArray(val) ?? [];
    const out: PluginBundleInfo[] = [];
    for (const item of rows) {
      const rec: Record<string, Object> | undefined = asRecord(item);
      if (rec === undefined) {
        continue;
      }
      const name: string = jsonStr(rec, 'name', '');
      if (name.length === 0) {
        continue;
      }
      const info = new PluginBundleInfo();
      info.name = name;
      info.version = jsonStr(rec, 'version', '');
      info.description = jsonStr(rec, 'description', '');
      info.enabled = jsonBool(rec, 'enabled', true);
      out.push(info);
    }
    return out;
  }

  async pluginListPlugins(): Promise<PluginEntryInfo[]> {
    const val: Object = await this.callValue('pluginManager/listPlugins', {});
    const rows: Object[] = asArray(val) ?? [];
    const out: PluginEntryInfo[] = [];
    for (const item of rows) {
      const rec: Record<string, Object> | undefined = asRecord(item);
      if (rec === undefined) {
        continue;
      }
      const id: string = jsonStr(rec, 'id', jsonStr(rec, 'name', ''));
      if (id.length === 0) {
        continue;
      }
      const info = new PluginEntryInfo();
      info.id = id;
      info.name = jsonStr(rec, 'name', id);
      info.description = jsonStr(rec, 'description', '');
      info.enabled = jsonBool(rec, 'enabled', true);
      info.status = jsonStr(rec, 'status', '');
      info.bundleName = jsonStr(rec, 'bundle', jsonStr(rec, 'bundleName', ''));
      out.push(info);
    }
    return out;
  }

  async pluginSetEnabled(isBundle: boolean, target: string, enabled: boolean): Promise<string> {
    const endpoint: string = isBundle ? 'pluginManager/setBundleEnabled' : 'pluginManager/setPluginEnabled';
    const args: Record<string, Object> = isBundle
      ? { 'name': target, 'enabled': enabled }
      : { 'id': target, 'enabled': enabled };
    const val: Object = await this.callValue(endpoint, args);
    const rec: Record<string, Object> | undefined = asRecord(val);
    if (rec === undefined) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid plugin change result.');
    }
    const appState: string = jsonStr(rec, 'application', '');
    if (appState === 'failed') {
      const errRec: Record<string, Object> | undefined = asRecord(rec['error']);
      const code: string = errRec !== undefined ? jsonStr(errRec, 'code', 'FAILED') : 'FAILED';
      const diag: string = errRec !== undefined ? jsonStr(errRec, 'diagnostic', 'Plugin change failed.') : 'Plugin change failed.';
      throw new RemoteGatewayError(code, diag);
    }
    return appState.length > 0 ? appState : 'applied';
  }

  async settingsDescribe(): Promise<SettingsDescribeResult> {
    const val: Object = await this.callValue('settings/describe', {});
    const rec: Record<string, Object> | undefined = asRecord(val);
    if (rec === undefined) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned invalid settings.');
    }
    const result = new SettingsDescribeResult();
    result.writable = jsonBool(rec, 'writable', true);
    const rawNs: Object[] = asArray(rec['namespaces']) ?? [];
    for (const item of rawNs) {
      const nsRec: Record<string, Object> | undefined = asRecord(item);
      if (nsRec === undefined) {
        continue;
      }
      const ns: string = jsonStr(nsRec, 'ns', '');
      if (ns.length === 0) {
        continue;
      }
      const info = new SettingsNamespaceInfo();
      info.ns = ns;
      info.revision = jsonNum(nsRec, 'revision', 0);
      info.schema = jsonValue(nsRec, 'schema');
      info.value = asRecord(nsRec['value']) ?? {};
      result.namespaces.push(info);
    }
    return result;
  }

  async settingsMutate(ns: string, ops: SettingsPathOp[], expectedRevision: number): Promise<void> {
    const opList: Object[] = [];
    for (const item of ops) {
      const entry: Record<string, Object> = {
        'op': item.op,
        'path': item.path
      };
      if (item.value !== undefined) {
        entry['value'] = item.value;
      }
      opList.push(entry);
    }
    const args: Record<string, Object> = {
      'ns': ns,
      'ops': opList,
      'expectedRevision': expectedRevision
    };
    await this.callValue('settings/mutate', args);
  }
}

export function parseTerminalInfo(raw: Object | undefined): TerminalInfo | undefined {
  const rec: Record<string, Object> | undefined = asRecord(raw);
  if (rec === undefined) {
    return undefined;
  }
  const id: string = jsonStr(rec, 'id', '');
  if (id.length === 0) {
    return undefined;
  }
  const info = new TerminalInfo();
  info.id = id;
  info.title = jsonStr(rec, 'title', id);
  const shellRec: Record<string, Object> | undefined = asRecord(rec['shell']);
  info.shellName = shellRec !== undefined ? jsonStr(shellRec, 'name', '') : '';
  info.cwd = jsonStr(rec, 'cwd', '');
  info.state = jsonStr(rec, 'state', 'running');
  info.controllerId = jsonStr(rec, 'controllerId', '');
  info.cols = jsonNum(rec, 'cols', 80);
  info.rows = jsonNum(rec, 'rows', 24);
  const codeNum: number | undefined = asNum(rec['exitCode']);
  if (codeNum !== undefined) {
    info.hasExitCode = true;
    info.exitCode = codeNum;
  }
  return info;
}

export function parseBackgroundJob(raw: Object | undefined): BackgroundJob | undefined {
  const rec: Record<string, Object> | undefined = asRecord(raw);
  if (rec === undefined) {
    return undefined;
  }
  const id: string = jsonStr(rec, 'id', '');
  if (id.length === 0) {
    return undefined;
  }
  const job = new BackgroundJob();
  job.id = id;
  job.label = jsonStr(rec, 'label', id);
  job.kind = jsonStr(rec, 'kind', '');
  job.owner = jsonStr(rec, 'owner', '');
  job.status = jsonStr(rec, 'status', 'running');
  job.progress = jsonStr(rec, 'progress', '');
  job.detail = jsonStr(rec, 'detail', '');
  job.startedAt = jsonNum(rec, 'startedAt', 0);
  job.finishedAt = jsonNum(rec, 'finishedAt', 0);
  const outputRec: Record<string, Object> | undefined = asRecord(rec['output']);
  if (outputRec !== undefined) {
    job.outputTotal = jsonNum(outputRec, 'total', 0);
    job.outputEarliest = jsonNum(outputRec, 'earliest', 0);
  }
  return job;
}
