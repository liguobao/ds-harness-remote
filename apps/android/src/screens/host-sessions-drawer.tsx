import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  TextInput,
  SectionList,
  ScrollView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import * as Clipboard from 'expo-clipboard'
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Puzzle,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Sliders,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import type { AgentBackend, RemoteSession, WorkspaceView } from '../types'
import { strings } from '../locales/i18n'
import { GroupCard, GroupRow, IconButton } from '../ui/components'
import { brandGlowShadow, floatingShadow, radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { resolveSessionDisplayTitle } from './session-title'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { browseStatus } from '../lib/backend-groups'
import { loadHostSessionsDrawerGroups, saveHostSessionsDrawerGroup, saveWorkspaceBackend } from '../services/storage'
import { clampDrawerTranslate, shouldConfirmSwipeLeftClose, shouldStartSwipeLeftToClose } from '../lib/gesture-swipe-rules'

const SESSION_PAGE_SIZE = 3
const DRAWER_WIDTH_RATIO = 0.85
const DRAWER_MAX_WIDTH = 360

/** 浮窗相对工具栏底部的间距 */
const POPOVER_OFFSET = 4
/** 浮窗到容器右边缘的距离（与工具栏 paddingHorizontal 对齐） */
const POPOVER_RIGHT_INSET = spacing.md

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

interface HarnessOption {
  value: AgentBackend
  name: string
  desc: string
}

const HARNESS_OPTIONS: HarnessOption[] = [
  { value: 'harness', name: 'DeepSeek Harness', desc: '官方 DeepSeek 智能体框架' },
  { value: 'codex', name: 'CodeX', desc: 'OpenAI CodeX 编程智能体' },
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
    case 'codex': return 'CodeX'
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
  onSelect,
  onOpenAutomationTasks,
  onOpenPlugins,
  inline = false,
  backLabel,
}: {
  onBack: () => void
  onClose: () => void
  onOpenWorkspaces: () => void
  onSelect: (session: RemoteSession) => Promise<void>
  onOpenAutomationTasks?: () => void
  onOpenPlugins?: () => void
  inline?: boolean
  backLabel?: string
}) {
  const language = useAppStore(state => state.language)
  const deviceId = useAppStore(state => state.selectedDevice?.deviceId)
  const deviceName = useAppStore(state => state.selectedDevice?.name)
  const sessions = useAppStore(state => state.sessions)
  const recentIds = useAppStore(state => state.currentWorkSessionIds)
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
  const busy = useAppStore(state => state.busyAction)
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const refreshWorkspaces = useAppStore(state => state.refreshWorkspaces)
  const createSession = useAppStore(state => state.createSession)
  const pinSession = useAppStore(state => state.pinSession)
  const unpinSession = useAppStore(state => state.unpinSession)
  const renameSession = useAppStore(state => state.renameSession)
  const forkSession = useAppStore(state => state.forkSession)
  const archiveSession = useAppStore(state => state.archiveSession)
  const unarchiveSession = useAppStore(state => state.unarchiveSession)

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
    if (connected) void refreshWorkspaces(backend)
  }, [backend, connected, deviceId, refreshWorkspaces])

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

    if (target === backend && selected && (selected.backend ?? 'harness') === target) {
      closeDrawer()
      return
    }

    let success = false
    const targetSessions = sessions.filter(s => (s.backend ?? 'harness') === target && !archivedIds.includes(s.sessionId))
    if (targetSessions.length > 0) {
      const latest = [...targetSessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (latest) {
        await onSelect(latest)
        success = true
      }
    } else {
      const targetWs = workspaces.find(w => (w.backend ?? 'harness') === target)?.workspaceId
      success = await createSession(targetWs, target)
    }

    if (success) {
      setBackend(target)
      if (deviceId !== undefined) {
        void saveWorkspaceBackend(deviceId, target)
      }
      if (connected) {
        void refreshWorkspaces(target)
      }
      closeDrawer()
    } else {
      Alert.alert(
        strings.common.unavailable ?? '切换失败',
        `无法切换到 ${harnessDisplayName(target)} 对话，请稍后重试。`,
      )
    }
  }

  const [refreshing, setRefreshing] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [groupBy, setGroupBy] = useState<'workspace' | 'list'>('workspace')
  const [orderBy, setOrderBy] = useState<'manual' | 'updated'>('updated')
  const [filterMode, setFilterMode] = useState<'hideArchived' | 'all' | 'archivedOnly'>('hideArchived')
  const [groupsByDevice, setGroupsByDevice] = useState<Record<string, Record<string, boolean>>>({})
  const [loadedDeviceId, setLoadedDeviceId] = useState<string>()
  const [groupStorageError, setGroupStorageError] = useState<string>()
  const groupsReady = deviceId === undefined || loadedDeviceId === deviceId
  const expandedWorkspaces = deviceId === undefined ? {} : groupsByDevice[deviceId] ?? {}
  useEffect(() => {
    if (deviceId === undefined) return
    let cancelled = false
    setLoadedDeviceId(undefined)
    setGroupStorageError(undefined)
    void loadHostSessionsDrawerGroups(deviceId).then(saved => {
      if (!cancelled) setGroupsByDevice(current => ({
        ...current, [deviceId]: { ...saved, ...current[deviceId] },
      }))
    }).catch(() => {
      if (!cancelled) setGroupStorageError(strings.comfort.cacheRestoreFailed)
    }).finally(() => {
      if (!cancelled) setLoadedDeviceId(deviceId)
    })
    return () => { cancelled = true }
  }, [deviceId])
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})

  // 浮窗定位：记录工具栏在覆盖层坐标系中的底部位置（默认兜底 200，测量后精准对齐）
  const [popoverTop, setPopoverTop] = useState<number>(200)
  const toolbarRef = useRef<View>(null)
  const containerRef = useRef<View>(null)

  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()

  const creatingSessionRef = useRef(false)
  const lastNewSessionTimeRef = useRef(0)
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

  const handleNewSession = async () => {
    const now = Date.now()
    if (now - lastNewSessionTimeRef.current < 800) return
    if (creatingSessionRef.current || busy !== undefined || !connected) return

    const targetWs = backendWorkspaces[0]?.workspaceId
    const currentMessages = selected === undefined ? [] : useAppStore.getState().messages[selected.sessionId] ?? []
    const isCurrentBlank = selected !== undefined && currentMessages.length === 0 && selected.blank !== false
    const currentWs = workspaces.find(w => selected !== undefined && w.sessionIds.includes(selected.sessionId))
    if (isCurrentBlank && (targetWs === undefined || currentWs?.workspaceId === targetWs)) {
      onClose()
      return
    }

    creatingSessionRef.current = true
    lastNewSessionTimeRef.current = now
    try {
      const ok = await createSession(targetWs, backend)
      if (ok) onClose()
    } finally {
      creatingSessionRef.current = false
    }
  }

  const handleRefresh = async () => {
    if (refreshing || busy !== undefined || !connected) return
    setRefreshing(true)
    try {
      await refreshWorkspaces(backend)
    } finally {
      setRefreshing(false)
    }
  }

  const toggleWorkspace = (id: string) => {
    if (deviceId === undefined || !groupsReady) return
    const expanded = !(expandedWorkspaces[id] ?? true)
    setGroupsByDevice(current => ({ ...current,
      [deviceId]: { ...current[deviceId], [id]: expanded },
    }))
    void saveHostSessionsDrawerGroup(deviceId, id, expanded).catch(() => {
      if (useAppStore.getState().selectedDevice?.deviceId === deviceId) {
        setGroupStorageError(strings.comfort.cacheSaveFailed)
      }
    })
  }

  const filteredSessions = useMemo(() => {
    const known = selected && !sessions.some(session => session.sessionId === selected.sessionId)
      ? [selected, ...sessions] : sessions
    let list = known.filter(session => (session.backend ?? 'harness') === backend)
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
  }, [sessions, selected, backend, archivedIds, filterMode, searchQuery, orderBy])

  const sections = useMemo(() => {
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
      const ordered = partitionPinned(filteredSessions)
      return [{ id: 'all', title: strings.sessions.allSessions, data: ordered, total: ordered.length, expanded: true }]
    }
    const recentOrder = new Map(recentIds.map((id, index) => [id, index]))
    if (selected) recentOrder.set(selected.sessionId, recentIds.length)
    const recent = partitionPinned(
      filteredSessions
        .filter(session => recentOrder.has(session.sessionId))
        .sort((a, b) => recentOrder.get(b.sessionId)! - recentOrder.get(a.sessionId)!)
        .slice(0, 5),
    )
    const recentExpanded = expandedWorkspaces[`recent:${backend}`] ?? true
    const recentSections = recent.length ? [{ id: `recent:${backend}`, title: strings.comfort.recent,
      data: recentExpanded ? recent : [], total: recent.length, expanded: recentExpanded }] : []
    const wsList: Array<WorkspaceView | { workspaceId: string; title: string; path: string; sessionIds: string[] }> =
      backendWorkspaces.length > 0 ? backendWorkspaces : [{ workspaceId: 'default', title: 'Default', path: '', sessionIds: [] }]
    return [...recentSections, ...wsList.map(ws => {
      const isDefault = ws.workspaceId === 'default'
      const wsSessions = partitionPinned(filteredSessions.filter(s =>
        isDefault ? !backendWorkspaces.some(w => w.sessionIds.includes(s.sessionId)) : ws.sessionIds.includes(s.sessionId)
      ))
      const groupId = `workspace:${backend}:${ws.workspaceId}`
      const isExpanded = expandedWorkspaces[groupId] ?? true
      const limit = visibleCounts[groupId] ?? SESSION_PAGE_SIZE
      const title = ws.title || ws.path || ws.workspaceId
      return {
        id: groupId,
        title,
        total: wsSessions.length,
        expanded: isExpanded,
        data: isExpanded ? wsSessions.slice(0, limit) : [],
      }
    })]
  }, [groupBy, backendWorkspaces, backend, filteredSessions, recentIds, selected, expandedWorkspaces, visibleCounts, language, pinnedSessionIds, archivedIds])

  // 手势与抽屉动画
  const { width: screenWidth } = useWindowDimensions()
  const drawerWidth = Math.min(Math.round(screenWidth * DRAWER_WIDTH_RATIO), DRAWER_MAX_WIDTH)
  const translateX = useRef(new Animated.Value(-drawerWidth)).current
  const overlayOpacity = useRef(new Animated.Value(0)).current
  const dragStartX = useRef(0)
  const closingRef = useRef(false)
  const animSeq = useRef(0)
  const currentAnim = useRef<Animated.CompositeAnimation | null>(null)
  const gestureSeq = useRef(0)
  const dragReady = useRef(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const smoothClose = (withHaptic = true) => {
    if (closingRef.current) return
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

  useEffect(() => {
    if (inline) return
    const anim = Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ])
    currentAnim.current = anim
    anim.start()
    return () => currentAnim.current?.stop()
  }, [inline, drawerWidth, translateX, overlayOpacity])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => (!inline && !closingRef.current ? shouldStartSwipeLeftToClose(g) : false),
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

  const closeConfig = () => setShowConfigModal(false)

  /** 排序配置浮窗（在覆盖层内部渲染，供点击命中） */
  const configPopover = (
    <View
      style={[
        styles.configPopover,
        { top: popoverTop, right: POPOVER_RIGHT_INSET },
      ]}
    >
      <Text style={styles.modalSectionLabel}>{strings.sessions.groupBy}</Text>
      <Pressable style={styles.modalItem} onPress={() => { setGroupBy('workspace'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.groupByWorkspace}</Text>
        {groupBy === 'workspace' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { setGroupBy('list'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.groupByList}</Text>
        {groupBy === 'list' && <Check size={14} color={colors.ink} />}
      </Pressable>

      <View style={styles.modalDivider} />

      <Text style={styles.modalSectionLabel}>{strings.sessions.orderBy}</Text>
      <Pressable style={styles.modalItem} onPress={() => { setOrderBy('manual'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.orderManual}</Text>
        {orderBy === 'manual' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { setOrderBy('updated'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.orderUpdated}</Text>
        {orderBy === 'updated' && <Check size={14} color={colors.ink} />}
      </Pressable>

      <View style={styles.modalDivider} />

      <Text style={styles.modalSectionLabel}>{strings.sessions.filterSessions}</Text>
      <Pressable style={styles.modalItem} onPress={() => { setFilterMode('hideArchived'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.filterHideArchived}</Text>
        {filterMode === 'hideArchived' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { setFilterMode('all'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.filterAll}</Text>
        {filterMode === 'all' && <Check size={14} color={colors.ink} />}
      </Pressable>
      <Pressable style={styles.modalItem} onPress={() => { setFilterMode('archivedOnly'); closeConfig() }}>
        <Text style={styles.modalItemText}>{strings.sessions.filterArchivedOnly}</Text>
        {filterMode === 'archivedOnly' && <Check size={14} color={colors.ink} />}
      </Pressable>
    </View>
  )

  const content = (
    <View ref={containerRef} style={styles.container} collapsable={false}>
      {/* 当前主机 */}
      <View style={styles.brandHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${deviceName ?? strings.devices.title} · ${strings.chat.backToWorkspaces}`}
          onPress={onOpenWorkspaces} hitSlop={8}
          style={({ pressed }) => [styles.brandLeft, pressed && styles.pressedFade]}>
          <Text style={styles.brandTitle} numberOfLines={1}>{deviceName ?? strings.devices.title}</Text>
        </Pressable>
        <View style={styles.brandRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.common.refresh}
            onPress={() => void handleRefresh()}
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtnRound, pressed && styles.pressedBg]}
          >
            <RefreshCw size={17} color={colors.ink} strokeWidth={1.9} />
          </Pressable>
          {onBack && (
            <Pressable accessibilityRole="button" accessibilityLabel={backLabel ?? 'Back'} onPress={onBack} hitSlop={8} style={({ pressed }) => [styles.iconBtnRound, pressed && styles.pressedBg]}>
              <ArrowLeft size={18} color={colors.ink} strokeWidth={1.9} />
            </Pressable>
          )}
        </View>
      </View>

      {/* 智能体平台切换 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`智能体平台，当前 ${harnessDisplayName(backend)}`}
        onPress={() => setHarnessPickerOpen(true)}
        style={({ pressed }) => [styles.navItem, pressed && styles.pressedBg]}
      >
        <Bot size={20} color={colors.ink} strokeWidth={1.8} />
        <Text style={[styles.navItemText, styles.harnessLabel]}>智能体平台</Text>
        <View style={styles.harnessTrailing}>
          <Text style={styles.harnessTrailingText} numberOfLines={1}>{harnessDisplayName(backend)}</Text>
          <ChevronDown size={15} color={colors.muted} strokeWidth={1.8} />
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.sessions.workspaces}
        onPress={onOpenWorkspaces}
        style={({ pressed }) => [styles.navItem, pressed && styles.pressedBg]}
      >
        <LayoutGrid size={20} color={colors.ink} strokeWidth={1.8} />
        <Text style={styles.navItemText}>{strings.sessions.workspaces}</Text>
      </Pressable>

      {onOpenPlugins !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.plugins.nav}
          onPress={onOpenPlugins}
          style={({ pressed }) => [styles.navItem, pressed && styles.pressedBg]}
        >
          <Puzzle size={20} color={colors.ink} strokeWidth={1.8} />
          <Text style={styles.navItemText}>{strings.plugins.nav}</Text>
        </Pressable>
      )}

      {/* 固定自动化入口 */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.automation.nav}
        onPress={() => {
          if (onOpenAutomationTasks) {
            onOpenAutomationTasks()
          } else {
            Alert.alert(strings.automation.title, strings.automation.empty)
          }
        }}
        style={({ pressed }) => [styles.navItem, pressed && styles.pressedBg]}
      >
        <Clock size={20} color={colors.ink} strokeWidth={1.8} />
        <Text style={styles.navItemText}>{strings.automation.nav}</Text>
      </Pressable>

      {backends.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0, marginTop: spacing.sm }} contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: 4, gap: spacing.xxs }}>
        {backends.map(value => <Pressable key={value} accessibilityRole="tab"
          accessibilityState={{ selected: backend === value }} onPress={() => setBackend(value)}
          style={({ pressed }) => [styles.backendTab, backend === value && styles.backendTabActive, pressed && styles.pressedFade]}>
          <Text style={[styles.backendTabText, backend === value && styles.backendTabTextActive]}>{backendLabel(value)}</Text>
        </Pressable>)}
      </ScrollView>}

      {/* Workspaces 标题栏与工具栏 */}
      <View ref={toolbarRef} style={styles.workspacesToolbarArea} collapsable={false}>
        <View style={styles.workspacesToolbar}>
          <Text style={styles.workspacesTitle}>{strings.sessions.workspaces}</Text>
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
                Alert.alert(
                  strings.workspaces.title,
                  strings.sessions.manageWorkspacesPrompt,
                  [
                    { text: strings.common.cancel, style: 'cancel' },
                    { text: strings.sessions.goToWorkspaces, onPress: () => { onClose(); onBack() } }
                  ]
                )
              }}
              style={styles.iconBtn}
            >
              <FolderPlus size={17} color={colors.muted} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* 搜索框 */}
      {showSearch && (
        <View style={styles.searchContainer}>
          <Search size={16} color={colors.muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={strings.comfort.search}
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoFocus
          />
        </View>
      )}

      {groupStorageError && <Text accessibilityRole="alert" style={{ color: colors.muted, paddingHorizontal: spacing.md }}>{groupStorageError}</Text>}
      {/* 会话树状列表 */}
      <SectionList
        sections={groupsReady ? sections : []}
        ListEmptyComponent={groupsReady ? null : <ActivityIndicator color={colors.muted} accessibilityLabel={strings.workspaces.loading} />}
        keyExtractor={item => item.sessionId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContainer}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => {
          if (groupBy === 'list') return null
          const isExp = section.expanded
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => toggleWorkspace(section.id)}
              style={({ pressed }) => [styles.workspaceRow, pressed && styles.pressedBg]}
            >
              <View style={styles.workspaceRowLeft}>
                {isExp ? <FolderOpen size={18} color={colors.muted} strokeWidth={1.8} /> : <Folder size={18} color={colors.muted} strokeWidth={1.8} />}
                <Text style={styles.workspaceRowTitle} numberOfLines={1}>
                  {section.title}
                </Text>
              </View>
              {isExp ? <ChevronDown size={16} color={colors.subtle} /> : <ChevronRight size={16} color={colors.subtle} />}
            </Pressable>
          )
        }}
        renderSectionFooter={({ section }) => {
          if (groupBy === 'list' || !section.expanded || section.data.length >= section.total) return null
          const remaining = section.total - section.data.length
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setVisibleCounts(c => ({
                  ...c,
                  [section.id]: (c[section.id] ?? SESSION_PAGE_SIZE) + SESSION_PAGE_SIZE,
                }))
              }
              style={styles.showMoreRow}
            >
              <Text style={styles.showMoreText}>{strings.sessions.showMoreSessions(remaining)}</Text>
            </Pressable>
          )
        }}
        renderItem={({ item }) => {
          const isSelected = item.sessionId === selected?.sessionId
          const isRunning = browseStatus(item, lifecycles[item.sessionId]) === 'running'
          const isHarness = (item.backend ?? 'harness') === 'harness'
          const isPinned = isHarness && pinnedSessionIds.includes(item.sessionId) && !archivedIds.includes(item.sessionId)
          const isArchived = isHarness && archivedIds.includes(item.sessionId)
          const timeStr = formatRelativeTime(item.updatedAt)
          const displayTitle = resolveSessionDisplayTitle(item) ?? strings.sessions.untitled
          const accessibilityLabel = isPinned
            ? `${displayTitle}, ${strings.sessions.pinned}`
            : displayTitle

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityState={{ selected: isSelected }}
              onPress={() => {
                if (isSelected) closeDrawer()
                else void onSelect(item)
              }}
              onLongPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                setMenuSession(item)
              }}
              style={({ pressed }) => [
                styles.sessionRow,
                isSelected && styles.sessionRowSelected,
                pressed && styles.pressedBg,
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

      <View style={styles.newSessionFloat} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.sessions.newSession}
          onPress={() => void handleNewSession()}
          style={({ pressed }) => [styles.newSessionBtn, pressed && styles.pressedFade]}
        >
          <Plus size={19} color={colors.onInverse} strokeWidth={2.2} />
          <Text style={styles.newSessionText}>{strings.sessions.newSession}</Text>
        </Pressable>
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
                {HARNESS_OPTIONS.map((option, index) => {
                  const chosen = option.value === backend
                  const available = isBackendAvailable(option.value)
                  return (
                    <GroupRow
                      key={option.value}
                      first={index === 0}
                      label={option.name}
                      detail={available ? option.desc : `${option.desc}（未启用）`}
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
    </View>
  )

  if (inline) {
    return <View style={[styles.drawer, styles.inlineDrawer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{content}</View>
  }

  return (
    <Modal transparent animationType="none" onRequestClose={() => smoothClose(false)} statusBarTranslucent>
      <View style={styles.overlayContainer}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: overlayOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" onPress={() => smoothClose(true)} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          {...panResponder.panHandlers}
          style={[styles.drawer, { paddingTop: insets.top, paddingBottom: insets.bottom, transform: [{ translateX }] }]}
        >
          {content}
        </Animated.View>
      </View>
    </Modal>
  )
}

function backendLabel(value: AgentBackend): string {
  switch (value) {
    case 'harness': return strings.workspaces.dsh
    case 'codex': return strings.workspaces.codex
    case 'cursor': return strings.workspaces.cursor
    case 'claude': return strings.workspaces.claude
    case 'hermes': return strings.workspaces.hermes
    case 'opencode': return strings.workspaces.opencode
    case 'pi': return strings.workspaces.pi
    case 'antigravity': return strings.workspaces.antigravity
    default: return value
  }
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlayContainer: { flex: 1 },
    overlay: { flex: 1, backgroundColor: colors.scrim },
    drawer: { flex: 1, width: `${DRAWER_WIDTH_RATIO * 100}%`, maxWidth: DRAWER_MAX_WIDTH, backgroundColor: colors.background, borderTopRightRadius: radius.xxl, borderBottomRightRadius: radius.xxl, overflow: 'hidden' },
    inlineDrawer: { width: '100%', maxWidth: '100%', borderRadius: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.separator },
    container: { flex: 1 },

    brandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: spacing.lg,
      paddingRight: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
    },
    brandLeft: { flex: 1, minWidth: 0, marginRight: spacing.sm, gap: 4 },
    brandTitle: { ...type.heading, fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.ink },
    brandRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    iconBtn: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    iconBtnRound: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, ...floatingShadow(colors) },

    // Floating black pill, as in the reference sidebar.
    newSessionFloat: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, zIndex: 20 },
    newSessionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      height: 52,
      paddingHorizontal: spacing.xl,
      borderRadius: radius.pill,
      backgroundColor: colors.inverse,
      ...brandGlowShadow(colors),
    },
    newSessionText: { ...type.bodyStrong, color: colors.onInverse },

    navItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      height: 50,
      marginHorizontal: spacing.xs,
      borderRadius: radius.lg,
    },
    backendTab: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      height: 36,
      borderRadius: radius.pill,
    },
    backendTabActive: { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, ...floatingShadow(colors) },
    backendTabText: { ...type.small, fontSize: 15, color: colors.muted },
    backendTabTextActive: { color: colors.ink, fontWeight: '600' },
    navItemText: { ...type.body, fontSize: 17, color: colors.ink },

    workspacesToolbarArea: { position: 'relative' },
    workspacesToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: spacing.lg,
      paddingRight: spacing.sm,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxs,
    },
    workspacesTitle: { ...type.small, fontSize: 15, color: colors.muted },
    toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },

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

    listContainer: { paddingBottom: 104 },

    workspaceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      height: 44,
      marginHorizontal: spacing.xs,
      borderRadius: radius.lg,
    },
    workspaceRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
    workspaceRowTitle: { ...type.bodyStrong, fontSize: 15, color: colors.ink, flex: 1 },

    sessionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: spacing.lg + spacing.xs,
      paddingRight: spacing.xxs,
      height: 46,
      borderRadius: radius.lg,
      marginHorizontal: spacing.xs,
    },
    sessionRowSelected: { backgroundColor: colors.surfaceStrong },
    statusIndicatorSlot: { width: 14, alignItems: 'flex-start', justifyContent: 'center' },
    runningDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
    sessionText: { ...type.body, fontSize: 16, color: colors.ink, flex: 1, marginRight: spacing.xs },
    sessionTextSelected: { fontWeight: '600' },
    timeText: { ...type.caption, color: colors.subtle },

    showMoreRow: {
      paddingLeft: spacing.lg + spacing.md,
      paddingVertical: spacing.xs,
      height: 36,
      justifyContent: 'center',
    },
    showMoreText: { ...type.caption, color: colors.muted },

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
