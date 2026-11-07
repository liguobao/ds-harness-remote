import { useEffect, useRef } from 'react'
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'

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
  anchor = 'top-right',
  topOffset = 54,
  bottomOffset = 72,
}: {
  visible: boolean
  actions: BotPopoverAction[]
  onClose: () => void
  anchor?: 'top-right' | 'top-left' | 'bottom-left'
  topOffset?: number
  bottomOffset?: number
}) {
  const insets = useSafeAreaInsets()
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(createPopoverStyles)
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) {
      anim.setValue(0)
      return
    }
    Animated.timing(anim, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [anim, visible])

  if (!visible || actions.length === 0) return null

  const positionStyle =
    anchor === 'top-left'
      ? { top: insets.top + topOffset, left: 16 }
      : anchor === 'bottom-left'
        ? { bottom: insets.bottom + bottomOffset, left: 16 }
        : { top: insets.top + topOffset, right: 16 }

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] })

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss menu" />
        <Animated.View
          style={[
            styles.card,
            scheme === 'light' ? styles.cardLight : styles.cardDark,
            positionStyle,
            { opacity: anim, transform: [{ scale }] },
          ]}
        >
          {actions.map(action => {
            const Icon = action.icon
            const inkColor = action.danger ? colors.danger : colors.ink
            return (
              <Pressable
                key={action.key}
                accessibilityRole="menuitem"
                accessibilityLabel={action.label}
                disabled={action.disabled}
                onPress={() => {
                  onClose()
                  action.onPress()
                }}
                style={({ pressed }) => [
                  styles.row,
                  action.selected && styles.rowSelected,
                  pressed && styles.rowPressed,
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
