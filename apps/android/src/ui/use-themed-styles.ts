import { useMemo } from 'react'
import { useTheme, type ChatAppearance, type ThemeColors, type TypographyDensity } from './theme-context'

export function useThemedStyles<T>(
  factory: (colors: ThemeColors, density: TypographyDensity, appearance: ChatAppearance) => T,
): T {
  const { colors, density, appearance } = useTheme()
  return useMemo(() => factory(colors, density, appearance), [colors, density, appearance, factory])
}
