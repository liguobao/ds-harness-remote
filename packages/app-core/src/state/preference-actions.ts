import { serverSession } from '../services/server-session'
import { applyLanguagePreference, updateSystemLocales } from '../locales/i18n'
import { DEFAULT_CHAT_APPEARANCE, normalizeChatAppearance } from '../ui/theme'
import {
  saveActivityDockMode,
  saveBusySendMode,
  saveChatAppearance,
  saveDefaultPermissionPreset,
  saveQuickPromptActionMode,
  saveCompactHistory,
  saveLanguagePreference,
  saveThemePreference,
  MEMBERSHIP_LINK_HIDE_MS,
  saveMemberShortcutScopes,
  saveMembershipLinkHiddenUntil,
  saveStatusBarVisible,
  saveTransportPreference,
} from '../services/storage'
import type { AppState } from './store-state'
import type { SessionAccess } from './session-runtime'

export function createPreferenceActions({ set, get, runtime }: SessionAccess): Pick<AppState,
  'setCompactHistory' | 'setTransportPreference' | 'setLanguagePreference' | 'setThemePreference' | 'setChatAppearance' | 'resetChatAppearance' | 'setActivityDockMode' | 'setQuickPromptActionMode' | 'setBusySendMode' | 'setStatusBarVisible' | 'hideMembershipLink' | 'refreshAccountMembership' | 'setDefaultPermissionPreset' | 'syncSystemLocales'> {
  return {
    async setCompactHistory(compactHistory) {
      await saveCompactHistory(compactHistory)
      set({ compactHistory })
    },
    async setActivityDockMode(activityDockMode) {
      await saveActivityDockMode(activityDockMode)
      set({ activityDockMode })
    },
    async setQuickPromptActionMode(quickPromptActionMode) {
      await saveQuickPromptActionMode(quickPromptActionMode)
      set({ quickPromptActionMode })
    },
    async setBusySendMode(busySendMode) {
      await saveBusySendMode(busySendMode)
      set({ busySendMode })
    },
    async setTransportPreference(preference) {
      await saveTransportPreference(preference)
      const phase = get().connection.phase
      const wasActive = phase === 'connected' || phase === 'connecting' || phase === 'reconnecting'
      // An explicit choice starts a fresh attempt, including when reselecting
      // the same mode after an automatic Relay downgrade.
      runtime.webRtcFallbackStreak = 0
      if (wasActive) {
        ++runtime.connectionGeneration
        ++runtime.sessionLoadGeneration
        runtime.reconnectFlight = undefined
      }
      set(state => ({
        transportPreference: preference,
        relayOnlyUntil: undefined,
        ...(wasActive ? { connection: { ...state.connection, phase: 'offline' as const } } : {}),
      }))
      if (wasActive) await get().reconnect()
    },

    async setLanguagePreference(languagePreference) {
      await saveLanguagePreference(languagePreference)
      const language = applyLanguagePreference(languagePreference)
      set({ languagePreference, language })
    },

    async refreshAccountMembership() {
      const { config, identity, account } = get()
      if (!config || !identity || !account) return
      const { api, credentials } = await serverSession.authenticate(config.baseUrl, identity)
      if (credentials.account !== undefined && credentials.account !== account) return
      const membership = await api.deviceAccountMembership()
      const current = get()
      if (current.config?.baseUrl !== config.baseUrl || current.account !== account || current.identity !== identity) return
      const scope = JSON.stringify([config.baseUrl, account])
      if (membership.status === 'active' && !current.memberShortcutScopes.includes(scope)) {
        const scopes = [...current.memberShortcutScopes, scope]
        await saveMemberShortcutScopes(scopes)
        if (get().identity === identity) set({ memberShortcutScopes: scopes })
      }
      return membership
    },

    async hideMembershipLink() {
      const membershipLinkHiddenUntil = Date.now() + MEMBERSHIP_LINK_HIDE_MS
      await saveMembershipLinkHiddenUntil(membershipLinkHiddenUntil)
      set({ membershipLinkHiddenUntil })
    },

    async setStatusBarVisible(statusBarVisible) {
      await saveStatusBarVisible(statusBarVisible)
      set({ statusBarVisible })
    },

    async setThemePreference(themePreference) {
      await saveThemePreference(themePreference)
      set({ themePreference })
    },

    async setChatAppearance(partial) {
      const next = normalizeChatAppearance({ ...get().chatAppearance, ...partial })
      await saveChatAppearance(next)
      set({ chatAppearance: next })
    },

    async resetChatAppearance() {
      const next = { ...DEFAULT_CHAT_APPEARANCE }
      await saveChatAppearance(next)
      set({ chatAppearance: next })
    },

    async setDefaultPermissionPreset(defaultPermissionPreset) {
      await saveDefaultPermissionPreset(defaultPermissionPreset)
      set({ defaultPermissionPreset })
    },

    syncSystemLocales(localeTags) {
      const language = updateSystemLocales(localeTags)
      if (language !== get().language) set({ language })
    },
  }
}
