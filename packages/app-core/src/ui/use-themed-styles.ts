import { useMemo } from 'react'
import { useTheme, type ChatAppearance, type ThemeColors } from './theme-context'

export function useThemedStyles<T>(
  factory: (colors: ThemeColors, appearance: ChatAppearance) => T,
): T {
  const { colors, appearance } = useTheme()
  return useMemo(() => factory(colors, appearance), [colors, appearance, factory])
}
