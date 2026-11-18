import { promptAction } from '@kit.ArkUI';
import { Palette, iconTintFilter } from '../services/Theme';
import { t } from '../services/I18n';
import {
  BotEntry,
  BotModelOption,
  BotRemoteClient,
  BotRoom,
  BotStateSnapshot,
  BotUsageRow,
  BotUsageSummary,
} from '../net/BotClient';
import { asArray, asBool, asNum, asRecord, asStr, jsonStr } from '../protocol/Types';
import { BotAvatar } from './BotAvatar';

class SettingsTabMeta {
  id: string = '';
  label: string = '';
  detail: string = '';

  constructor(id: string, label: string, detail: string) {
    this.id = id;
    this.label = label;
    this.detail = detail;
  }
}

class LocalAgentMeta {
  id: string = '';
  name: string = '';
  cmd: string = '';
  available: boolean = false;
  detail: string = '';

  constructor(id: string, name: string, cmd: string, available: boolean, detail: string) {
    this.id = id;
    this.name = name;
    this.cmd = cmd;
    this.available = available;
    this.detail = detail;
  }
}

class ScheduleItem {
  id: string = '';
  title: string = '';
  cron: string = '';
  prompt: string = '';
  targetId: string = '';
  sessionId: string = '';
  enabled: boolean = true;
}

class KeyValueItem {
  key: string = '';
  label: string = '';
  status: string = '';
  active: boolean = false;
}

function formatCompactTokens(value: number): string {
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
  return String(Math.round(value));
}

@Component
export struct BotSettingsSheet {
  @Prop pal: Palette = new Palette();
  @Prop fontScale: number = 1;
  @Prop state: BotStateSnapshot = new BotStateSnapshot();
  botClient: BotRemoteClient | undefined = undefined;
  initialTab: string = '';
  onClose: () => void = () => {};
  onRefreshState: () => void = () => {};
  onOpenCreate: () => void = () => {};
  onSelectTarget: (targetId: string, kind: string) => void = () => {};

  @State activeTab: string = '';
  @State busy: boolean = false;
  @State providers: KeyValueItem[] = [];
  @State localAgents: LocalAgentMeta[] = [];
  @State schedules: ScheduleItem[] = [];
  @State folders: string[] = [];
  @State usageSummary: BotUsageSummary = new BotUsageSummary();
  @State usageLoading: boolean = false;

  // Schedule create draft
  @State schedTitle: string = '';
  @State schedCron: string = '0 9 * * *';
  @State schedPrompt: string = '';

  aboutToAppear(): void {
    this.activeTab = this.initialTab;
    this.refreshRemotePanels().catch(() => undefined);
  }

  private fs(base: number): number {
    return Math.round(base * this.fontScale);
  }

  private tabs(): SettingsTabMeta[] {
    return [
      new SettingsTabMeta('general', t('通用'), t('默认工作目录、动效与交互偏好')),
      new SettingsTabMeta('models', t('模型'), t('默认模型与模型提供商状态')),
      new SettingsTabMeta('local-agents', t('本地 Agent'), t('本机已安装的编码 Agent 检测')),
      new SettingsTabMeta('bots', t('Bot'), t('成员管理、主 Bot 与角色设定')),
      new SettingsTabMeta('groups', t('群聊'), t('多 Bot 协作群聊与运行控制')),
      new SettingsTabMeta('connectors', t('连接器'), t('外部服务与 MCP 连接器')),
      new SettingsTabMeta('im', t('IM'), t('企微 / 飞书 / 钉钉等消息通道')),
      new SettingsTabMeta('capabilities', t('能力'), t('浏览器、记忆与旁白能力开关')),
      new SettingsTabMeta('browser', t('浏览器'), t('浏览器接管与授权状态')),
      new SettingsTabMeta('computer', t('电脑操控'), t('桌面操控能力与权限状态')),
      new SettingsTabMeta('schedules', t('定时任务'), t('DS-Bot 定时自动化任务')),
      new SettingsTabMeta('usage', t('用量'), t('Token 消耗与模型分布')),
      new SettingsTabMeta('secrets', t('密钥'), t('凭据与环境变量概览')),
    ];
  }

  private tabTitle(id: string): string {
    for (const item of this.tabs()) {
      if (item.id === id) return item.label;
    }
    return t('DS-Bot 设置');
  }

  private async refreshRemotePanels(): Promise<void> {
    if (this.botClient === undefined) return;
    this.usageLoading = true;
    const client = this.botClient;
    try {
      const provRaw = await client.call('providers', {}, 12000).catch(() => undefined);
      if (provRaw !== undefined) {
        const rec = asRecord(provRaw);
        const list = asArray(rec !== undefined ? rec['providers'] : provRaw) ?? [];
        const out: KeyValueItem[] = [];
        for (const row of list) {
          const r = asRecord(row);
          if (r === undefined) continue;
          const item = new KeyValueItem();
          item.key = jsonStr(r, 'id', jsonStr(r, 'name', ''));
          item.label = jsonStr(r, 'name', item.key);
          const ready = asBool(r['configured']) === true || asBool(r['enabled']) === true || asBool(r['connected']) === true;
          item.active = ready;
          item.status = ready ? t('已配置') : t('未配置');
          if (item.label.length > 0) out.push(item);
        }
        this.providers = out;
      }
    } catch {
      // ignore
    }

    try {
      const laRaw = await client.call('local-agents', {}, 12000).catch(() => undefined);
      const laRec = asRecord(laRaw) ?? {};
      const defaults: LocalAgentMeta[] = [
        new LocalAgentMeta('claude', 'Claude Code', 'claude-agent-acp', false, ''),
        new LocalAgentMeta('codex', 'Codex', 'codex', false, ''),
        new LocalAgentMeta('opencode', 'OpenCode', 'opencode', false, ''),
        new LocalAgentMeta('hermes', 'Hermes Agent', 'hermes', false, ''),
        new LocalAgentMeta('cursor', 'Cursor Agent', 'cursor-agent', false, ''),
        new LocalAgentMeta('pi', 'Pi', 'pi-acp', false, ''),
      ];
      const agentsObj = asRecord(laRec['agents']) ?? laRec;
      for (const meta of defaults) {
        const entry = asRecord(agentsObj[meta.id]);
        if (entry !== undefined) {
          meta.available = asBool(entry['available']) === true || asBool(entry['installed']) === true;
          meta.detail = jsonStr(entry, 'version', jsonStr(entry, 'path', ''));
        }
      }
      this.localAgents = defaults;
    } catch {
      // ignore
    }

    try {
      const schedRaw = await client.call('schedules', {}, 12000).catch(() => undefined);
      const sRec = asRecord(schedRaw);
      const sArr = asArray(sRec !== undefined ? (sRec['schedules'] ?? sRec['items']) : schedRaw) ?? [];
      const parsedSched: ScheduleItem[] = [];
      for (const raw of sArr) {
        const r = asRecord(raw);
        if (r === undefined) continue;
        const item = new ScheduleItem();
        item.id = jsonStr(r, 'id', '');
        if (item.id.length === 0) continue;
        item.title = jsonStr(r, 'title', jsonStr(r, 'name', item.id));
        item.cron = jsonStr(r, 'cron', jsonStr(r, 'expression', jsonStr(r, 'schedule', '')));
        item.prompt = jsonStr(r, 'prompt', jsonStr(r, 'text', ''));
        item.sessionId = jsonStr(r, 'sessionId', '');
        item.targetId = jsonStr(r, 'targetId', jsonStr(r, 'botId', ''));
        item.enabled = asBool(r['enabled']) !== false && asBool(r['paused']) !== true;
        parsedSched.push(item);
      }
      this.schedules = parsedSched;
    } catch {
      // ignore
    }

    try {
      const fRaw = await client.call('folders', {}, 10000).catch(() => undefined);
      const fRec = asRecord(fRaw);
      const fArr = asArray(fRec !== undefined ? fRec['folders'] : fRaw) ?? [];
      const outF: string[] = [];
      for (const entry of fArr) {
        const str = asStr(entry);
        if (str !== undefined && str.length > 0) {
          outF.push(str);
        } else {
          const r = asRecord(entry);
          const p = r !== undefined ? jsonStr(r, 'path', '') : '';
          if (p.length > 0) outF.push(p);
        }
      }
      this.folders = outF;
    } catch {
      // ignore
    }

    try {
      this.usageSummary = await client.fetchUsage(this.state.bots);
    } catch {
      // ignore
    }
    this.usageLoading = false;
  }

  private async runOp(action: () => Promise<void>, okText: string): Promise<void> {
    if (this.busy || this.botClient === undefined) return;
    this.busy = true;
    try {
      await action();
      promptAction.showToast({ message: okText });
      this.onRefreshState();
      await this.refreshRemotePanels();
    } catch (e) {
      promptAction.showToast({ message: e instanceof Error ? e.message : t('操作失败') });
    }
    this.busy = false;
  }

  private prefsRecord(): Record<string, Object> {
    return asRecord(this.state.rawState['prefs']) ?? {};
  }

  private currentWorkDir(): string {
    return jsonStr(this.state.rawState, 'workDir', jsonStr(this.prefsRecord(), 'workDir', ''));
  }

  private parseObjectList(raw: Object | undefined, fallbackKeys: string[]): KeyValueItem[] {
    const rec = asRecord(raw);
    const out: KeyValueItem[] = [];
    if (rec !== undefined) {
      for (const fk of fallbackKeys) {
        const arr = asArray(rec[fk]);
        if (arr !== undefined) {
          for (const entry of arr) {
            const r = asRecord(entry);
            if (r === undefined) continue;
            const item = new KeyValueItem();
            item.key = jsonStr(r, 'id', jsonStr(r, 'name', jsonStr(r, 'key', '')));
            item.label = jsonStr(r, 'name', jsonStr(r, 'label', item.key));
            item.active = asBool(r['connected']) === true || asBool(r['enabled']) === true || asBool(r['configured']) === true;
            item.status = jsonStr(r, 'status', item.active ? t('已连接') : t('未配置'));
            if (item.label.length > 0) out.push(item);
          }
          if (out.length > 0) return out;
        }
      }
      for (const k of Object.keys(rec)) {
        const v = rec[k];
        const vr = asRecord(v);
        const item = new KeyValueItem();
        item.key = k;
        item.label = vr !== undefined ? jsonStr(vr, 'name', k) : k;
        item.active = v === true || (vr !== undefined && (asBool(vr['enabled']) === true || asBool(vr['connected']) === true || asBool(vr['configured']) === true));
        item.status = vr !== undefined ? jsonStr(vr, 'status', item.active ? t('已启用') : t('未启用')) : (item.active ? t('已启用') : t('未启用'));
        out.push(item);
      }
      return out;
    }
    const arr = asArray(raw);
    if (arr !== undefined) {
      for (const entry of arr) {
        const r = asRecord(entry);
        if (r === undefined) continue;
        const item = new KeyValueItem();
        item.key = jsonStr(r, 'id', jsonStr(r, 'name', ''));
        item.label = jsonStr(r, 'name', item.key);
        item.active = asBool(r['connected']) === true || asBool(r['enabled']) === true;
        item.status = item.active ? t('已连接') : t('未配置');
        if (item.label.length > 0) out.push(item);
      }
    }
    return out;
  }

  @Builder
  RowCard(title: string, subtitle: string, badge: string, active: boolean, onTap?: () => void) {
    Row({ space: 10 }) {
      Column({ space: 3 }) {
        Text(title)
          .fontSize(this.fs(14))
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal.text)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (subtitle.length > 0) {
          Text(subtitle)
            .fontSize(this.fs(11))
            .fontColor(this.pal.text3)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      if (badge.length > 0) {
        Text(badge)
          .fontSize(this.fs(11))
          .fontColor(active ? '#16A34A' : this.pal.text3)
          .padding({ left: 8, right: 8, top: 3, bottom: 3 })
          .backgroundColor(active ? 'rgba(22, 163, 74, 0.12)' : this.pal.card)
          .borderRadius(999)
      }
    }
    .width('100%')
    .padding(12)
    .backgroundColor(this.pal.card)
    .borderRadius(12)
    .border({ width: 0.5, color: this.pal.border })
    .onClick(() => {
      if (onTap !== undefined) onTap();
    })
  }

  @Builder
  GeneralTab() {
    Column({ space: 10 }) {
      this.RowCard(
        t('默认工作目录'),
        this.currentWorkDir().length > 0 ? this.currentWorkDir() : t('未指定（跟随主机默认目录）'),
        '',
        false
      )
      if (this.folders.length > 0) {
        Text(t('快速切换工作目录'))
          .fontSize(this.fs(12))
          .fontColor(this.pal.text3)
        ForEach(this.folders.slice(0, 6), (folder: string) => {
          this.RowCard(
            folder,
            '',
            folder === this.currentWorkDir() ? t('当前') : t('选用'),
            folder === this.currentWorkDir(),
            () => {
              this.runOp(async () => {
                await this.botClient!.call('set-prefs', { 'workDir': folder }, 10000);
              }, t('已更新默认目录'));
            }
          )
        }, (folder: string) => folder)
      }
      this.RowCard(
        t('思考过程展示'),
        t('在对话流中显示推理过程'),
        asBool(this.prefsRecord()['thinking']) !== false ? t('开启') : t('关闭'),
        asBool(this.prefsRecord()['thinking']) !== false,
        () => {
          const nextVal = asBool(this.prefsRecord()['thinking']) === false;
          this.runOp(async () => {
            await this.botClient!.call('set-prefs', { 'thinking': nextVal }, 10000);
          }, t('已更新'));
        }
      )
      this.RowCard(
        t('回车发送消息'),
        t('外接键盘按 Enter 直接发送'),
        asBool(this.prefsRecord()['enterToSend']) !== false ? t('开启') : t('关闭'),
        asBool(this.prefsRecord()['enterToSend']) !== false,
        () => {
          const nextVal = asBool(this.prefsRecord()['enterToSend']) === false;
          this.runOp(async () => {
            await this.botClient!.call('set-prefs', { 'enterToSend': nextVal }, 10000);
          }, t('已更新'));
        }
      )
    }
    .width('100%')
  }

  @Builder
  ModelsTab() {
    Column({ space: 10 }) {
      Text(t('默认模型'))
        .fontSize(this.fs(12))
        .fontColor(this.pal.text3)
      if (this.state.models.length === 0) {
        this.RowCard(t('当前默认模型'), this.state.defaultModel.length > 0 ? this.state.defaultModel : t('跟随主机'), '', false)
      } else {
        ForEach(this.state.models, (m: BotModelOption) => {
          this.RowCard(
            m.name,
            m.provider.length > 0 ? m.provider + ' · ' + m.id : m.id,
            m.id === this.state.defaultModel ? t('默认') : t('切换'),
            m.id === this.state.defaultModel,
            () => {
              this.runOp(async () => {
                await this.botClient!.call('set-prefs', { 'defaultModel': m.id }, 10000);
              }, t('已切换默认模型'));
            }
          )
        }, (m: BotModelOption) => m.id)
      }

      if (this.providers.length > 0) {
        Text(t('模型提供商'))
          .fontSize(this.fs(12))
          .fontColor(this.pal.text3)
          .margin({ top: 6 })
        ForEach(this.providers, (p: KeyValueItem) => {
          this.RowCard(p.label, p.key, p.status, p.active)
        }, (p: KeyValueItem) => p.key)
      }
    }
    .width('100%')
  }

  @Builder
  LocalAgentsTab() {
    Column({ space: 10 }) {
      ForEach(this.localAgents, (a: LocalAgentMeta) => {
        this.RowCard(
          a.name,
          a.detail.length > 0 ? a.cmd + ' · ' + a.detail : a.cmd,
          a.available ? t('可用') : t('未检测到'),
          a.available
        )
      }, (a: LocalAgentMeta) => a.id)
    }
    .width('100%')
  }

  @Builder
  BotsTab() {
    Column({ space: 10 }) {
      Button(t('+ 新建 Bot'))
        .height(36)
        .width('100%')
        .fontSize(this.fs(13))
        .backgroundColor('#1E6CEB')
        .fontColor('#FFFFFF')
        .borderRadius(10)
        .onClick(() => {
          this.onClose();
          this.onOpenCreate();
        })
      ForEach(this.state.bots, (b: BotEntry) => {
        Row({ space: 10 }) {
          BotAvatar({ bot: b, avatarSize: 34 })
          Column({ space: 2 }) {
            Row({ space: 6 }) {
              Text(b.name)
                .fontSize(this.fs(14))
                .fontWeight(FontWeight.Medium)
                .fontColor(this.pal.text)
              if (b.main) {
                Text(t('主'))
                  .fontSize(this.fs(10))
                  .fontColor('#1E6CEB')
                  .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                  .backgroundColor('rgba(30, 108, 235, 0.12)')
                  .borderRadius(6)
              }
            }
            Text((b.role.length > 0 ? b.role + ' · ' : '') + (b.model.length > 0 ? b.model : this.state.defaultModel))
              .fontSize(this.fs(11))
              .fontColor(this.pal.text3)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)

          Text(t('进入'))
            .fontSize(this.fs(12))
            .fontColor('#1E6CEB')
            .onClick(() => {
              this.onSelectTarget(b.id, 'bot');
              this.onClose();
            })
        }
        .width('100%')
        .padding(10)
        .backgroundColor(this.pal.card)
        .borderRadius(12)
        .border({ width: 0.5, color: this.pal.border })
      }, (b: BotEntry) => b.id)
    }
    .width('100%')
  }

  @Builder
  GroupsTab() {
    Column({ space: 10 }) {
      if (this.state.rooms.length === 0) {
        this.RowCard(t('暂无群聊'), t('可在「新建」中创建多 Bot 协作群聊'), '', false)
      } else {
        ForEach(this.state.rooms, (r: BotRoom) => {
          this.RowCard(
            r.name,
            r.members.length + ' ' + t('位成员') + (r.mode.length > 0 ? ' · ' + r.mode : ''),
            r.paused ? t('已暂停') : t('运行中'),
            !r.paused,
            () => {
              this.onSelectTarget(r.id, 'room');
              this.onClose();
            }
          )
        }, (r: BotRoom) => r.id)
      }
    }
    .width('100%')
  }

  @Builder
  ConnectorsTab() {
    Column({ space: 10 }) {
      if (this.parseObjectList(this.state.rawState['connectors'], ['items', 'connections']).length === 0) {
        this.RowCard(t('MCP 与外部连接器'), t('当前由主机端统一托管连接器配置；已配置连接器会同步显示在此处'), t('主机托管'), true)
      } else {
        ForEach(this.parseObjectList(this.state.rawState['connectors'], ['items', 'connections']), (item: KeyValueItem) => {
          this.RowCard(item.label, item.key, item.status, item.active)
        }, (item: KeyValueItem) => item.key)
      }
    }
    .width('100%')
  }

  @Builder
  ImTab() {
    Column({ space: 10 }) {
      if (this.parseObjectList(this.state.rawState['im'], ['connections', 'channels', 'items']).length === 0) {
        this.RowCard(t('IM 消息通道'), t('尚未在主机端绑定企微、飞书、钉钉或 Telegram 等 IM 通道'), t('未绑定'), false)
      } else {
        ForEach(this.parseObjectList(this.state.rawState['im'], ['connections', 'channels', 'items']), (item: KeyValueItem) => {
          this.RowCard(item.label, item.key, item.status, item.active)
        }, (item: KeyValueItem) => item.key)
      }
    }
    .width('100%')
  }

  @Builder
  CapabilitiesTab() {
    Column({ space: 10 }) {
      this.RowCard(
        t('内置浏览器能力'),
        t('允许 DS-Bot 访问网页与执行浏览器自动化'),
        this.state.browserEnabled ? t('已开启') : t('已关闭'),
        this.state.browserEnabled,
        () => {
          this.runOp(async () => {
            await this.botClient!.call('set-flags', { 'browser': !this.state.browserEnabled }, 10000);
          }, t('已更新'));
        }
      )
      this.RowCard(
        t('长期记忆能力'),
        t('跨会话沉淀用户偏好与项目背景'),
        this.state.memoryEnabled ? t('已开启') : t('已关闭'),
        this.state.memoryEnabled,
        () => {
          this.runOp(async () => {
            await this.botClient!.call('set-flags', { 'memory': !this.state.memoryEnabled }, 10000);
          }, t('已更新'));
        }
      )
      this.RowCard(
        t('旁白 / 追问卡片 (BTW)'),
        t('允许在任务执行期间插入支线追问'),
        this.state.btwSupported ? t('支持') : t('未开启'),
        this.state.btwSupported
      )
    }
    .width('100%')
  }

  @Builder
  BrowserTab() {
    Column({ space: 10 }) {
      this.RowCard(
        t('浏览器通道状态'),
        t('开启后可在会话中直接由 Bot 操作浏览器'),
        this.state.browserEnabled ? t('已开启') : t('未开启'),
        this.state.browserEnabled,
        () => {
          this.runOp(async () => {
            await this.botClient!.call('set-flags', { 'browser': !this.state.browserEnabled }, 10000);
          }, t('已更新'));
        }
      )
      if (this.parseObjectList(this.state.rawState['browserGrants'], ['items', 'grants']).length > 0) {
        ForEach(this.parseObjectList(this.state.rawState['browserGrants'], ['items', 'grants']), (g: KeyValueItem) => {
          this.RowCard(g.label, g.key, g.status, g.active)
        }, (g: KeyValueItem) => g.key)
      }
      Row({ space: 8 }) {
        Button(t('接管浏览器'))
          .layoutWeight(1)
          .height(34)
          .fontSize(this.fs(12))
          .backgroundColor('#1E6CEB')
          .fontColor('#FFFFFF')
          .borderRadius(10)
          .onClick(() => {
            this.runOp(async () => {
              await this.botClient!.call('browser-takeover', {}, 10000);
            }, t('已发送接管指令'));
          })
        Button(t('归还控制权'))
          .layoutWeight(1)
          .height(34)
          .fontSize(this.fs(12))
          .backgroundColor(this.pal.card)
          .fontColor(this.pal.text)
          .border({ width: 0.5, color: this.pal.border })
          .borderRadius(10)
          .onClick(() => {
            this.runOp(async () => {
              await this.botClient!.call('browser-give-back', {}, 10000);
            }, t('已归还'));
          })
        Button(t('停止'))
          .height(34)
          .fontSize(this.fs(12))
          .backgroundColor(this.pal.card)
          .fontColor('#DC2626')
          .border({ width: 0.5, color: this.pal.border })
          .borderRadius(10)
          .onClick(() => {
            this.runOp(async () => {
              await this.botClient!.call('browser-stop', {}, 10000);
            }, t('已停止'));
          })
      }
      .width('100%')
    }
    .width('100%')
  }

  @Builder
  ComputerTab() {
    Column({ space: 10 }) {
      if (this.parseObjectList(this.state.rawState['computer'], ['items', 'permissions']).length === 0) {
        this.RowCard(t('电脑操控能力'), t('屏幕识别与键鼠操控在桌面主机授权后生效，可在对话中直接调用'), t('桌面端授权'), true)
      } else {
        ForEach(this.parseObjectList(this.state.rawState['computer'], ['items', 'permissions']), (item: KeyValueItem) => {
          this.RowCard(item.label, item.key, item.status, item.active)
        }, (item: KeyValueItem) => item.key)
      }
    }
    .width('100%')
  }

  @Builder
  SchedulesTab() {
    Column({ space: 10 }) {
      Column({ space: 8 }) {
        Text(t('新建定时任务'))
          .fontSize(this.fs(12))
          .fontColor(this.pal.text3)
        TextInput({ placeholder: t('任务名称（例如：每日早报）'), text: this.schedTitle })
          .height(36)
          .fontSize(this.fs(13))
          .backgroundColor(this.pal.card)
          .borderRadius(10)
          .onChange((v: string) => { this.schedTitle = v; })
        TextInput({ placeholder: t('Cron 表达式（例如：0 9 * * *）'), text: this.schedCron })
          .height(36)
          .fontSize(this.fs(13))
          .backgroundColor(this.pal.card)
          .borderRadius(10)
          .onChange((v: string) => { this.schedCron = v; })
        TextInput({ placeholder: t('执行指令内容'), text: this.schedPrompt })
          .height(36)
          .fontSize(this.fs(13))
          .backgroundColor(this.pal.card)
          .borderRadius(10)
          .onChange((v: string) => { this.schedPrompt = v; })
        Button(t('创建定时任务'))
          .height(36)
          .width('100%')
          .fontSize(this.fs(13))
          .backgroundColor('#1E6CEB')
          .fontColor('#FFFFFF')
          .borderRadius(10)
          .enabled(this.schedPrompt.trim().length > 0 && !this.busy)
          .onClick(() => {
            const title = this.schedTitle.trim().length > 0 ? this.schedTitle.trim() : t('定时任务');
            const cron = this.schedCron.trim().length > 0 ? this.schedCron.trim() : '0 9 * * *';
            const prompt = this.schedPrompt.trim();
            const sid = this.state.bots.length > 0 ? this.state.bots[0].sessionId : 'chief';
            this.runOp(async () => {
              await this.botClient!.call('schedule-create', {
                'sessionId': sid,
                'title': title,
                'cron': cron,
                'prompt': prompt,
              }, 12000);
              this.schedTitle = '';
              this.schedPrompt = '';
            }, t('已创建定时任务'));
          })
      }
      .width('100%')
      .padding(12)
      .backgroundColor(this.pal.card)
      .borderRadius(12)
      .border({ width: 0.5, color: this.pal.border })

      if (this.schedules.length === 0) {
        this.RowCard(t('暂无定时任务'), t('上方填写 Cron 与指令即可新增'), '', false)
      } else {
        ForEach(this.schedules, (item: ScheduleItem) => {
          Row({ space: 10 }) {
            Column({ space: 2 }) {
              Text(item.title)
                .fontSize(this.fs(14))
                .fontWeight(FontWeight.Medium)
                .fontColor(this.pal.text)
              Text((item.cron.length > 0 ? item.cron + ' · ' : '') + item.prompt)
                .fontSize(this.fs(11))
                .fontColor(this.pal.text3)
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)

            Text(t('删除'))
              .fontSize(this.fs(12))
              .fontColor('#DC2626')
              .onClick(() => {
                this.runOp(async () => {
                  await this.botClient!.call('schedule-delete', {
                    'id': item.id,
                    'sessionId': item.sessionId,
                  }, 10000);
                }, t('已删除'));
              })
          }
          .width('100%')
          .padding(12)
          .backgroundColor(this.pal.card)
          .borderRadius(12)
          .border({ width: 0.5, color: this.pal.border })
        }, (item: ScheduleItem) => item.id)
      }
    }
    .width('100%')
  }

  @Builder
  UsageTab() {
    Column({ space: 10 }) {
      if (this.usageLoading) {
        Text(t('正在统计用量...'))
          .fontSize(this.fs(13))
          .fontColor(this.pal.text3)
      } else {
        this.RowCard(
          t('总 Token 消耗') + '：' + formatCompactTokens(this.usageSummary.totalTokens),
          t('调用次数') + ' ' + this.usageSummary.totalCalls + ' · ' + t('缓存命中率') + ' ' + this.usageSummary.hitRatePct + '%',
          t('输入 ') + formatCompactTokens(this.usageSummary.inputTokens),
          true
        )
        if (this.usageSummary.byOwner.length > 0) {
          Text(t('按 Bot 分布'))
            .fontSize(this.fs(12))
            .fontColor(this.pal.text3)
          ForEach(this.usageSummary.byOwner, (row: BotUsageRow) => {
            this.RowCard(row.label, row.calls + ' ' + t('次调用'), formatCompactTokens(row.tokens) + ' (' + row.sharePct + '%)', false)
          }, (row: BotUsageRow) => 'u-owner-' + row.key)
        }
        if (this.usageSummary.byModel.length > 0) {
          Text(t('按模型分布'))
            .fontSize(this.fs(12))
            .fontColor(this.pal.text3)
          ForEach(this.usageSummary.byModel, (row: BotUsageRow) => {
            this.RowCard(row.label, row.calls + ' ' + t('次调用'), formatCompactTokens(row.tokens) + ' (' + row.sharePct + '%)', false)
          }, (row: BotUsageRow) => 'u-model-' + row.key)
        }
      }
    }
    .width('100%')
  }

  @Builder
  SecretsTab() {
    Column({ space: 10 }) {
      if (this.parseObjectList(this.state.rawState['secrets'], ['items', 'keys']).length === 0) {
        this.RowCard(t('密钥与凭据'), t('密钥由桌面端安全存储，移动端仅展示脱敏状态'), t('受保护'), true)
      } else {
        ForEach(this.parseObjectList(this.state.rawState['secrets'], ['items', 'keys']), (item: KeyValueItem) => {
          this.RowCard(item.label, item.key, t('已配置'), true)
        }, (item: KeyValueItem) => item.key)
      }
    }
    .width('100%')
  }

  build() {
    Column() {
      Blank()
        .onClick(() => { this.onClose(); })

      Column({ space: 12 }) {
        Row({ space: 8 }) {
          if (this.activeTab.length > 0) {
            Text('←')
              .fontSize(this.fs(16))
              .fontColor(this.pal.text)
              .padding({ left: 6, right: 6, top: 2, bottom: 2 })
              .onClick(() => { this.activeTab = ''; })
          }
          Text(this.activeTab.length > 0 ? this.tabTitle(this.activeTab) : t('DS-Bot 设置'))
            .fontSize(this.fs(16))
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal.text)
            .layoutWeight(1)
          Text('×')
            .fontSize(this.fs(20))
            .fontColor(this.pal.text3)
            .padding({ left: 8, right: 4, top: 2, bottom: 2 })
            .onClick(() => { this.onClose(); })
        }
        .width('100%')

        Scroll() {
          Column({ space: 8 }) {
            if (this.activeTab.length === 0) {
              ForEach(this.tabs(), (item: SettingsTabMeta) => {
                Row({ space: 10 }) {
                  Column({ space: 2 }) {
                    Text(item.label)
                      .fontSize(this.fs(14))
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.pal.text)
                    Text(item.detail)
                      .fontSize(this.fs(11))
                      .fontColor(this.pal.text3)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                  .layoutWeight(1)
                  .alignItems(HorizontalAlign.Start)

                  Text('›')
                    .fontSize(this.fs(18))
                    .fontColor(this.pal.text3)
                }
                .width('100%')
                .padding(12)
                .backgroundColor(this.pal.card)
                .borderRadius(12)
                .border({ width: 0.5, color: this.pal.border })
                .onClick(() => {
                  this.activeTab = item.id;
                  if (item.id === 'usage' || item.id === 'models' || item.id === 'local-agents' || item.id === 'schedules') {
                    this.refreshRemotePanels().catch(() => undefined);
                  }
                })
              }, (item: SettingsTabMeta) => item.id)
            } else if (this.activeTab === 'general') {
              this.GeneralTab()
            } else if (this.activeTab === 'models') {
              this.ModelsTab()
            } else if (this.activeTab === 'local-agents') {
              this.LocalAgentsTab()
            } else if (this.activeTab === 'bots') {
              this.BotsTab()
            } else if (this.activeTab === 'groups') {
              this.GroupsTab()
            } else if (this.activeTab === 'connectors') {
              this.ConnectorsTab()
            } else if (this.activeTab === 'im') {
              this.ImTab()
            } else if (this.activeTab === 'capabilities') {
              this.CapabilitiesTab()
            } else if (this.activeTab === 'browser') {
              this.BrowserTab()
            } else if (this.activeTab === 'computer') {
              this.ComputerTab()
            } else if (this.activeTab === 'schedules') {
              this.SchedulesTab()
            } else if (this.activeTab === 'usage') {
              this.UsageTab()
            } else if (this.activeTab === 'secrets') {
              this.SecretsTab()
            }
          }
          .width('100%')
        }
        .constraintSize({ maxHeight: 520 })
      }
      .width('92%')
      .padding(16)
      .backgroundColor(this.pal.panel)
      .borderRadius(18)
      .border({ width: 1, color: this.pal.borderStrong })

      Blank()
        .onClick(() => { this.onClose(); })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.pal.backdrop)
    .justifyContent(FlexAlign.Center)
  }
}
