import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';

@Component
export struct ResponseActions {
  @Prop palette: Palette = lightPalette();
  @Prop time: string = '';
  @Prop usage: string = '';
  @Prop canBranch: boolean = false;
  onCopy: () => void = () => {};
  onBranch: () => void = () => {};

  @Builder
  Action(icon: Resource, label: string, action: () => void) {
    Button({ type: ButtonType.Circle }) {
      Image(icon).width(15).height(15).fillColor(this.palette.text2)
    }
    .width(36)
    .height(36)
    .padding(0)
    .backgroundColor(Color.Transparent)
    .accessibilityText(label)
    .onClick(action)
  }

  build() {
    Row({ space: 4 }) {
      this.Action($r('app.media.ic_copy_response'), t('复制回复'), this.onCopy)
      if (this.canBranch) {
        this.Action($r('app.media.ic_branch_response'), t('从这里分叉'), this.onBranch)
      }
      if (this.usage.length > 0) {
        Row({ space: 4 }) {
          Image($r('app.media.ic_host_stack')).width(13).height(13).fillColor(this.palette.text2)
          Text(t('用量') + ' ' + this.usage).fontSize(12).fontColor(this.palette.text2)
        }
        .padding({ left: 4, right: 4 })
      }
      if (this.time.length > 0) {
        Text(this.time)
          .fontSize(11)
          .fontColor(this.palette.text2)
          .padding({ left: 6 })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }
}
