import { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet } from 'react-native'
import { useTheme, type ThemeColors } from './theme-context'
import { useThemedStyles } from './use-themed-styles'

const TRACK_WIDTH = 56
const TRACK_HEIGHT = 30
const INSET = 2
const THUMB_WIDTH = 34
const THUMB_HEIGHT = TRACK_HEIGHT - INSET * 2
const TRAVEL = TRACK_WIDTH - INSET * 2 - THUMB_WIDTH

/**
 * Pill-shaped on/off control replacing the platform Switch: a blue track when
 * on, a grey track when off, and a wide white thumb outlined in the track color.
 * `trackColor` / `thumbColor` are accepted for drop-in parity with Switch and ignored.
 */
export function Toggle({ value, onValueChange, disabled = false, accessibilityLabel }: {
  value: boolean
  onValueChange?: (value: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
  trackColor?: unknown
  thumbColor?: unknown
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
  }, [progress, value])

  const trackColor = progress.interpolate({ inputRange: [0, 1], outputRange: [colors.disabled, colors.primary] })
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] })

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={(e) => {
        e?.stopPropagation?.()
        onValueChange?.(!value)
      }}
      style={disabled ? styles.disabled : undefined}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View style={[styles.thumb, { borderColor: trackColor, transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    track: { width: TRACK_WIDTH, height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, padding: INSET, justifyContent: 'center' },
    thumb: {
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      borderRadius: THUMB_HEIGHT / 2,
      backgroundColor: colors.white,
      borderWidth: 1.5,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 2,
      elevation: 1,
    },
    disabled: { opacity: 0.5 },
  })
}
