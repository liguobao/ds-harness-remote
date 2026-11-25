import { PluginSettingOperation, PluginSettingsForm } from '../net/PluginSettings';
import { PluginSettingsPage } from '../ui/PluginSettingsPage';
import { BotCatalogRow } from '../net/BotCatalog';
import { TerminalPage } from '../ui/TerminalPage';
import { TerminalSession } from '../net/TerminalSession';
import { DshWebPage } from '../ui/DshWebPage';
import { HostPluginBundle, HostPluginRow } from '../net/PluginInventory';
import { KeyboardAvoidMode, UIContext, display, window, promptAction } from '@kit.ArkUI';
import { KeyCode } from '@ohos.multimodalInput.keyCode';
import lazy { pdfService, pdfViewManager, PdfView } from '@kit.PDFKit';
import { common, Want } from '@kit.AbilityKit';
import { deviceInfo, pasteboard } from '@kit.BasicServicesKit';
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { AppRuntime, ChatItem, ChatQuestion, DEFAULT_SERVER_URL, PHASE_BOOT, PHASE_CHAT,
  PHASE_CONNECTING, PHASE_DEVICES, PHASE_SETUP, ModelOption, SlashCommand,
  getAppRuntime, errorMessage, maskSecrets } from '../services/AppRuntime';
import { RemoteHostDevice } from '../model/Types';
import { DirectoryEntry, HarnessWorkspace, WORKSPACE_TEXT_PAGE_LINES, WorkspaceTextPage, WorkspaceGitFile, WorkspaceGitStatus, WorkspaceGitDiff } from '../net/HarnessClient';
import { HarnessRemoteSession, HarnessSchedule, HarnessScheduleDelivery } from '../net/HarnessClient';
import { applyTint, darkPalette, lightPalette, Palette } from '../services/Theme';
import { AccountMembership, OAuthProvider, clientVersion as appVersion } from '../net/ServerApi';
import { t, english, LANG_SYSTEM, LANG_ZH, LANG_EN } from '../services/I18n';
import {
  Breakpoint, FoldState, breakpointOf, contentColumnWidth, deviceColumns, foldStateOf,
  isCompactWidth, isExpandedWidth
} from '../services/Adaptive';
import { PickedImage, compressPixelMap, pickImages } from '../services/ImagePicker';
import { PromptImagePart } from '../net/HarnessClient';
import { RtcBridge } from '../services/RtcBridge';
import { heartbeatBodyOf } from '../services/Heartbeat';
import { isVisibleSession } from '../util/SessionVisibility';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { ServerSetupScreen } from '../ui/ServerSetupScreen';
import { ConnectionScreen } from '../ui/ConnectionScreen';
import { ResponseActions } from '../ui/ResponseActions';
import { WorkspaceToolbar } from '../ui/WorkspaceToolbar';
import { ChatHeader } from '../ui/ChatHeader';
import { RemoteHostRow } from '../ui/RemoteHostRow';
import { ScreenHeader } from '../ui/ScreenHeader';
import { LoginServerEditor } from '../ui/LoginServerEditor';
import BuildProfile from 'BuildProfile';

const MEMBERSHIP_PRICING_URL: string = 'https://dsh.r2049.cn/pricing';
const RELEASES_URL: string = 'https://github.com/liguobao/ds-harness-remote/releases/latest';

class SessionFolder {
  key: string;
  title: string;
  sessions: HarnessRemoteSession[];
  depth: number;

  constructor(key: string, title: string, sessions: HarnessRemoteSession[], depth: number = 0) {
    this.key = key;
    this.title = title;
    this.sessions = sessions;
    this.depth = depth;
  }
}

@Entry
@Component
struct Index {
  private runtime: AppRuntime = getAppRuntime();
  /** ArkWeb/WebRTC 桥：目前只跑能力自检，数据面仍走 relay。 */
  private rtc: RtcBridge = new RtcBridge();
  private images: MarkdownImageCache = new MarkdownImageCache();
  @State imageVersion: number = 0;
  private scroller: Scroller = new Scroller();
  private fieldsPrefilled: boolean = false;
  private mainWindow: window.Window | undefined = undefined;

  @State phase: string = PHASE_BOOT;
  @State busy: boolean = false;
  @State busyAction: string = '';
  @State errorMsg: string = '';
  @State infoMsg: string = '';
  /** 自动重连提示（含倒计时与第几次），原来是死数据只给状态点染色用。 */
  @State reconnectNotice: string = '';
  @State networkOnline: boolean = true;
  /** 会话页里正在等重连（短抖动不踢回设备列表）。 */
  @State reconnecting: boolean = false;
  /** 连接诊断面板。 */
  @State terminalOpen: boolean = false;
  private terminalSession: TerminalSession | undefined = undefined;
  private terminalSessionId: string = '';
  @State dshWebOpen: boolean = false;
  @State pluginForm: PluginSettingsForm | undefined = undefined;
  @State pluginFormTitle: string = '';
  private pluginFormDevice: string = '';
  @State pluginsOpen: boolean = false;
  @State pluginsLoading: boolean = false;
  @State pluginsError: string = '';
  @State pluginBundles: HostPluginBundle[] = [];
  @State pluginSelected: string = '';
  @State pluginSaving: boolean = false;
  private pluginRequest: number = 0;
  @State appearanceOpen: boolean = false;
  @State aboutOpen: boolean = false;
  @State browseRoot: string = '';
  private browseSessionId: string = '';
  @State diagnosticsOpen: boolean = false;
  /** 连接详情（点顶栏传输徽标打开）：传输路径 / 握手耗时 / 延迟 / 回落原因。 */
  @State linkDetailOpen: boolean = false;
  /** 已手动「看原文」的气泡（打码的敏感内容点一下就能展开）。 */
  @State revealedSecrets: string[] = [];
  /** 主题色选择面板。 */
  /** 定时任务面板。 */
  @State schedulesOpen: boolean = false;
  @State devices: RemoteHostDevice[] = [];
  @State sessions: HarnessRemoteSession[] = [];
  @State sessionsLoadFailed: boolean = false;
  @State messages: ChatItem[] = [];
  @State generating: boolean = false;
  @State currentSessionId: string = '';
  @State currentSessionTitle: string = '';
  @State connectedHostName: string = '';
  @State connectedDeviceId: string = '';
  @State deviceAliases: Record<string, string> = {};
  @State renamingDeviceId: string = '';
  @State renameInput: string = '';
  /** 会话重命名编辑态。 */
  /** 会话搜索。 */
  @State sessionSearchInput: string = '';
  @State expandedSessionGroups: string[] = [];
  @State collapsedSessionGroups: string[] = [];
  @State sessionSearchResults: HarnessRemoteSession[] = [];
  @State sessionSearchActive: boolean = false;
  /** 上下文占用百分比，0 表示未知。 */
  @State contextPercent: number = 0;
  /** 这条连接的数据面：'' | 'lan' | 'p2p' | 'turn' | 'relay'。 */
  @State connectedTransport: string = '';
  /** 已选好、还没发出去的图片。 */
  @State pendingImages: PickedImage[] = [];
  /** 正在取图/压缩。 */
  @State pickingImages: boolean = false;
  @State connectStage: string = '';
  @State connectStageIndex: number = 0;
  /** 诊断用：设备型号（读不到就给 unknown）。 */
  private deviceModelLabel(): string {
    try {
      const model: string = deviceInfo.productModel;
      return model.length > 0 ? model : 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /** 连接已经跑了多少秒：卡在哪里一眼能看出来。 */
  @State connectElapsedSec: number = 0;
  private connectStartAt: number = 0;
  private connectTickTimer: number = -1;
  /** 斜杠命令候选。 */
  @State slashCommands: SlashCommand[] = [];
  /** 模型选择器。 */
  @State permissionPickerOpen: boolean = false;
  @State showModelPicker: boolean = false;
  /** 顶栏齿轮打开的面板。 */
  @State showSessionPanel: boolean = false;
  @State modelOptions: ModelOption[] = [];
  @State currentModelLabel: string = '';
  @State currentModelProvider: string = '';
  @State currentModelEffort: string = '';
  @State permissionPreset: string = '';
  /** 按住说话：波形条高度、计时、是否处于「上滑取消」区。 */
  /** 文字大小档位与倍数（0 小 / 1 标准 / 2 大 / 3 特大）。 */
  @State textScaleMode: number = 1;
  /** 「更多」面板（替代系统菜单，自己控制对比度）。 */
  @State showMoreMenu: boolean = false;
  /** 通用设置的点选面板。 */
  @State choiceOpen: boolean = false;
  @State choiceKind: string = '';
  /** 单台设备的操作面板（卡片 ⋯）。 */
  @State deviceMenuId: string = '';
  @State textScaleValue: number = 1;
  /** 窗口尺寸（vp），PC 上放大窗口时据此调整布局。 */
  @State windowWidthVp: number = 0;
  @State windowHeightVp: number = 0;
  /** 当前窗口宽度落在哪个断点（xs/sm/md/lg/xl），布局判断统一走它。 */
  @State breakpoint: Breakpoint = 'sm';
  /** 折叠形态（展开 / 半折 / 折叠）；双折轴三折叠也归一到这三态。 */
  @State foldState: FoldState = 'expanded';
  /** 键盘是否弹起：弹起时收起语境胶囊、收窄列表底部留白。 */
  @State keyboardVisible: boolean = false;
  /** 提示词面板（本地提示词库）。 */
  @State promptPanelOpen: boolean = false;
  /** 执行轨迹面板：把本次会话里的工具调用按顺序列成时间线。 */
  @State trajectoryOpen: boolean = false;
  /** 新建工作区面板。 */
  @State workspaceCreateOpen: boolean = false;
  /** 文本文件预览面板。 */
  @State filePreviewOpen: boolean = false;
  @State filePreviewPath: string = '';
  @State filePreviewLoading: boolean = false;
  @State filePreviewError: string = '';
  @State filePreviewPage: WorkspaceTextPage = new WorkspaceTextPage();
  @State previewIsOffice: boolean = false;
  @State workspaceGitOpen: boolean = false;
  @State workspaceGitStatus: WorkspaceGitStatus = new WorkspaceGitStatus();
  @State workspaceGitScope: string = 'all';
  @State workspaceGitLoading: boolean = false;
  @State workspaceGitError: string = '';
  @State workspaceGitDiffPath: string = '';
  @State workspaceGitDiff: WorkspaceGitDiff = new WorkspaceGitDiff();
  @State workspaceGitDiffLoading: boolean = false;
  /** 预览的是不是 PDF（走系统 PDF Kit 渲染）。 */
  @State previewIsPdf: boolean = false;
  @State pdfError: string = '';
  private pdfController?: pdfViewManager.PdfController;
  private pdfRequest: number = 0;
  @State pdfPage: number = 0;
  @State pdfPages: number = 0;
  @State pdfZoom: number = 1;
  /** 消息操作面板（自绘，替代系统 ActionSheet）。 */
  @State messageActionsOpen: boolean = false;
  @State messageActionText: string = '';
  @State messageActionKind: string = '';
  @State messageActionSeq: number = 0;
  @State messageActionTime: number = 0;
  /** 该消息里所有代码块拼起来的内容，空串表示没有代码。 */
  @State messageActionCode: string = '';
  /** 设备详情面板（点 ⋯ 菜单里的「查看详情」打开）。 */
  @State deviceDetailId: string = '';
  /** 会话抽屉视图选项，与 Android 端的分组/排序/归档筛选一致。 */
  @State sessionGroupBy: string = 'workspace';
  @State sessionOrderBy: string = 'updated';
  @State sessionFilterMode: string = 'hideArchived';
  /** 展开看原文的心跳消息 id（默认折叠成可读正文）。 */
  @State heartbeatExpanded: string[] = [];
  /** 全屏编辑面板（长文写作时用，对齐 Android 的 composer expand）。 */
  @State composerExpanded: boolean = false;
  /** 登录页：密码登录默认收起（有扫码/授权方式时），对齐上游 #335。 */
  @State passwordLoginOpen: boolean = false;
  /** 发送方式面板（长按发送键）。 */
  @State sendModeOpen: boolean = false;
  /** 写作辅助面板（点 ✦）：提示词库 / 全屏编辑。 */
  @State writingMenuOpen: boolean = false;
  /** 归档 / 置顶集合的本地镜像（运行时对象不是可观察的，直接读不会触发重渲染）。 */
  @State archivedIds: string[] = [];
  @State pinnedIds: string[] = [];
  /** 当前会话还有更早历史可翻（同上，运行时字段要镜像）。 */
  @State historyHasMore: boolean = false;
  @State loadingOlderHistory: boolean = false;
  /** 按工作区过滤会话（存完整 cwd；空 = 全部）。 */
  @State workspaceFilter: string = '';
  /** 会话内搜索（只在当前会话里找）。 */
  @State inSessionSearchOpen: boolean = false;
  @State inSessionQuery: string = '';
  /** 被手工展开的长消息（item.id）。 */
  @State expandedMessages: string[] = [];
  @State workspacePathInput: string = '';
  @State workspaceNameDraft: string = '';
  @State promptDraftInput: string = '';
  /** 上一次同步到的会话 id，用来判断「切了会话」并搬运草稿。 */
  private lastSyncedSessionId: string = '';
  private draftSaveTimer: number = -1;
  /** 每个会话自己的「是否跟随底部」：切走再回来不强行把你拽到底部。 */
  private stickBySession: Record<string, boolean> = {};
  /** 每个会话最后停在的那一行（item.id），切回来据此定位。 */
  private scrollAnchors: Record<string, string> = {};
  private anchorSaveTimer: number = -1;
  @State permissionOptionsList: string[] = [];
  /** 工作区选择。 */
  @State workspaces: HarnessWorkspace[] = [];
  @State selectedWorkspaceId: string = '';
  /** 待选推理等级的模型（null 表示未进入等级选择）。 */
  @State pendingModel: ModelOption | undefined = undefined;
  /** 文件浏览面板。 */
  @State showBrowser: boolean = false;
  @State browsePath: string = '';
  @State browseLoading: boolean = false;
  @State browseError: string = '';
  @State directoryEntries: DirectoryEntry[] = [];
  /** 工作区改名。 */
  @State editingWorkspaceId: string = '';
  @State workspaceTitleInput: string = '';

  @State autoConnectLastHost: boolean = true;
  @State hostSwitcherOpen: boolean = false;
  @State hostsManagementOpen: boolean = false;
  @State workspaceOptionsOpen: boolean = false;
  @State workspaceSearchOpen: boolean = false;
  @State botTabOpen: boolean = false;
  @State botCatalog: BotCatalogRow[] = [];
  @State botCatalogLoading: boolean = false;
  @State botCatalogError: string = '';
  @State botDetail: BotCatalogRow | undefined = undefined;
  private botCatalogRequest: number = 0;
  @State loginServerEditor: boolean = false;
  @State serverInput: string = '';
  @State emailInput: string = '';
  @State passwordInput: string = '';
  @State passwordChallenge: string = '';
  private passwordChallengeServer: string = '';
  @State attachmentMenuOpen: boolean = false;
  @State promptInput: string = '';
  @State qrUrl: string = '';
  @State providers: OAuthProvider[] = [];
  private providersRequested: boolean = false;
  @State showSessions: boolean = false;
  /** PC：鼠标悬停在哪一行（会话行/主机卡），用来做 hover 高亮。 */
  /** PC：鼠标停在哪个消息上（气泡旁出快捷操作）。 */
  @State hoverMessageId: string = '';
  /** 分栏分隔条拖动中 / 悬停中。 */
  @State splitDragging: boolean = false;
  @State splitHover: boolean = false;
  private splitDragBase: number = 0;
  /** 竖屏会话抽屉的跟手进度：0 全收起，1 全展开（手势拖动直接改这个值）。 */
  @State drawerOpen: number = 0;
  private drawerCloseTimer: number = -1;
  /** 本次拖动的起点进度，以及它是不是从聊天页发起的（两个地方各有一把手势）。 */
  private drawerDragBase: number = 0;
  private drawerDragFromChat: boolean = false;
  @State topInset: number = 0;
  @State bottomInset: number = 0;
  @State isLandscape: boolean = false;
  @State accountEmail: string = '';
  @State accountServer: string = '';
  @State themeMode: number = 0;
  @State languageMode: number = 0;
  @State isDarkUi: boolean = false;
  @State showSettings: boolean = false;
  @State membershipStatus: string = '';
  @State membershipExpiry: number = 0;
  private membershipRequest: number = 0;
  /** 是否跟随最新消息；用户往上翻时置 false，避免流式输出把列表一直拽到底。 */
  @State stickToBottom: boolean = true;
  private searchDebounceTimer: number = -1;
  /** 上一次强制贴底的会话 id，用于区分「刚切进来」还是「流式更新」。 */
  private lastScrolledSessionId: string = '';
  /** chatRows 缓存：流式输出时每帧全量重算太贵。 */
  private chatRowsKey: string = '';
  private chatRowsSource: ChatItem[] | undefined = undefined;
  private runtimeMessages: ChatItem[] | undefined = undefined;
  private chatRowsCache: ChatItem[] = [];
  /** 图片全屏预览：src、缩放与平移。 */
  @State previewSrc: string = '';
  @State previewActive: boolean = false;
  @State previewScale: number = 1;
  @State previewOffsetX: number = 0;
  @State previewOffsetY: number = 0;
  /** 被手动展开的连续工具调用段（键是段首工具的 id）。 */
  @State expandedRuns: string[] = [];
  private windowChromeDark: boolean = false;
  private chromeApplied: boolean = false;

  aboutToAppear(): void {
    this.runtime.onUiUpdate = () => {
      this.syncFromRuntime();
    };
    // 把隐藏 Web 里的 WebRTC 桥交给运行时：连接时若它已就绪就走 LAN 直连，否则走中继
    this.runtime.attachRtcBridge(this.rtc);
    this.watchFoldStatus();
    // 键盘避让用 resize：pan 会把整个页面往上推，顶栏整条被顶出屏幕
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    this.runtime.bootstrap(getContext(this));
  }

  aboutToDisappear(): void {
    if (this.mainWindow !== undefined) {
      this.mainWindow.off('avoidAreaChange');
      this.mainWindow.off('windowSizeChange');
    }
  }

  /**
   * 折叠屏适配：监听折叠状态。
   * 折叠屏展开/折叠时窗口尺寸本来就会变化，断点会跟着更新；这里额外订阅状态，
   * 一是为了在状态切换的瞬间就把断点刷新，二是留一个展开态标记给后续布局用。
   */
  private watchFoldStatus(): void {
    try {
      this.foldState = foldStateOf(display.getFoldStatus());
      display.on('foldStatusChange', (status: display.FoldStatus) => {
        this.foldState = foldStateOf(status);
        this.breakpoint = breakpointOf(this.windowWidthVp);
      });
      // 主屏/副屏/协同显示切换会换一套窗口尺寸，断点也要重算
      display.on('foldDisplayModeChange', (mode: display.FoldDisplayMode) => {
        this.breakpoint = breakpointOf(this.windowWidthVp);
      });
    } catch (error) {
      // 非折叠设备没有该能力，按完全展开处理
      this.foldState = 'expanded';
    }
  }

  /**
   * 系统返回（左右边缘内滑 / 返回键）。
   * 顺序：先关浮层 → 会话页回到主机列表（连接保留）→ 连接中取消 → 其余交给系统。
   * 返回 true 表示已处理，不会退出应用。
   */
  onBackPress(): boolean {
    if (this.deviceMenuId.length > 0) {
      this.deviceMenuId = '';
      return true;
    }
    if (this.botDetail !== undefined) {
      this.botDetail = undefined;
      return true;
    }
    if (this.terminalOpen) {
      this.closeTerminalPage();
      return true;
    }
    if (this.dshWebOpen) {
      this.dshWebOpen = false;
      return true;
    }
    if (this.deviceDetailId.length > 0) {
      this.deviceDetailId = '';
      return true;
    }
    if (this.previewActive) {
      this.previewActive = false;
      return true;
    }
    if (this.messageActionsOpen) {
      this.messageActionsOpen = false;
      return true;
    }
    if (this.promptPanelOpen) {
      this.promptPanelOpen = false;
      return true;
    }
    if (this.trajectoryOpen) {
      this.trajectoryOpen = false;
      return true;
    }
    if (this.filePreviewOpen) {
      this.closeFilePreview();
      return true;
    }
    if (this.writingMenuOpen) {
      this.writingMenuOpen = false;
      return true;
    }
    if (this.sendModeOpen) {
      this.sendModeOpen = false;
      return true;
    }
    if (this.schedulesOpen) {
      this.schedulesOpen = false;
      return true;
    }
    if (this.linkDetailOpen) {
      this.linkDetailOpen = false;
      return true;
    }
    if (this.pluginForm !== undefined) {
      this.pluginForm = undefined;
      return true;
    }
    if (this.pluginsOpen) {
      this.backFromPlugins();
      return true;
    }
    if (this.appearanceOpen && !this.choiceOpen) {
      this.appearanceOpen = false;
      return true;
    }
    if (this.aboutOpen) {
      this.aboutOpen = false;
      return true;
    }
    if (this.diagnosticsOpen) {
      this.diagnosticsOpen = false;
      return true;
    }
    if (this.attachmentMenuOpen) {
      this.attachmentMenuOpen = false;
      return true;
    }
    if (this.composerExpanded) {
      this.composerExpanded = false;
      return true;
    }
    if (this.workspaceCreateOpen) {
      this.workspaceCreateOpen = false;
      return true;
    }
    if (this.choiceOpen) {
      this.choiceOpen = false;
      return true;
    }
    if (this.workspaceOptionsOpen) {
      this.workspaceOptionsOpen = false;
      return true;
    }
    if (this.hostSwitcherOpen) {
      this.hostSwitcherOpen = false;
      return true;
    }
    if (this.loginServerEditor) {
      this.loginServerEditor = false;
      return true;
    }
    if (this.permissionPickerOpen) {
      this.permissionPickerOpen = false;
      return true;
    }
    if (this.showModelPicker) {
      if (this.pendingModel !== undefined) {
        this.pendingModel = undefined;
      } else {
        this.closeModelPicker();
      }
      return true;
    }
    if (this.showBrowser) {
      this.backFromFiles();
      return true;
    }
    if (this.showMoreMenu
      || this.showSessionPanel || this.showBrowser || this.showSettings) {
      this.showMoreMenu = false;
      this.showModelPicker = false;
      this.showSessionPanel = false;
      this.showBrowser = false;
      this.showSettings = false;
      return true;
    }
    if (this.phase === PHASE_DEVICES && this.hostsManagementOpen) {
      this.leaveHostManagement();
      return true;
    }
    if (this.showSessions) {
      this.closeDrawer();
      return true;
    }
    if (this.phase === PHASE_CHAT && !this.isLandscape) {
      this.openDrawer();
      return true;
    }
    if (this.phase === PHASE_CONNECTING) {
      this.runtime.cancelConnect();
      return true;
    }
    return false;
  }

  onPageShow(): void {
    // 回前台：补查网络状态并做一次链路体检（后台待久了 socket 往往是半开的）。
    // 原来这里只把 appBackground 置回 false，连接死没死全靠用户发消息才知道。
    this.runtime.onAppForeground();
    this.runtime.appBackground = false;
  }

  onPageHide(): void {
    this.runtime.appBackground = true;
  }

  private measureInsets(): void {
    window.getLastWindow(getContext(this)).then((win: window.Window) => {
      this.mainWindow = win;
      // 2in1/PC：设个最小窗口尺寸（官方建议自由窗口应用给出可用下限，别让人拖成一条缝）
      win.setWindowLimits({ minWidth: 480, minHeight: 520 }).catch(() => undefined);
      // 沉浸式布局：页面铺到状态栏/导航条下面，避让交给 applyInsets 的 padding。
      // 不开这个，expandSafeArea 不会真的延伸到系统栏区域，底部就会多出一条导航条留白。
      win.setWindowLayoutFullScreen(true).catch(() => {
      });
      this.applyInsets(win);
      win.on('avoidAreaChange', () => {
        this.applyInsets(win);
      });
      win.on('windowSizeChange', (size: window.Size) => {
        this.applyWindowSize(size);
      });
      win.on('keyboardHeightChange', (height: number) => {
        const shown: boolean = height > 0;
        if (shown === this.keyboardVisible) {
          return;
        }
        this.keyboardVisible = shown;
        // 键盘把可视区压矮后，列表要跟着滚到底，内容整体上移，而不是被输入坞压住
        if (this.stickToBottom) {
          setTimeout(() => {
            this.scrollChatToBottom();
          }, 80);
        }
      });
    }).catch(() => {
      this.topInset = 0;
      this.bottomInset = 0;
    });
  }

  private applyInsets(win: window.Window): void {
    const ui: UIContext = this.getUIContext();
    // 2in1 全屏时系统状态栏高度是 0，但窗口自己那条标题栏还在，内容会顶到它下面被挡住，
    // 所以取「系统栏高度」和「窗口装饰高度」里大的那个当顶部安全区。
    let decorPx: number = 0;
    try {
      decorPx = win.getWindowDecorHeight();
    } catch (error) {
      decorPx = 0;
    }
    const systemTopPx: number = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height;
    const topPx: number = Math.max(systemTopPx, decorPx > 0 ? decorPx + 24 : 0);
    const bottomPx: number = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR).bottomRect.height;
    this.topInset = ui.px2vp(topPx);
    this.bottomInset = ui.px2vp(bottomPx);
    const rect: window.Rect = win.getWindowProperties().windowRect;
    this.isLandscape = rect.width > rect.height;
    this.windowWidthVp = ui.px2vp(rect.width);
    this.windowHeightVp = ui.px2vp(rect.height);
    this.breakpoint = breakpointOf(this.windowWidthVp);
  }

  private applyWindowSize(size: window.Size): void {
    const ui: UIContext = this.getUIContext();
    this.windowWidthVp = ui.px2vp(size.width);
    this.windowHeightVp = ui.px2vp(size.height);
    this.isLandscape = size.width > size.height;
    this.breakpoint = breakpointOf(this.windowWidthVp);
  }

  /** Build identity shown in the UI, so an installed APK can be matched to a source revision. */
  private buildTag(): string {
    return `v${BuildProfile.VERSION_NAME} (${BuildProfile.VERSION_CODE}) · ${BuildProfile.BUILD_MODE_NAME}`;
  }

  /** Copy the authorization link, so a long URL never has to be read off the screen. */
  private copyAuthorizeLink(): void {
    const url: string = this.qrUrl;
    if (url.length === 0) {
      return;
    }
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, url);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      promptAction.showToast({ message: this.tr('授权链接已复制') });
    }).catch(() => {
      promptAction.showToast({ message: this.tr('复制失败，可长按链接手动复制') });
    });
  }

  /** Open the authorization link in the system browser (the page that is already signed in). */
  private openAuthorizeLink(): void {
    const url: string = this.qrUrl;
    if (url.length === 0) {
      return;
    }
    this.openBrowserLink(url);
  }

  private openBrowserLink(url: string): void {
    if (!/^https?:\/\//i.test(url)) {
      return;
    }
    const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    context.openLink(url).catch(() => {
      const want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: url
      };
      context.startAbility(want).catch(() => {
        promptAction.showToast({ message: this.tr('无法打开链接') });
      });
    });
  }

  private syncFromRuntime(): void {
    const previousPhase: string = this.phase;
    const wasReconnecting: boolean = this.reconnecting;
    this.phase = this.runtime.phase;
    if (this.phase !== previousPhase) {
      if (this.phase === PHASE_SETUP) {
        this.passwordChallenge = '';
        this.passwordInput = '';
        this.emailInput = '';
        this.hostSwitcherOpen = false;
        this.hostsManagementOpen = false;
        this.showSessions = false;
      } else if (this.phase === PHASE_DEVICES && !this.hostsManagementOpen) {
        this.hostSwitcherOpen = true;
      } else if (this.phase === PHASE_CONNECTING) {
        this.hostSwitcherOpen = false;
        this.showSessions = false;
      } else if (this.phase === PHASE_CHAT) {
        this.hostSwitcherOpen = false;
        this.hostsManagementOpen = false;
        if (previousPhase === PHASE_CONNECTING && !wasReconnecting) {
          if (this.drawerCloseTimer >= 0) {
            clearTimeout(this.drawerCloseTimer);
            this.drawerCloseTimer = -1;
          }
          this.showSessions = true;
          this.drawerOpen = 1;
        }
      }
    }
    this.busy = this.runtime.busy;
    this.busyAction = this.runtime.busyAction;
    this.errorMsg = this.runtime.errorMsg;
    this.devices = this.runtime.devices.slice();
    this.autoConnectLastHost = this.runtime.autoConnectLastHost;
    this.sessions = this.runtime.sessions.slice();
    this.sessionsLoadFailed = this.runtime.sessionsLoadFailed;
    this.archivedIds = this.runtime.archivedSessionIds.slice();
    this.pinnedIds = this.runtime.pinnedSessionIds.slice();
    this.historyHasMore = this.runtime.historyHasMore;
    this.loadingOlderHistory = this.runtime.loadingOlderHistory;
    if (this.runtimeMessages !== this.runtime.messages) {
      this.runtimeMessages = this.runtime.messages;
      this.messages = this.runtime.messages.slice();
    }
    this.generating = this.runtime.generating;
    this.currentSessionId = this.runtime.currentSessionId;
    this.currentSessionTitle = this.runtime.currentSessionTitle;
    this.infoMsg = '';
    this.contextPercent = this.runtime.contextPercent;
    this.connectedTransport = this.runtime.transportLabel;
    this.connectStage = this.runtime.connectStage;
    this.connectStageIndex = this.runtime.connectStageIndex;
    // 重连文案原来只用于给状态点染色，用户看不到「几秒后重连第几次」。
    this.reconnectNotice = this.runtime.reconnectStatus;
    this.reconnecting = this.runtime.reconnecting;
    if (this.terminalOpen && (this.reconnecting || this.phase !== PHASE_CHAT
      || this.currentSessionId !== this.terminalSessionId)) {
      this.closeTerminalPage();
    }
    this.networkOnline = this.runtime.networkOnline;
    if (this.phase === PHASE_CONNECTING) {
      if (this.connectStartAt === 0) {
        this.connectStartAt = Date.now();
        this.connectElapsedSec = 0;
        this.connectTickTimer = setInterval(() => {
          this.connectElapsedSec = Math.max(0, Math.round((Date.now() - this.connectStartAt) / 1000));
        }, 1000);
      }
    } else if (this.connectStartAt !== 0) {
      this.connectStartAt = 0;
      if (this.connectTickTimer >= 0) {
        clearInterval(this.connectTickTimer);
        this.connectTickTimer = -1;
      }
    }
    this.slashCommands = this.runtime.slashCommands;
    this.modelOptions = this.runtime.modelOptions;
    this.currentModelLabel = this.runtime.currentModelLabel;
    this.currentModelProvider = this.runtime.currentModelProvider;
    this.currentModelEffort = this.runtime.currentModelEffort;
    this.textScaleMode = this.runtime.textScaleMode;
    this.textScaleValue = this.runtime.textScale();
    this.permissionPreset = this.runtime.permissionPreset;
    this.permissionOptionsList = this.runtime.permissionOptions.slice();
    this.workspaces = this.runtime.workspaces;
    this.selectedWorkspaceId = this.runtime.selectedWorkspaceId;
    this.sessionGroupBy = this.runtime.sessionGroupBy;
    this.sessionOrderBy = this.runtime.sessionOrderBy;
    this.sessionFilterMode = this.runtime.sessionFilterMode;
    this.filePreviewPath = this.runtime.filePreviewPath;
    this.filePreviewLoading = this.runtime.filePreviewLoading;
    this.filePreviewError = this.runtime.filePreviewError;
    this.filePreviewPage = this.runtime.filePreviewPage;
    this.browsePath = this.runtime.browsePath;
    this.browseLoading = this.runtime.browseLoading;
    this.browseError = this.runtime.browseError;
    this.directoryEntries = this.runtime.directoryEntries;
    this.workspaceGitStatus = this.runtime.workspaceGitStatus;
    this.workspaceGitScope = this.runtime.workspaceGitScope;
    this.workspaceGitLoading = this.runtime.workspaceGitLoading;
    this.workspaceGitError = this.runtime.workspaceGitError;
    this.workspaceGitDiffPath = this.runtime.workspaceGitDiffPath;
    this.workspaceGitDiff = this.runtime.workspaceGitDiff;
    this.workspaceGitDiffLoading = this.runtime.workspaceGitDiffLoading;
    if (this.sessionSearchActive) {
      const found: HarnessRemoteSession[] | undefined = this.runtime.searchResults;
      this.sessionSearchResults = found !== undefined ? found : [];
    }
    // 切了会话：先把上一段草稿存回去，再把新会话的草稿捞出来
    if (this.lastSyncedSessionId !== this.currentSessionId) {
      if (this.lastSyncedSessionId.length > 0) {
        this.runtime.saveDraft(this.lastSyncedSessionId, this.promptInput);
        this.stickBySession[this.lastSyncedSessionId] = this.stickToBottom;
      }
      this.lastSyncedSessionId = this.currentSessionId;
      this.promptInput = this.runtime.draftOf(this.currentSessionId);
      const restored: boolean | undefined = this.stickBySession[this.currentSessionId];
      this.stickToBottom = restored === undefined ? true : restored;
      if (!this.stickToBottom) {
        const anchorId: string | undefined = this.scrollAnchors[this.currentSessionId];
        if (anchorId !== undefined) {
          // 消息还没渲染完，稍等一下再定位，必要时补一次
          setTimeout(() => {
            this.scrollToMessage(anchorId);
          }, 260);
          setTimeout(() => {
            if (!this.stickToBottom) {
              this.scrollToMessage(anchorId);
            }
          }, 700);
        }
      }
    }
    this.connectedHostName = this.runtime.connectedHostName;
    if (this.reconnecting || this.connectedDeviceId !== this.runtime.connectedDeviceId) {
      this.dshWebOpen = false;
      this.botDetail = undefined;
      this.botCatalog = [];
      this.botCatalogLoading = false;
      this.botCatalogRequest += 1;
      if (this.botTabOpen) {
        this.botCatalogError = this.tr('连接主机后可查看 DS-Bot。');
      }
      if (this.pluginsOpen && this.connectedDeviceId !== this.runtime.connectedDeviceId) {
        this.pluginsOpen = false;
        this.pluginForm = undefined;
        this.pluginRequest += 1;
        this.pluginBundles = [];
        this.pluginSelected = '';
      }
    }
    this.connectedDeviceId = this.runtime.connectedDeviceId;
    this.deviceAliases = this.runtime.deviceAliases;
    this.accountEmail = this.runtime.email;
    this.accountServer = this.runtime.serverUrl;
    this.themeMode = this.runtime.themeMode;
    this.languageMode = this.runtime.languageMode;
    this.isDarkUi = this.runtime.isDark();
    this.isLandscape = this.runtime.systemLandscape;
    this.syncWindowChrome();
    this.qrUrl = this.runtime.qrUrl;
    this.providers = this.runtime.providers.slice().sort((left: OAuthProvider, right: OAuthProvider) =>
      this.providerOrder(left.id) - this.providerOrder(right.id));
    if (!this.fieldsPrefilled) {
      // Prefill the official public Server so a fresh install never dials an empty or dead address.
      this.serverInput = this.runtime.serverUrl.length > 0 ? this.runtime.serverUrl : DEFAULT_SERVER_URL;
      this.emailInput = this.runtime.email;
      this.fieldsPrefilled = true;
    }
    if (this.phase === PHASE_SETUP && !this.providersRequested) {
      this.providersRequested = true;
      this.runtime.loadProviders(this.serverInput);
    }
    if (this.phase === PHASE_CHAT) {
      // 切换/首次进入会话时强制贴底一次：否则 stickToBottom 在首帧测量里可能被判成 false，
      // 列表会停在历史中间，看不到最新消息。
      if (this.currentSessionId !== this.lastScrolledSessionId) {
        this.lastScrolledSessionId = this.currentSessionId;
        this.stickToBottom = true;
        setTimeout(() => {
          this.scrollChatToBottom();
          setTimeout(() => {
            this.scrollChatToBottom();
          }, 300);
        }, 120);
      } else {
        setTimeout(() => {
          this.scrollChatToBottom();
        }, 100);
      }
    }
  }

  private scrollChatToBottom(): void {
    if (this.messages.length === 0 || !this.stickToBottom) {
      return;
    }
    // scrollEdge 比 scrollToIndex 稳：列表项高度不定时 scrollToIndex 偶尔不动
    try {
      this.scroller.scrollEdge(Edge.Bottom);
    } catch (error) {
      this.scroller.scrollToIndex(this.messages.length - 1, false);
    }
  }

  /** 优先走系统分享面板；不可用就复制到剪贴板。 */
  private shareText(text: string): void {
    if (text.trim().length === 0) {
      return;
    }
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const data = new systemShare.SharedData({
        utd: utd.UniformDataType.PLAIN_TEXT,
        content: text
      });
      const controller = new systemShare.ShareController(data);
      controller.show(context, {
        previewMode: systemShare.SharePreviewMode.DETAIL,
        selectionMode: systemShare.SelectionMode.SINGLE
      }).catch(() => {
        this.copyToClipboard(text);
      });
      return;
    } catch (error) {
      this.copyToClipboard(text);
    }
  }

  private copyToClipboard(text: string): void {
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      promptAction.showToast({ message: this.tr('分享内容已复制') });
    }).catch(() => undefined);
  }

  private sendTap(): void {
    if (this.phase !== PHASE_CHAT || this.reconnecting) {
      promptAction.showToast({ message: this.tr('正在重连，连上后再发') });
      return;
    }
    const text: string = this.promptInput;
    const picked: PickedImage[] = this.pendingImages;
    if (text.trim().length === 0 && picked.length === 0) {
      return;
    }
    this.promptInput = '';
    this.pendingImages = [];
    const parts: PromptImagePart[] = [];
    for (const image of picked) {
      const part: PromptImagePart = new PromptImagePart();
      part.mediaType = image.mediaType;
      part.base64 = image.base64;
      part.name = image.name;
      parts.push(part);
    }
    // 发出去就把草稿清掉：onChange 不会因为代码里清空而触发，不清的话切回来还是这段文字
    this.runtime.saveDraft(this.currentSessionId, '');
    this.runtime.sendPrompt(text, parts);
    // 发送后输入框会从多行缩回单行、坞跟着变矮。必须等这一帧布局落定再滚，
    // 否则滚动是按旧高度算的，收回去之后新消息就矮到坞后面去了。
    this.stickToBottom = true;
    setTimeout(() => {
      this.scrollChatToBottom();
    }, 80);
    setTimeout(() => {
      if (this.stickToBottom) {
        this.scrollChatToBottom();
      }
    }, 240);
  }

  /** 从剪贴板取图：有图片就压一下挂到待发送区，没有就什么也不做。 */
  private pasteImageFromClipboard(): void {
    try {
      const board: pasteboard.SystemPasteboard = pasteboard.getSystemPasteboard();
      board.getData().then((data: pasteboard.PasteData) => {
        if (!data.hasType(pasteboard.MIMETYPE_PIXELMAP)) {
          return;
        }
        const pixel: image.PixelMap = data.getPrimaryPixelMap();
        compressPixelMap(pixel).then((picked: PickedImage) => {
          this.pendingImages = this.pendingImages.concat([picked]);
          promptAction.showToast({ message: this.tr('已粘贴图片') });
        }).catch(() => undefined);
      }).catch(() => undefined);
    } catch (error) {
      // 剪贴板不可用就算了，不打断输入
    }
  }

  /** 从系统相册选图；选完先压再进待发队列。 */
  private attachImage(): Promise<void> {
    if (this.pickingImages) {
      return Promise.resolve();
    }
    this.pickingImages = true;
    const pick = pickImages(4);
    return pick.then((picked: PickedImage[]) => {
      this.pickingImages = false;
      if (picked.length === 0) {
        return;
      }
      // 预检：单张 base64 超过 3.5MB 就会顶到协议单条上限，直接挡下来并说明原因
      const limit: number = 3500000;
      const accepted: PickedImage[] = [];
      let rejected: number = 0;
      for (const image of picked) {
        if (image.base64.length > limit) {
          rejected++;
        } else {
          accepted.push(image);
        }
      }
      if (rejected > 0) {
        promptAction.showToast({
          message: this.tr('有 ') + rejected + this.tr(' 张图片过大已跳过（单张上限约 3.5MB）')
        });
      }
      if (accepted.length > 0) {
        this.pendingImages = this.pendingImages.concat(accepted);
      }
    }).catch((error: Error) => {
      this.pickingImages = false;
      this.errorMsg = this.tr('图片读取失败：') + error.message;
    });
  }

  private removePendingImage(index: number): void {
    const next: PickedImage[] = this.pendingImages.slice();
    next.splice(index, 1);
    this.pendingImages = next;
  }

  /** Display name of a host device: user alias wins over the server-registered name. */
  private displayNameFor(device: RemoteHostDevice): string {
    const alias: string | undefined = this.deviceAliases[device.deviceId];
    if (alias !== undefined && alias.length > 0) {
      return alias;
    }
    return device.name;
  }

  /** Display name of the connected host shown in the chat header. */
  private connectedHostDisplay(): string {
    const id: string = this.connectedDeviceId;
    if (id.length > 0) {
      const alias: string | undefined = this.deviceAliases[id];
      if (alias !== undefined && alias.length > 0) {
        return alias;
      }
    }
    return this.connectedHostName;
  }

  /** 权限预设的中文短标签。 */
  /** 底栏账号文案：邮箱只留 @ 前面且截到 18 字符，避免长数字串撑满一行。 */
  /** 设备卡的 ⋯ 菜单：改名、清除公钥固定（都收进来，省出名字的宽度）。 */
  private openDeviceMenu(device: RemoteHostDevice): void {
    const sheets: SheetInfo[] = [
      {
        title: this.tr('改名'),
        action: () => {
          this.beginRename(device);
        }
      }
    ];
    if (this.runtime.hasHostPin(device.deviceId)) {
      sheets.push({
        title: this.tr('清除公钥固定'),
        action: () => {
          AlertDialog.show({
            title: this.tr('该主机已固定公钥'),
            message: this.tr('主机重置或更换后，本地固定的公钥会对不上，导致无法连接。\n'
              + '清除后下次连接将重新信任首次看到的公钥。'),
            primaryButton: {
              value: this.tr('取消'),
              action: () => {
              }
            },
            secondaryButton: {
              value: this.tr('清除固定记录'),
              fontColor: this.pal().danger,
              action: () => {
                this.runtime.forgetHostPin(device.deviceId);
                this.errorMsg = '';
                this.infoMsg = this.tr('已清除该主机的公钥固定记录');
              }
            }
          });
        }
      });
    }
    ActionSheet.show({
      title: device.name.length > 0 ? device.name : device.deviceId,
      message: this.tr('主机操作'),
      sheets: sheets
    });
  }

  /** 会话名是否长到需要跑马灯（> 12 个字符才滚，短名字保持自然宽度）。 */
  private titleNeedsMarquee(): boolean {
    return this.currentSessionTitle.length > 12;
  }

  /** 跨天时插一条日期分隔；同一天不打断。 */
  private shouldShowDayDivider(index: number): boolean {
    const rows: ChatItem[] = this.chatRows();
    if (index <= 0 || index >= rows.length) {
      return false;
    }
    const current: number = rows[index].timestamp;
    const previous: number = rows[index - 1].timestamp;
    if (current <= 0) {
      return false;
    }
    if (previous <= 0) {
      return index === 0;
    }
    return !sameDay(current, previous);
  }

  /** 这条回复是否需要折叠：非流式、没被展开过、且超过 24 行。 */
  private isLongCollapsed(item: ChatItem): boolean {
    if (item.streaming || this.expandedMessages.includes(item.id)) {
      return false;
    }
    return this.textLineCount(item.text) > 24;
  }

  /** 文本行数（粗算，用于判断要不要折叠）。 */
  private textLineCount(text: string): number {
    return text.split('\n').length;
  }

  /** 折叠到前 18 行，行尾加省略提示。 */
  /** 气泡里实际显示的文本：开了打码且没点「看原文」就把 Key/Token 遮掉。 */
  private bubbleText(item: ChatItem): string {
    if (!this.runtime.secretMask || this.revealedSecrets.indexOf(item.id) >= 0) {
      return item.text;
    }
    return maskSecrets(item.text);
  }

  /** 这条气泡是否「被遮挡过，可以展开看原文」。 */
  private showsMaskedHint(item: ChatItem): boolean {
    if (!this.runtime.secretMask || this.revealedSecrets.indexOf(item.id) >= 0) {
      return false;
    }
    return maskSecrets(item.text) !== item.text;
  }

  private collapseText(text: string): string {
    const lines: string[] = text.split('\n');
    if (lines.length <= 18) {
      return text;
    }
    return lines.slice(0, 18).join('\n') + '\n\n…';
  }

  private deviceDetail(): RemoteHostDevice | undefined {
    for (const device of this.devices) {
      if (device.deviceId === this.deviceDetailId) {
        return device;
      }
    }
    return undefined;
  }

  private deviceDetailName(): string {
    const device: RemoteHostDevice | undefined = this.deviceDetail();
    return device === undefined ? '' : device.name;
  }

  private deviceDetailOnline(): boolean {
    const device: RemoteHostDevice | undefined = this.deviceDetail();
    return device === undefined ? false : device.online;
  }

  private deviceDetailOnlineLabel(): string {
    const device: RemoteHostDevice | undefined = this.deviceDetail();
    return device === undefined ? '' : this.hostSeenLabel(device);
  }

  private deviceDetailField(key: string): string {
    const device: RemoteHostDevice | undefined = this.deviceDetail();
    if (device === undefined) {
      return '';
    }
    if (key === 'platform') {
      return device.platform;
    }
    if (key === 'harnessVersion') {
      return device.harnessVersion;
    }
    return device.clientVersion;
  }

  private deviceDetailLastSeen(): string {
    const device: RemoteHostDevice | undefined = this.deviceDetail();
    if (device === undefined || device.lastSeenAt <= 0) {
      return '';
    }
    const date: Date = new Date(device.lastSeenAt);
    const pad = (n: number): string => n < 10 ? '0' + n : '' + n;
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  private deviceDetailFingerprint(): string {
    const device: RemoteHostDevice | undefined = this.deviceDetail();
    if (device === undefined || device.identityKey.length === 0) {
      return '';
    }
    const key: string = device.identityKey;
    return key.length > 24 ? key.substring(0, 12) + '…' + key.substring(key.length - 8) : key;
  }

  private copyDeviceDetail(): void {
    const device: RemoteHostDevice | undefined = this.deviceDetail();
    if (device === undefined) {
      return;
    }
    const lines: string[] = [
      'name: ' + device.name,
      'deviceId: ' + device.deviceId,
      'platform: ' + device.platform,
      'harness: ' + device.harnessVersion,
      'client: ' + device.clientVersion,
      'online: ' + (device.online ? 'yes' : 'no'),
      'lastSeen: ' + this.deviceDetailLastSeen(),
      'identityKey: ' + device.identityKey
    ];
    if (device.deviceId === this.connectedDeviceId && this.connectedTransport === 'relay') {
      lines.push(...this.runtime.relayDetailLines());
    }
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, lines.join('\n'));
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      promptAction.showToast({ message: this.tr('已复制主机信息') });
    }).catch(() => undefined);
  }

  /** 会话列表实际展示的条目：搜索优先，其次「只看收藏」。 */
  private isArchivedSession(sessionId: string): boolean {
    return this.archivedIds.includes(sessionId);
  }

  private isPinnedSession(sessionId: string): boolean {
    return this.pinnedIds.includes(sessionId);
  }

  private visibleSessions(): HarnessRemoteSession[] {
    const base: HarnessRemoteSession[] = this.sessionSearchActive
      ? this.sessionSearchResults : this.sessions;
    const query: string = this.sessionSearchActive ? this.sessionSearchInput.trim() : '';
    const list: HarnessRemoteSession[] = [];
    for (const session of base) {
      // 空白占位只保留当前打开的那个；subagent 会话不进平铺列表（对齐 Desktop/Android）。
      if (!isVisibleSession(session.sessionId, session.blank, session.origin, this.currentSessionId, query)) {
        continue;
      }
      if (this.workspaceFilter.length > 0 && session.cwd !== this.workspaceFilter) {
        continue;
      }
      const archived: boolean = this.isArchivedSession(session.sessionId);
      if (this.sessionFilterMode === 'hideArchived' && archived) {
        continue;
      }
      if (this.sessionFilterMode === 'archivedOnly' && !archived) {
        continue;
      }
      list.push(session);
    }
    // Android 端先按置顶分区，再按最近更新时间排序；手动排序保留 Host 返回顺序。
    return list.sort((a: HarnessRemoteSession, b: HarnessRemoteSession) => {
      const aPin: number = this.runtime.isPinnedSession(a.sessionId) ? 1 : 0;
      const bPin: number = this.runtime.isPinnedSession(b.sessionId) ? 1 : 0;
      if (aPin !== bPin) {
        return bPin - aPin;
      }
      if (this.sessionOrderBy === 'updated') {
        return b.updatedAt - a.updatedAt;
      }
      return 0;
    });
  }

  private workspaceGroupKey(session: HarnessRemoteSession): string {
    for (const workspace of this.workspaces) {
      if (workspace.sessionIds.includes(session.sessionId)) {
        return 'workspace:' + workspace.workspaceId;
      }
    }
    return 'default';
  }

  private workspaceGroupTitle(key: string): string {
    if (key === 'recent') {
      return this.tr('最近访问');
    }
    for (const workspace of this.workspaces) {
      if ('workspace:' + workspace.workspaceId === key) {
        return workspace.title || cwdTail(workspace.path) || this.tr('默认');
      }
    }
    return this.tr('默认');
  }

  private workspaceParentIds(): Map<string, string | undefined> {
    const byPath: Map<string, string> = new Map<string, string>();
    for (const workspace of this.workspaces) {
      if (workspace.path.length > 0) {
        byPath.set(workspace.path.replace(/\\/g, '/').replace(/\/+$/, ''), workspace.workspaceId);
      }
    }
    const parents: Map<string, string | undefined> = new Map<string, string | undefined>();
    for (const workspace of this.workspaces) {
      const childPath: string = workspace.path.replace(/\\/g, '/').replace(/\/+$/, '');
      let parentId: string | undefined = undefined;
      let parentLength: number = -1;
      if (childPath.length > 0) {
        byPath.forEach((candidateId: string, candidatePath: string) => {
          if (candidatePath.length > parentLength && candidatePath !== childPath
            && childPath.startsWith(candidatePath + '/')) {
            parentId = candidateId;
            parentLength = candidatePath.length;
          }
        });
      }
      parents.set(workspace.workspaceId, parentId);
    }
    return parents;
  }

  private workspaceTreeSessions(sessions: HarnessRemoteSession[]): SessionFolder[] {
    const parents: Map<string, string | undefined> = this.workspaceParentIds();
    const children: Map<string, HarnessWorkspace[]> = new Map<string, HarnessWorkspace[]>();
    const assigned: Set<string> = new Set<string>();
    for (const workspace of this.workspaces) {
      for (const sessionId of workspace.sessionIds) {
        assigned.add(sessionId);
      }
      const parentId: string | undefined = parents.get(workspace.workspaceId);
      const list: HarnessWorkspace[] = children.get(parentId ?? '') ?? [];
      list.push(workspace);
      children.set(parentId ?? '', list);
    }
    const groups: SessionFolder[] = [];
    const append = (workspace: HarnessWorkspace, depth: number): void => {
      const entries: HarnessRemoteSession[] = sessions.filter((session: HarnessRemoteSession) =>
        workspace.sessionIds.includes(session.sessionId));
      groups.push(new SessionFolder('workspace:' + workspace.workspaceId,
        workspace.title || cwdTail(workspace.path) || this.tr('默认'), entries, depth));
      const nested: HarnessWorkspace[] = children.get(workspace.workspaceId) ?? [];
      for (const child of nested) {
        append(child, depth + 1);
      }
    };
    const roots: HarnessWorkspace[] = children.get('') ?? [];
    for (const root of roots) {
      append(root, 0);
    }
    const unassigned: HarnessRemoteSession[] = sessions.filter((session: HarnessRemoteSession) =>
      !assigned.has(session.sessionId));
    if (unassigned.length > 0) {
      groups.push(new SessionFolder('default', this.tr('默认'), unassigned));
    }
    return groups;
  }

  private groupedSessions(): SessionFolder[] {
    const sessions: HarnessRemoteSession[] = this.visibleSessions();
    if (this.sessionGroupBy === 'list') {
      return sessions.length > 0
        ? [new SessionFolder('all', this.tr('全部会话'), sessions)]
        : [];
    }
    const recent: HarnessRemoteSession[] = [];
    for (const session of sessions) {
      if (session.sessionId === this.currentSessionId || this.runtime.recentSessions.includes(session.sessionId)) {
        recent.push(session);
      }
    }
    if (this.sessionGroupBy === 'workspace-tree') {
      const groups: SessionFolder[] = this.workspaceTreeSessions(sessions);
      if (recent.length > 0) {
        groups.unshift(new SessionFolder('recent', this.workspaceGroupTitle('recent'), recent));
      }
      return groups;
    }
    const byWorkspace: Map<string, HarnessRemoteSession[]> = new Map<string, HarnessRemoteSession[]>();
    for (const session of sessions) {
      const key: string = this.workspaceGroupKey(session);
      const entries: HarnessRemoteSession[] = byWorkspace.get(key) ?? [];
      entries.push(session);
      byWorkspace.set(key, entries);
    }
    const groups: SessionFolder[] = [];
    if (recent.length > 0) {
      groups.push(new SessionFolder('recent', this.workspaceGroupTitle('recent'), recent));
    }
    byWorkspace.forEach((entries: HarnessRemoteSession[], key: string) => {
      groups.push(new SessionFolder(key, this.workspaceGroupTitle(key), entries));
    });
    return groups;
  }

  private sessionFolderExpanded(folder: SessionFolder): boolean {
    return !this.collapsedSessionGroups.includes(folder.key) &&
      (this.expandedSessionGroups.includes(folder.key) || folder.key === 'recent');
  }

  private toggleSessionFolder(folder: SessionFolder): void {
    if (this.sessionFolderExpanded(folder)) {
      this.expandedSessionGroups = this.expandedSessionGroups.filter((value: string) => value !== folder.key);
      this.collapsedSessionGroups = this.collapsedSessionGroups.concat([folder.key]);
    } else {
      this.collapsedSessionGroups = this.collapsedSessionGroups.filter((value: string) => value !== folder.key);
      this.expandedSessionGroups = this.expandedSessionGroups.concat([folder.key]);
    }
  }

  /** 文字大小：所有关键字号都过这个函数，改档位就是整体缩放。 */
  private fs(base: number): number {
    return Math.round(base * this.textScaleValue * 10) / 10;
  }

  /**
   * 一条消息要显示的图片：本地刚发的直接在 item.images 里；
   * 历史的只有 attachmentId，从运行时缓存里取（拉不到就是空，不占位）。
   */
  /** 心跳消息折成可读正文；不是心跳就是空串。 */
  private heartbeatBody(item: ChatItem): string {
    const role: string = item.kind === 'user' ? 'user' : 'assistant';
    return heartbeatBodyOf(item.text, role);
  }

  private heartbeatOpen(item: ChatItem): boolean {
    return this.heartbeatExpanded.includes(item.id);
  }

  private toggleHeartbeat(item: ChatItem): void {
    if (this.heartbeatOpen(item)) {
      this.heartbeatExpanded = this.heartbeatExpanded.filter((id: string) => id !== item.id);
      return;
    }
    this.heartbeatExpanded = this.heartbeatExpanded.concat([item.id]);
  }

  private messageImages(item: ChatItem): string[] {
    const out: string[] = [];
    for (const body of item.images) {
      if (body.length > 0) {
        out.push(body);
      }
    }
    for (const attachmentId of item.imageAttachmentIds) {
      const body: string = this.runtime.imageFor(attachmentId);
      if (body.length > 0) {
        if (!item.images.includes(body)) {
          out.push(body);
        }
      }
    }
    return out;
  }

  /** 会话区内容最大宽度：窗口越宽放越宽，不再固定 880。 */
  private chatMaxWidth(): number {
    const w: number = this.windowWidthVp;
    if (w <= 0) {
      return 880;
    }
    if (w >= 1600) {
      return 1180;
    }
    if (w >= 1200) {
      return 1020;
    }
    return 880;
  }

  /** 左侧会话栏宽度：宽窗口下按比例放宽，窄窗口保持 300。 */
  /** 竖屏抽屉宽度（屏宽 82%），跟手位移按它换算。 */
  /**
   * 三栏：会话 | 聊天 | 会话详情。给超宽窗口（2in1 全屏、三折叠三屏展开、大屏平板横放）用，
   * 阈值取 1180vp——再窄右栏会把消息区压到 600 以下。
   */
  private showThreePane(): boolean {
    return this.runtime.showInspector && this.windowWidthVp >= 1180
      && this.windowHeightVp >= 560 && this.phase === PHASE_CHAT;
  }

  /**
   * 是否走「会话 + 聊天」双栏。
   * 按断点（窗口宽度 ≥ 600vp）而不是横竖屏判断：平板竖屏、折叠屏展开、PC 窗口都该分栏，
   * 手机横屏（宽 800 但高 360）反而该保持单列。
   */
  private showTwoPane(): boolean {
    // 宽 ≥ 600vp（md 起）且高 ≥ 480vp：手机横屏（840×360）高度不够，仍走单列
    return this.windowWidthVp >= 600 && this.windowHeightVp >= 480
      && this.phase === PHASE_CHAT;
  }

  /**
   * 铰链留白：API 26 的 AvoidAreaType 里没有铰链类型，
   * 只能按「半折态 + 窗口高度」估一个合理间距（不同机型铰链宽度不一样，取 1.2%，夹在 8–24vp）。
   */
  private hingeGapVp(): number {
    const h: number = this.windowHeightVp > 0 ? this.windowHeightVp : 800;
    return Math.round(Math.min(24, Math.max(8, h * 0.012)));
  }

  /** 分栏里会话栏的宽度：用户拖过就用记住的值，否则按窗口比例（夹在 240–460）。 */
  private splitPaneWidth(): number {
    const saved: number = this.runtime.splitWidth;
    const w: number = this.windowWidthVp > 0 ? this.windowWidthVp : 900;
    if (saved > 0) {
      return saved;
    }
    return Math.round(Math.min(460, Math.max(240, w * 0.3)));
  }

  private drawerWidthVp(): number {
    const w: number = this.windowWidthVp > 0 ? this.windowWidthVp : 360;
    return w;
  }

  /** 松手后归位：过阈值就滑到底，否则弹回并卸载。 */
  private settleDrawer(open: boolean): void {
    if (this.drawerCloseTimer >= 0) {
      clearTimeout(this.drawerCloseTimer);
      this.drawerCloseTimer = -1;
    }
    this.getUIContext().animateTo({ duration: 220, curve: Curve.Friction }, () => {
      this.drawerOpen = open ? 1 : 0;
    });
    if (!open) {
      this.drawerCloseTimer = setTimeout(() => {
        this.showSessions = false;
        this.drawerCloseTimer = -1;
      }, 230);
    }
  }

  /** 点按钮/手势完成后展开抽屉。 */
  private openDrawer(): void {
    if (this.showSessions && this.drawerOpen >= 1) {
      return;
    }
    if (this.drawerCloseTimer >= 0) {
      clearTimeout(this.drawerCloseTimer);
      this.drawerCloseTimer = -1;
    }
    this.showSessions = true;
    this.drawerOpen = 0;
    this.getUIContext().animateTo({ duration: 240, curve: Curve.Friction }, () => {
      this.drawerOpen = 1;
    });
  }

  private closeDrawer(): void {
    this.settleDrawer(false);
  }

  /**
   * 顶部安全区：手机/平板有系统状态栏，直接用系统给的高度；
   * 只有 2in1 全屏这种读不到状态栏（=0）的情况才兜底，避免标题被窗口标题栏压住。
   */
  private topSafePadding(): number {
    if (this.topInset > 0) {
      return this.topInset;
    }
    return this.isWideLayout() ? 44 : 12;
  }

  /**
   * 底部安全区：手机只让出导航条，别留多余空白；2in1 全屏底部是系统 Dock，
   * 要多让一些，否则账号行会被 Dock 压掉。
   */
  private bottomSafePadding(): number {
    if (this.isWideLayout()) {
      return Math.max(this.bottomInset, 56);
    }
    // 手机上系统报的导航区高度常常是 50vp 往上（含手势区），按它留白会空一大条，
    // 这里只让出导航条本身的可视高度，多留 8vp 呼吸位。
    // 保留一点呼吸位：贴死到屏幕边缘反而显挤（82px 那版是用户认可的观感）
    return 8;
  }

  /** 设备页内容列宽：按断点给（手机满宽 / 平板 1040 / 2in1 1200），都居中。 */
  private deviceColumnWidth(): number {
    return contentColumnWidth(this.breakpoint, this.windowWidthVp);
  }

  /** 宽屏判断统一入口，避免页面里到处散落 width >= 900 之类的魔法数。 */
  /** 手机窄屏（xs/sm）：输入坞按紧凑口径排，别把输入框挤成一条缝。 */
  private compactDock(): boolean {
    return isCompactWidth(this.breakpoint);
  }

  private isWideLayout(): boolean {
    return isExpandedWidth(this.breakpoint);
  }

  /**
   * 会话行密度：设置里显式选了就听设置（0 自动 / 1 紧凑 / 2 超紧凑），
   * 「自动」时只在分栏下收紧，单列保持宽松版。
   */
  private compactRows(): boolean {
    if (this.runtime.layoutDensity === 1 || this.runtime.layoutDensity === 2) {
      return true;
    }
    return this.showTwoPane() || this.showThreePane();
  }

  /** 分栏里会话栏宽度：拖过分隔条就用记住的值，否则按窗口 20%（夹在 260–380）。 */
  private listPanelWidth(): number {
    const saved: number = this.runtime.splitWidth;
    if (saved > 0) {
      return saved;
    }
    const w: number = this.windowWidthVp;
    if (w <= 0) {
      return 300;
    }
    const computed: number = Math.round(w * 0.2);
    return Math.max(260, Math.min(380, computed));
  }

  /** 顶栏数据面徽标：LAN/P2P/TURN 是直连，Relay 是中继（中文界面显示「中继」）。 */
  private transportBadgeText(): string {
    if (this.connectedTransport === 'relay') {
      return this.en() ? 'Relay' : '中继';
    }
    if (this.connectedTransport === 'lan') {
      return 'LAN';
    }
    if (this.connectedTransport === 'p2p') {
      return 'P2P';
    }
    if (this.connectedTransport === 'turn') {
      return 'TURN';
    }
    return '';
  }

  private themeTintLabel(): string {
    const tint: number = this.runtime.themeTint;
    if (tint === 1) {
      return this.tr('深海');
    }
    if (tint === 2) {
      return this.tr('森林');
    }
    if (tint === 3) {
      return this.tr('暖沙');
    }
    if (tint === 4) {
      return this.tr('玫紫');
    }
    return this.tr('默认');
  }

  private transportBadgeColor(): string {
    return this.connectedTransport === 'relay' ? '#C88418' : '#1E9E6A';
  }

  private transportBadgeBg(): string {
    return this.connectedTransport === 'relay' ? 'rgba(240,160,32,0.14)' : 'rgba(52,211,153,0.16)';
  }

  private permissionLabel(): string {
    const preset: string = this.runtime.permissionPreset;
    if (preset === 'read-only') {
      return t('只读');
    }
    if (preset === 'workspace-write') {
      return t('可写');
    }
    if (preset === 'danger-full-access') {
      return t('完全');
    }
    return t('权限');
  }

  private currentSessionInfo(): HarnessRemoteSession | undefined {
    for (const session of this.sessions) {
      if (session.sessionId === this.currentSessionId) {
        return session;
      }
    }
    return undefined;
  }

  /** Short contextual facts about the open session, shown above the input bar. */

  private beginRename(device: RemoteHostDevice): void {
    this.renamingDeviceId = device.deviceId;
    this.renameInput = this.displayNameFor(device);
  }

  private confirmRename(): void {
    if (this.renamingDeviceId.length > 0) {
      this.runtime.setDeviceAlias(this.renamingDeviceId, this.renameInput);
    }
    this.renamingDeviceId = '';
    this.renameInput = '';
  }

  private cancelRename(): void {
    this.renamingDeviceId = '';
    this.renameInput = '';
  }

  private onlineDeviceCount(): number {
    let count: number = 0;
    for (const device of this.devices) {
      if (device.online) {
        count++;
      }
    }
    return count;
  }

  /** Active palette, re-evaluated whenever the theme or system mode flips. */
  private pal(): Palette {
    return applyTint(this.isDarkUi ? darkPalette() : lightPalette(), this.runtime.themeTint, this.isDarkUi);
  }

  /** 读一下 languageMode 再取文案：让 Text 节点依赖到状态，切语言时才会重算。 */
  private tr(key: string): string {
    const mode: number = this.languageMode;
    return t(key);
  }

  /** 同上，用于「按语言换单位」的拼接文案。 */
  private en(): boolean {
    const mode: number = this.languageMode;
    return english();
  }

  /** 会话列表分组：新会话不再一个个孤立，按 今天/昨天/更早 归堆。 */

  /** 标题旁的连接状态点：重连中黄、已断开红、其余绿。 */
  private connectionDotColor(): string {
    const status: string = this.runtime.reconnectStatus;
    if (status.length > 0) {
      return '#F5A623';
    }
    if (this.phase === PHASE_CONNECTING) {
      return '#F5A623';
    }
    if (!this.networkOnline) {
      return this.pal().danger;
    }
    return this.pal().success;
  }

  /** 设备页顶部横幅：优先显示重连进度，其次提示断网。空串表示不显示。 */
  private linkBannerText(): string {
    if (this.reconnectNotice.length > 0) {
      return this.reconnectNotice;
    }
    if (!this.networkOnline) {
      return this.tr('网络已断开，恢复后自动重连');
    }
    return '';
  }

  /** 设备页底部统计：英文环境换单位，避免模板里嵌死「台 / 在线」。 */
  private themeLabel(mode: number): string {
    if (mode === 1) {
      return this.tr('浅色');
    }
    if (mode === 2) {
      return this.tr('深色');
    }
    return this.tr('跟随系统');
  }

  private themeChoices(): ThemeChoice[] {
    return [
      new ThemeChoice(LANG_SYSTEM, '跟随系统', '跟着系统的深浅色走'),
      new ThemeChoice(1, '浅色', '始终使用浅色界面'),
      new ThemeChoice(2, '深色', '始终使用深色界面')
    ];
  }

  private textScaleChoices(): ThemeChoice[] {
    return [
      new ThemeChoice(0, '小', '0.9×'),
      new ThemeChoice(1, '标准', '1.0×'),
      new ThemeChoice(2, '大', '1.15×'),
      new ThemeChoice(3, '特大', '1.3×')
    ];
  }

  private languageChoices(): ThemeChoice[] {
    return [
      new ThemeChoice(LANG_SYSTEM, '跟随系统', '跟着系统语言走'),
      new ThemeChoice(LANG_ZH, '中文', '始终使用中文界面'),
      new ThemeChoice(LANG_EN, 'English', '始终使用英文界面')
    ];
  }

  /** 连续工具调用折叠：同段 ≥2 条收成一行「N 步」，点开再逐条看。 */
  private chatRows(): ChatItem[] {
    const source: ChatItem[] = this.messages;
    const key: string = `${this.languageMode}|${this.expandedRuns.join(',')}`;
    if (source === this.chatRowsSource && key === this.chatRowsKey) {
      return this.chatRowsCache;
    }
    const rows: ChatItem[] = [];
    let index: number = 0;
    while (index < source.length) {
      const item: ChatItem = source[index];
      if (item.kind !== 'tool') {
        rows.push(item);
        index += 1;
        continue;
      }
      let end: number = index;
      while (end < source.length && source[end].kind === 'tool') {
        end += 1;
      }
      const count: number = end - index;
      if (count < 2) {
        rows.push(item);
        index = end;
        continue;
      }
      const head: ChatItem = source[index];
      const expanded: boolean = this.isRunExpanded(head.id);
      rows.push(this.toolRunItem(source, index, end, expanded));
      if (expanded) {
        for (let cursor: number = index; cursor < end; cursor += 1) {
          rows.push(source[cursor]);
        }
      }
      index = end;
    }
    const merged: ChatItem[] = this.mergeAssistantRows(rows);
    this.chatRowsSource = source;
    this.chatRowsKey = key;
    this.chatRowsCache = merged;
    return merged;
  }

  /**
   * 连续多段助手文本合并成一个气泡：模型经常把一段话拆成多条消息发出，
   * 不合并的话屏幕上会堆一串宽度不一的小气泡，看着很碎。
   */
  private mergeAssistantRows(rows: ChatItem[]): ChatItem[] {
    const out: ChatItem[] = [];
    let buffer: ChatItem | undefined = undefined;
    for (const row of rows) {
      if (row.kind !== 'assistant') {
        if (buffer !== undefined) {
          out.push(buffer);
          buffer = undefined;
        }
        out.push(row);
        continue;
      }
      const current: ChatItem | undefined = buffer;
      if (current === undefined) {
        const merged: ChatItem = new ChatItem();
        merged.id = row.id;
        merged.kind = 'assistant';
        merged.role = row.role;
        merged.text = row.text;
        merged.reasoning = row.reasoning;
        merged.streaming = row.streaming;
        merged.sessionId = row.sessionId;
        merged.timestamp = row.timestamp;
        merged.totalTokens = row.totalTokens;
        merged.turnCompleted = row.turnCompleted;
        merged.seq = row.seq;
        merged.rev = row.rev;
        buffer = merged;
        continue;
      }
      if (row.text.length > 0) {
        current.text = current.text.length > 0 ? `${current.text}\n\n${row.text}` : row.text;
      }
      if (row.reasoning.length > 0) {
        current.reasoning = current.reasoning.length > 0
          ? `${current.reasoning}\n${row.reasoning}` : row.reasoning;
      }
      current.streaming = row.streaming;
      current.turnCompleted = current.turnCompleted || row.turnCompleted;
      if (row.totalTokens >= 0) {
        current.totalTokens = Math.max(0, current.totalTokens) + row.totalTokens;
      }
      current.rev += row.rev + 1;
    }
    if (buffer !== undefined) {
      out.push(buffer);
    }
    return out;
  }

  private toolRunItem(source: ChatItem[], start: number, end: number, expanded: boolean): ChatItem {
    const head: ChatItem = source[start];
    const row: ChatItem = new ChatItem();
    row.id = `run:${head.id}`;
    row.kind = 'toolrun';
    row.requestRpcId = head.id;
    row.sessionId = head.sessionId;
    row.timestamp = head.timestamp;
    row.rev = expanded ? 1 : 0;
    row.toolName = head.toolName;
    row.text = `${end - start}${t(' 步 · ')}${expanded ? t('收起') : t('展开')}`;
    row.summary = this.toolRunDetail(source, start, end);
    let running: boolean = false;
    let failed: boolean = false;
    for (let cursor: number = start; cursor < end; cursor += 1) {
      const state: string = source[cursor].toolState;
      if (state === 'running') {
        running = true;
      } else if (state === 'failed') {
        failed = true;
      }
    }
    row.toolState = running ? 'running' : (failed ? 'failed' : 'finished');
    return row;
  }

  private toolRunDetail(source: ChatItem[], start: number, end: number): string {
    const names: string[] = [];
    for (let cursor: number = start; cursor < end; cursor += 1) {
      const name: string = source[cursor].toolName;
      if (name.length > 0 && !names.includes(name)) {
        names.push(name);
      }
    }
    if (names.length === 0) {
      return '';
    }
    const shown: string[] = names.length > 3 ? names.slice(0, 3) : names;
    let detail: string = shown.join(' → ');
    if (names.length > 3) {
      detail = `${detail} → …`;
    }
    return detail;
  }

  private isRunExpanded(headId: string): boolean {
    return this.expandedRuns.includes(headId);
  }

  private toggleRun(headId: string): void {
    const next: string[] = [];
    let removed: boolean = false;
    for (const key of this.expandedRuns) {
      if (key === headId) {
        removed = true;
      } else {
        next.push(key);
      }
    }
    if (!removed) {
      next.push(headId);
    }
    this.expandedRuns = next;
  }

  private hostSubtitle(device: RemoteHostDevice, switching: boolean): string {
    const platform: string = device.platform.length > 0
      ? device.platform.charAt(0).toUpperCase() + device.platform.substring(1) : this.tr('远程主机');
    if (switching) {
      return this.tr('远程') + ' · ' + platform;
    }
    if (device.harnessVersion.length > 0) {
      return platform + ' · Harness ' + device.harnessVersion;
    }
    return device.online ? platform : platform + ' · ' + this.hostSeenLabel(device);
  }

  /** 设备卡第三行：在线状态用绿点表达，这里只补「最近活动」，避免「在线」重复两遍。 */
  private hostSeenLabel(device: RemoteHostDevice): string {
    if (device.online) {
      return this.tr('在线');
    }
    if (device.lastSeenAt <= 0) {
      return this.tr('离线');
    }
    const diff: number = Date.now() - device.lastSeenAt;
    if (diff < 60000) {
      return this.en() ? 'just offline' : '刚刚离线';
    }
    if (diff < 3600000) {
      const minutes: number = Math.round(diff / 60000);
      return this.en() ? `${minutes}m ago` : `${minutes} 分钟前`;
    }
    if (diff < 86400000) {
      const hours: number = Math.round(diff / 3600000);
      return this.en() ? `${hours}h ago` : `${hours} 小时前`;
    }
    const days: number = Math.round(diff / 86400000);
    return this.en() ? `${days}d ago` : `${days} 天前`;
  }

  /** 设备页标题栏的溢出菜单：退出登录收进菜单，避免和刷新、主题挤成三颗按钮。 */
  private devicesMenu(): MenuElement[] {
    const items: MenuElement[] = [
      {
        value: this.tr('退出登录'),
        action: () => {
          AlertDialog.show({
            title: this.tr('退出登录'),
            message: this.tr('将清除本机保存的主机凭据，需要重新绑定才能连接。'),
            autoCancel: true,
            primaryButton: {
              value: this.tr('取消'),
              action: () => {
              }
            },
            secondaryButton: {
              value: this.tr('退出'),
              fontColor: this.pal().danger,
              action: () => {
                this.runtime.logout();
              }
            }
          });
        }
      }
    ];
    return items;
  }

  /** Keep the window background and system bars in sync with the active theme. */
  private syncWindowChrome(): void {
    if (this.chromeApplied && this.windowChromeDark === this.isDarkUi) {
      return;
    }
    this.chromeApplied = true;
    this.windowChromeDark = this.isDarkUi;
    const bg: string = this.pal().bg;
    const content: string = this.pal().text;
    window.getLastWindow(getContext(this)).then((win: window.Window) => {
      win.setWindowBackgroundColor(bg);
      win.setWindowSystemBarProperties({
        statusBarColor: bg,
        statusBarContentColor: content,
        navigationBarColor: bg,
        navigationBarContentColor: content
      }).catch(() => {
      });
    }).catch(() => {
    });
  }

  build() {
    // 整个界面按语言重建一次：ArkUI 对 @Builder 子树的文案节点不会因为模块级文案表
    // 变化而重算，用 ForEach 的 key 换语言时强制重建，比给每个 Text 打状态依赖可靠。
    Column() {
      ForEach([this.languageMode], (lang: number) => {
        this.RootStack()
      }, (lang: number) => `ui-${lang}-${this.themeMode}`)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  RootStack() {
    Stack() {
      Column() {
        if (this.phase === PHASE_BOOT) {
          this.BootScreen()
        } else if (this.phase === PHASE_SETUP) {
          ServerSetupScreen({
            palette: this.pal(),
            providers: this.providers,
            busy: this.busy,
            wide: this.isWideLayout(),
            qrUrl: this.qrUrl,
            errorMsg: this.errorMsg,
            infoMsg: this.infoMsg,
            minContentHeight: Math.max(0, this.windowHeightVp - this.topSafePadding() - 36),
            emailInput: $emailInput,
            passwordInput: $passwordInput,
            twoFactorRequired: this.passwordChallenge.length > 0 && this.passwordChallengeServer === this.serverInput,
            passwordLoginOpen: $passwordLoginOpen,
            onMore: () => { this.showMoreMenu = true; },
            onLogin: (email: string, password: string, code: string) => {
              const server = this.serverInput;
              const challenge = this.passwordChallengeServer === server ? this.passwordChallenge : '';
              this.runtime.login(server, email, password, challenge, code).then((next: string | undefined) => {
                if (next !== undefined && this.phase === PHASE_SETUP && this.serverInput === server) {
                  this.passwordChallengeServer = server;
                  this.passwordChallenge = next;
                  this.passwordInput = '';
                } else if (this.phase !== PHASE_SETUP) {
                  this.passwordChallenge = '';
                }
              });
            },
            onRestartPassword: () => { this.passwordChallenge = ''; },
            onProvider: (id: string) => {
              this.passwordChallenge = '';
              this.startProviderLogin(id);
            },
            onOpenAuthorization: () => { this.openAuthorizeLink(); },
            onCopyAuthorization: () => { this.copyAuthorizeLink(); },
            onCancelAuthorization: () => { this.runtime.cancelQrLogin(); },
            onRetryIdentity: () => { this.runtime.retryBootstrap(getContext(this)); },
            onResetIdentity: () => { this.runtime.resetIdentityAndRestart(getContext(this)); },
            onOpenCredits: () => { this.openBrowserLink('https://github.com/liguobao'); }
          })
        } else if (this.phase === PHASE_DEVICES || this.phase === PHASE_CONNECTING) {
          if (this.hostsManagementOpen && this.phase === PHASE_DEVICES) {
            this.DevicesScreen()
          } else {
            this.SessionsPanelBody(false)
          }
        } else {
          if (this.showThreePane()) {
            Row() {
              this.SessionsPane()
              Column() {
  Column()
    .width(this.splitDragging ? 2 : 1)
    .height(this.splitDragging || this.splitHover ? '70%' : '0%')
    .backgroundColor(this.splitDragging || this.splitHover
      ? this.pal().primary : Color.Transparent)
    .borderRadius(1)
}
.width(6)
.height('100%')
.justifyContent(FlexAlign.Center)
.alignItems(HorizontalAlign.Center)
.onHover((isHover: boolean) => {
  this.splitHover = isHover;
})
.gesture(
  PanGesture({ direction: PanDirection.Horizontal, distance: 2 })
    .onActionStart(() => {
      this.splitDragging = true;
      this.splitDragBase = this.splitPaneWidth();
    })
    .onActionUpdate((event: GestureEvent) => {
      this.runtime.setSplitWidth(this.splitDragBase + event.offsetX);
    })
    .onActionEnd(() => {
      this.splitDragging = false;
      this.runtime.setSplitWidth(this.splitPaneWidth());
    })
)
              Column() {
                this.ChatScreen()
              }
              .layoutWeight(1)
              .height('100%')
              Column() {
  Column()
    .width(this.splitDragging ? 2 : 1)
    .height(this.splitDragging || this.splitHover ? '70%' : '0%')
    .backgroundColor(this.splitDragging || this.splitHover
      ? this.pal().primary : Color.Transparent)
    .borderRadius(1)
}
.width(6)
.height('100%')
.justifyContent(FlexAlign.Center)
.alignItems(HorizontalAlign.Center)
              this.InspectorPane()
            }
            .width('100%')
            .height('100%')
          } else if (this.showTwoPane()) {
            Row() {
              this.SessionsPane()
              // 分隔条：PC 上可以拖着调会话栏宽度，宽度记在本地
              Column() {
  Column()
    .width(this.splitDragging ? 2 : 1)
    .height(this.splitDragging || this.splitHover ? '70%' : '0%')
    .backgroundColor(this.splitDragging || this.splitHover
      ? this.pal().primary : Color.Transparent)
    .borderRadius(1)
}
.width(6)
.height('100%')
.justifyContent(FlexAlign.Center)
.alignItems(HorizontalAlign.Center)
.onHover((isHover: boolean) => {
  this.splitHover = isHover;
})
.gesture(
  PanGesture({ direction: PanDirection.Horizontal, distance: 2 })
    .onActionStart(() => {
      this.splitDragging = true;
      this.splitDragBase = this.splitPaneWidth();
    })
    .onActionUpdate((event: GestureEvent) => {
      this.runtime.setSplitWidth(this.splitDragBase + event.offsetX);
    })
    .onActionEnd(() => {
      this.splitDragging = false;
      this.runtime.setSplitWidth(this.splitPaneWidth());
    })
)
              Column() {
                this.ChatScreen()
              }
              .layoutWeight(1)
              .height('100%')
            }
            .width('100%')
            .height('100%')
          } else {
            this.ChatScreen()
          }
        }
      }
      .width('100%')
      .height('100%')
      if (this.phase === PHASE_CHAT && this.showSessions && !this.isLandscape) {
        this.SessionsOverlay()
      }
      // 挂载顺序 = 层级顺序：越靠后越在上层。
      // 设置面板在下面，它打开的二级点选必须排在它之后，否则会被压在设置底下点不到。
      if (this.hostSwitcherOpen || this.phase === PHASE_CONNECTING) {
        this.HostSwitcherSheet()
      }
      if (this.phase === PHASE_SETUP && this.loginServerEditor) {
        LoginServerEditor({
          palette: this.pal(),
          serverInput: this.serverInput,
          onSave: (server: string) => {
            this.loginServerEditor = false;
            this.runtime.selectServer(server).then((selected: string | undefined) => {
              if (selected === undefined) return;
              this.serverInput = selected;
              this.passwordChallenge = '';
              this.emailInput = '';
              this.passwordInput = '';
              this.passwordLoginOpen = false;
            });
          },
          onClose: () => { this.loginServerEditor = false; }
        })
      }
      if (this.workspaceOptionsOpen) {
        this.WorkspaceOptions()
      }
      if (this.showSettings) {
        this.SettingsOverlay()
      }
      if (this.pluginsOpen) {
        this.PluginsOverlay()
      }
      if (this.pluginForm !== undefined) {
        PluginSettingsPage({
          palette: this.pal(),
          title: this.pluginFormTitle,
          form: this.pluginForm,
          onBack: () => { this.pluginForm = undefined; },
          onSave: async (ops: PluginSettingOperation[]) => {
            const form = this.pluginForm;
            if (form === undefined) {
              throw new Error('PLUGIN_SETTINGS_CLOSED');
            }
            await this.runtime.saveHostPluginSettings(this.pluginFormDevice, form, ops);
          },
          onSaved: () => {
            this.pluginForm = undefined;
            this.reloadPlugins();
            promptAction.showToast({ message: this.tr('插件设置已保存') });
          }
        })
      }
      if (this.appearanceOpen) {
        this.AppearanceOverlay()
      }
      if (this.showBrowser) {
        this.FileBrowserOverlay()
      }
      if (this.showSessionPanel) {
        this.SessionPanelOverlay()
      }
      if (this.permissionPickerOpen) {
        this.PermissionPickerOverlay()
      }
      if (this.showModelPicker) {
        this.ModelPickerOverlay()
      }
      if (this.attachmentMenuOpen) {
        this.AttachmentMenu()
      }
      if (this.promptPanelOpen) {
        this.PromptPanelOverlay()
      }
      if (this.trajectoryOpen) {
        this.TrajectoryOverlay()
      }
      if (this.workspaceCreateOpen) {
        this.WorkspaceCreateOverlay()
      }
      if (this.composerExpanded) {
        this.ExpandedComposerOverlay()
      }
      if (this.linkDetailOpen) {
        this.LinkDetailOverlay()
      }
      if (this.aboutOpen) {
        this.AboutOverlay()
      }
      if (this.diagnosticsOpen) {
        this.DiagnosticsOverlay()
      }
      if (this.schedulesOpen) {
        this.SchedulesOverlay()
      }
      if (this.sendModeOpen) {
        this.SendModeOverlay()
      }
      if (this.writingMenuOpen) {
        this.WritingMenuOverlay()
      }
      if (this.filePreviewOpen) {
        this.FilePreviewOverlay()
      }
      if (this.workspaceGitOpen) {
        this.WorkspaceGitOverlay()
      }
      if (this.inSessionSearchOpen) {
        this.InSessionSearchOverlay()
      }
      if (this.deviceDetailId.length > 0) {
        this.DeviceDetailOverlay()
      }
      if (this.botDetail !== undefined) {
        this.BotDetailPage()
      }
      if (this.terminalOpen) {
        TerminalPage({
          palette: this.pal(),
          session: this.terminalSession,
          onBack: () => { this.closeTerminalPage(); }
        })
      }
      if (this.dshWebOpen && !this.reconnecting) {
        DshWebPage({
          palette: this.pal(),
          hostName: this.connectedHostDisplay(),
          openGrant: () => this.runtime.openDshWeb(this.deviceDetailId),
          closeGrant: () => this.runtime.closeDshWeb(),
          onBack: () => { this.dshWebOpen = false; }
        })
      }
      if (this.messageActionsOpen) {
        this.MessageActionsOverlay()
      }
      if (this.showMoreMenu) {
        this.MoreMenuOverlay()
      }
      if (this.deviceMenuId.length > 0) {
        this.DeviceMenuOverlay()
      }
      if (this.choiceOpen) {
        this.ChoiceSheetOverlay()
      }
      if (this.previewActive) {
        this.ImagePreviewOverlay()
      }
      // 隐藏的 WebRTC 桥：1x1 透明，仅承载 JS RTCPeerConnection
      Web({ src: $rawfile('webrtc-bridge.html'), controller: this.rtc.controller })
        .javaScriptAccess(true)
        .domStorageAccess(false)
        .fileAccess(false)
        .javaScriptProxy({
          object: this.rtc.proxyObject(),
          name: 'dshBridge',
          methodList: ['onLog', 'onLocalSdp', 'onIce', 'onState', 'onIceState', 'onTransport',
            'onDataOpen', 'onDataClosed', 'onDataBinary', 'onError'],
          controller: this.rtc.controller
        })
        .onPageEnd(() => {
          this.rtc.markReady();
          this.rtc.startSelfTest();
        })
        .width(1)
        .height(1)
        .opacity(0)
        .hitTestBehavior(HitTestMode.None)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().bg)
    // 让页面铺到系统栏下面（内容自己用 padding 避让），否则底部会多出导航条那一条留白
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    .padding({ top: this.topSafePadding(), bottom: this.bottomSafePadding() })
    .onAppear(() => {
      this.measureInsets();
    })
  }

  @Builder
  MoreMenuOverlay() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => { this.showMoreMenu = false; })
      Column() {
        if (this.phase === PHASE_SETUP) {
          this.MoreMenuRow($r('app.media.ic_refresh'), this.tr('切换服务器'), false, () => {
            this.loginServerEditor = true;
          })
          this.MoreMenuRow($r('app.media.ic_zap'), this.tr('会员方案'), false, () => {
            this.openBrowserLink(MEMBERSHIP_PRICING_URL);
          })
          this.MoreMenuRow($r('app.media.ic_settings'), this.tr('设置'), false, () => { this.showSettings = true; })
          this.MoreMenuRow($r('app.media.ic_info'), this.tr('关于'), false, () => { this.aboutOpen = true; })
          this.MoreMenuRow($r('app.media.ic_download'), this.tr('检查更新'), false, () => {
            this.openBrowserLink(RELEASES_URL);
          })
        } else if (this.phase === PHASE_CHAT) {
          if (!this.reconnecting) {
            this.MoreMenuRow($r('app.media.ic_puzzle'), this.tr('插件管理'), false, () => {
              this.pluginsOpen = true;
              this.pluginSelected = '';
              this.reloadPlugins();
            })
          }
          this.MoreMenuRow($r('app.media.ic_clock'), this.tr('自动化任务'), false, () => {
            this.schedulesOpen = true;
          })
          this.MoreMenuDivider()
          this.MoreMenuRow($r('app.media.ic_settings'), this.tr('设置'), false, () => { this.showSettings = true; })
          this.MoreMenuRow($r('app.media.ic_info'), this.tr('关于'), false, () => { this.aboutOpen = true; })
          this.MoreMenuRow($r('app.media.ic_download'), this.tr('检查更新'), false, () => {
            this.openBrowserLink(RELEASES_URL);
          })
        }
      }
      .width(this.en() ? 224 : 210)
      .constraintSize({ maxWidth: '90%' })
      .margin({ top: 56, right: 16 })
      .padding(6)
      .backgroundColor(this.pal().panel)
      .borderRadius(18)
      .border({ width: 1, color: this.pal().border })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  MoreMenuRow(icon: Resource, label: string, danger: boolean, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Image(icon)
          .width(20)
          .height(20)
          .fillColor(danger ? this.pal().danger : this.pal().text)
        Text(label)
          .fontSize(15)
          .fontColor(danger ? this.pal().danger : this.pal().text)
          .layoutWeight(1)
          .textAlign(TextAlign.Start)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
    }
      .width('100%')
      .height(48)
      .backgroundColor(Color.Transparent)
      .align(Alignment.Start)
      .padding({ left: 12, right: 12 })
      .onClick(() => {
        this.showMoreMenu = false;
        action();
      })
  }

  @Builder
  MoreMenuDivider() {
    Divider()
      .strokeWidth(0.5)
      .color(this.pal().border)
      .margin({ left: 12, right: 12, top: 4, bottom: 4 })
  }

  private loadMembership(): void {
    const request: number = ++this.membershipRequest;
    const account: string = this.runtime.email;
    const server: string = this.runtime.serverUrl;
    this.membershipStatus = '';
    this.membershipExpiry = 0;
    if (account.length === 0 || server.length === 0) {
      return;
    }
    this.runtime.readAccountMembership().then((membership: AccountMembership) => {
      if (this.showSettings && request === this.membershipRequest
        && account === this.runtime.email && server === this.runtime.serverUrl) {
        this.membershipStatus = membership.status;
        this.membershipExpiry = membership.expiresAt;
      }
    }).catch(() => {
      if (this.showSettings && request === this.membershipRequest
        && account === this.runtime.email && server === this.runtime.serverUrl) {
        this.membershipStatus = 'unavailable';
      }
    });
  }

  private membershipLabel(status: string): string {
    switch (status) {
      case 'none': return this.tr('未开通');
      case 'active': return this.tr('有效');
      case 'expired': return this.tr('已过期');
      case 'revoked': return this.tr('已撤销');
      case 'unavailable': return this.tr('不可用');
      default: return this.tr('查询中…');
    }
  }

  private copyAccountId(): void {
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.runtime.email);
    pasteboard.getSystemPasteboard().setData(data).catch(() => {
      promptAction.showToast({ message: this.tr('复制失败') });
    });
  }

  /** 设置面板：主题做成可选列表，不再靠一颗按钮循环切。 */
  @Builder
  SettingsOverlay() {
    Stack() {
      Column() {
        ScreenHeader({
          palette: this.pal(),
          title: this.tr('设置'),
          onBack: () => { this.showSettings = false; }
        })
        Scroll() {
          Column({ space: 16 }) {
            Text(this.tr('外观'))
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal().text2)
              .width('100%')
              .padding({ left: 14, top: 16 })
            Row({ space: 8 }) {
              this.ThemeTile(1)
              this.ThemeTile(2)
              this.ThemeTile(0)
            }
            .width('100%')
            .padding(12)
            .backgroundColor(this.pal().card)
            .borderRadius(22)
            Column() {
              this.SettingsRow(this.tr('聊天外观'), this.textScaleLabel() + ' · ' + this.themeTintLabel(), false, () => {
                this.appearanceOpen = true;
              })
              this.SettingsRow(this.tr('列表密度'), this.layoutDensityLabel(), false, () => {
                this.openChoice('density');
              })
              this.SettingsRow(this.tr('生成时发送'), this.runtime.steerMode ? this.tr('插话打断') : this.tr('排队发送'),
                false, () => { this.sendModeOpen = true; })
            }
            .width('100%')
            .backgroundColor(this.pal().card)
            .borderRadius(22)
            Text(this.tr('语言'))
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal().text2)
              .width('100%')
              .padding({ left: 14, top: 8 })
            Column() {
              this.SettingsRow(this.tr('语言'), this.languageLabel(), false, () => {
                this.openChoice('language');
              })
            }
            .width('100%')
            .backgroundColor(this.pal().card)
            .borderRadius(22)
            .clip(true)

            // —— 账号与服务器 ——
            Text(this.tr('账号与服务器'))
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal().text2)
              .width('100%')
              .padding({ left: 14, top: 8 })
            Column() {
              if (this.runtime.serverUrl.length > 0) {
                this.SettingsRow(this.tr('服务器'), serverHostLabel(this.runtime.serverUrl), false,
                  () => { this.openBrowserLink(this.runtime.serverUrl); })
              }
              if (this.runtime.email.length > 0 && this.runtime.serverUrl.length > 0 && this.phase !== PHASE_SETUP) {
                this.SettingsRow(this.tr('账号'), this.runtime.email, false, () => { this.copyAccountId(); })
                this.MembershipStatusRow()
                if (this.membershipExpiry > 0) {
                  this.SettingsRow(this.tr('到期日期'),
                    new Date(this.membershipExpiry).toLocaleDateString(this.en() ? 'en-US' : 'zh-CN'), false, undefined)
                }
              }
            }
            .width('100%')
            .backgroundColor(this.pal().card)
            .borderRadius(22)
            .clip(true)
            // —— 布局（分栏/密度，PC 与折叠屏才用得上）——
            Text(this.tr('布局'))
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal().text2)
              .width('100%')
              .padding({ left: 14, top: 8 })
            Column() {
              this.SettingsRow(this.tr('右侧详情栏'),
                this.runtime.showInspector ? this.tr('显示') : this.tr('隐藏'), false, () => {
                  this.runtime.setShowInspector(!this.runtime.showInspector);
                })
              if (this.runtime.splitWidth > 0) {
                this.SettingsRow(this.tr('会话栏宽度'),
                  this.runtime.splitWidth + 'vp', true, () => {
                    this.runtime.setSplitWidth(0);
                    promptAction.showToast({ message: this.tr('已恢复默认宽度') });
                  })
              }
            }
            .width('100%')
            .backgroundColor(this.pal().card)
            .borderRadius(22)
            .clip(true)
            // —— 通用（低频，点开再选）——
            Text(this.tr('通用'))
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal().text2)
              .width('100%')
              .padding({ left: 14, top: 8 })
            Column() {
              this.SettingsRow(this.tr('清空本地数据'), this.tr('草稿/提示词/收藏'), true, () => {
                AlertDialog.show({
                  title: this.tr('清空本地数据'),
                  message: this.tr('会删除本机的草稿、提示词、收藏与最近访问，登录态和主机凭据不动。确定吗？'),
                  autoCancel: true,
                  primaryButton: {
                    value: this.tr('取消'),
                    action: () => {
                    }
                  },
                  secondaryButton: {
                    value: this.tr('清空'),
                    fontColor: this.pal().danger,
                    action: () => {
                      this.runtime.clearLocalPreferences();
                      promptAction.showToast({ message: this.tr('已清空本地数据') });
                    }
                  }
                });
              })
              this.SettingsRow(this.tr('精简历史'),
                this.runtime.compactHistory ? this.tr('开 · 历史工具输出转摘要') : this.tr('关 · 传完整历史'),
                false, () => {
                  this.runtime.setCompactHistory(!this.runtime.compactHistory).then(() => {
                    promptAction.showToast({ message: this.runtime.compactHistory
                      ? this.tr('已开启：下次打开会话生效') : this.tr('已关闭：下次打开会话生效') });
                  }).catch(() => undefined);
                })
              this.SettingsRow(this.tr('敏感内容打码'),
                this.runtime.secretMask ? this.tr('开 · 点气泡看原文') : this.tr('关 · 原文显示'),
                false, () => {
                  this.runtime.setSecretMask(!this.runtime.secretMask);
                })
              this.SettingsRow(this.tr('连接诊断'),
                this.connectedTransport.length > 0 ? this.transportBadgeText() : this.tr('未连接'), false, () => {
                  this.diagnosticsOpen = true;
                })
              this.SettingsRow(this.tr('关于'), appVersion(), false, () => { this.aboutOpen = true; })
              this.SettingsRow(this.tr('完成通知'),
                this.runtime.notificationsEnabled ? this.tr('开') : this.tr('关'), false, () => {
                  const next: boolean = !this.runtime.notificationsEnabled;
                  this.runtime.notificationsEnabled = next;
                  if (next) {
                    const ability: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
                    this.runtime.requestNotificationPermission(ability).then((granted: boolean) => {
                      if (!granted) {
                        promptAction.showToast({ message: this.tr('系统通知权限未开启') });
                      }
                    }).catch(() => undefined);
                  }
                  this.runtime.notify();
                })
            }
            .width('100%')
            .backgroundColor(this.pal().card)
            .borderRadius(22)
            .clip(true)
            // —— 危险操作放最后 ——
            Column({ space: 8 }) {
              Text(this.tr('账号'))
                .fontSize(11)
                .fontColor(this.pal().text3)
                .width('100%')
                .padding({ left: 4 })
              Text(this.tr('退出登录'))
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor('#FFFFFF')
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 13, bottom: 13 })
                .backgroundColor('#E5484D')
                .borderRadius(12)
                .onClick(() => {
                  this.showSettings = false;
                  AlertDialog.show({
                    title: this.tr('退出登录'),
                    message: this.tr('将清除本机保存的主机凭据，需要重新绑定才能连接。'),
                    autoCancel: true,
                    primaryButton: {
                      value: this.tr('取消'),
                      action: () => {
                      }
                    },
                    secondaryButton: {
                      value: this.tr('退出'),
                      fontColor: this.pal().danger,
                      action: () => {
                        this.runtime.logout();
                      }
                    }
                  });
                })
              Text(this.buildTag())
                .fontSize(10)
                .fontColor(this.pal().text3)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 4 })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .padding({ bottom: 8 })
        }
        .scrollable(ScrollDirection.Vertical)
        .scrollBar(BarState.Off)
        .layoutWeight(1)
        .width('100%')
      }
      .width('100%')
      .height('100%')
      .constraintSize({ maxWidth: 600 })
      .padding({ left: 16, right: 16, bottom: 8 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().bg)
    .onAppear(() => { if (this.phase !== PHASE_SETUP) this.loadMembership(); })
  }

  private async reloadPlugins(): Promise<void> {
    const request = ++this.pluginRequest;
    this.pluginsLoading = true;
    this.pluginsError = '';
    try {
      const bundles = await this.runtime.hostPluginInventory();
      if (this.pluginsOpen && request === this.pluginRequest) {
        this.pluginBundles = bundles;
      }
    } catch {
      if (this.pluginsOpen && request === this.pluginRequest) {
        this.pluginsError = this.tr('无法读取主机插件，请检查连接和主机版本后重试。');
      }
    } finally {
      if (request === this.pluginRequest) {
        this.pluginsLoading = false;
      }
    }
  }

  private backFromPlugins(): void {
    if (this.pluginSelected.length > 0) {
      this.pluginSelected = '';
      return;
    }
    this.pluginsOpen = false;
    this.pluginRequest += 1;
    this.pluginBundles = [];
  }

  private async changeHostPlugin(target: string, enabled: boolean, bundle: boolean): Promise<void> {
    if (this.pluginSaving || this.pluginsLoading || !this.pluginsOpen) {
      return;
    }
    const deviceId = this.connectedDeviceId;
    this.pluginSaving = true;
    try {
      const result = await this.runtime.setHostPluginEnabled(deviceId, target, enabled, bundle);
      if (!this.pluginsOpen || deviceId !== this.connectedDeviceId) {
        return;
      }
      if (result === 'restart-required') {
        promptAction.showToast({ message: this.tr('请在主机上重启 DeepSeek Harness') });
      } else if (result !== 'applied') {
        promptAction.showToast({ message: this.tr('主机未应用插件修改') });
      }
      await this.reloadPlugins();
    } catch {
      promptAction.showToast({ message: this.tr('修改插件失败') });
      if (this.pluginsOpen && deviceId === this.connectedDeviceId) {
        await this.reloadPlugins();
      }
    } finally {
      this.pluginSaving = false;
    }
  }

  @Builder
  PluginToggle(title: string, enabled: boolean, writable: boolean, target: string, bundle: boolean) {
    Row({ space: 12 }) {
      Text(title).fontSize(15).fontColor(this.pal().text).layoutWeight(1).maxLines(2)
      Toggle({ type: ToggleType.Switch, isOn: enabled })
        .selectedColor(this.pal().primary)
        .enabled(writable && !this.pluginsLoading && !this.pluginSaving && !this.reconnecting)
        .onChange((value: boolean) => { this.changeHostPlugin(target, value, bundle); })
    }
    .width('100%').height(54).padding({ left: 14, right: 14 })
  }

  @Builder
  PluginsOverlay() {
    Column() {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('插件管理'),
        onBack: () => { this.backFromPlugins(); }
      })
      if (this.pluginsLoading) {
        LoadingProgress().width(24).height(24).color(this.pal().primary).margin(16)
      } else if (this.pluginsError.length > 0) {
        Text(this.pluginsError).fontSize(14).fontColor(this.pal().danger).margin(12)
        Button(this.tr('重试')).backgroundColor(this.pal().primary)
          .onClick(() => { this.reloadPlugins(); })
      } else {
        Scroll() {
          Column({ space: 12 }) {
            if (this.pluginSelected.length === 0) {
              ForEach(['remote', 'installed', 'experimental'], (category: string) => {
                if (this.pluginBundles.some((bundle: HostPluginBundle) => bundle.category === category)) {
                  Text(this.tr(category === 'remote' ? '远程适配' : category === 'installed' ? '已安装' : '实验功能'))
                    .fontSize(13).fontColor(this.pal().text3).width('100%').padding({ left: 12 })
                  Column() {
                    ForEach(this.pluginBundles.filter((bundle: HostPluginBundle) => bundle.category === category),
                      (bundle: HostPluginBundle) => {
                        this.SettingsRow(bundle.title, bundle.enabled ? this.tr('已启用') : this.tr('未启用'),
                          false, () => { this.pluginSelected = bundle.name; })
                      }, (bundle: HostPluginBundle) => bundle.name + ':' + String(bundle.enabled))
                  }
                  .width('100%').backgroundColor(this.pal().card).borderRadius(18).clip(true)
                }
              }, (category: string) => category)
              if (this.pluginBundles.length === 0) {
                Text(this.tr('主机没有可管理的插件')).fontSize(14).fontColor(this.pal().text3).padding(16)
              }
            } else {
              ForEach(this.pluginBundles.filter((bundle: HostPluginBundle) => bundle.name === this.pluginSelected),
                (bundle: HostPluginBundle) => {
                  Text(bundle.title).fontSize(21).fontWeight(FontWeight.Bold).fontColor(this.pal().text).width('100%')
                  if (bundle.version.length > 0) {
                    Text(bundle.version).fontSize(13).fontColor(this.pal().text3).width('100%')
                  }
                  if (bundle.description.length > 0) {
                    Text(bundle.description).fontSize(14).fontColor(this.pal().text2).width('100%')
                  }
                  Column() {
                    this.PluginToggle(this.tr('启用插件包'), bundle.enabled, bundle.writable, bundle.name, true)
                    ForEach(bundle.rows, (row: HostPluginRow) => {
                      this.PluginToggle(row.title, row.enabled, row.writable && bundle.enabled, row.entryId, false)
                      if (row.enabled && row.settings !== undefined) {
                        this.SettingsRow(this.tr('插件设置'), row.title, false, () => {
                          this.pluginFormDevice = this.connectedDeviceId;
                          this.pluginFormTitle = row.title;
                          this.pluginForm = row.settings;
                        })
                      }
                    }, (row: HostPluginRow) => row.name + ':' + row.entryId + ':' + String(row.enabled))
                  }
                  .width('100%').backgroundColor(this.pal().card).borderRadius(18).clip(true)
                }, (bundle: HostPluginBundle) => bundle.name + ':' + String(bundle.enabled))
            }
          }
          .width('100%')
          .padding({ top: 12, bottom: 16 })
        }
        .width('100%').layoutWeight(1).align(Alignment.Top)
      }
    }
    .width('100%').height('100%').padding({ left: 16, right: 16 }).backgroundColor(this.pal().bg)
  }

  @Builder
  AppearanceOverlay() {
    Column({ space: 16 }) {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('聊天外观'),
        onBack: () => { this.appearanceOpen = false; }
      })
      Scroll() {
        Column({ space: 12 }) {
          Text(this.tr('实时效果预览'))
            .fontSize(14)
            .fontColor(this.pal().text2)
            .width('100%')
            .padding({ left: 14 })
          Column({ space: 16 }) {
            Row() {
              Blank()
              Text(this.tr('帮我总结一下这次改动。'))
                .fontSize(this.fs(15))
                .fontColor(this.pal().text)
                .padding({ left: 14, right: 14, top: 10, bottom: 10 })
                .backgroundColor(this.pal().userBubble)
                .borderRadius({ topLeft: 18, topRight: 6, bottomLeft: 18, bottomRight: 18 })
            }
            .width('100%')
            Text(this.tr('已更新文件页面，目录列表和文件预览都可以用返回按钮逐级退出。'))
              .fontSize(this.fs(15))
              .fontColor(this.pal().text)
              .width('100%')
          }
          .width('100%')
          .padding(16)
          .backgroundColor(this.pal().card)
          .borderRadius(22)
          Text(this.tr('主题色'))
            .fontSize(14)
            .fontColor(this.pal().text2)
            .width('100%')
            .padding({ left: 14 })
          Row({ space: 4 }) {
            ForEach([0, 1, 2, 3, 4], (tint: number) => {
              Column({ space: 6 }) {
                Button({ type: ButtonType.Circle }) {
                  if (this.runtime.themeTint === tint) {
                    Image($r('app.media.ic_check')).width(18).height(18).fillColor(this.pal().primary)
                  }
                }
                  .width(36)
                  .height(36)
                  .padding(0)
                  .backgroundColor(applyTint(this.isDarkUi ? darkPalette() : lightPalette(), tint,
                    this.isDarkUi).bg)
                  .border({ width: 2, color: this.runtime.themeTint === tint
                    ? this.pal().primary : this.pal().borderStrong })
                  .accessibilityText(this.tintName(tint))
                  .onClick(() => { this.runtime.setThemeTint(tint); })
                Text(this.tintName(tint))
                  .fontSize(this.fs(10))
                  .maxLines(1)
                  .fontColor(this.pal().text2)
              }
              .layoutWeight(1)
            }, (tint: number) => tint.toString())
          }
          .width('100%')
          .padding({ left: 8, right: 8, top: 12, bottom: 12 })
          .backgroundColor(this.pal().card)
          .borderRadius(22)
          Column() {
            this.SettingsRow(this.tr('文字大小'), this.textScaleLabel(), false, () => {
              this.openChoice('scale');
            })
          }
          .width('100%')
          .backgroundColor(this.pal().card)
          .borderRadius(22)
          .clip(true)
        }
        .width('100%')
      }
      .width('100%')
      .layoutWeight(1)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16 })
    .backgroundColor(this.pal().bg)
  }

  @Builder
  ThemeTile(mode: number) {
    Column({ space: 6 }) {
      Column({ space: 5 }) {
        Column()
          .width('55%').height(4).borderRadius(2)
          .backgroundColor(mode === 2 ? '#7A8291' : '#B9B9BB')
        Column()
          .width('36%').height(4).borderRadius(2)
          .backgroundColor(mode === 2 ? '#59606D' : '#CDCED1')
        Blank()
        Row() {
          Blank()
          Column().width(11).height(11).borderRadius(6)
            .backgroundColor(mode === 2 ? '#6F89FF' : '#4D6BFE')
        }
        .width('100%')
      }
      .width('100%')
      .aspectRatio(1.55)
      .alignItems(HorizontalAlign.Start)
      .padding(9)
      .borderRadius(13)
      .border({ width: 2, color: this.themeMode === mode ? this.pal().primary : this.pal().border })
      .linearGradient({ angle: 145, colors: mode === 0
        ? [['#FFFFFF', 0], ['#FFFFFF', 0.49], ['#161A21', 0.51], ['#161A21', 1]]
        : [[mode === 2 ? '#161A21' : '#FFFFFF', 0], [mode === 2 ? '#161A21' : '#FFFFFF', 1]] })
      Text(mode === 0 ? this.tr('系统') : this.themeLabel(mode))
        .fontSize(14)
        .fontColor(this.themeMode === mode ? this.pal().primary : this.pal().text)
    }
    .layoutWeight(1)
    .onClick(() => { this.runtime.setThemeMode(mode); })
  }

  /** 设置里的一行：左边标题、右边当前值 + 箭头。 */
  @Builder
  MembershipStatusRow() {
    Row({ space: 10 }) {
      Text(this.tr('会员状态'))
        .fontSize(14)
        .fontColor(this.pal().text)
      Blank()
      Text(this.membershipLabel(this.membershipStatus))
        .fontSize(12)
        .fontColor(this.pal().text3)
      if (this.membershipStatus === 'none') {
        Image($r('app.media.ic_chevron_right')).width(16).height(16).fillColor(this.pal().text3)
      }
    }
    .width('100%')
    .padding({ top: 13, bottom: 13, left: 14, right: 14 })
    .border({ width: { bottom: 0.5 }, color: this.pal().border })
    .onClick(() => {
      if (this.membershipStatus === 'none') {
        this.openBrowserLink(MEMBERSHIP_PRICING_URL);
      }
    })
  }

  @Builder
  SettingsRow(title: string, value: string, danger: boolean, action: (() => void) | undefined) {
    Row({ space: 10 }) {
      Text(title)
        .fontSize(16)
        .fontColor(danger ? this.pal().danger : this.pal().text)
      Blank()
      if (value.length > 0) {
        Text(value)
          .fontSize(14)
          .fontColor(this.pal().text3)
          .maxLines(1)
          .constraintSize({ maxWidth: 170 })
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      if (action !== undefined) {
        Image($r('app.media.ic_chevron_right')).width(16).height(16).fillColor(this.pal().text3)
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 58 })
    .padding({ top: 12, bottom: 12, left: 16, right: 16 })
    .border({ width: { bottom: 0.5 }, color: this.pal().border })
    .onClick(() => {
      action?.();
    })
  }

  private textScaleLabel(): string {
    if (this.textScaleMode === 0) {
      return this.tr('小') + ' 0.9×';
    }
    if (this.textScaleMode === 2) {
      return this.tr('大') + ' 1.15×';
    }
    if (this.textScaleMode === 3) {
      return this.tr('特大') + ' 1.3×';
    }
    return this.tr('标准') + ' 1.0×';
  }

  private languageLabel(): string {
    if (this.languageMode === 1) {
      return '中文';
    }
    if (this.languageMode === 2) {
      return 'English';
    }
    return this.tr('跟随系统');
  }

  /** 打开通用设置的选择面板（外观 / 文字大小 / 语言）。 */
  private openChoice(kind: string): void {
    this.choiceKind = kind;
    this.choiceOpen = true;
  }

  /** 布局密度文案：0 自动 / 1 紧凑 / 2 超紧凑。 */
  private layoutDensityLabel(): string {
    const value: number = this.runtime.layoutDensity;
    if (value === 1) {
      return this.tr('紧凑');
    }
    if (value === 2) {
      return this.tr('超紧凑');
    }
    return this.tr('自动（分栏时紧凑）');
  }

  private densityChoices(): ThemeChoice[] {
    return [
      new ThemeChoice(0, this.tr('自动'), this.tr('分栏时自动收紧，单列保持宽松')),
      new ThemeChoice(1, this.tr('紧凑'), this.tr('行高小一点，同屏多两行')),
      new ThemeChoice(2, this.tr('超紧凑'), this.tr('只留标题和时间，隐藏轮数与目录'))
    ];
  }

  private choiceTitleText(): string {
    if (this.choiceKind === 'theme') {
      return this.tr('外观');
    }
    if (this.choiceKind === 'scale') {
      return this.tr('文字大小');
    }
    if (this.choiceKind === 'density') {
      return this.tr('列表密度');
    }
    return this.tr('语言');
  }

  private choiceItems(): ThemeChoice[] {
    if (this.choiceKind === 'theme') {
      return this.themeChoices();
    }
    if (this.choiceKind === 'scale') {
      return this.textScaleChoices();
    }
    if (this.choiceKind === 'density') {
      return this.densityChoices();
    }
    return this.languageChoices();
  }

  private choiceCurrentValue(): number {
    if (this.choiceKind === 'theme') {
      return this.themeMode;
    }
    if (this.choiceKind === 'scale') {
      return this.textScaleMode;
    }
    if (this.choiceKind === 'density') {
      return this.runtime.layoutDensity;
    }
    return this.languageMode;
  }

  private applyChoice(value: number): void {
    if (this.choiceKind === 'theme') {
      this.runtime.setThemeMode(value);
    } else if (this.choiceKind === 'scale') {
      this.runtime.setTextScaleMode(value);
    } else if (this.choiceKind === 'density') {
      this.runtime.setLayoutDensity(value);
    } else {
      this.runtime.setLanguageMode(value);
    }
    this.choiceOpen = false;
  }

  /** 通用设置的点选面板（带弹出/收回动画）。 */
  @Builder
  ChoiceSheetOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.choiceOpen = false;
        })
      Column({ space: 8 }) {
        Row() {
          Text(this.choiceTitleText())
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Blank()
          Image($r('app.media.ic_close'))
            .width(18)
            .height(18)
            .fillColor(this.pal().text3)
            .padding(2)
            .onClick(() => {
              this.choiceOpen = false;
            })
        }
        .width('100%')
        .padding({ bottom: 2 })
        ForEach(this.choiceItems(), (choice: ThemeChoice) => {
          Row({ space: 10 }) {
            Column({ space: 2 }) {
              Text(t(choice.label))
                .fontSize(14)
                .fontColor(this.pal().text)
              Text(t(choice.hint))
                .fontSize(11)
                .fontColor(this.pal().text3)
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            if (this.choiceCurrentValue() === choice.value) {
              Image($r('app.media.ic_check'))
                .width(18)
                .height(18)
                .fillColor(this.pal().primary)
            }
          }
          .width('100%')
          .padding({ top: 12, bottom: 12, left: 14, right: 14 })
          .backgroundColor(this.choiceCurrentValue() === choice.value
            ? this.pal().primarySoft : this.pal().card)
          .borderRadius(12)
          .border({
            width: this.choiceCurrentValue() === choice.value ? 1.5 : 1,
            color: this.choiceCurrentValue() === choice.value
              ? this.pal().primary : this.pal().border
          })
          .onClick(() => {
            this.applyChoice(choice.value);
          })
        }, (choice: ThemeChoice) => 'choice-' + choice.value)
      }
      .width('100%')
      .constraintSize({ maxWidth: 480 })
      .padding({ left: 20, right: 20, top: 16, bottom: 22 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 300 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 200, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /** 单台设备的能力菜单（卡片上的 ⋯）：行之间留间距、危险项单独标红。 */
  @Builder
  DeviceMenuOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.deviceMenuId = '';
        })
      Column({ space: 10 }) {
        Column({ space: 3 }) {
          Text(this.deviceMenuTitle())
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.tr('主机操作'))
            .fontSize(11)
            .fontColor(this.pal().text3)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        Text(this.tr('查看详情'))
          .fontSize(this.fs(15))
          .fontColor(this.pal().text)
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 14, bottom: 14 })
          .backgroundColor(this.pal().card)
          .borderRadius(14)
          .border({ width: 1, color: this.pal().border })
          .onClick(() => {
            const target: string = this.deviceMenuId;
            this.deviceMenuId = '';
            this.deviceDetailId = target;
          })
        Text(this.tr('改名'))
          .fontSize(14)
          .fontColor(this.pal().text)
          .width('100%')
          .padding({ top: 13, bottom: 13, left: 16 })
          .backgroundColor(this.pal().card)
          .borderRadius(12)
          .border({ width: 1, color: this.pal().border })
          .onClick(() => {
            const device: RemoteHostDevice | undefined = this.deviceById(this.deviceMenuId);
            this.deviceMenuId = '';
            if (device !== undefined) {
              this.beginRename(device);
            }
          })
        if (this.deviceMenuPinned()) {
          Text(this.tr('清除公钥固定'))
            .fontSize(14)
            .fontColor(this.pal().danger)
            .width('100%')
            .padding({ top: 13, bottom: 13, left: 16 })
            .backgroundColor('rgba(248,87,73,0.10)')
            .borderRadius(12)
            .border({ width: 1, color: 'rgba(248,87,73,0.35)' })
            .onClick(() => {
              const id: string = this.deviceMenuId;
              this.deviceMenuId = '';
              this.confirmForgetPin(id);
            })
        }
        Text(this.tr('取消'))
          .fontSize(13)
          .fontColor(this.pal().text2)
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 12, bottom: 12 })
          .backgroundColor(this.pal().chip)
          .borderRadius(12)
          .onClick(() => {
            this.deviceMenuId = '';
          })
      }
      .width('100%')
      .constraintSize({ maxWidth: 460 })
      .padding({ left: 20, right: 20, top: 16, bottom: 22 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 300 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 200, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  private deviceMenuTitle(): string {
    const device: RemoteHostDevice | undefined = this.deviceById(this.deviceMenuId);
    if (device === undefined) {
      return '';
    }
    const name: string = this.displayNameFor(device);
    return name.length > 0 ? name : device.deviceId;
  }

  private deviceMenuPinned(): boolean {
    return this.deviceMenuId.length > 0 && this.runtime.hasHostPin(this.deviceMenuId);
  }

  private deviceById(id: string): RemoteHostDevice | undefined {
    for (const device of this.devices) {
      if (device.deviceId === id) {
        return device;
      }
    }
    return undefined;
  }

  private confirmForgetPin(deviceId: string): void {
    AlertDialog.show({
      title: this.tr('该主机已固定公钥'),
      message: this.tr('主机重置或更换后，本地固定的公钥会对不上，导致无法连接。\n'
        + '清除后下次连接将重新信任首次看到的公钥。'),
      primaryButton: {
        value: this.tr('取消'),
        action: () => {
        }
      },
      secondaryButton: {
        value: this.tr('清除固定记录'),
        fontColor: this.pal().danger,
        action: () => {
          this.runtime.forgetHostPin(deviceId);
          this.errorMsg = '';
          this.infoMsg = this.tr('已清除该主机的公钥固定记录');
        }
      }
    });
  }

  @Builder
  FishLogo() {
    Image($r('app.media.ic_fish'))
      .width(this.isWideLayout() ? 168 : 128)
      .aspectRatio(23.16 / 17.04)
      .fillColor(this.pal().text)
      .accessibilityLevel('no')
  }

  @Builder
  BootScreen() {
    Column({ space: 14 }) {
      Blank()
      this.FishLogo()
      Text('DSH REMOTE')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.pal().text)
        .letterSpacing(-0.6)
        .textShadow({ radius: 16, color: 'rgba(77,107,254,0.55)' })
      LoadingProgress()
        .width(36)
        .height(36)
        .color(this.pal().primary)
      Text(this.tr('正在初始化…'))
        .fontSize(13)
        .fontColor(this.pal().text2)
        .letterSpacing(1)
      Blank()
    }
    .width('100%')
    .height('100%')
  }

  private startProviderLogin(id: string): void {
    this.runtime.selectProvider(id);
    const server: string = this.serverInput;
    this.runtime.startQrLogin(server).then(() => {
      if (this.phase === PHASE_SETUP && this.serverInput === server && this.runtime.qrUrl.length > 0) {
        this.openAuthorizeLink();
      }
    });
  }

  private providerOrder(id: string): number {
    const rank: number = ['google', 'zhihu', 'github'].indexOf(id);
    return rank < 0 ? 3 : rank;
  }

  @Builder
  DevicesScreen() {
    Column() {
      Row({ space: 8 }) {
        Button({ type: ButtonType.Normal }) {
          Image($r('app.media.ic_arrow_left'))
            .width(20)
            .height(20)
            .fillColor(this.pal().text)
        }
          .width(36)
          .height(44)
          .padding(0)
          .backgroundColor(Color.Transparent)
          .accessibilityText(this.tr('返回'))
          .onClick(() => {
            this.leaveHostManagement();
          })
        Text(this.tr('远程主机'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.pal().text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Button({ type: ButtonType.Circle }) {
          Image($r('app.media.ic_refresh'))
            .width(18)
            .height(18)
            .fillColor(this.pal().text2)
        }
        .width(32)
        .height(32)
        .backgroundColor(this.pal().chip)
        .border({ width: 1, color: this.pal().borderStrong })
        .enabled(!this.busy)
        .onClick(() => {
          this.runtime.refreshDevices();
        })
      }
      .width('100%')
      .padding({ left: 20, right: 12, top: 12 })
      Text('DSH Remote')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.pal().text2)
        .width('100%')
        .padding({ left: 28, right: 20, top: 18, bottom: 8 })
      if (this.busy) {
        Row({ space: 8 }) {
          LoadingProgress()
            .width(18)
            .height(18)
            .color(this.pal().primary)
          Text(this.tr('正在刷新设备…'))
            .fontSize(13)
            .fontColor(this.pal().text2)
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .padding({ left: 20, right: 20, bottom: 8 })
      }
      if (this.errorMsg.length > 0) {
        Row({ space: 8 }) {
          Column()
            .width(3)
            .height(16)
            .borderRadius(1.5)
            .backgroundColor(this.pal().danger)
          Text(this.errorMsg)
            .fontSize(this.fs(12))
            .fontColor(this.pal().danger)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          if (this.runtime.canRetry()) {
            Text(this.runtime.retryLabel())
              .fontSize(this.fs(12))
              .fontColor('#FFFFFF')
              .padding({ left: 10, right: 10, top: 3, bottom: 3 })
              .borderRadius(10)
              .backgroundColor(this.pal().danger)
              .onClick(() => {
                this.runtime.retryLastError();
              })
          }
          Image($r('app.media.ic_close'))
            .width(18)
            .height(18)
            .fillColor(this.pal().danger)
            .padding(2)
            .onClick(() => {
              this.runtime.clearError();
            })
        }
        .width('100%')
        .padding({ left: 12, right: 12, top: 8, bottom: 8 })
        .backgroundColor('rgba(248,87,73,0.10)')
        .borderRadius(10)
        .margin({ left: 20, right: 20, bottom: 8 })
      }
      if (this.linkBannerText().length > 0) {
        Row({ space: 8 }) {
          if (this.reconnectNotice.length > 0) {
            LoadingProgress()
              .width(15)
              .height(15)
              .color('#F5A623')
          }
          Text(this.linkBannerText())
            .fontSize(this.fs(12))
            .fontColor('#F5A623')
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          if (this.reconnectNotice.length > 0) {
            Text(this.tr('停止重连'))
              .fontSize(this.fs(12))
              .fontColor('#F5A623')
              .padding({ left: 8, right: 4, top: 3, bottom: 3 })
              .onClick(() => {
                this.runtime.cancelReconnect();
              })
          }
        }
        .width('100%')
        .padding({ left: 12, right: 12, top: 8, bottom: 8 })
        .backgroundColor('rgba(245,166,35,0.12)')
        .borderRadius(10)
        .margin({ left: 20, right: 20, bottom: 8 })
      }
      List() {
        ForEach(this.devices, (device: RemoteHostDevice) => {
          ListItem() {
            this.DeviceCard(device, false)
          }
        }, (device: RemoteHostDevice) => `${device.deviceId}#${this.languageMode}`)
      }
      .width('100%')
      // 宽屏双列：一列会留出大片空白，两列更像桌面端的主机面板
      .lanes(deviceColumns(this.breakpoint, this.devices.length))
      .constraintSize({ maxHeight: 560 })
      .margin({ left: 20, right: 20, bottom: 8 })
      .width('auto')
      .borderRadius(22)
      .clip(true)
      .scrollBar(BarState.Off)
      if (this.devices.length === 0 && !this.busy) {
        // 空态别只留一行灰字：给一张卡片说清楚下一步该做什么
        Column({ space: 10 }) {
          Image($r('app.media.ic_host'))
            .width(28)
            .height(28)
            .fillColor(this.pal().text2)
          Text(this.tr('还没有可用的主机'))
            .fontSize(this.fs(14))
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().text)
          Text(this.tr('在电脑上安装 DSH 并用同一账号登录，主机就会出现在这里'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
            .textAlign(TextAlign.Center)
            .maxLines(2)
          Row({ space: 10 }) {
            Text(this.tr('刷新'))
              .fontSize(this.fs(12))
              .fontColor('#FFFFFF')
              .padding({ left: 16, right: 16, top: 8, bottom: 8 })
              .backgroundColor(this.pal().primary)
              .borderRadius(10)
              .onClick(() => {
                this.runtime.refreshDevices();
              })
          }
          .padding({ top: 2 })
        }
        .width('100%')
        .padding({ left: 24, right: 24, top: 18, bottom: 18 })
        .margin({ left: 20, right: 20, top: 8 })
        .backgroundColor(this.pal().card)
        .borderRadius(16)
        .border({ width: 1, color: this.pal().border })
        .alignItems(HorizontalAlign.Center)
      }
      Text(this.tr('一次只连接一台主机，切换时会断开上一台主机。'))
        .fontSize(12)
        .fontColor(this.pal().text2)
        .width('100%')
        .padding({ left: 28, right: 28, top: 4, bottom: 12 })
      Text(this.tr('启动'))
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.pal().text2).width('100%')
        .padding({ left: 36, right: 20, top: 16, bottom: 12 })
      Row({ space: 12 }) {
        Image($r('app.media.ic_refresh')).width(20).height(20).fillColor(this.pal().text)
        Column({ space: 2 }) {
          Text(this.tr('连接上次使用的主机')).fontSize(16).fontColor(this.pal().text)
          Text(this.tr('关闭后启动停留在设备列表')).fontSize(13).fontColor(this.pal().text2)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Toggle({ type: ToggleType.Switch, isOn: this.autoConnectLastHost })
          .selectedColor(this.pal().primary)
          .accessibilityText(this.tr('连接上次使用的主机'))
          .onChange((value: boolean) => { this.runtime.setAutoConnectLastHost(value); })
      }
      .constraintSize({ minHeight: 58 })
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      .margin({ left: 20, right: 20 })
      .width('auto')
      .backgroundColor(this.pal().card)
      .borderRadius(22)
      Blank()
    }
    .width('100%')
    .height('100%')
    .constraintSize({ maxWidth: this.deviceColumnWidth() })
  }

  // Mirrors the shared app's HostSwitcherSheet: a grouped list and a separate management action.
  @Builder
  HostSwitcherSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%').height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => { this.dismissHostSwitcher(); })
      Column({ space: 12 }) {
        Column().width(36).height(4).borderRadius(2).backgroundColor(this.pal().borderStrong)
        if (this.phase === PHASE_CONNECTING) {
          this.ConnectingScreen()
        } else {
          Row({ space: 8 }) {
            Text(this.tr('切换主机'))
              .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.pal().text).layoutWeight(1)
            this.TopIcon($r('app.media.ic_refresh'), () => { this.runtime.refreshDevices(); })
            Button({ type: ButtonType.Normal }) {
              Image($r('app.media.ic_close'))
                .width(20)
                .height(20)
                .fillColor(this.pal().text)
            }
              .width(40).height(40).padding(0).fontSize(22)
              .backgroundColor(Color.Transparent)
              .accessibilityText(this.tr('关闭'))
              .onClick(() => { this.dismissHostSwitcher(); })
          }
          .width('100%')
          if (this.errorMsg.length > 0) {
            Text(this.errorMsg)
              .fontSize(13).fontColor(this.pal().danger).width('100%')
          }
          List() {
            if (this.devices.length === 0 && !this.busy) {
              ListItem() {
                Text(this.tr('还没有可用的主机'))
                  .fontSize(15).fontColor(this.pal().text2).width('100%')
                  .textAlign(TextAlign.Center).padding(18)
              }
            }
            ForEach(this.devices, (device: RemoteHostDevice) => {
              ListItem() {
                this.DeviceCard(device, true)
              }
            }, (device: RemoteHostDevice) => device.deviceId)
          }
          .width('100%')
          .constraintSize({ maxHeight: Math.max(80, this.windowHeightVp * 0.38) })
          .borderRadius(22)
          .scrollBar(BarState.Off)
          Text(this.tr('一次只连接一台主机，切换时会断开上一台主机。'))
            .fontSize(12).fontColor(this.pal().text2).width('100%')
            .padding({ left: 16, right: 16 })
          Row({ space: 12 }) {
            Image($r('app.media.ic_settings')).width(20).height(20).fillColor(this.pal().text)
            Text(this.tr('管理远程主机')).fontSize(16).fontColor(this.pal().text).layoutWeight(1)
            Image($r('app.media.ic_chevron_right')).width(18).height(18).fillColor(this.pal().text2)
          }
          .width('100%')
          .height(58)
          .padding({ left: 16, right: 16 })
          .borderRadius(22)
          .backgroundColor(this.pal().card)
          .onClick(() => {
            this.openHostManagement();
          })
        }
      }
      .width('100%')
      .constraintSize({ maxWidth: 540 })
      .padding({ left: 20, right: 20, top: 12, bottom: 24 })
      .backgroundColor(this.pal().bg)
      .borderRadius({ topLeft: 28, topRight: 28 })
    }
    .width('100%').height('100%')
  }

  @Builder
  DeviceCard(device: RemoteHostDevice, switching: boolean) {
    RemoteHostRow({
      palette: this.pal(),
      title: this.displayNameFor(device) || device.deviceId,
      subtitle: this.hostSubtitle(device, switching),
      online: device.online,
      selected: device.deviceId === this.connectedDeviceId,
      editing: this.renamingDeviceId === device.deviceId,
      switching: switching,
      renameInput: $renameInput,
      onSelect: () => { this.selectHostRow(device.deviceId, switching); },
      onMenu: () => { this.deviceMenuId = device.deviceId; },
      onDetails: () => { this.deviceDetailId = device.deviceId; },
      onConfirmRename: () => { this.confirmRename(); },
      onCancelRename: () => { this.cancelRename(); }
    })
  }

  private openHostManagement(): void {
    this.hostSwitcherOpen = false;
    this.hostsManagementOpen = true;
    if (this.phase === PHASE_CHAT) {
      this.closeDrawer();
      this.runtime.keepAliveToDevices();
    }
  }

  private leaveHostManagement(): void {
    this.hostsManagementOpen = false;
    if (this.connectedDeviceId.length > 0) {
      this.openDrawer();
      this.runtime.connectDevice(this.connectedDeviceId);
    }
  }

  private dismissHostSwitcher(): void {
    if (this.phase === PHASE_CONNECTING) {
      this.runtime.cancelConnect();
    } else {
      this.hostSwitcherOpen = false;
    }
  }

  private selectHostRow(deviceId: string, switching: boolean): void {
    this.hostSwitcherOpen = false;
    if (deviceId === this.connectedDeviceId && this.phase === PHASE_CHAT) {
      if (!switching) {
        this.deviceDetailId = deviceId;
      }
      return;
    }
    if (!this.runtime.hasHostPin(deviceId)) {
      this.deviceDetailId = deviceId;
      return;
    }
    this.connectFromHostPage(deviceId);
  }

  private connectFromHostPage(deviceId: string): void {
    this.deviceDetailId = '';
    this.hostSwitcherOpen = false;
    this.hostsManagementOpen = false;
    this.closeDrawer();
    if (this.phase === PHASE_CHAT) {
      this.runtime.keepAliveToDevices();
    }
    this.runtime.connectDevice(deviceId);
  }

  @Builder
  ConnectingScreen() {
    ConnectionScreen({
      palette: this.pal(),
      deviceName: this.connectingHostName(),
      phase: this.connectStageIndex,
      detail: this.connectStage.length > 0 ? this.tr(this.connectStage) : '',
      elapsed: this.connectElapsedSec,
      embedded: true,
      error: this.errorMsg,
      onCancel: () => { this.runtime.cancelConnect(); }
    })
  }

  private connectingHostName(): string {
    const device: RemoteHostDevice | undefined = this.deviceById(this.runtime.connectionTargetId());
    return device === undefined ? '' : this.displayNameFor(device);
  }

  @Builder
  ChatScreen() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column({ space: this.foldState === 'half' ? this.hingeGapVp() : 0 }) {
      ChatHeader({
        palette: this.pal(),
        title: this.currentSessionTitle.length > 0 ? this.currentSessionTitle : this.tr('新对话'),
        subtitle: this.currentSessionId.length === 0 ? '' :
          (this.currentModelLabel.length > 0 ? this.chatModelLabel() : this.tr('更换模型')),
        drawerInline: this.isLandscape,
        hasSession: this.currentSessionId.length > 0,
        trajectoryOpen: this.trajectoryOpen,
        titleSize: this.fs(15.5),
        subtitleSize: this.fs(12),
        onDrawer: () => {
          this.openDrawer();
          this.runtime.loadWorkspaces();
        },
        onSession: () => {
          this.runtime.refreshPermissionState();
          this.showSessionPanel = true;
        },
        onModel: () => {
          this.runtime.refreshModelCatalog();
          this.showModelPicker = true;
        },
        onCloseTrajectory: () => { this.trajectoryOpen = false; },
        onNewChat: () => {
          this.closeDrawer();
          this.runtime.createNewSession();
        }
      })
      if (this.reconnecting) {
        Row({ space: 8 }) {
          LoadingProgress()
            .width(15)
            .height(15)
            .color('#F5A623')
          Text(this.reconnectNotice.length > 0
            ? this.reconnectNotice
            : this.tr('连接中断，正在重连…'))
            .fontSize(this.fs(12))
            .fontColor('#F5A623')
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text(this.tr('立即重试'))
            .fontSize(this.fs(12))
            .fontColor('#F5A623')
            .padding({ left: 8, right: 4, top: 3, bottom: 3 })
            .onClick(() => {
              this.runtime.retryReconnectNow();
            })
          Text(this.tr('停止'))
            .fontSize(this.fs(12))
            .fontColor(this.pal().text3)
            .padding({ left: 8, right: 4, top: 3, bottom: 3 })
            .onClick(() => {
              this.runtime.cancelReconnect();
            })
        }
        .width('100%')
        .padding({ left: 12, right: 12, top: 8, bottom: 8 })
        .backgroundColor('rgba(245,166,35,0.12)')
        .borderRadius(10)
        .margin({ left: 16, right: 16, top: 6 })
      }
      if (this.errorMsg.length > 0) {
        Row({ space: 8 }) {
          Column()
            .width(3)
            .height(16)
            .borderRadius(1.5)
            .backgroundColor(this.pal().danger)
          Text(this.errorMsg)
            .fontSize(this.fs(12))
            .fontColor(this.pal().danger)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          if (this.runtime.canRetry()) {
            Text(this.runtime.retryLabel())
              .fontSize(this.fs(12))
              .fontColor('#FFFFFF')
              .padding({ left: 10, right: 10, top: 3, bottom: 3 })
              .borderRadius(10)
              .backgroundColor(this.pal().danger)
              .onClick(() => {
                this.runtime.retryLastError();
              })
          }
          Image($r('app.media.ic_close'))
            .width(18)
            .height(18)
            .fillColor(this.pal().danger)
            .padding(2)
            .onClick(() => {
              this.runtime.clearError();
            })
        }
        .width('100%')
        .padding({ left: 12, right: 12, top: 8, bottom: 8 })
        .backgroundColor('rgba(248,87,73,0.10)')
        .borderRadius(10)
        .margin({ left: 16, right: 16, top: 6 })
      }
      List({ scroller: this.scroller, space: 14 }) {
        if (this.historyHasMore || this.loadingOlderHistory) {
          ListItem() {
            Row({ space: 8 }) {
              Text(this.loadingOlderHistory ? this.tr('加载中…') : this.tr('加载更早的消息'))
                .fontSize(this.fs(12))
                .fontColor(this.loadingOlderHistory ? this.pal().text3 : this.pal().primary)
                .padding({ left: 14, right: 14, top: 6, bottom: 6 })
                .backgroundColor(this.pal().inputBg)
                .borderRadius(14)
                .border({ width: 1, color: this.pal().border })
                .onClick(() => {
                  if (!this.loadingOlderHistory) {
                    this.runtime.loadOlderHistory();
                  }
                })
            }
            .width('100%')
            .justifyContent(FlexAlign.Center)
            .padding({ top: 4, bottom: 2 })
          }
        }
        if (this.messages.length === 0) {
          ListItem() {
            Column({ space: 12 }) {
              if (this.sessionsLoadFailed) {
                Text(this.tr('会话列表加载失败'))
                  .fontSize(13)
                  .fontColor(this.pal().danger)
                Button(this.tr('重试'))
                  .height(34)
                  .fontSize(13)
                  .padding({ left: 24, right: 24 })
                  .backgroundColor(this.pal().primary)
                  .fontColor('#FFFFFF')
                  .borderRadius(17)
                  .enabled(!this.busy)
                  .onClick(() => {
                    this.runtime.retrySessionLoad();
                  })
                if (this.busy) {
                  Text(this.tr('正在重新加载…'))
                    .fontSize(11)
                    .fontColor(this.pal().text3)
                }
              } else if (this.busy) {
                Text(this.tr('正在加载会话…'))
                  .fontSize(13)
                  .fontColor(this.pal().text3)
                  .padding(32)
              } else {
                Column({ space: 10 }) {
                  Image($r('app.media.ic_fish'))
                    .width(64)
                    .aspectRatio(23.16 / 17.04)
                    .fillColor(this.pal().text)
                  Row({ space: 8 }) {
                    Text(this.tr('探索未至之境'))
                      .fontSize(this.fs(26))
                      .fontWeight(FontWeight.Bold)
                      .fontColor(this.pal().text)
                    Text(this.tr('预览版'))
                      .fontSize(this.fs(11))
                      .fontColor(this.pal().text2)
                      .backgroundColor(this.pal().chip)
                      .borderRadius(12)
                      .padding({ left: 7, right: 7, top: 3, bottom: 3 })
                  }
                  if (this.currentSessionId.length > 0) {
                    Text(this.tr('对话全程加密，远程操作受 DeepSeek Harness 权限控制。'))
                      .fontSize(this.fs(12))
                      .fontColor(this.pal().text2)
                      .textAlign(TextAlign.Center)
                      .maxLines(2)
                  }
                }
                .alignItems(HorizontalAlign.Center)
                .padding({ top: 30, bottom: 10 })
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Center)
            .padding({ top: 40 })
          }
        }
        ForEach(this.chatRows(), (item: ChatItem, index: number) => {
          ListItem() {
            Column({ space: 6 }) {
              if (this.shouldShowDayDivider(index)) {
                Text(dayDividerLabel(item.timestamp, this.en()))
                  .fontSize(this.fs(10))
                  .fontColor(this.pal().text3)
                  .padding({ left: 10, right: 10, top: 3, bottom: 3 })
                  .backgroundColor(this.pal().chip)
                  .borderRadius(8)
                  .margin({ top: 8, bottom: 2 })
              }
              this.MessageRow(item)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Center)
          }
        }, (item: ChatItem) => `${item.id}#${item.rev}#${this.languageMode}`)
      }
      .layoutWeight(1)
      .width('100%')
      .constraintSize({ maxWidth: this.chatMaxWidth() })
      // 宽屏下消息区居中，而不是贴着会话栏（2in1/三屏下特别明显）
      .alignSelf(ItemAlign.Center)
      // 多缓存几屏，滚动时少重建气泡（长会话明显）
      .cachedCount(6)
      // 底部留白要盖住「语境胶囊 + 输入坞」的高度，最后一条消息才不会被压在下面；
      // 键盘弹起时胶囊行收起，但仍要留够输入坞（约 46 + 16）的高度
      .padding({ left: 16, right: 16, top: 8, bottom: this.keyboardVisible ? 74 : 132 })
      // PC/横屏常驻滑块，鼠标可以直接拖；竖屏手机上仍然滚才出现
      .scrollBar(this.isLandscape ? BarState.On : BarState.Auto)
      .scrollBarWidth(this.isLandscape ? 6 : 3)
      .scrollBarColor(this.isDarkUi ? 'rgba(255,255,255,0.28)' : 'rgba(31,45,90,0.22)')
      .edgeEffect(EdgeEffect.Spring)
      // 只有「用户手动拖动」才停止跟随；程序化滚动不产生 touch，不会误判。
      .onTouch((event: TouchEvent) => {
        if (event.type === TouchType.Move && this.stickToBottom) {
          this.stickToBottom = false;
        }
      })
      .onReachEnd(() => {
        this.stickToBottom = true;
      })
      // 滚到顶就自动往更早翻一页（按钮仍然留着，翻不动时点它不会重复拉）
      .onReachStart(() => {
        if (this.historyHasMore && !this.loadingOlderHistory) {
          this.runtime.loadOlderHistory();
        }
      })
      // 记住当前停在哪个条目，切走再回来据此恢复位置
      .onScrollIndex((first: number) => {
        if (first < 0 || this.currentSessionId.length === 0) {
          return;
        }
        const rows: ChatItem[] = this.chatRows();
        if (first >= rows.length) {
          return;
        }
        const anchorId: string = rows[first].id;
        if (this.anchorSaveTimer >= 0) {
          clearTimeout(this.anchorSaveTimer);
        }
        this.anchorSaveTimer = setTimeout(() => {
          this.anchorSaveTimer = -1;
          this.scrollAnchors[this.currentSessionId] = anchorId;
        }, 400);
      })
      // 左往右横滑唤出会话抽屉：手势只挂在消息区，输入坞的触摸不再被抢
      .gesture(
        PanGesture({ direction: PanDirection.Horizontal, distance: 10 })
          .onActionStart(() => {
            if (this.isLandscape || this.showSessions) {
              this.drawerDragFromChat = false;
              return;
            }
            this.drawerDragFromChat = true;
            this.drawerDragBase = 0;
          })
          .onActionUpdate((event: GestureEvent) => {
            if (!this.drawerDragFromChat || event.offsetX <= 0) {
              return;
            }
            const width: number = this.drawerWidthVp();
            const progress: number = Math.min(1, Math.max(0, this.drawerDragBase + event.offsetX / width));
            if (progress <= 0) {
              return;
            }
            if (!this.showSessions) {
              this.showSessions = true;
            }
            this.drawerOpen = progress;
          })
          .onActionEnd(() => {
            if (!this.drawerDragFromChat) {
              return;
            }
            this.drawerDragFromChat = false;
            if (this.drawerOpen > 0.32) {
              this.settleDrawer(true);
              this.runtime.loadWorkspaces();
            } else {
              this.settleDrawer(false);
            }
          })
      )
      }
      .width('100%')
      .height('100%')


      if (!this.stickToBottom) {
        Row() {
          Row({ space: 4 }) {
            Image($r('app.media.ic_arrow_down')).width(14).height(14).fillColor(this.pal().text2)
            Text(this.tr('回到最新'))
              .fontSize(12)
              .fontColor(this.pal().text2)
          }
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor(this.pal().card)
            .borderRadius(14)
            .border({ width: 1, color: this.pal().border })
            .shadow({ radius: 10, color: 'rgba(0,0,0,0.12)', offsetX: 0, offsetY: 2 })
            .onClick(() => {
              this.stickToBottom = true;
              this.scrollChatToBottom();
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.Center)
        .margin({ bottom: 96 })
      }
      if (this.currentSessionId.length > 0) {
        if (this.foldState === 'half') {
          Column() {
            this.ComposerDock()
          }
          .width('100%')
          .constraintSize({ maxHeight: Math.max(180, this.windowHeightVp * 0.42) })
          .justifyContent(FlexAlign.End)
        } else {
          this.ComposerDock()
        }
      }
    }
    .width('100%')
    .height('100%')
  }

  /** 底部输入坞：不再是整条玻璃，图片键、输入框、发送键各自一块玻璃，中间留缝。 */
  /** 写作辅助：提示词库 / 全屏编辑（点输入坞上的 ✦ 打开）。 */
  @Builder
  AttachmentMenu() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%').height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => { this.attachmentMenuOpen = false; })
      Column({ space: 12 }) {
        Column().width(36).height(4).borderRadius(2).backgroundColor(this.pal().borderStrong)
        this.SheetTitle(this.tr('添加附件'), () => { this.attachmentMenuOpen = false; })
        Row({ space: 12 }) {
          Image($r('app.media.ic_image')).width(22).height(22).fillColor(this.pal().text)
          Text(this.tr('相册')).fontSize(16).fontColor(this.pal().text).layoutWeight(1)
          Image($r('app.media.ic_arrow_right'))
            .width(18)
            .height(18)
            .fillColor(this.pal().text2)
        }
        .width('100%').height(58)
        .padding({ left: 16, right: 16 })
        .backgroundColor(this.pal().card)
        .borderRadius(22)
        .onClick(() => {
          this.attachmentMenuOpen = false;
          this.attachImage();
        })
      }
      .width('100%')
      .constraintSize({ maxWidth: 540 })
      .padding({ left: 20, right: 20, top: 12, bottom: 24 })
      .backgroundColor(this.pal().bg)
      .borderRadius({ topLeft: 28, topRight: 28 })
    }
    .width('100%').height('100%')
  }

  @Builder
  WritingMenuOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(8,12,24,0.45)')
        .onClick(() => {
          this.writingMenuOpen = false;
        })
      Column({ space: 10 }) {
        this.SheetTitle(this.tr('写作辅助'), () => { this.writingMenuOpen = false; })
        Row({ space: 10 }) {
          Column({ space: 2 }) {
            Text(this.tr('提示词库'))
              .fontSize(this.fs(14))
              .fontColor(this.pal().text)
            Text(this.tr('挑一条常用提示词填进输入框'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
              .maxLines(1)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Image($r('app.media.ic_chevron_right'))
            .width(16)
            .height(16)
            .fillColor(this.pal().text3)
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 12, bottom: 12 })
        .backgroundColor(this.pal().inputBg)
        .borderRadius(14)
        .border({ width: 1, color: this.pal().border })
        .onClick(() => {
          this.writingMenuOpen = false;
          this.promptDraftInput = '';
          this.promptPanelOpen = true;
        })
        Row({ space: 10 }) {
          Column({ space: 2 }) {
            Text(this.tr('全屏编辑'))
              .fontSize(this.fs(14))
              .fontColor(this.pal().text)
            Text(this.tr('整屏写长文，换行不会丢'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
              .maxLines(1)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Image($r('app.media.ic_chevron_right'))
            .width(16)
            .height(16)
            .fillColor(this.pal().text3)
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 12, bottom: 12 })
        .backgroundColor(this.pal().inputBg)
        .borderRadius(14)
        .border({ width: 1, color: this.pal().border })
        .onClick(() => {
          this.writingMenuOpen = false;
          this.composerExpanded = true;
        })
      }
      .width('100%')
      .constraintSize({ maxWidth: 460 })
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 240 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 180, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /** 发送方式：排队 / 插话。自定义面板替掉系统 ActionSheet（后者样式和信息层级都别扭）。 */
  @Builder
  SendModeOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(8,12,24,0.45)')
        .onClick(() => {
          this.sendModeOpen = false;
        })
      Column({ space: 10 }) {
        Row() {
          Column({ space: 3 }) {
            Text(this.tr('发送方式'))
              .fontSize(this.fs(16))
              .fontWeight(FontWeight.Bold)
              .fontColor(this.pal().text)
            Text(this.runtime.generating
              ? this.tr('正在生成：插话会立刻打断当前这一轮')
              : this.tr('空闲时两种方式没有区别'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
              .maxLines(2)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Image($r('app.media.ic_close'))
            .width(18)
            .height(18)
            .fillColor(this.pal().text3)
            .padding(2)
            .onClick(() => {
              this.sendModeOpen = false;
            })
        }
        .width('100%')
        this.SendModeRow(this.tr('排队发送'), this.tr('本轮结束后再发，不打断'),
          !this.runtime.steerMode, false)
        this.SendModeRow(this.tr('插话打断'), this.tr('立刻发出去，打断当前这一轮'),
          this.runtime.steerMode, true)
      }
      .width('100%')
      .constraintSize({ maxWidth: 460 })
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 240 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 180, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /** 发送方式的一行：左侧标题+说明，右侧选中标记。 */
  @Builder
  SendModeRow(title: string, hint: string, selected: boolean, steer: boolean) {
    Row({ space: 10 }) {
      Column({ space: 2 }) {
        Text(title)
          .fontSize(this.fs(14))
          .fontColor(this.pal().text)
        Text(hint)
          .fontSize(this.fs(11))
          .fontColor(this.pal().text3)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      if (selected) {
        Image($r('app.media.ic_check'))
          .width(18)
          .height(18)
          .fillColor(steer ? '#F5A623' : this.pal().primary)
      }
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    .backgroundColor(selected
      ? (steer ? 'rgba(245,166,35,0.14)' : this.pal().primarySoft)
      : this.pal().inputBg)
    .borderRadius(14)
    .border({ width: 1,
      color: selected ? (steer ? 'rgba(245,166,35,0.45)' : this.pal().primary) : this.pal().border })
    .onClick(() => {
      this.runtime.setSteerMode(steer);
      this.sendModeOpen = false;
    })
  }

  /** 手机上生成中的「停止」小方块：贴在输入框内部右上角，不额外占一行宽度。 */
  @Builder
  StopChipOverlay() {
    if (this.compactDock() && this.generating) {
      Column() {
        Column()
          .width(11)
          .height(11)
          .borderRadius(2)
          .backgroundColor(this.pal().danger)
      }
      .width(30)
      .height(30)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .backgroundColor('rgba(248,87,73,0.14)')
      .borderRadius(15)
      .border({ width: 1, color: 'rgba(248,87,73,0.40)' })
      .onClick(() => {
        this.runtime.stopGeneration();
      })
    }
  }

  @Builder
  ComposerDock() {
    Column() {
      Column({ space: 8 }) {
      Column() {
        if (this.promptInput.startsWith('/') && this.slashCommands.length > 0) {
          Scroll() {
            Row({ space: 8 }) {
              ForEach(this.slashCommands, (command: SlashCommand) => {
                Row({ space: 6 }) {
                  Text(command.name)
                    .fontSize(this.fs(12))
                    .fontColor(this.pal().primary)
                  if (command.description.length > 0) {
                    Text(command.description)
                      .fontSize(this.fs(11))
                      .fontColor(this.pal().text3)
                      .maxLines(1)
                  }
                }
                .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                .backgroundColor(this.pal().inputBg)
                .borderRadius(9)
                .border({ width: 1, color: this.pal().border })
                .onClick(() => {
                  this.promptInput = command.name + ' ';
                })
              }, (command: SlashCommand) => command.name)
            }
            .padding({ left: 16, right: 16 })
          }
          .scrollable(ScrollDirection.Horizontal)
          .scrollBar(BarState.Off)
          .width('100%')
          .padding({ top: 4, bottom: 2 })
        }
        if (this.pendingImages.length > 0) {
          Scroll() {
            Row({ space: 8 }) {
              ForEach(this.pendingImages, (picked: PickedImage, index: number) => {
                Stack({ alignContent: Alignment.TopEnd }) {
                  if (picked.preview !== undefined) {
                    Image(picked.preview)
                      .width(56)
                      .height(56)
                      .borderRadius(10)
                      .objectFit(ImageFit.Cover)
                  } else {
                    Column()
                      .width(56)
                      .height(56)
                      .borderRadius(10)
                      .backgroundColor(this.pal().chip)
                  }
                  Text(Math.max(1, Math.round(picked.bytes / 1024)) + 'K')
                    .fontSize(this.fs(9))
                    .fontColor('#FFFFFF')
                    .padding({ left: 4, right: 4, top: 1, bottom: 1 })
                    .backgroundColor('rgba(0,0,0,0.45)')
                    .borderRadius(6)
                    .margin({ top: 58, right: 2 })
                  Image($r('app.media.ic_close'))
                    .width(18)
                    .height(18)
                    .fillColor('#FFFFFF')
                    .padding(4)
                    .backgroundColor('rgba(0,0,0,0.55)')
                    .borderRadius(9)
                    .onClick(() => {
                      this.removePendingImage(index);
                    })
                }
              }, (picked: PickedImage, index: number) => index + ':' + picked.bytes)
            }
            .padding({ left: 16, right: 16 })
          }
          .scrollable(ScrollDirection.Horizontal)
          .scrollBar(BarState.Off)
          .width('100%')
          .padding({ top: 2, bottom: 2 })
        }
        Row({ space: this.compactDock() ? 6 : 12 }) {
          // 图片：选相册里的图，压完挂在输入框上方，随下一次发送一起交给主机
          Row() {
            if (this.pickingImages) {
              LoadingProgress()
                .width(18)
                .height(18)
                .color(this.pal().primary)
            } else {
              Image($r('app.media.ic_plus'))
                .width(20)
                .height(20)
                .fillColor(this.pal().text2)
            }
          }
          .width(this.compactDock() ? 40 : 46)
          .height(this.compactDock() ? 40 : 46)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)

          .clip(true)
          .onClick(() => {
            this.attachmentMenuOpen = true;
          })
          // 展开：只在有空间时给（手机上会挤占输入框宽度，长文交给全屏编辑入口）
          if (!this.compactDock()) {
          Row() {
            Image($r('app.media.ic_expand'))
              .width(18)
              .height(18)
              .fillColor(this.pal().text2)
          }
          .width(this.compactDock() ? 30 : 34)
          .height(this.compactDock() ? 40 : 46)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)

          .onClick(() => {
            this.composerExpanded = true;
          })
          }
          TextArea({ text: this.promptInput,
            placeholder: this.generating
              ? (this.compactDock() ? this.tr('正在生成…') : this.tr('正在生成，可插话…'))
              : (this.runtime.steerMode
                ? (this.compactDock() ? this.tr('插话发送…') : this.tr('插话发送（长按发送键切换）'))
                : (this.isWideLayout() ? this.tr('发送消息…（Enter 换行 · Ctrl+Enter 发送）')
                  : this.tr('输入消息…'))) })
            .layoutWeight(1)
            .constraintSize({ minHeight: this.compactDock() ? 44 : 46,
              maxHeight: this.isLandscape ? 160 : (this.isWideLayout() ? 240 : 132) })
            // PC 键盘约定：Enter 换行，Ctrl+Enter（或 ⌘+Enter）发送，Shift+Enter 也按换行。
            // 这里只拦「修饰键+Enter」，其余一律交给 TextArea 默认行为，换行不会被吃掉。
            .onKeyEvent((event: KeyEvent) => {
              if (event.type !== KeyType.Down || event.keyCode !== KeyCode.KEYCODE_ENTER) {
                return;
              }
              // ArkUI 的 KeyEvent 没有 ctrlKey 字段，修饰键要走 getModifierKeyState
              const ctrl: boolean = event.getModifierKeyState !== undefined
                ? event.getModifierKeyState(['Ctrl', 'Meta']) : false;
              if (ctrl) {
                this.sendTap();
              }
            })
            .backgroundColor(Color.Transparent)
            .fontColor(this.pal().text)
            .fontSize(this.fs(16))
            .lineHeight(this.fs(22))
            .placeholderColor(this.pal().text3)
            .caretColor(this.pal().primary)
            // 生成中保持可输入：否则「插话」无从谈起。
            .enabled(true)
            .onFocus(() => {
              if (this.stickToBottom) {
                setTimeout(() => {
                  this.scrollChatToBottom();
                }, 80);
              }
            })
            .onChange((value: string) => {
              this.promptInput = value;
              if (value === '/' && this.slashCommands.length === 0) {
                this.runtime.loadSlashCommands();
              }
              // 草稿落盘做个 400ms 防抖，别每敲一个字就写一次 preferences
              if (this.draftSaveTimer >= 0) {
                clearTimeout(this.draftSaveTimer);
              }
              this.draftSaveTimer = setTimeout(() => {
                this.draftSaveTimer = -1;
                this.runtime.saveDraft(this.currentSessionId, this.promptInput);
              }, 400);
            })
            // 粘贴：剪贴板里是图片就直接挂到待发送区（文本仍按默认插入）
            .onPaste(() => {
              this.pasteImageFromClipboard();
            })
            .padding({ left: 2, right: 2, top: 10, bottom: 10 })
          Row() {
            Image($r('app.media.ic_zap'))
              .width(18).height(18).fillColor(this.pal().text)
          }
          .width(this.compactDock() ? 30 : 34)
          .height(this.compactDock() ? 40 : 46)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)

          .onClick(() => {
            // 一键出「写作辅助」面板：提示词库 / 全屏编辑（长按在鼠标与触控下都不稳，已弃用）
            this.writingMenuOpen = true;
          })
          if (this.generating && !this.compactDock()) {
            Image($r('app.media.ic_stop'))
              .width(46)
              .height(46)
              .padding(14)
              .fillColor(this.pal().danger)
              .backgroundColor('rgba(248,87,73,0.12)')
              .borderRadius(23)
              .border({ width: 1, color: 'rgba(248,87,73,0.35)' })
              .clip(true)
              .onClick(() => {
                this.runtime.stopGeneration();
              })
          }
          if (this.generating && this.compactDock() && this.promptInput.trim().length === 0
            && this.pendingImages.length === 0) {
            // 手机上生成中且没输入：最右边这颗键直接用成「停止」，垂直居中一颗键，不再另占位
            Column() {
              Column()
                .width(13)
                .height(13)
                .borderRadius(3)
                .backgroundColor(this.pal().onInverse)
            }
            .width(36)
            .height(36)
            .justifyContent(FlexAlign.Center)
            .alignItems(HorizontalAlign.Center)
            .backgroundColor(this.pal().inverse)
            .borderRadius(18)
            .onClick(() => {
              this.runtime.stopGeneration();
            })
          } else {
          Image($r('app.media.ic_arrow_up'))
            .width(this.compactDock() ? 36 : 42)
            .height(this.compactDock() ? 36 : 42)
            .padding(this.compactDock() ? 9 : 11)
            .fillColor(this.promptInput.trim().length > 0 || this.pendingImages.length > 0
              ? this.pal().onInverse : this.pal().text2)
            .backgroundColor(this.promptInput.trim().length > 0 || this.pendingImages.length > 0
              ? this.pal().inverse : this.pal().chip)
            .borderRadius(23)
            .clip(true)
            .opacity(this.reconnecting ? 0.45 : 1)
            // 不给键盘焦点：焦点落到发送键上时，Enter/Space 会变成「发送」，
            // PC 用户按 Enter 想换行却把消息发出去了。鼠标点它照样能发。
            .focusable(false)
            .onClick(() => {
              this.sendTap();
            })
            .onKeyEvent((event: KeyEvent) => {
              if (event.type === KeyType.Down
                && (event.keyCode === KeyCode.KEYCODE_ENTER || event.keyCode === KeyCode.KEYCODE_SPACE)) {
                this.sendTap();
              }
            })
            .gesture(LongPressGesture().onAction(() => {
              this.sendModeOpen = true;
            }))
          }
        }
        .width('100%')
        .padding({ left: 6, right: 8, top: 4, bottom: 4 })
        .backgroundColor(this.pal().inputBg)
        .borderRadius(26)
        .border({ width: 1, color: this.pal().border })
        .shadow({ radius: 5, offsetX: 0, offsetY: 2,
          color: this.isDarkUi ? 'rgba(0,0,0,0.28)' : 'rgba(26,38,56,0.12)' })
      }
      .width('100%')
      }
      .width('100%')
      .constraintSize({ maxWidth: this.chatMaxWidth() })
      .padding({ left: 16, right: 16, top: 4, bottom: 6 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }

  /** Shared sessions list (header + rows); wrapped by the overlay or the landscape pane. */
  private clearWorkspaceSearch(): void {
    this.sessionSearchInput = '';
    this.sessionSearchActive = false;
    this.sessionSearchResults = [];
    if (this.searchDebounceTimer >= 0) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = -1;
    }
    this.runtime.searchSessions('');
  }

  private applySessionView(groupBy: string, orderBy: string, filterMode: string): void {
    this.sessionGroupBy = groupBy;
    this.sessionOrderBy = orderBy;
    this.sessionFilterMode = filterMode;
    this.runtime.setSessionView(groupBy, orderBy, filterMode);
    this.workspaceOptionsOpen = false;
  }

  @Builder
  WorkspaceOptionItem(label: string, selected: boolean, action: () => void) {
    Row() {
      Text(label)
        .fontSize(this.fs(12.5))
        .fontColor(this.pal().text)
        .layoutWeight(1)
      if (selected) {
        Image($r('app.media.ic_check'))
          .width(16)
          .height(16)
          .fillColor(this.pal().text)
      }
    }
    .width('100%')
    .padding({ left: 4, right: 4, top: 7, bottom: 7 })
    .onClick(action)
  }

  @Builder
  WorkspaceOptionSectionTitle(title: string) {
    Text(title)
      .fontSize(this.fs(11))
      .fontWeight(FontWeight.Medium)
      .fontColor(this.pal().text2)
      .width('100%')
      .margin({ bottom: 2 })
  }

  @Builder
  WorkspaceOptions() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column()
        .width('100%').height('100%')
        .backgroundColor(Color.Transparent)
        .onClick(() => { this.workspaceOptionsOpen = false; })
      Column({ space: 4 }) {
        this.WorkspaceOptionSectionTitle(this.tr('分组方式'))
        this.WorkspaceOptionItem(this.tr('按工作区'), this.sessionGroupBy === 'workspace', () => {
          this.applySessionView('workspace', this.sessionOrderBy, this.sessionFilterMode);
        })
        this.WorkspaceOptionItem(this.tr('按工作区树'), this.sessionGroupBy === 'workspace-tree', () => {
          this.applySessionView('workspace-tree', this.sessionOrderBy, this.sessionFilterMode);
        })
        this.WorkspaceOptionItem(this.tr('单列表'), this.sessionGroupBy === 'list', () => {
          this.applySessionView('list', this.sessionOrderBy, this.sessionFilterMode);
        })
        Divider().strokeWidth(0.5).color(this.pal().border).margin({ top: 3, bottom: 3 })
        this.WorkspaceOptionSectionTitle(this.tr('排序方式'))
        this.WorkspaceOptionItem(this.tr('手动排序'), this.sessionOrderBy === 'manual', () => {
          this.applySessionView(this.sessionGroupBy, 'manual', this.sessionFilterMode);
        })
        this.WorkspaceOptionItem(this.tr('最近更新'), this.sessionOrderBy === 'updated', () => {
          this.applySessionView(this.sessionGroupBy, 'updated', this.sessionFilterMode);
        })
        Divider().strokeWidth(0.5).color(this.pal().border).margin({ top: 3, bottom: 3 })
        this.WorkspaceOptionSectionTitle(this.tr('筛选会话'))
        this.WorkspaceOptionItem(this.tr('隐藏归档'), this.sessionFilterMode === 'hideArchived', () => {
          this.applySessionView(this.sessionGroupBy, this.sessionOrderBy, 'hideArchived');
        })
        this.WorkspaceOptionItem(this.tr('全部'), this.sessionFilterMode === 'all', () => {
          this.applySessionView(this.sessionGroupBy, this.sessionOrderBy, 'all');
        })
        this.WorkspaceOptionItem(this.tr('仅归档'), this.sessionFilterMode === 'archivedOnly', () => {
          this.applySessionView(this.sessionGroupBy, this.sessionOrderBy, 'archivedOnly');
        })
      }
      .width(236)
      .padding(14)
      .margin({ top: this.topSafePadding() + 168, right: 10 })
      .backgroundColor(this.pal().card)
      .borderRadius(18)
      .border({ width: 0.5, color: this.pal().border })
      .shadow({ radius: 18, color: 'rgba(0,0,0,0.18)', offsetX: 0, offsetY: 6 })
    }
    .width('100%').height('100%')
  }

  private async loadBotCatalog(): Promise<void> {
    const request = ++this.botCatalogRequest;
    this.botCatalogError = '';
    this.botCatalogLoading = true;
    try {
      const rows = await this.runtime.loadBotCatalog();
      if (request === this.botCatalogRequest && this.botTabOpen) {
        this.botCatalog = rows;
      }
    } catch (error) {
      if (request === this.botCatalogRequest && this.botTabOpen) {
        const code = error instanceof Error ? error.message : '';
        this.botCatalogError = this.tr(code === 'BOT_NOT_INSTALLED' ? '此主机未安装 DS-Bot。'
          : code === 'BOT_UNSUPPORTED' ? '此主机未开放 DS-Bot。'
          : code === 'BOT_DISCONNECTED' ? '连接主机后可查看 DS-Bot。' : '无法读取 DS-Bot 列表。');
        this.botCatalog = [];
      }
    } finally {
      if (request === this.botCatalogRequest) {
        this.botCatalogLoading = false;
      }
    }
  }

  @Builder
  BotCatalogGroup(title: string, room: boolean) {
    Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.pal().text2)
      .width('100%').padding({ left: 10, top: 8 })
    Column() {
      ForEach(this.botCatalog.filter((row: BotCatalogRow) => row.room === room), (row: BotCatalogRow) => {
        Row({ space: 12 }) {
          Image(room ? $r('app.media.ic_bots_tab') : $r('app.media.ic_agents_tab'))
            .width(22).height(22).fillColor(this.pal().primary)
          Column({ space: 4 }) {
            Text(row.name).fontSize(15).fontColor(this.pal().text).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            if (row.role.length > 0 || row.room) {
              Text(row.room ? this.tr('成员') + ' ' + row.memberIds.length : row.role)
                .fontSize(12).fontColor(this.pal().text3).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Image($r('app.media.ic_chevron_right')).width(17).height(17).fillColor(this.pal().text3)
        }
        .width('100%').height(60).padding({ left: 14, right: 14 })
        .border({ width: { bottom: 0.5 }, color: this.pal().border })
        .onClick(() => { this.botDetail = row; })
      }, (row: BotCatalogRow) => row.id)
    }
    .width('100%').backgroundColor(this.pal().card).borderRadius(18).clip(true)
  }

  @Builder
  BotCatalogPage() {
    Scroll() {
      Column({ space: 12 }) {
        if (this.botCatalogLoading) {
          LoadingProgress().width(24).height(24).color(this.pal().primary).margin(16)
        } else if (this.botCatalogError.length > 0) {
          Text(this.botCatalogError).fontSize(14).fontColor(this.pal().text2).padding({ top: 24 })
          Button(this.tr('重试')).height(36).backgroundColor(this.pal().primary)
            .onClick(() => { this.loadBotCatalog(); })
        } else if (this.botCatalog.length === 0) {
          Text(this.tr('暂无机器人或群组')).fontSize(14).fontColor(this.pal().text3).padding(16)
        } else {
          if (this.botCatalog.some((row: BotCatalogRow) => !row.room)) {
            this.BotCatalogGroup(this.tr('机器人'), false)
          }
          if (this.botCatalog.some((row: BotCatalogRow) => row.room)) {
            this.BotCatalogGroup(this.tr('群组'), true)
          }
        }
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 14 })
    }
    .width('100%').layoutWeight(1).align(Alignment.Top).scrollBar(BarState.Off)
  }

  @Builder
  BotDetailPage() {
    Column({ space: 14 }) {
      ScreenHeader({
        palette: this.pal(),
        title: this.botDetail?.name ?? 'DS-Bot',
        onBack: () => { this.botDetail = undefined; }
      })
      if (this.botDetail !== undefined) {
        Column() {
          if (this.botDetail.room) {
            this.SettingsRow(this.tr('成员'), String(this.botDetail.memberIds.length), false, undefined)
            ForEach(this.botCatalog.filter((row: BotCatalogRow) =>
              !row.room && this.botDetail?.memberIds.includes(row.id) === true),
              (row: BotCatalogRow) => {
                this.SettingsRow(row.name, row.role, false, undefined)
              }, (row: BotCatalogRow) => row.id)
          } else {
            this.SettingsRow(this.tr('名称'), this.botDetail.name, false, undefined)
            if (this.botDetail.role.length > 0) {
              this.SettingsRow(this.tr('角色'), this.botDetail.role, false, undefined)
            }
            if (this.botDetail.model.length > 0) {
              this.SettingsRow(this.tr('模型'), this.botDetail.model, false, undefined)
            }
          }
        }
        .width('100%').backgroundColor(this.pal().card).borderRadius(20).clip(true)
      }
    }
    .width('100%').height('100%').padding({ left: 16, right: 16 }).backgroundColor(this.pal().bg)
  }

  @Builder
  SessionsPanelBody(connected: boolean = true) {
    Column() {
      Row() {
        Row({ space: 8 }) {
          Image($r('app.media.ic_fish'))
            .width(22)
            .height(16)
            .fillColor(this.pal().text)
          Text('DS Harness Remote')
            .fontSize(this.fs(20))
            .lineHeight(this.fs(25))
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
        }
        .accessibilityText('DS Harness Remote · ' + this.tr('关于'))
        .onClick(() => { this.aboutOpen = true; })
        Blank()
        Button({ type: ButtonType.Circle }) {
          Image($r('app.media.ic_more'))
            .width(18).height(18).rotate({ angle: 90 }).fillColor(this.pal().text)
        }
        .width(38).height(38).padding(0)
        .backgroundColor(Color.Transparent)
        .accessibilityText(this.tr('更多'))
        .onClick(() => { this.showMoreMenu = true; })
      }
      .width('100%')
      .height(60)
      .padding({ left: 20, right: 16 })
      WorkspaceToolbar({
        palette: this.pal(),
        connected: connected,
        botMode: this.botTabOpen,
        platformLabel: this.currentAgentPlatformLabel(),
        searchOpen: this.workspaceSearchOpen,
        onAgents: () => { this.botTabOpen = false; },
        onBots: () => {
          this.botTabOpen = true;
          this.workspaceSearchOpen = false;
          this.clearWorkspaceSearch();
          this.loadBotCatalog();
        },
        onSearch: () => {
          this.workspaceSearchOpen = !this.workspaceSearchOpen;
          if (!this.workspaceSearchOpen) {
            this.clearWorkspaceSearch();
          }
        },
        onOptions: () => { this.workspaceOptionsOpen = true; },
        onCreate: () => {
          this.workspacePathInput = '';
          this.workspaceNameDraft = '';
          this.workspaceCreateOpen = true;
        }
      })
      if (this.botTabOpen) {
        this.BotCatalogPage()
      } else {
      if (connected && this.workspaceSearchOpen) {
        Row({ space: 8 }) {
          TextInput({ text: this.sessionSearchInput, placeholder: this.tr('搜索会话…') })
            .layoutWeight(1)
            .height(36)
            .fontSize(this.fs(13))
            .backgroundColor(this.pal().inputBg)
            .fontColor(this.pal().text)
            .placeholderColor(this.pal().text3)
            .borderRadius(10)
            .border({ width: 1, color: this.pal().border })
            .padding({ left: 12, right: 12 })
            .onChange((value: string) => {
              this.sessionSearchInput = value;
              this.sessionSearchActive = value.trim().length > 0;
              // 每敲一个字就走一次中继 RPC 太贵（一次 400~600ms），加 250ms 防抖
              if (this.searchDebounceTimer >= 0) {
                clearTimeout(this.searchDebounceTimer);
              }
              this.searchDebounceTimer = setTimeout(() => {
                this.searchDebounceTimer = -1;
                this.runtime.searchSessions(this.sessionSearchInput);
              }, 250);
            })
          if (this.sessionSearchActive) {
            Text(this.tr('清除'))
              .fontSize(this.fs(12))
              .fontColor(this.pal().text3)
              .padding({ left: 10, right: 10, top: 6, bottom: 6 })
              .backgroundColor(this.pal().inputBg)
              .borderRadius(9)
              .border({ width: 1, color: this.pal().border })
              .onClick(() => {
                this.clearWorkspaceSearch();
              })
          }
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 4, bottom: 8 })
      }
      if (connected) {
      if (this.editingWorkspaceId.length > 0) {
        Row({ space: 8 }) {
          TextInput({ text: this.workspaceTitleInput, placeholder: this.tr('工作区名称') })
            .layoutWeight(1)
            .height(34)
            .fontSize(this.fs(12))
            .backgroundColor(this.pal().inputBg)
            .fontColor(this.pal().text)
            .borderRadius(9)
            .border({ width: 1, color: this.pal().border })
            .onChange((value: string) => {
              this.workspaceTitleInput = value;
            })
          Image($r('app.media.ic_check'))
            .width(18)
            .height(18)
            .fillColor(this.pal().success)
            .padding(2)
            .onClick(() => {
              this.runtime.renameWorkspace(this.editingWorkspaceId, this.workspaceTitleInput);
              this.editingWorkspaceId = '';
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 2, bottom: 6 })
      }
      if (this.visibleSessions().length === 0) {
        Column({ space: 6 }) {
          Text(this.sessionSearchActive ? this.tr('没有匹配的会话') : this.tr('还没有会话'))
            .fontSize(this.fs(12))
            .fontColor(this.pal().text3)
          if (!this.sessionSearchActive) {
            Text(this.tr('点右上角「新建」开一个'))
              .fontSize(this.fs(10))
              .fontColor(this.pal().text3)
          }
        }
        .width('100%')
        .padding({ top: 18, bottom: 12 })
        .alignItems(HorizontalAlign.Center)
      }
      List({ space: 8 }) {
        if (this.sessionSearchActive) {
          ForEach(this.visibleSessions(), (session: HarnessRemoteSession) => {
            ListItem() {
              this.SessionCatalogRow(session)
            }
          }, (session: HarnessRemoteSession) => session.sessionId)
        } else {
          ForEach(this.groupedSessions(), (folder: SessionFolder) => {
            if (this.sessionGroupBy === 'list') {
              ForEach(folder.sessions, (session: HarnessRemoteSession) => {
                ListItem() {
                  this.SessionCatalogRow(session)
                }
              }, (session: HarnessRemoteSession) => session.sessionId)
            } else {
              ListItemGroup({ header: this.SessionFolderHeader(folder) }) {
                if (this.sessionFolderExpanded(folder)) {
                  ForEach(folder.sessions, (session: HarnessRemoteSession) => {
                    ListItem() {
                      this.SessionCatalogRow(session)
                    }
                  }, (session: HarnessRemoteSession) => session.sessionId)
                }
              }
              .backgroundColor(this.pal().card)
              .borderRadius(22)
              .clip(true)
            }
          }, (folder: SessionFolder) => folder.key)
        }
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 12, right: 12, top: 10 })
      .scrollBar(BarState.Off)
      } else {
        Blank()
      }
      }
      Row({ space: 4 }) {
        Button({ type: ButtonType.Circle }) {
          Image($r('app.media.ic_host_stack')).width(17).height(17).fillColor(this.pal().text)
        }
        .width(30).height(32).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText(this.tr('主机详情'))
        .onClick(() => {
          if (connected) {
            this.deviceDetailId = this.connectedDeviceId;
          } else {
            this.hostSwitcherOpen = true;
          }
        })
        Row({ space: 6 }) {
          Text(connected ? this.connectedHostDisplay() : this.tr('切换主机'))
            .fontSize(13.5)
            .lineHeight(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
            .constraintSize({ maxWidth: '55%' })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Column().width(6).height(6).borderRadius(3)
            .backgroundColor(connected ? this.connectionDotColor() : this.pal().text3)
          Text(connected && !this.reconnecting ? this.tr('在线') : this.tr('未连接'))
            .fontSize(12).fontColor(this.pal().text2)
          Image($r('app.media.ic_chevron_up')).width(14).height(14).fillColor(this.pal().text2)
          Blank()
        }
        .layoutWeight(1)
        .height(36)
        .padding({ left: 8, right: 8 })
        .onClick(() => { this.hostSwitcherOpen = true; })
        Button({ type: ButtonType.Circle }) {
          Image($r('app.media.ic_settings')).width(17).height(17).fillColor(this.pal().text)
        }
        .width(34).height(34).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText(this.tr('设置'))
        .onClick(() => { this.showSettings = true; })
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 5, bottom: 5 })
      .backgroundColor(this.pal().bg)
      .border({ width: { top: 1 }, color: this.pal().border })
    }
    .width('100%')
    .height('100%')
  }

  private currentAgentPlatformLabel(): string {
    const sessionId: string = this.currentSessionId;
    if (sessionId.startsWith('codex:')) {
      return 'Codex';
    }
    if (sessionId.startsWith('claude:')) {
      return 'Claude';
    }
    if (sessionId.startsWith('cursor:')) {
      return 'Cursor';
    }
    if (sessionId.startsWith('opencode:')) {
      return 'OpenCode';
    }
    if (sessionId.startsWith('antigravity:')) {
      return 'Antigravity';
    }
    if (sessionId.startsWith('hermes:')) {
      return 'Hermes';
    }
    if (sessionId.startsWith('pi:')) {
      return 'Pi';
    }
    return 'DeepSeek';
  }

  private openCatalogSession(session: HarnessRemoteSession): void {
    this.closeDrawer();
    this.runtime.openSession(session.sessionId);
  }

  @Builder
  SessionCatalogRow(session: HarnessRemoteSession) {
    Row({ space: 6 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 6 }) {
          if (session.running) {
            Column().width(6).height(6).borderRadius(3).backgroundColor(this.pal().success)
          }
          Text(formatSessionTitle(session))
            .layoutWeight(1)
            .fontSize(this.fs(14))
            .fontColor(this.pal().text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (sessionBackendBadge(session.sessionId).length > 0) {
            Text(sessionBackendBadge(session.sessionId)).fontSize(10).fontColor(this.pal().text2)
          }
          if (this.runtime.draftOf(session.sessionId).length > 0) {
            Text(this.tr('草稿')).fontSize(10).fontColor(this.pal().text2)
          }
          Text(this.sessionAge(session.updatedAt))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
        }
        .width('100%')
      }
      .layoutWeight(1)
      .height(this.compactRows() ? 42 : 48)
      .padding(0)
      .backgroundColor(Color.Transparent)
      .onClick(() => { this.openCatalogSession(session); })
      .gesture(LongPressGesture().onAction(() => { this.openSessionMenu(session); }))
      .onMouse((event: MouseEvent) => {
        if (event.action === MouseAction.Press && event.button === MouseButton.Right) {
          this.openSessionMenu(session);
        }
      })
      Button({ type: ButtonType.Circle }) {
        Image($r('app.media.ic_more')).width(16).height(16).fillColor(this.pal().text2)
      }
      .width(32).height(36).padding(0)
      .backgroundColor(Color.Transparent)
      .accessibilityText(this.tr('更多'))
      .onClick(() => { this.openSessionMenu(session); })
    }
    .width('100%')
    .padding({ left: 26, right: 12 })
    .opacity(this.isArchivedSession(session.sessionId) ? 0.6 : 1)
    .border({ width: { top: 0.5 }, color: this.pal().border })
  }

  private sessionAge(timestamp: number): string {
    if (timestamp <= 0) {
      return '';
    }
    const minutes: number = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 60) {
      return minutes + (this.en() ? 'm' : '分');
    }
    const hours: number = Math.floor(minutes / 60);
    if (hours < 24) {
      return hours + (this.en() ? 'h' : '小时');
    }
    return Math.floor(hours / 24) + (this.en() ? 'd' : '天');
  }

  @Builder
  SessionFolderHeader(folder: SessionFolder) {
    Row({ space: 10 }) {
      Image($r('app.media.ic_folder')).width(19).height(19)
        .fillColor(this.sessionFolderExpanded(folder) ? this.pal().primary : this.pal().text2)
      Text(folder.title)
        .fontSize(this.fs(15))
        .fontWeight(FontWeight.Medium)
        .fontColor(this.pal().text)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(folder.sessions.length.toString())
        .fontSize(this.fs(11))
        .fontColor(this.pal().text2)
        .padding({ left: 7, right: 7, top: 3, bottom: 3 })
        .borderRadius(12)
        .backgroundColor(this.pal().chip)
      Blank()
      Image(this.sessionFolderExpanded(folder)
        ? $r('app.media.ic_chevron_down') : $r('app.media.ic_chevron_right'))
        .width(17)
        .height(17)
        .fillColor(this.pal().text2)
    }
    .width('100%')
    .height(48)
    .padding({ left: 16 + folder.depth * 14, right: 16 })
    .onClick(() => { this.toggleSessionFolder(folder); })
  }

  /**
   * 右栏会话详情（三栏模式常驻）：会话概览 + 模型/权限 + 上下文 + 快捷入口。
   * 内容与「齿轮」面板同源，但排成竖排窄栏，避免在超宽窗口里还要点开浮层。
   */
  @Builder
  InspectorPane() {
    Column({ space: 12 }) {
      Column({ space: 3 }) {
        Text(this.tr('会话详情'))
          .fontSize(this.fs(13))
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal().text)
          .width('100%')
        Text(this.currentSessionTitle.length > 0 ? this.currentSessionTitle : this.tr('新会话'))
          .fontSize(this.fs(11))
          .fontColor(this.pal().text3)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      // 上下文
      Column({ space: 4 }) {
        Row({ space: 8 }) {
          Text(this.tr('上下文'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
          Text(this.contextPercent > 0 ? `${this.contextPercent}%` : '—')
            .fontSize(this.fs(12))
            .fontWeight(FontWeight.Medium)
            .fontColor(this.contextPercent >= 80 ? this.pal().danger : this.pal().text)
        }
        .width('100%')
        Progress({ value: this.contextPercent, total: 100, type: ProgressType.Linear })
          .width('100%')
          .height(4)
          .color(this.contextPercent >= 80 ? this.pal().danger : this.pal().primary)
        if (this.contextPercent >= 60) {
          Text(this.tr('压缩上下文'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().primary)
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .backgroundColor(this.pal().primarySoft)
            .borderRadius(8)
            .onClick(() => {
              this.runtime.sendPrompt('/compact');
            })
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      // 模型
      Column({ space: 4 }) {
        Text(this.tr('模型'))
          .fontSize(this.fs(11))
          .fontColor(this.pal().text3)
          .width('100%')
        Text(this.modelSummary())
          .fontSize(this.fs(12))
          .fontColor(this.pal().text2)
          .maxLines(2)
          .width('100%')
        Text(this.tr('更换模型'))
          .fontSize(this.fs(11))
          .fontColor(this.pal().primary)
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .backgroundColor(this.pal().primarySoft)
          .borderRadius(8)
          .onClick(() => {
            this.runtime.refreshModelCatalog();
            this.showModelPicker = true;
          })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      // 权限：横向三个小 chip，省下竖排占掉的高度
      Column({ space: 4 }) {
        Text(this.tr('权限'))
          .fontSize(this.fs(11))
          .fontColor(this.pal().text3)
          .width('100%')
        Row({ space: 6 }) {
          ForEach(this.permissionChoices(), (preset: string) => {
            Text(this.permissionChoiceLabel(preset))
              .fontSize(this.fs(10))
              .fontColor(preset === this.permissionPreset ? this.pal().primary : this.pal().text2)
              .layoutWeight(1)
              .textAlign(TextAlign.Center)
              .padding({ top: 4, bottom: 4 })
              .backgroundColor(preset === this.permissionPreset ? this.pal().success : this.pal().inputBg)
              .borderRadius(8)
              .border({ width: 1, color: this.pal().border })
              .onClick(() => {
                this.runtime.selectPermission(preset);
              })
          }, (preset: string) => preset)
        }
        .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      // 定时任务摘要：最多两条，其余进面板看
      if (this.runtime.schedulesSupported && this.runtime.schedules.length > 0) {
        Column({ space: 4 }) {
          Row({ space: 6 }) {
            Text(this.tr('定时任务'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
            Blank()
            Text(this.runtime.schedules.length + this.tr(' 个'))
              .fontSize(this.fs(10))
              .fontColor(this.pal().text3)
              .onClick(() => {
                this.schedulesOpen = true;
              })
          }
          .width('100%')
          ForEach(this.runtime.schedules.slice(0, 2), (schedule: HarnessSchedule) => {
            Column({ space: 1 }) {
              Text(schedule.title.length > 0 ? schedule.title : schedule.id)
                .fontSize(this.fs(11))
                .fontColor(this.pal().text2)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
              Text(this.scheduleSummary(schedule))
                .fontSize(this.fs(9))
                .fontColor(this.pal().text3)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }, (schedule: HarnessSchedule) => 'insp-' + schedule.id)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }

      // 快捷入口
      Column({ space: 6 }) {
        Text(this.tr('快捷入口'))
          .fontSize(this.fs(11))
          .fontColor(this.pal().text3)
          .width('100%')
        Row({ space: 6 }) {
          Text(this.tr('定时任务'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text2)
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .backgroundColor(this.pal().inputBg)
            .borderRadius(8)
            .onClick(() => {
              this.schedulesOpen = true;
              this.runtime.loadSchedules();
            })
          Text(this.tr('诊断'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text2)
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .backgroundColor(this.pal().inputBg)
            .borderRadius(8)
            .onClick(() => {
              this.diagnosticsOpen = true;
            })
        }
        Row({ space: 6 }) {
          Text(this.tr('导出'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text2)
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .backgroundColor(this.pal().inputBg)
            .borderRadius(8)
            .onClick(() => {
              const data: pasteboard.PasteData = pasteboard.createData(
                pasteboard.MIMETYPE_TEXT_PLAIN, this.runtime.sessionMarkdown());
              pasteboard.getSystemPasteboard().setData(data).then(() => {
                promptAction.showToast({ message: this.tr('会话 Markdown 已复制') });
              }).catch(() => undefined);
            })
          Text(this.tr('归档'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().danger)
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .backgroundColor('rgba(248,87,73,0.10)')
            .borderRadius(8)
            .onClick(() => {
              this.runtime.archiveCurrentSession();
            })
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      Blank()
      Text(this.connectionSummary())
        .fontSize(this.fs(10))
        .fontColor(this.pal().text3)
        .maxLines(2)
        .width('100%')
    }
    .width(300)
    .padding({ left: 14, right: 14, top: 16, bottom: 16 })
    .margin({ right: 8, top: 8, bottom: 8 })
    .backgroundColor(this.pal().panel)
    .borderRadius(18)
    .border({ width: 1, color: this.pal().border })
    .alignItems(HorizontalAlign.Start)
    // 常驻栏没有「打开面板」这个动作，出现时自己补一次模型目录与权限状态
    .onAppear(() => {
      if (!this.runtime.modelCatalogLoaded) {
        this.runtime.refreshModelCatalog();
      }
      this.runtime.refreshPermissionState();
      this.runtime.loadSchedules();
    })
  }

  private openTerminalPage(): void {
    this.terminalSession = this.runtime.openTerminalSession(this.currentSessionId);
    if (this.terminalSession !== undefined) {
      this.terminalSessionId = this.currentSessionId;
      this.showSessionPanel = false;
      this.terminalOpen = true;
    }
  }

  private closeTerminalPage(): void {
    this.terminalOpen = false;
    this.terminalSession = undefined;
    this.terminalSessionId = '';
  }

  private activeSessionWorkspace(): HarnessWorkspace | undefined {
    return this.workspaces.find((item: HarnessWorkspace) => item.sessionIds.includes(this.currentSessionId));
  }

  private sessionFileRoot(): string {
    const workspace = this.activeSessionWorkspace();
    const session = this.sessions.find((item: HarnessRemoteSession) => item.sessionId === this.currentSessionId);
    return session?.cwd || workspace?.path || '';
  }

  private openWorkspaceFiles(path: string, sessionId: string = ''): void {
    this.browseRoot = path.replace(/\/+$/, '') || '/';
    this.browseSessionId = sessionId;
    this.showBrowser = true;
    this.browseFiles(this.browseRoot);
  }

  private browseFiles(path: string): void {
    if (path === this.browseRoot || path.startsWith(this.browsePrefix())) {
      const relativePath = path === this.browseRoot ? '' : path.substring(this.browsePrefix().length);
      this.runtime.browseDirectory(path, this.browseSessionId, relativePath);
    }
  }

  private browsePrefix(): string {
    return this.browseRoot === '/' ? '/' : this.browseRoot + '/';
  }

  private backFromFiles(): void {
    if (this.browsePath !== this.browseRoot && this.browsePath.startsWith(this.browsePrefix())) {
      const parent = this.browsePath.substring(0, this.browsePath.lastIndexOf('/')) || '/';
      this.browseFiles(parent);
    } else {
      this.showBrowser = false;
    }
  }

  @Builder
  FileBrowserOverlay() {
    Column() {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('文件'),
        onBack: () => { this.backFromFiles(); }
      })
        .margin({ left: 16, right: 16 })
      Row({ space: 12 }) {
        Text(this.browsePath !== this.browseRoot && this.browsePath.startsWith(this.browsePrefix())
          ? this.browsePath.substring(this.browsePrefix().length) : this.tr('根目录'))
          .fontSize(this.fs(15))
          .fontColor(this.pal().text)
          .layoutWeight(1)
          .maxLines(2)
        Image($r('app.media.ic_refresh'))
          .width(22)
          .height(22)
          .fillColor(this.pal().primary)
          .accessibilityText(this.tr('刷新'))
          .onClick(() => {
            this.browseFiles(this.browsePath.startsWith(this.browsePrefix())
              ? this.browsePath : this.browseRoot);
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      if (this.browseLoading) {
        LoadingProgress()
          .width(24)
          .height(24)
          .color(this.pal().primary)
          .margin(16)
      } else if (this.browseError.length > 0) {
        Text(this.browseError)
          .fontSize(this.fs(13))
          .fontColor(this.pal().danger)
          .width('100%')
          .padding(16)
      } else if (this.directoryEntries.length === 0) {
        Text(this.tr('目录为空'))
          .fontSize(this.fs(13))
          .fontColor(this.pal().text3)
          .width('100%')
          .padding(16)
      }
      List() {
        if (this.browsePath === this.browseRoot || this.browsePath.startsWith(this.browsePrefix())) {
          ForEach(this.sortedDirectoryEntries(), (entry: DirectoryEntry) => {
            ListItem() {
              Row({ space: 12 }) {
                Image(entry.isDirectory ? $r('app.media.ic_folder') : $r('app.media.ic_file'))
                  .width(22)
                  .height(22)
                  .fillColor(entry.isDirectory ? this.pal().primary : this.pal().text3)
                Text(entry.name)
                  .fontSize(this.fs(15))
                  .fontColor(this.pal().text)
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .width('100%')
              .height(56)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                const full: string = entry.path.length > 0 ? entry.path : ((this.browsePath === '/' ? '/' : this.browsePath + '/') + entry.name);
                if (entry.isDirectory) {
                  this.browseFiles(full);
                  return;
                }
                this.filePreviewOpen = true;
                this.openFilePreview(full);
              })
            }
          }, (entry: DirectoryEntry) => entry.path.length > 0 ? entry.path : entry.name)
        }
      }
      .divider({ strokeWidth: 0.5, color: this.pal().border, startMargin: 16, endMargin: 16 })
      .layoutWeight(1)
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().bg)
  }

  private sortedDirectoryEntries(): DirectoryEntry[] {
    return this.directoryEntries.slice().sort((a: DirectoryEntry, b: DirectoryEntry) =>
      Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  }

  /**
   * 顶栏齿轮面板：把「会话信息 / 模型 / 推理等级 / 权限 / 上下文 / 连接」收在一处。
   * 每一行都带当前值，点哪行改哪个；比原来的 ActionSheet 少一层猜测。
   */
  @Builder
  SessionPanelOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.showSessionPanel = false;
        })
      Column({ space: 8 }) {
        this.SheetTitle(this.tr('对话信息'), () => { this.showSessionPanel = false; })
        Scroll() {
          Column({ space: 0 }) {
            Text(this.currentSessionTitle || this.tr('新会话'))
              .fontSize(this.fs(16))
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal().text)
              .width('100%')
              .padding({ top: 4, bottom: 12 })
            Text(this.tr('工作区信息'))
              .fontSize(this.fs(13))
              .fontColor(this.pal().text3)
              .width('100%')
              .padding({ left: 16, top: 8, bottom: 4 })
            Column() {
              this.SettingsRow(this.tr('工作区'), this.activeSessionWorkspace()?.title || this.tr('默认'),
                false, undefined)
              this.SettingsRow(this.tr('工作区目录'), this.sessionFileRoot() || '—', false, undefined)
              this.SettingsRow(this.tr('连接状态'), this.connectionSummary(), false, undefined)
            }
            .width('100%')
            .backgroundColor(this.pal().card)
            .borderRadius(16)
            .clip(true)
            this.SettingsRow(this.tr('搜索本会话'), '', false, () => {
              this.showSessionPanel = false;
              this.inSessionQuery = '';
              this.inSessionSearchOpen = true;
            })
            if (this.sessionFileRoot().startsWith('/')) {
              this.SettingsRow(this.tr('文件'), '', false, () => {
                this.showSessionPanel = false;
                this.openWorkspaceFiles(this.sessionFileRoot(), this.currentSessionId);
              })
              if (this.runtime.supportsWorkspaceGit()) {
                this.SettingsRow(this.tr('工作区改动'), '', false, () => {
                  this.showSessionPanel = false;
                  this.workspaceGitOpen = true;
                  this.runtime.loadWorkspaceGitStatus();
                })
              }
            }

            this.SettingsRow(this.tr('终端'), '', false, () => { this.openTerminalPage(); })
            this.SettingsRow(
              this.trajectoryOpen ? this.tr('切换到对话模式') : this.tr('切换到轨迹模式'),
              '',
              false,
              () => {
                this.showSessionPanel = false;
                this.trajectoryOpen = !this.trajectoryOpen;
              }
            )

            // —— 模型 ——
            Row({ space: 10 }) {
              Column({ space: 3 }) {
                Text(this.tr('模型'))
                  .fontSize(this.fs(11))
                  .fontColor(this.pal().text3)
                Text(this.modelSummary())
                  .fontSize(this.fs(14))
                  .fontColor(this.pal().text)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Text(this.tr('更换'))
                .fontSize(this.fs(12))
                .fontColor(this.pal().primary)
                .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .backgroundColor(this.pal().primarySoft)
                .borderRadius(10)
                .onClick(() => {
                  this.showSessionPanel = false;
                  this.runtime.refreshModelCatalog();
                  this.showModelPicker = true;
                })
            }
            .width('100%')
            .padding({ left: 18, right: 18, top: 12, bottom: 12 })

            // —— 推理等级（当前模型有等级才显示）——
            if (this.currentModelEfforts().length > 0) {
              Column({ space: 6 }) {
                Text(this.tr('推理等级'))
                  .fontSize(this.fs(11))
                  .fontColor(this.pal().text3)
                  .width('100%')
                Scroll() {
                  Row({ space: 8 }) {
                    ForEach(this.currentModelEfforts(), (effort: string) => {
                      Text(effort)
                        .fontSize(this.fs(11))
                        .fontColor(effort === this.currentModelEffort ? this.pal().primary : this.pal().text2)
                        .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                        .backgroundColor(effort === this.currentModelEffort ? this.pal().primary : this.pal().inputBg)
                        .borderRadius(10)
                        .border({ width: 1, color: this.pal().border })
                        .onClick(() => {
                          this.runtime.selectModel(this.currentModelProvider, this.currentModelLabel, effort);
                        })
                    }, (effort: string) => effort)
                  }
                }
                .scrollable(ScrollDirection.Horizontal)
                .scrollBar(BarState.Off)
                .width('100%')
              }
              .width('100%')
              .padding({ left: 18, right: 18, top: 4, bottom: 12 })
            }

            this.SettingsRow(this.tr('审批模式'), this.permissionPickerTitle(this.permissionPreset), false, () => {
              this.runtime.refreshPermissionState();
              this.permissionPickerOpen = true;
            })

            // —— 上下文 ——
            Row({ space: 10 }) {
              Column({ space: 3 }) {
                Text(this.tr('上下文'))
                  .fontSize(this.fs(11))
                  .fontColor(this.pal().text3)
                Text(this.contextPercent > 0 ? `${this.contextPercent}%` : '—')
                  .fontSize(this.fs(14))
                  .fontColor(this.contextPercent >= 80 ? this.pal().danger : this.pal().text)
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Row({ space: 8 }) {
                Text(this.tr('导出'))
                  .fontSize(this.fs(12))
                  .fontColor(this.pal().text2)
                  .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                  .backgroundColor(this.pal().inputBg)
                  .borderRadius(10)
                  .onClick(() => {
                    const data: pasteboard.PasteData = pasteboard.createData(
                      pasteboard.MIMETYPE_TEXT_PLAIN, this.runtime.sessionMarkdown());
                    pasteboard.getSystemPasteboard().setData(data).then(() => {
                      promptAction.showToast({ message: this.tr('会话 Markdown 已复制') });
                    }).catch(() => {
                      promptAction.showToast({ message: this.tr('复制失败') });
                    });
                  })
                Text(this.tr('压缩上下文'))
                  .fontSize(this.fs(12))
                  .fontColor(this.pal().primary)
                  .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                  .backgroundColor(this.pal().primarySoft)
                  .borderRadius(10)
                  .onClick(() => {
                    this.showSessionPanel = false;
                    this.runtime.sendPrompt('/compact');
                  })
              }
              .alignItems(VerticalAlign.Center)
            }
            .width('100%')
            .padding({ left: 18, right: 18, top: 4, bottom: 12 })

            // —— 定时任务 ——
            Row({ space: 10 }) {
              Column({ space: 3 }) {
                Text(this.tr('定时任务'))
                  .fontSize(this.fs(11))
                  .fontColor(this.pal().text3)
                Text(this.runtime.schedules.length > 0
                  ? this.runtime.schedules.length + this.tr(' 个任务')
                  : this.tr('还没有'))
                  .fontSize(this.fs(12))
                  .fontColor(this.pal().text2)
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Text(this.tr('管理'))
                .fontSize(this.fs(12))
                .fontColor(this.pal().primary)
                .padding({ left: 10, right: 10, top: 4, bottom: 4 })
                .onClick(() => {
                  this.schedulesOpen = true;
                  this.runtime.loadSchedules();
                })
            }
            .width('100%')

            // —— 连接 ——
            Row({ space: 10 }) {
              Column({ space: 3 }) {
                Text(this.tr('连接状态'))
                  .fontSize(this.fs(11))
                  .fontColor(this.pal().text3)
                Text(this.connectionSummary())
                  .fontSize(this.fs(12))
                  .fontColor(this.pal().text2)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Text(this.tr('诊断'))
                .fontSize(this.fs(12))
                .fontColor(this.pal().primary)
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .onClick(() => {
                  this.diagnosticsOpen = true;
                })
              Text(this.tr('断开连接'))
                .fontSize(this.fs(12))
                .fontColor(this.pal().danger)
                .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .backgroundColor('rgba(248,87,73,0.10)')
                .borderRadius(10)
                .onClick(() => {
                  this.showSessionPanel = false;
                  this.runtime.disconnectAndClose();
                })
            }
            .width('100%')
            .padding({ left: 18, right: 18, top: 4, bottom: 18 })
          }
          .width('100%')
        }
        .width('100%')
        .scrollBar(BarState.Auto)
        .constraintSize({ maxHeight: '74%' })
      }
      .width('100%')
      .constraintSize({ maxWidth: 540, maxHeight: '80%' })
      .padding({ left: 16, right: 16, top: 12, bottom: 16 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 24, topRight: 24 })
      .border({ width: 1, color: this.pal().border })
    }
    .width('100%')
    .height('100%')
  }

  private chatModelLabel(): string {
    let name: string = this.currentModelLabel;
    for (const model of this.modelOptions) {
      if (model.model === this.currentModelLabel && model.provider === this.currentModelProvider) {
        name = model.name || name;
        break;
      }
    }
    const effort: string = this.currentModelEffort;
    return effort.length > 0 ? name + ' · ' + effort.charAt(0).toUpperCase() + effort.substring(1) : name;
  }

  /** 面板里的模型行文案：provider/model @effort。 */
  private modelSummary(): string {
    if (this.currentModelLabel.length === 0) {
      return this.runtime.modelCatalogLoaded ? this.tr('未选择') : this.tr('正在读取模型目录…');
    }
    const head: string = this.currentModelProvider.length > 0
      ? this.currentModelProvider + '/' + this.currentModelLabel
      : this.currentModelLabel;
    return this.currentModelEffort.length > 0 ? head + ' @' + this.currentModelEffort : head;
  }

  /** 当前模型支持哪些推理等级（从目录里找）。 */
  private currentModelEfforts(): string[] {
    for (const option of this.runtime.modelOptions) {
      if (option.model === this.currentModelLabel
        && (this.currentModelProvider.length === 0 || option.provider === this.currentModelProvider)) {
        return option.efforts;
      }
    }
    return [];
  }

  /** 主机报告的预设清单优先；没读到就退回内置三项。 */
  private permissionChoices(): string[] {
    if (this.permissionOptionsList.length > 0) {
      return this.permissionOptionsList;
    }
    return ['read-only', 'workspace-write', 'danger-full-access'];
  }

  private permissionChoiceLabel(preset: string): string {
    if (preset === 'read-only') {
      return this.tr('只读');
    }
    if (preset === 'workspace-write') {
      return this.tr('可写');
    }
    if (preset === 'danger-full-access') {
      return this.tr('完全');
    }
    return preset;
  }

  private permissionPickerTitle(preset: string): string {
    switch (preset) {
      case 'read-only': return this.tr('只读访问');
      case 'workspace-write': return this.tr('工作区写入');
      case 'danger-full-access': return this.tr('完全访问');
      default: return preset || '—';
    }
  }

  private permissionPickerDescription(preset: string): string {
    switch (preset) {
      case 'read-only': return this.tr('只读访问。修改文件或执行命令需要审批。');
      case 'workspace-write': return this.tr('允许在当前工作区修改文件和执行命令。更广的访问仍需审批。');
      case 'danger-full-access': return this.tr('修改文件和执行命令无需逐项审批。');
      default: return '';
    }
  }

  @Builder
  PermissionPickerOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column().width('100%').height('100%').backgroundColor(this.pal().backdrop)
        .onClick(() => { this.permissionPickerOpen = false; })
      Column({ space: 8 }) {
        this.SheetTitle(this.tr('审批模式'), () => { this.permissionPickerOpen = false; })
        Scroll() {
          Column({ space: 4 }) {
            ForEach(this.permissionChoices().filter((preset: string) => preset !== 'custom'), (preset: string) => {
              Row({ space: 12 }) {
                Column({ space: 4 }) {
                  Text(this.permissionPickerTitle(preset)).fontSize(this.fs(15)).fontColor(this.pal().text)
                  if (this.permissionPickerDescription(preset).length > 0) {
                    Text(this.permissionPickerDescription(preset)).fontSize(this.fs(12)).fontColor(this.pal().text2)
                  }
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)
                if (preset === this.permissionPreset) {
                  Image($r('app.media.ic_check'))
                    .width(18)
                    .height(18)
                    .fillColor(this.pal().primary)
                }
              }
              .width('100%')
              .padding({ left: 12, right: 12, top: 12, bottom: 12 })
              .backgroundColor(preset === this.permissionPreset ? this.pal().primarySoft : Color.Transparent)
              .borderRadius(12)
              .onClick(() => {
                this.permissionPickerOpen = false;
                this.runtime.selectPermission(preset);
              })
            }, (preset: string) => preset)
          }
          .width('100%')
        }
        .width('100%')
        .constraintSize({ maxHeight: '70%' })
        .scrollBar(BarState.Auto)
      }
      .width('100%')
      .constraintSize({ maxHeight: '70%' })
      .padding({ left: 16, right: 16, top: 12, bottom: 16 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%').height('100%')
  }

  /** 面板里的连接行：主机 + 数据面。 */
  private connectionSummary(): string {
    const host: string = this.connectedHostDisplay();
    const mode: string = this.transportBadgeText();
    if (host.length === 0) {
      return this.tr('未连接');
    }
    return mode.length > 0 ? host + ' · ' + mode : host;
  }

  private closeModelPicker(): void {
    this.pendingModel = undefined;
    this.showModelPicker = false;
  }

  private modelProviders(): string[] {
    return Array.from(new Set(this.modelOptions.map((option: ModelOption) => option.provider)));
  }

  @Builder
  ModelOptionRow(label: string, selected: boolean, onSelect: () => void, trailingChevron: boolean = false) {
    Row() {
      Text(label)
        .fontSize(this.fs(15))
        .fontColor(this.pal().text)
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (selected) {
        Image($r('app.media.ic_check'))
          .width(18)
          .height(18)
          .fillColor(this.pal().primary)
      } else if (trailingChevron) {
        Image($r('app.media.ic_chevron_right'))
          .width(17)
          .height(17)
          .fillColor(this.pal().text2)
      }
    }
    .width('100%')
    .height(44)
    .padding({ left: 12, right: 12 })
    .backgroundColor(selected ? this.pal().primarySoft : Color.Transparent)
    .borderRadius(12)
    .onClick(onSelect)
  }

  @Builder
  SheetTitle(title: string, onClose: () => void, back: boolean = false) {
    Row({ space: 8 }) {
      if (back) {
        Button({ type: ButtonType.Circle }) {
          Image($r('app.media.ic_arrow_left'))
            .width(18)
            .height(18)
            .fillColor(this.pal().text)
        }
          .width(36)
          .height(36)
          .fontSize(24)
          .padding(0)
          .backgroundColor(Color.Transparent)
          .accessibilityText(this.tr('返回'))
          .onClick(() => { this.pendingModel = undefined; })
      }
      Text(title)
        .fontSize(this.fs(17))
        .fontWeight(FontWeight.Bold)
        .fontColor(this.pal().text)
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Button({ type: ButtonType.Circle }) {
        Image($r('app.media.ic_close'))
          .width(20)
          .height(20)
          .fillColor(this.pal().text)
      }
        .width(40)
        .height(40)
        .padding(0)
        .backgroundColor(Color.Transparent)
        .accessibilityText(this.tr('关闭'))
        .onClick(onClose)
    }
    .width('100%')
  }

  @Builder
  ModelPickerOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => { this.closeModelPicker(); })
      Column({ space: 8 }) {
        if (this.pendingModel !== undefined) {
          this.SheetTitle(this.tr('推理等级'), () => { this.closeModelPicker(); }, true)
        } else {
          this.SheetTitle(this.tr('选择模型'), () => { this.closeModelPicker(); })
        }
        Scroll() {
          Column({ space: 8 }) {
            if (this.pendingModel !== undefined) {
              ForEach(this.pendingModel!.efforts, (effort: string) => {
                this.ModelOptionRow(effort, effort === this.currentModelEffort, () => {
                  const model = this.pendingModel;
                  if (model !== undefined) {
                    this.runtime.selectModel(model.provider, model.model, effort);
                    this.closeModelPicker();
                  }
                })
              }, (effort: string) => effort)
            } else if (this.modelOptions.length === 0) {
              Text(this.tr('模型目录为空'))
                .fontSize(this.fs(13))
                .fontColor(this.pal().text3)
            } else {
              ForEach(this.modelProviders(), (provider: string) => {
                Column() {
                  Text(provider)
                    .fontSize(this.fs(12))
                    .fontColor(this.pal().text3)
                    .width('100%')
                    .padding({ left: 12, top: 8, bottom: 4 })
                  ForEach(this.modelOptions.filter((option: ModelOption) => option.provider === provider),
                    (option: ModelOption) => {
                      this.ModelOptionRow(option.name || option.model,
                        option.provider === this.currentModelProvider && option.model === this.currentModelLabel,
                        () => {
                          const same = option.provider === this.currentModelProvider && option.model === this.currentModelLabel;
                          this.runtime.selectModel(option.provider, option.model, same ? this.currentModelEffort : '');
                          this.closeModelPicker();
                        })
                    }, (option: ModelOption) => option.model)
                }
              }, (provider: string) => provider)
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .constraintSize({ maxHeight: '78%' })
        .scrollBar(BarState.Auto)
        if (this.pendingModel === undefined && this.currentModelEfforts().length > 0) {
          this.ModelOptionRow(this.tr('推理等级') + ' · ' + (this.currentModelEffort || this.tr('默认')),
            false, () => {
              this.pendingModel = this.modelOptions.find((option: ModelOption) =>
                option.model === this.currentModelLabel && option.provider === this.currentModelProvider);
            }, true)
        }
      }
      .width('100%')
      .constraintSize({ maxHeight: '68%' })
      .padding({ left: 16, right: 16, top: 12, bottom: 16 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 24, topRight: 24 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
    }
    .width('100%')
    .height('100%')
  }

  /** Portrait: sessions slide in from the left over a scrim. */
  @Builder
  SessionsOverlay() {
    Stack({ alignContent: Alignment.Start }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .opacity(this.drawerOpen)
        .onClick(() => {
          this.closeDrawer();
        })
      Column() {
        this.SessionsPanelBody()
      }
      .width(this.drawerWidthVp())
      .height('100%')
      .backgroundColor(this.pal().bg)
      // 位移完全由手势进度决定：拉多少露多少，松手才补齐或弹回
      .translate({ x: (this.drawerOpen - 1) * this.drawerWidthVp() })
      .gesture(
        PanGesture({ direction: PanDirection.Horizontal, distance: 8 })
          .onActionStart(() => {
            this.drawerDragBase = this.drawerOpen;
            this.drawerDragFromChat = false;
          })
          .onActionUpdate((event: GestureEvent) => {
            if (this.drawerDragFromChat) {
              return;
            }
            const width: number = this.drawerWidthVp();
            this.drawerOpen = Math.min(1, Math.max(0, this.drawerDragBase + event.offsetX / width));
          })
          .onActionEnd(() => {
            this.settleDrawer(this.drawerOpen >= 0.55);
          })
      )
    }
    .width('100%')
    .height('100%')
  }

  /** Landscape: sessions stay pinned on the left next to the chat. */
  @Builder
  SessionsPane() {
    Column() {
      this.SessionsPanelBody()
    }
    .width(this.listPanelWidth())
    .margin({ left: 8, top: 8, bottom: 8 })
    .backgroundColor(this.pal().panel)
    .borderRadius(18)
    .border({ width: 1, color: this.pal().border })
    .clip(true)
  }

  @Builder
  MessageRow(item: ChatItem) {
    if (item.kind === 'user') {
      Row() {
        // Cap the user block, with the bubble and metadata stacked on its trailing edge.
        Column() {
          Column({ space: 6 }) {
            if (this.messageImages(item).length > 0) {
              Column({ space: 6 }) {
                ForEach(this.messageImages(item), (base64: string, index: number) => {
                  Image(imageDataUri(base64))
                    .width(168)
                    .height(168)
                    .borderRadius(10)
                    .objectFit(ImageFit.Cover)
                    .onClick(() => {
                      this.openPreview(imageDataUri(base64));
                    })
                }, (base64: string, index: number) => index + ':' + base64.length)
              }
            }
            if (item.text.length > 0) {
              if (this.heartbeatBody(item).length > 0) {
                Text(this.heartbeatOpen(item) ? item.text : this.heartbeatBody(item))
                  .fontSize(this.fs(this.heartbeatOpen(item) ? 12 : 15))
                  .fontColor(this.pal().text)
                  .textAlign(TextAlign.Start)
                Text(this.heartbeatOpen(item) ? this.tr('收起巡检原文') : this.tr('查看巡检原文'))
                  .fontSize(this.fs(11))
                  .fontColor('rgba(255,255,255,0.78)')
                  .padding({ top: 2, bottom: 2 })
                  .onClick(() => {
                    this.toggleHeartbeat(item);
                  })
              } else {
                Text(item.text)
                  .fontSize(this.fs(15))
                  .fontColor(this.pal().text)
                  .textAlign(TextAlign.Start)
              }
            }
            if (item.files.length > 0) {
              Column({ space: 4 }) {
                ForEach(item.files, (label: string, index: number) => {
                  Row({ space: 6 }) {
                    Image($r('app.media.ic_file'))
                      .width(14)
                      .height(14)
                    Text(label)
                      .fontSize(12)
                      .fontColor(this.pal().text)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .layoutWeight(1)
                  }
                  .width('100%')
                  .padding({ left: 8, right: 8, top: 5, bottom: 5 })
                  .backgroundColor(this.pal().chip)
                  .borderRadius(8)
                }, (label: string, index: number) => index + ':' + label)
              }
              .alignItems(HorizontalAlign.Start)
            }
          }
          .padding({ top: 10, bottom: 10, left: 14, right: 14 })
          .backgroundColor(this.pal().userBubble)
          .borderRadius({ topLeft: 18, topRight: 6, bottomLeft: 18, bottomRight: 18 })
          .alignItems(HorizontalAlign.Start)
          Row({ space: 4 }) {
            Blank()
            if (item.timestamp > 0) {
              Text(formatClock(item.timestamp)).fontSize(this.fs(10)).fontColor(this.pal().text3)
            }
            Button({ type: ButtonType.Circle }) {
              Image($r('app.media.ic_copy_response')).width(13).height(13).fillColor(this.pal().text3)
            }
            .width(28).height(28).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText(this.tr('复制'))
            .onClick(() => { this.copyResponse(this.bubbleText(item)); })
          }
          .width('100%')
        }
        .width('86%')
        .alignItems(HorizontalAlign.End)
        .gesture(LongPressGesture().onAction(() => {
          this.offerMessageActions(item);
        }))
        .onMouse((event: MouseEvent) => {
          if (event.action === MouseAction.Press && event.button === MouseButton.Right) {
            this.offerMessageActions(item);
          }
        })
        .onHover((isHover: boolean) => {
          // 鼠标（PC）停在气泡上才出快捷操作；触屏不走这里，行为不变
          this.hoverMessageId = isHover ? item.id : '';
        })
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
      if (this.hoverMessageId === item.id) {
        this.MessageQuickActions(item, true)
      }
    } else if (item.kind === 'assistant') {
      this.AssistantRow(item)
    } else if (item.kind === 'tool') {
      this.ToolRow(item)
    } else if (item.kind === 'toolrun') {
      this.ToolRunRow(item)
    } else if (item.kind === 'approval') {
      this.ApprovalRow(item)
    } else if (item.kind === 'question') {
      this.QuestionRow(item)
    } else if (item.kind === 'notice') {
      this.NoticeRow(item)
    }
  }

  /**
   * 失败/提醒行：上下文超窗、输出截断、主机拒绝等。
   * 以前这些在手机上完全看不到（turn/end 的 reason 被丢掉），现在固定占一行。
   */
  @Builder
  NoticeRow(item: ChatItem) {
    Row() {
      Row() {
        Column({ space: 6 }) {
          Row({ space: 6 }) {
            Text(item.noticeKind === 'error' ? '⚠' : '!')
              .fontSize(this.fs(13))
              .fontColor(item.noticeKind === 'error' ? this.pal().danger : '#F0A020')
            Text(this.tr(item.text))
              .fontSize(this.fs(13))
              .fontWeight(FontWeight.Medium)
              .fontColor(item.noticeKind === 'error' ? this.pal().danger : '#C88418')
              .textAlign(TextAlign.Start)
              .layoutWeight(1)
          }
          .alignItems(VerticalAlign.Top)
          if (item.reason.length > 0) {
            Text(this.tr(item.reason))
              .fontSize(this.fs(12))
              .fontColor(this.pal().text2)
              .textAlign(TextAlign.Start)
          }
          if (item.actionCommand.length > 0) {
            Button(this.tr('压缩上下文'))
              .height(30)
              .fontSize(this.fs(12))
              .padding({ left: 14, right: 14 })
              .backgroundColor(this.pal().chip)
              .fontColor(this.pal().text)
              .borderRadius(15)
              .enabled(!this.generating && !this.busy)
              .onClick(() => {
                this.runtime.sendPrompt(item.actionCommand);
              })
          }
        }
        .padding({ top: 10, bottom: 10, left: 14, right: 14 })
        .backgroundColor(this.pal().inputBg)
        .borderRadius(14)
        .border({ width: 1, color: item.noticeKind === 'error' ? 'rgba(248,87,73,0.35)' : 'rgba(240,160,32,0.35)' })
        .alignItems(HorizontalAlign.Start)
      }
      .width('88%')
      .constraintSize({ maxWidth: 780 })
      .justifyContent(FlexAlign.Start)
    }
    .width('100%')
  }

  /** 轻量 Markdown 渲染：代码块、标题、行内代码与粗体标记不再裸露。 */
  @Builder
  MarkdownText(text: string, streaming: boolean) {
    Column({ space: 5 }) {
      ForEach(markdownLines(streaming ? text + '▍' : text), (line: MdLine, index: number) => {
        if (line.table.length > 0) {
          this.MarkdownTable(line.table, line.columnWidths)
        } else if (line.imageSrc.length > 0) {
          this.MdImage(line)
        } else if (line.code) {
          Text(line.text)
            .fontSize(this.fs(12))
            .fontFamily('monospace')
            .fontColor(this.pal().text2)
            .width('100%')
            .padding(8)
            .backgroundColor(this.pal().inputBg)
            .borderRadius(6)
            .wordBreak(WordBreak.BREAK_ALL)
            .textAlign(TextAlign.Start)
            // 代码行：可选中，也可以长按整行复制（子组件的长按优先于消息菜单）
            .copyOption(CopyOptions.LocalDevice)
            .gesture(LongPressGesture().onAction(() => {
              const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, line.text);
              pasteboard.getSystemPasteboard().setData(data).then(() => {
                promptAction.showToast({ message: this.tr('已复制该行') });
              }).catch(() => undefined);
            }))
        } else if (line.bullet) {
          Row({ space: 6 }) {
            Text('·')
              .fontSize(this.fs(15))
              .fontColor(this.pal().text3)
            Text(line.text)
              .fontSize(this.fs(15))
              .fontColor(this.pal().text)
              .layoutWeight(1)
              .wordBreak(WordBreak.BREAK_ALL)
              .textAlign(TextAlign.Start)
          }
          .width('100%')
        } else if (line.linkUrl.length > 0) {
          Text(line.text)
            .fontSize(this.fs(15))
            .fontColor(this.pal().primary)
            .decoration({ type: TextDecorationType.Underline, color: this.pal().primary })
            .width('100%')
            .textAlign(TextAlign.Start)
            .onClick(() => {
              const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
              context.openLink(line.linkUrl).catch(() => {
                promptAction.showToast({ message: this.tr('无法打开链接') });
              });
            })
        } else {
          Text(line.text)
            .fontSize(line.heading ? 17 : 15)
            .fontWeight(line.heading ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(this.pal().text)
            .width('100%')
            .wordBreak(WordBreak.NORMAL)
            .textAlign(TextAlign.Start)
            .copyOption(CopyOptions.LocalDevice)
        }
      }, (line: MdLine, index: number) => line.table.length > 0
        ? index + ':' + JSON.stringify(line.table) : index.toString())
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  MarkdownTable(rows: string[][], widths: number[]) {
    Scroll() {
      Column() {
        ForEach(rows, (cells: string[], rowIndex: number) => {
          Row() {
            ForEach(cells, (cell: string, columnIndex: number) => {
              Text(cell)
                .fontSize(this.fs(14))
                .fontColor(this.pal().text)
                .fontWeight(rowIndex === 0 ? FontWeight.Bold : FontWeight.Normal)
                .width(widths[columnIndex])
                .padding(8)
                .wordBreak(WordBreak.BREAK_WORD)
                .copyOption(CopyOptions.LocalDevice)
            }, (cell: string, columnIndex: number) => columnIndex.toString())
          }
          .alignItems(VerticalAlign.Top)
          .backgroundColor(rowIndex === 0 ? this.pal().inputBg : Color.Transparent)
          .border({ width: { bottom: 1 }, color: this.pal().border })
        }, (cells: string[], rowIndex: number) => rowIndex.toString())
      }
    }
    .width('100%')
    .align(Alignment.Start)
    .scrollable(ScrollDirection.Horizontal)
  }

  /** 点开图片：全屏查看，双指缩放 / 拖动 / 双击复位。 */
  private openPreview(src: string): void {
    if (!isRemoteImage(src) && !this.images.has(src)) {
      // 慢链路下 300ms 定时器会落空，改成立即开、overlay 自己显示 loading
      this.loadMdImage(src);
    }
    this.previewSrc = src;
    this.previewScale = 1;
    this.previewOffsetX = 0;
    this.previewOffsetY = 0;
    this.previewActive = true;
  }

  /** 读一下 imageVersion，让预览层在图片解码完成后自动重建。 */
  private previewReady(): boolean {
    const version: number = this.imageVersion;
    return this.images.has(this.previewSrc);
  }

  @Builder
  ImagePreviewOverlay() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.92)')
        .onClick(() => {
          this.previewActive = false;
        })
      if (isRemoteImage(this.previewSrc)) {
        Image(this.previewSrc)
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Contain)
          .scale({ x: this.previewScale, y: this.previewScale })
          .translate({ x: this.previewOffsetX, y: this.previewOffsetY })
          .gesture(
            GestureGroup(GestureMode.Parallel,
              PinchGesture({ fingers: 2 })
                .onActionUpdate((event: GestureEvent) => {
                  this.previewScale = Math.min(6, Math.max(1, event.scale));
                })
                .onActionEnd(() => {
                  if (this.previewScale <= 1.02) {
                    this.previewScale = 1;
                    this.previewOffsetX = 0;
                    this.previewOffsetY = 0;
                  }
                }),
              PanGesture()
                .onActionUpdate((event: GestureEvent) => {
                  if (this.previewScale <= 1) {
                    return;
                  }
                  this.previewOffsetX = this.previewOffsetX + event.offsetX;
                  this.previewOffsetY = this.previewOffsetY + event.offsetY;
                }),
              TapGesture({ count: 2 })
                .onAction(() => {
                  const doubled: boolean = this.previewScale > 1.05;
                  this.previewScale = doubled ? 1 : 2.5;
                  this.previewOffsetX = 0;
                  this.previewOffsetY = 0;
                })
            )
          )
      } else if (this.previewReady()) {
        Image(this.images.pixel(this.previewSrc))
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Contain)
          .scale({ x: this.previewScale, y: this.previewScale })
          .translate({ x: this.previewOffsetX, y: this.previewOffsetY })
          .gesture(
            GestureGroup(GestureMode.Parallel,
              PinchGesture({ fingers: 2 })
                .onActionUpdate((event: GestureEvent) => {
                  this.previewScale = Math.min(6, Math.max(1, event.scale));
                })
                .onActionEnd(() => {
                  if (this.previewScale <= 1.02) {
                    this.previewScale = 1;
                    this.previewOffsetX = 0;
                    this.previewOffsetY = 0;
                  }
                }),
              PanGesture()
                .onActionUpdate((event: GestureEvent) => {
                  if (this.previewScale <= 1) {
                    return;
                  }
                  this.previewOffsetX = this.previewOffsetX + event.offsetX;
                  this.previewOffsetY = this.previewOffsetY + event.offsetY;
                }),
              TapGesture({ count: 2 })
                .onAction(() => {
                  const doubled: boolean = this.previewScale > 1.05;
                  this.previewScale = doubled ? 1 : 2.5;
                  this.previewOffsetX = 0;
                  this.previewOffsetY = 0;
                })
            )
          )
      }
      if (!isRemoteImage(this.previewSrc) && !this.previewReady()) {
        Column({ space: 10 }) {
          LoadingProgress()
            .width(28)
            .height(28)
            .color(this.pal().primary)
          Text(this.images.errorOf(this.previewSrc).length > 0
            ? this.tr('图片加载失败')
            : this.tr('图片加载中…'))
            .fontSize(this.fs(12))
            .fontColor('rgba(255,255,255,0.75)')
        }
        .hitTestBehavior(HitTestMode.None)
      }
      // 顶部：路径 + 关闭
      Row({ space: 10 }) {
        Text(this.previewSrc)
          .fontSize(this.fs(11))
          .fontColor('rgba(255,255,255,0.75)')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text('关闭')
          .fontSize(this.fs(13))
          .fontColor('#FFFFFF')
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor('rgba(255,255,255,0.18)')
          .borderRadius(14)
          .onClick(() => {
            this.previewActive = false;
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 14 })
      .position({ x: 0, y: this.topInset + 8 })
    }
    .width('100%')
    .height('100%')
  }

  /** 消息里的图片：远端链接直接交给 Image，主机本地路径走 workspaceFiles/readBytes。 */
  @Builder
  MdImage(line: MdLine) {
    Column({ space: 4 }) {
      if (isRemoteImage(line.imageSrc)) {
        Image(line.imageSrc)
          .width('100%')
          .constraintSize({ maxHeight: 420 })
          .objectFit(ImageFit.Contain)
          .borderRadius(10)
          .border({ width: 1, color: this.pal().border })
          .onClick(() => {
            this.openPreview(line.imageSrc);
          })
      } else if (this.images.has(line.imageSrc)) {
        Image(this.images.pixel(line.imageSrc))
          .width('100%')
          .constraintSize({ maxHeight: 420 })
          .objectFit(ImageFit.Contain)
          .borderRadius(10)
          .border({ width: 1, color: this.pal().border })
          .onClick(() => {
            this.openPreview(line.imageSrc);
          })
      } else if (this.images.errorOf(line.imageSrc).length > 0) {
        Row({ space: 8 }) {
          Image($r('app.media.ic_image'))
            .width(18)
            .height(18)
          Column({ space: 2 }) {
            Text(t('图片加载失败'))
              .fontSize(12)
              .fontColor(this.pal().text2)
            Text(line.imageSrc)
              .fontSize(10)
              .fontColor(this.pal().text3)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Text(t('重试'))
            .fontSize(11)
            .fontColor(this.pal().primary)
            .onClick(() => {
              this.images.forget(line.imageSrc);
              this.loadMdImage(line.imageSrc);
            })
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .padding({ left: 10, right: 10, top: 10, bottom: 10 })
        .backgroundColor(this.pal().chip)
        .borderRadius(10)
      } else {
        Row({ space: 8 }) {
          LoadingProgress()
            .width(14)
            .height(14)
            .color(this.pal().primary)
          Text(t('图片加载中…'))
            .fontSize(11)
            .fontColor(this.pal().text3)
        }
        .width('100%')
        .padding(10)
        .backgroundColor(this.pal().chip)
        .borderRadius(10)
      }
      if (line.imageAlt.length > 0) {
        Text(line.imageAlt)
          .fontSize(10)
          .fontColor(this.pal().text3)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .onAppear(() => {
      this.loadMdImage(line.imageSrc);
    })
  }

  /** 懒加载：只对主机本地路径发请求，远端链接由 Image 自己拉。 */
  private loadMdImage(src: string): void {
    if (src.length === 0 || isRemoteImage(src)) {
      return;
    }
    if (this.images.has(src) || this.images.isPending(src)) {
      return;
    }
    this.images.markPending(src);
    this.runtime.readImageBase64(src).then((base64: string) => {
      if (base64.length === 0) {
        throw new Error('empty');
      }
      return decodeBase64Image(base64);
    }).then((pixel: PixelMap) => {
      this.images.put(src, pixel);
      this.imageVersion = this.imageVersion + 1;
    }).catch((error: Error) => {
      this.images.fail(src, errorMessage(error));
      this.imageVersion = this.imageVersion + 1;
    });
  }

  /** 会话行菜单：收藏 / 置顶 / 复制标题 / 复制为 Markdown / 归档或取消归档。 */
  private openSessionMenu(session: HarnessRemoteSession): void {
    ActionSheet.show({
    title: formatSessionTitle(session),
    message: session.cwd.length > 0 ? session.cwd : session.sessionId,
    sheets: [
      {
        title: this.runtime.isFavoriteSession(session.sessionId) ? this.tr('取消收藏') : this.tr('收藏'),
        action: () => {
          this.runtime.toggleFavoriteSession(session.sessionId);
        }
      },
      {
        title: this.isPinnedSession(session.sessionId)
          ? this.tr('取消置顶') : this.tr('置顶'),
        action: () => {
          this.runtime.togglePinSession(session.sessionId);
        }
      },
      {
        title: this.tr('复制标题'),
        action: () => {
          const data: pasteboard.PasteData = pasteboard.createData(
            pasteboard.MIMETYPE_TEXT_PLAIN, formatSessionTitle(session));
          pasteboard.getSystemPasteboard().setData(data).then(() => {
            promptAction.showToast({ message: this.tr('已复制标题') });
          }).catch(() => undefined);
        }
      },
      {
        title: this.tr('复制为 Markdown'),
        action: () => {
          this.closeDrawer();
          this.runtime.sessionMarkdownFor(session.sessionId).then((markdown: string) => {
            if (markdown.length === 0) {
              promptAction.showToast({ message: this.tr('这张会话还没有内容') });
              return;
            }
            const data: pasteboard.PasteData = pasteboard.createData(
              pasteboard.MIMETYPE_TEXT_PLAIN, markdown);
            pasteboard.getSystemPasteboard().setData(data).then(() => {
              promptAction.showToast({ message: this.tr('会话 Markdown 已复制') });
            }).catch(() => {
              promptAction.showToast({ message: this.tr('复制失败') });
            });
          }).catch(() => {
            promptAction.showToast({ message: this.tr('导出失败') });
          });
        }
      },
      {
        title: this.isArchivedSession(session.sessionId)
          ? this.tr('取消归档') : this.tr('归档会话'),
        action: () => {
          if (this.isArchivedSession(session.sessionId)) {
            this.runtime.unarchiveSession(session.sessionId);
          } else {
            this.runtime.archiveSession(session.sessionId);
          }
        }
      }
    ]
    });
  }

  /** PC 鼠标悬停时贴在气泡下方的快捷操作（复制 / 引用 / 分叉）。 */
  @Builder
  MessageQuickActions(item: ChatItem, alignEnd: boolean) {
    Row({ space: 6 }) {
      Text(this.tr('复制'))
        .fontSize(this.fs(10))
        .fontColor(this.pal().text3)
        .padding({ left: 7, right: 7, top: 2, bottom: 2 })
        .backgroundColor(this.pal().chip)
        .borderRadius(7)
        .onClick(() => {
          const data: pasteboard.PasteData = pasteboard.createData(
            pasteboard.MIMETYPE_TEXT_PLAIN, item.text);
          pasteboard.getSystemPasteboard().setData(data).then(() => {
            promptAction.showToast({ message: this.tr('已复制') });
          }).catch(() => undefined);
        })
      if (item.text.length > 0) {
        Text(this.tr('引用'))
          .fontSize(this.fs(10))
          .fontColor(this.pal().text3)
          .padding({ left: 7, right: 7, top: 2, bottom: 2 })
          .backgroundColor(this.pal().chip)
          .borderRadius(7)
          .onClick(() => {
            const quoted: string = item.text.split('\n')
              .map((line: string) => '> ' + line).join('\n') + '\n\n';
            this.promptInput = quoted + this.promptInput;
            this.runtime.saveDraft(this.currentSessionId, this.promptInput);
            promptAction.showToast({ message: this.tr('已引用到输入框') });
          })
      }
      if (item.text.length > 0) {
        Text(this.tr('分享'))
          .fontSize(this.fs(10))
          .fontColor(this.pal().text3)
          .padding({ left: 7, right: 7, top: 2, bottom: 2 })
          .backgroundColor(this.pal().chip)
          .borderRadius(7)
          .onClick(() => {
            this.shareText(this.runtime.shareCardText(item));
          })
      }
      if (item.seq > 0 && this.runtime.currentSessionId.length > 0) {
        Text(this.tr('分叉'))
          .fontSize(this.fs(10))
          .fontColor(this.pal().text3)
          .padding({ left: 7, right: 7, top: 2, bottom: 2 })
          .backgroundColor(this.pal().chip)
          .borderRadius(7)
          .onClick(() => {
            this.runtime.forkCurrentSession(item.seq);
          })
      }
    }
    .width('100%')
    .justifyContent(alignEnd ? FlexAlign.End : FlexAlign.Start)
    .padding({ top: 2 })
  }

  /** 长按消息：复制正文 / 从这里分叉（分叉不再占用长按默认动作）。 */
  private offerMessageActions(item: ChatItem): void {
    this.messageActionText = item.text.length > 0 ? item.text : item.summary;
    this.messageActionKind = item.kind;
    this.messageActionSeq = item.seq;
    this.messageActionTime = item.timestamp;
    this.messageActionCode = extractCodeBlocks(item.text);
    this.messageActionsOpen = true;
  }

  private releasePdfPreview(): void {
    ++this.pdfRequest;
    this.pdfController?.releaseDocument();
    this.pdfController = undefined;
    this.pdfPage = 0;
    this.pdfPages = 0;
    this.pdfZoom = 1;
  }

  private closeFilePreview(): void {
    this.filePreviewOpen = false;
    this.runtime.cancelTextPreview();
    if (this.previewIsPdf) {
      this.releasePdfPreview();
      this.runtime.filePreviewLoading = false;
    }
  }

  /** PDF 交给系统 PDF Kit，其它文件按文本预览。 */
  private openFilePreview(path: string, offset: number = 1): void {
    this.releasePdfPreview();
    const request: number = this.pdfRequest;
    const lowerPath = path.toLowerCase();
    this.previewIsOffice = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx']
      .some((extension: string) => lowerPath.endsWith(extension));
    this.previewIsPdf = lowerPath.endsWith('.pdf') || this.previewIsOffice;
    this.pdfError = '';
    if (!this.previewIsPdf) {
      const requestPath = this.browseSessionId.length > 0 && path.startsWith(this.browsePrefix())
        ? path.substring(this.browsePrefix().length) : path;
      this.runtime.previewFile(path, requestPath, offset);
      return;
    }
    this.runtime.cancelTextPreview();
    this.runtime.filePreviewPath = path;
    this.runtime.filePreviewLoading = true;
    this.runtime.filePreviewError = '';
    this.runtime.notify();
    const source = this.previewIsOffice
      ? this.runtime.readOfficePdfBuffer(path)
      : this.runtime.readFileBuffer(path);
    source.then(async (buffer: ArrayBuffer) => {
      if (request !== this.pdfRequest) {
        return;
      }
      const controller: pdfViewManager.PdfController = new pdfViewManager.PdfController();
      try {
        const result: pdfService.ParseResult = await controller.loadDocumentFromMemory(buffer);
        if (request !== this.pdfRequest || result !== pdfService.ParseResult.PARSE_SUCCESS) {
          if (request !== this.pdfRequest) {
            controller.releaseDocument();
            return;
          }
          throw new Error(String(result));
        }
        controller.setPageContinuous(false);
        controller.setDisplayDirection(pdfViewManager.DisplayDirection.HORIZONTAL);
        controller.registerPageChangedListener((page: number) => {
          if (request === this.pdfRequest) this.pdfPage = page;
        });
        controller.registerScaleChangedListener((zoom: number) => {
          if (request === this.pdfRequest) this.pdfZoom = zoom;
        });
        this.pdfPages = controller.getPageCount();
        this.pdfPage = controller.getPageIndex();
        this.pdfZoom = controller.getPageZoom();
        this.pdfController = controller;
      } catch (error) {
        controller.releaseDocument();
        throw new Error(errorMessage(error));
      }
      this.runtime.filePreviewLoading = false;
      this.runtime.notify();
    }).catch((error: Error) => {
      if (request !== this.pdfRequest) return;
      this.pdfError = error.message;
      this.runtime.filePreviewLoading = false;
      this.runtime.notify();
    });
  }

  private turnPdfPage(delta: number): void {
    const page: number = this.pdfPage + delta;
    if (page >= 0 && page < this.pdfPages) {
      this.pdfController?.goToPage(page);
    }
  }

  private zoomPdf(factor: number): void {
    const controller: pdfViewManager.PdfController | undefined = this.pdfController;
    if (controller !== undefined) {
      controller.setPageZoom(Math.max(0.1, Math.min(10, controller.getPageZoom() * factor)));
    }
  }

  @Builder
  PdfTool(symbol: string, label: string, enabled: boolean, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      if (symbol === '‹') {
        Image($r('app.media.ic_arrow_left')).width(20).height(20).fillColor(this.pal().text)
      } else if (symbol === '›') {
        Image($r('app.media.ic_arrow_right')).width(20).height(20).fillColor(this.pal().text)
      } else {
        Text(symbol).fontSize(22).fontColor(this.pal().text)
      }
    }
      .width(56)
      .height(48)
      .padding(0)
      .backgroundColor(Color.Transparent)
      .opacity(enabled ? 1 : 0.36)
      .accessibilityText(this.tr(label))
      .enabled(enabled)
      .onClick(action)
  }

  private copyActionText(): void {
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.messageActionText);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      promptAction.showToast({ message: this.tr('已复制') });
    }).catch(() => {
      promptAction.showToast({ message: this.tr('复制失败') });
    });
  }

  private copyResponse(text: string): void {
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      promptAction.showToast({ message: this.tr('已复制') });
    }).catch(() => {
      promptAction.showToast({ message: this.tr('复制失败') });
    });
  }

  @Builder
  AssistantRow(item: ChatItem) {
    Row() {
      // A definite-width inner row gives prose a hard wrap budget; the inner
      // Texts carry no percentage width so they can never stretch past the row.
      Row() {
        Column({ space: 6 }) {
          if (item.turnCompleted && !item.streaming) {
            Text(this.tr('已完成'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
              .padding({ bottom: 5 })
          }
          if (item.reasoning.length > 0) {
            Text(item.reasoning)
              .fontSize(this.fs(12))
              .fontColor(this.pal().text2)
              .maxLines(8)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .textAlign(TextAlign.Start)
          }
          if (item.text.length > 0 && this.heartbeatBody(item).length > 0) {
            // 巡检心跳：默认只显示可读正文，标签原文折叠起来
            this.MarkdownText(this.heartbeatOpen(item) ? item.text : this.heartbeatBody(item),
              item.streaming)
            Text(this.heartbeatOpen(item) ? this.tr('收起巡检原文') : this.tr('查看巡检原文'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().primary)
              .padding({ top: 2, bottom: 2 })
              .onClick(() => {
                this.toggleHeartbeat(item);
              })
          } else if (item.text.length > 0) {
            // 敏感内容（Key/Token）默认打码，点一下看原文
            if (this.showsMaskedHint(item)) {
              Text(this.tr('已遮挡敏感内容 · 点此看原文'))
                .fontSize(this.fs(10))
                .fontColor(this.pal().primary)
                .padding({ top: 2, bottom: 2 })
                .onClick(() => {
                  this.revealedSecrets = this.revealedSecrets.concat([item.id]);
                })
            }
            // 长回复先折叠到 18 行，避免一条消息把整屏占满
            if (this.isLongCollapsed(item)) {
              this.MarkdownText(this.collapseText(this.bubbleText(item)), item.streaming)
              Text(this.tr('展开全文') + ' · ' + this.textLineCount(item.text) + this.tr(' 行'))
                .fontSize(this.fs(11))
                .fontColor(this.pal().primary)
                .padding({ top: 2, bottom: 2 })
                .onClick(() => {
                  this.expandedMessages = this.expandedMessages.concat([item.id]);
                })
            } else {
              this.MarkdownText(this.bubbleText(item), item.streaming)
            }
          }
          if (!item.streaming && item.text.length > 0) {
            ResponseActions({
              palette: this.pal(),
              time: item.timestamp > 0 ? formatClock(item.timestamp) : '',
              usage: item.totalTokens >= 0 ? AppRuntime.tokensText(item.totalTokens) : '',
              canBranch: item.seq > 0 && !this.generating && !this.reconnecting,
              onCopy: () => { this.copyResponse(this.bubbleText(item)); },
              onBranch: () => { this.runtime.forkCurrentSession(item.seq); }
            })
          }
          if (item.streaming && item.text.length === 0 && item.reasoning.length === 0) {
            Row({ space: 8 }) {
              LoadingProgress()
                .width(14)
                .height(14)
                .color(this.pal().primary)
              Text('正在思考…')
                .fontSize(this.fs(12))
                .fontColor(this.pal().text2)
            }
          }
        }
        .padding({ top: 4, bottom: 6 })
        .alignItems(HorizontalAlign.Start)
        .gesture(LongPressGesture().onAction(() => {
          this.offerMessageActions(item);
        }))
        .onMouse((event: MouseEvent) => {
          if (event.action === MouseAction.Press && event.button === MouseButton.Right) {
            this.offerMessageActions(item);
          }
        })
      }
      .width('100%')
      .constraintSize({ maxWidth: 780 })
      .justifyContent(FlexAlign.Start)
    }
    .width('100%')
    .justifyContent(FlexAlign.Start)
  }

  /** 消息操作：底部面板，带原文预览和图标行，替代黑白的系统 ActionSheet。 */
  @Builder
  MessageActionRow(icon: string, label: string, danger: boolean, action: () => void) {
    Row({ space: 12 }) {
      Text(icon)
        .fontSize(this.fs(14))
        .width(22)
        .textAlign(TextAlign.Center)
        .fontColor(danger ? this.pal().danger : this.pal().primary)
      Text(label)
        .fontSize(this.fs(14))
        .fontColor(danger ? this.pal().danger : this.pal().text)
        .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 11, bottom: 11 })
    .backgroundColor(this.pal().card)
    .borderRadius(12)
    .border({ width: 1, color: danger ? 'rgba(248,87,73,0.35)' : this.pal().border })
    .onClick(() => {
      action();
    })
  }

  @Builder
  MessageActionsOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.messageActionsOpen = false;
        })
      Column({ space: 8 }) {
        this.SheetTitle(this.tr('消息操作'), () => { this.messageActionsOpen = false; })
        // 原文预览：两行就够，让人确认点的是哪条
        if (this.messageActionText.length > 0) {
          Text(this.messageActionText)
            .fontSize(this.fs(12))
            .fontColor(this.pal().text2)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
            .padding({ left: 12, right: 12, top: 10, bottom: 10 })
            .backgroundColor(this.pal().inputBg)
            .borderRadius(12)
            .border({ width: { left: 3 }, color: this.pal().primary })
        }

        this.MessageActionRow('⧉', this.tr('复制文本'), false, () => {
          this.copyActionText();
          this.messageActionsOpen = false;
        })
        if (this.messageActionCode.length > 0) {
          this.MessageActionRow('{}', this.tr('复制代码块'), false, () => {
            const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.messageActionCode);
            pasteboard.getSystemPasteboard().setData(data).then(() => {
              promptAction.showToast({ message: this.tr('已复制代码') });
            }).catch(() => undefined);
            this.messageActionsOpen = false;
          })
        }
        this.MessageActionRow('❝', this.tr('引用到输入框'), false, () => {
          const quoted: string = this.messageActionText.split('\n')
            .map((line: string) => '> ' + line).join('\n') + '\n\n';
          this.promptInput = quoted + this.promptInput;
          this.runtime.saveDraft(this.currentSessionId, this.promptInput);
          this.messageActionsOpen = false;
        })
        if (this.messageActionSeq > 0 && this.runtime.currentSessionId.length > 0) {
          this.MessageActionRow('⑂', this.tr('从这里分叉'), false, () => {
            this.runtime.forkCurrentSession(this.messageActionSeq);
            this.messageActionsOpen = false;
          })
        }
      }
      .width('100%')
      .constraintSize({ maxWidth: 360 })
      .padding({ left: 14, right: 14, top: 12, bottom: 16 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 300 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 200, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /** 文本文件预览：主机上读回来直接显示，二进制给提示。 */
  @Builder
  WorkspaceGitOverlay() {
    Column() {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('工作区改动'),
        onBack: () => {
          this.workspaceGitOpen = false;
          this.workspaceGitDiffPath = '';
          this.workspaceGitDiff = new WorkspaceGitDiff();
        }
      })
        .margin({ left: 16, right: 16 })
      Row({ space: 10 }) {
        Text(this.workspaceGitStatus.branch.length > 0 ? this.workspaceGitStatus.branch : this.tr('当前分支未知'))
          .fontSize(this.fs(14))
          .fontColor(this.pal().text)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text('+' + this.workspaceGitStatus.totalAdditions + ' / −' + this.workspaceGitStatus.totalDeletions)
          .fontSize(this.fs(11))
          .fontColor(this.pal().text2)
        Image($r('app.media.ic_refresh'))
          .width(20)
          .height(20)
          .fillColor(this.pal().primary)
          .onClick(() => { this.runtime.loadWorkspaceGitStatus(); })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 10, bottom: 10 })
      Row({ space: 6 }) {
        this.WorkspaceGitScopeButton('all', this.tr('全部'))
        this.WorkspaceGitScopeButton('staged', this.tr('已暂存'))
        this.WorkspaceGitScopeButton('unstaged', this.tr('未暂存'))
      }
      .width('100%')
      .padding({ left: 16, right: 16, bottom: 8 })
      if (this.workspaceGitLoading) {
        LoadingProgress().width(24).height(24).color(this.pal().primary).margin(18)
      } else if (this.workspaceGitError.length > 0) {
        Text(this.workspaceGitError).fontSize(this.fs(13)).fontColor(this.pal().danger).padding(16)
      } else if (!this.workspaceGitStatus.isGitRepo) {
        Text(this.tr('当前工作区不是 Git 仓库')).fontSize(this.fs(13)).fontColor(this.pal().text3).padding(16)
      } else if (this.workspaceGitDiffPath.length > 0) {
        Row({ space: 8 }) {
          Text(this.workspaceGitDiffPath)
            .fontSize(this.fs(13))
            .fontColor(this.pal().text)
            .layoutWeight(1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.tr('返回文件列表'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().primary)
            .onClick(() => {
              this.workspaceGitDiffPath = '';
              this.workspaceGitDiff = new WorkspaceGitDiff();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 8 })
        if (this.workspaceGitDiffLoading) {
          LoadingProgress().width(24).height(24).color(this.pal().primary).margin(18)
        } else {
          Scroll() {
            Text(this.workspaceGitDiff.diff.length > 0 ? this.workspaceGitDiff.diff : this.tr('没有可显示的改动'))
              .fontSize(this.fs(12))
              .fontColor(this.pal().text)
              .fontFamily('monospace')
              .width('100%')
              .copyOption(CopyOptions.LocalDevice)
          }
          .width('100%')
          .layoutWeight(1)
          .scrollBar(BarState.Auto)
          .padding({ left: 16, right: 16, bottom: 16 })
        }
      } else {
        List() {
          ForEach(this.workspaceGitStatus.files, (file: WorkspaceGitFile) => {
            ListItem() {
              Row({ space: 8 }) {
                Text(file.status.substring(0, 1).toUpperCase())
                  .fontSize(this.fs(11))
                  .fontColor(file.status === 'deleted' ? this.pal().danger : this.pal().primary)
                  .width(22)
                  .textAlign(TextAlign.Center)
                Text(file.path)
                  .fontSize(this.fs(13))
                  .fontColor(this.pal().text)
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(this.gitCountLabel(file.additions, '+') + ' / ' + this.gitCountLabel(file.deletions, '−'))
                  .fontSize(this.fs(10))
                  .fontColor(this.pal().text3)
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 12, bottom: 12 })
              .onClick(() => { this.runtime.loadWorkspaceGitDiff(file.path); })
            }
          }, (file: WorkspaceGitFile) => file.path)
        }
        .layoutWeight(1)
        .width('100%')
        .divider({ strokeWidth: 0.5, color: this.pal().border, startMargin: 16, endMargin: 16 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().bg)
  }

  @Builder
  WorkspaceGitScopeButton(scope: string, label: string) {
    Text(label)
      .fontSize(this.fs(12))
      .fontColor(this.workspaceGitScope === scope ? this.pal().primary : this.pal().text2)
      .backgroundColor(this.workspaceGitScope === scope ? this.pal().primarySoft : this.pal().card)
      .borderRadius(10)
      .padding({ left: 12, right: 12, top: 7, bottom: 7 })
      .onClick(() => {
        if (this.workspaceGitScope !== scope) {
          this.workspaceGitDiffPath = '';
          this.workspaceGitDiff = new WorkspaceGitDiff();
          this.runtime.loadWorkspaceGitStatus(scope);
        }
      })
  }

  private gitCountLabel(value: number, prefix: string): string {
    return value < 0 ? '—' : prefix + value;
  }

  @Builder
  FilePreviewOverlay() {
    Column() {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('文件'),
        onBack: () => { this.closeFilePreview(); }
      })
        .margin({ left: 16, right: 16 })
      Row({ space: 12 }) {
        Text(this.filePreviewPath.startsWith(this.browsePrefix())
          ? this.filePreviewPath.substring(this.browsePrefix().length) : this.filePreviewPath)
          .fontSize(this.fs(15))
          .fontColor(this.pal().text)
          .layoutWeight(1)
          .maxLines(2)
        Image($r('app.media.ic_refresh'))
          .width(22)
          .height(22)
          .fillColor(this.pal().primary)
          .accessibilityText(this.tr('刷新'))
          .onClick(() => { this.openFilePreview(this.filePreviewPath, this.filePreviewPage.offset); })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      Column({ space: 8 }) {
        if (this.filePreviewLoading) {
          Row({ space: 8 }) {
            LoadingProgress()
              .width(16)
              .height(16)
              .color(this.pal().primary)
            Text(this.tr('读取中…'))
              .fontSize(this.fs(12))
              .fontColor(this.pal().text2)
          }
          .padding({ top: 12, bottom: 12 })
        } else if (this.previewIsPdf && this.pdfError.length === 0 && this.pdfController !== undefined) {
          Row() {
            Row() {
              this.PdfTool('‹', '上一页', this.pdfPage > 0, () => { this.turnPdfPage(-1); })
              Text(`${this.pdfPage + 1} / ${this.pdfPages}`)
                .fontSize(this.fs(12))
                .fontColor(this.pal().text2)
              this.PdfTool('›', '下一页', this.pdfPage + 1 < this.pdfPages, () => { this.turnPdfPage(1); })
            }
            .layoutWeight(1)
            this.PdfTool('−', '缩小', this.pdfZoom > 0.1, () => { this.zoomPdf(0.8); })
            this.PdfTool('+', '放大', this.pdfZoom < 10, () => { this.zoomPdf(1.25); })
          }
          .width('100%')
          PdfView({
            controller: this.pdfController,
            pageLayout: pdfService.PageLayout.LAYOUT_SINGLE,
            isContinuous: false,
            showScroll: true,
            pageFit: pdfService.PageFit.FIT_WIDTH
          })
            .width('100%')
            .layoutWeight(1)
            .borderRadius(12)
        } else if (this.previewIsPdf && this.pdfError.length > 0) {
          Text(this.tr('PDF 打开失败：') + this.pdfError)
            .fontSize(this.fs(12))
            .fontColor(this.pal().danger)
            .padding({ top: 12, bottom: 12 })
        } else if (this.filePreviewError.length > 0) {
          Text(this.filePreviewError)
            .fontSize(this.fs(12))
            .fontColor(this.pal().danger)
            .padding({ top: 12, bottom: 12 })
        } else {
          Text(this.tr('只读预览') + ' · ' + this.filePreviewPage.offset + '–'
            + (this.filePreviewPage.offset + Math.max(0, this.filePreviewPage.lines - 1)))
            .fontSize(this.fs(12))
            .fontColor(this.pal().text3)
            .width('100%')
          Scroll() {
            Text(this.filePreviewPage.text)
              .fontSize(this.fs(14))
              .fontColor(this.pal().text)
              .fontFamily('monospace')
              .width('100%')
              .textAlign(TextAlign.Start)
              .copyOption(CopyOptions.LocalDevice)
          }
          .width('100%')
          .scrollBar(BarState.Auto)
          .layoutWeight(1)
          Row({ space: 8 }) {
            this.PdfTool('‹', '上一页', this.filePreviewPage.offset > 1, () => {
              this.openFilePreview(this.filePreviewPath,
                Math.max(1, this.filePreviewPage.offset - WORKSPACE_TEXT_PAGE_LINES));
            })
            this.PdfTool('›', '下一页', !this.filePreviewPage.eof && this.filePreviewPage.lines > 0, () => {
              this.openFilePreview(this.filePreviewPath, this.filePreviewPage.offset + this.filePreviewPage.lines);
            })
          }
          .width('100%')
          .justifyContent(FlexAlign.End)
        }
      }
      .width('100%')
      .layoutWeight(1)
      .padding({ left: 16, right: 16, bottom: 16 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().bg)
  }

  /** 主机详情：把 server 上报的字段摊开，指纹/ID 可以一键复制。 */
  @Builder
  DeviceDetailOverlay() {
    Column() {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('主机详情'),
        onBack: () => { this.deviceDetailId = ''; }
      })
      Scroll() {
        Column({ space: 16 }) {
          Row({ space: 12 }) {
            Image($r('app.media.ic_host'))
              .width(56).height(56).padding(14)
              .borderRadius(18)
              .backgroundColor(this.pal().primarySoft)
              .fillColor(this.pal().primary)
            Column({ space: 4 }) {
              Text(this.deviceDetailName())
                .fontSize(this.fs(23))
                .fontWeight(FontWeight.Bold)
                .fontColor(this.pal().text)
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.deviceDetailOnlineLabel())
                .fontSize(this.fs(13))
                .fontColor(this.deviceDetailOnline() ? this.pal().success : this.pal().text2)
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            Button(this.tr('更多'), { type: ButtonType.Capsule })
              .height(40)
              .fontColor(this.pal().text)
              .backgroundColor(this.pal().chip)
              .onClick(() => { this.deviceMenuId = this.deviceDetailId; })
          }
          .width('100%')
          .padding({ top: 18, bottom: 8 })
          if (this.deviceDetailId === this.connectedDeviceId && this.runtime.supportsDshWeb()) {
            Button(this.tr('打开 DSH Web'))
              .backgroundColor(this.pal().primary)
              .onClick(() => { this.dshWebOpen = true; })
          }
          if (this.deviceDetailId !== this.connectedDeviceId) {
            Column({ space: 12 }) {
              if (!this.runtime.hasHostPin(this.deviceDetailId)) {
                Text(this.tr('连接前请确认这是你的主机。应用会记住主机的安全身份，身份发生变化时将中止连接。'))
                  .fontSize(15)
                  .fontColor(this.pal().text2)
                  .width('100%')
                if (this.deviceDetailFingerprint().length > 0) {
                  Text(this.deviceDetailFingerprint())
                    .fontSize(12).fontFamily('monospace').fontColor(this.pal().primary).width('100%')
                }
              }
              Button(this.runtime.hasHostPin(this.deviceDetailId) ? this.tr('连接') : this.tr('信任并继续'),
                { type: ButtonType.Capsule })
                .width('100%')
                .height(48)
                .backgroundColor(this.pal().primary)
                .enabled(this.deviceDetailOnline())
                .onClick(() => { this.connectFromHostPage(this.deviceDetailId); })
            }
            .width('100%')
            .padding(16)
            .borderRadius(22)
            .backgroundColor(this.pal().card)
          }
          if (this.renamingDeviceId === this.deviceDetailId) {
            Row({ space: 8 }) {
              TextInput({ text: this.renameInput, placeholder: this.tr('输入主机名称') })
                .layoutWeight(1)
                .height(44)
                .backgroundColor(this.pal().chip)
                .fontColor(this.pal().text)
                .onChange((value: string) => { this.renameInput = value; })
                .onSubmit(() => { this.confirmRename(); })
              Button(this.tr('确定')).onClick(() => { this.confirmRename(); })
              Button(this.tr('取消'))
                .backgroundColor(this.pal().chip)
                .fontColor(this.pal().text)
                .onClick(() => { this.cancelRename(); })
            }
            .width('100%')
          }
          Column() {
            this.DetailRow(this.tr('平台'), this.deviceDetailField('platform'))
            this.DetailRow(this.tr('主机版本'), this.deviceDetailField('harnessVersion'))
            this.DetailRow(this.tr('客户端版本'), this.deviceDetailField('clientVersion'))
            this.DetailRow(this.tr('最后在线'), this.deviceDetailLastSeen())
            this.DetailRow(this.tr('设备 ID'), this.deviceDetailId)
            this.DetailRow(this.tr('公钥指纹'), this.deviceDetailFingerprint())
          }
          .width('100%')
          .borderRadius(22)
          .backgroundColor(this.pal().card)
          .clip(true)


          if (this.deviceDetailId === this.connectedDeviceId && this.connectedTransport.length > 0) {
            this.SettingsRow(this.tr('连接诊断'), this.transportBadgeText(), false, () => {
              this.deviceDetailId = '';
              this.linkDetailOpen = true;
            })
          }
          if (this.deviceDetailId === this.connectedDeviceId && this.connectedTransport === 'relay') {
            ForEach(this.runtime.relayDetailLines(), (line: string) => {
              Text(line)
                .fontSize(this.fs(12))
                .fontColor(this.pal().text2)
                .width('100%')
                .textAlign(TextAlign.Start)
            }, (line: string) => line)
          }

          Text(this.tr('复制全部'))
            .fontSize(this.fs(13))
            .fontColor('#FFFFFF')
            .width('100%')
            .textAlign(TextAlign.Center)
            .padding({ top: 12, bottom: 12 })
            .backgroundColor(this.pal().primary)
            .borderRadius(12)
            .onClick(() => {
              this.copyDeviceDetail();
            })
        }
        .width('100%')
        .constraintSize({ maxWidth: 600 })
        .padding({ bottom: 24 })
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16 })
    .backgroundColor(this.pal().bg)
  }

  @Builder
  DetailRow(label: string, value: string) {
    Row({ space: 10 }) {
      Text(label)
        .fontSize(this.fs(11))
        .fontColor(this.pal().text3)
        .width(76)
      Text(value.length > 0 ? value : '—')
        .fontSize(this.fs(12))
        .fontColor(this.pal().text2)
        .fontFamily('monospace')
        .layoutWeight(1)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 8, bottom: 8 })
    .backgroundColor(this.pal().inputBg)
    .borderRadius(10)
  }

  /** 新建工作区：主机侧只认绝对路径，名称留空就用路径末段。 */
  /** 定时任务：列表 / 投递历史 / 删除；创建走会话里的官方 schedule_create 工具。 */
  @Builder
  SchedulesOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(8,12,24,0.55)')
        .onClick(() => {
          this.schedulesOpen = false;
        })
      Column({ space: 10 }) {
        Row({ space: 10 }) {
          Text(this.tr('定时任务'))
            .fontSize(this.fs(16))
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().text)
          if (this.runtime.schedulesLoading) {
            LoadingProgress()
              .width(14)
              .height(14)
              .color(this.pal().primary)
          }
          Blank()
          Text(this.tr('刷新'))
            .fontSize(this.fs(12))
            .fontColor(this.pal().primary)
            .padding({ left: 8, right: 8, top: 6, bottom: 6 })
            .onClick(() => {
              this.runtime.loadSchedules();
            })
          Text(this.tr('收起'))
            .fontSize(this.fs(13))
            .fontColor(this.pal().primary)
            .padding({ left: 8, right: 2, top: 6, bottom: 6 })
            .onClick(() => {
              this.schedulesOpen = false;
            })
        }
        .width('100%')
        Scroll() {
          Column({ space: 8 }) {
            if (!this.runtime.schedulesSupported) {
              Text(this.tr('这台主机没有开启定时任务'))
                .fontSize(this.fs(13))
                .fontColor(this.pal().text2)
                .width('100%')
                .textAlign(TextAlign.Start)
              Text(this.tr('Host 侧的 Remote 插件没有导出 schedule/* 端点，升级插件后这里会自动出现列表。'))
                .fontSize(this.fs(11))
                .fontColor(this.pal().text3)
                .width('100%')
                .textAlign(TextAlign.Start)
            } else if (this.runtime.schedules.length === 0) {
              Text(this.tr('还没有定时任务'))
                .fontSize(this.fs(13))
                .fontColor(this.pal().text2)
                .width('100%')
                .textAlign(TextAlign.Start)
              Text(this.tr('新建要在会话里说一句，由主机上的 agent 用 schedule_create 工具创建（协议不开放客户端直接创建）。'))
                .fontSize(this.fs(11))
                .fontColor(this.pal().text3)
                .width('100%')
                .textAlign(TextAlign.Start)
              Text(this.tr('填入示例：每天 9 点跑一次巡检，结果发到这个会话'))
                .fontSize(this.fs(12))
                .fontColor(this.pal().primary)
                .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                .backgroundColor(this.pal().primarySoft)
                .borderRadius(10)
                .onClick(() => {
                  this.promptInput = this.tr('每天 9 点跑一次巡检，结果发到这个会话');
                  this.runtime.saveDraft(this.currentSessionId, this.promptInput);
                  this.schedulesOpen = false;
                  promptAction.showToast({ message: this.tr('已填入输入框，发送即可让 agent 创建') });
                })
            }
            ForEach(this.runtime.schedules, (schedule: HarnessSchedule) => {
              Column({ space: 6 }) {
                Row({ space: 8 }) {
                  Text(schedule.title.length > 0 ? schedule.title : schedule.id)
                    .fontSize(this.fs(13))
                    .fontColor(this.pal().text)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                  if (schedule.inactive) {
                    Text(this.tr('已停用'))
                      .fontSize(this.fs(10))
                      .fontColor(this.pal().text3)
                      .padding({ left: 5, right: 5, top: 1, bottom: 1 })
                      .backgroundColor(this.pal().inputBg)
                      .borderRadius(5)
                  }
                }
                .width('100%')
                Text(this.scheduleSummary(schedule))
                  .fontSize(this.fs(11))
                  .fontColor(this.pal().text2)
                  .width('100%')
                  .textAlign(TextAlign.Start)
                Row({ space: 8 }) {
                  Text(this.tr('历史'))
                    .fontSize(this.fs(11))
                    .fontColor(this.pal().primary)
                    .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                    .onClick(() => {
                      this.runtime.loadScheduleHistory(schedule);
                    })
                  Text(this.tr('删除'))
                    .fontSize(this.fs(11))
                    .fontColor(this.pal().danger)
                    .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                    .onClick(() => {
                      this.runtime.deleteSchedule(schedule);
                    })
                  Blank()
                }
                .width('100%')
                if (this.runtime.scheduleHistoryId === schedule.id
                  && this.runtime.scheduleHistory.length > 0) {
                  Column({ space: 2 }) {
                    ForEach(this.runtime.scheduleHistory, (delivery: HarnessScheduleDelivery) => {
                      Text(formatSessionTime(delivery.deliveredAt) + ' · '
                        + (delivery.status.length > 0 ? delivery.status : '投递'))
                        .fontSize(this.fs(10))
                        .fontColor(this.pal().text3)
                        .width('100%')
                        .textAlign(TextAlign.Start)
                    }, (delivery: HarnessScheduleDelivery) => delivery.id + delivery.deliveredAt)
                  }
                  .width('100%')
                }
              }
              .width('100%')
              .padding(10)
              .backgroundColor(this.pal().inputBg)
              .borderRadius(12)
              .border({ width: 1, color: this.pal().border })
              .alignItems(HorizontalAlign.Start)
            }, (schedule: HarnessSchedule) => schedule.id + schedule.inactive)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Auto)
      }
      .width('100%')
      .height('66%')
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 340 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 200, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /** 一条定时任务的一行摘要：类型 + 下次时间 + 上次投递。 */
  private scheduleSummary(schedule: HarnessSchedule): string {
    const parts: string[] = [];
    parts.push(schedule.kind.length > 0 ? schedule.kind : '定时');
    if (schedule.expression.length > 0) {
      parts.push(schedule.expression);
    }
    if (schedule.scheduledAt > 0) {
      parts.push(this.tr('下次 ') + formatSessionTime(schedule.scheduledAt));
    }
    if (schedule.lastDeliveredAt > 0) {
      parts.push(this.tr('上次 ') + formatSessionTime(schedule.lastDeliveredAt));
    }
    return parts.join(' · ');
  }

  private tintName(tint: number): string {
    if (tint === 1) {
      return this.tr('深海');
    }
    if (tint === 2) {
      return this.tr('森林');
    }
    if (tint === 3) {
      return this.tr('暖沙');
    }
    if (tint === 4) {
      return this.tr('玫紫');
    }
    return this.tr('默认');
  }

  /** 连接详情：传输路径 / 握手耗时 / 测延迟 / 回落原因（点顶栏传输徽标打开）。 */
  @Builder
  LinkDetailOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(8,12,24,0.45)')
        .onClick(() => {
          this.linkDetailOpen = false;
        })
      Column({ space: 10 }) {
        Row({ space: 10 }) {
          Text(this.tr('连接详情'))
            .fontSize(this.fs(16))
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().text)
          Blank()
          Text(this.runtime.latencyTesting ? this.tr('测量中…') : this.tr('测延迟'))
            .fontSize(this.fs(12))
            .fontColor(this.runtime.latencyTesting ? this.pal().text3 : this.pal().primary)
            .padding({ left: 8, right: 8, top: 6, bottom: 6 })
            .onClick(() => {
              if (!this.runtime.latencyTesting) {
                this.runtime.measureLatency();
              }
            })
          Text(this.tr('收起'))
            .fontSize(this.fs(13))
            .fontColor(this.pal().primary)
            .padding({ left: 8, right: 2, top: 6, bottom: 6 })
            .onClick(() => {
              this.linkDetailOpen = false;
            })
        }
        .width('100%')
        Scroll() {
          Column({ space: 8 }) {
            ForEach(this.runtime.connectionDetailLines(), (line: string) => {
              Text(line)
                .fontSize(this.fs(12))
                .fontColor(this.pal().text2)
                .width('100%')
                .textAlign(TextAlign.Start)
            }, (line: string) => line)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Auto)
      }
      .width('100%')
      .constraintSize({ maxHeight: '56%' })
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 320 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 200, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /** 连接诊断：现场排障不用连电脑抓 hilog。 */
  @Builder
  DiagnosticsOverlay() {
    Column({ space: 10 }) {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('连接诊断'),
        onBack: () => { this.diagnosticsOpen = false; }
      })
      Row({ space: 10 }) {
        Blank()
        Text(this.tr('存文件'))
          .fontSize(this.fs(12))
          .fontColor(this.pal().primary)
          .padding({ left: 8, right: 8, top: 6, bottom: 6 })
          .onClick(() => {
            const path: string = this.runtime.exportDiagnosticsToFile();
            promptAction.showToast({ message: path.length > 0
              ? this.tr('已保存，可用 hdc file recv 拉走') + '\n' + path
              : this.tr('导出失败（存储不可用）') });
          })
        Text(this.tr('复制'))
          .fontSize(this.fs(12))
          .fontColor(this.pal().primary)
          .padding({ left: 8, right: 8, top: 6, bottom: 6 })
          .onClick(() => {
            const lines: string[] = this.runtime.diagnosticsLines()
              .concat(['', this.tr('最近事件：')])
              .concat(this.runtime.linkEvents)
              .concat(['', 'link.log: ' + this.runtime.linkLogPath()])
              .concat(this.runtime.linkLogTail());
            const data: pasteboard.PasteData = pasteboard.createData(
              pasteboard.MIMETYPE_TEXT_PLAIN, lines.join('\n'));
            pasteboard.getSystemPasteboard().setData(data).then(() => {
              promptAction.showToast({ message: this.tr('诊断信息已复制') });
            }).catch(() => undefined);
          })
      }
      .width('100%')
      Scroll() {
        Column({ space: 6 }) {
          ForEach(this.runtime.diagnosticsLines(), (line: string) => {
            Text(line)
              .fontSize(this.fs(12))
              .fontColor(this.pal().text2)
              .width('100%')
              .textAlign(TextAlign.Start)
          }, (line: string) => line)
          Column()
            .width('100%')
            .height(0.5)
            .backgroundColor(this.pal().border)
            .margin({ top: 4, bottom: 4 })
          Text(this.tr('最近事件'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
            .width('100%')
            .textAlign(TextAlign.Start)
          if (this.runtime.linkEvents.length === 0) {
            Text(this.tr('还没有记录'))
              .fontSize(this.fs(12))
              .fontColor(this.pal().text3)
              .width('100%')
              .textAlign(TextAlign.Start)
          } else {
            ForEach(this.runtime.linkEvents, (line: string) => {
              Text(line)
                .fontSize(this.fs(11))
                .fontColor(this.pal().text2)
                .width('100%')
                .textAlign(TextAlign.Start)
            }, (line: string) => line)
          }
          Column()
            .width('100%')
            .height(0.5)
            .backgroundColor(this.pal().border)
            .margin({ top: 4, bottom: 4 })
          Text(this.tr('链路日志（已落盘，重启 App 也保留）'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
            .width('100%')
            .textAlign(TextAlign.Start)
          if (this.runtime.linkLogTail().length === 0) {
            Text(this.tr('还没有记录'))
              .fontSize(this.fs(12))
              .fontColor(this.pal().text3)
              .width('100%')
              .textAlign(TextAlign.Start)
          } else {
            ForEach(this.runtime.linkLogTail(), (line: string) => {
              Text(line)
                .fontSize(this.fs(10))
                .fontColor(this.pal().text3)
                .width('100%')
                .textAlign(TextAlign.Start)
            }, (line: string) => line)
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Auto)
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16, bottom: 16 })
    .backgroundColor(this.pal().bg)
  }

  @Builder
  AboutOverlay() {
    Column() {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('关于'),
        onBack: () => { this.aboutOpen = false; }
      })
      Scroll() {
        Column() {
          Image($r('app.media.icon'))
            .width(84)
            .height(84)
            .borderRadius(22)
            .margin({ top: 24, bottom: 12 })
          Text('DS Harness Remote')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Text(appVersion())
            .fontSize(this.fs(13))
            .fontColor(this.pal().text3)
            .margin({ top: 6, bottom: 24 })
          Column() {
            this.SettingsRow(this.tr('开发者'), 'liguobao', false,
              () => { this.openBrowserLink('https://www.zhihu.com/people/codelover'); })
            this.SettingsRow('X / Twitter', '@liguobao2077', false,
              () => { this.openBrowserLink('https://x.com/liguobao2077'); })
            this.SettingsRow(this.tr('源代码'), 'GitHub', false,
              () => { this.openBrowserLink('https://github.com/liguobao/ds-harness-remote'); })
            this.SettingsRow(this.tr('版本发布'), 'GitHub Releases', false,
              () => { this.openBrowserLink('https://github.com/liguobao/ds-harness-remote/releases/latest'); })
          }
          .width('100%')
          .backgroundColor(this.pal().card)
          .borderRadius(22)
        }
        .width('100%')
      }
      .width('100%')
      .align(Alignment.Top)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16 })
    .backgroundColor(this.pal().bg)
  }

  /** 全屏编辑：写长 prompt 时不受输入坞高度和候选条限制。 */
  @Builder
  ExpandedComposerOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.composerExpanded = false;
        })
      Column({ space: 10 }) {
        Row() {
          Blank()
          Button({ type: ButtonType.Circle }) {
            Image($r('app.media.ic_collapse'))
              .width(19)
              .height(19)
              .fillColor(this.pal().text)
          }
            .width(36)
            .height(36)
            .padding(0)
            .backgroundColor(Color.Transparent)
            .accessibilityText(this.tr('收起'))
            .onClick(() => { this.composerExpanded = false; })
        }
        .width('100%')
        TextArea({ text: this.promptInput,
          placeholder: this.tr('输入消息…') })
          .layoutWeight(1)
          .width('100%')
          .onKeyEvent((event: KeyEvent) => {
            if (event.type !== KeyType.Down || event.keyCode !== KeyCode.KEYCODE_ENTER) {
              return;
            }
            const ctrl: boolean = event.getModifierKeyState !== undefined
              ? event.getModifierKeyState(['Ctrl', 'Meta']) : false;
            if (ctrl) {
              this.composerExpanded = false;
              this.sendTap();
            }
          })
          .backgroundColor(Color.Transparent)
          .fontColor(this.pal().text)
          .placeholderColor(this.pal().text3)
          .fontSize(this.fs(16))
          .padding(4)
          .onChange((value: string) => {
            this.promptInput = value;
            this.runtime.saveDraft(this.currentSessionId, value);
          })
        Row({ space: 10 }) {
          if (this.pendingImages.length > 0) {
            Text(this.pendingImages.length + this.tr(' 张图待发'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
          }
          Blank()
          if (this.generating && this.promptInput.trim().length === 0 && this.pendingImages.length === 0) {
            Button({ type: ButtonType.Circle }) {
              Image($r('app.media.ic_stop'))
                .width(18)
                .height(18)
                .fillColor(Color.White)
            }
              .width(44)
              .height(44)
              .padding(0)
              .backgroundColor(this.pal().text)
              .accessibilityText(this.tr('停止'))
              .onClick(() => { this.runtime.stopGeneration(); })
          } else {
            Button({ type: ButtonType.Circle }) {
              Image($r('app.media.ic_arrow_up'))
                .width(20)
                .height(20)
                .fillColor(Color.White)
            }
              .width(44)
              .height(44)
              .padding(0)
              .backgroundColor(this.pal().primary)
              .accessibilityText(this.tr('发送'))
              .enabled(this.promptInput.trim().length > 0 || this.pendingImages.length > 0)
              .onClick(() => {
                this.composerExpanded = false;
                this.sendTap();
              })
          }
        }
        .width('100%')
      }
      .width('100%')
      .height(Math.max(160, this.windowHeightVp - 88))
      .padding({ left: 16, right: 16, top: 6, bottom: 10 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 28, topRight: 28 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 380 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 200, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  WorkspaceCreateOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.workspaceCreateOpen = false;
        })
      Column({ space: 12 }) {
        this.SheetTitle(this.tr('新建工作区'), () => { this.workspaceCreateOpen = false; })
        Column({ space: 6 }) {
          Text(this.tr('主机上的目录（绝对路径）'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
            .width('100%')
          TextInput({ text: this.workspacePathInput, placeholder: '/home/user/project' })
            .width('100%')
            .height(46)
            .fontSize(this.fs(14))
            .fontColor(this.pal().text)
            .placeholderColor(this.pal().text3)
            .backgroundColor(this.pal().inputBg)
            .borderRadius(12)
            .border({ width: 1, color: this.pal().border })
            .padding({ left: 14, right: 14 })
            .onChange((value: string) => {
              this.workspacePathInput = value;
            })
          if (this.runtime.browsePath.length > 0) {
            Text(this.tr('填入当前浏览目录') + '：' + this.runtime.browsePath)
              .fontSize(this.fs(10))
              .fontColor(this.pal().primary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
              .onClick(() => {
                this.workspacePathInput = this.runtime.browsePath;
              })
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        Column({ space: 6 }) {
          Text(this.tr('显示名称（可留空）'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
            .width('100%')
          TextInput({ text: this.workspaceNameDraft, placeholder: this.tr('留空则用目录名') })
            .width('100%')
            .height(46)
            .fontSize(this.fs(14))
            .fontColor(this.pal().text)
            .placeholderColor(this.pal().text3)
            .backgroundColor(this.pal().inputBg)
            .borderRadius(12)
            .border({ width: 1, color: this.pal().border })
            .padding({ left: 14, right: 14 })
            .onChange((value: string) => {
              this.workspaceNameDraft = value;
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        Text(this.tr('创建'))
          .fontSize(this.fs(14))
          .fontColor('#FFFFFF')
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 13, bottom: 13 })
          .backgroundColor(this.pal().primary)
          .borderRadius(12)
          .onClick(() => {
            const path: string = this.workspacePathInput.trim();
            if (path.length === 0) {
              promptAction.showToast({ message: this.tr('先填一个主机上的绝对路径') });
              return;
            }
            this.runtime.createWorkspace(path, this.workspaceNameDraft.trim());
            this.workspaceCreateOpen = false;
          })
      }
      .width('100%')
      .constraintSize({ maxWidth: 420 })
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 320 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 220, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /** 轨迹条目：只挑工具调用，按 seq 升序。 */
  private trajectoryItems(): ChatItem[] {
    const out: ChatItem[] = [];
    for (const item of this.messages) {
      if (item.kind === 'tool') {
        out.push(item);
      }
    }
    out.sort((a: ChatItem, b: ChatItem) => a.seq - b.seq);
    return out;
  }

  /** 执行轨迹：整个会话的工具调用时间线，点开可看完整参数。 */
  @Builder
  TrajectoryOverlay() {
    Column() {
      ScreenHeader({
        palette: this.pal(),
        title: this.tr('执行轨迹'),
        onBack: () => { this.trajectoryOpen = false; }
      })
        Scroll() {
          Column({ space: 8 }) {
            ForEach(this.trajectoryItems(), (item: ChatItem) => {
              Row({ space: 10 }) {
                Column()
                  .width(2)
                  .height(34)
                  .borderRadius(1)
                  .backgroundColor(item.toolState === 'failed'
                    ? 'rgba(248,87,73,0.55)' : this.pal().border)
                Column({ space: 3 }) {
                  Row({ space: 6 }) {
                    Text(item.toolName.length > 0 ? item.toolName : this.tr('工具'))
                      .fontSize(this.fs(13))
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.pal().text)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(item.toolState === 'failed' ? this.tr('失败')
                      : (item.toolState === 'running' ? this.tr('运行中') : this.tr('完成')))
                      .fontSize(this.fs(10))
                      .fontColor(item.toolState === 'failed' ? this.pal().danger
                        : (item.toolState === 'running' ? this.pal().primary : this.pal().text3))
                  }
                  .width('100%')
                  if (item.summary.length > 0) {
                    Text(item.summary)
                      .fontSize(this.fs(11))
                      .fontColor(this.pal().text2)
                      .maxLines(2)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                  if (item.text.length > 0) {
                    Text(item.text)
                      .fontSize(this.fs(10))
                      .fontColor(this.pal().text3)
                      .fontFamily('monospace')
                      .maxLines(3)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)
              }
              .width('100%')
              .padding({ left: 10, right: 10, top: 8, bottom: 8 })
              .backgroundColor(this.pal().card)
              .borderRadius(12)
              .border({ width: 1, color: this.pal().border })
            }, (item: ChatItem) => 'traj-' + item.id + '-' + item.rev)
            if (this.trajectoryItems().length === 0) {
              Text(this.tr('本次会话还没有工具调用'))
                .fontSize(this.fs(12))
                .fontColor(this.pal().text3)
                .padding({ top: 12, bottom: 12 })
            }
          }
          .width('100%')
        }
        .layoutWeight(1)
        .scrollable(ScrollDirection.Vertical)
        .scrollBar(BarState.Auto)
        .width('100%')
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16 })
    .backgroundColor(this.pal().bg)
  }

  /** 当前会话里搜消息：命中片段列表，点一条滚过去。 */
  private inSessionHits(): ChatItem[] {
    const query: string = this.inSessionQuery.trim().toLowerCase();
    if (query.length === 0) {
      return [];
    }
    const out: ChatItem[] = [];
    for (const item of this.messages) {
      if (item.text.toLowerCase().indexOf(query) >= 0) {
        out.push(item);
      }
    }
    return out.slice(0, 40);
  }

  private scrollToMessage(messageId: string): void {
    const rows: ChatItem[] = this.chatRows();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === messageId) {
        this.stickToBottom = false;
        this.scroller.scrollToIndex(i, true);
        return;
      }
    }
  }

  /** 命中片段拆成「前缀 / 命中词 / 后缀」三段，方便分别上色。 */
  private hitParts(text: string): string[] {
    const query: string = this.inSessionQuery.trim();
    const lower: string = text.toLowerCase();
    const index: number = query.length === 0 ? -1 : lower.indexOf(query.toLowerCase());
    if (index < 0) {
      const head: string = text.length > 60 ? text.substring(0, 60) + '…' : text;
      return [head, '', ''];
    }
    const start: number = Math.max(0, index - 20);
    const end: number = Math.min(text.length, index + query.length + 30);
    const before: string = (start > 0 ? '…' : '') + text.substring(start, index);
    const hit: string = text.substring(index, index + query.length);
    const after: string = text.substring(index + query.length, end) + (end < text.length ? '…' : '');
    return [before, hit, after];
  }

  @Builder
  InSessionSearchOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.inSessionSearchOpen = false;
        })
      Column({ space: 8 }) {
        this.SheetTitle(this.tr('搜索本会话'), () => { this.inSessionSearchOpen = false; })
        TextInput({ text: this.inSessionQuery, placeholder: this.tr('输入关键词…') })
          .width('100%')
          .height(42)
          .fontSize(this.fs(13))
          .fontColor(this.pal().text)
          .placeholderColor(this.pal().text3)
          .backgroundColor(this.pal().inputBg)
          .borderRadius(10)
          .border({ width: 1, color: this.pal().border })
          .padding({ left: 12, right: 12 })
          .onChange((value: string) => {
            this.inSessionQuery = value;
          })
        Scroll() {
          Column({ space: 6 }) {
            ForEach(this.inSessionHits(), (item: ChatItem) => {
              Row({ space: 8 }) {
                Text(item.kind === 'user' ? '我' : '答')
                  .fontSize(this.fs(10))
                  .fontColor(this.pal().text3)
                  .width(16)
                Text() {
                  Span(this.hitParts(item.text)[0])
                    .fontColor(this.pal().text2)
                  Span(this.hitParts(item.text)[1])
                    .fontColor(this.pal().primary)
                    .fontWeight(FontWeight.Medium)
                  Span(this.hitParts(item.text)[2])
                    .fontColor(this.pal().text2)
                }
                .fontSize(this.fs(11))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
                Text(item.timestamp > 0 ? formatClock(item.timestamp) : '')
                  .fontSize(this.fs(10))
                  .fontColor(this.pal().text3)
              }
              .width('100%')
              .padding({ left: 10, right: 10, top: 8, bottom: 8 })
              .backgroundColor(this.pal().card)
              .borderRadius(10)
              .border({ width: 1, color: this.pal().border })
              .onClick(() => {
                this.inSessionSearchOpen = false;
                this.scrollToMessage(item.id);
              })
            }, (item: ChatItem) => 'hit-' + item.id)
            if (this.inSessionQuery.trim().length > 0 && this.inSessionHits().length === 0) {
              Text(this.tr('没有匹配的消息'))
                .fontSize(this.fs(11))
                .fontColor(this.pal().text3)
                .padding({ top: 10, bottom: 10 })
            }
          }
          .width('100%')
        }
        .constraintSize({ maxHeight: this.windowHeightVp > 0 ? this.windowHeightVp * 0.5 : 320 })
        .scrollable(ScrollDirection.Vertical)
        .scrollBar(BarState.Off)
        .width('100%')
      }
      .width('100%')
      .constraintSize({ maxWidth: 420 })
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
    }
    .width('100%')
    .height('100%')
  }

  /** 本地提示词库：点一条就填进输入框，也可以就地增删。 */
  @Builder
  PromptPanelOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.promptPanelOpen = false;
        })
      Column({ space: 10 }) {
        Row() {
          Text(this.tr('提示词'))
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Blank()
          Image($r('app.media.ic_close'))
            .width(18)
            .height(18)
            .fillColor(this.pal().text3)
            .padding(2)
            .onClick(() => {
              this.promptPanelOpen = false;
            })
        }
        .width('100%')

        Scroll() {
          Column({ space: 8 }) {
            ForEach(this.runtime.prompts, (item: string) => {
              Row({ space: 10 }) {
                Text(item)
                  .fontSize(this.fs(13))
                  .fontColor(this.pal().text)
                  .maxLines(3)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
                Image($r('app.media.ic_close'))
                  .width(18)
                  .height(18)
                  .fillColor(this.pal().text3)
                  .padding(3)
                  .onClick(() => {
                    this.runtime.removePrompt(item);
                  })
              }
              .width('100%')
              .padding({ left: 12, right: 10, top: 10, bottom: 10 })
              .backgroundColor(this.pal().card)
              .borderRadius(12)
              .border({ width: 1, color: this.pal().border })
              .onClick(() => {
                this.promptInput = item;
                this.runtime.saveDraft(this.currentSessionId, item);
                this.promptPanelOpen = false;
              })
            }, (item: string) => 'prompt-' + item)
            if (this.runtime.prompts.length === 0) {
              Text(this.tr('还没有提示词，下面加一条'))
                .fontSize(this.fs(12))
                .fontColor(this.pal().text3)
                .padding({ top: 6, bottom: 6 })
            }
          }
          .width('100%')
        }
        .constraintSize({ maxHeight: this.windowHeightVp > 0 ? this.windowHeightVp * 0.42 : 300 })
        .scrollable(ScrollDirection.Vertical)
        .scrollBar(BarState.Off)
        .width('100%')

        Row({ space: 8 }) {
          TextInput({ text: this.promptDraftInput, placeholder: this.tr('新增一条提示词…') })
            .layoutWeight(1)
            .height(42)
            .backgroundColor(this.pal().inputBg)
            .fontColor(this.pal().text)
            .fontSize(this.fs(14))
            .placeholderColor(this.pal().text3)
            .borderRadius(12)
            .padding({ left: 14, right: 14 })
            .onChange((value: string) => {
              this.promptDraftInput = value;
            })
          Text(this.tr('添加'))
            .fontSize(this.fs(13))
            .fontColor('#FFFFFF')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .backgroundColor(this.pal().primary)
            .borderRadius(12)
            .onClick(() => {
              this.runtime.addPrompt(this.promptDraftInput);
              this.promptDraftInput = '';
            })
        }
        .width('100%')
      }
      .width('100%')
      .constraintSize({ maxWidth: 520 })
      .padding({ left: 20, right: 20, top: 16, bottom: 22 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 22, topRight: 22 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 320 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 220, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /** 顶栏图标：22 的图形 + 40 的点击区，齿轮/加号/三横摆在一起比例才一致。 */
  @Builder
  TopIcon(icon: Resource, action: () => void) {
    Row() {
      Image(icon)
        .width(22)
        .height(22)
        .fillColor(this.pal().text2)
    }
    .width(40)
    .height(40)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    // PC/大屏：Tab 能走到、Enter/Space 能按下去（官方无障碍与键盘操作要求）
    .focusable(true)
    .onClick(() => {
      action();
    })
    .onKeyEvent((event: KeyEvent) => {
      if (event.type === KeyType.Down
        && (event.keyCode === KeyCode.KEYCODE_ENTER || event.keyCode === KeyCode.KEYCODE_SPACE)) {
        action();
      }
    })
  }

  /**
   * 折叠后的连续工具调用：左边一条竖线当时间轴，一行「N 步」，点一下摊开。
   * 不再套整块卡片，聊天流里不抢视线。
   */
  @Builder
  ToolRunRow(item: ChatItem) {
    Row({ space: 10 }) {
      Column()
        .width(2)
        .height(22)
        .borderRadius(1)
        .backgroundColor(item.toolState === 'failed'
          ? 'rgba(248,87,73,0.55)' : this.pal().border)
      if (item.toolState === 'running') {
        LoadingProgress()
          .width(12)
          .height(12)
          .color(this.pal().primary)
      } else {
        Column()
          .width(6)
          .height(6)
          .borderRadius(3)
          .backgroundColor(item.toolState === 'failed' ? this.pal().danger : this.pal().success)
      }
      Text(item.text)
        .fontSize(this.fs(12))
        .fontColor(this.pal().text2)
      if (item.summary.length > 0) {
        Text(item.summary)
          .fontSize(this.fs(11))
          .fontColor(this.pal().text3)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
      } else {
        Blank()
      }
      Image(item.rev === 1 ? $r('app.media.ic_chevron_up') : $r('app.media.ic_chevron_down'))
        .width(14)
        .height(14)
        .fillColor(this.pal().text3)
    }
    .width('100%')
    .padding({ top: 4, bottom: 4 })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.toggleRun(item.requestRpcId);
    })
  }

  /** 摊开后的单条工具调用：缩进对齐时间轴，只留一行摘要，不再是一块厚卡片。 */
  @Builder
  ToolRow(item: ChatItem) {
    Row({ space: 8 }) {
      if (item.toolState === 'running') {
        LoadingProgress()
          .width(10)
          .height(10)
          .color(this.pal().primary)
      } else {
        Column()
          .width(4)
          .height(4)
          .borderRadius(2)
          .backgroundColor(item.toolState === 'failed' ? this.pal().danger : this.pal().text3)
      }
      Text(item.toolName)
        .fontSize(this.fs(12))
        .fontColor(this.pal().text2)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (item.summary.length > 0) {
        Text(item.summary)
          .fontSize(this.fs(11))
          .fontColor(this.pal().text3)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
      } else if (item.text.length > 0) {
        Text(item.text)
          .fontSize(this.fs(10))
          .fontColor(this.pal().text3)
          .fontFamily('monospace')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
      } else {
        Blank()
      }
    }
    .width('100%')
    .padding({ top: 3, bottom: 3, left: 24, right: 6 })
    .onClick(() => {
      const payload: string = item.text.length > 0 ? item.text : item.summary;
      if (payload.length === 0) {
        return;
      }
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, payload);
      pasteboard.getSystemPasteboard().setData(data).then(() => {
        promptAction.showToast({ message: this.tr('已复制该条命令') });
      }).catch(() => undefined);
    })
  }

  @Builder
  ApprovalRow(item: ChatItem) {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text('!')
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#F5A623')
        Text('需要批准')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor('#F5A623')
          .letterSpacing(1)
      }
      Text(item.toolName)
        .fontSize(14)
        .fontColor(this.pal().text)
        .textAlign(TextAlign.Start)
      if (item.reason.length > 0) {
        Text(item.reason)
          .fontSize(12)
          .fontColor(this.pal().text2)
          .textAlign(TextAlign.Start)
      }
      if (item.approvalOutcome.length === 0) {
        Row({ space: 8 }) {
          Button(this.tr('允许'))
            .layoutWeight(1)
            .height(36)
            .fontSize(14)
            .backgroundColor(this.pal().primary)
            .fontColor('#FFFFFF')
            .borderRadius(12)
            .onClick(() => {
              this.runtime.respondApproval(item, true);
            })
          Button(this.tr('拒绝'))
            .layoutWeight(1)
            .height(36)
            .fontSize(14)
            .backgroundColor('rgba(248,87,73,0.12)')
            .fontColor(this.pal().danger)
            .borderRadius(12)
            .border({ width: 1, color: 'rgba(248,87,73,0.35)' })
            .onClick(() => {
              this.runtime.respondApproval(item, false);
            })
        }
        .width('100%')
      } else {
        Text(approvalOutcomeLabel(item.approvalOutcome))
          .fontSize(12)
          .fontColor(this.pal().text2)
      }
    }
    .width('100%')
    .padding(12)
    .backgroundColor('rgba(245,166,35,0.09)')
    .borderRadius(14)
    .border({ width: 1, color: 'rgba(245,166,35,0.28)' })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  QuestionRow(item: ChatItem) {
    Column({ space: 10 }) {
      Row({ space: 6 }) {
        Text('?')
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.pal().primary)
        Text('需要回答')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal().primary)
          .letterSpacing(1)
      }
      ForEach(item.questions, (question: ChatQuestion) => {
        Column({ space: 6 }) {
          if (question.header.length > 0) {
            Text(question.header)
              .fontSize(11)
              .fontColor(this.pal().text2)
              .letterSpacing(0.5)
          }
          Text(question.question)
            .fontSize(14)
            .fontColor(this.pal().text)
            .textAlign(TextAlign.Start)
          if (question.detail.length > 0) {
            Text(question.detail)
              .fontSize(12)
              .fontColor(this.pal().text2)
              .textAlign(TextAlign.Start)
          }
          Flex({ wrap: FlexWrap.Wrap, direction: FlexDirection.Row }) {
            ForEach(question.options, (label: string) => {
              Text(label)
                .fontSize(13)
                .fontColor(question.selectedLabels.includes(label) ? '#FFFFFF' : this.pal().text2)
                .backgroundColor(question.selectedLabels.includes(label) ? this.pal().primary : this.pal().chip)
                .borderRadius(14)
                .border({ width: 1,
                  color: question.selectedLabels.includes(label) ? 'rgba(77,107,254,0.8)' : this.pal().borderStrong })
                .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .margin({ right: 6, bottom: 6 })
                .onClick(() => {
                  this.runtime.toggleQuestionOption(item, question, label);
                })
            }, (label: string) => `${question.id}:${label}`)
          }
          .width('100%')
          if (question.multiSelect) {
            Text(this.tr('可多选'))
              .fontSize(11)
              .fontColor(this.pal().text3)
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }, (question: ChatQuestion) => question.id)
      if (item.questionOutcome.length === 0) {
        Button(this.tr('提交回答'))
          .width('100%')
          .height(38)
          .fontSize(14)
          .backgroundColor(this.pal().primary)
          .fontColor('#FFFFFF')
          .borderRadius(12)
          .enabled(this.busyAction.length === 0)
          .onClick(() => {
            this.runtime.submitQuestion(item);
          })
      } else {
        Text(questionOutcomeLabel(item.questionOutcome))
          .fontSize(12)
          .fontColor(this.pal().text2)
      }
    }
    .width('100%')
    .padding(12)
    .backgroundColor('rgba(77,107,254,0.08)')
    .borderRadius(14)
    .border({ width: 1, color: 'rgba(77,107,254,0.25)' })
    .alignItems(HorizontalAlign.Start)
  }
}

function deviceAvatarLabel(device: RemoteHostDevice, displayName: string): string {
  const name: string = displayName.trim();
  if (name.length > 0) {
    return name.substring(0, 1).toUpperCase();
  }
  return 'H';
}

/** Last path segment of the session workspace, e.g. '/a/WorkBuddy' -> 'WorkBuddy'. */
function cwdLabel(cwd: string): string {
  let trimmed: string = cwd;
  while (trimmed.length > 1 && trimmed.charAt(trimmed.length - 1) === '/') {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }
  if (trimmed.length === 0) {
    return '';
  }
  const slash: number = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.substring(slash + 1) : trimmed;
}

/** Human label of the server base URL: strip the scheme and any trailing slash. */
function serverHostLabel(url: string): string {
  let label: string = url;
  if (label.startsWith('https://')) {
    label = label.substring(8);
  } else if (label.startsWith('http://')) {
    label = label.substring(7);
  }
  while (label.length > 0 && label.charAt(label.length - 1) === '/') {
    label = label.substring(0, label.length - 1);
  }
  return label.length > 0 ? label : t('未配置服务器');
}

function formatSessionTitle(session: HarnessRemoteSession): string {
  const title: string = session.title.trim();
  if (title.length > 0) {
    return title;
  }
  if (session.blank) {
    return t('新会话');
  }
  const shortId: string = session.sessionId.substring(0, 8);
  return english() ? `Session ${shortId}` : `会话 ${shortId}`;
}

/** 会话行的 Agent 后端徽标：按 sessionId 前缀投影（与上游 Android backend-groups 同口径）。 */
function sessionBackendBadge(sessionId: string): string {
  if (sessionId.startsWith('codex:')) {
    return 'Codex';
  }
  if (sessionId.startsWith('claude:')) {
    return 'Claude';
  }
  if (sessionId.startsWith('cursor:')) {
    return 'Cursor';
  }
  if (sessionId.startsWith('opencode:')) {
    return 'OpenCode';
  }
  if (sessionId.startsWith('antigravity:')) {
    return 'AntiGravity';
  }
  if (sessionId.startsWith('hermes:')) {
    return 'Hermes';
  }
  if (sessionId.startsWith('pi:')) {
    return 'Pi';
  }
  return '';
}

/** 今天 / 昨天 / 更早 —— 会话列表分组用。 */
function sessionGroupLabel(updatedAt: number): string {
  if (updatedAt <= 0) {
    return t('更早');
  }
  const now: Date = new Date();
  const then: Date = new Date(updatedAt);
  const startOfToday: number = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (updatedAt >= startOfToday) {
    return t('今天');
  }
  if (updatedAt >= startOfToday - 86400000) {
    return t('昨天');
  }
  return t('更早');
}

function formatSessionTime(updatedAt: number): string {
  if (updatedAt <= 0) {
    return '';
  }
  const date: Date = new Date(updatedAt);
  const now: Date = new Date();
  const month: number = date.getMonth() + 1;
  const day: number = date.getDate();
  const hour: number = date.getHours();
  const minute: number = date.getMinutes();
  const minuteText: string = minute < 10 ? `0${minute}` : `${minute}`;
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return `${hour}:${minuteText}`;
  }
  if (english()) {
    const monthNames: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName: string = monthNames[month - 1];
    if (date.getFullYear() === now.getFullYear()) {
      return `${monthName} ${day} ${hour}:${minuteText}`;
    }
    return `${monthName} ${day}, ${date.getFullYear()}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}月${day}日 ${hour}:${minuteText}`;
  }
  return `${date.getFullYear()}年${month}月${day}日`;
}

function approvalOutcomeLabel(outcome: string): string {
  if (outcome === 'allowed-once') {
    return t('已允许');
  }
  if (outcome === 'rejected') {
    return t('已拒绝');
  }
  if (outcome === 'cancelled') {
    return t('已取消');
  }
  return t('已失效');
}

function questionOutcomeLabel(outcome: string): string {
  if (outcome === 'answered') {
    return t('已回答');
  }
  if (outcome === 'queued') {
    return t('已提交');
  }
  return t('已取消');
}


/** 消息图片的小缓存：按 src 存解码好的 PixelMap，失败也记下来避免反复请求。 */
class MarkdownImageCache {
  private pixels: Map<string, PixelMap> = new Map<string, PixelMap>();
  private failures: Map<string, string> = new Map<string, string>();
  private pending: Map<string, boolean> = new Map<string, boolean>();

  has(key: string): boolean {
    return this.pixels.has(key);
  }

  /** 调用方先用 has() 判过；这里取不到就是逻辑错误，直接抛出去暴露。 */
  pixel(key: string): PixelMap {
    const hit: PixelMap | undefined = this.pixels.get(key);
    if (hit === undefined) {
      throw new Error('image not cached: ' + key);
    }
    return hit;
  }

  errorOf(key: string): string {
    const hit: string | undefined = this.failures.get(key);
    return hit === undefined ? '' : hit;
  }

  isPending(key: string): boolean {
    return this.pending.has(key);
  }

  markPending(key: string): void {
    this.pending.set(key, true);
  }

  put(key: string, pixel: PixelMap): void {
    this.pending.delete(key);
    this.failures.delete(key);
    this.pixels.set(key, pixel);
    // LRU：一张手机截图解码后约 8~10MB，长会话里不设上限会吃满内存
    while (this.pixels.size > 20) {
      const oldest: string | undefined = this.pixels.keys().next().value;
      if (oldest === undefined || oldest === key) {
        break;
      }
      this.pixels.delete(oldest);
    }
  }

  fail(key: string, reason: string): void {
    this.pending.delete(key);
    this.failures.set(key, reason);
  }

  forget(key: string): void {
    this.pending.delete(key);
    this.failures.delete(key);
    this.pixels.delete(key);
  }
}

/** 本地图片以 data URI 交给 Image / 预览层，省掉一次 PixelMap 编解码。 */
function imageDataUri(base64: string): string {
  return base64.startsWith('data:') ? base64 : 'data:image/jpeg;base64,' + base64;
}

function isRemoteImage(src: string): boolean {
  return src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:');
}

/** base64 → PixelMap；主机 readBytes 给的是标准 base64。 */
function decodeBase64Image(base64: string): Promise<PixelMap> {
  const bytes: Uint8Array = new util.Base64Helper().decodeSync(base64);
  const source: image.ImageSource = image.createImageSource(bytes.buffer as ArrayBuffer);
  return source.createPixelMap();
}

/** 设置面板里的一项主题选择。 */
class ThemeChoice {
  value: number = 0;
  label: string = '';
  hint: string = '';

  constructor(value: number, label: string, hint: string) {
    this.value = value;
    this.label = label;
    this.hint = hint;
  }
}

/** 一行可直接渲染的 Markdown 内容。 */
/** 只取时分，用于消息操作面板这类小地方。 */
/** 把 markdown 里所有 ``` 代码块内容拼出来（不含围栏），没有就返回空串。 */
function extractCodeBlocks(text: string): string {
  const out: string[] = [];
  const lines: string[] = text.split('\n');
  let inside: boolean = false;
  let buffer: string[] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inside) {
        out.push(buffer.join('\n'));
        buffer = [];
      }
      inside = !inside;
      continue;
    }
    if (inside) {
      buffer.push(line);
    }
  }
  return out.join('\n\n');
}

/** 两个时间戳是否同一天。 */
function sameDay(a: number, b: number): boolean {
  const da: Date = new Date(a);
  const db: Date = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

/** 日期分隔文案：今天 / 昨天 / M月d日。 */
function dayDividerLabel(timestamp: number, english: boolean): string {
  if (timestamp <= 0) {
    return '';
  }
  const target: Date = new Date(timestamp);
  const now: Date = new Date();
  const sameAsToday: boolean = sameDay(timestamp, now.getTime());
  const yesterday: Date = new Date(now.getTime() - 86400000);
  const sameAsYesterday: boolean = sameDay(timestamp, yesterday.getTime());
  if (sameAsToday) {
    return english ? 'Today' : '今天';
  }
  if (sameAsYesterday) {
    return english ? 'Yesterday' : '昨天';
  }
  const month: number = target.getMonth() + 1;
  const day: number = target.getDate();
  return english ? `${month}/${day}` : `${month}月${day}日`;
}

/** 取工作区路径的末段，作为会话行的目录提示。 */
function cwdTail(cwd: string): string {
  if (cwd.length === 0) {
    return '';
  }
  const trimmed: string = cwd.endsWith('/') ? cwd.substring(0, cwd.length - 1) : cwd;
  const cut: number = trimmed.lastIndexOf('/');
  return cut >= 0 ? trimmed.substring(cut + 1) : trimmed;
}

function formatClock(timestamp: number): string {
  if (timestamp <= 0) {
    return '';
  }
  const date: Date = new Date(timestamp);
  const hh: string = date.getHours() < 10 ? '0' + date.getHours() : '' + date.getHours();
  const mm: string = date.getMinutes() < 10 ? '0' + date.getMinutes() : '' + date.getMinutes();
  return hh + ':' + mm;
}

class MdLine {
  text: string = '';
  code: boolean = false;
  heading: boolean = false;
  bullet: boolean = false;
  /** 非空表示这一行是图片，值是 markdown 里的 src。 */
  imageSrc: string = '';
  imageAlt: string = '';
  /** 非空表示这一行整行就是一个链接。 */
  linkUrl: string = '';
  table: string[][] = [];
  columnWidths: number[] = [];
}

/** 一行里切出来的片段：要么是文字，要么是一张图。 */
class MdSegment {
  text: string = '';
  imageSrc: string = '';
  imageAlt: string = '';
  isImage: boolean = false;
}

/** 把一行里的 ![](src) 逐个切出来，其余当文字。 */
function splitMdImages(body: string): MdSegment[] {
  const out: MdSegment[] = [];
  let cursor: number = 0;
  while (cursor < body.length) {
    const start: number = body.indexOf('![', cursor);
    if (start < 0) {
      break;
    }
    const labelEnd: number = body.indexOf('](', start + 2);
    if (labelEnd < 0) {
      break;
    }
    const urlEnd: number = body.indexOf(')', labelEnd + 2);
    if (urlEnd < 0) {
      break;
    }
    const src: string = body.substring(labelEnd + 2, urlEnd).trim();
    if (src.length === 0) {
      cursor = urlEnd + 1;
      continue;
    }
    const before: string = body.substring(cursor, start).trim();
    if (before.length > 0) {
      const textSeg: MdSegment = new MdSegment();
      textSeg.text = before;
      out.push(textSeg);
    }
    const imageSeg: MdSegment = new MdSegment();
    imageSeg.isImage = true;
    imageSeg.imageSrc = src;
    imageSeg.imageAlt = body.substring(start + 2, labelEnd).trim();
    out.push(imageSeg);
    cursor = urlEnd + 1;
  }
  const rest: string = body.substring(cursor).trim();
  if (rest.length > 0) {
    const textSeg: MdSegment = new MdSegment();
    textSeg.text = rest;
    out.push(textSeg);
  }
  return out;
}

/** 保留转义竖线，只用未转义的竖线分列。 */
function markdownTableCells(line: string): string[] {
  const body: string = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell: string) => cell.trim().replace(/\\\|/g, '|'));
}

function appendMarkdownTableRow(table: MdLine, cells: string[]): void {
  const row: string[] = [];
  for (let column: number = 0; column < table.columnWidths.length; column++) {
    const cell: string = (cells[column] ?? '').replace(/`|\*\*|__/g, '');
    const measured: number = cell.replace(/[^\x00-\x7F]/g, 'xx').length * 7 + 16;
    table.columnWidths[column] = Math.max(table.columnWidths[column], Math.min(260, measured));
    row.push(cell);
  }
  table.table.push(row);
}

/** 把 Markdown 拆成可渲染的行，并去掉会裸露的标记符号。 */
function markdownLines(source: string): MdLine[] {
  const out: MdLine[] = [];
  const raw: string[] = source.split(String.fromCharCode(10));
  let inCode: boolean = false;
  for (let index: number = 0; index < raw.length; index++) {
    const line: string = raw[index].trimEnd();
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      if (line.length > 0) {
        const code: MdLine = new MdLine();
        code.text = line;
        code.code = true;
        out.push(code);
      }
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    if (index + 1 < raw.length && /(?<!\\)\|/.test(line)) {
      const header: string[] = markdownTableCells(line);
      const divider: string[] = markdownTableCells(raw[index + 1]);
      if (header.length === divider.length && divider.every((cell: string) => /^:?-+:?$/.test(cell))) {
        const table: MdLine = new MdLine();
        table.columnWidths = header.map(() => 96);
        appendMarkdownTableRow(table, header);
        index++;
        while (index + 1 < raw.length && /(?<!\\)\|/.test(raw[index + 1])
          && !raw[index + 1].trimStart().startsWith('```')) {
          index++;
          appendMarkdownTableRow(table, markdownTableCells(raw[index]));
        }
        out.push(table);
        continue;
      }
    }
    const entry: MdLine = new MdLine();
    let body: string = line.trim();
    if (body.startsWith('### ')) {
      entry.heading = true;
      body = body.substring(4);
    } else if (body.startsWith('## ')) {
      entry.heading = true;
      body = body.substring(3);
    } else if (body.startsWith('# ')) {
      entry.heading = true;
      body = body.substring(2);
    } else if (body.startsWith('- ') || body.startsWith('* ')) {
      entry.bullet = true;
      body = body.substring(2);
    }
    body = body.split('`').join('');
    body = body.split('**').join('');
    body = body.split('__').join('');
    // 图片单独出行：文字段沿用当前标记（标题/列表），图片段单独成行
    const segments: MdSegment[] = splitMdImages(body);
    if (segments.length === 0) {
      continue;
    }
    for (const segment of segments) {
      if (segment.isImage) {
        const imageLine: MdLine = new MdLine();
        imageLine.imageSrc = segment.imageSrc;
        imageLine.imageAlt = segment.imageAlt;
        out.push(imageLine);
        continue;
      }
      const textLine: MdLine = new MdLine();
      textLine.heading = entry.heading;
      textLine.bullet = entry.bullet;
      // 整行 [文字](url) → 可点击；行内链接降级成「文字（url）」，避免裸露 markdown
      const wholeLink: RegExpMatchArray | null = segment.text.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (wholeLink !== null) {
        textLine.linkUrl = wholeLink[2];
        textLine.text = wholeLink[1];
      } else {
        textLine.text = segment.text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
          (match: string, label: string, url: string) => `${label}（${url}）`);
      }
      if (textLine.text.length > 0) {
        out.push(textLine);
      }
    }
  }
  return out;
}
