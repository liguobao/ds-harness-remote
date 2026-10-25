import { generateKeyPair } from '@dsh-remote/crypto'
import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import { isLanguagePreference, messageCatalogs, strings, type LanguagePreference } from '../locales/i18n'
import type { Messages } from '../locales/types'
import zhCN from '../locales/zh-CN'
import { isThemePreference, isTypographyDensity, type ThemePreference, type TypographyDensity } from '../ui/theme'
import type { AgentBackend, CodexPermissionPreset, DefaultPermissionPreset, DeviceCredentials, DeviceIdentity, RemoteDevice, ServerConfig, WorkspaceShortcut } from '../types'

const KEYS = {
  config: 'dshremote.server.v1',
  identity: 'dshremote.identity.v1',
  credentials: 'dshremote.credentials.v1',
  trustedHosts: 'dshremote.trusted-hosts.v1',
  /** Remembered host for `resolveAutoConnectDevice`; boot routing no longer consumes it. */
  lastConnectedDeviceId: 'dshremote.last-connected-device.v1',
  transportPreference: 'dshremote.transport-preference.v1',
  languagePreference: 'dshremote.language-preference.v1',
  themePreference: 'dshremote.theme-preference.v1',
  typographyDensity: 'dshremote.typography-density.v1',
  compactHistory: 'dshremote.compact-history.v1',
  statusBarVisible: 'dshremote.status-bar-visible.v1',
  defaultPermissionPreset: 'dshremote.default-permission-preset.v1',
  collapsedWorkspaces: 'dshremote.collapsed-workspaces.v1',
  hostSessionsDrawer: 'dshremote.host-sessions-drawer.v1',
  workspaceBackends: 'dshremote.workspace-backends.v1',
  codexPermissionPresets: 'dshremote.codex-permission-presets.v1',
  favoriteWorkspaces: 'dshremote.favorite-workspaces.v1',
  recentWorkspaces: 'dshremote.recent-workspaces.v1',
  customPrompts: 'dshremote.custom-prompts.v1',
} as const

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

export async function loadServerConfig(): Promise<ServerConfig | undefined> {
  return readJson<ServerConfig>(KEYS.config)
}

export async function saveServerConfig(config: ServerConfig): Promise<void> {
  await writeJson(KEYS.config, config)
}

export async function loadOrCreateIdentity(): Promise<DeviceIdentity> {
  const stored = await readJson<DeviceIdentity>(KEYS.identity)
  if (stored !== undefined) return stored

  const keyPair = generateKeyPair(Crypto.getRandomBytes(32))
  const model = Device.modelName?.trim()
  const appId = Application.applicationId
  const identity: DeviceIdentity = {
    deviceId: Crypto.randomUUID(),
    name: model ? `${model} · DSH Remote` : 'Android · DSH Remote',
    platform: 'android',
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  }
  if (appId === null) identity.name = model ?? 'Android phone'
  await writeJson(KEYS.identity, identity)
  return identity
}

export async function loadTrustedHosts(): Promise<RemoteDevice[]> {
  const stored = (await readJson<Array<RemoteDevice & { publicKey?: string }>>(KEYS.trustedHosts)) ?? []
  return stored.flatMap(host => {
    const identityKey = host.identityKey ?? host.publicKey
    if (identityKey === undefined || identityKey.length === 0) return []
    const { publicKey: _legacyPublicKey, ...current } = host
    return [{ ...current, identityKey }]
  })
}

export async function loadDeviceCredentials(serverUrl: string, deviceId: string): Promise<DeviceCredentials | undefined> {
  const credentials = await readJson<DeviceCredentials>(KEYS.credentials)
  return credentials?.serverUrl === serverUrl && credentials.deviceId === deviceId ? credentials : undefined
}

export async function saveDeviceCredentials(credentials: DeviceCredentials): Promise<void> {
  await writeJson(KEYS.credentials, credentials)
}

export async function clearDeviceCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.credentials, secureOptions)
}

export async function trustHost(host: RemoteDevice): Promise<void> {
  const hosts = await loadTrustedHosts()
  const next = [...hosts.filter(item => item.deviceId !== host.deviceId), { ...host, trusted: true }]
  await writeJson(KEYS.trustedHosts, next)
}

export async function forgetHost(deviceId: string): Promise<void> {
  const hosts = await loadTrustedHosts()
  await writeJson(KEYS.trustedHosts, hosts.filter(host => host.deviceId !== deviceId))
  const lastConnectedDeviceId = await loadLastConnectedDeviceId()
  if (lastConnectedDeviceId === deviceId) await clearLastConnectedDeviceId()
}

export async function loadLastConnectedDeviceId(): Promise<string | undefined> {
  const stored = await readJson<{ deviceId?: unknown }>(KEYS.lastConnectedDeviceId)
  return typeof stored?.deviceId === 'string' && stored.deviceId.trim() !== ''
    ? stored.deviceId.trim()
    : undefined
}

export async function saveLastConnectedDeviceId(deviceId: string): Promise<void> {
  const trimmed = deviceId.trim()
  if (trimmed === '') return
  await writeJson(KEYS.lastConnectedDeviceId, { deviceId: trimmed })
}

export async function clearLastConnectedDeviceId(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.lastConnectedDeviceId, secureOptions)
}

export async function loadFavoriteWorkspaces(): Promise<WorkspaceShortcut[]> {
  return loadWorkspaceShortcuts(KEYS.favoriteWorkspaces)
}

export async function saveFavoriteWorkspaces(items: readonly WorkspaceShortcut[]): Promise<void> {
  await writeJson(KEYS.favoriteWorkspaces, { items })
}

export async function loadRecentWorkspaces(): Promise<WorkspaceShortcut[]> {
  return loadWorkspaceShortcuts(KEYS.recentWorkspaces)
}

export async function saveRecentWorkspaces(items: readonly WorkspaceShortcut[]): Promise<void> {
  await writeJson(KEYS.recentWorkspaces, { items })
}

async function loadWorkspaceShortcuts(key: string): Promise<WorkspaceShortcut[]> {
  const stored = await readJson<{ items?: unknown }>(key)
  if (!Array.isArray(stored?.items)) return []
  return stored.items.flatMap(item => {
    const shortcut = workspaceShortcut(item)
    return shortcut === undefined ? [] : [shortcut]
  })
}

export async function loadTransportPreference(): Promise<import('../types').TransportPreference> {
  const stored = await readJson<{ value: import('../types').TransportPreference }>(KEYS.transportPreference)
  if (stored?.value === 'turn' || stored?.value === 'relay') return stored.value
  return 'auto'
}

export async function saveTransportPreference(value: import('../types').TransportPreference): Promise<void> {
  await writeJson(KEYS.transportPreference, { value })
}

export async function loadLanguagePreference(): Promise<LanguagePreference> {
  const stored = await readJson<{ value: unknown }>(KEYS.languagePreference)
  return isLanguagePreference(stored?.value) ? stored.value : 'system'
}

export async function saveLanguagePreference(value: LanguagePreference): Promise<void> {
  await writeJson(KEYS.languagePreference, { value })
}

export async function loadStatusBarVisible(): Promise<boolean> {
  const stored = await readJson<{ value: unknown }>(KEYS.statusBarVisible)
  return typeof stored?.value === 'boolean' ? stored.value : true
}

export async function saveStatusBarVisible(value: boolean): Promise<void> {
  await writeJson(KEYS.statusBarVisible, { value })
}

export async function loadThemePreference(): Promise<ThemePreference> {
  const stored = await readJson<{ value: unknown }>(KEYS.themePreference)
  return isThemePreference(stored?.value) ? stored.value : 'system'
}

export async function saveThemePreference(value: ThemePreference): Promise<void> {
  await writeJson(KEYS.themePreference, { value })
}

export async function loadDefaultPermissionPreset(): Promise<DefaultPermissionPreset> {
  const stored = await readJson<{ value: unknown }>(KEYS.defaultPermissionPreset)
  return codexPermissionPreset(stored?.value) ?? 'default'
}

export async function saveDefaultPermissionPreset(value: DefaultPermissionPreset): Promise<void> {
  await writeJson(KEYS.defaultPermissionPreset, { value })
}

export async function loadCollapsedWorkspaceIds(deviceId: string): Promise<string[]> {
  const stored = await readJson<{ byDevice?: Record<string, unknown> }>(KEYS.collapsedWorkspaces)
  const deviceValue = stored?.byDevice?.[deviceId]
  return Array.isArray(deviceValue)
    ? deviceValue.filter((value): value is string => typeof value === 'string')
    : []
}

let collapsedWorkspacesWrite = Promise.resolve()

export function saveCollapsedWorkspaceIds(deviceId: string, workspaceIds: readonly string[]): Promise<void> {
  const ids = [...new Set(workspaceIds)]
  collapsedWorkspacesWrite = collapsedWorkspacesWrite.catch(() => undefined).then(async () => {
    const stored = await readJson<{ byDevice?: Record<string, unknown> }>(KEYS.collapsedWorkspaces)
    const byDevice = { ...stored?.byDevice }
    if (ids.length === 0) delete byDevice[deviceId]
    else byDevice[deviceId] = ids
    await writeJson(KEYS.collapsedWorkspaces, { byDevice })
  })
  return collapsedWorkspacesWrite
}

// One queue protects read/modify/write across hosts and drawer remounts. A failed
// operation rejects its caller, but must not poison later reads or writes.
let hostSessionsDrawerWrite = Promise.resolve()

export async function loadHostSessionsDrawerGroups(deviceId: string): Promise<Record<string, boolean>> {
  await hostSessionsDrawerWrite
  const stored = await readJson<unknown>(KEYS.hostSessionsDrawer)
  const byDevice = isRecord(stored) && isRecord(stored.byDevice) ? stored.byDevice : {}
  const groups = byDevice[deviceId]
  return isRecord(groups)
    ? Object.fromEntries(Object.entries(groups).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
    : {}
}

export function saveHostSessionsDrawerGroup(deviceId: string, groupKey: string, expanded: boolean): Promise<void> {
  const nextWrite = hostSessionsDrawerWrite.then(async () => {
    const stored = await readJson<unknown>(KEYS.hostSessionsDrawer)
    const byDevice = isRecord(stored) && isRecord(stored.byDevice) ? stored.byDevice : {}
    const groups = isRecord(byDevice[deviceId]) ? byDevice[deviceId] : {}
    await writeJson(KEYS.hostSessionsDrawer, {
      byDevice: { ...byDevice, [deviceId]: { ...groups, [groupKey]: expanded } },
    })
  })
  hostSessionsDrawerWrite = nextWrite.catch(() => undefined)
  return nextWrite
}

export async function loadWorkspaceBackend(deviceId: string): Promise<AgentBackend | undefined> {
  const stored = await readJson<{ byDevice?: Record<string, unknown> }>(KEYS.workspaceBackends)
  const value = stored?.byDevice?.[deviceId]
  return value === 'harness' || value === 'codex' || value === 'cursor' || value === 'antigravity' || value === 'pi' || value === 'opencode' || value === 'claude' ? value : undefined
}

let workspaceBackendsWrite = Promise.resolve()

export function saveWorkspaceBackend(deviceId: string, backend: AgentBackend): Promise<void> {
  workspaceBackendsWrite = workspaceBackendsWrite.catch(() => undefined).then(async () => {
    const stored = await readJson<{ byDevice?: Record<string, unknown> }>(KEYS.workspaceBackends)
    await writeJson(KEYS.workspaceBackends, {
      byDevice: { ...stored?.byDevice, [deviceId]: backend },
    })
  })
  return workspaceBackendsWrite
}

export async function loadCodexPermissionPresets(hostDeviceId: string): Promise<Record<string, CodexPermissionPreset>> {
  const stored = await readJson<{ byHost?: Record<string, unknown> }>(KEYS.codexPermissionPresets)
  const byHost = isRecord(stored?.byHost) ? stored.byHost : {}
  const raw = isRecord(byHost[hostDeviceId]) ? byHost[hostDeviceId] : {}
  return Object.fromEntries(Object.entries(raw).flatMap(([threadId, value]) => {
    const preset = codexPermissionPreset(value)
    return preset === undefined ? [] : [[threadId, preset]]
  }))
}

export async function saveCodexPermissionPreset(
  hostDeviceId: string,
  threadId: string,
  preset: CodexPermissionPreset,
): Promise<void> {
  const stored = await readJson<{ byHost?: Record<string, unknown> }>(KEYS.codexPermissionPresets)
  const byHost = isRecord(stored?.byHost) ? { ...stored.byHost } : {}
  const current = await loadCodexPermissionPresets(hostDeviceId)
  current[threadId] = preset
  byHost[hostDeviceId] = current
  await writeJson(KEYS.codexPermissionPresets, { byHost })
}

export async function clearCodexPermissionPresets(hostDeviceId: string): Promise<void> {
  const stored = await readJson<{ byHost?: Record<string, unknown> }>(KEYS.codexPermissionPresets)
  const byHost = isRecord(stored?.byHost) ? { ...stored.byHost } : {}
  if (!(hostDeviceId in byHost)) return
  delete byHost[hostDeviceId]
  await writeJson(KEYS.codexPermissionPresets, { byHost })
}

export async function clearLocalData(): Promise<void> {
  await Promise.all(Object.values(KEYS).map(key => SecureStore.deleteItemAsync(key, secureOptions)))
}

async function readJson<T>(key: string): Promise<T | undefined> {
  const value = await SecureStore.getItemAsync(key, secureOptions)
  if (value === null) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    await SecureStore.deleteItemAsync(key, secureOptions)
    return undefined
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(value), secureOptions)
}

function codexPermissionPreset(value: unknown): CodexPermissionPreset | undefined {
  return value === 'workspace-write' || value === 'danger-full-access' ? value : undefined
}

function workspaceShortcut(value: unknown): WorkspaceShortcut | undefined {
  if (!isRecord(value)) return undefined
  const { deviceId, deviceName, key, workspaceId, backend, title, path, addedAt } = value
  if (typeof deviceId !== 'string' || deviceId.trim() === '') return undefined
  if (typeof key !== 'string' || key.trim() === '') return undefined
  if (typeof workspaceId !== 'string' || typeof title !== 'string' || typeof path !== 'string') return undefined
  return {
    deviceId,
    deviceName: typeof deviceName === 'string' ? deviceName : '',
    key,
    workspaceId,
    backend: agentBackend(backend),
    title,
    path,
    addedAt: typeof addedAt === 'number' && Number.isFinite(addedAt) ? addedAt : 0,
  }
}

function agentBackend(value: unknown): AgentBackend {
  return value === 'codex' ? 'codex' : 'harness'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** A user-managed quick prompt shown in the composer's quick prompts picker. */
export interface CustomPrompt {
  id: string
  title: string
  text: string
}

function customPrompt(value: unknown): CustomPrompt | undefined {
  if (!isRecord(value)) return undefined
  const { id, title, text } = value
  if (typeof id !== 'string' || id.trim() === '') return undefined
  if (typeof title !== 'string' || typeof text !== 'string') return undefined
  if (title.trim() === '' || text.trim() === '') return undefined
  return { id, title, text }
}

const BUILT_IN_IDS = new Set<string>(['builtin-check-changes', 'builtin-commit', 'builtin-view-screenshot'])

export function getBuiltInPrompts(messages?: Messages): readonly CustomPrompt[] {
  const msg = messages ?? strings
  return [
    {
      id: 'builtin-check-changes',
      title: msg.chat.quickCheckChanges,
      text: msg.chat.quickCheckChangesPrompt,
    },
    {
      id: 'builtin-commit',
      title: msg.chat.quickCommit,
      text: msg.chat.quickCommitPrompt,
    },
    {
      id: 'builtin-view-screenshot',
      title: msg.chat.quickViewScreenshot,
      text: msg.chat.quickViewScreenshotPrompt,
    },
  ]
}

export const BUILT_IN_PROMPTS: readonly CustomPrompt[] = Object.freeze(getBuiltInPrompts(zhCN))

const factoryBuiltIns = Object.values(messageCatalogs).flatMap(getBuiltInPrompts)

function isFactoryDefaultBuiltIn(prompt: CustomPrompt): boolean {
  return factoryBuiltIns.some(item => item.id === prompt.id && item.title === prompt.title && item.text === prompt.text)
}

function isBuiltInPrompt(id: string): boolean {
  return BUILT_IN_IDS.has(id)
}

/**
 * Saved prompts. `items` is the full list the user sees — including built-in
 * entries whose title or body was edited, so those edits survive a restart.
 * `removed` records the ids the user deleted, which is the only way to tell a
 * deleted built-in from one that was never seeded.
 */
export async function loadCustomPrompts(): Promise<CustomPrompt[]> {
  const stored = await readJson<{ items?: unknown; removed?: unknown }>(KEYS.customPrompts)
  const saved: CustomPrompt[] = Array.isArray(stored?.items)
    ? stored.items.flatMap(item => {
      const prompt = customPrompt(item)
      return prompt === undefined ? [] : [prompt]
    })
    : []
  const removed = new Set(Array.isArray(stored?.removed)
    ? stored.removed.filter((id): id is string => typeof id === 'string')
    : [])
  const savedById = new Map(saved.map(item => [item.id, item]))
  // Built-ins lead the list; an edited built-in keeps its factory id, so the
  // saved entry wins over the shipped seed if customized. If unedited,
  // materialize using the current active strings from i18n.
  const activeBuiltIns = getBuiltInPrompts()
  const builtIns = activeBuiltIns
    .filter(item => !removed.has(item.id))
    .map(item => {
      const savedItem = savedById.get(item.id)
      if (savedItem === undefined || isFactoryDefaultBuiltIn(savedItem)) {
        return item
      }
      return savedItem
    })
  const custom = saved.filter(item => !isBuiltInPrompt(item.id) && !removed.has(item.id))
  return [...builtIns, ...custom]
}

let customPromptsWrite = Promise.resolve()

export function saveCustomPrompts(items: readonly CustomPrompt[], removed: readonly string[] = []): Promise<void> {
  const snapshot = {
    items: [...items],
    removed: [...removed],
  }
  const nextWrite = customPromptsWrite.then(async () => {
    await writeJson(KEYS.customPrompts, snapshot)
  })
  customPromptsWrite = nextWrite.catch(() => undefined)
  return nextWrite
}

export async function loadCompactHistory(): Promise<boolean> {
  const stored = await readJson<{ value: unknown }>(KEYS.compactHistory)
  return stored?.value === true
}
export async function saveCompactHistory(value: boolean): Promise<void> {
  await writeJson(KEYS.compactHistory, { value })
}

export async function loadTypographyDensity(): Promise<TypographyDensity> {
  const stored = await readJson<{ value: unknown }>(KEYS.typographyDensity)
  return isTypographyDensity(stored?.value) ? stored.value : 'compact'
}

export async function saveTypographyDensity(value: TypographyDensity): Promise<void> {
  await writeJson(KEYS.typographyDensity, { value })
}
