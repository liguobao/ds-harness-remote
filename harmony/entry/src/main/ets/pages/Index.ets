import { KeyboardAvoidMode, UIContext, display, window, promptAction } from '@kit.ArkUI';
import { pdfService, pdfViewManager, PdfView } from '@kit.PDFKit';
import { common, Want } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { AppRuntime, ChatItem, ChatQuestion, DEFAULT_SERVER_URL, DEFAULT_ACCOUNT, PHASE_BOOT, PHASE_CHAT,
  PHASE_CONNECTING, PHASE_DEVICES, PHASE_SETUP, ModelOption, SlashCommand,
  getAppRuntime, errorMessage } from '../services/AppRuntime';
import { RemoteHostDevice } from '../model/Types';
import { DirectoryEntry, HarnessWorkspace } from '../net/HarnessClient';
import { HarnessRemoteSession } from '../net/HarnessClient';
import { darkPalette, lightPalette, Palette } from '../services/Theme';
import { OAuthProvider, clientVersion as appVersion } from '../net/ServerApi';
import { t, english, LANG_SYSTEM, LANG_ZH, LANG_EN } from '../services/I18n';
import {
  Breakpoint, FoldState, breakpointOf, contentColumnWidth, deviceColumns, foldStateOf,
  isCompactWidth, isExpandedWidth, mascotVisible
} from '../services/Adaptive';
import { PickedImage, pickImages } from '../services/ImagePicker';
import { SavedProfile } from '../services/SecureStore';
import { PromptImagePart } from '../net/HarnessClient';
import { RtcBridge } from '../services/RtcBridge';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import BuildProfile from 'BuildProfile';

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
  @State renamingSession: boolean = false;
  @State sessionTitleInput: string = '';
  /** 会话搜索。 */
  @State sessionSearchInput: string = '';
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
  /** 斜杠命令候选。 */
  @State slashCommands: SlashCommand[] = [];
  /** 模型选择器。 */
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
  @State profilesList: SavedProfile[] = [];
  /** 「更多」面板（替代系统菜单，自己控制对比度）。 */
  @State showMoreMenu: boolean = false;
  /** 服务器切换面板。 */
  @State showServerSwitch: boolean = false;
  /** 通用设置的点选面板。 */
  @State choiceOpen: boolean = false;
  @State choiceKind: string = '';
  /** 单台设备的操作面板（卡片 ⋯）。 */
  @State deviceMenuId: string = '';
  /** 按下中的服务器行 key，用来做明显的按压反馈。 */
  @State pressedChoiceKey: string = '';
  /** 官方服务器固定地址，切换时直接可选，不用手输。 */
  private static readonly OFFICIAL_SERVER: string = 'https://dsh.r2049.cn';
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
  /** 切换服务器中（与 runtime 同步），用于设备页的即时提示与防重复点击。 */
  @State switchingServer: boolean = false;
  @State switchingTo: string = '';
  /** 提示词面板（本地提示词库）。 */
  @State promptPanelOpen: boolean = false;
  /** 执行轨迹面板：把本次会话里的工具调用按顺序列成时间线。 */
  @State trajectoryOpen: boolean = false;
  /** 新建工作区面板。 */
  @State workspaceCreateOpen: boolean = false;
  /** 文本文件预览面板。 */
  @State filePreviewOpen: boolean = false;
  /** 预览的是不是 PDF（走系统 PDF Kit 渲染）。 */
  @State previewIsPdf: boolean = false;
  @State pdfError: string = '';
  private pdfController: pdfViewManager.PdfController = new pdfViewManager.PdfController();
  /** 消息操作面板（自绘，替代系统 ActionSheet）。 */
  @State messageActionsOpen: boolean = false;
  @State messageActionText: string = '';
  @State messageActionKind: string = '';
  @State messageActionSeq: number = 0;
  /** 会话列表只看收藏。 */
  @State favoriteOnly: boolean = false;
  @State workspacePathInput: string = '';
  @State workspaceNameDraft: string = '';
  @State promptDraftInput: string = '';
  /** 上一次同步到的会话 id，用来判断「切了会话」并搬运草稿。 */
  private lastSyncedSessionId: string = '';
  private draftSaveTimer: number = -1;
  @State permissionOptionsList: string[] = [];
  /** 工作区选择。 */
  @State workspaces: HarnessWorkspace[] = [];
  @State selectedWorkspaceId: string = '';
  /** 待选推理等级的模型（null 表示未进入等级选择）。 */
  @State pendingModel: ModelOption | undefined = undefined;
  /** 文件浏览面板。 */
  @State showBrowser: boolean = false;
  @State browsePath: string = '';
  @State directoryEntries: DirectoryEntry[] = [];
  /** 工作区改名。 */
  @State editingWorkspaceId: string = '';
  @State workspaceTitleInput: string = '';

  @State serverInput: string = '';
  @State emailInput: string = '';
  @State passwordInput: string = '';
  @State promptInput: string = '';
  @State qrUrl: string = '';
  @State providers: OAuthProvider[] = [];
  @State providerId: string = '';
  private providersRequested: boolean = false;
  @State showSessions: boolean = false;
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
  @State namePreviewId: string = '';
  @State headerNamePopup: boolean = false;
  @State themeMode: number = 0;
  @State languageMode: number = 0;
  @State isDarkUi: boolean = false;
  @State showSettings: boolean = false;
  /** 是否跟随最新消息；用户往上翻时置 false，避免流式输出把列表一直拽到底。 */
  @State stickToBottom: boolean = true;
  private searchDebounceTimer: number = -1;
  /** 上一次强制贴底的会话 id，用于区分「刚切进来」还是「流式更新」。 */
  private lastScrolledSessionId: string = '';
  /** chatRows 缓存：流式输出时每帧全量重算太贵。 */
  private chatRowsKey: string = '';
  private chatRowsCache: ChatItem[] = [];
  /** 图片全屏预览：src、缩放与平移。 */
  @State previewSrc: string = '';
  @State previewActive: boolean = false;
  @State previewScale: number = 1;
  @State previewOffsetX: number = 0;
  @State previewOffsetY: number = 0;
  /** 输入坞上跟随手指/鼠标的光斑位置与强度。 */
  @State dockLightX: number = 0;
  @State dockLightY: number = 0;
  @State dockLightOpacity: number = 0;
  /** 列表下方陪伴小人的呼吸状态（由定时器来回切）。 */
  @State maidBob: boolean = false;
  private maidTimer: number = -1;
  private dockLightHideTimer: number = -1;
  /** 录音已停止、等主机转写。 */
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
    // 陪伴小人：每 2 秒翻身一次，配合 .animation 就是来回呼吸
    this.maidTimer = setInterval(() => {
      this.maidBob = !this.maidBob;
    }, 2000);
  }

  aboutToDisappear(): void {
    if (this.maidTimer >= 0) {
      clearInterval(this.maidTimer);
      this.maidTimer = -1;
    }
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
      this.filePreviewOpen = false;
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
    if (this.showServerSwitch || this.showMoreMenu || this.showModelPicker
      || this.showSessionPanel || this.showBrowser || this.showSettings) {
      this.showServerSwitch = false;
      this.showMoreMenu = false;
      this.showModelPicker = false;
      this.showSessionPanel = false;
      this.showBrowser = false;
      this.showSettings = false;
      return true;
    }
    if (this.showSessions) {
      this.closeDrawer();
      return true;
    }
    if (this.phase === PHASE_CHAT) {
      // 会话页 → 主机列表，连接保持不断（和左上角箭头同一个行为）
      this.runtime.keepAliveToDevices();
      return true;
    }
    if (this.phase === PHASE_CONNECTING) {
      this.runtime.cancelConnect();
      return true;
    }
    return false;
  }

  onPageShow(): void {
    this.runtime.appBackground = false;
  }

  onPageHide(): void {
    this.runtime.appBackground = true;
  }

  private measureInsets(): void {
    window.getLastWindow(getContext(this)).then((win: window.Window) => {
      this.mainWindow = win;
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
    const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    context.openLink(url).catch(() => {
      const want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: url
      };
      context.startAbility(want).catch(() => {
      });
    });
  }

  private syncFromRuntime(): void {
    this.phase = this.runtime.phase;
    this.busy = this.runtime.busy;
    this.busyAction = this.runtime.busyAction;
    this.errorMsg = this.runtime.errorMsg;
    this.devices = this.runtime.devices.slice();
    this.sessions = this.runtime.sessions.slice();
    this.sessionsLoadFailed = this.runtime.sessionsLoadFailed;
    this.messages = this.runtime.messages.slice();
    this.generating = this.runtime.generating;
    this.currentSessionId = this.runtime.currentSessionId;
    this.currentSessionTitle = this.runtime.currentSessionTitle;
    this.infoMsg = '';
    this.contextPercent = this.runtime.contextPercent;
    this.connectedTransport = this.runtime.transportLabel;
    this.connectStage = this.runtime.connectStage;
    this.slashCommands = this.runtime.slashCommands;
    this.modelOptions = this.runtime.modelOptions;
    this.currentModelLabel = this.runtime.currentModelLabel;
    this.currentModelProvider = this.runtime.currentModelProvider;
    this.currentModelEffort = this.runtime.currentModelEffort;
    this.textScaleMode = this.runtime.textScaleMode;
    this.profilesList = this.runtime.profiles.slice();
    this.textScaleValue = this.runtime.textScale();
    this.permissionPreset = this.runtime.permissionPreset;
    this.permissionOptionsList = this.runtime.permissionOptions.slice();
    this.workspaces = this.runtime.workspaces;
    this.selectedWorkspaceId = this.runtime.selectedWorkspaceId;
    this.browsePath = this.runtime.browsePath;
    this.directoryEntries = this.runtime.directoryEntries;
    if (this.sessionSearchActive) {
      const found: HarnessRemoteSession[] | undefined = this.runtime.searchResults;
      this.sessionSearchResults = found !== undefined ? found : [];
    }
    // 切了会话：先把上一段草稿存回去，再把新会话的草稿捞出来
    if (this.lastSyncedSessionId !== this.currentSessionId) {
      if (this.lastSyncedSessionId.length > 0) {
        this.runtime.saveDraft(this.lastSyncedSessionId, this.promptInput);
      }
      this.lastSyncedSessionId = this.currentSessionId;
      this.promptInput = this.runtime.draftOf(this.currentSessionId);
    }
    this.switchingServer = this.runtime.switchingServer;
    this.switchingTo = this.runtime.switchingTo;
    this.connectedHostName = this.runtime.connectedHostName;
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
    this.providers = this.runtime.providers.slice();
    this.providerId = this.runtime.providerId;
    if (this.phase === PHASE_SETUP && !this.providersRequested) {
      this.providersRequested = true;
      this.runtime.loadProviders(this.serverInput);
    }
    if (!this.fieldsPrefilled) {
      // Prefill the official public Server so a fresh install never dials an empty or dead address.
      this.serverInput = this.runtime.serverUrl.length > 0 ? this.runtime.serverUrl : DEFAULT_SERVER_URL;
      this.emailInput = this.runtime.email.length > 0 ? this.runtime.email : DEFAULT_ACCOUNT;
      this.fieldsPrefilled = true;
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

  private sendTap(): void {
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
  private shortAccount(): string {
    const email: string = this.accountEmail;
    if (email.length === 0) {
      return '';
    }
    const at: number = email.indexOf('@');
    const head: string = at > 0 ? email.substring(0, at) : email;
    return head.length > 18 ? head.substring(0, 18) + '…' : head;
  }

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
              fontColor: '#F85749',
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

  /** 当前服务器胶囊文案  /** 顶栏切换按钮的文案：只给「官方 / 本地 / 自定义」短标签，长邮箱不该出现在这里。 */
  private accountSwitchLabel(): string {
    const url: string = this.runtime.serverUrl;
    if (url.length === 0) {
      return this.tr('切换账号');
    }
    const host: string = serverHostLabel(url);
    if (url.indexOf('dsh.r2049.cn') >= 0) {
      return this.tr('官方') + ' · ' + host;
    }
    if (url.indexOf('192.168.') >= 0 || url.indexOf('127.0.0.1') >= 0 || url.indexOf('localhost') >= 0) {
      return this.tr('本地') + ' · ' + host;
    }
    return host;
  }

  /** 主机选择页直接切换服务器/账号：列出已保存的登录态，点了就换（不用重输密码）。 */
  private openAccountSwitcher(): void {
    this.showMoreMenu = false;
    this.showServerSwitch = true;
  }

  /** 服务器候选：已保存的登录态 + 内置的官方/本地出口（去重）。 */
  private serverChoices(): ServerChoice[] {
    const out: ServerChoice[] = [];
    const currentUrl: string = this.runtime.serverUrl;
    const currentEmail: string = this.runtime.email;
    const push = (url: string, email: string, profile: SavedProfile | undefined): void => {
      const emailFull: string = email;
      for (const existing of out) {
        // 同一个服务器只留一条（先入为主的是已保存的登录态）
        if (existing.url === url) {
          return;
        }
      }
      const choice: ServerChoice = new ServerChoice();
      choice.url = url;
      choice.account = this.shortEmail(emailFull);
      choice.accountFull = emailFull;
      choice.profile = profile;
      choice.host = serverHostLabel(url);
      choice.label = this.serverTag(url);
      choice.active = url === currentUrl && emailFull === currentEmail;
      out.push(choice);
    };
    for (const profile of this.profilesList) {
      push(profile.baseUrl, profile.email, profile);
    }
    push('https://dsh.r2049.cn', '', undefined);
    push('http://192.168.11.128:8080', '', undefined);
    return out;
  }

  /** 服务器短标签：官方 / 本地 / 自定义。 */
  private serverTag(url: string): string {
    if (url.indexOf('dsh.r2049.cn') >= 0) {
      return this.tr('官方服务器');
    }
    if (url.indexOf('192.168.') >= 0 || url.indexOf('127.0.0.1') >= 0 || url.indexOf('localhost') >= 0) {
      return this.tr('本地服务器');
    }
    return this.tr('自定义服务器');
  }

  /** 邮箱只留前缀并截断，避免长数字串撑行。 */
  private shortEmail(email: string): string {
    const at: number = email.indexOf('@');
    const head: string = at > 0 ? email.substring(0, at) : email;
    return head.length > 16 ? head.substring(0, 16) + '…' : head;
  }

  /** 选中某条服务器：有保存的登录态就直接切，没有就带上地址去登录页。 */
  /** 会话列表实际展示的条目：搜索优先，其次「只看收藏」。 */
  private visibleSessions(): HarnessRemoteSession[] {
    const base: HarnessRemoteSession[] = this.sessionSearchActive
      ? this.sessionSearchResults : this.sessions;
    if (!this.favoriteOnly) {
      return base;
    }
    return base.filter((session: HarnessRemoteSession) => this.runtime.isFavoriteSession(session.sessionId));
  }

  /** 最近访问的会话标题；列表里没有（已归档/换主机）时给个短 id。 */
  private recentSessionTitle(sessionId: string): string {
    for (const session of this.sessions) {
      if (session.sessionId === sessionId) {
        return formatSessionTitle(session);
      }
    }
    return '#' + sessionId.substring(sessionId.length - 6);
  }

  private chooseServerChoice(choice: ServerChoice): void {
    if (this.switchingServer) {
      return;
    }
    this.showServerSwitch = false;
    const profile: SavedProfile | undefined = choice.profile;
    if (profile !== undefined) {
      if (!choice.active) {
        this.runtime.switchProfile(profile);
      }
      return;
    }
    this.prefillAndLogout(choice.url);
  }

  /** 在已保存登录态里按服务器找一条。 */  /** 在已保存登录态里按服务器找一条。 */
  private findProfile(baseUrl: string): SavedProfile | undefined {
    for (const profile of this.profilesList) {
      if (profile.baseUrl === baseUrl) {
        return profile;
      }
    }
    return undefined;
  }

  /** 退出登录并把登录页的服务器地址预填成指定值（点击官方/本地切换时用）。 */
  private prefillAndLogout(baseUrl: string): void {
    this.serverInput = baseUrl;
    this.fieldsPrefilled = true;
    this.runtime.logout();
  }

  /** 文字大小：所有关键字号都过这个函数，改档位就是整体缩放。 */
  private fs(base: number): number {
    return Math.round(base * this.textScaleValue * 10) / 10;
  }

  /**
   * 一条消息要显示的图片：本地刚发的直接在 item.images 里；
   * 历史的只有 attachmentId，从运行时缓存里取（拉不到就是空，不占位）。
   */
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
  private drawerWidthVp(): number {
    const w: number = this.windowWidthVp > 0 ? this.windowWidthVp : 360;
    return Math.round(w * 0.82);
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
  private isWideLayout(): boolean {
    return isExpandedWidth(this.breakpoint);
  }

  /** 小女仆的出场条件：窗口够高就出来，手机横屏（约 405vp）这种就不挤列表。 */
  private showMascot(): boolean {
    return mascotVisible(this.breakpoint, this.windowHeightVp);
  }

  private listPanelWidth(): number {
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
  private contextPills(): string[] {
    const pills: string[] = [];
    const session: HarnessRemoteSession | undefined = this.currentSessionInfo();
    if (session === undefined) {
      return pills;
    }
    if (session.cwd.length > 0) {
      const label: string = cwdLabel(session.cwd);
      if (label.length > 0) {
        pills.push(label);
      }
    }
    if (session.turns > 0) {
      pills.push(`${session.turns} 轮`);
    }
    if (session.contextPercent > 0) {
      pills.push(`上下文 ${session.contextPercent}%`);
    }
    return pills;
  }

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
    return this.isDarkUi ? darkPalette() : lightPalette();
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
  private sessionGroupGap(index: number): string {
    const list: HarnessRemoteSession[] = this.sessionSearchActive ? this.sessionSearchResults : this.sessions;
    if (index < 0 || index >= list.length) {
      return '';
    }
    const label: string = sessionGroupLabel(list[index].updatedAt);
    if (index === 0) {
      return label;
    }
    return sessionGroupLabel(list[index - 1].updatedAt) === label ? '' : label;
  }

  /** 标题旁的连接状态点：重连中黄、已断开红、其余绿。 */
  private connectionDotColor(): string {
    const status: string = this.runtime.reconnectStatus;
    if (status.length > 0) {
      return '#F5A623';
    }
    if (this.phase === PHASE_CONNECTING) {
      return '#F5A623';
    }
    return '#34D399';
  }

  /** 设备页底部统计：英文环境换单位，避免模板里嵌死「台 / 在线」。 */
  private hostCountLabel(): string {
    return this.en() ? `${this.devices.length} hosts` : `${this.devices.length} 台主机`;
  }

  private onlineCountLabel(): string {
    return this.en() ? `${this.onlineDeviceCount()} online` : `${this.onlineDeviceCount()} 在线`;
  }

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
    const last: ChatItem | undefined = source.length > 0 ? source[source.length - 1] : undefined;
    const key: string = `${source.length}|${last === undefined ? 0 : last.rev}|${this.languageMode}`
      + `|${this.expandedRuns.join(',')}`;
    if (key === this.chatRowsKey) {
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
      current.rev = current.rev + 1;
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

  /** 设备卡第二行：平台 + 主机版本（Host 没上报版本时只显示平台）。 */
  private hostSubtitle(device: RemoteHostDevice): string {
    const head: string = device.platform.length > 0 ? device.platform : this.tr('远程主机');
    let base: string = head;
    if (device.harnessVersion.length > 0) {
      base = `${head} · ${this.tr('主机')} ${device.harnessVersion}`;
    } else if (device.clientVersion.length > 0) {
      base = `${head} · ${this.tr('插件')} ${device.clientVersion}`;
    }
    const seen: string = this.hostSeenLabel(device);
    return device.online ? base : `${base} · ${seen}`;
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
      return this.tr('离线');
    }
    if (diff < 3600000) {
      return this.en() ? `offline ${Math.round(diff / 60000)}m` : `离线 ${Math.round(diff / 60000)} 分钟`;
    }
    if (diff < 86400000) {
      return this.en() ? `offline ${Math.round(diff / 3600000)}h` : `离线 ${Math.round(diff / 3600000)} 小时`;
    }
    return this.en() ? `offline ${Math.round(diff / 86400000)}d` : `离线 ${Math.round(diff / 86400000)} 天`;
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
              fontColor: '#F85749',
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
      // 背景：顶部一层品牌蓝，底部再压一层青色光晕。
      // 底部这层是给输入坞玻璃「有颜色可透」用的——背后是纯白的话，材质再厚也透不出光感。
      Stack() {
        Column()
          .width('100%')
          .height('100%')
          .radialGradient({ center: ['50%', '0%'], radius: '70%',
            colors: [[this.isDarkUi ? 'rgba(77,107,254,0.18)' : 'rgba(77,107,254,0.10)', 0],
              ['rgba(77,107,254,0)', 1]] })
        Column()
          .width('100%')
          .height('100%')
          .radialGradient({ center: ['50%', '100%'], radius: '58%',
            colors: [[this.isDarkUi ? 'rgba(34,211,238,0.26)' : 'rgba(34,211,238,0.24)', 0],
              ['rgba(34,211,238,0)', 1]] })
        Column()
          .width('100%')
          .height('100%')
          .radialGradient({ center: ['18%', '88%'], radius: '42%',
            colors: [[this.isDarkUi ? 'rgba(147,97,255,0.18)' : 'rgba(147,97,255,0.12)', 0],
              ['rgba(147,97,255,0)', 1]] })
      }
      // 背景层用绝对定位铺满整个窗口（含上下安全区），
      // 否则根容器的 padding 会把渐变内缩，底栏下方那块留白露出纯色底，突然后一块白
      .height(this.windowHeightVp > 0 ? this.windowHeightVp : 800)
      .position({ x: 0, y: -this.topSafePadding() })
      .width('100%')
      .hitTestBehavior(HitTestMode.None)
      Column() {
        if (this.phase === PHASE_BOOT) {
          this.BootScreen()
        } else if (this.phase === PHASE_SETUP) {
          this.SetupScreen()
        } else if (this.phase === PHASE_DEVICES) {
          this.DevicesScreen()
        } else if (this.phase === PHASE_CONNECTING) {
          this.ConnectingScreen()
        } else {
          if (this.isLandscape) {
            Row() {
              this.SessionsPane()
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
      if (this.showSessions && !this.isLandscape) {
        this.SessionsOverlay()
      }
      // 挂载顺序 = 层级顺序：越靠后越在上层。
      // 设置面板在下面，它打开的二级点选必须排在它之后，否则会被压在设置底下点不到。
      if (this.showSettings) {
        this.SettingsOverlay()
      }
      if (this.showBrowser) {
        this.FileBrowserOverlay()
      }
      if (this.showSessionPanel) {
        this.SessionPanelOverlay()
      }
      if (this.showModelPicker) {
        this.ModelPickerOverlay()
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
      if (this.filePreviewOpen) {
        this.FilePreviewOverlay()
      }
      if (this.messageActionsOpen) {
        this.MessageActionsOverlay()
      }
      if (this.showMoreMenu) {
        this.MoreMenuOverlay()
      }
      if (this.showServerSwitch) {
        this.ServerSwitchOverlay()
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

  /**
   * 服务器切换面板：自绘列表，选中项有明确的三重反馈
   * （左侧青色竖条 + 高亮底 + 右侧 ✓），按下时行底色再压暗一档。
   */
  @Builder
  ServerSwitchOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.showServerSwitch = false;
        })
      Column({ space: 10 }) {
        Row() {
          Column({ space: 2 }) {
            Text(this.tr('切换服务器'))
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.pal().text)
            Text(this.tr('点一下即切换，不用重输密码'))
              .fontSize(11)
              .fontColor(this.pal().text3)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text('✕')
            .fontSize(15)
            .fontColor(this.pal().text3)
            .width(30)
            .height(30)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.showServerSwitch = false;
            })
        }
        .width('100%')
        .padding({ bottom: 4 })
        Scroll() {
          Column({ space: 10 }) {
            ForEach(this.serverChoices(), (choice: ServerChoice) => {
          Row({ space: 12 }) {
            // 单选指示：选中填满青色并带内圈白点
            Stack() {
              Column()
                .width(18)
                .height(18)
                .borderRadius(9)
                .border({ width: 2, color: choice.active ? '#22D3EE' : this.pal().borderStrong })
              if (choice.active) {
                Column()
                  .width(9)
                  .height(9)
                  .borderRadius(4.5)
                  .backgroundColor('#22D3EE')
              }
            }
            .width(18)
            .height(18)
            Column({ space: 3 }) {
              Text(choice.label)
                .fontSize(14)
                .fontWeight(choice.active ? FontWeight.Bold : FontWeight.Normal)
                .fontColor(this.pal().text)
                .width('100%')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(choice.account.length > 0 ? choice.host + ' · ' + choice.account : choice.host)
                .fontSize(11)
                .fontColor(this.pal().text3)
                .width('100%')
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            Text(choice.active ? '✓' : '›')
              .fontSize(choice.active ? 17 : 15)
              .fontColor(choice.active ? '#22D3EE' : this.pal().text3)
          }
          .width('100%')
          .padding({ top: 12, bottom: 12, left: 14, right: 14 })
          .backgroundColor(choice.active
            ? 'rgba(34,211,238,0.14)'
            : (this.pressedChoiceKey === choice.url + '|' + choice.account ? this.pal().inputBg : this.pal().card))
          .borderRadius(14)
          .border({
            width: choice.active ? 1.5 : 1,
            color: choice.active ? 'rgba(34,211,238,0.75)' : this.pal().border
          })
          .onTouch((event: TouchEvent) => {
            const key: string = choice.url + '|' + choice.account;
            if (event.type === TouchType.Down) {
              this.pressedChoiceKey = key;
            } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
              this.pressedChoiceKey = '';
            }
          })
          .onClick(() => {
            this.chooseServerChoice(choice);
          })
            }, (choice: ServerChoice) => 'sv-' + choice.url + '|' + choice.account)
          }
          .width('100%')
        }
        .scrollable(ScrollDirection.Vertical)
        .scrollBar(BarState.Auto)
        .constraintSize({ maxHeight: this.windowHeightVp > 0 ? this.windowHeightVp * 0.62 : 460 })
        .width('100%')
        Text(this.tr('登录其他服务器…'))
          .fontSize(13)
          .fontColor(this.pal().text2)
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 12, bottom: 12 })
          .backgroundColor(this.pal().chip)
          .borderRadius(14)
          .onClick(() => {
            this.showServerSwitch = false;
            this.runtime.logout();
          })
      }
      .width('100%')
      .constraintSize({ maxWidth: 480 })
      .padding({ left: 20, right: 20, top: 18, bottom: 24 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: 1, color: this.pal().border })
      .transition(TransitionEffect.translate({ y: 320 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 220, curve: Curve.Friction }))
    }
    .width('100%')
    .height('100%')
  }

  /**
   * 设备页「更多」面板：系统菜单在深色/浅色下对比度不受控（退出登录看不清），
   * 改成自己画：每行大字号 + 明确的底色，退出登录用红底白字。
   */
  @Builder
  MoreMenuOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.showMoreMenu = false;
        })
      Column({ space: 10 }) {
        Text(this.tr('更多'))
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.pal().text)
          .width('100%')
        Row({ space: 8 }) {
          Text(this.tr('切换服务器'))
            .fontSize(15)
            .fontColor(this.pal().text)
          Text(this.runtime.email.length > 0 ? this.runtime.email : '')
            .fontSize(11)
            .fontColor(this.pal().text3)
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .padding({ top: 14, bottom: 14, left: 16, right: 16 })
        .backgroundColor(this.pal().card)
        .borderRadius(14)
        .border({ width: 1, color: this.pal().border })
        .onClick(() => {
          this.showMoreMenu = false;
          this.openAccountSwitcher();
        })
        Row({ space: 8 }) {
          Text('⌁')
            .fontSize(15)
            .fontColor('#22D3EE')
          Text(this.tr('执行轨迹'))
            .fontSize(15)
            .fontColor(this.pal().text)
        }
        .width('100%')
        .padding({ top: 14, bottom: 14, left: 16, right: 16 })
        .backgroundColor(this.pal().card)
        .borderRadius(14)
        .border({ width: 1, color: this.pal().border })
        .onClick(() => {
          this.showMoreMenu = false;
          this.trajectoryOpen = true;
        })
        Text(this.tr('退出登录'))
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 14, bottom: 14 })
          .backgroundColor('#E5484D')
          .borderRadius(14)
          .onClick(() => {
            this.showMoreMenu = false;
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
                fontColor: '#F85749',
                action: () => {
                  this.runtime.logout();
                }
              }
            });
          })
        Text(this.tr('取消'))
          .fontSize(14)
          .fontColor(this.pal().text2)
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 12, bottom: 12 })
          .backgroundColor(this.pal().chip)
          .borderRadius(14)
          .onClick(() => {
            this.showMoreMenu = false;
          })
      }
      .width('100%')
      .constraintSize({ maxWidth: 420 })
      .padding({ left: 20, right: 20, top: 18, bottom: 26 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: 1, color: this.pal().border })
    }
    .width('100%')
    .height('100%')
  }

  /** 设置面板：主题做成可选列表，不再靠一颗按钮循环切。 */
  @Builder
  SettingsOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.showSettings = false;
        })
      Column() {
        Row() {
          Text(this.tr('设置'))
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Blank()
          Text(this.tr('完成'))
            .fontSize(13)
            .fontColor('#22D3EE')
            .padding({ left: 12, right: 4, top: 6, bottom: 6 })
            .onClick(() => {
              this.showSettings = false;
            })
        }
        .width('100%')
        .padding({ bottom: 6 })
        Scroll() {
          Column({ space: 16 }) {
            // —— 服务器 ——
            Column({ space: 8 }) {
              Text(this.tr('服务器'))
                .fontSize(11)
                .fontColor(this.pal().text3)
                .width('100%')
                .padding({ left: 4 })
              this.SettingsRow(this.tr('切换服务器'), this.currentServerSummary(), false, () => {
                this.showSettings = false;
                this.showServerSwitch = true;
              })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            // —— 通用（低频，点开再选）——
            Column({ space: 8 }) {
              Text(this.tr('通用'))
                .fontSize(11)
                .fontColor(this.pal().text3)
                .width('100%')
                .padding({ left: 4 })
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
              this.SettingsRow(this.tr('外观'), this.themeLabel(this.themeMode), false, () => {
                this.openChoice('theme');
              })
              this.SettingsRow(this.tr('文字大小'), this.textScaleLabel(), false, () => {
                this.openChoice('scale');
              })
              this.SettingsRow(this.tr('语言'), this.languageLabel(), false, () => {
                this.openChoice('language');
              })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
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
                      fontColor: '#F85749',
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
        .scrollBar(BarState.Auto)
        .constraintSize({ maxHeight: this.windowHeightVp > 0 ? this.windowHeightVp * 0.66 : 480 })
        .width('100%')
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

  /** 设置里的一行：左边标题、右边当前值 + 箭头。 */
  @Builder
  SettingsRow(title: string, value: string, danger: boolean, action: () => void) {
    Row({ space: 10 }) {
      Text(title)
        .fontSize(14)
        .fontColor(danger ? '#F85749' : this.pal().text)
      Blank()
      if (value.length > 0) {
        Text(value)
          .fontSize(12)
          .fontColor(this.pal().text3)
          .maxLines(1)
          .constraintSize({ maxWidth: 170 })
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      Text('›')
        .fontSize(15)
        .fontColor(this.pal().text3)
    }
    .width('100%')
    .padding({ top: 13, bottom: 13, left: 14, right: 14 })
    .backgroundColor(this.pal().card)
    .borderRadius(12)
    .border({ width: 1, color: this.pal().border })
    .onClick(() => {
      action();
    })
  }

  private currentServerSummary(): string {
    return this.accountSwitchLabel();
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

  private choiceTitleText(): string {
    if (this.choiceKind === 'theme') {
      return this.tr('外观');
    }
    if (this.choiceKind === 'scale') {
      return this.tr('文字大小');
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
    return this.languageChoices();
  }

  private choiceCurrentValue(): number {
    if (this.choiceKind === 'theme') {
      return this.themeMode;
    }
    if (this.choiceKind === 'scale') {
      return this.textScaleMode;
    }
    return this.languageMode;
  }

  private applyChoice(value: number): void {
    if (this.choiceKind === 'theme') {
      this.runtime.setThemeMode(value);
    } else if (this.choiceKind === 'scale') {
      this.runtime.setTextScaleMode(value);
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
          Text('✕')
            .fontSize(15)
            .fontColor(this.pal().text3)
            .width(30)
            .height(30)
            .textAlign(TextAlign.Center)
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
              Text('✓')
                .fontSize(16)
                .fontColor('#22D3EE')
            }
          }
          .width('100%')
          .padding({ top: 12, bottom: 12, left: 14, right: 14 })
          .backgroundColor(this.choiceCurrentValue() === choice.value
            ? 'rgba(34,211,238,0.14)' : this.pal().card)
          .borderRadius(12)
          .border({
            width: this.choiceCurrentValue() === choice.value ? 1.5 : 1,
            color: this.choiceCurrentValue() === choice.value
              ? 'rgba(34,211,238,0.75)' : this.pal().border
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
            .fontColor('#F85749')
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
        fontColor: '#F85749',
        action: () => {
          this.runtime.forgetHostPin(deviceId);
          this.errorMsg = '';
          this.infoMsg = this.tr('已清除该主机的公钥固定记录');
        }
      }
    });
  }

  @Builder
  LogoChip() {    Column() {
      Text('DS')
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .letterSpacing(2)
    }
    .width(72)
    .height(72)
    .borderRadius(22)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
    .shadow({ radius: 30, color: 'rgba(77,107,254,0.5)', offsetX: 0, offsetY: 10 })
  }

  @Builder
  BootScreen() {
    Column({ space: 14 }) {
      Blank()
      this.LogoChip()
      Text('DSH REMOTE')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.pal().text)
        .letterSpacing(6)
        .textShadow({ radius: 16, color: 'rgba(77,107,254,0.55)' })
      LoadingProgress()
        .width(36)
        .height(36)
        .color('#22D3EE')
      Text(this.tr('正在初始化…'))
        .fontSize(13)
        .fontColor(this.pal().text2)
        .letterSpacing(1)
      Blank()
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  SetupScreen() {
    Scroll() {
      Column() {
      Column({ space: 14 }) {
      this.LogoChip()
      Column({ space: 6 }) {
        Text('DSH REMOTE')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.pal().text)
          .letterSpacing(6)
          .textShadow({ radius: 18, color: 'rgba(77,107,254,0.6)' })
        Text(this.tr('连接你的 DEEPSEEK HARNESS 主机'))
          .fontSize(12)
          .fontColor(this.pal().text2)
          .letterSpacing(1)
      }
      if (this.profilesList.length > 0) {
        Column({ space: 8 }) {
          Text(this.tr('已保存的登录（一键进入）'))
            .fontSize(11)
            .fontColor(this.pal().text3)
            .width('100%')
          ForEach(this.profilesList, (profile: SavedProfile) => {
            Row({ space: 10 }) {
              Column({ space: 2 }) {
                Text(profile.email)
                  .fontSize(13)
                  .fontColor(this.pal().text)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(profile.baseUrl)
                  .fontSize(10)
                  .fontColor(this.pal().text3)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              Text(this.tr('进入'))
                .fontSize(11)
                .fontColor('#0B1220')
                .padding({ left: 12, right: 12, top: 5, bottom: 5 })
                .backgroundColor('#22D3EE')
                .borderRadius(10)
            }
            .width('100%')
            .padding({ top: 8, bottom: 8, left: 12, right: 12 })
            .backgroundColor(this.pal().chip)
            .borderRadius(12)
            .border({ width: 1, color: this.pal().border })
            .enabled(!this.busy)
            .onClick(() => {
              this.runtime.switchProfile(profile);
            })
          }, (profile: SavedProfile) => 'login-' + profile.baseUrl + '|' + profile.email)
        }
        .width('100%')
        .padding({ top: 4, bottom: 4 })
      }
      Row({ space: 8 }) {
        Text(this.tr('常用'))
          .fontSize(11)
          .fontColor(this.pal().text3)
        Text('官方 ' + 'dsh.r2049.cn')
          .fontSize(11)
          .fontColor(this.serverInput.indexOf('dsh.r2049.cn') >= 0 ? '#0B1220' : this.pal().text2)
          .padding({ left: 10, right: 10, top: 5, bottom: 5 })
          .backgroundColor(this.serverInput.indexOf('dsh.r2049.cn') >= 0 ? '#22D3EE' : this.pal().chip)
          .borderRadius(9)
          .border({ width: 1, color: this.pal().border })
          .onClick(() => {
            this.serverInput = 'https://dsh.r2049.cn';
          })
        Text(this.tr('本地') + ' 192.168.11.128')
          .fontSize(11)
          .fontColor(this.serverInput.indexOf('192.168.11.128') >= 0 ? '#0B1220' : this.pal().text2)
          .padding({ left: 10, right: 10, top: 5, bottom: 5 })
          .backgroundColor(this.serverInput.indexOf('192.168.11.128') >= 0 ? '#22D3EE' : this.pal().chip)
          .borderRadius(9)
          .border({ width: 1, color: this.pal().border })
          .onClick(() => {
            this.serverInput = 'http://192.168.11.128:8080';
          })
      }
      .width('100%')
      .padding({ top: 2, bottom: 2 })
      TextInput({ text: this.serverInput, placeholder: this.tr('服务器地址（http://…）') })
        .height(48)
        .backgroundColor(this.pal().chip)
        .fontColor(this.pal().text)
        .placeholderColor(this.pal().text3)
        .caretColor('#22D3EE')
        .borderRadius(14)
        .border({ width: 1, color: this.pal().borderStrong })
        .padding({ left: 16, right: 16 })
        .onChange((value: string) => {
          this.serverInput = value;
        })
      TextInput({ text: this.emailInput, placeholder: this.tr('邮箱') })
        .height(48)
        .backgroundColor(this.pal().chip)
        .fontColor(this.pal().text)
        .placeholderColor(this.pal().text3)
        .caretColor('#22D3EE')
        .borderRadius(14)
        .border({ width: 1, color: this.pal().borderStrong })
        .padding({ left: 16, right: 16 })
        .onChange((value: string) => {
          this.emailInput = value;
        })
      TextInput({ text: this.passwordInput, placeholder: this.tr('密码') })
        .type(InputType.Password)
        .height(48)
        .backgroundColor(this.pal().chip)
        .fontColor(this.pal().text)
        .placeholderColor(this.pal().text3)
        .caretColor('#22D3EE')
        .borderRadius(14)
        .border({ width: 1, color: this.pal().borderStrong })
        .padding({ left: 16, right: 16 })
        .onChange((value: string) => {
          this.passwordInput = value;
        })
        .onSubmit(() => {
          this.runtime.login(this.serverInput, this.emailInput, this.passwordInput);
        })
      Button(this.tr('登录'))
        .width('100%')
        .height(50)
        .backgroundColor(Color.Transparent)
        .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#3AA6F0', 0.55], ['#22D3EE', 1]] })
        .shadow({ radius: 18, color: 'rgba(77,107,254,0.45)', offsetX: 0, offsetY: 6 })
        .fontColor('#FFFFFF')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .borderRadius(14)
        .enabled(!this.busy)
        .onClick(() => {
          this.runtime.login(this.serverInput, this.emailInput, this.passwordInput);
        })
      if (this.providers.length > 0) {
        Column({ space: 8 }) {
          Text(this.tr('扫码 / 浏览器授权登录（选账号对应的提供商）'))
            .fontSize(12)
            .fontColor(this.pal().text2)
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Center }) {
            ForEach(this.providers, (item: OAuthProvider) => {
              Button(item.displayName)
                .height(38)
                .fontSize(13)
                .fontColor('#22D3EE')
                .backgroundColor(this.pal().chip)
                .borderRadius(19)
                .border({ width: 1, color: this.providerId === item.id ? 'rgba(34,211,238,0.9)' : this.pal().borderStrong })
                .margin(4)
                .enabled(!this.busy)
                .onClick(() => {
                  this.runtime.selectProvider(item.id);
                  this.runtime.startQrLogin(this.serverInput);
                })
            }, (item: OAuthProvider) => item.id)
          }
        }
        .width('100%')
      } else {
        Button(this.tr('扫码 / 浏览器授权登录'))
          .width('100%')
          .height(44)
          .backgroundColor(this.pal().chip)
          .fontColor('#22D3EE')
          .fontSize(14)
          .borderRadius(14)
          .border({ width: 1, color: this.pal().borderStrong })
          .enabled(!this.busy)
          .onClick(() => {
            this.runtime.loadProviders(this.serverInput);
            this.runtime.startQrLogin(this.serverInput);
          })
      }
      if (this.qrUrl.length > 0) {
        Column({ space: 10 }) {
          Text(this.tr('用已登录同一账号的浏览器扫码或点按钮授权'))
            .fontSize(12)
            .fontColor(this.pal().text2)
            .textAlign(TextAlign.Center)
          QRCode(this.qrUrl)
            .width(160)
            .height(160)
            .color('#0B0F19')
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
          Button(this.tr('在浏览器中打开授权页'))
            .width('100%')
            .height(40)
            .backgroundColor(Color.Transparent)
            .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#3AA6F0', 0.55], ['#22D3EE', 1]] })
            .fontColor('#FFFFFF')
            .fontSize(14)
            .borderRadius(12)
            .onClick(() => {
              this.openAuthorizeLink();
            })
          Text(this.qrUrl)
            .fontSize(11)
            .fontColor('#22D3EE')
            .copyOption(CopyOptions.LocalDevice)
            .textAlign(TextAlign.Center)
            .wordBreak(WordBreak.BREAK_ALL)
            .width('100%')
          Button(this.tr('复制授权链接'))
            .height(30)
            .fontSize(12)
            .fontColor(this.pal().text2)
            .backgroundColor(this.pal().border)
            .borderRadius(15)
            .onClick(() => {
              this.copyAuthorizeLink();
            })
          Row({ space: 12 }) {
            LoadingProgress()
              .width(18)
              .height(18)
              .color('#22D3EE')
            Text(this.tr('等待浏览器授权…'))
              .fontSize(12)
              .fontColor(this.pal().text2)
          }
          Button(this.tr('取消'))
            .height(32)
            .fontSize(12)
            .backgroundColor(this.pal().chip)
            .fontColor(this.pal().text2)
            .borderRadius(16)
            .onClick(() => {
              this.runtime.cancelQrLogin();
            })
        }
        .width('100%')
        .padding(12)
        .borderRadius(14)
        .backgroundColor(this.pal().card)
      }
      if (this.busy) {
        LoadingProgress()
          .width(24)
          .height(24)
          .color('#22D3EE')
      }
      if (this.infoMsg.length > 0) {
        Text(this.infoMsg)
          .fontSize(12)
          .fontColor('#34D399')
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 6, bottom: 2, left: 16, right: 16 })
      }
      if (this.errorMsg.length > 0) {
        Text(this.errorMsg)
          .fontSize(13)
          .fontColor('#F85749')
          .textAlign(TextAlign.Center)
        if (this.errorMsg.indexOf('设备身份读取失败') >= 0) {
          Row({ space: 8 }) {
            Text('重试')
              .fontSize(12)
              .fontColor(this.pal().text2)
              .padding({ left: 14, right: 14, top: 6, bottom: 6 })
              .backgroundColor(this.pal().chip)
              .borderRadius(14)
              .border({ width: 1, color: this.pal().borderStrong })
              .onClick(() => {
                const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
                this.runtime.retryBootstrap(context);
              })
            Text('重置设备身份')
              .fontSize(12)
              .fontColor('#FFFFFF')
              .padding({ left: 14, right: 14, top: 6, bottom: 6 })
              .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
              .borderRadius(14)
              .onClick(() => {
                const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
                AlertDialog.show({
                  title: this.tr('重置设备身份'),
                  message: this.tr('安全存储里的私钥已经读不到了。重置会生成一个新的设备身份，'
                    + '需要重新登录，服务器上会把这台设备当成新设备。继续？'),
                  primaryButton: {
                    value: this.tr('取消'),
                    action: () => {
                    }
                  },
                  secondaryButton: {
                    value: this.tr('重置'),
                    fontColor: '#F85749',
                    action: () => {
                      this.runtime.resetIdentityAndRestart(context);
                    }
                  }
                });
              })
          }
          .margin({ top: 8 })
        }
      }
      Row({ space: 10 }) {
        Text(this.buildTag())
          .fontSize(10)
          .fontColor(this.pal().text3)
        Text(this.tr('设置'))
          .fontSize(10)
          .fontColor('#22D3EE')
          .padding({ left: 8, right: 8, top: 3, bottom: 3 })
          .backgroundColor(this.pal().chip)
          .borderRadius(9)
          .onClick(() => {
            this.showSettings = true;
          })
      }
      .margin({ top: 4 })
      }
      .padding(24)
      .width('100%')
      .constraintSize({ maxWidth: 640 })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
  }

  @Builder
  DevicesScreen() {
    Column() {
      // 第一行：标题压在整行正中，按钮独立浮在右侧，标题位置不再被按钮宽度带偏
      Stack({ alignContent: Alignment.Center }) {
        Column({ space: 6 }) {
          Text(this.tr('DSH主机列表'))
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
            .letterSpacing(2)
          Row()
            .width(32)
            .height(3)
            .borderRadius(2)
            .linearGradient({ angle: 90, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
        }
        .alignItems(HorizontalAlign.Center)
        // 按钮组浮在右上角，宽度不参与标题居中计算
        Row({ space: 8 }) {
          Blank()
          Button({ type: ButtonType.Circle }) {
            Image($r('app.media.ic_settings'))
              .width(18)
              .height(18)
              .fillColor(this.pal().text2)
          }
          .width(32)
          .height(32)
          .backgroundColor(this.pal().chip)
          .border({ width: 1, color: this.pal().borderStrong })
          .onClick(() => {
            this.showSettings = true;
          })
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
      }
      .width('100%')
      // 宽屏：标题留在顶部，下面的「胶囊 + 主机卡片 + 小人」作为一组垂直居中
      if (this.isWideLayout()) {
        Blank()
      }
      // 第二行：当前服务器胶囊（自己一行，点开切换），不参与标题行竞争
      Row() {
        Row({ space: 6 }) {
          Column()
            .width(6)
            .height(6)
            .borderRadius(3)
            .backgroundColor('#22D3EE')
          Text(this.accountSwitchLabel())
            .fontSize(12)
            .fontColor(this.pal().text2)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text('⌄')
            .fontSize(11)
            .fontColor(this.pal().text3)
        }
        .padding({ left: 10, right: 10, top: 5, bottom: 5 })
        .backgroundColor(this.pal().chip)
        .borderRadius(12)
        .border({ width: 1, color: this.pal().border })
        .constraintSize({ maxWidth: 260 })
        .onClick(() => {
          this.openAccountSwitcher();
        })
        Blank()
      }
      .width('100%')
      .padding({ top: 8 })
      .width('100%')
      .padding({ left: 20, right: 20, top: 16, bottom: 12 })
      if (this.busy) {
        Row({ space: 8 }) {
          LoadingProgress()
            .width(18)
            .height(18)
            .color('#22D3EE')
          Text(this.switchingServer && this.switchingTo.length > 0
            ? this.tr('正在切换服务器…') + ' ' + serverHostLabel(this.switchingTo)
            : this.tr('正在刷新设备…'))
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
            .backgroundColor('#F85749')
          Text(this.errorMsg)
            .fontSize(this.fs(12))
            .fontColor('#F85749')
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text('✕')
            .fontSize(this.fs(12))
            .fontColor('#F85749')
            .padding({ left: 6, right: 2, top: 2, bottom: 2 })
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
      List({ space: 12 }) {
        ForEach(this.devices, (device: RemoteHostDevice) => {
          ListItem() {
            this.DeviceCard(device)
          }
        }, (device: RemoteHostDevice) => `${device.deviceId}#${this.languageMode}`)
      }
      .width('100%')
      // 宽屏双列：一列会留出大片空白，两列更像桌面端的主机面板
      .lanes(deviceColumns(this.breakpoint, this.devices.length))
      // 列表按内容高度（多台时滚动），剩下的空间交给下面的小人居中，别让她贴底
      .constraintSize({ maxHeight: 560 })
      .padding({ left: 20, right: 20, top: 8, bottom: 12 })
      .scrollBar(BarState.Off)
      // 陪伴小人固定一块高度，上下由两个 Blank 撑开，整页内容在宽屏里垂直居中
      if (this.showMascot()) {
        Column() {
          this.MaidMascot()
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      }
      if (this.isWideLayout()) {
        Blank()
      }
      if (this.devices.length === 0 && !this.busy) {
        // 空态别只留一行灰字：给一张卡片说清楚下一步该做什么
        Column({ space: 10 }) {
          Text('🖥')
            .fontSize(26)
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
              .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
              .borderRadius(10)
              .onClick(() => {
                this.runtime.refreshDevices();
              })
            Text(this.tr('切换服务器'))
              .fontSize(this.fs(12))
              .fontColor(this.pal().text2)
              .padding({ left: 16, right: 16, top: 8, bottom: 8 })
              .backgroundColor(this.pal().chip)
              .borderRadius(10)
              .border({ width: 1, color: this.pal().border })
              .onClick(() => {
                this.showServerSwitch = true;
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
      Column()
        .width('100%')
        .height(0.5)
        .backgroundColor(this.pal().border)
        .margin({ top: 8 })
      Row({ space: 12 }) {
        Column({ space: 2 }) {
          // 账号只显示邮箱前缀：google-110176351561077530156@… 那种长串会把整行吃掉
          Text(this.shortAccount())
            .fontSize(12)
            .fontColor(this.pal().text2)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          // 版本号跟在服务器域名后面，报障时一眼能报出装的是哪一版
          Text(serverHostLabel(this.accountServer) + ' · v' + appVersion())
            .fontSize(10)
            .fontColor(this.pal().text3)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Text(this.hostCountLabel() + ' · ' + this.onlineCountLabel())
          .fontSize(12)
          .fontColor(this.pal().text2)
          .maxLines(1)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 10, bottom: 12 })
    }
    .width('100%')
    .height('100%')
    .constraintSize({ maxWidth: this.deviceColumnWidth() })
  }

  /** 列表下方的陪伴小人：缓慢上下浮 + 轻微摆头，落地处有一圈随呼吸缩放的影子。 */
  @Builder
  MaidMascot() {
    Column({ space: 2 }) {
      Stack({ alignContent: Alignment.Bottom }) {
        Column()
          .width(104)
          .height(12)
          .borderRadius(6)
          .backgroundColor(this.isDarkUi ? 'rgba(0,0,0,0.30)' : 'rgba(90,120,190,0.16)')
          .scale({ x: this.maidBob ? 1 : 0.86 })
          .opacity(this.maidBob ? 0.9 : 0.6)
          .animation({ duration: 2000, curve: Curve.EaseInOut })
        Image($r('app.media.maid_mascot'))
          .width(158)
          .height(204)
          .objectFit(ImageFit.Contain)
          .translate({ y: this.maidBob ? -7 : 0 })
          .rotate({ angle: this.maidBob ? 1.2 : -1.2 })
          .animation({ duration: 2000, curve: Curve.EaseInOut })
      }
      .height(190)
      .width('100%')
      Text(this.tr('选一台主机，继续上次的工作'))
        .fontSize(12)
        .fontColor(this.pal().text3)
        .padding({ top: 2 })
    }
    .width('100%')
    .padding({ top: 2, bottom: 6 })
    .alignItems(HorizontalAlign.Center)
    .hitTestBehavior(HitTestMode.None)
  }

  @Builder
  DeviceCard(device: RemoteHostDevice) {
    Row({ space: 14 }) {
      // 主机头像：用电脑图形代替首字母圆圈（在线绿、离线灰）
      Stack({ alignContent: Alignment.BottomEnd }) {
        Image($r('app.media.ic_host'))
          .width(22)
          .height(22)
          .fillColor(device.online ? '#34D399' : this.pal().text3)
        Column()
          .width(9)
          .height(9)
          .borderRadius(4.5)
          .backgroundColor(device.online ? '#34D399' : this.pal().text3)
          .border({ width: 2, color: this.pal().card })
          .margin({ right: 1, bottom: 1 })
      }
      .width(44)
      .height(44)
      .padding(6)
      .backgroundColor(device.online ? 'rgba(52,211,153,0.10)' : this.pal().chip)
      .borderRadius(12)
      .border({ width: 1, color: device.online ? 'rgba(52,211,153,0.28)' : this.pal().border })
      Column({ space: 4 }) {
        if (this.renamingDeviceId === device.deviceId) {
          TextInput({ text: this.renameInput, placeholder: this.tr('输入主机名称') })
            .height(34)
            .fontSize(14)
            .fontColor(this.pal().text)
            .placeholderColor(this.pal().text3)
            .caretColor('#22D3EE')
            .backgroundColor(this.pal().inputBg)
            .borderRadius(10)
            .border({ width: 1, color: 'rgba(34,211,238,0.45)' })
            .padding({ left: 10, right: 10 })
            .onChange((value: string) => {
              this.renameInput = value;
            })
            .onSubmit(() => {
              this.confirmRename();
            })
        } else {
          Text(this.displayNameFor(device).length > 0 ? this.displayNameFor(device) : device.deviceId)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().text)
            // 手机上名字列只有 ~150vp，16sp 单行会把 DESKTOP-R5BVQJJ 截成 DESKTOP-...；
            // 放宽到两行、字号降一档，短名字仍是一行，长名字能看全。
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .onHover((isHover: boolean) => {
              const name: string = this.displayNameFor(device);
              this.namePreviewId = isHover && name.length > 12 ? device.deviceId : '';
            })
            .gesture(LongPressGesture()
              .onAction(() => {
                this.namePreviewId = device.deviceId;
              }))
            .bindPopup(this.namePreviewId === device.deviceId, {
              message: this.displayNameFor(device).length > 0 ? this.displayNameFor(device) : device.deviceId,
              placement: Placement.Bottom,
              autoCancel: true,
              onStateChange: (state: PopupStateChangeParam) => {
                if (!state.isVisible && this.namePreviewId === device.deviceId) {
                  this.namePreviewId = '';
                }
              }
            })
        }
        Row({ space: 5 }) {
          Column()
            .width(6)
            .height(6)
            .borderRadius(3)
            .backgroundColor(device.online ? '#34D399' : this.pal().text3)
          // 手机上右侧三个按钮把这一列压得很窄，单行省略会把版本号整段吃掉，
          // 所以允许折到第二行（整卡可点即连接，别指望用户读截断的字）
          Text(this.hostSubtitle(device))
            .fontSize(11)
            .fontColor(this.pal().text3)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      if (this.renamingDeviceId === device.deviceId) {
        Row({ space: 8 }) {
          Text(this.tr('取消'))
            .fontSize(12)
            .fontColor(this.pal().text2)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor(this.pal().chip)
            .borderRadius(14)
            .border({ width: 1, color: this.pal().borderStrong })
            .onClick(() => {
              this.cancelRename();
            })
          Text(this.tr('确定'))
            .fontSize(12)
            .fontColor('#FFFFFF')
            .padding({ left: 14, right: 14, top: 6, bottom: 6 })
            .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
            .borderRadius(14)
            .onClick(() => {
              this.confirmRename();
            })
        }
      } else {
        Text('⋯')
          .fontSize(15)
          .fontColor(this.pal().text2)
          .padding({ left: 9, right: 9, top: 3, bottom: 3 })
          .backgroundColor(this.pal().chip)
          .borderRadius(13)
          .border({ width: 1, color: this.pal().borderStrong })
          .onClick(() => {
            this.deviceMenuId = device.deviceId;
          })
        if (device.online) {
          Text(this.tr('连接'))
            .fontSize(14)
            .fontColor('#FFFFFF')
            .padding({ left: 14, right: 14, top: 9, bottom: 9 })
            .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
            .borderRadius(20)
            .shadow({ radius: 10, color: 'rgba(77,107,254,0.30)', offsetX: 0, offsetY: 3 })
            .onClick(() => {
              this.runtime.connectDevice(device.deviceId);
            })
        }
      }
    }
    .width('100%')
    .padding({ top: 16, bottom: 16, left: 16, right: 16 })
    .backgroundColor(this.pal().card)
    .borderRadius(18)
    .onClick(() => {
      // 对齐 dsh-go：整行可点即连接，不必瞄准右侧按钮。
      if (device.online && this.renamingDeviceId.length === 0) {
        this.runtime.connectDevice(device.deviceId);
      }
    })
    .border({ width: 1, color: this.pal().border })
    .onClick(() => {
      if (device.online && this.renamingDeviceId !== device.deviceId) {
        this.runtime.connectDevice(device.deviceId);
      }
    })
  }

  @Builder
  ConnectingScreen() {
    Column({ space: 16 }) {
      Blank()
      this.LogoChip()
      LoadingProgress()
        .width(40)
        .height(40)
        .color('#22D3EE')
      Text(this.tr('正在建立安全连接…'))
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.pal().text)
        .letterSpacing(1)
      Text(this.connectStage.length > 0 ? this.connectStage : this.tr('NOISE IK 握手 · 能力协商需要几秒'))
        .fontSize(12)
        .fontColor(this.connectStage.length > 0 ? this.pal().text2 : this.pal().text3)
        .letterSpacing(1)
      Button(this.tr('取消'))
        .height(36)
        .fontSize(14)
        .backgroundColor(this.pal().chip)
        .fontColor(this.pal().text2)
        .borderRadius(18)
        .border({ width: 1, color: this.pal().borderStrong })
        .padding({ left: 20, right: 20 })
        .onClick(() => {
          this.runtime.cancelConnect();
        })
      if (this.errorMsg.length > 0) {
        Text(this.errorMsg)
          .fontSize(13)
          .fontColor('#F85749')
          .textAlign(TextAlign.Center)
      }
      Blank()
    }
    .padding(24)
    .width('100%')
    .height('100%')
  }

  @Builder
  ChatScreen() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column({ space: this.foldState === 'half' ? 10 : 0 }) {
      Row() {
        Text('‹')
          .fontSize(26)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal().text)
          .width(38)
          .height(38)
          .textAlign(TextAlign.Center)
          .onClick(() => {
            // 只是回列表，连接保留：同一台主机再进来不重新认证
            this.runtime.keepAliveToDevices();
          })
        Column({ space: 2 }) {
          Text(this.connectedHostDisplay())
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .onHover((isHover: boolean) => {
              this.headerNamePopup = isHover && this.connectedHostDisplay().length > 12;
            })
            .gesture(LongPressGesture()
              .onAction(() => {
                this.headerNamePopup = true;
              }))
            .bindPopup(this.headerNamePopup, {
              message: this.connectedHostDisplay(),
              placement: Placement.Bottom,
              autoCancel: true,
              onStateChange: (state: PopupStateChangeParam) => {
                if (!state.isVisible) {
                  this.headerNamePopup = false;
                }
              }
            })
          Row({ space: 5 }) {
            Column()
              .width(5)
              .height(5)
              .borderRadius(2.5)
              .backgroundColor(this.generating ? '#22D3EE' : '#34D399')
            if (this.renamingSession) {
              TextInput({ text: this.sessionTitleInput, placeholder: this.tr('会话名称') })
                .height(30)
                .fontSize(12)
                .backgroundColor(this.pal().inputBg)
                .fontColor(this.pal().text)
                .borderRadius(8)
                .border({ width: 1, color: this.pal().borderStrong })
                .padding({ left: 8, right: 8 })
                .constraintSize({ maxWidth: 200 })
                .onChange((value: string) => {
                  this.sessionTitleInput = value;
                })
                .onSubmit(() => {
                  this.runtime.renameCurrentSession(this.sessionTitleInput);
                  this.renamingSession = false;
                })
              Text('✓')
                .fontSize(14)
                .fontColor('#34D399')
                .padding({ left: 4, right: 4 })
                .onClick(() => {
                  this.runtime.renameCurrentSession(this.sessionTitleInput);
                  this.renamingSession = false;
                })
            } else {
              Row({ space: 4 }) {
                Column()
                  .width(6)
                  .height(6)
                  .borderRadius(3)
                  .backgroundColor(this.connectionDotColor())
                // 会话名过长时用 TextOverflow.MARQUEE 自己滚，不再硬截成「…」
                Text(this.generating ? this.tr('正在生成…') : this.currentSessionTitle)
                  .fontSize(12)
                  .fontColor(this.generating ? '#22D3EE' : this.pal().text2)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.MARQUEE })
                  .constraintSize({ maxWidth: 190 })
                  .onClick(() => {
                    if (!this.generating && this.currentSessionId.length > 0) {
                      this.sessionTitleInput = this.currentSessionTitle;
                      this.renamingSession = true;
                    }
                  })
              }
              .alignItems(VerticalAlign.Center)
              if (this.connectedTransport.length > 0) {
                Text(this.transportBadgeText())
                  .fontSize(9)
                  .fontColor(this.transportBadgeColor())
                  .padding({ left: 5, right: 5, top: 1, bottom: 1 })
                  .backgroundColor(this.transportBadgeBg())
                  .borderRadius(5)
                  .margin({ left: 4 })
              }
              if (this.contextPercent > 0) {
                Text(this.contextPercent + '%')
                  .fontSize(10)
                  .fontColor(this.contextPercent >= 80 ? '#F85749' : this.pal().text3)
                  .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                  .backgroundColor(this.pal().inputBg)
                  .borderRadius(6)
              }
            }
          }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Center)
        // 三颗图标共用一套尺寸（22 的图形 + 40 的点击区），粗细与视觉重量才对得上
        this.TopIcon($r('app.media.ic_settings'), () => {
          if (!this.runtime.modelCatalogLoaded) {
            this.runtime.refreshModelCatalog();
          }
          this.runtime.refreshPermissionState();
          this.showSessionPanel = true;
        })
        this.TopIcon($r('app.media.ic_plus'), () => {
          this.showSessions = false;
          this.drawerOpen = 0;
          this.runtime.createNewSession();
        })
        if (!this.isLandscape) {
          this.TopIcon($r('app.media.ic_menu'), () => {
            this.openDrawer();
            this.runtime.loadWorkspaces();
          })
        }
      }
      .width('100%')
      .height(56)
      .padding({ left: 12, right: 12 })
      // 顶栏横条：毛玻璃压住滚过来的消息，内容不硬切
      .backgroundColor(this.isDarkUi ? 'rgba(18,22,34,0.72)' : 'rgba(247,249,255,0.76)')
      .backgroundBlurStyle(BlurStyle.COMPONENT_THIN, {
        colorMode: this.isDarkUi ? ThemeColorMode.DARK : ThemeColorMode.LIGHT,
        adaptiveColor: AdaptiveColor.DEFAULT,
        blurOptions: { grayscale: [0, 24] }
      })
      Column()
        .width('100%')
        .height(0.5)
        .backgroundColor(this.pal().border)
      if (this.errorMsg.length > 0) {
        Row({ space: 8 }) {
          Column()
            .width(3)
            .height(16)
            .borderRadius(1.5)
            .backgroundColor('#F85749')
          Text(this.errorMsg)
            .fontSize(this.fs(12))
            .fontColor('#F85749')
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text('✕')
            .fontSize(this.fs(12))
            .fontColor('#F85749')
            .padding({ left: 6, right: 2, top: 2, bottom: 2 })
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
        if (this.messages.length === 0) {
          ListItem() {
            Column({ space: 12 }) {
              if (this.sessionsLoadFailed) {
                Text(this.tr('会话列表加载失败'))
                  .fontSize(13)
                  .fontColor('#F85749')
                Button(this.tr('重试'))
                  .height(34)
                  .fontSize(13)
                  .padding({ left: 24, right: 24 })
                  .backgroundColor(Color.Transparent)
                  .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
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
                // 空会话别只留一句话：给几条能直接点的提示词，顺手把 slash 入口说清楚
                Column({ space: 8 }) {
                  Text('✨')
                    .fontSize(22)
                  Text(this.tr('发送第一条消息开始对话'))
                    .fontSize(this.fs(13))
                    .fontColor(this.pal().text2)
                  if (this.runtime.prompts.length > 0) {
                    ForEach(this.runtime.prompts.slice(0, 3), (item: string) => {
                      Text(item)
                        .fontSize(this.fs(11))
                        .fontColor(this.pal().text2)
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .padding({ left: 12, right: 12, top: 7, bottom: 7 })
                        .backgroundColor(this.pal().card)
                        .borderRadius(10)
                        .border({ width: 1, color: this.pal().border })
                        .constraintSize({ maxWidth: 260 })
                        .onClick(() => {
                          this.promptInput = item;
                          this.runtime.saveDraft(this.currentSessionId, item);
                        })
                    }, (item: string) => 'empty-prompt-' + item)
                  }
                  Text(this.tr('输入 / 查看主机命令，点 ✦ 打开提示词库'))
                    .fontSize(this.fs(10))
                    .fontColor(this.pal().text3)
                    .padding({ top: 2 })
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
        ForEach(this.chatRows(), (item: ChatItem) => {
          ListItem() {
            this.MessageRow(item)
          }
        }, (item: ChatItem) => `${item.id}#${item.rev}#${this.languageMode}`)
      }
      .layoutWeight(1)
      .width('100%')
      .constraintSize({ maxWidth: this.chatMaxWidth() })
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
      // 右往左横滑唤出会话抽屉：手势只挂在消息区，输入坞的触摸不再被抢
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
            if (!this.drawerDragFromChat || event.offsetX >= 0) {
              return;
            }
            const width: number = this.drawerWidthVp();
            const progress: number = Math.min(1, Math.max(0, this.drawerDragBase - event.offsetX / width));
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
          Text('↓ ' + this.tr('回到最新'))
            .fontSize(12)
            .fontColor(this.pal().text2)
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
      // 半折悬停（桌面立着那种）：输入坞限制在下半屏，上半留给消息，中间那道间隔就是铰链
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
    .width('100%')
    .height('100%')
  }

  /** 底部输入坞：不再是整条玻璃，图片键、输入框、发送键各自一块玻璃，中间留缝。 */
  @Builder
  ComposerDock() {
    Column() {
      Column({ space: 8 }) {
        // 键盘弹起时收起语境胶囊：它正好压在输入法候选条上方，会挡住半个候选框
        if (!this.keyboardVisible && this.contextPills().length > 0) {
          Row({ space: 8 }) {
            ForEach(this.contextPills(), (pill: string) => {
              // 语境提示做成纯文字：带底色的胶囊连排会看成一条横带，压在输入框上方很割裂
              Text(pill)
                .fontSize(this.fs(10))
                .fontColor(this.pal().text3)
                .maxLines(1)
                .opacity(0.9)
            }, (pill: string) => pill)
          }
          .width('100%')
          .padding({ left: 20, right: 20, top: 2, bottom: 4 })
          .justifyContent(FlexAlign.Start)
        }
      Column() {
        if (this.promptInput.startsWith('/') && this.slashCommands.length > 0) {
          Scroll() {
            Row({ space: 8 }) {
              ForEach(this.slashCommands, (command: SlashCommand) => {
                Row({ space: 6 }) {
                  Text(command.name)
                    .fontSize(this.fs(12))
                    .fontColor('#22D3EE')
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
                  Text('✕')
                    .fontSize(this.fs(11))
                    .fontColor('#FFFFFF')
                    .width(18)
                    .height(18)
                    .textAlign(TextAlign.Center)
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
        // 每颗控件各自一块玻璃，中间留缝断开，不再连成一整条
        Row({ space: 12 }) {
          // 图片：选相册里的图，压完挂在输入框上方，随下一次发送一起交给主机
          Row() {
            if (this.pickingImages) {
              LoadingProgress()
                .width(18)
                .height(18)
                .color('#22D3EE')
            } else {
              Image($r('app.media.ic_image'))
                .width(20)
                .height(20)
                .fillColor(this.pal().text2)
            }
          }
          .width(46)
          .height(46)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .borderRadius(23)
          // 对齐资讯类 App 的底栏光感：厚材质 + 低白度过衬，让下层内容模糊透上来
          .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, {
            colorMode: this.isDarkUi ? ThemeColorMode.DARK : ThemeColorMode.LIGHT,
            adaptiveColor: AdaptiveColor.DEFAULT,
            blurOptions: { grayscale: [0, 12] }
          })
          .border({ width: 1,
            color: this.isDarkUi ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)' })
          .backgroundColor(this.isDarkUi ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.40)')
          .shadow({ radius: 12,
            color: this.isDarkUi ? 'rgba(0,0,0,0.45)' : 'rgba(31,45,90,0.16)',
            offsetX: 0, offsetY: 5 })
          .clip(true)
          .overlay(this.DockSpot(52), { align: Alignment.Center })
          .onTouch((event: TouchEvent) => {
            this.trackDockLight(event);
          })
          .onClick(() => {
            this.attachImage();
          })
          // 提示词库入口：和图片键同规格的小圆玻璃
          Row() {
            Text('✦')
              .fontSize(this.fs(15))
              .fontColor(this.pal().text2)
          }
          .width(34)
          .height(46)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .borderRadius(23)
          .backgroundColor(this.isDarkUi ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.40)')
          .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, {
            colorMode: this.isDarkUi ? ThemeColorMode.DARK : ThemeColorMode.LIGHT,
            adaptiveColor: AdaptiveColor.DEFAULT,
            blurOptions: { grayscale: [0, 12] }
          })
          .border({ width: 1,
            color: this.isDarkUi ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)' })
          .onClick(() => {
            this.promptDraftInput = '';
            this.promptPanelOpen = true;
          })
          // 输入框自己就是一块玻璃；换行靠回车，高度随内容长到 5 行再内部滚动
          TextArea({ text: this.promptInput,
            placeholder: this.generating ? this.tr('正在生成，可插话…')
              : (this.runtime.steerMode ? this.tr('插话发送（长按发送键切换）') : this.tr('发送消息…')) })
            .layoutWeight(1)
            .constraintSize({ minHeight: 46, maxHeight: 132 })
            .backgroundColor(this.isDarkUi ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.40)')
            .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, {
              colorMode: this.isDarkUi ? ThemeColorMode.DARK : ThemeColorMode.LIGHT,
              adaptiveColor: AdaptiveColor.DEFAULT,
              blurOptions: { grayscale: [0, 12] }
            })
            .fontColor(this.pal().text)
            .fontSize(this.fs(15))
            .lineHeight(this.fs(22))
            .placeholderColor(this.pal().text3)
            .caretColor('#22D3EE')
            .borderRadius(23)
            .border({ width: 1,
              color: this.isDarkUi ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)' })
            .padding({ left: 18, right: 18, top: 12, bottom: 12 })
            .clip(true)
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
            // 跟手光斑：坐标就是这块自己的局部坐标
            .overlay(this.DockSpot(96), { align: Alignment.Center })
            .onTouch((event: TouchEvent) => {
              this.trackDockLight(event);
            })
            .onMouse((event: MouseEvent) => {
              this.trackDockMouse(event);
            })
          if (this.generating) {
            Text('■')
              .fontSize(this.fs(16))
              .fontColor('#F85749')
              .width(46)
              .height(46)
              .textAlign(TextAlign.Center)
              .backgroundColor('rgba(248,87,73,0.12)')
              .borderRadius(23)
              .border({ width: 1, color: 'rgba(248,87,73,0.35)' })
              .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, {
                colorMode: this.isDarkUi ? ThemeColorMode.DARK : ThemeColorMode.LIGHT,
                adaptiveColor: AdaptiveColor.DEFAULT,
                blurOptions: { grayscale: [0, 12] }
              })
              .shadow({ radius: 12,
                color: this.isDarkUi ? 'rgba(0,0,0,0.45)' : 'rgba(31,45,90,0.16)',
                offsetX: 0, offsetY: 5 })
              .clip(true)
              .overlay(this.DockSpot(52), { align: Alignment.Center })
              .onTouch((event: TouchEvent) => {
                this.trackDockLight(event);
              })
              .onClick(() => {
                this.runtime.stopGeneration();
              })
          }
          Text('↑')
            .fontSize(this.fs(20))
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .width(46)
            .height(46)
            .textAlign(TextAlign.Center)
            .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
            .borderRadius(23)
            .shadow({ radius: 12, color: 'rgba(77,107,254,0.45)', offsetX: 0, offsetY: 5 })
            .clip(true)
            .overlay(this.DockSpot(52), { align: Alignment.Center })
            .onTouch((event: TouchEvent) => {
              this.trackDockLight(event);
            })
            .onClick(() => {
              this.sendTap();
            })
            .gesture(LongPressGesture().onAction(() => {
              ActionSheet.show({
                title: this.tr('发送方式'),
                message: this.runtime.steerMode ? this.tr('当前：插话（立刻打断当前轮）') : this.tr('当前：排队（本轮结束后再发）'),
                sheets: [
                  {
                    title: this.tr('排队发送'),
                    action: () => {
                      this.runtime.setSteerMode(false);
                    }
                  },
                  {
                    title: this.tr('插话打断'),
                    action: () => {
                      this.runtime.setSteerMode(true);
                    }
                  }
                ]
              });
            }))
        }
        .width('100%')
      }
      // 这一层不再画玻璃：底板交给按钮行的每一块自己画，中间才断得开
      .width('100%')
      }
      .width('100%')
      .constraintSize({ maxWidth: this.chatMaxWidth() })
      .padding({ left: 12, right: 12, top: 8, bottom: 0 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }

  /** Shared sessions list (header + rows); wrapped by the overlay or the landscape pane. */
  @Builder
  SessionsPanelBody() {
    Column() {
      Row() {
        Text('会话')
          .fontSize(this.fs(18))
          .fontWeight(FontWeight.Bold)
          .fontColor(this.pal().text)
        if (this.runtime.favoriteSessions.length > 0) {
          Text('★ ' + this.runtime.favoriteSessions.length)
            .fontSize(this.fs(11))
            .fontColor('#F5A623')
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .backgroundColor(this.favoriteOnly ? 'rgba(245,166,35,0.28)' : 'rgba(245,166,35,0.12)')
            .borderRadius(7)
            .margin({ left: 6 })
            .onClick(() => {
              this.favoriteOnly = !this.favoriteOnly;
            })
        }
        Text(`${this.sessions.length}`)
          .fontSize(this.fs(12))
          .fontColor(this.pal().text3)
          .margin({ left: 6 })
        Blank()
        Text('＋ 新建')
          .fontSize(this.fs(13))
          .fontColor('#22D3EE')
          .padding({ left: 12, right: 12, top: 7, bottom: 7 })
          .backgroundColor('rgba(34,211,238,0.10)')
          .borderRadius(15)
          .border({ width: 1, color: 'rgba(34,211,238,0.30)' })
          .onClick(() => {
            this.closeDrawer();
            this.runtime.createNewSession();
          })
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 16, bottom: 12 })
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
          Text('清除')
            .fontSize(this.fs(12))
            .fontColor(this.pal().text3)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(this.pal().inputBg)
            .borderRadius(9)
            .border({ width: 1, color: this.pal().border })
            .onClick(() => {
              this.sessionSearchInput = '';
              this.sessionSearchActive = false;
              this.sessionSearchResults = [];
              this.runtime.searchSessions('');
            })
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 4, bottom: 8 })
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
          Text('✓')
            .fontSize(this.fs(14))
            .fontColor('#34D399')
            .padding({ left: 8, right: 8 })
            .onClick(() => {
              this.runtime.renameWorkspace(this.editingWorkspaceId, this.workspaceTitleInput);
              this.editingWorkspaceId = '';
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 2, bottom: 6 })
      }
      if (this.workspaces.length > 0) {
        Scroll() {
          Row({ space: 8 }) {
            Text('跟随当前会话')
              .fontSize(this.fs(11))
              .fontColor(this.selectedWorkspaceId.length === 0 ? '#22D3EE' : this.pal().text3)
              .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .backgroundColor(this.selectedWorkspaceId.length === 0
                ? 'rgba(34,211,238,0.12)' : this.pal().inputBg)
              .borderRadius(9)
              .border({ width: 1, color: this.selectedWorkspaceId.length === 0
                ? 'rgba(34,211,238,0.45)' : this.pal().border })
              .onClick(() => {
                this.runtime.setSelectedWorkspace('');
              })
            Text('＋ ' + this.tr('新建'))
              .fontSize(this.fs(11))
              .fontColor('#22D3EE')
              .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .backgroundColor('rgba(34,211,238,0.10)')
              .borderRadius(9)
              .border({ width: 1, color: 'rgba(34,211,238,0.40)' })
              .onClick(() => {
                this.workspacePathInput = this.runtime.browsePath.length > 0
                  ? this.runtime.browsePath : '';
                this.workspaceNameDraft = '';
                this.workspaceCreateOpen = true;
              })
            ForEach(this.workspaces, (workspace: HarnessWorkspace) => {
              Text(workspace.title.length > 0 ? workspace.title : workspace.path)
                .fontSize(this.fs(11))
                .maxLines(1)
                .constraintSize({ maxWidth: 140 })
                .fontColor(this.selectedWorkspaceId === workspace.workspaceId
                  ? '#22D3EE' : this.pal().text3)
                .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                .backgroundColor(this.selectedWorkspaceId === workspace.workspaceId
                  ? 'rgba(34,211,238,0.12)' : this.pal().inputBg)
                .borderRadius(9)
                .border({ width: 1, color: this.selectedWorkspaceId === workspace.workspaceId
                  ? 'rgba(34,211,238,0.45)' : this.pal().border })
                .onClick(() => {
                  this.runtime.setSelectedWorkspace(workspace.workspaceId);
                })
                .gesture(LongPressGesture().onAction(() => {
                  ActionSheet.show({
                    title: workspace.title.length > 0 ? workspace.title : workspace.path,
                    message: workspace.path,
                    sheets: [
                      {
                        title: this.tr('浏览文件'),
                        action: () => {
                          this.showBrowser = true;
                          this.runtime.openWorkspace(workspace.workspaceId);
                        }
                      },
                      {
                        title: this.tr('重命名'),
                        action: () => {
                          this.editingWorkspaceId = workspace.workspaceId;
                          this.workspaceTitleInput = workspace.title;
                        }
                      },
                      {
                        title: this.tr('删除工作区'),
                        action: () => {
                          this.runtime.deleteWorkspace(workspace.workspaceId);
                        }
                      }
                    ]
                  });
                }))
            }, (workspace: HarnessWorkspace) => `${workspace.workspaceId}#${this.languageMode}`)
          }
          .padding({ left: 16, right: 16 })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
        .padding({ top: 2, bottom: 6 })
      }
      Column()
        .width('100%')
        .height(0.5)
        .backgroundColor(this.pal().border)
      if (!this.sessionSearchActive && this.runtime.recentSessions.length > 0) {
        Scroll() {
          Row({ space: 8 }) {
            Text(this.tr('最近'))
              .fontSize(this.fs(10))
              .fontColor(this.pal().text3)
            ForEach(this.runtime.recentSessions, (id: string) => {
              Text(this.recentSessionTitle(id))
                .fontSize(this.fs(11))
                .fontColor(this.pal().text2)
                .maxLines(1)
                .constraintSize({ maxWidth: 120 })
                .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                .backgroundColor(this.pal().inputBg)
                .borderRadius(9)
                .border({ width: 1, color: this.pal().border })
                .onClick(() => {
                  this.closeDrawer();
                  this.runtime.openSession(id);
                })
            }, (id: string) => 'recent-' + id)
          }
          .padding({ left: 16, right: 16, bottom: 6 })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
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
        ForEach(this.visibleSessions(),
          (session: HarnessRemoteSession, index: number) => {
          ListItem() {
            Column() {
            if (this.sessionGroupGap(index).length > 0) {
              Text(this.tr(this.sessionGroupGap(index)))
                .fontSize(this.fs(11))
                .fontColor(this.pal().text3)
                .width('100%')
                .padding({ left: 4, top: index === 0 ? 0 : 10, bottom: 4 })
            }
            Row({ space: 10 }) {
              Column()
                .width(3)
                .height(34)
                .borderRadius(1.5)
                .backgroundColor(session.sessionId === this.currentSessionId ? '#4D6BFE' : this.pal().chip)
              Column({ space: 3 }) {
                Text(formatSessionTitle(session))
                  .fontSize(this.fs(14))
                  .fontWeight(session.sessionId === this.currentSessionId ? FontWeight.Medium : FontWeight.Normal)
                  .fontColor(session.sessionId === this.currentSessionId ? this.pal().text : this.pal().text2)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Row({ space: 6 }) {
                  Text(formatSessionTime(session.updatedAt))
                    .fontSize(this.fs(11))
                    .fontColor(this.pal().text2)
                  if (session.running) {
                    Row({ space: 3 }) {
                      Column()
                        .width(4)
                        .height(4)
                        .borderRadius(2)
                        .backgroundColor('#34D399')
                      Text('运行中')
                        .fontSize(this.fs(10))
                        .fontColor('#34D399')
                    }
                  }
                }
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              Text(this.runtime.isFavoriteSession(session.sessionId) ? '★' : '☆')
                .fontSize(this.fs(14))
                .fontColor(this.runtime.isFavoriteSession(session.sessionId) ? '#F5A623' : this.pal().text3)
                .padding({ left: 6, right: 2, top: 6, bottom: 6 })
                .onClick(() => {
                  this.runtime.toggleFavoriteSession(session.sessionId);
                })
            }
            .width('100%')
            .padding({ top: 10, bottom: 10, left: 12, right: 12 })
            .backgroundColor(session.sessionId === this.currentSessionId
              ? 'rgba(77,107,254,0.14)' : this.pal().card)
            .borderRadius(14)
            .border({ width: 1,
              color: session.sessionId === this.currentSessionId
                ? 'rgba(77,107,254,0.40)' : this.pal().border })
            .onClick(() => {
              this.closeDrawer();
              this.runtime.openSession(session.sessionId);
            })
            .gesture(LongPressGesture().onAction(() => {
              this.runtime.archiveSession(session.sessionId);
            }))
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }
        }, (session: HarnessRemoteSession) => `${session.sessionId}#${this.languageMode}`)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 12, right: 12, top: 10 })
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
  }

  /** 文件浏览：只读列目录，点目录进入、点 .. 返回上级。 */
  @Builder
  FileBrowserOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.showBrowser = false;
        })
      Column() {
        Row({ space: 10 }) {
          Text('↑ 上级')
            .fontSize(this.fs(12))
            .fontColor(this.pal().text2)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(this.pal().chip)
            .borderRadius(9)
            .onClick(() => {
              this.runtime.browseUp();
            })
          Text(this.browsePath)
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text('关闭')
            .fontSize(this.fs(12))
            .fontColor(this.pal().text3)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .onClick(() => {
              this.showBrowser = false;
            })
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 14, bottom: 8 })
        List({ space: 4 }) {
          ForEach(this.directoryEntries, (entry: DirectoryEntry) => {
            ListItem() {
              Row({ space: 10 }) {
                Text(entry.isDirectory ? '📁' : '📄')
                  .fontSize(this.fs(14))
                Text(entry.name)
                  .fontSize(this.fs(13))
                  .fontColor(this.pal().text)
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (!entry.isDirectory && entry.size > 0) {
                  Text(Math.round(entry.size / 1024) + ' KB')
                    .fontSize(this.fs(10))
                    .fontColor(this.pal().text3)
                }
              }
              .width('100%')
              .padding({ left: 14, right: 14, top: 10, bottom: 10 })
              .onClick(() => {
                const full: string = entry.path.length > 0 ? entry.path : (this.browsePath + '/' + entry.name);
                if (entry.isDirectory) {
                  this.runtime.browseDirectory(full);
                  return;
                }
                this.filePreviewOpen = true;
                this.openFilePreview(full);
              })
            }
          }, (entry: DirectoryEntry) => entry.path.length > 0 ? entry.path : entry.name)
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .constraintSize({ maxHeight: '70%' })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
    }
    .width('100%')
    .height('100%')
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
      Column({ space: 0 }) {
        Row() {
          Column({ space: 2 }) {
            Text(this.tr('会话设置'))
              .fontSize(this.fs(16))
              .fontWeight(FontWeight.Bold)
              .fontColor(this.pal().text)
            Text(this.currentSessionTitle.length > 0 ? this.currentSessionTitle : this.tr('新会话'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text('✕')
            .fontSize(this.fs(15))
            .fontColor(this.pal().text3)
            .width(32)
            .height(32)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.showSessionPanel = false;
            })
        }
        .width('100%')
        .padding({ left: 18, right: 12, top: 16, bottom: 8 })

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
            .fontColor('#22D3EE')
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor('rgba(34,211,238,0.10)')
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
                    .fontColor(effort === this.currentModelEffort ? '#0B1220' : this.pal().text2)
                    .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                    .backgroundColor(effort === this.currentModelEffort ? '#22D3EE' : this.pal().inputBg)
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

        // —— 权限 ——
        Column({ space: 6 }) {
          Text(this.tr('权限'))
            .fontSize(this.fs(11))
            .fontColor(this.pal().text3)
            .width('100%')
          Row({ space: 8 }) {
            ForEach(this.permissionChoices(), (preset: string) => {
              Text(this.permissionChoiceLabel(preset))
                .fontSize(this.fs(11))
                .fontColor(preset === this.permissionPreset ? '#0B1220' : this.pal().text2)
                .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .backgroundColor(preset === this.permissionPreset ? '#34D399' : this.pal().inputBg)
                .borderRadius(10)
                .border({ width: 1, color: this.pal().border })
                .onClick(() => {
                  this.runtime.selectPermission(preset);
                })
            }, (preset: string) => preset)
          }
          .width('100%')
        }
        .width('100%')
        .padding({ left: 18, right: 18, top: 4, bottom: 12 })

        // —— 上下文 ——
        Row({ space: 10 }) {
          Column({ space: 3 }) {
            Text(this.tr('上下文'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
            Text(this.contextPercent > 0 ? `${this.contextPercent}%` : '—')
              .fontSize(this.fs(14))
              .fontColor(this.contextPercent >= 80 ? '#F85749' : this.pal().text)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text(this.tr('压缩上下文'))
            .fontSize(this.fs(12))
            .fontColor('#22D3EE')
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor('rgba(34,211,238,0.10)')
            .borderRadius(10)
            .onClick(() => {
              this.showSessionPanel = false;
              this.runtime.sendPrompt('/compact');
            })
        }
        .width('100%')
        .padding({ left: 18, right: 18, top: 4, bottom: 12 })

        // —— 连接 ——
        Row({ space: 10 }) {
          Column({ space: 3 }) {
            Text(this.tr('连接'))
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
          Text(this.tr('断开连接'))
            .fontSize(this.fs(12))
            .fontColor('#F85749')
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
      .constraintSize({ maxWidth: 520 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20, bottomLeft: 0, bottomRight: 0 })
      .border({ width: 1, color: this.pal().border })
    }
    .width('100%')
    .height('100%')
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

  /** 面板里的连接行：主机 + 数据面。 */
  private connectionSummary(): string {
    const host: string = this.connectedHostDisplay();
    const mode: string = this.transportBadgeText();
    if (host.length === 0) {
      return this.tr('未连接');
    }
    return mode.length > 0 ? host + ' · ' + mode : host;
  }

  /** 模型选择器：底部面板形式，点选后立即切换当前会话的模型。 */
  @Builder
  ModelPickerOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.showModelPicker = false;
        })
      Column() {
        Row() {
          Text('选择模型')
            .fontSize(this.fs(16))
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Blank()
          Text('关闭')
            .fontSize(this.fs(13))
            .fontColor(this.pal().text3)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .onClick(() => {
              this.showModelPicker = false;
            })
        }
        .width('100%')
        .padding({ left: 18, right: 18, top: 16, bottom: 10 })
        if (this.pendingModel !== undefined) {
          Column({ space: 6 }) {
            Text('选择 ' + this.pendingModel!.name + ' 的推理等级')
              .fontSize(this.fs(12))
              .fontColor(this.pal().text2)
              .width('100%')
              .padding({ left: 18, right: 18 })
            Scroll() {
              Row({ space: 8 }) {
                Text('默认')
                  .fontSize(this.fs(11))
                  .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                  .backgroundColor(this.pal().inputBg)
                  .borderRadius(9)
                  .border({ width: 1, color: this.pal().border })
                  .onClick(() => {
                    this.runtime.selectModel(this.pendingModel!.provider,
                      this.pendingModel!.model, '');
                    this.pendingModel = undefined;
                    this.showModelPicker = false;
                  })
                ForEach(this.pendingModel!.efforts, (effort: string) => {
                  Text(effort)
                    .fontSize(this.fs(11))
                    .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                    .backgroundColor('rgba(34,211,238,0.10)')
                    .borderRadius(9)
                    .border({ width: 1, color: 'rgba(34,211,238,0.35)' })
                    .onClick(() => {
                      this.runtime.selectModel(this.pendingModel!.provider,
                        this.pendingModel!.model, effort);
                      this.pendingModel = undefined;
                      this.showModelPicker = false;
                    })
                }, (effort: string) => effort)
              }
              .padding({ left: 18, right: 18 })
            }
            .scrollable(ScrollDirection.Horizontal)
            .scrollBar(BarState.Off)
            .width('100%')
          }
          .width('100%')
          .padding({ top: 4, bottom: 8 })
        }
        if (this.modelOptions.length === 0) {
          Text('模型目录为空：请确认主机已配置模型服务商')
            .fontSize(this.fs(13))
            .fontColor(this.pal().text3)
            .padding({ left: 18, right: 18, top: 8, bottom: 24 })
        } else {
          List({ space: 6 }) {
            ForEach(this.modelOptions, (option: ModelOption) => {
              ListItem() {
                Row({ space: 10 }) {
                  Column({ space: 2 }) {
                    Text(option.name.length > 0 ? option.name : option.model)
                      .fontSize(this.fs(14))
                      .fontColor(this.pal().text)
                    Text(option.provider + ' · ' + option.model)
                      .fontSize(this.fs(11))
                      .fontColor(this.pal().text3)
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  if (option.model === this.currentModelLabel) {
                    Text('当前')
                      .fontSize(this.fs(11))
                      .fontColor('#22D3EE')
                      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                      .backgroundColor('rgba(34,211,238,0.12)')
                      .borderRadius(8)
                  }
                }
                .width('100%')
                .padding({ left: 14, right: 14, top: 11, bottom: 11 })
                .backgroundColor(this.pal().card)
                .borderRadius(12)
                .border({ width: 1, color: this.pal().border })
                .onClick(() => {
                  if (option.efforts.length > 0) {
                    this.pendingModel = option;
                    return;
                  }
                  this.runtime.selectModel(option.provider, option.model, '');
                  this.showModelPicker = false;
                })
              }
            }, (option: ModelOption) => option.provider + '/' + option.model)
          }
          .layoutWeight(1)
          .width('100%')
          .padding({ left: 14, right: 14, bottom: 16 })
          .scrollBar(BarState.Off)
        }
      }
      .width('100%')
      .constraintSize({ maxHeight: '62%' })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
    }
    .width('100%')
    .height('100%')
  }

  /** Portrait: sessions slide in from the right over a scrim. */
  @Builder
  SessionsOverlay() {
    Stack({ alignContent: Alignment.End }) {
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
      .backgroundColor(this.pal().panel)
      .border({ width: { left: 0.5 }, color: this.pal().borderStrong })
      // 位移完全由手势进度决定：拉多少露多少，松手才补齐或弹回
      .translate({ x: (1 - this.drawerOpen) * this.drawerWidthVp() })
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
            this.drawerOpen = Math.min(1, Math.max(0, this.drawerDragBase - event.offsetX / width));
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
    .height('100%')
    .backgroundColor(this.pal().panel)
    .border({ width: { right: 0.5 }, color: this.pal().borderStrong })
  }

  @Builder
  MessageRow(item: ChatItem) {
    if (item.kind === 'user') {
      Row() {
        // A definite-width inner row gives the bubble a hard wrap budget, so long
        // text lines break inside the gradient instead of overflowing it.
        Row() {
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
              Text(item.text)
                .fontSize(this.fs(15))
                .fontColor('#FFFFFF')
                .textAlign(TextAlign.Start)
            }
          }
          .padding({ top: 10, bottom: 10, left: 14, right: 14 })
          .linearGradient({ angle: 135, colors: [['#3D5CF6', 0], ['#2E7CF0', 0.6], ['#22D3EE', 1]] })
          .borderRadius({ topLeft: 18, topRight: 18, bottomLeft: 18, bottomRight: 6 })
          .alignItems(HorizontalAlign.Start)
          .shadow({ radius: 12, color: 'rgba(61,92,246,0.30)', offsetX: 0, offsetY: 3 })
        }
        .width('80%')
        .justifyContent(FlexAlign.End)
        .gesture(LongPressGesture().onAction(() => {
          this.offerMessageActions(item);
        }))
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
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
              .fontColor(item.noticeKind === 'error' ? '#F85749' : '#F0A020')
            Text(this.tr(item.text))
              .fontSize(this.fs(13))
              .fontWeight(FontWeight.Medium)
              .fontColor(item.noticeKind === 'error' ? '#F85749' : '#C88418')
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
        if (line.imageSrc.length > 0) {
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
            .fontColor('#22D3EE')
            .decoration({ type: TextDecorationType.Underline, color: '#22D3EE' })
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
        }
      }, (line: MdLine, index: number) => index.toString())
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** 手指按下/滑动：光斑跟到触点，并按 180ms 淡入。 */
  private trackDockLight(event: TouchEvent): void {
    const touches: TouchObject[] = event.touches;
    if (event.type === TouchType.Down || event.type === TouchType.Move) {
      if (touches.length === 0) {
        return;
      }
      this.dockLightX = touches[0].x;
      this.dockLightY = touches[0].y;
      this.fadeDockLight(true);
      return;
    }
    // 抬手或被父级手势打断时先留一帧，别一按就灭
    if (this.dockLightHideTimer >= 0) {
      clearTimeout(this.dockLightHideTimer);
    }
    this.dockLightHideTimer = setTimeout(() => {
      this.dockLightHideTimer = -1;
      this.fadeDockLight(false);
    }, 260);
  }

  /** 鼠标悬停也用同一套光斑，桌面/2in1 上鼠标划过就能看到。 */
  private trackDockMouse(event: MouseEvent): void {
    if (event.action === MouseAction.Move || event.action === MouseAction.Press) {
      this.dockLightX = event.x;
      this.dockLightY = event.y;
      this.fadeDockLight(true);
      return;
    }
    if (event.action === MouseAction.Release) {
      this.fadeDockLight(false);
    }
  }

  private fadeDockLight(visible: boolean): void {
    if (visible && this.dockLightHideTimer >= 0) {
      clearTimeout(this.dockLightHideTimer);
      this.dockLightHideTimer = -1;
    }
    const target: number = visible ? 1 : 0;
    if (this.dockLightOpacity === target) {
      return;
    }
    this.getUIContext().animateTo({
      duration: visible ? 160 : 260,
      curve: Curve.EaseOut
    }, () => {
      this.dockLightOpacity = target;
    });
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
            .color('#22D3EE')
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
          Text('🖼')
            .fontSize(13)
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
            .fontColor('#22D3EE')
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
            .color('#22D3EE')
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

  /** 长按消息：复制正文 / 从这里分叉（分叉不再占用长按默认动作）。 */
  private offerMessageActions(item: ChatItem): void {
    this.messageActionText = item.text.length > 0 ? item.text : item.summary;
    this.messageActionKind = item.kind;
    this.messageActionSeq = item.seq;
    this.messageActionsOpen = true;
  }

  /** 点开一个文件：PDF 交给系统 PDF Kit，其它按文本预览。 */
  private openFilePreview(path: string): void {
    const lower: string = path.toLowerCase();
    const isPdf: boolean = lower.endsWith('.pdf');
    this.previewIsPdf = isPdf;
    this.pdfError = '';
    if (!isPdf) {
      this.runtime.previewFile(path);
      return;
    }
    this.runtime.filePreviewPath = path;
    this.runtime.filePreviewLoading = true;
    this.runtime.filePreviewError = '';
    this.runtime.notify();
    this.runtime.readFileBuffer(path).then((buffer: ArrayBuffer) => {
      this.pdfController.loadDocumentFromMemory(buffer).then(() => {
        this.runtime.filePreviewLoading = false;
        this.runtime.notify();
      }).catch((error: Error) => {
        this.pdfError = error.message;
        this.runtime.filePreviewLoading = false;
        this.runtime.notify();
      });
    }).catch((error: Error) => {
      this.pdfError = error.message;
      this.runtime.filePreviewLoading = false;
      this.runtime.notify();
    });
  }

  private copyActionText(): void {
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.messageActionText);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      promptAction.showToast({ message: this.tr('已复制') });
    }).catch(() => {
      promptAction.showToast({ message: this.tr('复制失败') });
    });
  }

  @Builder
  AssistantRow(item: ChatItem) {
    Row() {
      // A definite-width inner row gives the bubble a hard wrap budget; the inner
      // Texts carry no percentage width so they can never stretch past the card.
      Row() {
        Column({ space: 6 }) {
          if (item.reasoning.length > 0) {
            Text(item.reasoning)
              .fontSize(this.fs(12))
              .fontColor(this.pal().text2)
              .maxLines(8)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .textAlign(TextAlign.Start)
          }
          if (item.text.length > 0) {
            this.MarkdownText(item.text, item.streaming)
          }
          if (item.streaming && item.text.length === 0 && item.reasoning.length === 0) {
            Row({ space: 8 }) {
              LoadingProgress()
                .width(14)
                .height(14)
                .color('#22D3EE')
              Text('正在思考…')
                .fontSize(this.fs(12))
                .fontColor(this.pal().text2)
            }
          }
        }
        .padding({ top: 10, bottom: 10, left: 14, right: 14 })
        .backgroundColor(this.pal().inputBg)
        .borderRadius(16)
        .alignItems(HorizontalAlign.Start)
        .gesture(LongPressGesture().onAction(() => {
          this.offerMessageActions(item);
        }))
      }
      .width('88%')
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
        .fontColor(danger ? '#F85749' : '#22D3EE')
      Text(label)
        .fontSize(this.fs(14))
        .fontColor(danger ? '#F85749' : this.pal().text)
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
        Row() {
          Column({ space: 1 }) {
            Text(this.tr('消息操作'))
              .fontSize(15)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.pal().text)
            Text(this.messageActionKind === 'user' ? this.tr('你发送的消息') : this.tr('助手回复'))
              .fontSize(this.fs(11))
              .fontColor(this.pal().text3)
          }
          .alignItems(HorizontalAlign.Start)
          Blank()
          Text('✕')
            .fontSize(15)
            .fontColor(this.pal().text3)
            .width(30)
            .height(30)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.messageActionsOpen = false;
            })
        }
        .width('100%')

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
            .border({ width: { left: 3 }, color: 'rgba(34,211,238,0.55)' })
        }

        this.MessageActionRow('⧉', this.tr('复制文本'), false, () => {
          this.copyActionText();
          this.messageActionsOpen = false;
        })
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
  FilePreviewOverlay() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.filePreviewOpen = false;
        })
      Column({ space: 8 }) {
        Row({ space: 10 }) {
          Column({ space: 2 }) {
            Text(this.runtime.filePreviewPath.substring(this.runtime.filePreviewPath.lastIndexOf('/') + 1))
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal().text)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.runtime.filePreviewPath)
              .fontSize(this.fs(10))
              .fontColor(this.pal().text3)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Text('关闭')
            .fontSize(this.fs(12))
            .fontColor(this.pal().text3)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(this.pal().chip)
            .borderRadius(9)
            .onClick(() => {
              this.filePreviewOpen = false;
            })
        }
        .width('100%')

        if (this.runtime.filePreviewLoading) {
          Row({ space: 8 }) {
            LoadingProgress()
              .width(16)
              .height(16)
              .color('#22D3EE')
            Text(this.tr('读取中…'))
              .fontSize(this.fs(12))
              .fontColor(this.pal().text2)
          }
          .padding({ top: 12, bottom: 12 })
        } else if (this.previewIsPdf && this.pdfError.length === 0) {
          PdfView({
            controller: this.pdfController,
            pageLayout: pdfService.PageLayout.LAYOUT_SINGLE,
            isContinuous: true,
            showScroll: true,
            pageFit: pdfService.PageFit.FIT_WIDTH
          })
            .width('100%')
            .height(this.windowHeightVp > 0 ? this.windowHeightVp * 0.62 : 420)
            .borderRadius(12)
        } else if (this.previewIsPdf && this.pdfError.length > 0) {
          Text(this.tr('PDF 打开失败：') + this.pdfError)
            .fontSize(this.fs(12))
            .fontColor('#F85749')
            .padding({ top: 12, bottom: 12 })
        } else if (this.runtime.filePreviewError.length > 0) {
          Text(this.runtime.filePreviewError)
            .fontSize(this.fs(12))
            .fontColor('#F85749')
            .padding({ top: 12, bottom: 12 })
        } else {
          Scroll() {
            Text(this.runtime.filePreviewText)
              .fontSize(this.fs(11))
              .fontColor(this.pal().text)
              .fontFamily('monospace')
              .width('100%')
              .textAlign(TextAlign.Start)
              .copyOption(CopyOptions.LocalDevice)
          }
          .width('100%')
          .scrollable(ScrollDirection.Vertical)
          .scrollBar(BarState.Auto)
          .constraintSize({ maxHeight: this.windowHeightVp > 0 ? this.windowHeightVp * 0.62 : 420 })
        }
      }
      .width('100%')
      .constraintSize({ maxWidth: 620 })
      .padding({ left: 16, right: 16, top: 14, bottom: 20 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
    }
    .width('100%')
    .height('100%')
  }

  /** 新建工作区：主机侧只认绝对路径，名称留空就用路径末段。 */
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
        Row() {
          Text(this.tr('新建工作区'))
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Blank()
          Text('✕')
            .fontSize(15)
            .fontColor(this.pal().text3)
            .width(30)
            .height(30)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.workspaceCreateOpen = false;
            })
        }
        .width('100%')

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
              .fontColor('#22D3EE')
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
          .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
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
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal().backdrop)
        .onClick(() => {
          this.trajectoryOpen = false;
        })
      Column({ space: 8 }) {
        Row() {
          Text(this.tr('执行轨迹'))
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Text(' ' + this.trajectoryItems().length + '')
            .fontSize(this.fs(12))
            .fontColor(this.pal().text3)
          Blank()
          Text('✕')
            .fontSize(15)
            .fontColor(this.pal().text3)
            .width(30)
            .height(30)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.trajectoryOpen = false;
            })
        }
        .width('100%')
        .padding({ bottom: 4 })

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
                      .fontColor(item.toolState === 'failed' ? '#F85749'
                        : (item.toolState === 'running' ? '#22D3EE' : this.pal().text3))
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
        .constraintSize({ maxHeight: this.windowHeightVp > 0 ? this.windowHeightVp * 0.62 : 420 })
        .scrollable(ScrollDirection.Vertical)
        .scrollBar(BarState.Auto)
        .width('100%')
      }
      .width('100%')
      .constraintSize({ maxWidth: 560 })
      .padding({ left: 20, right: 20, top: 16, bottom: 22 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 22, topRight: 22 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
      .transition(TransitionEffect.translate({ y: 340 })
        .combine(TransitionEffect.opacity(0))
        .animation({ duration: 220, curve: Curve.Friction }))
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
          Text('✕')
            .fontSize(15)
            .fontColor(this.pal().text3)
            .width(30)
            .height(30)
            .textAlign(TextAlign.Center)
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
                Text('✕')
                  .fontSize(this.fs(12))
                  .fontColor(this.pal().text3)
                  .padding({ left: 6, right: 6, top: 4, bottom: 4 })
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
            .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
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

  /** 单块玻璃上的跟手光斑：谁被按就亮谁，坐标就是那一块自己的局部坐标。 */
  @Builder
  DockSpot(radius: number) {
    Column()
      .width('100%')
      .height('100%')
      .radialGradient({
        center: [this.dockLightX, this.dockLightY],
        radius: radius,
        colors: [
          ['rgba(255,255,255,0.62)', 0],
          ['rgba(255,255,255,0.20)', 0.45],
          ['rgba(255,255,255,0)', 1]
        ]
      })
      .opacity(this.dockLightOpacity)
      .hitTestBehavior(HitTestMode.None)
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
    .onClick(() => {
      action();
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
          .color('#22D3EE')
      } else {
        Column()
          .width(6)
          .height(6)
          .borderRadius(3)
          .backgroundColor(item.toolState === 'failed' ? '#F85749' : '#34D399')
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
      Text(item.rev === 1 ? '⌃' : '⌄')
        .fontSize(this.fs(12))
        .fontColor(this.pal().text3)
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
          .color('#22D3EE')
      } else {
        Column()
          .width(4)
          .height(4)
          .borderRadius(2)
          .backgroundColor(item.toolState === 'failed' ? '#F85749' : this.pal().text3)
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
            .backgroundColor(Color.Transparent)
            .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
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
            .fontColor('#F85749')
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
          .fontColor('#22D3EE')
        Text('需要回答')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor('#22D3EE')
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
                .backgroundColor(question.selectedLabels.includes(label) ? '#4D6BFE' : this.pal().chip)
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
          .backgroundColor(Color.Transparent)
          .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
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

/** 服务器切换面板的一行。 */
class ServerChoice {
  url: string = '';
  /** 显示用的短账号（截断过）。 */
  account: string = '';
  /** 完整账号，用来判定「是不是当前这条」。 */
  accountFull: string = '';
  label: string = '';
  host: string = '';
  active: boolean = false;
  profile: SavedProfile | undefined = undefined;
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

/** 把 Markdown 拆成可渲染的行，并去掉会裸露的标记符号。 */
function markdownLines(source: string): MdLine[] {
  const out: MdLine[] = [];
  const raw: string[] = source.split(String.fromCharCode(10));
  let inCode: boolean = false;
  for (const original of raw) {
    const line: string = original.trimEnd();
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
