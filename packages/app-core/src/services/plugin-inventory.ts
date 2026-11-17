import type { HarnessSettingsDescribe, HarnessSettingsNamespace, HarnessSettingsPathOp } from '@dsh-remote/client-core'
import { requireProxy } from '../state/store'
import { getActiveLanguage, strings } from '../locales/i18n'

/** One Loader row a bundle contributes, joined with its live entry. */
export interface PluginRowView {
  rowId: string
  entryId?: string
  moduleName: string
  title: string
  description?: string
  enabled: boolean
  readOnly: boolean
  /** Settings namespace (the Loader entry id) when the entry exposes a form. */
  settings?: HarnessSettingsNamespace
}

/**
 * Where the plugin page lists a bundle: `remote` for plugins this client renders
 * natively (see {@link REMOTE_ADAPTED_PLUGINS}), `installed` for the person's own
 * profile dependencies, and `experimental` for the official optional bundles.
 */
export type PluginCategory = 'remote' | 'installed' | 'experimental'

/** One bundle as the Host's official plugin manager reports it. */
export interface PluginBundleView {
  name: string
  title: string
  description?: string
  /** Base64 data URL from the package manifest. */
  icon?: string
  version?: string
  category: PluginCategory
  /** What the mobile client renders natively for a Remote-adapted plugin. */
  remoteFeature?: string
  /** Release that adds phone-editable settings, when the installed one predates it. */
  upgradeFor?: string
  official: boolean
  enabled: boolean
  /** False when the package files are missing and need a local install first. */
  available: boolean
  readOnly: boolean
  error?: string
  rows: PluginRowView[]
}

export interface PluginInventory {
  bundles: PluginBundleView[]
  settingsWritable: boolean
}

const REMOTE_MODULE = /^(?:ds-harness-remote|dsh-remote)(?:\/|$)/

/**
 * Plugins whose output this client renders natively, keyed by package name. The
 * Remote category lists them first, also when the Host lacks them, so the person
 * knows what to install on the computer for a richer mobile experience.
 */
export const REMOTE_ADAPTED_PLUGINS: Readonly<Record<string, {
  title: string
  feature: () => string
  /** First release whose settings the official settings service exposes (`volatile` fields). */
  settingsSince?: string
}>> = {
  'deepseek-harness-intelligent-ui': {
    title: 'Intelligent UI',
    feature: () => strings.plugins.intelligentUiFeature,
    settingsSince: '0.2.10',
  },
  'ds-bot': {
    title: 'DS Bot',
    feature: () => strings.bots.notInstalled,
  },
}

/** Read bundles, live entries and settings forms through the authenticated Typert carrier. */
export async function loadPluginInventory(): Promise<PluginInventory> {
  const proxy = requireProxy()
  const [bundles, plugins, settings] = await Promise.all([
    proxy.pluginListBundles(),
    proxy.pluginListPlugins(),
    proxy.settingsDescribe().catch((): HarnessSettingsDescribe => ({ writable: false, namespaces: [] })),
  ])
  return { bundles: joinInventory(bundles, plugins, settings), settingsWritable: settings.writable }
}

export async function setPluginEnabled(kind: 'bundle' | 'plugin', target: string, enabled: boolean): Promise<string> {
  const result = await requireProxy().pluginSetEnabled(kind, target, enabled)
  return result.application
}

export async function mutatePluginSettings(ns: string, ops: HarnessSettingsPathOp[], revision: number): Promise<void> {
  await requireProxy().settingsMutate(ns, ops, revision)
}

export function joinInventory(bundles: unknown[], plugins: unknown[], settings: HarnessSettingsDescribe): PluginBundleView[] {
  const live = new Map<string, Record<string, unknown>>()
  for (const plugin of plugins) {
    if (isRecord(plugin) && typeof plugin.entryId === 'string') live.set(plugin.entryId, plugin)
  }
  const forms = new Map(settings.namespaces.map(row => [row.ns, row]))
  const views: PluginBundleView[] = []
  for (const bundle of bundles) {
    if (!isRecord(bundle) || typeof bundle.name !== 'string' || REMOTE_MODULE.test(bundle.name)) continue
    const meta = isRecord(bundle.meta) ? bundle.meta : {}
    const rows: PluginRowView[] = []
    for (const row of Array.isArray(bundle.rows) ? bundle.rows : []) {
      if (!isRecord(row) || typeof row.moduleName !== 'string' || REMOTE_MODULE.test(row.moduleName)) continue
      const entryId = typeof row.entryId === 'string' ? row.entryId : undefined
      const entry = entryId === undefined ? undefined : live.get(entryId)
      const rowMeta = isRecord(row.meta) ? row.meta : {}
      // Settings namespaces are the profile entry's own id (`patchId`), not the Loader's `include:` entry id.
      const form = entryId === undefined ? undefined
        : forms.get(typeof entry?.patchId === 'string' ? entry.patchId : entryId) ?? forms.get(entryId)
      rows.push({
        rowId: typeof row.rowId === 'string' ? row.rowId : row.moduleName,
        ...(entryId === undefined ? {} : { entryId }),
        moduleName: row.moduleName,
        title: localized(rowMeta.title) ?? shortName(row.moduleName),
        ...(localized(rowMeta.description) === undefined ? {} : { description: localized(rowMeta.description) }),
        enabled: entry?.enabled === true,
        readOnly: entryId === undefined || entry?.readOnlyReason !== undefined,
        ...(form !== undefined && schemaFields(form.schema).length > 0 ? { settings: form } : {}),
      })
    }
    const adapted = REMOTE_ADAPTED_PLUGINS[bundle.name]
    const category: PluginCategory | undefined = adapted !== undefined ? 'remote'
      : bundle.optional === true ? 'experimental'
        : bundle.availability === 'profile' ? 'installed' : undefined
    // Base/runtime profile bundles and catalog entries the Host lacks stay off this page, as on Desktop.
    if (category === undefined) continue
    const description = localized(meta.description) ?? (typeof bundle.description === 'string' ? bundle.description : undefined)
    const error = isRecord(bundle.error) ? (typeof bundle.error.message === 'string' ? bundle.error.message : String(bundle.error.code ?? '')) : undefined
    views.push({
      name: bundle.name,
      title: localized(meta.title) ?? shortName(bundle.name),
      ...(description === undefined || description === '' ? {} : { description }),
      ...(typeof meta.icon === 'string' && meta.icon.startsWith('data:image/') ? { icon: meta.icon } : {}),
      ...(typeof bundle.version === 'string' ? { version: bundle.version } : {}),
      category,
      ...(adapted === undefined ? {} : { remoteFeature: adapted.feature() }),
      ...(adapted?.settingsSince !== undefined && typeof bundle.version === 'string'
        && olderThan(bundle.version, adapted.settingsSince) && !rows.some(row => row.settings !== undefined)
        ? { upgradeFor: adapted.settingsSince } : {}),
      official: bundle.official === true,
      enabled: bundle.enabled === true,
      available: bundle.availability !== 'missing',
      readOnly: bundle.readOnlyReason !== undefined,
      ...(error === undefined || error === '' ? {} : { error }),
      rows,
    })
  }
  for (const [name, adapted] of Object.entries(REMOTE_ADAPTED_PLUGINS)) {
    if (views.some(view => view.name === name)) continue
    views.push({
      name, title: adapted.title, category: 'remote', remoteFeature: adapted.feature(),
      official: false, enabled: false, available: false, readOnly: true, rows: [],
    })
  }
  return views.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.title.localeCompare(b.title))
}

export type SchemaFieldKind = 'boolean' | 'number' | 'string' | 'string-list' | 'unsupported'

export interface SchemaField {
  key: string
  kind: SchemaFieldKind
  description?: string
  defaultValue?: unknown
  min?: number
  max?: number
  integer?: boolean
  secret?: boolean
}

/** Flatten the top-level object of a serialized Schemastery envelope into editable fields. */
export function schemaFields(schema: unknown): SchemaField[] {
  const refs = isRecord(schema) && isRecord(schema.refs) ? schema.refs : {}
  const resolve = (node: unknown): Record<string, unknown> | undefined => {
    const value = typeof node === 'number' || typeof node === 'string' ? refs[String(node)] : node
    return isRecord(value) ? value : undefined
  }
  const root = isRecord(schema) && 'uid' in schema ? resolve(schema.uid) : resolve(schema)
  const fields = new Map<string, SchemaField>()
  const collect = (node: Record<string, unknown> | undefined, depth: number): void => {
    if (node === undefined || depth > 8) return
    if (node.type === 'intersect' && Array.isArray(node.list)) {
      for (const item of node.list) collect(resolve(item), depth + 1)
      return
    }
    if (node.type !== 'object' || !isRecord(node.dict)) return
    for (const [key, child] of Object.entries(node.dict)) {
      const field = describeField(key, resolve(child), resolve)
      if (field !== undefined) fields.set(key, field)
    }
  }
  collect(root, 0)
  return [...fields.values()]
}

function describeField(
  key: string,
  node: Record<string, unknown> | undefined,
  resolve: (node: unknown) => Record<string, unknown> | undefined,
): SchemaField | undefined {
  if (node === undefined) return undefined
  const meta = isRecord(node.meta) ? node.meta : {}
  if (meta.hidden === true) return undefined
  const base = {
    key,
    ...(localized(meta.description) === undefined ? {} : { description: localized(meta.description) }),
    ...(meta.default === undefined ? {} : { defaultValue: meta.default }),
    ...(meta.role === 'secret' ? { secret: true } : {}),
  }
  if (node.type === 'boolean') return { ...base, kind: 'boolean' }
  if (node.type === 'number' || node.type === 'natural') {
    return {
      ...base,
      kind: 'number',
      ...(typeof meta.min === 'number' ? { min: meta.min } : node.type === 'natural' ? { min: 0 } : {}),
      ...(typeof meta.max === 'number' ? { max: meta.max } : {}),
      integer: meta.step === 1 || node.type === 'natural',
    }
  }
  if (node.type === 'string' && meta.role !== 'secret') return { ...base, kind: 'string' }
  if (node.type === 'array' && resolve(node.inner)?.type === 'string') return { ...base, kind: 'string-list' }
  return { ...base, kind: 'unsupported' }
}

/** Pick the active app language from Host-localized text, falling back to English. */
export function localized(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  // Manifests key by lowercase language ids (`zh`), Schemastery i18n by locale tags (`zh-CN`, `''` fallback).
  const entries = new Map(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, text]) => [key.toLowerCase(), text]))
  const language = getActiveLanguage().toLowerCase()
  const base = language.split('-')[0] ?? language
  for (const key of [language, base, ...(base === 'zh' ? ['zh-cn'] : []), 'en', 'en-us', '']) {
    const text = entries.get(key)
    if (text !== undefined) return text
  }
  return entries.values().next().value
}

/** Compare the numeric release parts only; a prerelease counts as its release. */
export function olderThan(version: string, minimum: string): boolean {
  const parts = (value: string) => (value.replace(/^v/, '').split(/[-+]/)[0] ?? '')
    .split('.').map(part => Number.parseInt(part, 10) || 0)
  const [a, b] = [parts(version), parts(minimum)]
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta < 0
  }
  return false
}

function shortName(name: string): string {
  return name.replace(/^@[^/]+\//, '').replace(/^dsh-plugin-/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
