import type { Context } from '@deepseek-ai/cordis'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SettingsNamespace, SettingsProvider, SettingsScope } from '@deepseek-ai/dsh-settings'
import { ClientModeRuntime, type HostConnectionHandle } from './client-runtime.js'
import {
  Config,
  DEFAULT_REMOTE_SERVER_URL,
  resolveConfig,
  type Config as ConfigInput,
  type ResolvedConfig,
} from './config.js'
import { PluginControlRuntime } from './control-runtime.js'
import type { HostWebServerLike } from './control-route.js'
import { IdentityStore, serverStorageDirectory } from './identity-store.js'
import { SafeLogger } from './logging.js'
import { HostPluginRuntime } from './service.js'
import { ClientServerApi } from './server-api.js'
import { ServerCredentialStore } from './server-credentials.js'
import type { TypertGatewayLike } from './typert-gateway-contract.js'
import { TypertGatewaySwitch } from './typert-gateway-switch.js'
import type { FileViewerHostServiceLike } from './file-viewer-bridge.js'
import {
  installTuiRemoteCommand,
  type TuiRemoteBinding,
  type TuiRemoteTarget,
} from './tui-command.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshRemote: HostPluginRuntime
    dshRemoteClient: ClientModeRuntime
    typertGateway: TypertGatewayLike
  }
}

export const name = 'ds-harness-remote'
export { Config }

const legacyLoaderModuleNames = new Set(['dsh-remote', '@dsh-remote/plugin'])
// rc.2 requires the branded SettingsNamespace type, while v0.1.2-alpha.2+
// accepts and validates the literal directly after removing the helper.
const pluginSettingsNamespace = 'ds-harness-remote' as SettingsNamespace
const legacySettingsNamespace = 'dsh-remote' as SettingsNamespace

interface LoaderEntryLike {
  id: string
  options: {
    name?: string
    disabled?: boolean | null
  }
}

interface LoaderLike {
  entries(): Iterable<LoaderEntryLike>
  locate?(fiber?: unknown): string | undefined
  update(id: string, options: { disabled?: boolean | null }): unknown
}

export function apply(ctx: Context, input: ConfigInput = {}): void {
  const tuiCommandsAvailable = ctx.get('commands', false) !== undefined
    && ctx.get('tuiScenes', false) !== undefined
  const tuiBinding: TuiRemoteBinding | undefined = tuiCommandsAvailable ? {} : undefined
  // Entry-level TUI injects make this synchronous with the Loader activation,
  // which is required by dsh-TUI's authenticated scene/completion registries.
  if (tuiBinding !== undefined) installTuiRemoteCommand(ctx, () => tuiBinding.target)

  // A terminal-only dsh-TUI profile has no browser `connection` service.
  // Its rc.2 Gateway also has no stream carrier or ApiProxy, but the Host
  // control plane and `/remote` account commands remain useful. Desktop
  // profiles still wait for one complete official Harness carrier.
  const activateWhenCarrierReady = (runtimeContext: Context): void | Promise<void> => {
    const gateway = runtimeContext.get('typertGateway') as TypertGatewayLike
    const connection = runtimeContext.get('connection') as HostConnectionHandle | undefined
    const webServer = runtimeContext.get('webServer') as HostWebServerLike | undefined
    let disposePendingControl: (() => Promise<void>) | undefined
    const installPendingControl = (): void => {
      if (connection === undefined || disposePendingControl !== undefined) return
      disposePendingControl = runtimeContext.effect(() => {
        const control = new PluginControlRuntime(
          resolveConfig(input),
          new IdentityStore().directory,
          undefined,
          undefined,
          undefined,
        )
        return control.register(connection, webServer)
      }, 'dsh-remote pending control')
    }
    const startActiveRuntime = async (activeContext: Context): Promise<void> => {
      await disposePendingControl?.()
      disposePendingControl = undefined
      await activate(activeContext, input, tuiBinding)
    }
    if (
      tuiCommandsAvailable
      || runtimeContext.get('apiProxy') !== undefined
      || new TypertGatewaySwitch(gateway).supportsCarrier()
    ) {
      return startActiveRuntime(runtimeContext)
    }
    installPendingControl()
    runtimeContext.inject(['apiProxy'], legacyContext => startActiveRuntime(legacyContext))
  }

  if (tuiCommandsAvailable) {
    ctx.inject(['settings', 'typertGateway'], activateWhenCarrierReady)
  } else {
    ctx.inject(['settings', 'connection', 'typertGateway'], activateWhenCarrierReady)
  }
}

async function activate(
  ctx: Context,
  input: ConfigInput,
  tuiBinding?: TuiRemoteBinding,
): Promise<void> {
  const settings = ctx.get('settings')
  const settingsScope: SettingsScope<ConfigInput> | undefined = settings?.register(pluginSettingsNamespace, Config, {
    base: input,
    applies: 'restart',
    validate: value => { resolveConfig(value) },
  })
  if (settings !== undefined && settingsScope !== undefined) {
    const migration = migrateLegacySettings(settings, settingsScope)
    reportSettingsMigration(ctx, await migration)
  }
  const connection = ctx.get('connection') as HostConnectionHandle | undefined
  const webServer = ctx.get('webServer') as HostWebServerLike | undefined
  const resolvedConfig = resolveConfig(settingsScope?.get() ?? input)
  // dsh-TUI has no settings UI or browser connection. In that profile the
  // QR-authorized Host is enabled against the hosted Server by default.
  const config: ResolvedConfig = connection === undefined && resolvedConfig.serverUrl === undefined
    ? { ...resolvedConfig, serverUrl: DEFAULT_REMOTE_SERVER_URL }
    : resolvedConfig
  const defaultIdentityDirectory = new IdentityStore().directory
  if (!config.enabled) {
    if (connection !== undefined) {
      const controlRuntime = new PluginControlRuntime(config, defaultIdentityDirectory, settingsScope, undefined, undefined)
      ctx.effect(() => controlRuntime.register(connection, webServer), 'dsh-remote disabled control')
    }
    return
  }
  // Mirrors SafeLogger output to the process stdout/stderr as well as the DSH
  // logger: the web process stdout is captured by the Desktop shell into
  // desktop.log, so remote RPC/transport diagnostics stay greppable there.
  const logger = new SafeLogger({
    debug: message => { ctx.logger.debug(message); console.debug(message) },
    info: message => { ctx.logger.info(message); console.info(message) },
    warn: message => { ctx.logger.warn(message); console.warn(message) },
    error: message => { ctx.logger.error(message); console.error(message) },
  }, config.logLevel)
  const hostIdentities = new IdentityStore({
    directory: config.serverUrl === undefined
      ? defaultIdentityDirectory
      : serverStorageDirectory(defaultIdentityDirectory, config.serverUrl, 'host'),
  })
  const apiProxy = ctx.get('apiProxy') as ApiProxy | undefined
  // The official Typert gateway (`typertGateway` from dsh-api-gateway) is the
  // dispatch path behind `/api/commands/*` on the host. It is an explicit
  // activation dependency so a peer bridge never silently omits commands.
  const nativeTypertGateway = ctx.get('typertGateway') as TypertGatewayLike
  const localTypertGateway = new TypertGatewaySwitch(nativeTypertGateway).local()
  const runtime = new HostPluginRuntime(
    config,
    hostIdentities,
    apiProxy,
    logger,
    localTypertGateway,
    () => ctx.get('fileViewerHost') as FileViewerHostServiceLike | undefined,
  )

  let clientRuntime: ClientModeRuntime | undefined
  const hostControl = runtime
  if (config.serverUrl !== undefined && connection !== undefined) {
    const clientIdentities = new IdentityStore({
      directory: serverStorageDirectory(defaultIdentityDirectory, config.serverUrl, 'client'),
    })
    clientRuntime = new ClientModeRuntime(
      config,
      clientIdentities,
      new ClientServerApi(config.serverUrl, new ServerCredentialStore(clientIdentities.directory)),
      apiProxy,
      nativeTypertGateway,
      logger,
      hostControl,
    )
  }

  const controlRuntime = connection === undefined
    ? undefined
    : new PluginControlRuntime(config, defaultIdentityDirectory, settingsScope, clientRuntime, hostControl)

  ctx.provide('dshRemote', runtime)
  if (clientRuntime !== undefined) ctx.provide('dshRemoteClient', clientRuntime)
  const tuiTarget: TuiRemoteTarget = { runtime, config }
  if (tuiBinding !== undefined) tuiBinding.target = tuiTarget
  await disableLegacyLoaderEntries(ctx, logger)
  await ctx.effect(async () => {
    const disposeControl = controlRuntime?.register(connection!, webServer)
    try {
      await runtime.start()
      if (clientRuntime !== undefined) {
        await clientRuntime.start()
      } else {
        logger.warn('client remote mode is unavailable', {
          serverConfigured: config.serverUrl !== undefined,
          apiProxyAvailable: apiProxy !== undefined,
          remoteGatewayAvailable: localTypertGateway.supportsCarrier,
          connectionAvailable: connection !== undefined,
        })
      }
    } catch (error) {
      if (tuiBinding?.target === tuiTarget) tuiBinding.target = undefined
      await disposeControl?.()
      await clientRuntime?.close()
      await runtime.close()
      throw error
    }
    return async () => {
      if (tuiBinding?.target === tuiTarget) tuiBinding.target = undefined
      await disposeControl?.()
      await clientRuntime?.close()
      await runtime.close()
    }
  }, 'dsh-remote lifecycle')
}

function reportSettingsMigration(
  ctx: Context,
  migration: 'migrated' | 'skipped' | 'failed',
): void {
  if (migration === 'migrated') ctx.logger.info('migrated legacy Remote settings namespace')
  if (migration === 'failed') ctx.logger.warn('failed to migrate legacy Remote settings namespace')
}

/**
 * Preserve existing installs after the package/settings namespace rename. The
 * old section remains untouched as a rollback source; only its raw user layer
 * is copied, once, when the current namespace has no user layer of its own.
 */
export async function migrateLegacySettings(
  settings: Pick<SettingsProvider, 'register'> & Partial<Pick<SettingsProvider, 'describe'>>,
  currentScope: SettingsScope<ConfigInput>,
): Promise<'migrated' | 'skipped' | 'failed'> {
  if (typeof settings.describe !== 'function') return 'skipped'
  try {
    let descriptors = settings.describe()
    const current = descriptors.find(descriptor => descriptor.ns === pluginSettingsNamespace)
    if (isPlainRecord(current?.user)) return 'skipped'

    let legacy = descriptors.find(descriptor => descriptor.ns === legacySettingsNamespace)
    if (legacy === undefined) {
      settings.register(legacySettingsNamespace, Config, {
        applies: 'restart',
        validate: value => { resolveConfig(value) },
      })
      descriptors = settings.describe()
      legacy = descriptors.find(descriptor => descriptor.ns === legacySettingsNamespace)
    }
    if (!isPlainRecord(legacy?.user) || Object.keys(legacy.user).length === 0) return 'skipped'
    await currentScope.replace(legacy.user)
    return 'migrated'
  } catch {
    return 'failed'
  }
}

async function disableLegacyLoaderEntries(ctx: Context, logger: SafeLogger): Promise<void> {
  const loader = ctx.get('loader') as LoaderLike | undefined
  if (!isLoaderLike(loader)) return

  const currentEntryId = loader.locate?.(ctx.fiber)
  for (const entry of loader.entries()) {
    const moduleName = entry.options.name
    if (moduleName === undefined || !legacyLoaderModuleNames.has(moduleName)) continue
    if (entry.id === currentEntryId || entry.options.disabled === true) continue

    try {
      await loader.update(entry.id, { disabled: true })
      logger.warn('disabled legacy loader entry', { entryId: entry.id, moduleName })
    } catch {
      logger.warn('failed to disable legacy loader entry', {
        entryId: entry.id,
        moduleName,
        code: 'LOADER_UPDATE_FAILED',
      })
    }
  }
}

function isLoaderLike(value: unknown): value is LoaderLike {
  return typeof value === 'object' && value !== null
    && typeof (value as { entries?: unknown }).entries === 'function'
    && typeof (value as { update?: unknown }).update === 'function'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type { ResolvedConfig } from './config.js'
export { resolveConfig } from './config.js'
export { ConnectionController, ConnectionRejectedError } from './connection-controller.js'
export type { PeerConnectionContext, RpcRouterFactory } from './connection-controller.js'
export { fingerprint, IdentityInvalidError, IdentityStore } from './identity-store.js'
export { serverStorageDirectory } from './identity-store.js'
export type { HostIdentity, RemoteDeviceRole, TrustedPeer } from './identity-store.js'
export { ClientServerApi, HostServerApi, ServerApiError } from './server-api.js'
export { HostServerConnection } from './server-connection.js'
export type { WebSocketFactory } from './server-connection.js'
export { ServerCredentialStore, ServerCredentialsInvalidError } from './server-credentials.js'
export type { ServerCredentials } from './server-credentials.js'
export { HOST_CAPABILITIES, RpcError, RpcRouter } from './rpc-router.js'
export { HostPluginRuntime } from './service.js'
export { ApiProxySwitch } from './api-proxy-switch.js'
export { ClientModeError, ClientModeRuntime } from './client-runtime.js'
export { PluginControlRuntime } from './control-runtime.js'
export { ClientSecureTransport } from './client-secure-transport.js'
export { HARNESS_API_ALLOWLIST, HarnessApiBridge } from './harness-api-bridge.js'
export { HARNESS_REMOTE_ALLOWLIST, HarnessRemoteBridge } from './harness-remote-bridge.js'
export { RemoteHarnessApiProxy } from './remote-api-proxy.js'
export { RemoteTypertGateway } from './remote-typert-gateway.js'
export { RemoteFileViewerBridge } from './file-viewer-bridge.js'
export { CodexRemoteDomain } from './codex/domain.js'
export { CodexPeerBridge } from './codex/peer-bridge.js'
export { CodexAppServerClient, CodexAppServerError } from './codex/app-server.js'
export { CODEX_APP_ALLOWLIST } from './codex/method-policy.js'
export { createRemoteFileContentProvider } from './remote-file-content-provider.js'
export { TypertGatewaySwitch } from './typert-gateway-switch.js'
export { runCli } from './cli.js'
export type { RemoteCliDependencies } from './cli.js'
export type {
  LocalTypertGateway,
  RemoteTypertGatewayTarget,
  TypertGatewayLike,
  TypertGatewayRequest,
  TypertGatewayWireStreamLike,
  TypertRpcResult,
} from './typert-gateway-contract.js'
export type { AuthenticatedPeerChannel } from './types.js'
