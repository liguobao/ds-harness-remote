import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings as zhCN } from '../../locales/i18n'
import { easingCurve, resolveMotion } from '../../ui/motion'
import { useResponsiveLayout } from '../../ui/responsive'
import { spacing } from '../../ui/theme'
import { useReduceMotion } from '../../ui/use-reduce-motion'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { createStyles } from './styles'

/**
 * Keep the dismiss target behind the sheet instead of nesting Pressables.
 * Android's responder negotiation can otherwise let the backdrop consume a
 * child press, which makes every option in a transparent modal look inert.
 *
 * The sheet follows the live window height: nearly full-height in landscape
 * phones, ~70% otherwise. Content that is taller than the sheet must scroll
 * (pickers use `usePickerListMaxHeight`).
 *
 * Sheets that own their `<Modal>` should use `ui/sheet.tsx`'s `SheetModal`,
 * which also animates the exit. This surface animates on mount only, for
 * callers that keep a native modal wrapper.
 */
export function ModalSurface({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const { sheetMaxHeight } = useResponsiveLayout()
  const reduceMotion = useReduceMotion()
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const motion = resolveMotion('sheet', reduceMotion)
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.duration,
      easing: Easing.bezier(...easingCurve('expand')),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [progress, reduceMotion])

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [resolveMotion('sheet', reduceMotion).translate, 0],
  })

  return (
    <View style={styles.modalBackdrop} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={zhCN.common.close}
        onPress={onClose}
        pointerEvents="box-only"
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        style={[styles.modalSheet, {
          maxHeight: sheetMaxHeight,
          // Landscapes on cutout phones put the display edge on a side; keep
          // the sheet content inside the safe area there. Portrait keeps the
          // original horizontal padding because both insets are 0.
          paddingLeft: spacing.lg + insets.left,
          paddingRight: spacing.lg + insets.right,
          // 3-button landscape navigation can be taller than the original
          // bottom padding; grow only when needed.
          paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.sm),
          transform: [{ translateY }],
        }]}
        pointerEvents="box-none"
      >
        {children}
      </Animated.View>
    </View>
  )
}

/**
 * Height a picker list may use inside a `ModalSurface`. The sheet header,
 * margins and padding take ~120dp, so the list is capped by what remains of
 * the sheet instead of a separate screen-height ratio (which clipped content
 * in landscape).
 */
export function usePickerListMaxHeight(): number {
  const { sheetMaxHeight } = useResponsiveLayout()
  return Math.max(140, sheetMaxHeight - 120)
}
