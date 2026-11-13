import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings } from '../locales/i18n'
import {
  anchorRise,
  easingCurve,
  motionTokens,
  nextSheetPhase,
  sheetPhaseDuration,
  type Rect,
  type SheetPhase,
} from './motion'
import { useResponsiveLayout } from './responsive'
import { radius, spacing, type ThemeColors } from './theme'
import { useReduceMotion } from './use-reduce-motion'
import { useThemedStyles } from './use-themed-styles'

/**
 * Bottom sheet container with an interruptible enter/exit transition.
 *
 * The sheet itself stays fully opaque while it travels (only the backdrop
 * fades), because a translucent panel shows the page underneath through it.
 * Closing is animated too: `visible` switching to false keeps the modal mounted
 * until the exit finishes, rendering the last children it was given.
 *
 * Geometry matches the previous `ModalSurface` exactly so no screen moves at
 * rest; callers with their own sheet styles override them afterwards.
 */
export function SheetModal({
  visible,
  onClose,
  onRequestClose,
  anchor,
  children,
  backdropStyle,
  sheetStyle,
  avoidKeyboard = false,
  dismissLabel,
}: {
  visible: boolean
  onClose: () => void
  /** Hardware back / modal request; defaults to `onClose`. */
  onRequestClose?: () => void
  anchor?: Rect
  children: ReactNode
  backdropStyle?: StyleProp<ViewStyle>
  sheetStyle?: StyleProp<ViewStyle>
  /** Wrap in `KeyboardAvoidingView` for sheets with text inputs (rename dialogs). */
  avoidKeyboard?: boolean
  dismissLabel?: string
}) {
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const { sheetMaxHeight } = useResponsiveLayout()
  const { height: windowHeight } = useWindowDimensions()
  const reduceMotion = useReduceMotion()
  const [phase, setPhase] = useState<SheetPhase>(() => visible ? 'opening' : 'unmounted')
  const progress = useRef(new Animated.Value(0)).current
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)
  // Keep the closing sheet populated after the caller clears its target.
  const retainedChildren = useRef(children)
  if (visible) retainedChildren.current = children

  useEffect(() => {
    setPhase(current => nextSheetPhase(current, visible))
  }, [visible])

  useEffect(() => {
    if (phase !== 'opening' && phase !== 'closing') return
    animationRef.current?.stop()
    const animation = Animated.timing(progress, {
      toValue: phase === 'opening' ? 1 : 0,
      duration: sheetPhaseDuration(phase, reduceMotion),
      easing: Easing.bezier(...easingCurve(phase === 'opening' ? 'expand' : 'retreat')),
      useNativeDriver: true,
    })
    animationRef.current = animation
    animation.start(({ finished }) => {
      if (!finished) return
      setPhase(current => current === 'opening' ? 'open' : current === 'closing' ? 'unmounted' : current)
    })
    return () => animation.stop()
  }, [phase, progress, reduceMotion])

  useEffect(() => () => animationRef.current?.stop(), [])

  if (phase === 'unmounted') return null

  const rise = anchorRise(anchor, windowHeight)
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] })
  const requestClose = onRequestClose ?? onClose
  const content = visible ? children : retainedChildren.current

  const body = (
    <View style={styles.container} pointerEvents="box-none">
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle, { opacity: progress }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dismissLabel ?? strings.common.close}
        onPress={onClose}
        pointerEvents="box-only"
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        accessibilityViewIsModal
        pointerEvents="box-none"
        style={[
          styles.sheet,
          {
            maxHeight: sheetMaxHeight,
            paddingLeft: spacing.lg + insets.left,
            paddingRight: spacing.lg + insets.right,
            paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.sm),
            transform: [{ translateY }],
          },
          sheetStyle,
        ]}
      >
        {content}
      </Animated.View>
    </View>
  )

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent
    >
      {avoidKeyboard
        ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.container}
          >
            {body}
          </KeyboardAvoidingView>
        )
        : body}
    </Modal>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
  sheet: {
    zIndex: 1,
    elevation: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
})
