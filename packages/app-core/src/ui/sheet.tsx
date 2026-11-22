import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
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
  finishSheetExit,
  motionTokens,
  nextSheetPhase,
  sheetPhaseDuration,
  type Rect,
  type SheetPhase,
} from './motion'
import { DIALOG_SHEET_MAX_WIDTH, useResponsiveLayout } from './responsive'
import { radius, spacing, type ThemeColors } from './theme'
import { useReduceMotion } from './use-reduce-motion'
import { useThemedStyles } from './use-themed-styles'

// When a user jumps from one sheet straight to another (e.g. `+` menu -> picker),
// immediately finish any closing sheet's exit so two transparent Modal windows
// never stack on Android or steal autoFocus when the old Dialog unmounts.
const sheetOpenListeners = new Set<(openerId: string) => void>()
let routeDismissEpoch = 0
function notifySheetOpening(openerId: string) {
  for (const listener of sheetOpenListeners) {
    listener(openerId)
  }
}

/** Finish any in-flight or synchronous sheet exit immediately before switching to a new route. */
export function dismissClosingSheets() {
  routeDismissEpoch += 1
  notifySheetOpening('__route__')
}

// `animationType="none"` dismisses on UIKit in 1–2 frames; this caps wait time if
// the native Modal never presented (e.g. closed before attaching to a window).
const NATIVE_DISMISS_FALLBACK_MS = 180

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
  onDismiss,
  anchor,
  children,
  backdropStyle,
  sheetStyle,
  avoidKeyboard = false,
  dismissLabel,
  /**
   * `adaptive` (default) promotes anchor-less sheets to centered dialog cards
   * on wide windows; `sheet` always keeps the bottom-sheet form. Menus whose
   * anchor can disappear (e.g. the composer "+" menu while the IME toggles)
   * must pass `sheet` so their form does not jump between shapes.
   */
  presentation = 'adaptive',
  showHandle = true,
}: {
  visible: boolean
  onClose: () => void
  /** Hardware back / modal request; defaults to `onClose`. */
  onRequestClose?: () => void
  /** iOS-only: the native modal finished dismissing. Never fires on Android. */
  onDismiss?: () => void
  anchor?: Rect
  children: ReactNode
  backdropStyle?: StyleProp<ViewStyle>
  sheetStyle?: StyleProp<ViewStyle>
  /** Keep input sheets and their actions above the soft keyboard. */
  avoidKeyboard?: boolean
  dismissLabel?: string
  /** `sheet` disables the wide-window centered-dialog promotion. */
  presentation?: 'adaptive' | 'sheet'
  /** Render the top grabber bar with drag-to-dismiss gesture on bottom sheets. */
  showHandle?: boolean
}) {
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const { sheetMaxHeight, sheetAsDialog } = useResponsiveLayout()
  const { height: windowHeight } = useWindowDimensions()
  const reduceMotion = useReduceMotion()
  const sheetId = useId()
  const waitForNativeDismiss = Platform.OS === 'ios'
  const [phase, setPhase] = useState<SheetPhase>(() => visible ? 'opening' : 'unmounted')
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [availableHeight, setAvailableHeight] = useState<number>()
  const progress = useRef(new Animated.Value(0)).current
  const dragY = useRef(new Animated.Value(0)).current
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)
  const dragAnimationRef = useRef<Animated.CompositeAnimation | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notifiedOpenRef = useRef(false)
  const openedAtRouteEpochRef = useRef(routeDismissEpoch)
  const supersededByOtherRef = useRef(false)
  // Keep the closing sheet populated after the caller clears its target.
  const retainedChildren = useRef(children)
  if (visible) retainedChildren.current = children

  const snapDragBack = () => {
    dragAnimationRef.current?.stop()
    if (reduceMotionRef.current || typeof Animated.spring !== 'function') {
      dragY.setValue(0)
      return
    }
    const anim = Animated.spring(dragY, {
      toValue: 0,
      bounciness: motionTokens.spring.bounciness,
      speed: motionTokens.spring.speed,
      useNativeDriver: true,
    })
    dragAnimationRef.current = anim
    anim.start()
  }

  const panResponder = useRef(
    typeof PanResponder?.create === 'function'
      ? PanResponder.create({
          onStartShouldSetPanResponder: () => visibleRef.current,
          onMoveShouldSetPanResponder: (_evt, gesture) =>
            visibleRef.current && gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
          onPanResponderGrant: () => {
            dragAnimationRef.current?.stop()
          },
          onPanResponderMove: (_evt, gesture) => {
            if (!visibleRef.current) return
            dragY.setValue(Math.max(0, gesture.dy))
          },
          onPanResponderRelease: (_evt, gesture) => {
            if (visibleRef.current && (gesture.dy > 72 || gesture.vy > 0.6)) {
              onCloseRef.current()
              // If the caller guards dismissal (e.g. while busy) and keeps the
              // sheet visible, snap back to rest on the next frame.
              if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => {
                  if (visibleRef.current && phaseRef.current !== 'unmounted') snapDragBack()
                })
              }
              return
            }
            snapDragBack()
          },
          onPanResponderTerminate: () => {
            snapDragBack()
          },
        })
      : { panHandlers: {} },
  ).current

  const settleNativeDismiss = () => {
    if (phaseRef.current !== 'dismissing') return
    phaseRef.current = 'unmounted'
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
    setPhase(current => current === 'dismissing' ? 'unmounted' : current)
    onDismissRef.current?.()
  }

  useEffect(() => {
    const onOtherSheetOpen = (openerId: string) => {
      if (openerId === sheetId || visibleRef.current) return
      supersededByOtherRef.current = true
      setPhase(current => {
        if (current === 'unmounted' || current === 'dismissing') return current
        animationRef.current?.stop()
        return nextSheetPhase(current, false, true, waitForNativeDismiss)
      })
    }
    sheetOpenListeners.add(onOtherSheetOpen)
    return () => { sheetOpenListeners.delete(onOtherSheetOpen) }
  }, [sheetId, waitForNativeDismiss])

  useEffect(() => {
    if (visible) {
      // Wait for an in-flight native iOS Modal dismissal to settle through
      // `unmounted` before re-opening so UIKit never receives a concurrent present.
      if (phase === 'dismissing') return
      dragAnimationRef.current?.stop()
      dragY.setValue(0)
      if (!notifiedOpenRef.current) {
        notifiedOpenRef.current = true
        openedAtRouteEpochRef.current = routeDismissEpoch
        supersededByOtherRef.current = false
        notifySheetOpening(sheetId)
      }
      setPhase(current => nextSheetPhase(current, true, false, waitForNativeDismiss))
      return
    }
    notifiedOpenRef.current = false
    const superseded = supersededByOtherRef.current || routeDismissEpoch !== openedAtRouteEpochRef.current
    if (superseded) animationRef.current?.stop()
    setPhase(current => nextSheetPhase(current, false, superseded, waitForNativeDismiss))
  }, [visible, phase, sheetId, waitForNativeDismiss, dragY])

  useEffect(() => {
    if (phase === 'unmounted' || phase === 'dismissing') {
      animationRef.current?.stop()
      dragAnimationRef.current?.stop()
      progress.setValue(0)
      dragY.setValue(0)
      return
    }
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
      setPhase(current => current === 'opening' ? 'open' : finishSheetExit(current, waitForNativeDismiss))
    })
    return () => animation.stop()
  }, [phase, progress, dragY, reduceMotion, waitForNativeDismiss])

  useEffect(() => {
    if (phase !== 'dismissing' || phaseRef.current !== 'dismissing') return
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = undefined
      settleNativeDismiss()
    }, NATIVE_DISMISS_FALLBACK_MS)
    return () => {
      if (dismissTimerRef.current !== undefined) {
        clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = undefined
      }
    }
  }, [phase])

  useEffect(() => () => {
    phaseRef.current = 'unmounted'
    animationRef.current?.stop()
    dragAnimationRef.current?.stop()
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
  }, [])

  if (phase === 'unmounted') return null

  const rise = anchorRise(anchor, windowHeight)
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] })
  const sheetTranslateY = typeof Animated.add === 'function' ? Animated.add(translateY, dragY) : translateY
  const requestClose = onRequestClose ?? onClose
  const content = visible ? children : retainedChildren.current
  // Wide windows promote anchor-less sheets to centered dialog cards; menus
  // marked `presentation="sheet"` keep the bottom form regardless.
  const asDialog = sheetAsDialog && presentation === 'adaptive'
  // Reduced motion drops the scale per motion.ts conventions; the card itself
  // stays opaque (only the backdrop fades) so Android never flashes the
  // card's elevation shadow in from nothing (see #512).
  const dialogScale = progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 1 : 0.96, 1] })

  const dialogPadTop = Math.max(spacing.md, insets.top)
  const dialogPadBottom = Math.max(spacing.md, insets.bottom)
  const dialogPadLeft = Math.max(spacing.md, insets.left)
  const dialogPadRight = Math.max(spacing.md, insets.right)
  // A resized Modal may be shorter than the normal sheet cap. Leave
  // safe-area / outer margins above and below tall, scrollable forms too.
  const resolvedMaxHeight = Math.min(
    sheetMaxHeight,
    Math.max(0, (availableHeight ?? windowHeight) - (asDialog ? dialogPadTop + dialogPadBottom : insets.top)),
  )

  const body = phase === 'dismissing' ? null : (
    <View
      style={[
        asDialog ? styles.dialogContainer : styles.container,
        asDialog && {
          paddingTop: dialogPadTop,
          paddingBottom: dialogPadBottom,
          paddingLeft: dialogPadLeft,
          paddingRight: dialogPadRight,
        },
      ]}
      pointerEvents={visible ? 'box-none' : 'none'}
      onLayout={event => setAvailableHeight(event.nativeEvent.layout.height)}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle, { opacity: progress }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dismissLabel ?? strings.common.close}
        disabled={!visible}
        onPress={onClose}
        pointerEvents={visible ? 'box-only' : 'none'}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        accessibilityViewIsModal
        pointerEvents="box-none"
        style={[
          asDialog ? styles.dialogSheet : styles.sheet,
          // Caller styles first in dialog form so bottom-sheet-only overrides
          // (top-corner radius, bottom inset padding, stale maxHeight) cannot
          // clobber the centered card's rounded geometry, while callers that
          // own their own horizontal insets (e.g. HostSwitcherSheet's
          // `paddingHorizontal: 0`) keep them without double-padding.
          ...(asDialog ? [sheetStyle] : []),
          asDialog
            ? {
                width: '100%' as const,
                maxWidth: DIALOG_SHEET_MAX_WIDTH,
                maxHeight: resolvedMaxHeight,
                borderRadius: radius.xl,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                paddingTop: spacing.lg,
                paddingBottom: spacing.lg,
                transform: [{ scale: dialogScale }],
              }
            : {
                maxHeight: resolvedMaxHeight,
                paddingTop: showHandle ? 0 : spacing.lg,
                paddingLeft: spacing.lg + insets.left,
                paddingRight: spacing.lg + insets.right,
                paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.sm),
                transform: [{ translateY: sheetTranslateY }],
              },
          ...(asDialog ? [] : [sheetStyle]),
        ]}
      >
        {!asDialog && showHandle && (
          <View style={styles.handleHitArea} {...panResponder.panHandlers} accessible={false}>
            <View style={styles.handleBar} />
          </View>
        )}
        {content}
      </Animated.View>
    </View>
  )

  return (
    <Modal
      visible={phase !== 'dismissing'}
      transparent
      animationType="none"
      onRequestClose={() => { if (visible) requestClose() }}
      onDismiss={waitForNativeDismiss ? settleNativeDismiss : onDismiss}
      statusBarTranslucent
    >
      {phase === 'dismissing'
        ? null
        : avoidKeyboard
          ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
  dialogContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
  sheet: {
    zIndex: 1,
    elevation: 1,
    backgroundColor: colors.surface ?? colors.background,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    ...(Platform.OS === 'ios' ? { borderCurve: 'continuous' as const } : {}),
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  dialogSheet: {
    zIndex: 1,
    elevation: 1,
    backgroundColor: colors.surface ?? colors.background,
    borderRadius: radius.xl,
    ...(Platform.OS === 'ios' ? { borderCurve: 'continuous' as const } : {}),
    padding: spacing.lg,
    paddingBottom: spacing.lg,
  },
  handleHitArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.subtle ?? '#7C8492',
    opacity: 0.45,
  },
})
