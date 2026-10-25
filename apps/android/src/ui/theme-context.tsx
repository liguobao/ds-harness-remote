import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { useAppStore } from '../state/store'
import { colorsForScheme, resolveColorScheme, type ColorScheme, type ThemeColors, type TypographyDensity } from './theme'

export interface Theme {
  colors: ThemeColors
  scheme: ColorScheme
  density: TypographyDensity
}

const ThemeContext = createContext<Theme>({
  colors: colorsForScheme('light'),
  scheme: 'light',
  density: 'compact',
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themePreference = useAppStore(state => state.themePreference)
  const density = useAppStore(state => state.typographyDensity)
  const systemScheme = useColorScheme()
  const scheme = resolveColorScheme(themePreference, systemScheme === 'dark' ? 'dark' : systemScheme === 'light' ? 'light' : undefined)
  const value = useMemo<Theme>(() => ({
    colors: colorsForScheme(scheme),
    scheme,
    density,
  }), [scheme, density])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export type { ThemeColors, TypographyDensity } from './theme'
