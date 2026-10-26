import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  PanResponder,
  TextInput,
  SectionList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import Svg, { Path } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  FolderPlus,
  PlusCircle,
  RefreshCw,
  Search,
  Sliders,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import type { RemoteSession, WorkspaceView } from '../types'
import { strings } from '../locales/i18n'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../ui/fish-logo'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { resolveSessionDisplayTitle } from './session-title'
import { browseStatus } from '../lib/backend-groups'
import { clampDrawerTranslate, shouldConfirmSwipeLeftClose, shouldStartSwipeLeftToClose } from '../lib/gesture-swipe-rules'

const SESSION_PAGE_SIZE = 8

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

export function HostSessionsDrawer({
  onBack,
  onClose,
  onSelect,
  onOpenAutomationTasks,
  inline = false,
  backLabel,
}: {
  onBack: () => void
  onClose: () => void
  onSelect: (session: RemoteSession) => Promise<void>
  onOpenAutomationTasks?: () => void
  inline?: boolean
  backLabel?: string
}) {
  const language = useAppStore(state => state.language)
  const sessions = useAppStore(state => state.sessions)
  const lifecycles = useAppStore(state => state.sessionLifecycles)
  const selected = useAppStore(state => state.selectedSession)
  const archivedIds = useAppStore(state => state.archivedSessionIds)
  const workspaces = useAppStore(state => state.workspaces)
  const busy = useAppStore(state => state.busyAction)
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const refreshWorkspaces = useAppStore(state => state.refreshWorkspaces)
  const createSession = useAppStore(state => state.createSession)

  const [refreshing, setRefreshing] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [groupBy, setGroupBy] = useState<'workspace' | 'list'>('workspace')
  const [orderBy, setOrderBy] = useState<'manual' | 'updated'>('updated')
  const [filterMode, setFilterMode] = useState<'hideArchived' | 'all' | 'archivedOnly'>('hideArchived')
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({})
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})

  // 浮窗定位：记录工具栏在覆盖层坐标系中的底部位置（默认兜底 200，测量后精准对齐）
  const [popoverTop, setPopoverTop] = useState<number>(200)
  const toolbarRef = useRef<View>(null)
  const containerRef = useRef<View>(null)

  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()

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
    const targetWs = workspaces[0]?.workspaceId
    const ok = await createSession(targetWs)
    if (ok) onClose()
  }

  const handleRefresh = async () => {
    if (refreshing || busy !== undefined || !connected) return
    setRefreshing(true)
    try {
      await refreshWorkspaces()
    } finally {
      setRefreshing(false)
    }
  }

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces(prev => ({ ...prev, [id]: !(prev[id] ?? true) }))
  }

  const filteredSessions = useMemo(() => {
    let list = [...sessions]
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
  }, [sessions, archivedIds, filterMode, searchQuery, orderBy])

  const sections = useMemo(() => {
    if (groupBy === 'list') {
      return [{ id: 'all', title: strings.sessions.allSessions, data: filteredSessions, total: filteredSessions.length, expanded: true }]
    }
    const wsList: Array<WorkspaceView | { workspaceId: string; title: string; path: string; sessionIds: string[] }> =
      workspaces.length > 0 ? workspaces : [{ workspaceId: 'default', title: 'Default', path: '', sessionIds: [] }]
    return wsList.map(ws => {
      const isDefault = ws.workspaceId === 'default'
      const wsSessions = filteredSessions.filter(s =>
        isDefault ? !workspaces.some(w => w.sessionIds.includes(s.sessionId)) : ws.sessionIds.includes(s.sessionId)
      )
      const isExpanded = expandedWorkspaces[ws.workspaceId] ?? true
      const limit = visibleCounts[ws.workspaceId] ?? SESSION_PAGE_SIZE
      const title = ws.title || ws.path || ws.workspaceId
      return {
        id: ws.workspaceId,
        title,
        total: wsSessions.length,
        expanded: isExpanded,
        data: isExpanded ? wsSessions.slice(0, limit) : [],
      }
    })
  }, [groupBy, workspaces, filteredSessions, expandedWorkspaces, visibleCounts, language])

  // 手势与抽屉动画
  const { width: screenWidth } = useWindowDimensions()
  const drawerWidth = Math.min(Math.round(screenWidth * 0.85), 360)
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
      {/* 品牌顶部区 */}
      <View style={styles.brandHeader}>
        <View style={styles.brandLeft}>
          <Svg
            width={18}
            height={18}
            viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
            fill={colors.ink}
          >
            <Path d={FISH_LOGO_PATH} />
          </Svg>
          <Text style={styles.brandTitle}>deepseek</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>HARNESS</Text>
          </View>
        </View>
        <View style={styles.brandRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.common.refresh}
            onPress={() => void handleRefresh()}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <RefreshCw size={15} color={colors.muted} />
          </Pressable>
          {onBack && (
            <Pressable accessibilityRole="button" accessibilityLabel={backLabel ?? 'Back'} onPress={onBack} hitSlop={8} style={styles.iconBtn}>
              <ArrowLeft size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* New Session 按钮 */}
      <View style={styles.newSessionWrapper}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void handleNewSession()}
          style={({ pressed }) => [styles.newSessionBtn, pressed && styles.pressedBg]}
        >
          <PlusCircle size={16} color={colors.ink} />
          <Text style={styles.newSessionText}>{strings.sessions.newSession}</Text>
        </Pressable>
      </View>

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
        <Clock size={16} color={colors.muted} />
        <Text style={styles.navItemText}>{strings.automation.nav}</Text>
      </Pressable>

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
              <Search size={14} color={showSearch ? colors.ink : colors.muted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.sessions.viewOptions}
              hitSlop={6}
              onPress={() => setShowConfigModal(prev => !prev)}
              style={styles.iconBtn}
            >
              <Sliders size={14} color={showConfigModal ? colors.ink : colors.muted} />
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
              <FolderPlus size={14} color={colors.muted} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* 搜索框 */}
      {showSearch && (
        <View style={styles.searchContainer}>
          <Search size={14} color={colors.muted} />
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

      {/* 会话树状列表 */}
      <SectionList
        sections={sections}
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
                {isExp ? <FolderOpen size={16} color={colors.muted} /> : <Folder size={16} color={colors.muted} />}
                <Text style={styles.workspaceRowTitle} numberOfLines={1}>
                  {section.title}
                </Text>
              </View>
              {isExp ? <ChevronDown size={14} color={colors.muted} /> : <ChevronRight size={14} color={colors.muted} />}
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
          const timeStr = formatRelativeTime(item.updatedAt)

          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (isSelected) onClose()
                else void onSelect(item)
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
              <Text style={[styles.sessionText, isSelected && styles.sessionTextSelected]} numberOfLines={1}>
                {resolveSessionDisplayTitle(item) ?? strings.sessions.untitled}
              </Text>
              {timeStr ? <Text style={styles.timeText}>{timeStr}</Text> : null}
            </Pressable>
          )
        }}
      />

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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlayContainer: { flex: 1 },
    overlay: { flex: 1, backgroundColor: colors.scrim },
    drawer: { flex: 1, width: '85%', maxWidth: 360, backgroundColor: colors.surface },
    inlineDrawer: { width: '100%', maxWidth: '100%', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.separator },
    container: { flex: 1 },

    brandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    brandLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    brandTitle: { ...type.heading, fontSize: 18, fontWeight: '700', color: colors.ink },
    badge: {
      backgroundColor: '#000000',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: radius.sm,
    },
    badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    brandRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    iconBtn: { padding: 6, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },

    newSessionWrapper: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    newSessionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      height: 38,
      borderWidth: 1,
      borderColor: colors.separator,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    newSessionText: { ...type.smallStrong, color: colors.ink },

    navItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      height: 36,
      marginHorizontal: spacing.xs,
      borderRadius: radius.sm,
    },
    navItemText: { ...type.small, color: colors.ink },

    workspacesToolbarArea: { position: 'relative' },
    workspacesToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    workspacesTitle: { ...type.caption, fontWeight: '600', color: colors.muted },
    toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },

    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginHorizontal: spacing.md,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.sm,
      height: 32,
      borderWidth: 1,
      borderColor: colors.separator,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceStrong,
    },
    searchInput: { flex: 1, ...type.small, color: colors.ink, paddingVertical: 0 },

    listContainer: { paddingBottom: spacing.xl },

    workspaceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      height: 34,
      borderRadius: radius.sm,
    },
    workspaceRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
    workspaceRowTitle: { ...type.smallStrong, color: colors.ink, flex: 1 },

    sessionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: spacing.lg + spacing.xs,
      paddingRight: spacing.md,
      height: 34,
      borderRadius: radius.sm,
      marginHorizontal: spacing.xs,
    },
    sessionRowSelected: { backgroundColor: colors.surfaceStrong },
    statusIndicatorSlot: { width: 12, alignItems: 'flex-start', justifyContent: 'center' },
    runningDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' },
    sessionText: { ...type.small, color: colors.ink, flex: 1, marginRight: spacing.xs },
    sessionTextSelected: { fontWeight: '600' },
    timeText: { ...type.caption, color: colors.muted, fontSize: 11 },

    showMoreRow: {
      paddingLeft: spacing.lg + spacing.md,
      paddingVertical: spacing.xs,
      height: 30,
      justifyContent: 'center',
    },
    showMoreText: { ...type.caption, color: colors.muted },

    pressedBg: { opacity: 0.7, backgroundColor: colors.surfaceStrong },

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
      borderRadius: radius.sm,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.separator,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 8,
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
  })