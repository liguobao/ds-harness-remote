import { useState } from 'react'
import { AccessibilityInfo, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Copy, GitBranch } from 'lucide-react-native'
import type { ChatItemBase, ChatMessage } from '../types'
import { useAppStore } from '../state/store'
import { strings } from '../locales/i18n'
import { useTheme } from '../ui/theme-context'

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
  return <View style={[styles.row, user && styles.userRow]}>
    {user && time !== undefined && <Text style={{ color: colors.muted, fontSize: 12 }}>{messageClock(time)}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={copied ? strings.messageActions.copied : strings.messageActions.copy} disabled={item.text.length === 0} style={styles.icon} onPress={() => {
      void Clipboard.setStringAsync(item.text).then(() => { setCopied(true); AccessibilityInfo.announceForAccessibility(strings.messageActions.copied) }).catch(report)
    }}><Copy size={16} color={copied ? colors.primary : colors.muted} /></Pressable>
    {!user && !pending && <>
    {supportsBranch && <Pressable accessibilityRole="button" accessibilityLabel={strings.messageActions.branch} accessibilityState={{ disabled }} disabled={disabled} style={styles.icon} onPress={() => void branch()}><GitBranch size={16} color={colors.muted} /></Pressable>}
    {backend !== 'codex' && item.usage !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={strings.messageActions.usage} style={styles.usage} onPress={showUsage}><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>{item.usage.totalTokens === undefined ? strings.messageActions.usage : `${item.usage.totalTokens.toLocaleString()} tokens`}</Text></Pressable>}
    {time !== undefined && <View style={styles.clockContainer}><Text style={[styles.clock, { color: colors.muted }]}>{messageClock(time)}</Text></View>}
    </>}
  </View>
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2, minHeight: 44 },
  userRow: { justifyContent: 'flex-end', gap: 8 },
  icon: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  clockContainer: { flexGrow: 1, flexShrink: 0, alignItems: 'flex-end' },
  clock: { fontSize: 11 },
  usage: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
})
