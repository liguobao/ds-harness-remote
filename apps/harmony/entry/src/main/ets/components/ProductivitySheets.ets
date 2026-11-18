import { promptAction } from '@kit.ArkUI';
import { Palette } from '../services/Theme';
import { t } from '../services/I18n';
import {
  BackgroundJob, PluginBundleInfo, PluginEntryInfo, SessionToolsClient,
  SettingsNamespaceInfo, SettingsPathOp, parseBackgroundJob
} from '../net/SessionToolsClient';
import { HarnessRemoteSession } from '../net/HarnessClient';
import { RemoteGatewayStream, StreamHandler } from '../net/RemoteGateway';
import { asArray, asRecord, jsonNum, jsonStr } from '../protocol/Types';

export class TodoEntry {
  content: string = '';
  status: string = 'pending'; // 'pending' | 'in_progress' | 'completed'
}

export class QueueEntry {
  id: string = '';
  text: string = '';
}

/**
 * Activity dock sheet: Todos checklist, Background Jobs (+ follow log & kill),
 * Subagent child conversations, and Pending prompt queue (steer / remove).
 */
@Component
export struct ActivityDockSheet {
  tools: SessionToolsClient | undefined = undefined;
  sessionId: string = '';
  todos: TodoEntry[] = [];
  subagents: HarnessRemoteSession[] = [];
  queueItems: QueueEntry[] = [];
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();
  onClose: () => void = () => {};
  onOpenSession: (sessionId: string) => void = () => {};

  @State activeTab: string = 'jobs'; // 'jobs' | 'todos' | 'subagents' | 'queue'
  @State jobs: BackgroundJob[] = [];
  @State selectedJobId: string = '';
  @State jobOutputText: string = '';
  @State errorMsg: string = '';
  private jobsStream: RemoteGatewayStream | undefined = undefined;
  private jobFollowStream: RemoteGatewayStream | undefined = undefined;

  aboutToAppear(): void {
    if (this.todos.length > 0) this.activeTab = 'todos';
    this.startWatchingJobs();
  }

  aboutToDisappear(): void {
    this.stopStreams();
  }

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private stopStreams(): void {
    if (this.jobFollowStream !== undefined) {
      this.jobFollowStream.close(true);
      this.jobFollowStream = undefined;
    }
    if (this.jobsStream !== undefined) {
      this.jobsStream.close(true);
      this.jobsStream = undefined;
    }
  }

  private async startWatchingJobs(): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) return;
    const handler = new StreamHandler();
    handler.onFrame = (raw: Object) => {
      const direct = asArray(raw);
      const rec = asRecord(raw);
      const rows: Object[] = direct ?? (rec !== undefined ? (asArray(rec['items']) ?? asArray(rec['jobs']) ?? []) : []);
      const next: BackgroundJob[] = [];
      for (const item of rows) {
        const parsed = parseBackgroundJob(item);
        if (parsed !== undefined) next.push(parsed);
      }
      if (next.length > 0 || direct !== undefined || rec !== undefined) {
        this.jobs = next;
      }
    };
    try {
      this.jobsStream = await this.tools.watchJobs(this.sessionId, handler);
    } catch {
      // Optional on older hosts.
    }
  }

  private async followOneJob(jobId: string): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) return;
    if (this.jobFollowStream !== undefined) {
      this.jobFollowStream.close(true);
      this.jobFollowStream = undefined;
    }
    this.selectedJobId = jobId;
    this.jobOutputText = '';
    const handler = new StreamHandler();
    handler.onFrame = (raw: Object) => {
      const rec = asRecord(raw);
      if (rec !== undefined) {
        const chunk = jsonStr(rec, 'data', jsonStr(rec, 'text', jsonStr(rec, 'output', '')));
        if (chunk.length > 0) {
          this.jobOutputText = this.jobOutputText + chunk;
        }
      } else if (typeof raw === 'string') {
        this.jobOutputText = this.jobOutputText + raw;
      }
    };
    try {
      this.jobFollowStream = await this.tools.followJob(this.sessionId, jobId, handler, 0);
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
  }

  private async killJob(jobId: string): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) return;
    try {
      await this.tools.killJob(this.sessionId, jobId);
      promptAction.showToast({ message: t('已请求停止任务') });
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
  }

  private async updateQueue(itemId: string, kind: string): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) return;
    try {
      await this.tools.sessionUpdateQueue(this.sessionId, itemId, kind);
      promptAction.showToast({ message: t('已更新队列') });
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
  }

  @Builder
  TabChip(key: string, label: string, count: number) {
    Text(label + (count > 0 ? ` (${count})` : ''))
      .fontSize(this.fs(11))
      .fontColor(this.activeTab === key ? '#0B1220' : this.pal.text2)
      .padding({ left: 10, right: 10, top: 6, bottom: 6 })
      .backgroundColor(this.activeTab === key ? '#22D3EE' : this.pal.chip)
      .borderRadius(9)
      .onClick(() => {
        this.activeTab = key;
      })
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal.backdrop)
        .onClick(() => {
          this.stopStreams();
          this.onClose();
        })

      Column({ space: 10 }) {
        Row({ space: 8 }) {
          Text(t('会话活动'))
            .fontSize(this.fs(16))
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal.text)
            .layoutWeight(1)
          Text('✕')
            .fontSize(this.fs(14))
            .fontColor(this.pal.text3)
            .padding(6)
            .onClick(() => {
              this.stopStreams();
              this.onClose();
            })
        }
        .width('100%')

        Scroll() {
          Row({ space: 6 }) {
            this.TabChip('jobs', t('后台任务'), this.jobs.length)
            this.TabChip('todos', t('待办清单'), this.todos.length)
            this.TabChip('subagents', t('子智能体'), this.subagents.length)
            this.TabChip('queue', t('排队消息'), this.queueItems.length)
          }
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')

        if (this.errorMsg.length > 0) {
          Text(this.errorMsg).fontSize(this.fs(11)).fontColor('#F85749').width('100%')
        }

        Scroll() {
          Column({ space: 8 }) {
            if (this.activeTab === 'jobs') {
              if (this.jobs.length === 0) {
                Text(t('暂无后台任务')).fontSize(this.fs(12)).fontColor(this.pal.text3).padding(12)
              }
              ForEach(this.jobs, (job: BackgroundJob) => {
                Column({ space: 6 }) {
                  Row({ space: 8 }) {
                    Text(job.label)
                      .fontSize(this.fs(13))
                      .fontColor(this.pal.text)
                      .layoutWeight(1)
                      .maxLines(1)
                    Text(job.status)
                      .fontSize(this.fs(11))
                      .fontColor(job.status === 'running' ? '#22D3EE' : this.pal.text3)
                  }
                  .width('100%')
                  Row({ space: 8 }) {
                    Text(t('查看输出'))
                      .fontSize(this.fs(11))
                      .fontColor('#22D3EE')
                      .onClick(() => { this.followOneJob(job.id); })
                    if (job.status === 'running') {
                      Text(t('停止'))
                        .fontSize(this.fs(11))
                        .fontColor('#F85749')
                        .onClick(() => { this.killJob(job.id); })
                    }
                  }
                  if (this.selectedJobId === job.id) {
                    Text(this.jobOutputText.length > 0 ? this.jobOutputText : t('等待输出…'))
                      .fontSize(this.fs(11))
                      .fontFamily('monospace')
                      .fontColor('#E6EDF3')
                      .width('100%')
                      .padding(8)
                      .backgroundColor('#0D1117')
                      .borderRadius(8)
                  }
                }
                .width('100%')
                .padding(10)
                .backgroundColor(this.pal.card)
                .borderRadius(10)
              }, (job: BackgroundJob) => job.id)
            } else if (this.activeTab === 'todos') {
              if (this.todos.length === 0) {
                Text(t('暂无待办事项')).fontSize(this.fs(12)).fontColor(this.pal.text3).padding(12)
              }
              ForEach(this.todos, (todo: TodoEntry, idx: number) => {
                Row({ space: 8 }) {
                  Text(todo.status === 'completed' ? '✓' : (todo.status === 'in_progress' ? '▶' : '○'))
                    .fontSize(this.fs(13))
                    .fontColor(todo.status === 'completed' ? '#34D399'
                      : (todo.status === 'in_progress' ? '#22D3EE' : this.pal.text3))
                  Text(todo.content)
                    .fontSize(this.fs(13))
                    .fontColor(this.pal.text)
                    .layoutWeight(1)
                }
                .width('100%')
                .padding(10)
                .backgroundColor(this.pal.card)
                .borderRadius(10)
              }, (todo: TodoEntry, idx: number) => idx + ':' + todo.content)
            } else if (this.activeTab === 'subagents') {
              if (this.subagents.length === 0) {
                Text(t('暂无子智能体')).fontSize(this.fs(12)).fontColor(this.pal.text3).padding(12)
              }
              ForEach(this.subagents, (sub: HarnessRemoteSession) => {
                Row({ space: 8 }) {
                  Text(sub.title.length > 0 ? sub.title : sub.sessionId)
                    .fontSize(this.fs(13))
                    .fontColor(this.pal.text)
                    .layoutWeight(1)
                    .maxLines(1)
                  Text(sub.running ? t('运行中') : t('查看'))
                    .fontSize(this.fs(11))
                    .fontColor('#22D3EE')
                }
                .width('100%')
                .padding(10)
                .backgroundColor(this.pal.card)
                .borderRadius(10)
                .onClick(() => {
                  this.stopStreams();
                  this.onOpenSession(sub.sessionId);
                  this.onClose();
                })
              }, (sub: HarnessRemoteSession) => sub.sessionId)
            } else {
              if (this.queueItems.length === 0) {
                Text(t('暂无排队消息')).fontSize(this.fs(12)).fontColor(this.pal.text3).padding(12)
              }
              ForEach(this.queueItems, (q: QueueEntry) => {
                Row({ space: 8 }) {
                  Text(q.text)
                    .fontSize(this.fs(12))
                    .fontColor(this.pal.text)
                    .layoutWeight(1)
                    .maxLines(2)
                  Text(t('插话'))
                    .fontSize(this.fs(11))
                    .fontColor('#22D3EE')
                    .onClick(() => { this.updateQueue(q.id, 'steer'); })
                  Text(t('移除'))
                    .fontSize(this.fs(11))
                    .fontColor('#F85749')
                    .onClick(() => { this.updateQueue(q.id, 'remove'); })
                }
                .width('100%')
                .padding(10)
                .backgroundColor(this.pal.card)
                .borderRadius(10)
              }, (q: QueueEntry) => q.id)
            }
          }
          .width('100%')
        }
        .layoutWeight(1)
        .width('100%')
      }
      .width('100%')
      .height('72%')
      .constraintSize({ maxWidth: 640 })
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal.panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal.borderStrong })
    }
    .width('100%')
    .height('100%')
  }
}

/**
 * Host Plugins & Settings Sheet: lists bundles & plugin entries with toggle switches,
 * plus Host settings namespaces.
 */
@Component
export struct PluginsAndSettingsSheet {
  tools: SessionToolsClient | undefined = undefined;
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();
  onClose: () => void = () => {};

  @State tab: string = 'plugins'; // 'plugins' | 'settings'
  @State bundles: PluginBundleInfo[] = [];
  @State plugins: PluginEntryInfo[] = [];
  @State namespaces: SettingsNamespaceInfo[] = [];
  @State writable: boolean = true;
  @State loading: boolean = false;
  @State errorMsg: string = '';

  aboutToAppear(): void {
    this.refreshAll();
  }

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private async refreshAll(): Promise<void> {
    if (this.tools === undefined) return;
    this.loading = true;
    this.errorMsg = '';
    try {
      const results = await Promise.all([
        this.tools.pluginListBundles().catch(() => [] as PluginBundleInfo[]),
        this.tools.pluginListPlugins().catch(() => [] as PluginEntryInfo[]),
        this.tools.settingsDescribe().catch(() => undefined)
      ]);
      this.bundles = results[0] as PluginBundleInfo[];
      this.plugins = results[1] as PluginEntryInfo[];
      const desc = results[2];
      if (desc !== undefined) {
        this.writable = desc.writable;
        this.namespaces = desc.namespaces;
      }
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
    this.loading = false;
  }

  private async togglePlugin(isBundle: boolean, target: string, nextVal: boolean): Promise<void> {
    if (this.tools === undefined) return;
    try {
      await this.tools.pluginSetEnabled(isBundle, target, nextVal);
      promptAction.showToast({ message: t('已更新插件状态') });
      await this.refreshAll();
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
  }

  private async toggleBoolSetting(ns: SettingsNamespaceInfo, key: string, curVal: boolean): Promise<void> {
    if (this.tools === undefined || !this.writable) return;
    const op = new SettingsPathOp();
    op.op = 'set';
    op.path = key;
    op.value = (!curVal) as Object;
    try {
      await this.tools.settingsMutate(ns.ns, [op], ns.revision);
      promptAction.showToast({ message: t('已保存主机设置') });
      await this.refreshAll();
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal.backdrop)
        .onClick(() => {
          this.onClose();
        })

      Column({ space: 10 }) {
        Row({ space: 8 }) {
          Text(t('插件与主机设置'))
            .fontSize(this.fs(16))
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal.text)
            .layoutWeight(1)
          Text(t('刷新'))
            .fontSize(this.fs(12))
            .fontColor('#22D3EE')
            .onClick(() => { this.refreshAll(); })
          Text('✕')
            .fontSize(this.fs(14))
            .fontColor(this.pal.text3)
            .padding(6)
            .onClick(() => { this.onClose(); })
        }
        .width('100%')

        Row({ space: 8 }) {
          Text(t('扩展插件'))
            .fontSize(this.fs(12))
            .fontColor(this.tab === 'plugins' ? '#0B1220' : this.pal.text2)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor(this.tab === 'plugins' ? '#22D3EE' : this.pal.chip)
            .borderRadius(9)
            .onClick(() => { this.tab = 'plugins'; })
          Text(t('主机配置'))
            .fontSize(this.fs(12))
            .fontColor(this.tab === 'settings' ? '#0B1220' : this.pal.text2)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor(this.tab === 'settings' ? '#22D3EE' : this.pal.chip)
            .borderRadius(9)
            .onClick(() => { this.tab = 'settings'; })
        }
        .width('100%')

        if (this.errorMsg.length > 0) {
          Text(this.errorMsg).fontSize(this.fs(11)).fontColor('#F85749').width('100%')
        }

        Scroll() {
          Column({ space: 8 }) {
            if (this.loading) {
              Row({ space: 8 }) {
                LoadingProgress().width(16).height(16).color('#22D3EE')
                Text(t('加载中…')).fontSize(this.fs(12)).fontColor(this.pal.text2)
              }
            } else if (this.tab === 'plugins') {
              ForEach(this.bundles, (b: PluginBundleInfo) => {
                Row({ space: 10 }) {
                  Column({ space: 2 }) {
                    Text(b.name + (b.version.length > 0 ? ' · ' + b.version : ''))
                      .fontSize(this.fs(13))
                      .fontColor(this.pal.text)
                    if (b.description.length > 0) {
                      Text(b.description).fontSize(this.fs(11)).fontColor(this.pal.text3).maxLines(2)
                    }
                  }
                  .layoutWeight(1)
                  .alignItems(HorizontalAlign.Start)
                  Toggle({ type: ToggleType.Switch, isOn: b.enabled })
                    .onChange((isOn: boolean) => {
                      if (isOn !== b.enabled) {
                        this.togglePlugin(true, b.name, isOn);
                      }
                    })
                }
                .width('100%')
                .padding(10)
                .backgroundColor(this.pal.card)
                .borderRadius(10)
              }, (b: PluginBundleInfo) => 'b:' + b.name + ':' + b.enabled)

              ForEach(this.plugins, (p: PluginEntryInfo) => {
                Row({ space: 10 }) {
                  Column({ space: 2 }) {
                    Text(p.name)
                      .fontSize(this.fs(13))
                      .fontColor(this.pal.text)
                    if (p.description.length > 0) {
                      Text(p.description).fontSize(this.fs(11)).fontColor(this.pal.text3).maxLines(2)
                    }
                  }
                  .layoutWeight(1)
                  .alignItems(HorizontalAlign.Start)
                  Toggle({ type: ToggleType.Switch, isOn: p.enabled })
                    .onChange((isOn: boolean) => {
                      if (isOn !== p.enabled) {
                        this.togglePlugin(false, p.id, isOn);
                      }
                    })
                }
                .width('100%')
                .padding(10)
                .backgroundColor(this.pal.card)
                .borderRadius(10)
              }, (p: PluginEntryInfo) => 'p:' + p.id + ':' + p.enabled)
            } else {
              ForEach(this.namespaces, (ns: SettingsNamespaceInfo) => {
                Column({ space: 6 }) {
                  Text(ns.ns + ' · rev ' + ns.revision)
                    .fontSize(this.fs(12))
                    .fontWeight(FontWeight.Medium)
                    .fontColor('#22D3EE')
                  ForEach(Object.keys(ns.value), (key: string) => {
                    Row({ space: 8 }) {
                      Text(key)
                        .fontSize(this.fs(12))
                        .fontColor(this.pal.text2)
                        .layoutWeight(1)
                      if (typeof ns.value[key] === 'boolean') {
                        Toggle({ type: ToggleType.Switch, isOn: ns.value[key] === true })
                          .enabled(this.writable)
                          .onChange((isOn: boolean) => {
                            if (isOn !== (ns.value[key] === true)) {
                              this.toggleBoolSetting(ns, key, ns.value[key] === true);
                            }
                          })
                      } else {
                        Text(String(ns.value[key]))
                          .fontSize(this.fs(11))
                          .fontColor(this.pal.text3)
                          .maxLines(1)
                      }
                    }
                    .width('100%')
                  }, (key: string) => ns.ns + '.' + key + ':' + ns.revision)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
                .padding(10)
                .backgroundColor(this.pal.card)
                .borderRadius(10)
              }, (ns: SettingsNamespaceInfo) => ns.ns + ':' + ns.revision)
            }
          }
          .width('100%')
        }
        .layoutWeight(1)
        .width('100%')
      }
      .width('100%')
      .height('74%')
      .constraintSize({ maxWidth: 640 })
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal.panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal.borderStrong })
    }
    .width('100%')
    .height('100%')
  }
}
