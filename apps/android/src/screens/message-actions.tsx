import { useState } from 'react'
import { AccessibilityInfo, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Coins, Copy, GitBranch } from 'lucide-react-native'
import type { ChatItemBase, ChatMessage } from '../types'
import { useAppStore } from '../state/store'
import { strings } from '../locales/i18n'
import { useTheme } from '../ui/theme-context'
import { formatTokens } from '../ui/quote-helpers'

export { formatTokens }

export function messageClock(time?: number): string {
  if (time === undefined || !Number.isFinite(time) || time <= 0) return strings.messageActions.timeUnavailable
  return new Date(time).toLocaleTimeString(strings.time.locale, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** History without an upstream timestamp must not inherit the time it was loaded. */
export function messageTime(item: ChatItemBase): number | undefined {
  if (item.nativeTime !== undefined && Number.isFinite(item.nativeTime) && item.nativeTime > 0) return item.nativeTime
  if (item.nativeSeq === undefined && Number.isFinite(item.createdAt) && item.createdAt > 0) return item.createdAt
  return undefined
}

/** Mutating icons only change after the official Host write has been read back. */
export function MessageActions({ item }: { item: ChatMessage }) {
  const { colors } = useTheme()
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const busy = useAppStore(state => state.busyAction !== undefined)
  // The row's own session, not whatever happens to be selected afterwards.
  const session = useAppStore(state => state.sessions.find(row => row.sessionId === item.sessionId)
    ?? (state.selectedSession?.sessionId === item.sessionId ? state.selectedSession : undefined))
  const backend = session?.backend
  const harness = session !== undefined && (backend === undefined || backend === 'harness')
  // Only delivered Harness messages have an official event prefix to fork.
  const pending = item.sendState !== undefined
  const supportsBranch = harness && item.nativeSeq !== undefined && Number.isSafeInteger(item.nativeSeq) && item.nativeSeq >= 0
  const time = messageTime(item)
  const fork = useAppStore(state => state.forkChatMessage)
  const [copied, setCopied] = useState(false)
  const disabled = !connected || busy || item.streaming === true
  const report = () => Alert.alert(strings.messageActions.failed, useAppStore.getState().error ?? strings.messageActions.unavailable)
  const branch = async () => {
    if (!supportsBranch) return
    Alert.alert(strings.messageActions.branch, undefined, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: strings.messageActions.branch, onPress: () => { void fork(item).then(ok => { if (!ok) report() }) } },
    ])
  }
  const showUsage = () => {
    const u = item.usage
    if (u === undefined) { Alert.alert(strings.messageActions.usage, strings.messageActions.usageUnavailable); return }
    const rows = [
      [strings.messageActions.input, u.inputTokens], [strings.messageActions.output, u.outputTokens],
      [strings.messageActions.cacheRead, u.cacheReadTokens], [strings.messageActions.cacheWrite, u.cacheWriteTokens],
      [strings.messageActions.reasoning, u.reasoningTokens], [strings.messageActions.total, u.totalTokens],
    ] as const
    Alert.alert(strings.messageActions.usage, rows.filter(([, value]) => value !== undefined).map(([label, value]) => `${label}: ${value}`).join('\n'))
  }
  const user = item.role === 'user'

  if (user) {
    return (
      <View style={[styles.row, styles.userRow]}>
        {time !== undefined && <Text style={{ color: colors.muted, fontSize: 12 }}>{messageClock(time)}</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? strings.messageActions.copied : strings.messageActions.copy}
          disabled={item.text.length === 0}
          hitSlop={8}
          style={styles.actionBtn}
          onPress={() => {
            void Clipboard.setStringAsync(item.text).then(() => { setCopied(true); AccessibilityInfo.announceForAccessibility(strings.messageActions.copied) }).catch(report)
          }}
        >
          <Copy size={14} color={copied ? colors.primary : colors.muted} strokeWidth={1.8} />
        </Pressable>
      </View>
    )
  }

  const totalTokens = item.usage?.totalTokens
  const usageLabel = totalTokens !== undefined ? `${strings.messageActions.usage} ${formatTokens(totalTokens)} tok` : strings.messageActions.usage

  return (
    <View style={styles.assistantRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? strings.messageActions.copied : strings.messageActions.copy}
        disabled={item.text.length === 0}
        hitSlop={8}
        style={styles.actionBtn}
        onPress={() => {
          void Clipboard.setStringAsync(item.text).then(() => { setCopied(true); AccessibilityInfo.announceForAccessibility(strings.messageActions.copied) }).catch(report)
        }}
      >
        <Copy size={14} color={copied ? colors.primary : colors.muted} strokeWidth={1.8} />
      </Pressable>
      {!pending && supportsBranch && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.messageActions.branch}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={8}
          style={styles.actionBtn}
          onPress={() => void branch()}
        >
          <GitBranch size={14} color={colors.muted} strokeWidth={1.8} />
        </Pressable>
      )}
      {!pending && backend !== 'codex' && item.usage !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.messageActions.usage}
          hitSlop={8}
          style={styles.usageBtn}
          onPress={showUsage}
        >
          <Coins size={14} color={colors.muted} strokeWidth={1.8} />
          <Text numberOfLines={1} style={[styles.usageText, { color: colors.muted }]}>
            {usageLabel}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  userRow: { justifyContent: 'flex-end', gap: 8, paddingTop: 4 },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 32,
    paddingTop: 8,
    paddingBottom: 2,
  },
  actionBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  usageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    paddingHorizontal: 2,
  },
  usageText: {
    fontSize: 12,
    fontWeight: '400',
  },
})
