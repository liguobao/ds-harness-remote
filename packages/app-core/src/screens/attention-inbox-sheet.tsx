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
  ArrowRightLeft,
  Bell,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  HelpCircle,
  Inbox,
  ShieldAlert,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AttentionItem, AttentionStatus } from '@dsh-remote/protocol'
import {
  filterAttentionItemsByBackend,
  resolveAttentionBackendIdentity,
  selectAttentionBackendFilters,
} from '../lib/attention-backend'
import { strings } from '../locales/i18n'
import {
  resolveHostAttentionOverview,
  selectAttentionGroups,
  selectCrossHostAttentionCounts,
  useAttentionStore,
  type HostAttentionOverview,
} from '../state/attention-store'
import { useAppStore } from '../state/store'
import type { RemoteDevice } from '../types'
import { IconButton } from '../ui/components'
import { androidRipple, continuousRadius, elevationStyle } from '../ui/platform-style'
import { DIALOG_SHEET_MAX_WIDTH, useResponsiveLayout } from '../ui/responsive'
import { SheetModal } from '../ui/sheet'
import { radius, spacing, type, type ColorScheme, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export interface AttentionInboxSheetProps {
  visible: boolean
  onClose: () => void
  onSelectItem: (item: AttentionItem) => void
  onSwitchHost?: (device: RemoteDevice, targetItem?: AttentionItem) => void
  onOpenRemoteHosts?: () => void
}

export function formatBackendLabel(item: Pick<AttentionItem, 'backend' | 'acpAdapter'>): string {
  return resolveAttentionBackendIdentity(item).label
}

export function formatDetachedCountdown(expiresAt: number, now: number): string | undefined {
  const remainingSec = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  if (remainingSec <= 0) return '0s'
  if (remainingSec < 60) return `${remainingSec}s`
  const mins = Math.ceil(remainingSec / 60)
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60)
    const remMins = mins % 60
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`
  }
  return `${mins}m`
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

function hostToneFromOverview(
  overview: HostAttentionOverview,
  online: boolean,
  colors: ThemeColors,
  palette: AttentionSurfacePalette,
): { dotColor: string; pillBg: string; pillBorder: string; pillText: string } {
  if (overview.pendingApprovals > 0) {
    return {
      dotColor: palette.approval.dot,
      pillBg: palette.approval.bg,
      pillBorder: palette.approval.border,
      pillText: palette.approval.fg,
    }
  }
  if (overview.pendingQuestions > 0) {
    return {
      dotColor: palette.question.dot,
      pillBg: palette.question.bg,
      pillBorder: palette.question.border,
      pillText: palette.question.fg,
    }
  }
  if (overview.hasFailedSignal || overview.failedUnread > 0) {
    return {
      dotColor: palette.failed.dot,
      pillBg: palette.failed.bg,
      pillBorder: palette.failed.border,
      pillText: palette.failed.fg,
    }
  }
  if (overview.runningSessions > 0) {
    return {
      dotColor: palette.running.dot,
      pillBg: palette.running.bg,
      pillBorder: palette.running.border,
      pillText: palette.running.fg,
    }
  }
  if (overview.completedUnread > 0) {
    return {
      dotColor: palette.completed.dot,
      pillBg: palette.completed.bg,
      pillBorder: palette.completed.border,
      pillText: palette.completed.fg,
    }
  }
  return {
    dotColor: online ? colors.success : colors.subtle,
    pillBg: colors.surfaceStrong,
    pillBorder: colors.border,
    pillText: colors.muted,
  }
}

export function AttentionInboxSheet({
  visible,
  onClose,
  onSelectItem,
  onSwitchHost,
  onOpenRemoteHosts,
}: AttentionInboxSheetProps) {
  useAppStore(state => state.language)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connectionPhase = useAppStore(state => state.connection.phase)
  const refreshDevices = useAppStore(state => state.refreshDevices)
  const items = useAttentionStore(state => state.items)
  const loading = useAttentionStore(state => state.loading)
  const cachedByHost = useAttentionStore(state => state.cachedByHost)
  const ackAllUnread = useAttentionStore(state => state.ackAllUnread)
  const { colors, scheme } = useTheme()
  const palette = useMemo(() => attentionSurfacePalette(colors, scheme), [colors, scheme])
  const styles = useThemedStyles(createStyles)
  const { width, sheetMaxHeight, sheetAsDialog } = useResponsiveLayout()
  const insets = useSafeAreaInsets()

  const connectedHostId = connectionPhase === 'connected' ? selectedDevice?.deviceId : undefined

  const hostEntries = useMemo(() => {
    const candidateDevices = devices.length > 0
      ? devices
      : selectedDevice !== undefined
        ? [selectedDevice]
        : []
    const seen = new Set<string>()
    const entries: Array<{ device: RemoteDevice; overview: HostAttentionOverview }> = []
    for (const device of candidateDevices) {
      if (seen.has(device.deviceId)) continue
      seen.add(device.deviceId)
      const overview = resolveHostAttentionOverview({
        device,
        connectedHostId,
        activeItems: items,
        cachedSnapshot: cachedByHost[device.deviceId],
      })
      entries.push({ device, overview })
    }
    return entries.sort((left, right) => {
      if (left.overview.isConnectedHost !== right.overview.isConnectedHost) {
        return left.overview.isConnectedHost ? -1 : 1
      }
      if ((left.overview.totalUrgent > 0) !== (right.overview.totalUrgent > 0)) {
        return left.overview.totalUrgent > 0 ? -1 : 1
      }
      if (left.device.online !== right.device.online) {
        return left.device.online ? -1 : 1
      }
      if (left.overview.totalActive !== right.overview.totalActive) {
        return right.overview.totalActive - left.overview.totalActive
      }
      return left.device.name.localeCompare(right.device.name)
    })
  }, [devices, selectedDevice, connectedHostId, items, cachedByHost])

  const defaultHostId = connectedHostId ?? selectedDevice?.deviceId ?? hostEntries[0]?.device.deviceId
  const [inspectedHostId, setInspectedHostId] = useState<string | undefined>(defaultHostId)
  const [backendFilter, setBackendFilter] = useState<string>('all')
  const [openDropdown, setOpenDropdown] = useState<'host' | 'backend' | null>(null)

  useEffect(() => {
    setOpenDropdown(null)
    if (!visible) return
    setInspectedHostId(connectedHostId ?? selectedDevice?.deviceId ?? hostEntries[0]?.device.deviceId)
    setBackendFilter('all')
    if (!useAppStore.getState().refreshing) {
      void refreshDevices()
    }
  }, [visible])

  const activeHostEntry = useMemo(
    () => hostEntries.find(entry => entry.device.deviceId === inspectedHostId) ?? hostEntries[0],
    [hostEntries, inspectedHostId],
  )
  const inspectedHost = activeHostEntry?.device
  const activeOverview = activeHostEntry?.overview
  const isConnectedHostView = activeOverview?.isConnectedHost === true

  const displayItems = useMemo(
    () => (activeOverview ? [...activeOverview.items] : isConnectedHostView || hostEntries.length === 0 ? items : []),
    [activeOverview, isConnectedHostView, hostEntries.length, items],
  )

  const backendFilters = useMemo(
    () => selectAttentionBackendFilters(displayItems),
    [displayItems],
  )

  useEffect(() => {
    if (backendFilter === 'all') return
    if (!backendFilters.some(option => option.key === backendFilter)) {
      setBackendFilter('all')
    }
  }, [backendFilter, backendFilters])

  useEffect(() => {
    if (openDropdown === 'host' && hostEntries.length === 0) {
      setOpenDropdown(null)
    } else if (openDropdown === 'backend' && backendFilters.length === 0) {
      setOpenDropdown(null)
    }
  }, [openDropdown, hostEntries.length, backendFilters.length])

  const selectedBackendOption = useMemo(
    () => (backendFilter === 'all' ? undefined : backendFilters.find(option => option.key === backendFilter)),
    [backendFilter, backendFilters],
  )
  const inspectedTone = useMemo(
    () => (activeOverview && inspectedHost
      ? hostToneFromOverview(activeOverview, inspectedHost.online, colors, palette)
      : undefined),
    [activeOverview, inspectedHost, colors, palette],
  )

  const filteredItems = useMemo(
    () => filterAttentionItemsByBackend(displayItems, backendFilter),
    [displayItems, backendFilter],
  )
  const groups = useMemo(() => selectAttentionGroups(filteredItems), [filteredItems])

  const hasUnread = isConnectedHostView && ((activeOverview?.completedUnread ?? 0) + (activeOverview?.failedUnread ?? 0) > 0)

  const sections = useMemo(
    () => [
      { key: 'attention', title: strings.attention.sectionAttention, data: groups.attention },
      { key: 'finished', title: strings.attention.sectionFinished, data: groups.finished },
      { key: 'running', title: strings.attention.sectionRunning, data: groups.running },
    ].filter(section => section.data.length > 0),
    [groups],
  )

  const canSwitchToInspected = Boolean(
    inspectedHost && !isConnectedHostView && inspectedHost.trusted && inspectedHost.online && onSwitchHost,
  )

  const digestBreakdown = useMemo(() => {
    if (!activeOverview || isConnectedHostView) return []
    const chips: Array<{ key: string; label: string; count: number; tone: AttentionToneTokens }> = []
    if (activeOverview.pendingApprovals > 0) {
      chips.push({ key: 'approval', label: strings.attention.statusApproval, count: activeOverview.pendingApprovals, tone: palette.approval })
    }
    if (activeOverview.pendingQuestions > 0) {
      chips.push({ key: 'question', label: strings.attention.statusQuestion, count: activeOverview.pendingQuestions, tone: palette.question })
    }
    if (activeOverview.runningSessions > 0) {
      chips.push({ key: 'running', label: strings.attention.statusRunning, count: activeOverview.runningSessions, tone: palette.running })
    }
    if (activeOverview.completedUnread > 0) {
      chips.push({
        key: 'completed',
        label: activeOverview.hasFailedSignal ? strings.attention.statusFailed : strings.attention.statusCompleted,
        count: activeOverview.completedUnread,
        tone: activeOverview.hasFailedSignal ? palette.failed : palette.completed,
      })
    }
    return chips
  }, [activeOverview, isConnectedHostView, palette])

  const remoteHintText = useMemo(() => {
    if (!activeOverview || !inspectedHost || isConnectedHostView) return ''
    if (!inspectedHost.trusted) return strings.attention.hostUntrusted
    if (!inspectedHost.online) return strings.attention.hostOffline
    if (activeOverview.freshness === 'digest-cleared') return strings.attention.hostSnapshotCleared
    if (activeOverview.freshness === 'digest-match' && activeOverview.items.length > 0) {
      return strings.attention.hostSnapshotRecent
    }
    if (activeOverview.freshness === 'digest-stale' && activeOverview.items.length > 0) {
      return strings.attention.hostSnapshotStale
    }
    return strings.attention.hostBlindHint
  }, [activeOverview, inspectedHost, isConnectedHostView])

  const steadySheetHeight = sheetAsDialog ? Math.min(sheetMaxHeight, 560) : sheetMaxHeight
  const sheetWidth = sheetAsDialog ? Math.min(width - spacing.xl, DIALOG_SHEET_MAX_WIDTH) : width
  const dropdownMaxWidth = Math.max(200, Math.min(316, sheetWidth - spacing.lg * 2))
  const dropdownMaxHeight = Math.max(160, Math.min(300, steadySheetHeight - 136))
  const inspectedTotal = activeOverview?.totalActive ?? 0
  const backendSelectorDisabled = backendFilters.length === 0
  const activeBackendLabel = selectedBackendOption?.label ?? strings.attention.filterAllPlatforms
  const activeBackendCount = selectedBackendOption?.count ?? displayItems.length

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      onRequestClose={() => {
        if (openDropdown !== null) {
          setOpenDropdown(null)
          return
        }
        onClose()
      }}
      backdropStyle={styles.backdrop}
      sheetStyle={[
        styles.sheet,
        sheetAsDialog
          ? { height: steadySheetHeight, maxHeight: sheetMaxHeight, paddingHorizontal: 0, paddingTop: spacing.lg, paddingBottom: spacing.lg }
          : {
              height: steadySheetHeight,
              maxHeight: sheetMaxHeight,
              paddingLeft: insets.left,
              paddingRight: insets.right,
              paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.sm),
            },
      ]}
    >
      <View style={styles.sheetHeader}>
        <View style={styles.titleColumn}>
          <Text style={styles.title} numberOfLines={1}>{strings.attention.title}</Text>
          {hostEntries.length === 0 && selectedDevice?.name ? (
            <Text style={styles.subtitle} numberOfLines={1}>{selectedDevice.name}</Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          {hasUnread && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.attention.markAllRead}
              onPress={() => {
                setOpenDropdown(null)
                void ackAllUnread()
              }}
              hitSlop={6}
              style={({ pressed }) => [styles.markReadBtn, pressed && styles.pressed]}
            >
              <CheckCheck size={14} color={colors.muted} strokeWidth={2.1} />
              <Text style={styles.markReadText} numberOfLines={1}>{strings.attention.markAllRead}</Text>
            </Pressable>
          )}
          <IconButton
            label={strings.common.close}
            icon={X}
            onPress={() => {
              setOpenDropdown(null)
              onClose()
            }}
          />
        </View>
      </View>

      {hostEntries.length > 0 && inspectedHost !== undefined && (
        <View style={styles.dropdownBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: openDropdown === 'host' }}
            accessibilityLabel={[
              inspectedHost.name,
              isConnectedHostView ? strings.attention.hostCurrent : undefined,
              inspectedTotal > 0 ? String(inspectedTotal) : undefined,
            ].filter(Boolean).join(', ')}
            onPress={() => setOpenDropdown(prev => (prev === 'host' ? null : 'host'))}
            style={({ pressed }) => [
              styles.dropdownTrigger,
              styles.dropdownTriggerHost,
              openDropdown === 'host' && styles.dropdownTriggerOpen,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.dropdownDot, { backgroundColor: inspectedTone?.dotColor ?? colors.muted }]} />
            <Text style={[styles.dropdownTriggerText, styles.dropdownTriggerTextActive]} numberOfLines={1}>
              {inspectedHost.name}
            </Text>
            {inspectedTotal > 0 && inspectedTone !== undefined && (
              <View
                style={[
                  styles.dropdownCountBadge,
                  { backgroundColor: inspectedTone.pillBg, borderColor: inspectedTone.pillBorder },
                ]}
              >
                <Text style={[styles.dropdownCountText, { color: inspectedTone.pillText }]}>
                  {inspectedTotal > 99 ? '99+' : inspectedTotal}
                </Text>
              </View>
            )}
            {openDropdown === 'host'
              ? <ChevronUp size={14} color={colors.ink} strokeWidth={2.2} />
              : <ChevronDown size={14} color={colors.muted} strokeWidth={2.1} />}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: openDropdown === 'backend', disabled: backendSelectorDisabled }}
            accessibilityLabel={
              activeBackendCount > 0
                ? `${strings.sessions.agentPlatform}, ${activeBackendLabel}, ${activeBackendCount}`
                : `${strings.sessions.agentPlatform}, ${activeBackendLabel}`
            }
            disabled={backendSelectorDisabled}
            onPress={() => setOpenDropdown(prev => (prev === 'backend' ? null : 'backend'))}
            style={({ pressed }) => [
              styles.dropdownTrigger,
              openDropdown === 'backend' && styles.dropdownTriggerOpen,
              backendSelectorDisabled && styles.dropdownTriggerDisabled,
              pressed && !backendSelectorDisabled && styles.pressed,
            ]}
          >
            {selectedBackendOption !== undefined ? (
              <BackendGlyphBadge
                accent={scheme === 'dark' ? selectedBackendOption.accentDark : selectedBackendOption.accentLight}
                shortBadge={selectedBackendOption.shortBadge}
                styles={styles}
              />
            ) : (
              <View style={styles.platformAllGlyph}>
                <Bot size={12.5} color={backendSelectorDisabled ? colors.muted : colors.ink} strokeWidth={2} />
              </View>
            )}
            <Text
              style={[
                styles.dropdownTriggerText,
                !backendSelectorDisabled && styles.dropdownTriggerTextActive,
              ]}
              numberOfLines={1}
            >
              {activeBackendLabel}
            </Text>
            {activeBackendCount > 0 && (
              <View style={styles.dropdownNeutralCountBadge}>
                <Text style={styles.dropdownNeutralCountText}>
                  {activeBackendCount > 99 ? '99+' : activeBackendCount}
                </Text>
              </View>
            )}
            {openDropdown === 'backend'
              ? <ChevronUp size={14} color={colors.ink} strokeWidth={2.2} />
              : <ChevronDown size={14} color={colors.muted} strokeWidth={2.1} />}
          </Pressable>
        </View>
      )}

      <View style={styles.bodyStage}>
        {isConnectedHostView && loading && displayItems.length === 0 ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : !isConnectedHostView && inspectedHost !== undefined ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hostBridgeCard}>
              <View style={styles.hostBridgeTop}>
                <View style={styles.hostBridgeMeta}>
                  <Text style={styles.hostBridgeName} numberOfLines={1}>{inspectedHost.name}</Text>
                  <Text style={styles.hostBridgeStatus} numberOfLines={1}>
                    {!inspectedHost.trusted
                      ? strings.attention.hostUntrusted
                      : inspectedHost.online
                        ? strings.attention.hostOnlineDigest
                        : strings.attention.hostOffline}
                  </Text>
                </View>
                {canSwitchToInspected && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.attention.hostSwitch}
                    onPress={() => onSwitchHost?.(inspectedHost)}
                    style={({ pressed }) => [styles.switchHostBtn, pressed && styles.pressed]}
                  >
                    <ArrowRightLeft size={13} color={colors.onInverse} strokeWidth={2.2} />
                    <Text style={styles.switchHostBtnText} numberOfLines={1}>
                      {strings.attention.hostSwitch}
                    </Text>
                  </Pressable>
                )}
                {!inspectedHost.trusted && onOpenRemoteHosts !== undefined && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.attention.hostManage}
                    onPress={onOpenRemoteHosts}
                    style={({ pressed }) => [styles.switchHostSecondaryBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.switchHostSecondaryText} numberOfLines={1}>
                      {strings.attention.hostManage}
                    </Text>
                  </Pressable>
                )}
              </View>

              {digestBreakdown.length > 0 && (
                <View style={styles.digestChipsRow}>
                  {digestBreakdown.map(chip => (
                    <View
                      key={chip.key}
                      style={[
                        styles.digestChip,
                        { backgroundColor: chip.tone.bg, borderColor: chip.tone.border },
                      ]}
                    >
                      <View style={[styles.digestChipDot, { backgroundColor: chip.tone.dot }]} />
                      <Text style={[styles.digestChipText, { color: chip.tone.fg }]}>
                        {`${chip.label} ${chip.count}`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.hostBridgeHint}>{remoteHintText}</Text>
            </View>

            {sections.map(section => (
              <View key={section.key} style={styles.sectionBlock}>
                <Text style={styles.sectionHeader}>{section.title}</Text>
                <View style={[styles.sectionCard, !canSwitchToInspected && styles.sectionCardMuted]}>
                  {section.data.map((item, idx) => (
                    <AttentionInboxItemRow
                      key={item.id}
                      item={item}
                      first={idx === 0}
                      disabled={!canSwitchToInspected}
                      onPress={() => onSwitchHost?.(inspectedHost, item)}
                      colors={colors}
                      scheme={scheme}
                      palette={palette}
                      styles={styles}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
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
                  {section.data.map((item, idx) => (
                    <AttentionInboxItemRow
                      key={item.id}
                      item={item}
                      first={idx === 0}
                      onPress={() => onSelectItem(item)}
                      colors={colors}
                      scheme={scheme}
                      palette={palette}
                      styles={styles}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {openDropdown !== null && (
          <View style={styles.dropdownOverlay} collapsable={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.common.close}
              onPress={() => setOpenDropdown(null)}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: scheme === 'dark' ? 'rgba(0, 0, 0, 0.36)' : 'rgba(15, 23, 42, 0.1)' },
              ]}
            />
            <View
              style={[
                styles.dropdownMenuCard,
                openDropdown === 'host' ? styles.dropdownMenuLeft : styles.dropdownMenuRight,
                { maxWidth: dropdownMaxWidth },
              ]}
            >
              <ScrollView
                style={{ maxHeight: dropdownMaxHeight }}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {openDropdown === 'host' ? (
                  hostEntries.map((entry, index) => {
                    const selected = entry.device.deviceId === inspectedHost?.deviceId
                    const tone = hostToneFromOverview(entry.overview, entry.device.online, colors, palette)
                    const total = entry.overview.totalActive
                    const statusDetail = entry.overview.isConnectedHost
                      ? undefined
                      : !entry.device.trusted
                        ? strings.attention.hostUntrusted
                        : !entry.device.online
                          ? strings.attention.hostOffline
                          : strings.attention.hostOnlineDigest
                    return (
                      <Pressable
                        key={entry.device.deviceId}
                        accessibilityRole="menuitem"
                        accessibilityState={{ selected }}
                        accessibilityLabel={[
                          entry.device.name,
                          entry.overview.isConnectedHost ? strings.attention.hostCurrent : statusDetail,
                          total > 0 ? String(total) : undefined,
                        ].filter(Boolean).join(', ')}
                        onPress={() => {
                          setInspectedHostId(entry.device.deviceId)
                          setBackendFilter('all')
                          setOpenDropdown(null)
                        }}
                        style={({ pressed }) => [
                          styles.dropdownOptionRow,
                          index > 0 && styles.dropdownOptionBorder,
                          selected && styles.dropdownOptionSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={[styles.dropdownMenuDot, { backgroundColor: tone.dotColor }]} />
                        <View style={styles.dropdownOptionTextCol}>
                          <View style={styles.dropdownOptionTitleRow}>
                            <Text
                              style={[styles.dropdownOptionTitle, selected && styles.dropdownOptionTitleSelected]}
                              numberOfLines={1}
                            >
                              {entry.device.name}
                            </Text>
                            {entry.overview.isConnectedHost && (
                              <View style={styles.dropdownCurrentBadge}>
                                <Text style={styles.dropdownCurrentBadgeText} numberOfLines={1}>
                                  {strings.attention.hostCurrent}
                                </Text>
                              </View>
                            )}
                          </View>
                          {statusDetail !== undefined && (
                            <Text style={styles.dropdownOptionDetail} numberOfLines={1}>
                              {statusDetail}
                            </Text>
                          )}
                        </View>
                        {total > 0 && (
                          <View
                            style={[
                              styles.dropdownCountBadge,
                              { backgroundColor: tone.pillBg, borderColor: tone.pillBorder },
                            ]}
                          >
                            <Text style={[styles.dropdownCountText, { color: tone.pillText }]}>
                              {total > 99 ? '99+' : total}
                            </Text>
                          </View>
                        )}
                        <View style={styles.dropdownCheckSlot}>
                          {selected && <Check size={16} color={colors.primary} strokeWidth={2.3} />}
                        </View>
                      </Pressable>
                    )
                  })
                ) : (
                  <>
                    <Pressable
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: backendFilter === 'all' }}
                      accessibilityLabel={`${strings.attention.filterAllPlatforms}, ${displayItems.length}`}
                      onPress={() => {
                        setBackendFilter('all')
                        setOpenDropdown(null)
                      }}
                      style={({ pressed }) => [
                        styles.dropdownOptionRow,
                        backendFilter === 'all' && styles.dropdownOptionSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.platformAllGlyphMd}>
                        <Bot size={13.5} color={colors.ink} strokeWidth={2} />
                      </View>
                      <View style={styles.dropdownOptionTextCol}>
                        <Text
                          style={[
                            styles.dropdownOptionTitle,
                            backendFilter === 'all' && styles.dropdownOptionTitleSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {strings.attention.filterAllPlatforms}
                        </Text>
                      </View>
                      <View style={styles.dropdownNeutralCountBadge}>
                        <Text style={styles.dropdownNeutralCountText}>
                          {displayItems.length > 99 ? '99+' : displayItems.length}
                        </Text>
                      </View>
                      <View style={styles.dropdownCheckSlot}>
                        {backendFilter === 'all' && <Check size={16} color={colors.primary} strokeWidth={2.3} />}
                      </View>
                    </Pressable>
                    {backendFilters.map(option => {
                      const selected = backendFilter === option.key
                      const accent = scheme === 'dark' ? option.accentDark : option.accentLight
                      return (
                        <Pressable
                          key={option.key}
                          accessibilityRole="menuitem"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`${option.label}, ${option.count}`}
                          onPress={() => {
                            setBackendFilter(option.key)
                            setOpenDropdown(null)
                          }}
                          style={({ pressed }) => [
                            styles.dropdownOptionRow,
                            styles.dropdownOptionBorder,
                            selected && styles.dropdownOptionSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <BackendGlyphBadge
                            accent={accent}
                            shortBadge={option.shortBadge}
                            size="md"
                            styles={styles}
                          />
                          <View style={styles.dropdownOptionTextCol}>
                            <Text
                              style={[styles.dropdownOptionTitle, selected && styles.dropdownOptionTitleSelected]}
                              numberOfLines={1}
                            >
                              {option.label}
                            </Text>
                          </View>
                          <View style={styles.dropdownNeutralCountBadge}>
                            <Text style={styles.dropdownNeutralCountText}>
                              {option.count > 99 ? '99+' : option.count}
                            </Text>
                          </View>
                          <View style={styles.dropdownCheckSlot}>
                            {selected && <Check size={16} color={colors.primary} strokeWidth={2.3} />}
                          </View>
                        </Pressable>
                      )
                    })}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        )}
      </View>
    </SheetModal>
  )
}

function DetachedCountdownChip({
  expiresAt,
  tone,
  styles,
}: {
  expiresAt: number
  tone: AttentionToneTokens
  styles: ReturnType<typeof createStyles>
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const scheduleTick = () => {
      const current = Date.now()
      const remainingMs = expiresAt - current
      if (remainingMs <= 0) return
      const delayMs = remainingMs <= 60_000
        ? Math.max(250, (remainingMs % 1000) || 1000)
        : Math.max(1000, ((remainingMs - 60_000) % 60_000) || 60_000)
      timer = setTimeout(() => {
        if (!active) return
        setNow(Date.now())
        scheduleTick()
      }, delayMs)
    }
    setNow(Date.now())
    scheduleTick()
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [expiresAt])

  const countdown = formatDetachedCountdown(expiresAt, now)
  if (countdown === undefined) return null

  return (
    <View
      style={[
        styles.countdownPill,
        { backgroundColor: tone.bg, borderColor: tone.border },
      ]}
    >
      <Clock size={11} color={tone.fg} strokeWidth={2.0} />
      <Text style={[styles.countdownText, { color: tone.fg }]}>
        {strings.attention.expiresIn(countdown)}
      </Text>
    </View>
  )
}

function BackendGlyphBadge({
  accent,
  shortBadge,
  size = 'sm',
  styles,
}: {
  accent: string
  shortBadge: string
  size?: 'sm' | 'md'
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <View
      style={[
        styles.backendGlyphMini,
        size === 'md' && styles.backendGlyphMd,
        { borderColor: `${accent}55` },
      ]}
    >
      <Text
        style={[
          styles.backendGlyphMiniText,
          size === 'md' && styles.backendGlyphMdText,
          { color: accent },
        ]}
      >
        {shortBadge}
      </Text>
    </View>
  )
}

function AttentionInboxItemRow({
  item,
  first,
  disabled = false,
  onPress,
  colors,
  scheme,
  palette,
  styles,
}: {
  item: AttentionItem
  first: boolean
  disabled?: boolean
  onPress: () => void
  colors: ThemeColors
  scheme: ColorScheme
  palette: AttentionSurfacePalette
  styles: ReturnType<typeof createStyles>
}) {
  const visual = attentionStatusVisual(item.status, colors, scheme)
  const StatusIcon = visual.Icon
  const backendMeta = resolveAttentionBackendIdentity(item)
  const backendAccent = scheme === 'dark' ? backendMeta.accentDark : backendMeta.accentLight
  const titleText = item.sessionTitle.trim().length > 0
    ? item.sessionTitle.trim()
    : strings.sessions.untitled
  const initialCountdown = item.detachedExpiresAt !== undefined
    ? formatDetachedCountdown(item.detachedExpiresAt, Date.now())
    : undefined
  const a11yLabel = [
    visual.label,
    backendMeta.label,
    titleText,
    item.workspaceLabel,
    initialCountdown ? strings.attention.expiresIn(initialCountdown) : undefined,
  ].filter(Boolean).join(', ')

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowBorder,
        pressed && !disabled && styles.rowPressed,
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
          <View style={styles.backendPill}>
            <BackendGlyphBadge
              accent={backendAccent}
              shortBadge={backendMeta.shortBadge}
              styles={styles}
            />
            <Text style={styles.backendText} numberOfLines={1}>{backendMeta.label}</Text>
          </View>
          {item.detachedExpiresAt !== undefined && (
            <DetachedCountdownChip
              expiresAt={item.detachedExpiresAt}
              tone={palette.approval}
              styles={styles}
            />
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
      {!disabled && <ChevronRight size={16} color={colors.subtle} />}
    </Pressable>
  )
}

/**
 * Compact pill placed in the HostSessionsDrawer footer to the left of Settings,
 * showing urgent/active counts across connected + online hosts and opening Attention Inbox.
 */
export function AttentionInboxPill({
  onPress,
}: {
  onPress: () => void
}) {
  useAppStore(state => state.language)
  const devices = useAppStore(state => state.devices)
  const selectedDeviceId = useAppStore(state => state.selectedDevice?.deviceId)
  const connectionPhase = useAppStore(state => state.connection.phase)
  const items = useAttentionStore(state => state.items)
  const { colors, scheme } = useTheme()
  const palette = useMemo(() => attentionSurfacePalette(colors, scheme), [colors, scheme])
  const styles = useThemedStyles(createStyles)

  const connectedHostId = connectionPhase === 'connected' ? selectedDeviceId : undefined
  const counts = useMemo(
    () => selectCrossHostAttentionCounts({ devices, connectedHostId, activeItems: items }),
    [devices, connectedHostId, items],
  )

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
      android_ripple={androidRipple(colors)}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.inboxPill,
        hasAny && [
          styles.inboxPillActive,
          { backgroundColor: colors.elevated, borderColor: borderTint },
        ],
        pressed && styles.pressed,
      ]}
    >
      <Icon size={16} color={iconTint} strokeWidth={2.05} />
      {hasAny && (
        <Text style={[styles.inboxPillCount, { color: colors.ink }]} numberOfLines={1}>
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
      paddingHorizontal: 0,
      paddingTop: 0,
      gap: spacing.xs,
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
    dropdownBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingTop: 2,
      paddingBottom: 4,
    },
    dropdownTrigger: {
      flex: 1,
      minWidth: 0,
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    dropdownTriggerHost: {
      flex: 1.08,
    },
    dropdownTriggerOpen: {
      backgroundColor: colors.elevated,
      borderColor: colors.ink,
    },
    dropdownTriggerDisabled: {
      opacity: 0.52,
    },
    dropdownDot: {
      width: 6.5,
      height: 6.5,
      borderRadius: 3.5,
      flexShrink: 0,
    },
    dropdownTriggerText: {
      ...type.caption,
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.muted,
      flex: 1,
      minWidth: 0,
    },
    dropdownTriggerTextActive: {
      color: colors.ink,
    },
    dropdownCountBadge: {
      paddingHorizontal: 5.5,
      paddingVertical: 1,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      flexShrink: 0,
    },
    dropdownCountText: {
      ...type.caption,
      fontSize: 10.5,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    dropdownNeutralCountBadge: {
      paddingHorizontal: 5.5,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: colors.cardOpaque,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      flexShrink: 0,
    },
    dropdownNeutralCountText: {
      ...type.caption,
      fontSize: 10.5,
      fontWeight: '700',
      color: colors.muted,
      fontVariant: ['tabular-nums'],
    },
    platformAllGlyph: {
      width: 15,
      height: 15,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    platformAllGlyphMd: {
      width: 20,
      height: 20,
      borderRadius: 6,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    bodyStage: {
      flex: 1,
      minHeight: 0,
      position: 'relative',
    },
    dropdownOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 20,
      elevation: 12,
    },
    dropdownMenuCard: {
      position: 'absolute',
      top: 4,
      backgroundColor: colors.elevated,
      ...continuousRadius(radius.xl),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      ...elevationStyle(colors, 3),
    },
    dropdownMenuLeft: {
      left: spacing.lg,
      width: '80%',
      minWidth: 224,
    },
    dropdownMenuRight: {
      right: spacing.lg,
      width: '78%',
      minWidth: 214,
    },
    dropdownOptionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: 44,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    dropdownOptionBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    dropdownOptionSelected: {
      backgroundColor: colors.surfaceStrong,
    },
    dropdownMenuDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      flexShrink: 0,
    },
    dropdownOptionTextCol: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    dropdownOptionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
    },
    dropdownOptionTitle: {
      ...type.small,
      fontSize: 13.5,
      fontWeight: '500',
      color: colors.ink,
      flexShrink: 1,
    },
    dropdownOptionTitleSelected: {
      fontWeight: '700',
    },
    dropdownOptionDetail: {
      ...type.caption,
      fontSize: 11.5,
      color: colors.muted,
    },
    dropdownCurrentBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      flexShrink: 0,
    },
    dropdownCurrentBadgeText: {
      ...type.caption,
      fontSize: 10,
      fontWeight: '600',
      color: colors.muted,
    },
    dropdownCheckSlot: {
      width: 18,
      alignItems: 'flex-end',
      justifyContent: 'center',
      flexShrink: 0,
    },
    hostBridgeCard: {
      backgroundColor: colors.grouped,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    hostBridgeTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    hostBridgeMeta: { flex: 1, minWidth: 0, gap: 2 },
    hostBridgeName: { ...type.bodyStrong, fontSize: 15, color: colors.ink },
    hostBridgeStatus: { ...type.caption, color: colors.muted },
    switchHostBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.inverse,
    },
    switchHostBtnText: {
      ...type.caption,
      fontSize: 12,
      fontWeight: '700',
      color: colors.onInverse,
    },
    switchHostSecondaryBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    switchHostSecondaryText: {
      ...type.caption,
      fontSize: 12,
      fontWeight: '600',
      color: colors.ink,
    },
    digestChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    digestChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
    },
    digestChipDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
    },
    digestChipText: {
      ...type.caption,
      fontSize: 11,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    hostBridgeHint: {
      ...type.caption,
      fontSize: 12,
      lineHeight: 17,
      color: colors.muted,
    },
    scroll: { flexGrow: 1, flexShrink: 1 },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
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
    sectionCardMuted: {
      opacity: 0.78,
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
    backendPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4.5,
      paddingHorizontal: 6.5,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    backendGlyphMini: {
      width: 14,
      height: 14,
      borderRadius: 4,
      backgroundColor: colors.cardOpaque,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    backendGlyphMiniText: {
      fontSize: 9,
      lineHeight: 11,
      fontWeight: '800',
    },
    backendGlyphMd: {
      width: 20,
      height: 20,
      borderRadius: 6,
    },
    backendGlyphMdText: {
      fontSize: 11,
      lineHeight: 13,
    },
    backendText: {
      ...type.caption,
      fontSize: 11,
      color: colors.ink,
      fontWeight: '600',
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
    inboxPill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      gap: 5,
      minHeight: 36,
      minWidth: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    inboxPillActive: {
      paddingHorizontal: 10,
      borderWidth: StyleSheet.hairlineWidth,
    },
    inboxPillCount: {
      ...type.caption,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    pressed: { opacity: 0.72 },
  })
}
