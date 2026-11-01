import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Alert, Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { ChatItemBase, ChatMessage, RemoteSession } from '../types'
import { useAppStore } from '../state/store'
import { strings } from '../locales/i18n'
import { useTheme } from '../ui/theme-context'
import { formatTokens } from '../ui/quote-helpers'
import {
  IconBranchOutline,
  IconCheckOutline,
  IconCopyOutline,
  IconDatabaseOutline,
} from '../ui/dsh-icons'

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

/**
 * Official DeepSeek Harness TurnUsagePanel popover modal dialog.
 * 1:1 match with DeepSeek Harness desktop TurnUsagePanel.tsx.
 */
export function TurnUsageModal({
  visible,
  onClose,
  item,
  session,
}: {
  visible: boolean
  onClose: () => void
  item: ChatMessage
  session?: RemoteSession
}) {
  const { colors } = useTheme()
  const u = item.usage
  if (!u) return null

  const totalTokens = u.totalTokens ?? 0
  const inputTokens = u.inputTokens ?? 0
  const cacheReadTokens = u.cacheReadTokens ?? 0
  const cacheWriteTokens = u.cacheWriteTokens ?? 0
  const outputTokens = u.outputTokens ?? 0
  const reasoningTokens = u.reasoningTokens ?? 0
  const uncachedInput = Math.max(0, inputTokens - cacheReadTokens)
  const sessionModels = useAppStore.getState().sessionModels
  const currentModelStr = sessionModels?.current
    ? `${sessionModels.current.provider ? `${sessionModels.current.provider}/` : ''}${sessionModels.current.model}`
    : undefined
  const modelName = (item as unknown as { model?: string }).model
    ?? (u as unknown as { model?: string }).model
    ?? (session as unknown as { model?: string })?.model
    ?? (session?.backend ? `dsh/${session.backend}` : undefined)
    ?? currentModelStr
    ?? 'deepseek-v4.1-flash'

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={[styles.usageCard, { backgroundColor: colors.surface, borderColor: colors.border }]} onStartShouldSetResponder={() => true}>
          {/* Header row */}
          <View style={styles.usageTitleRow}>
            <View style={styles.usageTitleLeft}>
              <IconDatabaseOutline size={15} color={colors.ink} />
              <Text style={[styles.usageTitleText, { color: colors.ink }]}>{strings.messageActions.turnUsageTitle ?? '本轮用量'}</Text>
            </View>
            <Text style={[styles.usageTotalText, { color: colors.ink }]}>
              {totalTokens.toLocaleString()} tok
            </Text>
          </View>

          {/* Divider */}
          <View style={[styles.usageDivider, { backgroundColor: colors.separator }]} />

          {/* Details */}
          <View style={styles.usageGrid}>
            {modelName !== undefined && (
              <View style={styles.usageRow}>
                <Text style={[styles.usageLabel, { color: colors.muted }]}>{strings.messageActions.providerModel ?? '提供方 / 模型'}</Text>
                <Text style={[styles.usageValue, { color: colors.ink }]} numberOfLines={1}>
                  {modelName}
                </Text>
              </View>
            )}
            <View style={styles.usageRow}>
              <Text style={[styles.usageLabel, { color: colors.muted }]}>{strings.messageActions.uncachedInput ?? '未缓存输入'}</Text>
              <Text style={[styles.usageValue, { color: colors.ink }]}>
                {uncachedInput.toLocaleString()} tok
              </Text>
            </View>
            {cacheReadTokens > 0 && (
              <View style={styles.usageRow}>
                <Text style={[styles.usageLabel, { color: colors.muted }]}>{strings.messageActions.cacheRead ?? '缓存读取'}</Text>
                <Text style={[styles.usageValue, { color: colors.ink }]}>
                  {cacheReadTokens.toLocaleString()} tok
                </Text>
              </View>
            )}
            {cacheWriteTokens > 0 && (
              <View style={styles.usageRow}>
                <Text style={[styles.usageLabel, { color: colors.muted }]}>{strings.messageActions.cacheWrite ?? '缓存写入'}</Text>
                <Text style={[styles.usageValue, { color: colors.ink }]}>
                  {cacheWriteTokens.toLocaleString()} tok
                </Text>
              </View>
            )}
            <View style={styles.usageRow}>
              <Text style={[styles.usageLabel, { color: colors.muted }]}>{strings.messageActions.output ?? '输出'}</Text>
              <Text style={[styles.usageValue, { color: colors.ink }]}>
                {outputTokens.toLocaleString()} tok
              </Text>
            </View>
            {reasoningTokens > 0 && (
              <View style={styles.usageRow}>
                <Text style={[styles.usageLabel, { color: colors.muted }]}>{strings.messageActions.reasoning ?? '推理'}</Text>
                <Text style={[styles.usageValue, { color: colors.ink }]}>
                  {reasoningTokens.toLocaleString()} tok
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Modal>
  )
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
  const [usageOpen, setUsageOpen] = useState(false)
  const copyOpacity = useRef(new Animated.Value(1)).current
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const disabled = !connected || busy || item.streaming === true
  const report = () => Alert.alert(strings.messageActions.failed, useAppStore.getState().error ?? strings.messageActions.unavailable)

  const handleCopy = () => {
    if (item.text.length === 0) return
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    Clipboard.setStringAsync(item.text)
      .then(() => {
        Animated.sequence([
          Animated.timing(copyOpacity, { toValue: 0.3, duration: 80, useNativeDriver: true }),
          Animated.timing(copyOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        ]).start()
        setCopied(true)
        AccessibilityInfo.announceForAccessibility(strings.messageActions.copied)
        copyTimeoutRef.current = setTimeout(() => {
          Animated.sequence([
            Animated.timing(copyOpacity, { toValue: 0.3, duration: 80, useNativeDriver: true }),
            Animated.timing(copyOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
          ]).start()
          setCopied(false)
          copyTimeoutRef.current = null
        }, 1800)
      })
      .catch(report)
  }

  const branch = async () => {
    if (!supportsBranch) return
    Alert.alert(strings.messageActions.branch, undefined, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: strings.messageActions.branch, onPress: () => { void fork(item).then(ok => { if (!ok) report() }) } },
    ])
  }

  const user = item.role === 'user'

  if (user) {
    return (
      <View style={[styles.row, styles.userRow]}>
        {time !== undefined && <Text style={{ color: colors.muted, fontSize: 12 }}>{messageClock(time)}</Text>}
        <Animated.View style={{ opacity: copyOpacity }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? strings.messageActions.copied : strings.messageActions.copy}
            disabled={item.text.length === 0}
            hitSlop={8}
            style={styles.actionBtn}
            onPress={handleCopy}
          >
            {copied ? (
              <IconCheckOutline size={14} color={colors.primary} />
            ) : (
              <IconCopyOutline size={14} color={colors.muted} />
            )}
          </Pressable>
        </Animated.View>
      </View>
    )
  }

  const totalTokens = item.usage?.totalTokens
  const usageLabel = totalTokens !== undefined ? `${strings.messageActions.usage} ${formatTokens(totalTokens)} tok` : strings.messageActions.usage

  return (
    <>
      <View style={styles.assistantRow}>
        <Animated.View style={{ opacity: copyOpacity }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? strings.messageActions.copied : strings.messageActions.copy}
            disabled={item.text.length === 0}
            hitSlop={8}
            style={styles.actionBtn}
            onPress={handleCopy}
          >
            {copied ? (
              <IconCheckOutline size={14} color={colors.primary} />
            ) : (
              <IconCopyOutline size={14} color={colors.muted} />
            )}
          </Pressable>
        </Animated.View>
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
            <IconBranchOutline size={14} color={colors.muted} />
          </Pressable>
        )}
        {!pending && backend !== 'codex' && item.usage !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.messageActions.usage}
            hitSlop={8}
            style={styles.usageBtn}
            onPress={() => setUsageOpen(true)}
          >
            <IconDatabaseOutline size={14} color={colors.muted} />
            <Text numberOfLines={1} style={[styles.usageText, { color: colors.muted }]}>
              {usageLabel}
            </Text>
          </Pressable>
        )}
        {time !== undefined && (
          <Text style={[styles.timeText, { color: colors.muted }]}>
            {messageClock(time)}
          </Text>
        )}
      </View>

      {item.usage !== undefined && (
        <TurnUsageModal
          visible={usageOpen}
          onClose={() => setUsageOpen(false)}
          item={item}
          session={session}
        />
      )}
    </>
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
  timeText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginLeft: -4,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  usageCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  usageTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  usageTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  usageTitleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  usageTotalText: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  usageDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  usageGrid: {
    gap: 8,
  },
  usageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  usageLabel: {
    fontSize: 12,
  },
  usageValue: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    flexShrink: 1,
  },
})
