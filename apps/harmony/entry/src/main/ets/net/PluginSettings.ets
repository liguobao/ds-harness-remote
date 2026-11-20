import { asArray, asRecord, jsonStr } from '../protocol/Types';

export class PluginSettingField {
  key: string = '';
  kind: string = '';
  description: string = '';
  value: string = '';
  hasOverride: boolean = false;
  min: number | undefined = undefined;
  max: number | undefined = undefined;
  integer: boolean = false;

  encode(draft: string): Object | undefined {
    switch (this.kind) {
      case 'boolean':
        return draft === 'true';
      case 'number': {
        const text = draft.trim();
        const number = Number(text);
        if (text.length === 0 || !Number.isFinite(number) || (this.integer && !Number.isInteger(number))
          || (this.min !== undefined && number < this.min) || (this.max !== undefined && number > this.max)) {
          return undefined;
        }
        return number;
      }
      case 'string':
        return draft;
      case 'string-list':
        return draft.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0);
      default:
        return undefined;
    }
  }
}

export class PluginSettingsForm {
  namespace: string = '';
  revision: number = 0;
  writable: boolean = false;
  fields: PluginSettingField[] = [];
}

export class PluginSettingOperation {
  op: string = 'set';
  path: string[] = [];
  value?: Object;

  constructor(key: string, value: Object | undefined) {
    this.path = [key];
    if (value === undefined) {
      this.op = 'unset';
    } else {
      this.value = value;
    }
  }
}

function resolve(node: Object | undefined, refs: Record<string, Object>): Record<string, Object> | undefined {
  return asRecord(typeof node === 'string' || typeof node === 'number' ? refs[String(node)] : node);
}

function collect(
  node: Record<string, Object> | undefined,
  refs: Record<string, Object>,
  source: Record<string, Object> | undefined,
  overrides: Record<string, Object> | undefined,
  fields: Map<string, PluginSettingField>,
  depth: number
): void {
  if (node === undefined || depth > 8) {
    return;
  }
  if (node['type'] === 'intersect') {
    for (const child of asArray(node['list']) ?? []) {
      collect(resolve(child, refs), refs, source, overrides, fields, depth + 1);
    }
    return;
  }
  const dictionary = asRecord(node['dict']);
  if (node['type'] !== 'object' || dictionary === undefined) {
    return;
  }
  for (const key of Object.keys(dictionary)) {
    if (key.length === 0 || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    const schema = resolve(dictionary[key], refs);
    if (schema === undefined) {
      continue;
    }
    const meta = asRecord(schema['meta']);
    if (meta?.['hidden'] === true || meta?.['role'] === 'secret') {
      fields.delete(key);
      continue;
    }
    const value = source?.[key] ?? meta?.['default'];
    const field = new PluginSettingField();
    field.key = key;
    field.hasOverride = overrides !== undefined && Object.keys(overrides).includes(key);
    field.description = meta === undefined ? '' : jsonStr(meta, 'description', '');
    const kind = jsonStr(schema, 'type', '');
    if (kind === 'boolean') {
      field.kind = kind;
      field.value = value === true ? 'true' : 'false';
    } else if (kind === 'number' || kind === 'natural') {
      field.kind = 'number';
      field.value = typeof value === 'number' ? String(value) : '';
      field.min = typeof meta?.['min'] === 'number' ? meta?.['min'] as number : kind === 'natural' ? 0 : undefined;
      field.max = typeof meta?.['max'] === 'number' ? meta?.['max'] as number : undefined;
      field.integer = kind === 'natural' || meta?.['step'] === 1;
    } else if (kind === 'string') {
      field.kind = kind;
      field.value = typeof value === 'string' ? value : '';
    } else if (kind === 'array' && resolve(schema['inner'], refs)?.['type'] === 'string') {
      field.kind = 'string-list';
      field.value = (asArray(value) ?? []).filter((line: Object) => typeof line === 'string').join('\n');
    }
    if (field.kind.length > 0) {
      fields.set(key, field);
    }
  }
}

export function parsePluginSettings(value: Object): Map<string, PluginSettingsForm> {
  const settings = asRecord(value);
  const namespaces = asArray(settings?.['namespaces']) ?? [];
  const result = new Map<string, PluginSettingsForm>();
  for (const namespace of namespaces) {
    const entry = asRecord(namespace);
    if (entry === undefined) {
      continue;
    }
    const id = jsonStr(entry, 'ns', '');
    const revision = entry['revision'];
    const schema = asRecord(entry['schema']);
    if (id.length === 0 || /^(?:@dsh-remote\/plugin|ds-harness-remote|dsh-remote)(?:\/|$)/.test(id)
      || schema === undefined || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      continue;
    }
    const refs: Record<string, Object> = asRecord(schema['refs']) ?? {};
    const root = schema['uid'] === undefined ? schema : resolve(schema['uid'], refs);
    const fields = new Map<string, PluginSettingField>();
    collect(root, refs, asRecord(entry['value']), asRecord(entry['user']), fields, 0);
    if (fields.size > 0) {
      const form = new PluginSettingsForm();
      form.namespace = id;
      form.revision = revision;
      form.writable = settings?.['writable'] !== false;
      form.fields = Array.from(fields.values());
      result.set(id, form);
    }
  }
  return result;
}
