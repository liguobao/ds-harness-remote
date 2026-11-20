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
import type { AttentionItem, AttentionStatus } from '@dsh-remote/protocol'
import { strings } from '../locales/i18n'
import {
  selectAttentionCounts,
  selectAttentionGroups,
  useAttentionStore,
} from '../state/attention-store'
import { useAppStore } from '../state/store'
import { IconButton } from '../ui/components'
import { useResponsiveLayout } from '../ui/responsive'
import { SheetModal } from '../ui/sheet'
import { radius, spacing, type, type ColorScheme, type ThemeColors } from '../ui/theme'
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

export interface AttentionToneTokens {
  fg: string
  bg: string
  border: string
  dot: string
}

export interface AttentionSurfacePalette {
  approval: AttentionToneTokens
  question: AttentionToneTokens
  running: AttentionToneTokens
  completed: AttentionToneTokens
  failed: AttentionToneTokens
}

/** Light/dark status tokens for Attention Inbox pills, banners, and drawer badges. */
export function attentionSurfacePalette(
  colors: ThemeColors,
  scheme: ColorScheme = 'light',
): AttentionSurfacePalette {
  if (scheme === 'dark') {
    return {
      approval: {
        fg: '#F5C45E',
        bg: 'rgba(255, 255, 255, 0.055)',
        border: 'rgba(245, 196, 94, 0.28)',
        dot: '#F5B942',
      },
      question: {
        fg: '#67C6F5',
        bg: 'rgba(255, 255, 255, 0.055)',
        border: 'rgba(103, 198, 245, 0.28)',
        dot: '#4BB8F0',
      },
      running: {
        fg: colors.primary,
        bg: 'rgba(255, 255, 255, 0.055)',
        border: 'rgba(111, 137, 255, 0.28)',
        dot: colors.primary,
      },
      completed: {
        fg: '#52D18C',
        bg: 'rgba(255, 255, 255, 0.055)',
        border: 'rgba(82, 209, 140, 0.26)',
        dot: '#4CC07D',
      },
      failed: {
        fg: '#F47B74',
        bg: 'rgba(255, 255, 255, 0.055)',
        border: 'rgba(244, 123, 116, 0.28)',
        dot: '#F2736C',
      },
    }
  }
  return {
    approval: {
      fg: '#A16207',
      bg: '#FFF8EB',
      border: '#F2DDA8',
      dot: '#D97706',
    },
    question: {
      fg: '#0369A1',
      bg: '#F0F9FF',
      border: '#BAE6FD',
      dot: '#0284C7',
    },
    running: {
      fg: colors.primary,
      bg: colors.primarySoft,
      border: '#D4DFFF',
      dot: colors.primary,
    },
    completed: {
      fg: '#15803D',
      bg: '#ECFDF3',
      border: '#BBEAD0',
      dot: '#1E8449',
    },
    failed: {
      fg: '#B91C1C',
      bg: '#FEF2F2',
      border: '#F9CBC8',
      dot: '#C2362F',
    },
  }
}

export function attentionStatusVisual(
  status: AttentionStatus,
  colors: ThemeColors,
  scheme: ColorScheme = 'light',
): {
  label: string
  fg: string
  bg: string
  border: string
  dot: string
  Icon: typeof ShieldAlert
} {
  const palette = attentionSurfacePalette(colors, scheme)
  switch (status) {
    case 'waiting_approval':
      return {
        label: strings.attention.statusApproval,
        ...palette.approval,
        Icon: ShieldAlert,
      }
    case 'waiting_question':
      return {
        label: strings.attention.statusQuestion,
        ...palette.question,
        Icon: HelpCircle,
      }
    case 'failed_unread':
      return {
        label: strings.attention.statusFailed,
        ...palette.failed,
        Icon: AlertCircle,
      }
    case 'completed_unread':
      return {
        label: strings.attention.statusCompleted,
        ...palette.completed,
        Icon: CheckCircle2,
      }
    case 'running':
      return {
        label: strings.attention.statusRunning,
        ...palette.running,
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
  const { colors, scheme } = useTheme()
  const palette = useMemo(() => attentionSurfacePalette(colors, scheme), [colors, scheme])
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
              <CheckCheck size={14} color={colors.muted} strokeWidth={2.1} />
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
                  const visual = attentionStatusVisual(item.status, colors, scheme)
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
                          <View
                            style={[
                              styles.statusPill,
                              { backgroundColor: visual.bg, borderColor: visual.border },
                            ]}
                          >
                            <StatusIcon size={12} color={visual.fg} strokeWidth={2.1} />
                            <Text style={[styles.statusPillText, { color: visual.fg }]}>{visual.label}</Text>
                          </View>
                          <Text style={styles.backendText} numberOfLines={1}>{backendLabel}</Text>
                          {countdown !== undefined && (
                            <View
                              style={[
                                styles.countdownPill,
                                { backgroundColor: palette.approval.bg, borderColor: palette.approval.border },
                              ]}
                            >
                              <Clock size={11} color={palette.approval.fg} strokeWidth={2.0} />
                              <Text style={[styles.countdownText, { color: palette.approval.fg }]}>
                                {strings.attention.expiresIn(countdown)}
                              </Text>
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
 * Compact pill placed in the HostSessionsDrawer footer to the left of Settings,
 * showing urgent/active count and opening the Attention Inbox sheet.
 */
export function AttentionHeaderPill({
  onPress,
}: {
  onPress: () => void
}) {
  useAppStore(state => state.language)
  const items = useAttentionStore(state => state.items)
  const { colors, scheme } = useTheme()
  const palette = useMemo(() => attentionSurfacePalette(colors, scheme), [colors, scheme])
  const styles = useThemedStyles(createStyles)
  const counts = useMemo(() => selectAttentionCounts(items), [items])

  const hasApproval = counts.pendingApprovals > 0
  const hasQuestion = counts.pendingQuestions > 0
  const hasUrgent = counts.totalUrgent > 0
  const hasFailed = !hasUrgent && counts.failedUnread > 0
  const hasAny = counts.totalActive > 0
  const displayCount = hasUrgent
    ? counts.totalUrgent
    : hasFailed
      ? counts.failedUnread
      : counts.totalActive

  const iconTint = hasApproval
    ? palette.approval.fg
    : hasQuestion
      ? palette.question.fg
      : hasFailed
        ? palette.failed.fg
        : hasAny
          ? palette.running.fg
          : colors.muted
  const borderTint = hasApproval
    ? palette.approval.border
    : hasQuestion
      ? palette.question.border
      : hasFailed
        ? palette.failed.border
        : colors.border

  const Icon = hasApproval ? ShieldAlert : hasQuestion ? HelpCircle : Bell

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings.attention.pillA11y(counts.totalUrgent, counts.totalActive)}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.headerPill,
        hasAny && [
          styles.headerPillActive,
          { backgroundColor: colors.elevated, borderColor: borderTint },
        ],
        pressed && styles.pressed,
      ]}
    >
      <Icon size={15} color={iconTint} strokeWidth={2.1} />
      {hasAny && (
        <Text style={[styles.headerPillCount, { color: colors.ink }]} numberOfLines={1}>
          {displayCount > 99 ? '99+' : displayCount}
        </Text>
      )}
    </Pressable>
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
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    markReadText: { ...type.caption, color: colors.ink, fontWeight: '600' },
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
      paddingHorizontal: 8,
      paddingVertical: 2.5,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
    },
    statusPillText: {
      ...type.caption,
      fontSize: 11,
      fontWeight: '600',
    },
    backendText: {
      ...type.caption,
      fontSize: 11,
      color: colors.subtle,
      fontWeight: '500',
    },
    countdownPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
    },
    countdownText: {
      ...type.caption,
      fontSize: 11,
      fontWeight: '600',
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
      flexShrink: 0,
      gap: 5,
      minHeight: 32,
      minWidth: 32,
      paddingHorizontal: 9,
      borderRadius: radius.pill,
    },
    headerPillActive: {
      borderWidth: StyleSheet.hairlineWidth,
    },
    headerPillCount: {
      ...type.caption,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    pressed: { opacity: 0.72 },
  })
}
