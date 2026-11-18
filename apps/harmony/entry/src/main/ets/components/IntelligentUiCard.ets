import { Palette } from '../services/Theme';
import { t } from '../services/I18n';
import { asArray, asBool, asNum, asRecord, asStr, jsonNum, jsonStr } from '../protocol/Types';
import {
  UiActionGuard, UiArtifactSnapshot, extractCatalogChildren, extractCatalogStr,
  indexCatalogNodes, isSafeBotViewTree
} from '../util/UiArtifacts';

function toneColor(tone: string, pal: Palette): string {
  if (tone === 'bad' || tone === 'danger' || tone === 'error') return '#F87171';
  if (tone === 'warn' || tone === 'warning') return '#F5A623';
  if (tone === 'good' || tone === 'success') return '#34D399';
  if (tone === 'accent' || tone === 'info' || tone === 'primary') return '#22D3EE';
  if (tone === 'muted') return pal.text3;
  return pal.text;
}

function nodePropObj(node: Record<string, Object>): Record<string, Object> {
  const p = asRecord(node['props']);
  return p !== undefined ? p : node;
}

/**
 * Recursive ArkUI renderer for Intelligent UI declarative catalog trees.
 * Bounded at depth <= 12 to prevent pathological cycles.
 */
@Component
struct CatalogNodeView {
  @Prop nodeId: string = '';
  @Prop depth: number = 0;
  @Prop fontScale: number = 1;
  nodeMapJson: string = '{}';
  nodesMap: Map<string, Record<string, Object>> = new Map<string, Record<string, Object>>();
  pal: Palette = new Palette();
  onAction: (actionLabel: string, promptText: string) => void = () => {};

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private getNode(): Record<string, Object> | undefined {
    return this.nodesMap.get(this.nodeId);
  }

  build() {
    if (this.depth > 12 || this.getNode() === undefined) {
      Column()
    } else {
      this.renderNode(this.getNode()!)
    }
  }

  @Builder
  renderNode(node: Record<string, Object>) {
    if (jsonStr(node, 'type', '').toLowerCase() === 'row') {
      Row({ space: 8 }) {
        ForEach(extractCatalogChildren(node), (cid: string) => {
          Column() {
            CatalogNodeView({
              nodeId: cid,
              depth: this.depth + 1,
              fontScale: this.fontScale,
              nodesMap: this.nodesMap,
              pal: this.pal,
              onAction: this.onAction
            })
          }
          .layoutWeight(1)
        }, (cid: string) => cid + ':' + this.depth)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
    } else if (jsonStr(node, 'type', '').toLowerCase() === 'card') {
      Column({ space: 6 }) {
        if (extractCatalogStr(node, 'title', '').length > 0) {
          Text(extractCatalogStr(node, 'title', ''))
            .fontSize(this.fs(13))
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal.text)
        }
        ForEach(extractCatalogChildren(node), (cid: string) => {
          CatalogNodeView({
            nodeId: cid,
            depth: this.depth + 1,
            fontScale: this.fontScale,
            nodesMap: this.nodesMap,
            pal: this.pal,
            onAction: this.onAction
          })
        }, (cid: string) => cid + ':' + this.depth)
      }
      .width('100%')
      .padding(10)
      .backgroundColor(this.pal.chip)
      .borderRadius(10)
      .border({ width: 0.5, color: this.pal.border })
      .alignItems(HorizontalAlign.Start)
    } else if (jsonStr(node, 'type', '').toLowerCase() === 'heading'
      || jsonStr(node, 'type', '').toLowerCase() === 'title') {
      Text(extractCatalogStr(node, 'text', extractCatalogStr(node, 'label', '')))
        .fontSize(this.fs(15))
        .fontWeight(FontWeight.Bold)
        .fontColor(this.pal.text)
        .width('100%')
    } else if (jsonStr(node, 'type', '').toLowerCase() === 'text'
      || jsonStr(node, 'type', '').toLowerCase() === 'markdown'
      || jsonStr(node, 'type', '').toLowerCase() === 'callout') {
      Text(extractCatalogStr(node, 'text', extractCatalogStr(node, 'content', '')))
        .fontSize(this.fs(13))
        .fontColor(toneColor(extractCatalogStr(node, 'tone', ''), this.pal))
        .lineHeight(this.fs(19))
        .width('100%')
    } else if (jsonStr(node, 'type', '').toLowerCase() === 'badge'
      || jsonStr(node, 'type', '').toLowerCase() === 'tag') {
      Text(extractCatalogStr(node, 'label', extractCatalogStr(node, 'text', '')))
        .fontSize(this.fs(11))
        .fontWeight(FontWeight.Medium)
        .fontColor(toneColor(extractCatalogStr(node, 'tone', 'accent'), this.pal))
        .padding({ left: 8, right: 8, top: 3, bottom: 3 })
        .backgroundColor(this.pal.chip)
        .borderRadius(8)
    } else if (jsonStr(node, 'type', '').toLowerCase() === 'metric'
      || jsonStr(node, 'type', '').toLowerCase() === 'stat'
      || jsonStr(node, 'type', '').toLowerCase() === 'kpi') {
      Column({ space: 2 }) {
        if (extractCatalogStr(node, 'label', '').length > 0) {
          Text(extractCatalogStr(node, 'label', ''))
            .fontSize(this.fs(11))
            .fontColor(this.pal.text3)
        }
        Text(extractCatalogStr(node, 'value', '—'))
          .fontSize(this.fs(18))
          .fontWeight(FontWeight.Bold)
          .fontColor(toneColor(extractCatalogStr(node, 'tone', ''), this.pal))
        if (extractCatalogStr(node, 'caption', '').length > 0) {
          Text(extractCatalogStr(node, 'caption', ''))
            .fontSize(this.fs(11))
            .fontColor(this.pal.text2)
        }
      }
      .padding(8)
      .backgroundColor(this.pal.chip)
      .borderRadius(8)
      .alignItems(HorizontalAlign.Start)
    } else if (jsonStr(node, 'type', '').toLowerCase() === 'progress') {
      Column({ space: 4 }) {
        Row() {
          Text(extractCatalogStr(node, 'label', t('进度')))
            .fontSize(this.fs(12))
            .fontColor(this.pal.text2)
          Blank()
          Text(`${Math.max(0, Math.min(100, Math.round(jsonNum(nodePropObj(node), 'percent', jsonNum(nodePropObj(node), 'value', 0)))))}%`)
            .fontSize(this.fs(12))
            .fontColor('#22D3EE')
        }
        .width('100%')
        Progress({
          value: Math.max(0, Math.min(100, jsonNum(nodePropObj(node), 'percent', jsonNum(nodePropObj(node), 'value', 0)))),
          total: 100,
          type: ProgressType.Linear
        })
          .width('100%')
          .color('#22D3EE')
      }
      .width('100%')
    } else if (jsonStr(node, 'type', '').toLowerCase() === 'button'
      || jsonStr(node, 'type', '').toLowerCase() === 'action') {
      Text(extractCatalogStr(node, 'label', t('执行操作')))
        .fontSize(this.fs(13))
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFF')
        .padding({ left: 14, right: 14, top: 8, bottom: 8 })
        .backgroundColor('#1E6CEB')
        .borderRadius(10)
        .onClick(() => {
          const label = extractCatalogStr(node, 'label', t('执行操作'));
          const promptText = extractCatalogStr(node, 'prompt', extractCatalogStr(node, 'action', label));
          this.onAction(label, promptText);
        })
    } else if (jsonStr(node, 'type', '').toLowerCase() === 'table') {
      this.renderTable(nodePropObj(node))
    } else {
      // Fallback for Stack / Container / Grid / ChoiceGroup / unknown containers with children
      Column({ space: 6 }) {
        if (extractCatalogStr(node, 'label', extractCatalogStr(node, 'title', '')).length > 0) {
          Text(extractCatalogStr(node, 'label', extractCatalogStr(node, 'title', '')))
            .fontSize(this.fs(12))
            .fontWeight(FontWeight.Medium)
            .fontColor(this.pal.text2)
        }
        if (extractCatalogStr(node, 'text', '').length > 0) {
          Text(extractCatalogStr(node, 'text', ''))
            .fontSize(this.fs(13))
            .fontColor(this.pal.text)
        }
        ForEach(extractCatalogChildren(node), (cid: string) => {
          CatalogNodeView({
            nodeId: cid,
            depth: this.depth + 1,
            fontScale: this.fontScale,
            nodesMap: this.nodesMap,
            pal: this.pal,
            onAction: this.onAction
          })
        }, (cid: string) => cid + ':' + this.depth)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  renderTable(props: Record<string, Object>) {
    Scroll() {
      Column() {
        Row({ space: 12 }) {
          ForEach(asArray(props['columns']) ?? [], (col: Object, idx: number) => {
            Text(asRecord(col) !== undefined
              ? jsonStr(asRecord(col)!, 'label', jsonStr(asRecord(col)!, 'key', ''))
              : String(col))
              .fontSize(this.fs(11))
              .fontWeight(FontWeight.Medium)
              .fontColor(this.pal.text2)
              .width(96)
          }, (col: Object, idx: number) => 'h:' + idx)
        }
        .padding({ left: 8, right: 8, top: 6, bottom: 6 })
        .backgroundColor(this.pal.chip)

        ForEach(asArray(props['rows']) ?? [], (row: Object, rIdx: number) => {
          Row({ space: 12 }) {
            ForEach(asArray(row) ?? [], (cell: Object, cIdx: number) => {
              Text(asStr(cell) ?? String(cell))
                .fontSize(this.fs(12))
                .fontColor(this.pal.text)
                .width(96)
                .maxLines(3)
            }, (cell: Object, cIdx: number) => 'c:' + rIdx + ':' + cIdx)
          }
          .padding({ left: 8, right: 8, top: 6, bottom: 6 })
          .border({ width: { top: 0.5 }, color: this.pal.border })
        }, (row: Object, rIdx: number) => 'r:' + rIdx)
      }
      .alignItems(HorizontalAlign.Start)
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .width('100%')
    .border({ width: 0.5, color: this.pal.border })
    .borderRadius(8)
  }
}

/**
 * Native Intelligent UI Artifact Card (projected from ui_render / ui_patch / ui_compose / ui_render_widget).
 * Enforces UiActionGuard throttling & explicit user confirmation before dispatching model prompts.
 */
@Component
export struct IntelligentUiArtifactCard {
  snapshot: UiArtifactSnapshot = new UiArtifactSnapshot();
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();
  onSendPrompt: (promptText: string) => void = () => {};

  @State pendingPrompt: string = '';
  @State pendingLabel: string = '';
  private guard: UiActionGuard = new UiActionGuard();
  private actionSeq: number = 0;

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  private requestConfirm(label: string, promptText: string): void {
    const id = ++this.actionSeq;
    if (!this.guard.admit(id, Date.now())) {
      return;
    }
    this.pendingLabel = label;
    this.pendingPrompt = promptText;
  }

  private cancelConfirm(): void {
    this.guard.finish(this.actionSeq);
    this.pendingPrompt = '';
    this.pendingLabel = '';
  }

  private submitConfirm(): void {
    const text = this.pendingPrompt;
    this.guard.finish(this.actionSeq);
    this.pendingPrompt = '';
    this.pendingLabel = '';
    if (text.length > 0) {
      this.onSendPrompt(text);
    }
  }

  build() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        Text('✨')
          .fontSize(this.fs(12))
        Text(this.snapshot.title.length > 0 ? this.snapshot.title : t('智能交互卡片'))
          .fontSize(this.fs(13))
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal.text)
          .layoutWeight(1)
        Text('v' + this.snapshot.version)
          .fontSize(this.fs(10))
          .fontColor('#22D3EE')
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .backgroundColor('rgba(34,211,238,0.12)')
          .borderRadius(6)
      }
      .width('100%')

      if (this.snapshot.kind === 'declarative') {
        CatalogNodeView({
          nodeId: jsonStr(this.snapshot.definition, 'root', ''),
          depth: 0,
          fontScale: this.fontScale,
          nodesMap: indexCatalogNodes(this.snapshot.definition),
          pal: this.pal,
          onAction: (label: string, promptText: string) => {
            this.requestConfirm(label, promptText);
          }
        })
      } else if (this.snapshot.kind === 'composition') {
        ForEach(asArray(this.snapshot.definition['blocks']) ?? [], (rawBlock: Object, idx: number) => {
          if (asRecord(rawBlock) !== undefined) {
            if (jsonStr(asRecord(rawBlock)!, 'type', '') === 'markdown') {
              Text(jsonStr(asRecord(rawBlock)!, 'text', ''))
                .fontSize(this.fs(13))
                .fontColor(this.pal.text)
                .lineHeight(this.fs(19))
                .width('100%')
            } else if (jsonStr(asRecord(rawBlock)!, 'type', '') === 'catalog') {
              CatalogNodeView({
                nodeId: jsonStr(asRecord(rawBlock)!, 'root', ''),
                depth: 0,
                fontScale: this.fontScale,
                nodesMap: indexCatalogNodes(asRecord(rawBlock)!),
                pal: this.pal,
                onAction: (label: string, promptText: string) => {
                  this.requestConfirm(label, promptText);
                }
              })
            } else {
              Text(t('Widget HTML 片段已在安全边界内跳过渲染'))
                .fontSize(this.fs(11))
                .fontColor(this.pal.text3)
            }
          }
        }, (rawBlock: Object, idx: number) => 'blk:' + idx)
      } else {
        Column({ space: 4 }) {
          if (jsonStr(this.snapshot.definition, 'summary', '').length > 0) {
            Text(jsonStr(this.snapshot.definition, 'summary', ''))
              .fontSize(this.fs(13))
              .fontColor(this.pal.text)
          }
          Text(t('交互式 HTML 小组件已在沙箱摘要模式下展示'))
            .fontSize(this.fs(11))
            .fontColor(this.pal.text3)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }

      if (this.pendingPrompt.length > 0) {
        Column({ space: 6 }) {
          Text(t('确认向会话发送此操作指令？'))
            .fontSize(this.fs(12))
            .fontWeight(FontWeight.Medium)
            .fontColor('#F5A623')
          Text(this.pendingPrompt)
            .fontSize(this.fs(12))
            .fontColor(this.pal.text2)
            .maxLines(3)
          Row({ space: 8 }) {
            Blank()
            Text(t('取消'))
              .fontSize(this.fs(12))
              .fontColor(this.pal.text2)
              .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .backgroundColor(this.pal.chip)
              .borderRadius(8)
              .onClick(() => {
                this.cancelConfirm();
              })
            Text(t('确认发送'))
              .fontSize(this.fs(12))
              .fontColor('#FFFFFF')
              .padding({ left: 12, right: 12, top: 5, bottom: 5 })
              .backgroundColor('#1E6CEB')
              .borderRadius(8)
              .onClick(() => {
                this.submitConfirm();
              })
          }
          .width('100%')
        }
        .width('100%')
        .padding(10)
        .backgroundColor(this.pal.inputBg)
        .borderRadius(10)
        .border({ width: 0.8, color: 'rgba(245,166,35,0.45)' })
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(12)
    .backgroundColor(this.pal.card)
    .borderRadius(14)
    .border({ width: 0.8, color: 'rgba(34,211,238,0.35)' })
    .alignItems(HorizontalAlign.Start)
  }
}

/**
 * Native DS-Bot View Card matching Android BotViewCard controls
 * (`stack`, `row`, `text`, `callout`, `metric`, `progress`, `table`, `choice`, `options`, `confirm`, `form`, `toggle`, `number`/`slider`, `submit`).
 */
@Component
export struct BotInteractiveViewCard {
  viewId: string = '';
  title: string = '';
  rawView: Record<string, Object> = {};
  @Prop busy: boolean = false;
  @Prop fontScale: number = 1;
  pal: Palette = new Palette();
  onReply: (action: string, values: Record<string, Object>) => void = () => {};
  onDismiss: () => void = () => {};

  @State selectedOptions: string[] = [];
  @State fieldValues: Record<string, string> = {};
  @State boolValues: Record<string, boolean> = {};
  @State numValues: Record<string, number> = {};

  private fs(base: number): number {
    return Math.round(base * this.fontScale * 10) / 10;
  }

  build() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text(this.title.length > 0 ? this.title : t('交互视图'))
          .fontSize(this.fs(14))
          .fontWeight(FontWeight.Medium)
          .fontColor(this.pal.text)
          .layoutWeight(1)
        Text('✕')
          .fontSize(this.fs(13))
          .fontColor(this.pal.text3)
          .padding(4)
          .onClick(() => {
            if (!this.busy) {
              this.onDismiss();
            }
          })
      }
      .width('100%')

      if (!isSafeBotViewTree(this.rawView)) {
        Text(t('视图结构超出安全限制'))
          .fontSize(this.fs(12))
          .fontColor(this.pal.text3)
      } else {
        this.renderViewNode(this.rawView, 0)
      }
    }
    .width('100%')
    .padding(12)
    .backgroundColor(this.pal.card)
    .borderRadius(14)
    .border({ width: 0.8, color: this.pal.borderStrong })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  renderViewNode(node: Record<string, Object>, depth: number) {
    if (depth > 12) {
      Column()
    } else if (jsonStr(node, 'type', '') === 'stack' || jsonStr(node, 'type', '') === 'row') {
      Column({ space: 6 }) {
        ForEach(asArray(node['children']) ?? [], (child: Object, idx: number) => {
          if (asRecord(child) !== undefined) {
            this.renderViewNode(asRecord(child)!, depth + 1)
          }
        }, (child: Object, idx: number) => 'vn:' + depth + ':' + idx)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    } else if (jsonStr(node, 'type', '') === 'text' || jsonStr(node, 'type', '') === 'callout') {
      Text(jsonStr(node, 'text', ''))
        .fontSize(this.fs(13))
        .fontColor(toneColor(jsonStr(node, 'tone', ''), this.pal))
        .lineHeight(this.fs(19))
    } else if (jsonStr(node, 'type', '') === 'metric') {
      Column({ space: 2 }) {
        Text(jsonStr(node, 'label', ''))
          .fontSize(this.fs(11))
          .fontColor(this.pal.text3)
        Text(jsonStr(node, 'value', '—'))
          .fontSize(this.fs(17))
          .fontWeight(FontWeight.Bold)
          .fontColor(toneColor(jsonStr(node, 'tone', ''), this.pal))
      }
      .alignItems(HorizontalAlign.Start)
    } else if (jsonStr(node, 'type', '') === 'confirm') {
      Row({ space: 8 }) {
        Text(jsonStr(node, 'cancelLabel', t('拒绝')))
          .fontSize(this.fs(13))
          .fontColor(this.pal.text)
          .padding({ left: 14, right: 14, top: 8, bottom: 8 })
          .backgroundColor(this.pal.chip)
          .borderRadius(10)
          .onClick(() => {
            if (!this.busy) this.onReply(jsonStr(node, 'id', 'confirm'), { 'confirmed': false });
          })
        Text(jsonStr(node, 'confirmLabel', t('确认')))
          .fontSize(this.fs(13))
          .fontColor('#FFFFFF')
          .padding({ left: 14, right: 14, top: 8, bottom: 8 })
          .backgroundColor('#1E6CEB')
          .borderRadius(10)
          .onClick(() => {
            if (!this.busy) this.onReply(jsonStr(node, 'id', 'confirm'), { 'confirmed': true });
          })
      }
    } else if (jsonStr(node, 'type', '') === 'options') {
      Column({ space: 6 }) {
        ForEach(asArray(node['options']) ?? [], (rawOpt: Object, idx: number) => {
          if (asRecord(rawOpt) !== undefined) {
            Text(jsonStr(asRecord(rawOpt)!, 'label', ''))
              .fontSize(this.fs(13))
              .fontColor(this.selectedOptions.includes(jsonStr(asRecord(rawOpt)!, 'label', '')) ? '#22D3EE' : this.pal.text)
              .padding({ left: 10, right: 10, top: 7, bottom: 7 })
              .width('100%')
              .backgroundColor(this.selectedOptions.includes(jsonStr(asRecord(rawOpt)!, 'label', ''))
                ? 'rgba(34,211,238,0.14)' : this.pal.chip)
              .borderRadius(9)
              .onClick(() => {
                const lbl = jsonStr(asRecord(rawOpt)!, 'label', '');
                if (asBool(node['multi']) === true) {
                  this.selectedOptions = this.selectedOptions.includes(lbl)
                    ? this.selectedOptions.filter((s: string) => s !== lbl)
                    : this.selectedOptions.concat([lbl]);
                } else {
                  this.selectedOptions = [lbl];
                }
              })
          }
        }, (rawOpt: Object, idx: number) => 'opt:' + idx)
        Text(t('提交'))
          .fontSize(this.fs(13))
          .fontColor('#FFFFFF')
          .padding({ left: 16, right: 16, top: 8, bottom: 8 })
          .backgroundColor(this.selectedOptions.length > 0 ? '#1E6CEB' : this.pal.text3)
          .borderRadius(10)
          .onClick(() => {
            if (!this.busy && this.selectedOptions.length > 0) {
              this.onReply(jsonStr(node, 'id', 'options'), { 'selected': this.selectedOptions });
            }
          })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    } else if (jsonStr(node, 'type', '') === 'form') {
      Column({ space: 6 }) {
        ForEach(asArray(node['fields']) ?? [], (rawField: Object, idx: number) => {
          if (asRecord(rawField) !== undefined) {
            Column({ space: 2 }) {
              Text(jsonStr(asRecord(rawField)!, 'label', ''))
                .fontSize(this.fs(12))
                .fontColor(this.pal.text2)
              TextInput({
                text: this.fieldValues[jsonStr(asRecord(rawField)!, 'id', 'f' + idx)] ?? '',
                placeholder: jsonStr(asRecord(rawField)!, 'placeholder', '')
              })
                .height(36)
                .fontSize(this.fs(13))
                .backgroundColor(this.pal.inputBg)
                .fontColor(this.pal.text)
                .borderRadius(8)
                .onChange((val: string) => {
                  const key = jsonStr(asRecord(rawField)!, 'id', 'f' + idx);
                  const next: Record<string, string> = {};
                  for (const k of Object.keys(this.fieldValues)) next[k] = this.fieldValues[k];
                  next[key] = val;
                  this.fieldValues = next;
                })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }
        }, (rawField: Object, idx: number) => 'fld:' + idx)
        Text(jsonStr(node, 'submitLabel', t('提交')))
          .fontSize(this.fs(13))
          .fontColor('#FFFFFF')
          .padding({ left: 16, right: 16, top: 8, bottom: 8 })
          .backgroundColor('#1E6CEB')
          .borderRadius(10)
          .onClick(() => {
            if (!this.busy) {
              const fieldsObj: Record<string, Object> = {};
              for (const k of Object.keys(this.fieldValues)) fieldsObj[k] = this.fieldValues[k];
              this.onReply(jsonStr(node, 'id', 'form'), { 'fields': fieldsObj });
            }
          })
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    } else if (jsonStr(node, 'type', '') === 'submit') {
      Text(jsonStr(node, 'label', t('提交')))
        .fontSize(this.fs(13))
        .fontColor('#FFFFFF')
        .padding({ left: 16, right: 16, top: 8, bottom: 8 })
        .backgroundColor('#1E6CEB')
        .borderRadius(10)
        .onClick(() => {
          if (!this.busy) this.onReply(jsonStr(node, 'id', 'submit'), {});
        })
    } else if (jsonStr(node, 'type', '') === 'html') {
      Column({ space: 4 }) {
        if (jsonStr(node, 'summary', '').length > 0) {
          Text(jsonStr(node, 'summary', ''))
            .fontSize(this.fs(13))
            .fontColor(this.pal.text)
        }
        Text(t('HTML 视图已在移动端安全摘要模式下展示'))
          .fontSize(this.fs(11))
          .fontColor(this.pal.text3)
      }
      .alignItems(HorizontalAlign.Start)
    } else {
      Text(jsonStr(node, 'label', jsonStr(node, 'text', jsonStr(node, 'type', ''))))
        .fontSize(this.fs(12))
        .fontColor(this.pal.text2)
    }
  }
}
