import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';

// ArkUI counterpart of app-core's centered TopBar.
@Component
export struct ScreenHeader {
  @Prop palette: Palette = lightPalette();
  @Prop title: string = '';
  onBack: () => void = () => {};

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Text(this.title)
        .fontSize(17)
        .lineHeight(22)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.palette.text)
        .width('100%')
        .padding({ left: 48, right: 48 })
        .textAlign(TextAlign.Center)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Button('←', { type: ButtonType.Circle })
        .width(44)
        .height(44)
        .padding(0)
        .fontSize(18)
        .fontColor(this.palette.text)
        .backgroundColor(this.palette.inputBg)
        .border({ width: 1, color: this.palette.border })
        .accessibilityText(t('返回'))
        .onClick(this.onBack)
    }
    .width('100%')
    .height(60)
  }
}
