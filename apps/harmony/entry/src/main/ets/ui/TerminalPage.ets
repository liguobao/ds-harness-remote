import { webview } from '@kit.ArkWeb';
import { asRecord, jsonStr } from '../protocol/Types';
import { TerminalAttachment, TerminalDimensions, TerminalInfo, TerminalSession } from '../net/TerminalSession';
import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';
import { ScreenHeader } from './ScreenHeader';

class TerminalBridge {
  receive: (message: string) => void = () => {};

  postMessage(message: string): void {
    this.receive(message);
  }
}

@Component
export struct TerminalPage {
  @Prop palette: Palette = lightPalette();
  session: TerminalSession | undefined = undefined;
  onBack: () => void = () => {};
  @State terminals: TerminalInfo[] = [];
  @State selected: string = '';
  @State ready: boolean = false;
  @State busy: boolean = false;
  @State writable: boolean = false;
  @State status: string = '';
  @State error: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: TerminalBridge = new TerminalBridge();
  private attachment: TerminalAttachment | undefined = undefined;
  private terminalSize: TerminalDimensions = new TerminalDimensions();
  private active: boolean = false;
  private rendererAck: number = 0;
  private ack: ((received: boolean) => void) | undefined = undefined;

  aboutToAppear(): void {
    this.active = true;
    this.bridge.receive = (message: string) => { this.receive(message); };
  }

  aboutToDisappear(): void {
    this.active = false;
    this.detach();
    this.bridge.receive = () => {};
  }

  private async reload(): Promise<void> {
    if (this.busy || !this.ready || this.session === undefined) {
      return;
    }
    this.detach();
    this.busy = true;
    this.error = '';
    this.status = t('正在连接终端…');
    try {
      const items = await this.session.load();
      if (!this.active) {
        return;
      }
      this.terminals = items;
      if (items.length > 0) {
        const previous = items.find((item: TerminalInfo) => item.id === this.selected);
        this.attach(previous?.id ?? items[0].id);
      } else {
        this.selected = '';
        await this.create();
      }
    } catch {
      this.setError(t('无法连接主机终端，请检查主机设置后重试。'));
    } finally {
      this.busy = false;
    }
  }

  private async create(): Promise<void> {
    if (!this.active || this.session === undefined) {
      return;
    }
    this.error = '';
    this.status = t('正在创建终端…');
    const item = await this.session.create(this.terminalSize);
    if (this.active) {
      this.terminals = this.terminals.concat([item]);
      this.attach(item.id);
    }
  }

  private async createFromButton(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      await this.create();
    } catch {
      this.setError(t('无法创建终端'));
    } finally {
      this.busy = false;
    }
  }

  private async closeSelected(): Promise<void> {
    const session = this.session;
    const id = this.selected;
    if (id.length === 0 || session === undefined || this.busy) {
      return;
    }
    this.detach();
    this.busy = true;
    try {
      await session.close(id);
      if (!this.active) {
        return;
      }
      this.terminals = this.terminals.filter((item: TerminalInfo) => item.id !== id);
      this.selected = '';
      if (this.terminals.length === 0) {
        this.onBack();
      } else {
        this.attach(this.terminals[0].id);
      }
    } catch {
      this.setError(t('无法关闭终端'));
    } finally {
      this.busy = false;
    }
  }

  private attach(id: string): void {
    if (this.session === undefined || id.length === 0) {
      return;
    }
    this.detach();
    this.selected = id;
    this.error = '';
    this.status = t('正在连接终端…');
    const attachment = this.session.attachment(id);
    this.attachment = attachment;
    attachment.onOutput = (data: string, reset: boolean) => this.renderOutput(data, reset);
    attachment.onState = (writable: boolean, running: boolean) => {
      if (this.attachment !== attachment) {
        return;
      }
      const readyForInput = !this.writable && writable;
      this.writable = writable;
      this.send({ 'type': 'enabled', 'value': writable });
      this.status = writable ? '' : t(running ? '终端由其他客户端控制' : '终端已退出');
      if (readyForInput) {
        attachment.resize(this.terminalSize);
      }
    };
    attachment.onFailure = () => {
      if (this.attachment === attachment) {
        this.setError(t('终端连接已中断'));
      }
    };
    attachment.open();
  }

  private detach(): void {
    this.attachment?.dispose();
    this.attachment = undefined;
    this.ack?.(false);
    this.ack = undefined;
    this.writable = false;
    this.send({ 'type': 'enabled', 'value': false });
  }

  private setError(message: string): void {
    if (this.active) {
      this.detach();
      this.status = '';
      this.error = message;
    }
  }

  private send(message: Record<string, Object>): void {
    if (this.ready) {
      this.controller.runJavaScript('window.receive(' + JSON.stringify(message) + ')').catch(() => {});
    }
  }

  private async renderOutput(data: string, reset: boolean): Promise<void> {
    const id = ++this.rendererAck;
    const received = await new Promise<boolean>((resolve) => {
      const deadline = setTimeout(() => { this.ack?.(false); }, 10000);
      this.ack = (success: boolean) => {
        clearTimeout(deadline);
        this.ack = undefined;
        resolve(success);
      };
      this.send({ 'type': 'write', 'data': data, 'reset': reset, 'id': id });
    });
    if (!received) {
      throw new Error('TERMINAL_RENDER_TIMEOUT');
    }
  }

  private receive(message: string): void {
    if (!this.active || message.length > 131072) {
      return;
    }
    try {
      const frame = asRecord(JSON.parse(message) as Object);
      if (frame === undefined) {
        return;
      }
      const type = jsonStr(frame, 'type', '');
      if (type === 'ready' || type === 'resize') {
        const cols = frame['cols'];
        const rows = frame['rows'];
        if (typeof cols === 'number' && Number.isSafeInteger(cols) && cols > 0 &&
          typeof rows === 'number' && Number.isSafeInteger(rows) && rows > 0) {
          this.terminalSize.cols = cols;
          this.terminalSize.rows = rows;
          this.attachment?.resize(this.terminalSize);
        }
        if (type === 'ready' && !this.ready) {
          this.ready = true;
          this.reload();
        }
      } else if (type === 'ack' && frame['id'] === this.rendererAck) {
        this.ack?.(true);
      } else if (type === 'data' && typeof frame['data'] === 'string' && this.writable) {
        this.attachment?.write(frame['data'] as string);
      }
    } catch {
      return;
    }
  }

  @Builder
  TerminalKey(label: string, data: string) {
    Button(label)
      .height(38)
      .backgroundColor(this.palette.card)
      .fontColor(this.palette.text)
      .enabled(this.writable)
      .onClick(() => { this.attachment?.write(data); })
  }

  build() {
    Column() {
      ScreenHeader({ palette: this.palette, title: t('终端'), onBack: this.onBack })
        .margin({ left: 16, right: 16 })
      Scroll() {
        Row({ space: 8 }) {
          Button('+').height(38).backgroundColor(this.palette.primary).accessibilityText(t('新建终端'))
            .enabled(this.ready && !this.busy).onClick(() => { this.createFromButton(); })
          ForEach(this.terminals, (item: TerminalInfo) => {
            Button(item.title)
              .height(38)
              .backgroundColor(this.selected === item.id ? this.palette.primary : this.palette.inputBg)
              .fontColor(this.selected === item.id ? Color.White : this.palette.text)
              .enabled(!this.busy)
              .onClick(() => { if (this.selected !== item.id) { this.attach(item.id); } })
          }, (item: TerminalInfo) => item.id)
          if (this.selected.length > 0) {
            Button(t('关闭终端')).height(38).backgroundColor(this.palette.card).fontColor(this.palette.danger)
              .enabled(!this.busy).onClick(() => { this.closeSelected(); })
          }
        }
        .padding({ left: 12, right: 12, bottom: 8 })
      }
      .width('100%').height(46).align(Alignment.Start).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
      if (this.error.length > 0) {
        Row({ space: 8 }) {
          Text(this.error).fontSize(13).fontColor(this.palette.danger).layoutWeight(1)
          Button(t('重试')).height(32).backgroundColor(this.palette.primary).enabled(this.ready && !this.busy)
            .onClick(() => { this.reload(); })
        }
        .width('100%').padding(10)
      }
      Stack({ alignContent: Alignment.BottomStart }) {
        Web({ src: $rawfile('terminal.html'), controller: this.controller })
          .width('100%').height('100%')
          .javaScriptAccess(true)
          .domStorageAccess(false)
          .fileAccess(false)
          .mixedMode(MixedMode.None)
          .multiWindowAccess(false)
          .javaScriptProxy({
            object: this.bridge, name: 'DshTerminalBridge', methodList: ['postMessage'],
            controller: this.controller
          })
          .onLoadIntercept((event: OnLoadInterceptEvent): boolean => {
            const url = event.data.getRequestUrl();
            return url !== 'resource://rawfile/terminal.html' && url !== 'about:blank';
          })
          .onErrorReceive((event: OnErrorReceiveEvent) => {
            if (event.request.isMainFrame()) {
              this.setError(t('无法加载终端显示'));
            }
          })
          .onRenderExited(() => { this.setError(t('无法加载终端显示')); })
        if (this.status.length > 0) {
          Text(this.status).fontSize(13).fontColor('#D1D9E0').width('100%').padding(10)
            .backgroundColor('#101418')
        }
      }
      .width('100%').layoutWeight(1).backgroundColor('#101418')
      Scroll() {
        Row({ space: 8 }) {
          Button(t('键盘')).height(38).backgroundColor(this.palette.card).fontColor(this.palette.text)
            .enabled(this.writable).onClick(() => { this.send({ 'type': 'focus' }); })
          this.TerminalKey('Enter', '\r')
          this.TerminalKey('Ctrl+C', '\x03')
          this.TerminalKey('Tab', '\t')
          this.TerminalKey('Esc', '\x1b')
          this.TerminalKey('↑', '\x1b[A')
          this.TerminalKey('↓', '\x1b[B')
          this.TerminalKey('←', '\x1b[D')
          this.TerminalKey('→', '\x1b[C')
          this.TerminalKey('⌫', '\x7f')
        }
        .padding({ left: 12, right: 12 })
      }
      .width('100%').height(50).align(Alignment.Start).scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)
    }
    .width('100%').height('100%').backgroundColor(this.palette.bg)
  }
}
