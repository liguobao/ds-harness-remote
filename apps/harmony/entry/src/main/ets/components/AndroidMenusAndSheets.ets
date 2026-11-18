import { HarnessWorkspace } from '../net/HarnessClient';
import { AgentPresetOption } from '../net/SessionToolsClient';
import { Palette, iconTintFilter } from '../services/Theme';
import { t } from '../services/I18n';
import { cwdFolderName } from '../util/WorkspaceGrouping';

function backendMenuTitle(backend: string): string {
  if (backend === 'harness') return 'DeepSeek Harness';
  if (backend === 'codex') return 'Codex';
  if (backend === 'antigravity') return 'Antigravity';
  if (backend === 'opencode') return 'OpenCode';
  if (backend === 'cursor') return 'Cursor';
  if (backend === 'claude') return 'Claude Code';
  if (backend === 'pi') return 'Pi';
  if (backend === 'hermes') return 'Hermes';
  return backend;
}

function backendMenuDesc(backend: string): string {
  if (backend === 'harness') return t('官方 DeepSeek 智能体框架');
  if (backend === 'codex') return t('OpenAI Codex 编程智能体');
  if (backend === 'antigravity') return t('Antigravity 研发框架');
  if (backend === 'opencode') return t('OpenCode 开源智能体');
  if (backend === 'cursor') return t('Cursor 编程智能体');
  if (backend === 'claude') return t('Anthropic Claude Code 智能体');
  if (backend === 'pi') return t('Pi 轻量智能体');
  if (backend === 'hermes') return t('Hermes 智能体');
  return backend;
}

export function backendPillShort(backend: string): string {
  if (backend === 'harness') return 'DeepSeek';
  if (backend === 'codex') return 'Codex';
  if (backend === 'antigravity') return 'Antigravity';
  if (backend === 'opencode') return 'OpenCode';
  if (backend === 'cursor') return 'Cursor';
  if (backend === 'claude') return 'Claude';
  return backend;
}

export function permissionFriendlyLabel(preset: string): string {
  if (preset === 'read-only') return t('只读');
  if (preset === 'workspace-write') return t('工作区可写');
  if (preset === 'danger-full-access') return t('完全权限');
  return preset.length > 0 ? preset : t('默认权限');
}

export function agentPresetFriendlyLabel(id: string, presets: AgentPresetOption[]): string {
  for (const p of presets) {
    if (p.id === id) {
      return p.name.length > 0 ? p.name : p.id;
    }
  }
  if (id === 'standard' || id === 'default' || id.length === 0) {
    return t('标准模式');
  }
  return id;
}

/**
 * 切换 Harness 底部弹窗，对齐 Android 端样式。
 */
@Component
export struct BackendPickerSheet {
  @Prop availableBackends: string[] = ['harness'];
  @Prop selectedBackend: string = 'harness';
  @Prop fontScale: number = 1;
  @Prop pal: Palette = new Palette();
  onSelect: (backend: string) => void = () => {};
  onClose: () => void = () => {};

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
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
      Column({ space: 14 }) {
        Row() {
          Text(t('切换 Harness'))
            .fontSize(this.fs(18))
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal.text)
            .layoutWeight(1)
          Row() {
            Image($r('app.media.ic_lucide_close'))
              .width(19)
              .height(19)
              .colorFilter(iconTintFilter(this.pal.text2))
          }
          .width(34)
          .height(34)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            this.onClose();
          })
        }
        .width('100%')

        Column() {
          ForEach(this.availableBackends, (bk: string, idx: number) => {
            Column() {
              if (idx > 0) {
                Column()
                  .width('100%')
                  .height(0.5)
                  .backgroundColor(this.pal.border)
              }
              Row({ space: 12 }) {
                Column({ space: 3 }) {
                  Text(backendMenuTitle(bk))
                    .fontSize(this.fs(15))
                    .fontWeight(this.selectedBackend === bk ? FontWeight.Medium : FontWeight.Normal)
                    .fontColor(this.selectedBackend === bk ? '#4D6BFE' : this.pal.text)
                  Text(backendMenuDesc(bk))
                    .fontSize(this.fs(12))
                    .fontColor(this.pal.text3)
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)

                if (this.selectedBackend === bk) {
                  Image($r('app.media.ic_lucide_check'))
                    .width(18)
                    .height(18)
                    .colorFilter(iconTintFilter('#4D6BFE'))
                }
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 14, bottom: 14 })
              .onClick(() => {
                this.onSelect(bk);
                this.onClose();
              })
            }
          }, (bk: string) => bk)
        }
        .width('100%')
        .backgroundColor(this.pal.card)
        .borderRadius(16)
        .border({ width: 0.5, color: this.pal.border })
      }
      .width('100%')
      .constraintSize({ maxHeight: '72%' })
      .padding({ left: 16, right: 16, top: 18, bottom: 26 })
      .backgroundColor(this.pal.panel)
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%')
    .height('100%')
  }
}

/**
 * 侧栏右上角 ⋮ 弹出菜单，对齐 Android 端（插件 / 自动化任务 / 设置 / 关于 / 检查更新）。
 */
@Component
export struct DrawerOverflowMenu {
  @Prop fontScale: number = 1;
  @Prop pal: Palette = new Palette();
  @Prop updateBadge: boolean = false;
  onPlugins: () => void = () => {};
  onSchedules: () => void = () => {};
  onSettings: () => void = () => {};
  onAbout: () => void = () => {};
  onCheckUpdate: () => void = () => {};
  onClose: () => void = () => {};

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  @Builder
  MenuRow(icon: Resource, label: string, badge: boolean, action: () => void) {
    Row({ space: 14 }) {
      Image(icon)
        .width(18)
        .height(18)
        .colorFilter(iconTintFilter(this.pal.text))
      Text(label)
        .fontSize(this.fs(15))
        .fontColor(this.pal.text)
        .layoutWeight(1)
      if (badge) {
        Column()
          .width(7)
          .height(7)
          .borderRadius(3.5)
          .backgroundColor('#4D6BFE')
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 13, bottom: 13 })
    .onClick(() => {
      this.onClose();
      action();
    })
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.04)')
        .onClick(() => {
          this.onClose();
        })
      Column() {
        this.MenuRow($r('app.media.ic_lucide_puzzle'), t('插件'), false, this.onPlugins)
        this.MenuRow($r('app.media.ic_lucide_clock'), t('自动化任务'), false, this.onSchedules)
        Column().width('100%').height(0.5).backgroundColor(this.pal.border)
        this.MenuRow($r('app.media.ic_lucide_settings_o'), t('设置'), false, this.onSettings)
        this.MenuRow($r('app.media.ic_lucide_info'), t('关于'), false, this.onAbout)
        this.MenuRow($r('app.media.ic_lucide_download'), t('检查更新'), this.updateBadge, this.onCheckUpdate)
      }
      .width(216)
      .margin({ top: 56, right: 16 })
      .padding({ top: 6, bottom: 6 })
      .backgroundColor(this.pal.card)
      .borderRadius(18)
      .border({ width: 0.5, color: this.pal.border })
      .shadow({ radius: 24, color: 'rgba(0,0,0,0.16)', offsetX: 0, offsetY: 8 })
    }
    .width('100%')
    .height('100%')
  }
}

/**
 * 聊天底部 + 号「更多操作」菜单，对齐 Android 端（拍照/相册/文件 + 引用对话/工作区/模式/工具访问/操作权限）。
 */
@Component
export struct ChatActionMenuSheet {
  @Prop workspaceLabel: string = 'default-workspace';
  @Prop modeLabel: string = '';
  @Prop permissionPreset: string = '';
  @Prop agentPresets: AgentPresetOption[] = [];
  @Prop currentAgentPreset: string = '';
  @Prop workspaces: HarnessWorkspace[] = [];
  @Prop selectedWorkspaceId: string = '';
  @Prop fontScale: number = 1;
  @Prop pal: Palette = new Palette();
  onTakePhoto: () => void = () => {};
  onPickAlbum: () => void = () => {};
  onPickFile: () => void = () => {};
  onQuoteSession: () => void = () => {};
  onSelectWorkspace: (workspaceId: string) => void = () => {};
  onSelectMode: (presetId: string) => void = () => {};
  onOpenWorkspaceFiles: () => void = () => {};
  onOpenTerminal: () => void = () => {};
  onOpenActivity: () => void = () => {};
  onSelectPermission: (preset: string) => void = () => {};
  onClose: () => void = () => {};

  @State expandedSection: string = '';

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private permChoices(): string[] {
    return ['read-only', 'workspace-write', 'danger-full-access'];
  }

  @Builder
  MediaTile(icon: Resource, label: string, action: () => void) {
    Column({ space: 7 }) {
      Image(icon)
        .width(22)
        .height(22)
        .colorFilter(iconTintFilter('#4D6BFE'))
      Text(label)
        .fontSize(this.fs(12))
        .fontWeight(FontWeight.Medium)
        .fontColor(this.pal.text)
    }
    .layoutWeight(1)
    .height(74)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .backgroundColor(this.pal.card)
    .borderRadius(16)
    .border({ width: 0.5, color: this.pal.border })
    .onClick(() => {
      this.onClose();
      action();
    })
  }

  @Builder
  ActionListRow(icon: Resource, label: string, valueText: string, sectionKey: string, directAction: () => void) {
    Row({ space: 12 }) {
      Image(icon)
        .width(19)
        .height(19)
        .colorFilter(iconTintFilter('#4D6BFE'))
      Text(label)
        .fontSize(this.fs(15))
        .fontColor(this.pal.text)
        .layoutWeight(1)
      if (valueText.length > 0) {
        Text(valueText)
          .fontSize(this.fs(13))
          .fontColor(this.pal.text3)
          .maxLines(1)
          .constraintSize({ maxWidth: 140 })
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      Image($r(sectionKey.length > 0 && this.expandedSection === sectionKey
        ? 'app.media.ic_lucide_chevron_down' : 'app.media.ic_lucide_chevron_right'))
        .width(15)
        .height(15)
        .colorFilter(iconTintFilter(this.pal.text3))
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .backgroundColor(this.pal.card)
    .borderRadius(16)
    .border({ width: 0.5, color: this.pal.border })
    .onClick(() => {
      if (sectionKey.length > 0) {
        this.expandedSection = this.expandedSection === sectionKey ? '' : sectionKey;
      } else {
        this.onClose();
        directAction();
      }
    })
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
        Row() {
          Text(t('更多操作'))
            .fontSize(this.fs(18))
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal.text)
            .layoutWeight(1)
          Row() {
            Image($r('app.media.ic_lucide_close'))
              .width(19)
              .height(19)
              .colorFilter(iconTintFilter(this.pal.text2))
          }
          .width(34)
          .height(34)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            this.onClose();
          })
        }
        .width('100%')
        .padding({ bottom: 4 })

        Row({ space: 10 }) {
          this.MediaTile($r('app.media.ic_lucide_camera'), t('拍照'), this.onTakePhoto)
          this.MediaTile($r('app.media.ic_lucide_images'), t('相册'), this.onPickAlbum)
          this.MediaTile($r('app.media.ic_lucide_file_text'), t('文件'), this.onPickFile)
        }
        .width('100%')

        Scroll() {
          Column({ space: 8 }) {
            this.ActionListRow($r('app.media.ic_lucide_message_sq'), t('引用对话'), '', '', this.onQuoteSession)

            this.ActionListRow($r('app.media.ic_lucide_folder'), t('工作区'), this.workspaceLabel, 'workspace', () => {})
            if (this.expandedSection === 'workspace') {
              Row({ space: 6 }) {
                ForEach(this.workspaces.slice(0, 6), (ws: HarnessWorkspace) => {
                  Text(ws.title.length > 0 ? ws.title : cwdFolderName(ws.path))
                    .fontSize(this.fs(12))
                    .fontColor(this.selectedWorkspaceId === ws.workspaceId ? '#4D6BFE' : this.pal.text2)
                    .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                    .backgroundColor(this.selectedWorkspaceId === ws.workspaceId
                      ? 'rgba(77,107,254,0.14)' : this.pal.chip)
                    .borderRadius(10)
                    .maxLines(1)
                    .onClick(() => {
                      this.onSelectWorkspace(ws.workspaceId);
                      this.onClose();
                    })
                }, (ws: HarnessWorkspace) => ws.workspaceId)
              }
              .width('100%')
              .padding({ left: 8, right: 8, bottom: 2 })
            }

            this.ActionListRow($r('app.media.ic_lucide_layers'), t('模式'),
              this.modeLabel.length > 0 ? this.modeLabel : agentPresetFriendlyLabel(this.currentAgentPreset, this.agentPresets),
              this.agentPresets.length > 0 ? 'mode' : '', () => {})
            if (this.expandedSection === 'mode' && this.agentPresets.length > 0) {
              Row({ space: 6 }) {
                ForEach(this.agentPresets, (p: AgentPresetOption) => {
                  Text(p.name.length > 0 ? p.name : p.id)
                    .fontSize(this.fs(12))
                    .fontColor(this.currentAgentPreset === p.id ? '#4D6BFE' : this.pal.text2)
                    .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                    .backgroundColor(this.currentAgentPreset === p.id
                      ? 'rgba(77,107,254,0.14)' : this.pal.chip)
                    .borderRadius(10)
                    .onClick(() => {
                      this.onSelectMode(p.id);
                      this.onClose();
                    })
                }, (p: AgentPresetOption) => p.id)
              }
              .width('100%')
              .padding({ left: 8, right: 8, bottom: 2 })
            }

            this.ActionListRow($r('app.media.ic_lucide_terminal'), t('工具访问'), '', 'tools', () => {})
            if (this.expandedSection === 'tools') {
              Row({ space: 8 }) {
                Row({ space: 4 }) {
                  Image($r('app.media.ic_lucide_folder'))
                    .width(13)
                    .height(13)
                    .colorFilter(iconTintFilter('#4D6BFE'))
                  Text(t('工作区文件'))
                    .fontSize(this.fs(12))
                    .fontColor('#4D6BFE')
                }
                .layoutWeight(1)
                .justifyContent(FlexAlign.Center)
                .padding({ top: 9, bottom: 9 })
                .backgroundColor('rgba(77,107,254,0.10)')
                .borderRadius(12)
                .onClick(() => {
                  this.onClose();
                  this.onOpenWorkspaceFiles();
                })
                Row({ space: 4 }) {
                  Image($r('app.media.ic_lucide_terminal'))
                    .width(13)
                    .height(13)
                    .colorFilter(iconTintFilter('#4D6BFE'))
                  Text(t('远程终端'))
                    .fontSize(this.fs(12))
                    .fontColor('#4D6BFE')
                }
                .layoutWeight(1)
                .justifyContent(FlexAlign.Center)
                .padding({ top: 9, bottom: 9 })
                .backgroundColor('rgba(77,107,254,0.10)')
                .borderRadius(12)
                .onClick(() => {
                  this.onClose();
                  this.onOpenTerminal();
                })
                Row({ space: 4 }) {
                  Image($r('app.media.ic_lucide_zap'))
                    .width(13)
                    .height(13)
                    .colorFilter(iconTintFilter(this.pal.text))
                  Text(t('活动'))
                    .fontSize(this.fs(12))
                    .fontColor(this.pal.text)
                }
                .layoutWeight(1)
                .justifyContent(FlexAlign.Center)
                .padding({ top: 9, bottom: 9 })
                .backgroundColor(this.pal.chip)
                .borderRadius(12)
                .onClick(() => {
                  this.onClose();
                  this.onOpenActivity();
                })
              }
              .width('100%')
              .padding({ left: 4, right: 4, bottom: 2 })
            }

            this.ActionListRow($r('app.media.ic_lucide_shield_alert'), t('操作权限'), permissionFriendlyLabel(this.permissionPreset), 'perm', () => {})
            if (this.expandedSection === 'perm') {
              Row({ space: 8 }) {
                ForEach(this.permChoices(), (preset: string) => {
                  Text(permissionFriendlyLabel(preset))
                    .fontSize(this.fs(12))
                    .fontColor(this.permissionPreset === preset ? '#4D6BFE' : this.pal.text2)
                    .layoutWeight(1)
                    .textAlign(TextAlign.Center)
                    .padding({ top: 8, bottom: 8 })
                    .backgroundColor(this.permissionPreset === preset
                      ? 'rgba(77,107,254,0.14)' : this.pal.chip)
                    .borderRadius(10)
                    .onClick(() => {
                      this.onSelectPermission(preset);
                      this.onClose();
                    })
                }, (preset: string) => preset)
              }
              .width('100%')
              .padding({ left: 4, right: 4, bottom: 2 })
            }
          }
          .width('100%')
        }
        .constraintSize({ maxHeight: 360 })
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 18, bottom: 26 })
      .backgroundColor(this.pal.panel)
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%')
    .height('100%')
  }
}

/**
 * 顶栏点击标题打开的「对话信息」底部弹窗，对齐 Android 端。
 */
@Component
export struct SessionInfoSheet {
  @Prop sessionTitle: string = '';
  @Prop workspaceTitle: string = 'default-workspace';
  @Prop hostName: string = '';
  @Prop workspaceType: string = 'DSH';
  @Prop workspacePath: string = '';
  @Prop sessionCount: number = 0;
  @Prop transportLabel: string = '';
  @Prop modelLabel: string = '';
  @Prop contextPercent: number = 0;
  @Prop fontScale: number = 1;
  @Prop pal: Palette = new Palette();
  onPickModel: () => void = () => {};
  onRename: () => void = () => {};
  onCompact: () => void = () => {};
  onExportMarkdown: () => void = () => {};
  onSwitchHost: () => void = () => {};
  onClose: () => void = () => {};

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  @Builder
  InfoRow(label: string, value: string, highlight: boolean) {
    Row({ space: 12 }) {
      Text(label)
        .fontSize(this.fs(14))
        .fontColor(this.pal.text2)
        .width(86)
      Text(value.length > 0 ? value : '—')
        .fontSize(this.fs(14))
        .fontColor(highlight ? '#4D6BFE' : this.pal.text)
        .textAlign(TextAlign.End)
        .layoutWeight(1)
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .padding({ top: 10, bottom: 10 })
    .alignItems(VerticalAlign.Top)
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
      Column({ space: 14 }) {
        Row() {
          Text(t('对话信息'))
            .fontSize(this.fs(18))
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pal.text)
            .layoutWeight(1)
          Row() {
            Image($r('app.media.ic_lucide_close'))
              .width(19)
              .height(19)
              .colorFilter(iconTintFilter(this.pal.text2))
          }
          .width(34)
          .height(34)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            this.onClose();
          })
        }
        .width('100%')

        Scroll() {
          Column({ space: 14 }) {
            Row({ space: 8 }) {
              Text(this.sessionTitle.length > 0 ? this.sessionTitle : t('新会话'))
                .fontSize(this.fs(16))
                .fontWeight(FontWeight.Medium)
                .fontColor(this.pal.text)
                .layoutWeight(1)
                .maxLines(2)
              Row({ space: 4 }) {
                Image($r('app.media.ic_dsh_edit'))
                  .width(13)
                  .height(13)
                  .colorFilter(iconTintFilter('#4D6BFE'))
                Text(t('重命名'))
                  .fontSize(this.fs(12))
                  .fontColor('#4D6BFE')
              }
              .padding({ left: 10, right: 10, top: 4, bottom: 4 })
              .backgroundColor('rgba(77,107,254,0.10)')
              .borderRadius(10)
              .onClick(() => {
                this.onClose();
                this.onRename();
              })
            }
            .width('100%')

            Column() {
              Text(t('工作区信息'))
                .fontSize(this.fs(12))
                .fontColor(this.pal.text3)
                .width('100%')
                .padding({ bottom: 4 })
              this.InfoRow(t('工作区'), this.workspaceTitle, true)
              Column().width('100%').height(0.5).backgroundColor(this.pal.border)
              this.InfoRow(t('主机'), this.hostName, false)
              Column().width('100%').height(0.5).backgroundColor(this.pal.border)
              this.InfoRow(t('工作区类型'), this.workspaceType, false)
              Column().width('100%').height(0.5).backgroundColor(this.pal.border)
              this.InfoRow(t('工作区目录'), this.workspacePath, false)
              Column().width('100%').height(0.5).backgroundColor(this.pal.border)
              this.InfoRow(t('对话'), `${this.sessionCount}`, false)
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 6 })
            .backgroundColor(this.pal.card)
            .borderRadius(16)
            .border({ width: 0.5, color: this.pal.border })

            Column() {
              Text(t('连接信息'))
                .fontSize(this.fs(12))
                .fontColor(this.pal.text3)
                .width('100%')
                .padding({ bottom: 4 })
              this.InfoRow(t('连接方式'), this.transportLabel.length > 0 ? this.transportLabel : t('服务器转发'), false)
              Column().width('100%').height(0.5).backgroundColor(this.pal.border)
              Row({ space: 12 }) {
                Text(t('模型'))
                  .fontSize(this.fs(14))
                  .fontColor(this.pal.text2)
                  .width(86)
                Text(this.modelLabel.length > 0 ? this.modelLabel : t('默认模型'))
                  .fontSize(this.fs(14))
                  .fontColor('#4D6BFE')
                  .textAlign(TextAlign.End)
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .width('100%')
              .padding({ top: 10, bottom: 10 })
              .onClick(() => {
                this.onClose();
                this.onPickModel();
              })
              if (this.contextPercent > 0) {
                Column().width('100%').height(0.5).backgroundColor(this.pal.border)
                this.InfoRow(t('上下文'), `${this.contextPercent}%`, false)
              }
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 6 })
            .backgroundColor(this.pal.card)
            .borderRadius(16)
            .border({ width: 0.5, color: this.pal.border })

            Row({ space: 8 }) {
              Text(t('导出'))
                .fontSize(this.fs(13))
                .fontColor(this.pal.text)
                .layoutWeight(1)
                .textAlign(TextAlign.Center)
                .padding({ top: 10, bottom: 10 })
                .backgroundColor(this.pal.card)
                .borderRadius(12)
                .border({ width: 0.5, color: this.pal.border })
                .onClick(() => {
                  this.onClose();
                  this.onExportMarkdown();
                })
              Text(t('压缩上下文'))
                .fontSize(this.fs(13))
                .fontColor('#4D6BFE')
                .layoutWeight(1)
                .textAlign(TextAlign.Center)
                .padding({ top: 10, bottom: 10 })
                .backgroundColor('rgba(77,107,254,0.10)')
                .borderRadius(12)
                .onClick(() => {
                  this.onClose();
                  this.onCompact();
                })
              Text(t('切换主机'))
                .fontSize(this.fs(13))
                .fontColor(this.pal.text2)
                .layoutWeight(1)
                .textAlign(TextAlign.Center)
                .padding({ top: 10, bottom: 10 })
                .backgroundColor(this.pal.card)
                .borderRadius(12)
                .border({ width: 0.5, color: this.pal.border })
                .onClick(() => {
                  this.onClose();
                  this.onSwitchHost();
                })
            }
            .width('100%')
          }
          .width('100%')
        }
        .constraintSize({ maxHeight: 480 })
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 18, bottom: 26 })
      .backgroundColor(this.pal.panel)
      .borderRadius({ topLeft: 24, topRight: 24 })
    }
    .width('100%')
    .height('100%')
  }
}
