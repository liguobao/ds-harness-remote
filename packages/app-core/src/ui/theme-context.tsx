import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { useAppStore } from '../state/store'
import {
  DEFAULT_CHAT_APPEARANCE,
  resolveColorScheme,
  resolveThemeColors,
  type ChatAppearance,
  type ColorScheme,
  type ThemeColors,
  type TypographyDensity,
} from './theme'

export interface Theme {
  colors: ThemeColors
  scheme: ColorScheme
  density: TypographyDensity
  appearance: ChatAppearance
}

const ThemeContext = createContext<Theme>({
  colors: resolveThemeColors('light', DEFAULT_CHAT_APPEARANCE.accent),
  scheme: 'light',
  density: 'compact',
  appearance: DEFAULT_CHAT_APPEARANCE,
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themePreference = useAppStore(state => state.themePreference)
  const density = useAppStore(state => state.typographyDensity)
  const appearance = useAppStore(state => state.chatAppearance)
  const systemScheme = useColorScheme()
  const scheme = resolveColorScheme(themePreference, systemScheme === 'dark' ? 'dark' : systemScheme === 'light' ? 'light' : undefined)
  const value = useMemo<Theme>(() => ({
    colors: resolveThemeColors(scheme, appearance.accent),
    scheme,
    density,
    appearance,
  }), [scheme, density, appearance])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export type { ChatAppearance, ThemeColors, TypographyDensity } from './theme'
