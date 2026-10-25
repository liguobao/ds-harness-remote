import { useMemo } from 'react'
import { useTheme, type ThemeColors, type TypographyDensity } from './theme-context'

export function useThemedStyles<T>(factory: (colors: ThemeColors, density: TypographyDensity) => T): T {
  const { colors, density } = useTheme()
  return useMemo(() => factory(colors, density), [colors, density, factory])
}
