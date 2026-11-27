import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings as zhCN } from '../../locales/i18n'
import { easingCurve, resolveMotion } from '../../ui/motion'
import { GlassSheen } from '../../ui/glass'
import { DIALOG_SHEET_MAX_WIDTH, useResponsiveLayout } from '../../ui/responsive'
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
  const { height: windowHeight, sheetMaxHeight, sheetAsDialog } = useResponsiveLayout()
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

  // Wide windows promote the bottom sheet to a centered dialog card. The card
  // stays opaque so Android never flashes its elevation shadow in from
  // nothing; reduced motion drops the scale.
  const asDialog = sheetAsDialog
  const sheetTransform = asDialog
    ? { transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 1 : 0.96, 1] }) }] }
    : {
        transform: [{
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [resolveMotion('sheet', reduceMotion).translate, 0],
          }),
        }],
      }
  const dialogPadTop = Math.max(spacing.md, insets.top)
  const dialogPadBottom = Math.max(spacing.md, insets.bottom)
  const dialogPadLeft = Math.max(spacing.md, insets.left)
  const dialogPadRight = Math.max(spacing.md, insets.right)

  return (
    <View
      style={[
        asDialog ? styles.modalDialogBackdrop : styles.modalBackdrop,
        asDialog && {
          paddingTop: dialogPadTop,
          paddingBottom: dialogPadBottom,
          paddingLeft: dialogPadLeft,
          paddingRight: dialogPadRight,
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={zhCN.common.close}
        onPress={onClose}
        pointerEvents="box-only"
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        style={[
          asDialog ? styles.modalDialogSheet : styles.modalSheet,
          {
            maxHeight: asDialog
              ? Math.min(sheetMaxHeight, Math.max(0, windowHeight - dialogPadTop - dialogPadBottom))
              : sheetMaxHeight,
            ...(asDialog ? {
              width: '100%',
              maxWidth: DIALOG_SHEET_MAX_WIDTH,
              paddingLeft: spacing.lg,
              paddingRight: spacing.lg,
              paddingBottom: spacing.lg,
            } : {
              // Landscapes on cutout phones put the display edge on a side; keep
              // the sheet content inside the safe area there. Portrait keeps the
              // original horizontal padding because both insets are 0.
              paddingLeft: spacing.lg + insets.left,
              paddingRight: spacing.lg + insets.right,
              // 3-button landscape navigation can be taller than the original
              // bottom padding; grow only when needed.
              paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.sm),
            }),
            ...sheetTransform,
          },
        ]}
        pointerEvents="box-none"
      >
        <GlassSheen prominent />
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
