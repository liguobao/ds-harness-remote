import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { notificationManager } from '@kit.NotificationKit';
import { SecureStore, StoredServerConfig, SavedProfile } from './SecureStore';
import { RemoteServerApi, RemoteApiError, normalizeServerUrl, websocketUrl, QrLoginSession, QrLoginPoll,
  OAuthProvider, HostPresence, initClientVersion } from '../net/ServerApi';
import { CloseVerdict, RelayConnectionInfo, RelayTransport, RelayTransportOptions } from '../net/RelayTransport';
import { SecureTransport } from '../net/SecureTransport';
import { RemoteClientCore, RemoteClientError } from '../net/RemoteClientCore';
import { RemoteGateway, RemoteGatewayError, RemoteHostFeatures } from '../net/RemoteGateway';
import { HarnessAlphaClient, HarnessClientFrame, HarnessHistoryEntry, HarnessRemoteSession,
  DirectoryEntry, HarnessSchedule, HarnessScheduleDelivery, HarnessSessionEvent, HarnessWorkspace,
  HarnessWorkspaceSnapshot, HistoryPage, PromptImagePart } from '../net/HarnessClient';
import { DeviceIdentity, TokenPair, RemoteHostDevice, AuthorizedPeerDevice, AccountLoginResult } from '../model/Types';
import { asArray, asBool, asNum, asRecord, asStr, jsonStr, jsonNum } from '../protocol/Types';
import { randomId } from '../crypto/Bytes';
import { logInfo, logWarn, logError } from '../util/Log';
import { setEnglish, resolveEnglish, systemEnglish } from './I18n';
import { RtcBridge } from './RtcBridge';
import { NetworkMonitor, networkTypeLabel } from './NetworkMonitor';
import { NetTrace, TraceSample } from '../util/NetTrace';
import { LinkLog } from './LinkLog';
import { KeepAlive } from './KeepAlive';

// 首屏拉多少条历史：条数越多，主机经中继回放越久（更早的仍可 session/page 翻页）
const INITIAL_HISTORY_COUNT: number = 30;
// 最近看过的会话历史在内存里留几份，切回去可以立刻显示
const HISTORY_CACHE_LIMIT: number = 8;

export const PHASE_BOOT: string = 'boot';
export const PHASE_SETUP: string = 'setup';
export const PHASE_DEVICES: string = 'devices';
export const PHASE_CONNECTING: string = 'connecting';
export const PHASE_CHAT: string = 'chat';

/** Official public Server, used to prefill the setup screen and as the QR-login fallback
 *  so a fresh install never dials a dead placeholder address. */
/**
 * 本地专用版的默认服务器：局域网自建 server。
 *
 * 这个 fork 就是给「日常只连自家 LAN」用的，省得每次在登录页切服务器。
 * 官方服务器仍可在登录页手动改地址登录（不会删掉这个默认值）。
 */
export const DEFAULT_SERVER_URL: string = 'http://192.168.11.128:8080';
/** 本地专用版预填的账号。 */
export const DEFAULT_ACCOUNT: string = 'admin@dsh.local';

const MAX_TOOL_DETAIL_CHARS: number = 8000;

/** One rendered question inside a `question` chat card. */
export class ChatQuestion {
  id: string = '';
  question: string = '';
  detail: string = '';
  header: string = '';
  options: string[] = [];
  multiSelect: boolean = false;
  selectedLabels: string[] = [];
}

/** One row in the chat transcript. */
export class ChatItem {
  id: string = '';
  kind: string = ''; // 'user' | 'assistant' | 'tool' | 'approval' | 'question'
  role: string = '';
  text: string = '';
  reasoning: string = '';
  streaming: boolean = false;
  requestRpcId: string = '';
  sessionId: string = '';
  timestamp: number = 0;
  toolName: string = '';
  toolState: string = ''; // '' | 'running' | 'finished' | 'failed'
  summary: string = '';
  approvalId: string = '';
  approvalOutcome: string = ''; // '' pending | 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  frameRpcId: string = '';
  reason: string = '';
  questions: ChatQuestion[] = [];
  questionOutcome: string = ''; // '' pending | 'answered' | 'queued' | 'cancelled'
  /** 该消息对应的事件序号，用于「从这里分叉」。 */
  seq: number = 0;
  rev: number = 0;
  /** kind === 'notice' 时的提示级别：'' 普通 | 'warn' 需要用户处理 | 'error' 失败。 */
  noticeKind: string = '';
  /** notice 上的操作按钮要执行的斜杠命令（例如 '/compact'），空表示没有按钮。 */
  actionCommand: string = '';
  /** 用户消息里带的图片（标准 base64）；本地刚发的直接用，历史的按 attachmentId 拉。 */
  images: string[] = [];
  /** 历史图片的附件 id：拿到字节前先占位，下拉时逐张补。 */
  imageAttachmentIds: string[] = [];
  /**
   * 与 `imageAttachmentIds` 一一对应的完整 `ImageAttachmentRef`（JSON 字符串）。
   * 0.2.2+ 的主机 `session/attachment` 必须收到 mediaType/bytes/width/height 并逐项校验，
   * 只给 attachmentId 会被网关判参数不合法；历史记录里本来就存着完整引用，原样回传最稳。
   */
  imageRefs: string[] = [];
  /**
   * 用户消息里带的普通文件（主机只收 png/jpeg/webp/gif，HEIC 之类会落成 file part）。
   * 远端没有读文件字节的接口，所以这里只保留「名称 · 大小」用于展示，至少别把消息吞掉。
   */
  files: string[] = [];
}

/**
 * Application state machine: login -> devices -> connect -> chat.
 * The UI subscribes via `onUiUpdate` and copies the public fields into @State.
 */
/** commands/execute 的回执是 `{commandId, result:{kind,text}}`，文案在里层。 */
function commandReplyText(result: Record<string, Object> | undefined): string {
  if (result === undefined) {
    return '';
  }
  const inner: Record<string, Object> | undefined = asRecord(result['result']);
  if (inner !== undefined) {
    return jsonStr(inner, 'text', '');
  }
  return jsonStr(result, 'text', '');
}

export class AppRuntime {
  private store: SecureStore = new SecureStore();
  /** 应用沙箱目录（导出诊断文件用）。 */
  private filesDir: string = '';
  private config: StoredServerConfig | undefined = undefined;
  private identity: DeviceIdentity | undefined = undefined;
  private credentials: TokenPair | undefined = undefined;
  private core: RemoteClientCore | undefined = undefined;
  private harness: HarnessAlphaClient | undefined = undefined;
  private unsubscribeClose: (() => void) | undefined = undefined;
  /** 预热中的中继通道：还没交给 SecureTransport/Core 就失败时由 teardown 负责关掉，否则会漏一条 socket。 */
  private pendingRelay: RelayTransport | undefined = undefined;
  /** 已交给 Core 的那条中继通道：只为断线时读 closeVerdict（决定要不要继续自动重连）。 */
  private activeRelay: RelayTransport | undefined = undefined;
  /** 系统网络事件（断网/恢复/切网）。 */
  private netMonitor: NetworkMonitor | undefined = undefined;
  /** ArkWeb 里的 WebRTC 桥（LAN 直连用），由页面在 aboutToAppear 时挂进来。 */
  private rtcBridge: RtcBridge | undefined = undefined;
  /** 退回设备列表时保留连接的那台主机；空表示没有保活连接。 */
  keepAliveDeviceId: string = '';
  /** 这次连接最终用的数据面：'' | 'relay' | 'lan' | 'p2p' | 'turn'。 */
  transportLabel: string = '';
  /** 历史图片字节缓存：attachmentId -> base64（'' 表示取失败，别反复打主机）。 */
  private attachmentCache: Map<string, string> = new Map<string, string>();
  /** 已经尝试补过的附件，避免 hydrate 死循环。 */
  private fetchedAttachments: Map<string, string> = new Map<string, string>();
  /** 历史图片补水已排程（历史是异步帧回来的，不能在 openSession 里只跑一次）。 */
  private imageHydrateScheduled: boolean = false;
  /** 断线后的重连退避：逐次放大，最多 MAX_RECONNECT_ATTEMPTS 次后交回用户。 */
  private static readonly RECONNECT_DELAYS_MS: number[] = [1000, 2000, 4000, 8000, 15000, 30000];
  private static readonly MAX_RECONNECT_ATTEMPTS: number = 6;
  /** 在线状态探测预算（毫秒）：超时按「未知」处理，不挡连接。 */
  private static readonly PRESENCE_BUDGET_MS: number = 4000;
  /** session/list 的单次预算：中继下主机实测 9 秒上下，给足 20 秒再用重试兜底。 */
  private static readonly SESSION_LIST_BUDGET_MS: number = 20000;
  /**
   * 链路「算活着」的最大静默：服务端 25 秒一跳心跳，两个周期没消息就当作可疑。
   * 复用连接、回前台体检都用这个阈值——以前只有 90 秒看门狗，用户早就点不动了。
   */
  private static readonly LINK_STALE_MS: number = 45000;
  /** 一次连接（含握手、能力探测、订阅）的总预算：卡住就判超时，别让界面永远停在「正在连接」。 */
  private static readonly CONNECT_DEADLINE_MS: number = 30000;
  private refreshTimer: number = -1;
  /** In-flight credential renewal. The Server rotates the refresh token on every call and
   *  invalidates every token of this device when a spent one is presented again, so two
   *  concurrent refreshes would log the user out for good. */
  private authPromise: Promise<RemoteServerApi> | undefined = undefined;
  private connectCancelled: boolean = false;
  /** QR login state: the scanned URL plus the poll timer that watches it. */
  qrUrl: string = '';
  /** Login providers offered by the Server; empty until loaded. */
  providers: OAuthProvider[] = [];
  providerId: string = 'google';
  private qrId: string = '';
  private qrBaseUrl: string = '';
  private qrDeadline: number = 0;
  private qrTimer: number = -1;
  /** 最近一次成功连接的主机，断线自动重连时复用。 */
  private lastDeviceId: string = '';
  /** 会话列表失败后是否已经排过一次自动重试（防抖，别循环）。 */
  private sessionListAutoRetried: boolean = false;
  /** 上一次成功拉到的会话列表（按主机记）：抖动时侧栏不要一下清空。 */
  private sessionsSnapshot: HarnessRemoteSession[] = [];
  private sessionsSnapshotHost: string = '';
  /** 在会话页里重连时记下当前会话，连上后直接回到它，不从列表重新挑。 */
  private pendingResumeSessionId: string = '';
  /** 主机能力探测结果缓存：同一版本的主机能力是固定的，重连不必再问一遍（上游 #326 同一思路）。 */
  private featuresCacheKey: string = '';
  private featuresCacheValue: RemoteHostFeatures | undefined = undefined;
  private reconnectAttempt: number = 0;
  private reconnectTimer: number = -1;
  /** 退避耗尽后仍允许「网络恢复/回前台」再试一轮，否则用户只能手点或杀进程。 */
  private reconnectExhausted: boolean = false;
  /** 「等主机重新上线」的起始时刻（0 = 不在等）；此状态下不消耗重连次数，最多等 90 秒。 */
  private offlineWaitSince: number = 0;
  /**
   * 这次的失败是「恢复尝试」触发的：即使 reconnectAttempt 被清零，
   * connectDevice 的 catch 也必须继续按退避排下一次，否则网络刚回来那一下没连上就彻底停了。
   */
  private autoRecovering: boolean = false;
  /** 当前这次连接的看门狗（CONNECT_DEADLINE_MS 到点判超时）。 */
  private connectDeadlineTimer: number = -1;
  /** 系统网络是否掉过（掉过之后要把链路当作可疑，别信「WebSocket 还开着」）。 */
  private awaitingNetwork: boolean = false;
  /** 用户主动断开/退出登录后，本次运行内别再自动连。 */
  private autoConnectSuppressed: boolean = false;
  /** 掉网 8 秒后主动判死的那次定时器。 */
  private netLossTimer: number = -1;
  /**
   * 空闲多久才值得探一次：服务端心跳 25 秒一跳，超过 35 秒没动静
   * 说明至少漏了一拍（正常情况永远探不到，不产生额外流量）。
   */
  private static readonly PROBE_IDLE_MS: number = 35000;
  /** 探测间隔：每 5 秒看一次要不要探，不空转。 */
  private static readonly PROBE_TICK_MS: number = 5000;
  /** 最近一次拉会话列表的失败原因（复用时判定「链路是不是真的死了」用）。 */
  private lastListError: Object | undefined = undefined;
  /** 应用层心跳探测：空闲一段时间就主动要一个回包，把「静默判死」从 45~90 秒压到 20 秒级。 */
  private probeTimer: number = -1;
  private probeInFlight: boolean = false;
  /** 最近一次「测延迟」结果（毫秒）；-1 表示没测过。 */
  latencyMs: number = -1;
  latencyAt: number = 0;
  /** 是否正在测延迟（按钮转圈用）。 */
  latencyTesting: boolean = false;
  /** 精简历史：主机把历史里的工具参数/输出转摘要，省流量、首屏更快。 */
  compactHistory: boolean = false;
  /** 已发送文本里的 Key/Token 默认打码（点气泡可看原文）。 */
  secretMask: boolean = true;
  /** 本轮开始时刻/步数：用来看「这一轮跑了多久、走了几步」。 */
  private turnStartedAt: number = 0;
  private turnSteps: number = 0;
  /** 上一轮结束后展示的摘要（步数/耗时/用量），空串表示还没跑完一轮。 */
  lastTurnSummary: string = '';
  /** 稳定性统计（诊断面板 + 落盘日志用）。 */
  private connectCount: number = 0;
  private disconnectCount: number = 0;
  private connectedAt: number = 0;
  private lastDisconnectAt: number = 0;
  private lastRecoveryMs: number = -1;
  /** 错误条上「重试」按钮的文案与要重跑的动作：失败时登记，成功或手动关闭时清掉。 */
  private retryText: string = '';
  private retryAction: (() => void) | undefined = undefined;

  phase: string = PHASE_BOOT;
  busy: boolean = false;
  busyAction: string = '';
  errorMsg: string = '';
  /** true = 发送走 steer（插话打断当前轮），false = 排队到本轮之后。 */
  steerMode: boolean = false;
  /** 会话搜索结果；null 表示未在搜索。 */
  searchResults: HarnessRemoteSession[] | undefined = undefined;
  /** 当前会话的上下文占用百分比（0 表示未知）。 */
  contextPercent: number = 0;
  /** 当前会话的权限预设；空表示未从主机读到。 */
  permissionPreset: string = '';
  /** 主机上可切换的权限预设名（来自 /permission 回执，拿不到用内置三项）。 */
  permissionOptions: string[] = [];
  /** 文件浏览：当前目录路径与条目。 */
  browsePath: string = '';
  directoryEntries: DirectoryEntry[] = [];
  /** Host 上的工作区列表。 */
  workspaces: HarnessWorkspace[] = [];
  /** 新建会话时使用的工作区；空表示沿用当前会话的 cwd。 */
  selectedWorkspaceId: string = '';
  /** 可选模型列表（来自主机模型目录）。 */
  modelOptions: ModelOption[] = [];
  /** 当前模型展示名；空表示未知。 */
  currentModelLabel: string = '';
  /** 当前模型完整选择（面板显示与高亮用）。 */
  currentModelProvider: string = '';
  currentModelEffort: string = '';
  modelCatalogLoaded: boolean = false;
  /** 斜杠命令候选（主机清单 + 内置兜底）。 */
  slashCommands: SlashCommand[] = [];
  /** 模型目录的原始结构，交给 UI 按需解析。 */
  modelCatalogRaw: Record<string, Object> = {};
  /** 自动重连状态文案；空字符串表示没有正在进行的重连。 */
  reconnectStatus: string = '';
  /** true = 断线后正在会话页里等重连（短抖动不把用户踢回设备列表）。 */
  reconnecting: boolean = false;
  /** 最近的链路事件（环形，最多 20 条），诊断面板直接看，不用连电脑抓 hilog。 */
  linkEvents: string[] = [];
  /** 当前会话的定时任务列表（schedule/list）。 */
  schedules: HarnessSchedule[] = [];
  /** 定时任务投递历史（面板打开某条时才拉）。 */
  scheduleHistory: HarnessScheduleDelivery[] = [];
  scheduleHistoryId: string = '';
  schedulesLoading: boolean = false;
  /** 该主机是否导出 `schedule/*`：老插件会回「no active Remote method exports this endpoint」。 */
  schedulesSupported: boolean = true;
  serverUrl: string = '';
  email: string = '';
  devices: RemoteHostDevice[] = [];
  sessions: HarnessRemoteSession[] = [];
  /** True when the session list failed to load; the chat shows a retry entry point. */
  sessionsLoadFailed: boolean = false;
  messages: ChatItem[] = [];
  generating: boolean = false;
  currentSessionId: string = '';
  /** 当前会话是否还有更早的历史可翻（session/page 的 hasMore）。 */
  historyHasMore: boolean = false;
  /** 正在翻更早历史，防连点。 */
  loadingOlderHistory: boolean = false;
  /** 已加载历史里最早的 seq，session/page 的 beforeSeq 用它。 */
  private oldestHistorySeq: number = -1;
  /** 会话历史本地缓存（按最近使用淘汰），用于切换会话时立刻出内容 */
  private historyCache: Map<string, ChatItem[]> = new Map<string, ChatItem[]>();
  private historyOrder: string[] = [];
  /** 最近一次见到的真实工作区路径；新建会话时用它，避免传空 cwd */
  private lastSessionCwd: string = '';
  currentSessionTitle: string = '';
  connectedHostName: string = '';
  connectedDeviceId: string = '';
  /** User-defined display names for host devices, keyed by deviceId. */
  deviceAliases: Record<string, string> = {};
  /** Theme preference: 0 = follow system, 1 = light, 2 = dark. */
  themeMode: number = 0;
  /** 主题着色：0 默认 · 1 深海 · 2 森林 · 3 暖沙 · 4 玫紫 */
  themeTint: number = 0;
  /** 桌宠（鲸娘）开关。 */
  petEnabled: boolean = true;
  /** 桌宠「完成」动作只亮一会儿，记录时刻。 */
  petDoneAt: number = 0;
  /** 会话输入草稿（sessionId -> 文本）。 */
  drafts: Record<string, string> = {};
  /** 本地提示词库。 */
  prompts: string[] = [];
  /** 主机侧的归档 / 置顶集合（workspace/follow baseline 与归档、置顶回执同步）。 */
  archivedSessionIds: string[] = [];
  pinnedSessionIds: string[] = [];
  /** 分栏布局里会话栏的宽度（vp）；0 = 用默认比例。 */
  splitWidth: number = 0;
  /** 会话列表密度：0 自动 / 1 紧凑 / 2 超紧凑。 */
  layoutDensity: number = 0;
  /** 超宽窗口是否显示右侧「会话详情」栏。 */
  showInspector: boolean = true;
  /** 会话收藏与最近访问（sessionId 列表）。 */
  favoriteSessions: string[] = [];
  recentSessions: string[] = [];
  /** 完成通知开关（默认开），以及 App 是否在后台——只有后台才值得打扰。 */
  /** busy 的起始时间，用于泄漏自愈。 */
  private busySince: number = 0;
  /** 切换服务器时用的独立锁：不再共用 busy，避免别处的 busy 把切换挡回去。 */
  switchingServer: boolean = false;
  switchingTo: string = '';
  notificationsEnabled: boolean = true;
  appBackground: boolean = false;
  /** 系统网络是否可用（断网时立刻把 UI 变灰，而不是等 socket 自己断）。 */
  networkOnline: boolean = true;
  /** 当前承载名：'Wi-Fi' | '移动数据' | '有线网络' | '无网络' | ''（未知）。 */
  networkType: string = '';
  /** 文件预览：主机上某个文本文件的内容。 */
  filePreviewPath: string = '';
  filePreviewText: string = '';
  filePreviewError: string = '';
  filePreviewLoading: boolean = false;
  /** Language preference: 0 = follow system, 1 = Chinese, 2 = English. */
  languageMode: number = 0;
  /** 文字大小档位：0 小 / 1 标准 / 2 大 / 3 特大（对应 0.9 / 1.0 / 1.15 / 1.3 倍）。 */
  textScaleMode: number = 1;
  /** 已保存的服务器/账号登录态（一键切换，不用重输密码）。 */
  profiles: SavedProfile[] = [];
  /** 设备身份读不出来（安全存储不可用）时置位，解锁回到前台后自动重试。 */
  identityBlocked: boolean = false;
  /** 服务端下发的 ICE 配置（空串表示没有），将来给 RtcBridge.startOffer 用。 */
  iceServersJson: string = '';
  /** 连接过程中的阶段文案（连接页显示，让等待有进度感）。 */
  connectStage: string = '';
  /** System dark-mode flag, kept fresh by EntryAbility configuration updates. */
  systemDark: boolean = false;
  /** System orientation flag, kept fresh by EntryAbility configuration updates. */
  systemLandscape: boolean = false;
  onUiUpdate: (() => void) | undefined = undefined;

  notify(): void {
    const callback: (() => void) | undefined = this.onUiUpdate;
    if (callback !== undefined) {
      callback();
    }
  }

  /** Whether the UI should render the dark palette. */
  isDark(): boolean {
    return this.themeMode === 2 || (this.themeMode === 0 && this.systemDark);
  }

  /** Persist and apply a new theme preference. */
  setPetEnabled(enabled: boolean): void {
    this.petEnabled = enabled;
    this.store.savePet(enabled);
    this.notify();
  }

  /** 桌宠状态：'working' 干活 · 'waiting' 等你确认 · 'done' 刚做完 · 'idle' 待命。 */
  petState(): string {
    if (this.generating) {
      return 'working';
    }
    for (const item of this.messages) {
      if (item.kind === 'approval' && item.approvalOutcome.length === 0) {
        return 'waiting';
      }
      if (item.kind === 'question' && item.questionOutcome.length === 0) {
        return 'waiting';
      }
    }
    if (this.petDoneAt > 0 && Date.now() - this.petDoneAt < 4000) {
      return 'done';
    }
    return 'idle';
  }

  setThemeTint(tint: number): void {
    this.themeTint = tint;
    this.store.saveThemeTint(tint);
    this.notify();
  }

  setThemeMode(mode: number): void {
    this.themeMode = mode;
    const saving: Promise<void> = this.store.saveThemeMode(mode);
    saving.catch((error: Error) => {
      logError('save themeMode failed: ' + errorMessage(error));
    });
    this.notify();
  }

  /** Persist and apply a new language preference (the UI re-renders through notify). */
  setLanguageMode(mode: number): void {
    this.languageMode = mode;
    this.applyLanguage();
    const saving: Promise<void> = this.store.saveLanguageMode(mode);
    saving.catch((error: Error) => {
      logError('save languageMode failed: ' + errorMessage(error));
    });
    this.notify();
  }

  /** 文字大小倍数。 */
  textScale(): number {
    if (this.textScaleMode === 0) {
      return 0.9;
    }
    if (this.textScaleMode === 2) {
      return 1.15;
    }
    if (this.textScaleMode === 3) {
      return 1.3;
    }
    return 1;
  }

  /** 持久化并应用新的文字大小档位。 */
  setTextScaleMode(mode: number): void {
    this.textScaleMode = mode;
    const saving: Promise<void> = this.store.saveTextScale(mode);
    saving.catch((error: Error) => {
      logError('save textScale failed: ' + errorMessage(error));
    });
    this.notify();
  }

  /** Push the effective language into the module-level translator. */
  applyLanguage(): void {
    setEnglish(resolveEnglish(this.languageMode, systemEnglish()));
  }

  /** Called by EntryAbility when the system dark mode changes. */
  setSystemDark(dark: boolean): void {
    if (this.systemDark !== dark) {
      this.systemDark = dark;
      this.notify();
    }
  }

  /** Called by EntryAbility when the system orientation changes. */
  setSystemLandscape(landscape: boolean): void {
    if (this.systemLandscape !== landscape) {
      this.systemLandscape = landscape;
      this.notify();
    }
  }

  /** Persisted user-defined display name for a device, or its server name. */
  deviceDisplayName(device: RemoteHostDevice): string {
    const alias: string | undefined = this.deviceAliases[device.deviceId];
    if (alias !== undefined && alias.length > 0) {
      return alias;
    }
    return device.name;
  }

  /** Display name for the currently connected host; alias wins over server name. */
  connectedHostDisplayName(): string {
    const id: string = this.connectedDeviceId;
    if (id.length > 0) {
      const alias: string | undefined = this.deviceAliases[id];
      if (alias !== undefined && alias.length > 0) {
        return alias;
      }
    }
    return this.connectedHostName;
  }

  /** Set (or clear, when empty) the local alias of a device and persist it. */
  setDeviceAlias(deviceId: string, name: string): void {
    const trimmed: string = name.trim();
    const next: Record<string, string> = {};
    for (const key of Object.keys(this.deviceAliases)) {
      if (key !== deviceId) {
        next[key] = this.deviceAliases[key];
      }
    }
    if (trimmed.length > 0) {
      next[deviceId] = trimmed;
    }
    this.deviceAliases = next;
    const saving: Promise<void> = this.store.saveDeviceAliases(next);
    saving.catch((error: Error) => {
      logError('save aliases failed: ' + errorMessage(error));
    });
    this.notify();
  }

  async bootstrap(context: common.Context): Promise<void> {
    if (this.phase !== PHASE_BOOT) {
      return;
    }
    try {
      this.filesDir = context.filesDir;
    } catch (error) {
      this.filesDir = '';
    }
    LinkLog.init(context);
    this.startNetworkMonitor();
    this.startLinkProbe();
    try {
      await initClientVersion();
      await this.store.init(context);
      this.config = await this.store.loadConfig();
      this.identity = await this.store.loadOrCreateIdentity();
      this.credentials = await this.store.loadCredentials();
      this.deviceAliases = this.store.loadDeviceAliases();
      this.themeMode = this.store.loadThemeMode();
      this.themeTint = this.store.loadThemeTint();
      this.petEnabled = this.store.loadPet();
      this.languageMode = this.store.loadLanguageMode();
      this.textScaleMode = this.store.loadTextScale();
      this.splitWidth = this.store.loadSplitWidth();
      this.layoutDensity = this.store.loadLayoutDensity();
      this.showInspector = this.store.loadShowInspector();
      this.compactHistory = this.store.loadCompactHistory();
      this.secretMask = this.store.loadSecretMask();
      this.profiles = this.store.loadProfiles();
      this.drafts = this.store.loadDrafts();
      this.prompts = this.store.loadPrompts();
      const meta: Record<string, string[]> = this.store.loadSessionMeta();
      this.favoriteSessions = meta['favorites'] !== undefined ? meta['favorites'] : [];
      this.recentSessions = meta['recents'] !== undefined ? meta['recents'] : [];
      this.applyLanguage();
    } catch (error) {
      const text: string = errorMessage(error);
      this.errorMsg = text;
      this.identityBlocked = text.indexOf('设备身份读取失败') >= 0;
      this.phase = PHASE_SETUP;
      this.notify();
      return;
    }
    const config: StoredServerConfig | undefined = this.config;
    if (config !== undefined) {
      this.serverUrl = config.baseUrl;
      this.email = config.email;
    }
    if (this.config !== undefined && this.credentials !== undefined && this.identity !== undefined) {
      this.phase = PHASE_DEVICES;
      this.notify();
      const lastHost: string = this.store.loadLastHost();
      if (lastHost.length > 0 && !this.autoConnectSuppressed) {
        // 上次连着主机：启动后直接连它，不用每次手点「连接」。
        // 失败照常落到设备列表 + 重试按钮，不影响用户重新选主机。
        logInfo('auto-connect last host ' + lastHost);
        LinkLog.write('conn', '启动后自动连接上次的主机 ' + lastHost);
        setTimeout(() => {
          if (this.phase === PHASE_DEVICES && this.core === undefined) {
            this.connectDevice(lastHost).catch((error: Error) => {
              logWarn('auto connect failed: ' + errorMessage(error));
            });
          }
        }, 400);
      }
      this.refreshDevices();
      return;
    }
    this.phase = PHASE_SETUP;
    this.notify();
  }

  async login(baseUrl: string, email: string, password: string): Promise<void> {
    if (this.busy) {
      return;
    }
    this.setBusy(true);
    this.errorMsg = '';
    this.notify();
    try {
      const normalized: string = normalizeServerUrl(baseUrl);
      const api: RemoteServerApi = new RemoteServerApi(normalized);
      await api.health();
      const account: AccountLoginResult = await api.loginAccount(email, password);
      const identity: DeviceIdentity = await this.store.loadOrCreateIdentity();
      const tokens: TokenPair = await api.registerDevice(identity, account.token);
      const config: StoredServerConfig = new StoredServerConfig();
      config.baseUrl = normalized;
      config.email = email.trim();
      await this.store.saveConfig(config);
      await this.store.saveCredentials(tokens);
      this.config = config;
      this.identity = identity;
      this.credentials = tokens;
      this.serverUrl = config.baseUrl;
      this.email = config.email;
      this.phase = PHASE_DEVICES;
      this.setBusy(false);
      await this.rememberProfile();
      this.notify();
      await this.refreshDevices();
      return;
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.setBusy(false);
    this.notify();
  }

  async refreshDevices(): Promise<void> {
    if (this.phase !== PHASE_DEVICES) {
      return;
    }
    this.setBusy(true);
    this.errorMsg = '';
    this.notify();
    try {
      const devices: RemoteHostDevice[] = await this.listDevicesWithRetry();
      await this.fillPresence(devices);
      devices.sort(compareDevices);
      this.devices = devices;
      this.clearRetry();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.setRetry('刷新主机', () => {
        this.refreshDevices();
      });
    }
    this.setBusy(false);
    this.notify();
  }

  /**
   * 等隐藏 WebRTC 桥就绪（最多 budgetMs，100ms 轮询）。
   * 桥没挂上（页面还没渲染到这里）就直接返回，让连接照常走中继。
   */
  private async waitForRtcBridge(budgetMs: number): Promise<void> {
    const bridge: RtcBridge | undefined = this.rtcBridge;
    if (bridge === undefined) {
      return;
    }
    const deadline: number = Date.now() + budgetMs;
    while (!bridge.isReady() && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 100);
      });
    }
    if (!bridge.isReady()) {
      logInfo('webrtc: 桥在 ' + budgetMs + 'ms 内没就绪，本次连接走中继');
    }
  }

  /** 页面把 WebRTC 桥交给运行时；没挂上时连接一律走中继。 */
  attachRtcBridge(bridge: RtcBridge): void {
    this.rtcBridge = bridge;
  }

  async connectDevice(deviceId: string): Promise<void> {
    // 正常入口在设备页；断线重连时允许从会话页直接重来（reconnecting 标记着这件事）
    const fromChatReconnect: boolean = this.phase === PHASE_CHAT && this.reconnecting;
    if (this.phase !== PHASE_DEVICES && !fromChatReconnect) {
      return;
    }
    // 刚从这台主机的会话页退回来（连接还活着）：不重新认证，直接回聊天
    if (this.keepAliveDeviceId === deviceId && this.core !== undefined && this.harness !== undefined) {
      // 复用前必须体检：飞行模式/切网之后 WebSocket 常常不报 close，
      // 这时 core/harness 还在，直接「复用」就是回到一条死连接——
      // 用户看到「连上了但点不动」，只能杀进程重进（这就是线上的主症状）。
      const aliveRelay: RelayTransport | undefined = this.activeRelay;
      const healthy: boolean = aliveRelay !== undefined && this.networkOnline
        && aliveRelay.isHealthy(AppRuntime.LINK_STALE_MS);
      if (healthy) {
        logInfo('reuse live connection to ' + deviceId);
        LinkLog.write('conn', '复用现有连接 device=' + deviceId
          + ' transport=' + this.transportLabel);
        this.phase = PHASE_CHAT;
        this.errorMsg = '';
        this.notify();
        this.reuseThenVerify(deviceId);
        return;
      }
      LinkLog.write('conn', '放弃复用（链路不健康：socket=' + (aliveRelay !== undefined)
        + ' online=' + this.networkOnline + ' silence='
        + (aliveRelay !== undefined ? aliveRelay.linkSilenceMs() : -1) + 'ms）→ 重新连接');
      this.pushLinkEvent('旧链路已不可用，重新连接');
      this.teardownConnection();
      this.keepAliveDeviceId = '';
    }
    // 之前连着别的设备：先干净断开再连新的
    if (this.core !== undefined) {
      this.teardownConnection();
      this.keepAliveDeviceId = '';
    }
    this.connectCancelled = false;
    this.lastDeviceId = deviceId;
    this.phase = PHASE_CONNECTING;
    this.errorMsg = '';
    this.notify();
    this.armConnectDeadline(deviceId);
    try {
      const config: StoredServerConfig | undefined = this.config;
      const identity: DeviceIdentity | undefined = this.identity;
      const credentials: TokenPair | undefined = this.credentials;
      if (config === undefined || identity === undefined || credentials === undefined) {
        throw new Error('尚未登录');
      }
      // 建连前先把 accessToken 弄新鲜：中继握手只用这个 token，
      // 过期了服务器会回 4002 invalid access token。
      // 恢复场景跳过了设备查询（省一次往返），也就顺带跳过了那次刷新，所以这里必须补上。
      if (!this.hasFreshAccessToken(credentials)) {
        try {
          await this.ensureApi();
          LinkLog.write('conn', 'accessToken 即将过期，已先刷新再建连');
        } catch (error) {
          logWarn('refresh before connect failed: ' + errorMessage(error));
        }
      }
      // 先把中继/控制通道的建连预热起来，和下面的 REST 查询并行跑：
      // 二者互不依赖（RelayTransport 只需要 deviceId，身份公钥是给 Noise 用的）。
      const relayOptions: RelayTransportOptions = new RelayTransportOptions();
      relayOptions.deviceId = identity.deviceId;
      relayOptions.accessToken = credentials.accessToken;
      relayOptions.targetDeviceId = deviceId;
      // 隐藏的 Web 桥要 onPageEnd 之后才算 ready；刚启动就点「连接」时它常常还没好，
      // 那样会直接判「桥未就绪」回落中继，用户看到的就是"明明同网段却显示中继"。
      await this.waitForRtcBridge(2500);
      relayOptions.rtc = this.rtcBridge;
      // WebRTC 要 TURN/STUN 配置时现取：接口要求 active connection，正好在 connect.accepted 之后
      relayOptions.fetchIceServers = (connectionId: string): Promise<string> => {
        return this.ensureApi().then((api: RemoteServerApi) => api.iceServersJson(connectionId));
      };
      let relay: RelayTransport = new RelayTransport(websocketUrl(config.baseUrl), relayOptions);
      this.pendingRelay = relay;
      const tokenFresh: boolean = credentials.accessTokenExpiresAt - Date.now() > 120000;
      this.setConnectStage('读取主机信息…');
      const relayWarm: Promise<boolean> = tokenFresh
        ? relay.connect().then(() => true).catch(() => false)
        : Promise.resolve(false);
      const t0: number = Date.now();
      const recovering: boolean = this.autoRecovering || this.reconnectAttempt > 0;
      // 恢复场景优先用上次连上时缓存的主机信息（deviceId + 身份公钥 + 版本）：
      // 刚断线重连时这些一定没变，省掉一次服务器往返；公钥仍要用本地 pin 校验（见 enforceHostPin），
      // 主机真被重置过 → pin 不匹配 → 直接报错，不会拿错公钥硬连。
      const cachedHost: AuthorizedPeerDevice | undefined = recovering
        ? await this.cachedHostFor(deviceId) : undefined;
      const host: AuthorizedPeerDevice = cachedHost !== undefined
        ? cachedHost : await this.deviceForWithRetry(deviceId);
      const tDevice: number = Date.now();
      if (cachedHost !== undefined) {
        LinkLog.write('conn', '恢复场景：用缓存的主机信息建连（省掉一次设备查询）');
      }
      // 恢复场景（刚断线重连/网络刚恢复）不再单独探一次在线状态：
      // 我们几十秒前还连着这台主机，而 Wi-Fi 刚关联上时每个额外 HTTP 往返都要几秒。
      if (!host.presenceKnown && !recovering) {
        this.setConnectStage('检查主机在线状态…');
        const presence: HostPresence = await this.presenceWithRetry(host.deviceId);
        host.online = presence.online;
        host.presenceKnown = true;
      }
      if (!host.online && !recovering) {
        throw new Error('设备不在线');
      }
      if (recovering) {
        LinkLog.write('conn', '恢复场景：跳过在线探测，直接用列表里的状态连接（online=true 视为可试）');
      }
      const pinnedHostKey: string = await this.enforceHostPin(host);
      // ensureApi() may have renewed the credentials above: the relay handshake must use
      // the current access token, not the one captured before the renewal.
      const current: TokenPair | undefined = this.credentials;
      const warmed: boolean = await relayWarm;
      const rotated: boolean = current !== undefined && current.accessToken !== credentials.accessToken;
      if (!warmed || rotated) {
        // 预热失败，或凭证在 REST 期间轮换过（旧 token 的 socket 不能拿去握手）就重建一条
        if (warmed) {
          relay.close();
        }
        relayOptions.accessToken = current !== undefined ? current.accessToken : credentials.accessToken;
        relay = new RelayTransport(websocketUrl(config.baseUrl), relayOptions);
        this.pendingRelay = relay;
      }
      const secure: SecureTransport = new SecureTransport(relay, identity, host, pinnedHostKey);
      // 通道所有权交给 SecureTransport → Core，之后由 teardownConnection 关
      this.pendingRelay = undefined;
      // 留着引用只为断线时读关闭判词（RelayTransport.closeVerdict）：
      // 4003/授权失败要靠它决定「停止自动重连」。
      this.activeRelay = relay;
      const core: RemoteClientCore = new RemoteClientCore(secure, 45000);
      this.core = core;
      this.unsubscribeClose = core.onClose((error: Error | undefined) => {
        this.handleDisconnect();
      });
      this.setConnectStage('建立加密通道（Noise IK 握手）…');
      const tRelay: number = Date.now();
      await core.connect();
      const tSecure: number = Date.now();
      if (this.connectCancelled) {
        return;
      }
      // ICE 体检只用于诊断，绝不能挡在连接主链路上（慢链路下单次 HTTP 可能几十秒）
      this.probeIceConfig(relay).catch(() => undefined);
      this.setConnectStage('读取主机能力…');
      const gateway: RemoteGateway = new RemoteGateway(core);
      // 能力探测是每次连接一个 RPC 往返；主机版本不变就没有重新探测的必要
      const featureKey: string = host.clientVersion + '|' + host.harnessVersion;
      let features: RemoteHostFeatures | undefined = this.featuresCacheKey === featureKey
        ? this.featuresCacheValue : undefined;
      if (features === undefined) {
        features = await gateway.probeHostFeatures();
        this.featuresCacheKey = featureKey;
        this.featuresCacheValue = features;
      } else {
        logInfo('host features cached for ' + featureKey);
      }
      logInfo('host features: sessionFormat=' + features.sessionFormat + ' apiProxy=' + features.apiProxy
        + ' remoteGateway=' + features.remoteGateway + ' caps=' + features.capabilities.join(','));
      if (this.connectCancelled) {
        return;
      }
      const harness: HarnessAlphaClient =
        new HarnessAlphaClient(core, features.sessionFormat, (frame: HarnessClientFrame) => {
          this.handleFrame(frame);
        });
      this.harness = harness;
      this.setConnectStage('订阅会话事件…');
      await harness.start();
      const tHarness: number = Date.now();
      NetTrace.record('connect 分段', tHarness - t0,
        '设备信息 ' + (tDevice - t0) + 'ms · 中继+握手 ' + (tSecure - tRelay) + 'ms'
        + ' · 订阅 ' + (tHarness - tSecure) + 'ms', true);
      if (this.connectCancelled) {
        return;
      }
      // Enter the chat as soon as the secure harness channel is live: the session
      // list is loaded afterwards so a slow host never keeps the user locked out.
      this.connectedHostName = host.name.length > 0 ? host.name : '远程主机';
      this.connectedDeviceId = host.deviceId;
      this.transportLabel = relay.transportKind();
      logInfo('connected to host ' + host.deviceId + ' transport=' + this.transportLabel);
      const lanSkip: string = relay.lanSkipReason();
      this.pushLinkEvent('已连接 · ' + this.transportLabel
        + (lanSkip.length > 0 && this.transportLabel !== 'lan' ? '（' + lanSkip + '）' : ''));
      // 记住这台主机：下次启动自动连它
      this.store.saveLastHost(host.deviceId);
      this.store.saveHostInfo(JSON.stringify({
        'deviceId': host.deviceId,
        'name': host.name,
        'platform': host.platform,
        'identityKey': host.identityKey,
        'clientVersion': host.clientVersion,
        'harnessVersion': host.harnessVersion
      }));
      this.autoConnectSuppressed = false;
      // 连着主机时申请长时任务：熄屏/后台不再被系统冻结，心跳与直连都活着
      KeepAlive.start().catch(() => undefined);
      // 精简历史：主机侧把历史工具参数/输出转摘要（remote.history.configure）
      this.applyCompactHistory().catch(() => undefined);
      this.connectCount += 1;
      this.connectedAt = Date.now();
      if (this.lastDisconnectAt > 0) {
        this.lastRecoveryMs = this.connectedAt - this.lastDisconnectAt;
      }
      LinkLog.write('stat', '连接 #' + this.connectCount
        + ' · transport=' + this.transportLabel
        + (this.lastRecoveryMs > 0 ? ' · 恢复耗时 ' + (Math.round(this.lastRecoveryMs / 100) / 10) + 's' : '')
        + ' · 本次运行断线 ' + this.disconnectCount + ' 次'
        + (lanSkip.length > 0 && this.transportLabel !== 'lan' ? ' · 没直连：' + lanSkip : ''));
      this.reconnectAttempt = 0;
      this.reconnectExhausted = false;
      this.autoRecovering = false;
      this.offlineWaitSince = 0;
      this.reconnectStatus = '';
      this.clearReconnectTimer();
      this.connectStage = '';
      this.clearRetry();
      this.reconnecting = false;
      this.phase = PHASE_CHAT;
      this.notify();
      await this.loadSessionsAfterConnect();
      // 工作区快照实测要 6.4 秒，且与会话列表/首帧抢同一条中继：挪到首屏之后再做，
      // 抽屉打开时也会各自再拉一次，用户几乎察觉不到。
      setTimeout(() => {
        if (this.phase === PHASE_CHAT) {
          this.loadWorkspaces().catch(() => undefined);
        }
      }, 4000);
      return;
    } catch (error) {
      logError('connect failed: ' + errorMessage(error));
      LinkLog.write('conn', '连接失败 device=' + deviceId + '：' + errorMessage(error)
        + '（attempt=' + this.reconnectAttempt + '）');
      // 「主机不在线」= 服务器已经回来了、只是主机插件还没重新注册：这不是连接失败，
      // 属于「等主机回来」的状态，不该消耗重连次数（否则 6 次很快烧完就彻底停了）。
      const failureText: string = errorMessage(error);
      const hostOffline: boolean = failureText.toLowerCase().indexOf('host is offline') >= 0
        || failureText.indexOf('设备不在线') >= 0;
      if (hostOffline && !this.connectCancelled) {
        if (this.offlineWaitSince === 0) {
          this.offlineWaitSince = Date.now();
        }
        // 等主机回来的窗口最多 90 秒；超时后按普通失败处理（正常烧完退避并交回用户）
        if (Date.now() - this.offlineWaitSince < 90000) {
          this.reconnectAttempt = Math.min(this.reconnectAttempt, 1);
        } else {
          this.offlineWaitSince = 0;
        }
      }
      const autoRetry: boolean = !this.connectCancelled && deviceId === this.lastDeviceId
        && (this.reconnectAttempt > 0 || this.autoRecovering)
        && this.reconnectAttempt < AppRuntime.MAX_RECONNECT_ATTEMPTS;
      if (!this.connectCancelled && !autoRetry) {
        this.errorMsg = errorMessage(error);
        this.setRetry('重新连接', () => {
          this.connectDevice(deviceId);
        });
      }
      this.teardownConnection();
      if (this.phase !== PHASE_DEVICES) {
        this.phase = PHASE_DEVICES;
      }
      if (autoRetry) {
        // 自动重连期间的单次失败不打断退避序列，继续按下一档重试。
        // 例外：失败原因是「主机不在线」——说明服务器已经回来了，只是主机插件还没重新注册，
        // 这种通常几秒内就好，按 30 秒退避去等纯属浪费（实测恢复被拖到 34.8 秒）。
        const index: number = Math.min(this.reconnectAttempt, AppRuntime.RECONNECT_DELAYS_MS.length - 1);
        const delay: number = hostOffline
          ? Math.min(2000, AppRuntime.RECONNECT_DELAYS_MS[index])
          : AppRuntime.RECONNECT_DELAYS_MS[index];
        this.reconnectAttempt += 1;
        if (hostOffline) {
          // 主机侧还没回来时，说明「服务器通了、主机还没上线」，别用「重连失败」吓人
          const waited: number = this.offlineWaitSince > 0
            ? Math.round((Date.now() - this.offlineWaitSince) / 1000) : 0;
          this.reconnectStatus = '主机还没重新上线，' + Math.round(delay / 1000)
            + ' 秒后再试（已等 ' + waited + ' 秒）';
        } else {
          this.reconnectStatus = '重连失败，' + Math.round(delay / 1000) + ' 秒后重试（第 '
            + this.reconnectAttempt + ' / ' + AppRuntime.MAX_RECONNECT_ATTEMPTS + ' 次）';
        }
        LinkLog.write('conn', '自动重连失败，' + Math.round(delay / 1000) + 's 后第 '
          + this.reconnectAttempt + ' 次');
        this.scheduleReconnect(deviceId, delay);
      }
    } finally {
      this.clearConnectDeadline();
    }
    this.notify();
  }

  /** 起连接看门狗：不这么做的话，某条路径卡住会让界面永远停在「正在连接」。 */
  private armConnectDeadline(deviceId: string): void {
    this.clearConnectDeadline();
    this.connectDeadlineTimer = setTimeout(() => {
      this.connectDeadlineTimer = -1;
      if (this.phase !== PHASE_CONNECTING) {
        return;
      }
      const seconds: number = Math.round(AppRuntime.CONNECT_DEADLINE_MS / 1000);
      logWarn('connect deadline hit after ' + seconds + 's');
      LinkLog.write('conn', '连接超过 ' + seconds + ' 秒没完成，判超时并放弃（stage='
        + (this.connectStage.length > 0 ? this.connectStage : '—') + '）');
      this.connectCancelled = true;
      this.teardownConnection();
      this.connectStage = '';
      this.phase = PHASE_DEVICES;
      this.errorMsg = '连接超时（' + seconds + ' 秒没走完握手）：已主动断开。请检查网络后点「连接」重试。';
      this.setRetry('重新连接', () => {
        this.connectDevice(deviceId);
      });
      this.notify();
    }, AppRuntime.CONNECT_DEADLINE_MS);
  }

  private clearConnectDeadline(): void {
    if (this.connectDeadlineTimer !== -1) {
      clearTimeout(this.connectDeadlineTimer);
      this.connectDeadlineTimer = -1;
    }
  }

  /**
   * 复用连接后做一次真实体检：拉会话列表。
   * 拉不到（传输类失败）说明这条链路其实是死的——干净重连一次，
   * 而不是把「会话列表加载失败」甩给用户让他自己杀进程。
   */
  private reuseThenVerify(deviceId: string): void {
    this.loadSessionsAfterConnect().then(() => {
      if (!this.sessionsLoadFailed) {
        return;
      }
      const cause: Object | undefined = this.lastListError;
      if (cause !== undefined && !isTransportFailure(cause)) {
        // 主机拒绝（业务类）不是链路问题：重连也白搭，交给用户看红条
        LinkLog.write('conn', '复用后列表被主机拒绝（业务类），不重连：' + errorMessage(cause));
        return;
      }
      LinkLog.write('conn', '复用后列表拉不到，判定链路已死 → 干净重连');
      this.pushLinkEvent('复用连接不可用，已自动重连');
      this.teardownConnection();
      this.keepAliveDeviceId = '';
      this.connectDevice(deviceId).catch((error: Error) => {
        logWarn('auto reconnect after failed reuse: ' + errorMessage(error));
      });
    }).catch((error: Error) => {
      logWarn('reuse verify failed: ' + errorMessage(error));
    });
  }

  cancelConnect(): void {
    if (this.phase !== PHASE_CONNECTING) {
      return;
    }
    this.connectCancelled = true;
    this.connectStage = '';
    this.teardownConnection();
    this.phase = PHASE_DEVICES;
    this.notify();
  }

  /**
   * 返回设备列表但**保持连接**：同一台主机再进去不重新认证、不重新握手。
   * 真正的断开走 disconnectAndClose()。
   */
  keepAliveToDevices(): void {
    if (this.phase !== PHASE_CHAT) {
      return;
    }
    this.phase = PHASE_DEVICES;
    this.keepAliveDeviceId = this.connectedDeviceId;
    this.errorMsg = '';
    this.notify();
  }

  /** 设备列表里「断开连接」用：真的拆掉会话。 */
  disconnectAndClose(): void {
    if (this.phase !== PHASE_CHAT && this.phase !== PHASE_DEVICES) {
      return;
    }
    LinkLog.write('conn', '用户主动断开连接');
    this.autoConnectSuppressed = true;
    this.store.saveLastHost('');
    this.teardownConnection();
    this.keepAliveDeviceId = '';
    this.clearReconnectTimer();
    this.clearNetLossCheck();
    this.clearConnectDeadline();
    this.reconnectExhausted = false;
    this.reconnectAttempt = 0;
    this.reconnectStatus = '';
    this.phase = PHASE_DEVICES;
    this.notify();
  }

  disconnectToDevices(): void {
    if (this.phase !== PHASE_CHAT) {
      return;
    }
    this.teardownConnection();
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectStatus = '';
    this.phase = PHASE_DEVICES;
    this.errorMsg = '';
    this.notify();
    this.refreshDevices();
  }

  /** 私钥已丢失时重置身份：清本地身份/凭据，重新生成，然后回到登录页。 */
  async resetIdentityAndRestart(context: common.Context): Promise<void> {
    await this.store.resetIdentity();
    this.identity = undefined;
    this.credentials = undefined;
    this.config = await this.store.loadConfig();
    this.identityBlocked = false;
    this.errorMsg = '';
    this.phase = PHASE_BOOT;
    this.notify();
    await this.bootstrap(context);
  }

  /** 解锁 / 回到前台后重试读取设备身份。 */
  retryBootstrap(context: common.Context): void {
    if (!this.identityBlocked) {
      return;
    }
    this.identityBlocked = false;
    this.errorMsg = '';
    this.phase = PHASE_BOOT;
    this.notify();
    this.bootstrap(context);
  }

  async logout(): Promise<void> {
    this.teardownConnection();
    this.autoConnectSuppressed = true;
    this.store.saveLastHost('');
    // 换账号/换服务器就把打点与抖动计数清零，别把上一台的数字带到下一台上看
    NetTrace.reset();
    this.sessionsSnapshot = [];
    this.sessionsSnapshotHost = '';
    // 退出前先把手上的登录态存成 profile：以后在设置里一键切回来，不用重输密码
    await this.rememberProfile();
    this.phase = PHASE_SETUP;
    this.setBusy(false);
    this.errorMsg = '';
    this.devices = [];
    this.credentials = undefined;
    await this.store.clearCredentials();
    this.notify();
  }

  /**
   * 把「主机不接受这条路径」的原始报错翻成人话。
   * 协议收紧后 workspaceFiles/read* 只允许 Session 工作区内、且拒绝越界符号链接，
   * 报错原文是英文的路径/权限描述，直接弹给用户等于没说。
   */
  private fileAccessHint(error: Object): Error {
    const text: string = errorMessage(error).toLowerCase();
    const denied: boolean = text.indexOf('outside') >= 0 || text.indexOf('escape') >= 0
      || text.indexOf('forbidden') >= 0 || text.indexOf('permission') >= 0
      || text.indexOf('denied') >= 0 || text.indexOf('not within') >= 0;
    if (!denied) {
      return asError(error);
    }
    return new Error('主机拒绝读取这个路径：新版主机只允许读取当前会话工作区内（cwd）的文件。'
      + '把文件放到该工作区，或让主机上的 agent 先复制过来。');
  }

  /** 取主机上一张图片的 base64（消息里的本地图片路径）。 */
  async readImageBase64(path: string): Promise<string> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      throw new Error('尚未连接主机');
    }
    const sessionId: string = this.currentSessionId;
    try {
      return await harness.readFileBase64(sessionId, path);
    } catch (error) {
      throw this.fileAccessHint(asError(error));
    }
  }

  /** 申请通知权限（用户第一次开启开关时调）。 */
  async requestNotificationPermission(context: common.UIAbilityContext): Promise<boolean> {
    try {
      const granted: boolean = await notificationManager.isNotificationEnabled();
      if (granted) {
        return true;
      }
      await notificationManager.requestEnableNotification(context);
      return await notificationManager.isNotificationEnabled();
    } catch (error) {
      logWarn('notification permission failed: ' + errorMessage(error));
      return false;
    }
  }

  /** 发一条完成通知；App 在前台或开关关闭时什么也不做。 */
  private publishCompletionNotice(title: string, text: string): void {
    if (!this.notificationsEnabled || !this.appBackground) {
      return;
    }
    const request: notificationManager.NotificationRequest = {
      id: 101,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: {
          title: title,
          text: text
        }
      }
    };
    notificationManager.publish(request).catch((error: Error) => {
      logWarn('publish notification failed: ' + errorMessage(error));
    });
  }

  /** 读主机上的文件字节（不转文本），给 PDF 这类需要二进制的内容用。 */
  async readFileBuffer(path: string): Promise<ArrayBuffer> {
    const base64: string = await this.readImageBase64(path);
    const helper: util.Base64Helper = new util.Base64Helper();
    const bytes: Uint8Array = helper.decodeSync(base64);
    return bytes.buffer as ArrayBuffer;
  }

  /** 预览主机上的文本文件：走 workspaceFiles/readBytes，base64 解码成 UTF-8。 */
  async previewFile(path: string): Promise<void> {
    this.filePreviewPath = path;
    this.filePreviewText = '';
    this.filePreviewError = '';
    this.filePreviewLoading = true;
    this.notify();
    try {
      const base64: string = await this.readImageBase64(path);
      if (base64.length === 0) {
        this.filePreviewError = '主机返回了空内容';
        this.filePreviewLoading = false;
        this.notify();
        return;
      }
      const helper: util.Base64Helper = new util.Base64Helper();
      const bytes: Uint8Array = helper.decodeSync(base64);
      // 二进制文件会解出大量 NUL，直接给个提示，别把乱码糊到屏幕上
      let nulCount: number = 0;
      const probe: number = Math.min(bytes.length, 4096);
      for (let i = 0; i < probe; i++) {
        if (bytes[i] === 0) {
          nulCount++;
        }
      }
      if (probe > 0 && nulCount * 20 > probe) {
        this.filePreviewError = '这是一个二进制文件，暂不支持预览';
        this.filePreviewLoading = false;
        this.notify();
        return;
      }
      const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
      let text: string = decoder.decodeToString(bytes);
      if (text.length > 200000) {
        text = text.substring(0, 200000) + '\n\n…（内容超过 20 万字符，已截断）';
      }
      this.filePreviewText = text;
    } catch (error) {
      this.filePreviewError = errorMessage(error);
    }
    this.filePreviewLoading = false;
    this.notify();
  }

  /** 把一段录音（WAV base64）交给主机转写，返回文本；未连接或失败时抛错。 */
  async transcribeVoice(audioBase64: string): Promise<string> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      throw new Error('尚未连接主机');
    }
    if (audioBase64.length === 0) {
      return '';
    }
    return harness.speechTranscribe(audioBase64, '');
  }

  /** busy 的写入统一走这里：同时记时间戳，泄漏时能自动解锁，不至于界面永远卡在「忙」。 */
  private setBusy(value: boolean): void {
    this.busy = value;
    if (!value) {
      this.busySince = 0;
      return;
    }
    this.busySince = Date.now();
    setTimeout(() => {
      if (this.busy && this.busySince > 0 && Date.now() - this.busySince >= 19000) {
        logWarn('busy flag leaked, auto-reset after 20s');
        this.setBusy(false);
        this.busySince = 0;
        this.notify();
      }
    }, 20000);
  }

  /** 清空本地偏好（草稿、提示词、收藏、最近访问），不动登录态与凭据。 */
  clearLocalPreferences(): void {
    this.drafts = {};
    this.prompts = [];
    this.favoriteSessions = [];
    this.recentSessions = [];
    this.store.saveDrafts({});
    this.store.savePrompts([]);
    this.store.saveSessionMeta([], []);
    this.notify();
  }

  /** 用户手动关掉错误提示。 */
  clearError(): void {
    if (this.errorMsg.length === 0) {
      return;
    }
    this.errorMsg = '';
    this.clearRetry();
    this.notify();
  }

  /** 登记一个「重试」动作；错误条据此显示按钮。 */
  private setRetry(text: string, action: () => void): void {
    this.retryText = text;
    this.retryAction = action;
  }

  private clearRetry(): void {
    this.retryText = '';
    this.retryAction = undefined;
  }

  /** 错误条上要不要显示「重试」（有错误、且有可重跑的动作）。 */
  canRetry(): boolean {
    return this.errorMsg.length > 0 && this.retryAction !== undefined;
  }

  /** 重试按钮文案；没有可重试动作时返回空串。 */
  retryLabel(): string {
    return this.retryAction === undefined ? '' : this.retryText;
  }

  /** 跑一次上次失败的动作；先清掉错误条，别让旧错误压着新结果。 */
  retryLastError(): void {
    const action: (() => void) | undefined = this.retryAction;
    if (action === undefined) {
      return;
    }
    this.clearRetry();
    this.errorMsg = '';
    this.notify();
    action();
  }

  /** 收藏/取消收藏一个会话。 */
  toggleFavoriteSession(sessionId: string): void {
    if (sessionId.length === 0) {
      return;
    }
    if (this.favoriteSessions.includes(sessionId)) {
      this.favoriteSessions = this.favoriteSessions.filter(id => id !== sessionId);
    } else {
      this.favoriteSessions = this.favoriteSessions.concat([sessionId]);
    }
    this.store.saveSessionMeta(this.favoriteSessions, this.recentSessions);
    this.notify();
  }

  isFavoriteSession(sessionId: string): boolean {
    return this.favoriteSessions.includes(sessionId);
  }

  /** 打开会话时把它推到最近访问最前面（最多留 8 条）。 */
  private rememberRecentSession(sessionId: string): void {
    if (sessionId.length === 0) {
      return;
    }
    const next: string[] = [sessionId];
    for (const id of this.recentSessions) {
      if (id !== sessionId && next.length < 8) {
        next.push(id);
      }
    }
    this.recentSessions = next;
    this.store.saveSessionMeta(this.favoriteSessions, this.recentSessions);
  }

  /** 读某会话的草稿（没有就空串）。 */
  draftOf(sessionId: string): string {
    const value: string | undefined = this.drafts[sessionId];
    return value === undefined ? '' : value;
  }

  /** 记一条草稿；空文本即删除，避免脏数据堆积。 */
  saveDraft(sessionId: string, text: string): void {
    if (sessionId.length === 0) {
      return;
    }
    const next: Record<string, string> = {};
    for (const key of Object.keys(this.drafts)) {
      if (key !== sessionId) {
        next[key] = this.drafts[key];
      }
    }
    if (text.trim().length > 0) {
      next[sessionId] = text;
    }
    this.drafts = next;
    this.store.saveDrafts(next);
  }

  /** 提示词库增删（纯本地）。 */
  addPrompt(text: string): void {
    const trimmed: string = text.trim();
    if (trimmed.length === 0 || this.prompts.includes(trimmed)) {
      return;
    }
    this.prompts = this.prompts.concat([trimmed]);
    this.store.savePrompts(this.prompts);
    this.notify();
  }

  removePrompt(text: string): void {
    this.prompts = this.prompts.filter(item => item !== text);
    this.store.savePrompts(this.prompts);
    this.notify();
  }

  async createNewSession(): Promise<void> {
    if (this.phase !== PHASE_CHAT) {
      return;
    }
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      return;
    }
    // 当前会话还空着就顺手归档：否则连点几次「新建」会在列表里堆一串「新会话」。
    this.archiveBlankCurrentSession();
    this.setBusy(true);
    this.errorMsg = '';
    this.notify();
    try {
      // 空 cwd 会让主机把会话建到用户主目录（不是工程工作区），agent 起不来，
      // 表现就是「消息发出去了但永远没回复，切回来还消失」。
      const cwd: string = this.resolveNewSessionCwd();
      const workspaceId: string = this.selectedWorkspaceId;
      logInfo('session/create workspace=' + (workspaceId.length > 0 ? workspaceId : '(cwd)')
        + ' cwd=' + (cwd.length > 0 ? cwd : '(empty)'));
      const sessionId: string = await harness.sessionCreate(cwd, workspaceId);
      logInfo('session/create -> ' + sessionId);
      this.currentSessionId = sessionId;
      this.currentSessionTitle = '新会话';
      this.messages = [];
      this.historyHasMore = false;
      this.oldestHistorySeq = -1;
      this.generating = false;
      this.notify();
      const page: HistoryPage = await harness.sessionHistory(sessionId, -1, INITIAL_HISTORY_COUNT);
      if (this.currentSessionId === sessionId) {
        this.messages = foldHistory(page.entries);
        this.rememberHistory(sessionId, this.messages);
        this.notify();
      }
      this.refreshSessionsSoon();
      this.clearRetry();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.setRetry('新建会话', () => {
        this.createNewSession();
      });
    }
    this.setBusy(false);
    this.notify();
  }

  async openSession(sessionId: string): Promise<void> {
    if (this.phase !== PHASE_CHAT || sessionId === this.currentSessionId) {
      return;
    }
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      return;
    }
    this.setBusy(true);
    this.errorMsg = '';
    this.notify();
    try {
      let title: string = '';
      for (const session of this.sessions) {
        if (session.sessionId === sessionId) {
          title = sessionTitle(session);
          break;
        }
      }
      await this.openSessionInternal(harness, sessionId, title);
      this.rememberRecentSession(sessionId);
      this.hydrateHistoryImages().catch(() => undefined);
      this.clearRetry();
    } catch (error) {
      this.errorMsg = this.sessionStreamHint(error);
      this.setRetry(isTransportFailure(error) ? '重连并重新打开' : '重新打开会话', () => {
        if (isTransportFailure(error)) {
          this.reconnectAndReopen(sessionId);
        } else {
          this.reopenCurrentSession(sessionId);
        }
      });
    }
    this.setBusy(false);
    this.notify();
  }

  /**
   * 「重新打开会话」：重开当前会话的 follow 流（不动连接）。
   * 注意不能用 openSession —— 它看到 sessionId === currentSessionId 会直接 return，
   * 这正是以前点「重新打开」毫无反应、只能重启 App 的原因。
   */
  async reopenCurrentSession(target?: string): Promise<void> {
    NetTrace.streamReopen();
    this.pushLinkEvent('重新打开会话流（累计 ' + NetTrace.stats().streamReopens + ' 次）');
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      return;
    }
    const sessionId: string = target !== undefined && target.length > 0 ? target : this.currentSessionId;
    if (sessionId.length === 0) {
      // 连会话都没选中：重新拉一次列表并挑一个
      await this.loadSessionsAfterConnect();
      return;
    }
    if (this.busy) {
      return;
    }
    this.setBusy(true);
    this.errorMsg = '';
    this.clearRetry();
    this.notify();
    try {
      let title: string = this.currentSessionTitle;
      for (const session of this.sessions) {
        if (session.sessionId === sessionId) {
          title = sessionTitle(session);
          break;
        }
      }
      await this.openSessionInternal(harness, sessionId, title);
      this.rememberRecentSession(sessionId);
      this.hydrateHistoryImages().catch(() => undefined);
      logInfo('session reopened -> ' + sessionId);
    } catch (error) {
      const text: string = errorMessage(error);
      logWarn('reopen session failed: ' + text);
      this.nudgeLink();
      this.errorMsg = this.sessionStreamHint(error);
      this.setRetry(isTransportFailure(error) ? '重连并重新打开' : '重新打开会话', () => {
        if (isTransportFailure(error)) {
          this.reconnectAndReopen(sessionId);
        } else {
          this.reopenCurrentSession(sessionId);
        }
      });
    }
    this.setBusy(false);
    this.notify();
  }

  /**
   * 传输层已经不健康（TURN 半开、中继换节点、数据面 stall）时：
   * 直接换一条新连接，再用 pendingResumeSessionId 回到同一个会话。
   * 光重开流只会一遍遍失败，用户看到的就是「点了没用」。
   */
  async reconnectAndReopen(sessionId: string): Promise<void> {
    if (this.lastDeviceId.length === 0) {
      return;
    }
    this.pendingResumeSessionId = sessionId.length > 0 ? sessionId : this.currentSessionId;
    NetTrace.streamReopen();
    this.reconnecting = true;
    this.errorMsg = '';
    this.clearRetry();
    this.pushLinkEvent('会话流失败 → 重连并重新打开');
    this.teardownConnection();
    this.notify();
    await this.connectDevice(this.lastDeviceId);
  }

  /** 主动体检一次链路：会话流/RPC 失败时先用它把半开连接判死，别干等看门狗。 */
  private nudgeLink(): void {
    const relay: RelayTransport | undefined = this.activeRelay;
    if (relay === undefined) {
      return;
    }
    try {
      relay.recheckLink();
    } catch (error) {
      logWarn('recheck link failed: ' + errorMessage(error));
    }
  }

  /** 会话流失败时给用户看的文案：区分「传输断了」和「主机拒绝」。 */
  private sessionStreamHint(error: Object): string {
    const text: string = errorMessage(error);
    if (isTransportFailure(error)) {
      return '会话流断了（传输层已不可用）：点「重连并重新打开」换一条链路再进来，'
        + '不用退出 App。原始错误：' + text;
    }
    return '打开会话失败：' + text;
  }

  /**
   * 尝试把一行斜杠命令交给主机执行。
   * 返回 true 表示已被命令通道消费；false 表示应回退成普通 prompt。
   */
  private async trySlashCommand(harness: HarnessAlphaClient, sessionId: string,
    line: string): Promise<boolean> {
    try {
      const result: Record<string, Object> | undefined = await harness.commandsExecute(sessionId, line);
      const text: string = commandReplyText(result);
      if (text.length === 0) {
        // 有些命令（如 /permission）只产生副作用、没有文字回执。
        // 不能静默吞掉输入，否则用户会以为消息丢了。
        const note: ChatItem = new ChatItem();
        note.id = `cmd:${randomId()}`;
        note.kind = 'assistant';
        note.role = 'assistant';
        note.text = '已执行 ' + line.split(' ')[0];
        note.sessionId = sessionId;
        note.timestamp = Date.now();
        const noted: ChatItem[] = this.messages.slice();
        noted.push(note);
        this.messages = noted;
        this.notify();
        return true;
      }
      if (text.length > 0) {
        const item: ChatItem = new ChatItem();
        item.id = `cmd:${randomId()}`;
        item.kind = 'assistant';
        item.role = 'assistant';
        item.text = text;
        item.sessionId = sessionId;
        item.timestamp = Date.now();
        const next: ChatItem[] = this.messages.slice();
        next.push(item);
        this.messages = next;
        this.notify();
      }
      return true;
    } catch (error) {
      // 主机不认识这条命令（或该后端未实现）时静默回退成普通消息。
      logInfo('slash command not handled, falling back to prompt: ' + line.split(' ')[0]);
      return false;
    }
  }

  /** 把当前 config+credentials 记成一份 profile（同一 server+账号则覆盖）。 */
  private async rememberProfile(): Promise<void> {
    const config: StoredServerConfig | undefined = this.config;
    const credentials: TokenPair | undefined = this.credentials;
    const identity: DeviceIdentity | undefined = this.identity;
    if (config === undefined || credentials === undefined) {
      return;
    }
    const next: SavedProfile[] = [];
    for (const existing of this.profiles) {
      if (existing.baseUrl !== config.baseUrl || existing.email !== config.email) {
        next.push(existing);
      }
    }
    const profile: SavedProfile = new SavedProfile();
    profile.baseUrl = config.baseUrl;
    profile.email = config.email;
    profile.accessToken = credentials.accessToken;
    profile.accessTokenExpiresAt = credentials.accessTokenExpiresAt;
    profile.refreshToken = credentials.refreshToken;
    profile.refreshTokenExpiresAt = credentials.refreshTokenExpiresAt;
    profile.deviceId = identity !== undefined ? identity.deviceId : '';
    next.unshift(profile);
    this.profiles = next;
    try {
      await this.store.saveProfiles(next);
    } catch (error) {
      logWarn('save profiles failed: ' + errorMessage(error));
    }
  }

  /** 切换到一个已保存的服务器/账号：不需要重新输密码。 */
  async switchProfile(profile: SavedProfile): Promise<void> {
    if (this.switchingServer) {
      return;
    }
    this.switchingServer = true;
    this.switchingTo = profile.baseUrl;
    this.errorMsg = '';
    // 先把内存状态切过去，界面立刻有反应；落盘、旧连接清理都放到后面
    const config: StoredServerConfig = new StoredServerConfig();
    config.baseUrl = profile.baseUrl;
    config.email = profile.email;
    const tokens: TokenPair = new TokenPair();
    tokens.accessToken = profile.accessToken;
    tokens.accessTokenExpiresAt = profile.accessTokenExpiresAt;
    tokens.refreshToken = profile.refreshToken;
    tokens.refreshTokenExpiresAt = profile.refreshTokenExpiresAt;
    this.config = config;
    this.credentials = tokens;
    this.serverUrl = config.baseUrl;
    this.email = config.email;
    this.phase = PHASE_DEVICES;
    this.devices = [];
    // 换到另一套服务器/账号：打点与抖动计数清零，否则数字会串到上一台头上
    NetTrace.reset();
    this.sessionsSnapshot = [];
    this.sessionsSnapshotHost = '';
    this.setBusy(true);
    this.notify();
    // 旧连接是同步拆的（关闭 WS、销毁 core），丢到下一帧别挡点击响应
    setTimeout(() => {
      try {
        this.teardownConnection();
        this.clearReconnectTimer();
      } catch (error) {
        logWarn('teardown on switch failed: ' + errorMessage(error));
      }
    }, 0);
    try {
      await this.store.saveConfig(config);
      await this.store.saveCredentials(tokens);
      const identity: DeviceIdentity = await this.store.loadOrCreateIdentity();
      this.identity = identity;
      this.notify();
      await this.rememberProfile();
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.switchingServer = false;
    this.switchingTo = '';
    this.notify();
    // 设备列表单独刷新：失败只影响列表，不会把整个切换判死
    this.refreshDevices().catch(() => undefined);
  }

  /** 删掉一套保存的登录态（不影响服务端注册）。 */
  async forgetProfile(profile: SavedProfile): Promise<void> {
    const next: SavedProfile[] = [];
    for (const existing of this.profiles) {
      if (existing.baseUrl !== profile.baseUrl || existing.email !== profile.email) {
        next.push(existing);
      }
    }
    this.profiles = next;
    await this.store.saveProfiles(next);
    this.notify();
  }

  /** 载入 Host 工作区列表。 */
  async loadWorkspaces(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      return;
    }
    try {
      const snapshot: HarnessWorkspaceSnapshot = await harness.workspaceList();
      this.workspaces = snapshot.items;
      this.archivedSessionIds = snapshot.archivedSessionIds;
      this.pinnedSessionIds = snapshot.pinnedSessionIds;
      this.notify();
    } catch (error) {
      logWarn('workspace/list unavailable: ' + errorMessage(error));
    }
  }

  /** 打开工作区根目录。 */
  async openWorkspace(workspaceId: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      return;
    }
    let path: string = '';
    for (const workspace of this.workspaces) {
      if (workspace.workspaceId === workspaceId) {
        path = workspace.path;
        break;
      }
    }
    if (path.length === 0) {
      return;
    }
    await this.browseDirectory(path);
  }

  /** 列出某个目录的内容。 */
  async browseDirectory(path: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || path.length === 0) {
      return;
    }
    try {
      this.directoryEntries = await harness.listDirectory(path);
      this.browsePath = path;
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /** 返回上一级目录。 */
  async browseUp(): Promise<void> {
    const current: string = this.browsePath;
    if (current.length === 0) {
      return;
    }
    const cut: number = current.lastIndexOf('/');
    if (cut <= 0) {
      return;
    }
    await this.browseDirectory(current.substring(0, cut));
  }

  /** 新建工作区并刷新列表。 */
  async createWorkspace(path: string, title: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || path.trim().length === 0) {
      return;
    }
    try {
      await harness.workspaceCreate(path.trim(), title.trim());
      await this.loadWorkspaces();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /** 工作区重命名。 */
  async renameWorkspace(workspaceId: string, title: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || title.trim().length === 0) {
      return;
    }
    try {
      await harness.workspaceRename(workspaceId, title.trim());
      await this.loadWorkspaces();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /** 删除工作区。 */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || workspaceId.length === 0) {
      return;
    }
    try {
      await harness.workspaceDelete(workspaceId);
      if (this.selectedWorkspaceId === workspaceId) {
        this.selectedWorkspaceId = '';
      }
      await this.loadWorkspaces();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /** 选择新建会话使用的工作区；空字符串表示跟随当前会话。 */
  setSelectedWorkspace(workspaceId: string): void {
    this.selectedWorkspaceId = workspaceId;
    this.notify();
  }

  /** 载入斜杠命令清单；主机返回空则用内置兜底清单。 */
  async loadSlashCommands(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    const collected: SlashCommand[] = [];
    if (harness !== undefined) {
      try {
        const items: Record<string, Object>[] = await harness.commandsList(sessionId);
        for (const item of items) {
          const name: string = jsonStr(item, 'name', '');
          const command: string = name.length > 0 ? name : jsonStr(item, 'command', '');
          if (command.length === 0) {
            continue;
          }
          const entry: SlashCommand = new SlashCommand();
          entry.name = command.startsWith('/') ? command : '/' + command;
          entry.description = jsonStr(item, 'description', jsonStr(item, 'title', ''));
          collected.push(entry);
        }
      } catch (error) {
        logWarn('commands/list unavailable: ' + errorMessage(error));
      }
    }
    if (collected.length === 0) {
      collected.push(...builtinSlashCommands());
    }
    this.slashCommands = collected;
    this.notify();
  }

  /** 切换「排队 / 插话」发送模式。 */
  setSteerMode(enabled: boolean): void {
    this.steerMode = enabled;
    this.notify();
  }

  /** 中断当前轮。 */
  async stopGeneration(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      await harness.sessionCancel(sessionId);
      this.generating = false;
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /** 重命名当前会话。 */
  async renameCurrentSession(title: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    const trimmed: string = title.trim();
    if (harness === undefined || sessionId.length === 0 || trimmed.length === 0) {
      return;
    }
    try {
      await harness.sessionRename(sessionId, trimmed);
      this.currentSessionTitle = trimmed;
      const next: HarnessRemoteSession[] = this.sessions.slice();
      for (const session of next) {
        if (session.sessionId === sessionId) {
          session.title = trimmed;
        }
      }
      this.sessions = next;
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /**
   * 新建会话前收尾：当前会话一条消息都没有、也没在跑，就先归档，
   * 免得「新建」点几次就堆出一串空会话（主机列表会越来越难找）。
   */
  private archiveBlankCurrentSession(): void {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    if (this.messages.length > 0 || this.generating) {
      return;
    }
    let blank: boolean = false;
    let running: boolean = false;
    for (const session of this.sessions) {
      if (session.sessionId === sessionId) {
        blank = session.blank;
        running = session.running;
        break;
      }
    }
    if (!blank || running) {
      return;
    }
    logInfo('archive blank session before create: ' + sessionId);
    harness.sessionArchive(sessionId).then((ids: string[]) => {
      this.archivedSessionIds = ids;
      this.pinnedSessionIds = this.pinnedSessionIds.filter((id: string) => id !== sessionId);
      this.notify();
    }).catch((error: Error) => {
      logWarn('archive blank session failed: ' + errorMessage(error));
    });
  }

  /**
   * 往更早翻一页历史（首屏只拉最近 30 条）。
   * 主机按 beforeSeq 返回，返回的条目拼到最前面；同一 seq 的重复条目会被丢掉。
   */
  async loadOlderHistory(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    if (!this.historyHasMore || this.loadingOlderHistory) {
      return;
    }
    const before: number = this.oldestHistorySeq;
    if (before < 0) {
      // 首屏没给出可用 seq（空会话、主机未回游标）：没有翻页锚点，收手
      this.historyHasMore = false;
      return;
    }
    this.loadingOlderHistory = true;
    this.notify();
    try {
      const page: HistoryPage = await harness.sessionPage(sessionId, before, INITIAL_HISTORY_COUNT);
      if (this.currentSessionId !== sessionId) {
        return;
      }
      const older: ChatItem[] = foldHistory(page.entries);
      if (older.length > 0) {
        const cut: number = oldestSeqOf(page.entries);
        // 已经有的 seq 不再插一遍（翻页边界偶尔会重叠一两条）
        const seen: number[] = [];
        for (const item of this.messages) {
          if (item.seq > 0) {
            seen.push(item.seq);
          }
        }
        const kept: ChatItem[] = [];
        for (const item of older) {
          if (item.seq > 0 && seen.includes(item.seq)) {
            continue;
          }
          kept.push(item);
        }
        const merged: ChatItem[] = kept.concat(this.messages);
        this.messages = merged;
        this.rememberHistory(sessionId, merged);
        if (cut >= 0) {
          this.oldestHistorySeq = cut;
        }
        this.scheduleImageHydration();
      }
      this.historyHasMore = page.hasMore;
      this.clearRetry();
      logInfo('session/page before=' + before + ' -> ' + older.length + ' item(s), hasMore=' + page.hasMore);
    } catch (error) {
      const text: string = errorMessage(error);
      logWarn('session/page failed: ' + text);
      if (text.indexOf('cursor') >= 0) {
        // 游标已经对不上（换会话 / 主机重放）：这次不翻，也不再拿错误条打扰用户
        this.historyHasMore = false;
      } else {
        this.errorMsg = text;
        this.setRetry('重新加载更早', () => {
          this.loadOlderHistory();
        });
      }
    }
    this.loadingOlderHistory = false;
    this.notify();
  }

  /**
   * 把当前会话拼成 Markdown（复制到剪贴板用）。
   * 只取已加载的部分：首屏 30 条 + 手动翻的更早历史；工具调用压成一行，不铺长参数。
   */
  sessionMarkdown(): string {
    const lines: string[] = [];
    const title: string = this.currentSessionTitle.length > 0 ? this.currentSessionTitle : '会话';
    lines.push('# ' + title);
    const meta: string[] = [];
    if (this.connectedHostName.length > 0) {
      meta.push('主机：' + this.connectedHostDisplayName());
    }
    if (this.currentSessionId.length > 0) {
      meta.push('会话：' + this.currentSessionId);
    }
    meta.push('导出：' + formatStamp(Date.now()));
    lines.push('');
    lines.push('> ' + meta.join(' · '));
    lines.push('');
    const out: string[] = [];
    for (const item of this.messages) {
      if (item.kind === 'user') {
        if (item.text.length === 0) {
          continue;
        }
        out.push('## 我 · ' + formatStamp(item.timestamp));
        out.push('');
        out.push(item.text);
        out.push('');
      } else if (item.kind === 'assistant') {
        if (item.text.length === 0) {
          continue;
        }
        out.push('## 助手 · ' + formatStamp(item.timestamp));
        out.push('');
        out.push(item.text);
        out.push('');
      } else if (item.kind === 'tool' || item.kind === 'toolrun') {
        const name: string = item.toolName.length > 0 ? item.toolName : 'tool';
        const state: string = item.toolState.length > 0 ? item.toolState : '';
        out.push('- `' + name + '`' + (state.length > 0 ? '（' + state + '）' : '')
          + (item.summary.length > 0 ? '：' + firstLineOf(item.summary) : ''));
      } else if (item.kind === 'notice') {
        if (item.text.length > 0) {
          out.push('> ⚠ ' + firstLineOf(item.text));
        }
      }
    }
    const body: string = out.join('\n').trim();
    lines.push(body.length > 0 ? body : '_（这段历史里没有可导出的正文）_');
    lines.push('');
    const markdown: string = lines.join('\n');
    logInfo('session markdown -> ' + markdown.length + ' chars');
    return markdown;
  }

  /**
   * 指定会话的 Markdown（会话行菜单用）。
   * 不是当前会话就先切过去——导出要靠已加载的历史，换会话再拼最稳。
   */
  async sessionMarkdownFor(sessionId: string): Promise<string> {
    if (sessionId.length === 0) {
      return '';
    }
    if (sessionId !== this.currentSessionId) {
      await this.openSession(sessionId);
    }
    return this.sessionMarkdown();
  }

  /** 会话列表密度。 */
  setLayoutDensity(value: number): void {
    this.layoutDensity = value;
    this.store.saveLayoutDensity(value).catch((error: Error) => {
      logWarn('save layout density failed: ' + errorMessage(error));
    });
    this.notify();
  }

  /** 右侧详情栏开关。 */
  setShowInspector(value: boolean): void {
    this.showInspector = value;
    this.store.saveShowInspector(value).catch((error: Error) => {
      logWarn('save inspector pref failed: ' + errorMessage(error));
    });
    this.notify();
  }

  /** 记住分栏宽度（拖完分隔条调用）。 */
  setSplitWidth(width: number): void {
    const clamped: number = Math.max(240, Math.min(460, Math.round(width)));
    this.splitWidth = clamped;
    this.store.saveSplitWidth(clamped).catch((error: Error) => {
      logWarn('save split width failed: ' + errorMessage(error));
    });
    this.notify();
  }

  /** 归档指定会话（会话列表长按触发）。归档集合以主机回执为准。 */
  async archiveSession(sessionId: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      this.archivedSessionIds = await harness.sessionArchive(sessionId);
      // 归档同时会取消置顶，别让旧置顶留在本地
      this.pinnedSessionIds = this.pinnedSessionIds.filter((id: string) => id !== sessionId);
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = '';
        this.currentSessionTitle = '';
        this.messages = [];
      }
      this.clearRetry();
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.setRetry('重新归档', () => {
        this.archiveSession(sessionId);
      });
      this.notify();
    }
  }

  /** 取消归档：把会话从归档集合里放回列表。 */
  async unarchiveSession(sessionId: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      this.archivedSessionIds = await harness.sessionUnarchive(sessionId);
      this.clearRetry();
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.setRetry('重新取消归档', () => {
        this.unarchiveSession(sessionId);
      });
      this.notify();
    }
  }

  /** 置顶 / 取消置顶会话。 */
  async togglePinSession(sessionId: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    const pinned: boolean = this.isPinnedSession(sessionId);
    try {
      this.pinnedSessionIds = pinned
        ? await harness.sessionUnpin(sessionId)
        : await harness.sessionPin(sessionId);
      this.clearRetry();
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.setRetry(pinned ? '重新取消置顶' : '重新置顶', () => {
        this.togglePinSession(sessionId);
      });
      this.notify();
    }
  }

  isArchivedSession(sessionId: string): boolean {
    return this.archivedSessionIds.includes(sessionId);
  }

  isPinnedSession(sessionId: string): boolean {
    return this.pinnedSessionIds.includes(sessionId);
  }

  /** 归档当前会话并回到会话列表。 */
  async archiveCurrentSession(): Promise<void> {
    const sessionId: string = this.currentSessionId;
    if (sessionId.length === 0) {
      return;
    }
    await this.archiveSession(sessionId);
  }

  /** 全文搜索会话；空字符串表示退出搜索。 */
  async searchSessions(query: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const trimmed: string = query.trim();
    if (trimmed.length === 0) {
      this.searchResults = undefined;
      this.notify();
      return;
    }
    if (harness === undefined) {
      return;
    }
    try {
      const found: HarnessRemoteSession[] = await harness.sessionSearch(trimmed);
      this.searchResults = found;
    } catch (error) {
      this.searchResults = [];
      this.errorMsg = errorMessage(error);
    }
    this.notify();
  }

  /** 读取当前会话的上下文占用与用量。 */
  async refreshProjections(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      // 主机返回 { asOfSeq, values }；上下文占用在 values 里，键名随版本可能不同，
      // 因此这里按「任何带 percent 的对象」扫描，取第一个有效值。
      const raw: Record<string, Object> = await harness.sessionProjections(sessionId);
      const values: Record<string, Object> | undefined = asRecord(raw['values']);
      const percent: number = values !== undefined ? findPercent(values) : findPercent(raw);
      this.contextPercent = percent > 0 ? percent : 0;
      this.notify();
    } catch (error) {
      // 投影是锦上添花，失败不打扰用户。
      logWarn('projections unavailable: ' + errorMessage(error));
    }
  }

  /** 拉取模型目录并解析成可选列表。 */
  async refreshModelCatalog(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      return;
    }
    try {
      const raw: Record<string, Object> = await harness.modelCatalog();
      this.modelCatalogRaw = raw;
      const options: ModelOption[] = [];
      const groups: Object[] | undefined = asArray(raw['groups']);
      if (groups !== undefined) {
        for (const groupValue of groups) {
          const group: Record<string, Object> | undefined = asRecord(groupValue);
          if (group === undefined) {
            continue;
          }
          const providerId: string = jsonStr(group, 'id', '');
          const models: Object[] | undefined = asArray(group['models']);
          if (models === undefined) {
            continue;
          }
          for (const modelValue of models) {
            const model: Record<string, Object> | undefined = asRecord(modelValue);
            if (model === undefined) {
              continue;
            }
            const option: ModelOption = new ModelOption();
            option.provider = providerId;
            option.model = jsonStr(model, 'id', '');
            option.name = jsonStr(model, 'name', option.model);
            option.description = jsonStr(model, 'description', '');
            const reasoning: Record<string, Object> | undefined = asRecord(model['reasoning']);
            if (reasoning !== undefined) {
              const efforts: Object[] | undefined = asArray(reasoning['efforts']);
              if (efforts !== undefined) {
                for (const effortValue of efforts) {
                  const effort: Record<string, Object> | undefined = asRecord(effortValue);
                  if (effort !== undefined) {
                    const id: string = jsonStr(effort, 'id', '');
                    if (id.length > 0) {
                      option.efforts.push(id);
                    }
                  }
                }
              }
            }
            if (option.model.length > 0) {
              options.push(option);
            }
          }
        }
      }
      this.modelOptions = options;
      const fallback: Record<string, Object> | undefined = asRecord(raw['default']);
      if (fallback !== undefined) {
        const defaultModel: string = jsonStr(fallback, 'model', '');
        if (defaultModel.length > 0) {
          this.currentModelLabel = defaultModel;
          this.currentModelProvider = jsonStr(fallback, 'provider', '');
          this.currentModelEffort = jsonStr(fallback, 'reasoningEffort', '');
        }
      }
      const failures: Object[] | undefined = asArray(raw['failures']);
      if (failures !== undefined) {
        for (const failureValue of failures) {
          const failure: Record<string, Object> | undefined = asRecord(failureValue);
          if (failure !== undefined) {
            logWarn('model catalog failure: ' + jsonStr(failure, 'id', '?') + ' '
              + jsonStr(failure, 'message', ''));
          }
        }
      }
      logInfo('model catalog: options=' + options.length
        + ' current=' + this.currentModelProvider + '/' + this.currentModelLabel
        + (this.currentModelEffort.length > 0 ? ' @' + this.currentModelEffort : ''));
      this.modelCatalogLoaded = options.length > 0;
      this.notify();
    } catch (error) {
      logWarn('model catalog unavailable: ' + errorMessage(error));
    }
  }

  /** 切换当前会话的权限预设。 */
  async selectPermission(preset: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      // DSH 的 session API 没有 selectPermission（只在 create 时能指定），运行期切换走内置命令
      const result: Record<string, Object> | undefined =
        await harness.commandsExecute(sessionId, '/permission ' + preset);
      const text: string = commandReplyText(result);
      logInfo('permission switch -> ' + preset + ' : ' + text);
      if (text.indexOf('unknown preset') >= 0) {
        this.errorMsg = text;
        this.parsePermissionOptions(text);
        this.notify();
        return;
      }
      this.permissionPreset = preset;
      this.errorMsg = '';
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /**
   * 取某张历史图片的字节（base64）；没拉到时返回空串。
   *
   * 之前是把字节塞进 ChatItem，一旦会话重新折叠历史（openSession / follow 快照）
   * 就被冲掉，界面上只剩一条空消息。改成「消息只记 attachmentId，渲染时查缓存」。
   */
  imageFor(attachmentId: string): string {
    const cached: string | undefined = this.attachmentCache.get(attachmentId);
    return cached !== undefined ? cached : '';
  }

  /** 读一次 `/permission`（不带参数）：回执带当前值与可选项，用来把面板铺对。 */
  async refreshPermissionState(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      const result: Record<string, Object> | undefined =
        await harness.commandsExecute(sessionId, '/permission');
      const text: string = commandReplyText(result);
      logInfo('permission state: ' + text);
      const at: number = text.indexOf('current preset ');
      if (at >= 0) {
        const tail: string = text.substring(at + 'current preset '.length);
        const space: number = tail.indexOf(' ');
        const current: string = space >= 0 ? tail.substring(0, space) : tail;
        if (current.length > 0) {
          this.permissionPreset = current;
        }
      }
      this.parsePermissionOptions(text);
      this.notify();
    } catch (error) {
      logWarn('permission state unavailable: ' + errorMessage(error));
    }
  }

    /** 从 `(available: a, b, c)` 里取可选项。 */
  private parsePermissionOptions(text: string): void {
    const at: number = text.indexOf('(available: ');
    if (at < 0) {
      return;
    }
    const tail: string = text.substring(at + '(available: '.length);
    const close: number = tail.indexOf(')');
    const body: string = close >= 0 ? tail.substring(0, close) : tail;
    const names: string[] = [];
    for (const piece of body.split(',')) {
      const name: string = piece.trim();
      if (name.length > 0 && !names.includes(name)) {
        names.push(name);
      }
    }
    if (names.length > 0) {
      this.permissionOptions = names;
    }
  }

  /** 切换当前会话的模型。 */
  async selectModel(provider: string, model: string, reasoningEffort: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      await harness.selectModel(sessionId, provider, model, reasoningEffort);
      this.currentModelLabel = model;
      this.currentModelProvider = provider;
      this.currentModelEffort = reasoningEffort;
      logInfo('model selected: ' + provider + '/' + model
        + (reasoningEffort.length > 0 ? ' @' + reasoningEffort : ''));
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /** 从当前会话的某条消息处分叉出新会话并切过去。 */
  async forkCurrentSession(atSeq: number): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      const forkedId: string = await harness.sessionFork(sessionId, atSeq);
      await this.refreshSessionsSoon();
      await this.openSession(forkedId);
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  async sendPrompt(text: string, images: PromptImagePart[] = []): Promise<void> {
    const trimmed: string = text.trim();
    if (trimmed.length === 0 && images.length === 0) {
      return;
    }
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    const requestId: string = randomId();
    const item: ChatItem = new ChatItem();
    item.id = `local:${requestId}`;
    item.kind = 'user';
    item.role = 'user';
    item.text = trimmed;
    item.requestRpcId = requestId;
    item.sessionId = sessionId;
    item.timestamp = Date.now();
    if (images.length > 0) {
      const previews: string[] = [];
      for (const image of images) {
        previews.push(image.base64);
      }
      item.images = previews;
    }
    const next: ChatItem[] = this.messages.slice();
    next.push(item);
    this.messages = next;
    // 以 / 开头且未生成中的单行输入，先按斜杠命令交给主机执行。
    if (images.length === 0 && trimmed.startsWith('/') && !trimmed.includes('\n') && !this.generating) {
      const handled: boolean = await this.trySlashCommand(harness, sessionId, trimmed);
      if (handled) {
        return;
      }
    }
    this.generating = true;
    this.errorMsg = '';
    this.notify();
    try {
      await harness.sessionPrompt(sessionId, trimmed, requestId,
        this.steerMode ? 'steer' : 'queue', images);
      this.clearRetry();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.generating = false;
      // 主机没收到：先把乐观插入的气泡撤掉，重试时按原样重发一次，避免重复两条
      const kept: ChatItem[] = [];
      for (const item of this.messages) {
        if (item.id !== `local:${requestId}`) {
          kept.push(item);
        }
      }
      this.messages = kept;
      this.setRetry('重新发送', () => {
        this.sendPrompt(trimmed, images);
      });
      this.notify();
    }
  }

  /** 下一个 tick 再补水，避免每个事件都触发一轮 RPC。 */
  private scheduleImageHydration(): void {
    if (this.imageHydrateScheduled) {
      return;
    }
    let needed: boolean = false;
    for (const item of this.messages) {
      if (item.kind !== 'user') {
        continue;
      }
      for (const id of item.imageAttachmentIds) {
        if (!this.fetchedAttachments.has(id)) {
          needed = true;
          break;
        }
      }
      if (needed) {
        break;
      }
    }
    if (!needed) {
      return;
    }
    this.imageHydrateScheduled = true;
    setTimeout(() => {
      this.imageHydrateScheduled = false;
      this.hydrateHistoryImages().catch(() => undefined);
    }, 60);
  }

  /**
   * 历史图片按需补字节：`user/message` 只带 attachmentId，
   * 逐张调 `session/attachment` 拉回 base64 填进对应气泡（失败就标记，别反复问主机）。
   */
  private async hydrateHistoryImages(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    for (let guard = 0; guard < 24; guard += 1) {
      let attachmentId: string = '';
      let attachmentRef: Record<string, Object> | undefined = undefined;
      for (const item of this.messages) {
        if (item.kind !== 'user' || item.imageAttachmentIds.length === 0) {
          continue;
        }
        for (let i = 0; i < item.imageAttachmentIds.length; i += 1) {
          const id: string = item.imageAttachmentIds[i];
          if (this.fetchedAttachments.has(id)) {
            continue;
          }
          attachmentId = id;
          attachmentRef = parseAttachmentRef(i < item.imageRefs.length ? item.imageRefs[i] : '');
          break;
        }
        if (attachmentId.length > 0) {
          break;
        }
      }
      if (attachmentId.length === 0) {
        return;
      }
      this.fetchedAttachments.set(attachmentId, '');
      let body: string = '';
      const cached: string | undefined = this.attachmentCache.get(attachmentId);
      if (cached !== undefined) {
        body = cached;
      } else {
        try {
          body = await harness.sessionAttachment(sessionId, attachmentId, attachmentRef);
          this.attachmentCache.set(attachmentId, body);
        } catch (error) {
          const text: string = errorMessage(error);
          logWarn('history image ' + attachmentId + ' failed (ref=' +
            (attachmentRef === undefined ? 'no' : 'yes') + '): ' + text);
          // 0.2.2+ 的 Host 要完整 ImageAttachmentRef；只报日志的话用户只会看到图片空着
          if (text.toLowerCase().indexOf('attachment') >= 0) {
            this.pushLinkEvent('图片附件读取失败（可能是 Host 版本要求完整引用）');
          }
          this.attachmentCache.set(attachmentId, '');
        }
      }
      if (body.length === 0) {
        this.notify();
        continue;
      }
      logInfo('history image ok ' + attachmentId.substring(0, 20) + ' base64=' + body.length +
        ' ref=' + (attachmentRef === undefined ? 'no' : 'yes'));
      this.notify();
      const next: ChatItem[] = this.messages.slice();
      let changed: boolean = false;
      for (let i = 0; i < next.length; i += 1) {
        const item: ChatItem = next[i];
        if (!item.imageAttachmentIds.includes(attachmentId) || item.images.includes(body)) {
          continue;
        }
        const updated: ChatItem = cloneItem(item);
        updated.images = updated.images.concat([body]);
        updated.rev += 1;
        next[i] = updated;
        changed = true;
      }
      if (changed) {
        this.messages = next;
        this.notify();
      }
    }
  }

  async cancel(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0 || !this.generating) {
      return;
    }
    try {
      await harness.sessionCancel(sessionId);
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  async respondApproval(item: ChatItem, allowed: boolean): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || item.kind !== 'approval' || item.approvalOutcome.length > 0) {
      return;
    }
    const outcome: string = allowed ? 'allowed-once' : 'rejected';
    this.busyAction = `approval:${item.id}`;
    this.errorMsg = '';
    this.notify();
    try {
      await harness.respondApproval(item.frameRpcId, item.sessionId, item.approvalId, outcome);
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.busyAction = '';
    this.notify();
  }

  toggleQuestionOption(item: ChatItem, question: ChatQuestion, label: string): void {
    if (item.kind !== 'question' || item.questionOutcome.length > 0) {
      return;
    }
    const next: ChatItem[] = this.messages.slice();
    const index: number = next.indexOf(item);
    if (index < 0) {
      return;
    }
    const updated: ChatItem = cloneItem(item);
    const clonedQuestions: ChatQuestion[] = [];
    for (const source of updated.questions) {
      const copy: ChatQuestion = new ChatQuestion();
      copy.id = source.id;
      copy.question = source.question;
      copy.detail = source.detail;
      copy.header = source.header;
      copy.options = source.options.slice();
      copy.multiSelect = source.multiSelect;
      copy.selectedLabels = source.selectedLabels.slice();
      clonedQuestions.push(copy);
    }
    for (const copy of clonedQuestions) {
      if (copy.id !== question.id) {
        continue;
      }
      const position: number = copy.selectedLabels.indexOf(label);
      if (copy.multiSelect) {
        if (position >= 0) {
          copy.selectedLabels.splice(position, 1);
        } else {
          copy.selectedLabels.push(label);
        }
      } else {
        if (position >= 0) {
          copy.selectedLabels = [];
        } else {
          copy.selectedLabels = [label];
        }
      }
      break;
    }
    updated.questions = clonedQuestions;
    updated.rev += 1;
    next[index] = updated;
    this.messages = next;
    this.notify();
  }

  async submitQuestion(item: ChatItem): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || item.kind !== 'question' || item.questionOutcome.length > 0) {
      return;
    }
    const answers: Object[] = [];
    for (const question of item.questions) {
      const selected: Object[] = [];
      for (const label of question.selectedLabels) {
        selected.push(label);
      }
      const answer: Record<string, Object> = {
        'id': question.id,
        'selected': selected
      };
      answers.push(answer);
    }
    const value: Record<string, Object> = { 'answers': answers };
    this.busyAction = `question:${item.id}`;
    this.errorMsg = '';
    this.notify();
    try {
      await harness.respondQuestion(item.frameRpcId, item.sessionId, value);
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.busyAction = '';
    this.notify();
  }

  refreshSessionsSoon(): void {
    if (this.refreshTimer >= 0) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = -1;
      this.refreshSessions();
    }, 300);
  }

  /**
   * Trust-on-first-use pin of the Host identity key (protocol §2 / §12.1): the Client must
   * keep a local Pinned Key record per Host, and a changed key for the same Host deviceId
   * aborts the connection to block man-in-the-middle attacks. The Noise IK handshake then
   * proves the pinned Host actually holds the matching private key. Returns the effective
   * pinned key so the secure handshake can enforce it as well.
   */
  private async enforceHostPin(host: AuthorizedPeerDevice): Promise<string> {
    const pins: Record<string, string> = this.store.loadHostPins();
    const pinned: string | undefined = pins[host.deviceId];
    if (pinned !== undefined) {
      if (pinned !== host.identityKey) {
        logError(`host identity key mismatch for ${host.deviceId}; aborting to prevent MITM`);
        throw new Error('主机身份公钥与本地固定记录不一致，为防中间人攻击已中断连接。若主机确已重置，请先清除本机固定记录后重试');
      }
      return pinned;
    }
    pins[host.deviceId] = host.identityKey;
    await this.store.saveHostPins(pins);
    logInfo(`pinned host identity key for ${host.deviceId}`);
    return host.identityKey;
  }

  /**
   * 记住上一次成功拉到的会话列表，并绑定当时的主机。
   * 用途：抖动导致列表拉不到时，侧栏还能显示上次的结果，
   * 而不是「会话列表加载失败 + 空白侧栏」让人以为会话没了。
   */
  private rememberSessions(sessions: HarnessRemoteSession[]): void {
    this.sessionsSnapshot = sessions;
    this.sessionsSnapshotHost = this.lastDeviceId;
  }

  /**
   * 把会话列表存成本地快照（只存侧栏要用的字段）。
   * 目的：启动或重连时列表能先画出来，不用干等主机那 3~9 秒的 session/list。
   */
  private persistSessionSnapshot(sessions: HarnessRemoteSession[]): void {
    const host: string = this.lastDeviceId;
    if (host.length === 0) {
      return;
    }
    const rows: Record<string, Object>[] = [];
    for (const item of sessions) {
      rows.push({
        'sessionId': item.sessionId,
        'title': item.title,
        'updatedAt': item.updatedAt,
        'running': item.running,
        'blank': item.blank,
        'cwd': item.cwd,
        'turns': item.turns,
        'contextPercent': item.contextPercent
      });
    }
    try {
      this.store.saveSessionSnapshot(JSON.stringify({ 'host': host, 'at': Date.now(), 'items': rows }));
    } catch (error) {
      logWarn('snapshot save failed');
    }
  }

  /** 读本地会话列表快照（启动预热用）；主机不一致或解析失败返回空数组。 */
  private loadSessionSnapshot(host: string): HarnessRemoteSession[] {
    const raw: string = this.store.loadSessionSnapshot(host);
    if (raw.length === 0) {
      return [];
    }
    const out: HarnessRemoteSession[] = [];
    try {
      const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      const items: Object | undefined = parsed['items'];
      if (items === undefined || !Array.isArray(items)) {
        return [];
      }
      for (const entry of items as Object[]) {
        const row: Record<string, Object> = entry as Record<string, Object>;
        const session: HarnessRemoteSession = new HarnessRemoteSession();
        const id: Object | undefined = row['sessionId'];
        if (typeof id !== 'string' || id.length === 0) {
          continue;
        }
        session.sessionId = id;
        const title: Object | undefined = row['title'];
        session.title = typeof title === 'string' ? title : '';
        const updatedAt: Object | undefined = row['updatedAt'];
        session.updatedAt = typeof updatedAt === 'number' ? updatedAt : 0;
        session.running = row['running'] === true;
        session.blank = row['blank'] === true;
        const cwd: Object | undefined = row['cwd'];
        session.cwd = typeof cwd === 'string' ? cwd : '';
        const turns: Object | undefined = row['turns'];
        session.turns = typeof turns === 'number' ? turns : 0;
        const percent: Object | undefined = row['contextPercent'];
        session.contextPercent = typeof percent === 'number' ? percent : 0;
        out.push(session);
      }
    } catch (error) {
      return [];
    }
    return out;
  }

  private async refreshSessions(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || this.phase !== PHASE_CHAT) {
      return;
    }
    try {
      const sessions: HarnessRemoteSession[] = await harness.sessionList(12000);
      if (this.harness === harness && this.phase === PHASE_CHAT) {
        this.sessions = sortSessions(sessions);
        this.rememberSessions(this.sessions);
        this.notify();
      }
    } catch (error) {
      return;
    }
  }

  /** The device list does not always carry presence, so ask per host before showing offline. */
  private async fillPresence(devices: RemoteHostDevice[]): Promise<void> {
    for (const device of devices) {
      if (device.presenceKnown) {
        continue;
      }
      try {
        const presence: HostPresence = await this.presenceWithRetry(device.deviceId);
        device.online = presence.online;
        device.presenceKnown = true;
        if (presence.lastSeenAt > 0) {
          device.lastSeenAt = presence.lastSeenAt;
        }
      } catch (error) {
        // keep the value from the list response
      }
    }
  }

  /**
   * 在线状态判断：给 4 秒预算（一次请求 + 一次仅针对鉴权失败的重试）。
   * 这只是决定「能不能连」，超时就当未知，交给后续握手去暴露真实原因，
   * 而不是在这里把连接失败拖到 30 秒（上游 #326 的 HOST_DESCRIBE_TIMEOUT_MS 同一思路）。
   */
  private async presenceWithRetry(deviceId: string): Promise<HostPresence> {
    const api: RemoteServerApi = await this.ensureApi();
    const probe: Promise<HostPresence> = (async (): Promise<HostPresence> => {
      try {
        return await api.presenceFor(deviceId);
      } catch (error) {
        if (!isAuthError(error)) {
          throw asError(error);
        }
        this.dropAccessToken();
        const retried: RemoteServerApi = await this.ensureApi();
        return await retried.presenceFor(deviceId);
      }
    })();
    // 4 秒预算：在线状态只是「要不要连」的前置判断，超时就当未知（不拦连接），
    // 让 Noise 握手去暴露真实原因，而不是把失败拖到 30 秒。
    const timeout: Promise<HostPresence> = new Promise<HostPresence>((resolve) => {
      setTimeout(() => {
        const unknown: HostPresence = new HostPresence();
        unknown.online = true;
        unknown.lastSeenAt = 0;
        resolve(unknown);
      }, AppRuntime.PRESENCE_BUDGET_MS);
    });
    return Promise.race([probe, timeout]);
  }

  /** Start QR login against `baseUrl`; the UI renders `qrUrl` and polling runs by itself. */
  /** Load the provider list once so the login screen can offer Google / Zhihu / GitHub. */
  async loadProviders(baseUrl: string): Promise<void> {
    try {
      const raw: string = baseUrl.trim().length > 0 ? baseUrl.trim() : DEFAULT_SERVER_URL;
      const api: RemoteServerApi = new RemoteServerApi(normalizeServerUrl(raw));
      const items: OAuthProvider[] = await api.oauthProviders();
      if (items.length > 0) {
        this.providers = items;
        let stillValid: boolean = false;
        for (const item of items) {
          if (item.id === this.providerId) {
            stillValid = true;
          }
        }
        if (!stillValid) {
          this.providerId = items[0].id;
        }
        this.notify();
        return;
      }
    } catch (error) {
      // 自建 server 不一定实现 /auth/oauth/providers；这只是「能不能扫码登录」的探测，
      // 失败不该在登录页糊一条红字（METHOD_NOT_FOUND 之类），记日志就够。
      logWarn('oauth providers unavailable: ' + errorMessage(error));
    }
    this.providers = [];
    this.notify();
  }

  selectProvider(id: string): void {
    this.providerId = id;
    this.notify();
  }

  async startQrLogin(baseUrl: string): Promise<void> {
    this.errorMsg = '';
    this.stopQrPolling();
    try {
      const raw: string = baseUrl.trim().length > 0 ? baseUrl.trim() : DEFAULT_SERVER_URL;
      const normalized: string = normalizeServerUrl(raw);
      const api: RemoteServerApi = new RemoteServerApi(normalized);
      const session: QrLoginSession = await api.startQrLogin(this.providerId);
      this.qrBaseUrl = normalized;
      this.qrId = session.qrId;
      this.qrUrl = session.scanUrl;
      this.qrDeadline = Date.now() + session.expiresIn * 1000;
      this.notify();
      this.scheduleQrPoll();
      return;
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.qrUrl = '';
    this.qrId = '';
    this.notify();
  }

  cancelQrLogin(): void {
    this.stopQrPolling();
    this.qrId = '';
    this.qrUrl = '';
    this.notify();
  }

  private stopQrPolling(): void {
    if (this.qrTimer >= 0) {
      clearTimeout(this.qrTimer);
      this.qrTimer = -1;
    }
  }

  private scheduleQrPoll(): void {
    this.stopQrPolling();
    this.qrTimer = setTimeout(() => {
      this.qrTimer = -1;
      this.pollQrLogin();
    }, 2000);
  }

  private async pollQrLogin(): Promise<void> {
    const qrId: string = this.qrId;
    if (qrId.length === 0) {
      return;
    }
    if (Date.now() > this.qrDeadline) {
      this.qrId = '';
      this.qrUrl = '';
      this.errorMsg = '二维码已过期，请重新获取';
      this.notify();
      return;
    }
    try {
      const api: RemoteServerApi = new RemoteServerApi(this.qrBaseUrl);
      const poll: QrLoginPoll = await api.pollQrLogin(qrId);
      if (poll.status === 'expired') {
        this.qrId = '';
        this.qrUrl = '';
        this.errorMsg = '二维码已过期，请重新获取';
        this.notify();
        return;
      }
      if (poll.status !== 'complete') {
        this.scheduleQrPoll();
        return;
      }
      const account: string = await api.accountProfile(poll.token);
      const identity: DeviceIdentity = await this.store.loadOrCreateIdentity();
      const tokens: TokenPair = await api.registerDevice(identity, poll.token);
      const config: StoredServerConfig = new StoredServerConfig();
      config.baseUrl = this.qrBaseUrl;
      config.email = account;
      await this.store.saveConfig(config);
      await this.store.saveCredentials(tokens);
      this.config = config;
      this.identity = identity;
      this.credentials = tokens;
      this.serverUrl = config.baseUrl;
      this.email = config.email;
      this.qrId = '';
      this.qrUrl = '';
      this.phase = PHASE_DEVICES;
      this.notify();
      await this.refreshDevices();
      return;
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.qrId = '';
    this.qrUrl = '';
    this.notify();
  }

  /** 更新连接阶段文案并推给界面。 */
  private setConnectStage(text: string): void {
    this.connectStage = text;
    logInfo('connect stage: ' + text);
    this.notify();
  }

  /** 探测服务端是否给本连接下发 TURN/STUN 配置，供后续 WebRTC 直连使用。 */
  private async probeIceConfig(relay: RelayTransport): Promise<void> {
    try {
      const info: RelayConnectionInfo = relay.connectionInfo();
      const api: RemoteServerApi = await this.ensureApi();
      const ice: string = await api.iceServersJson(info.connectionId);
      if (ice.length === 0) {
        logInfo('turn/credentials -> empty（服务端未配置 TURN/STUN，直连不可用）');
        return;
      }
      logInfo('turn/credentials -> ' + ice.substring(0, 240));
      this.iceServersJson = ice;
    } catch (error) {
      logWarn('turn/credentials failed: ' + errorMessage(error));
    }
  }

  private async ensureApi(): Promise<RemoteServerApi> {
    const config: StoredServerConfig | undefined = this.config;
    const credentials: TokenPair | undefined = this.credentials;
    const identity: DeviceIdentity | undefined = this.identity;
    if (config === undefined || credentials === undefined || identity === undefined) {
      throw new Error('尚未登录');
    }
    if (this.hasFreshAccessToken(credentials)) {
      return new RemoteServerApi(config.baseUrl, credentials.accessToken);
    }
    const inflight: Promise<RemoteServerApi> | undefined = this.authPromise;
    if (inflight !== undefined) {
      return inflight;
    }
    const task: Promise<RemoteServerApi> = this.renewApi(config.baseUrl, credentials, identity);
    this.authPromise = task;
    try {
      return await task;
    } finally {
      this.authPromise = undefined;
    }
  }

  private hasFreshAccessToken(credentials: TokenPair): boolean {
    return credentials.accessTokenExpiresAt > Date.now() + 60000;
  }

  /**
   * Renew credentials exactly once at a time.
   * Order of recovery: refresh -> reuse whatever another caller already stored ->
   * re-register this device (the Server binds it by identity key, so an already
   * owned device gets fresh tokens without asking the user to log in again).
   */
  private async renewApi(baseUrl: string, stale: TokenPair, identity: DeviceIdentity): Promise<RemoteServerApi> {
    const refreshSpent: boolean = stale.refreshTokenExpiresAt > 0
      && stale.refreshTokenExpiresAt <= Date.now() + 600000;
    if (!refreshSpent) {
      try {
        const tokens: TokenPair = await new RemoteServerApi(baseUrl).refreshToken(identity.deviceId, stale.refreshToken);
        await this.adoptCredentials(tokens);
        return new RemoteServerApi(baseUrl, tokens.accessToken);
      } catch (error) {
        if (!isAuthError(error)) {
          throw asError(error);
        }
        // fall through: another caller may already have rotated the token
      }
    }
    const saved: TokenPair | undefined = await this.readStoredCredentials();
    if (saved !== undefined && saved.accessToken !== stale.accessToken && this.hasFreshAccessToken(saved)) {
      await this.adoptCredentials(saved);
      return new RemoteServerApi(baseUrl, saved.accessToken);
    }
    const recovered: TokenPair = await this.recoverDevice(baseUrl, identity);
    await this.adoptCredentials(recovered);
    return new RemoteServerApi(baseUrl, recovered.accessToken);
  }

  private async recoverDevice(baseUrl: string, identity: DeviceIdentity): Promise<TokenPair> {
    try {
      return await new RemoteServerApi(baseUrl).recoverDevice(identity);
    } catch (error) {
      if (isAuthError(error)) {
        throw new RemoteApiError('AUTH_REQUIRED', 'This device must sign in again.', 401);
      }
      throw asError(error);
    }
  }

  private async adoptCredentials(tokens: TokenPair): Promise<void> {
    this.credentials = tokens;
    try {
      await this.store.saveCredentials(tokens);
    } catch (error) {
      // 安全存储暂时不可用（多见于设备刚锁上）：新 token 只留在内存里，界面明确提示。
      // 这里不能抛 —— 旧 refresh token 服务器已经消费掉，抛出去只会让本次重连直接失败。
      logWarn('credentials not persisted: ' + errorMessage(error));
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  private async readStoredCredentials(): Promise<TokenPair | undefined> {
    try {
      return await this.store.loadCredentials();
    } catch (error) {
      return undefined;
    }
  }

  /** Force the next ensureApi() to renew, after the Server rejected our access token. */
  private dropAccessToken(): void {
    const credentials: TokenPair | undefined = this.credentials;
    if (credentials !== undefined) {
      credentials.accessTokenExpiresAt = 0;
    }
  }

  private async listDevicesWithRetry(): Promise<RemoteHostDevice[]> {
    const api: RemoteServerApi = await this.ensureApi();
    try {
      return await api.listDevices();
    } catch (error) {
      if (!isAuthError(error)) {
        throw asError(error);
      }
      this.dropAccessToken();
      const retried: RemoteServerApi = await this.ensureApi();
      return await retried.listDevices();
    }
  }

  /**
   * 读缓存的主机信息（恢复场景用）。只有本地 pin 与缓存公钥一致才返回，
   * 否则视为缓存失效（主机可能重置过），回退到正常查询路径。
   */
  private async cachedHostFor(deviceId: string): Promise<AuthorizedPeerDevice | undefined> {
    const raw: string = this.store.loadHostInfo(deviceId);
    if (raw.length === 0) {
      return undefined;
    }
    let record: Record<string, Object>;
    try {
      record = JSON.parse(raw) as Record<string, Object>;
    } catch (error) {
      return undefined;
    }
    const key: Object | undefined = record['identityKey'];
    const identityKey: string = typeof key === 'string' ? key : '';
    if (identityKey.length === 0) {
      return undefined;
    }
    const pins: Record<string, string> = this.store.loadHostPins();
    const pinned: string | undefined = pins[deviceId];
    if (pinned !== undefined && pinned !== identityKey) {
      LinkLog.write('conn', '缓存的主机公钥与本地固定记录不一致，改走正常查询');
      return undefined;
    }
    const host: AuthorizedPeerDevice = new AuthorizedPeerDevice();
    host.deviceId = deviceId;
    host.identityKey = identityKey;
    const name: Object | undefined = record['name'];
    host.name = typeof name === 'string' ? name : '';
    const platform: Object | undefined = record['platform'];
    host.platform = typeof platform === 'string' ? platform : '';
    const clientVersion: Object | undefined = record['clientVersion'];
    host.clientVersion = typeof clientVersion === 'string' ? clientVersion : '';
    const harnessVersion: Object | undefined = record['harnessVersion'];
    host.harnessVersion = typeof harnessVersion === 'string' ? harnessVersion : '';
    host.online = true;
    host.presenceKnown = true;
    return host;
  }

  private async deviceForWithRetry(deviceId: string): Promise<AuthorizedPeerDevice> {
    const api: RemoteServerApi = await this.ensureApi();
    try {
      return await api.deviceFor(deviceId);
    } catch (error) {
      if (!isAuthError(error)) {
        throw asError(error);
      }
      this.dropAccessToken();
      const retried: RemoteServerApi = await this.ensureApi();
      return await retried.deviceFor(deviceId);
    }
  }

  private async pickInitialSession(): Promise<void> {
    // 断线重连回来的：直接回原来那个会话，别按更新时间另挑一个
    const resume: string = this.pendingResumeSessionId;
    this.pendingResumeSessionId = '';
    if (resume.length > 0) {
      for (const session of this.sessions) {
        if (session.sessionId === resume) {
          await this.openSessionInternal(this.requireHarness(), resume, sessionTitle(session));
          return;
        }
      }
    }
    let best: HarnessRemoteSession | undefined = undefined;
    for (const session of this.sessions) {
      if (session.blank) {
        continue;
      }
      if (best === undefined || session.updatedAt > best.updatedAt) {
        best = session;
      }
    }
    if (best === undefined) {
      await this.createNewSession();
      return;
    }
    try {
      await this.openSessionInternal(this.requireHarness(), best.sessionId, sessionTitle(best));
    } catch (error) {
      logError('open initial session failed: ' + errorMessage(error));
      this.currentSessionId = '';
      this.currentSessionTitle = '请选择会话';
      this.messages = [];
      this.generating = false;
      this.errorMsg = '打开会话失败：' + errorMessage(error);
      this.notify();
    }
  }

  /**
   * 重连后立刻回到原会话，不等会话列表。
   * 失败时按「传输类 / 业务类」决定按钮文案，跟 openSession 一致，不再静默。
   */
  private async resumeSessionEarly(harness: HarnessAlphaClient, sessionId: string,
    title: string): Promise<void> {
    try {
      await this.openSessionInternal(harness, sessionId, title);
      this.rememberRecentSession(sessionId);
      this.hydrateHistoryImages().catch(() => undefined);
      logInfo('resumed early -> ' + sessionId);
    } catch (error) {
      logWarn('early resume failed: ' + errorMessage(error));
      this.errorMsg = this.sessionStreamHint(error);
      this.setRetry(isTransportFailure(error) ? '重连并重新打开' : '重新打开会话', () => {
        if (isTransportFailure(error)) {
          this.reconnectAndReopen(sessionId);
        } else {
          this.reopenCurrentSession(sessionId);
        }
      });
      this.notify();
    }
  }

  /**
   * Load the session list right after entering the chat phase. A slow or stuck
   * Host must not fail the whole connection: on failure the chat stays usable
   * and the user can retry from the empty-state entry point.
   */
  private async loadSessionsAfterConnect(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || this.phase !== PHASE_CHAT) {
      return;
    }
    // 先把上次的列表画出来：主机的 session/list 实测 3~9 秒，
    // 让用户立刻看到侧栏有东西，比空着等强得多（拉到新列表会覆盖它）。
    if (this.sessions.length === 0) {
      const snapshot: HarnessRemoteSession[] = this.loadSessionSnapshot(this.lastDeviceId);
      if (snapshot.length > 0) {
        this.sessions = sortSessions(snapshot);
        LinkLog.write('conn', '先用本地快照铺开 ' + snapshot.length + ' 个会话（随后静默刷新）');
      }
    }
    this.setBusy(true);
    this.sessionsLoadFailed = false;
    this.notify();
    // 重连回来的场景已经知道要回哪个会话：不要先干等会话列表
    // （中继下实测 session/list 要 9 秒，而 session/follow 打开只要 0.3 秒）。
    // 两件事并行跑：内容先出来，侧栏列表随后补上。
    const resume: string = this.pendingResumeSessionId;
    this.pendingResumeSessionId = '';
    let earlyResume: Promise<void> | undefined = undefined;
    if (resume.length > 0) {
      const resumeTitle: string = this.currentSessionTitle.length > 0
        ? this.currentSessionTitle : '正在恢复会话';
      earlyResume = this.resumeSessionEarly(harness, resume, resumeTitle);
    }
    try {
      const sessions: HarnessRemoteSession[] = await this.sessionListWithRetry(harness);
      if (this.harness !== harness || this.phase !== PHASE_CHAT) {
        return;
      }
      this.sessions = sortSessions(sessions);
      this.rememberSessions(this.sessions);
      this.persistSessionSnapshot(this.sessions);
      this.lastListError = undefined;
      this.setBusy(false);
      this.sessionsLoadFailed = false;
      this.notify();
      if (earlyResume !== undefined) {
        // 已经在原会话里了，不再按更新时间另挑一个（那会把用户切到别的会话）
        await earlyResume;
        return;
      }
      await this.pickInitialSession();
    } catch (error) {
      this.lastListError = error;
      logError('session list failed after connect: ' + errorMessage(error));
      if (this.harness !== harness || this.phase !== PHASE_CHAT) {
        return;
      }
      // 同一台主机的上一次结果还留着：显示它并标成「待刷新」，
      // 别把侧栏清空——抖动几秒就恢复的情况下，清空比不动更吓人。
      const memorySnapshot: boolean = this.sessionsSnapshot.length > 0
        && this.sessionsSnapshotHost === this.lastDeviceId;
      const diskSnapshot: HarnessRemoteSession[] = memorySnapshot ? []
        : this.loadSessionSnapshot(this.lastDeviceId);
      const keepSnapshot: boolean = memorySnapshot || diskSnapshot.length > 0;
      this.sessions = memorySnapshot ? this.sessionsSnapshot : diskSnapshot;
      this.sessionsLoadFailed = true;
      this.currentSessionId = '';
      this.currentSessionTitle = keepSnapshot ? '会话列表待刷新' : '会话列表加载失败';
      this.messages = [];
      this.generating = false;
      this.setBusy(false);
      if (isTransportFailure(error)) {
        // 加密通道还没就绪/已经断了：先体检链路，3 秒后自动重拉一次（用户不用手点）
        this.nudgeLink();
        NetTrace.listAutoRetry();
        this.errorMsg = '会话列表没拉到：与主机的加密通道还没就绪或已断开，正在自动重试…'
          + '（本机累计自动重拉 ' + NetTrace.stats().listAutoRetries + ' 次）';
        this.setRetry('重连并重试', () => {
          this.reconnectAndReopen('');
        });
        this.pushLinkEvent('会话列表没拉到 · 3 秒后自动重拉（第 '
          + NetTrace.stats().listAutoRetries + ' 次）');
        if (!this.sessionListAutoRetried) {
          this.sessionListAutoRetried = true;
          setTimeout(() => {
            this.sessionListAutoRetried = false;
            const harnessNow: HarnessAlphaClient | undefined = this.harness;
            if (harnessNow !== undefined && this.phase === PHASE_CHAT) {
              this.retrySessionLoad(true).catch(() => undefined);
            }
          }, 3000);
        }
      } else {
        this.errorMsg = '会话列表加载失败：' + errorMessage(error);
      }
      this.notify();
    }
  }

  /**
   * Retry a failed session-list load; keeps the live connection.
   * `auto` = 由「3 秒后自动重拉」发起，成功时要记一条「已自动恢复」事件。
   */
  async retrySessionLoad(auto: boolean = false): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || this.phase !== PHASE_CHAT || this.busy) {
      return;
    }
    this.setBusy(true);
    this.sessionsLoadFailed = false;
    this.errorMsg = '';
    this.notify();
    try {
      const sessions: HarnessRemoteSession[] = await this.sessionListWithRetry(harness);
      if (this.harness !== harness || this.phase !== PHASE_CHAT) {
        return;
      }
      this.sessions = sortSessions(sessions);
      this.rememberSessions(this.sessions);
      this.persistSessionSnapshot(this.sessions);
      this.setBusy(false);
      if (auto) {
        // 抖一下自己好了：明确告诉用户「抖过、已恢复」，方便判断链路质量
        NetTrace.listAutoRecovered();
        this.pushLinkEvent('会话列表已自动恢复（累计 ' + NetTrace.stats().listAutoRecovered + ' 次）');
      }
      this.notify();
      await this.pickInitialSession();
    } catch (error) {
      if (this.harness !== harness || this.phase !== PHASE_CHAT) {
        return;
      }
      this.sessionsLoadFailed = true;
      this.setBusy(false);
      this.errorMsg = '会话列表加载失败：' + errorMessage(error);
      this.notify();
    }
  }

  private async sessionListWithRetry(harness: HarnessAlphaClient): Promise<HarnessRemoteSession[]> {
    // 预算 20 秒：TURN/中继下实测主机回 session/list 要 9 秒上下（打点见诊断面板），
    // 12 秒太紧——稍慢一点就白超时一次、再花 12 秒重试，用户看到的就是「列表一直转」。
    try {
      return await harness.sessionList(AppRuntime.SESSION_LIST_BUDGET_MS);
    } catch (error) {
      const wrapped: Error = asError(error);
      if (!(wrapped instanceof RemoteGatewayError) || wrapped.code !== 'RPC_TIMEOUT') {
        throw wrapped;
      }
      logWarn('session/list timed out, retrying once');
      await delay(1500);
      return await harness.sessionList(AppRuntime.SESSION_LIST_BUDGET_MS);
    }
  }

  private requireHarness(): HarnessAlphaClient {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      throw new Error('尚未连接主机');
    }
    return harness;
  }

  /** 新建会话必须带一个真实工作区：当前会话 → 最近会话 → 上次记住的。 */
  private resolveNewSessionCwd(): string {
    const current: string = this.currentSessionId;
    if (current.length > 0) {
      for (const session of this.sessions) {
        if (session.sessionId === current && session.cwd.length > 0) {
          this.lastSessionCwd = session.cwd;
          return session.cwd;
        }
      }
    }
    for (const session of this.sessions) {
      if (session.cwd.length > 0) {
        this.lastSessionCwd = session.cwd;
        return session.cwd;
      }
    }
    return this.lastSessionCwd;
  }

  /** 记住一个会话的最新历史，按最近使用淘汰最旧的几份。 */
  private rememberHistory(sessionId: string, items: ChatItem[]): void {
    if (sessionId.length === 0) {
      return;
    }
    this.historyCache.set(sessionId, items.slice());
    const at: number = this.historyOrder.indexOf(sessionId);
    if (at >= 0) {
      this.historyOrder.splice(at, 1);
    }
    this.historyOrder.push(sessionId);
    while (this.historyOrder.length > HISTORY_CACHE_LIMIT) {
      const evicted: string | undefined = this.historyOrder.shift();
      if (evicted !== undefined) {
        this.historyCache.delete(evicted);
      }
    }
  }

  private async openSessionInternal(harness: HarnessAlphaClient, sessionId: string,
    title: string): Promise<void> {
    this.currentSessionId = sessionId;
    this.currentSessionTitle = title;
    // 换会话先清翻页游标：列表刚重建时可能触发 onReachStart，拿着上一个会话的 seq 去翻页
    // 会被主机拒（session/page ... is past cursor）——那是最典型的串会话。
    this.historyHasMore = false;
    this.oldestHistorySeq = -1;
    // 记住这个会话的工作区，下一次新建会话直接复用
    for (const session of this.sessions) {
      if (session.sessionId === sessionId && session.cwd.length > 0) {
        this.lastSessionCwd = session.cwd;
        break;
      }
    }
    // 切回看过的会话先用缓存立刻出内容，再向主机同步（原来每次先清空再等中继回放）
    const cached: ChatItem[] | undefined = this.historyCache.get(sessionId);
    this.generating = false;
    this.messages = cached !== undefined ? cached.slice() : [];
    this.notify();
    const page: HistoryPage = await harness.sessionHistory(sessionId, -1, INITIAL_HISTORY_COUNT);
    if (this.currentSessionId !== sessionId) {
      return;
    }
    this.messages = foldHistory(page.entries);
    this.historyHasMore = page.hasMore;
    this.oldestHistorySeq = oldestSeqOf(page.entries);
    this.rememberHistory(sessionId, this.messages);
    // 历史里的图片只有 attachmentId，这里排程补水（自动打开的会话也走这条）
    this.scheduleImageHydration();
    let turnOpen: boolean = false;
    for (const entry of page.entries) {
      if (entry.event.type === 'turn/start') {
        turnOpen = true;
      } else if (entry.event.type === 'turn/end') {
        turnOpen = false;
      }
    }
    let running: boolean = turnOpen;
    if (!running) {
      for (const session of this.sessions) {
        if (session.sessionId === sessionId && session.running) {
          running = true;
          break;
        }
      }
    }
    this.generating = running;
    this.notify();
    this.refreshProjections().catch(() => undefined);
  }

  private teardownConnection(): void {
    // 连接没了就别再占着长时任务（通知栏那条也会跟着消失）
    KeepAlive.stop().catch(() => undefined);
    const unsubscribe: (() => void) | undefined = this.unsubscribeClose;
    this.unsubscribeClose = undefined;
    if (unsubscribe !== undefined) {
      unsubscribe();
    }
    const core: RemoteClientCore | undefined = this.core;
    this.core = undefined;
    const pending: RelayTransport | undefined = this.pendingRelay;
    this.pendingRelay = undefined;
    this.activeRelay = undefined;
    if (pending !== undefined) {
      pending.close();
    }
    const harness: HarnessAlphaClient | undefined = this.harness;
    this.harness = undefined;
    this.connectedHostName = '';
    this.connectedDeviceId = '';
    this.keepAliveDeviceId = '';
    this.transportLabel = '';
    this.currentSessionId = '';
    this.currentSessionTitle = '';
    this.sessions = [];
    this.messages = [];
    this.generating = false;
    if (harness !== undefined) {
      const closing: Promise<void> = harness.close(false);
      closing.catch((error: Error) => {
        return;
      });
    }
    if (core !== undefined) {
      core.close();
    }
  }

  private handleDisconnect(): void {
    if (this.phase !== PHASE_CHAT) {
      LinkLog.write('disc', '链路断开但当前不在会话页（phase=' + this.phase + '），不回连');
      return;
    }
    // 关闭判词必须在 teardown 之前取：teardown 会把 activeRelay 清掉。
    const verdict: CloseVerdict | undefined = this.activeRelay !== undefined
      ? this.activeRelay.closeVerdict : undefined;
    this.disconnectCount += 1;
    this.lastDisconnectAt = Date.now();
    const uptimeMs: number = this.connectedAt > 0 ? this.lastDisconnectAt - this.connectedAt : -1;
    const relayNow: RelayTransport | undefined = this.activeRelay;
    const silenceNow: number = relayNow !== undefined ? relayNow.linkSilenceMs() : -1;
    LinkLog.write('disc', '链路断开 #' + this.disconnectCount
      + ' code=' + (verdict !== undefined ? verdict.code : -1)
      + ' reason=' + (verdict !== undefined && verdict.reason.length > 0 ? verdict.reason : '—')
      + (uptimeMs >= 0 ? ' · 本次在线 ' + (Math.round(uptimeMs / 100) / 10) + 's' : '')
      + (silenceNow >= 0 ? ' · 断开前静默 ' + silenceNow + 'ms' : '')
      + ' transport=' + (this.transportLabel.length > 0 ? this.transportLabel : '—')
      + ' attempt=' + this.reconnectAttempt);
    this.teardownConnection();
    const target: string = this.lastDeviceId;
    if (verdict !== undefined && verdict.reason === 'link-silent') {
      NetTrace.linkDeath();
    }
    if (verdict !== undefined && verdict.stopAutoReconnect) {
      // 4003 连接被顶掉 / 4001 授权失败 / 未知关闭码：自动重连只会让用户以为在恢复。
      this.clearReconnectTimer();
      this.reconnectAttempt = 0;
      this.phase = PHASE_DEVICES;
      this.reconnectStatus = '';
      this.errorMsg = verdict.message;
      logWarn('disconnect without auto-reconnect: ' + verdict.message);
      this.pushLinkEvent('断线（不重连）：' + verdict.message);
      this.notify();
      return;
    }
    if (target.length > 0 && this.reconnectAttempt < AppRuntime.MAX_RECONNECT_ATTEMPTS) {
      const index: number = Math.min(this.reconnectAttempt, AppRuntime.RECONNECT_DELAYS_MS.length - 1);
      const delay: number = AppRuntime.RECONNECT_DELAYS_MS[index];
      this.reconnectAttempt += 1;
      this.errorMsg = '';
      // 短抖动不把用户踢回设备列表：留在会话页，消息和滚动位置都还在，
      // 连上后直接回到这个会话（pendingResumeSessionId）。
      this.reconnecting = true;
      if (this.currentSessionId.length > 0) {
        this.pendingResumeSessionId = this.currentSessionId;
      }
      const cause: string = verdict !== undefined && verdict.message.length > 0
        ? verdict.message : '与主机的连接已断开';
      this.reconnectStatus = cause + '，' + Math.round(delay / 1000)
        + ' 秒后自动重连（第 ' + this.reconnectAttempt + ' / ' + AppRuntime.MAX_RECONNECT_ATTEMPTS + ' 次）';
      NetTrace.autoReconnect();
      this.pushLinkEvent('断线：' + cause + ' → ' + Math.round(delay / 1000) + 's 后第 '
        + this.reconnectAttempt + ' 次重连（累计 ' + NetTrace.stats().autoReconnects + ' 次）');
      this.notify();
      this.scheduleReconnect(target, delay);
      return;
    }
    // 退避耗尽：这时确实要交回用户，文案带上原因和下一步动作
    // （reconnectExhausted=true 让「网络恢复/回前台」还能再自动试一轮，不必手点或杀进程）
    this.reconnecting = false;
    this.reconnectExhausted = this.reconnectAttempt > 0;
    this.pendingResumeSessionId = '';
    this.phase = PHASE_DEVICES;
    this.reconnectStatus = '';
    if (this.reconnectAttempt > 0) {
      const why: string = verdict !== undefined && verdict.message.length > 0
        ? verdict.message : '主机一直连不上';
      this.errorMsg = '连续 ' + this.reconnectAttempt + ' 次重连都没成功（' + why + '）。'
        + '已回到主机列表：检查网络或主机是否在线后点「连接」，网络恢复时也会自动再试一次。';
    } else {
      this.errorMsg = '与主机的连接已断开，点「连接」可以重试。';
    }
    this.reconnectAttempt = 0;
    this.pushLinkEvent('重连次数用尽，已回到主机列表');
    this.notify();
  }

  private scheduleReconnect(deviceId: string, delay: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = -1;
      const allowed: boolean = this.phase === PHASE_DEVICES
        || (this.phase === PHASE_CHAT && this.reconnecting);
      if (!allowed || this.connectCancelled) {
        return;
      }
      this.connectDevice(deviceId).catch((error: Error) => {
        logWarn('reconnect attempt failed: ' + errorMessage(error));
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== -1) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = -1;
    }
  }

  /**
   * 系统网络事件：这里只反映状态 + 该立刻重试时立刻重试，
   * 什么时候判死仍归 RelayTransport 的静默看门狗（两个地方别都下结论）。
   */
  private startNetworkMonitor(): void {
    if (this.netMonitor !== undefined) {
      return;
    }
    const monitor: NetworkMonitor = new NetworkMonitor();
    monitor.onLost = () => {
      this.networkOnline = false;
      this.awaitingNetwork = true;
      NetTrace.netFlap();
      this.pushLinkEvent('网络断开');
      this.networkType = '无网络';
      logWarn('runtime: 网络已断开');
      LinkLog.write('net', '网络断开（phase=' + this.phase + ' transport='
        + (this.transportLabel.length > 0 ? this.transportLabel : '—') + '）');
      if (this.phase === PHASE_CHAT && this.reconnectStatus.length === 0) {
        // 先给提示，不立刻拆连接（用户切一下 Wi-Fi 就回来的情况别吓人）；
        // 但 WebSocket 在半开状态下往往不报 close，所以 8 秒还没回来就主动判死。
        this.reconnectStatus = '网络已断开，恢复后自动重连';
      }
      this.scheduleNetLossCheck();
      this.notify();
    };
    monitor.onAvailable = () => {
      const wasOffline: boolean = !this.networkOnline;
      this.networkOnline = true;
      this.awaitingNetwork = false;
      this.clearNetLossCheck();
      // 网络条件变了：退避从头算，否则「6 次用尽」之后永远轮不到自动重连
      this.reconnectAttempt = 0;
      this.reconnectExhausted = false;
      this.pushLinkEvent('网络已恢复');
      this.networkType = networkTypeLabel(monitor.type);
      logInfo('runtime: 网络已恢复 type=' + this.networkType);
      const typeText: string = networkTypeLabel(monitor.type);
      LinkLog.write('net', '网络恢复 type=' + (typeText.length > 0 ? typeText
        : (monitor.type.length > 0 ? monitor.type : '未知'))
        + ' phase=' + this.phase + ' reconnecting=' + this.reconnecting
        + ' wasOffline=' + wasOffline);
      if (this.reconnectStatus.indexOf('网络已断开') >= 0) {
        this.reconnectStatus = '';
      }
      this.notify();
      this.recoverAfterNetwork();
    };
    monitor.onTypeChange = (type: string) => {
      const previous: string = this.networkType;
      const nextLabel: string = networkTypeLabel(type);
      this.networkOnline = type !== 'none';
      this.networkType = nextLabel;
      logInfo('runtime: 网络类型 ' + (this.networkType.length > 0 ? this.networkType : type));
      LinkLog.write('net', '承载变化 ' + (previous.length > 0 ? previous : '—') + ' → '
        + (nextLabel.length > 0 ? nextLabel : type));
      // Wi-Fi ↔ 移动数据这类**真实承载**切换：旧 socket 的源地址已经不存在，连接基本必死，
      // 直接判死比等看门狗快得多（看门狗要 90 秒才认定）。
      // 注意别把「无网络 → Wi-Fi」这种「重新出现」当成切换：那不是换承载，是刚恢复。
      if (isRealBearer(previous) && isRealBearer(nextLabel) && previous !== nextLabel
        && this.phase === PHASE_CHAT) {
        this.markLinkSuspect('网络从 ' + previous + ' 切到 ' + nextLabel);
      }
      // 还没连上时换到了一条真实承载（典型：Wi-Fi 刚关联上、移动数据让位）：
      // NetworkMonitor 已经「online」，不会再发 onAvailable，这里必须自己补一次重试，
      // 否则刚才那次在旧承载上的失败之后没人再试。
      if (isRealBearer(nextLabel) && this.phase !== PHASE_CHAT
        && (this.reconnecting || this.reconnectExhausted || this.autoRecovering
          || this.reconnectTimer !== -1)) {
        this.retryNow('bearer-switch:' + nextLabel);
      }
      this.notify();
    };
    this.netMonitor = monitor;
    monitor.start();
  }

  /**
   * 应用层心跳探测（稳定性核心）：空闲 20 秒就主动要一个回包。
   *
   * 为什么必须有：服务端心跳 25 秒一跳，但链路半开时**收不到就是收不到**，
   * 我们只能靠"多久没消息"来推断。不做探测的话只能等看门狗（45/90 秒），
   * 用户早就以为卡死了。探测有回应 = 链路活着；探测超时 = 立刻判死走已验证的重连。
   * 代价是每 20 秒一个极小的 RPC，换来的是「断了 20 秒内必被发现」。
   */
  private startLinkProbe(): void {
    if (this.probeTimer !== -1) {
      return;
    }
    this.probeTimer = setInterval(() => {
      this.onProbeTick();
    }, AppRuntime.PROBE_TICK_MS);
  }

  private stopLinkProbe(): void {
    if (this.probeTimer !== -1) {
      clearInterval(this.probeTimer);
      this.probeTimer = -1;
    }
  }

  private onProbeTick(): void {
    if (this.phase !== PHASE_CHAT || this.appBackground) {
      return;
    }
    const relay: RelayTransport | undefined = this.activeRelay;
    const core: RemoteClientCore | undefined = this.core;
    if (relay === undefined || core === undefined || this.probeInFlight) {
      return;
    }
    const silence: number = relay.linkSilenceMs();
    if (silence >= 0 && silence < AppRuntime.PROBE_IDLE_MS) {
      return;
    }
    this.probeInFlight = true;
    const startedAt: number = Date.now();
    // 用一个只读、便宜的传输层 RPC 当探针；老主机不认识也没关系——
    // 「主机回了错误」同样证明链路活着。
    core.rpc('harness.transport.describe', {}, 6000, 'probe').then(() => {
      this.probeInFlight = false;
      LinkLog.write('probe', '空闲 ' + silence + 'ms，探测成功（' + (Date.now() - startedAt) + 'ms）');
    }).catch((error: Object) => {
      this.probeInFlight = false;
      const text: string = errorMessage(error);
      const linkAlive: boolean = text.toLowerCase().indexOf('method') >= 0
        || text.indexOf('不支持') >= 0 || text.toLowerCase().indexOf('unknown') >= 0;
      if (linkAlive) {
        // 主机不认识这个 RPC，但「有回包」就说明链路是通的
        LinkLog.write('probe', '空闲 ' + silence + 'ms，探测得到主机回包（' + text + '），链路正常');
        return;
      }
      LinkLog.write('probe', '空闲 ' + silence + 'ms，探测失败：' + text + ' → 判死链路');
      NetTrace.linkDeath();
      this.markLinkSuspect('心跳探测无响应（静默 ' + Math.round(silence / 1000) + ' 秒）');
    });
  }

  /**
   * 掉网 8 秒还没回来：不再指望 WebSocket 自己报 close（半开时它不会报），
   * 主动把链路判死，让状态机进入「重连中」。这样网络一回来就能立刻连上。
   */
  private scheduleNetLossCheck(): void {
    this.clearNetLossCheck();
    this.netLossTimer = setTimeout(() => {
      this.netLossTimer = -1;
      if (this.networkOnline) {
        return;
      }
      LinkLog.write('net', '掉网 8 秒仍未恢复，主动判死链路（不等 WebSocket close）');
      this.markLinkSuspect('网络已断开 8 秒');
    }, 8000);
  }

  private clearNetLossCheck(): void {
    if (this.netLossTimer !== -1) {
      clearTimeout(this.netLossTimer);
      this.netLossTimer = -1;
    }
  }

  /**
   * 链路可疑（切网、长时间静默、复用时体检不过）：能判死就判死，
   * 走统一的断线 + 自动重连；没连接就只把状态提示出来。
   */
  private markLinkSuspect(reason: string): void {
    const relay: RelayTransport | undefined = this.activeRelay;
    if (relay === undefined || this.phase !== PHASE_CHAT) {
      return;
    }
    if (this.reconnecting) {
      return;
    }
    LinkLog.write('link', '判死链路：' + reason);
    this.pushLinkEvent('链路判定不可用：' + reason);
    relay.failStale(reason);
  }

  /** 网络恢复之后：能立刻连就连，会话页则先确认旧链路真死了再换。 */
  private recoverAfterNetwork(): void {
    if (this.phase === PHASE_CHAT && !this.reconnecting) {
      const relay: RelayTransport | undefined = this.activeRelay;
      const silence: number = relay !== undefined ? relay.linkSilenceMs() : -1;
      LinkLog.write('net', '网络恢复，链路静默 ' + silence + 'ms（阈值 '
        + AppRuntime.LINK_STALE_MS + 'ms）');
      if (relay !== undefined && silence < AppRuntime.LINK_STALE_MS) {
        // 看起来很新鲜：先体检，不折腾用户
        relay.recheckLink();
        return;
      }
      if (relay !== undefined) {
        this.markLinkSuspect('网络恢复但链路已静默 ' + Math.round(silence / 1000) + ' 秒');
        return;
      }
    }
    this.retryNow('net-available');
  }

  /** 回前台：补一次网络状态查询，并对已有连接做一次链路体检。 */
  onAppForeground(): void {
    const wasBackground: boolean = this.appBackground;
    this.appBackground = false;
    if (!wasBackground) {
      return;
    }
    LinkLog.write('life', '回前台（phase=' + this.phase + ' reconnecting=' + this.reconnecting
      + ' transport=' + (this.transportLabel.length > 0 ? this.transportLabel : '—') + '）');
    const monitor: NetworkMonitor | undefined = this.netMonitor;
    if (monitor !== undefined) {
      monitor.refreshDefaultNet();
    }
    const relay: RelayTransport | undefined = this.activeRelay;
    if (relay !== undefined && this.phase === PHASE_CHAT) {
      const silence: number = relay.linkSilenceMs();
      logInfo('runtime: 回前台，链路静默 ' + silence + 'ms，触发体检');
      // 后台待久了 socket 基本都是死的，而且不报 close：静默超阈值直接判死重连，
      // 别再让它慢慢等 90 秒看门狗（用户以为「连上了但点不动」）。
      if (silence >= AppRuntime.LINK_STALE_MS) {
        this.markLinkSuspect('回前台时链路已静默 ' + Math.round(silence / 1000) + ' 秒');
        return;
      }
      relay.recheckLink();
      return;
    }
    this.retryNow('foreground');
  }

  /**
   * 不等退避档位，立刻按原目标重试一次。
   * 网络刚恢复、刚回前台这类「外部条件已经变好」的时机用它，用户不用干等 30 秒。
   *
   * 这里放宽了三处以前把恢复卡死的限制（飞行模式恢复不了的主因）：
   * - 以前只认 PHASE_DEVICES：会话页里「重连中」的那次永远等不到立刻重连；
   * - 以前要求 reconnectTimer !== -1：退避耗尽（timer 已清）之后就再也不会自动试；
   * - 以前不重置退避计数：6 次用尽后即使网络恢复也没有下一轮。
   */
  private retryNow(reason: string): void {
    if (this.connectCancelled || !this.networkOnline) {
      return;
    }
    const target: string = this.lastDeviceId;
    if (target.length === 0) {
      return;
    }
    // 会话页「重连中」，或者会话页但已经没有传输对象（链路已判死）——两种都必须重连。
    // 后者是 0.17.65 的新坑：判死链路后如果 onClose 没到上层，reconnecting 还是 false，
    // 恢复事件来了却什么都不做，用户就卡在「看着连着、其实没有连接」。
    const inChatRetrying: boolean = this.phase === PHASE_CHAT
      && (this.reconnecting || this.activeRelay === undefined);
    const onDeviceList: boolean = this.phase === PHASE_DEVICES;
    if (this.phase === PHASE_CONNECTING) {
      // 已经在连了，别重入
      return;
    }
    if (!inChatRetrying && !onDeviceList) {
      return;
    }
    if (onDeviceList && !this.reconnecting && !this.reconnectExhausted && this.reconnectTimer === -1) {
      // 用户自己停在主机列表、也没在重连：不要擅自替他连
      return;
    }
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectExhausted = false;
    // 网络条件刚变好时的这一次叫「恢复尝试」：失败也要继续退避，不能一发定生死
    this.autoRecovering = true;
    LinkLog.write('retry', '立即重连（' + reason + '）phase=' + this.phase + ' target=' + target);
    logInfo('runtime: 立即重连（' + reason + '）target=' + target);
    this.connectDevice(target).catch((error: Error) => {
      logWarn('retryNow failed: ' + errorMessage(error));
      LinkLog.write('retry', '立即重连失败：' + errorMessage(error));
    });
  }

  /** 用户主动取消自动重连（例如要切换到另一台主机）。 */
  /** 记一条链路事件（界面上 20 条 + 落盘的链路日志）。 */
  private pushLinkEvent(text: string): void {
    const clock: Date = new Date();
    const pad = (value: number): string => (value < 10 ? '0' + value : '' + value);
    const stamp: string = pad(clock.getHours()) + ':' + pad(clock.getMinutes()) + ':' + pad(clock.getSeconds());
    const next: string[] = this.linkEvents.slice();
    next.push(stamp + '  ' + text);
    while (next.length > 20) {
      next.shift();
    }
    this.linkEvents = next;
    // 同一句也进落盘日志：重启 App 之后还能看到这次断线发生过什么
    LinkLog.write('event', text);
  }

  /** 把「精简历史」设置同步给主机；失败不打扰用户，只记日志。 */
  async applyCompactHistory(): Promise<void> {
    const core: RemoteClientCore | undefined = this.core;
    if (core === undefined) {
      return;
    }
    try {
      await core.rpc('remote.history.configure', { 'compact': this.compactHistory }, 6000,
        'remote.history.configure');
      LinkLog.write('conn', '精简历史=' + (this.compactHistory ? '开' : '关') + ' 已同步给主机');
    } catch (error) {
      LinkLog.write('conn', '精简历史设置失败：' + errorMessage(error));
    }
  }

  /** 「第 i / n 轮」文本；没有用户消息时返回空串。 */
  turnPositionText(): string {
    const turns: number[] = this.userTurnIndexes();
    if (turns.length === 0) {
      return '';
    }
    return '1/' + turns.length;
  }

  /** 所有用户消息在 messages 里的下标（轮次导航用）。 */
  userTurnIndexes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.messages.length; i++) {
      const item: ChatItem = this.messages[i];
      if (item.kind === 'user') {
        out.push(i);
      }
    }
    return out;
  }

  /** 当前看到的轮次位置（从 1 开始）；找不到就返回 0。 */
  currentTurnPosition(scrollTopIndex: number): number {
    const turns: number[] = this.userTurnIndexes();
    let position: number = 0;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i] <= scrollTopIndex) {
        position = i + 1;
      }
    }
    return position;
  }

  static durationText(ms: number): string {
    const seconds: number = Math.round(ms / 1000);
    if (seconds < 60) {
      return seconds + 's';
    }
    const minutes: number = Math.floor(seconds / 60);
    const rest: number = seconds % 60;
    return minutes + 'm' + (rest > 0 ? rest + 's' : '');
  }

  /** 从 turn/end 的 data 里尽力取用量（不同主机版本字段名不一样，取不到就返回空串）。 */
  private turnUsageText(data: Object | undefined): string {
    const record: Record<string, Object> | undefined = asRecord(data);
    if (record === undefined) {
      return '';
    }
    const usage: Record<string, Object> | undefined = asRecord(record['usage']);
    const source: Record<string, Object> = usage !== undefined ? usage : record;
    const candidates: string[] = ['totalTokens', 'tokens', 'outputTokens', 'completionTokens'];
    for (const key of candidates) {
      const value: Object | undefined = source[key];
      if (typeof value === 'number' && value > 0) {
        return AppRuntime.tokensText(value);
      }
    }
    return '';
  }

  static tokensText(count: number): string {
    if (count < 1000) {
      return count + ' tok';
    }
    return (Math.round(count / 100) / 10) + 'k tok';
  }

  /**
   * 把一条消息做成可分享的卡片文本（对齐 dsh-Go 的分享卡；这里先出文本版，
   * 走系统分享面板，不依赖任何服务端）。
   */
  shareCardText(item: ChatItem): string {
    const title: string = this.currentSessionTitle.length > 0 ? this.currentSessionTitle : '会话';
    const clock: Date = new Date(item.timestamp > 0 ? item.timestamp : Date.now());
    const pad = (value: number): string => (value < 10 ? '0' + value : '' + value);
    const stamp: string = pad(clock.getMonth() + 1) + '-' + pad(clock.getDate())
      + ' ' + pad(clock.getHours()) + ':' + pad(clock.getMinutes());
    const body: string = this.secretMask ? maskSecrets(item.text) : item.text;
    const trimmed: string = body.length > 1200 ? body.slice(0, 1200) + '\n…（已截断）' : body;
    const host: string = this.connectedHostDisplayName().length > 0 ? this.connectedHostDisplayName() : '远程主机';
    const lines: string[] = [];
    lines.push('《' + title + '》· ' + stamp);
    lines.push('────────────');
    lines.push(trimmed);
    lines.push('────────────');
    lines.push('来自 DSH 远程 · ' + host + (this.transportLabel.length > 0 ? ' · ' + this.transportLabel : ''));
    return lines.join('\n');
  }

  /** 开关「敏感内容打码」。 */
  setSecretMask(enabled: boolean): void {
    this.secretMask = enabled;
    this.store.saveSecretMask(enabled);
    this.notify();
  }

  /** 切换精简历史（下次打开会话生效，和主机约定一致）。 */
  async setCompactHistory(enabled: boolean): Promise<void> {
    this.compactHistory = enabled;
    this.store.saveCompactHistory(enabled);
    this.notify();
    await this.applyCompactHistory();
  }

  /**
   * 测延迟：连发 3 个便宜 RPC，取最小/平均往返。
   * 只用于「这条链路现在到底多快」，失败就当链路有问题直接报出来。
   */
  async measureLatency(): Promise<void> {
    const core: RemoteClientCore | undefined = this.core;
    if (core === undefined || this.latencyTesting) {
      return;
    }
    this.latencyTesting = true;
    this.notify();
    const samples: number[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const started: number = Date.now();
        await core.rpc('harness.transport.describe', {}, 6000, 'latency');
        samples.push(Date.now() - started);
      }
      let total: number = 0;
      for (const value of samples) {
        total += value;
      }
      this.latencyMs = Math.round(total / samples.length);
      this.latencyAt = Date.now();
      LinkLog.write('probe', '测延迟：' + samples.join('/') + 'ms → 平均 ' + this.latencyMs + 'ms'
        + ' transport=' + (this.transportLabel.length > 0 ? this.transportLabel : '—'));
    } catch (error) {
      this.latencyMs = -1;
      this.latencyAt = Date.now();
      LinkLog.write('probe', '测延迟失败：' + errorMessage(error));
      this.errorMsg = '测延迟失败：' + errorMessage(error);
      this.nudgeLink();
    }
    this.latencyTesting = false;
    this.notify();
  }

  /** 「连接详情」的行内容：传输、路径、耗时、延迟、回落原因。 */
  connectionDetailLines(): string[] {
    const relay: RelayTransport | undefined = this.activeRelay;
    const rows: string[] = [];
    rows.push('传输：' + (this.transportLabel.length > 0 ? this.transportLabel : '—'));
    if (relay !== undefined) {
      const path: string = relay.rtcPathText();
      if (path.length > 0) {
        rows.push('路径：' + path);
      } else if (this.transportLabel !== 'relay') {
        // 页面没上报选中候选对时也别空着：至少说明直连已经用上了
        rows.push('路径：直连（' + this.transportLabel + '），浏览器未给出选中候选对');
      }
      const skip: string = relay.lanSkipReason();
      if (skip.length > 0 && this.transportLabel !== 'lan') {
        rows.push('没直连：' + skip);
      }
    }
    const staged: TraceSample | undefined = NetTrace.latest('connect 分段');
    if (staged !== undefined) {
      rows.push('握手：' + NetTrace.msText(staged.totalMs) + '（' + staged.detail + '）');
    }
    if (this.latencyMs >= 0) {
      rows.push('延迟：' + this.latencyMs + 'ms（测于 ' + this.clockText(this.latencyAt) + '）');
    } else {
      rows.push('延迟：未测');
    }
    const silence: number = relay !== undefined ? relay.silenceMs() : -1;
    rows.push('链路：' + (silence < 0 ? '未知'
      : (Math.round(silence / 100) / 10) + ' 秒前收到过数据'));
    rows.push('精简历史：' + (this.compactHistory ? '开（历史工具输出转摘要）' : '关'));
    return rows;
  }

  private clockText(at: number): string {
    const d: Date = new Date(at);
    const pad = (value: number): string => (value < 10 ? '0' + value : '' + value);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /** 诊断面板展示的链路日志尾行（落盘日志的内存镜像）。 */
  linkLogTail(): string[] {
    return LinkLog.tail(12);
  }

  /** 链路日志文件路径（面板「复制」里带上，方便一条命令拉走）。 */
  linkLogPath(): string {
    return LinkLog.pathText();
  }

  /** 诊断面板的行内容（也用于「复制全部」）。 */
  diagnosticsLines(): string[] {
    const relay: RelayTransport | undefined = this.activeRelay;
    const silence: string = relay !== undefined
      ? ((): string => {
        const ms: number = relay.silenceMs();
        return ms < 0 ? '未知' : (Math.round(ms / 100) / 10) + ' 秒前收到过数据';
      })()
      : '未连接';
    const rows: string[] = [];
    rows.push('主机：' + (this.connectedHostDisplayName().length > 0 ? this.connectedHostDisplayName() : '—'));
    rows.push('传输：' + (this.transportLabel.length > 0 ? this.transportLabel : '—'));
    if (relay !== undefined) {
      const skip: string = relay.lanSkipReason();
      rows.push('直连：' + (this.transportLabel === 'lan' || this.transportLabel === 'p2p'
        ? '已直连' : (skip.length > 0 ? skip : '未尝试')));
    }
    rows.push('链路：' + silence);
    const heartbeat: string = relay !== undefined && relay.heartbeatIntervalMs() > 0
      ? Math.round(relay.heartbeatIntervalMs() / 1000) + ' 秒（服务端心跳）'
      : '未读到';
    rows.push('心跳：' + heartbeat);
    rows.push('网络：' + (this.networkOnline
      ? (this.networkType.length > 0 ? this.networkType : '在线')
      : '已断开' + (this.awaitingNetwork ? '（等待恢复，恢复后自动重连）' : '')));
    rows.push('重连：' + (this.reconnecting
      ? (this.reconnectStatus.length > 0 ? this.reconnectStatus : '进行中')
      : '无'));
    // 打点：把「慢在哪一段」量化，用户复现时直接读这两行回报，
    // 不用再让他去电脑上抓 hilog（TURN 下 session/list 与 session/follow 的耗时最可疑）。
    const trace: string = NetTrace.summaryLine();
    if (trace.length > 0) {
      rows.push(trace);
    }
    const slowest: string = NetTrace.slowestLine();
    if (slowest.length > 0) {
      rows.push(slowest);
    }
    rows.push(NetTrace.jitterLine());
    const uptime: string = this.connectedAt > 0
      ? (Math.round((Date.now() - this.connectedAt) / 1000) + ' 秒')
      : '—';
    rows.push('保活：' + (KeepAlive.isRunning() ? '已开启（长时任务，熄屏不冻结）' : '未开启（后台可能被冻结）'));
    rows.push('稳定：连接 ' + this.connectCount + ' 次 · 断线 ' + this.disconnectCount
      + ' 次 · 本次已在线 ' + uptime
      + (this.lastRecoveryMs > 0 ? ' · 上次恢复 ' + (Math.round(this.lastRecoveryMs / 100) / 10) + 's' : ''));
    rows.push('日志：' + (LinkLog.pathText().length > 0 ? 'link.log（已落盘，重启也保留）' : '未启用'));
    rows.push('会话：' + (this.currentSessionId.length > 0 ? this.currentSessionId : '—'));
    return rows;
  }

  /**
   * 把诊断信息与链路日志写成文件，返回路径（现场排障时可以直接 hdc file recv 拉走，
   * 不用手抄屏幕，也不依赖 App 里复制粘贴）。
   */
  exportDiagnosticsToFile(): string {
    if (this.filesDir.length === 0) {
      return '';
    }
    const stamp: Date = new Date();
    const pad = (value: number): string => (value < 10 ? '0' + value : '' + value);
    const name: string = 'diagnostics-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate())
      + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds()) + '.txt';
    const path: string = this.filesDir + '/' + name;
    const lines: string[] = [];
    lines.push('# DSH 远程 诊断导出（' + stamp.toLocaleString() + '）');
    lines.push('');
    for (const row of this.diagnosticsLines()) {
      lines.push(row);
    }
    lines.push('');
    lines.push('## 最近事件');
    for (const row of this.linkEvents) {
      lines.push(row);
    }
    lines.push('');
    lines.push('## link.log（最近 200 行）');
    for (const row of LinkLog.tail(200)) {
      lines.push(row);
    }
    try {
      const file = fileIo.openSync(path,
        fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      try {
        fileIo.writeSync(file.fd, lines.join('\n'));
      } finally {
        fileIo.closeSync(file);
      }
      LinkLog.write('life', '诊断已导出：' + path);
      return path;
    } catch (error) {
      logWarn('export diagnostics failed: ' + errorMessage(error));
      return '';
    }
  }

  /** 拉当前会话的定时任务列表。 */
  async loadSchedules(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined) {
      return;
    }
    this.schedulesLoading = true;
    this.notify();
    try {
      this.schedules = await harness.scheduleList(sessionId);
      this.clearRetry();
    } catch (error) {
      const text: string = errorMessage(error);
      logWarn('schedule/list failed: ' + text);
      const lower: string = text.toLowerCase();
      const unsupported: boolean = lower.indexOf('unknown') >= 0
        || lower.indexOf('no active remote method') >= 0
        || lower.indexOf('exports this endpoint') >= 0
        || text.indexOf('不支持') >= 0;
      if (unsupported) {
        // 老插件不放行 schedule/* 时不弹红条（它只是在右栏出现时顺手拉的），
        // 记成「不支持」，右栏与面板据此显示说明，不再每次重试。
        this.schedulesSupported = false;
        this.schedules = [];
        this.errorMsg = '';
      } else {
        this.errorMsg = text;
      }
    }
    this.schedulesLoading = false;
    this.notify();
  }

  /** 删除一条定时任务，成功后从列表移除。 */
  async deleteSchedule(schedule: HarnessSchedule): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || schedule.id.length === 0) {
      return;
    }
    const sessionId: string = schedule.sessionId.length > 0 ? schedule.sessionId
      : this.currentSessionId;
    try {
      await harness.scheduleDelete(sessionId, schedule.id);
      this.schedules = this.schedules.filter((item: HarnessSchedule) => item.id !== schedule.id);
      if (this.scheduleHistoryId === schedule.id) {
        this.scheduleHistory = [];
        this.scheduleHistoryId = '';
      }
      this.errorMsg = '';
      this.notify();
    } catch (error) {
      const text: string = errorMessage(error);
      this.errorMsg = '删除定时任务失败：' + text;
      this.setRetry('重新删除', () => {
        this.deleteSchedule(schedule);
      });
      this.notify();
    }
  }

  /** 拉某条任务的投递历史。 */
  async loadScheduleHistory(schedule: HarnessSchedule): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || schedule.id.length === 0) {
      return;
    }
    const sessionId: string = schedule.sessionId.length > 0 ? schedule.sessionId
      : this.currentSessionId;
    try {
      this.scheduleHistory = await harness.scheduleHistory(sessionId, schedule.id, 20);
      this.scheduleHistoryId = schedule.id;
      this.notify();
    } catch (error) {
      this.errorMsg = '读取投递历史失败：' + errorMessage(error);
      this.notify();
    }
  }

  /** 会话页横幅上的「立即重试」：不等退避，马上重连一次。 */
  retryReconnectNow(): void {
    if (!this.reconnecting || this.lastDeviceId.length === 0) {
      return;
    }
    this.clearReconnectTimer();
    this.pushLinkEvent('用户点了「立即重试」');
    this.connectDevice(this.lastDeviceId).catch((error: Error) => {
      logWarn('manual reconnect failed: ' + errorMessage(error));
    });
  }

  cancelReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectStatus = '';
    this.reconnecting = false;
    this.reconnectExhausted = false;
    this.autoRecovering = false;
    this.pendingResumeSessionId = '';
    if (this.phase === PHASE_CHAT) {
      // 从会话页点「停止重连」等于放弃这次会话，回设备列表让用户重新选
      this.phase = PHASE_DEVICES;
      this.teardownConnection();
    }
    this.notify();
  }

  /** 清除某台主机的公钥固定记录，下次连接重新走 TOFU。 */
  async forgetHostPin(hostDeviceId: string): Promise<void> {
    await this.store.forgetHostPin(hostDeviceId);
    this.errorMsg = '';
    this.reconnectStatus = '';
    this.notify();
  }

  /** 该主机是否已有本地固定公钥（用于 UI 决定是否显示「忘记」入口）。 */
  hasHostPin(hostDeviceId: string): boolean {
    const pins: Record<string, string> = this.store.loadHostPins();
    return pins[hostDeviceId] !== undefined;
  }

  private handleFrame(frame: HarnessClientFrame): void {
    const payload: Record<string, Object> = frame.payload;
    const type: string = jsonStr(payload, 'type', '');
    if (type === 'session/event') {
      this.applyEventPayload(payload);
      return;
    }
    if (type === 'approval/requested') {
      const sessionId: string = jsonStr(payload, 'sessionId', '');
      if (sessionId.length === 0 || sessionId === this.currentSessionId) {
        this.messages = addApproval(this.messages, payload, frame.rpcId);
        this.notify();
      }
      return;
    }
    if (type === 'approval/resolved') {
      this.messages = resolveApproval(this.messages, payload);
      this.notify();
      return;
    }
    if (type === 'question/requested') {
      const sessionId: string = jsonStr(payload, 'sessionId', '');
      if (sessionId.length === 0 || sessionId === this.currentSessionId) {
        this.messages = addQuestion(this.messages, payload, frame.rpcId);
        this.notify();
      }
      return;
    }
    if (type === 'question/resolved') {
      this.messages = resolveQuestion(this.messages, payload);
      this.notify();
      return;
    }
    if (type === 'stream/closed') {
      const reason: string = jsonStr(payload, 'reason', '');
      const failure: Record<string, Object> | undefined = asRecord(payload['error']);
      const code: string = failure !== undefined ? jsonStr(failure, 'code', '') : '';
      const message: string = failure !== undefined ? jsonStr(failure, 'message', '') : '';
      // 传输层自己断的（TRANSPORT_CLOSED/CLIENT_CLOSED）交给重连提示，别在聊天里再糊一条；
      // 业务失败（上下文超窗、提示被主机拒绝等）以前是彻底静默的，这里必须说出来。
      const transportLevel: boolean = code === 'TRANSPORT_CLOSED' || code === 'CLIENT_CLOSED'
        || code === 'CONNECTION_FAILED';
      if (reason === 'failed' && !transportLevel && message.length > 0) {
        if (looksLikeContextOverflow(code, message)) {
          this.messages = appendNotice(this.messages, 'stream:context',
            '上下文已超出模型窗口，这一轮没有执行',
            'error', '先压缩上下文（/compact）再重新发送，或新开一个会话', '/compact', Date.now());
        } else {
          this.messages = appendNotice(this.messages, 'stream:error:' + code, '本轮失败',
            'error', code.length > 0 ? code + ' · ' + message : message, '', Date.now());
        }
      }
      this.handleDisconnect();
    }
  }

  private applyEventPayload(payload: Record<string, Object>): void {
    const raw: Object | undefined = payload['event'];
    if (raw instanceof HarnessSessionEvent) {
      this.applySessionEventDirect(raw);
      return;
    }
    const record: Record<string, Object> | undefined = asRecord(raw);
    if (record !== undefined) {
      this.applySessionEventDirect(eventFromRecord(record));
    }
  }

  private applySessionEventDirect(event: HarnessSessionEvent): void {
    if (event.type.length === 0) {
      return;
    }
    // 步数：每次工具调用算一步，用于「本轮 12 步 · 1m20s」这样的摘要
    if (event.type.indexOf('tool/') === 0) {
      this.turnSteps += 1;
    }
    this.messages = applySessionEvent(this.messages, event);
    if (event.type === 'user/message' || event.type === 'turn/end') {
      this.scheduleImageHydration();
    }
    if (event.type === 'permission/preset') {
      // 主机确认后的权威值：/permission 命令也会推这个事件
      const preset: string = jsonStr(event.data, 'preset', '');
      if (preset.length > 0) {
        this.permissionPreset = preset;
      }
    }
    if (event.type === 'turn/start') {
      this.generating = true;
      this.turnStartedAt = Date.now();
      this.turnSteps = 0;
      this.lastTurnSummary = '';
    } else if (event.type === 'turn/end') {
      this.generating = false;
      const elapsed: number = this.turnStartedAt > 0 ? Date.now() - this.turnStartedAt : 0;
      const usage: string = this.turnUsageText(event.data);
      this.lastTurnSummary = (this.turnSteps > 0 ? this.turnSteps + ' 步 · ' : '')
        + (elapsed > 0 ? AppRuntime.durationText(elapsed) : '')
        + (usage.length > 0 ? ' · ' + usage : '');
      this.turnStartedAt = 0;
      this.petDoneAt = Date.now();
      // 一轮结束后刷新上下文占用（不阻塞 UI）。
      this.refreshProjections().catch(() => undefined);
      // 后台时给一条完成提醒；前台不打扰
      this.publishCompletionNotice('DSH 远程', '「' + (this.currentSessionTitle.length > 0 ? this.currentSessionTitle : '当前会话') + '」这一轮已完成');
    }
    this.notify();
  }
}

let runtimeInstance: AppRuntime | undefined = undefined;

export function getAppRuntime(): AppRuntime {
  if (runtimeInstance === undefined) {
    runtimeInstance = new AppRuntime();
  }
  return runtimeInstance;
}

/** 在投影值里找上下文占用百分比；找不到返回 0。 */
function findPercent(source: Record<string, Object>): number {
  for (const key of Object.keys(source)) {
    const value: Object | undefined = source[key];
    const record: Record<string, Object> | undefined = asRecord(value);
    if (record === undefined) {
      continue;
    }
    const percent: number = jsonNum(record, 'percent', 0);
    if (percent > 0) {
      return percent;
    }
    const used: number = jsonNum(record, 'usedTokens', 0);
    const limit: number = jsonNum(record, 'contextWindow', 0);
    if (used > 0 && limit > 0) {
      return Math.round((used / limit) * 100);
    }
  }
  return 0;
}

/** 一个可选的模型（provider + model）。 */
export class ModelOption {
  provider: string = '';
  model: string = '';
  name: string = '';
  description: string = '';
  /** 该模型支持的推理等级 id；空表示不支持。 */
  efforts: string[] = [];
}

/** 一条斜杠命令候选。 */
export class SlashCommand {
  name: string = '';
  description: string = '';
}

/** 主机没有给清单时的内置候选（按 DSH 官方命令集）。 */
function builtinSlashCommands(): SlashCommand[] {
  const names: string[] = ['compact', 'permission', 'model', 'plan', 'goal', 'feedback', 'export'];
  const labels: string[] = ['压缩上下文', '切换权限预设', '选择模型', '计划模式', '长期目标', '反馈', '导出会话日志'];
  const out: SlashCommand[] = [];
  for (let i = 0; i < names.length; i++) {
    const entry: SlashCommand = new SlashCommand();
    entry.name = '/' + names[i];
    entry.description = labels[i];
    out.push(entry);
  }
  return out;
}

export /** 真实承载（用于区分「换网」和「网络刚恢复」）。 */
/** 形如 sk-xxx / ghp_xxx / Bearer xxx / 长 hex 的片段，展示时打码。 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /(Bearer\s+)[A-Za-z0-9._-]{16,}/g,
  /\b[A-Fa-f0-9]{32,}\b/g
];

/** 把文本里像密钥的片段打码，返回新文本（原文不动，供「看原文」用）。 */
export function maskSecrets(text: string): string {
  if (text.length === 0) {
    return text;
  }
  let out: string = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match: string, prefix: string | undefined): string => {
      const head: string = typeof prefix === 'string' && prefix.length > 0 ? prefix : '';
      const body: string = match.slice(head.length);
      const tail: string = body.length > 4 ? body.slice(body.length - 4) : '';
      return head + '•••• ' + tail;
    });
  }
  return out;
}

function isRealBearer(label: string): boolean {
  return label === 'Wi-Fi' || label === '移动数据' || label === '有线网络';
}

export function errorMessage(error: Object): string {
  if (error instanceof RemoteGatewayError) {
    return friendlyCode(error.code, error.message);
  }
  if (error instanceof RemoteClientError) {
    return friendlyCode(error.code, error.message);
  }
  if (error instanceof RemoteApiError) {
    const remote: string = error.serverMessage;
    if (remote.length > 0) {
      return remote;
    }
    return friendlyCode(error.code, error.message);
  }
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : '操作失败';
  }
  return '操作失败';
}

/** Re-throw helper: catch-clause values have no type, wrap them in a real Error first. */
function asError(error: Object): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/**
 * 是否是「传输层坏了」这一类失败（可以靠换链路恢复），而不是主机业务拒绝。
 * 覆盖：RPC 超时 / 发送失败、通道已关闭、连接失败、链路静默判死。
 */
function isTransportFailure(error: Object): boolean {
  if (error instanceof RemoteGatewayError || error instanceof RemoteClientError) {
    const code: string = error.code;
    if (code === 'TRANSPORT_CLOSED' || code === 'CONNECTION_FAILED' || code === 'TIMEOUT'
      || code === 'transport_closed' || code === 'timeout' || code === 'closed') {
      return true;
    }
  }
  const text: string = errorMessage(error).toLowerCase();
  return text.indexOf('timed out') >= 0 || text.indexOf('send failed') >= 0
    || text.indexOf('not been authorized') >= 0 || text.indexOf('relay connection') >= 0
    || text.indexOf('连接已断开') >= 0 || text.indexOf('链路静默') >= 0
    || text.indexOf('transport') >= 0 || text.indexOf('closed') >= 0;
}

/** True when the Server rejected our credentials (as opposed to a network/transport fault). */
function isAuthError(error: Object): boolean {
  if (error instanceof RemoteApiError) {
    return error.code === 'AUTH_INVALID' || error.code === 'AUTH_REQUIRED'
      || error.code === 'TOKEN_EXPIRED' || error.status === 401;
  }
  if (error instanceof RemoteGatewayError) {
    return error.code === 'AUTH_INVALID' || error.code === 'AUTH_REQUIRED';
  }
  return false;
}

function friendlyCode(code: string, fallback: string): string {
  if (code === 'CONNECTION_FAILED') {
    return fallback.length > 0 ? fallback : '无法连接服务器';
  }
  if (code === 'TOKEN_EXPIRED') {
    return '登录状态已过期，正在重新连接…';
  }
  if (code === 'DEVICE_REVOKED') {
    return '此设备已被服务器移除，请重新登录';
  }
  if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID') {
    return '登录已过期，请重新登录';
  }
  if (code === 'RPC_TIMEOUT' || code === 'STREAM_TIMEOUT') {
    return '请求超时，请重试';
  }
  if (code === 'TRANSPORT_CLOSED') {
    return '连接已关闭';
  }
  if (code === 'RATE_LIMITED') {
    return '请求过于频繁，请稍后再试';
  }
  if (code === 'CONTEXT_WINDOW_EXCEEDED' || code === 'CONTEXT_LENGTH_EXCEEDED'
    || code === 'CONTEXT_OVERFLOW') {
    return '上下文已超出模型窗口，请先压缩上下文（/compact）再试';
  }
  if (code === 'DEVICE_NOT_FOUND') {
    return '设备不存在';
  }
  if (code === 'FEATURE_NOT_SUPPORTED') {
    return '主机不支持远程访问';
  }
  if (code === 'METHOD_NOT_FOUND') {
    return '主机不支持该功能';
  }
  return fallback;
}

function compareDevices(a: RemoteHostDevice, b: RemoteHostDevice): number {
  if (a.online !== b.online) {
    return a.online ? -1 : 1;
  }
  return b.lastSeenAt - a.lastSeenAt;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

function sortSessions(sessions: HarnessRemoteSession[]): HarnessRemoteSession[] {
  const sorted: HarnessRemoteSession[] = sessions.slice();
  sorted.sort((a: HarnessRemoteSession, b: HarnessRemoteSession): number => {
    return b.updatedAt - a.updatedAt;
  });
  return sorted;
}

function sessionTitle(session: HarnessRemoteSession): string {
  const title: string = session.title.trim();
  if (title.length > 0) {
    return title;
  }
  if (session.blank) {
    return '新会话';
  }
  return `会话 ${session.sessionId.substring(0, 8)}`;
}

function cloneItem(item: ChatItem): ChatItem {
  const copy: ChatItem = new ChatItem();
  copy.id = item.id;
  copy.kind = item.kind;
  copy.role = item.role;
  copy.text = item.text;
  copy.reasoning = item.reasoning;
  copy.streaming = item.streaming;
  copy.requestRpcId = item.requestRpcId;
  copy.sessionId = item.sessionId;
  copy.timestamp = item.timestamp;
  copy.toolName = item.toolName;
  copy.toolState = item.toolState;
  copy.summary = item.summary;
  copy.approvalId = item.approvalId;
  copy.approvalOutcome = item.approvalOutcome;
  copy.frameRpcId = item.frameRpcId;
  copy.reason = item.reason;
  copy.questions = item.questions.slice();
  copy.questionOutcome = item.questionOutcome;
  copy.rev = item.rev;
  copy.noticeKind = item.noticeKind;
  copy.actionCommand = item.actionCommand;
  copy.images = item.images.slice();
  copy.imageAttachmentIds = item.imageAttachmentIds.slice();
  copy.imageRefs = item.imageRefs.slice();
  copy.files = item.files.slice();
  return copy;
}

/** Fold a native history window into ordered chat items. */
/** 导出用：MM-DD HH:MM（时间为 0 时给空串）。 */
function formatStamp(timestamp: number): string {
  if (timestamp <= 0) {
    return '—';
  }
  const date: Date = new Date(timestamp);
  const pad = (value: number): string => (value < 10 ? '0' + value : '' + value);
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' '
    + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** 多行文本压成一行，导出工具摘要用。 */
function firstLineOf(text: string): string {
  const cut: number = text.indexOf('\n');
  const line: string = cut >= 0 ? text.substring(0, cut) : text;
  return line.length > 120 ? line.substring(0, 120) + '…' : line;
}

/** 一页历史里最早的事件 seq（没有有效 seq 时返回 -1）。 */
function oldestSeqOf(entries: HarnessHistoryEntry[]): number {
  let oldest: number = -1;
  for (const entry of entries) {
    if (entry.event.seq > 0 && (oldest < 0 || entry.event.seq < oldest)) {
      oldest = entry.event.seq;
    }
  }
  return oldest;
}

function foldHistory(entries: HarnessHistoryEntry[]): ChatItem[] {
  let items: ChatItem[] = [];
  for (const entry of entries) {
    items = applySessionEvent(items, entry.event);
  }
  return items;
}

/** Apply one native Harness session event to the transcript, stamping its sequence. */
function applySessionEvent(items: ChatItem[], event: HarnessSessionEvent): ChatItem[] {
  const next: ChatItem[] = applySessionEventInner(items, event);
  if (next.length === 0 || event.seq <= 0) {
    return next;
  }
  const last: ChatItem = next[next.length - 1];
  if (last.seq === event.seq) {
    return next;
  }
  const stamped: ChatItem = cloneItem(last);
  stamped.seq = event.seq;
  const out: ChatItem[] = next.slice();
  out[out.length - 1] = stamped;
  return out;
}

function applySessionEventInner(items: ChatItem[], event: HarnessSessionEvent): ChatItem[] {
  const data: Record<string, Object> = event.data;
  if (event.type === 'turn/start') {
    return settleTurn(items);
  }
  if (event.type === 'turn/end') {
    // 失败的一轮必须让用户看见：turn/end 的 reason.kind === 'error' 带着结构化失败
    // （上下文超窗就是 code=CONTEXT_WINDOW_EXCEEDED），以前这里只 settleTurn，手机上什么都没有。
    return appendTurnFailure(settleTurn(items), data, event.time);
  }
  if (event.type === 'user/message') {
    return addUserMessage(items, data, event.time);
  }
  if (event.type === 'assistant/message') {
    return addAssistantMessage(items, data, event.time);
  }
  if (event.type === 'assistant/chunk') {
    return applyAssistantChunk(items, data, event.time);
  }
  if (event.type === 'tool/call') {
    return applyToolEvent(items, data, event.time, 'running');
  }
  if (event.type === 'tool/result') {
    return applyToolEvent(items, data, event.time, 'finished');
  }
  return items;
}

/** A closed turn must not leave stale streams, running tools or pending cards. */
function settleTurn(items: ChatItem[]): ChatItem[] {
  if (items.length === 0) {
    return items;
  }
  const next: ChatItem[] = [];
  let changed: boolean = false;
  for (const item of items) {
    if (item.kind === 'assistant' && item.streaming) {
      const settled: ChatItem = cloneItem(item);
      settled.streaming = false;
      settled.rev += 1;
      next.push(settled);
      changed = true;
    } else if (item.kind === 'tool' && item.toolState === 'running') {
      const settled: ChatItem = cloneItem(item);
      settled.toolState = 'failed';
      settled.rev += 1;
      next.push(settled);
      changed = true;
    } else if (item.kind === 'approval' && item.approvalOutcome.length === 0) {
      const settled: ChatItem = cloneItem(item);
      settled.approvalOutcome = 'unavailable';
      settled.rev += 1;
      next.push(settled);
      changed = true;
    } else if (item.kind === 'question' && item.questionOutcome.length === 0) {
      const settled: ChatItem = cloneItem(item);
      settled.questionOutcome = 'cancelled';
      settled.rev += 1;
      next.push(settled);
      changed = true;
    } else {
      next.push(item);
    }
  }
  return changed ? next : items;
}

/**
 * 把 turn/end 的结束原因摊成一条可见提示。
 *
 * DSH 的失败轮是 `turn/end{reason:{kind:'error',error:{message,code}}}`；上下文超窗的
 * code 是 `CONTEXT_WINDOW_EXCEEDED`（见 @deepseek-ai/dsh-llm）。以前客户端只做 settleTurn，
 * 于是「上下文超限」在手机上完全静默——这条提示补的就是那个洞。
 */
function appendTurnFailure(items: ChatItem[], data: Record<string, Object>, time: number): ChatItem[] {
  // reason 有几种历史形态：{kind:'error', error:{code,message}}（DSH 原生）、
  // {kind:'error', failure:{...}}（pi 后端）、以及裸字符串 'error' / 'failed'。
  const raw: Object | undefined = data['reason'];
  let kind: string = '';
  let failure: Record<string, Object> | undefined = undefined;
  const reason: Record<string, Object> | undefined = asRecord(raw);
  if (reason !== undefined) {
    kind = jsonStr(reason, 'kind', '');
    failure = asRecord(reason['error']);
    if (failure === undefined) {
      failure = asRecord(reason['failure']);
    }
  } else if (typeof raw === 'string') {
    kind = raw;
  }
  if (kind === 'max-tokens') {
    return appendNotice(items, 'turn-end:max-tokens', '本轮输出达到模型上限，内容被截断',
      'warn', '输出达到上限，可以让我继续或拆小一点', '', time);
  }
  if (kind !== 'error' && kind !== 'failed') {
    return items;
  }
  const code: string = failure !== undefined ? jsonStr(failure, 'code', '') : '';
  const message: string = failure !== undefined ? jsonStr(failure, 'message', '') : '';
  if (code.length === 0 && message.length === 0) {
    // 只有裸字符串 reason：至少让用户知道这一轮挂了，别静默
    return appendNotice(items, 'turn-end:bare', '本轮失败', 'error', '主机没有给出失败原因',
      '', time);
  }
  if (looksLikeContextOverflow(code, message)) {
    return appendNotice(items, 'turn-end:context', '上下文已超出模型窗口，这一轮没有执行',
      'error', '先压缩上下文（/compact）再重新发送，或新开一个会话', '/compact', time);
  }
  const detail: string = message.length > 0 ? message : (code.length > 0 ? code : '未知原因');
  const hint: string = code.length > 0 ? code + ' · ' + detail : detail;
  return appendNotice(items, 'turn-end:error:' + code, '本轮失败', 'error', hint, '', time);
}

/** 上下文超窗的判据：结构化 code 与会话里常见的英文原文，两头都认。 */
function looksLikeContextOverflow(code: string, message: string): boolean {
  const upper: string = code.toUpperCase();
  if (upper === 'CONTEXT_WINDOW_EXCEEDED' || upper === 'CONTEXT_LENGTH_EXCEEDED'
    || upper === 'CONTEXT_OVERFLOW') {
    return true;
  }
  const text: string = message.toLowerCase();
  return text.indexOf('context_length') >= 0 || text.indexOf('context length') >= 0
    || text.indexOf('context window') >= 0 || text.indexOf('maximum context') >= 0
    || text.indexOf('too long for this model') >= 0 || message.indexOf('上下文超') >= 0;
}

/** 追加一条 notice；同一 id 连续出现时只保留一条，避免重连/重放把聊天刷满。 */
function appendNotice(items: ChatItem[], dedupeKey: string, text: string, noticeKind: string,
  hint: string, actionCommand: string, time: number): ChatItem[] {
  for (let i = items.length - 1; i >= 0 && i >= items.length - 3; i--) {
    const item: ChatItem = items[i];
    if (item.kind === 'notice' && item.id === dedupeKey) {
      return items;
    }
  }
  const created: ChatItem = new ChatItem();
  created.id = dedupeKey;
  created.kind = 'notice';
  created.text = text;
  created.reason = hint;
  created.noticeKind = noticeKind;
  created.actionCommand = actionCommand;
  created.timestamp = time > 0 ? time : Date.now();
  const next: ChatItem[] = items.slice();
  next.push(created);
  return next;
}

function addUserMessage(items: ChatItem[], data: Record<string, Object>, time: number): ChatItem[] {
  if (!isHumanUserMessage(data)) {
    return items;
  }
  const id: string = messageIdOf(data);
  const text: string = messageTextOf(data);
  const attachmentIds: string[] = [];
  const attachmentRefs: string[] = [];
  imageAttachmentsOf(data, attachmentIds, attachmentRefs);
  const files: string[] = fileLabelsOf(data);
  if (!hasVisibleText(text) && attachmentIds.length === 0 && files.length === 0) {
    return items;
  }
  const rpcId: string = messageRequestRpcId(data);
  const next: ChatItem[] = items.slice();
  if (rpcId.length > 0) {
    for (let i = 0; i < next.length; i++) {
      const item: ChatItem = next[i];
      if (item.kind === 'user' && item.requestRpcId === rpcId) {
        const settled: ChatItem = cloneItem(item);
        settled.id = id;
        settled.text = text;
        settled.requestRpcId = rpcId;
        if (attachmentIds.length > 0) {
          settled.imageAttachmentIds = attachmentIds;
          settled.imageRefs = attachmentRefs;
        }
        if (files.length > 0) {
          settled.files = files;
        }
        if (time > 0) {
          settled.timestamp = time;
        }
        settled.rev += 1;
        next[i] = settled;
        return next;
      }
    }
  }
  for (const item of next) {
    if (item.id === id) {
      return items;
    }
  }
  const message: ChatItem = new ChatItem();
  message.id = id;
  message.kind = 'user';
  message.role = 'user';
  message.text = text;
  message.requestRpcId = rpcId;
  message.imageAttachmentIds = attachmentIds;
  message.imageRefs = attachmentRefs;
  message.files = files;
  message.timestamp = time > 0 ? time : Date.now();
  next.push(message);
  return next;
}

function addAssistantMessage(items: ChatItem[], data: Record<string, Object>, time: number): ChatItem[] {
  const id: string = messageIdOf(data);
  const text: string = messageTextOf(data);
  const reasoning: string = messageReasoningOf(data);
  const streamId: string = `stream:${stepKeyOf(data)}`;
  const next: ChatItem[] = items.slice();
  let streamIndex: number = -1;
  for (let i = 0; i < next.length; i++) {
    const item: ChatItem = next[i];
    if (item.kind === 'assistant' && item.streaming && item.id === streamId) {
      streamIndex = i;
      break;
    }
  }
  const streamed: ChatItem | undefined = streamIndex >= 0 ? next[streamIndex] : undefined;
  const finalText: string = hasVisibleText(text) ? text
    : streamed !== undefined ? streamed.text : '';
  const finalReasoning: string = hasVisibleText(reasoning) ? reasoning
    : streamed !== undefined ? streamed.reasoning : '';
  if (!hasVisibleText(finalText) && !hasVisibleText(finalReasoning)) {
    if (streamIndex < 0) {
      return items;
    }
    next.splice(streamIndex, 1);
    return next;
  }
  if (streamIndex >= 0) {
    const settled: ChatItem = cloneItem(next[streamIndex]);
    settled.id = id;
    settled.text = finalText;
    settled.reasoning = finalReasoning;
    settled.streaming = false;
    if (time > 0) {
      settled.timestamp = time;
    }
    settled.rev += 1;
    next[streamIndex] = settled;
    return next;
  }
  for (const item of next) {
    if (item.id === id) {
      return items;
    }
  }
  const message: ChatItem = new ChatItem();
  message.id = id;
  message.kind = 'assistant';
  message.role = 'assistant';
  message.text = finalText;
  message.reasoning = finalReasoning;
  message.timestamp = time > 0 ? time : Date.now();
  next.push(message);
  return next;
}

function applyAssistantChunk(items: ChatItem[], data: Record<string, Object>, time: number): ChatItem[] {
  const chunk: Record<string, Object> | undefined = asRecord(data['chunk']);
  if (chunk === undefined) {
    return items;
  }
  const type: string = jsonStr(chunk, 'type', '');
  if (type !== 'text-delta' && type !== 'reasoning-delta') {
    return items;
  }
  const delta: string = jsonStr(chunk, 'text', '');
  if (delta.length === 0) {
    return items;
  }
  const streamId: string = `stream:${stepKeyOf(data)}`;
  const next: ChatItem[] = items.slice();
  let index: number = -1;
  for (let i = 0; i < next.length; i++) {
    const item: ChatItem = next[i];
    if (item.kind === 'assistant' && item.id === streamId) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    if (!hasVisibleText(delta)) {
      return items;
    }
    const created: ChatItem = new ChatItem();
    created.id = streamId;
    created.kind = 'assistant';
    created.role = 'assistant';
    created.text = type === 'text-delta' ? delta : '';
    created.reasoning = type === 'reasoning-delta' ? delta : '';
    created.streaming = true;
    created.timestamp = time > 0 ? time : Date.now();
    next.push(created);
    return next;
  }
  const updated: ChatItem = cloneItem(next[index]);
  if (type === 'reasoning-delta') {
    updated.reasoning = `${updated.reasoning}${delta}`;
  } else {
    updated.text = `${updated.text}${delta}`;
  }
  updated.streaming = true;
  updated.rev += 1;
  next[index] = updated;
  return next;
}

function applyToolEvent(items: ChatItem[], data: Record<string, Object>, time: number,
  state: string): ChatItem[] {
  const message: Record<string, Object> = messageRecord(data);
  const source: Record<string, Object> | undefined = asRecord(message['source']);
  let id: string = source !== undefined ? jsonStr(source, 'callId', '') : '';
  if (id.length === 0) {
    id = jsonStr(data, 'callId', '');
  }
  if (id.length === 0) {
    id = jsonStr(data, 'id', '');
  }
  if (id.length === 0) {
    id = `tool:${randomId()}`;
  }
  const name: string = jsonStr(data, 'name', jsonStr(data, 'toolName', 'Tool'));
  const summary: string = jsonStr(data, 'summary', '');
  const failed: boolean = state === 'finished' && toolResultFailed(data);
  const next: ChatItem[] = items.slice();
  let index: number = -1;
  for (let i = 0; i < next.length; i++) {
    const item: ChatItem = next[i];
    if (item.kind === 'tool' && item.id === id) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    const created: ChatItem = new ChatItem();
    created.id = id;
    created.kind = 'tool';
    created.toolName = name;
    created.toolState = failed ? 'failed' : state;
    created.summary = summary;
    created.text = state === 'running' ? toolCallDetailOf(data) : toolResultDetailOf(data);
    created.timestamp = time > 0 ? time : Date.now();
    next.push(created);
    return next;
  }
  const updated: ChatItem = cloneItem(next[index]);
  if (name !== 'Tool') {
    updated.toolName = name;
  }
  if (summary.length > 0) {
    updated.summary = summary;
  }
  updated.toolState = failed ? 'failed' : state;
  if (state === 'finished') {
    updated.text = toolResultDetailOf(data);
  }
  updated.rev += 1;
  next[index] = updated;
  return next;
}

function addApproval(items: ChatItem[], payload: Record<string, Object>, frameRpcId: string): ChatItem[] {
  const approvalId: string = jsonStr(payload, 'approvalId', '');
  if (approvalId.length === 0) {
    return items;
  }
  const id: string = `approval:${approvalId}`;
  for (const item of items) {
    if (item.id === id) {
      return items;
    }
  }
  const created: ChatItem = new ChatItem();
  created.id = id;
  created.kind = 'approval';
  created.approvalId = approvalId;
  created.sessionId = jsonStr(payload, 'sessionId', '');
  created.toolName = jsonStr(payload, 'toolName', 'Harness');
  created.reason = jsonStr(payload, 'reason', '');
  created.frameRpcId = frameRpcId;
  created.timestamp = Date.now();
  const next: ChatItem[] = items.slice();
  next.push(created);
  return next;
}

function resolveApproval(items: ChatItem[], payload: Record<string, Object>): ChatItem[] {
  const approvalId: string = jsonStr(payload, 'approvalId', '');
  const outcome: string = jsonStr(payload, 'outcome', '');
  if (approvalId.length === 0 || outcome.length === 0) {
    return items;
  }
  const next: ChatItem[] = items.slice();
  let changed: boolean = false;
  for (let i = 0; i < next.length; i++) {
    const item: ChatItem = next[i];
    if (item.kind === 'approval' && item.approvalId === approvalId) {
      const updated: ChatItem = cloneItem(item);
      updated.approvalOutcome = outcome;
      updated.rev += 1;
      next[i] = updated;
      changed = true;
    }
  }
  return changed ? next : items;
}

function addQuestion(items: ChatItem[], payload: Record<string, Object>, frameRpcId: string): ChatItem[] {
  const sessionId: string = jsonStr(payload, 'sessionId', '');
  const rawQuestions: Object[] | undefined = asArray(payload['questions']);
  if (sessionId.length === 0 || rawQuestions === undefined || rawQuestions.length === 0) {
    return items;
  }
  const id: string = `question:${frameRpcId.length > 0 ? frameRpcId : randomId()}`;
  const questions: ChatQuestion[] = [];
  for (const raw of rawQuestions) {
    const record: Record<string, Object> | undefined = asRecord(raw);
    if (record === undefined) {
      continue;
    }
    const question: ChatQuestion = new ChatQuestion();
    question.id = jsonStr(record, 'id', '');
    question.question = jsonStr(record, 'question', '');
    question.detail = jsonStr(record, 'detail', '');
    question.header = jsonStr(record, 'header', '');
    question.multiSelect = asBool(record['multiSelect']) === true;
    const rawOptions: Object[] | undefined = asArray(record['options']);
    if (rawOptions !== undefined) {
      for (const rawOption of rawOptions) {
        const optionRecord: Record<string, Object> | undefined = asRecord(rawOption);
        if (optionRecord !== undefined) {
          const label: string = jsonStr(optionRecord, 'label', '');
          if (label.length > 0) {
            question.options.push(label);
          }
        }
      }
    }
    if (question.id.length === 0) {
      continue;
    }
    questions.push(question);
  }
  if (questions.length === 0) {
    return items;
  }
  const next: ChatItem[] = items.slice();
  for (let i = 0; i < next.length; i++) {
    if (next[i].id === id) {
      const updated: ChatItem = cloneItem(next[i]);
      updated.questions = questions;
      updated.rev += 1;
      next[i] = updated;
      return next;
    }
  }
  const created: ChatItem = new ChatItem();
  created.id = id;
  created.kind = 'question';
  created.sessionId = sessionId;
  created.frameRpcId = frameRpcId;
  created.questions = questions;
  created.timestamp = Date.now();
  next.push(created);
  return next;
}

function resolveQuestion(items: ChatItem[], payload: Record<string, Object>): ChatItem[] {
  const questionRpcId: string = jsonStr(payload, 'questionRpcId', '');
  const outcome: string = jsonStr(payload, 'outcome', '');
  if (questionRpcId.length === 0 || outcome.length === 0) {
    return items;
  }
  const targetId: string = `question:${questionRpcId}`;
  const next: ChatItem[] = items.slice();
  let changed: boolean = false;
  for (let i = 0; i < next.length; i++) {
    const item: ChatItem = next[i];
    if (item.kind === 'question' && (item.id === targetId || item.frameRpcId === questionRpcId)) {
      const updated: ChatItem = cloneItem(item);
      updated.questionOutcome = outcome;
      updated.rev += 1;
      next[i] = updated;
      changed = true;
    }
  }
  return changed ? next : items;
}

function eventFromRecord(record: Record<string, Object>): HarnessSessionEvent {
  const event: HarnessSessionEvent = new HarnessSessionEvent();
  event.type = jsonStr(record, 'type', '');
  event.time = jsonNum(record, 'time', 0);
  const seq: number | undefined = asNum(record['seq']);
  if (seq !== undefined) {
    event.seq = seq;
  }
  const data: Record<string, Object> | undefined = asRecord(record['data']);
  if (data !== undefined) {
    event.data = data;
  }
  return event;
}

function messageRecord(data: Record<string, Object>): Record<string, Object> {
  const inner: Record<string, Object> | undefined = asRecord(data['message']);
  return inner !== undefined ? inner : data;
}

function messageTextOf(data: Record<string, Object>): string {
  const message: Record<string, Object> = messageRecord(data);
  const parts: string[] = [];
  collectTextBlocks(message['content'], 'text', parts);
  return parts.join('\n');
}

function messageReasoningOf(data: Record<string, Object>): string {
  const message: Record<string, Object> = messageRecord(data);
  const parts: string[] = [];
  collectTextBlocks(message['content'], 'reasoning', parts);
  return parts.join('\n');
}

function collectTextBlocks(value: Object | undefined, blockType: string, parts: string[]): void {
  const blocks: Object[] | undefined = asArray(value);
  if (blocks === undefined) {
    return;
  }
  for (const block of blocks) {
    const record: Record<string, Object> | undefined = asRecord(block);
    if (record === undefined || jsonStr(record, 'type', '') !== blockType) {
      continue;
    }
    const text: string | undefined = asStr(record['text']);
    if (text !== undefined) {
      parts.push(text);
    }
  }
}

/** 1234567 → 1.2 MB；给文件卡片用。 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  if (bytes >= 1024) {
    return Math.round(bytes / 1024) + ' KB';
  }
  return String(Math.max(0, Math.round(bytes))) + ' B';
}

/**
 * 从 user/message 里挑出 `file` 附件，返回「名称 · 大小」标签。
 * 主机只把 png/jpeg/webp/gif 当图片，HEIC 等格式会以 file part 存下来，
 * 而远端没有读文件字节的接口，所以客户端只能展示，不能预览。
 */
function fileLabelsOf(data: Record<string, Object>): string[] {
  const message: Record<string, Object> = messageRecord(data);
  const blocks: Object[] | undefined = asArray(message['content']);
  const out: string[] = [];
  if (blocks === undefined) {
    return out;
  }
  for (const block of blocks) {
    const record: Record<string, Object> | undefined = asRecord(block);
    if (record === undefined || jsonStr(record, 'type', '') !== 'file') {
      continue;
    }
    const attachment: Record<string, Object> | undefined = asRecord(record['attachment']);
    if (attachment === undefined) {
      continue;
    }
    const name: string = jsonStr(attachment, 'name', '');
    const bytes: number = jsonNum(attachment, 'bytes', 0);
    out.push((name.length > 0 ? name : '附件') + ' · ' + formatBytes(bytes));
  }
  return out;
}

/**
 * 把 `imageRefs` 里存的引用 JSON 还原成主机要的对象。
 * 解析不出来（老记录、字段异常）就返回 undefined，退回只发 attachmentId 的老行为。
 */
function parseAttachmentRef(json: string): Record<string, Object> | undefined {
  if (json.length === 0) {
    return undefined;
  }
  try {
    return asRecord(JSON.parse(json) as Object);
  } catch (error) {
    return undefined;
  }
}

/**
 * 从 user/message 的 content 里挑出图片附件（历史回显用；本地刚发的没有 id）。
 * `idsOut` 与 `refsOut` 下标一一对应：refs 是完整 `ImageAttachmentRef` 的 JSON 字符串，
 * 因为 0.2.2+ 的 `session/attachment` 必须收到 mediaType/bytes/width/height 才能校验通过。
 */
function imageAttachmentsOf(data: Record<string, Object>, idsOut: string[], refsOut: string[]): void {
  const message: Record<string, Object> = messageRecord(data);
  const blocks: Object[] | undefined = asArray(message['content']);
  if (blocks === undefined) {
    return;
  }
  for (const block of blocks) {
    const record: Record<string, Object> | undefined = asRecord(block);
    if (record === undefined || jsonStr(record, 'type', '') !== 'image') {
      continue;
    }
    const attachment: Record<string, Object> | undefined = asRecord(record['attachment']);
    if (attachment === undefined) {
      continue;
    }
    const attachmentId: string = jsonStr(attachment, 'attachmentId', '');
    if (attachmentId.length > 0 && !idsOut.includes(attachmentId)) {
      idsOut.push(attachmentId);
      refsOut.push(JSON.stringify(attachment));
    }
  }
}

function isHumanUserMessage(data: Record<string, Object>): boolean {
  const message: Record<string, Object> = messageRecord(data);
  const source: Record<string, Object> | undefined = asRecord(message['source']);
  return source !== undefined && jsonStr(source, 'kind', '') === 'user';
}

function messageRequestRpcId(data: Record<string, Object>): string {
  const message: Record<string, Object> = messageRecord(data);
  const source: Record<string, Object> | undefined = asRecord(message['source']);
  if (source === undefined || jsonStr(source, 'kind', '') !== 'user') {
    return '';
  }
  return jsonStr(source, 'rpcId', '');
}

function messageIdOf(data: Record<string, Object>): string {
  const message: Record<string, Object> = messageRecord(data);
  const id: string = jsonStr(message, 'id', '');
  return id.length > 0 ? id : `message:${randomId()}`;
}

function replyGroupOf(data: Record<string, Object>): string {
  const turn: Object | undefined = data['turn'];
  const asString: string | undefined = asStr(turn);
  if (asString !== undefined) {
    return asString;
  }
  const asNumber: number | undefined = asNum(turn);
  if (asNumber !== undefined) {
    return `${asNumber}`;
  }
  return '';
}

function stepKeyOf(data: Record<string, Object>): string {
  const turn: string = replyGroupOf(data);
  const step: Object | undefined = data['step'];
  const stepString: string | undefined = asStr(step);
  const stepNumber: number | undefined = asNum(step);
  const stepPart: string = stepString !== undefined ? stepString
    : stepNumber !== undefined ? `${stepNumber}` : '?';
  return `${turn.length > 0 ? turn : '?'}:${stepPart}`;
}

function hasVisibleText(text: string): boolean {
  return text.replace(/[\s\u00AD\u200B-\u200F\uFEFF]/g, '').length > 0;
}

function toolResultFailed(data: Record<string, Object>): boolean {
  if (asRecord(data['error']) !== undefined) {
    return true;
  }
  if (asBool(data['isError']) === true) {
    return true;
  }
  const message: Record<string, Object> = messageRecord(data);
  if (asBool(message['isError']) === true) {
    return true;
  }
  const content: Object[] | undefined = asArray(message['content']);
  if (content !== undefined) {
    for (const block of content) {
      const record: Record<string, Object> | undefined = asRecord(block);
      if (record !== undefined && jsonStr(record, 'type', '') === 'tool-result'
        && asBool(record['isError']) === true) {
        return true;
      }
    }
  }
  return false;
}

function toolCallDetailOf(data: Record<string, Object>): string {
  const args: string = jsonStr(data, 'arguments', jsonStr(data, 'argumentsDelta', ''));
  if (args.trim().length === 0) {
    return '';
  }
  try {
    const parsed: Object = JSON.parse(args);
    return boundedText(JSON.stringify(parsed, null, 2));
  } catch (e) {
    return boundedText(args);
  }
}

function toolResultDetailOf(data: Record<string, Object>): string {
  const message: Record<string, Object> = messageRecord(data);
  return boundedText(contentBlocksTextOf(message['content']));
}

function contentBlocksTextOf(value: Object | undefined): string {
  const blocks: Object[] | undefined = asArray(value);
  if (blocks === undefined) {
    return '';
  }
  const parts: string[] = [];
  for (const block of blocks) {
    const record: Record<string, Object> | undefined = asRecord(block);
    if (record === undefined) {
      continue;
    }
    const type: string = jsonStr(record, 'type', '');
    if (type === 'text' || type === 'reasoning') {
      const text: string = jsonStr(record, 'text', '');
      if (text.trim().length > 0) {
        parts.push(text);
      }
    } else if (type === 'image') {
      parts.push('[图片]');
    } else if (type === 'tool-result') {
      const nested: string = contentBlocksTextOf(record['content']);
      if (nested.trim().length > 0) {
        parts.push(nested);
      }
    }
  }
  return parts.join('\n\n');
}

function boundedText(text: string): string {
  if (text.length <= MAX_TOOL_DETAIL_CHARS) {
    return text;
  }
  return text.substring(0, MAX_TOOL_DETAIL_CHARS);
}
