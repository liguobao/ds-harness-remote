import { OAuthProvider } from '../net/ServerApi';
import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';

// ArkUI counterpart to app-core ServerSetupScreen. The parent owns authentication.
@Component
export struct ServerSetupScreen {
  @Prop palette: Palette = lightPalette();
  @Prop providers: OAuthProvider[] = [];
  @Prop busy: boolean = false;
  @Prop wide: boolean = false;
  @Prop qrUrl: string = '';
  @Prop errorMsg: string = '';
  @Prop infoMsg: string = '';
  @Prop minContentHeight: number = 0;
  @Link emailInput: string;
  @Link passwordInput: string;
  @Prop twoFactorRequired: boolean = false;
  @State code: string = '';
  @Link passwordLoginOpen: boolean;
  onMore: () => void = () => {};
  onLogin: (email: string, password: string, code: string) => void = () => {};
  onRestartPassword: () => void = () => {};
  onProvider: (id: string) => void = () => {};
  onOpenAuthorization: () => void = () => {};
  onCopyAuthorization: () => void = () => {};
  onCancelAuthorization: () => void = () => {};
  onRetryIdentity: () => void = () => {};
  onResetIdentity: () => void = () => {};
  onOpenCredits: () => void = () => {};

  private canSubmit(): boolean {
    return this.twoFactorRequired ? this.code.trim().length > 0
      : this.emailInput.trim().length > 0 && this.passwordInput.length > 0;
  }

  private submit(): void {
    if (!this.busy && this.canSubmit()) {
      this.onLogin(this.emailInput, this.passwordInput, this.twoFactorRequired ? this.code : '');
      this.code = '';
    }
  }

  /**
   * 登录页是否展开账号密码输入：没有可用的扫码/授权方式时必须露出；
   * 有的话默认收起，用户点「用账号密码登录」再展开（对齐上游 #335）。
   */
  private showPasswordLogin(): boolean {
    if (this.passwordLoginOpen) {
      return true;
    }
    // 已经填了账号/密码就别收起来（providers 晚到时输入框突然消失最恼人）
    if (this.emailInput.length > 0 || this.passwordInput.length > 0) {
      return true;
    }
    return this.providers.length === 0;
  }

  private providerTitle(provider: OAuthProvider): string {
    switch (provider.id) {
      case 'google': return t('使用 Google 继续');
      case 'zhihu': return t('使用知乎继续');
      case 'github': return t('使用 GitHub 继续');
      default: return provider.displayName;
    }
  }

  @Builder
  ProviderIcon(id: string) {
    if (id === 'google') {
      Image($r('app.media.ic_google')).width(22).height(22)
    } else if (id === 'zhihu') {
      Image($r('app.media.ic_zhihu')).width(22).height(22).fillColor(this.palette.primary)
    } else if (id === 'github') {
      Image($r('app.media.ic_github')).width(22).height(22).fillColor(this.palette.text)
    }
  }

  build() {
    Scroll() {
      Column() {
        Row() {
          Blank()
          Button({ type: ButtonType.ROUNDED_RECTANGLE }) {
            Image($r('app.media.ic_more'))
              .width(22)
              .height(22)
              .rotate({ angle: 90 })
              .fillColor(this.palette.text)
          }
          .width(44)
          .height(44)
          .padding(0)
          .backgroundColor(this.palette.inputBg)
          .borderRadius(22)
          .border({ width: 1, color: this.palette.border })
          .accessibilityText(t('更多'))
          .onClick(() => { this.onMore(); })
        }
        .width('100%')
        .padding({ top: 14, right: 16 })
        Column({ space: 12 }) {
          Image($r('app.media.ic_fish'))
            .width(this.wide ? 168 : 128)
            .aspectRatio(23.16 / 17.04)
            .fillColor(this.palette.text)
            .accessibilityLevel('no')
          Column({ space: 6 }) {
            Text('DSH REMOTE')
              .fontSize(28)
              .fontWeight(900)
              .fontColor(this.palette.text)
              .letterSpacing(-0.6)

            Text(t('请选择与远端设备相同的登录方式'))
              .fontSize(14)
              .fontColor(this.palette.text2)
              .textAlign(TextAlign.Center)
          }
          Column({ space: 12 }) {
            if (this.providers.length > 0 && this.qrUrl.length === 0) {
              Column({ space: 10 }) {
                ForEach(this.providers, (item: OAuthProvider) => {
                  Button({ type: ButtonType.ROUNDED_RECTANGLE }) {
                    Row({ space: 10 }) {
                      this.ProviderIcon(item.id)
                      Text(this.providerTitle(item))
                        .fontSize(16)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(this.palette.text)
                        .layoutWeight(1)
                        .textAlign(TextAlign.Start)
                    }
                    .width('100%')
                    .padding({ left: 18, right: 18 })
                  }
                    .padding(0)
                    .width('100%')
                    .height(52)
                    .backgroundColor(this.palette.inputBg)
                    .borderRadius(14)
                    .border({ width: 1, color: this.palette.border })
                    .enabled(!this.busy)
                    .onClick(() => {
                      this.onProvider(item.id);
                    })
                }, (item: OAuthProvider) => item.id)
                Text(t('浏览器授权后将自动返回'))
                  .fontSize(12)
                  .fontColor(this.palette.text2)
                  .textAlign(TextAlign.Center)
              }
              .width('100%')
            }
            if (this.providers.length > 0 && this.qrUrl.length === 0) {
              Row({ space: 10 }) {
                Divider().layoutWeight(1).color(this.palette.border)
                Text(t('或')).fontSize(12).fontColor(this.palette.text2)
                Divider().layoutWeight(1).color(this.palette.border)
              }
              .width('100%')
              .padding({ top: 10, bottom: 10 })
            }
            if ((this.twoFactorRequired || this.showPasswordLogin()) && this.qrUrl.length === 0) {
              if (this.twoFactorRequired) {
                TextInput({ text: this.code, placeholder: t('验证码或恢复码') })
                  .height(50)
                  .maxLength(64)
                  .backgroundColor(this.palette.chip)
                  .fontColor(this.palette.text)
                  .placeholderColor(this.palette.text3)
                  .borderRadius(14)
                  .onChange((value: string) => { this.code = value; })
                  .onSubmit(() => { this.submit(); })
              } else {
                TextInput({ text: this.emailInput, placeholder: t('输入邮箱') })
                  .height(50)
                  .backgroundColor(this.palette.chip)
                  .fontColor(this.palette.text)
                  .placeholderColor(this.palette.text3)
                  .caretColor(this.palette.primary)
                  .borderRadius(14)
                  .padding({ left: 16, right: 16 })
                  .onChange((value: string) => {
                    this.emailInput = value;
                  })
                TextInput({ text: this.passwordInput, placeholder: t('输入密码') })
                  .type(InputType.Password)
                  .height(50)
                  .backgroundColor(this.palette.chip)
                  .fontColor(this.palette.text)
                  .placeholderColor(this.palette.text3)
                  .caretColor(this.palette.primary)
                  .borderRadius(14)
                  .padding({ left: 16, right: 16 })
                  .onChange((value: string) => {
                    this.passwordInput = value;
                  })
                  .onSubmit(() => {
                    this.submit();
                  })
              }
              Button(t('登录'), { type: ButtonType.ROUNDED_RECTANGLE })
                .width('100%')
                .height(50)
                .backgroundColor(this.canSubmit()
                  ? this.palette.primary : this.palette.chip)
                .fontColor(this.canSubmit()
                  ? '#FFFFFF' : this.palette.text2)
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .borderRadius(14)
                .enabled(!this.busy && this.canSubmit())
                .onClick(() => {
                  this.submit();
                })
              if (this.twoFactorRequired) {
                Button(t('重新输入密码'))
                  .enabled(!this.busy)
                  .onClick(() => {
                    this.code = '';
                    this.onRestartPassword();
                  })
              } else {
                Text(t('仅用于邀请或自建账号。'))
                  .fontSize(12)
                  .fontColor(this.palette.text2)
                  .textAlign(TextAlign.Center)
              }
            }
            if (this.providers.length > 0 && this.qrUrl.length === 0) {
              Row({ space: 6 }) {
                Image($r('app.media.ic_mail')).width(18).height(18).fillColor(this.palette.text)
                Text(this.passwordLoginOpen ? t('收起邮箱登录') : t('使用邮箱登录'))
                  .fontSize(14)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.palette.text)
              }
              .width('100%')
              .height(44)
              .justifyContent(FlexAlign.Center)
              .backgroundColor(this.palette.chip)
              .borderRadius(14)
              .onClick(() => { this.passwordLoginOpen = !this.passwordLoginOpen; })
            }
            if (this.qrUrl.length > 0) {
              Column({ space: 10 }) {
                Text(t('用已登录同一账号的浏览器扫码或点按钮授权'))
                  .fontSize(12)
                  .fontColor(this.palette.text2)
                  .textAlign(TextAlign.Center)
                QRCode(this.qrUrl)
                  .width(160)
                  .height(160)
                  .color('#0B0F19')
                  .backgroundColor('#FFFFFF')
                  .borderRadius(12)
                Button(t('在浏览器中打开授权页'))
                  .width('100%')
                  .height(40)
                  .backgroundColor(this.palette.primary)
                  .fontColor('#FFFFFF')
                  .fontSize(14)
                  .borderRadius(12)
                  .onClick(() => {
                    this.onOpenAuthorization();
                  })
                Text(this.qrUrl)
                  .fontSize(11)
                  .fontColor(this.palette.primary)
                  .copyOption(CopyOptions.LocalDevice)
                  .textAlign(TextAlign.Center)
                  .wordBreak(WordBreak.BREAK_ALL)
                  .width('100%')
                Button(t('复制授权链接'))
                  .height(30)
                  .fontSize(12)
                  .fontColor(this.palette.text2)
                  .backgroundColor(this.palette.border)
                  .borderRadius(15)
                  .onClick(() => {
                    this.onCopyAuthorization();
                  })
                Row({ space: 12 }) {
                  LoadingProgress()
                    .width(18)
                    .height(18)
                    .color(this.palette.primary)
                  Text(t('等待浏览器授权…'))
                    .fontSize(12)
                    .fontColor(this.palette.text2)
                }
                Button(t('取消'))
                  .height(32)
                  .fontSize(12)
                  .backgroundColor(this.palette.chip)
                  .fontColor(this.palette.text2)
                  .borderRadius(16)
                  .onClick(() => {
                    this.onCancelAuthorization();
                  })
              }
              .width('100%')
              .padding(12)
              .borderRadius(14)
              .backgroundColor(this.palette.card)
            }
            if (this.busy) {
              LoadingProgress()
                .width(24)
                .height(24)
                .color(this.palette.primary)
            }
            if (this.infoMsg.length > 0) {
              Text(this.infoMsg)
                .fontSize(12)
                .fontColor(this.palette.success)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 6, bottom: 2, left: 16, right: 16 })
            }
            if (this.errorMsg.length > 0) {
              Text(this.errorMsg)
                .fontSize(13)
                .fontColor(this.palette.danger)
                .textAlign(TextAlign.Center)
              if (this.errorMsg.indexOf('设备身份读取失败') >= 0) {
                Row({ space: 8 }) {
                  Text('重试')
                    .fontSize(12)
                    .fontColor(this.palette.text2)
                    .padding({ left: 14, right: 14, top: 6, bottom: 6 })
                    .backgroundColor(this.palette.chip)
                    .borderRadius(14)
                    .border({ width: 1, color: this.palette.borderStrong })
                    .onClick(() => {
                                            this.onRetryIdentity();
                    })
                  Text('重置设备身份')
                    .fontSize(12)
                    .fontColor('#FFFFFF')
                    .padding({ left: 14, right: 14, top: 6, bottom: 6 })
                    .backgroundColor(this.palette.primary)
                    .borderRadius(14)
                    .onClick(() => {
                                            AlertDialog.show({
                        title: t('重置设备身份'),
                        message: t('安全存储里的私钥已经读不到了。重置会生成一个新的设备身份，'
                          + '需要重新登录，服务器上会把这台设备当成新设备。继续？'),
                        primaryButton: {
                          value: t('取消'),
                          action: () => {
                          }
                        },
                        secondaryButton: {
                          value: t('重置'),
                          fontColor: this.palette.danger,
                          action: () => {
                            this.onResetIdentity();
                          }
                        }
                      });
                    })
                }
                .margin({ top: 8 })
              }
            }
            }
          .width('100%')
          .margin({ top: 24 })
        }
        .padding({ left: 24, right: 24, top: 24, bottom: 24 })
        .width('100%')
        .constraintSize({ maxWidth: 400 })
        Blank()
        Text() {
          Span('Power by ')
            .fontColor(this.palette.text2)
          Span('GitHub/liguobao')
            .fontColor(this.palette.primary)
            .decoration({ type: TextDecorationType.Underline })
        }
        .fontSize(12)
        .padding({ top: 10, bottom: 32 })
        .onClick(() => { this.onOpenCredits(); })

        }
      .width('100%')
      .alignItems(HorizontalAlign.Center)
      .constraintSize({ minHeight: this.minContentHeight })
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
  }

}
