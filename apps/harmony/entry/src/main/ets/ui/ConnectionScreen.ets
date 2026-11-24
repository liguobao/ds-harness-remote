import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';

@Component
export struct ConnectionScreen {
  @Prop palette: Palette = lightPalette();
  @Prop deviceName: string = '';
  @Prop phase: number = 0;
  @Prop detail: string = '';
  @Prop elapsed: number = 0;
  @Prop embedded: boolean = false;
  @Prop error: string = '';
  onCancel: () => void = () => {};

  @Builder
  Stage(index: number, label: string) {
    Row({ space: 12 }) {
      if (this.phase === index) {
        LoadingProgress().width(24).height(24).color(this.palette.primary)
      } else if (this.phase > index) {
        Image($r('app.media.ic_check'))
          .width(18)
          .height(18)
          .fillColor(this.palette.success)
          .margin({ left: 3, right: 3 })
      } else {
        Text('·')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.phase > index ? this.palette.success : this.palette.text2)
          .width(24)
          .height(24)
          .textAlign(TextAlign.Center)
      }
      Text(label)
        .layoutWeight(1)
        .fontSize(15)
        .fontWeight(this.phase === index ? FontWeight.Medium : FontWeight.Normal)
        .fontColor(this.phase === index ? this.palette.text : this.palette.text2)
    }
    .width('100%')
    .height(52)
    .padding({ left: 16, right: 16 })
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Stack({ alignContent: Alignment.Center }) {
          Image($r('app.media.ic_host'))
            .width(78)
            .height(66)
            .fillColor(this.palette.text)
          Image($r('app.media.ic_fish'))
            .width(27)
            .aspectRatio(23.16 / 17.04)
            .fillColor(this.palette.primary)
            .margin({ bottom: 9 })
        }
        .width(104)
        .height(104)
        .borderRadius(30)
        .backgroundColor(this.palette.primarySoft)
        Text(t('正在建立安全连接…'))
          .fontSize(14)
          .fontColor(this.palette.text2)
        if (this.deviceName.length > 0) {
          Text(this.deviceName)
            .fontSize(26)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.palette.text)
            .textAlign(TextAlign.Center)
            .maxLines(2)
        }
        Column() {
          this.Stage(0, t('验证主机'))
          this.Stage(1, t('建立加密通道'))
          this.Stage(2, t('准备连接'))
          this.Stage(3, t('订阅会话'))
        }
        .width('100%')
        .borderRadius(22)
        .backgroundColor(this.palette.card)
        Text(this.detail + (this.elapsed > 0 ? ' · ' + this.elapsed + 's' : ''))
          .fontSize(13)
          .fontColor(this.palette.text2)
          .textAlign(TextAlign.Center)
        if (this.error.length > 0) {
          Text(this.error)
            .fontSize(13)
            .fontColor(this.palette.danger)
            .textAlign(TextAlign.Center)
        }
        Button(t('取消'), { type: ButtonType.Capsule })
          .height(44)
          .padding({ left: 24, right: 24 })
          .fontColor(this.palette.text)
          .backgroundColor(this.palette.chip)
          .onClick(this.onCancel)
      }
      .width('100%')
      .constraintSize({ maxWidth: 520 })
      .padding({ left: 0, right: 0, top: this.embedded ? 6 : 36, bottom: 12 })
    }
    .width('100%')
    .constraintSize({ maxHeight: this.embedded ? 490 : '100%' })
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
  }
}
