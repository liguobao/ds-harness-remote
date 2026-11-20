import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  Activity,
  AlertCircle,
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  HelpCircle,
  Inbox,
  ShieldAlert,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AttentionDigest, AttentionItem, AttentionStatus } from '@dsh-remote/protocol'
import { strings } from '../locales/i18n'
import {
  selectAttentionCounts,
  selectAttentionGroups,
  useAttentionStore,
} from '../state/attention-store'
import { useAppStore } from '../state/store'
import type { RemoteDevice } from '../types'
import { IconButton } from '../ui/components'
import { useResponsiveLayout } from '../ui/responsive'
import { SheetModal } from '../ui/sheet'
import { radius, spacing, type, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export interface AttentionInboxSheetProps {
  visible: boolean
  onClose: () => void
  onSelectItem: (item: AttentionItem) => void
}

export function formatBackendLabel(item: Pick<AttentionItem, 'backend' | 'acpAdapter'>): string {
  if (item.backend === 'ds-bot') return 'DS-Bot'
  if (item.backend === 'codex') return 'Codex'
  if (item.backend === 'harness') return 'Harness'
  const adapter = (item.acpAdapter ?? 'acp').trim().toLowerCase()
  switch (adapter) {
    case 'antigravity': return 'AGY'
    case 'claude': return 'Claude'
    case 'cursor': return 'Cursor'
    case 'opencode': return 'OpenCode'
    case 'pi': return 'Pi'
    case 'hermes': return 'Hermes'
    default: return adapter.length > 0 ? adapter.slice(0, 12) : 'ACP'
  }
}

export function formatDetachedCountdown(expiresAt: number, now: number): string | undefined {
  const remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  if (remainingSec <= 0) return '0s'
  const mins = Math.floor(remainingSec / 60)
  const secs = remainingSec % 60
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60)
    const remMins = mins % 60
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`
  }
  if (mins > 0) return `${mins}m ${secs.toString().padStart(2, '0')}s`
  return `${secs}s`
}

export function attentionStatusVisual(
  status: AttentionStatus,
  colors: ThemeColors,
): {
  label: string
  fg: string
  bg: string
  Icon: typeof ShieldAlert
} {
  switch (status) {
    case 'waiting_approval':
      return {
        label: strings.attention.statusApproval,
        fg: colors.warning,
        bg: colors.warningSoft,
        Icon: ShieldAlert,
      }
    case 'waiting_question':
      return {
        label: strings.attention.statusQuestion,
        fg: colors.warning,
        bg: colors.warningSoft,
        Icon: HelpCircle,
      }
    case 'failed_unread':
      return {
        label: strings.attention.statusFailed,
        fg: colors.danger,
        bg: colors.dangerSoft,
        Icon: AlertCircle,
      }
    case 'completed_unread':
      return {
        label: strings.attention.statusCompleted,
        fg: colors.success,
        bg: colors.successSoft,
        Icon: CheckCircle2,
      }
    case 'running':
      return {
        label: strings.attention.statusRunning,
        fg: colors.primary,
        bg: colors.primarySoft,
        Icon: Activity,
      }
  }
}

export function AttentionInboxSheet({
  visible,
  onClose,
  onSelectItem,
}: AttentionInboxSheetProps) {
  useAppStore(state => state.language)
  const hostName = useAppStore(state => state.selectedDevice?.name)
  const items = useAttentionStore(state => state.items)
  const loading = useAttentionStore(state => state.loading)
  const ackAllUnread = useAttentionStore(state => state.ackAllUnread)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { sheetMaxHeight, sheetAsDialog } = useResponsiveLayout()
  const insets = useSafeAreaInsets()

  const groups = useMemo(() => selectAttentionGroups(items), [items])
  const counts = useMemo(() => selectAttentionCounts(items), [items])
  const hasUnread = counts.completedUnread + counts.failedUnread > 0
  const hasDetachedTimer = items.some(item => item.detachedExpiresAt !== undefined)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!visible || !hasDetachedTimer) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [visible, hasDetachedTimer])

  const sections = useMemo(
    () => [
      { key: 'attention', title: strings.attention.sectionAttention, data: groups.attention },
      { key: 'finished', title: strings.attention.sectionFinished, data: groups.finished },
      { key: 'running', title: strings.attention.sectionRunning, data: groups.running },
    ].filter(section => section.data.length > 0),
    [groups],
  )

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={styles.backdrop}
      sheetStyle={[
        styles.sheet,
        sheetAsDialog
          ? { paddingTop: spacing.lg, paddingBottom: spacing.lg }
          : { maxHeight: sheetMaxHeight, paddingBottom: spacing.xl + insets.bottom },
      ]}
    >
      {!sheetAsDialog && <View style={styles.grabber} />}
      <View style={styles.sheetHeader}>
        <View style={styles.titleColumn}>
          <Text style={styles.title} numberOfLines={1}>{strings.attention.title}</Text>
          {hostName ? <Text style={styles.subtitle} numberOfLines={1}>{hostName}</Text> : null}
        </View>
        <View style={styles.headerActions}>
          {hasUnread && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.attention.markAllRead}
              onPress={() => void ackAllUnread()}
              hitSlop={6}
              style={({ pressed }) => [styles.markReadBtn, pressed && styles.pressed]}
            >
              <CheckCheck size={14} color={colors.primary} strokeWidth={2.2} />
              <Text style={styles.markReadText} numberOfLines={1}>{strings.attention.markAllRead}</Text>
            </Pressable>
          )}
          <IconButton label={strings.common.close} icon={X} onPress={onClose} />
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Inbox size={24} color={colors.muted} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>{strings.attention.emptyTitle}</Text>
          <Text style={styles.emptyBody}>{strings.attention.emptyBody}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {sections.map(section => (
            <View key={section.key} style={styles.sectionBlock}>
              <Text style={styles.sectionHeader}>{section.title}</Text>
              <View style={styles.sectionCard}>
                {section.data.map((item, idx) => {
                  const visual = attentionStatusVisual(item.status, colors)
                  const StatusIcon = visual.Icon
                  const backendLabel = formatBackendLabel(item)
                  const countdown = item.detachedExpiresAt !== undefined
                    ? formatDetachedCountdown(item.detachedExpiresAt, now)
                    : undefined
                  const titleText = item.sessionTitle.trim().length > 0
                    ? item.sessionTitle.trim()
                    : strings.sessions.untitled
                  const a11yLabel = [
                    visual.label,
                    backendLabel,
                    titleText,
                    item.workspaceLabel,
                    countdown ? strings.attention.expiresIn(countdown) : undefined,
                  ].filter(Boolean).join(', ')

                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={a11yLabel}
                      onPress={() => onSelectItem(item)}
                      style={({ pressed }) => [
                        styles.row,
                        idx > 0 && styles.rowBorder,
                        pressed && styles.rowPressed,
                      ]}
                    >
                      <View style={styles.rowBody}>
                        <View style={styles.badgeRow}>
                          <View style={[styles.statusPill, { backgroundColor: visual.bg }]}>
                            <StatusIcon size={12} color={visual.fg} strokeWidth={2.2} />
                            <Text style={[styles.statusPillText, { color: visual.fg }]}>{visual.label}</Text>
                          </View>
                          <View style={styles.backendPill}>
                            <Text style={styles.backendPillText}>{backendLabel}</Text>
                          </View>
                          {countdown !== undefined && (
                            <View style={styles.countdownPill}>
                              <Clock size={11} color={colors.warning} strokeWidth={2.1} />
                              <Text style={styles.countdownText}>{strings.attention.expiresIn(countdown)}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.rowTitle} numberOfLines={1}>{titleText}</Text>
                        {item.workspaceLabel ? (
                          <Text style={styles.rowWorkspace} numberOfLines={1}>{item.workspaceLabel}</Text>
                        ) : null}
                        {item.summary ? (
                          <Text style={styles.rowSummary} numberOfLines={2}>{item.summary}</Text>
                        ) : null}
                      </View>
                      <ChevronRight size={16} color={colors.subtle} />
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SheetModal>
  )
}

/**
 * Compact header pill for ChatScreen and BotModeScreen showing urgent count
 * (highlighted amber when approvals/questions await, subtle neutral when running/unread,
 * quiet icon when 0) and opening the Attention Inbox sheet.
 */
export function AttentionHeaderPill({
  onPress,
}: {
  onPress: () => void
}) {
  useAppStore(state => state.language)
  const items = useAttentionStore(state => state.items)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const counts = useMemo(() => selectAttentionCounts(items), [items])

  const hasUrgent = counts.totalUrgent > 0
  const hasFailed = !hasUrgent && counts.failedUnread > 0
  const hasAny = counts.totalActive > 0
  const displayCount = hasUrgent
    ? counts.totalUrgent
    : hasFailed
      ? counts.failedUnread
      : counts.totalActive

  const tint = hasUrgent
    ? colors.warning
    : hasFailed
      ? colors.danger
      : hasAny
        ? colors.primary
        : colors.muted
  const background = hasUrgent
    ? colors.warningSoft
    : hasFailed
      ? colors.dangerSoft
      : hasAny
        ? colors.primarySoft
        : 'transparent'

  const Icon = hasUrgent ? ShieldAlert : Bell

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings.attention.pillA11y(counts.totalUrgent, counts.totalActive)}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.headerPill,
        hasAny && { backgroundColor: background },
        pressed && styles.pressed,
      ]}
    >
      <Icon size={16} color={tint} strokeWidth={2.1} />
      {hasAny && (
        <Text style={[styles.headerPillCount, { color: tint }]} numberOfLines={1}>
          {displayCount > 99 ? '99+' : displayCount}
        </Text>
      )}
    </Pressable>
  )
}

export function digestTotalCount(digest: AttentionDigest | undefined): number {
  if (!digest) return 0
  return digest.pendingApprovals
    + digest.pendingQuestions
    + digest.runningSessions
    + digest.completedUnread
}

export function formatDigestSegments(digest: AttentionDigest): Array<{
  key: string
  label: string
  urgent: boolean
}> {
  const segments: Array<{ key: string; label: string; urgent: boolean }> = []
  if (digest.pendingApprovals > 0) {
    segments.push({ key: 'approvals', label: strings.attention.approvalsCount(digest.pendingApprovals), urgent: true })
  }
  if (digest.pendingQuestions > 0) {
    segments.push({ key: 'questions', label: strings.attention.questionsCount(digest.pendingQuestions), urgent: true })
  }
  if (digest.runningSessions > 0) {
    segments.push({ key: 'running', label: strings.attention.runningCount(digest.runningSessions), urgent: false })
  }
  if (digest.completedUnread > 0) {
    segments.push({ key: 'completed', label: strings.attention.completedCount(digest.completedUnread), urgent: false })
  }
  return segments
}

/** Inline attention summary pills rendered under an online host row. */
export function HostDigestPills({ digest }: { digest?: AttentionDigest }) {
  const styles = useThemedStyles(createStyles)
  if (!digest || digestTotalCount(digest) === 0) return null
  const segments = formatDigestSegments(digest)
  const hasUrgent = digest.pendingApprovals + digest.pendingQuestions > 0
  return (
    <View style={styles.inlineDigestRow}>
      <Text
        numberOfLines={1}
        style={[styles.inlineDigestText, hasUrgent && styles.inlineDigestTextUrgent]}
      >
        {segments.map(seg => seg.label).join(' · ')}
      </Text>
    </View>
  )
}

/**
 * Cross-host summary banner shown above host lists when any online host
 * advertises pending approvals, questions, running tasks, or unread completions
 * in its Presence `attentionDigest`.
 */
export function CrossHostAttentionBanner({
  devices,
  onSelectHost,
}: {
  devices: readonly RemoteDevice[]
  onSelectHost: (device: RemoteDevice, token?: string) => void
}) {
  useAppStore(state => state.language)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  const activeHosts = useMemo(() => {
    return devices
      .filter(device => device.online && device.trusted && digestTotalCount(device.attentionDigest) > 0)
      .sort((a, b) => {
        const aUrgent = (a.attentionDigest?.pendingApprovals ?? 0) + (a.attentionDigest?.pendingQuestions ?? 0)
        const bUrgent = (b.attentionDigest?.pendingApprovals ?? 0) + (b.attentionDigest?.pendingQuestions ?? 0)
        if (aUrgent !== bUrgent) return bUrgent - aUrgent
        return (b.attentionDigest?.updatedAt ?? 0) - (a.attentionDigest?.updatedAt ?? 0)
      })
  }, [devices])

  if (activeHosts.length === 0) return null

  const anyUrgent = activeHosts.some(
    d => (d.attentionDigest?.pendingApprovals ?? 0) + (d.attentionDigest?.pendingQuestions ?? 0) > 0,
  )

  return (
    <View style={[styles.bannerCard, anyUrgent && styles.bannerCardUrgent]}>
      <View style={styles.bannerHeader}>
        {anyUrgent
          ? <ShieldAlert size={15} color={colors.warning} strokeWidth={2.2} />
          : <Bell size={15} color={colors.primary} strokeWidth={2.1} />}
        <Text style={[styles.bannerTitle, anyUrgent && { color: colors.warning }]}>
          {strings.attention.crossHostTitle}
        </Text>
      </View>
      {activeHosts.map((device, index) => {
        const digest = device.attentionDigest!
        const segments = formatDigestSegments(digest)
        const urgent = digest.pendingApprovals + digest.pendingQuestions > 0
        const summary = segments.map(seg => seg.label).join(' · ')
        return (
          <Pressable
            key={device.deviceId}
            accessibilityRole="button"
            accessibilityLabel={`${device.name}, ${summary}`}
            onPress={() => onSelectHost(device, digest.attentionToken)}
            style={({ pressed }) => [
              styles.bannerRow,
              index > 0 && styles.bannerRowBorder,
              pressed && styles.rowPressed,
            ]}
          >
            <View style={styles.bannerRowText}>
              <Text style={styles.bannerHostName} numberOfLines={1}>{device.name}</Text>
              <Text
                style={[styles.bannerSummary, urgent && styles.inlineDigestTextUrgent]}
                numberOfLines={1}
              >
                {summary}
              </Text>
            </View>
            <ChevronRight size={15} color={urgent ? colors.warning : colors.muted} />
          </Pressable>
        )
      })}
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
    sheet: {
      zIndex: 1,
      elevation: 1,
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      paddingHorizontal: 0,
      paddingTop: spacing.sm,
      gap: spacing.sm,
    },
    grabber: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.subtle,
      opacity: 0.45,
      alignSelf: 'center',
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
    },
    titleColumn: { flex: 1, minWidth: 0 },
    title: { ...type.heading, fontSize: 18, fontWeight: '700', color: colors.ink },
    subtitle: { ...type.caption, color: colors.muted, marginTop: 1 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    markReadBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySoft,
    },
    markReadText: { ...type.caption, color: colors.primary, fontWeight: '600' },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      gap: spacing.md,
    },
    sectionBlock: { gap: spacing.xs },
    sectionHeader: {
      ...type.caption,
      color: colors.muted,
      fontWeight: '600',
      paddingHorizontal: spacing.xs,
    },
    sectionCard: {
      backgroundColor: colors.grouped,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    rowPressed: { backgroundColor: colors.surfaceStrong },
    rowBody: { flex: 1, minWidth: 0, gap: 4 },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radius.pill,
    },
    statusPillText: {
      ...type.caption,
      fontSize: 11,
      fontWeight: '600',
    },
    backendPill: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    backendPillText: {
      ...type.caption,
      fontSize: 11,
      color: colors.muted,
    },
    countdownPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: colors.warningSoft,
    },
    countdownText: {
      ...type.caption,
      fontSize: 11,
      color: colors.warning,
      fontVariant: ['tabular-nums'],
    },
    rowTitle: { ...type.bodyStrong, fontSize: 15, color: colors.ink },
    rowWorkspace: { ...type.caption, color: colors.muted },
    rowSummary: { ...type.small, fontSize: 13, color: colors.muted },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xxl,
      paddingHorizontal: spacing.xl,
      gap: spacing.xs,
    },
    emptyIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.surfaceStrong,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xs,
    },
    emptyTitle: { ...type.bodyStrong, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.small, color: colors.muted, textAlign: 'center' },
    headerPill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minHeight: 32,
      minWidth: 32,
      paddingHorizontal: 8,
      borderRadius: radius.pill,
    },
    headerPillCount: {
      ...type.caption,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    pressed: { opacity: 0.72 },
    inlineDigestRow: { marginTop: 2 },
    inlineDigestText: { ...type.caption, color: colors.primary, fontWeight: '600' },
    inlineDigestTextUrgent: { color: colors.warning },
    bannerCard: {
      backgroundColor: colors.grouped,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: spacing.sm,
    },
    bannerCardUrgent: {
      borderColor: colors.warning,
      backgroundColor: colors.warningSoft,
    },
    bannerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    bannerTitle: {
      ...type.caption,
      fontWeight: '700',
      color: colors.primary,
    },
    bannerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      gap: spacing.sm,
    },
    bannerRowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    bannerRowText: { flex: 1, minWidth: 0, gap: 2 },
    bannerHostName: { ...type.smallStrong, color: colors.ink },
    bannerSummary: { ...type.caption, color: colors.muted, fontWeight: '600' },
  })
}
