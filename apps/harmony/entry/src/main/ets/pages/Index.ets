import { UIContext, window, promptAction } from '@kit.ArkUI';
import { common, Want } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { AppRuntime, ChatItem, ChatQuestion, DEFAULT_SERVER_URL, PHASE_BOOT, PHASE_CHAT,
  PHASE_CONNECTING, PHASE_DEVICES, PHASE_SETUP, SlashCommand, getAppRuntime } from '../services/AppRuntime';
import { RemoteHostDevice } from '../model/Types';
import { HarnessRemoteSession } from '../net/HarnessClient';
import { darkPalette, lightPalette, Palette } from '../services/Theme';
import { OAuthProvider } from '../net/ServerApi';
import BuildProfile from 'BuildProfile';

@Entry
@Component
struct Index {
  private runtime: AppRuntime = getAppRuntime();
  private scroller: Scroller = new Scroller();
  private fieldsPrefilled: boolean = false;
  private mainWindow: window.Window | undefined = undefined;

  @State phase: string = PHASE_BOOT;
  @State busy: boolean = false;
  @State busyAction: string = '';
  @State errorMsg: string = '';
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
  @State isDarkUi: boolean = false;
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
    this.contextPercent = this.runtime.contextPercent;
    this.slashCommands = this.runtime.slashCommands;
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

  private themeLabel(mode: number): string {
    if (mode === 1) {
      return '浅色';
    }
    if (mode === 2) {
      return '深色';
    }
    return '跟随系统';
  }

  private cycleTheme(): void {
    const next: number = this.themeMode === 0 ? 1 : (this.themeMode === 1 ? 2 : 0);
    this.runtime.setThemeMode(next);
    promptAction.showToast({ message: `主题：${this.themeLabel(next)}` });
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
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal().bg)
    .padding({ top: this.topInset, bottom: this.bottomInset })
    .onAppear(() => {
      this.measureInsets();
    })
  }

  @Builder
  LogoChip() {
    Column() {
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
      Text('正在初始化…')
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
        Text('连接你的 DEEPSEEK HARNESS 主机')
          .fontSize(12)
          .fontColor(this.pal().text2)
          .letterSpacing(1)
      }
      TextInput({ text: this.serverInput, placeholder: '服务器地址（https://…）' })
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
      TextInput({ text: this.emailInput, placeholder: '邮箱' })
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
      TextInput({ text: this.passwordInput, placeholder: '密码' })
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
      Button('登录')
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
          Text('扫码 / 浏览器授权登录（选账号对应的提供商）')
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
        Button('扫码 / 浏览器授权登录')
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
          Text('用已登录同一账号的浏览器扫码或点按钮授权')
            .fontSize(12)
            .fontColor(this.pal().text2)
            .textAlign(TextAlign.Center)
          QRCode(this.qrUrl)
            .width(160)
            .height(160)
            .color('#0B0F19')
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
          Button('在浏览器中打开授权页')
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
          Button('复制授权链接')
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
            Text('等待浏览器授权…')
              .fontSize(12)
              .fontColor(this.pal().text2)
          }
          Button('取消')
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
      if (this.errorMsg.length > 0) {
        Text(this.errorMsg)
          .fontSize(13)
          .fontColor('#F85749')
          .textAlign(TextAlign.Center)
      }
      Text(this.buildTag())
        .fontSize(10)
        .fontColor(this.pal().text3)
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
          Text('远程主机')
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
            this.cycleTheme();
          })
        Button('刷新')
          .height(32)
          .fontSize(13)
          .backgroundColor(this.pal().chip)
          .fontColor(this.pal().text2)
          .borderRadius(16)
          .border({ width: 1, color: this.pal().borderStrong })
          .onClick(() => {
            this.runtime.refreshDevices();
          })
        Button('退出')
          .height(32)
          .fontSize(13)
          .backgroundColor(this.pal().chip)
          .fontColor(this.pal().text2)
          .borderRadius(16)
          .border({ width: 1, color: this.pal().borderStrong })
          .onClick(() => {
            this.runtime.logout();
          })
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 16, bottom: 12 })
      if (this.busy) {
        Row({ space: 8 }) {
          LoadingProgress()
            .width(18)
            .height(18)
            .color('#22D3EE')
          Text('正在刷新设备…')
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
        }, (device: RemoteHostDevice) => device.deviceId)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 20, right: 20, top: 8, bottom: 12 })
      .scrollBar(BarState.Off)
      if (this.devices.length === 0 && !this.busy) {
        Text('暂无远程主机，请先在服务器上注册主机设备')
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
          Text(`${this.devices.length} 台主机`)
            .fontSize(12)
            .fontColor(this.pal().text2)
          Text(`${this.onlineDeviceCount()} 在线`)
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
        if (this.renamingDeviceId === device.deviceId) {
          TextInput({ text: this.renameInput, placeholder: '输入主机名称' })
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
          Text(`${device.platform} · ${device.online ? '在线' : '离线'}`)
            .fontSize(12)
            .fontColor(this.pal().text2)
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      if (this.renamingDeviceId === device.deviceId) {
        Row({ space: 8 }) {
          Text('取消')
            .fontSize(12)
            .fontColor(this.pal().text2)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor(this.pal().chip)
            .borderRadius(14)
            .border({ width: 1, color: this.pal().borderStrong })
            .onClick(() => {
              this.cancelRename();
            })
          Text('确定')
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
        Text('改名')
          .fontSize(11)
          .fontColor(this.pal().text2)
          .padding({ left: 10, right: 10, top: 5, bottom: 5 })
          .backgroundColor(this.pal().chip)
          .borderRadius(13)
          .border({ width: 1, color: this.pal().borderStrong })
          .onClick(() => {
            this.beginRename(device);
          })
        if (device.online) {
          Text('连接')
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
      Text('正在建立安全连接…')
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
                .constraintSize({ maxWidth: 220 })
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
        ForEach(this.messages, (item: ChatItem) => {
          ListItem() {
            this.MessageRow(item)
          }
        }, (item: ChatItem) => `${item.id}#${item.rev}`)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 4 })
      .scrollBar(BarState.Off)
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
      Row() {
        Text(this.runtime.steerMode ? '插话 · 立刻打断' : '排队 · 本轮之后')
          .fontSize(11)
          .fontColor(this.runtime.steerMode ? '#22D3EE' : this.pal().text3)
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .backgroundColor(this.runtime.steerMode ? 'rgba(34,211,238,0.14)' : this.pal().inputBg)
          .borderRadius(10)
          .border({ width: 1,
            color: this.runtime.steerMode ? 'rgba(34,211,238,0.45)' : this.pal().border })
          .onClick(() => {
            this.runtime.setSteerMode(!this.runtime.steerMode);
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 2, bottom: 0 })
      .justifyContent(FlexAlign.Start)
      Row({ space: 10 }) {
        TextInput({ text: this.promptInput, placeholder: this.generating ? '正在生成，可插话…' : '发送消息…' })
          .layoutWeight(1)
          .height(46)
          .backgroundColor(this.pal().inputBg)
          .fontColor(this.pal().text)
          .fontSize(15)
          .placeholderColor(this.pal().text3)
          .caretColor('#22D3EE')
          .borderRadius(23)
          .border({ width: 1, color: this.pal().borderStrong })
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
      }
      .width('100%')
      .padding({ left: 14, right: 14, top: 8, bottom: 10 })
    }
    .width('100%')
    .height('100%')
    .constraintSize({ maxWidth: 880 })
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
        }, (session: HarnessRemoteSession) => session.sessionId)
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 12, right: 12, top: 10 })
      .scrollBar(BarState.Off)
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
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
    } else if (item.kind === 'assistant') {
      this.AssistantRow(item)
    } else if (item.kind === 'tool') {
      this.ToolRow(item)
    } else if (item.kind === 'approval') {
      this.ApprovalRow(item)
    } else if (item.kind === 'question') {
      this.QuestionRow(item)
    }
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
            Text(item.streaming ? `${item.text}▍` : item.text)
              .fontSize(15)
              .fontColor(this.pal().text)
              .textAlign(TextAlign.Start)
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
            .maxLines(6)
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
