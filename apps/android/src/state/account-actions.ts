import { normalizeServerUrl } from '../lib/server-url'
import * as Haptics from 'expo-haptics'
import { resolveAutoConnectDevice } from '../lib/auto-connect'
import { friendlyError, isSessionAuthError } from '../lib/errors'
import { applyLanguagePreference, strings as zhCN } from '../locales/i18n'
import { reconcileTrustedDevices } from '../services/device-directory'
import { RemoteServerApi } from '../services/api'
import type { LoginOutcome } from '../services/login'
import {
  githubOAuthLoginChannel,
  googleOAuthLoginChannel,
  loginFlow,
  oauthLoginChannel,
  passwordLoginChannel,
  redirectLoginChannelFor,
} from '../services/login'
import { serverSession } from '../services/server-session'
import {
  clearCodexPermissionPresets,
  clearDeviceCredentials,
  clearLastConnectedDeviceId,
  clearLocalData,
  forgetHost,
  loadDefaultPermissionPreset,
  loadFavoriteWorkspaces,
  loadCompactHistory,
  loadLanguagePreference,
  loadLastConnectedDeviceId,
  loadOrCreateIdentity,
  loadRecentWorkspaces,
  loadServerConfig,
  loadThemePreference,
  loadTypographyDensity,
  loadStatusBarVisible,
  loadTransportPreference,
  loadTrustedHosts,
  saveDefaultPermissionPreset,
  saveFavoriteWorkspaces,
  saveCompactHistory,
  saveLanguagePreference,
  saveRecentWorkspaces,
  saveServerConfig,
  saveThemePreference,
  saveTypographyDensity,
  saveStatusBarVisible,
  trustHost,
} from '../services/storage'
import type { ServerConfig, WorkspaceShortcut } from '../types'
import type { AppState, QrLoginStart, QrProviderList, StoreAccess } from './store-state'
import { clearBrowseMemory } from '../services/browse-memory'
import { initialData } from './store-state'

type AccountActions = Pick<AppState,
  'bootstrap' | 'requireReauth' | 'consumePendingAutoConnect' | 'configureServer' | 'selectServer' | 'startOAuth' | 'startGithubOAuth' | 'startGoogleOAuth' | 'completeOAuth' | 'listQrProviders' | 'listLoginProviders' | 'startQrLogin' | 'pollQrLogin' | 'completeQrLogin' | 'refreshDevices' | 'trustDevice' | 'renameDevice' | 'forgetDevice' | 'resetLocalData' | 'signOut'>

export function createAccountActions({ set, get }: StoreAccess): AccountActions {
  let accountGeneration = 0
  let refreshGeneration = 0
  let accountChanges = 0
  let effects: Promise<unknown> = Promise.resolve()

  // Credential refresh and directory cleanup can write SecureStore. Account
  // changes wait for already-started writes before publishing a new account.
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = effects.then(operation)
    effects = next.catch(() => undefined)
    return next
  }

  function captureAccount(): () => boolean {
    const generation = accountGeneration
    const { config, identity } = get()
    return () => generation === accountGeneration && get().config === config && get().identity === identity
  }

  async function change<T>(operation: () => Promise<T>, refresh = false): Promise<T> {
    const generation = ++accountGeneration
    ++refreshGeneration
    ++accountChanges
    set({ refreshing: false, pendingAutoConnectDeviceId: undefined })
    let result: T
    try {
      result = await exclusive(operation)
    } finally {
      --accountChanges
    }
    if (refresh && result !== false && accountChanges === 0 && generation === accountGeneration) {
      await get().refreshDevices()
    }
    return result
  }

  async function login(operation: () => Promise<boolean>): Promise<boolean> {
    const generation = accountGeneration + 1
    const success = await change(operation, true)
    return success && generation === accountGeneration && !get().reauthRequired
  }

  async function redirect(operation: () => Promise<string | undefined>): Promise<string | undefined> {
    const generation = accountGeneration + 1
    const url = await change(operation)
    return generation === accountGeneration ? url : undefined
  }

  const actions: AccountActions = {
    async bootstrap() {
      set({ bootPhase: 'loading', error: undefined, pendingAutoConnectDeviceId: undefined, reauthRequired: false })
      try {
        const [config, identity, transportPreference, languagePreference, themePreference, typographyDensity, statusBarVisible, favoriteWorkspaces, recentWorkspaces, lastConnectedDeviceId, defaultPermissionPreset, compactHistory] = await Promise.all([
          loadServerConfig(),
          loadOrCreateIdentity(),
          loadTransportPreference(),
          loadLanguagePreference(),
          loadThemePreference(),
          loadTypographyDensity(),
          loadStatusBarVisible(),
          loadFavoriteWorkspaces(),
          loadRecentWorkspaces(),
          loadLastConnectedDeviceId(),
          loadDefaultPermissionPreset(),
          loadCompactHistory(),
        ])
        const language = applyLanguagePreference(languagePreference)
        set({
          config,
          identity,
          account: config?.account,
          transportPreference,
          languagePreference,
          language,
          themePreference,
          typographyDensity,
          statusBarVisible,
          compactHistory,
          defaultPermissionPreset,
          favoriteWorkspaces,
          recentWorkspaces,
          lastConnectedDeviceId,
        })
        // The public wrapper refreshes only after the account transaction commits.
        set({ bootPhase: 'ready' })
      } catch (error) {
        set({ bootPhase: 'error', error: friendlyError(error) })
      }
    },

    async requireReauth(message) {
      await get().disconnect()
      await clearDeviceCredentials()
      const config = get().config
      const nextConfig = config === undefined
        ? undefined
        : { baseUrl: config.baseUrl, ...(config.loginMethod === undefined ? {} : { loginMethod: config.loginMethod }) }
      if (nextConfig !== undefined) await saveServerConfig(nextConfig)
      set({
        config: nextConfig,
        account: undefined,
        devices: [],
        pendingAutoConnectDeviceId: undefined,
        refreshing: false,
        busyAction: undefined,
        reauthRequired: true,
        error: message,
      })
    },

    async selectServer(input) {
      set({ busyAction: 'server', error: undefined })
      try {
        const baseUrl = normalizeServerUrl(input)
        await new RemoteServerApi(baseUrl).health()
        if (baseUrl !== get().config?.baseUrl) {
          await get().disconnect()
          await clearDeviceCredentials()
          for (const host of await loadTrustedHosts()) {
            await forgetHost(host.deviceId)
            await clearCodexPermissionPresets(host.deviceId)
          }
          await clearLastConnectedDeviceId()
          const config = { baseUrl }
          await saveServerConfig(config)
          set({ config, account: undefined, devices: [], lastConnectedDeviceId: undefined,
            pendingAutoConnectDeviceId: undefined, pendingOAuthBaseUrl: undefined,
            pendingOAuthLoginMethod: undefined, reauthRequired: true, authPhase: 'idle' })
        }
        set({ busyAction: undefined })
        return baseUrl
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return undefined
      }
    },

    async configureServer(input, email, password) {
      set({ busyAction: passwordLoginChannel.busyAction, error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        const context = await loginFlow.createContext(input, identity)
        const outcome = await loginFlow.signInWith(passwordLoginChannel, context, { email, password })
        return await finalizeLogin(set, context.baseUrl, outcome)
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async startOAuth(input) {
      set({ busyAction: oauthLoginChannel.prepareBusyAction, error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        const context = await loginFlow.createContext(input, identity)
        set({ pendingOAuthBaseUrl: context.baseUrl, pendingOAuthLoginMethod: 'oauth', busyAction: undefined })
        return await loginFlow.prepareRedirect(oauthLoginChannel, context)
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return undefined
      }
    },

    async startGithubOAuth(input) {
      set({ busyAction: githubOAuthLoginChannel.prepareBusyAction, error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        const context = await loginFlow.createContext(input, identity)
        set({
          pendingOAuthBaseUrl: context.baseUrl,
          pendingOAuthLoginMethod: 'github-oauth',
          busyAction: undefined,
        })
        return await loginFlow.prepareRedirect(githubOAuthLoginChannel, context)
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return undefined
      }
    },

    async startGoogleOAuth(input) {
      set({ busyAction: googleOAuthLoginChannel.prepareBusyAction, error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        const context = await loginFlow.createContext(input, identity)
        set({
          pendingOAuthBaseUrl: context.baseUrl,
          pendingOAuthLoginMethod: 'google-oauth',
          busyAction: undefined,
        })
        return await loginFlow.prepareRedirect(googleOAuthLoginChannel, context)
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return undefined
      }
    },

    async completeOAuth(token) {
      const baseUrl = get().pendingOAuthBaseUrl
      const loginMethod = get().pendingOAuthLoginMethod
      const channel = redirectLoginChannelFor(loginMethod)
      if (baseUrl === undefined || token.length < 16) {
        set({ pendingOAuthBaseUrl: undefined, pendingOAuthLoginMethod: undefined })
        return false
      }
      set({ pendingOAuthBaseUrl: undefined, pendingOAuthLoginMethod: undefined })
      set({ busyAction: channel.completeBusyAction, error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        const context = await loginFlow.createContext(baseUrl, identity)
        const outcome = await loginFlow.completeRedirect(channel, context, token)
        return await finalizeLogin(set, context.baseUrl, outcome)
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async listLoginProviders(input) {
      set({ error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        const context = await loginFlow.createContext(input, identity)
        const providers = (await context.publicApi.oauthProviders())
        return { baseUrl: context.baseUrl, providers } satisfies QrProviderList
      } catch (error) {
        set({ error: friendlyError(error) })
        return undefined
      }
    },

    async listQrProviders(input) {
      set({ error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        const context = await loginFlow.createContext(input, identity)
        const providers = (await context.publicApi.oauthProviders())
          .filter(provider => provider.qrStartUrl !== undefined)
        return { baseUrl: context.baseUrl, providers } satisfies QrProviderList
      } catch (error) {
        set({ error: friendlyError(error) })
        return undefined
      }
    },

    async startQrLogin(input, providerId) {
      set({ busyAction: 'oauth', error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        const context = await loginFlow.createContext(input, identity)
        const provider = (await context.publicApi.oauthProviders())
          .find(item => item.id === providerId && item.qrStartUrl !== undefined)
        if (provider === undefined) throw new Error(zhCN.setup.qrUnsupported)
        const session = await context.publicApi.startOAuthQrLogin(provider)
        set({ busyAction: undefined })
        return { baseUrl: context.baseUrl, provider, session } satisfies QrLoginStart
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return undefined
      }
    },

    async pollQrLogin(baseUrl, qrId) {
      // Poll failures stay local to the sign-in panel: a transient network
      // error must not replace the whole app error banner while scanning.
      try {
        return await new RemoteServerApi(baseUrl).pollOAuthQrLogin(qrId)
      } catch {
        return undefined
      }
    },

    async completeQrLogin(baseUrl, token, method) {
      set({ busyAction: 'server', error: undefined })
      try {
        const identity = get().identity
        if (identity === undefined) throw new Error(zhCN.runtime.identityNotReady)
        if (token.length < 16) throw new Error(zhCN.setup.qrFailed)
        const context = await loginFlow.createContext(baseUrl, identity)
        const outcome = await loginFlow.completeRedirect(redirectLoginChannelFor(method), context, token)
        return await finalizeLogin(set, context.baseUrl, outcome)
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async refreshDevices() {
      const { config, identity } = get()
      if (accountChanges > 0 || config === undefined || identity === undefined) return
      const sameAccount = captureAccount()
      const refresh = ++refreshGeneration
      const current = () => sameAccount() && refresh === refreshGeneration && accountChanges === 0
      set({ refreshing: true })
      try {
        const authenticated = await exclusive(async () => {
          if (!current()) return undefined
          const trusted = await loadTrustedHosts()
          if (!current()) return undefined
          const session = await serverSession.authenticate(config.baseUrl, identity)
          return { ...session, trusted }
        })
        if (!current() || authenticated === undefined) return
        const result = await reconcileTrustedDevices(authenticated.api, authenticated.trusted)
        if (!current()) return
        await exclusive(async () => {
          // Sequential read/modify/write avoids losing removals from the same
          // trusted-host list, and no new account can publish during cleanup.
          for (const deviceId of result.missingTrustedDeviceIds) {
            if (!current()) return
            await forgetHost(deviceId)
            if (!current()) return
            await clearCodexPermissionPresets(deviceId)
          }
        })
        if (!current()) return
        set(state => ({
          devices: result.devices,
          selectedDevice: state.selectedDevice === undefined ? undefined : {
            ...state.selectedDevice,
            name: result.devices.find(device => device.deviceId === state.selectedDevice?.deviceId)?.name ?? state.selectedDevice.name,
          },
          refreshing: false,
        }))
      } catch (error) {
        if (!current()) return
        if (isSessionAuthError(error)) {
          await get().requireReauth(friendlyError(error))
          return
        }
        set({ refreshing: false, error: friendlyError(error) })
      }
    },

    async trustDevice(device) {
      const current = captureAccount()
      if (accountChanges > 0 || device.identityKey.length === 0) return false
      await exclusive(async () => { if (current()) await trustHost(device) })
      if (!current()) return false
      set(state => ({
        devices: state.devices.map(item => item.deviceId === device.deviceId ? { ...item, trusted: true } : item),
      }))
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      return true
    },

    consumePendingAutoConnect() {
      const deviceId = get().pendingAutoConnectDeviceId
      if (deviceId !== undefined) set({ pendingAutoConnectDeviceId: undefined })
      return deviceId
    },

    async renameDevice(deviceId, name) {
      const { config, identity, busyAction } = get()
      const current = captureAccount()
      const trimmed = name.trim()
      if (accountChanges > 0 || config === undefined || identity === undefined || busyAction !== undefined || trimmed.length === 0) return false
      set({ busyAction: `rename-device:${deviceId}`, error: undefined })
      try {
        const authenticated = await exclusive(async () => current()
          ? serverSession.authenticate(config.baseUrl, identity) : undefined)
        if (!current() || authenticated === undefined) return false
        const { api } = authenticated
        const renamed = await api.renameAccountDevice(deviceId, trimmed)
        // Ignore an old account's response after sign-out or server switching.
        if (!current()) return false
        const updateShortcut = (item: WorkspaceShortcut) => item.deviceId === deviceId
          ? { ...item, deviceName: renamed.name }
          : item
        const favoriteWorkspaces = get().favoriteWorkspaces.map(updateShortcut)
        const recentWorkspaces = get().recentWorkspaces.map(updateShortcut)
        set(state => ({
          devices: state.devices.map(device => device.deviceId === deviceId ? { ...device, name: renamed.name } : device),
          selectedDevice: state.selectedDevice?.deviceId === deviceId
            ? { ...state.selectedDevice, name: renamed.name }
            : state.selectedDevice,
          favoriteWorkspaces,
          recentWorkspaces,
        }))
        await exclusive(async () => {
          if (!current()) return
          await saveFavoriteWorkspaces(favoriteWorkspaces)
          if (current()) await saveRecentWorkspaces(recentWorkspaces)
        })
        if (!current()) return false
        set({ busyAction: undefined })
        return true
      } catch (error) {
        if (!current()) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        if (isSessionAuthError(error)) await get().requireReauth(friendlyError(error))
        return false
      }
    },

    async forgetDevice(deviceId) {
      const { config, identity } = get()
      if (config === undefined || identity === undefined) return false
      set({ busyAction: `forget:${deviceId}`, error: undefined })
      try {
        const { api } = await serverSession.authenticate(config.baseUrl, identity)
        await api.removeAccountDevice(deviceId)
        if (get().selectedDevice?.deviceId === deviceId) await get().disconnect()
        await forgetHost(deviceId)
        await clearCodexPermissionPresets(deviceId)
        const clearedLast = get().lastConnectedDeviceId === deviceId
        if (clearedLast) await clearLastConnectedDeviceId()
        const favoriteWorkspaces = get().favoriteWorkspaces.filter(item => item.deviceId !== deviceId)
        if (favoriteWorkspaces.length !== get().favoriteWorkspaces.length) {
          await saveFavoriteWorkspaces(favoriteWorkspaces)
        }
        const recentWorkspaces = get().recentWorkspaces.filter(item => item.deviceId !== deviceId)
        if (recentWorkspaces.length !== get().recentWorkspaces.length) {
          await saveRecentWorkspaces(recentWorkspaces)
        }
        set(state => ({
          devices: state.devices.filter(device => device.deviceId !== deviceId),
          favoriteWorkspaces,
          recentWorkspaces,
          lastConnectedDeviceId: clearedLast ? undefined : state.lastConnectedDeviceId,
          pendingAutoConnectDeviceId: state.pendingAutoConnectDeviceId === deviceId
            ? undefined
            : state.pendingAutoConnectDeviceId,
          busyAction: undefined,
        }))
        return true
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async resetLocalData() {
      await get().disconnect()
      await clearBrowseMemory()
      await clearLocalData()
      const identity = await loadOrCreateIdentity()
      const language = applyLanguagePreference('system')
      set({
        ...initialData(),
        identity,
        languagePreference: 'system',
        language,
        themePreference: 'system',
        typographyDensity: 'compact',
        statusBarVisible: true,
        compactHistory: false,
        defaultPermissionPreset: 'default',
        lastConnectedDeviceId: undefined,
        pendingAutoConnectDeviceId: undefined,
        reauthRequired: false,
        bootPhase: 'ready',
      })
    },

    async signOut() {
      const { config, identity, languagePreference, themePreference, typographyDensity, statusBarVisible, defaultPermissionPreset, compactHistory } = get()
      await get().disconnect()
      await clearBrowseMemory()
      if (config !== undefined && identity !== undefined) {
        try {
          const { api } = await serverSession.authenticate(config.baseUrl, identity)
          await api.removeSelf()
        } catch {
          // Local sign-out must still complete if the server is unavailable.
        }
      }
      await clearLocalData()
      await saveLanguagePreference(languagePreference)
      await saveThemePreference(themePreference)
      await saveTypographyDensity(typographyDensity)
      await saveStatusBarVisible(statusBarVisible)
      await saveCompactHistory(compactHistory)
      await saveDefaultPermissionPreset(defaultPermissionPreset)
      const nextIdentity = await loadOrCreateIdentity()
      set({
        ...initialData(),
        identity: nextIdentity,
        lastConnectedDeviceId: undefined,
        pendingAutoConnectDeviceId: undefined,
        reauthRequired: false,
        bootPhase: 'ready',
      })
    },
  }

  return {
    ...actions,
    bootstrap: async () => {
      const generation = accountGeneration + 1
      await change(() => actions.bootstrap(), true)
      if (generation === accountGeneration && get().bootPhase === 'ready' && !get().reauthRequired && accountChanges === 0) {
        set({ pendingAutoConnectDeviceId: resolveAutoConnectDevice(get().devices, get().lastConnectedDeviceId)?.deviceId })
      }
    },
    selectServer: input => redirect(() => actions.selectServer(input)),
    configureServer: (...args) => login(() => actions.configureServer(...args)),
    completeOAuth: token => login(() => actions.completeOAuth(token)),
    listLoginProviders: input => actions.listLoginProviders(input),
    listQrProviders: async input => {
      const generation = accountGeneration + 1
      const result = await change(() => actions.listQrProviders(input))
      return generation === accountGeneration ? result : undefined
    },
    startQrLogin: async (input, providerId) => {
      const generation = accountGeneration + 1
      const result = await change(() => actions.startQrLogin(input, providerId))
      return generation === accountGeneration ? result : undefined
    },
    pollQrLogin: (baseUrl, qrId) => actions.pollQrLogin(baseUrl, qrId),
    completeQrLogin: (baseUrl, token, method) => login(() => actions.completeQrLogin(baseUrl, token, method)),
    startOAuth: input => redirect(() => actions.startOAuth(input)),
    startGithubOAuth: input => redirect(() => actions.startGithubOAuth(input)),
    startGoogleOAuth: input => redirect(() => actions.startGoogleOAuth(input)),
    requireReauth: message => change(() => actions.requireReauth(message)),
    signOut: () => change(() => actions.signOut()),
    resetLocalData: () => change(() => actions.resetLocalData()),
    forgetDevice: deviceId => {
      const current = captureAccount()
      return exclusive(async () => current() && accountChanges === 0 ? actions.forgetDevice(deviceId) : false)
    },
  }
}

async function finalizeLogin(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  baseUrl: string,
  outcome: LoginOutcome,
): Promise<boolean> {
  const config: ServerConfig = {
    baseUrl,
    account: outcome.account,
    loginMethod: outcome.loginMethod,
  }
  await saveServerConfig(config)
  set({
    config,
    account: outcome.account,
    busyAction: undefined,
    devices: [],
    authPhase: 'complete',
    reauthRequired: false,
    error: undefined,
  })
  return true
}
