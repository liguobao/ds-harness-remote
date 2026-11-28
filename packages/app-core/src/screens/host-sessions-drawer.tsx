import { compareAttentionItems, type AttentionStatus } from '@dsh-remote/protocol'
import { AttentionInboxPill, attentionStatusVisual } from './attention-inbox-sheet'
import { useAttentionStore } from '../state/attention-store'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  TextInput,
  SectionList,
  RefreshControl,
  ScrollView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Alert } from '../ui/alert'
import * as Haptics from 'expo-haptics'
import * as Clipboard from 'expo-clipboard'
import Svg, { Path } from 'react-native-svg'
import {
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Laptop,
  LayoutGrid,
  Monitor,
  Plus,
  MoreVertical,
  Search,
  Server,
  Settings,
  Sliders,
  Star,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import { selectCustomAcpBackends, selectKnownMember } from '../state/store-state'
import { dispatchSessionCatalogCommand } from '../state/session-catalog-commands'
import { isKnownBotSessionId, useBotTeamStore } from '../state/bot-store'
import type { AgentBackend, RemoteSession, WorkspaceView } from '../types'
import { strings } from '../locales/i18n'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../ui/fish-logo'
import { ErrorBanner, GroupCard, GroupRow, IconButton, SectionTitle } from '../ui/components'
import { floatingShadow, radius, spacing, type } from '../ui/theme'
import { androidRipple, continuousRadius, elevationStyle, tabularNumsStyle } from '../ui/platform-style'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { easingCurve, indicatorGeometry, motionTokens, resolveMotion } from '../ui/motion'
import {
  DRAWER_FULL_CONTENT_MAX_WIDTH,
  WINDOW_SIZE_MEDIUM,
  drawerWidthForWindow,
  modalSheetMaxHeight,
  useResponsiveLayout,
} from '../ui/responsive'
import { useReduceMotion } from '../ui/use-reduce-motion'
import { resolveSessionDisplayTitle, resolveSessionHandoffBadge } from './session-title'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { isVisibleSession } from '../lib/session-visibility'
import { isSubagentSession } from '../lib/session-kind'
import { isAcpManagedBackend } from '../lib/workspace-key'
import { harnessDisplayName, type SessionHandoffOrigin } from '../lib/handoff-preview'
import { HandoffOriginBadge } from './chat/handoff-badge'
import { browseStatus } from '../lib/backend-groups'
import { browseScope, saveHostMode, useBrowseMemory } from '../services/browse-memory'
import {
  loadHostSessionsDrawerGroups,
  loadHostSessionsDrawerPreferences,
  saveHostSessionsDrawerGroup,
  saveHostSessionsDrawerPreferences,
  saveWorkspaceBackend,
  type SessionFilterMode,
  type SessionGroupBy,
  type SessionOrderBy,
} from '../services/storage'
import { clampDrawerTranslate, shouldConfirmSwipeLeftClose, shouldStartSwipeLeftToClose } from '../lib/gesture-swipe-rules'
import { createStoreGate, shouldAllowDrawerClose, useStoreGateSelector, type StoreGate } from '../lib/gated-store'
import { buildTreeSections, applyManualOrder, reorderSessionIds } from '../lib/workspace-tree'
import { BOT_MODALS_LINGER_MS, isDrawerHostHidden, shouldRenderBotModalsHost } from './bot/popover-menu'
import { BotModalsHost, BotSidebarSection, useBotTeamLoad } from './bot-sidebar-section'
import { HomeActionsMenu, openMembershipPlan } from './setup-screens'
import { CreateWorkspaceModal, RenameWorkspaceModal, WorkspaceActionsModal } from './workspace-modals'

const SESSION_PAGE_SIZE = 3
/** Padding inside the Agent / DS-Bot underline tab track. */
const MODE_SWITCHER_INSET = 0
const EMPTY_SECTIONS: DrawerSection[] = []
const sessionKeyExtractor = (item: RemoteSession) => item.sessionId

/** 浮窗相对工具栏底部的间距 */
const POPOVER_OFFSET = 4
/** 浮窗到容器右边缘的距离（与工具栏 paddingHorizontal 对齐） */
const POPOVER_RIGHT_INSET = spacing.md

/** 内存缓存每台设备的工作区展开状态，关闭/重开侧边栏或切换模式时保持上次离开状态 */
const memoryGroupsByDevice: Record<string, Record<string, boolean>> = {}

interface DrawerPreferencesMemory {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  filterMode: SessionFilterMode
  manualOrders: Record<string, string[]>
}

/** 内存缓存全局与每台设备的侧边栏偏好（分组方式、排序方式、筛选条件、手动排序顺序），关闭/重开抽屉或进入回话再返回时保持上次离开状态 */
const memoryPreferencesByDevice: Record<string, Partial<DrawerPreferencesMemory>> = {}
const memoryGlobalPreferences: Omit<DrawerPreferencesMemory, 'manualOrders'> = {
  groupBy: 'workspace',
  orderBy: 'updated',
  filterMode: 'hideArchived',
}

export function resetDrawerPreferencesMemoryForTesting(): void {
  for (const k of Object.keys(memoryPreferencesByDevice)) {
    delete memoryPreferencesByDevice[k]
  }
  memoryGlobalPreferences.groupBy = 'workspace'
  memoryGlobalPreferences.orderBy = 'updated'
  memoryGlobalPreferences.filterMode = 'hideArchived'
}

function formatRelativeTime(timestamp?: number | string): string {
  if (!timestamp) return ''
  const time = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp
  const diff = Math.max(0, Date.now() - time)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return strings.time.now
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

interface DrawerSection {
  id: string
  title: string
  total: number
  expanded: boolean
  data: RemoteSession[]
  depth?: number
  workspaceId?: string
  hasMoreFooter?: boolean
}

interface HarnessOption {
  value: AgentBackend & keyof typeof strings.sessions.backendDescriptions
  name: string
}

const HARNESS_OPTIONS: HarnessOption[] = [
  { value: 'harness', name: 'DeepSeek Harness' },
  { value: 'codex', name: 'Codex' },
  { value: 'claude', name: 'Claude' },
  { value: 'hermes', name: 'Hermes' },
  { value: 'kimi', name: 'Kimi' },
  { value: 'cursor', name: 'Cursor' },
  { value: 'antigravity', name: 'Antigravity' },
  { value: 'opencode', name: 'OpenCode' },
  { value: 'pi', name: 'Pi' },
]

export interface HostSessionsDrawerProps {
  onBack?: () => void
  onClose: () => void
  onOpenWorkspaces?: () => void
  onOpenDeviceInfo?: () => void
  onSelect: (session: RemoteSession) => Promise<void>
  onHandoffSession?: (session: RemoteSession, workspace?: WorkspaceView) => void
  onNewSession?: () => Promise<void> | void
  onOpenAutomationTasks?: () => void
  onOpenPlugins?: () => void
  onOpenHostSwitcher?: () => void
  onOpenAttentionInbox?: () => void
  onOpenSettings?: () => void
  onOpenAbout?: () => void
  botMode?: boolean
  onBotModeChange?: (botMode: boolean) => void
  onSelectBot?: (botId: string) => void
  inline?: boolean
  open?: boolean
  backLabel?: string
  /** 冷启动停留在侧边栏且尚未选择任何页面时，禁止手势/返回键把侧边栏划走。 */
  dismissible?: boolean
  /** 默认停留在列表或切换主机时直接就位，避免先露底层对话再滑入；从对话呼出时才滑入。 */
  entrance?: 'immediate' | 'slide'
  /** 由 ChatScreen 统一协调硬件返回键顺序。 */
  backRef?: MutableRefObject<(() => boolean) | undefined>
  /** 由 ChatScreen 触发常驻 overlay 抽屉的平滑关闭动画。 */
  closeRef?: MutableRefObject<((options?: { withHaptic?: boolean; force?: boolean }) => void) | undefined>
  /** 冷启动点选当前会话等显式动作时，同步解锁外层 dismissible 状态。 */
  onUnlockDismissible?: () => void
}

type DrawerStyles = ReturnType<typeof createStyles>

const BotTeamLoadBridge = memo(function BotTeamLoadBridge({ enabled }: { enabled: boolean }) {
  useBotTeamLoad(enabled)
  return null
})

export { isDrawerHostHidden }

const BotModalsGate = memo(function BotModalsGate({ visible }: { visible: boolean; gate: StoreGate }) {
  const hasStoreModal = useBotTeamStore(
    store =>
      store.editor !== undefined
      || store.detailsOpen
      || store.report !== undefined
      || store.contextMenu !== undefined,
  )
  const [deleteConfirmActive, setDeleteConfirmActive] = useState(false)
  const active = hasStoreModal || deleteConfirmActive
  const [lingerMounted, setLingerMounted] = useState(false)

  useEffect(() => {
    if (active) {
      if (!visible) {
        if (lingerMounted) setLingerMounted(false)
        if (deleteConfirmActive) setDeleteConfirmActive(false)
        return
      }
      if (!lingerMounted) setLingerMounted(true)
      return
    }
    if (!lingerMounted) return
    const timer = setTimeout(() => setLingerMounted(false), BOT_MODALS_LINGER_MS)
    return () => clearTimeout(timer)
  }, [visible, active, lingerMounted, deleteConfirmActive])

  if (!shouldRenderBotModalsHost({ visible, hasStoreModal, deleteConfirmActive, lingerMounted })) {
    return null
  }
  return <BotModalsHost onDeleteConfirmChange={setDeleteConfirmActive} />
})

interface SessionListRowProps {
  item: RemoteSession
  displayTitle: string
  handoffSourceLabel?: string
  sectionId: string
  accountKey: string
  index: number
  isSelected: boolean
  isFirstInList: boolean
  isLastInCard: boolean
  attentionStatus?: AttentionStatus
  scheme: Parameters<typeof attentionStatusVisual>[2]
  isPinned: boolean
  isArchived: boolean
  depth: number
  isDragging: boolean
  dropAbove: boolean
  dropBelow: boolean
  timeStr: string
  language: string
  styles: DrawerStyles
  colors: ThemeColors
  onPress: (item: RemoteSession, isSelected: boolean) => void
  onLongPress: (item: RemoteSession, sectionId: string, accountKey: string, index: number, isPinned: boolean) => void
  onTouchStart: (pageY: number) => void
  onTouchMove: (item: RemoteSession, sectionId: string, pageY: number) => void
  onTouchEnd: (item: RemoteSession, sectionId: string, isPinned: boolean) => void
  onTouchCancel: () => void
  onMorePress: (item: RemoteSession) => void
}

const SessionListRow = memo(function SessionListRow({
  item,
  displayTitle,
  handoffSourceLabel,
  sectionId,
  accountKey,
  index,
  isSelected,
  isFirstInList,
  isLastInCard,
  attentionStatus,
  scheme,
  isPinned,
  isArchived,
  depth,
  isDragging,
  dropAbove,
  dropBelow,
  timeStr,
  language: _language,
  styles,
  colors,
  onPress,
  onLongPress,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onMorePress,
}: SessionListRowProps) {
  const status = attentionStatus && attentionStatusVisual(attentionStatus, colors, scheme)
  const handoffLabel = handoffSourceLabel !== undefined
    ? (handoffSourceLabel.length > 0 ? strings.handoff.badgeFrom(handoffSourceLabel) : strings.handoff.title)
    : undefined
  const accessibilityLabel = [displayTitle, handoffLabel, status?.label, isPinned ? strings.sessions.pinned : undefined].filter(Boolean).join(', ')

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: isSelected }}
      onPress={() => onPress(item, isSelected)}
      onLongPress={() => onLongPress(item, sectionId, accountKey, index, isPinned)}
      delayLongPress={300}
      onTouchStart={e => onTouchStart(e.nativeEvent.pageY)}
      onTouchMove={e => onTouchMove(item, sectionId, e.nativeEvent.pageY)}
      onTouchEnd={() => onTouchEnd(item, sectionId, isPinned)}
      onTouchCancel={onTouchCancel}
      style={({ pressed }) => [
        styles.sessionRow,
        isFirstInList && styles.sessionRowCardTop,
        isLastInCard && styles.sessionRowCardBottom,
        depth > 0 && { paddingLeft: spacing.lg + spacing.xs + depth * 14 },
        isSelected && styles.sessionRowSelected,
        pressed && styles.pressedBg,
        isDragging && styles.sessionRowDragging,
        dropAbove && styles.dropTargetAbove,
        dropBelow && styles.dropTargetBelow,
      ]}
    >
      <View style={styles.statusIndicatorSlot}>
        {status && <status.Icon size={13} color={status.fg} strokeWidth={2.2} />}
      </View>
      <Text
        style={[
          styles.sessionText,
          isSelected && styles.sessionTextSelected,
          isArchived && styles.archivedText,
        ]}
        numberOfLines={1}
      >
        {displayTitle}
      </Text>
      {handoffSourceLabel !== undefined && (
        <View style={styles.handoffBadgeSlot}>
          <HandoffOriginBadge sourceLabel={handoffSourceLabel} selected={isSelected} compact />
        </View>
      )}
      {timeStr ? <Text style={styles.timeText}>{timeStr}</Text> : null}
      {isPinned && (
        <View style={styles.pinIndicator} accessibilityLabel={strings.sessions.pinned}>
          <OfficialMenuIcons.pinFill size={13} color={colors.ink} />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.sessions.moreActions}
        hitSlop={8}
        onPress={e => {
          e.stopPropagation()
          onMorePress(item)
        }}
        style={styles.moreActionBtn}
      >
        <OfficialMenuIcons.ellipsis size={16} color={colors.muted} />
      </Pressable>
    </Pressable>
  )
})

interface WorkspaceSectionHeaderProps {
  sectionId: string
  title: string
  total: number
  expanded: boolean
  hasItems: boolean
  depth: number
  workspace: WorkspaceView | undefined
  language: string
  styles: DrawerStyles
  colors: ThemeColors
  onToggle: (sectionId: string) => void
  onLongPress: (workspace: WorkspaceView) => void
  onCreateSession: (workspace: WorkspaceView) => void
}

const WorkspaceSectionHeader = memo(function WorkspaceSectionHeader({
  sectionId,
  title,
  total,
  expanded,
  hasItems,
  depth,
  workspace,
  language: _language,
  styles,
  colors,
  onToggle,
  onLongPress,
  onCreateSession,
}: WorkspaceSectionHeaderProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={workspace ? strings.workspaces.options : undefined}
      android_ripple={androidRipple(colors)}
      onPress={() => onToggle(sectionId)}
      onLongPress={() => {
        if (workspace) onLongPress(workspace)
      }}
      style={({ pressed }) => [
        styles.workspaceRow,
        hasItems ? styles.workspaceRowCardTop : styles.workspaceRowCardSingle,
        pressed && styles.pressedBg,
        depth > 0 && { paddingLeft: spacing.md + depth * 14 },
      ]}
    >
      <View style={styles.workspaceRowLeft}>
        {expanded
          ? <FolderOpen size={18} color={colors.primary} strokeWidth={1.8} />
          : <Folder size={18} color={colors.muted} strokeWidth={1.8} />}
        <Text style={styles.workspaceRowTitle} numberOfLines={1}>
          {title}
        </Text>
        {total > 0 && (
          <Text style={styles.workspaceCountText}>{total}</Text>
        )}
      </View>
      <View style={styles.workspaceRowRight}>
        {workspace !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.workspaces.newSessionIn(title)}
            android_ripple={androidRipple(colors, true)}
            hitSlop={8}
            onPress={e => {
              e.stopPropagation()
              onCreateSession(workspace)
            }}
            style={({ pressed }) => [styles.workspaceSmallBtn, pressed && styles.pressedBg]}
          >
            <Plus size={16} color={colors.muted} strokeWidth={2} />
          </Pressable>
        )}
        {expanded ? <ChevronDown size={16} color={colors.subtle} /> : <ChevronRight size={16} color={colors.subtle} />}
      </View>
    </Pressable>
  )
})

interface WorkspaceSectionFooterProps {
  countKey: string
  remaining: number
  depth: number
  language: string
  styles: DrawerStyles
  onShowMore: (countKey: string) => void
}

const WorkspaceSectionFooter = memo(function WorkspaceSectionFooter({
  countKey,
  remaining,
  depth,
  language: _language,
  styles,
  onShowMore,
}: WorkspaceSectionFooterProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onShowMore(countKey)}
      style={[
        styles.showMoreRow,
        depth > 0 && { paddingLeft: spacing.lg + spacing.md + depth * 14 },
      ]}
    >
      <Text style={styles.showMoreText}>{strings.sessions.showMoreSessions(remaining)}</Text>
    </Pressable>
  )
})

const HarnessPickerModal = memo(function HarnessPickerModal({
  visible,
  backend,
  backends,
  customAcpBackends,
  colors,
  styles,
  onClose,
  onSelect,
}: {
  visible: boolean
  backend: AgentBackend
  backends: AgentBackend[]
  customAcpBackends: readonly string[]
  colors: ThemeColors
  styles: DrawerStyles
  onClose: () => void
  onSelect: (target: AgentBackend) => void
}) {
  const layout = useResponsiveLayout()
  const sheetMaxHeight = Math.min(modalSheetMaxHeight(layout.height), 520)

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.harnessBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={onClose} />
        <View style={[styles.harnessDialog, { maxHeight: sheetMaxHeight }]} accessibilityViewIsModal>
          <View style={styles.harnessHeader}>
            <Text style={styles.harnessTitle} accessibilityRole="header">{strings.sessions.switchHarness}</Text>
            <IconButton label={strings.common.close} icon={X} onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.harnessList}>
            <GroupCard>
              {[
                ...HARNESS_OPTIONS,
                ...customAcpBackends.map(id => ({ value: id as AgentBackend, name: harnessDisplayName(id) })),
              ].filter(option => backends.includes(option.value)).map((option, index) => {
                const chosen = option.value === backend
                const descriptionMap = strings.sessions.backendDescriptions as Record<string, string | undefined>
                return (
                  <GroupRow
                    key={option.value}
                    first={index === 0}
                    label={option.name}
                    detail={descriptionMap[option.value] ?? strings.sessions.customAcpDescription}
                    selected={chosen}
                    chevron={false}
                    accessory={chosen ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                    onPress={() => onSelect(option.value)}
                  />
                )
              })}
            </GroupCard>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
})

interface HostSessionsDrawerBodyProps {
  inline: boolean
  gate: StoreGate
  fullWidthCentered: boolean
  showBackButton: boolean
  backLabel?: string
  botMode?: boolean
  onHeaderBack: () => void
  onClose: () => void
  onOpenDeviceInfo?: () => void
  onHandoffSession?: HostSessionsDrawerProps['onHandoffSession']
  onSelect: (session: RemoteSession) => Promise<void>
  onOpenAutomationTasks?: () => void
  onOpenPlugins?: () => void
  onOpenHostSwitcher?: () => void
  onOpenAttentionInbox?: () => void
  onOpenSettings?: () => void
  onOpenAbout?: () => void
  onBotModeChange?: (botMode: boolean) => void
  onSelectBot?: (botId: string) => void
  smoothClose: (withHaptic?: boolean, force?: boolean, unlockOnComplete?: boolean) => void
  releaseFreeze: () => void
  resetRef: MutableRefObject<(() => void) | undefined>
  backOverlayRef: MutableRefObject<(() => boolean) | undefined>
  dragActiveRef: MutableRefObject<boolean>
  onBotTabActiveChange: (active: boolean) => void
}

const HostSessionsDrawerBody = memo(function HostSessionsDrawerBody({
  inline,
  gate,
  fullWidthCentered,
  showBackButton,
  backLabel,
  botMode,
  onHeaderBack,
  onClose,
  onOpenDeviceInfo,
  onSelect,
  onHandoffSession,
  onOpenAutomationTasks,
  onOpenPlugins,
  onOpenHostSwitcher,
  onOpenAttentionInbox,
  onOpenSettings,
  onOpenAbout,
  onBotModeChange,
  onSelectBot,
  smoothClose,
  releaseFreeze,
  resetRef,
  backOverlayRef,
  dragActiveRef,
  onBotTabActiveChange,
}: HostSessionsDrawerBodyProps) {
  const language = useStoreGateSelector(useAppStore, state => state.language, gate)
  const deviceId = useStoreGateSelector(useAppStore, state => state.selectedDevice?.deviceId, gate)
  const membershipLinkHidden = useStoreGateSelector(useAppStore, state => !!state.membershipLinkHiddenUntil || selectKnownMember(state), gate)
  const deviceName = useStoreGateSelector(useAppStore, state => state.selectedDevice?.name, gate)
  const platform = useStoreGateSelector(useAppStore, state => state.selectedDevice?.platform, gate)
  const connectionPhase = useStoreGateSelector(useAppStore, state => state.connection.phase, gate)
  const sessions = useStoreGateSelector(useAppStore, state => state.sessions, gate)
  const recentIds = useStoreGateSelector(useAppStore, state => state.currentWorkSessionIds, gate)
  const codexAvailable = useStoreGateSelector(useAppStore, state => state.codexAvailable, gate)
  const cursorAvailable = useStoreGateSelector(useAppStore, state => state.cursorAvailable, gate)
  const antigravityAvailable = useStoreGateSelector(useAppStore, state => state.antigravityAvailable, gate)
  const piAvailable = useStoreGateSelector(useAppStore, state => state.piAvailable, gate)
  const opencodeAvailable = useStoreGateSelector(useAppStore, state => state.opencodeAvailable, gate)
  const claudeAvailable = useStoreGateSelector(useAppStore, state => state.claudeAvailable, gate)
  const hermesAvailable = useStoreGateSelector(useAppStore, state => state.hermesAvailable, gate)
  const kimiAvailable = useStoreGateSelector(useAppStore, state => state.kimiAvailable, gate)
  const customAcpBackends = useStoreGateSelector(useAppStore, selectCustomAcpBackends, gate)
  const availableBackends = useStoreGateSelector(useAppStore, state => [
    'harness', state.codexAvailable && 'codex', state.cursorAvailable && 'cursor',
    state.antigravityAvailable && 'antigravity', state.piAvailable && 'pi',
    state.opencodeAvailable && 'opencode', state.claudeAvailable && 'claude',
    state.hermesAvailable && 'hermes', state.kimiAvailable && 'kimi', ...selectCustomAcpBackends(state),
  ].filter(Boolean).join(','), gate)
  const attentionItems = useStoreGateSelector(useAttentionStore, state => state.items, gate)
  const attentionStatusBySession = useMemo(() => {
    const map = new Map<string, AttentionStatus>()
    const sorted = [...attentionItems].sort(compareAttentionItems)
    for (const entry of sorted) {
      if (!map.has(entry.sessionId)) {
        map.set(entry.sessionId, entry.status)
      }
    }
    return map
  }, [attentionItems])
  const hasTrustedHost = useStoreGateSelector(useAppStore, state => state.devices.some(d => d.trusted), gate)
  const lifecycles = useStoreGateSelector(useAppStore, state => state.sessionLifecycles, gate)
  const selected = useStoreGateSelector(useAppStore, state => state.selectedSession, gate)
  const archivedIds = useStoreGateSelector(useAppStore, state => state.archivedSessionIds, gate)
  const pinnedSessionIds = useStoreGateSelector(useAppStore, state => state.pinnedSessionIds, gate)
  const workspaces = useStoreGateSelector(useAppStore, state => state.workspaces, gate)
  const favoriteWorkspaces = useStoreGateSelector(useAppStore, state => state.favoriteWorkspaces, gate)
  const toggleFavoriteWorkspace = useStoreGateSelector(useAppStore, state => state.toggleFavoriteWorkspace, gate)
  const removeFavoriteWorkspace = useStoreGateSelector(useAppStore, state => state.removeFavoriteWorkspace, gate)
  const createWorkspace = useStoreGateSelector(useAppStore, state => state.workspaceCreate, gate)
  const renameWorkspace = useStoreGateSelector(useAppStore, state => state.workspaceRename, gate)
  const moveWorkspace = useStoreGateSelector(useAppStore, state => state.workspaceMove, gate)
  const deleteWorkspace = useStoreGateSelector(useAppStore, state => state.workspaceDelete, gate)
  const busy = useStoreGateSelector(useAppStore, state => state.busyAction, gate)
  const connected = useStoreGateSelector(useAppStore, state => state.connection.phase === 'connected', gate)
  const error = useStoreGateSelector(useAppStore, state => state.error, gate)
  const clearError = useStoreGateSelector(useAppStore, state => state.clearError, gate)
  const devicesRefreshing = useStoreGateSelector(useAppStore, state => state.refreshing, gate)
  const refreshDevices = useStoreGateSelector(useAppStore, state => state.refreshDevices, gate)
  const createSession = useStoreGateSelector(useAppStore, state => state.createSession, gate)
  const pinSession = useStoreGateSelector(useAppStore, state => state.pinSession, gate)
  const unpinSession = useStoreGateSelector(useAppStore, state => state.unpinSession, gate)
  const renameSession = useStoreGateSelector(useAppStore, state => state.renameSession, gate)
  const forkSession = useStoreGateSelector(useAppStore, state => state.forkSession, gate)
  const archiveSession = useStoreGateSelector(useAppStore, state => state.archiveSession, gate)
  const unarchiveSession = useStoreGateSelector(useAppStore, state => state.unarchiveSession, gate)

  const hostScope = useStoreGateSelector(useAppStore, browseScope, gate)
  const handoffOrigins = useStoreGateSelector(useBrowseMemory, state => state.handoffOrigins[hostScope], gate)
  const persistedBotMode = useStoreGateSelector(useBrowseMemory, state => state.hostModes[hostScope] === 'bot', gate)
  const activeBotMode = botMode ?? persistedBotMode
  const [drawerMode, setDrawerMode] = useState<'agent' | 'bot'>(activeBotMode ? 'bot' : 'agent')
  const reduceMotion = useReduceMotion()
  // One indicator travels between the two equal-width segments; it starts
  // hidden until the track has measured so it cannot flash at x=0.
  const [modeTrackWidth, setModeTrackWidth] = useState(0)
  const modeIndicator = useRef(new Animated.Value(activeBotMode ? 1 : 0)).current
  const modeStart = indicatorGeometry(0, modeTrackWidth, MODE_SWITCHER_INSET)
  const modeEnd = indicatorGeometry(1, modeTrackWidth, MODE_SWITCHER_INSET)
  useEffect(() => {
    const animation = Animated.timing(modeIndicator, {
      toValue: drawerMode === 'bot' ? 1 : 0,
      duration: resolveMotion('indicator', reduceMotion).duration,
      easing: Easing.bezier(...easingCurve('expand')),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [drawerMode, modeIndicator, reduceMotion])

  useEffect(() => {
    setDrawerMode(activeBotMode ? 'bot' : 'agent')
  }, [activeBotMode, hostScope])

  useEffect(() => {
    onBotTabActiveChange(drawerMode === 'bot')
  }, [drawerMode, onBotTabActiveChange])

  const handleSwitchMode = (nextMode: 'agent' | 'bot') => {
    setDrawerMode(nextMode)
    // In single-pane phone overlay mode, switching tabs only browses the other
    // roster without mutating the underlying conversation until an item is chosen.
    if (inline) {
      saveHostMode(hostScope, nextMode)
      onBotModeChange?.(nextMode === 'bot')
    }
  }

  const activateAgentMode = () => {
    setDrawerMode('agent')
    saveHostMode(hostScope, 'agent')
    onBotModeChange?.(false)
  }

  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
  const [createWorkspaceEverOpened, setCreateWorkspaceEverOpened] = useState(false)
  const [workspaceActionTarget, setWorkspaceActionTarget] = useState<WorkspaceView | undefined>(undefined)
  const [workspaceActionsEverOpened, setWorkspaceActionsEverOpened] = useState(false)
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<WorkspaceView | undefined>(undefined)
  const [renameWorkspaceEverOpened, setRenameWorkspaceEverOpened] = useState(false)
  const [showBotSearch, setShowBotSearch] = useState(false)
  const [botSearchQuery, setBotSearchQuery] = useState('')

  const [menuSession, setMenuSession] = useState<RemoteSession | null>(null)
  const handoffTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clearHandoffTimer = useCallback(() => {
    if (handoffTimerRef.current !== undefined) {
      clearTimeout(handoffTimerRef.current)
      handoffTimerRef.current = undefined
    }
  }, [])
  useEffect(() => clearHandoffTimer, [clearHandoffTimer])
  useEffect(() => { clearHandoffTimer() }, [deviceId, clearHandoffTimer])
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; currentTitle: string; backend?: RemoteSession['backend'] } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const archivedSet = useMemo(() => new Set(archivedIds), [archivedIds])
  const pinnedSet = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds])

  const menuBackend = menuSession?.backend ?? 'harness'
  const canUseHarnessActions = !!menuSession && menuBackend === 'harness'
  const canPinSession = !!menuSession && (menuBackend === 'harness' || isAcpManagedBackend(menuBackend))
  const menuIsPinned = !!menuSession && canPinSession && pinnedSet.has(menuSession.sessionId)
  const menuIsArchived = !!menuSession && canUseHarnessActions && archivedSet.has(menuSession.sessionId)

  const [backend, setBackend] = useState<AgentBackend>(selected?.backend ?? useAppStore.getState().workspaceCatalog?.backend ?? 'harness')
  const backends = useMemo(() => [...new Set<AgentBackend>([
    ...availableBackends.split(',') as AgentBackend[],
    ...workspaces.map(workspace => workspace.backend ?? 'harness'),
    ...(selected ? [selected.backend ?? 'harness'] : []),
  ])], [availableBackends, workspaces, selected])
  const backendWorkspaces = useMemo(() => workspaces.filter(workspace => (workspace.backend ?? 'harness') === backend), [workspaces, backend])
  const backendWorkspaceById = useMemo(() => {
    const map = new Map<string, WorkspaceView>()
    for (const workspace of backendWorkspaces) map.set(workspace.workspaceId, workspace)
    return map
  }, [backendWorkspaces])
  useEffect(() => {
    setBackend(selected?.backend ?? useAppStore.getState().workspaceCatalog?.backend ?? 'harness')
    setVisibleCounts({})
  }, [deviceId, selected?.backend])
  useEffect(() => {
    if (connected) void dispatchSessionCatalogCommand({ type: 'refresh-catalog', backend })
  }, [backend, connected, deviceId])

  const [harnessPickerOpen, setHarnessPickerOpen] = useState(false)
  const [harnessPickerEverOpened, setHarnessPickerEverOpened] = useState(false)

  const isBackendAvailable = (target: AgentBackend) => {
    switch (target) {
      case 'harness': return true
      case 'codex': return useAppStore.getState().codexAvailable
      case 'cursor': return useAppStore.getState().cursorAvailable
      case 'antigravity': return useAppStore.getState().antigravityAvailable
      case 'pi': return useAppStore.getState().piAvailable
      case 'opencode': return useAppStore.getState().opencodeAvailable
      case 'claude': return useAppStore.getState().claudeAvailable
      case 'hermes': return useAppStore.getState().hermesAvailable
      case 'kimi': return useAppStore.getState().kimiAvailable
      default: return selectCustomAcpBackends(useAppStore.getState()).includes(target)
    }
  }

  const handleSelectHarness = async (target: AgentBackend) => {
    setHarnessPickerOpen(false)
    if (!isBackendAvailable(target)) {
      Alert.alert(
        strings.common.unavailable,
        strings.sessions.backendUnavailable(harnessDisplayName(target)),
      )
      return
    }

    // Switching categories only browses the target catalogue. It must not
    // depend on cached sessions or create a thread in a fallback directory.
    setBackend(target)
    setVisibleCounts({})
    if (deviceId !== undefined) {
      void saveWorkspaceBackend(deviceId, target)
    }
    // The backend effect loads the catalogue without changing the open chat.
  }

  const [refreshing, setRefreshing] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMounted, setSearchMounted] = useState(false)
  const searchMotion = useRef(new Animated.Value(0)).current
  const [showConfigModal, setShowConfigModal] = useState(false)
  const configMotion = useRef(new Animated.Value(0)).current
  const [appMenuOpen, setAppMenuOpen] = useState(false)
  const [groupBy, setGroupBy] = useState<SessionGroupBy>(() => {
    const devPrefs = deviceId ? memoryPreferencesByDevice[deviceId] : undefined
    return devPrefs?.groupBy ?? memoryGlobalPreferences.groupBy
  })
  const [orderBy, setOrderBy] = useState<SessionOrderBy>(() => {
    const devPrefs = deviceId ? memoryPreferencesByDevice[deviceId] : undefined
    return devPrefs?.orderBy ?? memoryGlobalPreferences.orderBy
  })
  const [manualOrders, setManualOrders] = useState<Record<string, string[]>>(() => {
    const devPrefs = deviceId ? memoryPreferencesByDevice[deviceId] : undefined
    return devPrefs?.manualOrders ?? {}
  })
  const [dragState, setDragState] = useState<{
    sessionId: string
    sectionId: string
    accountKey: string
    fromIndex: number
    overIndex: number
    isPinned: boolean
  } | null>(null)
  const touchStartY = useRef(0)
  const justDraggedRef = useRef(false)
  const [filterMode, setFilterMode] = useState<SessionFilterMode>(() => {
    const devPrefs = deviceId ? memoryPreferencesByDevice[deviceId] : undefined
    return devPrefs?.filterMode ?? memoryGlobalPreferences.filterMode
  })

  const updateGroupBy = (nextGroupBy: SessionGroupBy) => {
    setGroupBy(nextGroupBy)
    memoryGlobalPreferences.groupBy = nextGroupBy
    if (deviceId) {
      memoryPreferencesByDevice[deviceId] = {
        ...memoryPreferencesByDevice[deviceId],
        groupBy: nextGroupBy,
      }
    }
    void saveHostSessionsDrawerPreferences(deviceId, { groupBy: nextGroupBy }).catch(() => undefined)
  }

  const updateOrderBy = (nextOrderBy: SessionOrderBy) => {
    setOrderBy(nextOrderBy)
    memoryGlobalPreferences.orderBy = nextOrderBy
    if (deviceId) {
      memoryPreferencesByDevice[deviceId] = {
        ...memoryPreferencesByDevice[deviceId],
        orderBy: nextOrderBy,
      }
    }
    void saveHostSessionsDrawerPreferences(deviceId, { orderBy: nextOrderBy }).catch(() => undefined)
  }

  const updateFilterMode = (nextFilter: SessionFilterMode) => {
    setFilterMode(nextFilter)
    memoryGlobalPreferences.filterMode = nextFilter
    if (deviceId) {
      memoryPreferencesByDevice[deviceId] = {
        ...memoryPreferencesByDevice[deviceId],
        filterMode: nextFilter,
      }
    }
    void saveHostSessionsDrawerPreferences(deviceId, { filterMode: nextFilter }).catch(() => undefined)
  }

  const updateManualOrders = (accountKey: string, nextIds: string[], alsoSetManualOrder: boolean) => {
    setManualOrders(prev => {
      const nextManualOrders = { ...prev, [accountKey]: nextIds }
      if (deviceId) {
        memoryPreferencesByDevice[deviceId] = {
          ...memoryPreferencesByDevice[deviceId],
          manualOrders: nextManualOrders,
          ...(alsoSetManualOrder ? { orderBy: 'manual' } : {}),
        }
      }
      void saveHostSessionsDrawerPreferences(deviceId, {
        manualOrders: nextManualOrders,
        ...(alsoSetManualOrder ? { orderBy: 'manual' } : {}),
      }).catch(() => undefined)
      return nextManualOrders
    })
    if (alsoSetManualOrder) {
      setOrderBy('manual')
      memoryGlobalPreferences.orderBy = 'manual'
    }
  }

  useEffect(() => {
    const devPrefs = deviceId ? memoryPreferencesByDevice[deviceId] : undefined
    if (devPrefs) {
      if (devPrefs.groupBy !== undefined) setGroupBy(devPrefs.groupBy)
      if (devPrefs.orderBy !== undefined) setOrderBy(devPrefs.orderBy)
      if (devPrefs.filterMode !== undefined) setFilterMode(devPrefs.filterMode)
      if (devPrefs.manualOrders !== undefined) setManualOrders(devPrefs.manualOrders)
    }

    let cancelled = false
    void loadHostSessionsDrawerPreferences(deviceId).then(saved => {
      if (cancelled) return
      if (saved.groupBy !== undefined) {
        memoryGlobalPreferences.groupBy = saved.groupBy
        setGroupBy(prev => {
          const activeMem = deviceId ? memoryPreferencesByDevice[deviceId]?.groupBy : undefined
          return activeMem ?? saved.groupBy!
        })
      }
      if (saved.orderBy !== undefined) {
        memoryGlobalPreferences.orderBy = saved.orderBy
        setOrderBy(prev => {
          const activeMem = deviceId ? memoryPreferencesByDevice[deviceId]?.orderBy : undefined
          return activeMem ?? saved.orderBy!
        })
      }
      if (saved.filterMode !== undefined) {
        memoryGlobalPreferences.filterMode = saved.filterMode
        setFilterMode(prev => {
          const activeMem = deviceId ? memoryPreferencesByDevice[deviceId]?.filterMode : undefined
          return activeMem ?? saved.filterMode!
        })
      }
      if (saved.manualOrders !== undefined) {
        setManualOrders(prev => {
          const activeMem = deviceId ? memoryPreferencesByDevice[deviceId]?.manualOrders : undefined
          return activeMem ?? saved.manualOrders!
        })
      }
      if (deviceId) {
        memoryPreferencesByDevice[deviceId] = {
          ...(saved.groupBy !== undefined ? { groupBy: saved.groupBy } : {}),
          ...(saved.orderBy !== undefined ? { orderBy: saved.orderBy } : {}),
          ...(saved.filterMode !== undefined ? { filterMode: saved.filterMode } : {}),
          ...(saved.manualOrders !== undefined ? { manualOrders: saved.manualOrders } : {}),
          ...memoryPreferencesByDevice[deviceId],
        }
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [deviceId])
  const groupScopeKey = deviceId ? `${hostScope}:${deviceId}` : undefined
  const [groupsByDevice, setGroupsByDevice] = useState<Record<string, Record<string, boolean>>>(() => ({ ...memoryGroupsByDevice }))
  const [loadedDeviceId, setLoadedDeviceId] = useState<string | undefined>(() => (groupScopeKey && memoryGroupsByDevice[groupScopeKey] ? deviceId : undefined))
  const [groupStorageError, setGroupStorageError] = useState<string>()
  const groupsReady = deviceId === undefined || loadedDeviceId === deviceId
  const expandedWorkspaces = groupScopeKey === undefined ? {} : groupsByDevice[groupScopeKey] ?? {}
  useEffect(() => {
    if (deviceId === undefined || groupScopeKey === undefined) return
    let cancelled = false
    if (!memoryGroupsByDevice[groupScopeKey]) setLoadedDeviceId(undefined)
    setGroupStorageError(undefined)
    void loadHostSessionsDrawerGroups(deviceId).then(saved => {
      if (!cancelled) {
        const merged = { ...saved, ...memoryGroupsByDevice[groupScopeKey] }
        memoryGroupsByDevice[groupScopeKey] = merged
        setGroupsByDevice(current => ({
          ...current, [groupScopeKey]: { ...merged, ...current[groupScopeKey] },
        }))
      }
    }).catch(() => {
      if (!cancelled) setGroupStorageError(strings.comfort.cacheRestoreFailed)
    }).finally(() => {
      if (!cancelled) setLoadedDeviceId(deviceId)
    })
    return () => { cancelled = true }
  }, [deviceId, groupScopeKey])
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})

  // 浮窗定位：记录工具栏在覆盖层坐标系中的底部与右侧偏移（默认兜底，测量后精准对齐）
  const [popoverTop, setPopoverTop] = useState<number>(200)
  const [popoverRight, setPopoverRight] = useState<number>(POPOVER_RIGHT_INSET)
  const toolbarRef = useRef<View>(null)
  const containerRef = useRef<View>(null)

  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(createStyles)

  useEffect(() => {
    if (renameTarget) {
      setRenameDraft(renameTarget.currentTitle)
      setRenameError(null)
      setRenaming(false)
    } else {
      setRenameDraft('')
      setRenameError(null)
      setRenaming(false)
    }
  }, [renameTarget])

  useEffect(() => {
    if (!connected) {
      clearHandoffTimer()
      setMenuSession(null)
      setRenameTarget(null)
      setRenameError(null)
      setRenaming(false)
      setToastMessage(null)
    }
  }, [connected, clearHandoffTimer])

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 2000)
    return () => clearTimeout(timer)
  }, [toastMessage])

  // 打开浮窗时测量工具栏位置，确保浮窗紧贴工具栏下方并对齐居中列右缘
  useEffect(() => {
    if (!showConfigModal) return
    const raf = requestAnimationFrame(() => {
      if (!containerRef.current || !toolbarRef.current) return
      containerRef.current.measureInWindow((cx, cy, cw) => {
        toolbarRef.current?.measureInWindow((tx, ty, tw, th) => {
          if (typeof cy !== 'number' || typeof ty !== 'number' || typeof th !== 'number') return
          // 工具栏底部相对覆盖层顶部的偏移
          setPopoverTop(ty - cy + th + POPOVER_OFFSET)
          if (typeof cx === 'number' && typeof cw === 'number' && typeof tx === 'number' && typeof tw === 'number') {
            setPopoverRight(Math.max(POPOVER_RIGHT_INSET, (cx + cw) - (tx + tw) + POPOVER_RIGHT_INSET))
          }
        })
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [showConfigModal])

  const handleRefresh = async () => {
    if (refreshing || busy !== undefined) return
    if (!connected) {
      if (!devicesRefreshing) await refreshDevices()
      return
    }
    setRefreshing(true)
    try {
      if (drawerMode === 'bot') {
        await useBotTeamStore.getState().refresh(true)
      } else {
        await dispatchSessionCatalogCommand({ type: 'refresh-catalog', backend })
      }
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateSessionInWorkspace = async (workspace: WorkspaceView) => {
    const targetBackend = workspace.backend ?? backend
    const created = await createSession(workspace.workspaceId, targetBackend)
    if (created) {
      activateAgentMode()
      if (!inline) closeDrawer()
    }
  }

  const handleOpenFavorite = async (workspaceId: string, favBackend: AgentBackend) => {
    if (favBackend !== backend) {
      setBackend(favBackend)
      if (deviceId !== undefined) void saveWorkspaceBackend(deviceId, favBackend)
    }
    const matchedWs = workspaces.find(w => w.workspaceId === workspaceId && (w.backend ?? 'harness') === favBackend)
    if (matchedWs) {
      const wsSessions = sessions
        .filter(s => (s.backend ?? 'harness') === favBackend && matchedWs.sessionIds.includes(s.sessionId) && !archivedIds.includes(s.sessionId))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      if (wsSessions[0]) {
        activateAgentMode()
        if (!inline) gate.setActive(false)
        try {
          await onSelect(wsSessions[0])
          if (!inline) closeDrawer()
        } finally {
          if (!inline) releaseFreeze()
        }
        return
      }
    }
    const created = await createSession(workspaceId, favBackend)
    if (created) {
      activateAgentMode()
      if (!inline) closeDrawer()
    }
  }

  const confirmDeleteWorkspace = (target: WorkspaceView) => {
    Alert.alert(
      strings.workspaces.deleteTitle(target.title),
      strings.workspaces.deleteBody,
      [
        { text: strings.common.cancel, style: 'cancel' },
        {
          text: strings.workspaces.delete,
          style: 'destructive',
          onPress: () => {
            setWorkspaceActionTarget(undefined)
            void deleteWorkspace(target.workspaceId)
          },
        },
      ],
      // Keep the actions sheet mounted while the confirmation is open: closing
      // one Modal window while another fades in flickers on Android.
      { onDismiss: () => setWorkspaceActionTarget(undefined) },
    )
  }

  const hostFavorites = useMemo(
    () => (deviceId ? favoriteWorkspaces.filter(fav => fav.deviceId === deviceId) : []),
    [deviceId, favoriteWorkspaces],
  )
  const actionTargetIndex = workspaceActionTarget
    ? backendWorkspaces.findIndex(w => w.workspaceId === workspaceActionTarget.workspaceId)
    : -1
  const actionTargetFavorited = Boolean(
    deviceId && workspaceActionTarget && favoriteWorkspaces.some(
      fav => fav.deviceId === deviceId
        && fav.workspaceId === workspaceActionTarget.workspaceId
        && fav.backend === (workspaceActionTarget.backend ?? backend),
    ),
  )

  const toggleWorkspace = (id: string) => {
    if (deviceId === undefined || groupScopeKey === undefined) return
    const expanded = !(expandedWorkspaces[id] ?? false)
    memoryGroupsByDevice[groupScopeKey] = { ...memoryGroupsByDevice[groupScopeKey], [id]: expanded }
    setGroupsByDevice(current => ({ ...current,
      [groupScopeKey]: { ...current[groupScopeKey], [id]: expanded },
    }))
    void saveHostSessionsDrawerGroup(deviceId, id, expanded).catch(() => {
      if (useAppStore.getState().selectedDevice?.deviceId === deviceId) {
        setGroupStorageError(strings.comfort.cacheSaveFailed)
      }
    })
  }

  const botTeamState = useStoreGateSelector(useBotTeamStore, state => state.state, gate)

  const filteredSessions = useMemo(() => {
    const known = selected && !sessions.some(session => session.sessionId === selected.sessionId)
      ? [selected, ...sessions] : sessions
    let list = known.filter(session => (session.backend ?? 'harness') === backend
      && !isKnownBotSessionId(session.sessionId, botTeamState, hostScope)
      && isVisibleSession(session, selected?.sessionId, searchQuery))
    if (filterMode === 'hideArchived') {
      list = list.filter(s => !archivedSet.has(s.sessionId))
    } else if (filterMode === 'archivedOnly') {
      list = list.filter(s => archivedSet.has(s.sessionId))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(s => {
        const badge = resolveSessionHandoffBadge(s, handoffOrigins?.[s.sessionId])
        const title = resolveSessionDisplayTitle(s, badge?.origin) ?? ''
        const sourceName = badge?.sourceBackend ? harnessDisplayName(badge.sourceBackend) : ''
        return title.toLowerCase().includes(q) || sourceName.toLowerCase().includes(q)
      })
    }
    if (orderBy === 'updated') {
      list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    }
    return list
  }, [sessions, selected, backend, archivedSet, filterMode, searchQuery, orderBy, botTeamState, hostScope, handoffOrigins])

  const sections = useMemo<DrawerSection[]>(() => {
    const isRowPinned = (s: RemoteSession) => {
      const b = s.backend ?? 'harness'
      return (b === 'harness' || isAcpManagedBackend(b)) && pinnedSet.has(s.sessionId) && !archivedSet.has(s.sessionId)
    }
    const partitionPinned = (items: RemoteSession[]) => {
      const pinned: RemoteSession[] = []
      const ordinary: RemoteSession[] = []
      for (const s of items) {
        if (isRowPinned(s)) {
          pinned.push(s)
        } else {
          ordinary.push(s)
        }
      }
      return [...pinned, ...ordinary]
    }

    if (groupBy === 'list') {
      let ordered = filteredSessions
      if (orderBy === 'manual') {
        ordered = applyManualOrder(filteredSessions, manualOrders['all'])
      }
      const partitioned = partitionPinned(ordered)
      return [{ id: 'all', title: strings.sessions.allSessions, data: partitioned, total: partitioned.length, expanded: true, depth: 0 }]
    }
    const recentOrder = new Map(recentIds.map((id, index) => [id, index]))
    if (selected) recentOrder.set(selected.sessionId, recentIds.length)
    const recent = partitionPinned(
      filteredSessions
        .filter(session => recentOrder.has(session.sessionId))
        .sort((a, b) => recentOrder.get(b.sessionId)! - recentOrder.get(a.sessionId)!)
        .slice(0, 5),
    )
    const recentExpanded = expandedWorkspaces[`recent:${backend}`] ?? false
    const recentSections = recent.length ? [{ id: `recent:${backend}`, title: strings.comfort.recent,
      data: recentExpanded ? recent : [], total: recent.length, expanded: recentExpanded, depth: 0 }] : []
    const wsList: Array<WorkspaceView | { workspaceId: string; title: string; path: string; sessionIds: string[] }> =
      backendWorkspaces.length > 0 ? backendWorkspaces : [{ workspaceId: 'default', title: 'Default', path: '', sessionIds: [] }]

    if (groupBy === 'workspace') {
      const workspaceIdsBySession = new Map<string, string[]>()
      for (const w of backendWorkspaces) {
        const seenInWorkspace = new Set<string>()
        for (const sid of w.sessionIds) {
          if (seenInWorkspace.has(sid)) continue
          seenInWorkspace.add(sid)
          let owners = workspaceIdsBySession.get(sid)
          if (owners === undefined) {
            owners = []
            workspaceIdsBySession.set(sid, owners)
          }
          owners.push(w.workspaceId)
        }
      }
      const sessionsByWorkspace = new Map<string, RemoteSession[]>()
      const unassignedSessions: RemoteSession[] = []
      for (const s of filteredSessions) {
        const owners = workspaceIdsBySession.get(s.sessionId)
        if (owners === undefined || owners.length === 0) {
          unassignedSessions.push(s)
        } else {
          for (const wsId of owners) {
            let bucket = sessionsByWorkspace.get(wsId)
            if (bucket === undefined) {
              bucket = []
              sessionsByWorkspace.set(wsId, bucket)
            }
            bucket.push(s)
          }
        }
      }
      return [...recentSections, ...wsList.map(ws => {
        const isDefault = ws.workspaceId === 'default'
        let wsSessions = isDefault ? unassignedSessions : (sessionsByWorkspace.get(ws.workspaceId) ?? [])
        const groupId = `workspace:${backend}:${ws.workspaceId}`
        if (orderBy === 'manual') {
          wsSessions = applyManualOrder(wsSessions, manualOrders[groupId])
        }
        const partitioned = partitionPinned(wsSessions)
        const isExpanded = expandedWorkspaces[groupId] ?? false
        const limit = visibleCounts[groupId] ?? SESSION_PAGE_SIZE
        const title = ws.title || ws.path || ws.workspaceId
        return {
          id: groupId,
          title,
          total: partitioned.length,
          expanded: isExpanded,
          data: isExpanded ? partitioned.slice(0, limit) : [],
          depth: 0,
          workspaceId: ws.workspaceId,
        }
      })]
    }

    // groupBy === 'workspace-tree'
    const treeSections = buildTreeSections({
      backend,
      wsList,
      filteredSessions,
      backendWorkspaces,
      expandedWorkspaces,
      visibleCounts,
      manualOrders,
      orderBy,
      searchQuery,
      partitionPinned,
      pageSize: SESSION_PAGE_SIZE,
      defaultExpanded: false,
    })

    return [...recentSections, ...treeSections]
  }, [groupBy, backendWorkspaces, backend, filteredSessions, recentIds, selected, expandedWorkspaces, visibleCounts, language, pinnedSet, archivedSet, orderBy, manualOrders, searchQuery])

  const transientStateRef = useRef({
    menuSession,
    renameTarget,
    renameError,
    renaming,
    toastMessage,
    showConfigModal,
    harnessPickerOpen,
    appMenuOpen,
    dragState,
    showSearch,
    searchQuery,
    searchMounted,
    showBotSearch,
    botSearchQuery,
    createWorkspaceOpen,
    workspaceActionTarget,
    renameWorkspaceTarget,
  })
  transientStateRef.current = {
    menuSession,
    renameTarget,
    renameError,
    renaming,
    toastMessage,
    showConfigModal,
    harnessPickerOpen,
    appMenuOpen,
    dragState,
    showSearch,
    searchQuery,
    searchMounted,
    showBotSearch,
    botSearchQuery,
    createWorkspaceOpen,
    workspaceActionTarget,
    renameWorkspaceTarget,
  }

  const clearTransientOverlays = useCallback(() => {
    clearHandoffTimer()
    const state = transientStateRef.current
    if (state.menuSession !== null) setMenuSession(null)
    if (state.renameTarget !== null) setRenameTarget(null)
    if (state.renameError !== null) setRenameError(null)
    if (state.renaming) setRenaming(false)
    if (state.toastMessage !== null) setToastMessage(null)
  }, [clearHandoffTimer])

  const closeDrawer = useCallback(() => {
    clearTransientOverlays()
    onClose()
  }, [onClose, clearTransientOverlays])

  resetRef.current = () => {
    clearHandoffTimer()
    const state = transientStateRef.current
    if (state.menuSession !== null) setMenuSession(null)
    if (state.renameTarget !== null) setRenameTarget(null)
    if (state.renameError !== null) setRenameError(null)
    if (state.renaming) setRenaming(false)
    if (state.toastMessage !== null) setToastMessage(null)
    if (state.showConfigModal) setShowConfigModal(false)
    if (state.harnessPickerOpen) setHarnessPickerOpen(false)
    if (state.appMenuOpen) setAppMenuOpen(false)
    if (state.dragState !== null) setDragState(null)
    if (state.showSearch) setShowSearch(false)
    if (state.searchQuery !== '') setSearchQuery('')
    if (state.searchMounted) {
      setSearchMounted(false)
      searchMotion.setValue(0)
    } else if (state.showSearch) {
      searchMotion.setValue(0)
    }
    if (state.showBotSearch) setShowBotSearch(false)
    if (state.botSearchQuery !== '') setBotSearchQuery('')
    if (state.createWorkspaceOpen) setCreateWorkspaceOpen(false)
    if (state.workspaceActionTarget !== undefined) setWorkspaceActionTarget(undefined)
    if (state.renameWorkspaceTarget !== undefined) setRenameWorkspaceTarget(undefined)
  }

  backOverlayRef.current = () => {
    const state = transientStateRef.current
    if (state.showConfigModal) {
      setShowConfigModal(false)
      return true
    }
    if (state.showSearch) {
      setShowSearch(false)
      if (state.searchQuery !== '') setSearchQuery('')
      return true
    }
    if (state.showBotSearch) {
      setShowBotSearch(false)
      if (state.botSearchQuery !== '') setBotSearchQuery('')
      return true
    }
    return false
  }

  useEffect(() => () => {
    resetRef.current = undefined
    backOverlayRef.current = undefined
  }, [resetRef, backOverlayRef])

  useEffect(() => {
    if (!showSearch && !transientStateRef.current.searchMounted) return
    if (showSearch) setSearchMounted(true)
    const animation = Animated.timing(searchMotion, {
      toValue: showSearch ? 1 : 0,
      duration: reduceMotion
        ? Math.min(motionTokens.duration.sheetExit, motionTokens.duration.reduced)
        : motionTokens.duration.sheetExit,
      easing: Easing.bezier(...easingCurve(showSearch ? 'expand' : 'retreat')),
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished && !showSearch) setSearchMounted(false)
    })
    return () => animation.stop()
  }, [showSearch, searchMotion, reduceMotion])

  useEffect(() => {
    if (!showConfigModal) return
    configMotion.setValue(0)
    const animation = Animated.timing(configMotion, {
      toValue: 1,
      duration: resolveMotion('micro', reduceMotion).duration,
      easing: Easing.bezier(...easingCurve('expand')),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [showConfigModal, configMotion, reduceMotion])

  const listCtxRef = useRef({
    dragState,
    botMode,
    onSelect,
    searchQuery,
    sections,
    pinnedSet,
    archivedSet,
    sessions,
    backend,
    groupBy,
    backendWorkspaces,
    orderBy,
    manualOrders,
    updateManualOrders,
    toggleWorkspace,
    handleCreateSessionInWorkspace,
    handleRefresh,
    handleOpenFavorite,
    removeFavoriteWorkspace,
  })
  listCtxRef.current = {
    dragState,
    botMode,
    onSelect,
    searchQuery,
    sections,
    pinnedSet,
    archivedSet,
    sessions,
    backend,
    groupBy,
    backendWorkspaces,
    orderBy,
    manualOrders,
    updateManualOrders,
    toggleWorkspace,
    handleCreateSessionInWorkspace,
    handleRefresh,
    handleOpenFavorite,
    removeFavoriteWorkspace,
  }

  const handleRowPress = useCallback((item: RemoteSession, isSelected: boolean) => {
    const ctx = listCtxRef.current
    if (justDraggedRef.current || ctx.dragState !== null) return
    if (isSelected && !ctx.botMode) {
      if (inline) {
        closeDrawer()
      } else {
        smoothClose(true, true, true)
      }
    } else {
      if (!inline) gate.setActive(false)
      let pending: Promise<void> | undefined
      try {
        pending = ctx.onSelect(item)
      } catch {
        if (!inline) releaseFreeze()
        return
      }
      void Promise.resolve(pending)
        .catch(() => undefined)
        .finally(() => {
          if (!inline) releaseFreeze()
        })
    }
  }, [inline, gate, closeDrawer, smoothClose, releaseFreeze])

  const handleRowLongPress = useCallback((
    item: RemoteSession,
    sectionId: string,
    accountKey: string,
    index: number,
    isPinned: boolean,
  ) => {
    if (listCtxRef.current.searchQuery.trim() || sectionId.startsWith('recent:')) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
      setMenuSession(item)
      return
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
    setDragState({
      sessionId: item.sessionId,
      sectionId,
      accountKey,
      fromIndex: index,
      overIndex: index,
      isPinned,
    })
    dragActiveRef.current = true
  }, [dragActiveRef])

  const handleRowTouchStart = useCallback((pageY: number) => {
    touchStartY.current = pageY
  }, [])

  const handleRowTouchMove = useCallback((item: RemoteSession, sectionId: string, pageY: number) => {
    const ctx = listCtxRef.current
    const activeDrag = ctx.dragState
    if (!dragActiveRef.current || !activeDrag || activeDrag.sessionId !== item.sessionId) return
    const section = ctx.sections.find(s => s.id === sectionId)
    if (!section) return
    const dy = pageY - touchStartY.current
    const rowHeight = 46
    const deltaSlots = Math.round(dy / rowHeight)
    const pinnedCount = section.data.filter(s => {
      const b = s.backend ?? 'harness'
      return (b === 'harness' || isAcpManagedBackend(b)) && ctx.pinnedSet.has(s.sessionId) && !ctx.archivedSet.has(s.sessionId)
    }).length
    const minSlot = activeDrag.isPinned ? 0 : pinnedCount
    const maxSlot = activeDrag.isPinned ? Math.max(0, pinnedCount - 1) : Math.max(minSlot, section.data.length - 1)
    const newIndex = Math.max(minSlot, Math.min(maxSlot, activeDrag.fromIndex + deltaSlots))
    if (newIndex !== activeDrag.overIndex) {
      setDragState(curr => curr ? { ...curr, overIndex: newIndex } : null)
    }
  }, [dragActiveRef])

  const handleRowTouchEnd = useCallback((item: RemoteSession, sectionId: string, isPinned: boolean) => {
    const ctx = listCtxRef.current
    const activeDrag = ctx.dragState
    if (dragActiveRef.current && activeDrag && activeDrag.sessionId === item.sessionId) {
      justDraggedRef.current = true
      setTimeout(() => { justDraggedRef.current = false }, 250)
      dragActiveRef.current = false
      setDragState(null)
      const { fromIndex, overIndex, accountKey: currentAccountKey } = activeDrag
      const section = ctx.sections.find(s => s.id === sectionId)
      if (fromIndex !== overIndex && section) {
        const targetSession = section.data[overIndex]
        const targetBackend = targetSession?.backend ?? 'harness'
        const targetIsPinned = !!targetSession
          && (targetBackend === 'harness' || isAcpManagedBackend(targetBackend))
          && ctx.pinnedSet.has(targetSession.sessionId)
          && !ctx.archivedSet.has(targetSession.sessionId)
        if (targetSession && targetIsPinned === isPinned) {
          const allGroupSessions = ctx.sessions.filter(s => {
            if ((s.backend ?? 'harness') !== ctx.backend) return false
            if (ctx.groupBy === 'list') return true
            const isDefault = section.workspaceId === 'default'
            return isDefault
              ? !ctx.backendWorkspaces.some(w => w.sessionIds.includes(s.sessionId))
              : section.workspaceId ? ctx.backendWorkspaces.find(w => w.workspaceId === section.workspaceId)?.sessionIds.includes(s.sessionId) : false
          })
          if (ctx.orderBy === 'updated') {
            allGroupSessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
          }
          const baselineSessions = ctx.orderBy === 'manual'
            ? applyManualOrder(allGroupSessions, ctx.manualOrders[currentAccountKey])
            : allGroupSessions
          const fullIds = baselineSessions.map(s => s.sessionId)
          const direction = fromIndex < overIndex ? 'after' : 'before'
          const next = reorderSessionIds(fullIds, item.sessionId, targetSession.sessionId, direction)
          ctx.updateManualOrders(currentAccountKey, next, ctx.orderBy === 'updated')
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
        }
      }
    }
  }, [dragActiveRef])

  const handleRowTouchCancel = useCallback(() => {
    dragActiveRef.current = false
    if (listCtxRef.current.dragState !== null) setDragState(null)
  }, [dragActiveRef])

  const handleRowMorePress = useCallback((item: RemoteSession) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
    setMenuSession(item)
  }, [])

  const handleToggleWorkspace = useCallback((sectionId: string) => {
    listCtxRef.current.toggleWorkspace(sectionId)
  }, [])

  const handleWorkspaceLongPress = useCallback((workspace: WorkspaceView) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
    setWorkspaceActionsEverOpened(true)
    setWorkspaceActionTarget(workspace)
  }, [])

  const handleWorkspaceCreateSession = useCallback((workspace: WorkspaceView) => {
    void listCtxRef.current.handleCreateSessionInWorkspace(workspace)
  }, [])

  const handleShowMoreSessions = useCallback((countKey: string) => {
    setVisibleCounts(c => ({
      ...c,
      [countKey]: (c[countKey] ?? SESSION_PAGE_SIZE) + SESSION_PAGE_SIZE,
    }))
  }, [])

  const handleRefreshStable = useCallback(() => {
    void listCtxRef.current.handleRefresh()
  }, [])

  const isListRefreshing = connected ? refreshing : devicesRefreshing
  const listRefreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={isListRefreshing}
        onRefresh={handleRefreshStable}
        tintColor={colors.primary}
        colors={[colors.primary]}
      />
    ),
    [isListRefreshing, handleRefreshStable, colors.primary],
  )

  const listHeaderComponent = useMemo(
    () =>
      hostFavorites.length > 0 ? (
        <View style={styles.favoritesWrap}>
          <SectionTitle>{strings.devices.favorites}</SectionTitle>
          <GroupCard>
            {hostFavorites.map((fav, idx) => (
              <GroupRow
                key={fav.key}
                first={idx === 0}
                icon={Star}
                label={fav.title}
                detail={fav.path || undefined}
                onPress={() => void listCtxRef.current.handleOpenFavorite(fav.workspaceId, fav.backend)}
                accessory={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.devices.removeFavorite(fav.title)}
                    hitSlop={8}
                    onPress={e => {
                      e.stopPropagation()
                      void listCtxRef.current.removeFavoriteWorkspace(fav.deviceId, fav.key)
                    }}
                    style={styles.workspaceSmallBtn}
                  >
                    <X size={14} color={colors.muted} />
                  </Pressable>
                }
              />
            ))}
          </GroupCard>
        </View>
      ) : null,
    [hostFavorites, language, styles, colors.muted],
  )

  const listEmptyComponent = useMemo(
    () => (groupsReady ? null : <ActivityIndicator color={colors.muted} accessibilityLabel={strings.workspaces.loading} />),
    [groupsReady, language, colors.muted],
  )

  const renderSectionHeader = useCallback(
    ({ section }: { section: DrawerSection }) => {
      if (groupBy === 'list' || !section.title) return null
      const isExp = section.expanded
      const hasItems = isExp && section.data.length > 0
      const depth = section.depth ?? 0
      const matchedWorkspace = section.workspaceId && section.workspaceId !== 'default'
        ? backendWorkspaceById.get(section.workspaceId)
        : undefined
      return (
        <WorkspaceSectionHeader
          sectionId={section.id}
          title={section.title}
          total={section.total}
          expanded={isExp}
          hasItems={hasItems}
          depth={depth}
          workspace={matchedWorkspace}
          language={language}
          styles={styles}
          colors={colors}
          onToggle={handleToggleWorkspace}
          onLongPress={handleWorkspaceLongPress}
          onCreateSession={handleWorkspaceCreateSession}
        />
      )
    },
    [
      groupBy,
      backendWorkspaceById,
      language,
      styles,
      colors,
      handleToggleWorkspace,
      handleWorkspaceLongPress,
      handleWorkspaceCreateSession,
    ],
  )

  const renderSectionFooter = useCallback(
    ({ section }: { section: DrawerSection }) => {
      if (groupBy === 'list' || !section.expanded || section.hasMoreFooter === false || section.data.length >= section.total) return null
      const remaining = section.total - section.data.length
      const countKey = section.workspaceId ? `workspace:${backend}:${section.workspaceId}` : section.id
      const depth = section.depth ?? 0
      return (
        <WorkspaceSectionFooter
          countKey={countKey}
          remaining={remaining}
          depth={depth}
          language={language}
          styles={styles}
          onShowMore={handleShowMoreSessions}
        />
      )
    },
    [groupBy, backend, language, styles, handleShowMoreSessions],
  )

  const selectedSessionId = selected?.sessionId
  const renderItem = useCallback(
    ({ item, section, index }: { item: RemoteSession; section: DrawerSection; index: number }) => {
      const isSelected = item.sessionId === selectedSessionId && !section.id.startsWith('recent:')
      const hasFooter = groupBy !== 'list' && section.expanded && section.hasMoreFooter !== false && section.data.length < section.total
      const isFirstInList = groupBy === 'list' && index === 0
      const isLastInCard = index === section.data.length - 1 && !hasFooter
      const isRunning = browseStatus(item, lifecycles[item.sessionId]) === 'running'
      const isHarness = (item.backend ?? 'harness') === 'harness'
      const canPin = isHarness || isAcpManagedBackend(item.backend ?? 'harness')
      const isPinned = canPin && pinnedSet.has(item.sessionId) && !archivedSet.has(item.sessionId)
      const isArchived = isHarness && archivedSet.has(item.sessionId)
      const timeStr = formatRelativeTime(item.updatedAt)
      const depth = section.depth ?? 0
      const accountKey = section.workspaceId ? `workspace:${backend}:${section.workspaceId}` : section.id
      const isDragging = dragState?.sessionId === item.sessionId && dragState.sectionId === section.id
      const isDragTarget = dragState !== null && dragState.sectionId === section.id && dragState.overIndex === index && !isDragging && isPinned === dragState.isPinned
      const dropAbove = isDragTarget && dragState.fromIndex > index
      const dropBelow = isDragTarget && dragState.fromIndex < index
      const handoffBadge = resolveSessionHandoffBadge(item, handoffOrigins?.[item.sessionId])
      const displayTitle = resolveSessionDisplayTitle(item, handoffBadge?.origin) ?? strings.sessions.untitled
      const handoffSourceLabel = handoffBadge === undefined
        ? undefined
        : handoffBadge.sourceBackend !== undefined
          ? harnessDisplayName(handoffBadge.sourceBackend)
          : ''

      return (
        <SessionListRow
          item={item}
          displayTitle={displayTitle}
          handoffSourceLabel={handoffSourceLabel}
          sectionId={section.id}
          accountKey={accountKey}
          index={index}
          isSelected={isSelected}
          isFirstInList={isFirstInList}
          isLastInCard={isLastInCard}
          attentionStatus={attentionStatusBySession.get(item.sessionId) ?? (isRunning ? 'running' : undefined)}
          scheme={scheme}
          isPinned={isPinned}
          isArchived={isArchived}
          depth={depth}
          isDragging={isDragging}
          dropAbove={dropAbove}
          dropBelow={dropBelow}
          timeStr={timeStr}
          language={language}
          styles={styles}
          colors={colors}
          onPress={handleRowPress}
          onLongPress={handleRowLongPress}
          onTouchStart={handleRowTouchStart}
          onTouchMove={handleRowTouchMove}
          onTouchEnd={handleRowTouchEnd}
          onTouchCancel={handleRowTouchCancel}
          onMorePress={handleRowMorePress}
        />
      )
    },
    [
      attentionStatusBySession,
      scheme,
      selectedSessionId,
      groupBy,
      lifecycles,
      pinnedSet,
      archivedSet,
      backend,
      handoffOrigins,
      dragState,
      language,
      styles,
      colors,
      handleRowPress,
      handleRowLongPress,
      handleRowTouchStart,
      handleRowTouchMove,
      handleRowTouchEnd,
      handleRowTouchCancel,
      handleRowMorePress,
    ],
  )

  const closeConfig = () => setShowConfigModal(false)

  /** 排序配置浮窗（在覆盖层内部渲染，供点击命中） */
  const configPopover = (
    <Animated.View
      style={[
        styles.configPopover,
        { top: popoverTop, right: popoverRight },
        {
          opacity: configMotion,
          transform: [{ translateY: configMotion.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
        },
      ]}
    >
      <Text style={styles.modalSectionLabel}>{strings.sessions.groupBy}</Text>
      <Pressable style={styles.modalItem} onPress={() => { updateGroupBy('workspace'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.groupByWorkspace}</Text>
        {groupBy === 'workspace' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { updateGroupBy('workspace-tree'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.groupByWorkspaceTree}</Text>
        {groupBy === 'workspace-tree' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { updateGroupBy('list'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.groupByList}</Text>
        {groupBy === 'list' && <Check size={14} color={colors.ink} />}
      </Pressable>

      <View style={styles.modalDivider} />

      <Text style={styles.modalSectionLabel}>{strings.sessions.orderBy}</Text>
      <Pressable style={styles.modalItem} onPress={() => { updateOrderBy('manual'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.orderManual}</Text>
        {orderBy === 'manual' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { updateOrderBy('updated'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.orderUpdated}</Text>
        {orderBy === 'updated' && <Check size={14} color={colors.ink} />}
      </Pressable>

      <View style={styles.modalDivider} />

      <Text style={styles.modalSectionLabel}>{strings.sessions.filterSessions}</Text>
      <Pressable style={styles.modalItem} onPress={() => { updateFilterMode('hideArchived'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.filterHideArchived}</Text>
        {filterMode === 'hideArchived' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { updateFilterMode('all'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.filterAll}</Text>
        {filterMode === 'all' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { updateFilterMode('archivedOnly'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.filterArchivedOnly}</Text>
        {filterMode === 'archivedOnly' && <Check size={14} color={colors.ink} />}
      </Pressable>
    </Animated.View>
  )

  const hostStatusDotColor = connectionPhase === 'connected'
    ? colors.success
    : connectionPhase === 'connecting' || connectionPhase === 'reconnecting'
      ? colors.warning
      : colors.disabled
  const hostStatusLabel = connectionPhase === 'connected'
    ? strings.status.online
    : connectionPhase === 'connecting' || connectionPhase === 'reconnecting'
      ? strings.status.waiting
      : strings.status.offline
  const FooterHostIcon = platform === 'win32' ? Monitor : platform === 'linux' ? Server : Laptop
  const hostFooterDeviceInfo = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${deviceName ?? strings.devices.title} · ${strings.devices.openInfo}`}
        disabled={connectionPhase !== 'connected' || onOpenDeviceInfo === undefined}
        android_ripple={androidRipple(colors)}
        onPress={() => {
          Keyboard.dismiss()
          onOpenDeviceInfo?.()
        }}
        hitSlop={4}
        style={({ pressed }) => [styles.hostFooterIcon, pressed && styles.pressedBg]}
      >
        <FooterHostIcon size={17} color={colors.ink} strokeWidth={1.8} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${deviceName ?? strings.devices.title} · ${strings.remoteHosts.switchTitle}`}
        disabled={onOpenHostSwitcher === undefined}
        android_ripple={androidRipple(colors)}
        onPress={() => { Keyboard.dismiss(); onOpenHostSwitcher?.() }}
        hitSlop={4}
        style={({ pressed }) => [styles.hostFooterInfo, pressed && styles.pressedBg]}
      >
        <View style={styles.hostFooterNameRow}>
          <Text numberOfLines={1} style={styles.hostFooterName}>{deviceName ?? strings.devices.title}</Text>
        </View>
        <View style={styles.hostFooterStatusRow}>
          <View style={[styles.hostFooterDot, { backgroundColor: hostStatusDotColor }]} />
          <Text numberOfLines={1} style={styles.hostFooterStatusText}>{hostStatusLabel}</Text>
        </View>
        {onOpenHostSwitcher !== undefined && <ChevronsUpDown size={13} color={colors.muted} strokeWidth={1.8} />}
      </Pressable>
    </>
  )

  const content = (
    <View ref={containerRef} style={styles.container} collapsable={false}>
      <View style={[styles.container, fullWidthCentered && styles.centeredColumn]}>
      {/* 品牌顶部区 */}
      <View style={styles.brandHeader}>
        <View style={styles.brandGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`DS Harness Remote · ${strings.settings.about}`}
            disabled={onOpenAbout === undefined}
            onPress={() => {
              Keyboard.dismiss()
              onOpenAbout?.()
            }}
            hitSlop={{ top: 6, left: 6, right: 6 }}
            style={({ pressed }) => [styles.brandLeft, pressed && styles.pressedFade]}
          >
            <Svg
              width={22}
              height={(22 * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
              viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
              accessible={false}
            >
              <Path d={FISH_LOGO_PATH} fill={colors.ink} />
            </Svg>
            <Text style={styles.brandTitle} numberOfLines={1}>DS Harness Remote</Text>
          </Pressable>
          {!membershipLinkHidden && <>
            <Pressable accessibilityRole="link" onPress={() => void openMembershipPlan()}
              style={({ pressed }) => [styles.membershipLink, pressed && styles.pressedFade]}>
              <Text numberOfLines={1} style={styles.membershipText}>{strings.settings.membership.plan}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={strings.settings.membership.hideLink}
              onPress={() => void useAppStore.getState().hideMembershipLink().catch(() => setGroupStorageError(strings.comfort.cacheSaveFailed))}
              style={({ pressed }) => [styles.dismissMembership, pressed && styles.pressedFade]}>
              <X size={13} color={colors.muted} />
            </Pressable>
          </>}
        </View>
        <View style={styles.brandRight}>
          {onOpenSettings !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.settings.more}
              onPress={() => { Keyboard.dismiss(); setAppMenuOpen(true) }}
              hitSlop={8}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressedFade]}
            >
              <MoreVertical size={18} color={colors.ink} strokeWidth={1.9} />
            </Pressable>
          )}
          {showBackButton && (
            <Pressable accessibilityRole="button" accessibilityLabel={backLabel ?? strings.chat.backToChat} onPress={onHeaderBack} hitSlop={8} style={({ pressed }) => [styles.iconBtnRound, pressed && styles.pressedBg]}>
              <ArrowLeft size={18} color={colors.ink} strokeWidth={1.9} />
            </Pressable>
          )}
        </View>
      </View>

      {!connected && error !== undefined && (
        <ErrorBanner
          message={error}
          onRetry={() => void refreshDevices()}
          onDismiss={clearError}
        />
      )}

      {/* 顶部模式切换底线页签：智能体 / DS-Bot */}
      <View
        style={styles.modeSwitcherWrap}
        onLayout={event => setModeTrackWidth(event.nativeEvent.layout.width)}
      >
        {modeStart.width > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.modeSwitcherIndicator,
              {
                width: modeStart.width,
                transform: [
                  { translateX: modeIndicator.interpolate({
                    inputRange: [0, 1],
                    outputRange: [modeStart.x, modeEnd.x],
                  }) },
                ],
              },
            ]}
          >
            <View style={styles.modeSwitcherIndicatorBar} />
          </Animated.View>
        )}
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: drawerMode === 'agent' }}
          accessibilityLabel={strings.sessions.agentsTab}
          onPress={() => handleSwitchMode('agent')}
          style={({ pressed }) => [
            styles.modeSwitcherTab,
            pressed && styles.pressedFade,
          ]}
        >
          <LayoutGrid size={15} color={drawerMode === 'agent' ? colors.ink : colors.muted} strokeWidth={2} />
          <Text style={[styles.modeSwitcherText, drawerMode === 'agent' && styles.modeSwitcherTextActive]}>
            {strings.sessions.agentsTab}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: drawerMode === 'bot' }}
          accessibilityLabel="DS-Bot"
          onPress={() => handleSwitchMode('bot')}
          style={({ pressed }) => [
            styles.modeSwitcherTab,
            pressed && styles.pressedFade,
          ]}
        >
          <Bot size={15} color={drawerMode === 'bot' ? colors.ink : colors.muted} strokeWidth={2} />
          <Text style={[styles.modeSwitcherText, drawerMode === 'bot' && styles.modeSwitcherTextActive]}>
            DS-Bot
          </Text>
        </Pressable>
      </View>

      {drawerMode === 'bot' ? (
        <BotSidebarSection
          refreshing={isListRefreshing}
          onRefresh={handleRefreshStable}
          searchQuery={botSearchQuery}
          onSearchChange={setBotSearchQuery}
          showSearch={showBotSearch}
          onSelectBot={id => {
            saveHostMode(hostScope, 'bot')
            onBotModeChange?.(true)
            if (!inline) gate.setActive(false)
            try {
              useBotTeamStore.getState().setSelectedId(id)
              onSelectBot?.(id)
              if (inline) {
                closeDrawer()
              } else {
                clearTransientOverlays()
                smoothClose(false, true, true)
              }
            } finally {
              if (!inline) releaseFreeze()
            }
          }}
        />
      ) : (
        <>
          {/* Workspaces 标题栏与平台筛选、工具栏 */}
          <View ref={toolbarRef} style={styles.workspacesToolbarArea} collapsable={false}>
            <View style={styles.workspacesToolbar}>
              <View style={styles.workspacesTitleGroup}>
                <Text style={styles.workspacesTitle} numberOfLines={1}>{strings.sessions.workspaces}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.sessions.agentPlatform} · ${harnessDisplayName(backend)}`}
                  hitSlop={6}
                  onPress={() => {
                    setHarnessPickerEverOpened(true)
                    setHarnessPickerOpen(true)
                  }}
                  style={({ pressed }) => [styles.platformChip, pressed && styles.pressedFade]}
                >
                  <Text style={styles.platformChipText} numberOfLines={1}>{harnessDisplayName(backend)}</Text>
                  <ChevronDown size={13} color={colors.muted} strokeWidth={2.1} />
                </Pressable>
              </View>
              <View style={styles.toolbarActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.comfort.search}
                  hitSlop={6}
                  onPress={() => setShowSearch(prev => !prev)}
                  style={styles.iconBtn}
                >
                  <Search size={17} color={showSearch ? colors.ink : colors.muted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.sessions.viewOptions}
                  hitSlop={6}
                  onPress={() => setShowConfigModal(prev => !prev)}
                  style={styles.iconBtn}
                >
                  <Sliders size={17} color={showConfigModal ? colors.ink : colors.muted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.sessions.addWorkspace}
                  hitSlop={6}
                  onPress={() => {
                    setCreateWorkspaceEverOpened(true)
                    setCreateWorkspaceOpen(true)
                  }}
                  style={styles.iconBtn}
                >
                  <FolderPlus size={17} color={colors.muted} />
                </Pressable>
              </View>
            </View>
          </View>

          {/* 搜索框 */}
          {searchMounted && (
            <Animated.View
              style={[styles.searchContainer, {
                opacity: searchMotion,
                transform: [{ translateY: searchMotion.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
              }]}
            >
              <Search size={16} color={colors.muted} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={strings.comfort.search}
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                autoFocus
              />
            </Animated.View>
          )}

          {groupStorageError && <Text accessibilityRole="alert" style={{ color: colors.muted, paddingHorizontal: spacing.md }}>{groupStorageError}</Text>}
          {/* 会话树状列表 */}
          <SectionList<RemoteSession, DrawerSection>
            refreshControl={listRefreshControl}
            alwaysBounceVertical
            scrollEnabled={dragState === null}
            sections={groupsReady ? sections : EMPTY_SECTIONS}
            ListHeaderComponent={listHeaderComponent}
            ListEmptyComponent={listEmptyComponent}
            keyExtractor={sessionKeyExtractor}
            keyboardShouldPersistTaps="handled"
            style={styles.sectionList}
            contentContainerStyle={styles.listContainer}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={renderSectionHeader}
            renderSectionFooter={renderSectionFooter}
            renderItem={renderItem}
          />
        </>
      )}

      {/* 底部常驻栏：左侧当前远程主机状态与切换入口，右侧收件箱入口与设置按钮 */}
      <View style={styles.hostFooterBar}>
        <View style={styles.hostFooterLeft}>{hostFooterDeviceInfo}</View>
        {(((connected || hasTrustedHost) && onOpenAttentionInbox !== undefined) || onOpenSettings !== undefined) && (
          <View style={styles.hostFooterRight}>
            {(connected || hasTrustedHost) && onOpenAttentionInbox !== undefined && (
              <AttentionInboxPill
                onPress={() => {
                  Keyboard.dismiss()
                  onOpenAttentionInbox()
                }}
              />
            )}
            {onOpenSettings !== undefined && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.settings.title}
                android_ripple={androidRipple(colors, true)}
                onPress={() => {
                  Keyboard.dismiss()
                  onOpenSettings()
                }}
                hitSlop={8}
                style={({ pressed }) => [styles.footerSettingsBtn, pressed && styles.pressedBg]}
              >
                <Settings size={17} color={colors.ink} strokeWidth={1.9} />
              </Pressable>
            )}
          </View>
        )}
      </View>
      </View>

      {/* 会话上下文操作浮层/菜单 */}
      {menuSession && (
        <Modal
          transparent
          animationType="fade"
          visible={true}
          onRequestClose={() => setMenuSession(null)}
          statusBarTranslucent
        >
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuSession(null)}>
            <View style={styles.contextMenuCard} onStartShouldSetResponder={() => true}>
              <View style={styles.menuHeader}>
                <Text style={styles.menuTitle} numberOfLines={1}>
                  {resolveSessionDisplayTitle(menuSession, handoffOrigins?.[menuSession.sessionId]) ?? strings.sessions.untitled}
                </Text>
              </View>

              {canPinSession && (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={menuIsPinned ? strings.sessions.unpinSession : strings.sessions.pinSession}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.pressedBg]}
                  onPress={async () => {
                    const sid = menuSession.sessionId
                    const targetBackend = menuSession.backend
                    setMenuSession(null)
                    if (menuIsPinned) {
                      const ok = await unpinSession(sid, targetBackend)
                      if (!ok) setToastMessage(strings.sessions.unpinFailed)
                    } else {
                      const ok = await pinSession(sid, targetBackend)
                      if (!ok) setToastMessage(strings.sessions.pinFailed)
                    }
                  }}
                >
                  {menuIsPinned ? (
                    <OfficialMenuIcons.pinFill size={16} color={colors.ink} />
                  ) : (
                    <OfficialMenuIcons.pin size={16} color={colors.ink} />
                  )}
                  <Text style={styles.menuItemText}>
                    {menuIsPinned ? strings.sessions.unpinSession : strings.sessions.pinSession}
                  </Text>
                </Pressable>
              )}

              {canUseHarnessActions && (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={strings.sessions.renameSession}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.pressedBg]}
                  onPress={() => {
                    const target = {
                      sessionId: menuSession.sessionId,
                      currentTitle: resolveSessionDisplayTitle(menuSession, handoffOrigins?.[menuSession.sessionId]) ?? '',
                      backend: menuSession.backend,
                    }
                    setMenuSession(null)
                    setRenameError(null)
                    setRenameTarget(target)
                  }}
                >
                  <OfficialMenuIcons.edit size={16} color={colors.ink} />
                  <Text style={styles.menuItemText}>{strings.sessions.renameSession}</Text>
                </Pressable>
              )}

              {menuSession && (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={strings.sessions.forkSession}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.pressedBg]}
                  onPress={async () => {
                    const sid = menuSession.sessionId
                    const targetBackend = menuSession.backend
                    setMenuSession(null)
                    const created = await forkSession(sid, targetBackend)
                    if (created) {
                      closeDrawer()
                    }
                  }}
                >
                  <OfficialMenuIcons.fork size={16} color={colors.ink} />
                  <Text style={styles.menuItemText}>{strings.sessions.forkSession}</Text>
                </Pressable>
              )}

              {connected && onHandoffSession !== undefined && !isSubagentSession(menuSession) && menuSession.blank !== true && (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={strings.handoff.action}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.pressedBg]}
                  onPress={() => {
                    const targetSession = menuSession
                    const menuWorkspace = workspaces.find(w => w.sessionIds.includes(targetSession.sessionId))
                    setMenuSession(null)
                    if (Platform.OS === 'ios') {
                      if (handoffTimerRef.current !== undefined) clearTimeout(handoffTimerRef.current)
                      handoffTimerRef.current = setTimeout(() => {
                        handoffTimerRef.current = undefined
                        onHandoffSession(targetSession, menuWorkspace)
                      }, 80)
                    } else {
                      onHandoffSession(targetSession, menuWorkspace)
                    }
                  }}
                >
                  <ArrowRightLeft size={16} color={colors.ink} />
                  <Text style={styles.menuItemText}>{strings.handoff.action}</Text>
                </Pressable>
              )}

              {canUseHarnessActions && (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={menuIsArchived ? strings.sessions.unarchiveSession : strings.sessions.archiveSession}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.pressedBg]}
                  onPress={async () => {
                    const sid = menuSession.sessionId
                    const wasArchived = menuIsArchived
                    const isCurrent = sid === selected?.sessionId
                    setMenuSession(null)
                    if (wasArchived) {
                      const ok = await unarchiveSession(sid, menuSession.backend)
                      if (!ok) setToastMessage(strings.sessions.unarchiveFailed)
                    } else {
                      const ok = await archiveSession(sid)
                      if (!ok) {
                        setToastMessage(strings.sessions.archiveFailed)
                      } else if (isCurrent) {
                        closeDrawer()
                      }
                    }
                  }}
                >
                  {menuIsArchived ? (
                    <OfficialMenuIcons.unarchive size={16} color={colors.ink} />
                  ) : (
                    <OfficialMenuIcons.archive size={16} color={colors.ink} />
                  )}
                  <Text style={styles.menuItemText}>
                    {menuIsArchived ? strings.sessions.unarchiveSession : strings.sessions.archiveSession}
                  </Text>
                </Pressable>
              )}

              {/* 复制 Session ID 对所有会话可用 */}
              <Pressable
                accessibilityRole="menuitem"
                accessibilityLabel={strings.sessions.copySessionId}
                style={({ pressed }) => [styles.menuItem, pressed && styles.pressedBg]}
                onPress={async () => {
                  const sid = menuSession.sessionId
                  setMenuSession(null)
                  try {
                    await Clipboard.setStringAsync(sid)
                    setToastMessage(strings.sessions.sessionIdCopied)
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
                  } catch {
                    setToastMessage(strings.sessions.copyFailed)
                  }
                }}
              >
                <OfficialMenuIcons.copy size={16} color={colors.ink} />
                <Text style={styles.menuItemText}>{strings.sessions.copySessionId}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      )}

      {/* 重命名模态弹窗 */}
      {renameTarget && (
        <Modal
          transparent
          animationType="fade"
          visible={true}
          onRequestClose={() => {
            if (!renaming) {
              setRenameTarget(null)
              setRenameError(null)
            }
          }}
          statusBarTranslucent
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.renameBackdrop}
          >
            <View style={styles.renameCard}>
              <Text style={styles.renameModalTitle}>{strings.sessions.renameSessionTitle}</Text>
              <TextInput
                value={renameDraft}
                onChangeText={(text) => {
                  setRenameDraft(text)
                  if (renameError) setRenameError(null)
                }}
                placeholder={strings.sessions.renamePlaceholder}
                placeholderTextColor={colors.muted}
                style={styles.renameInput}
                autoFocus
                selectTextOnFocus
                editable={!renaming}
                accessibilityLabel={strings.sessions.renameSessionTitle}
              />
              {renameError ? (
                <Text accessibilityRole="alert" style={styles.renameErrorText}>
                  {renameError}
                </Text>
              ) : null}
              <View style={styles.renameButtonRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.common.cancel}
                  disabled={renaming}
                  onPress={() => {
                    setRenameTarget(null)
                    setRenameError(null)
                  }}
                  style={({ pressed }) => [styles.renameCancelBtn, pressed && styles.pressedBg]}
                >
                  <Text style={styles.renameCancelText}>{strings.common.cancel}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.sessions.renameSession}
                  disabled={renaming || !renameDraft.trim()}
                  onPress={async () => {
                    if (renaming || !renameDraft.trim() || !renameTarget) return
                    const target = renameTarget
                    setRenaming(true)
                    setRenameError(null)
                    try {
                      const ok = await renameSession(target.sessionId, renameDraft.trim(), target.backend)
                      if (ok) {
                        setRenameTarget(null)
                        setRenameError(null)
                      } else {
                        setRenameError(strings.sessions.renameFailed)
                      }
                    } finally {
                      setRenaming(false)
                    }
                  }}
                  style={({ pressed }) => [
                    styles.renameConfirmBtn,
                    (!renameDraft.trim() || renaming) && styles.btnDisabled,
                    pressed && styles.pressedBg,
                  ]}
                >
                  {renaming ? (
                    <ActivityIndicator size="small" color={colors.surface} />
                  ) : (
                    <Text style={styles.renameConfirmText}>{strings.sessions.renameSession}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* 轻量 Toast 提示 */}
      {toastMessage && (
        <View style={styles.toastContainer} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* 排序配置浮窗覆盖层：整层覆盖抽屉内容，遮罩与浮窗同级且顺序明确 */}
      {showConfigModal && (
        <View style={styles.popoverLayer} pointerEvents="box-none">
          {/* 全屏透明遮罩：点击关闭浮窗，不会穿透到下层 */}
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={strings.common.close}
            onPress={closeConfig}
          />
          {/* 浮窗内容：位于遮罩之上，点击不会穿透 */}
          {configPopover}
        </View>
      )}

      {/* 切换 Harness 模态弹窗 */}
      {(harnessPickerEverOpened || harnessPickerOpen) && (
        <HarnessPickerModal
          visible={harnessPickerOpen}
          backend={backend}
          backends={backends}
          customAcpBackends={customAcpBackends}
          colors={colors}
          styles={styles}
          onClose={() => setHarnessPickerOpen(false)}
          onSelect={target => void handleSelectHarness(target)}
        />
      )}

      {/* 工作区新建 / 管理 / 重命名弹窗 */}
      {(createWorkspaceEverOpened || createWorkspaceOpen) && (
        <CreateWorkspaceModal
          visible={createWorkspaceOpen}
          codexAvailable={codexAvailable}
          cursorAvailable={cursorAvailable}
          antigravityAvailable={antigravityAvailable}
          piAvailable={piAvailable}
          opencodeAvailable={opencodeAvailable}
          claudeAvailable={claudeAvailable}
          hermesAvailable={hermesAvailable}
          kimiAvailable={kimiAvailable}
          customAcpBackends={customAcpBackends}
          initialBackend={backend}
          busy={
            busy === 'create-workspace'
            || busy === 'create-codex-workspace'
            || busy === 'create-cursor-workspace'
            || busy === 'create-antigravity-workspace'
            || busy === 'create-pi-workspace'
            || busy === 'create-opencode-workspace'
            || busy === 'create-claude-workspace'
            || busy === 'create-hermes-workspace'
            || busy === 'create-kimi-workspace'
          }
          onClose={() => setCreateWorkspaceOpen(false)}
          onCreate={(path, targetBackend) => createWorkspace(path, targetBackend)}
          onCreated={workspace => {
            const expectedDeviceId = deviceId
            if (useAppStore.getState().selectedDevice?.deviceId !== expectedDeviceId) return
            const nextBackend = workspace.backend ?? 'harness'
            setBackend(nextBackend)
            if (expectedDeviceId !== undefined) void saveWorkspaceBackend(expectedDeviceId, nextBackend)
            const groupId = `workspace:${nextBackend}:${workspace.workspaceId}`
            if (expectedDeviceId !== undefined && groupScopeKey !== undefined) {
              memoryGroupsByDevice[groupScopeKey] = { ...memoryGroupsByDevice[groupScopeKey], [groupId]: true }
              setGroupsByDevice(current => ({
                ...current,
                [groupScopeKey]: { ...current[groupScopeKey], [groupId]: true },
              }))
              void saveHostSessionsDrawerGroup(expectedDeviceId, groupId, true).catch(() => undefined)
            }
            const latestSession = [...useAppStore.getState().sessions]
              .filter(item => workspace.sessionIds.includes(item.sessionId) && !useAppStore.getState().archivedSessionIds.includes(item.sessionId))
              .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
            if (latestSession !== undefined) {
              if (!inline) gate.setActive(false)
              let pending: Promise<void> | undefined
              try {
                pending = onSelect(latestSession)
              } catch {
                if (!inline) releaseFreeze()
                return
              }
              void Promise.resolve(pending)
                .then(() => {
                  if (useAppStore.getState().selectedDevice?.deviceId === expectedDeviceId) {
                    closeDrawer()
                  }
                })
                .catch(() => undefined)
                .finally(() => {
                  if (!inline) releaseFreeze()
                })
              return
            }
            void createSession(workspace.workspaceId, nextBackend).then(ok => {
              if (ok && useAppStore.getState().selectedDevice?.deviceId === expectedDeviceId) {
                activateAgentMode()
                closeDrawer()
              }
            })
          }}
        />
      )}
      {(renameWorkspaceEverOpened || renameWorkspaceTarget !== undefined) && (
        <RenameWorkspaceModal
          target={renameWorkspaceTarget}
          busy={renameWorkspaceTarget !== undefined && busy === `rename-workspace:${renameWorkspaceTarget.workspaceId}`}
          onClose={() => setRenameWorkspaceTarget(undefined)}
          onRename={renameWorkspace}
        />
      )}
      {(workspaceActionsEverOpened || workspaceActionTarget !== undefined) && (
        <WorkspaceActionsModal
          target={workspaceActionTarget}
          favorited={actionTargetFavorited}
          canMoveUp={actionTargetIndex > 0}
          canMoveDown={actionTargetIndex >= 0 && actionTargetIndex < backendWorkspaces.length - 1}
          busy={busy !== undefined}
          onClose={() => setWorkspaceActionTarget(undefined)}
          onNewSession={() => {
            const target = workspaceActionTarget
            setWorkspaceActionTarget(undefined)
            if (target !== undefined) void handleCreateSessionInWorkspace(target)
          }}
          onToggleFavorite={() => {
            const target = workspaceActionTarget
            setWorkspaceActionTarget(undefined)
            if (target !== undefined) void toggleFavoriteWorkspace(target)
          }}
          onRename={() => {
            const target = workspaceActionTarget
            setWorkspaceActionTarget(undefined)
            if (target !== undefined) setRenameWorkspaceEverOpened(true)
            setRenameWorkspaceTarget(target)
          }}
          onMoveUp={() => {
            const target = workspaceActionTarget
            const beforeId = actionTargetIndex > 0 ? backendWorkspaces[actionTargetIndex - 1]?.workspaceId : undefined
            setWorkspaceActionTarget(undefined)
            if (target !== undefined && beforeId !== undefined) void moveWorkspace(target.workspaceId, beforeId)
          }}
          onMoveDown={() => {
            const target = workspaceActionTarget
            const beforeId = actionTargetIndex >= 0 ? backendWorkspaces[actionTargetIndex + 2]?.workspaceId : undefined
            setWorkspaceActionTarget(undefined)
            if (target !== undefined && actionTargetIndex >= 0 && actionTargetIndex < backendWorkspaces.length - 1) {
              void moveWorkspace(target.workspaceId, beforeId)
            }
          }}
          onDelete={() => {
            const target = workspaceActionTarget
            if (target !== undefined) confirmDeleteWorkspace(target)
          }}
        />
      )}

      {appMenuOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setAppMenuOpen(false)}
        >
          <View style={{ flex: 1 }}>
            <HomeActionsMenu
              visible
              onClose={() => setAppMenuOpen(false)}
              onPlugins={() => {
                setAppMenuOpen(false)
                onOpenPlugins?.()
              }}
              pluginsDisabled={!connected || onOpenPlugins === undefined}
              onAutomationTasks={() => {
                setAppMenuOpen(false)
                if (onOpenAutomationTasks) {
                  onOpenAutomationTasks()
                } else {
                  Alert.alert(strings.automation.title, strings.automation.empty)
                }
              }}
              onSettings={() => {
                setAppMenuOpen(false)
                onOpenSettings?.()
              }}
              onAbout={() => {
                setAppMenuOpen(false)
                onOpenAbout?.()
              }}
            />
          </View>
        </Modal>
      )}
    </View>
  )

  return content
})

export const HostSessionsDrawer = memo(function HostSessionsDrawer({
  onBack,
  onClose,
  onOpenWorkspaces: _onOpenWorkspaces,
  onOpenDeviceInfo,
  onSelect,
  onHandoffSession,
  onNewSession: _onNewSession,
  onOpenAutomationTasks,
  onOpenPlugins,
  onOpenHostSwitcher,
  onOpenAttentionInbox,
  onOpenSettings,
  onOpenAbout,
  botMode,
  onBotModeChange,
  onSelectBot,
  inline = false,
  open = true,
  backLabel,
  dismissible = true,
  entrance = 'immediate',
  backRef,
  closeRef,
  onUnlockDismissible,
}: HostSessionsDrawerProps) {
  const visible = inline || open
  const gateRef = useRef<StoreGate | null>(null)
  if (gateRef.current === null) {
    gateRef.current = createStoreGate(visible)
  }
  const gate = gateRef.current

  // React runs child layout effects before parent layout effects, so
  // `HostSessionsDrawerBody` must not assume store-derived values are already
  // refreshed inside a child `useLayoutEffect`; `useSyncExternalStore` forces a
  // synchronous pre-paint re-render here when `gate.setActive(true)` flushes.
  useLayoutEffect(() => {
    gate.setActive(visible)
  }, [gate, visible])

  const bodyResetRef = useRef<(() => void) | undefined>(undefined)
  const bodyBackRef = useRef<(() => boolean) | undefined>(undefined)
  const dragActiveRef = useRef(false)
  const [botTabActive, setBotTabActive] = useState(Boolean(botMode))

  const layout = useResponsiveLayout()
  const { scheme } = useTheme()
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()

  // 手势与抽屉动画。宽窗口下抽屉宽度封顶（DRAWER_MAX_WIDTH），手机仍全宽。
  // 不可关闭态（冷启动/切 Host）保持全宽背景并用居中列限宽，避免右侧露出
  // 点不动的假遮罩，也不把列表行拉成超长白条。
  const screenWidth = layout.width
  const drawerWidth = !dismissible ? Math.round(screenWidth) : Math.round(drawerWidthForWindow(screenWidth))
  const cappedDrawer = !inline && drawerWidth < Math.round(screenWidth)
  const fullWidthCentered = !inline && !dismissible && screenWidth >= WINDOW_SIZE_MEDIUM
  const showBackButton = Boolean(onBack) && (inline || dismissible)
  // Extra travel clears the right-edge elevation shadow off-screen during exit.
  const closedTranslateX = -(drawerWidth + (cappedDrawer ? 24 : 0))
  const immediateMount = entrance === 'immediate'
  const initialOpen = !inline && open
  const translateX = useRef(new Animated.Value(initialOpen && immediateMount ? 0 : closedTranslateX)).current
  const overlayOpacity = useRef(new Animated.Value(initialOpen && immediateMount ? 1 : 0)).current
  const hasSettledOpenRef = useRef(initialOpen && immediateMount)
  const dragStartX = useRef(0)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const animSeq = useRef(0)
  const currentAnim = useRef<Animated.CompositeAnimation | null>(null)
  const gestureSeq = useRef(0)
  const dragReady = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const stableOnClose = useCallback(() => {
    onCloseRef.current()
  }, [])
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible
  const openRef = useRef(open)
  openRef.current = open
  const closedTranslateXRef = useRef(closedTranslateX)
  closedTranslateXRef.current = closedTranslateX
  const onUnlockDismissibleRef = useRef(onUnlockDismissible)
  onUnlockDismissibleRef.current = onUnlockDismissible
  const pendingUnlockRef = useRef(false)
  const releaseFreezeRafRef = useRef<number | null>(null)
  const cancelReleaseFreeze = useCallback(() => {
    if (releaseFreezeRafRef.current !== null) {
      cancelAnimationFrame(releaseFreezeRafRef.current)
      releaseFreezeRafRef.current = null
    }
  }, [])
  // Safety net for pre-freeze actions (`onSelect`, `onSelectBot`, workspace
  // auto-open): if the action fails or stays open without closing the drawer,
  // re-activate the store gate on the next frame so the open drawer never
  // remains permanently frozen.
  const releaseFreeze = useCallback(() => {
    cancelReleaseFreeze()
    releaseFreezeRafRef.current = requestAnimationFrame(() => {
      releaseFreezeRafRef.current = null
      if (!inline && openRef.current && !closingRef.current) {
        gate.setActive(true)
      }
    })
  }, [cancelReleaseFreeze, gate, inline])

  useEffect(() => () => {
    cancelReleaseFreeze()
    animSeq.current++
    currentAnim.current?.stop()
    currentAnim.current = null
  }, [cancelReleaseFreeze])

  const smoothClose = useCallback((withHaptic = true, force = false, unlockOnComplete = false) => {
    if (!shouldAllowDrawerClose({
      inline,
      open: openRef.current,
      closing: closingRef.current,
      dismissible: dismissibleRef.current,
      force,
    })) {
      return
    }
    cancelReleaseFreeze()
    closingRef.current = true
    setClosing(true)
    if (unlockOnComplete) pendingUnlockRef.current = true
    gestureSeq.current++
    dragReady.current = false
    if (withHaptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
    const seq = ++animSeq.current
    currentAnim.current?.stop()

    const anim = Animated.parallel([
      Animated.timing(translateX, { toValue: closedTranslateXRef.current, duration: 200, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ])
    currentAnim.current = anim
    anim.start(({ finished }) => {
      if (seq !== animSeq.current) return
      if (!finished) {
        translateX.setValue(closedTranslateXRef.current)
        overlayOpacity.setValue(0)
      }
      currentAnim.current = null
      hasSettledOpenRef.current = false
      closingRef.current = false
      setClosing(false)
      if (pendingUnlockRef.current) {
        pendingUnlockRef.current = false
        onUnlockDismissibleRef.current?.()
      }
      onCloseRef.current()
    })
  }, [inline, translateX, overlayOpacity, cancelReleaseFreeze])

  const handleBack = useCallback(() => {
    if (typeof Keyboard.isVisible !== 'function' || Keyboard.isVisible()) Keyboard.dismiss()
    if (!inline) {
      if (!dismissibleRef.current) return
      smoothClose(true)
      return
    }
    onBackRef.current?.()
  }, [inline, smoothClose])

  const handleBackdropPress = useCallback(() => {
    smoothClose(true)
  }, [smoothClose])

  const skippedInitialHiddenRef = useRef(!inline && !open)
  useEffect(() => {
    if (inline) {
      skippedInitialHiddenRef.current = false
      return
    }
    if (!open) {
      if (skippedInitialHiddenRef.current) {
        skippedInitialHiddenRef.current = false
        return
      }
      animSeq.current++
      cancelReleaseFreeze()
      currentAnim.current?.stop()
      currentAnim.current = null
      closingRef.current = false
      setClosing(false)
      pendingUnlockRef.current = false
      hasSettledOpenRef.current = false
      gestureSeq.current++
      dragReady.current = false
      dragActiveRef.current = false
      translateX.setValue(closedTranslateXRef.current)
      overlayOpacity.setValue(0)
      bodyResetRef.current?.()
      return
    }
    skippedInitialHiddenRef.current = false
    const seq = ++animSeq.current
    currentAnim.current?.stop()
    currentAnim.current = null
    closingRef.current = false
    setClosing(false)
    if (immediateMount || hasSettledOpenRef.current) {
      translateX.setValue(0)
      overlayOpacity.setValue(1)
      hasSettledOpenRef.current = true
      return
    }
    translateX.setValue(closedTranslateXRef.current)
    overlayOpacity.setValue(0)
    const anim = Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ])
    currentAnim.current = anim
    let stoppedByCleanup = false
    anim.start(({ finished }) => {
      if (stoppedByCleanup || seq !== animSeq.current) return
      if (!finished) {
        translateX.setValue(0)
        overlayOpacity.setValue(1)
      }
      currentAnim.current = null
      hasSettledOpenRef.current = true
    })
    return () => {
      stoppedByCleanup = true
      if (currentAnim.current === anim) {
        anim.stop()
        currentAnim.current = null
      }
    }
  }, [inline, open, immediateMount, translateX, overlayOpacity, cancelReleaseFreeze])

  const prevClosedTranslateXRef = useRef(closedTranslateX)
  useEffect(() => {
    if (prevClosedTranslateXRef.current === closedTranslateX) return
    prevClosedTranslateXRef.current = closedTranslateX
    if (!inline && !openRef.current && !closingRef.current) {
      translateX.setValue(closedTranslateX)
    }
  }, [inline, closedTranslateX, translateX])

  useEffect(() => {
    if (closeRef === undefined) return
    if (inline || !open) {
      closeRef.current = undefined
      return
    }
    closeRef.current = options => {
      smoothClose(options?.withHaptic ?? true, options?.force ?? false)
    }
    return () => {
      closeRef.current = undefined
    }
  }, [closeRef, inline, open, smoothClose])

  useEffect(() => {
    if (backRef === undefined) return
    if (inline || !open) {
      backRef.current = undefined
      return
    }
    backRef.current = () => {
      if (bodyBackRef.current?.()) return true
      if (!dismissibleRef.current) return false
      smoothClose(true)
      return true
    }
    return () => {
      backRef.current = undefined
    }
  }, [backRef, inline, open, smoothClose])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_e, g) => (!inline && openRef.current && dismissibleRef.current && !closingRef.current && !dragActiveRef.current ? shouldStartSwipeLeftToClose(g) : false),
        onMoveShouldSetPanResponderCapture: (_e, g) => (!inline && openRef.current && dismissibleRef.current && !closingRef.current && !dragActiveRef.current ? shouldStartSwipeLeftToClose(g) : false),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          if (closingRef.current || !openRef.current) return
          animSeq.current++
          currentAnim.current?.stop()
          const seq = ++gestureSeq.current
          dragReady.current = false
          translateX.stopAnimation(value => {
            if (seq !== gestureSeq.current || closingRef.current || !openRef.current) return
            dragStartX.current = value
            dragReady.current = true
          })
        },
        onPanResponderMove: (_e, g) => {
          if (closingRef.current || !openRef.current || !dragReady.current) return
          const next = clampDrawerTranslate(dragStartX.current + g.dx, drawerWidth)
          translateX.setValue(next)
          overlayOpacity.setValue(Math.max(0, 1 + next / drawerWidth))
        },
        onPanResponderRelease: (_e, g) => {
          if (closingRef.current || !openRef.current) return
          if (shouldConfirmSwipeLeftClose({ dx: g.dx, dy: g.dy, x0: g.x0, vx: g.vx })) {
            smoothClose(true)
          } else {
            const seq = ++animSeq.current
            currentAnim.current?.stop()
            const anim = Animated.parallel([
              Animated.spring(translateX, { toValue: 0, bounciness: 0, speed: 18, useNativeDriver: true }),
              Animated.timing(overlayOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
            ])
            currentAnim.current = anim
            anim.start(({ finished }) => {
              if (!finished || seq !== animSeq.current) return
              currentAnim.current = null
            })
          }
        },
      }),
    [inline, drawerWidth, translateX, overlayOpacity, smoothClose],
  )

  const touchSwipeStartRef = useRef<{ x0: number; y0: number; t0: number } | undefined>(undefined)
  const drawerTouchProps = useMemo(() => ({
    ...panResponder.panHandlers,
    onTouchStart: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
      touchSwipeStartRef.current = { x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, t0: Date.now() }
    },
    onTouchEnd: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
      const start = touchSwipeStartRef.current
      touchSwipeStartRef.current = undefined
      if (start === undefined || inline || !openRef.current || !dismissibleRef.current || closingRef.current || dragActiveRef.current) return
      const dx = e.nativeEvent.pageX - start.x0
      const dy = e.nativeEvent.pageY - start.y0
      const dt = Math.max(16, Date.now() - start.t0)
      const vx = dx / dt
      if (
        shouldStartSwipeLeftToClose({ dx, dy, x0: start.x0 })
        && shouldConfirmSwipeLeftClose({ dx, dy, x0: start.x0, vx })
      ) {
        smoothClose(true)
      }
    },
  }), [panResponder, inline, smoothClose])

  const body = (
    <HostSessionsDrawerBody
      inline={inline}
      gate={gate}
      fullWidthCentered={fullWidthCentered}
      showBackButton={showBackButton}
      backLabel={backLabel}
      botMode={botMode}
      onHeaderBack={handleBack}
      onClose={stableOnClose}
      onOpenDeviceInfo={onOpenDeviceInfo}
      onHandoffSession={onHandoffSession}
      onSelect={onSelect}
      onOpenAutomationTasks={onOpenAutomationTasks}
      onOpenPlugins={onOpenPlugins}
      onOpenHostSwitcher={onOpenHostSwitcher}
      onOpenAttentionInbox={onOpenAttentionInbox}
      onOpenSettings={onOpenSettings}
      onOpenAbout={onOpenAbout}
      onBotModeChange={onBotModeChange}
      onSelectBot={onSelectBot}
      smoothClose={smoothClose}
      releaseFreeze={releaseFreeze}
      resetRef={bodyResetRef}
      backOverlayRef={bodyBackRef}
      dragActiveRef={dragActiveRef}
      onBotTabActiveChange={setBotTabActive}
    />
  )

  if (inline) {
    return (
      <View style={[styles.drawer, styles.inlineDrawer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {body}
        <BotTeamLoadBridge enabled={visible && botTabActive} />
        <BotModalsGate visible={visible} gate={gate} />
      </View>
    )
  }

  const drawerHidden = isDrawerHostHidden(inline, open, closing)
  const drawerInteractive = open && !closing

  return (
    <View
      collapsable={false}
      style={[StyleSheet.absoluteFill, styles.drawerHost, drawerHidden && styles.drawerHostHidden]}
      pointerEvents={drawerInteractive ? 'box-none' : 'none'}
      accessibilityElementsHidden={!drawerInteractive}
      importantForAccessibility={drawerInteractive ? 'auto' : 'no-hide-descendants'}
    >
      <View style={styles.overlayContainer}>
        <Animated.View
          pointerEvents={drawerInteractive ? 'auto' : 'none'}
          style={[
            StyleSheet.absoluteFill,
            styles.overlay,
            cappedDrawer && (scheme === 'dark' ? styles.overlayCappedDark : styles.overlayCappedLight),
            { opacity: overlayOpacity },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" onPress={handleBackdropPress} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal={drawerInteractive}
          pointerEvents={drawerInteractive ? 'auto' : 'none'}
          {...drawerTouchProps}
          style={[
            styles.overlayDrawerShell,
            {
              maxWidth: drawerWidth,
              transform: [{ translateX }],
            },
            // Capped overlay drawer floats above the dimmed conversation with
            // rounded trailing corners and a soft right-side shadow; keep
            // overflow unclipped on this shell so iOS preserves the shadow.
            // Dark mode lifts the floating surface to `colors.surface` so the
            // drawer edge stays distinct against the dark scrim without a border.
            cappedDrawer && styles.drawerCapped,
            cappedDrawer && scheme === 'dark' && styles.drawerCappedDark,
            cappedDrawer && !open && styles.drawerHiddenShadow,
          ]}
        >
          <View
            style={[
              styles.drawerClip,
              { paddingTop: insets.top, paddingBottom: insets.bottom },
              cappedDrawer && styles.drawerClipCapped,
            ]}
          >
            {body}
          </View>
        </Animated.View>
      </View>
      <BotTeamLoadBridge enabled={visible && botTabActive} />
      <BotModalsGate visible={visible} gate={gate} />
    </View>
  )
})

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    drawerHost: { zIndex: 20 },
    drawerHostHidden: { opacity: 0 },
    overlayContainer: { flex: 1 },
    overlay: { flex: 1, backgroundColor: colors.scrim },
    overlayCappedLight: { backgroundColor: 'rgba(15, 15, 15, 0.50)' },
    overlayCappedDark: { backgroundColor: 'rgba(0, 0, 0, 0.68)' },
    drawer: { flex: 1, width: '100%', maxWidth: '100%', backgroundColor: colors.background, overflow: 'hidden' },
    overlayDrawerShell: { flex: 1, width: '100%', maxWidth: '100%', backgroundColor: colors.background },
    drawerCapped: {
      borderTopRightRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
      shadowColor: colors.shadow,
      shadowOffset: { width: 4, height: 0 },
      shadowOpacity: 0.14,
      shadowRadius: 16,
      elevation: 8,
    },
    drawerCappedDark: { backgroundColor: colors.surface },
    drawerHiddenShadow: { elevation: 0, shadowOpacity: 0 },
    drawerClip: { flex: 1, overflow: 'hidden' },
    drawerClipCapped: { borderTopRightRadius: radius.xl, borderBottomRightRadius: radius.xl },
    inlineDrawer: { width: '100%', maxWidth: '100%', borderRadius: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.separator },
    container: { flex: 1 },
    centeredColumn: { width: '100%', maxWidth: DRAWER_FULL_CONTENT_MAX_WIDTH, alignSelf: 'center' },

    brandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 60,
      paddingLeft: spacing.lg,
      paddingRight: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
    },
    brandGroup: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, marginRight: spacing.sm },
    membershipLink: { maxWidth: '45%', minHeight: 36, justifyContent: 'center' },
    dismissMembership: { width: 32, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
    membershipText: { ...type.smallStrong, color: colors.primary },
    brandLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, marginRight: spacing.sm, gap: 8 },
    brandTitle: { ...type.heading, fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.2, color: colors.ink, flexShrink: 1 },
    brandRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    iconBtn: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    iconBtnRound: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, ...floatingShadow(colors) },

    modeSwitcherWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: spacing.md,
      marginBottom: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    modeSwitcherTab: {
      flex: 1,
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: spacing.sm,
      paddingBottom: 2,
    },
    // Deliberately no elevation: the indicator is painted before the tab
    // Pressables, and an elevated sibling would cover their labels on Android.
    modeSwitcherIndicator: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      height: 2.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modeSwitcherIndicatorBar: {
      width: 44,
      height: 2.5,
      borderRadius: 2,
      backgroundColor: colors.primary,
    },
    modeSwitcherText: {
      ...type.smallStrong,
      fontSize: 14,
      fontWeight: '500',
      color: colors.muted,
    },
    modeSwitcherTextActive: {
      color: colors.ink,
      fontWeight: '700',
    },
    favoritesWrap: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      gap: 2,
    },

    workspacesToolbarArea: { position: 'relative' },
    workspacesToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: spacing.lg,
      paddingRight: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxs,
    },
    workspacesTitleGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      flex: 1,
      minWidth: 0,
      marginRight: spacing.xs,
    },
    workspacesTitle: { ...type.small, fontSize: 14.5, color: colors.muted, flexShrink: 0 },
    platformChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      height: 28,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      flexShrink: 1,
      minWidth: 0,
    },
    platformChipText: {
      ...type.caption,
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.ink,
      flexShrink: 1,
    },
    toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },

    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginHorizontal: spacing.md,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.md,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    searchInput: { flex: 1, ...type.body, fontSize: 15, color: colors.ink, paddingVertical: 0 },

    listContainer: { paddingBottom: spacing.xl },

    // 底部常驻栏：左侧当前远程主机状态/切换入口，右侧轻量设置按钮
    hostFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
    hostFooterBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
      backgroundColor: 'transparent',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    hostFooterLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
      backgroundColor: colors.card,
      ...continuousRadius(radius.lg),
      overflow: 'hidden',
    },
    hostFooterIcon: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.separator,
    },
    hostFooterInfo: {
      flex: 1,
      minWidth: 0,
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.sm,
    },
    hostFooterNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0, flexShrink: 1 },
    hostFooterName: { ...type.bodyStrong, fontSize: 13.5, lineHeight: 18, color: colors.ink, flexShrink: 1 },
    hostFooterStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
    hostFooterDot: { width: 6, height: 6, borderRadius: 3 },
    hostFooterStatusText: { ...type.caption, fontSize: 12, color: colors.muted },
    footerSettingsBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    sectionList: { flex: 1 },

    workspaceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      minHeight: 48,
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    workspaceRowCardSingle: {
      ...continuousRadius(radius.xl),
    },
    workspaceRowCardTop: {
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      ...(Platform.OS === 'ios' ? { borderCurve: 'continuous' as const } : {}),
    },
    workspaceRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
    workspaceRowTitle: { ...type.bodyStrong, fontSize: 15, color: colors.ink, flexShrink: 1 },
    workspaceCountText: {
      ...type.caption,
      fontSize: 12,
      color: colors.muted,
      ...tabularNumsStyle,
    },
    workspaceRowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },
    workspaceSmallBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },

    sessionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: spacing.md,
      paddingRight: spacing.xxs,
      minHeight: 46,
      marginHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderTopColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
    },
    sessionRowCardTop: {
      marginTop: spacing.xs,
      borderTopWidth: 0,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      ...(Platform.OS === 'ios' ? { borderCurve: 'continuous' as const } : {}),
    },
    sessionRowCardBottom: {
      borderBottomLeftRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
      ...(Platform.OS === 'ios' ? { borderCurve: 'continuous' as const } : {}),
    },
    sessionRowSelected: { backgroundColor: colors.primarySoft },
    sessionRowDragging: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.primary,
      opacity: 0.9,
    },
    dropTargetAbove: {
      borderTopWidth: 2,
      borderTopColor: colors.primary,
    },
    dropTargetBelow: {
      borderBottomWidth: 2,
      borderBottomColor: colors.primary,
    },
    statusIndicatorSlot: { width: 14, alignItems: 'flex-start', justifyContent: 'center' },
    runningDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
    sessionText: { ...type.body, fontSize: 15, color: colors.ink, flex: 1, marginRight: spacing.xs },
    sessionTextSelected: { fontWeight: '600', color: colors.primary },
    handoffBadgeSlot: { marginRight: spacing.xs, flexShrink: 0 },
    timeText: { ...type.caption, color: colors.muted, ...tabularNumsStyle },

    showMoreRow: {
      paddingLeft: spacing.md + 14,
      paddingVertical: spacing.xs,
      minHeight: 38,
      justifyContent: 'center',
      marginHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderTopColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomLeftRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
      ...(Platform.OS === 'ios' ? { borderCurve: 'continuous' as const } : {}),
    },
    showMoreText: { ...type.caption, color: colors.primary, fontWeight: '500' },

    pressedBg: { backgroundColor: colors.surfaceStrong },
    pressedFade: { opacity: 0.72 },

    // 浮窗覆盖层：铺满抽屉内容区，作为唯一命中层，避免跨父级层级问题
    popoverLayer: {
      ...StyleSheet.absoluteFill,
      zIndex: 999,
    },
    configPopover: {
      position: 'absolute',
      width: 220,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      ...floatingShadow(colors, 'high'),
      zIndex: 1000,
    },
    modalSectionLabel: { ...type.caption, color: colors.muted, marginBottom: 4, fontWeight: '600' },
    modalItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 7,
      paddingHorizontal: 4,
    },
    modalItemText: { ...type.small, color: colors.ink },
    modalDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginVertical: 6 },

    archivedText: { color: colors.muted, fontStyle: 'italic' },
    pinIndicator: { marginLeft: 4, marginRight: 2, alignItems: 'center', justifyContent: 'center' },
    moreActionBtn: {
      minWidth: 44,
      minHeight: 44,
      paddingHorizontal: 8,
      marginLeft: 2,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },

    menuBackdrop: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.md,
    },
    contextMenuCard: {
      width: '80%',
      maxWidth: 280,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      paddingVertical: spacing.xs,
      ...floatingShadow(colors, 'high'),
    },
    menuHeader: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      marginBottom: spacing.xxs,
    },
    menuTitle: {
      ...type.caption,
      fontWeight: '600',
      color: colors.muted,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    menuItemText: {
      ...type.body,
      color: colors.ink,
      flex: 1,
    },

    renameBackdrop: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.md,
    },
    renameCard: {
      width: '85%',
      maxWidth: 340,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      padding: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      ...floatingShadow(colors, 'high'),
    },
    renameModalTitle: {
      ...type.heading,
      color: colors.ink,
      fontWeight: '600',
    },
    renameInput: {
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginVertical: spacing.md,
      ...type.body,
      color: colors.ink,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    renameErrorText: {
      ...type.caption,
      color: colors.ink,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    renameButtonRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
    },
    renameCancelBtn: {
      paddingVertical: 10,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    renameCancelText: {
      ...type.small,
      color: colors.ink,
    },
    renameConfirmBtn: {
      paddingVertical: 10,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.primary,
    },
    renameConfirmText: {
      ...type.small,
      color: colors.white,
      fontWeight: '600',
    },
    btnDisabled: {
      opacity: 0.5,
    },

    toastContainer: {
      position: 'absolute',
      bottom: 60,
      alignSelf: 'center',
      backgroundColor: colors.inverse,
      paddingVertical: 10,
      paddingHorizontal: 18,
      borderRadius: radius.pill,
      zIndex: 9999,
      ...elevationStyle(colors, 3),
    },
    toastText: {
      ...type.small,
      color: colors.onInverse,
      fontWeight: '500',
    },
    harnessLabel: {
      flex: 1,
    },
    harnessTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },
    harnessTrailingText: {
      ...type.small,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
      maxWidth: 100,
    },
    harnessBackdrop: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      justifyContent: 'flex-end',
    },
    harnessDialog: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
      ...floatingShadow(colors, 'high'),
    },
    harnessHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: spacing.xs,
    },
    harnessTitle: {
      ...type.heading,
      fontSize: 18,
      color: colors.ink,
      fontWeight: '700',
    },
    harnessList: {
      paddingBottom: spacing.md,
    },
    harnessOptionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    harnessOptionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    harnessOptionInfo: {
      flex: 1,
      gap: 2,
      marginRight: spacing.sm,
    },
    harnessOptionName: {
      ...type.body,
      fontSize: 16,
      color: colors.ink,
    },
    harnessOptionNameActive: {
      fontWeight: '600',
      color: colors.primary,
    },
    harnessOptionDesc: {
      ...type.small,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
  })
