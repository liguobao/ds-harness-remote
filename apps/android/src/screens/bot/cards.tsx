import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { X } from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import { object, text, type BotObject } from '../../services/bot-catalog'
import { Button } from '../../ui/components'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { createBotStyles } from './styles'

export { BotViewCard } from './view-card'

const keyLetter = (index: number) => String.fromCharCode(65 + index)

export function BotQuestion({ question, busy, answer, dismiss }: { question: BotObject; busy: boolean; answer: (value: BotObject) => void; dismiss: () => void }) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createCardStyles)
  const { colors, scheme } = useTheme()
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const options = (Array.isArray(question.options) ? question.options : []).map(option => typeof option === 'string' ? { label: option } : object(option))
  const isMulti = question.multiSelect === true
  const needsCustomInput = options.length === 0
  const promptTitle = text(question.question) || text(question.header) || s.bots.question
  const subHeader = text(question.question) && text(question.header) ? text(question.header) : ''
  const detailText = text(question.detail)

  const handleOptionPress = (label: string) => {
    if (busy) return
    if (isMulti) {
      setSelected(current => current.includes(label) ? current.filter(item => item !== label) : [...current, label])
      return
    }
    setSelected([label])
    answer({ selected: [label] })
  }

  return (
    <View style={localStyles.wrapper}>
      <View style={[localStyles.questionCard, scheme === 'light' ? localStyles.questionCardLight : localStyles.questionCardDark]}>
        <View style={localStyles.headerRow}>
          <View style={localStyles.headerTextWrap}>
            {Boolean(subHeader) && <Text style={localStyles.kickerText}>{subHeader}</Text>}
            <Text style={localStyles.questionTitle}>{promptTitle}</Text>
            {Boolean(detailText) && <Text style={localStyles.detailText}>{detailText}</Text>}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.bots.dismiss}
            disabled={busy}
            hitSlop={10}
            onPress={dismiss}
            style={({ pressed }) => [localStyles.closeBtn, pressed && { opacity: 0.55 }, busy && { opacity: 0.35 }]}
          >
            <X size={18} color={colors.muted} strokeWidth={1.9} />
          </Pressable>
        </View>

        {options.length > 0 && (
          <View style={localStyles.optionsList}>
            {options.map((option, i) => {
              const label = text(option.label)
              const desc = text(option.description)
              const isChecked = selected.includes(label)
              return (
                <Pressable
                  key={i}
                  accessibilityRole={isMulti ? 'checkbox' : 'button'}
                  accessibilityState={{ checked: isChecked, disabled: busy }}
                  accessibilityLabel={`${keyLetter(i)}. ${label}`}
                  disabled={busy}
                  onPress={() => handleOptionPress(label)}
                  style={({ pressed }) => [
                    localStyles.optionRow,
                    pressed && localStyles.optionRowPressed,
                    busy && { opacity: 0.5 },
                  ]}
                >
                  <View
                    style={[
                      localStyles.letterBadge,
                      scheme === 'light' ? localStyles.letterBadgeLight : localStyles.letterBadgeDark,
                      isChecked && localStyles.letterBadgeActive,
                    ]}
                  >
                    <Text style={[localStyles.letterText, isChecked && localStyles.letterTextActive]}>
                      {keyLetter(i)}
                    </Text>
                  </View>
                  <View style={localStyles.optionBody}>
                    <Text style={localStyles.optionLabel}>{label}</Text>
                    {Boolean(desc) && <Text style={localStyles.optionDesc}>{desc}</Text>}
                  </View>
                </Pressable>
              )
            })}
          </View>
        )}

        {(isMulti || needsCustomInput) && (
          <View style={localStyles.submitArea}>
            {needsCustomInput && (
              <TextInput
                style={styles.input}
                value={custom}
                onChangeText={setCustom}
                editable={!busy}
                placeholder={s.bots.yourAnswer}
                accessibilityLabel={s.bots.yourAnswer}
                placeholderTextColor={colors.muted}
                multiline
              />
            )}
            <View style={[styles.actions, localStyles.footerRow]}>
              <Button
                label={s.bots.submit}
                disabled={busy || (selected.length === 0 && custom.trim() === '')}
                onPress={() => answer({ selected, ...(custom.trim() ? { custom: custom.trim() } : {}) })}
              />
            </View>
          </View>
        )}
      </View>
      {!needsCustomInput && <Text style={localStyles.belowCardHint}>{s.bots.orAnswerInChat}</Text>}
    </View>
  )
}

export function BotSettledCard({ title, closed }: { title: string; closed: 'replied' | 'dismissed' | string }) {
  const localStyles = useThemedStyles(createCardStyles)
  const badgeText = closed === 'replied' ? s.bots.answeredByMessage : s.bots.cardDismissed
  return (
    <View style={localStyles.settledCard} accessibilityRole="summary">
      <Text style={localStyles.settledTitle} numberOfLines={2}>{title || s.bots.question}</Text>
      <View style={localStyles.settledBadge}>
        <Text style={localStyles.settledBadgeText}>{badgeText}</Text>
      </View>
    </View>
  )
}

const createCardStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      gap: 8,
    },
    questionCard: {
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 16,
      borderRadius: 24,
      gap: 14,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    questionCardLight: {
      backgroundColor: '#FFFFFF',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(0, 0, 0, 0.05)',
    },
    questionCardDark: {
      backgroundColor: colors.cardOpaque,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    headerTextWrap: {
      flex: 1,
      gap: 4,
    },
    kickerText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.muted,
    },
    questionTitle: {
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '700',
      color: colors.ink,
    },
    detailText: {
      fontSize: 13.5,
      lineHeight: 19,
      color: colors.muted,
    },
    closeBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -2,
      marginRight: -4,
    },
    optionsList: {
      gap: 4,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 9,
      paddingHorizontal: 6,
      marginHorizontal: -6,
      borderRadius: 14,
    },
    optionRowPressed: {
      backgroundColor: colors.grouped,
    },
    letterBadge: {
      width: 26,
      height: 26,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    letterBadgeLight: {
      backgroundColor: '#EAECEF',
    },
    letterBadgeDark: {
      backgroundColor: colors.surfaceStrong,
    },
    letterBadgeActive: {
      backgroundColor: colors.ink,
    },
    letterText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.muted,
    },
    letterTextActive: {
      color: colors.surface,
    },
    optionBody: {
      flex: 1,
      gap: 2,
    },
    optionLabel: {
      fontSize: 15.5,
      lineHeight: 21,
      fontWeight: '500',
      color: colors.ink,
    },
    optionDesc: {
      fontSize: 12.5,
      lineHeight: 17,
      color: colors.muted,
    },
    submitArea: {
      gap: 10,
      paddingTop: 4,
    },
    belowCardHint: {
      fontSize: 13,
      color: colors.muted,
      paddingHorizontal: 8,
    },
    footerRow: { alignItems: 'center' },
    settledCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      backgroundColor: colors.card,
    },
    settledTitle: { ...type.small, color: colors.muted, flex: 1 },
    settledBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    settledBadgeText: { ...type.caption, fontSize: 11.5, color: colors.muted, fontWeight: '600' },
  })
