import { useRef } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from 'react-native'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
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
  // iOS runs handlers after its dismiss fade. Android does not emit
  // Modal.onDismiss, so it must run the action when requesting the close.
  const pendingRef = useRef<(() => void) | undefined>(undefined)
  const runPending = () => {
    const pending = pendingRef.current
    pendingRef.current = undefined
    pending?.()
  }
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={() => {
        pendingRef.current = undefined
        onClose('dismiss')
      }}
      onDismiss={runPending}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => onClose('dismiss')} accessibilityLabel={title} />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.buttons}>
            {buttons.map(button => (
              <Pressable
                key={button.label}
                accessibilityRole="button"
                accessibilityLabel={button.label}
                onPress={() => {
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
      </View>
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
  })
