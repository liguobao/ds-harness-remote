import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useTheme, type ThemeColors } from './theme-context'

function safeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '')
}

function splitStopColor(color: string, factor = 1): { stopColor: string; stopOpacity: number } {
  const rgba = color.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i)
  if (rgba) {
    const alpha = Math.max(0, Math.min(1, Number.parseFloat(rgba[4]!) * factor))
    return { stopColor: `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})`, stopOpacity: alpha }
  }
  return { stopColor: color, stopOpacity: factor }
}

/**
 * Ambient multi-orb backdrop behind screens so frosted Liquid Glass surfaces
 * have soft chromatic depth to refract while preserving neutral canvas contrast.
 */
export function LiquidCanvasBackground({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors, scheme } = useTheme()
  const primaryGlow = colors.glassCanvasGlow ?? colors.primary
  const secondaryGlow = colors.glassCanvasSecondaryGlow ?? '#38BDF8'
  const rawId = `${scheme}_${safeSvgId(primaryGlow)}_${safeSvgId(secondaryGlow)}`
  const topOpacity = scheme === 'dark' ? 0.17 : 0.095
  const bottomOpacity = scheme === 'dark' ? 0.12 : 0.07
  const top0 = splitStopColor(primaryGlow, topOpacity)
  const top1 = splitStopColor(primaryGlow, topOpacity * 0.35)
  const top2 = splitStopColor(primaryGlow, 0)
  const bot0 = splitStopColor(secondaryGlow, bottomOpacity)
  const bot1 = splitStopColor(secondaryGlow, bottomOpacity * 0.3)
  const bot2 = splitStopColor(secondaryGlow, 0)

  return (
    <Svg style={[StyleSheet.absoluteFill, style]} pointerEvents="none" accessible={false}>
      <Defs>
        <RadialGradient id={`lgTop${rawId}`} cx="84%" cy="10%" rx="68%" ry="44%">
          <Stop offset="0" stopColor={top0.stopColor} stopOpacity={top0.stopOpacity} />
          <Stop offset="0.55" stopColor={top1.stopColor} stopOpacity={top1.stopOpacity} />
          <Stop offset="1" stopColor={top2.stopColor} stopOpacity={top2.stopOpacity} />
        </RadialGradient>
        <RadialGradient id={`lgBot${rawId}`} cx="14%" cy="84%" rx="62%" ry="40%">
          <Stop offset="0" stopColor={bot0.stopColor} stopOpacity={bot0.stopOpacity} />
          <Stop offset="0.6" stopColor={bot1.stopColor} stopOpacity={bot1.stopOpacity} />
          <Stop offset="1" stopColor={bot2.stopColor} stopOpacity={bot2.stopOpacity} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#lgTop${rawId})`} />
      <Rect width="100%" height="100%" fill={`url(#lgBot${rawId})`} />
    </Svg>
  )
}

/**
 * Specular optical sheen overlay for Liquid Glass surfaces: catches light along
 * the top edge and gives subtle bottom refraction without intercepting touches.
 */
export function GlassSheen({
  prominent = false,
  style,
}: {
  prominent?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { colors, scheme } = useTheme()
  const top = colors.glassSpecularTop ?? (scheme === 'dark' ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.64)')
  const mid = colors.glassSpecularMid ?? (scheme === 'dark' ? 'rgba(255, 255, 255, 0.025)' : 'rgba(255, 255, 255, 0.12)')
  const bottom = colors.glassSpecularBottom ?? (scheme === 'dark' ? 'rgba(255, 255, 255, 0.055)' : 'rgba(255, 255, 255, 0.28)')
  const rawId = `${scheme}_${prominent ? 'p' : 's'}_${safeSvgId(top)}`
  const topStop = splitStopColor(top, prominent ? 1 : 0.72)
  const midStop = splitStopColor(mid, prominent ? 0.9 : 0.6)
  const bottomStop = splitStopColor(bottom, prominent ? 0.8 : 0.55)

  return (
    <Svg style={[StyleSheet.absoluteFill, style]} pointerEvents="none" accessible={false}>
      <Defs>
        <LinearGradient id={`lgSheen${rawId}`} x1="0.1" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor={topStop.stopColor} stopOpacity={topStop.stopOpacity} />
          <Stop offset="0.34" stopColor={midStop.stopColor} stopOpacity={midStop.stopOpacity} />
          <Stop offset="0.72" stopColor="#FFFFFF" stopOpacity={0} />
          <Stop offset="1" stopColor={bottomStop.stopColor} stopOpacity={bottomStop.stopOpacity} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#lgSheen${rawId})`} />
    </Svg>
  )
}

/** Shared hairline rim + specular top highlight style helper for Liquid Glass shells. */
export function glassRimStyle(colors: ThemeColors, variant: 'card' | 'elevated' | 'pill' = 'card'): ViewStyle {
  const borderColor = variant === 'card'
    ? (colors.glassBorderSubtle ?? colors.separator)
    : (colors.glassBorder ?? colors.separator)
  return {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor,
  }
}
