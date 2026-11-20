import { PluginSettingsForm } from './PluginSettings';
import { asArray, asRecord, jsonStr } from '../protocol/Types';

export class HostPluginRow {
  entryId: string = '';
  settings: PluginSettingsForm | undefined = undefined;
  name: string = '';
  title: string = '';
  enabled: boolean = false;
  writable: boolean = false;
}

export class HostPluginBundle {
  name: string = '';
  title: string = '';
  description: string = '';
  version: string = '';
  category: string = '';
  enabled: boolean = false;
  available: boolean = false;
  writable: boolean = false;
  rows: HostPluginRow[] = [];
}

function isRemoteModule(name: string): boolean {
  return /^(?:@dsh-remote\/plugin|ds-harness-remote|dsh-remote)(?:\/|$)/.test(name);
}

export function readPluginInventory(bundlesValue: Object, pluginsValue: Object,
  settings: Map<string, PluginSettingsForm>): HostPluginBundle[] {
  const bundles = asArray(bundlesValue);
  const plugins = asArray(pluginsValue);
  if (bundles === undefined || plugins === undefined) {
    throw new Error('INVALID_MESSAGE');
  }
  const live = new Map<string, Record<string, Object>>();
  for (const item of plugins) {
    const entry = asRecord(item);
    if (entry !== undefined && typeof entry['entryId'] === 'string') {
      live.set(entry['entryId'] as string, entry);
    }
  }
  const inventory: HostPluginBundle[] = [];
  for (const item of bundles) {
    const record = asRecord(item);
    if (record === undefined) {
      continue;
    }
    const name = jsonStr(record, 'name', '');
    const availability = jsonStr(record, 'availability', '');
    if (name.length === 0 || isRemoteModule(name)) {
      continue;
    }
    const bundle = new HostPluginBundle();
    bundle.name = name;
    bundle.category = name === 'ds-bot' || name === 'deepseek-harness-intelligent-ui' ? 'remote'
      : record['optional'] === true ? 'experimental' : availability === 'profile' ? 'installed' : '';
    if (bundle.category.length === 0) {
      continue;
    }
    const meta = asRecord(record['meta']);
    bundle.title = meta === undefined ? name : jsonStr(meta, 'title', name);
    bundle.description = meta === undefined ? '' : jsonStr(meta, 'description', '');
    bundle.version = jsonStr(record, 'version', '');
    bundle.available = availability !== 'missing';
    bundle.enabled = record['enabled'] === true;
    bundle.writable = bundle.available && record['readOnlyReason'] === undefined;
    for (const itemRow of asArray(record['rows']) ?? []) {
      const rowRecord = asRecord(itemRow);
      if (rowRecord === undefined) {
        continue;
      }
      const row = new HostPluginRow();
      row.name = jsonStr(rowRecord, 'moduleName', '');
      if (row.name.length === 0 || isRemoteModule(row.name)) {
        continue;
      }
      row.entryId = jsonStr(rowRecord, 'entryId', '');
      const rowMeta = asRecord(rowRecord['meta']);
      row.title = rowMeta === undefined ? row.name : jsonStr(rowMeta, 'title', row.name);
      const entry = live.get(row.entryId);
      row.enabled = entry?.['enabled'] === true;
      const patchId = entry === undefined ? row.entryId : jsonStr(entry, 'patchId', row.entryId);
      row.settings = settings.get(patchId) ?? settings.get(row.entryId);
      row.writable = bundle.available && entry !== undefined && entry['readOnlyReason'] === undefined;
      bundle.rows.push(row);
    }
    inventory.push(bundle);
  }
  return inventory.sort((a: HostPluginBundle, b: HostPluginBundle) =>
    Number(b.enabled) - Number(a.enabled) || a.title.localeCompare(b.title));
}
