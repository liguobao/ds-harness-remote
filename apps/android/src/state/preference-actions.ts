import { applyLanguagePreference, updateSystemLocales } from '../locales/i18n'
import {
  saveDefaultPermissionPreset,
  saveCompactHistory,
  saveLanguagePreference,
  saveThemePreference,
  saveTypographyDensity,
  saveStatusBarVisible,
  saveTransportPreference,
} from '../services/storage'
import type { AppState } from './store-state'
import type { SessionAccess } from './session-runtime'

export function createPreferenceActions({ set, get, runtime }: SessionAccess): Pick<AppState,
  'setCompactHistory' | 'setTransportPreference' | 'setLanguagePreference' | 'setThemePreference' | 'setTypographyDensity' | 'setStatusBarVisible' | 'setDefaultPermissionPreset' | 'syncSystemLocales'> {
  return {
    async setCompactHistory(compactHistory) {
      await saveCompactHistory(compactHistory)
      set({ compactHistory })
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

    async setStatusBarVisible(statusBarVisible) {
      await saveStatusBarVisible(statusBarVisible)
      set({ statusBarVisible })
    },

    async setThemePreference(themePreference) {
      await saveThemePreference(themePreference)
      set({ themePreference })
    },

    async setTypographyDensity(typographyDensity) {
      await saveTypographyDensity(typographyDensity)
      set({ typographyDensity })
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
