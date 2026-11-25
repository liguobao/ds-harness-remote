import { ArrowRightLeft } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { strings } from '../../locales/i18n'
import { radius, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'

export function HandoffOriginBadge({
  sourceLabel,
  selected = false,
  compact = false,
}: {
  sourceLabel: string
  selected?: boolean
  compact?: boolean
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const label = sourceLabel.trim()

  return (
    <View
      style={[
        styles.badge,
        compact && styles.badgeCompact,
        selected && styles.badgeSelected,
      ]}
      accessibilityLabel={label.length > 0 ? strings.handoff.badgeFrom(label) : strings.handoff.title}
    >
      <ArrowRightLeft size={compact ? 10 : 11} color={colors.primary} strokeWidth={2.2} />
      {label.length > 0 && (
        <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    maxWidth: 92,
    flexShrink: 0,
  },
  badgeCompact: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    maxWidth: 84,
  },
  badgeSelected: {
    backgroundColor: colors.surface,
  },
  text: {
    ...type.caption,
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '600',
    color: colors.primary,
    flexShrink: 1,
  },
  textCompact: {
    fontSize: 10,
    lineHeight: 12,
  },
})
