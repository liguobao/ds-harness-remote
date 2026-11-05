import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { notificationManager } from '@kit.NotificationKit';
import { SecureStore, StoredServerConfig, SavedProfile } from './SecureStore';
import { RemoteServerApi, RemoteApiError, normalizeServerUrl, websocketUrl, QrLoginSession, QrLoginPoll,
  OAuthProvider, HostPresence, initClientVersion } from '../net/ServerApi';
import { RelayConnectionInfo, RelayTransport, RelayTransportOptions } from '../net/RelayTransport';
import { SecureTransport } from '../net/SecureTransport';
import { RemoteClientCore, RemoteClientError } from '../net/RemoteClientCore';
import { RemoteGateway, RemoteGatewayError, RemoteHostFeatures } from '../net/RemoteGateway';
import { HarnessAlphaClient, HarnessClientFrame, HarnessHistoryEntry, HarnessRemoteSession,
  DirectoryEntry, HarnessSessionEvent, HarnessWorkspace, HistoryPage, PromptImagePart } from '../net/HarnessClient';
import { DeviceIdentity, TokenPair, RemoteHostDevice, AuthorizedPeerDevice, AccountLoginResult } from '../model/Types';
import { asArray, asBool, asNum, asRecord, asStr, jsonStr, jsonNum } from '../protocol/Types';
import { randomId } from '../crypto/Bytes';
import { logInfo, logWarn, logError } from '../util/Log';
import { setEnglish, resolveEnglish, systemEnglish } from './I18n';
import { RtcBridge } from './RtcBridge';

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
  private config: StoredServerConfig | undefined = undefined;
  private identity: DeviceIdentity | undefined = undefined;
  private credentials: TokenPair | undefined = undefined;
  private core: RemoteClientCore | undefined = undefined;
  private harness: HarnessAlphaClient | undefined = undefined;
  private unsubscribeClose: (() => void) | undefined = undefined;
  /** 预热中的中继通道：还没交给 SecureTransport/Core 就失败时由 teardown 负责关掉，否则会漏一条 socket。 */
  private pendingRelay: RelayTransport | undefined = undefined;
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
  private reconnectAttempt: number = 0;
  private reconnectTimer: number = -1;

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
  serverUrl: string = '';
  email: string = '';
  devices: RemoteHostDevice[] = [];
  sessions: HarnessRemoteSession[] = [];
  /** True when the session list failed to load; the chat shows a retry entry point. */
  sessionsLoadFailed: boolean = false;
  messages: ChatItem[] = [];
  generating: boolean = false;
  currentSessionId: string = '';
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
  /** 会话输入草稿（sessionId -> 文本）。 */
  drafts: Record<string, string> = {};
  /** 本地提示词库。 */
  prompts: string[] = [];
  /** 完成通知开关（默认开），以及 App 是否在后台——只有后台才值得打扰。 */
  notificationsEnabled: boolean = true;
  appBackground: boolean = false;
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
      await initClientVersion();
      await this.store.init(context);
      this.config = await this.store.loadConfig();
      this.identity = await this.store.loadOrCreateIdentity();
      this.credentials = await this.store.loadCredentials();
      this.deviceAliases = this.store.loadDeviceAliases();
      this.themeMode = this.store.loadThemeMode();
      this.languageMode = this.store.loadLanguageMode();
      this.textScaleMode = this.store.loadTextScale();
      this.profiles = this.store.loadProfiles();
      this.drafts = this.store.loadDrafts();
      this.prompts = this.store.loadPrompts();
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
    this.busy = true;
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
      this.busy = false;
      await this.rememberProfile();
      this.notify();
      await this.refreshDevices();
      return;
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.busy = false;
    this.notify();
  }

  async refreshDevices(): Promise<void> {
    if (this.phase !== PHASE_DEVICES) {
      return;
    }
    this.busy = true;
    this.errorMsg = '';
    this.notify();
    try {
      const devices: RemoteHostDevice[] = await this.listDevicesWithRetry();
      await this.fillPresence(devices);
      devices.sort(compareDevices);
      this.devices = devices;
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.busy = false;
    this.notify();
  }

  /** 页面把 WebRTC 桥交给运行时；没挂上时连接一律走中继。 */
  attachRtcBridge(bridge: RtcBridge): void {
    this.rtcBridge = bridge;
  }

  async connectDevice(deviceId: string): Promise<void> {
    if (this.phase !== PHASE_DEVICES) {
      return;
    }
    // 刚从这台主机的会话页退回来（连接还活着）：不重新认证，直接回聊天
    if (this.keepAliveDeviceId === deviceId && this.core !== undefined && this.harness !== undefined) {
      logInfo('reuse live connection to ' + deviceId);
      this.phase = PHASE_CHAT;
      this.errorMsg = '';
      this.notify();
      this.loadSessionsAfterConnect().catch(() => undefined);
      return;
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
    try {
      const config: StoredServerConfig | undefined = this.config;
      const identity: DeviceIdentity | undefined = this.identity;
      const credentials: TokenPair | undefined = this.credentials;
      if (config === undefined || identity === undefined || credentials === undefined) {
        throw new Error('尚未登录');
      }
      // 先把中继/控制通道的建连预热起来，和下面的 REST 查询并行跑：
      // 二者互不依赖（RelayTransport 只需要 deviceId，身份公钥是给 Noise 用的）。
      const relayOptions: RelayTransportOptions = new RelayTransportOptions();
      relayOptions.deviceId = identity.deviceId;
      relayOptions.accessToken = credentials.accessToken;
      relayOptions.targetDeviceId = deviceId;
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
      const host: AuthorizedPeerDevice = await this.deviceForWithRetry(deviceId);
      if (!host.presenceKnown) {
        this.setConnectStage('检查主机在线状态…');
        const presence: HostPresence = await this.presenceWithRetry(host.deviceId);
        host.online = presence.online;
        host.presenceKnown = true;
      }
      if (!host.online) {
        throw new Error('设备不在线');
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
      const core: RemoteClientCore = new RemoteClientCore(secure, 45000);
      this.core = core;
      this.unsubscribeClose = core.onClose((error: Error | undefined) => {
        this.handleDisconnect();
      });
      this.setConnectStage('建立加密通道（Noise IK 握手）…');
      await core.connect();
      if (this.connectCancelled) {
        return;
      }
      // ICE 体检只用于诊断，绝不能挡在连接主链路上（慢链路下单次 HTTP 可能几十秒）
      this.probeIceConfig(relay).catch(() => undefined);
      this.setConnectStage('读取主机能力…');
      const gateway: RemoteGateway = new RemoteGateway(core);
      const features: RemoteHostFeatures = await gateway.probeHostFeatures();
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
      if (this.connectCancelled) {
        return;
      }
      // Enter the chat as soon as the secure harness channel is live: the session
      // list is loaded afterwards so a slow host never keeps the user locked out.
      this.connectedHostName = host.name.length > 0 ? host.name : '远程主机';
      this.connectedDeviceId = host.deviceId;
      this.transportLabel = relay.transportKind();
      logInfo('connected to host ' + host.deviceId + ' transport=' + this.transportLabel);
      this.reconnectAttempt = 0;
      this.reconnectStatus = '';
      this.clearReconnectTimer();
      this.connectStage = '';
      this.phase = PHASE_CHAT;
      this.notify();
      await this.loadSessionsAfterConnect();
      this.loadWorkspaces().catch(() => undefined);
      return;
    } catch (error) {
      logError('connect failed: ' + errorMessage(error));
      const autoRetry: boolean = !this.connectCancelled && deviceId === this.lastDeviceId
        && this.reconnectAttempt > 0 && this.reconnectAttempt < AppRuntime.MAX_RECONNECT_ATTEMPTS;
      if (!this.connectCancelled && !autoRetry) {
        this.errorMsg = errorMessage(error);
      }
      this.teardownConnection();
      if (this.phase !== PHASE_DEVICES) {
        this.phase = PHASE_DEVICES;
      }
      if (autoRetry) {
        // 自动重连期间的单次失败不打断退避序列，继续按下一档重试。
        const index: number = Math.min(this.reconnectAttempt, AppRuntime.RECONNECT_DELAYS_MS.length - 1);
        const delay: number = AppRuntime.RECONNECT_DELAYS_MS[index];
        this.reconnectAttempt += 1;
        this.reconnectStatus = '重连失败，' + Math.round(delay / 1000) + ' 秒后重试（第 '
          + this.reconnectAttempt + ' / ' + AppRuntime.MAX_RECONNECT_ATTEMPTS + ' 次）';
        this.scheduleReconnect(deviceId, delay);
      }
    }
    this.notify();
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
    this.teardownConnection();
    this.keepAliveDeviceId = '';
    this.clearReconnectTimer();
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
    // 退出前先把手上的登录态存成 profile：以后在设置里一键切回来，不用重输密码
    await this.rememberProfile();
    this.phase = PHASE_SETUP;
    this.busy = false;
    this.errorMsg = '';
    this.devices = [];
    this.credentials = undefined;
    await this.store.clearCredentials();
    this.notify();
  }

  /** 取主机上一张图片的 base64（消息里的本地图片路径）。 */
  async readImageBase64(path: string): Promise<string> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined) {
      throw new Error('尚未连接主机');
    }
    const sessionId: string = this.currentSessionId;
    return harness.readFileBase64(sessionId, path);
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
    this.busy = true;
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
      this.generating = false;
      this.notify();
      const page: HistoryPage = await harness.sessionHistory(sessionId, -1, INITIAL_HISTORY_COUNT);
      if (this.currentSessionId === sessionId) {
        this.messages = foldHistory(page.entries);
        this.rememberHistory(sessionId, this.messages);
        this.notify();
      }
      this.refreshSessionsSoon();
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.busy = false;
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
    this.busy = true;
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
      this.hydrateHistoryImages().catch(() => undefined);
    } catch (error) {
      this.errorMsg = errorMessage(error);
    }
    this.busy = false;
    this.notify();
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
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.errorMsg = '';
    this.notify();
    try {
      this.teardownConnection();
      this.clearReconnectTimer();
      const config: StoredServerConfig = new StoredServerConfig();
      config.baseUrl = profile.baseUrl;
      config.email = profile.email;
      const tokens: TokenPair = new TokenPair();
      tokens.accessToken = profile.accessToken;
      tokens.accessTokenExpiresAt = profile.accessTokenExpiresAt;
      tokens.refreshToken = profile.refreshToken;
      tokens.refreshTokenExpiresAt = profile.refreshTokenExpiresAt;
      await this.store.saveConfig(config);
      await this.store.saveCredentials(tokens);
      this.config = config;
      this.credentials = tokens;
      this.serverUrl = config.baseUrl;
      this.email = config.email;
      const identity: DeviceIdentity = await this.store.loadOrCreateIdentity();
      this.identity = identity;
      this.phase = PHASE_DEVICES;
      this.busy = false;
      await this.rememberProfile();
      this.notify();
      await this.refreshDevices();
    } catch (error) {
      this.busy = false;
      this.errorMsg = errorMessage(error);
      this.notify();
    }
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
      this.workspaces = await harness.workspaceList();
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

  /** 归档指定会话（会话列表长按触发）。 */
  async archiveSession(sessionId: string): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      await harness.sessionArchive(sessionId);
      const next: HarnessRemoteSession[] = [];
      for (const session of this.sessions) {
        if (session.sessionId !== sessionId) {
          next.push(session);
        }
      }
      this.sessions = next;
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = '';
        this.currentSessionTitle = '';
        this.messages = [];
      }
      this.notify();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
  }

  /** 归档当前会话并回到会话列表。 */
  async archiveCurrentSession(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    const sessionId: string = this.currentSessionId;
    if (harness === undefined || sessionId.length === 0) {
      return;
    }
    try {
      await harness.sessionArchive(sessionId);
      const next: HarnessRemoteSession[] = [];
      for (const session of this.sessions) {
        if (session.sessionId !== sessionId) {
          next.push(session);
        }
      }
      this.sessions = next;
      this.currentSessionId = '';
      this.currentSessionTitle = '';
      this.messages = [];
      this.notify();
      await this.refreshSessionsSoon();
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.notify();
    }
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
    } catch (error) {
      this.errorMsg = errorMessage(error);
      this.generating = false;
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
      for (const item of this.messages) {
        if (item.kind !== 'user' || item.imageAttachmentIds.length === 0) {
          continue;
        }
        for (const id of item.imageAttachmentIds) {
          if (!this.fetchedAttachments.has(id)) {
            attachmentId = id;
            break;
          }
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
          body = await harness.sessionAttachment(sessionId, attachmentId);
          this.attachmentCache.set(attachmentId, body);
        } catch (error) {
          logWarn('history image ' + attachmentId + ' failed: ' + errorMessage(error));
          this.attachmentCache.set(attachmentId, '');
        }
      }
      if (body.length === 0) {
        this.notify();
        continue;
      }
      logInfo('history image ok ' + attachmentId.substring(0, 20) + ' base64=' + body.length);
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

  private async refreshSessions(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || this.phase !== PHASE_CHAT) {
      return;
    }
    try {
      const sessions: HarnessRemoteSession[] = await harness.sessionList(12000);
      if (this.harness === harness && this.phase === PHASE_CHAT) {
        this.sessions = sortSessions(sessions);
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

  private async presenceWithRetry(deviceId: string): Promise<HostPresence> {
    const api: RemoteServerApi = await this.ensureApi();
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
    await this.store.saveCredentials(tokens);
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
   * Load the session list right after entering the chat phase. A slow or stuck
   * Host must not fail the whole connection: on failure the chat stays usable
   * and the user can retry from the empty-state entry point.
   */
  private async loadSessionsAfterConnect(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || this.phase !== PHASE_CHAT) {
      return;
    }
    this.busy = true;
    this.sessionsLoadFailed = false;
    this.notify();
    try {
      const sessions: HarnessRemoteSession[] = await this.sessionListWithRetry(harness);
      if (this.harness !== harness || this.phase !== PHASE_CHAT) {
        return;
      }
      this.sessions = sortSessions(sessions);
      this.busy = false;
      this.sessionsLoadFailed = false;
      this.notify();
      await this.pickInitialSession();
    } catch (error) {
      logError('session list failed after connect: ' + errorMessage(error));
      if (this.harness !== harness || this.phase !== PHASE_CHAT) {
        return;
      }
      this.sessions = [];
      this.sessionsLoadFailed = true;
      this.currentSessionId = '';
      this.currentSessionTitle = '会话列表加载失败';
      this.messages = [];
      this.generating = false;
      this.busy = false;
      this.errorMsg = '会话列表加载失败：' + errorMessage(error);
      this.notify();
    }
  }

  /** User-triggered retry for a failed session-list load; keeps the live connection. */
  async retrySessionLoad(): Promise<void> {
    const harness: HarnessAlphaClient | undefined = this.harness;
    if (harness === undefined || this.phase !== PHASE_CHAT || this.busy) {
      return;
    }
    this.busy = true;
    this.sessionsLoadFailed = false;
    this.errorMsg = '';
    this.notify();
    try {
      const sessions: HarnessRemoteSession[] = await this.sessionListWithRetry(harness);
      if (this.harness !== harness || this.phase !== PHASE_CHAT) {
        return;
      }
      this.sessions = sortSessions(sessions);
      this.busy = false;
      this.notify();
      await this.pickInitialSession();
    } catch (error) {
      if (this.harness !== harness || this.phase !== PHASE_CHAT) {
        return;
      }
      this.sessionsLoadFailed = true;
      this.busy = false;
      this.errorMsg = '会话列表加载失败：' + errorMessage(error);
      this.notify();
    }
  }

  private async sessionListWithRetry(harness: HarnessAlphaClient): Promise<HarnessRemoteSession[]> {
    try {
      return await harness.sessionList(12000);
    } catch (error) {
      const wrapped: Error = asError(error);
      if (!(wrapped instanceof RemoteGatewayError) || wrapped.code !== 'RPC_TIMEOUT') {
        throw wrapped;
      }
      logWarn('session/list timed out, retrying once');
      await delay(1500);
      return await harness.sessionList(12000);
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
    const unsubscribe: (() => void) | undefined = this.unsubscribeClose;
    this.unsubscribeClose = undefined;
    if (unsubscribe !== undefined) {
      unsubscribe();
    }
    const core: RemoteClientCore | undefined = this.core;
    this.core = undefined;
    const pending: RelayTransport | undefined = this.pendingRelay;
    this.pendingRelay = undefined;
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
      return;
    }
    this.teardownConnection();
    const target: string = this.lastDeviceId;
    if (target.length > 0 && this.reconnectAttempt < AppRuntime.MAX_RECONNECT_ATTEMPTS) {
      const index: number = Math.min(this.reconnectAttempt, AppRuntime.RECONNECT_DELAYS_MS.length - 1);
      const delay: number = AppRuntime.RECONNECT_DELAYS_MS[index];
      this.reconnectAttempt += 1;
      this.phase = PHASE_DEVICES;
      this.errorMsg = '';
      this.reconnectStatus = '与主机的连接已断开，' + Math.round(delay / 1000)
        + ' 秒后自动重连（第 ' + this.reconnectAttempt + ' / ' + AppRuntime.MAX_RECONNECT_ATTEMPTS + ' 次）';
      this.notify();
      this.scheduleReconnect(target, delay);
      return;
    }
    this.phase = PHASE_DEVICES;
    this.reconnectStatus = '';
    this.errorMsg = this.reconnectAttempt > 0
      ? '多次重连未成功，请检查网络或稍后手动连接'
      : '与主机的连接已断开';
    this.reconnectAttempt = 0;
    this.notify();
  }

  private scheduleReconnect(deviceId: string, delay: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = -1;
      if (this.phase !== PHASE_DEVICES || this.connectCancelled) {
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

  /** 用户主动取消自动重连（例如要切换到另一台主机）。 */
  cancelReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnectStatus = '';
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
    } else if (event.type === 'turn/end') {
      this.generating = false;
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
  return copy;
}

/** Fold a native history window into ordered chat items. */
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
  const attachmentIds: string[] = imageAttachmentIdsOf(data);
  if (!hasVisibleText(text) && attachmentIds.length === 0) {
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

/** 从 user/message 的 content 里挑出图片附件 id（历史回显用；本地刚发的没有 id）。 */
function imageAttachmentIdsOf(data: Record<string, Object>): string[] {
  const message: Record<string, Object> = messageRecord(data);
  const blocks: Object[] | undefined = asArray(message['content']);
  const out: string[] = [];
  if (blocks === undefined) {
    return out;
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
    if (attachmentId.length > 0 && !out.includes(attachmentId)) {
      out.push(attachmentId);
    }
  }
  return out;
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
