import { StyleSheet, Text, View } from 'react-native'
import { strings as s } from '../../locales/i18n'
import { text, type BotObject } from '../../services/bot-catalog'
import { NativeMarkdown } from '../../ui/markdown'
import { radius, spacing, type } from '../../ui/theme'
import { type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { createBotStyles } from './styles'

function formatRelayEvent(reply: BotObject, speakerName: string): { isEvent: boolean; isError?: boolean; body: string } {
  const kind = text(reply.kind)
  if (!kind || kind === 'user') {
    return { isEvent: false, body: text(reply.text) }
  }
  if (kind === 'failed') {
    const reason = text(reply.text) || text(reply.code) || s.bots.unknownOutcome
    return {
      isEvent: true,
      isError: true,
      body: s.bots.relayFailed(speakerName, reason),
    }
  }
  if (text(reply.text)) {
    return { isEvent: false, body: text(reply.text) }
  }
  return { isEvent: true, body: `${speakerName} · ${kind}` }
}

export function BotViaPill({ platform }: { platform?: string }) {
  const localStyles = useThemedStyles(createReplyStyles)
  if (!platform) return null
  return (
    <View style={localStyles.viaPill}>
      <Text style={localStyles.viaPillText}>{s.bots.viaPlatform(platform)}</Text>
    </View>
  )
}

export function BotReplies({ rows }: { rows: BotObject[] }) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createReplyStyles)
  return (
    <View style={styles.section}>
      {rows.map((reply, i) => {
        const speakerName = text(reply.name) || (reply.kind === 'user' ? s.bots.yourAnswer : s.bots.title)
        const via = text(reply.via)
        const formatted = formatRelayEvent(reply, speakerName)
        if (formatted.isEvent) {
          return (
            <View
              key={i}
              style={[localStyles.eventRow, formatted.isError && localStyles.eventRowError]}
              accessibilityRole="summary"
            >
              <Text style={[localStyles.eventText, formatted.isError && localStyles.eventTextError]}>
                {formatted.body}
              </Text>
            </View>
          )
        }
        return (
          <View key={i} style={styles.card}>
            <View style={localStyles.headerRow}>
              <Text style={styles.heading}>{speakerName}</Text>
              {via !== '' && <BotViaPill platform={via} />}
            </View>
            <NativeMarkdown text={formatted.body} />
          </View>
        )
      })}
    </View>
  )
}

const createReplyStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
    },
    viaPill: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    viaPillText: {
      ...type.caption,
      fontSize: 11,
      color: colors.muted,
    },
    eventRow: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceStrong,
    },
    eventRowError: {
      backgroundColor: colors.dangerSoft,
    },
    eventText: {
      ...type.small,
      color: colors.muted,
    },
    eventTextError: {
      color: colors.danger,
    },
  })
