import { applyLanguagePreference, updateSystemLocales } from '../locales/i18n'
import {
  saveCellularSkipP2p,
  saveDefaultPermissionPreset,
  saveCompactHistory,
  saveLanguagePreference,
  saveThemePreference,
  saveTypographyDensity,
  saveStatusBarVisible,
  saveTransportPreference,
} from '../services/storage'
import type { AppState, StoreAccess } from './store-state'

export function createPreferenceActions({ set, get }: StoreAccess): Pick<AppState,
  'setCompactHistory' | 'setCellularSkipP2p' | 'setTransportPreference' | 'setLanguagePreference' | 'setThemePreference' | 'setTypographyDensity' | 'setStatusBarVisible' | 'setDefaultPermissionPreset' | 'syncSystemLocales'> {
  return {
    async setCompactHistory(compactHistory) {
      await saveCompactHistory(compactHistory)
      set({ compactHistory })
    },
    async setCellularSkipP2p(cellularSkipP2p) {
      await saveCellularSkipP2p(cellularSkipP2p)
      // Applies to the next connection; the current carrier stays untouched.
      set({ cellularSkipP2p })
    },
    async setTransportPreference(preference) {
      await saveTransportPreference(preference)
      const wasConnected = get().connection.phase === 'connected' || get().connection.phase === 'reconnecting'
      // An explicit path change is the user asking to try again: clear the
      // session's relay downgrade so the new choice actually applies.
      set({ transportPreference: preference, relayOnlyUntil: undefined })
      if (wasConnected) await get().reconnect()
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
