import { promptAction } from '@kit.ArkUI';
import { pasteboard } from '@kit.BasicServicesKit';
import { Palette, iconTintFilter } from '../services/Theme';
import { t } from '../services/I18n';
import {
  BotBtwCard, BotEntry, BotPendingApproval, BotPendingQuestion, BotPendingView,
  BotQuestionOption, BotRemoteClient, BotRoom, BotStateSnapshot, BotUsageRow, BotUsageSummary
} from '../net/BotClient';
import { ChatItem } from '../services/AppRuntime';
import { BotInteractiveViewCard } from './IntelligentUiCard';
import { BotAvatar } from './BotAvatar';
import { BotSettingsSheet } from './BotSettingsSheet';
import { RichCodeBlockCard, RichMathBlockCard, RichTableBlockCard } from './RichMessageView';
import { RichBlock, parseRichBlocks } from '../util/MentionAndQuote';

/**
 * Native HarmonyOS DS-Bot team workspace:
 * - Multi-bot & group-room switcher
 * - Live Bot DM & Room conversation with /btw asides and @Bot mentions
 * - Inline Questions, Approvals & BotInteractiveViewCard replies
 * - Bot/Room creator & Usage/Prefs manager via plugin.route.call ('api/bot')
 */
@Component
export struct BotModeView {
  botClient: BotRemoteClient | undefined = undefined;
  readState: () => BotStateSnapshot = () => new BotStateSnapshot();
  @Prop @Watch('onStateVersionChange') stateVersion: number = 0;
  @Prop selectedTargetId: string = '';
  @Prop @Watch('onCreateRequest') createRequestVersion: number = 0;
  @Prop messages: ChatItem[] = [];
  @Prop generating: boolean = false;
  @Prop loading: boolean = false;
  @Prop errorMsg: string = '';
  @Prop fontScale: number = 1;
  @Prop dark: boolean = false;
  pal: Palette = new Palette();

  onSwitchAgentMode: () => void = () => {};
  onOpenDrawer: () => void = () => {};
  onCreateRequestHandled: () => void = () => {};
  onSelectTarget: (targetId: string, sessionId: string) => void = () => {};
  onRefreshState: () => void = () => {};
  onSendMessage: (targetId: string, text: string) => Promise<void> = async () => {};
  onStopBot: (targetId: string, sessionId: string) => Promise<void> = async () => {};
  onCreateBotPart: (botId: string) => Promise<void> = async () => {};

  @State state: BotStateSnapshot = new BotStateSnapshot();

  aboutToAppear(): void {
    this.state = this.readState();
    if (this.createRequestVersion > 0) this.onCreateRequest();
  }

  onStateVersionChange(): void {
    this.state = this.readState();
  }

  @State draft: string = '';
  @State sending: boolean = false;
  @State modalTargetId: string = '';
  @State menuOpen: boolean = false;
  @State subModal: string = ''; // '' | 'create' | 'usage'
  @State createKind: string = 'bot'; // 'bot' | 'room'
  @State formName: string = '';
  @State formRole: string = '';
  @State formInstructions: string = '';
  @State formModel: string = '';
  @State formRoomMembers: string[] = [];
  @State formRoomNotice: string = '';
  @State busyAction: boolean = false;
  @State usageSummary: BotUsageSummary = new BotUsageSummary();
  @State usageLoading: boolean = false;
  @State mentionQuery: string = '';
  @State showMentions: boolean = false;
  @State selectedQuestionOpts: string[] = [];
  @State customQuestionText: string = '';

  private scroller: Scroller = new Scroller();

  onCreateRequest(): void {
    if (this.createRequestVersion <= 0) return;
    this.onCreateRequestHandled();
    this.formName = '';
    this.formRole = '';
    this.formInstructions = '';
    this.formRoomNotice = '';
    this.formRoomMembers = [];
    this.createKind = 'bot';
    this.subModal = 'create';
  }

  private async sendDraft(): Promise<void> {
    const msg = this.draft.trim();
    const original = this.draft;
    const target = this.selectedTargetId;
    if (this.sending || msg.length === 0 || target.length === 0 || this.botClient === undefined ||
      this.state.readOnlyReason.length > 0) return;
    this.sending = true;
    try {
      await this.onSendMessage(target, msg);
      if (this.selectedTargetId === target && this.draft === original) {
        this.draft = '';
        this.showMentions = false;
      }
    } catch (e) {
      promptAction.showToast({ message: e instanceof Error ? e.message : t('发送失败') });
    }
    this.sending = false;
  }

  private openEdit(): void {
    const bot = this.selectedBot();
    const room = this.selectedRoom();
    if (bot === undefined && room === undefined) return;
    this.modalTargetId = this.selectedTargetId;
    this.createKind = bot !== undefined ? 'bot' : 'room';
    this.formName = bot?.name ?? room?.name ?? '';
    this.formRole = bot?.role ?? '';
    this.formInstructions = bot?.instructions ?? '';
    this.formRoomNotice = room?.notice ?? '';
    this.formRoomMembers = room?.members.slice() ?? [];
    this.subModal = 'edit';
  }

  private mainBotCount(): number {
    let count = 0;
    for (const bot of this.state.bots) {
      if (bot.main) count++;
    }
    return count;
  }

  private canDeleteSelected(): boolean {
    const bot = this.selectedBot();
    if (this.selectedRoom() !== undefined) return true;
    if (bot === undefined) return false;
    if (!bot.main) return true;
    let mains = 0;
    for (const b of this.state.bots) {
      if (b.main) mains++;
      if (b.id !== bot.id && !b.isPrivate) return true;
    }
    return mains > 1;
  }


  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private selectedBot(): BotEntry | undefined {
    for (const b of this.state.bots) {
      if (b.id === this.selectedTargetId) return b;
    }
    return undefined;
  }

  private selectedRoom(): BotRoom | undefined {
    for (const r of this.state.rooms) {
      if (r.id === this.selectedTargetId) return r;
    }
    return undefined;
  }

  private activeSessionId(): string {
    const b = this.selectedBot();
    if (b !== undefined) return b.sessionId;
    const r = this.selectedRoom();
    if (r !== undefined) return r.sessionId;
    return '';
  }

  private isSelectedBusy(): boolean {
    return this.state.busyBotIds.includes(this.selectedTargetId)
      || this.state.busyRoomIds.includes(this.selectedTargetId)
      || this.generating;
  }

  private matchingMentions(): BotEntry[] {
    if (!this.showMentions) return [];
    const q = this.mentionQuery.toLowerCase();
    const out: BotEntry[] = [];
    for (const b of this.state.bots) {
      if (b.hidden || b.id === this.selectedTargetId) continue;
      if (q.length === 0 || b.name.toLowerCase().includes(q) || b.role.toLowerCase().includes(q)) {
        out.push(b);
      }
      if (out.length >= 6) break;
    }
    return out;
  }

  private matchingBtwCards(): BotBtwCard[] {
    const out: BotBtwCard[] = [];
    for (const c of this.state.btwCards) {
      if (c.botId === this.selectedTargetId || c.botId.length === 0) {
        out.push(c);
      }
    }
    return out;
  }

  private matchingQuestions(): BotPendingQuestion[] {
    const sid = this.activeSessionId();
    const out: BotPendingQuestion[] = [];
    for (const q of this.state.pendingQuestions) {
      if (q.sessionId === this.selectedTargetId || (sid.length > 0 && q.sessionId === sid)) {
        out.push(q);
      }
    }
    return out;
  }

  private matchingViews(): BotPendingView[] {
    const sid = this.activeSessionId();
    const out: BotPendingView[] = [];
    for (const v of this.state.pendingViews) {
      if (v.sessionId === this.selectedTargetId || (sid.length > 0 && v.sessionId === sid)) {
        out.push(v);
      }
    }
    return out;
  }

  private matchingApprovals(): BotPendingApproval[] {
    const sid = this.activeSessionId();
    const out: BotPendingApproval[] = [];
    for (const a of this.state.approvals) {
      if (a.sessionId.length === 0 || a.sessionId === this.selectedTargetId || (sid.length > 0 && a.sessionId === sid)) {
        out.push(a);
      }
    }
    return out;
  }

  private updateDraftAndMentions(val: string): void {
    this.draft = val;
    const atPos = val.lastIndexOf('@');
    if (atPos >= 0) {
      const tail = val.slice(atPos + 1);
      if (!tail.includes(' ') && !tail.includes('\n')) {
        this.mentionQuery = tail;
        this.showMentions = true;
        return;
      }
    }
    this.showMentions = false;
    this.mentionQuery = '';
  }

  private insertBotMention(botName: string): void {
    const atPos = this.draft.lastIndexOf('@');
    const prefix = atPos >= 0 ? this.draft.slice(0, atPos) : this.draft;
    this.draft = prefix + '@' + botName + ' ';
    this.showMentions = false;
    this.mentionQuery = '';
  }

  private async openUsageModal(): Promise<void> {
    this.subModal = 'usage';
    if (this.botClient === undefined) return;
    this.usageLoading = true;
    try {
      this.usageSummary = await this.botClient.fetchUsage(this.state.bots);
    } catch (e) {
      promptAction.showToast({ message: e instanceof Error ? e.message : t('获取用量失败') });
    }
    this.usageLoading = false;
  }

  private async runBotOp(fn: () => Promise<void>, successToast: string): Promise<void> {
    if (this.busyAction) return;
    this.busyAction = true;
    try {
      await fn();
      promptAction.showToast({ message: successToast });
      this.onRefreshState();
    } catch (e) {
      promptAction.showToast({ message: e instanceof Error ? e.message : t('操作失败') });
    }
    this.busyAction = false;
  }

  @Builder
  BotMenuItem(label: string, action: () => void) {
    Text(label)
      .fontSize(this.fs(14))
      .fontColor(this.pal.text)
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })
      .onClick(() => {
        this.menuOpen = false;
        action();
      })
  }

  build() {
    Stack() {
      Column({ space: 0 }) {
        // 1. Android-style top bar: ☰ | [avatar + name + badge] | ⋯
        Row({ space: 10 }) {
          Row() {
            Image($r('app.media.ic_menu'))
              .width(20)
              .height(20)
              .colorFilter(iconTintFilter(this.pal.text))
          }
          .width(40)
          .height(40)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(this.pal.card)
          .borderRadius(20)
          .border({ width: 0.5, color: this.pal.border })
          .onClick(() => {
            this.onOpenDrawer();
          })

          Row({ space: 8 }) {
            if (this.selectedBot() !== undefined) {
              BotAvatar({ bot: this.selectedBot()!, avatarSize: 26, dark: this.dark })
            } else {
              Stack() {
                Circle({ width: 26, height: 26 }).fill('#7A5AF8')
                Text((this.selectedRoom()?.name ?? 'D').slice(0, 1).toUpperCase())
                  .fontSize(this.fs(12)).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
              }
            }
            Text(this.selectedBot()?.name ?? this.selectedRoom()?.name ?? 'DS-Bot')
              .fontSize(this.fs(15))
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal.text)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .constraintSize({ maxWidth: 170 })
            if (this.selectedBot() !== undefined && this.selectedBot()!.engine.length > 0) {
              Text(this.selectedBot()!.engine)
                .fontSize(this.fs(10))
                .fontColor('#4D6BFE')
                .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                .backgroundColor('rgba(77,107,254,0.12)')
                .borderRadius(8)
            }
          }
          .padding({ left: 8, right: 14, top: 7, bottom: 7 })
          .backgroundColor(this.pal.card)
          .borderRadius(20)
          .border({ width: 0.5, color: this.pal.border })
          .layoutWeight(1)
          .justifyContent(FlexAlign.Center)

          Row() {
            Image($r('app.media.ic_lucide_more_h'))
              .width(20)
              .height(20)
              .colorFilter(iconTintFilter(this.pal.text))
          }
          .width(40)
          .height(40)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(this.pal.card)
          .borderRadius(20)
          .border({ width: 0.5, color: this.pal.border })
          .onClick(() => {
            this.menuOpen = !this.menuOpen;
          })
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 10, bottom: 8 })
        .alignItems(VerticalAlign.Center)
        .border({ width: { bottom: 0.5 }, color: this.pal.border })


        if (this.errorMsg.length > 0) {
          Text(this.errorMsg)
            .fontSize(this.fs(12))
            .fontColor('#F87171')
            .padding({ left: 14, right: 14, top: 6, bottom: 6 })
            .width('100%')
            .backgroundColor('rgba(248,113,113,0.12)')
        }

        // 3. Conversation + /btw + pending Views/Questions/Approvals
        List({ scroller: this.scroller, space: 10 }) {
          if (this.messages.length === 0 && !this.loading) {
            ListItem() {
              Column({ space: 6 }) {
                Text(this.state.bots.length === 0 && this.state.rooms.length === 0
                  ? t('主机暂未配置 Bot 团队')
                  : t('开始和当前 Bot 或群聊对话'))
                  .fontSize(this.fs(14))
                  .fontColor(this.pal.text2)
                if (this.state.btwSupported && this.selectedBot() !== undefined) {
                  Text(t('提示：输入 /btw 问题 可发起不打扰主线的旁白提问'))
                    .fontSize(this.fs(12))
                    .fontColor(this.pal.text3)
                }
              }
              .width('100%')
              .padding({ top: 48, bottom: 24 })
              .alignItems(HorizontalAlign.Center)
            }
          }

          ForEach(this.messages, (msg: ChatItem) => {
            ListItem() {
              Column({ space: 4 }) {
                if (msg.kind === 'user') {
                  Row() {
                    Blank()
                    Text(msg.text)
                      .fontSize(this.fs(14))
                      .fontColor(this.pal.text)
                      .padding({ left: 14, right: 14, top: 10, bottom: 10 })
                      .backgroundColor(this.pal.userBubble)
                      .borderRadius({ topLeft: 18, topRight: 6, bottomLeft: 18, bottomRight: 18 })
                      .constraintSize({ maxWidth: '86%' })
                  }
                  .width('100%')
                } else if (msg.kind === 'tool') {
                  Row({ space: 6 }) {
                    Text(msg.toolState === 'running' ? '⏳' : (msg.toolState === 'failed' ? '⚠️' : '✓'))
                      .fontSize(this.fs(11))
                    Text(msg.toolName + (msg.summary.length > 0 ? ' · ' + msg.summary : ''))
                      .fontSize(this.fs(12))
                      .fontColor(this.pal.text3)
                      .maxLines(2)
                  }
                  .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                  .backgroundColor(this.pal.chip)
                  .borderRadius(10)
                } else {
                  Column({ space: 6 }) {
                    if (msg.reasoning.length > 0) {
                      Text(msg.reasoning)
                        .fontSize(this.fs(12))
                        .fontColor(this.pal.text3)
                        .maxLines(4)
                    }
                    if (msg.text.length > 0) {
                      ForEach(parseRichBlocks(msg.text), (blk: RichBlock, idx: number) => {
                        if (blk.kind === 'code' || blk.kind === 'mermaid') {
                          RichCodeBlockCard({ blk: blk, dark: this.dark, fontScale: this.fontScale, pal: this.pal })
                        } else if (blk.kind === 'math') {
                          RichMathBlockCard({ blk: blk, dark: this.dark, fontScale: this.fontScale, pal: this.pal })
                        } else if (blk.kind === 'table') {
                          RichTableBlockCard({ blk: blk, dark: this.dark, fontScale: this.fontScale, pal: this.pal })
                        } else {
                          Text(blk.text)
                            .fontSize(this.fs(14))
                            .fontColor(this.pal.text)
                            .lineHeight(this.fs(21))
                            .copyOption(CopyOptions.LocalDevice)
                        }
                      }, (blk: RichBlock, idx: number) => 'bb:' + idx + ':' + blk.kind + ':' + blk.text.length)
                    } else if (msg.streaming) {
                      Text('…')
                        .fontSize(this.fs(14))
                        .fontColor(this.pal.text)
                    }
                  }
                  .width('100%')
                  .padding(12)
                  .backgroundColor(this.pal.card)
                  .borderRadius(14)
                  .border({ width: 0.5, color: this.pal.border })
                  .alignItems(HorizontalAlign.Start)
                }
              }
              .width('100%')
            }
          }, (msg: ChatItem) => msg.id + ':' + msg.rev)

          ForEach(this.matchingBtwCards(), (card: BotBtwCard) => {
            ListItem() {
              Column({ space: 6 }) {
                Row({ space: 6 }) {
                  Text('/btw')
                    .fontSize(this.fs(11))
                    .fontWeight(FontWeight.Medium)
                    .fontColor('#A78BFA')
                    .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                    .backgroundColor('rgba(167,139,250,0.16)')
                    .borderRadius(6)
                  Text(card.question)
                    .fontSize(this.fs(13))
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.pal.text)
                    .layoutWeight(1)
                  if (card.status === 'answering') {
                    Text(t('取消'))
                      .fontSize(this.fs(11))
                      .fontColor('#F5A623')
                      .onClick(() => {
                        if (this.botClient !== undefined) {
                          this.runBotOp(() => this.botClient!.cancelBtw(card.botId, card.id), t('已取消'));
                        }
                      })
                  } else {
                    Image($r('app.media.ic_lucide_close'))
                      .width(16)
                      .height(16)
                      .colorFilter(iconTintFilter(this.pal.text3))
                      .onClick(() => {
                        if (this.botClient !== undefined) {
                          this.runBotOp(() => this.botClient!.deleteBtw(card.botId, card.id), t('已移除'));
                        }
                      })
                  }
                }
                .width('100%')
                if (card.answer.length > 0) {
                  Text(card.answer)
                    .fontSize(this.fs(13))
                    .fontColor(this.pal.text2)
                    .lineHeight(this.fs(19))
                } else {
                  Text(t('正在生成旁白回复…'))
                    .fontSize(this.fs(12))
                    .fontColor(this.pal.text3)
                }
              }
              .width('100%')
              .padding(12)
              .backgroundColor(this.pal.card)
              .borderRadius(12)
              .border({ width: 0.8, color: 'rgba(167,139,250,0.35)' })
              .alignItems(HorizontalAlign.Start)
            }
          }, (card: BotBtwCard) => 'btw:' + card.id + ':' + card.answer.length)

          ForEach(this.matchingApprovals(), (ap: BotPendingApproval) => {
            ListItem() {
              Column({ space: 6 }) {
                Text(t('权限确认') + ' · ' + ap.toolName)
                  .fontSize(this.fs(13))
                  .fontWeight(FontWeight.Medium)
                  .fontColor('#F5A623')
                if (ap.reason.length > 0) {
                  Text(ap.reason).fontSize(this.fs(12)).fontColor(this.pal.text2)
                }
                Row({ space: 8 }) {
                  Text(t('拒绝'))
                    .fontSize(this.fs(12))
                    .fontColor(this.pal.text)
                    .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                    .backgroundColor(this.pal.chip)
                    .borderRadius(9)
                    .onClick(() => {
                      if (this.botClient !== undefined) {
                        this.runBotOp(() => this.botClient!.answerApproval(ap.id, false), t('已拒绝'));
                      }
                    })
                  Text(t('允许'))
                    .fontSize(this.fs(12))
                    .fontColor('#FFFFFF')
                    .padding({ left: 14, right: 14, top: 6, bottom: 6 })
                    .backgroundColor('#1E6CEB')
                    .borderRadius(9)
                    .onClick(() => {
                      if (this.botClient !== undefined) {
                        this.runBotOp(() => this.botClient!.answerApproval(ap.id, true), t('已允许'));
                      }
                    })
                }
              }
              .width('100%')
              .padding(12)
              .backgroundColor(this.pal.card)
              .borderRadius(12)
              .border({ width: 0.8, color: 'rgba(245,166,35,0.45)' })
              .alignItems(HorizontalAlign.Start)
            }
          }, (ap: BotPendingApproval) => 'ap:' + ap.id)

          ForEach(this.matchingQuestions(), (q: BotPendingQuestion) => {
            ListItem() {
              Column({ space: 8 }) {
                Row() {
                  Text(q.question.length > 0 ? q.question : q.header)
                    .fontSize(this.fs(13))
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.pal.text)
                    .layoutWeight(1)
                  Image($r('app.media.ic_lucide_close'))
                    .width(16)
                    .height(16)
                    .colorFilter(iconTintFilter(this.pal.text3))
                    .onClick(() => {
                      if (this.botClient !== undefined) {
                        this.runBotOp(() => this.botClient!.dismissQuestion(q.sessionId), t('已关闭'));
                      }
                    })
                }
                .width('100%')
                if (q.options.length > 0) {
                  ForEach(q.options, (opt: BotQuestionOption, idx: number) => {
                    Text(opt.label)
                      .fontSize(this.fs(12))
                      .fontColor(this.selectedQuestionOpts.includes(opt.label) ? '#22D3EE' : this.pal.text)
                      .padding({ left: 10, right: 10, top: 7, bottom: 7 })
                      .width('100%')
                      .backgroundColor(this.selectedQuestionOpts.includes(opt.label)
                        ? 'rgba(34,211,238,0.16)' : this.pal.chip)
                      .borderRadius(9)
                      .onClick(() => {
                        if (q.multiSelect) {
                          this.selectedQuestionOpts = this.selectedQuestionOpts.includes(opt.label)
                            ? this.selectedQuestionOpts.filter((s: string) => s !== opt.label)
                            : this.selectedQuestionOpts.concat([opt.label]);
                        } else if (this.botClient !== undefined) {
                          this.runBotOp(() => this.botClient!.answerQuestion(q.sessionId, [opt.label], ''), t('已回答'));
                        }
                      })
                  }, (opt: BotQuestionOption, idx: number) => 'qo:' + idx + ':' + opt.label)
                  if (q.multiSelect) {
                    Text(t('提交'))
                      .fontSize(this.fs(12))
                      .fontColor('#FFFFFF')
                      .padding({ left: 14, right: 14, top: 7, bottom: 7 })
                      .backgroundColor('#1E6CEB')
                      .borderRadius(9)
                      .onClick(() => {
                        if (this.botClient !== undefined && this.selectedQuestionOpts.length > 0) {
                          const picked = this.selectedQuestionOpts.slice();
                          this.selectedQuestionOpts = [];
                          this.runBotOp(() => this.botClient!.answerQuestion(q.sessionId, picked, ''), t('已回答'));
                        }
                      })
                  }
                } else {
                  Row({ space: 6 }) {
                    TextInput({ text: this.customQuestionText, placeholder: t('输入你的回答…') })
                      .layoutWeight(1)
                      .height(36)
                      .fontSize(this.fs(12))
                      .backgroundColor(this.pal.inputBg)
                      .fontColor(this.pal.text)
                      .borderRadius(8)
                      .onChange((v: string) => {
                        this.customQuestionText = v;
                      })
                    Text(t('发送'))
                      .fontSize(this.fs(12))
                      .fontColor('#FFFFFF')
                      .padding({ left: 12, right: 12, top: 8, bottom: 8 })
                      .backgroundColor('#1E6CEB')
                      .borderRadius(8)
                      .onClick(() => {
                        if (this.botClient !== undefined && this.customQuestionText.trim().length > 0) {
                          const txt = this.customQuestionText.trim();
                          this.customQuestionText = '';
                          this.runBotOp(() => this.botClient!.answerQuestion(q.sessionId, [], txt), t('已回答'));
                        }
                      })
                  }
                  .width('100%')
                }
              }
              .width('100%')
              .padding(12)
              .backgroundColor(this.pal.card)
              .borderRadius(12)
              .border({ width: 0.8, color: 'rgba(34,211,238,0.4)' })
              .alignItems(HorizontalAlign.Start)
            }
          }, (q: BotPendingQuestion) => 'bq:' + q.id)

          ForEach(this.matchingViews(), (v: BotPendingView) => {
            ListItem() {
              BotInteractiveViewCard({
                viewId: v.id,
                title: v.title,
                rawView: v.rawView,
                busy: this.busyAction,
                fontScale: this.fontScale,
                pal: this.pal,
                onReply: (action: string, values: Record<string, Object>) => {
                  if (this.botClient !== undefined) {
                    this.runBotOp(() => this.botClient!.replyView(v.sessionId, v.id, action, values), t('已提交'));
                  }
                },
                onDismiss: () => {
                  if (this.botClient !== undefined) {
                    this.runBotOp(() => this.botClient!.dismissView(v.sessionId, v.id), t('已关闭'));
                  }
                }
              })
            }
          }, (v: BotPendingView) => 'bv:' + v.id)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 14, right: 14, top: 10, bottom: 10 })

        // 4. @ Mention autocomplete popover
        if (this.showMentions && this.matchingMentions().length > 0) {
          Column({ space: 4 }) {
            ForEach(this.matchingMentions(), (b: BotEntry) => {
              Row({ space: 8 }) {
                Text('@' + b.name)
                  .fontSize(this.fs(12))
                  .fontWeight(FontWeight.Medium)
                  .fontColor('#22D3EE')
                Text(b.role)
                  .fontSize(this.fs(11))
                  .fontColor(this.pal.text3)
                  .layoutWeight(1)
                  .maxLines(1)
              }
              .width('100%')
              .padding({ left: 10, right: 10, top: 6, bottom: 6 })
              .backgroundColor(this.pal.chip)
              .borderRadius(8)
              .onClick(() => {
                this.insertBotMention(b.name);
              })
            }, (b: BotEntry) => 'bm:' + b.id)
          }
          .width('100%')
          .padding({ left: 14, right: 14, top: 6, bottom: 4 })
          .backgroundColor(this.pal.panel)
          .border({ width: { top: 0.5 }, color: this.pal.border })
        }

        // 5. Composer bar
        Column({ space: 6 }) {
          if (this.selectedTargetId.length > 0) {
            Row({ space: 8 }) {
              if (this.state.btwSupported && this.selectedBot() !== undefined) {
              Text('/btw')
                .fontSize(this.fs(11))
                .fontColor(this.draft.startsWith('/btw ') ? '#A78BFA' : this.pal.text2)
                .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                .backgroundColor(this.draft.startsWith('/btw ') ? 'rgba(167,139,250,0.18)' : this.pal.chip)
                .borderRadius(8)
                .onClick(() => {
                  if (!this.draft.startsWith('/btw ')) {
                    this.draft = '/btw ' + this.draft;
                  }
                })
              }
              Text('@' + t('提及队友'))
                .fontSize(this.fs(11))
                .fontColor(this.pal.text2)
                .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                .backgroundColor(this.pal.chip)
                .borderRadius(8)
                .onClick(() => {
                  this.updateDraftAndMentions(this.draft + '@');
                })
              Blank()
              if (this.isSelectedBusy() && this.botClient !== undefined && (this.selectedRoom() !== undefined || this.selectedBot() !== undefined)) {
                Text('■ ' + t('停止'))
                  .fontSize(this.fs(11))
                  .fontColor('#F87171')
                  .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                  .backgroundColor('rgba(248,113,113,0.14)')
                  .borderRadius(8)
                  .onClick(() => {
                    this.runBotOp(
                      async () => {
                        if (this.selectedRoom() !== undefined) {
                          await this.botClient!.call('stop-room-work', { 'roomId': this.selectedTargetId }, 10000);
                        } else {
                          await this.onStopBot(this.selectedTargetId, this.activeSessionId());
                        }
                      },
                      t('已停止')
                    );
                  })
              }
            }
            .width('100%')
          }

          Row({ space: 8 }) {
            TextArea({
              text: this.draft,
              placeholder: this.selectedBot() !== undefined
                ? t('给 ') + this.selectedBot()!.name + t(' 发消息（支持 /btw 和 @）…')
                : t('在群聊发消息，输入 @ 选择 Bot…')
            })
              .layoutWeight(1)
              .constraintSize({ minHeight: 44, maxHeight: 120 })
              .fontSize(this.fs(14))
              .backgroundColor(this.pal.inputBg)
              .fontColor(this.pal.text)
              .placeholderColor(this.pal.text3)
              .borderRadius(14)
              .border({ width: 0.8, color: this.pal.border })
              .onChange((v: string) => {
                this.updateDraftAndMentions(v);
              })

            Text(t('发送'))
              .fontSize(this.fs(13))
              .fontWeight(FontWeight.Medium)
              .fontColor('#FFFFFF')
              .padding({ left: 14, right: 14, top: 10, bottom: 10 })
              .backgroundColor(this.draft.trim().length > 0 && this.selectedTargetId.length > 0 &&
                this.botClient !== undefined && !this.sending && this.state.readOnlyReason.length === 0 ? '#1E6CEB' : this.pal.text3)
              .borderRadius(14)
              .onClick(() => {
                this.sendDraft();
              })
          }
          .width('100%')
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 8, bottom: 12 })
        .backgroundColor(this.pal.panel)
        .border({ width: { top: 0.5 }, color: this.pal.border })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pal.bg)

      if (this.menuOpen) {
        Stack({ alignContent: Alignment.TopEnd }) {
          Column() {}.width('100%').height('100%').onClick(() => { this.menuOpen = false; })
          Scroll() {
          Column() {
            if (this.selectedBot() !== undefined || this.selectedRoom() !== undefined) {
              this.BotMenuItem(t('详情'), () => {
                this.modalTargetId = this.selectedTargetId;
                this.subModal = 'details';
              })
              this.BotMenuItem(t('复制 ID'), () => {
                const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.selectedTargetId);
                pasteboard.getSystemPasteboard().setData(data).then(() => {
                  promptAction.showToast({ message: t('已复制') });
                }).catch(() => { promptAction.showToast({ message: t('复制失败') }); });
              })
              if (this.botClient !== undefined && this.state.readOnlyReason.length === 0) {
                this.BotMenuItem(t('编辑'), () => { this.openEdit(); })
                if (this.selectedBot() !== undefined && !this.selectedBot()!.isPrivate &&
                  (!this.selectedBot()!.main || this.mainBotCount() > 1)) {
                  this.BotMenuItem(this.selectedBot()!.main ? t('取消主 Bot') : t('设为主 Bot'), () => {
                    const botId = this.selectedTargetId;
                    const makeMain = !this.selectedBot()!.main;
                    this.runBotOp(async () => {
                      await this.botClient!.call('set-main', { 'id': botId, 'main': makeMain }, 10000);
                    }, t('已更新'));
                  })
                }
                if (this.canDeleteSelected()) {
                  this.BotMenuItem(t('删除'), () => {
                    this.modalTargetId = this.selectedTargetId;
                    this.subModal = 'delete';
                  })
                }
              }
            }
            if (this.selectedBot() !== undefined && this.botClient !== undefined && this.state.readOnlyReason.length === 0) {
              this.BotMenuItem(t('新建会话'), () => {
                const botId = this.selectedTargetId;
                this.runBotOp(async () => {
                  await this.onCreateBotPart(botId);
                }, t('已新建会话'));
              })
            }
            if (this.selectedRoom() !== undefined && this.botClient !== undefined) {
              this.BotMenuItem(t('停止'), () => {
                const roomId = this.selectedTargetId;
                this.runBotOp(async () => {
                  await this.botClient!.call('stop-room-work', { 'roomId': roomId }, 10000);
                }, t('已停止'));
              })
            }
            this.BotMenuItem(t('新建 Bot'), () => {
              this.formName = '';
              this.formRole = '';
              this.formInstructions = '';
              this.formRoomNotice = '';
              this.subModal = 'create';
            })
            this.BotMenuItem(t('刷新'), () => {
              this.onRefreshState();
            })
            this.BotMenuItem(t('用量统计'), () => {
              this.openUsageModal();
            })
            this.BotMenuItem(t('DS-Bot 设置'), () => {
              this.subModal = 'settings';
            })
            this.BotMenuItem(t('Agent 模式'), () => {
              this.onSwitchAgentMode();
            })
          }
          .width('100%')
          }
          .width(210)
          .constraintSize({ maxHeight: 430 })
          .backgroundColor(this.pal.card)
          .borderRadius(14)
          .border({ width: 0.5, color: this.pal.border })
          .shadow({ radius: 12, color: 'rgba(0,0,0,0.12)', offsetY: 4 })
          .margin({ right: 14, top: 60 })
        }
        .width('100%')
        .height('100%')
      }


      // Sub-modals: Create Bot/Room & Usage/Prefs & DS-Bot Settings
      if (this.subModal === 'settings') {
        BotSettingsSheet({
          pal: this.pal,
          fontScale: this.fontScale,
          state: this.state,
          botClient: this.botClient,
          onClose: () => { this.subModal = ''; },
          onRefreshState: () => { this.onRefreshState(); },
          onOpenCreate: () => {
            this.formName = '';
            this.formRole = '';
            this.formInstructions = '';
            this.formRoomNotice = '';
            this.subModal = 'create';
          },
          onSelectTarget: (targetId: string, kind: string) => { this.onSelectTarget(targetId, kind); },
        })
      } else if (this.subModal.length > 0) {
        Column() {
          Blank()
            .onClick(() => {
              this.subModal = '';
            })
          Column({ space: 12 }) {
            if (this.subModal === 'create') {
              this.CreateModalBody()
            } else if (this.subModal === 'usage') {
              this.UsageModalBody()
            } else {
              this.TargetModalBody()
            }
          }
          .width('92%')
          .padding(16)
          .backgroundColor(this.pal.panel)
          .borderRadius(18)
          .border({ width: 1, color: this.pal.borderStrong })
          Blank()
            .onClick(() => {
              this.subModal = '';
            })
        }
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal.backdrop)
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  CreateModalBody() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text(t('新建成员或群聊'))
          .fontSize(this.fs(16))
          .fontWeight(FontWeight.Bold)
          .fontColor(this.pal.text)
          .layoutWeight(1)
        Image($r('app.media.ic_lucide_close'))
          .width(18)
          .height(18)
          .colorFilter(iconTintFilter(this.pal.text3))
          .onClick(() => {
            this.subModal = '';
          })
      }
      .width('100%')

      Row({ space: 8 }) {
        Text(t('新建 Bot'))
          .fontSize(this.fs(12))
          .fontColor(this.createKind === 'bot' ? '#22D3EE' : this.pal.text2)
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.createKind === 'bot' ? 'rgba(34,211,238,0.16)' : this.pal.chip)
          .borderRadius(10)
          .onClick(() => {
            this.createKind = 'bot';
          })
        Text(t('新建群聊'))
          .fontSize(this.fs(12))
          .fontColor(this.createKind === 'room' ? '#22D3EE' : this.pal.text2)
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.createKind === 'room' ? 'rgba(34,211,238,0.16)' : this.pal.chip)
          .borderRadius(10)
          .onClick(() => {
            this.createKind = 'room';
          })
      }

      TextInput({ text: this.formName, placeholder: t('名称') })
        .height(38)
        .fontSize(this.fs(13))
        .backgroundColor(this.pal.inputBg)
        .fontColor(this.pal.text)
        .borderRadius(10)
        .onChange((v: string) => { this.formName = v; })

      if (this.createKind === 'bot') {
        TextInput({ text: this.formRole, placeholder: t('角色定位（如 前端专家）') })
          .height(38)
          .fontSize(this.fs(13))
          .backgroundColor(this.pal.inputBg)
          .fontColor(this.pal.text)
          .borderRadius(10)
          .onChange((v: string) => { this.formRole = v; })
        TextInput({ text: this.formInstructions, placeholder: t('系统提示词（可选）') })
          .height(64)
          .fontSize(this.fs(13))
          .backgroundColor(this.pal.inputBg)
          .fontColor(this.pal.text)
          .borderRadius(10)
          .onChange((v: string) => { this.formInstructions = v; })
      } else {
        Text(t('选择成员'))
          .fontSize(this.fs(12))
          .fontColor(this.pal.text2)
        Row({ space: 6 }) {
          ForEach(this.state.bots, (b: BotEntry) => {
            Text(b.name)
              .fontSize(this.fs(11))
              .fontColor(this.formRoomMembers.includes(b.id) ? '#22D3EE' : this.pal.text2)
              .padding({ left: 8, right: 8, top: 4, bottom: 4 })
              .backgroundColor(this.formRoomMembers.includes(b.id) ? 'rgba(34,211,238,0.18)' : this.pal.chip)
              .borderRadius(8)
              .onClick(() => {
                this.formRoomMembers = this.formRoomMembers.includes(b.id)
                  ? this.formRoomMembers.filter((id: string) => id !== b.id)
                  : this.formRoomMembers.concat([b.id]);
              })
          }, (b: BotEntry) => 'rmsel:' + b.id)
        }
        TextInput({ text: this.formRoomNotice, placeholder: t('群公告 / 协作说明（可选）') })
          .height(38)
          .fontSize(this.fs(13))
          .backgroundColor(this.pal.inputBg)
          .fontColor(this.pal.text)
          .borderRadius(10)
          .onChange((v: string) => { this.formRoomNotice = v; })
      }

      Row({ space: 10 }) {
        if (this.selectedBot() !== undefined && !this.selectedBot()!.main) {
          Text(t('设为主 Bot'))
            .fontSize(this.fs(12))
            .fontColor('#22D3EE')
            .onClick(() => {
              if (this.botClient !== undefined && this.selectedBot() !== undefined) {
                const bid = this.selectedBot()!.id;
                this.subModal = '';
                this.runBotOp(() => this.botClient!.setMainBot(bid), t('已设为主 Bot'));
              }
            })
        }
        Blank()
        Text(t('创建'))
          .fontSize(this.fs(13))
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .padding({ left: 16, right: 16, top: 8, bottom: 8 })
          .backgroundColor(this.formName.trim().length > 0 ? '#1E6CEB' : this.pal.text3)
          .borderRadius(10)
          .onClick(() => {
            if (this.botClient === undefined || this.formName.trim().length === 0) return;
            const n = this.formName.trim();
            if (this.createKind === 'bot') {
              const role = this.formRole.trim();
              const inst = this.formInstructions.trim();
              const model = this.state.defaultModel;
              this.subModal = '';
              this.runBotOp(() => this.botClient!.createBot(n, role, inst, model, ''), t('已创建 Bot'));
            } else {
              const members = this.formRoomMembers.slice();
              const notice = this.formRoomNotice.trim();
              this.subModal = '';
              this.runBotOp(() => this.botClient!.createRoom(n, members, notice), t('已创建群聊'));
            }
          })
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private async saveTargetEdit(): Promise<void> {
    if (this.busyAction || this.botClient === undefined || this.modalTargetId !== this.selectedTargetId ||
      this.state.readOnlyReason.length > 0 || this.formName.trim().length === 0) return;
    const bot = this.selectedBot();
    const room = this.selectedRoom();
    if (bot === undefined && room === undefined) return;
    this.busyAction = true;
    try {
      if (bot !== undefined) {
        await this.botClient.call('update-bot', {
          'id': bot.id, 'name': this.formName.trim(), 'role': this.formRole,
          'instructions': this.formInstructions
        }, 15000);
      } else if (room !== undefined) {
        await this.botClient.call('update-room', {
          'id': room.id, 'name': this.formName.trim(), 'notice': this.formRoomNotice,
          'members': room.members, 'admin': room.admin, 'workDir': room.workDir
        }, 15000);
      }
      this.subModal = '';
      this.onRefreshState();
      promptAction.showToast({ message: t('已保存') });
    } catch (e) {
      promptAction.showToast({ message: e instanceof Error ? e.message : t('操作失败') });
    }
    this.busyAction = false;
  }

  private async deleteTarget(): Promise<void> {
    if (this.busyAction || this.botClient === undefined || this.modalTargetId !== this.selectedTargetId ||
      this.state.readOnlyReason.length > 0 || !this.canDeleteSelected()) return;
    const target = this.modalTargetId;
    const room = this.selectedRoom() !== undefined;
    this.busyAction = true;
    try {
      await this.botClient.call(room ? 'delete-room' : 'delete-bot', { 'id': target }, 12000);
      this.subModal = '';
      this.onRefreshState();
      this.onSelectTarget('', '');
      promptAction.showToast({ message: t('已删除') });
    } catch (e) {
      promptAction.showToast({ message: e instanceof Error ? e.message : t('操作失败') });
    }
    this.busyAction = false;
  }

  @Builder
  TargetModalBody() {
    Column({ space: 10 }) {
      Row() {
        Text(this.subModal === 'details' ? t('详情') : (this.subModal === 'edit' ? t('编辑') : t('确认删除')))
          .fontSize(this.fs(16)).fontWeight(FontWeight.Bold).fontColor(this.pal.text).layoutWeight(1)
        Image($r('app.media.ic_lucide_close')).width(18).height(18)
          .colorFilter(iconTintFilter(this.pal.text3)).onClick(() => { this.subModal = ''; })
      }.width('100%')
      if (this.modalTargetId !== this.selectedTargetId) {
        Text(t('当前会话已切换')).fontSize(this.fs(13)).fontColor(this.pal.text2)
      } else if (this.subModal === 'details') {
        Text(this.selectedBot()?.name ?? this.selectedRoom()?.name ?? '')
          .fontSize(this.fs(15)).fontWeight(FontWeight.Medium).fontColor(this.pal.text)
        Text('ID: ' + this.modalTargetId).fontSize(this.fs(12)).fontColor(this.pal.text2)
        if (this.selectedBot() !== undefined) {
          Text(t('角色') + ': ' + this.selectedBot()!.role).fontSize(this.fs(13)).fontColor(this.pal.text2)
          Text(t('模型') + ': ' + this.selectedBot()!.model).fontSize(this.fs(13)).fontColor(this.pal.text2)
          Text(t('系统提示词') + ': ' + this.selectedBot()!.instructions).fontSize(this.fs(13)).fontColor(this.pal.text2)
        } else if (this.selectedRoom() !== undefined) {
          Text(t('群公告') + ': ' + this.selectedRoom()!.notice).fontSize(this.fs(13)).fontColor(this.pal.text2)
          Text(t('成员') + ': ' + this.selectedRoom()!.members.join(', ')).fontSize(this.fs(13)).fontColor(this.pal.text2)
        }
      } else if (this.subModal === 'edit') {
        TextInput({ text: this.formName, placeholder: t('名称') })
          .height(40).backgroundColor(this.pal.inputBg).fontColor(this.pal.text)
          .onChange((v: string) => { this.formName = v; })
        if (this.createKind === 'bot') {
          TextInput({ text: this.formRole, placeholder: t('角色') })
            .height(40).backgroundColor(this.pal.inputBg).fontColor(this.pal.text)
            .onChange((v: string) => { this.formRole = v; })
          TextArea({ text: this.formInstructions, placeholder: t('系统提示词') })
            .height(90).backgroundColor(this.pal.inputBg).fontColor(this.pal.text)
            .onChange((v: string) => { this.formInstructions = v; })
        } else {
          TextArea({ text: this.formRoomNotice, placeholder: t('群公告') })
            .height(90).backgroundColor(this.pal.inputBg).fontColor(this.pal.text)
            .onChange((v: string) => { this.formRoomNotice = v; })
        }
        Text(t('保存')).fontSize(this.fs(14)).fontColor('#FFFFFF')
          .padding({ left: 16, right: 16, top: 9, bottom: 9 }).backgroundColor('#1E6CEB').borderRadius(10)
          .onClick(() => { this.saveTargetEdit(); })
      } else if (this.subModal === 'delete') {
        Text(t('确认删除') + ' ' + (this.selectedBot()?.name ?? this.selectedRoom()?.name ?? '') + '？')
          .fontSize(this.fs(14)).fontColor(this.pal.text)
        Row({ space: 12 }) {
          Text(t('取消')).fontSize(this.fs(14)).fontColor(this.pal.text2)
            .padding(10).onClick(() => { this.subModal = ''; })
          Text(t('确认删除')).fontSize(this.fs(14)).fontColor('#FFFFFF')
            .padding(10).backgroundColor('#C83D3D').borderRadius(10)
            .onClick(() => { this.deleteTarget(); })
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  UsageModalBody() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text(t('DS-Bot 用量与偏好'))
          .fontSize(this.fs(16))
          .fontWeight(FontWeight.Bold)
          .fontColor(this.pal.text)
          .layoutWeight(1)
        Image($r('app.media.ic_lucide_close'))
          .width(18)
          .height(18)
          .colorFilter(iconTintFilter(this.pal.text3))
          .onClick(() => {
            this.subModal = '';
          })
      }
      .width('100%')

      if (this.usageLoading) {
        Text(t('正在统计用量…')).fontSize(this.fs(12)).fontColor(this.pal.text3)
      } else {
        Row({ space: 12 }) {
          Column({ space: 2 }) {
            Text(t('总 Token')).fontSize(this.fs(11)).fontColor(this.pal.text3)
            Text(String(this.usageSummary.totalTokens))
              .fontSize(this.fs(16)).fontWeight(FontWeight.Bold).fontColor(this.pal.text)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Column({ space: 2 }) {
            Text(t('缓存命中率')).fontSize(this.fs(11)).fontColor(this.pal.text3)
            Text(this.usageSummary.hitRatePct + '%')
              .fontSize(this.fs(16)).fontWeight(FontWeight.Bold).fontColor('#34D399')
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Column({ space: 2 }) {
            Text(t('调用次数')).fontSize(this.fs(11)).fontColor(this.pal.text3)
            Text(String(this.usageSummary.totalCalls))
              .fontSize(this.fs(16)).fontWeight(FontWeight.Bold).fontColor('#22D3EE')
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .padding(10)
        .backgroundColor(this.pal.chip)
        .borderRadius(10)

        ForEach(this.usageSummary.byOwner.slice(0, 5), (row: BotUsageRow) => {
          Column({ space: 3 }) {
            Row() {
              Text(row.label).fontSize(this.fs(12)).fontColor(this.pal.text)
              Blank()
              Text(row.tokens + ' (' + row.sharePct + '%)').fontSize(this.fs(11)).fontColor(this.pal.text3)
            }
            .width('100%')
            Progress({ value: Math.max(0, Math.min(100, row.sharePct)), total: 100, type: ProgressType.Linear })
              .width('100%')
              .color(row.color)
          }
        }, (row: BotUsageRow) => 'uo:' + row.key)
      }

      Row() {
        Text(t('共享浏览器工具'))
          .fontSize(this.fs(13))
          .fontColor(this.pal.text)
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.state.browserEnabled })
          .onChange((isOn: boolean) => {
            if (this.botClient !== undefined) {
              this.runBotOp(() => this.botClient!.setPrefs({ 'browser': isOn }), t('已更新偏好'));
            }
          })
      }
      .width('100%')

      Row() {
        Text(t('长期记忆'))
          .fontSize(this.fs(13))
          .fontColor(this.pal.text)
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.state.memoryEnabled })
          .onChange((isOn: boolean) => {
            if (this.botClient !== undefined) {
              this.runBotOp(() => this.botClient!.setPrefs({ 'memory': isOn }), t('已更新偏好'));
            }
          })
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
