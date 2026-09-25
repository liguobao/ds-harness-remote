import { hostname } from 'node:os'
import { execFileSync } from 'node:child_process'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { resolveConfig, type Config, type ConfigInput, type ResolvedConfig } from './config.js'
import {
  ClientModeError,
  type ClientModeRuntime,
  type HostConnectionHandle,
  type HostAuthorizationControl,
} from './client-runtime.js'
import { IdentityStore, serverStorageDirectory } from './identity-store.js'
import { ClientServerApi, HostServerApi } from './server-api.js'
import { ServerCredentialStore } from './server-credentials.js'
import { registerControlRoute, type HostWebServerLike } from './control-route.js'
import { ControlStatusStream } from './control-stream.js'

export interface PluginSettingsView {
  config: Config
  deviceName: string
  writable: boolean
  applies: 'live' | 'restart'
  association?: PluginAssociation
  associations: Partial<Record<'host' | 'client', PluginAssociation>>
  acpAvailability?: Record<string, boolean>
}

export interface PluginAssociation {
  method: 'account' | 'host_registration_code' | 'owned_device'
  account?: string
}

/**
 * Live read/write face of the plugin's profile-owned entry Config.
 *
 * DSH 0.1.7-rc.1 (DSH-0.1.7-RC1-04) removed the settings-namespace registry
 * and its scope type: the entry's editable fields are a single
 * `.volatile()` Cordis Config, read through `.get()`, and writes go to
 * `ctx.settings.replace(entryId, section)` (persisted in the active profile's
 * `cordis.patch.yml` under the entry id).
 */
export interface PluginSettingsBinding {
  /** The current config, read from the entry's live volatile reference. */
  get(): ConfigInput
  /** Replace the entry's editable fields in the active profile. */
  replace(section: Config): Promise<void>
}

/** Loopback-only control plane shared by Local/Remote switching and plugin setup. */
export class PluginControlRuntime {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly identityDirectory: string,
    private readonly settings: PluginSettingsBinding | undefined,
    private readonly client: ClientModeRuntime | undefined,
    private readonly host: HostAuthorizationControl | undefined,
  ) {}

  register(connection: HostConnectionHandle, webServer?: HostWebServerLike): () => Promise<void> {
    const statusStream = new ControlStatusStream(() => this.streamStatus())
    return registerControlRoute(
      connection,
      (endpoint, payload, signal) => this.handle(endpoint, payload, signal),
      webServer,
      statusStream,
    )
  }

  /**
   * Read the value the status event stream pushes. It resolves through the same
   * endpoint handler as the unary `status` control call, so a pushed status and
   * a polled one can never diverge.
   */
  private async streamStatus(): Promise<unknown> {
    const result = await this.handle('status', {}, new AbortController().signal)
    if (!result.ok) throw new ClientModeError('STATUS_UNAVAILABLE', result.error.message)
    return result.value
  }

  private async handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> {
    try {
      if (endpoint === 'settings.development.set') return ok(await this.setDevelopment(payload))
      if (endpoint === 'settings.get') return ok(await this.settingsView())
      if (endpoint === 'settings.configure') return ok(await this.configure(payload))
      if (endpoint === 'settings.server.set') return ok(await this.setServer(payload))
      if (endpoint === 'settings.role.set') return ok(await this.setRole(payload))
      if (endpoint === 'settings.codex.set') return ok(await this.setCodex(payload))
      if (endpoint === 'settings.acp.set') return ok(await this.setAcp(payload))
      if (endpoint === 'settings.acp.add') return ok(await this.addAcp(payload))
      if (endpoint === 'settings.acp.remove') return ok(await this.removeAcp(payload))
      if (endpoint === 'settings.logout') return ok(await this.logout())
      if (endpoint === 'host.reconnect') {
        if (this.host === undefined) throw new ClientModeError('METHOD_NOT_ALLOWED', 'This plugin is not running as a Host.')
        this.host.reconnectHost()
        return ok(this.hostOnlyStatus())
      }
      if (this.client !== undefined) return this.client.handleControl(endpoint, payload, signal)

      if (endpoint === 'status') return ok(this.hostOnlyStatus())
      if (endpoint === 'devices') return ok([])
      if (endpoint === 'host.account.login') {
        if (this.host === undefined) throw new ClientModeError('METHOD_NOT_ALLOWED', 'This plugin is not running as a Host.')
        const value = record(payload)
        if (typeof value.email !== 'string' || typeof value.password !== 'string') {
          throw new ClientModeError('INVALID_MESSAGE', 'Email and password are required.')
        }
        return ok(await this.host.authorizeHostWithAccount(value.email, value.password))
      }
      if (endpoint === 'host.registration-code.submit') {
        if (this.host === undefined) throw new ClientModeError('METHOD_NOT_ALLOWED', 'This plugin is not running as a Host.')
        const value = record(payload)
        if (typeof value.code !== 'string' || value.code.trim() === '') {
          throw new ClientModeError('INVALID_MESSAGE', 'A Host registration code is required.')
        }
        return ok(await this.host.authorizeHostWithCode(value.code))
      }
      if (endpoint === 'mode.set' && record(payload).mode === 'local') return ok(this.hostOnlyStatus())
      throw new ClientModeError('METHOD_NOT_ALLOWED', 'Remote Client mode is disabled by the plugin role.')
    } catch (error) {
      return fail(error)
    }
  }

  private async configure(payload: unknown): Promise<Record<string, unknown>> {
    if (this.settings === undefined) {
      throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    }
    const value = record(payload)
    if (value.role !== 'host' && value.role !== 'client') {
      throw new ClientModeError('INVALID_MESSAGE', 'Role must be Host or Client.')
    }
    if (typeof value.serverUrl !== 'string') {
      throw new ClientModeError('INVALID_MESSAGE', 'Server URL is required.')
    }
    const current = editableConfig(resolveConfig(this.settings.get()))
    const next = resolveConfig({ ...current, role: value.role, serverUrl: value.serverUrl })

    const identities = new IdentityStore({
      directory: serverStorageDirectory(this.identityDirectory, next.serverUrl!, value.role),
    })
    const identity = await identities.loadOrCreate(hostname())
    const api = value.role === 'host'
      ? new HostServerApi(next.serverUrl!, new ServerCredentialStore(identities.directory))
      : new ClientServerApi(next.serverUrl!, new ServerCredentialStore(identities.directory))
    let authorization
    if (value.role === 'host' && typeof value.registrationCode === 'string' && value.registrationCode.trim() !== '') {
      authorization = await api.authorizeHostWithCode(identity, value.registrationCode)
    } else {
      if (typeof value.email !== 'string' || typeof value.password !== 'string') {
        throw new ClientModeError('INVALID_MESSAGE', 'Email and password are required for account authorization.')
      }
      authorization = await api.authorizeWithAccount(identity, value.email, value.password)
    }
    await this.settings.replace(editableConfig(next))
    return {
      status: 'authorized',
      role: value.role,
      ...(authorization.account === undefined ? {} : { account: authorization.account }),
      settings: await this.settingsView(),
    }
  }

  private async setServer(payload: unknown): Promise<PluginSettingsView> {
    if (this.settings === undefined) {
      throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    }
    const value = record(payload)
    if (typeof value.serverUrl !== 'string') {
      throw new ClientModeError('INVALID_MESSAGE', 'Server URL is required.')
    }
    const current = editableConfig(resolveConfig(this.settings.get()))
    const next = resolveConfig({ ...current, serverUrl: value.serverUrl })
    await this.settings.replace(editableConfig(next))
    return this.settingsView()
  }

  private async setRole(payload: unknown): Promise<PluginSettingsView> {
    if (this.settings === undefined) {
      throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    }
    const role = record(payload).role
    if (role !== 'host' && role !== 'client') {
      throw new ClientModeError('INVALID_MESSAGE', 'Role must be Host or Client.')
    }
    const current = editableConfig(resolveConfig(this.settings.get()))
    const currentRole = current.role === 'client' ? 'client' : 'host'
    if (role !== currentRole && current.serverUrl !== undefined
      && await this.association(current.serverUrl, role) === undefined) {
      await this.authorizeOwnedRole(current.serverUrl, currentRole, role)
    }
    await this.settings.replace({ ...current, role })
    return this.settingsView()
  }

  private async setDevelopment(payload: unknown): Promise<PluginSettingsView> {
    if (this.settings === undefined) throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    const value = record(payload)
    if (value.terminalEnabled !== undefined && typeof value.terminalEnabled !== 'boolean') throw new ClientModeError('INVALID_MESSAGE', 'The terminal switch must be a boolean.')
    if (value.ports !== undefined && (!Array.isArray(value.ports) || value.ports.some((port) => !Number.isInteger(port)))) throw new ClientModeError('INVALID_MESSAGE', 'Loopback ports must be integers.')
    if (value.terminalEnabled === undefined && value.ports === undefined) throw new ClientModeError('INVALID_MESSAGE', 'A terminal switch or loopback ports are required.')
    const current = editableConfig(resolveConfig(this.settings.get()))
    const next = resolveConfig({ ...current,
      terminal: { enabled: value.terminalEnabled === undefined ? (current.terminal?.enabled ?? false) : value.terminalEnabled },
      loopback: { ports: value.ports === undefined ? (current.loopback?.ports ?? []) : value.ports },
    })
    await this.settings.replace(editableConfig(next))
    if (value.terminalEnabled !== undefined) this.host?.setTerminalEnabled?.(value.terminalEnabled)
    if (value.ports !== undefined) this.host?.setLoopbackPorts?.(value.ports)
    return this.settingsView()
  }

  private async setCodex(payload: unknown): Promise<PluginSettingsView> {
    if (this.settings === undefined) {
      throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    }
    const enabled = record(payload).enabled
    if (typeof enabled !== 'boolean') {
      throw new ClientModeError('INVALID_MESSAGE', 'Codex Remote enabled must be a boolean.')
    }
    const current = editableConfig(resolveConfig(this.settings.get()))
    const next = resolveConfig({
      ...current,
      codex: { ...current.codex, enabled },
    })
    await this.settings.replace(editableConfig(next))
    return this.settingsView()
  }

  private async setAcp(payload: unknown): Promise<PluginSettingsView> {
    if (this.settings === undefined) throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    const value = record(payload)
    const backend = value.backend
    const enabled = value.enabled
    if (typeof backend !== 'string' || typeof enabled !== 'boolean') throw new ClientModeError('INVALID_MESSAGE', 'ACP backend and enabled are required.')
    const current = resolveConfig(this.settings.get())
    const backends = current.acp?.backends.map(item => item.id === backend ? { ...item, enabled } : item) ?? []
    await this.settings.replace({ ...editableConfig(current), acp: { enabled: current.acp?.enabled ?? true, backends } })
    return this.settingsView()
  }

  private async addAcp(payload: unknown): Promise<PluginSettingsView> {
    if (this.settings === undefined) throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    const value = record(payload)
    if (typeof value.id !== 'string' || typeof value.command !== 'string' || !Array.isArray(value.args) || !value.args.every(item => typeof item === 'string')) {
      throw new ClientModeError('INVALID_MESSAGE', 'ACP name, command, and arguments are required.')
    }
    const current = resolveConfig(this.settings.get())
    if (current.acp?.backends.some(item => item.id === value.id)) throw new ClientModeError('INVALID_MESSAGE', 'ACP backend already exists.')
    const backends = [...(current.acp?.backends ?? []), { id: value.id, command: value.command, args: value.args, enabled: false }]
    const next = resolveConfig({ ...editableConfig(current), acp: { enabled: current.acp?.enabled ?? true, backends } })
    await this.settings.replace(editableConfig(next))
    return this.settingsView()
  }

  private async removeAcp(payload: unknown): Promise<PluginSettingsView> {
    if (this.settings === undefined) throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    const id = record(payload).id
    if (typeof id !== 'string' || ['codex', 'cursor', 'kimi'].includes(id)) throw new ClientModeError('INVALID_MESSAGE', 'Only custom ACP backends can be removed.')
    const current = resolveConfig(this.settings.get())
    const backends = (current.acp?.backends ?? []).filter(item => item.id !== id)
    await this.settings.replace(editableConfig({ ...current, acp: { enabled: current.acp?.enabled ?? true, backends } }))
    return this.settingsView()
  }

  private async authorizeOwnedRole(
    serverUrl: string,
    sourceRole: 'host' | 'client',
    targetRole: 'host' | 'client',
  ): Promise<void> {
    const sourceDirectory = serverStorageDirectory(this.identityDirectory, serverUrl, sourceRole)
    const sourceIdentity = await new IdentityStore({ directory: sourceDirectory }).loadOrCreate(hostname())
    const sourceStore = new ServerCredentialStore(sourceDirectory)
    if (await sourceStore.load(serverUrl, sourceIdentity.deviceId) === undefined) return
    const sourceApi = sourceRole === 'host'
      ? new HostServerApi(serverUrl, sourceStore)
      : new ClientServerApi(serverUrl, sourceStore)
    const sourceCredentials = await sourceApi.authenticate(sourceIdentity)

    const targetDirectory = serverStorageDirectory(this.identityDirectory, serverUrl, targetRole)
    const targetIdentity = await new IdentityStore({ directory: targetDirectory }).loadOrCreate(hostname())
    const targetApi = targetRole === 'host'
      ? new HostServerApi(serverUrl, new ServerCredentialStore(targetDirectory))
      : new ClientServerApi(serverUrl, new ServerCredentialStore(targetDirectory))
    await targetApi.authorizeOwnedRole(targetIdentity, sourceCredentials.accessToken, sourceCredentials.account)
  }

  private async logout(): Promise<PluginSettingsView> {
    if (this.settings === undefined) {
      throw new ClientModeError('SETTINGS_UNAVAILABLE', 'DSH user settings are unavailable in this profile.')
    }
    const config = resolveConfig(this.settings.get())
    if (config.serverUrl !== undefined) {
      await Promise.all([
        this.client?.clearClientAuthorization(),
        this.host?.clearHostAuthorization(),
      ])
      await Promise.all((['host', 'client'] as const).map(async role => {
        const directory = serverStorageDirectory(this.identityDirectory, config.serverUrl!, role)
        await new ServerCredentialStore(directory).clear()
      }))
    }
    return this.settingsView()
  }

  private async settingsView(): Promise<PluginSettingsView> {
    const config = this.settings === undefined ? editableConfig(this.config) : editableConfig(resolveConfig(this.settings.get()))
    const associations = await this.associations(config)
    const role = config.role === 'client' ? 'client' : 'host'
    const association = associations[role]
    return {
      config,
      deviceName: hostname(),
      writable: this.settings !== undefined,
      applies: 'restart',
      associations,
      acpAvailability: Object.fromEntries((config.acp?.backends ?? []).map(item => [item.id, commandAvailable(item.command ?? '')])),
      ...(association === undefined ? {} : { association }),
    }
  }

  private async associations(config: Config): Promise<PluginSettingsView['associations']> {
    if (config.serverUrl === undefined) return {}
    const [host, client] = await Promise.all([
      this.association(config.serverUrl, 'host'),
      this.association(config.serverUrl, 'client'),
    ])
    return {
      ...(host === undefined ? {} : { host }),
      ...(client === undefined ? {} : { client }),
    }
  }

  private async association(serverUrl: string, role: 'host' | 'client'): Promise<PluginAssociation | undefined> {
    const identities = new IdentityStore({
      directory: serverStorageDirectory(this.identityDirectory, serverUrl, role),
    })
    const identity = await identities.loadOrCreate(hostname())
    const credentials = await new ServerCredentialStore(identities.directory).load(serverUrl, identity.deviceId)
    if (credentials === undefined) return undefined
    return {
      method: credentials.authorizationMethod,
      ...(credentials.account === undefined ? {} : { account: credentials.account }),
    }
  }

  private hostOnlyStatus(): Record<string, unknown> {
    return {
      mode: 'local',
      available: false,
      deviceName: hostname(),
      hostAuthorizationAvailable: this.host !== undefined,
      ...(this.host === undefined ? {} : { host: this.host.hostStatus() }),
    }
  }
}

function commandAvailable(command: string): boolean {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' }); return true } catch { return false }
}

function editableConfig(config: ResolvedConfig): Config {
  return {
    enabled: config.enabled,
    role: config.role,
    ...(config.serverUrl === undefined ? {} : { serverUrl: config.serverUrl }),
    terminal: config.terminal,
    loopback: config.loopback,
    forceRelay: config.forceRelay,
    logLevel: config.logLevel,
    reconnect: config.reconnect.enabled
      ? {
          initialDelayMs: config.reconnect.initialDelayMs,
          maxDelayMs: config.reconnect.maxDelayMs,
          jitter: config.reconnect.jitter,
        }
      : false,
    codex: {
      enabled: config.codex.enabled,
      binary: config.codex.binary,
    },
    ...(config.acp === undefined ? {} : { acp: { enabled: config.acp.enabled, backends: config.acp.backends } }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ClientModeError('INVALID_MESSAGE', 'The control request payload is invalid.')
  return value
}

function ok(value: unknown): RpcResult<unknown> { return { ok: true, value } }

function fail(error: unknown): RpcResult<unknown> {
  const source = error instanceof Error ? error : undefined
  const remoteCode = source !== undefined && 'code' in source && typeof source.code === 'string'
    ? source.code
    : source instanceof ClientModeError ? source.code : undefined
  return {
    ok: false,
    error: {
      code: 'internal',
      message: source?.message ?? 'The plugin control operation failed.',
      details: remoteCode === undefined ? {} : { remoteCode },
    },
  }
}
