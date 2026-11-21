import { Platform, type PressableAndroidRippleConfig, type TextStyle, type ViewStyle } from 'react-native'

function getPlatform(): typeof Platform | undefined {
  try {
    return Platform
  } catch {
    return undefined
  }
}

export const monoFontFamily: string = (() => {
  const platform = getPlatform()
  return typeof platform?.select === 'function'
    ? platform.select({ ios: 'Menlo', default: 'monospace' })
    : 'monospace'
})()

export const tabularNumsStyle: Pick<TextStyle, 'fontVariant'> = {
  fontVariant: ['tabular-nums'],
}

export function continuousRadius(borderRadius: number): ViewStyle {
  return getPlatform()?.OS === 'ios'
    ? { borderRadius, borderCurve: 'continuous' }
    : { borderRadius }
}

export function elevationStyle(colors: { shadow: string }, level: 0 | 1 | 2 | 3): ViewStyle {
  switch (level) {
    case 0:
      return { elevation: 0, shadowOpacity: 0 }
    case 1:
      return {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 1,
      }
    case 2:
      return {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.09,
        shadowRadius: 10,
        elevation: 3,
      }
    case 3:
      return {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 20,
        elevation: 8,
      }
  }
}

export function androidRipple(
  colors: { ink: string },
  borderless = false,
): PressableAndroidRippleConfig | undefined {
  if (getPlatform()?.OS !== 'android') return undefined
  return {
    color: colors.ink === '#0F0F0F' ? 'rgba(15, 15, 15, 0.08)' : 'rgba(242, 244, 247, 0.12)',
    borderless,
  }
}
