import { useEffect, useRef } from 'react'
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, X, type LucideIcon } from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import { GroupCard, GroupRow, IconButton } from '../../ui/components'
import { useResponsiveLayout } from '../../ui/responsive'
import { SheetModal } from '../../ui/sheet'
import { spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { createModalActionQueue } from '../chat/modal-action-queue'

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
 * Themed action sheet for DS-Bot menus (replaces legacy fixed-offset popovers),
 * built on `SheetModal` with drag-to-dismiss, tablet dialog promotion and safe
 * post-dismiss action handoff on iOS.
 */
export function BotFloatingPopover({
  visible,
  actions,
  onClose,
  onDismiss,
  title,
  presentation = 'adaptive',
}: {
  visible: boolean
  actions: BotPopoverAction[]
  onClose: () => void
  onDismiss?: () => void
  title?: string
  presentation?: 'adaptive' | 'sheet'
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createPopoverStyles)
  const { sheetMaxHeight } = useResponsiveLayout()
  const menuActions = useRef(createModalActionQueue(Platform.OS === 'ios')).current

  useEffect(() => () => menuActions.cancel(), [menuActions])

  const handleDismiss = () => {
    menuActions.onDismiss()
    onDismiss?.()
  }

  return (
    <SheetModal
      visible={visible && actions.length > 0}
      onClose={onClose}
      onDismiss={handleDismiss}
      presentation={presentation}
    >
      {title !== undefined && (
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <IconButton label={s.common.close} icon={X} dense onPress={onClose} />
        </View>
      )}
      <ScrollView
        style={{ maxHeight: Math.max(160, sheetMaxHeight - 104) }}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <GroupCard>
          {actions.map((action, index) => (
            <GroupRow
              key={action.key}
              first={index === 0}
              icon={action.icon}
              label={action.label}
              danger={action.danger}
              selected={action.selected}
              disabled={action.disabled}
              chevron={false}
              accessory={action.selected ? <Check size={18} color={colors.primary} strokeWidth={2.2} /> : undefined}
              onPress={() => menuActions.run(onClose, action.onPress)}
            />
          ))}
        </GroupCard>
      </ScrollView>
    </SheetModal>
  )
}

const createPopoverStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    title: {
      ...type.heading,
      color: colors.ink,
      flex: 1,
    },
  })
