import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';

@Component
export struct ChatHeader {
  @Prop palette: Palette = lightPalette();
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop drawerInline: boolean = false;
  @Prop hasSession: boolean = false;
  @Prop trajectoryOpen: boolean = false;
  @Prop titleSize: number = 17;
  @Prop subtitleSize: number = 12;
  onDrawer: () => void = () => {};
  onSession: () => void = () => {};
  onModel: () => void = () => {};
  onCloseTrajectory: () => void = () => {};
  onNewChat: () => void = () => {};

  @Builder
  Action(icon: Resource, label: string, action: () => void) {
    Button({ type: ButtonType.Circle }) {
      Image(icon)
        .width(20)
        .height(20)
        .fillColor(this.palette.text)
    }
    .width(40)
    .height(40)
    .padding(0)
    .backgroundColor(Color.Transparent)
    .accessibilityText(label)
    .onClick(action)
  }

  build() {
    Row({ space: 4 }) {
      if (!this.drawerInline) {
        Row() {
          this.Action($r('app.media.ic_menu'), t('会话'), this.onDrawer)
        }
        .width(44)
        .height(44)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.palette.inputBg)
        .borderRadius(22)
        .border({ width: 1, color: this.palette.border })
      }
      Column({ space: 2 }) {
        Text(this.title)
          .fontSize(this.titleSize)
          .lineHeight(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.palette.text)
          .width('100%')
          .textAlign(TextAlign.Center)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .onClick(() => {
            if (this.hasSession) {
              this.onSession();
            }
          })
        if (this.subtitle.length > 0) {
          Text(this.subtitle + ' ⌄')
            .fontSize(this.subtitleSize)
            .lineHeight(16)
            .fontColor(this.palette.text2)
            .width('100%')
            .textAlign(TextAlign.Center)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .onClick(this.onModel)
        }
      }
      .layoutWeight(1)
      .padding({ left: 8, right: 8 })
      Row() {
        if (this.trajectoryOpen) {
          this.Action($r('app.media.ic_message'), t('切换到对话模式'), this.onCloseTrajectory)
        } else {
          this.Action($r('app.media.ic_new_chat'), t('新对话'), this.onNewChat)
          this.Action($r('app.media.ic_more'), t('更多操作'), this.onSession)
        }
      }
      .height(44)
      .padding({ left: 2, right: 2 })
      .backgroundColor(this.palette.inputBg)
      .borderRadius(22)
      .border({ width: 1, color: this.palette.border })
    }
    .width('100%')
    .height(this.subtitle.length > 0 ? 68 : 60)
    .padding({ left: 16, right: 16 })
    .backgroundColor(this.palette.bg)
  }
}
