import { strings } from '../../locales/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useReduceMotion } from '../../ui/use-reduce-motion'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { createModalActionQueue } from '../chat/modal-action-queue'

/** Keep BotModalsHost alive briefly after store modals close so popover action delays, ConfirmDialog fade/onDismiss, and BotProfilePage slide-out + iOS native dismiss can finish cleanly. */
export const BOT_MODALS_LINGER_MS = 500

export function shouldRenderBotModalsHost(params: {
  visible: boolean
  hasStoreModal: boolean
  deleteConfirmActive: boolean
  lingerMounted: boolean
}): boolean {
  const active = params.hasStoreModal || params.deleteConfirmActive
  if (params.visible) {
    return active || params.lingerMounted
  }
  // When the host container hides right after a modal closed, keep BotModalsHost
  // mounted until the linger timer expires so iOS Modal(visible=false) finishes
  // dismissing cleanly, while avoiding duplicate presentation if a store modal is open.
  return !active && params.lingerMounted
}

export function isDrawerHostHidden(inline: boolean, open: boolean, closing: boolean): boolean {
  return !inline && !open && !closing
}

type PopoverPhase = 'unmounted' | 'open' | 'dismissing'

// `animationType="none"` dismisses on UIKit in 1-2 frames; this caps wait time if
// the native Modal never presented (e.g. closed before attaching to a window).
const NATIVE_DISMISS_FALLBACK_MS = 180

export interface BotPopoverAction {
  key: string
  label: string
  icon?: LucideIcon
  danger?: boolean
  selected?: boolean
  disabled?: boolean
  onPress: () => void
}

/**
 * Floating iOS-style frosted popover card anchored near a top/bottom corner,
 * with a clean borderless row layout and invisible tap-outside backdrop.
 */
export function BotFloatingPopover({
  visible,
  actions,
  onClose,
  onDismiss,
  anchor = 'top-right',
  topOffset = 54,
  bottomOffset = 72,
}: {
  visible: boolean
  actions: BotPopoverAction[]
  onClose: () => void
  onDismiss?: () => void
  anchor?: 'top-right' | 'top-left' | 'bottom-left'
  topOffset?: number
  bottomOffset?: number
}) {
  const insets = useSafeAreaInsets()
  const { colors, scheme } = useTheme()
  const reduceMotion = useReduceMotion()
  const styles = useThemedStyles(createPopoverStyles)
  const anim = useRef(new Animated.Value(0)).current
  const waitForNativeDismiss = Platform.OS === 'ios'
  const activeVisible = visible && actions.length > 0
  const [phase, setPhase] = useState<PopoverPhase>(() => (activeVisible ? 'open' : 'unmounted'))
  const phaseRef = useRef<PopoverPhase>(phase)
  phaseRef.current = phase
  const retainedActionsRef = useRef<BotPopoverAction[]>(actions)
  if (activeVisible) {
    retainedActionsRef.current = actions
  }
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const actionQueue = useMemo(() => createModalActionQueue(waitForNativeDismiss), [waitForNativeDismiss])

  const settleNativeDismiss = useCallback(() => {
    if (phaseRef.current !== 'dismissing') return
    phaseRef.current = 'unmounted'
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
    setPhase(current => (current === 'dismissing' ? 'unmounted' : current))
    try {
      actionQueue.onDismiss()
    } finally {
      onDismissRef.current?.()
    }
  }, [actionQueue])

  useEffect(() => {
    if (activeVisible) {
      // Wait for an in-flight native iOS Modal dismissal to settle through
      // `unmounted` before re-opening so UIKit never receives a concurrent present.
      if (phase === 'dismissing') return
      if (phase !== 'open') setPhase('open')
      return
    }
    if (phase === 'open') {
      if (waitForNativeDismiss) {
        setPhase('dismissing')
      } else {
        setPhase('unmounted')
        onDismissRef.current?.()
      }
    }
  }, [activeVisible, phase, waitForNativeDismiss])

  useEffect(() => {
    if (phase !== 'dismissing' || phaseRef.current !== 'dismissing') return
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
    }
    const timer = setTimeout(() => {
      if (dismissTimerRef.current === timer) {
        dismissTimerRef.current = undefined
      }
      settleNativeDismiss()
    }, NATIVE_DISMISS_FALLBACK_MS)
    dismissTimerRef.current = timer
    return () => {
      clearTimeout(timer)
      if (dismissTimerRef.current === timer) {
        dismissTimerRef.current = undefined
      }
    }
  }, [phase])

  useEffect(() => () => {
    phaseRef.current = 'unmounted'
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
    actionQueue.cancel()
  }, [actionQueue])

  useEffect(() => {
    if (phase !== 'open' || !activeVisible) {
      anim.stopAnimation()
      anim.setValue(0)
      return
    }
    if (reduceMotion) {
      anim.stopAnimation()
      anim.setValue(1)
      return
    }
    anim.setValue(0)
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [activeVisible, anim, phase, reduceMotion])

  if (phase === 'unmounted' || (!activeVisible && !waitForNativeDismiss)) return null

  const displayActions = activeVisible ? actions : retainedActionsRef.current
  if (phase !== 'dismissing' && displayActions.length === 0) return null

  const positionStyle =
    anchor === 'top-left'
      ? { top: insets.top + topOffset, left: 16 }
      : anchor === 'bottom-left'
        ? { bottom: insets.bottom + bottomOffset, left: 16 }
        : { top: insets.top + topOffset, right: 16 }

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] })

  return (
    <Modal
      transparent
      visible={phase !== 'dismissing'}
      animationType="none"
      onRequestClose={() => {
        if (activeVisible) onClose()
      }}
      onDismiss={waitForNativeDismiss ? settleNativeDismiss : onDismiss}
      statusBarTranslucent
    >
      {phase === 'dismissing' ? null : (
        <View style={styles.overlay} pointerEvents={activeVisible ? 'auto' : 'none'}>
          <Pressable
            style={StyleSheet.absoluteFill}
            disabled={!activeVisible}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={strings.common.close}
          />
          <Animated.View
            style={[
              styles.card,
              scheme === 'light' ? styles.cardLight : styles.cardDark,
              positionStyle,
              { opacity: anim, transform: [{ scale }] },
            ]}
          >
            {displayActions.map(action => {
              const Icon = action.icon
              const inkColor = action.danger ? colors.danger : colors.ink
              const disabled = Boolean(action.disabled) || !activeVisible
              return (
                <Pressable
                  key={action.key}
                  accessibilityRole="menuitem"
                  accessibilityLabel={action.label}
                  disabled={disabled}
                  onPress={() => {
                    actionQueue.run(onClose, action.onPress)
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    action.selected && styles.rowSelected,
                    pressed && !disabled && styles.rowPressed,
                    action.disabled && styles.rowDisabled,
                  ]}
                >
                  {Icon && <Icon size={19} color={inkColor} strokeWidth={1.9} />}
                  <Text numberOfLines={1} style={[styles.label, action.danger && styles.labelDanger]}>
                    {action.label}
                  </Text>
                </Pressable>
              )
            })}
          </Animated.View>
        </View>
      )}
    </Modal>
  )
}

const createPopoverStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
    },
    card: {
      position: 'absolute',
      minWidth: 224,
      maxWidth: 276,
      borderRadius: 24,
      paddingVertical: 8,
      paddingHorizontal: 6,
      shadowColor: '#000',
      shadowOpacity: 0.14,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    cardLight: {
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(0, 0, 0, 0.05)',
    },
    cardDark: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 46,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
    },
    rowSelected: {
      backgroundColor: colors.primarySoft,
    },
    rowPressed: {
      backgroundColor: colors.grouped,
    },
    rowDisabled: {
      opacity: 0.4,
    },
    label: {
      flex: 1,
      fontSize: 16,
      fontWeight: '400',
      color: colors.ink,
    },
    labelDanger: {
      color: colors.danger,
    },
  })
