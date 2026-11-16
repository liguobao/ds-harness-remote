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
import { botMentionSpans } from './mentions'
import type { BotEntry } from '../../services/bot-catalog'
import { BotAvatar } from './avatar'
import { botMessageClock } from './clock'
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

type AvatarBot = { id: string; avatar?: { shape?: string; image?: string }; color?: string; engine?: string; model?: string; appliedModel?: string; role?: string }

/** What a mention needs: the roster to resolve names against and where a tap goes. */
export interface BotMentionContext { bots: BotEntry[]; selfId?: string; onPress: (botId: string) => void }

export function BotReplies({ rows, botOf, mentions, adminId }: {
  rows: BotObject[]; botOf?: (botId: string) => AvatarBot | undefined; mentions?: BotMentionContext
  /** The room's admin, badged as on the Host's own chat. */
  adminId?: string
}) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createReplyStyles)
  return (
    <View style={styles.section}>
      {stackBotReplies(rows).map(({ reply, texts }, i) => {
        const speakerName = text(reply.name) || (reply.kind === 'user' ? s.bots.yourAnswer : s.bots.title)
        const via = text(reply.via)
        const speakerId = text(reply.botId)
        const role = reply.kind === 'user' || speakerId === '' ? ''
          : speakerId === adminId ? 'Admin' : (botOf?.(speakerId)?.role ?? '')
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
                {role !== '' && <View style={localStyles.roleBadge}><Text style={localStyles.roleBadgeText}>{role}</Text></View>}
                <View style={localStyles.headerSpacer} />
                {typeof reply.time === 'number' && <Text style={styles.muted}>{botMessageClock(reply.time)}</Text>}
                {typeof reply.duration === 'number' && reply.duration > 0 && (
                  <Text style={styles.muted}>{Math.max(1, Math.round(reply.duration / 1000))}s</Text>
                )}
                {via !== '' && <BotViaPill platform={via} />}
              </View>}
              <View style={reply.kind === 'user' ? undefined : localStyles.memberBubble}>
                {texts.map((body, index) => <MentionBody key={index} body={body} mentions={mentions} />)}
              </View>
              <View style={localStyles.footerRow}>
                <ReplyCopy text={texts.join('\n\n')} />
                {reply.kind === 'user' && via !== '' && <BotViaPill platform={via} />}
              </View>
            </View>
          </View>
        )
      })}
    </View>
  )
}

/**
 * A member's line, with each `@Name` drawn like the web chat: the mentioned member's
 * character followed by their name, inline with the sentence.
 */
function MentionBody({ body, mentions }: { body: string; mentions?: BotMentionContext }) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createReplyStyles)
  const spans = mentions ? botMentionSpans(body, mentions.bots, mentions.selfId) : []
  if (mentions === undefined || spans.length === 0) return <NativeMarkdown text={body} />
  const runs: React.ReactNode[] = []
  let cursor = 0
  spans.forEach((span, index) => {
    if (span.start > cursor) runs.push(<Text key={`t${index}`} style={styles.body}>{body.slice(cursor, span.start)}</Text>)
    runs.push(
      <Pressable
        key={`m${index}`}
        onPress={() => mentions.onPress(span.bot.id)}
        accessibilityRole="link"
        accessibilityLabel={`@${span.bot.name}`}
      >
        <View style={localStyles.mention}>
          <BotAvatar bot={span.bot} size={16} />
          <Text style={[styles.body, localStyles.mentionName]}>{span.bot.name}</Text>
        </View>
      </Pressable>,
    )
    cursor = span.end
  })
  if (cursor < body.length) runs.push(<Text key="tail" style={styles.body}>{body.slice(cursor)}</Text>)
  return <View style={localStyles.mentionFlow}>{runs}</View>
}

const createReplyStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    userBubble: {
      alignSelf: 'flex-end', maxWidth: '90%', padding: spacing.md,
      borderRadius: radius.lg, backgroundColor: colors.surfaceStrong,
    },
    memberRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    memberAvatar: { width: 26, height: 26, flexShrink: 0 },
    mentionFlow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 2 },
    mention: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 1 },
    mentionName: { color: colors.warning, fontWeight: '600' },
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
      gap: spacing.xs,
    },
    headerSpacer: { flexGrow: 1 },
    roleBadge: {
      paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm,
      backgroundColor: colors.surfaceStrong,
    },
    roleBadgeText: { fontSize: 11, fontWeight: '600', color: colors.muted },
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
