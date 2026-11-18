import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';
import { Palette } from '../services/Theme';
import { t } from '../services/I18n';
import { SyntaxPalette, SyntaxToken, darkCodePalette, highlightCode, lightCodePalette,
  syntaxColorFor } from '../util/SyntaxHighlight';
import { RichBlock, formatMathDisplay } from '../util/MentionAndQuote';

/** Syntax-highlighted code / Mermaid card with one-tap Copy. */
@Component
export struct RichCodeBlockCard {
  @Prop blk: RichBlock = new RichBlock();
  @Prop dark: boolean = true;
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private codePalette(): SyntaxPalette {
    return this.dark ? darkCodePalette() : lightCodePalette();
  }

  build() {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        Text(this.blk.kind === 'mermaid' ? 'Mermaid' : (this.blk.language.length > 0 ? this.blk.language : 'code'))
          .fontSize(this.fs(11))
          .fontWeight(FontWeight.Medium)
          .fontColor(this.codePalette().headerText)
          .fontFamily('monospace')
        Blank()
        Text(t('复制'))
          .fontSize(this.fs(11))
          .fontColor('#22D3EE')
          .padding({ left: 8, right: 8, top: 3, bottom: 3 })
          .borderRadius(6)
          .backgroundColor(this.pal.chip)
          .onClick(() => {
            const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.blk.text);
            pasteboard.getSystemPasteboard().setData(data).then(() => {
              promptAction.showToast({ message: t('已复制代码') });
            }).catch(() => undefined);
          })
      }
      .width('100%')
      .padding({ left: 10, right: 8, top: 6, bottom: 6 })
      .backgroundColor(this.codePalette().headerBackground)

      Scroll() {
        Text() {
          ForEach(highlightCode(this.blk.text, this.blk.language), (tok: SyntaxToken, idx: number) => {
            Span(tok.text)
              .fontColor(syntaxColorFor(this.codePalette(), tok.kind))
              .fontSize(this.fs(12))
              .fontFamily('monospace')
          }, (tok: SyntaxToken, idx: number) => idx + ':' + tok.kind + ':' + tok.text.length)
        }
        .textAlign(TextAlign.Start)
        .copyOption(CopyOptions.LocalDevice)
        .padding({ left: 10, right: 10, top: 8, bottom: 10 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .width('100%')
    .backgroundColor(this.codePalette().background)
    .borderRadius(10)
    .border({ width: 0.5, color: this.codePalette().border })
    .clip(true)
  }
}

/** Display math block card with Unicode TeX formatting and TeX source copy. */
@Component
export struct RichMathBlockCard {
  @Prop blk: RichBlock = new RichBlock();
  @Prop dark: boolean = true;
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  build() {
    Column({ space: 4 }) {
      Row({ space: 6 }) {
        Text('fx')
          .fontSize(this.fs(10))
          .fontColor('#22D3EE')
          .fontFamily('monospace')
        Blank()
        Text('TeX')
          .fontSize(this.fs(10))
          .fontColor(this.pal.text3)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .backgroundColor(this.pal.chip)
          .borderRadius(5)
          .onClick(() => {
            const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.blk.text);
            pasteboard.getSystemPasteboard().setData(data).then(() => {
              promptAction.showToast({ message: t('已复制公式') });
            }).catch(() => undefined);
          })
      }
      .width('100%')

      Scroll() {
        Text(formatMathDisplay(this.blk.text))
          .fontSize(this.fs(14))
          .fontFamily('serif')
          .fontColor(this.pal.text)
          .copyOption(CopyOptions.LocalDevice)
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .width('100%')
    .padding({ left: 10, right: 10, top: 8, bottom: 8 })
    .backgroundColor(this.pal.card)
    .borderRadius(8)
    .border({ width: 0.5, color: this.pal.border })
  }
}

/** Scrollable Markdown table card. */
@Component
export struct RichTableBlockCard {
  @Prop blk: RichBlock = new RichBlock();
  @Prop dark: boolean = true;
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private headerBg(): string {
    return this.dark ? darkCodePalette().headerBackground : lightCodePalette().headerBackground;
  }

  build() {
    Scroll() {
      Column({ space: 0 }) {
        Row() {
          ForEach(this.blk.headers, (h: string, colIdx: number) => {
            Text(h)
              .fontSize(this.fs(12))
              .fontWeight(FontWeight.Bold)
              .fontColor(this.pal.text)
              .constraintSize({ minWidth: 72, maxWidth: 200 })
              .padding({ left: 8, right: 8, top: 6, bottom: 6 })
          }, (h: string, colIdx: number) => 'h' + colIdx + ':' + h)
        }
        .backgroundColor(this.headerBg())
        .border({ width: { bottom: 0.5 }, color: this.pal.borderStrong })

        ForEach(this.blk.rows, (row: string[], rIdx: number) => {
          Row() {
            ForEach(row, (cell: string, cIdx: number) => {
              Text(cell)
                .fontSize(this.fs(12))
                .fontColor(this.pal.text2)
                .constraintSize({ minWidth: 72, maxWidth: 200 })
                .padding({ left: 8, right: 8, top: 5, bottom: 5 })
            }, (cell: string, cIdx: number) => 'c' + cIdx + ':' + cell)
          }
          .border({ width: { bottom: 0.5 }, color: this.pal.border })
        }, (row: string[], rIdx: number) => 'r' + rIdx)
      }
      .alignItems(HorizontalAlign.Start)
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .width('100%')
    .backgroundColor(this.pal.card)
    .borderRadius(8)
    .border({ width: 0.5, color: this.pal.border })
    .clip(true)
  }
}
