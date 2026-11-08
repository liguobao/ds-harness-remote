import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  FileText,
  FolderOpen,
  Globe,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Settings,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings as s } from '../../locales/i18n'
import {
  canDeleteBot,
  object,
  objects,
  text,
  type BotEntry,
  type BotObject,
  type BotOperation,
  type BotRemoteClient,
  type BotRoom,
  type BotState,
} from '../../services/bot-catalog'
import { useAppStore } from '../../state/store'
import { Button, IconButton } from '../../ui/components'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { Toggle } from '../../ui/toggle'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ModalSurface } from '../chat/modal'
import { BotAgentBadge, engineOfModel } from './agent-badge'
import { BotAvatar, BotAvatarWithBadge } from './avatar'
import { BotFloatingPopover, type BotPopoverAction } from './popover-menu'
import {
  BotBrowserPane,
  BotFolderPickerModal,
  BotMemoryPanel,
  BotSchedulesPanel,
  folderBasename,
  formatCompactTokens,
  formatScheduleSummary,
} from './shared-panels'

type ProfileTopTab = 'details' | 'browser'
type ProfileSubPage = 'sessions' | 'memory' | 'usage' | 'schedules' | null

function isNonEmptyObject(value: BotObject | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0
}

function groupBotModels(models: BotObject[]): { provider: string; label: string; items: BotObject[] }[] {
  const groups = new Map<string, BotObject[]>()
  for (const model of models) {
    const ref = text(model.ref)
    const provider = text(model.provider) || text(model.providerName) || ref.split('/')[0] || 'default'
    const existing = groups.get(provider)
    if (existing) existing.push(model)
    else groups.set(provider, [model])
  }
  return [...groups].map(([provider, items]) => ({
    provider,
    label: text(items[0]?.providerName) || provider,
    items,
  }))
}

export function BotProfilePage({
  visible,
  bot,
  room,
  state,
  client,
  busy,
  error,
  runStats,
  onClose,
  onEdit,
  perform,
}: {
  visible: boolean
  bot?: BotEntry
  room?: BotRoom
  state: BotState
  client?: BotRemoteClient
  busy: boolean
  error?: string
  runStats?: BotObject | null
  onClose: () => void
  onEdit: () => void
  perform: (operation: BotOperation, payload?: BotObject) => Promise<{ ok: boolean; value?: unknown }>
}) {
  const insets = useSafeAreaInsets()
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(createProfileStyles)
  const appSessions = useAppStore(store => store.sessions)

  const [mounted, setMounted] = useState(visible)
  const [topTab, setTopTab] = useState<ProfileTopTab>('details')
  const [subPage, setSubPage] = useState<ProfileSubPage>(null)
  const [mountedSubPage, setMountedSubPage] = useState<ProfileSubPage>(null)
  const [schedulesStartCreating, setSchedulesStartCreating] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)

  const [schedulesData, setSchedulesData] = useState<BotObject[] | null>(null)
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [memoryCount, setMemoryCount] = useState<number | null>(null)
  const [usageData, setUsageData] = useState<BotObject | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)

  const screenWidth = Dimensions.get('window').width || 390
  const slideAnim = useRef(new Animated.Value(screenWidth)).current
  const subSlideAnim = useRef(new Animated.Value(screenWidth)).current

  useEffect(() => {
    if (visible) {
      setMounted(true)
      setTopTab('details')
      setSubPage(null)
      setMountedSubPage(null)
      setMoreOpen(false)
      slideAnim.setValue(screenWidth)
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    } else if (mounted) {
      setMoreOpen(false)
      Animated.timing(slideAnim, {
        toValue: screenWidth,
        duration: 210,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false)
          setSubPage(null)
          setMountedSubPage(null)
        }
      })
    }
  }, [visible, screenWidth, slideAnim, mounted])

  const openSubPage = useCallback(
    (target: Exclude<ProfileSubPage, null>, createScheduleNow = false) => {
      setSchedulesStartCreating(createScheduleNow)
      setSubPage(target)
      setMountedSubPage(target)
      subSlideAnim.setValue(screenWidth)
      Animated.timing(subSlideAnim, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    },
    [screenWidth, subSlideAnim],
  )

  const closeSubPage = useCallback(() => {
    setSubPage(null)
    Animated.timing(subSlideAnim, {
      toValue: screenWidth,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMountedSubPage(null)
    })
  }, [screenWidth, subSlideAnim])

  const handleBack = useCallback(() => {
    if (moreOpen) {
      setMoreOpen(false)
      return true
    }
    if (subPage !== null) {
      closeSubPage()
      return true
    }
    onClose()
    return true
  }, [moreOpen, subPage, closeSubPage, onClose])

  useEffect(() => {
    if (!visible) return
    const sub = BackHandler.addEventListener('hardwareBackPress', handleBack)
    return () => sub.remove()
  }, [visible, handleBack])

  const reloadSchedules = useCallback(() => {
    if (!visible || !client) return
    setSchedulesLoading(true)
    void client
      .call('schedules')
      .then(val => {
        setSchedulesData(objects(object(val).tasks))
      })
      .catch(() => setSchedulesData([]))
      .finally(() => setSchedulesLoading(false))
  }, [visible, client])

  useEffect(() => {
    reloadSchedules()
  }, [reloadSchedules, bot?.id, room?.id])

  useEffect(() => {
    const ownerId = bot?.id ?? room?.id
    if (!visible || !client || !ownerId || state.memory === false) {
      setMemoryCount(0)
      return
    }
    let cancelled = false
    setMemoryCount(null)
    void client
      .call('memory-view', { id: ownerId })
      .then(res => {
        if (!cancelled) setMemoryCount(objects(object(res).entries).length)
      })
      .catch(() => {
        if (!cancelled) setMemoryCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [visible, client, bot?.id, room?.id, state.memory])

  const loadFullUsage = useCallback(() => {
    if (!client) return
    setUsageLoading(true)
    void client
      .call('usage', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      .then(val => setUsageData(object(val)))
      .catch(() => setUsageData(null))
      .finally(() => setUsageLoading(false))
  }, [client])

  useEffect(() => {
    if (visible && client) loadFullUsage()
  }, [visible, client, loadFullUsage, bot?.id, room?.id])

  const botSchedules = useMemo(() => {
    if (!schedulesData) return []
    if (bot) {
      return schedulesData.filter(
        t => text(t.botId) === bot.id || text(t.sessionId) === bot.sessionId || (bot.parts ?? []).includes(text(t.sessionId)),
      )
    }
    if (room) {
      return schedulesData.filter(
        t => text(t.roomId) === room.id || text(t.sessionId) === room.sessionId || (room.ownParts ?? []).includes(text(t.sessionId)),
      )
    }
    return []
  }, [schedulesData, bot, room])

  if (!mounted || (!bot && !room)) return null

  const mainCount = state.bots.filter(b => b.main).length
  const allParts = bot
    ? [bot.sessionId, ...(bot.parts ?? []).filter(id => id !== bot.sessionId).slice().reverse()]
    : []

  const confirmDelete = () => {
    const targetId = bot?.id ?? room?.id
    if (!targetId) return
    Alert.alert(s.bots.delete, s.bots.deleteHint, [
      { text: s.bots.cancel, style: 'cancel' },
      {
        text: s.bots.delete,
        style: 'destructive',
        onPress: () => {
          onClose()
          void perform(bot ? 'delete-bot' : 'delete-room', { id: targetId })
        },
      },
    ])
  }

  const popoverActions: BotPopoverAction[] = []
  if (bot) {
    popoverActions.push({
      key: 'browser',
      icon: Globe,
      label: s.bots.browser,
      onPress: () => setTopTab('browser'),
    })
    popoverActions.push({
      key: 'sessions',
      icon: FolderOpen,
      label: `${s.bots.sessions} (${allParts.length})`,
      onPress: () => openSubPage('sessions'),
    })
    popoverActions.push({
      key: 'new-part',
      icon: Plus,
      label: s.bots.newSession,
      disabled: busy || Boolean(state.readOnly),
      onPress: () => {
        onClose()
        void perform('bot-new-part', { botId: bot.id })
      },
    })
    if (!bot.main || mainCount > 1) {
      popoverActions.push({
        key: 'main',
        icon: ArrowLeftRight,
        label: bot.main ? s.bots.removeMain : s.bots.replaceMain,
        disabled: busy || Boolean(state.readOnly),
        onPress: () => void perform('set-main', { id: bot.id, main: !bot.main }),
      })
    }
    if (!bot.private) {
      popoverActions.push({
        key: 'duplicate',
        icon: CopyPlus,
        label: s.bots.duplicate,
        disabled: busy || Boolean(state.readOnly),
        onPress: () => {
          onClose()
          void perform('duplicate-bot', { id: bot.id })
        },
      })
    }
    popoverActions.push({
      key: 'copy-id',
      icon: Copy,
      label: s.bots.copyId,
      onPress: () => void Clipboard.setStringAsync(bot.id),
    })
    if (canDeleteBot(state, bot)) {
      popoverActions.push({
        key: 'delete',
        icon: Trash2,
        label: s.bots.delete,
        danger: true,
        disabled: busy || Boolean(state.readOnly),
        onPress: confirmDelete,
      })
    }
  } else if (room) {
    popoverActions.push({
      key: 'stop-room',
      icon: Square,
      label: s.bots.stop,
      disabled: busy || Boolean(state.readOnly),
      onPress: () => void perform('stop-room-work', { roomId: room.id }),
    })
    popoverActions.push({
      key: 'copy-id',
      icon: Copy,
      label: s.bots.copyId,
      onPress: () => void Clipboard.setStringAsync(room.id),
    })
    popoverActions.push({
      key: 'delete',
      icon: Trash2,
      label: s.bots.delete,
      danger: true,
      disabled: busy || Boolean(state.readOnly),
      onPress: confirmDelete,
    })
  }

  // Model & availability (Figure 1: `group/duty` + `magpie · 不可用`)
  const activeModelRef = bot ? bot.model || bot.appliedModel || state.defaultModel || '' : ''
  const matchedModel = activeModelRef ? state.models.find(m => text(m.ref) === activeModelRef) : undefined
  const modelAvailable = !activeModelRef || state.models.length === 0 || Boolean(matchedModel && !matchedModel.needsKey)
  const modelTitle = activeModelRef
    ? text(matchedModel?.name) || text(matchedModel?.label) || activeModelRef
    : s.bots.defaultModel
  const modelProvider = activeModelRef
    ? text(matchedModel?.providerName) || text(matchedModel?.provider) || activeModelRef.split('/')[0] || ''
    : ''

  // Permission preset (`read-only` | `workspace-write` | `danger-full-access`)
  const defaultPerm = text(state.permissions?.defaultPreset) || 'workspace-write'
  const currentPerm = bot?.permission || defaultPerm

  // Usage summary (`600.9K tok · 缓存命中 74%`)
  const usageInlineText = (() => {
    const tu = runStats ? object(runStats.tokenUsage) : {}
    let input = Number(tu.inputTokens ?? 0)
    let output = Number(tu.outputTokens ?? 0)
    let cacheRead = Number(tu.cacheReadTokens ?? tu.cachedInputTokens ?? 0)

    if (input + output <= 0 && Array.isArray(usageData?.rows)) {
      const targetName = bot?.name ?? room?.name ?? ''
      for (const r of usageData!.rows) {
        if (!Array.isArray(r)) continue
        const rowOwner = text(r[0])
        if (!targetName || rowOwner === targetName || rowOwner === (bot?.id ?? room?.id)) {
          input += Number(r[3] ?? 0)
          output += Number(r[4] ?? 0)
          cacheRead += Number(r[5] ?? 0)
        }
      }
    }
    const total = input + output + cacheRead
    if (total <= 0) return '0 tok'
    const hit = input + cacheRead > 0 ? Math.round((cacheRead / (input + cacheRead)) * 100) : 0
    return s.bots.usageSummary(formatCompactTokens(total), hit)
  })()

  const canvasBg = scheme === 'light' ? '#F6F7F9' : colors.background
  const cardBg = scheme === 'light' ? '#FFFFFF' : colors.cardOpaque

  const memoryCountLabel =
    memoryCount === null ? '…' : memoryCount === 0 ? s.bots.memoryEmpty : s.bots.memoryCount(memoryCount)

  return (
    <Modal transparent visible animationType="none" onRequestClose={handleBack} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Animated.View
          style={[
            styles.page,
            { backgroundColor: canvasBg, transform: [{ translateX: slideAnim }] },
          ]}
        >
          {/* Top Action Bar (`<` on left, `⚙` Settings + `•••` More on right, matching Figure 1) */}
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.common.back}
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [styles.circleBtn, { backgroundColor: cardBg }, pressed && styles.btnPressed]}
            >
              <ChevronLeft size={22} color={colors.ink} strokeWidth={2.1} />
            </Pressable>

            <View style={styles.topRightGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.bots.botSettings}
                disabled={busy || Boolean(state.readOnly)}
                onPress={() => {
                  onClose()
                  onEdit()
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.circleBtn,
                  { backgroundColor: cardBg },
                  pressed && styles.btnPressed,
                  (busy || Boolean(state.readOnly)) && { opacity: 0.45 },
                ]}
              >
                <Settings size={19} color={colors.ink} strokeWidth={1.9} />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.sessions.moreActions}
                onPress={() => setMoreOpen(true)}
                hitSlop={8}
                style={({ pressed }) => [styles.circleBtn, { backgroundColor: cardBg }, pressed && styles.btnPressed]}
              >
                <MoreHorizontal size={20} color={colors.ink} strokeWidth={2} />
              </Pressable>
            </View>
          </View>

          {/* Compact Header + `详情 | 浏览器` Segmented Tabs */}
          <View style={styles.heroCompactSection}>
            {bot ? (
              <BotAvatarWithBadge
                bot={bot}
                size={topTab === 'browser' ? 44 : 76}
                showMainStar
                badgeBorderColor={canvasBg}
              />
            ) : room ? (
              <View style={[styles.roomHeroAvatar, { backgroundColor: cardBg }]}>
                {room.members.slice(0, 3).map((id, idx) => {
                  const member = state.bots.find(b => b.id === id)
                  return member ? (
                    <View key={id} style={{ position: 'absolute', left: 10 + idx * 13, top: 14 + (idx % 2) * 14 }}>
                      <BotAvatar bot={member} size={32} />
                    </View>
                  ) : null
                })}
                {room.members.length === 0 && <Users size={34} color={colors.muted} />}
              </View>
            ) : null}

            <View style={styles.heroNameRow}>
              <Text style={[styles.heroName, topTab === 'browser' && { fontSize: 17 }]} numberOfLines={1}>
                {bot?.name ?? room?.name}
              </Text>
              {bot && (
                <BotAgentBadge
                  engine={bot.engine ?? engineOfModel(bot.model || bot.appliedModel)}
                  size={17}
                />
              )}
            </View>

            {topTab === 'details' && Boolean(bot?.role || room?.notice) && (
              <Text style={styles.heroSubtitle} numberOfLines={2}>
                {bot?.role ?? room?.notice}
              </Text>
            )}

            {/* Figure 1 Segmented Tabs: `详情 | 浏览器` */}
            {bot && (
              <View
                style={[
                  styles.segmentedWrap,
                  { backgroundColor: scheme === 'light' ? '#EAECEF' : colors.grouped },
                ]}
              >
                {([
                  ['details', s.bots.details],
                  ['browser', s.bots.browser],
                ] as const).map(([key, label]) => {
                  const active = topTab === key
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      onPress={() => setTopTab(key)}
                      style={[
                        styles.segmentedTab,
                        active && [
                          styles.segmentedTabActive,
                          { backgroundColor: scheme === 'light' ? '#FFFFFF' : colors.surfaceStrong },
                        ],
                      ]}
                    >
                      <Text style={[styles.segmentedTabText, active && styles.segmentedTabTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            )}
          </View>

          {Boolean(error) && (
            <Text accessibilityRole="alert" style={styles.errorBanner}>
              {error}
            </Text>
          )}

          {/* Browser Tab Content (Figure 2) */}
          {bot && topTab === 'browser' ? (
            <View style={{ flex: 1, marginTop: 4 }}>
              <BotBrowserPane bot={bot} perform={perform} />
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 36 }]}
              showsVerticalScrollIndicator={false}
            >
              {bot ? (
                <View style={{ gap: 18 }}>
                  {/* 1. 模型 (Model Selector Box, matching Figure 1) */}
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldSectionTitle}>{s.bots.model}</Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || Boolean(state.readOnly)}
                      onPress={() => setModelPickerOpen(true)}
                      style={({ pressed }) => [
                        styles.selectorBox,
                        { backgroundColor: cardBg },
                        pressed && styles.cardRowPressed,
                      ]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.selectorPrimaryText} numberOfLines={1}>
                          {modelTitle}
                        </Text>
                        {(modelProvider || !modelAvailable || bot.effort) && (
                          <Text
                            style={[
                              styles.selectorSubText,
                              !modelAvailable && { color: colors.danger, fontWeight: '500' },
                            ]}
                            numberOfLines={1}
                          >
                            {[
                              modelProvider,
                              !modelAvailable ? s.bots.modelUnavailable : bot.effort ? `${s.bots.effort}: ${bot.effort}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        )}
                      </View>
                      <ChevronDown size={18} color={colors.muted} />
                    </Pressable>
                  </View>

                  {/* 2. 权限 (3-Segment Pill: 仅可查看 | 工作区内修改 | 完全权限, matching Figure 1) */}
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldSectionTitle}>{s.bots.permissions}</Text>
                    <View
                      style={[
                        styles.permSegmented,
                        { backgroundColor: scheme === 'light' ? '#EAECEF' : colors.grouped },
                      ]}
                    >
                      {(
                        [
                          ['read-only', s.bots.permReadOnly, false],
                          ['workspace-write', s.bots.permWorkspace, false],
                          ['danger-full-access', s.bots.permFullAccess, true],
                        ] as const
                      ).map(([val, label, danger]) => {
                        const active = currentPerm === val
                        return (
                          <Pressable
                            key={val}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                            disabled={busy || Boolean(state.readOnly)}
                            onPress={() => {
                              if (val === currentPerm) return
                              if (val === 'danger-full-access') {
                                Alert.alert(s.bots.permFullAccess, s.chat.permissionFullAccessDescription, [
                                  { text: s.common.cancel, style: 'cancel' },
                                  { text: s.bots.confirm, style: 'destructive', onPress: () => void perform('update-bot', { id: bot.id, permission: val }) },
                                ])
                                return
                              }
                              void perform('update-bot', { id: bot.id, permission: val })
                            }}
                            style={[
                              styles.permOption,
                              active && [
                                styles.permOptionActive,
                                { backgroundColor: scheme === 'light' ? '#FFFFFF' : colors.surfaceStrong },
                              ],
                            ]}
                          >
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.permOptionText,
                                active && styles.permOptionTextActive,
                                danger && { color: colors.danger },
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>

                  {/* 3. 工作文件夹 (Working Folder Selector Box: `总工作区 ∨`, matching Figure 1) */}
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldSectionTitle}>{s.bots.workingFolder}</Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy || Boolean(state.readOnly)}
                      onPress={() => setFolderPickerOpen(true)}
                      style={({ pressed }) => [
                        styles.selectorBox,
                        { backgroundColor: cardBg },
                        pressed && styles.cardRowPressed,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectorPrimaryText} numberOfLines={1}>
                          {bot.workDir ? folderBasename(bot.workDir) : s.bots.teamWorkspace}
                        </Text>
                        {Boolean(bot.workDir) && (
                          <Text style={styles.selectorSubText} numberOfLines={1}>
                            {bot.workDir}
                          </Text>
                        )}
                      </View>
                      <ChevronDown size={18} color={colors.muted} />
                    </Pressable>
                  </View>

                  {/* 4. Instructions / `在 Bot 设置里添加说明` (matching Figure 1) */}
                  {bot.instructions.trim() ? (
                    <Pressable
                      onPress={() => {
                        onClose()
                        onEdit()
                      }}
                      style={[styles.selectorBox, { backgroundColor: cardBg }]}
                    >
                      <Text style={[styles.selectorSubText, { color: colors.ink, lineHeight: 19 }]} numberOfLines={3}>
                        {bot.instructions.trim()}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        onClose()
                        onEdit()
                      }}
                      style={styles.centeredHintBtn}
                    >
                      <Text style={styles.centeredHintText}>{s.bots.addInstructionsHint}</Text>
                    </Pressable>
                  )}

                  {/* 5. 记忆 (Memory: `📄 3 条    管理 >`, matching Figure 1) */}
                  {state.memory !== false && (
                    <View style={styles.fieldSection}>
                      <Text style={styles.fieldSectionTitle}>{s.bots.memory}</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openSubPage('memory')}
                        style={({ pressed }) => [
                          styles.selectorBox,
                          { backgroundColor: cardBg },
                          pressed && styles.cardRowPressed,
                        ]}
                      >
                        <FileText size={17} color={colors.muted} />
                        <Text style={[styles.selectorPrimaryText, { flex: 1, fontWeight: '400' }]} numberOfLines={1}>
                          {memoryCountLabel}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                          <Text style={styles.manageLinkText}>{s.bots.memoryManage}</Text>
                          <ChevronRight size={16} color={colors.muted} />
                        </View>
                      </Pressable>
                    </View>
                  )}

                  {/* 6. 用量 (Usage: `Chief    600.9K tok · 缓存命中 74%`, matching Figure 1) */}
                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldSectionTitle}>{s.bots.usage}</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        loadFullUsage()
                        openSubPage('usage')
                      }}
                      style={({ pressed }) => [
                        styles.selectorBox,
                        { backgroundColor: cardBg },
                        pressed && styles.cardRowPressed,
                      ]}
                    >
                      <Text style={[styles.selectorPrimaryText, { fontWeight: '500' }]} numberOfLines={1}>
                        {bot.name}
                      </Text>
                      <Text style={[styles.selectorSubText, { flex: 1, textAlign: 'right' }]} numberOfLines={1}>
                        {usageInlineText}
                      </Text>
                      <ChevronRight size={16} color={colors.muted} />
                    </Pressable>
                  </View>

                  {/* 7. 定时任务 (Scheduled Tasks: `还没有定时任务，去添加` or task rows, matching Figure 1) */}
                  <View style={styles.fieldSection}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.fieldSectionTitle}>
                        {botSchedules.length > 0
                          ? `${s.bots.scheduledTasks} · ${botSchedules.length}`
                          : s.bots.scheduledTasks}
                      </Text>
                      {botSchedules.length > 0 && (
                        <Pressable onPress={() => openSubPage('schedules', false)} hitSlop={8}>
                          <Text style={styles.manageLinkText}>{s.bots.memoryManage}</Text>
                        </Pressable>
                      )}
                    </View>

                    {schedulesLoading ? (
                      <View style={[styles.selectorBox, { backgroundColor: cardBg, justifyContent: 'center' }]}>
                        <ActivityIndicator size="small" color={colors.primary} />
                      </View>
                    ) : botSchedules.length === 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openSubPage('schedules', true)}
                        style={({ pressed }) => [
                          styles.selectorBox,
                          { backgroundColor: cardBg },
                          pressed && styles.cardRowPressed,
                        ]}
                      >
                        <Text style={[styles.selectorSubText, { flex: 1 }]}>{s.bots.schedulesNoneAdd}</Text>
                        <ChevronRight size={16} color={colors.muted} />
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openSubPage('schedules', false)}
                        style={({ pressed }) => [
                          styles.groupCard,
                          { backgroundColor: cardBg },
                          pressed && styles.cardRowPressed,
                        ]}
                      >
                        {botSchedules.slice(0, 3).map((task, idx) => (
                          <View key={text(task.id) || idx} style={[styles.partRow, idx > 0 && styles.cardRowDivider]}>
                            <View style={styles.memberBody}>
                              <Text style={styles.rowLabel} numberOfLines={1}>
                                {text(task.title) || s.bots.scheduledTasks}
                              </Text>
                              <Text style={styles.memberRole} numberOfLines={1}>
                                {formatScheduleSummary(task)}
                              </Text>
                            </View>
                            <ChevronRight size={16} color={colors.subtle} />
                          </View>
                        ))}
                      </Pressable>
                    )}
                  </View>

                  {/* 会话分段快捷入口 + 置顶开关 */}
                  <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => openSubPage('sessions')}
                      style={({ pressed }) => [styles.cardRow, pressed && styles.cardRowPressed]}
                    >
                      <FolderOpen size={19} color={colors.ink} />
                      <Text style={styles.rowLabel}>{s.bots.sessions}</Text>
                      <Text style={styles.rowValue}>{s.bots.sessionsCount(allParts.length)}</Text>
                      <ChevronRight size={18} color={colors.subtle} />
                    </Pressable>
                    {!bot.tile && (
                      <View style={[styles.toggleRow, styles.cardRowDivider]}>
                        <Text style={styles.rowLabel}>{s.bots.pinChat}</Text>
                        <Toggle
                          value={Boolean(bot.pinned)}
                          disabled={busy || Boolean(state.readOnly)}
                          accessibilityLabel={s.bots.pinChat}
                          onValueChange={() => void perform('set-flags', { id: bot.id, pinned: !bot.pinned })}
                        />
                      </View>
                    )}
                  </View>

                  {canDeleteBot(state, bot) && (
                    <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={s.bots.delete}
                        disabled={busy || Boolean(state.readOnly)}
                        onPress={confirmDelete}
                        style={({ pressed }) => [
                          styles.cardRow,
                          pressed && styles.cardRowPressed,
                          (busy || Boolean(state.readOnly)) && { opacity: 0.45 },
                        ]}
                      >
                        <Trash2 size={19} color={colors.danger} />
                        <Text style={[styles.rowLabel, { color: colors.danger }]}>{s.bots.delete}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : room ? (
                <View style={{ gap: 16 }}>
                  {room.goal && isNonEmptyObject(room.goal) && (
                    <View style={[styles.groupCard, { backgroundColor: cardBg, padding: 16, gap: 10 }]}>
                      <Text style={styles.subCardTitle}>
                        {s.sessionActivity.goal}: {text(room.goal.title) || text(room.goal.status)}
                      </Text>
                      <View style={styles.goalBtnRow}>
                        {text(room.goal.status) === 'running' ? (
                          <Button
                            variant="secondary"
                            icon={Pause}
                            label={s.automation.pauseTask}
                            disabled={busy || Boolean(state.readOnly)}
                            onPress={() => void perform('goal-control', { roomId: room.id, action: 'pause' })}
                          />
                        ) : text(room.goal.status) === 'paused' ? (
                          <Button
                            variant="secondary"
                            icon={Play}
                            label={s.automation.resumeTask}
                            disabled={busy || Boolean(state.readOnly)}
                            onPress={() => void perform('goal-control', { roomId: room.id, action: 'resume' })}
                          />
                        ) : null}
                        <Button
                          variant="secondary"
                          icon={Square}
                          label={s.bots.stop}
                          disabled={busy || Boolean(state.readOnly)}
                          onPress={() => void perform('goal-control', { roomId: room.id, action: 'stop' })}
                        />
                      </View>
                    </View>
                  )}

                  {room.members.length > 0 && (
                    <View style={styles.fieldSection}>
                      <Text style={styles.fieldSectionTitle}>{s.bots.members}</Text>
                      <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                        {room.members.map((memberId, index) => {
                          const memberBot = state.bots.find(entry => entry.id === memberId)
                          return (
                            <View key={memberId} style={[styles.memberRow, index > 0 && styles.cardRowDivider]}>
                              {memberBot ? <BotAvatar bot={memberBot} size={36} /> : <Users size={24} color={colors.muted} />}
                              <View style={styles.memberBody}>
                                <Text style={styles.rowLabel} numberOfLines={1}>
                                  {memberBot?.name ?? memberId}
                                </Text>
                                {Boolean(memberBot?.role) && (
                                  <Text style={styles.memberRole} numberOfLines={1}>
                                    {memberBot?.role}
                                  </Text>
                                )}
                              </View>
                              <IconButton
                                dense
                                label={s.bots.stop}
                                icon={Square}
                                disabled={busy || Boolean(state.readOnly)}
                                onPress={() => void perform('stop-member-work', { roomId: room.id, botId: memberId })}
                              />
                            </View>
                          )
                        })}
                      </View>
                    </View>
                  )}

                  {state.memory !== false && (
                    <View style={styles.fieldSection}>
                      <Text style={styles.fieldSectionTitle}>{s.bots.memory}</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openSubPage('memory')}
                        style={({ pressed }) => [styles.selectorBox, { backgroundColor: cardBg }, pressed && styles.cardRowPressed]}
                      >
                        <FileText size={17} color={colors.muted} />
                        <Text style={[styles.selectorPrimaryText, { flex: 1, fontWeight: '400' }]}>{memoryCountLabel}</Text>
                        <Text style={styles.manageLinkText}>{s.bots.memoryManage}</Text>
                        <ChevronRight size={16} color={colors.muted} />
                      </Pressable>
                    </View>
                  )}

                  <View style={styles.fieldSection}>
                    <Text style={styles.fieldSectionTitle}>{s.bots.scheduledTasks}</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => openSubPage('schedules', botSchedules.length === 0)}
                      style={({ pressed }) => [styles.selectorBox, { backgroundColor: cardBg }, pressed && styles.cardRowPressed]}
                    >
                      <Text style={[styles.selectorSubText, { flex: 1 }]}>
                        {botSchedules.length > 0
                          ? s.bots.schedulesEnabled(botSchedules.length)
                          : s.bots.schedulesNoneAdd}
                      </Text>
                      <ChevronRight size={16} color={colors.muted} />
                    </Pressable>
                  </View>

                  <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                    <View style={styles.toggleRow}>
                      <Text style={styles.rowLabel}>{s.bots.pinChat}</Text>
                      <Toggle
                        value={Boolean(room.pinned)}
                        disabled={busy || Boolean(state.readOnly)}
                        accessibilityLabel={s.bots.pinChat}
                        onValueChange={() => void perform('set-flags', { id: room.id, pinned: !room.pinned })}
                      />
                    </View>
                  </View>

                  <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={s.bots.delete}
                      disabled={busy || Boolean(state.readOnly)}
                      onPress={confirmDelete}
                      style={({ pressed }) => [
                        styles.cardRow,
                        pressed && styles.cardRowPressed,
                        (busy || Boolean(state.readOnly)) && { opacity: 0.45 },
                      ]}
                    >
                      <Trash2 size={19} color={colors.danger} />
                      <Text style={[styles.rowLabel, { color: colors.danger }]}>{s.bots.delete}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          )}

          {/* 2nd-Level Push Sub-Pages (`会话` / `记忆` / `用量` / `定时任务`) */}
          {mountedSubPage !== null && (
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                styles.subPage,
                { backgroundColor: canvasBg, transform: [{ translateX: subSlideAnim }] },
              ]}
            >
              <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={s.common.back}
                  onPress={closeSubPage}
                  hitSlop={8}
                  style={({ pressed }) => [styles.circleBtn, { backgroundColor: cardBg }, pressed && styles.btnPressed]}
                >
                  <ChevronLeft size={22} color={colors.ink} strokeWidth={2.1} />
                </Pressable>

                <Text style={styles.subPageTitle} numberOfLines={1}>
                  {mountedSubPage === 'sessions'
                    ? s.bots.sessions
                    : mountedSubPage === 'memory'
                      ? s.bots.memory
                      : mountedSubPage === 'usage'
                        ? s.bots.usage
                        : s.bots.scheduledTasks}
                </Text>

                {mountedSubPage === 'sessions' && bot ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={s.bots.newSession}
                    disabled={busy || Boolean(state.readOnly)}
                    onPress={() => {
                      onClose()
                      void perform('bot-new-part', { botId: bot.id })
                    }}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.circleBtn,
                      { backgroundColor: cardBg },
                      pressed && styles.btnPressed,
                      (busy || Boolean(state.readOnly)) && { opacity: 0.4 },
                    ]}
                  >
                    <Plus size={20} color={colors.ink} strokeWidth={2.1} />
                  </Pressable>
                ) : (
                  <View style={styles.circlePlaceholder} />
                )}
              </View>

              {mountedSubPage === 'sessions' && bot && (
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={[styles.scrollContent, { paddingTop: 12, paddingBottom: insets.bottom + 28 }]}
                >
                  <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                    {allParts.map((partId, index) => {
                      const current = index === 0
                      const matched = appSessions.find(item => item.sessionId === partId)
                      const label =
                        matched?.title && matched.title.trim() !== ''
                          ? matched.title
                          : s.bots.sessionNumber(allParts.length - index)
                      return (
                        <Pressable
                          key={partId}
                          accessibilityRole="button"
                          accessibilityLabel={label}
                          disabled={current || busy || Boolean(state.readOnly)}
                          onPress={() => {
                            onClose()
                            void perform('bot-open-part', { botId: bot.id, sessionId: partId })
                          }}
                          style={({ pressed }) => [
                            styles.partRow,
                            index > 0 && styles.cardRowDivider,
                            pressed && !current && styles.cardRowPressed,
                          ]}
                        >
                          <View style={styles.memberBody}>
                            <Text style={styles.rowLabel} numberOfLines={1}>
                              {label}
                            </Text>
                            <Text style={styles.memberRole} numberOfLines={1}>
                              {current ? s.bots.currentSession : s.bots.openEarlierSession}
                            </Text>
                          </View>
                          {current ? (
                            <Check size={18} color={colors.primary} strokeWidth={2.2} />
                          ) : (
                            <ChevronRight size={18} color={colors.subtle} />
                          )}
                        </Pressable>
                      )
                    })}
                  </View>
                </ScrollView>
              )}

              {mountedSubPage === 'memory' && (
                <BotMemoryPanel
                  ownerId={bot?.id ?? room?.id ?? ''}
                  ownerName={bot?.name ?? room?.name ?? ''}
                  isGroup={Boolean(room)}
                  client={client}
                />
              )}

              {mountedSubPage === 'schedules' && (
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={[styles.scrollContent, { paddingTop: 12, paddingBottom: insets.bottom + 28 }]}
                >
                  <BotSchedulesPanel
                    state={state}
                    client={client}
                    fixedBotId={bot?.id}
                    fixedRoomId={room?.id}
                    initialCreating={schedulesStartCreating}
                    onChanged={reloadSchedules}
                  />
                </ScrollView>
              )}

              {mountedSubPage === 'usage' && (
                usageLoading && !runStats ? (
                  <View style={styles.centeredEmptyWrap}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : (
                  <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={[styles.scrollContent, { paddingTop: 12, paddingBottom: insets.bottom + 28 }]}
                  >
                    <View style={[styles.groupCard, { backgroundColor: cardBg, padding: 16, marginBottom: 14, gap: 6 }]}>
                      <Text style={styles.subCardTitle}>{bot?.name ?? room?.name ?? s.bots.usage}</Text>
                      <Text style={styles.memberRole}>{usageInlineText}</Text>
                    </View>
                    {(() => {
                      const rows = Array.isArray(usageData?.rows) ? usageData!.rows.filter(Array.isArray) : []
                      if (rows.length === 0) return null
                      return (
                        <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                          {rows.map((row, i) => {
                            const cells = row as unknown[]
                            return (
                              <View key={i} style={[styles.partRow, i > 0 && styles.cardRowDivider]}>
                                <View style={styles.memberBody}>
                                  <Text style={styles.rowLabel}>
                                    {text(cells[0]) || s.bots.title}
                                    {text(cells[1]) ? ` · ${text(cells[1])}` : ''}
                                  </Text>
                                  <Text style={styles.memberRole}>
                                    {s.bots.calls}: {Number(cells[2] ?? 0).toLocaleString()} · {s.bots.inputTokens}:{' '}
                                    {Number(cells[3] ?? 0).toLocaleString()} · {s.bots.outputTokens}:{' '}
                                    {Number(cells[4] ?? 0).toLocaleString()}
                                  </Text>
                                </View>
                              </View>
                            )
                          })}
                        </View>
                      )
                    })()}
                  </ScrollView>
                )
              )}
            </Animated.View>
          )}
        </Animated.View>

        {/* Quick Model Picker Sheet */}
        {bot && modelPickerOpen && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setModelPickerOpen(false)}>
            <ModalSurface onClose={() => setModelPickerOpen(false)}>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.subCardTitle}>{s.bots.model}</Text>
                  <Pressable onPress={() => setModelPickerOpen(false)} hitSlop={8}>
                    <X size={20} color={colors.muted} />
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                  <Pressable
                    onPress={() => {
                      setModelPickerOpen(false)
                      void perform('update-bot', { id: bot.id, model: '' })
                    }}
                    style={styles.partRow}
                  >
                    <Text style={[styles.rowLabel, { flex: 1 }]}>{s.bots.defaultModel}</Text>
                    {!bot.model && <Check size={18} color={colors.primary} />}
                  </Pressable>
                  {groupBotModels(state.models).map(group => (
                    <View key={group.provider} style={{ marginTop: 8 }}>
                      <Text style={[styles.fieldSectionTitle, { paddingHorizontal: 14, marginBottom: 4 }]}>
                        {group.label}
                      </Text>
                      {group.items.map(item => {
                        const ref = text(item.ref)
                        const label = text(item.name) || text(item.label) || ref
                        const selected = bot.model === ref
                        return (
                          <Pressable
                            key={ref}
                            onPress={() => {
                              setModelPickerOpen(false)
                              void perform('update-bot', { id: bot.id, model: ref })
                            }}
                            style={styles.partRow}
                          >
                            <BotAgentBadge engine={engineOfModel(ref)} size={16} />
                            <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={1}>
                              {label}
                            </Text>
                            {selected && <Check size={18} color={colors.primary} />}
                          </Pressable>
                        )
                      })}
                    </View>
                  ))}
                </ScrollView>
              </View>
            </ModalSurface>
          </Modal>
        )}

        {/* Working Folder Picker Sheet */}
        {bot && (
          <BotFolderPickerModal
            visible={folderPickerOpen}
            value={bot.workDir}
            client={client}
            onClose={() => setFolderPickerOpen(false)}
            onPick={workDir => {
              void perform('update-bot', { id: bot.id, workDir })
            }}
          />
        )}

        <BotFloatingPopover
          visible={moreOpen}
          actions={popoverActions}
          onClose={() => setMoreOpen(false)}
          anchor="top-right"
        />
      </View>
    </Modal>
  )
}

const createProfileStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    modalRoot: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.14)',
    },
    page: {
      flex: 1,
    },
    subPage: {
      zIndex: 10,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 6,
    },
    topRightGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    circleBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    circlePlaceholder: {
      width: 40,
      height: 40,
    },
    btnPressed: {
      opacity: 0.72,
    },
    subPageTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 17,
      fontWeight: '600',
      color: colors.ink,
      paddingHorizontal: 12,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 6,
    },
    heroCompactSection: {
      alignItems: 'center',
      paddingTop: 4,
      paddingBottom: 12,
      paddingHorizontal: 16,
    },
    roomHeroAvatar: {
      width: 76,
      height: 76,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    heroNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 10,
      paddingHorizontal: 20,
    },
    heroName: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.ink,
      textAlign: 'center',
    },
    heroSubtitle: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
      textAlign: 'center',
      marginTop: 2,
      paddingHorizontal: 28,
    },
    segmentedWrap: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      marginTop: 14,
      padding: 3,
      borderRadius: 999,
    },
    segmentedTab: {
      flex: 1,
      height: 34,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentedTabActive: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    segmentedTabText: {
      fontSize: 13.5,
      fontWeight: '500',
      color: colors.muted,
    },
    segmentedTabTextActive: {
      color: colors.ink,
      fontWeight: '600',
    },
    fieldSection: {
      gap: 7,
    },
    fieldSectionTitle: {
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.muted,
      paddingHorizontal: 2,
    },
    selectorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 14,
      gap: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    selectorPrimaryText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.ink,
    },
    selectorSubText: {
      fontSize: 12.5,
      color: colors.muted,
    },
    permSegmented: {
      flexDirection: 'row',
      padding: 3,
      borderRadius: 12,
    },
    permOption: {
      flex: 1,
      minHeight: 36,
      paddingHorizontal: 6,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    permOptionActive: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    permOptionText: {
      fontSize: 12.5,
      fontWeight: '500',
      color: colors.muted,
    },
    permOptionTextActive: {
      color: colors.ink,
      fontWeight: '600',
    },
    centeredHintBtn: {
      alignItems: 'center',
      paddingVertical: 4,
    },
    centeredHintText: {
      fontSize: 13,
      color: colors.muted,
    },
    manageLinkText: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.muted,
    },
    errorBanner: {
      fontSize: 13.5,
      color: colors.danger,
      textAlign: 'center',
      marginBottom: 8,
      paddingHorizontal: 12,
    },
    groupCard: {
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 50,
      paddingHorizontal: 14,
      paddingVertical: 11,
      gap: 10,
    },
    cardRowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    cardRowPressed: {
      backgroundColor: colors.grouped,
    },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      fontWeight: '400',
      color: colors.ink,
    },
    rowValue: {
      fontSize: 14,
      color: colors.muted,
      marginRight: 2,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 50,
      paddingHorizontal: 14,
      paddingVertical: 9,
      gap: 12,
    },
    subCardTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.ink,
    },
    goalBtnRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 12,
    },
    memberBody: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    memberRole: {
      fontSize: 12.5,
      lineHeight: 17,
      color: colors.muted,
    },
    partRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 10,
    },
    centeredEmptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 36,
      paddingBottom: 64,
      gap: 12,
    },
  })
