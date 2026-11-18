import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction } from '@kit.ArkUI';
import { pdfViewManager, PdfView } from '@kit.PDFKit';
import { Palette } from '../services/Theme';
import { t } from '../services/I18n';
import { SessionToolsClient, WorkspaceFileEntry, WorkspaceOfficeRender } from '../net/SessionToolsClient';
import { highlightCode, darkCodePalette, lightCodePalette, syntaxColorFor, SyntaxToken } from '../util/SyntaxHighlight';
import { randomId } from '../crypto/Bytes';

const IMAGE_EXTS: Set<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const OFFICE_EXTS: Set<string> = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);

function extOf(path: string): string {
  const cut = path.lastIndexOf('.');
  if (cut < 0 || cut === path.length - 1) return '';
  return path.slice(cut + 1).toLowerCase();
}

@Component
export struct WorkspaceFilesSheet {
  tools: SessionToolsClient | undefined = undefined;
  sessionId: string = '';
  @Prop dark: boolean = true;
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();
  onClose: () => void = () => {};
  onInsertMention: (path: string, isDir: boolean) => void = () => {};

  @State currentPath: string = '';
  @State entries: WorkspaceFileEntry[] = [];
  @State loading: boolean = false;
  @State uploading: boolean = false;
  @State errorMsg: string = '';

  @State previewPath: string = '';
  @State previewKind: string = ''; // '' | 'text' | 'image' | 'pdf'
  @State previewText: string = '';
  @State previewLang: string = '';
  @State previewHasMore: boolean = false;
  @State previewNextOffset: number = 1;
  @State previewPixel: image.PixelMap | undefined = undefined;
  @State previewLoading: boolean = false;
  @State previewError: string = '';
  @State missingFonts: string[] = [];
  private pdfController: pdfViewManager.PdfController = new pdfViewManager.PdfController();

  aboutToAppear(): void {
    this.loadDirectory('');
  }

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private async loadDirectory(path: string): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) {
      return;
    }
    this.loading = true;
    this.errorMsg = '';
    try {
      const dir = await this.tools.listFiles(this.sessionId, path);
      this.currentPath = path;
      const sorted = dir.entries.slice();
      sorted.sort((a: WorkspaceFileEntry, b: WorkspaceFileEntry) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
      this.entries = sorted;
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
    this.loading = false;
  }

  private goUp(): void {
    if (this.currentPath.length === 0 || this.currentPath === '.') {
      return;
    }
    const cut = this.currentPath.lastIndexOf('/');
    const parent = cut > 0 ? this.currentPath.slice(0, cut) : '';
    this.loadDirectory(parent);
  }

  private async uploadToWorkspace(): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0 || this.uploading) {
      return;
    }
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;
      const docPicker = new picker.DocumentViewPicker(context);
      const uris: string[] = await docPicker.select(options);
      if (uris.length === 0) return;
      this.uploading = true;
      this.errorMsg = '';
      const uri = uris[0];
      const cut = uri.lastIndexOf('/');
      const fileName = decodeURIComponent(cut >= 0 ? uri.slice(cut + 1) : 'upload.bin');
      const f = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      let bytes: Uint8Array;
      try {
        const stat = fileIo.statSync(f.fd);
        bytes = new Uint8Array(stat.size);
        fileIo.readSync(f.fd, bytes.buffer);
      } finally {
        fileIo.closeSync(f);
      }
      await this.tools.workspaceUploadFile(this.sessionId, fileName, bytes);
      promptAction.showToast({ message: t('已上传到工作区') });
      await this.loadDirectory(this.currentPath);
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : String(error);
    }
    this.uploading = false;
  }

  private async openPreview(entry: WorkspaceFileEntry): Promise<void> {
    if (this.tools === undefined || this.sessionId.length === 0) {
      return;
    }
    const full = this.currentPath.length > 0 ? this.currentPath + '/' + entry.name : entry.name;
    this.previewPath = full;
    this.previewText = '';
    this.previewPixel = undefined;
    this.previewError = '';
    this.missingFonts = [];
    this.previewHasMore = false;
    this.previewLoading = true;
    const ext = extOf(full);
    try {
      if (IMAGE_EXTS.has(ext)) {
        this.previewKind = 'image';
        const res = await this.tools.readBytes(this.sessionId, full, 0, 8 * 1024 * 1024);
        const src = image.createImageSource(res.data.buffer as ArrayBuffer);
        this.previewPixel = await src.createPixelMap();
      } else if (ext === 'pdf') {
        this.previewKind = 'pdf';
        const res = await this.tools.readBytes(this.sessionId, full, 0, 16 * 1024 * 1024);
        await this.loadPdfBytes(res.data);
      } else if (OFFICE_EXTS.has(ext)) {
        this.previewKind = 'pdf';
        const rendered: WorkspaceOfficeRender = await this.tools.renderOfficePdf(this.sessionId, full);
        this.missingFonts = rendered.missingFonts;
        await this.loadPdfBytes(rendered.data);
      } else {
        this.previewKind = 'text';
        this.previewLang = ext;
        const page = await this.tools.readFile(this.sessionId, full, 1, 200);
        this.previewText = page.text;
        this.previewHasMore = !page.eof;
        this.previewNextOffset = page.offset + Math.max(page.lines, 1);
      }
    } catch (error) {
      this.previewError = error instanceof Error ? error.message : String(error);
    }
    this.previewLoading = false;
  }

  private async loadMoreText(): Promise<void> {
    if (this.tools === undefined || !this.previewHasMore || this.previewLoading) {
      return;
    }
    this.previewLoading = true;
    try {
      const page = await this.tools.readFile(this.sessionId, this.previewPath, this.previewNextOffset, 200);
      this.previewText = this.previewText + (this.previewText.endsWith('\n') ? '' : '\n') + page.text;
      this.previewHasMore = !page.eof;
      this.previewNextOffset = page.offset + Math.max(page.lines, 1);
    } catch (error) {
      this.previewError = error instanceof Error ? error.message : String(error);
    }
    this.previewLoading = false;
  }

  private async loadPdfBytes(data: Uint8Array): Promise<void> {
    const ctx = getContext(this) as common.UIAbilityContext;
    const tmpPdf = `${ctx.cacheDir}/ws_preview_${randomId()}.pdf`;
    const f = fileIo.openSync(tmpPdf,
      fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    try {
      fileIo.writeSync(f.fd, data.buffer as ArrayBuffer);
    } finally {
      fileIo.closeSync(f);
    }
    await this.pdfController.loadDocument(tmpPdf);
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(this.pal.backdrop)
        .onClick(() => {
          this.onClose();
        })

      Column({ space: 10 }) {
        Row({ space: 8 }) {
          if (this.previewPath.length > 0) {
            Text('← ' + t('返回目录'))
              .fontSize(this.fs(12))
              .fontColor('#22D3EE')
              .padding({ left: 8, right: 8, top: 6, bottom: 6 })
              .backgroundColor(this.pal.chip)
              .borderRadius(8)
              .onClick(() => {
                this.previewPath = '';
                this.previewPixel = undefined;
              })
          } else if (this.currentPath.length > 0) {
            Text('↑ ' + t('上级'))
              .fontSize(this.fs(12))
              .fontColor(this.pal.text2)
              .padding({ left: 8, right: 8, top: 6, bottom: 6 })
              .backgroundColor(this.pal.chip)
              .borderRadius(8)
              .onClick(() => {
                this.goUp();
              })
          }
          Text(this.previewPath.length > 0
            ? this.previewPath
            : (this.currentPath.length > 0 ? this.currentPath : t('工作区根目录')))
            .fontSize(this.fs(13))
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal.text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          if (this.previewPath.length === 0) {
            Text(this.uploading ? t('上传中…') : t('上传文件'))
              .fontSize(this.fs(12))
              .fontColor('#22D3EE')
              .padding({ left: 8, right: 8, top: 6, bottom: 6 })
              .backgroundColor('rgba(34,211,238,0.12)')
              .borderRadius(8)
              .onClick(() => {
                this.uploadToWorkspace();
              })
          } else {
            Text('@ ' + t('引用'))
              .fontSize(this.fs(12))
              .fontColor('#22D3EE')
              .padding({ left: 8, right: 8, top: 6, bottom: 6 })
              .backgroundColor('rgba(34,211,238,0.12)')
              .borderRadius(8)
              .onClick(() => {
                this.onInsertMention(this.previewPath, false);
                this.onClose();
              })
          }
          Text('✕')
            .fontSize(this.fs(14))
            .fontColor(this.pal.text3)
            .padding({ left: 6, right: 4, top: 4, bottom: 4 })
            .onClick(() => {
              this.onClose();
            })
        }
        .width('100%')

        if (this.errorMsg.length > 0 || this.previewError.length > 0) {
          Text(this.previewError.length > 0 ? this.previewError : this.errorMsg)
            .fontSize(this.fs(12))
            .fontColor('#F85749')
            .width('100%')
        }

        if (this.loading || this.previewLoading) {
          Row({ space: 8 }) {
            LoadingProgress().width(16).height(16).color('#22D3EE')
            Text(t('加载中…')).fontSize(this.fs(12)).fontColor(this.pal.text2)
          }
          .width('100%')
          .padding(12)
        } else if (this.previewPath.length > 0) {
          if (this.previewKind === 'image' && this.previewPixel !== undefined) {
            Image(this.previewPixel)
              .width('100%')
              .layoutWeight(1)
              .objectFit(ImageFit.Contain)
          } else if (this.previewKind === 'pdf') {
            Column({ space: 6 }) {
              if (this.missingFonts.length > 0) {
                Text(t('缺少字体：') + this.missingFonts.join(', '))
                  .fontSize(this.fs(11))
                  .fontColor('#F5A623')
                  .width('100%')
              }
              PdfView({ controller: this.pdfController })
                .width('100%')
                .layoutWeight(1)
            }
            .width('100%')
            .layoutWeight(1)
          } else {
            Column({ space: 6 }) {
              Scroll() {
                Text() {
                  ForEach(highlightCode(this.previewText, this.previewLang), (tok: SyntaxToken, i: number) => {
                    Span(tok.text)
                      .fontColor(syntaxColorFor(this.dark ? darkCodePalette() : lightCodePalette(), tok.kind))
                      .fontSize(this.fs(12))
                      .fontFamily('monospace')
                  }, (tok: SyntaxToken, i: number) => i + ':' + tok.kind + ':' + tok.text.length)
                }
                .copyOption(CopyOptions.LocalDevice)
                .textAlign(TextAlign.Start)
                .width('100%')
                .padding(10)
              }
              .layoutWeight(1)
              .width('100%')
              .backgroundColor(this.dark ? '#131720' : '#F6F8FB')
              .borderRadius(10)

              Row({ space: 10 }) {
                if (this.previewHasMore) {
                  Text(t('加载更多行'))
                    .fontSize(this.fs(12))
                    .fontColor('#22D3EE')
                    .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                    .backgroundColor(this.pal.chip)
                    .borderRadius(8)
                    .onClick(() => {
                      this.loadMoreText();
                    })
                }
                Blank()
                Text(t('复制文本'))
                  .fontSize(this.fs(12))
                  .fontColor(this.pal.text2)
                  .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                  .backgroundColor(this.pal.chip)
                  .borderRadius(8)
                  .onClick(() => {
                    const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.previewText);
                    pasteboard.getSystemPasteboard().setData(data).then(() => {
                      promptAction.showToast({ message: t('已复制') });
                    }).catch(() => undefined);
                  })
              }
              .width('100%')
            }
            .width('100%')
            .layoutWeight(1)
          }
        } else {
          List({ space: 4 }) {
            ForEach(this.entries, (entry: WorkspaceFileEntry) => {
              ListItem() {
                Row({ space: 10 }) {
                  Text(entry.type === 'directory' ? '📁' : '📄')
                    .fontSize(this.fs(14))
                  Text(entry.name)
                    .fontSize(this.fs(13))
                    .fontColor(this.pal.text)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                  if (entry.type !== 'directory' && entry.size >= 0) {
                    Text(Math.max(1, Math.round(entry.size / 1024)) + ' KB')
                      .fontSize(this.fs(10))
                      .fontColor(this.pal.text3)
                  }
                  Text('@')
                    .fontSize(this.fs(12))
                    .fontColor('#22D3EE')
                    .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                    .backgroundColor('rgba(34,211,238,0.10)')
                    .borderRadius(6)
                    .onClick(() => {
                      const full = this.currentPath.length > 0 ? this.currentPath + '/' + entry.name : entry.name;
                      this.onInsertMention(full, entry.type === 'directory');
                      this.onClose();
                    })
                }
                .width('100%')
                .padding({ left: 10, right: 10, top: 10, bottom: 10 })
                .backgroundColor(this.pal.card)
                .borderRadius(10)
                .onClick(() => {
                  if (entry.type === 'directory') {
                    const sub = this.currentPath.length > 0 ? this.currentPath + '/' + entry.name : entry.name;
                    this.loadDirectory(sub);
                  } else {
                    this.openPreview(entry);
                  }
                })
              }
            }, (entry: WorkspaceFileEntry) => entry.type + ':' + entry.name)
          }
          .layoutWeight(1)
          .width('100%')
        }
      }
      .width('100%')
      .height('78%')
      .constraintSize({ maxWidth: 640 })
      .padding({ left: 16, right: 16, top: 14, bottom: 18 })
      .backgroundColor(this.pal.panel)
      .borderRadius({ topLeft: 20, topRight: 20 })
      .border({ width: { top: 0.5 }, color: this.pal.borderStrong })
    }
    .width('100%')
    .height('100%')
  }
}
