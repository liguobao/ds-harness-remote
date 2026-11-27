import type { RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { GlassSheen } from './glass'
import { useTheme } from './theme-context'

/**
 * Live frosted backdrop layer for floating chrome inside a `BlurTargetView`
 * (or pure optical sheen + translucent fill when no `blurTarget` is supplied).
 */
export function GlassBackdrop({
  blurTarget,
  intensity = 60,
  tintColor,
  prominent = true,
  borderRadius,
}: {
  blurTarget?: RefObject<View | null>
  intensity?: number
  tintColor?: string
  prominent?: boolean
  borderRadius?: number
}) {
  const { colors, scheme } = useTheme()
  const resolvedTint = tintColor ?? colors.glassElevated ?? colors.elevated
  const clipStyle = borderRadius !== undefined ? { borderRadius, overflow: 'hidden' as const } : { overflow: 'hidden' as const }

  return (
    <View style={[StyleSheet.absoluteFill, clipStyle]} pointerEvents="none">
      {blurTarget !== undefined && (
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={intensity}
          tint={scheme === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: resolvedTint }]}
        pointerEvents="none"
      />
      <GlassSheen prominent={prominent} />
    </View>
  )
}
