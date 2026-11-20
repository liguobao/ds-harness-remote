import { DshWebGrant, isDshWebOrigin, isFatalDshWebHttpError } from '../net/DshWebGrant';
import { webview } from '@kit.ArkWeb';
import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';
import { ScreenHeader } from './ScreenHeader';

@Component
export struct DshWebPage {
  @Prop palette: Palette = lightPalette();
  @Prop hostName: string = '';
  openGrant: () => Promise<DshWebGrant> = async () => { throw new Error('DSH_WEB_UNAVAILABLE'); };
  closeGrant: () => Promise<void> = async () => {};
  onBack: () => void = () => {};
  @State grantUrl: string = '';
  @State loaded: boolean = false;
  @State failed: boolean = false;
  private grantToken: string = '';
  private localGrant: boolean = false;
  private grantOrigin: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private active: boolean = false;

  aboutToAppear(): void {
    this.active = true;
    this.load();
  }

  aboutToDisappear(): void {
    this.active = false;
    this.grantToken = '';
    this.closeGrant();
  }

  private async load(): Promise<void> {
    this.failed = false;
    this.loaded = false;
    this.grantUrl = '';
    this.grantToken = '';
    this.grantOrigin = '';
    try {
      const grant = await this.openGrant();
      if (this.active) {
        this.controller = new webview.WebviewController();
        this.localGrant = grant.origin.startsWith('http://');
        this.grantToken = grant.browserGrant;
        this.grantOrigin = grant.origin;
        this.grantUrl = grant.url;
      }
    } catch {
      if (this.active) {
        this.failed = true;
      }
    }
  }

  private submitGrant(): void {
    if (!this.active || this.grantToken.length === 0) {
      return;
    }
    const token = this.grantToken;
    this.grantToken = '';
    try {
      this.controller.loadData(
        '<!doctype html><meta name="referrer" content="same-origin">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; form-action \'self\'">' +
        '<form method="post" action="/__remote/session">' +
        '<input type="hidden" name="browserGrant" value="' + token + '"></form>' +
        '<script>document.forms[0].submit()</script>',
        'text/html', 'UTF-8', this.grantUrl + '__remote/session-bootstrap', '');
    } catch {
      this.failed = true;
    }
  }

  build() {
    Column() {
      ScreenHeader({
        palette: this.palette,
        title: this.loaded && !this.failed ? this.hostName : t('打开 DSH Web'),
        onBack: this.onBack
      })
        .margin({ left: 16, right: 16 })
      if (this.failed) {
        Text(t('无法打开 DSH Web，请重试。')).fontSize(15).fontColor(this.palette.danger).padding(16)
        Button(t('重试')).backgroundColor(this.palette.primary).onClick(() => { this.load(); })
      } else {
        Stack() {
          if (this.grantUrl.length > 0) {
            Web({ src: this.localGrant ? this.grantUrl + '__remote/launch' : 'about:blank', controller: this.controller, incognitoMode: true })
              .width('100%').height('100%')
              .javaScriptAccess(true)
              .domStorageAccess(true)
              .fileAccess(false)
              .mixedMode(MixedMode.None)
              .multiWindowAccess(false)
              .onLoadIntercept((event: OnLoadInterceptEvent): boolean => {
                const target = event.data.getRequestUrl();
                if (target === 'about:blank' && this.grantToken.length > 0) {
                  return false;
                }
                return !isDshWebOrigin(target, this.grantOrigin);
              })
              .onPermissionRequest((event: OnPermissionRequestEvent) => { event.request.deny(); })
              .onPageEnd((event: OnPageEndEvent) => {
                if (this.localGrant && event.url === this.grantUrl + '__remote/launch' && this.grantToken.length > 0) {
                  const token = this.grantToken;
                  this.grantToken = '';
                  this.controller.runJavaScript("document.forms[0].elements.browserGrant.value='" + token +
                    "';document.forms[0].submit()").catch(() => { this.failed = true; });
                } else if (!this.localGrant && event.url === 'about:blank' && this.grantToken.length > 0) {
                  this.submitGrant();
                } else if (event.url === this.grantUrl) {
                  this.loaded = true;
                }
              })
              .onErrorReceive((event: OnErrorReceiveEvent) => {
                if (event.request.isMainFrame()) {
                  this.failed = true;
                }
              })
              .onHttpErrorReceive((event: OnHttpErrorReceiveEvent) => {
                if (this.localGrant && event.response.getResponseCode() === 401 &&
                  event.request.getRequestUrl() === this.grantUrl + '__remote/launch') return;
                if (isFatalDshWebHttpError(event.request.getRequestUrl(), event.response.getResponseCode(),
                  this.grantUrl, this.grantOrigin)) {
                  this.failed = true;
                }
              })
              .onRenderExited(() => { this.failed = true; })
          }
          if (!this.loaded) {
            Column({ space: 12 }) {
              LoadingProgress().width(28).height(28).color(this.palette.primary)
              Text(t(this.grantUrl.length > 0 ? '正在验证访问并加载页面…' : '正在建立 DSH Web 连接…')).fontSize(14).fontColor(this.palette.text2)
            }
            .width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor(this.palette.bg)
          }
        }
        .width('100%').layoutWeight(1)
      }
    }
    .width('100%').height('100%').backgroundColor(this.palette.bg)
  }
}
