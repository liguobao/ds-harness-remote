import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';

// Compact host drawer controls use the same geometry as app-core HostSessionsDrawer.
@Component
export struct WorkspaceToolbar {
  @Prop palette: Palette = lightPalette();
  @Prop connected: boolean = false;
  @Prop botMode: boolean = false;
  @Prop platformLabel: string = 'DeepSeek';
  @Prop searchOpen: boolean = false;
  onAgents: () => void = () => {};
  onBots: () => void = () => {};
  onSearch: () => void = () => {};
  onOptions: () => void = () => {};
  onCreate: () => void = () => {};

  @Builder
  Tab(icon: Resource, label: string, selected: boolean, action: () => void) {
    Column() {
      Row({ space: 6 }) {
        Image(icon).width(15).height(15).fillColor(selected ? this.palette.text : this.palette.text2)
        Text(label)
          .fontSize(14)
          .fontWeight(selected ? FontWeight.Bold : FontWeight.Medium)
          .fontColor(selected ? this.palette.text : this.palette.text2)
      }
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      Column().width(44).height(2.5).borderRadius(2)
        .backgroundColor(selected ? this.palette.primary : Color.Transparent)
    }
    .layoutWeight(1)
    .height(38)
    .accessibilityText(label)
    .onClick(action)
  }

  @Builder
  Action(icon: Resource, label: string, active: boolean, action: () => void) {
    Button({ type: ButtonType.Circle }) {
      Image(icon).width(17).height(17).fillColor(active ? this.palette.text : this.palette.text2)
    }
    .width(34).height(34).padding(0)
    .backgroundColor(Color.Transparent)
    .accessibilityText(label)
    .onClick(action)
  }

  build() {
    Column() {
      Row() {
        this.Tab($r('app.media.ic_agents_tab'), t('智能体'), !this.botMode, this.onAgents)
        this.Tab($r('app.media.ic_bots_tab'), 'DS-Bot', this.botMode, this.onBots)
      }
      .width('auto')
      .margin({ left: 16, right: 16, bottom: 8 })
      .border({ width: { bottom: 0.5 }, color: this.palette.border })
      if (!this.botMode) {
        Row({ space: 8 }) {
          Text(t('工作区列表')).fontSize(14.5).fontColor(this.palette.text2)
            Row({ space: 3 }) {
            Text(this.platformLabel).fontSize(12).fontWeight(FontWeight.Bold).fontColor(this.palette.text)
          }
          .height(28).padding({ left: 10, right: 10 })
          .borderRadius(14).backgroundColor(this.palette.chip)
          Blank()
          if (this.connected) {
            this.Action($r('app.media.ic_search_sessions'), t('搜索'), this.searchOpen, this.onSearch)
            this.Action($r('app.media.ic_workspace_options'), t('视图选项'), false, this.onOptions)
            this.Action($r('app.media.ic_workspace_add'), t('新建工作区'), false, this.onCreate)
          }
        }
        .width('100%')
        .padding({ left: 20, right: 12, top: 12, bottom: 4 })
      }
    }
    .width('100%')
  }
}
