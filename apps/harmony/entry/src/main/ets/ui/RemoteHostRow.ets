import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';

// One grouped row shared by the remote hosts page and the host switcher.
@Component
export struct RemoteHostRow {
  @Prop palette: Palette = lightPalette();
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop online: boolean = false;
  @Prop selected: boolean = false;
  @Prop editing: boolean = false;
  @Prop switching: boolean = false;
  @Link renameInput: string;
  @State hovered: boolean = false;
  @State namePreview: boolean = false;
  onSelect: () => void = () => {};
  onMenu: () => void = () => {};
  onDetails: () => void = () => {};
  onConfirmRename: () => void = () => {};
  onCancelRename: () => void = () => {};

  build() {
    Row({ space: 14 }) {
      Image($r('app.media.ic_host'))
        .width(24)
        .height(24)
        .fillColor(this.palette.text2)
      Column({ space: 4 }) {
        if (this.editing) {
          TextInput({ text: this.renameInput, placeholder: t('输入主机名称') })
            .height(34)
            .fontSize(14)
            .fontColor(this.palette.text)
            .placeholderColor(this.palette.text3)
            .caretColor(this.palette.primary)
            .backgroundColor(this.palette.inputBg)
            .borderRadius(10)
            .border({ width: 1, color: this.palette.primary })
            .padding({ left: 10, right: 10 })
            .onChange((value: string) => {
              this.renameInput = value;
            })
            .onSubmit(() => {
              this.onConfirmRename();
            })
        } else {
          Text(this.title)
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.palette.text)
            // 手机上名字列只有 ~150vp，16sp 单行会把 DESKTOP-R5BVQJJ 截成 DESKTOP-...；
            // 放宽到两行、字号降一档，短名字仍是一行，长名字能看全。
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .onHover((isHover: boolean) => {
              this.namePreview = isHover && this.title.length > 12;
            })
            .gesture(LongPressGesture()
              .onAction(() => {
                this.namePreview = true;
              }))
            .bindPopup(this.namePreview, {
              message: this.title,
              placement: Placement.Bottom,
              autoCancel: true,
              onStateChange: (state: PopupStateChangeParam) => {
                if (!state.isVisible && this.namePreview) {
                  this.namePreview = false;
                }
              }
            })
        }
        Text(this.subtitle)
          .fontSize(13)
          .fontColor(this.palette.text2)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      if (this.editing) {
        Row({ space: 8 }) {
          Text(t('取消'))
            .fontSize(12)
            .fontColor(this.palette.text2)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor(this.palette.chip)
            .borderRadius(14)
            .border({ width: 1, color: this.palette.borderStrong })
            .onClick(() => {
              this.onCancelRename();
            })
          Text(t('确定'))
            .fontSize(12)
            .fontColor('#FFFFFF')
            .padding({ left: 14, right: 14, top: 6, bottom: 6 })
            .backgroundColor(this.palette.primary)
            .borderRadius(14)
            .onClick(() => {
              this.onConfirmRename();
            })
        }
      } else {
        Row({ space: 5 }) {
          Column()
            .width(7)
            .height(7)
            .borderRadius(4)
            .backgroundColor(this.online ? this.palette.success : this.palette.text3)
          Text(this.online ? t('在线') : t('离线'))
            .fontSize(12)
            .fontColor(this.palette.text2)
        }
        if (this.switching && this.selected) {
          Image($r('app.media.ic_check'))
            .width(18)
            .height(18)
            .fillColor(this.palette.primary)
        } else if (!this.switching) {
        Button({ type: ButtonType.Normal }) {
          Image($r('app.media.ic_arrow_right'))
            .width(20)
            .height(20)
            .fillColor(this.palette.text2)
        }
          .width(20)
          .height(44)
          .padding(0)
          .backgroundColor(Color.Transparent)
          .accessibilityText(t('主机详情'))
          .onClick(this.onDetails)
        }
      }
    }
    .width('100%')
    .padding({ top: 10, bottom: 10, left: 16, right: 12 })
    .backgroundColor(this.hovered ? this.palette.inputBg : this.palette.card)
    .constraintSize({ minHeight: 58 })
    .borderRadius(0)
    .border({ width: { bottom: 0.5 }, color: this.palette.border })
    .onHover((isHover: boolean) => {
      this.hovered = isHover;
    })
    .onClick(() => {
      if (this.editing) {
        return;
      }
      if (this.online) {
        this.onSelect();
      } else {
        this.onDetails();
      }
    })
    .onMouse((event: MouseEvent) => {
      if (event.action === MouseAction.Press && event.button === MouseButton.Right) {
        this.onMenu();
      }
    })
  }

}
