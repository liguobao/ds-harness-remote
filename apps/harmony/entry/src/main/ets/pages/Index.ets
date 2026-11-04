import { UIContext, window, promptAction } from '@kit.ArkUI';
import { common, Want } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { AppRuntime, ChatItem, ChatQuestion, DEFAULT_SERVER_URL, PHASE_BOOT, PHASE_CHAT,
  PHASE_CONNECTING, PHASE_DEVICES, PHASE_SETUP, ModelOption, SlashCommand,
  getAppRuntime, errorMessage } from '../services/AppRuntime';
import { RemoteHostDevice } from '../model/Types';
import { DirectoryEntry, HarnessWorkspace } from '../net/HarnessClient';
import { HarnessRemoteSession } from '../net/HarnessClient';
import { darkPalette, lightPalette, Palette } from '../services/Theme';
import { OAuthProvider } from '../net/ServerApi';
import { t, english, LANG_SYSTEM, LANG_ZH, LANG_EN } from '../services/I18n';
import { VoiceRecorder } from '../services/VoiceInput';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import BuildProfile from 'BuildProfile';

@Entry
@Component
struct Index {
  private runtime: AppRuntime = getAppRuntime();
  private voice: VoiceRecorder = new VoiceRecorder();
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
  /** 斜杠命令候选。 */
  @State slashCommands: SlashCommand[] = [];
  /** 模型选择器。 */
  @State showModelPicker: boolean = false;
  @State modelOptions: ModelOption[] = [];
  @State currentModelLabel: string = '';
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
  /** 正在录音（麦克风按钮变红点）。 */
  @State recording: boolean = false;
  /** 录音已停止、等主机转写。 */
  @State dictating: boolean = false;
  /** 被手动展开的连续工具调用段（键是段首工具的 id）。 */
  @State expandedRuns: string[] = [];
  private windowChromeDark: boolean = false;
  private chromeApplied: boolean = false;

  aboutToAppear(): void {
    this.runtime.onUiUpdate = () => {
      this.syncFromRuntime();
    };
    this.runtime.bootstrap(getContext(this));
  }

  aboutToDisappear(): void {
    if (this.mainWindow !== undefined) {
      this.mainWindow.off('avoidAreaChange');
    }
  }

  private measureInsets(): void {
    window.getLastWindow(getContext(this)).then((win: window.Window) => {
      this.mainWindow = win;
      this.applyInsets(win);
      win.on('avoidAreaChange', () => {
        this.applyInsets(win);
      });
    }).catch(() => {
      this.topInset = 0;
      this.bottomInset = 0;
    });
  }

  private applyInsets(win: window.Window): void {
    const ui: UIContext = this.getUIContext();
    const topPx: number = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height;
    const bottomPx: number = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR).bottomRect.height;
    this.topInset = ui.px2vp(topPx);
    this.bottomInset = ui.px2vp(bottomPx);
    const rect: window.Rect = win.getWindowProperties().windowRect;
    this.isLandscape = rect.width > rect.height;
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
      promptAction.showToast({ message: '授权链接已复制' });
    }).catch(() => {
      promptAction.showToast({ message: '复制失败，可长按链接手动复制' });
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
    this.slashCommands = this.runtime.slashCommands;
    this.modelOptions = this.runtime.modelOptions;
    this.currentModelLabel = this.runtime.currentModelLabel;
    this.workspaces = this.runtime.workspaces;
    this.selectedWorkspaceId = this.runtime.selectedWorkspaceId;
    this.browsePath = this.runtime.browsePath;
    this.directoryEntries = this.runtime.directoryEntries;
    if (this.sessionSearchActive) {
      const found: HarnessRemoteSession[] | undefined = this.runtime.searchResults;
      this.sessionSearchResults = found !== undefined ? found : [];
    }
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
      this.emailInput = this.runtime.email;
      this.fieldsPrefilled = true;
    }
    if (this.phase === PHASE_CHAT) {
      setTimeout(() => {
        this.scrollChatToBottom();
      }, 100);
    }
  }

  private scrollChatToBottom(): void {
    if (this.messages.length === 0) {
      return;
    }
    this.scroller.scrollToIndex(this.messages.length - 1, false);
  }

  private sendTap(): void {
    const text: string = this.promptInput;
    this.promptInput = '';
    this.runtime.sendPrompt(text);
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
  private permissionLabel(): string {
    const preset: string = this.runtime.permissionPreset;
    if (preset === 'read-only') {
      return '只读';
    }
    if (preset === 'workspace-write') {
      return '可写';
    }
    if (preset === 'danger-full-access') {
      return '完全';
    }
    return '权限';
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
    return rows;
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
    row.text = `${end - start} 步 · ${expanded ? '收起' : '展开'}`;
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
    if (device.harnessVersion.length > 0) {
      return `${head} · ${this.tr('主机')} ${device.harnessVersion}`;
    }
    if (device.clientVersion.length > 0) {
      return `${head} · ${this.tr('插件')} ${device.clientVersion}`;
    }
    return head;
  }

  /** 设备卡第三行：在线状态用绿点表达，这里只补「最近活动」，避免「在线」重复两遍。 */
  private hostSeenLabel(device: RemoteHostDevice): string {
    if (device.online) {
      return this.tr('此刻在线');
    }
    if (device.lastSeenAt <= 0) {
      return this.tr('离线 · 无活动记录');
    }
    const diff: number = Date.now() - device.lastSeenAt;
    if (diff < 60000) {
      return this.tr('离线 · 刚刚还在');
    }
    if (diff < 3600000) {
      return this.en() ? `offline · ${Math.round(diff / 60000)} min ago` : `离线 · ${Math.round(diff / 60000)} 分钟前`;
    }
    if (diff < 86400000) {
      return this.en() ? `offline · ${Math.round(diff / 3600000)} h ago` : `离线 · ${Math.round(diff / 3600000)} 小时前`;
    }
    return this.en() ? `offline · ${Math.round(diff / 86400000)} d ago` : `离线 · ${Math.round(diff / 86400000)} 天前`;
  }

  /** 设备页标题栏的溢出菜单：退出登录收进菜单，避免和刷新、主题挤成三颗按钮。 */
  /** 语音输入：点一下开录，再点一下收尾并转写，结果续写到输入框。 */
  private toggleDictation(): void {
    if (this.dictating) {
      return;
    }
    if (this.recording) {
      this.stopDictation();
      return;
    }
    this.startDictation();
  }

  private startDictation(): void {
    const context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
    const recorder: VoiceRecorder = this.voice;
    this.errorMsg = '';
    VoiceRecorder.ensurePermission(context).then((granted: boolean) => {
      if (!granted) {
        this.errorMsg = this.tr('没有麦克风权限，去系统设置里允许后再试');
        return;
      }
      return recorder.start().then(() => {
        this.recording = true;
      });
    }).catch((error: Error) => {
      this.recording = false;
      this.errorMsg = this.tr('录音启动失败：') + errorMessage(error);
    });
  }

  private stopDictation(): void {
    const recorder: VoiceRecorder = this.voice;
    this.recording = false;
    this.dictating = true;
    recorder.stop().then((audioBase64: string) => {
      if (audioBase64.length === 0) {
        this.dictating = false;
        this.errorMsg = this.tr('太短了，没听清');
        return;
      }
      return this.runtime.transcribeVoice(audioBase64).then((text: string) => {
        this.dictating = false;
        if (text.length === 0) {
          this.errorMsg = this.tr('没识别出内容');
          return;
        }
        const head: string = this.promptInput.length > 0 && !this.promptInput.endsWith(' ') ? ' ' : '';
        this.promptInput = this.promptInput + head + text;
      });
    }).catch((error: Error) => {
      this.dictating = false;
      this.errorMsg = this.tr('语音转写失败：') + errorMessage(error);
    });
  }

  private devicesMenu(): MenuElement[] {
    const items: MenuElement[] = [
      {
        value: '退出登录',
        action: () => {
          AlertDialog.show({
            title: '退出登录',
            message: '将清除本机保存的主机凭据，需要重新绑定才能连接。',
            autoCancel: true,
            primaryButton: {
              value: '取消',
              action: () => {
              }
            },
            secondaryButton: {
              value: '退出',
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
      }, (lang: number) => `ui-${lang}`)
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  RootStack() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .radialGradient({ center: ['50%', '0%'], radius: '70%',
          colors: [['rgba(77,107,254,0.10)', 0], ['rgba(77,107,254,0)', 1]] })
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
      if (this.showModelPicker) {
        this.ModelPickerOverlay()
      }
      if (this.showBrowser) {
        this.FileBrowserOverlay()
      }
      if (this.showSettings) {
        this.SettingsOverlay()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().bg)
    .padding({ top: this.topInset, bottom: this.bottomInset })
    .onAppear(() => {
      this.measureInsets();
    })
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
      Column({ space: 14 }) {
        Row() {
          Text('设置')
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Blank()
          Text('完成')
            .fontSize(13)
            .fontColor('#22D3EE')
            .padding({ left: 12, right: 4, top: 4, bottom: 4 })
            .onClick(() => {
              this.showSettings = false;
            })
        }
        .width('100%')
        Column({ space: 8 }) {
          Text(this.tr('外观'))
            .fontSize(12)
            .fontColor(this.pal().text3)
            .width('100%')
          ForEach(this.themeChoices(), (choice: ThemeChoice) => {
            Row({ space: 10 }) {
              Column({ space: 2 }) {
                Text(t(choice.label))
                  .fontSize(15)
                  .fontColor(this.pal().text)
                Text(t(choice.hint))
                  .fontSize(11)
                  .fontColor(this.pal().text3)
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              Text(this.themeMode === choice.value ? '✓' : '')
                .fontSize(15)
                .fontColor('#22D3EE')
            }
            .width('100%')
            .padding({ top: 11, bottom: 11, left: 14, right: 14 })
            .backgroundColor(this.themeMode === choice.value ? this.pal().chip : this.pal().card)
            .borderRadius(14)
            .border({ width: 1, color: this.themeMode === choice.value ? 'rgba(34,211,238,0.55)' : this.pal().border })
            .onClick(() => {
              this.runtime.setThemeMode(choice.value);
            })
          }, (choice: ThemeChoice) => `theme-${choice.value}-${this.languageMode}`)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        Column({ space: 8 }) {
          Text(this.tr('语言'))
            .fontSize(12)
            .fontColor(this.pal().text3)
            .width('100%')
          ForEach(this.languageChoices(), (choice: ThemeChoice) => {
            Row({ space: 10 }) {
              Column({ space: 2 }) {
                Text(t(choice.label))
                  .fontSize(15)
                  .fontColor(this.pal().text)
                Text(t(choice.hint))
                  .fontSize(11)
                  .fontColor(this.pal().text3)
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              Text(this.languageMode === choice.value ? '✓' : '')
                .fontSize(15)
                .fontColor('#22D3EE')
            }
            .width('100%')
            .padding({ top: 11, bottom: 11, left: 14, right: 14 })
            .backgroundColor(this.languageMode === choice.value ? this.pal().chip : this.pal().card)
            .borderRadius(14)
            .border({ width: 1,
              color: this.languageMode === choice.value ? 'rgba(34,211,238,0.55)' : this.pal().border })
            .onClick(() => {
              this.runtime.setLanguageMode(choice.value);
            })
          }, (choice: ThemeChoice) => `lang-${choice.value}-${this.languageMode}`)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 18, bottom: 26 })
      .backgroundColor(this.pal().panel)
      .borderRadius({ topLeft: 22, topRight: 22 })
      .border({ width: { top: 0.5 }, color: this.pal().borderStrong })
    }
    .width('100%')
    .height('100%')
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
      TextInput({ text: this.serverInput, placeholder: this.tr('服务器地址（https://…）') })
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
      Row({ space: 10 }) {
        Column({ space: 6 }) {
          Text(this.tr('远程主机'))
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
            .letterSpacing(2)
          Row()
            .width(32)
            .height(3)
            .borderRadius(2)
            .linearGradient({ angle: 90, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
          Text(this.buildTag())
            .fontSize(10)
            .fontColor(this.pal().text3)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Button(this.themeLabel(this.themeMode))
          .height(32)
          .fontSize(13)
          .backgroundColor(this.pal().chip)
          .fontColor(this.pal().text2)
          .borderRadius(16)
          .border({ width: 1, color: this.pal().border })
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
        Button({ type: ButtonType.Circle }) {
          Image($r('app.media.ic_more'))
            .width(18)
            .height(18)
            .fillColor(this.pal().text2)
        }
        .width(32)
        .height(32)
        .backgroundColor(this.pal().chip)
        .border({ width: 1, color: this.pal().borderStrong })
        .bindMenu(this.devicesMenu())
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 16, bottom: 12 })
      if (this.busy) {
        Row({ space: 8 }) {
          LoadingProgress()
            .width(18)
            .height(18)
            .color('#22D3EE')
          Text(this.tr('正在刷新设备…'))
            .fontSize(13)
            .fontColor(this.pal().text2)
        }
        .padding({ left: 20, right: 20, bottom: 8 })
      }
      if (this.errorMsg.length > 0) {
        Text(this.errorMsg)
          .fontSize(13)
          .fontColor('#F85749')
          .padding({ left: 20, right: 20, bottom: 8 })
      }
      List({ space: 12 }) {
        ForEach(this.devices, (device: RemoteHostDevice) => {
          ListItem() {
            this.DeviceCard(device)
          }
        }, (device: RemoteHostDevice) => `${device.deviceId}#${this.languageMode}`)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 20, right: 20, top: 8, bottom: 12 })
      .scrollBar(BarState.Off)
      if (this.devices.length === 0 && !this.busy) {
        Text(this.tr('暂无远程主机，请先在服务器上注册主机设备'))
          .fontSize(13)
          .fontColor(this.pal().text3)
          .padding(24)
          .textAlign(TextAlign.Center)
      }
      Column()
        .width('100%')
        .height(0.5)
        .backgroundColor(this.pal().border)
      Row({ space: 12 }) {
        Column({ space: 2 }) {
          Text(this.accountEmail)
            .fontSize(12)
            .fontColor(this.pal().text2)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(serverHostLabel(this.accountServer))
            .fontSize(10)
            .fontColor(this.pal().text3)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        Column({ space: 2 }) {
          Text(this.hostCountLabel())
            .fontSize(12)
            .fontColor(this.pal().text2)
          Text(this.onlineCountLabel())
            .fontSize(10)
            .fontColor(this.pal().text3)
        }
        .alignItems(HorizontalAlign.End)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 10, bottom: 12 })
    }
    .width('100%')
    .height('100%')
    .constraintSize({ maxWidth: 880 })
  }

  @Builder
  DeviceCard(device: RemoteHostDevice) {
    Row({ space: 14 }) {
      Column() {
        Text(deviceAvatarLabel(device, this.displayNameFor(device)))
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor(device.online ? '#34D399' : this.pal().text3)
      }
        .width(40)
        .height(40)
        .borderRadius(20)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor(device.online ? 'rgba(52,211,153,0.12)' : this.pal().chip)
        .border({ width: 1, color: device.online ? 'rgba(52,211,153,0.30)' : this.pal().border })
      Column({ space: 4 }) {
        Row({ space: 5 }) {
          Column()
            .width(6)
            .height(6)
            .borderRadius(3)
            .backgroundColor(device.online ? '#34D399' : this.pal().text3)
          Text(device.online ? this.tr('在线') : this.tr('离线'))
            .fontSize(11)
            .fontColor(device.online ? '#34D399' : this.pal().text3)
        }
        .width('100%')
        .justifyContent(FlexAlign.Start)

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
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().text)
            .maxLines(1)
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
        Row({ space: 6 }) {
          Column()
            .width(6)
            .height(6)
            .borderRadius(3)
            .backgroundColor(device.online ? '#34D399' : this.pal().text3)
          Column({ space: 2 }) {
            Text(this.hostSubtitle(device))
              .fontSize(12)
              .fontColor(this.pal().text2)
            Text(this.hostSeenLabel(device))
              .fontSize(10)
              .fontColor(this.pal().text3)
          }
          .alignItems(HorizontalAlign.Start)
        }
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
        Text(this.tr('改名'))
          .fontSize(11)
          .fontColor(this.pal().text2)
          .padding({ left: 10, right: 10, top: 5, bottom: 5 })
          .backgroundColor(this.pal().chip)
          .borderRadius(13)
          .border({ width: 1, color: this.pal().borderStrong })
          .onClick(() => {
            this.beginRename(device);
          })
        if (this.runtime.hasHostPin(device.deviceId)) {
          Text('🔑')
            .fontSize(12)
            .padding({ left: 8, right: 8, top: 5, bottom: 5 })
            .backgroundColor(this.pal().chip)
            .borderRadius(13)
            .border({ width: 1, color: this.pal().borderStrong })
            .onClick(() => {
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
            })
        }
        if (device.online) {
          Text(this.tr('连接'))
            .fontSize(14)
            .fontColor('#FFFFFF')
            .padding({ left: 20, right: 20, top: 9, bottom: 9 })
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
      Text('NOISE IK 握手 · 能力协商需要几秒')
        .fontSize(11)
        .fontColor(this.pal().text3)
        .letterSpacing(1)
      Button('取消')
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
      Column() {
      Row() {
        Text('‹')
          .fontSize(26)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal().text)
          .width(38)
          .height(38)
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.runtime.disconnectToDevices();
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
              TextInput({ text: this.sessionTitleInput, placeholder: '会话名称' })
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
              Text(this.generating ? '正在生成…' : this.currentSessionTitle)
                .fontSize(12)
                .fontColor(this.generating ? '#22D3EE' : this.pal().text2)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .constraintSize({ maxWidth: 150 })
                .onClick(() => {
                  if (!this.generating && this.currentSessionId.length > 0) {
                    this.sessionTitleInput = this.currentSessionTitle;
                    this.renamingSession = true;
                  }
                })
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
        Text(this.currentModelLabel.length > 0 ? this.currentModelLabel : '模型')
          .fontSize(10)
          .fontColor(this.pal().text2)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 64 })
          .padding({ left: 9, right: 9, top: 5, bottom: 5 })
          .backgroundColor(this.pal().chip)
          .borderRadius(11)
          .border({ width: 1, color: this.pal().border })
          .onClick(() => {
            this.runtime.refreshModelCatalog();
            this.showModelPicker = true;
          })
          .gesture(LongPressGesture().onAction(() => {
            ActionSheet.show({
              title: '会话权限',
              message: '决定这个会话里工具调用与命令执行的放行方式',
              sheets: [
                { title: '只读', action: () => { this.runtime.selectPermission('read-only'); } },
                { title: '工作区可写', action: () => { this.runtime.selectPermission('workspace-write'); } },
                { title: '完全权限', action: () => { this.runtime.selectPermission('danger-full-access'); } }
              ]
            });
          }))
        Text('＋')
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal().text)
          .width(38)
          .height(38)
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.showSessions = false;
            this.runtime.createNewSession();
          })
        if (!this.isLandscape) {
          Text('≡')
            .fontSize(20)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal().text)
            .width(38)
            .height(38)
            .textAlign(TextAlign.Center)
            .margin({ left: 2 })
            .onClick(() => {
              this.showSessions = true;
              this.runtime.loadWorkspaces();
            })
        }
      }
      .width('100%')
      .height(56)
      .padding({ left: 12, right: 12 })
      Column()
        .width('100%')
        .height(0.5)
        .backgroundColor(this.pal().border)
      if (this.errorMsg.length > 0) {
        Text(this.errorMsg)
          .fontSize(12)
          .fontColor('#F85749')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .padding({ left: 16, right: 16, top: 8 })
      }
      List({ scroller: this.scroller, space: 14 }) {
        if (this.messages.length === 0) {
          ListItem() {
            Column({ space: 12 }) {
              if (this.sessionsLoadFailed) {
                Text('会话列表加载失败')
                  .fontSize(13)
                  .fontColor('#F85749')
                Button('重试')
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
                  Text('正在重新加载…')
                    .fontSize(11)
                    .fontColor(this.pal().text3)
                }
              } else {
                Text(this.busy ? '正在加载会话…' : '发送第一条消息开始对话')
                  .fontSize(13)
                  .fontColor(this.pal().text3)
                  .padding(32)
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
      .padding({ left: 16, right: 16, top: 8, bottom: 104 })
      .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')

      // 底部渐隐：消息滚到浮动坞下方时不硬切
      Column()
        .width('100%')
        .height(96)
        .linearGradient({ angle: 180, colors: [['rgba(0,0,0,0)', 0], [this.pal().bg, 1]] })
        .hitTestBehavior(HitTestMode.None)

      this.ComposerDock()
    }
    .width('100%')
    .height('100%')
    .constraintSize({ maxWidth: 880 })
  }

  /** 底部输入坞：系统级光感玻璃（背景模糊 + 提饱和 + 半透内衬），浮在会话层之上。 */
  @Builder
  ComposerDock() {
    Column({ space: 8 }) {
        if (this.contextPills().length > 0) {
          Row({ space: 8 }) {
            ForEach(this.contextPills(), (pill: string) => {
              Text(pill)
                .fontSize(11)
                .fontColor(this.pal().text2)
                .padding({ left: 10, right: 10, top: 4, bottom: 4 })
                .backgroundColor(this.pal().card)
                .borderRadius(10)
                .maxLines(1)
            }, (pill: string) => pill)
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4, bottom: 2 })
          .justifyContent(FlexAlign.Start)
        }
      Column() {
        if (this.promptInput.startsWith('/') && this.slashCommands.length > 0) {
          Scroll() {
            Row({ space: 8 }) {
              ForEach(this.slashCommands, (command: SlashCommand) => {
                Row({ space: 6 }) {
                  Text(command.name)
                    .fontSize(12)
                    .fontColor('#22D3EE')
                  if (command.description.length > 0) {
                    Text(command.description)
                      .fontSize(11)
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
        Row({ space: 10 }) {
          // 语音输入：点一下开始录，再点一下结束并转写；转写中显示 spinner。
          Row() {
            if (this.dictating) {
              LoadingProgress()
                .width(18)
                .height(18)
                .color('#22D3EE')
            } else if (this.recording) {
              Column()
                .width(10)
                .height(10)
                .borderRadius(3)
                .backgroundColor('#F85749')
            } else {
              Image($r('app.media.ic_mic'))
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
          .backgroundColor(this.recording ? 'rgba(248,87,73,0.16)'
            : (this.isDarkUi ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.66)'))
          .border({ width: 1,
            color: this.recording ? 'rgba(248,87,73,0.55)'
              : (this.isDarkUi ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)') })
          .enabled(!this.dictating)
          .onClick(() => {
            this.toggleDictation();
          })
          TextInput({ text: this.promptInput, placeholder: this.recording ? '正在听…'
              : (this.dictating ? '正在转写…'
                : (this.generating ? '正在生成，可插话…'
                  : (this.runtime.steerMode ? '插话发送（长按发送键切换）' : '发送消息…'))) })
            .layoutWeight(1)
            .height(46)
            .backgroundColor(this.isDarkUi ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.66)')
            .fontColor(this.pal().text)
            .fontSize(15)
            .placeholderColor(this.pal().text3)
            .caretColor('#22D3EE')
            .borderRadius(23)
            .border({ width: 1,
              color: this.isDarkUi ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)' })
            .padding({ left: 18, right: 18 })
            // 生成中保持可输入：否则「插话」无从谈起。
            .enabled(true)
            .onChange((value: string) => {
              this.promptInput = value;
              if (value === '/' && this.slashCommands.length === 0) {
                this.runtime.loadSlashCommands();
              }
            })
            .onSubmit(() => {
              this.sendTap();
            })
          if (this.generating) {
            Text('■')
              .fontSize(16)
              .fontColor('#F85749')
              .width(46)
              .height(46)
              .textAlign(TextAlign.Center)
              .backgroundColor('rgba(248,87,73,0.12)')
              .borderRadius(23)
              .border({ width: 1, color: 'rgba(248,87,73,0.35)' })
              .onClick(() => {
                this.runtime.stopGeneration();
              })
          }
          Text('↑')
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .width(46)
            .height(46)
            .textAlign(TextAlign.Center)
            .linearGradient({ angle: 135, colors: [['#4D6BFE', 0], ['#22D3EE', 1]] })
            .borderRadius(23)
            .shadow({ radius: 12, color: 'rgba(77,107,254,0.4)', offsetX: 0, offsetY: 3 })
            .onClick(() => {
              this.sendTap();
            })
            .gesture(LongPressGesture().onAction(() => {
              ActionSheet.show({
                title: '发送方式',
                message: this.runtime.steerMode ? '当前：插话（立刻打断当前轮）' : '当前：排队（本轮结束后再发）',
                sheets: [
                  {
                    title: '排队发送',
                    action: () => {
                      this.runtime.setSteerMode(false);
                    }
                  },
                  {
                    title: '插话打断',
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
      .width('100%')
      // 系统材质负责模糊和透光，内衬只留一点点白，避免糊成一块实心板
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, {
        colorMode: ThemeColorMode.SYSTEM,
        adaptiveColor: AdaptiveColor.DEFAULT
      })
      .backgroundColor(this.isDarkUi ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.18)')
      .borderRadius(30)
      .border({ width: 1,
        color: this.isDarkUi ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.90)' })
      .shadow({
        radius: 30,
        color: this.isDarkUi ? 'rgba(0,0,0,0.45)' : 'rgba(31,45,90,0.18)',
        offsetX: 0,
        offsetY: 12
      })
    }
    .width('100%')
    .padding({ left: 12, right: 12, bottom: 18 })
  }

  /** Shared sessions list (header + rows); wrapped by the overlay or the landscape pane. */
  @Builder
  SessionsPanelBody() {
    Column() {
      Row() {
        Text('会话')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.pal().text)
        Text(`${this.sessions.length}`)
          .fontSize(12)
          .fontColor(this.pal().text3)
          .margin({ left: 6 })
        Blank()
        Text('＋ 新建')
          .fontSize(13)
          .fontColor('#22D3EE')
          .padding({ left: 12, right: 12, top: 7, bottom: 7 })
          .backgroundColor('rgba(34,211,238,0.10)')
          .borderRadius(15)
          .border({ width: 1, color: 'rgba(34,211,238,0.30)' })
          .onClick(() => {
            this.showSessions = false;
            this.runtime.createNewSession();
          })
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 16, bottom: 12 })
      Row({ space: 8 }) {
        TextInput({ text: this.sessionSearchInput, placeholder: '搜索会话…' })
          .layoutWeight(1)
          .height(36)
          .fontSize(13)
          .backgroundColor(this.pal().inputBg)
          .fontColor(this.pal().text)
          .placeholderColor(this.pal().text3)
          .borderRadius(10)
          .border({ width: 1, color: this.pal().border })
          .padding({ left: 12, right: 12 })
          .onChange((value: string) => {
            this.sessionSearchInput = value;
            this.sessionSearchActive = value.trim().length > 0;
            this.runtime.searchSessions(value);
          })
        if (this.sessionSearchActive) {
          Text('清除')
            .fontSize(12)
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
          TextInput({ text: this.workspaceTitleInput, placeholder: '工作区名称' })
            .layoutWeight(1)
            .height(34)
            .fontSize(12)
            .backgroundColor(this.pal().inputBg)
            .fontColor(this.pal().text)
            .borderRadius(9)
            .border({ width: 1, color: this.pal().border })
            .onChange((value: string) => {
              this.workspaceTitleInput = value;
            })
          Text('✓')
            .fontSize(14)
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
              .fontSize(11)
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
            ForEach(this.workspaces, (workspace: HarnessWorkspace) => {
              Text(workspace.title.length > 0 ? workspace.title : workspace.path)
                .fontSize(11)
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
                        title: '浏览文件',
                        action: () => {
                          this.showBrowser = true;
                          this.runtime.openWorkspace(workspace.workspaceId);
                        }
                      },
                      {
                        title: '重命名',
                        action: () => {
                          this.editingWorkspaceId = workspace.workspaceId;
                          this.workspaceTitleInput = workspace.title;
                        }
                      },
                      {
                        title: '删除工作区',
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
      List({ space: 8 }) {
        ForEach(this.sessionSearchActive ? this.sessionSearchResults : this.sessions, (session: HarnessRemoteSession) => {
          ListItem() {
            Row({ space: 10 }) {
              Column()
                .width(3)
                .height(34)
                .borderRadius(1.5)
                .backgroundColor(session.sessionId === this.currentSessionId ? '#4D6BFE' : this.pal().chip)
              Column({ space: 3 }) {
                Text(formatSessionTitle(session))
                  .fontSize(14)
                  .fontWeight(session.sessionId === this.currentSessionId ? FontWeight.Medium : FontWeight.Normal)
                  .fontColor(session.sessionId === this.currentSessionId ? this.pal().text : this.pal().text2)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Row({ space: 6 }) {
                  Text(formatSessionTime(session.updatedAt))
                    .fontSize(11)
                    .fontColor(this.pal().text2)
                  if (session.running) {
                    Row({ space: 3 }) {
                      Column()
                        .width(4)
                        .height(4)
                        .borderRadius(2)
                        .backgroundColor('#34D399')
                      Text('运行中')
                        .fontSize(10)
                        .fontColor('#34D399')
                    }
                  }
                }
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
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
              this.showSessions = false;
              this.runtime.openSession(session.sessionId);
            })
            .gesture(LongPressGesture().onAction(() => {
              this.runtime.archiveSession(session.sessionId);
            }))
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
            .fontSize(12)
            .fontColor(this.pal().text2)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .backgroundColor(this.pal().chip)
            .borderRadius(9)
            .onClick(() => {
              this.runtime.browseUp();
            })
          Text(this.browsePath)
            .fontSize(11)
            .fontColor(this.pal().text3)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text('关闭')
            .fontSize(12)
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
                  .fontSize(14)
                Text(entry.name)
                  .fontSize(13)
                  .fontColor(this.pal().text)
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (!entry.isDirectory && entry.size > 0) {
                  Text(Math.round(entry.size / 1024) + ' KB')
                    .fontSize(10)
                    .fontColor(this.pal().text3)
                }
              }
              .width('100%')
              .padding({ left: 14, right: 14, top: 10, bottom: 10 })
              .onClick(() => {
                if (entry.isDirectory) {
                  this.runtime.browseDirectory(entry.path.length > 0 ? entry.path : (this.browsePath + '/' + entry.name));
                }
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
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal().text)
          Blank()
          Text('关闭')
            .fontSize(13)
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
              .fontSize(12)
              .fontColor(this.pal().text2)
              .width('100%')
              .padding({ left: 18, right: 18 })
            Scroll() {
              Row({ space: 8 }) {
                Text('默认')
                  .fontSize(11)
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
                    .fontSize(11)
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
            .fontSize(13)
            .fontColor(this.pal().text3)
            .padding({ left: 18, right: 18, top: 8, bottom: 24 })
        } else {
          List({ space: 6 }) {
            ForEach(this.modelOptions, (option: ModelOption) => {
              ListItem() {
                Row({ space: 10 }) {
                  Column({ space: 2 }) {
                    Text(option.name.length > 0 ? option.name : option.model)
                      .fontSize(14)
                      .fontColor(this.pal().text)
                    Text(option.provider + ' · ' + option.model)
                      .fontSize(11)
                      .fontColor(this.pal().text3)
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  if (option.model === this.currentModelLabel) {
                    Text('当前')
                      .fontSize(11)
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
        .onClick(() => {
          this.showSessions = false;
        })
      Column() {
        this.SessionsPanelBody()
      }
      .width('82%')
      .height('100%')
      .backgroundColor(this.pal().panel)
      .border({ width: { left: 0.5 }, color: this.pal().borderStrong })
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
    .width(300)
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
          Column() {
            Text(item.text)
              .fontSize(15)
              .fontColor('#FFFFFF')
              .textAlign(TextAlign.Start)
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
          this.offerFork(item);
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
    }
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
            .fontSize(12)
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
              .fontSize(15)
              .fontColor(this.pal().text3)
            Text(line.text)
              .fontSize(15)
              .fontColor(this.pal().text)
              .layoutWeight(1)
              .wordBreak(WordBreak.BREAK_ALL)
              .textAlign(TextAlign.Start)
          }
          .width('100%')
        } else {
          Text(line.text)
            .fontSize(line.heading ? 17 : 15)
            .fontWeight(line.heading ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(this.pal().text)
            .width('100%')
            .wordBreak(WordBreak.BREAK_ALL)
            .textAlign(TextAlign.Start)
        }
      }, (line: MdLine, index: number) => index.toString())
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
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
      } else if (this.images.has(line.imageSrc)) {
        Image(this.images.pixel(line.imageSrc))
          .width('100%')
          .constraintSize({ maxHeight: 420 })
          .objectFit(ImageFit.Contain)
          .borderRadius(10)
          .border({ width: 1, color: this.pal().border })
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

  /** 长按消息：可从该条消息处分叉出一个新会话。 */
  private offerFork(item: ChatItem): void {
    if (item.seq <= 0 || this.runtime.currentSessionId.length === 0) {
      return;
    }
    AlertDialog.show({
      title: '从这里分叉',
      message: '将新建一个会话，保留到这条消息为止的上下文，后续对话互不影响。',
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '分叉',
        action: () => {
          this.runtime.forkCurrentSession(item.seq);
        }
      }
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
              .fontSize(12)
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
                .fontSize(12)
                .fontColor(this.pal().text2)
            }
          }
        }
        .padding({ top: 10, bottom: 10, left: 14, right: 14 })
        .backgroundColor(this.pal().card)
        .borderRadius({ topLeft: 6, topRight: 18, bottomLeft: 18, bottomRight: 18 })
        .border({ width: 1, color: this.pal().border })
        .alignItems(HorizontalAlign.Start)
      }
      .width('88%')
      .justifyContent(FlexAlign.Start)
    }
    .width('100%')
    .justifyContent(FlexAlign.Start)
  }

  /** 折叠后的连续工具调用：一行「N 步 · 展开」，点一下逐条摊开。 */
  @Builder
  ToolRunRow(item: ChatItem) {
    Row({ space: 10 }) {
      if (item.toolState === 'running') {
        LoadingProgress()
          .width(14)
          .height(14)
          .color('#22D3EE')
      } else if (item.toolState === 'failed') {
        Text('✕')
          .fontSize(12)
          .fontColor('#F85749')
      } else {
        Text('✓')
          .fontSize(12)
          .fontColor('#34D399')
      }
      Column({ space: 2 }) {
        Text(item.text)
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal().text2)
        if (item.summary.length > 0) {
          Text(item.summary)
            .fontSize(11)
            .fontColor(this.pal().text3)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      Text(item.rev === 1 ? '收起' : '展开')
        .fontSize(11)
        .fontColor('#22D3EE')
    }
    .width('100%')
    .padding({ top: 9, bottom: 9, left: 12, right: 12 })
    .backgroundColor(this.pal().card)
    .borderRadius(12)
    .border({ width: 1, color: this.pal().border })
    .onClick(() => {
      this.toggleRun(item.requestRpcId);
    })
  }

  @Builder
  ToolRow(item: ChatItem) {
    Row({ space: 10 }) {
      if (item.toolState === 'running') {
        LoadingProgress()
          .width(14)
          .height(14)
          .color('#22D3EE')
      } else if (item.toolState === 'failed') {
        Text('✕')
          .fontSize(12)
          .fontColor('#F85749')
      } else {
        Text('✓')
          .fontSize(12)
          .fontColor('#34D399')
      }
      Column({ space: 2 }) {
        Text(item.toolName)
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal().text)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (item.summary.length > 0) {
          Text(item.summary)
            .fontSize(12)
            .fontColor(this.pal().text2)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        if (item.text.length > 0) {
          Text(item.text)
            .fontSize(11)
            .fontColor(this.pal().text2)
            .fontFamily('monospace')
            .maxLines(6)
            .wordBreak(WordBreak.BREAK_ALL)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding({ top: 10, bottom: 10, left: 12, right: 12 })
    .backgroundColor(this.pal().card)
    .borderRadius(14)
    .border({ width: 1, color: this.pal().border })
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
          Button('允许')
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
          Button('拒绝')
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
            Text('可多选')
              .fontSize(11)
              .fontColor(this.pal().text3)
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }, (question: ChatQuestion) => question.id)
      if (item.questionOutcome.length === 0) {
        Button('提交回答')
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
  return label.length > 0 ? label : '未配置服务器';
}

function formatSessionTitle(session: HarnessRemoteSession): string {
  const title: string = session.title.trim();
  if (title.length > 0) {
    return title;
  }
  if (session.blank) {
    return '新会话';
  }
  return `会话 ${session.sessionId.substring(0, 8)}`;
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
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}月${day}日 ${hour}:${minuteText}`;
  }
  return `${date.getFullYear()}年${month}月${day}日`;
}

function approvalOutcomeLabel(outcome: string): string {
  if (outcome === 'allowed-once') {
    return '已允许';
  }
  if (outcome === 'rejected') {
    return '已拒绝';
  }
  if (outcome === 'cancelled') {
    return '已取消';
  }
  return '已失效';
}

function questionOutcomeLabel(outcome: string): string {
  if (outcome === 'answered') {
    return '已回答';
  }
  if (outcome === 'queued') {
    return '已提交';
  }
  return '已取消';
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
class MdLine {
  text: string = '';
  code: boolean = false;
  heading: boolean = false;
  bullet: boolean = false;
  /** 非空表示这一行是图片，值是 markdown 里的 src。 */
  imageSrc: string = '';
  imageAlt: string = '';
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
      textLine.text = segment.text;
      if (textLine.text.length > 0) {
        out.push(textLine);
      }
    }
  }
  return out;
}
