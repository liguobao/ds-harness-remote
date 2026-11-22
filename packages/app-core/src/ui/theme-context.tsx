import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import * as SystemUI from 'expo-system-ui'
import { useAppStore } from '../state/store'
import {
  DEFAULT_CHAT_APPEARANCE,
  resolveColorScheme,
  resolveThemeColors,
  type ChatAppearance,
  type ColorScheme,
  type ThemeColors,
} from './theme'

export interface Theme {
  colors: ThemeColors
  scheme: ColorScheme
  appearance: ChatAppearance
}

const ThemeContext = createContext<Theme>({
  colors: resolveThemeColors('light', DEFAULT_CHAT_APPEARANCE.accent),
  scheme: 'light',
  appearance: DEFAULT_CHAT_APPEARANCE,
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themePreference = useAppStore(state => state.themePreference)
  const appearance = useAppStore(state => state.chatAppearance)
  const systemScheme = useColorScheme()
  const scheme = resolveColorScheme(themePreference, systemScheme === 'dark' ? 'dark' : systemScheme === 'light' ? 'light' : undefined)
  const value = useMemo<Theme>(() => ({
    colors: resolveThemeColors(scheme, appearance.accent),
    scheme,
    appearance,
  }), [scheme, appearance])

  useEffect(() => {
    if (typeof SystemUI?.setBackgroundColorAsync === 'function') {
      void SystemUI.setBackgroundColorAsync(value.colors.background).catch(() => {})
    }
  }, [value.colors.background])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export type { ChatAppearance, ThemeColors } from './theme'
