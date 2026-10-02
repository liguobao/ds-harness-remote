import { useState } from 'react'
import { AccessibilityInfo, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Copy, GitBranch, ThumbsDown, ThumbsUp } from 'lucide-react-native'
import type { ChatMessage } from '../types'
import { useAppStore } from '../state/store'
import { strings } from '../locales/i18n'
import { useTheme } from '../ui/theme-context'

export function messageClock(time?: number): string {
  if (time === undefined || !Number.isFinite(time) || time <= 0) return strings.messageActions.timeUnavailable
  return new Date(time).toLocaleTimeString(strings.time.locale, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Mutating icons only change after the official Host write has been read back. */
export function MessageActions({ item }: { item: ChatMessage }) {
  const { colors } = useTheme()
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const busy = useAppStore(state => state.busyAction !== undefined)
  const backend = useAppStore(state => state.selectedSession?.backend)
  const rate = useAppStore(state => state.rateMessage)
  const fork = useAppStore(state => state.forkChatMessage)
  const [copied, setCopied] = useState(false)
  const disabled = !connected || busy || item.streaming === true
  const report = () => Alert.alert(strings.messageActions.failed, useAppStore.getState().error ?? strings.messageActions.unavailable)
  const rateReply = async (rating: 'positive' | 'negative') => {
    if (backend === 'codex' || item.nativeSeq === undefined) { Alert.alert(strings.messageActions.unavailable); return }
    if (!await rate(item, rating)) report()
    else AccessibilityInfo.announceForAccessibility(strings.messageActions.feedbackSaved)
  }
  const branch = async () => {
    if (backend === 'codex' || item.nativeSeq === undefined) { Alert.alert(strings.messageActions.unavailable); return }
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
    Alert.alert(strings.messageActions.usage, rows.map(([label, value]) => `${label}: ${value ?? strings.messageActions.usageUnavailable}`).join('\n'))
  }
  return <View style={styles.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={copied ? strings.messageActions.copied : strings.messageActions.copy} disabled={item.text.length === 0} style={styles.icon} onPress={() => {
      void Clipboard.setStringAsync(item.text).then(() => { setCopied(true); AccessibilityInfo.announceForAccessibility(strings.messageActions.copied) }).catch(report)
    }}><Copy size={16} color={copied ? colors.primary : colors.muted} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={strings.messageActions.good} accessibilityState={{ selected: item.feedback === 'positive', disabled }} disabled={disabled} style={styles.icon} onPress={() => void rateReply('positive')}><ThumbsUp size={16} color={item.feedback === 'positive' ? colors.primary : colors.muted} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={strings.messageActions.bad} accessibilityState={{ selected: item.feedback === 'negative', disabled }} disabled={disabled} style={styles.icon} onPress={() => void rateReply('negative')}><ThumbsDown size={16} color={item.feedback === 'negative' ? colors.primary : colors.muted} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={strings.messageActions.branch} accessibilityState={{ disabled }} disabled={disabled} style={styles.icon} onPress={() => void branch()}><GitBranch size={16} color={colors.muted} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={strings.messageActions.usage} style={styles.usage} onPress={showUsage}><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>{item.usage?.totalTokens === undefined ? strings.messageActions.usageUnavailable : `${item.usage.totalTokens.toLocaleString()} tokens`}</Text></Pressable>
    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, flexShrink: 1 }}>{messageClock(item.nativeTime)}</Text>
  </View>
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  icon: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  usage: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
})
