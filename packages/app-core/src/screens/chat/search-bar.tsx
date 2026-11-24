import type { RefObject } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings } from '../../locales/i18n'
import { IconButton, HeaderBlurBackdrop } from '../../ui/components'
import { continuousRadius } from '../../ui/platform-style'
import { floatingShadow, radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'

export interface ChatSearchBarProps {
  inputRef: RefObject<TextInput | null>
  query: string
  hasActiveQuery: boolean
  matchCount: number
  activeIndex: number
  onChangeQuery: (value: string) => void
  onPrev: () => void
  onNext: () => void
  onSubmit: () => void
  onClose: () => void
}

export function ChatSearchBar({
  inputRef,
  query,
  hasActiveQuery,
  matchCount,
  activeIndex,
  onChangeQuery,
  onPrev,
  onNext,
  onSubmit,
  onClose,
}: ChatSearchBarProps) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const navDisabled = matchCount === 0
  const countLabel = matchCount > 0 && activeIndex >= 0
    ? `${activeIndex + 1}/${matchCount}`
    : strings.chat.searchNoResults

  return (
    <View
      style={[
        styles.barWrap,
        {
          paddingTop: insets.top + spacing.xs,
        },
      ]}
    >
      <HeaderBlurBackdrop />
      <View style={styles.pill}>
        <Search size={18} color={colors.muted} strokeWidth={2} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onChangeQuery}
          placeholder={strings.chat.searchInChat}
          placeholderTextColor={colors.muted}
          selectionColor={colors.primary}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={onSubmit}
          accessibilityLabel={strings.chat.searchInChat}
          style={styles.input}
        />
        {hasActiveQuery && (
          <Text
            style={[styles.countText, matchCount === 0 && styles.countEmpty]}
            accessibilityLiveRegion="polite"
            numberOfLines={1}
          >
            {countLabel}
          </Text>
        )}
        <IconButton
          dense
          label={strings.chat.searchNext}
          icon={ChevronDown}
          disabled={navDisabled}
          tint={navDisabled ? colors.subtle : colors.ink}
          onPress={onNext}
        />
        <IconButton
          dense
          label={strings.chat.searchPrevious}
          icon={ChevronUp}
          disabled={navDisabled}
          tint={navDisabled ? colors.subtle : colors.ink}
          onPress={onPrev}
        />
        <IconButton
          dense
          label={strings.common.close}
          icon={X}
          onPress={onClose}
        />
      </View>
    </View>
  )
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    barWrap: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
      minHeight: 56,
    },
    pill: {
      minHeight: 46,
      ...continuousRadius(radius.pill),
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 14,
      paddingRight: 4,
      gap: 4,
      ...floatingShadow(colors),
    },
    input: {
      ...type.body,
      fontSize: 15,
      lineHeight: 20,
      flex: 1,
      minWidth: 0,
      minHeight: 42,
      paddingVertical: 6,
      paddingHorizontal: 4,
      color: colors.ink,
    },
    countText: {
      ...type.caption,
      fontSize: 12,
      color: colors.muted,
      fontVariant: ['tabular-nums'],
      paddingHorizontal: 4,
    },
    countEmpty: {
      color: colors.subtle,
    },
  })
