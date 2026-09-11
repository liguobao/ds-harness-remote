import { generateKeyPair } from '@dsh-remote/crypto'
import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import { isLanguagePreference, type LanguagePreference } from '../locales/i18n'
import { isThemePreference, type ThemePreference } from '../ui/theme'
import type { CodexPermissionPreset, DeviceCredentials, DeviceIdentity, RemoteDevice, ServerConfig } from '../types'

const KEYS = {
  config: 'dshremote.server.v1',
  identity: 'dshremote.identity.v1',
  credentials: 'dshremote.credentials.v1',
  trustedHosts: 'dshremote.trusted-hosts.v1',
  lastConnectedDeviceId: 'dshremote.last-connected-device.v1',
  transportPreference: 'dshremote.transport-preference.v1',
  languagePreference: 'dshremote.language-preference.v1',
  themePreference: 'dshremote.theme-preference.v1',
  collapsedWorkspaces: 'dshremote.collapsed-workspaces.v1',
  workspaceBackends: 'dshremote.workspace-backends.v1',
  codexPermissionPresets: 'dshremote.codex-permission-presets.v1',
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

export async function loadThemePreference(): Promise<ThemePreference> {
  const stored = await readJson<{ value: unknown }>(KEYS.themePreference)
  return isThemePreference(stored?.value) ? stored.value : 'system'
}

export async function saveThemePreference(value: ThemePreference): Promise<void> {
  await writeJson(KEYS.themePreference, { value })
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

export async function loadWorkspaceBackend(deviceId: string): Promise<'harness' | 'codex' | undefined> {
  const stored = await readJson<{ byDevice?: Record<string, unknown> }>(KEYS.workspaceBackends)
  const value = stored?.byDevice?.[deviceId]
  return value === 'harness' || value === 'codex' ? value : undefined
}

let workspaceBackendsWrite = Promise.resolve()

export function saveWorkspaceBackend(deviceId: string, backend: 'harness' | 'codex'): Promise<void> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
