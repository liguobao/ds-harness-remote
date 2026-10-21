import { applyLanguagePreference, updateSystemLocales } from '../locales/i18n'
import {
  saveDefaultPermissionPreset,
  saveLanguagePreference,
  saveThemePreference,
  saveStatusBarVisible,
  saveTransportPreference,
} from '../services/storage'
import type { AppState, StoreAccess } from './store-state'

export function createPreferenceActions({ set, get }: StoreAccess): Pick<AppState,
  'setTransportPreference' | 'setLanguagePreference' | 'setThemePreference' | 'setStatusBarVisible' | 'setDefaultPermissionPreset' | 'syncSystemLocales'> {
  return {
    async setTransportPreference(preference) {
      await saveTransportPreference(preference)
      const wasConnected = get().connection.phase === 'connected' || get().connection.phase === 'reconnecting'
      set({ transportPreference: preference })
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
