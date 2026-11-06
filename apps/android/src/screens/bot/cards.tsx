import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { strings as s } from '../../locales/i18n'
import { object, text, type BotObject } from '../../services/bot-catalog'
import { Button } from '../../ui/components'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { BotChoice } from './controls'
import { createBotStyles } from './styles'

export { BotViewCard } from './view-card'

const keyLetter = (index: number) => String.fromCharCode(65 + index)

export function BotQuestion({ question, busy, answer, dismiss }: { question: BotObject; busy: boolean; answer: (value: BotObject) => void; dismiss: () => void }) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createCardStyles)
  const { colors } = useTheme()
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const options = (Array.isArray(question.options) ? question.options : []).map(option => typeof option === 'string' ? { label: option } : object(option))
  return <View style={styles.card}>
    <Text style={styles.heading}>{text(question.header) || s.bots.question}</Text><Text style={styles.body}>{text(question.question)}</Text>
    {text(question.detail) !== '' && <Text style={styles.muted}>{text(question.detail)}</Text>}
    {options.map((option, i) => { const label = text(option.label); return <BotChoice key={i} label={`${keyLetter(i)}. ${label}`} description={text(option.description)} multiple={question.multiSelect === true} checked={selected.includes(label)} disabled={busy} onPress={() => setSelected(current => question.multiSelect === true ? current.includes(label) ? current.filter(item => item !== label) : [...current, label] : [label])} /> })}
    <TextInput style={styles.input} value={custom} onChangeText={setCustom} editable={!busy} placeholder={s.bots.yourAnswer} accessibilityLabel={s.bots.yourAnswer} placeholderTextColor={colors.muted} multiline />
    <View style={[styles.actions, localStyles.footerRow]}><Button variant="quiet" label={s.bots.dismiss} disabled={busy} onPress={dismiss} /><Button label={s.bots.submit} disabled={busy || (selected.length === 0 && custom.trim() === '')} onPress={() => answer({ selected, ...(custom.trim() ? { custom: custom.trim() } : {}) })} /></View>
  </View>
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
