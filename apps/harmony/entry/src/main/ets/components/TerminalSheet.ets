import { Palette } from '../services/Theme';
import { t } from '../services/I18n';
import { SessionToolsClient, TerminalInfo, parseTerminalInfo } from '../net/SessionToolsClient';
import { RemoteGatewayStream, StreamHandler } from '../net/RemoteGateway';
import { TerminalScreenBuffer, TerminalSpecialKey, specialKeysBar } from '../services/TerminalAnsi';
import { randomId } from '../crypto/Bytes';
import { asRecord, jsonStr } from '../protocol/Types';

@Component
export struct TerminalSheet {
  tools: SessionToolsClient | undefined = undefined;
  sessionId: string = '';
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();
  onClose: () => void = () => {};

  @State terminals: TerminalInfo[] = [];
  @State activeId: string = '';
  @State screenText: string = '';
  @State writable: boolean = false;
  @State statusLabel: string = '';
  @State commandInput: string = '';
  @State errorMsg: string = '';
  @State busy: boolean = false;

  private buffer: TerminalScreenBuffer = new TerminalScreenBuffer(600);
  private attachmentId: string = '';
  private retentionStream: RemoteGatewayStream | undefined = undefined;
  private followStream: RemoteGatewayStream | undefined = undefined;
  private outputScroller: Scroller = new Scroller();

  aboutToAppear(): void {
    this.initTerminals();
  }

  aboutToDisappear(): void {
    this.detachStreams();
  }

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private detachStreams(): void {
    if (this.followStream !== undefined) {
      this.followStream.close(true);
      this.followStream = undefined;
    }
    if (this.retentionStream !== undefined) {
      this.retentionStream.close(true);
      this.retentionStream = undefined;
    }
    this.writable = false;
  }

  private async initTerminals(): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) {
      return;
    }
    this.busy = true;
    this.errorMsg = '';
    try {
      await this.tools.terminalEnvironment(this.sessionId).catch(() => undefined);
      const list = await this.tools.listTerminals(this.sessionId);
      this.terminals = list;
      if (list.length > 0) {
        await this.attachTerminal(list[0].id);
      } else {
        await this.createNewTerminal();
      }
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
    this.busy = false;
  }

  private async createNewTerminal(): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) {
      return;
    }
    this.busy = true;
    this.errorMsg = '';
    try {
      const id = randomId();
      const created = await this.tools.createTerminal(this.sessionId, id, 80, 28);
      this.terminals = this.terminals.concat([created]);
      await this.attachTerminal(created.id);
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
    this.busy = false;
  }

  private async attachTerminal(terminalId: string): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) {
      return;
    }
    this.detachStreams();
    this.activeId = terminalId;
    this.attachmentId = randomId();
    this.buffer.reset('');
    this.screenText = '';
    this.statusLabel = t('正在连接终端…');

    const retainHandler = new StreamHandler();
    let followOpened = false;
    retainHandler.onFrame = (_val: Object) => {
      if (!followOpened) {
        followOpened = true;
        this.openFollowStream(terminalId);
      }
    };
    retainHandler.onClosed = () => {
      this.writable = false;
    };
    this.retentionStream = await this.tools.retainTerminal(this.sessionId, terminalId, retainHandler);
  }

  private async openFollowStream(terminalId: string): Promise<void> {
    if (this.tools === undefined || this.activeId !== terminalId) {
      return;
    }
    const handler = new StreamHandler();
    handler.onFrame = (raw: Object) => {
      const rec = asRecord(raw);
      if (rec === undefined) return;
      const type = jsonStr(rec, 'type', '');
      if (type === 'snapshot') {
        this.buffer.reset(jsonStr(rec, 'screen', ''));
        this.screenText = this.buffer.text();
        this.applyInfoState(rec['info']);
        this.scrollOutputBottom();
      } else if (type === 'output') {
        this.buffer.append(jsonStr(rec, 'data', ''));
        this.screenText = this.buffer.text();
        this.scrollOutputBottom();
      } else if (type === 'state') {
        this.applyInfoState(rec['info']);
      }
    };
    handler.onClosed = () => {
      this.writable = false;
      this.statusLabel = t('终端流已断开');
    };
    try {
      this.followStream = await this.tools.followTerminal(this.sessionId, terminalId, this.attachmentId, handler);
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
  }

  private applyInfoState(rawInfo: Object | undefined): void {
    const info = parseTerminalInfo(rawInfo);
    if (info === undefined) return;
    this.writable = info.state === 'running' && info.controllerId === this.attachmentId;
    if (info.state === 'running') {
      this.statusLabel = (info.shellName.length > 0 ? info.shellName + ' · ' : '')
        + (this.writable ? t('可输入') : t('只读观察'));
    } else {
      this.statusLabel = t('已退出') + (info.hasExitCode ? ` (${info.exitCode})` : '');
    }
  }

  private scrollOutputBottom(): void {
    setTimeout(() => {
      this.outputScroller.scrollEdge(Edge.Bottom);
    }, 30);
  }

  private sendRaw(data: string): void {
    if (this.tools === undefined || this.activeId.length === 0 || !this.writable || data.length === 0) {
      return;
    }
    this.tools.writeTerminal(this.sessionId, this.activeId, this.attachmentId, data).catch((error: Error) => {
      this.errorMsg = error.message;
    });
  }

  private sendLine(): void {
    const line = this.commandInput;
    this.commandInput = '';
    this.sendRaw(line + '\r');
  }

  private async closeTab(id: string): Promise<void> {
    if (this.tools === undefined) return;
    if (this.activeId === id) {
      this.detachStreams();
    }
    await this.tools.closeTerminal(this.sessionId, id).catch(() => undefined);
    const next = this.terminals.filter((item: TerminalInfo) => item.id !== id);
    this.terminals = next;
    if (this.activeId === id) {
      if (next.length > 0) {
        await this.attachTerminal(next[0].id);
      } else {
        this.activeId = '';
        this.screenText = '';
      }
    }
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal.backdrop)
        .onClick(() => {
          this.detachStreams();
          this.onClose();
        })

      Column({ space: 8 }) {
        Row({ space: 8 }) {
          Text(t('远程终端'))
            .fontSize(this.fs(15))
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal.text)
          if (this.statusLabel.length > 0) {
            Text(this.statusLabel)
              .fontSize(this.fs(11))
              .fontColor(this.writable ? '#34D399' : this.pal.text3)
              .layoutWeight(1)
              .maxLines(1)
          } else {
            Blank()
          }
          Text('+ ' + t('新建'))
            .fontSize(this.fs(12))
            .fontColor('#22D3EE')
            .padding({ left: 8, right: 8, top: 4, bottom: 4 })
            .backgroundColor('rgba(34,211,238,0.12)')
            .borderRadius(8)
            .onClick(() => {
              this.createNewTerminal();
            })
          Text('✕')
            .fontSize(this.fs(14))
            .fontColor(this.pal.text3)
            .padding({ left: 6, right: 4 })
            .onClick(() => {
              this.detachStreams();
              this.onClose();
            })
        }
        .width('100%')

        if (this.terminals.length > 0) {
          Scroll() {
            Row({ space: 6 }) {
              ForEach(this.terminals, (term: TerminalInfo, idx: number) => {
                Row({ space: 6 }) {
                  Text(term.shellName.length > 0 ? term.shellName : ('sh #' + (idx + 1)))
                    .fontSize(this.fs(11))
                    .fontColor(term.id === this.activeId ? '#22D3EE' : this.pal.text2)
                  Text('✕')
                    .fontSize(this.fs(10))
                    .fontColor(this.pal.text3)
                    .onClick(() => {
                      this.closeTab(term.id);
                    })
                }
                .padding({ left: 9, right: 7, top: 4, bottom: 4 })
                .backgroundColor(term.id === this.activeId ? 'rgba(34,211,238,0.12)' : this.pal.chip)
                .borderRadius(8)
                .border({ width: 0.5, color: term.id === this.activeId ? '#22D3EE' : this.pal.border })
                .onClick(() => {
                  if (term.id !== this.activeId) {
                    this.attachTerminal(term.id);
                  }
                })
              }, (term: TerminalInfo) => term.id)
            }
          }
          .scrollable(ScrollDirection.Horizontal)
          .scrollBar(BarState.Off)
          .width('100%')
        }

        if (this.errorMsg.length > 0) {
          Text(this.errorMsg)
            .fontSize(this.fs(11))
            .fontColor('#F85749')
            .width('100%')
        }

        Scroll(this.outputScroller) {
          Text(this.screenText.length > 0 ? this.screenText : (this.busy ? t('正在启动终端…') : '$ '))
            .fontSize(this.fs(12))
            .fontFamily('monospace')
            .fontColor('#E6EDF3')
            .width('100%')
            .textAlign(TextAlign.Start)
            .copyOption(CopyOptions.LocalDevice)
            .padding(10)
        }
        .layoutWeight(1)
        .width('100%')
        .backgroundColor('#0D1117')
        .borderRadius(10)
        .border({ width: 0.5, color: '#273041' })

        Scroll() {
          Row({ space: 6 }) {
            ForEach(specialKeysBar(), (key: TerminalSpecialKey) => {
              Text(key.label)
                .fontSize(this.fs(11))
                .fontFamily('monospace')
                .fontColor(this.pal.text)
                .padding({ left: 8, right: 8, top: 5, bottom: 5 })
                .backgroundColor(this.pal.chip)
                .borderRadius(7)
                .border({ width: 0.5, color: this.pal.border })
                .onClick(() => {
                  this.sendRaw(key.seq);
                })
            }, (key: TerminalSpecialKey) => key.label)
          }
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')

        Row({ space: 8 }) {
          TextInput({ text: this.commandInput, placeholder: t('输入命令后发送…') })
            .layoutWeight(1)
            .height(40)
            .fontSize(this.fs(13))
            .fontFamily('monospace')
            .fontColor(this.pal.text)
            .placeholderColor(this.pal.text3)
            .backgroundColor(this.pal.inputBg)
            .borderRadius(10)
            .onChange((v: string) => {
              this.commandInput = v;
            })
            .onSubmit(() => {
              this.sendLine();
            })
          Button(t('执行'))
            .height(40)
            .fontSize(this.fs(13))
            .backgroundColor('#22D3EE')
            .fontColor('#0B1220')
            .borderRadius(10)
            .enabled(this.writable)
            .onClick(() => {
              this.sendLine();
            })
        }
        .width('100%')
      }
      .width('100%')
      .height('80%')
      .constraintSize({ maxWidth: 720 })
      .padding({ left: 14, right: 14, top: 14, bottom: 18 })
      .backgroundColor(this.pal.panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal.borderStrong })
    }
    .width('100%')
    .height('100%')
  }
}
