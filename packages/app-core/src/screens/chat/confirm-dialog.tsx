import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { nextSheetPhase, type SheetPhase } from '../../ui/motion'
import { type ThemeColors } from '../../ui/theme-context'
import { useReduceMotion } from '../../ui/use-reduce-motion'
import { useThemedStyles } from '../../ui/use-themed-styles'

export interface ConfirmDialogButton {
  label: string
  onPress?: () => void
  /** Destructive actions render as a filled red pill; cancel renders plain. */
  danger?: boolean
}

/**
 * How the dialog was closed: `action` picked a button, `dismiss` came from the
 * backdrop or the Android back button. Callers must keep them apart — React
 * Native's `Alert.onDismiss` only means "closed without choosing".
 */
export type ConfirmDialogCloseCause = 'action' | 'dismiss'

/**
 * Custom themed replacement for `Alert.alert` confirmations: a centered card
 * on a dimmed scrim, title + body + button row. Unlike the system AlertDialog,
 * colors, button order and wording are fully controlled by the app theme.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  buttons,
  onClose,
}: {
  visible: boolean
  title: string
  message?: string
  buttons: ConfirmDialogButton[]
  onClose: (cause: ConfirmDialogCloseCause) => void
}) {
  const styles = useThemedStyles(createStyles)
  const reduceMotion = useReduceMotion()
  // iOS runs handlers after its dismiss fade. Android does not emit
  // Modal.onDismiss, so it must run the action when requesting the close.
  const pendingRef = useRef<(() => void) | undefined>(undefined)
  const runPending = () => {
    const pending = pendingRef.current
    pendingRef.current = undefined
    pending?.()
  }
  // iOS keeps the original native Modal fade (its `onDismiss` ordering and
  // Modal fade are already correct there). Android's native fade animates the
  // whole window in a few coarse steps, which reads as a hard white→gray jump
  // on light themes, so it is driven from JS instead: the transparent Modal
  // mounts first (`phase !== 'unmounted'`), then the scrim+card ease in/out.
  const isAndroid = Platform.OS === 'android'
  const [phase, setPhase] = useState<SheetPhase>(() => (isAndroid && visible ? 'open' : 'unmounted'))
  const fade = useRef(new Animated.Value(visible ? 1 : 0)).current

  useEffect(() => {
    if (!isAndroid) return
    setPhase(current => {
      if (reduceMotion) return visible ? 'open' : 'unmounted'
      return nextSheetPhase(current, visible)
    })
  }, [isAndroid, visible, reduceMotion])

  useEffect(() => {
    if (!isAndroid) return
    if (phase === 'unmounted') {
      fade.setValue(0)
      return
    }
    if (phase === 'open') {
      fade.setValue(1)
      return
    }
    const opening = phase === 'opening'
    const anim = Animated.timing(fade, {
      toValue: opening ? 1 : 0,
      duration: opening ? 220 : 180,
      easing: opening ? Easing.inOut(Easing.quad) : Easing.in(Easing.quad),
      useNativeDriver: true,
    })
    anim.start(({ finished }) => {
      if (!finished) return
      setPhase(current => (current === 'opening' ? 'open' : current === 'closing' ? 'unmounted' : current))
    })
    return () => anim.stop()
  }, [isAndroid, phase, fade])

  // The exit fade must not re-trigger destructive actions: ignore presses and
  // the Android back button while the dialog is animating out. Never clear
  // `pendingRef` when `!visible` — on iOS a valid action tap has already
  // flipped `visible` to false and is waiting for `Modal.onDismiss`.
  const modalVisible = isAndroid ? phase !== 'unmounted' : visible
  // Android elevation shadows render at full strength regardless of the view's
  // animated opacity, so the card's square shadow would pop in before the card
  // fades in and linger after it fades out. Only draw elevation while fully shown.
  const hideAndroidShadow = isAndroid && phase !== 'open'
  return (
    <Modal
      transparent
      visible={modalVisible}
      animationType={isAndroid ? 'none' : 'fade'}
      onRequestClose={() => {
        if (!visible) return
        pendingRef.current = undefined
        onClose('dismiss')
      }}
      onDismiss={runPending}
      statusBarTranslucent
    >
      <Animated.View
        style={isAndroid ? [styles.backdrop, { opacity: fade }] : styles.backdrop}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!visible) return
            pendingRef.current = undefined
            onClose('dismiss')
          }}
          accessibilityLabel={title}
        />
        <View style={[styles.card, hideAndroidShadow ? styles.cardShadowless : null]} accessibilityViewIsModal>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.buttons}>
            {buttons.map(button => (
              <Pressable
                key={button.label}
                accessibilityRole="button"
                accessibilityLabel={button.label}
                onPress={() => {
                  if (!visible) return
                  pendingRef.current = button.onPress
                  onClose('action')
                  if (Platform.OS !== 'ios') runPending()
                }}
                style={({ pressed }) => [
                  styles.button,
                  button.danger ? styles.buttonDanger : styles.buttonPlain,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.buttonLabel, button.danger ? styles.buttonLabelDanger : styles.buttonLabelPlain]}
                >
                  {button.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Animated.View>
    </Modal>
  )
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
    },
    card: {
      width: '100%',
      maxWidth: 340,
      borderRadius: 24,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 16,
      shadowColor: colors.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.ink,
    },
    message: {
      marginTop: 8,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    buttons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 18,
    },
    button: {
      borderRadius: 14,
      minHeight: 40,
      paddingHorizontal: 16,
      justifyContent: 'center',
    },
    buttonPlain: {
      backgroundColor: colors.grouped,
    },
    buttonDanger: {
      backgroundColor: colors.dangerSoft,
    },
    buttonPressed: {
      opacity: 0.7,
    },
    buttonLabel: {
      fontSize: 15,
      fontWeight: '600',
    },
    buttonLabelPlain: {
      color: colors.ink,
    },
    buttonLabelDanger: {
      color: colors.danger,
    },
    cardShadowless: {
      elevation: 0,
    },
  })
