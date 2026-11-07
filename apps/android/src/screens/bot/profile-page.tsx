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
  ChartNoAxesColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CopyPlus,
  Cpu,
  FolderOpen,
  Monitor,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Share2,
  Square,
  Trash2,
  Users,
   type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings as s } from '../../locales/i18n'
import {
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
import { BotAgentBadge, engineOfModel } from './agent-badge'
import { BotAvatar, BotAvatarWithBadge } from './avatar'
import { BotFloatingPopover, type BotPopoverAction } from './popover-menu'

type ProfileSubPage = 'sessions' | 'computer' | 'usage' | 'im' | 'schedules' | null

function isNonEmptyObject(value: BotObject | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0
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
  const [subPage, setSubPage] = useState<ProfileSubPage>(null)
  const [mountedSubPage, setMountedSubPage] = useState<ProfileSubPage>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [schedulesData, setSchedulesData] = useState<BotObject[] | null>(null)
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [usageData, setUsageData] = useState<BotObject | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)

  const screenWidth = Dimensions.get('window').width || 390
  const slideAnim = useRef(new Animated.Value(screenWidth)).current
  const subSlideAnim = useRef(new Animated.Value(screenWidth)).current

  useEffect(() => {
    if (visible) {
      setMounted(true)
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
    (target: Exclude<ProfileSubPage, null>) => {
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

  // Preload schedules count gently so the "定时任务  N 已开启 >" row matches the design.
  useEffect(() => {
    if (!visible || !client) return
    const control = new AbortController()
    setSchedulesLoading(true)
    void client
      .call('schedules', null, control.signal)
      .then(val => {
        if (!control.signal.aborted) {
          const allTasks = objects(object(val).tasks)
          setSchedulesData(allTasks)
        }
      })
      .catch(() => {
        if (!control.signal.aborted) setSchedulesData([])
      })
      .finally(() => {
        if (!control.signal.aborted) setSchedulesLoading(false)
      })
    return () => control.abort()
  }, [visible, client, bot?.id, room?.id])

  const loadFullUsage = useCallback(() => {
    if (!client) return
    setUsageLoading(true)
    void client
      .call('usage', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      .then(val => setUsageData(object(val)))
      .catch(() => setUsageData(null))
      .finally(() => setUsageLoading(false))
  }, [client])

  const botSchedules = useMemo(() => {
    if (!schedulesData) return []
    if (bot) {
      const own = schedulesData.filter(t => text(t.botId) === bot.id || text(t.sessionId) === bot.sessionId)
      return own.length > 0 ? own : schedulesData
    }
    if (room) return schedulesData.filter(t => text(t.roomId) === room.id)
    return schedulesData
  }, [schedulesData, bot, room])

  const enabledScheduleCount = useMemo(
    () =>
      botSchedules.filter(task => {
        const status = (text(task.status) || text(task.state)).toLowerCase()
        return status !== 'disabled' && status !== 'paused' && status !== 'inactive'
      }).length,
    [botSchedules],
  )

  if (!mounted || (!bot && !room)) return null

  const mainCount = state.bots.filter(b => b.main).length

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
    if (!bot.main || mainCount > 1) {
      popoverActions.push({
        key: 'main',
        icon: ArrowLeftRight,
        label: bot.main ? s.bots.removeMain : s.bots.replaceMain,
        disabled: busy || Boolean(state.readOnly),
        onPress: () => void perform('set-main', { id: bot.id, main: !bot.main }),
      })
    }
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
    popoverActions.push({
      key: 'copy-id',
      icon: Copy,
      label: s.bots.copyId,
      onPress: () => void Clipboard.setStringAsync(bot.id),
    })
    if (!bot.main) {
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

  // Bot session parts
  const allParts = bot
    ? [bot.sessionId, ...(bot.parts ?? []).filter(id => id !== bot.sessionId).slice().reverse()]
    : []

  // Computer status (DS-Bot 0.3.0)
  const computerStatusLabel = (() => {
    if (!bot) return s.bots.computerIdle
    const asks = object(state.computerLive?.asks)
    const holds = object(state.computerLive?.holds)
    if (Object.keys(object(asks[bot.id])).length > 0) return s.bots.waiting
    if (Object.keys(object(holds[bot.id])).length > 0) return s.bots.computerActive
    if (state.computer && state.computer.enabled === false) return s.bots.computerDisabled
    return s.bots.computerIdle
  })()

  // Model label
  const activeModelRef = bot ? bot.model || bot.appliedModel || '' : ''
  const matchedModel = activeModelRef ? state.models.find(m => text(m.ref) === activeModelRef) : undefined
  const modelDisplay = activeModelRef
    ? text(matchedModel?.name) || text(matchedModel?.label) || activeModelRef
    : s.bots.defaultModel

  // IM / Connector status
  const activeImPlatform = bot ? text(state.imVia[bot.sessionId]) : ''

  // Token usage summary
  const tokenSummary = (() => {
    if (!runStats || !isNonEmptyObject(object(runStats.tokenUsage))) return ''
    const tu = object(runStats.tokenUsage)
    const total = Number(tu.inputTokens ?? 0) + Number(tu.outputTokens ?? 0)
    if (!Number.isFinite(total) || total <= 0) return ''
    return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`
  })()

  const canvasBg = scheme === 'light' ? '#F6F7F9' : colors.background
  const cardBg = scheme === 'light' ? '#FFFFFF' : colors.cardOpaque

  const renderRow = ({
    first = false,
    icon: Icon,
    label,
    value,
    onPress,
    disabled = false,
  }: {
    first?: boolean
    icon: LucideIcon
    label: string
    value?: string
    onPress: () => void
    disabled?: boolean
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cardRow,
        !first && styles.cardRowDivider,
        pressed && styles.cardRowPressed,
        disabled && { opacity: 0.45 },
      ]}
    >
      <View style={styles.rowIconWrap}>
        <Icon size={20} color={colors.ink} strokeWidth={1.75} />
      </View>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      {Boolean(value) && (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      )}
      <ChevronRight size={18} color={colors.subtle} strokeWidth={2} />
    </Pressable>
  )

  return (
    <Modal transparent visible animationType="none" onRequestClose={handleBack} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Animated.View
          style={[
            styles.page,
            { backgroundColor: canvasBg, transform: [{ translateX: slideAnim }] },
          ]}
        >
          {/* Floating Island Top Bar */}
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
                accessibilityLabel={s.sessions.moreActions}
                onPress={() => setMoreOpen(true)}
                hitSlop={8}
                style={({ pressed }) => [styles.circleBtn, { backgroundColor: cardBg }, pressed && styles.btnPressed]}
              >
                <MoreHorizontal size={20} color={colors.ink} strokeWidth={2} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 36 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* Centered Hero Avatar + Title + Edit Pill */}
            <View style={styles.heroSection}>
              {bot ? (
                <BotAvatarWithBadge
                  bot={bot}
                  size={88}
                  showMainStar
                  badgeBorderColor={canvasBg}
                />
              ) : room ? (
                <View style={[styles.roomHeroAvatar, { backgroundColor: cardBg }]}>
                  {room.members.slice(0, 3).map((id, idx) => {
                    const member = state.bots.find(b => b.id === id)
                    return member ? (
                      <View key={id} style={{ position: 'absolute', left: 12 + idx * 14, top: 16 + (idx % 2) * 16 }}>
                        <BotAvatar bot={member} size={36} />
                      </View>
                    ) : null
                  })}
                  {room.members.length === 0 && <Users size={38} color={colors.muted} />}
                </View>
              ) : null}

              <View style={styles.heroNameRow}>
                <Text style={styles.heroName} numberOfLines={2}>
                  {bot?.name ?? room?.name}
                </Text>
                {bot && (
                  <BotAgentBadge
                    engine={bot.engine ?? engineOfModel(bot.model || bot.appliedModel)}
                    size={18}
                  />
                )}
              </View>

              {Boolean(bot?.role || room?.notice) && (
                <Text style={styles.heroSubtitle} numberOfLines={2}>
                  {bot?.role ?? room?.notice}
                </Text>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.bots.edit}
                disabled={busy || Boolean(state.readOnly)}
                onPress={() => {
                  onClose()
                  onEdit()
                }}
                style={({ pressed }) => [
                  styles.editPill,
                  scheme === 'light' ? styles.editPillLight : styles.editPillDark,
                  pressed && styles.btnPressed,
                  (busy || Boolean(state.readOnly)) && { opacity: 0.45 },
                ]}
              >
                <Text style={styles.editPillText}>{s.bots.edit}</Text>
              </Pressable>
            </View>

            {Boolean(error) && (
              <Text accessibilityRole="alert" style={styles.errorBanner}>
                {error}
              </Text>
            )}

            {bot ? (
              <>
                {/* Group 1: Sessions, Computer, Usage */}
                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {renderRow({
                    first: true,
                    icon: FolderOpen,
                    label: s.bots.sessions,
                    value: s.bots.sessionsCount(allParts.length),
                    onPress: () => openSubPage('sessions'),
                  })}
                  {renderRow({
                    icon: Monitor,
                    label: s.bots.computer,
                    value: computerStatusLabel,
                    onPress: () => openSubPage('computer'),
                  })}
                  {renderRow({
                    icon: ChartNoAxesColumn,
                    label: s.bots.usage,
                    value: tokenSummary,
                    onPress: () => {
                      loadFullUsage()
                      openSubPage('usage')
                    },
                  })}
                </View>

                {/* Section Header: 配置 Bot */}
                <Text style={styles.sectionHeader}>{s.bots.configureBot}</Text>

                {/* Group 2: Model, IM/Connectors, Schedules */}
                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {renderRow({
                    first: true,
                    icon: Cpu,
                    label: s.bots.model,
                    value: modelDisplay,
                    disabled: busy || Boolean(state.readOnly),
                    onPress: () => {
                      onClose()
                      onEdit()
                    },
                  })}
                  {renderRow({
                    icon: Share2,
                    label: s.bots.imAndConnectors,
                    value: activeImPlatform ?? '',
                    onPress: () => openSubPage('im'),
                  })}
                  {renderRow({
                    icon: Clock,
                    label: s.bots.schedules,
                    value: schedulesLoading ? '…' : s.bots.schedulesEnabled(enabledScheduleCount),
                    onPress: () => openSubPage('schedules'),
                  })}
                </View>

                {/* Group 3: Standalone Toggle Row + Footnote */}
                {!bot.tile ? (
                  <>
                    <View style={[styles.groupCard, styles.toggleCardSpacing, { backgroundColor: cardBg }]}>
                      <View style={styles.toggleRow}>
                        <Text style={styles.rowLabel}>{s.bots.pinChat}</Text>
                        <Toggle
                          value={Boolean(bot.pinned)}
                          disabled={busy || Boolean(state.readOnly)}
                          accessibilityLabel={s.bots.pinChat}
                          onValueChange={() => void perform('set-flags', { id: bot.id, pinned: !bot.pinned })}
                        />
                      </View>
                    </View>
                    <Text style={styles.footnote}>{s.bots.pinChatHint}</Text>
                  </>
                ) : (
                  <Text style={[styles.footnote, { marginTop: 14 }]}>{s.bots.hostSettings}</Text>
                )}
              </>
            ) : room ? (
              <>
                {/* Room Goal Card */}
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

                {/* Room Members Card */}
                {room.members.length > 0 && (
                  <>
                    <Text style={styles.sectionHeader}>{s.bots.members}</Text>
                    <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                      {room.members.map((memberId, index) => {
                        const memberBot = state.bots.find(entry => entry.id === memberId)
                        return (
                          <View
                            key={memberId}
                            style={[styles.memberRow, index > 0 && styles.cardRowDivider]}
                          >
                            {memberBot ? (
                              <BotAvatar bot={memberBot} size={36} />
                            ) : (
                              <Users size={24} color={colors.muted} />
                            )}
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
                  </>
                )}

                {/* Room Schedules + Pin Toggle */}
                <Text style={styles.sectionHeader}>{s.bots.manage}</Text>
                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {renderRow({
                    first: true,
                    icon: Clock,
                    label: s.bots.schedules,
                    value: schedulesLoading ? '…' : s.bots.schedulesEnabled(enabledScheduleCount),
                    onPress: () => openSubPage('schedules'),
                  })}
                </View>

                <View style={[styles.groupCard, styles.toggleCardSpacing, { backgroundColor: cardBg }]}>
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
                <Text style={styles.footnote}>{s.bots.pinChatHint}</Text>
              </>
            ) : null}
          </ScrollView>

          {/* 2nd-Level Push Sub-Page (Sessions / Computer / Usage / IM / Schedules) */}
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
                    : mountedSubPage === 'computer'
                      ? s.bots.computer
                      : mountedSubPage === 'usage'
                        ? s.bots.usage
                        : mountedSubPage === 'im'
                          ? s.bots.imAndConnectors
                          : s.bots.schedules}
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

              {mountedSubPage === 'computer' && (
                <View style={styles.centeredEmptyWrap}>
                  <Text style={styles.centeredStatusPill}>{computerStatusLabel}</Text>
                  <Text style={styles.centeredEmptyText}>{s.bots.computerDesc}</Text>
                </View>
              )}

              {mountedSubPage === 'im' && (
                <View style={styles.centeredEmptyWrap}>
                  {Boolean(activeImPlatform) && (
                    <Text style={styles.centeredStatusPill}>{s.bots.viaPlatform(activeImPlatform!)}</Text>
                  )}
                  <Text style={styles.centeredEmptyText}>{s.bots.imAndConnectorsDesc}</Text>
                </View>
              )}

              {mountedSubPage === 'schedules' && (
                schedulesLoading ? (
                  <View style={styles.centeredEmptyWrap}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : botSchedules.length === 0 ? (
                  <View style={styles.centeredEmptyWrap}>
                    <Text style={styles.centeredEmptyText}>{s.bots.schedulesEmpty}</Text>
                  </View>
                ) : (
                  <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={[styles.scrollContent, { paddingTop: 12, paddingBottom: insets.bottom + 28 }]}
                  >
                    <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                      {botSchedules.map((task, idx) => {
                        const timeText = [
                          text(task.scheduledAt) || text(task.time),
                          text(task.timeZone),
                          text(task.status) || text(task.state),
                        ]
                          .filter(Boolean)
                          .join(' · ')
                        return (
                          <View key={idx} style={[styles.partRow, idx > 0 && styles.cardRowDivider]}>
                            <View style={styles.memberBody}>
                              <Text style={styles.rowLabel}>{text(task.title) || s.bots.schedules}</Text>
                              {Boolean(text(task.prompt)) && (
                                <Text style={styles.memberRole} numberOfLines={2}>
                                  {text(task.prompt)}
                                </Text>
                              )}
                              {Boolean(timeText) && <Text style={styles.memberRole}>{timeText}</Text>}
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  </ScrollView>
                )
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
                    {runStats && isNonEmptyObject(object(runStats.tokenUsage)) && (
                      <View style={[styles.groupCard, { backgroundColor: cardBg, padding: 16, marginBottom: 14, gap: 6 }]}>
                        <Text style={styles.subCardTitle}>{bot?.name ?? s.bots.usage}</Text>
                        <Text style={styles.memberRole}>
                          {s.bots.inputTokens}: {Number(object(runStats.tokenUsage).inputTokens ?? 0).toLocaleString()} ·{' '}
                          {s.bots.outputTokens}: {Number(object(runStats.tokenUsage).outputTokens ?? 0).toLocaleString()}
                        </Text>
                      </View>
                    )}
                    {(() => {
                      const rows = Array.isArray(usageData?.rows) ? usageData!.rows.filter(Array.isArray) : []
                      if (rows.length === 0) {
                        return !runStats ? (
                          <View style={styles.centeredEmptyWrap}>
                            <Text style={styles.centeredEmptyText}>{s.bots.none}</Text>
                          </View>
                        ) : null
                      }
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
      paddingBottom: 8,
    },
    topRightGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    circleBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    circlePlaceholder: {
      width: 42,
      height: 42,
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
    },
    heroSection: {
      alignItems: 'center',
      paddingTop: 12,
      paddingBottom: 24,
    },
    roomHeroAvatar: {
      width: 88,
      height: 88,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    heroNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 14,
      paddingHorizontal: 20,
    },
    heroName: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.ink,
      textAlign: 'center',
    },
    heroSubtitle: {
      fontSize: 13.5,
      lineHeight: 19,
      color: colors.muted,
      textAlign: 'center',
      marginTop: 4,
      paddingHorizontal: 28,
    },
    editPill: {
      marginTop: 12,
      paddingHorizontal: 18,
      paddingVertical: 7,
      borderRadius: 999,
    },
    editPillLight: {
      backgroundColor: '#E5E7EB',
    },
    editPillDark: {
      backgroundColor: colors.surfaceStrong,
    },
    editPillText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: colors.ink,
    },
    errorBanner: {
      fontSize: 13.5,
      color: colors.danger,
      textAlign: 'center',
      marginBottom: 12,
      paddingHorizontal: 12,
    },
    groupCard: {
      borderRadius: 18,
      overflow: 'hidden',
    },
    toggleCardSpacing: {
      marginTop: 16,
    },
    sectionHeader: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.muted,
      paddingHorizontal: 14,
      marginTop: 20,
      marginBottom: 8,
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 54,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
    },
    cardRowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    cardRowPressed: {
      backgroundColor: colors.grouped,
    },
    rowIconWrap: {
      width: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      flex: 1,
      fontSize: 16,
      fontWeight: '400',
      color: colors.ink,
    },
    rowValue: {
      maxWidth: '42%',
      fontSize: 15,
      color: colors.muted,
      marginRight: 2,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 54,
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 12,
    },
    footnote: {
      fontSize: 12.5,
      lineHeight: 18,
      color: colors.muted,
      paddingHorizontal: 14,
      paddingTop: 8,
    },
    subCardTitle: {
      fontSize: 15.5,
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
      minHeight: 58,
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 12,
    },
    memberBody: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    memberRole: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
    partRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 58,
      paddingHorizontal: 16,
      paddingVertical: 11,
      gap: 12,
    },
    centeredEmptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 36,
      paddingBottom: 64,
      gap: 12,
    },
    centeredStatusPill: {
      paddingHorizontal: 14,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.surfaceStrong,
      fontSize: 13.5,
      fontWeight: '600',
      color: colors.ink,
      overflow: 'hidden',
    },
    centeredEmptyText: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
      textAlign: 'center',
    },
  })
