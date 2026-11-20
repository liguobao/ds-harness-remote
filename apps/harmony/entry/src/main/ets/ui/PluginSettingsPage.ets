import { PluginSettingField, PluginSettingOperation, PluginSettingsForm } from '../net/PluginSettings';
import { t } from '../services/I18n';
import { lightPalette, Palette } from '../services/Theme';
import { ScreenHeader } from './ScreenHeader';

@Component
export struct PluginSettingsPage {
  @Prop palette: Palette = lightPalette();
  @Prop title: string = '';
  form: PluginSettingsForm = new PluginSettingsForm();
  onBack: () => void = () => {};
  onSaved: () => void = () => {};
  onSave: (ops: PluginSettingOperation[]) => Promise<void> = async () => {};
  @State saving: boolean = false;
  @State error: string = '';
  @State changed: number = 0;
  private draft: Map<string, string> = new Map<string, string>();
  private active: boolean = false;

  aboutToAppear(): void {
    this.active = true;
  }

  aboutToDisappear(): void {
    this.active = false;
    this.draft.clear();
  }

  private update(field: PluginSettingField, value: string): void {
    if (value === field.value) {
      this.draft.delete(field.key);
    } else {
      this.draft.set(field.key, value);
    }
    this.changed = this.draft.size;
    this.error = '';
  }

  private async save(reset: boolean): Promise<void> {
    if (this.saving || !this.form.writable) {
      return;
    }
    const changes: PluginSettingOperation[] = [];
    for (const field of this.form.fields) {
      if (reset) {
        if (field.hasOverride) {
          changes.push(new PluginSettingOperation(field.key, undefined));
        }
        continue;
      }
      const draft = this.draft.get(field.key);
      if (draft === undefined) {
        continue;
      }
      const value = field.encode(draft);
      if (value === undefined) {
        this.error = t('请检查字段') + ' ' + field.key;
        return;
      }
      changes.push(new PluginSettingOperation(field.key, value));
    }
    if (changes.length === 0) {
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await this.onSave(changes);
      if (this.active) {
        this.onSaved();
      }
    } catch {
      if (this.active) {
        this.error = t('无法保存插件设置，请重新打开页面后重试。');
      }
    } finally {
      this.saving = false;
    }
  }

  private confirmReset(): void {
    AlertDialog.show({
      title: t('恢复插件默认设置'),
      message: t('主机上此插件的自定义设置将被清除。'),
      primaryButton: { value: t('取消'), action: () => {} },
      secondaryButton: { value: t('恢复默认'), action: () => { this.save(true); } }
    });
  }

  @Builder
  Field(field: PluginSettingField) {
    Column({ space: 6 }) {
      Row({ space: 10 }) {
        Column({ space: 4 }) {
          Text(field.description || field.key).fontSize(15).fontColor(this.palette.text)
          if (field.description.length > 0) {
            Text(field.key).fontSize(12).fontColor(this.palette.text3)
          }
        }
        .layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (field.kind === 'boolean') {
          Toggle({ type: ToggleType.Switch, isOn: field.value === 'true' })
            .selectedColor(this.palette.primary)
            .enabled(this.form.writable && !this.saving)
            .onChange((checked: boolean) => { this.update(field, String(checked)); })
        }
      }
      .width('100%')
      if (field.kind === 'string-list') {
        TextArea({ text: field.value, placeholder: t('每行一项') })
          .height(84).padding({ left: 10, right: 10 }).fontSize(14)
          .fontColor(this.palette.text).backgroundColor(this.palette.inputBg)
          .enabled(this.form.writable && !this.saving)
          .onChange((value: string) => { this.update(field, value); })
      } else if (field.kind !== 'boolean') {
        TextInput({ text: field.value })
          .height(44).padding({ left: 10, right: 10 }).fontSize(14)
          .fontColor(this.palette.text).backgroundColor(this.palette.inputBg)
          .enabled(this.form.writable && !this.saving)
          .onChange((value: string) => { this.update(field, value); })
      }
    }
    .width('100%').padding(14).alignItems(HorizontalAlign.Start)
    .border({ width: { bottom: 0.5 }, color: this.palette.border })
  }

  build() {
    Column() {
      ScreenHeader({ palette: this.palette, title: this.title || t('插件设置'), onBack: this.onBack })
      Scroll() {
        Column({ space: 14 }) {
          Text(t(this.form.writable ? '插件设置' : '插件设置为只读'))
            .fontSize(14).fontColor(this.palette.text2).width('100%').padding({ left: 12 })
          Column() {
            ForEach(this.form.fields, (field: PluginSettingField) => {
              this.Field(field)
            }, (field: PluginSettingField) => field.key)
          }
          .width('100%').backgroundColor(this.palette.card).borderRadius(18).clip(true)
          if (this.error.length > 0) {
            Text(this.error).fontSize(14).fontColor(this.palette.danger).width('100%')
          }
          if (this.form.writable) {
            Row({ space: 8 }) {
              Button(t('保存')).height(42).backgroundColor(this.palette.primary)
                .enabled(this.changed > 0 && !this.saving).onClick(() => { this.save(false); })
              if (this.form.fields.some((field: PluginSettingField) => field.hasOverride)) {
                Button(t('恢复默认')).height(42).backgroundColor(this.palette.card).fontColor(this.palette.danger)
                  .enabled(!this.saving).onClick(() => { this.confirmReset(); })
              }
            }
            .width('100%')
          }
        }
        .width('100%').padding({ top: 10, bottom: 16 })
      }
      .width('100%').layoutWeight(1).align(Alignment.Top)
    }
    .width('100%').height('100%').padding({ left: 16, right: 16 }).backgroundColor(this.palette.bg)
  }
}
