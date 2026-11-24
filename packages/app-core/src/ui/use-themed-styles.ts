import { useMemo } from 'react'
import { useTheme, type ChatAppearance, type ThemeColors } from './theme-context'

type StyleFactory = (colors: ThemeColors, appearance: ChatAppearance) => unknown

const themedStyleCache = new WeakMap<
  StyleFactory,
  WeakMap<ThemeColors, WeakMap<ChatAppearance, unknown>>
>()

const UNDEFINED_APPEARANCE = {} as ChatAppearance

export function getCachedThemedStyles<T>(
  factory: (colors: ThemeColors, appearance: ChatAppearance) => T,
  colors: ThemeColors,
  appearance: ChatAppearance,
): T {
  const appearanceKey = appearance ?? UNDEFINED_APPEARANCE
  if (
    typeof factory !== 'function'
    || colors === null
    || typeof colors !== 'object'
    || appearanceKey === null
    || typeof appearanceKey !== 'object'
  ) {
    return factory(colors, appearance)
  }

  let byColors = themedStyleCache.get(factory)
  if (byColors === undefined) {
    byColors = new WeakMap()
    themedStyleCache.set(factory, byColors)
  }

  let byAppearance = byColors.get(colors)
  if (byAppearance === undefined) {
    byAppearance = new WeakMap()
    byColors.set(colors, byAppearance)
  }

  if (byAppearance.has(appearanceKey)) {
    return byAppearance.get(appearanceKey) as T
  }

  const styles = factory(colors, appearance)
  byAppearance.set(appearanceKey, styles)
  return styles
}

export function useThemedStyles<T>(
  factory: (colors: ThemeColors, appearance: ChatAppearance) => T,
): T {
  const { colors, appearance } = useTheme()
  return useMemo(
    () => getCachedThemedStyles(factory, colors, appearance),
    [colors, appearance, factory],
  )
}
