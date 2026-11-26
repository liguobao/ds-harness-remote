import { Text, View } from 'react-native'
import { type UiIconComponent } from '../../ui/components'
import { DuotoneIcons, MotionPressable } from '../../ui/duotone-icons'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { createBotStyles } from './styles'

export function BotAction({ label, icon: Icon, disabled = false, danger = false, navigate = false, onPress }: {
  label: string; icon: UiIconComponent; disabled?: boolean; danger?: boolean; navigate?: boolean; onPress: () => void
}) {
  const styles = useThemedStyles(createBotStyles)
  const { colors } = useTheme()
  return <MotionPressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.detailAction, pressed && styles.rosterPressed, disabled && styles.footerDisabled]}>
    <Icon size={20} color={danger ? colors.danger : colors.muted} /><Text style={[styles.body, styles.grow, danger && { color: colors.danger }]}>{label}</Text>
    {navigate && <DuotoneIcons.ChevronRight size={18} color={colors.subtle} />}
  </MotionPressable>
}

export function BotChoice({ label, description, checked, multiple = false, disabled = false, onPress }: {
  label: string; description?: string; checked: boolean; multiple?: boolean; disabled?: boolean; onPress: () => void
}) {
  const styles = useThemedStyles(createBotStyles)
  const { colors } = useTheme()
  const Mark = checked ? DuotoneIcons.Check : multiple ? DuotoneIcons.Square : DuotoneIcons.Circle
  return <MotionPressable accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.choice, checked && styles.selected, pressed && styles.choicePressed, disabled && styles.footerDisabled]}>
    <Mark size={18} color={checked ? colors.primary : colors.subtle} /><View style={styles.grow}><Text style={styles.body}>{label}</Text>{!!description && <Text style={styles.muted}>{description}</Text>}</View>
  </MotionPressable>
}
