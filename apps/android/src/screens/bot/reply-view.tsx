import { useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy } from 'lucide-react-native'
import { StyleSheet, Text, View, Pressable } from 'react-native'
import { strings as s } from '../../locales/i18n'
import { text, type BotObject } from '../../services/bot-catalog'
import { NativeMarkdown } from '../../ui/markdown'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { stackBotReplies } from './replies'
import { BotAvatar } from './avatar'
import { messageClock } from '../message-actions'
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
  if (kind === 'folder') return { isEvent: true, body: text(reply.text) }
  const label = (s.bots.relayEvents as Record<string, string>)[kind]
  return { isEvent: true, body: label ? `${speakerName} · ${label}` : '' }
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

type AvatarBot = { id: string; avatar?: { shape?: string; image?: string }; color?: string; engine?: string; model?: string; appliedModel?: string }

export function BotReplies({ rows, botOf }: { rows: BotObject[]; botOf?: (botId: string) => AvatarBot | undefined }) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createReplyStyles)
  return (
    <View style={styles.section}>
      {stackBotReplies(rows).map(({ reply, texts }, i) => {
        const speakerName = text(reply.name) || (reply.kind === 'user' ? s.bots.yourAnswer : s.bots.title)
        const via = text(reply.via)
        const formatted = formatRelayEvent(reply, speakerName)
        if (formatted.isEvent) {
          if (!formatted.body) return null
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
          <View key={i} style={reply.kind === 'user' ? localStyles.userRow : localStyles.memberRow}>
            {reply.kind !== 'user' && (
              <View style={localStyles.memberAvatar}>
                <BotAvatar bot={botOf?.(text(reply.botId)) ?? { id: text(reply.botId) || speakerName, color: text(reply.color) || undefined }} size={26} />
              </View>
            )}
            <View style={reply.kind === 'user' ? localStyles.userBubble : localStyles.memberBody}>
              {reply.kind !== 'user' && <View style={localStyles.headerRow}>
                <Text style={styles.heading}>{speakerName}</Text>
                {typeof reply.time === 'number' && <Text style={styles.muted}>{messageClock(reply.time)}</Text>}
                {via !== '' && <BotViaPill platform={via} />}
              </View>}
              <View style={reply.kind === 'user' ? undefined : localStyles.memberBubble}>
                {texts.map((body, index) => <NativeMarkdown key={index} text={body} />)}
              </View>
              <View style={localStyles.footerRow}>
                <ReplyCopy text={texts.join('\n\n')} />
                {reply.kind === 'user' && via !== '' && <BotViaPill platform={via} />}
                {reply.kind === 'user' && typeof reply.time === 'number' && <Text style={styles.muted}>{messageClock(reply.time)}</Text>}
              </View>
            </View>
          </View>
        )
      })}
    </View>
  )
}

const createReplyStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    userBubble: {
      alignSelf: 'flex-end', maxWidth: '90%', padding: spacing.md,
      borderRadius: radius.lg, backgroundColor: colors.surfaceStrong,
    },
    memberRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    memberAvatar: { width: 26, height: 26, flexShrink: 0 },
    memberBody: { flexShrink: 1, flexGrow: 1, gap: spacing.xs },
    memberBubble: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.lg, backgroundColor: colors.surfaceStrong,
    },
    userRow: { alignItems: 'flex-end' },
    footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
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

function ReplyCopy({ text }: { text: string }) {
  const { colors } = useTheme()
  const [copied, setCopied] = useState(false)
  return <Pressable accessibilityRole="button" accessibilityLabel={copied ? s.messageActions.copied : s.messageActions.copy}
    disabled={!text} hitSlop={8} style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}
    onPress={async () => { await Clipboard.setStringAsync(text); setCopied(true) }}>
    {copied ? <Check size={14} color={colors.primary} /> : <Copy size={14} color={colors.muted} />}
  </Pressable>
}
