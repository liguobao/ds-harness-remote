import { useEffect, useRef } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, Switch, View } from 'react-native'
import { triggerLightHaptic } from './haptics'
import { useTheme, type ThemeColors } from './theme-context'
import { useReduceMotion } from './use-reduce-motion'
import { useThemedStyles } from './use-themed-styles'

const TRACK_WIDTH = 50
const TRACK_HEIGHT = 28
const INSET = 3
const THUMB_SIZE = 22
const TRAVEL = TRACK_WIDTH - INSET * 2 - THUMB_SIZE

interface ToggleProps {
  value: boolean
  onValueChange?: (value: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
  trackColor?: unknown
  thumbColor?: unknown
}

export function Toggle({ value, onValueChange, disabled = false, accessibilityLabel }: ToggleProps) {
  const { colors } = useTheme()
  if (Platform.OS === 'ios') {
    return (
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        trackColor={{ false: colors.disabled, true: colors.inverse }}
        ios_backgroundColor={colors.disabled}
      />
    )
  }
  return (
    <AndroidToggle
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
    />
  )
}

function AndroidToggle({ value, onValueChange, disabled = false, accessibilityLabel }: {
  value: boolean
  onValueChange?: (value: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}) {
  const styles = useThemedStyles(createStyles)
  const reduceMotion = useReduceMotion()
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current

  useEffect(() => {
    const target = value ? 1 : 0
    if (reduceMotion) {
      progress.setValue(target)
      return
    }
    const anim = Animated.timing(progress, {
      toValue: target,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [progress, reduceMotion, value])

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
        triggerLightHaptic()
        onValueChange?.(!value)
      }}
      style={disabled ? styles.disabled : undefined}
    >
      <View style={styles.track}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.trackActive, { opacity: progress }]} />
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </View>
    </Pressable>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    track: {
      width: TRACK_WIDTH,
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      padding: INSET,
      justifyContent: 'center',
      backgroundColor: colors.disabled,
      overflow: 'hidden',
    },
    trackActive: {
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: colors.inverse,
    },
    thumb: {
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: THUMB_SIZE / 2,
      backgroundColor: colors.onInverse,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.14,
      shadowRadius: 2,
      elevation: 1,
    },
    disabled: { opacity: 0.5 },
  })
}
