import { RemoteClientCore } from './RemoteClientCore';
import { asArray, asBool, asNum, asRecord, asStr, jsonNum, jsonStr } from '../protocol/Types';

export const BOT_OPERATIONS: string[] = [
  'state', 'models', 'efforts', 'providers', 'local-agents',
  'exchange', 'exchange-text', 'file-text', 'earlier', 'chat', 'run-stats', 'thinking', 'usage', 'room-progress', 'group-rows',
  'schedules', 'schedule-create', 'schedule-delete',
  'memory-view', 'memory-history', 'memory-ask', 'memory-forget', 'memory-restore',
  'folders', 'folder-list', 'team-workspace', 'set-prefs',
  'browser-takeover', 'browser-give-back', 'browser-stop',
  'create-bot', 'duplicate-bot', 'update-bot', 'delete-bot', 'set-main', 'set-flags', 'resume', 'bot-new-part', 'bot-open-part',
  'create-room', 'update-room', 'delete-room', 'stop-room-work', 'goal-draft', 'goal-control',
  'add-agent', 'agent-session', 'agent-adopt', 'agent-archive', 'agent-rename', 'remove-agent',
  'send', 'btw', 'btw-cancel', 'btw-delete', 'side-new', 'side-ask', 'side-cancel', 'side-close',
  'room-continue', 'answer-question', 'dismiss-question', 'dismiss-view', 'view-reply', 'approval-answer', 'stop-member-work'
];

export class BotEntry {
  id: string = '';
  sessionId: string = '';
  name: string = '';
  color: string = '';
  avatarShape: string = '';
  avatarImage: string = '';
  role: string = '';
  instructions: string = '';
  model: string = '';
  appliedModel: string = '';
  effort: string = '';
  engine: string = '';
  workDir: string = '';
  permission: string = '';
  isPrivate: boolean = false;
  main: boolean = false;
  pinned: boolean = false;
  hidden: boolean = false;
  waiting: boolean = false;
  preview: string = '';
  createdAt: number = 0;
}

export class BotRoom {
  id: string = '';
  sessionId: string = '';
  name: string = '';
  members: string[] = [];
  notice: string = '';
  admin: string = '';
  mode: string = '';
  workDir: string = '';
  permission: string = '';
  paused: boolean = false;
  pinned: boolean = false;
  hidden: boolean = false;
  preview: string = '';
  createdAt: number = 0;
}

export class BotBtwCard {
  id: string = '';
  botId: string = '';
  question: string = '';
  answer: string = '';
  status: string = '';
  createdAt: number = 0;
}

export class BotQuestionOption {
  label: string = '';
  description: string = '';
}

export class BotPendingQuestion {
  id: string = '';
  sessionId: string = '';
  header: string = '';
  question: string = '';
  detail: string = '';
  multiSelect: boolean = false;
  options: BotQuestionOption[] = [];
}

export class BotPendingApproval {
  id: string = '';
  sessionId: string = '';
  toolName: string = '';
  reason: string = '';
}

export class BotPendingView {
  id: string = '';
  sessionId: string = '';
  title: string = '';
  rawView: Record<string, Object> = {};
}

export class BotModelOption {
  id: string = '';
  provider: string = '';
  name: string = '';
}

export class BotUsageRow {
  key: string = '';
  label: string = '';
  tokens: number = 0;
  calls: number = 0;
  sharePct: number = 0;
  color: string = '#4D6BFE';
}

export class BotUsageSummary {
  totalTokens: number = 0;
  inputTokens: number = 0;
  cacheReadTokens: number = 0;
  cacheWriteTokens: number = 0;
  outputTokens: number = 0;
  totalCalls: number = 0;
  hitRatePct: number = 0;
  scanning: boolean = false;
  byOwner: BotUsageRow[] = [];
  byModel: BotUsageRow[] = [];
}

export class BotDispatchPlan {
  endpoint: string = 'send';
  payload: Record<string, Object> = {};
}

export class BotStateSnapshot {
  revision: number = -1;
  liveKey: string = '';
  modelsKey: string = '';
  workspaceId: string = '';
  mainBotId: string = '';
  bots: BotEntry[] = [];
  rooms: BotRoom[] = [];
  exchangeTurns: Record<string, Object> = {};
  btwSupported: boolean = false;
  btwCards: BotBtwCard[] = [];
  pendingQuestions: BotPendingQuestion[] = [];
  pendingViews: BotPendingView[] = [];
  approvals: BotPendingApproval[] = [];
  busyBotIds: string[] = [];
  busyRoomIds: string[] = [];
  waitingIds: string[] = [];
  models: BotModelOption[] = [];
  defaultModel: string = '';
  browserEnabled: boolean = false;
  memoryEnabled: boolean = false;
  readOnlyReason: string = '';
  rawState: Record<string, Object> = {};
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function extractTrueKeys(record: Record<string, Object> | undefined): string[] {
  if (record === undefined) return [];
  const out: string[] = [];
  const keys = Object.keys(record);
  for (const k of keys) {
    const val = record[k];
    if (val === true || (asArray(val)?.length ?? 0) > 0 || (asRecord(val) !== undefined)) {
      out.push(k);
    }
  }
  return out;
}

function parseBtwCards(rawMap: Record<string, Object> | undefined): BotBtwCard[] {
  if (rawMap === undefined) return [];
  const out: BotBtwCard[] = [];
  const keys = Object.keys(rawMap);
  for (const key of keys) {
    const entry = rawMap[key];
    const list = asArray(entry);
    if (list !== undefined) {
      for (const item of list) {
        const rec = asRecord(item);
        if (rec === undefined) continue;
        const card = new BotBtwCard();
        card.id = jsonStr(rec, 'id', key + ':' + out.length);
        card.botId = jsonStr(rec, 'botId', key);
        card.question = jsonStr(rec, 'question', jsonStr(rec, 'prompt', ''));
        card.answer = jsonStr(rec, 'answer', jsonStr(rec, 'text', ''));
        card.status = jsonStr(rec, 'status', card.answer.length > 0 ? 'done' : 'answering');
        card.createdAt = jsonNum(rec, 'createdAt', 0);
        out.push(card);
      }
    } else {
      const rec = asRecord(entry);
      if (rec !== undefined) {
        const card = new BotBtwCard();
        card.id = jsonStr(rec, 'id', key);
        card.botId = jsonStr(rec, 'botId', '');
        card.question = jsonStr(rec, 'question', jsonStr(rec, 'prompt', ''));
        card.answer = jsonStr(rec, 'answer', jsonStr(rec, 'text', ''));
        card.status = jsonStr(rec, 'status', card.answer.length > 0 ? 'done' : 'answering');
        card.createdAt = jsonNum(rec, 'createdAt', 0);
        out.push(card);
      }
    }
  }
  return out;
}

function parsePendingQuestions(rawMap: Record<string, Object> | undefined): BotPendingQuestion[] {
  if (rawMap === undefined) return [];
  const out: BotPendingQuestion[] = [];
  for (const sessionId of Object.keys(rawMap)) {
    const rec = asRecord(rawMap[sessionId]);
    if (rec === undefined) continue;
    const q = new BotPendingQuestion();
    q.id = jsonStr(rec, 'id', sessionId);
    q.sessionId = sessionId;
    q.header = jsonStr(rec, 'header', '');
    q.question = jsonStr(rec, 'question', '');
    q.detail = jsonStr(rec, 'detail', '');
    q.multiSelect = asBool(rec['multiSelect']) === true;
    const rawOpts = asArray(rec['options']) ?? [];
    for (const rawOpt of rawOpts) {
      const opt = new BotQuestionOption();
      if (typeof rawOpt === 'string') {
        opt.label = rawOpt;
      } else {
        const optRec = asRecord(rawOpt);
        if (optRec !== undefined) {
          opt.label = jsonStr(optRec, 'label', '');
          opt.description = jsonStr(optRec, 'description', '');
        }
      }
      if (opt.label.length > 0) {
        q.options.push(opt);
      }
    }
    if (q.question.length > 0 || q.header.length > 0 || q.options.length > 0) {
      out.push(q);
    }
  }
  return out;
}

function parsePendingViews(rawMap: Record<string, Object> | undefined): BotPendingView[] {
  if (rawMap === undefined) return [];
  const out: BotPendingView[] = [];
  for (const sessionId of Object.keys(rawMap)) {
    const rec = asRecord(rawMap[sessionId]);
    if (rec === undefined) continue;
    const viewBody = asRecord(rec['view']);
    if (viewBody === undefined) continue;
    const v = new BotPendingView();
    v.id = jsonStr(rec, 'id', sessionId);
    v.sessionId = sessionId;
    v.title = jsonStr(rec, 'title', jsonStr(viewBody, 'title', ''));
    v.rawView = viewBody;
    out.push(v);
  }
  return out;
}

function parseApprovals(rawArr: Object[] | undefined): BotPendingApproval[] {
  if (rawArr === undefined) return [];
  const out: BotPendingApproval[] = [];
  for (const raw of rawArr) {
    const rec = asRecord(raw);
    if (rec === undefined) continue;
    const id = jsonStr(rec, 'id', jsonStr(rec, 'approvalId', ''));
    if (id.length === 0) continue;
    const ap = new BotPendingApproval();
    ap.id = id;
    ap.sessionId = jsonStr(rec, 'sessionId', '');
    ap.toolName = jsonStr(rec, 'toolName', jsonStr(rec, 'tool', 'Tool'));
    ap.reason = jsonStr(rec, 'reason', jsonStr(rec, 'detail', ''));
    out.push(ap);
  }
  return out;
}

export function parseBotState(raw: Object, previous?: BotStateSnapshot): BotStateSnapshot {
  const rec = asRecord(raw);
  if (rec === undefined) {
    throw new Error('DS-Bot 返回状态格式无效');
  }
  // Incremental delta response
  if (asBool(rec['unchanged']) === true && previous !== undefined) {
    const snap = cloneBotSnapshot(previous);
    const exchangeTurns = asRecord(rec['exchangeTurns']);
    if (exchangeTurns !== undefined) snap.exchangeTurns = exchangeTurns;
    const nextRev = asNum(rec['revision']);
    if (nextRev !== undefined) snap.revision = nextRev;
    const nextLive = asStr(rec['liveKey']);
    if (nextLive !== undefined && nextLive.length > 0) snap.liveKey = nextLive;
    const workObj = asRecord(rec['work']);
    if (workObj !== undefined) {
      snap.busyBotIds = extractTrueKeys(asRecord(workObj['bots']));
      snap.busyRoomIds = extractTrueKeys(asRecord(workObj['rooms']));
      snap.waitingIds = extractTrueKeys(asRecord(workObj['waiting']));
      const workApprovals = asArray(workObj['approvals']);
      if (workApprovals !== undefined) {
        snap.approvals = parseApprovals(workApprovals);
      }
    }
    const btwObj = asRecord(rec['btwCards']);
    if (btwObj !== undefined) {
      snap.btwSupported = true;
      snap.btwCards = parseBtwCards(btwObj);
    }
    return snap;
  }

  const rawBots = asArray(rec['bots']);
  const rawRooms = asArray(rec['rooms']);
  if (rawBots === undefined || rawRooms === undefined) {
    throw new Error('DS-Bot 缺少 bots 或 rooms 列表');
  }
  const snap = new BotStateSnapshot();
  snap.exchangeTurns = asRecord(rec['exchangeTurns']) ?? {};
  snap.revision = jsonNum(rec, 'revision', -1);
  snap.liveKey = jsonStr(rec, 'liveKey', '');
  snap.modelsKey = jsonStr(rec, 'modelsKey', '');
  snap.workspaceId = jsonStr(rec, 'workspaceId', '');
  snap.mainBotId = jsonStr(rec, 'mainBotId', '');
  snap.readOnlyReason = jsonStr(rec, 'readOnly', '');

  const mainIds: string[] = [];
  const rawMainIds = asArray(rec['mainBotIds']) ?? [];
  for (const id of rawMainIds) {
    const s = asStr(id);
    if (s !== undefined && s.length > 0) mainIds.push(s);
  }
  if (snap.mainBotId.length > 0 && !mainIds.includes(snap.mainBotId)) {
    mainIds.push(snap.mainBotId);
  }

  for (const rawBot of rawBots) {
    const b = asRecord(rawBot);
    if (b === undefined) continue;
    const id = jsonStr(b, 'id', '');
    const sessionId = jsonStr(b, 'sessionId', '');
    if (id.length === 0 || sessionId.length === 0) continue;
    const entry = new BotEntry();
    entry.id = id;
    entry.sessionId = sessionId;
    entry.name = jsonStr(b, 'name', id);
    entry.color = jsonStr(b, 'color', '');
    const avatarRec = asRecord(b['avatar']);
    entry.avatarShape = avatarRec !== undefined ? jsonStr(avatarRec, 'shape', '') : '';
    entry.avatarImage = avatarRec !== undefined ? jsonStr(avatarRec, 'image', '') : '';
    entry.role = jsonStr(b, 'role', '');
    entry.instructions = jsonStr(b, 'instructions', '');
    entry.model = jsonStr(b, 'model', '');
    entry.appliedModel = jsonStr(b, 'appliedModel', '');
    entry.effort = jsonStr(b, 'effort', '');
    entry.engine = jsonStr(b, 'engine', '');
    entry.workDir = jsonStr(b, 'workDir', '');
    entry.permission = jsonStr(b, 'permission', '');
    entry.isPrivate = asBool(b['private']) === true;
    entry.main = mainIds.length > 0 ? mainIds.includes(id) : asBool(b['main']) === true;
    entry.pinned = asBool(b['pinned']) === true;
    entry.hidden = asBool(b['hidden']) === true;
    entry.waiting = asBool(b['waiting']) === true;
    entry.preview = compactText(jsonStr(b, 'preview', ''));
    entry.createdAt = jsonNum(b, 'createdAt', 0);
    snap.bots.push(entry);
  }

  for (const rawRoom of rawRooms) {
    const r = asRecord(rawRoom);
    if (r === undefined) continue;
    const id = jsonStr(r, 'id', '');
    if (id.length === 0) continue;
    const room = new BotRoom();
    room.id = id;
    room.sessionId = jsonStr(r, 'sessionId', id);
    room.name = jsonStr(r, 'name', id);
    const rawMembers = asArray(r['members']) ?? [];
    for (const m of rawMembers) {
      const s = asStr(m);
      if (s !== undefined && s.length > 0) room.members.push(s);
    }
    room.notice = jsonStr(r, 'notice', '');
    room.admin = jsonStr(r, 'admin', '');
    room.mode = jsonStr(r, 'mode', '');
    room.workDir = jsonStr(r, 'workDir', '');
    room.permission = jsonStr(r, 'permission', '');
    room.paused = asBool(r['paused']) === true;
    room.pinned = asBool(r['pinned']) === true;
    room.hidden = asBool(r['hidden']) === true;
    room.preview = compactText(jsonStr(r, 'preview', ''));
    room.createdAt = jsonNum(r, 'createdAt', 0);
    snap.rooms.push(room);
  }

  const workObj = asRecord(rec['work']);
  if (workObj !== undefined) {
    snap.busyBotIds = extractTrueKeys(asRecord(workObj['bots']));
    snap.busyRoomIds = extractTrueKeys(asRecord(workObj['rooms']));
    snap.waitingIds = extractTrueKeys(asRecord(workObj['waiting']));
  }
  const btwObj = asRecord(rec['btwCards']);
  snap.btwSupported = btwObj !== undefined;
  snap.btwCards = parseBtwCards(btwObj);
  snap.pendingQuestions = parsePendingQuestions(asRecord(rec['questions']));
  snap.pendingViews = parsePendingViews(asRecord(rec['views']));
  snap.approvals = parseApprovals(asArray(rec['approvals']));
  snap.defaultModel = jsonStr(rec, 'defaultModel', '');
  snap.browserEnabled = asBool(rec['browser']) === true;
  snap.memoryEnabled = asBool(rec['memory']) === true;
  snap.rawState = rec;

  const rawModels = asArray(rec['models']) ?? [];
  for (const rm of rawModels) {
    const m = asRecord(rm);
    if (m === undefined) continue;
    const id = jsonStr(m, 'id', jsonStr(m, 'model', ''));
    if (id.length === 0) continue;
    const opt = new BotModelOption();
    opt.id = id;
    opt.provider = jsonStr(m, 'provider', '');
    opt.name = jsonStr(m, 'name', jsonStr(m, 'label', id));
    snap.models.push(opt);
  }
  return snap;
}

function cloneBotSnapshot(src: BotStateSnapshot): BotStateSnapshot {
  const copy = new BotStateSnapshot();
  copy.revision = src.revision;
  copy.liveKey = src.liveKey;
  copy.modelsKey = src.modelsKey;
  copy.workspaceId = src.workspaceId;
  copy.mainBotId = src.mainBotId;
  copy.bots = src.bots.slice();
  copy.rooms = src.rooms.slice();
  copy.exchangeTurns = src.exchangeTurns;
  copy.btwSupported = src.btwSupported;
  copy.btwCards = src.btwCards.slice();
  copy.pendingQuestions = src.pendingQuestions.slice();
  copy.pendingViews = src.pendingViews.slice();
  copy.approvals = src.approvals.slice();
  copy.busyBotIds = src.busyBotIds.slice();
  copy.busyRoomIds = src.busyRoomIds.slice();
  copy.waitingIds = src.waitingIds.slice();
  copy.models = src.models.slice();
  copy.defaultModel = src.defaultModel;
  copy.browserEnabled = src.browserEnabled;
  copy.memoryEnabled = src.memoryEnabled;
  copy.readOnlyReason = src.readOnlyReason;
  copy.rawState = src.rawState;
  return copy;
}

export function buildBotDispatchPlan(state: BotStateSnapshot, targetId: string, draft: string): BotDispatchPlan {
  const message = draft.trim();
  if (message.length === 0) {
    throw new Error('消息不能为空');
  }
  if (state.readOnlyReason.length > 0) {
    throw new Error('当前 DS-Bot 处于只读状态');
  }
  let bot: BotEntry | undefined = undefined;
  for (const b of state.bots) {
    if (b.id === targetId || b.sessionId === targetId) {
      bot = b;
      break;
    }
  }
  let room: BotRoom | undefined = undefined;
  if (bot === undefined) {
    for (const r of state.rooms) {
      if (r.id === targetId || r.sessionId === targetId) {
        room = r;
        break;
      }
    }
  }
  if (bot === undefined && room === undefined) {
    throw new Error('未找到对应的 Bot 或群聊');
  }
  if (message === '/btw' || message.startsWith('/btw ')) {
    if (bot === undefined) {
      throw new Error('/btw 仅支持与单个 Bot 私聊使用');
    }
    if (!state.btwSupported) {
      throw new Error('当前主机不支持 /btw 旁白提问');
    }
    const question = message.slice(4).trim();
    if (question.length === 0) {
      throw new Error('请输入 /btw 问题内容');
    }
    const plan = new BotDispatchPlan();
    plan.endpoint = 'btw';
    plan.payload = { 'sessionId': bot.id, 'text': question };
    return plan;
  }
  const resolvedId = bot !== undefined ? bot.id : room!.id;
  const plan = new BotDispatchPlan();
  plan.endpoint = 'send';
  plan.payload = { 'sessionId': resolvedId, 'text': message };
  return plan;
}

export function parseUsageSummary(raw: Object, bots: BotEntry[]): BotUsageSummary {
  const summary = new BotUsageSummary();
  const rec = asRecord(raw);
  if (rec === undefined) return summary;
  summary.scanning = asBool(rec['scanning']) === true;
  const records = asArray(rec['records']) ?? asArray(rec['rows']) ?? asArray(rec['entries']) ?? [];
  const colors = ['#4D6BFE', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];
  const ownerMap = new Map<string, BotUsageRow>();
  const modelMap = new Map<string, BotUsageRow>();

  const botNameById = new Map<string, string>();
  for (const b of bots) {
    botNameById.set(b.id, b.name);
  }

  for (const item of records) {
    const r = asRecord(item);
    if (r === undefined) continue;
    const inp = jsonNum(r, 'inputTokens', jsonNum(r, 'input', 0));
    const cr = jsonNum(r, 'cacheReadTokens', jsonNum(r, 'cacheRead', 0));
    const cw = jsonNum(r, 'cacheWriteTokens', jsonNum(r, 'cacheWrite', 0));
    const out = jsonNum(r, 'outputTokens', jsonNum(r, 'output', 0));
    const total = jsonNum(r, 'totalTokens', jsonNum(r, 'tokens', inp + cr + cw + out));
    const calls = Math.max(1, jsonNum(r, 'calls', 1));
    summary.inputTokens += inp;
    summary.cacheReadTokens += cr;
    summary.cacheWriteTokens += cw;
    summary.outputTokens += out;
    summary.totalTokens += total;
    summary.totalCalls += calls;

    const ownerKey = jsonStr(r, 'ownerId', jsonStr(r, 'botId', jsonStr(r, 'owner', 'other')));
    const ownerLabel = jsonStr(r, 'ownerName', botNameById.get(ownerKey) ?? ownerKey);
    let oRow = ownerMap.get(ownerKey);
    if (oRow === undefined) {
      oRow = new BotUsageRow();
      oRow.key = ownerKey;
      oRow.label = ownerLabel;
      oRow.color = colors[ownerMap.size % colors.length];
      ownerMap.set(ownerKey, oRow);
    }
    oRow.tokens += total;
    oRow.calls += calls;

    const modelKey = jsonStr(r, 'model', 'unknown');
    let mRow = modelMap.get(modelKey);
    if (mRow === undefined) {
      mRow = new BotUsageRow();
      mRow.key = modelKey;
      mRow.label = modelKey;
      mRow.color = colors[modelMap.size % colors.length];
      modelMap.set(modelKey, mRow);
    }
    mRow.tokens += total;
    mRow.calls += calls;
  }

  const cacheDenom = summary.inputTokens + summary.cacheReadTokens;
  summary.hitRatePct = cacheDenom > 0 ? Math.round((summary.cacheReadTokens / cacheDenom) * 100) : 0;

  ownerMap.forEach((row: BotUsageRow) => {
    row.sharePct = summary.totalTokens > 0 ? Math.round((row.tokens / summary.totalTokens) * 100) : 0;
    summary.byOwner.push(row);
  });
  modelMap.forEach((row: BotUsageRow) => {
    row.sharePct = summary.totalTokens > 0 ? Math.round((row.tokens / summary.totalTokens) * 100) : 0;
    summary.byModel.push(row);
  });
  summary.byOwner.sort((a: BotUsageRow, b: BotUsageRow) => b.tokens - a.tokens);
  summary.byModel.sort((a: BotUsageRow, b: BotUsageRow) => b.tokens - a.tokens);
  return summary;
}

export class BotRemoteClient {
  private core: RemoteClientCore;

  constructor(core: RemoteClientCore) {
    this.core = core;
  }

  async call(endpoint: string, payload: Record<string, Object> | undefined = undefined,
    timeoutMs: number = 15000): Promise<Object> {
    if (!BOT_OPERATIONS.includes(endpoint)) {
      throw new Error('不允许的 DS-Bot 操作: ' + endpoint);
    }
    const body: Record<string, Object> = payload !== undefined
      ? { 'endpoint': endpoint, 'payload': payload }
      : { 'endpoint': endpoint, 'payload': JSON.parse('null') as Object };
    const raw = await this.core.rpc('plugin.route.call', {
      'route': 'api/bot',
      'body': body
    }, timeoutMs);
    const resp = asRecord(raw);
    if (resp === undefined) {
      throw new Error('DS-Bot 插件响应无效');
    }
    const status = jsonNum(resp, 'status', 0);
    if (status === 404) {
      throw new Error('主机尚未安装 ds-bot 插件');
    }
    if (status === 503) {
      throw new Error('主机 ds-bot 服务暂不可用');
    }
    const jsonBody = asRecord(resp['json']);
    if (status !== 200 || jsonBody === undefined) {
      throw new Error('DS-Bot 请求失败 (HTTP ' + status + ')');
    }
    if (asBool(jsonBody['ok']) !== true) {
      const errRec = asRecord(jsonBody['error']);
      const msg = errRec !== undefined ? jsonStr(errRec, 'message', '') : '';
      throw new Error(msg.length > 0 ? msg : 'DS-Bot 操作失败');
    }
    const value = jsonBody['value'];
    return value !== undefined ? value : (JSON.parse('{}') as Object);
  }

  async loadState(previous?: BotStateSnapshot): Promise<BotStateSnapshot> {
    let query: Record<string, Object> | undefined = undefined;
    if (previous !== undefined && previous.revision >= 0 && previous.liveKey.length > 0) {
      query = {
        'since': previous.revision,
        'live': previous.liveKey
      };
      if (previous.modelsKey.length > 0) {
        query['models'] = previous.modelsKey;
      }
    }
    const val = await this.call('state', query, 12000);
    return parseBotState(val, previous);
  }

  async fetchUsage(bots: BotEntry[]): Promise<BotUsageSummary> {
    const val = await this.call('usage', { 'timeZone': 'Asia/Shanghai' }, 20000);
    return parseUsageSummary(val, bots);
  }

  async sendMessage(state: BotStateSnapshot, targetId: string, draft: string): Promise<string> {
    const plan = buildBotDispatchPlan(state, targetId, draft);
    await this.call(plan.endpoint, plan.payload, 20000);
    return plan.endpoint;
  }

  async stopWork(isRoom: boolean, roomId: string, botId: string = ''): Promise<void> {
    if (isRoom) {
      await this.call('stop-room-work', { 'roomId': roomId }, 10000);
    } else {
      if (botId.length === 0) throw new Error('停止群成员需要群聊和成员 ID');
      await this.call('stop-member-work', { 'roomId': roomId, 'botId': botId }, 10000);
    }
  }

  async cancelBtw(botId: string, cardId: string): Promise<void> {
    await this.call('btw-cancel', { 'sessionId': botId, 'id': cardId }, 10000);
  }

  async deleteBtw(botId: string, cardId: string): Promise<void> {
    await this.call('btw-delete', { 'sessionId': botId, 'cardId': cardId }, 10000);
  }

  async answerQuestion(sessionId: string, selected: string[], customText: string): Promise<void> {
    const val: Record<string, Object> = selected.length > 0
      ? { 'selected': selected }
      : { 'text': customText };
    await this.call('answer-question', { 'sessionId': sessionId, 'answer': val }, 12000);
  }

  async dismissQuestion(sessionId: string): Promise<void> {
    await this.call('dismiss-question', { 'sessionId': sessionId }, 10000);
  }

  async replyView(sessionId: string, viewId: string, action: string, values: Record<string, Object>): Promise<void> {
    await this.call('view-reply', {
      'sessionId': sessionId,
      'viewId': viewId,
      'action': action,
      'values': values
    }, 12000);
  }

  async dismissView(sessionId: string, viewId: string): Promise<void> {
    await this.call('dismiss-view', { 'sessionId': sessionId, 'viewId': viewId }, 10000);
  }

  async answerApproval(approvalId: string, allow: boolean): Promise<void> {
    await this.call('approval-answer', {
      'approvalId': approvalId,
      'choice': allow ? 'allow' : 'reject'
    }, 12000);
  }

  async createBot(name: string, role: string, instructions: string, model: string, workDir: string): Promise<void> {
    const payload: Record<string, Object> = { 'name': name, 'role': role, 'instructions': instructions };
    if (model.length > 0) payload['model'] = model;
    if (workDir.length > 0) payload['workDir'] = workDir;
    await this.call('create-bot', payload, 15000);
  }

  async deleteBot(botId: string): Promise<void> {
    await this.call('delete-bot', { 'id': botId }, 12000);
  }

  async setMainBot(botId: string): Promise<void> {
    await this.call('set-main', { 'id': botId }, 10000);
  }

  async createRoom(name: string, members: string[], notice: string): Promise<void> {
    await this.call('create-room', {
      'name': name,
      'members': members,
      'notice': notice
    }, 15000);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.call('delete-room', { 'id': roomId }, 12000);
  }

  async setPrefs(patch: Record<string, Object>): Promise<void> {
    await this.call('set-prefs', patch, 10000);
  }
}
