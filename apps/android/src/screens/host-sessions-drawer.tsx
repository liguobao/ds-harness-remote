import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
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
  useWindowDimensions,
} from 'react-native'
import { Alert } from '../ui/alert'
import * as Haptics from 'expo-haptics'
import * as Clipboard from 'expo-clipboard'
import Svg, { Path } from 'react-native-svg'
import {
  ArrowLeft,
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
  MoreHorizontal,
  Plus,
  MoreVertical,
  Search,
  Server,
  Settings,
  Sliders,
  Star,
  Users,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import { dispatchSessionCatalogCommand } from '../state/session-catalog-commands'
import { isKnownBotSessionId, useBotTeamStore } from '../state/bot-store'
import type { AgentBackend, RemoteSession, WorkspaceView } from '../types'
import { strings } from '../locales/i18n'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../ui/fish-logo'
import { ErrorBanner, GroupCard, GroupRow, IconButton, SectionTitle } from '../ui/components'
import { floatingShadow, radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { easingCurve, indicatorGeometry, motionTokens, resolveMotion } from '../ui/motion'
import { useReduceMotion } from '../ui/use-reduce-motion'
import { resolveSessionDisplayTitle } from './session-title'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
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
import { buildTreeSections, applyManualOrder, reorderSessionIds } from '../lib/workspace-tree'
import { BotModalsHost, BotSidebarSection, useBotTeamLoad } from './bot-sidebar-section'
import { HomeActionsMenu } from './setup-screens'
import { CreateWorkspaceModal, RenameWorkspaceModal, WorkspaceActionsModal } from './workspace-modals'

const SESSION_PAGE_SIZE = 3
const DRAWER_WIDTH_RATIO = 1
/** Padding inside the Agent / DS-Bot underline tab track. */
const MODE_SWITCHER_INSET = 0

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
  value: AgentBackend
  name: string
  desc: string
}

const HARNESS_OPTIONS: HarnessOption[] = [
  { value: 'harness', name: 'DeepSeek Harness', desc: '官方 DeepSeek 智能体框架' },
  { value: 'codex', name: 'Codex', desc: 'OpenAI Codex 编程智能体' },
  { value: 'claude', name: 'Claude', desc: 'Anthropic Claude 智能体' },
  { value: 'hermes', name: 'Hermes', desc: 'Nous Research Hermes Agent 智能体' },
  { value: 'cursor', name: 'Cursor', desc: 'Cursor IDE 交互智能体' },
  { value: 'antigravity', name: 'Antigravity', desc: 'Antigravity 研发框架' },
  { value: 'opencode', name: 'OpenCode', desc: 'OpenCode 开源智能体' },
  { value: 'pi', name: 'Pi', desc: 'Personal Intelligence 智能体' },
]

function harnessDisplayName(value: AgentBackend): string {
  switch (value) {
    case 'harness': return 'DeepSeek'
    case 'codex': return 'Codex'
    case 'claude': return 'Claude'
    case 'hermes': return 'Hermes'
    case 'cursor': return 'Cursor'
    case 'antigravity': return 'Antigravity'
    case 'opencode': return 'OpenCode'
    case 'pi': return 'Pi'
    default: return value
  }
}

export function HostSessionsDrawer({
  onBack,
  onClose,
  onOpenWorkspaces,
  onOpenDeviceInfo,
  onSelect,
  onNewSession: _onNewSession,
  onOpenAutomationTasks,
  onOpenPlugins,
  onOpenHostSwitcher,
  onOpenSettings,
  onOpenAbout,
  botMode,
  onBotModeChange,
  onSelectBot,
  inline = false,
  backLabel,
  dismissible = true,
  entrance = 'immediate',
  backRef,
}: {
  onBack?: () => void
  onClose: () => void
  onOpenWorkspaces?: () => void
  onOpenDeviceInfo?: () => void
  onSelect: (session: RemoteSession) => Promise<void>
  onNewSession?: () => Promise<void> | void
  onOpenAutomationTasks?: () => void
  onOpenPlugins?: () => void
  onOpenHostSwitcher?: () => void
  onOpenSettings?: () => void
  onOpenAbout?: () => void
  botMode?: boolean
  onBotModeChange?: (botMode: boolean) => void
  onSelectBot?: (botId: string) => void
  inline?: boolean
  backLabel?: string
  /** 冷启动停留在侧边栏且尚未选择任何页面时，禁止手势/返回键把侧边栏划走。 */
  dismissible?: boolean
  /** 默认停留在列表或切换主机时直接就位，避免先露底层对话再滑入；从对话呼出时才滑入。 */
  entrance?: 'immediate' | 'slide'
  /** 由 ChatScreen 统一协调硬件返回键顺序。 */
  backRef?: MutableRefObject<(() => boolean) | undefined>
}) {
  const language = useAppStore(state => state.language)
  const deviceId = useAppStore(state => state.selectedDevice?.deviceId)
  const deviceName = useAppStore(state => state.selectedDevice?.name)
  const platform = useAppStore(state => state.selectedDevice?.platform)
  const connectionPhase = useAppStore(state => state.connection.phase)
  const sessions = useAppStore(state => state.sessions)
  const recentIds = useAppStore(state => state.currentWorkSessionIds)
  const codexAvailable = useAppStore(state => state.codexAvailable)
  const cursorAvailable = useAppStore(state => state.cursorAvailable)
  const antigravityAvailable = useAppStore(state => state.antigravityAvailable)
  const piAvailable = useAppStore(state => state.piAvailable)
  const opencodeAvailable = useAppStore(state => state.opencodeAvailable)
  const claudeAvailable = useAppStore(state => state.claudeAvailable)
  const hermesAvailable = useAppStore(state => state.hermesAvailable)
  const availableBackends = useAppStore(state => [
    'harness', state.codexAvailable && 'codex', state.cursorAvailable && 'cursor',
    state.antigravityAvailable && 'antigravity', state.piAvailable && 'pi',
    state.opencodeAvailable && 'opencode', state.claudeAvailable && 'claude',
    state.hermesAvailable && 'hermes',
  ].filter(Boolean).join(','))
  const lifecycles = useAppStore(state => state.sessionLifecycles)
  const selected = useAppStore(state => state.selectedSession)
  const archivedIds = useAppStore(state => state.archivedSessionIds)
  const pinnedSessionIds = useAppStore(state => state.pinnedSessionIds)
  const workspaces = useAppStore(state => state.workspaces)
  const favoriteWorkspaces = useAppStore(state => state.favoriteWorkspaces)
  const toggleFavoriteWorkspace = useAppStore(state => state.toggleFavoriteWorkspace)
  const removeFavoriteWorkspace = useAppStore(state => state.removeFavoriteWorkspace)
  const createWorkspace = useAppStore(state => state.workspaceCreate)
  const renameWorkspace = useAppStore(state => state.workspaceRename)
  const moveWorkspace = useAppStore(state => state.workspaceMove)
  const deleteWorkspace = useAppStore(state => state.workspaceDelete)
  const busy = useAppStore(state => state.busyAction)
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const error = useAppStore(state => state.error)
  const clearError = useAppStore(state => state.clearError)
  const devicesRefreshing = useAppStore(state => state.refreshing)
  const refreshDevices = useAppStore(state => state.refreshDevices)
  const createSession = useAppStore(state => state.createSession)
  const pinSession = useAppStore(state => state.pinSession)
  const unpinSession = useAppStore(state => state.unpinSession)
  const renameSession = useAppStore(state => state.renameSession)
  const forkSession = useAppStore(state => state.forkSession)
  const archiveSession = useAppStore(state => state.archiveSession)
  const unarchiveSession = useAppStore(state => state.unarchiveSession)

  const hostScope = useAppStore(browseScope)
  const persistedBotMode = useBrowseMemory(state => state.hostModes[hostScope] === 'bot')
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

  useBotTeamLoad(drawerMode === 'bot')

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
  const [workspaceActionTarget, setWorkspaceActionTarget] = useState<WorkspaceView | undefined>(undefined)
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<WorkspaceView | undefined>(undefined)
  const [showBotSearch, setShowBotSearch] = useState(false)
  const [botSearchQuery, setBotSearchQuery] = useState('')

  const [menuSession, setMenuSession] = useState<RemoteSession | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; currentTitle: string; backend?: RemoteSession['backend'] } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const menuBackend = menuSession?.backend ?? 'harness'
  const canUseHarnessActions = !!menuSession && menuBackend === 'harness'
  const menuIsPinned = !!menuSession && canUseHarnessActions && pinnedSessionIds.includes(menuSession.sessionId)
  const menuIsArchived = !!menuSession && canUseHarnessActions && archivedIds.includes(menuSession.sessionId)

  const closeDrawer = () => {
    setMenuSession(null)
    setRenameTarget(null)
    setRenameError(null)
    setRenaming(false)
    setToastMessage(null)
    onClose()
  }

  const [backend, setBackend] = useState<AgentBackend>(selected?.backend ?? useAppStore.getState().workspaceCatalog?.backend ?? 'harness')
  const backends = [...new Set<AgentBackend>([
    ...availableBackends.split(',') as AgentBackend[],
    ...workspaces.map(workspace => workspace.backend ?? 'harness'),
    ...(selected ? [selected.backend ?? 'harness'] : []),
  ])]
  const backendWorkspaces = useMemo(() => workspaces.filter(workspace => (workspace.backend ?? 'harness') === backend), [workspaces, backend])
  useEffect(() => {
    setBackend(selected?.backend ?? useAppStore.getState().workspaceCatalog?.backend ?? 'harness')
    setVisibleCounts({})
  }, [deviceId, selected?.backend])
  useEffect(() => {
    if (connected) void dispatchSessionCatalogCommand({ type: 'refresh-catalog', backend })
  }, [backend, connected, deviceId])

  const [harnessPickerOpen, setHarnessPickerOpen] = useState(false)
  const windowDimensions = useWindowDimensions()
  const sheetMaxHeight = Math.min(windowDimensions.height * 0.75, 520)

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
      default: return false
    }
  }

  const handleSelectHarness = async (target: AgentBackend) => {
    setHarnessPickerOpen(false)
    if (!isBackendAvailable(target)) {
      Alert.alert(
        strings.common.unavailable ?? '平台未启用',
        `当前连接的主机未启用 ${harnessDisplayName(target)} 服务，请在电脑端配置或启动该智能体。`,
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
  const dragActiveRef = useRef(false)
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

  // 浮窗定位：记录工具栏在覆盖层坐标系中的底部位置（默认兜底 200，测量后精准对齐）
  const [popoverTop, setPopoverTop] = useState<number>(200)
  const toolbarRef = useRef<View>(null)
  const containerRef = useRef<View>(null)

  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()

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
      setMenuSession(null)
      setRenameTarget(null)
      setRenameError(null)
      setRenaming(false)
      setToastMessage(null)
    }
  }, [connected])

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 2000)
    return () => clearTimeout(timer)
  }, [toastMessage])

  // 打开浮窗时测量工具栏位置，确保浮窗紧贴工具栏下方
  useEffect(() => {
    if (!showConfigModal) return
    const raf = requestAnimationFrame(() => {
      if (!containerRef.current || !toolbarRef.current) return
      containerRef.current.measureInWindow((_cx, cy) => {
        toolbarRef.current?.measureInWindow((_tx, ty, _tw, th) => {
          if (typeof cy !== 'number' || typeof ty !== 'number' || typeof th !== 'number') return
          // 工具栏底部相对覆盖层顶部的偏移
          setPopoverTop(ty - cy + th + POPOVER_OFFSET)
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
        await onSelect(wsSessions[0])
        if (!inline) closeDrawer()
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

  const botTeamState = useBotTeamStore(state => state.state)

  const filteredSessions = useMemo(() => {
    const known = selected && !sessions.some(session => session.sessionId === selected.sessionId)
      ? [selected, ...sessions] : sessions
    let list = known.filter(session => (session.backend ?? 'harness') === backend && !isKnownBotSessionId(session.sessionId, botTeamState, hostScope))
    if (filterMode === 'hideArchived') {
      list = list.filter(s => !archivedIds.includes(s.sessionId))
    } else if (filterMode === 'archivedOnly') {
      list = list.filter(s => archivedIds.includes(s.sessionId))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(s => (resolveSessionDisplayTitle(s) ?? '').toLowerCase().includes(q))
    }
    if (orderBy === 'updated') {
      list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    }
    return list
  }, [sessions, selected, backend, archivedIds, filterMode, searchQuery, orderBy, botTeamState])

  const sections = useMemo<DrawerSection[]>(() => {
    const partitionPinned = (items: RemoteSession[]) => {
      const pinned: RemoteSession[] = []
      const ordinary: RemoteSession[] = []
      for (const s of items) {
        const isHarness = (s.backend ?? 'harness') === 'harness'
        if (isHarness && pinnedSessionIds.includes(s.sessionId) && !archivedIds.includes(s.sessionId)) {
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
      return [...recentSections, ...wsList.map(ws => {
        const isDefault = ws.workspaceId === 'default'
        let wsSessions = filteredSessions.filter(s =>
          isDefault ? !backendWorkspaces.some(w => w.sessionIds.includes(s.sessionId)) : ws.sessionIds.includes(s.sessionId)
        )
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
  }, [groupBy, backendWorkspaces, backend, filteredSessions, recentIds, selected, expandedWorkspaces, visibleCounts, language, pinnedSessionIds, archivedIds, orderBy, manualOrders, searchQuery])

  // 手势与抽屉动画
  const { width: screenWidth } = useWindowDimensions()
  const drawerWidth = Math.round(screenWidth * DRAWER_WIDTH_RATIO)
  const immediateMount = entrance === 'immediate'
  const translateX = useRef(new Animated.Value(immediateMount ? 0 : -drawerWidth)).current
  const overlayOpacity = useRef(new Animated.Value(immediateMount ? 1 : 0)).current
  const hasSettledOpenRef = useRef(immediateMount)
  const dragStartX = useRef(0)
  const closingRef = useRef(false)
  const animSeq = useRef(0)
  const currentAnim = useRef<Animated.CompositeAnimation | null>(null)
  const gestureSeq = useRef(0)
  const dragReady = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible

  useEffect(() => {
    if (showSearch) setSearchMounted(true)
    const animation = Animated.timing(searchMotion, {
      toValue: showSearch ? 1 : 0,
      duration: reduceMotion ? motionTokens.duration.reduced : motionTokens.duration.sheetExit,
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

  const smoothClose = (withHaptic = true) => {
    if (closingRef.current) return
    // A cold start parks the user in this drawer without a chosen page; only an
    // explicit tap (session / Bot) may leave it, never a swipe or the back key.
    if (!inline && !dismissibleRef.current) return
    closingRef.current = true
    gestureSeq.current++
    dragReady.current = false
    if (withHaptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
    const seq = ++animSeq.current
    currentAnim.current?.stop()

    const anim = Animated.parallel([
      Animated.timing(translateX, { toValue: -drawerWidth, duration: 200, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ])
    currentAnim.current = anim
    anim.start(({ finished }) => {
      if (!finished || seq !== animSeq.current) return
      currentAnim.current = null
      closingRef.current = false
      onCloseRef.current()
    })
  }

  const handleBack = () => {
    Keyboard.dismiss()
    if (!inline) {
      if (!dismissibleRef.current) return
      smoothClose(true)
      return
    }
    onBack?.()
  }

  useEffect(() => {
    if (inline) return
    if (immediateMount || hasSettledOpenRef.current) {
      currentAnim.current?.stop()
      closingRef.current = false
      translateX.setValue(0)
      overlayOpacity.setValue(1)
      hasSettledOpenRef.current = true
      return
    }
    const anim = Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ])
    currentAnim.current = anim
    anim.start(({ finished }) => {
      if (finished) hasSettledOpenRef.current = true
    })
    return () => currentAnim.current?.stop()
  }, [inline, immediateMount, translateX, overlayOpacity])

  useEffect(() => {
    if (backRef === undefined || inline) return
    backRef.current = () => {
      if (showConfigModal) {
        setShowConfigModal(false)
        return true
      }
      if (showSearch) {
        setShowSearch(false)
        setSearchQuery('')
        return true
      }
      if (showBotSearch) {
        setShowBotSearch(false)
        setBotSearchQuery('')
        return true
      }
      if (!dismissibleRef.current) return false
      smoothClose(true)
      return true
    }
    return () => {
      backRef.current = undefined
    }
  })

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_e, g) => (!inline && dismissibleRef.current && !closingRef.current ? shouldStartSwipeLeftToClose(g) : false),
        onMoveShouldSetPanResponderCapture: (_e, g) => (!inline && dismissibleRef.current && !closingRef.current ? shouldStartSwipeLeftToClose(g) : false),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          if (closingRef.current) return
          currentAnim.current?.stop()
          const seq = ++gestureSeq.current
          dragReady.current = false
          translateX.stopAnimation(value => {
            if (seq !== gestureSeq.current || closingRef.current) return
            dragStartX.current = value
            dragReady.current = true
          })
        },
        onPanResponderMove: (_e, g) => {
          if (closingRef.current || !dragReady.current) return
          const next = clampDrawerTranslate(dragStartX.current + g.dx, drawerWidth)
          translateX.setValue(next)
          overlayOpacity.setValue(Math.max(0, 1 + next / drawerWidth))
        },
        onPanResponderRelease: (_e, g) => {
          if (closingRef.current) return
          if (shouldConfirmSwipeLeftClose({ dx: g.dx, dy: g.dy, x0: g.x0, vx: g.vx })) {
            smoothClose(true)
          } else {
            Animated.parallel([
              Animated.spring(translateX, { toValue: 0, bounciness: 0, speed: 18, useNativeDriver: true }),
              Animated.timing(overlayOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
            ]).start()
          }
        },
      }),
    [inline, drawerWidth, translateX, overlayOpacity]
  )

  const touchSwipeStartRef = useRef<{ x0: number; y0: number; t0: number } | undefined>(undefined)
  const drawerTouchProps = {
    ...panResponder.panHandlers,
    onTouchStart: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
      touchSwipeStartRef.current = { x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, t0: Date.now() }
    },
    onTouchEnd: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
      const start = touchSwipeStartRef.current
      touchSwipeStartRef.current = undefined
      if (start === undefined || inline || !dismissibleRef.current || closingRef.current) return
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
  }

  const closeConfig = () => setShowConfigModal(false)

  /** 排序配置浮窗（在覆盖层内部渲染，供点击命中） */
  const configPopover = (
    <Animated.View
      style={[
        styles.configPopover,
        { top: popoverTop, right: POPOVER_RIGHT_INSET },
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
        onPress={() => {
          Keyboard.dismiss()
          onOpenDeviceInfo?.()
        }}
        hitSlop={6}
        style={({ pressed }) => [styles.hostFooterIcon, pressed && styles.pressedFade]}
      >
        <FooterHostIcon size={17} color={colors.ink} strokeWidth={1.8} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${deviceName ?? strings.devices.title} · ${strings.remoteHosts.switchTitle}`}
        disabled={onOpenHostSwitcher === undefined}
        onPress={() => { Keyboard.dismiss(); onOpenHostSwitcher?.() }}
        hitSlop={6}
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
      {/* 品牌顶部区 */}
      <View style={styles.brandHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`DS Harness Remote · ${strings.settings.about}`}
          disabled={onOpenAbout === undefined}
          onPress={() => {
            Keyboard.dismiss()
            onOpenAbout?.()
          }}
          hitSlop={8}
          style={({ pressed }) => [styles.brandLeft, pressed && styles.pressedFade]}
        >
          <Svg
            width={20}
            height={(20 * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
            viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
            accessible={false}
          >
            <Path d={FISH_LOGO_PATH} fill={colors.ink} />
          </Svg>
          <Text style={styles.brandTitle} numberOfLines={1}>DS Harness Remote</Text>
        </Pressable>
        <View style={styles.brandRight}>
          {onOpenSettings !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.settings.more}
              onPress={() => { Keyboard.dismiss(); setAppMenuOpen(true) }}
              hitSlop={8}
              style={({ pressed }) => [styles.iconBtnRound, pressed && styles.pressedBg]}
            >
              <MoreVertical size={18} color={colors.ink} strokeWidth={1.9} />
            </Pressable>
          )}
          {Boolean(onBack) && (inline || dismissible) && (
            <Pressable accessibilityRole="button" accessibilityLabel={backLabel ?? strings.chat.backToChat} onPress={handleBack} hitSlop={8} style={({ pressed }) => [styles.iconBtnRound, pressed && styles.pressedBg]}>
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
          accessibilityLabel="智能体"
          onPress={() => handleSwitchMode('agent')}
          style={({ pressed }) => [
            styles.modeSwitcherTab,
            pressed && styles.pressedFade,
          ]}
        >
          <LayoutGrid size={15} color={drawerMode === 'agent' ? colors.ink : colors.muted} strokeWidth={2} />
          <Text style={[styles.modeSwitcherText, drawerMode === 'agent' && styles.modeSwitcherTextActive]}>
            智能体
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
          refreshing={connected ? refreshing : devicesRefreshing}
          onRefresh={() => void handleRefresh()}
          searchQuery={botSearchQuery}
          onSearchChange={setBotSearchQuery}
          showSearch={showBotSearch}
          onSelectBot={id => {
            saveHostMode(hostScope, 'bot')
            onBotModeChange?.(true)
            useBotTeamStore.getState().setSelectedId(id)
            onSelectBot?.(id)
            if (!inline) closeDrawer()
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
                  accessibilityLabel={`智能体平台 · ${harnessDisplayName(backend)}`}
                  hitSlop={6}
                  onPress={() => setHarnessPickerOpen(true)}
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
                  onPress={() => setCreateWorkspaceOpen(true)}
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
            refreshControl={
              <RefreshControl
                refreshing={connected ? refreshing : devicesRefreshing}
                onRefresh={() => void handleRefresh()}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            alwaysBounceVertical
            scrollEnabled={dragState === null}
            sections={groupsReady ? sections : []}
            ListHeaderComponent={
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
                        onPress={() => void handleOpenFavorite(fav.workspaceId, fav.backend)}
                        accessory={
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={strings.devices.removeFavorite(fav.title)}
                            hitSlop={8}
                            onPress={e => {
                              e.stopPropagation()
                              void removeFavoriteWorkspace(fav.deviceId, fav.key)
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
              ) : null
            }
            ListEmptyComponent={groupsReady ? null : <ActivityIndicator color={colors.muted} accessibilityLabel={strings.workspaces.loading} />}
            keyExtractor={item => item.sessionId}
            keyboardShouldPersistTaps="handled"
            style={styles.sectionList}
            contentContainerStyle={styles.listContainer}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => {
              if (groupBy === 'list' || !section.title) return null
              const isExp = section.expanded
              const hasItems = isExp && section.data.length > 0
              const depth = section.depth ?? 0
              const matchedWorkspace = section.workspaceId && section.workspaceId !== 'default'
                ? backendWorkspaces.find(w => w.workspaceId === section.workspaceId)
                : undefined
              const isFavorited = Boolean(
                deviceId && matchedWorkspace && favoriteWorkspaces.some(
                  f => f.deviceId === deviceId && f.workspaceId === matchedWorkspace.workspaceId && f.backend === (matchedWorkspace.backend ?? backend),
                ),
              )
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => toggleWorkspace(section.id)}
                  onLongPress={() => {
                    if (!matchedWorkspace) return
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                    setWorkspaceActionTarget(matchedWorkspace)
                  }}
                  style={({ pressed }) => [
                    styles.workspaceRow,
                    hasItems ? styles.workspaceRowCardTop : styles.workspaceRowCardSingle,
                    pressed && styles.pressedBg,
                    depth > 0 && { paddingLeft: spacing.md + depth * 14 },
                  ]}
                >
                  <View style={styles.workspaceRowLeft}>
                    {isExp
                      ? <FolderOpen size={18} color={colors.primary} strokeWidth={1.8} />
                      : <Folder size={18} color={colors.muted} strokeWidth={1.8} />}
                    <Text style={styles.workspaceRowTitle} numberOfLines={1}>
                      {section.title}
                    </Text>
                    {isFavorited && (
                      <Star size={12} color={colors.primary} fill={colors.primary} />
                    )}
                    {section.total > 0 && (
                      <Text style={styles.workspaceCountText}>{section.total}</Text>
                    )}
                  </View>
                  <View style={styles.workspaceRowRight}>
                    {matchedWorkspace !== undefined && (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={strings.workspaces.newSessionIn(section.title)}
                          hitSlop={6}
                          onPress={e => {
                            e.stopPropagation()
                            void handleCreateSessionInWorkspace(matchedWorkspace)
                          }}
                          style={styles.workspaceSmallBtn}
                        >
                          <Plus size={15} color={colors.muted} />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${section.title} · ${strings.workspaces.options}`}
                          hitSlop={6}
                          onPress={e => {
                            e.stopPropagation()
                            setWorkspaceActionTarget(matchedWorkspace)
                          }}
                          style={styles.workspaceSmallBtn}
                        >
                          <MoreHorizontal size={15} color={colors.muted} />
                        </Pressable>
                      </>
                    )}
                    {isExp ? <ChevronDown size={16} color={colors.subtle} /> : <ChevronRight size={16} color={colors.subtle} />}
                  </View>
                </Pressable>
              )
            }}
        renderSectionFooter={({ section }) => {
          if (groupBy === 'list' || !section.expanded || section.hasMoreFooter === false || section.data.length >= section.total) return null
          const remaining = section.total - section.data.length
          const countKey = section.workspaceId ? `workspace:${backend}:${section.workspaceId}` : section.id
          const depth = section.depth ?? 0
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setVisibleCounts(c => ({
                  ...c,
                  [countKey]: (c[countKey] ?? SESSION_PAGE_SIZE) + SESSION_PAGE_SIZE,
                }))
              }
              style={[
                styles.showMoreRow,
                depth > 0 && { paddingLeft: spacing.lg + spacing.md + depth * 14 },
              ]}
            >
              <Text style={styles.showMoreText}>{strings.sessions.showMoreSessions(remaining)}</Text>
            </Pressable>
          )
        }}
        renderItem={({ item, section, index }) => {
          const isSelected = item.sessionId === selected?.sessionId && !section.id.startsWith('recent:')
          const hasFooter = groupBy !== 'list' && section.expanded && section.hasMoreFooter !== false && section.data.length < section.total
          const isFirstInList = groupBy === 'list' && index === 0
          const isLastInCard = index === section.data.length - 1 && !hasFooter
          const isRunning = browseStatus(item, lifecycles[item.sessionId]) === 'running'
          const isHarness = (item.backend ?? 'harness') === 'harness'
          const isPinned = isHarness && pinnedSessionIds.includes(item.sessionId) && !archivedIds.includes(item.sessionId)
          const isArchived = isHarness && archivedIds.includes(item.sessionId)
          const timeStr = formatRelativeTime(item.updatedAt)
          const displayTitle = resolveSessionDisplayTitle(item) ?? strings.sessions.untitled
          const accessibilityLabel = isPinned
            ? `${displayTitle}, ${strings.sessions.pinned}`
            : displayTitle
          const depth = section.depth ?? 0
          const accountKey = section.workspaceId ? `workspace:${backend}:${section.workspaceId}` : section.id
          const isDragging = dragState?.sessionId === item.sessionId && dragState.sectionId === section.id
          const isDragTarget = dragState !== null && dragState.sectionId === section.id && dragState.overIndex === index && !isDragging && isPinned === dragState.isPinned
          const dropAbove = isDragTarget && dragState.fromIndex > index
          const dropBelow = isDragTarget && dragState.fromIndex < index

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityState={{ selected: isSelected }}
              onPress={() => {
                if (justDraggedRef.current || dragState !== null) return
                if (isSelected) closeDrawer()
                else void onSelect(item)
              }}
              onLongPress={() => {
                if (searchQuery.trim() || section.id.startsWith('recent:')) {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                  setMenuSession(item)
                  return
                }
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                setDragState({
                  sessionId: item.sessionId,
                  sectionId: section.id,
                  accountKey,
                  fromIndex: index,
                  overIndex: index,
                  isPinned,
                })
                dragActiveRef.current = true
              }}
              delayLongPress={300}
              onTouchStart={(e) => {
                touchStartY.current = e.nativeEvent.pageY
              }}
              onTouchMove={(e) => {
                if (!dragActiveRef.current || !dragState || dragState.sessionId !== item.sessionId) return
                const currentY = e.nativeEvent.pageY
                const dy = currentY - touchStartY.current
                const rowHeight = 46
                const deltaSlots = Math.round(dy / rowHeight)
                const pinnedCount = section.data.filter(s => {
                  const isH = (s.backend ?? 'harness') === 'harness'
                  return isH && pinnedSessionIds.includes(s.sessionId) && !archivedIds.includes(s.sessionId)
                }).length
                const minSlot = dragState.isPinned ? 0 : pinnedCount
                const maxSlot = dragState.isPinned ? Math.max(0, pinnedCount - 1) : Math.max(minSlot, section.data.length - 1)
                const newIndex = Math.max(minSlot, Math.min(maxSlot, dragState.fromIndex + deltaSlots))
                if (newIndex !== dragState.overIndex) {
                  setDragState(curr => curr ? { ...curr, overIndex: newIndex } : null)
                }
              }}
              onTouchEnd={() => {
                if (dragActiveRef.current && dragState && dragState.sessionId === item.sessionId) {
                  justDraggedRef.current = true
                  setTimeout(() => { justDraggedRef.current = false }, 250)
                  const activeDrag = dragState
                  dragActiveRef.current = false
                  setDragState(null)
                  const { fromIndex, overIndex, accountKey: currentAccountKey } = activeDrag
                  if (fromIndex !== overIndex) {
                    const targetSession = section.data[overIndex]
                    const targetIsPinned = targetSession && (targetSession.backend ?? 'harness') === 'harness' && pinnedSessionIds.includes(targetSession.sessionId) && !archivedIds.includes(targetSession.sessionId)
                    if (targetSession && targetIsPinned === isPinned) {
                      const allGroupSessions = sessions.filter(s => {
                        if ((s.backend ?? 'harness') !== backend) return false
                        if (groupBy === 'list') return true
                        const isDefault = section.workspaceId === 'default'
                        return isDefault
                          ? !backendWorkspaces.some(w => w.sessionIds.includes(s.sessionId))
                          : section.workspaceId ? backendWorkspaces.find(w => w.workspaceId === section.workspaceId)?.sessionIds.includes(s.sessionId) : false
                      })
                      if (orderBy === 'updated') {
                        allGroupSessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
                      }
                      const baselineSessions = orderBy === 'manual'
                        ? applyManualOrder(allGroupSessions, manualOrders[currentAccountKey])
                        : allGroupSessions
                      const fullIds = baselineSessions.map(s => s.sessionId)
                      const direction = fromIndex < overIndex ? 'after' : 'before'
                      const next = reorderSessionIds(fullIds, item.sessionId, targetSession.sessionId, direction)
                      updateManualOrders(currentAccountKey, next, orderBy === 'updated')
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
                    }
                  }
                }
              }}
              onTouchCancel={() => {
                dragActiveRef.current = false
                setDragState(null)
              }}
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
                {isRunning && <View style={styles.runningDot} />}
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
                onPress={(e) => {
                  e.stopPropagation()
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
                  setMenuSession(item)
                }}
                style={styles.moreActionBtn}
              >
                <OfficialMenuIcons.ellipsis size={16} color={colors.muted} />
              </Pressable>
            </Pressable>
          )
        }}
      />
        </>
      )}

      {/* 底部常驻栏：左侧当前远程主机状态与切换入口，右侧轻量设置按钮 */}
      <View style={styles.hostFooterBar}>
        <View style={styles.hostFooterLeft}>{hostFooterDeviceInfo}</View>
        {onOpenSettings !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.settings.title}
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
                  {resolveSessionDisplayTitle(menuSession) ?? strings.sessions.untitled}
                </Text>
              </View>

              {canUseHarnessActions && (
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
                      currentTitle: resolveSessionDisplayTitle(menuSession) ?? '',
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

              {canUseHarnessActions && (
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
            accessibilityLabel="Close view options"
            onPress={closeConfig}
          />
          {/* 浮窗内容：位于遮罩之上，点击不会穿透 */}
          {configPopover}
        </View>
      )}

      {/* 切换 Harness 模态弹窗 */}
      <Modal
        visible={harnessPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHarnessPickerOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.harnessBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={() => setHarnessPickerOpen(false)} />
          <View style={[styles.harnessDialog, { maxHeight: sheetMaxHeight }]} accessibilityViewIsModal>
            <View style={styles.harnessHeader}>
              <Text style={styles.harnessTitle} accessibilityRole="header">切换 Harness</Text>
              <IconButton label={strings.common.close} icon={X} onPress={() => setHarnessPickerOpen(false)} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.harnessList}>
              <GroupCard>
                {HARNESS_OPTIONS.filter(option => backends.includes(option.value)).map((option, index) => {
                  const chosen = option.value === backend
                  return (
                    <GroupRow
                      key={option.value}
                      first={index === 0}
                      label={option.name}
                      detail={option.desc}
                      selected={chosen}
                      chevron={false}
                      accessory={chosen ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                      onPress={() => void handleSelectHarness(option.value)}
                    />
                  )
                })}
              </GroupCard>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 工作区新建 / 管理 / 重命名弹窗 */}
      <CreateWorkspaceModal
        visible={createWorkspaceOpen}
        codexAvailable={codexAvailable}
        cursorAvailable={cursorAvailable}
        antigravityAvailable={antigravityAvailable}
        piAvailable={piAvailable}
        opencodeAvailable={opencodeAvailable}
        claudeAvailable={claudeAvailable}
        hermesAvailable={hermesAvailable}
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
            void onSelect(latestSession).then(() => {
              if (useAppStore.getState().selectedDevice?.deviceId === expectedDeviceId) {
                closeDrawer()
              }
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
      <RenameWorkspaceModal
        target={renameWorkspaceTarget}
        busy={busy === 'rename-workspace'}
        onClose={() => setRenameWorkspaceTarget(undefined)}
        onRename={renameWorkspace}
      />
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

      <Modal
        visible={appMenuOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setAppMenuOpen(false)}
      >
        <View style={{ flex: 1 }}>
          <HomeActionsMenu
            visible={appMenuOpen}
            onClose={() => setAppMenuOpen(false)}
            onPlugins={onOpenPlugins !== undefined ? () => {
              setAppMenuOpen(false)
              onOpenPlugins()
            } : undefined}
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

      {/* DS-Bot 弹窗宿主 (创建/编辑 Bot & 群聊、上下文菜单、用量/日程报表) */}
      <BotModalsHost />
    </View>
  )

  if (inline) {
    return <View style={[styles.drawer, styles.inlineDrawer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{content}</View>
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.drawerHost]} pointerEvents="box-none">
      <View style={styles.overlayContainer}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: overlayOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" onPress={() => smoothClose(true)} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          {...drawerTouchProps}
          style={[styles.drawer, { paddingTop: insets.top, paddingBottom: insets.bottom, transform: [{ translateX }] }]}
        >
          {content}
        </Animated.View>
      </View>
    </View>
  )
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    drawerHost: { zIndex: 20, elevation: 20 },
    overlayContainer: { flex: 1 },
    overlay: { flex: 1, backgroundColor: colors.scrim },
    drawer: { flex: 1, width: '100%', maxWidth: '100%', backgroundColor: colors.background, overflow: 'hidden' },
    inlineDrawer: { width: '100%', maxWidth: '100%', borderRadius: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.separator },
    container: { flex: 1 },

    brandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: spacing.lg,
      paddingRight: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    brandLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, marginRight: spacing.sm, gap: 6 },
    brandTitle: { ...type.heading, fontSize: 19, lineHeight: 23, fontWeight: '800', letterSpacing: -0.4, color: colors.ink, flexShrink: 1 },
    brandBadge: {
      backgroundColor: colors.ink,
      paddingHorizontal: 5,
      paddingVertical: 1.5,
      borderRadius: 4,
    },
    brandBadgeText: {
      color: colors.background,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
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
    hostFooterBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
      backgroundColor: colors.background,
      paddingLeft: spacing.sm,
      paddingRight: spacing.sm,
      paddingVertical: 5,
    },
    hostFooterLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flex: 1,
      minWidth: 0,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      borderRadius: radius.md,
    },
    hostFooterIcon: { width: 30, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    hostFooterInfo: { flexShrink: 1, minWidth: 0, minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.xs, borderRadius: radius.md },
    hostFooterNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0, flexShrink: 1 },
    hostFooterName: { ...type.bodyStrong, fontSize: 13.5, lineHeight: 18, color: colors.ink, flexShrink: 1 },
    hostFooterStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
    hostFooterDot: { width: 6, height: 6, borderRadius: 3 },
    hostFooterStatusText: { ...type.caption, fontSize: 12, color: colors.muted },
    footerSettingsBtn: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
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
      borderColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    workspaceRowCardSingle: {
      borderRadius: radius.xl,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    workspaceRowCardTop: {
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
    workspaceRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
    workspaceRowTitle: { ...type.bodyStrong, fontSize: 15, color: colors.ink, flexShrink: 1 },
    workspaceCountText: {
      ...type.caption,
      fontSize: 12,
      color: colors.muted,
      backgroundColor: colors.surfaceStrong,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
    },
    workspaceRowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      flexShrink: 0,
    },
    workspaceSmallBtn: {
      width: 28,
      height: 28,
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
      borderColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    sessionRowCardTop: {
      marginTop: spacing.xs,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
    sessionRowCardBottom: {
      borderBottomLeftRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
      borderBottomWidth: StyleSheet.hairlineWidth,
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
    timeText: { ...type.caption, color: colors.subtle },

    showMoreRow: {
      paddingLeft: spacing.md + 14,
      paddingVertical: spacing.xs,
      minHeight: 38,
      justifyContent: 'center',
      marginHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomLeftRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
    },
    showMoreText: { ...type.caption, color: colors.primary, fontWeight: '500' },

    pressedBg: { backgroundColor: colors.surfaceStrong },
    pressedFade: { opacity: 0.72 },

    // 浮窗覆盖层：铺满抽屉内容区，作为唯一命中层，避免跨父级层级问题
    popoverLayer: {
      ...StyleSheet.absoluteFill,
      zIndex: 999,
      elevation: 999,
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
      elevation: 9999,
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
