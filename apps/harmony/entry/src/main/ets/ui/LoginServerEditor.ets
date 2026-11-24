import { normalizeServerUrl } from '../net/ServerApi';
import { errorMessage } from '../services/AppRuntime';
import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';

@Component
export struct LoginServerEditor {
  @Prop palette: Palette = lightPalette();
  @Prop serverInput: string = '';
  @State loginServerDraft: string = '';
  @State loginServerError: string = '';
  onSave: (server: string) => void = () => {};
  onClose: () => void = () => {};

  aboutToAppear(): void {
    this.loginServerDraft = this.serverInput;
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.palette.backdrop)
        .onClick(() => { this.onClose(); })
      Column({ space: 12 }) {
        Text(t('切换服务器'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.palette.text)
          .width('100%')
        Text(t('服务器地址')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.palette.text).width('100%')
        TextInput({ text: this.loginServerDraft, placeholder: 'https://remote.example.com' })
          .height(50)
          .type(InputType.URL)
          .fontColor(this.palette.text)
          .backgroundColor(this.palette.chip)
          .borderRadius(14)
          .accessibilityText(t('服务器'))
          .onChange((value: string) => {
            this.loginServerDraft = value;
            this.loginServerError = '';
          })
        if (this.loginServerError.length > 0) {
          Text(this.loginServerError).fontSize(13).fontColor(this.palette.danger).width('100%')
        }
        Text(t('切换服务器后需重新登录'))
          .fontSize(13)
          .fontColor(this.palette.text2)
          .width('100%')
        Row({ space: 8 }) {
          Button(t('保存服务器'), { type: ButtonType.Capsule })
            .layoutWeight(1)
            .height(46)
            .borderRadius(14)
            .backgroundColor(this.palette.primary)
            .enabled(this.loginServerDraft.trim().length > 0 && this.loginServerDraft.trim() !== this.serverInput)
            .onClick(() => {
              try {
                this.onSave(normalizeServerUrl(this.loginServerDraft));
              } catch (error) {
                this.loginServerError = t(errorMessage(error));
              }
            })
          Button(t('取消'), { type: ButtonType.Capsule })
            .layoutWeight(1)
            .height(46)
            .borderRadius(14)
            .fontColor(this.palette.text)
            .backgroundColor(this.palette.chip)
            .onClick(() => { this.onClose(); })
        }
        .width('100%')
      }
      .width('90%')
      .constraintSize({ maxWidth: 420 })
      .padding(20)
      .borderRadius(24)
      .backgroundColor(this.palette.panel)
    }
    .width('100%')
    .height('100%')
  }

}
