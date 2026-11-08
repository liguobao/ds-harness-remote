import { Text, View } from 'react-native'
import { strings as s } from '../../locales/i18n'
import { text, type BotObject } from '../../services/bot-catalog'
import { Button } from '../../ui/components'
import { NativeMarkdown } from '../../ui/markdown'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { createBotStyles } from './styles'

export function BotAsideCard({ card, busy, cancel, onDelete }: { card: BotObject; busy: boolean; cancel: () => void; onDelete?: () => void }) {
  const styles = useThemedStyles(createBotStyles)
  const answering = card.status === 'answering'
  return <View style={styles.card} accessibilityLabel={s.bots.btw}>
    <Text style={styles.muted}>{s.bots.btw}{typeof card.createdAt === 'number' ? ` · ${new Date(card.createdAt).toLocaleString()}` : ''}</Text>
    <Text selectable style={styles.heading}>{text(card.question)}</Text>
    <Text style={styles.muted}>{s.bots.btwNote}</Text>
    {text(card.answer) !== '' && <NativeMarkdown text={text(card.answer)} />}
    {answering && <Text accessibilityLiveRegion="polite" style={styles.muted}>{s.bots.btwAnswering}</Text>}
    {card.status === 'cancelled' && <Text style={styles.muted}>{s.bots.btwCancelled}</Text>}
    {card.status === 'failed' && <Text accessibilityRole="alert" style={styles.error}>{text(card.error) || s.bots.btwFailed}</Text>}
    {answering && <View style={styles.actions}><Button variant="quiet" label={s.bots.cancel} disabled={busy || !text(card.id)} onPress={cancel} /></View>}
    {!answering && onDelete !== undefined && <View style={styles.actions}><Button variant="quiet" label={s.bots.delete} disabled={busy || !text(card.id)} onPress={onDelete} /></View>}
  </View>
}
