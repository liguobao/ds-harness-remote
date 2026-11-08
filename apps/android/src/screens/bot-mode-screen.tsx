import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, AppState, Easing, Pressable, ScrollView, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeftRight,
  Bot,
  ChevronLeft,
  Copy,
  Info,
  Menu,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Plus,
  Square,
  Trash2,
  Users,
} from 'lucide-react-native'
import { strings as s } from '../locales/i18n'
import { browseScope } from '../services/browse-memory'
import { canDeleteBot, objects, resolveBotTargetSessionId, text, type BotRemoteClient } from '../services/bot-catalog'
import { getConnectionGeneration, requireBotClient, useAppStore } from '../state/store'
import { useBotTeamStore } from '../state/bot-store'
import { BlurHeaderFrame, Button, EmptyState, IconButton, TopBar } from '../ui/components'
import { KeyboardInset } from '../ui/keyboard-inset'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { BotAgentBadge, engineOfModel } from './bot/agent-badge'
import { BotAvatar } from './bot/avatar'
import { BotConversation } from './bot/conversation'
import { type BotPerform } from './bot/editor'
import { BotFloatingPopover, type BotPopoverAction } from './bot/popover-menu'
import { createBotStyles } from './bot/styles'
import { BotModalsHost, BotSidebarSection, DsBotInstallCard, useBotTeamPolling } from './bot-sidebar-section'

export function BotModeScreen({
  selectedId: propSelectedId,
  onSelect,
  onAgentMode,
  onBack,
  onOpenDrawer,
  onDeviceInfo,
  onMore,
  splitView = false,
  drawerOpen = false,
}: {
  selectedId?: string
  onSelect: (id?: string) => void
  onAgentMode: () => void
  onBack?: () => void
  onOpenDrawer?: () => void
  onDeviceInfo: () => void
  onMore: () => void
  splitView?: boolean
  drawerOpen?: boolean
}) {
  const styles = useThemedStyles(createBotStyles)
  const { colors } = useTheme()
  const device = useAppStore(store => store.selectedDevice)
  const connectionPhase = useAppStore(store => store.connection.phase)
  const hostScope = useAppStore(browseScope)
  const connectionGen = getConnectionGeneration()

  // The drawer runs the same poller while it is mounted (inline split view or an
  // open sheet); a second loop just doubles traffic and cancels in-flight reads.
  useBotTeamPolling(!drawerOpen)

  const state = useBotTeamStore(store => store.state)
  const session = useBotTeamStore(store => store.session)
  const openError = useBotTeamStore(store => store.openError)
  const openAttempt = useBotTeamStore(store => store.openAttempt)
  const loading = useBotTeamStore(store => store.loading)
  const busy = useBotTeamStore(store => store.busy)
  const error = useBotTeamStore(store => store.error)
  const actionError = useBotTeamStore(store => store.actionError)
  const storeSelectedId = useBotTeamStore(store => store.selectedId)
  const setSelectedId = useBotTeamStore(store => store.setSelectedId)
  const setEditor = useBotTeamStore(store => store.setEditor)
  const setDetailsOpen = useBotTeamStore(store => store.setDetailsOpen)
  const syncSelectedSession = useBotTeamStore(store => store.syncSelectedSession)
  const retryOpenSession = useBotTeamStore(store => store.retryOpenSession)
  const performStore = useBotTeamStore(store => store.perform)

  const prevPropRef = useRef(propSelectedId)
  const prevStoreRef = useRef(storeSelectedId)
  const pendingStoreTargetRef = useRef<{ active: boolean; value: string | undefined }>({
    active: false,
    value: undefined,
  })
  const pendingPropAcksRef = useRef<Array<string | undefined>>([])
  const mountedSyncRef = useRef(false)

  const emitOnSelect = (nextId: string | undefined) => {
    const queue = pendingPropAcksRef.current
    if (queue.length === 0 || queue[queue.length - 1] !== nextId) {
      queue.push(nextId)
    }
    onSelect(nextId)
  }

  useEffect(() => {
    if (!mountedSyncRef.current) {
      mountedSyncRef.current = true
      prevPropRef.current = propSelectedId
      prevStoreRef.current = storeSelectedId
      if (propSelectedId !== undefined && propSelectedId !== storeSelectedId) {
        pendingStoreTargetRef.current = { active: true, value: propSelectedId }
        setSelectedId(propSelectedId)
      } else if (propSelectedId === undefined && storeSelectedId !== undefined) {
        emitOnSelect(storeSelectedId)
      }
      return
    }
    const propChanged = propSelectedId !== prevPropRef.current
    const storeChanged = storeSelectedId !== prevStoreRef.current
    prevPropRef.current = propSelectedId
    prevStoreRef.current = storeSelectedId

    let externalPropChange = propChanged
    if (propChanged) {
      const ackIdx = pendingPropAcksRef.current.indexOf(propSelectedId)
      if (ackIdx !== -1) {
        pendingPropAcksRef.current.splice(0, ackIdx + 1)
        externalPropChange = false
      } else {
        pendingPropAcksRef.current.length = 0
      }
    }

    if (pendingStoreTargetRef.current.active) {
      if (storeSelectedId === pendingStoreTargetRef.current.value) {
        pendingStoreTargetRef.current = { active: false, value: undefined }
        if (externalPropChange && propSelectedId !== undefined && propSelectedId !== storeSelectedId) {
          pendingStoreTargetRef.current = { active: true, value: propSelectedId }
          setSelectedId(propSelectedId)
        } else if (pendingPropAcksRef.current.length === 0 && storeSelectedId !== propSelectedId) {
          emitOnSelect(storeSelectedId)
        }
        return
      }
      if (!externalPropChange && !storeChanged) {
        setSelectedId(pendingStoreTargetRef.current.value)
        return
      }
      pendingStoreTargetRef.current = { active: false, value: undefined }
    }

    if (storeChanged) {
      if (storeSelectedId !== propSelectedId) {
        emitOnSelect(storeSelectedId)
      }
      return
    }
    if (externalPropChange && propSelectedId !== undefined && propSelectedId !== storeSelectedId) {
      pendingStoreTargetRef.current = { active: true, value: propSelectedId }
      setSelectedId(propSelectedId)
    } else if (!externalPropChange && propChanged && pendingPropAcksRef.current.length === 0 && storeSelectedId !== propSelectedId) {
      emitOnSelect(storeSelectedId)
    }
  }, [propSelectedId, storeSelectedId, setSelectedId, onSelect])

  const isPendingPropAckInRender = propSelectedId !== prevPropRef.current
    && pendingPropAcksRef.current.includes(propSelectedId)
  const propChangedInRender = mountedSyncRef.current
    ? propSelectedId !== prevPropRef.current
      && !isPendingPropAckInRender
      && (storeSelectedId === prevStoreRef.current
        || (pendingStoreTargetRef.current.active && storeSelectedId === pendingStoreTargetRef.current.value))
    : propSelectedId !== undefined && propSelectedId !== storeSelectedId
  const selectedId = propChangedInRender && propSelectedId !== undefined
    ? propSelectedId
    : storeSelectedId

  const handleSelect = (id?: string) => {
    pendingStoreTargetRef.current = { active: false, value: undefined }
    setSelectedId(id)
    emitOnSelect(id)
  }

  const [active, setActive] = useState(AppState.currentState === 'active')
  const [rosterSearch, setRosterSearch] = useState('')
  const [chatMoreOpen, setChatMoreOpen] = useState(false)
  const enterAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setActive(next === 'active'))
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!selectedId) return
    enterAnim.setValue(0)
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [selectedId, enterAnim])

  const { clientValue, clientInitError } = useMemo(() => {
    if (connectionPhase !== 'connected') {
      return { clientValue: undefined, clientInitError: undefined }
    }
    try {
      return { clientValue: requireBotClient(), clientInitError: undefined }
    } catch (reason) {
      return {
        clientValue: undefined,
        clientInitError: reason instanceof Error ? reason.message : s.bots.unavailable,
      }
    }
  }, [connectionPhase, connectionGen, hostScope])

  const bot = state?.bots.find(entry => entry.id === selectedId)
  const room = state?.rooms.find(entry => entry.id === selectedId)
  const targetSessionId = resolveBotTargetSessionId(state, selectedId)

  // Only resolve and open when session identity, Host/connection epoch, or explicit retry changes — never on 3s roster array reference refreshes.
  useEffect(() => {
    if (connectionPhase !== 'connected') return
    void syncSelectedSession({ selectedId })
  }, [hostScope, connectionPhase, connectionGen, selectedId, targetSessionId, openAttempt, syncSelectedSession])

  const perform: BotPerform = (operation, payload) => performStore(operation, payload)
  const visibleError = actionError ?? openError ?? error ?? clientInitError

  const retry = () => {
    void retryOpenSession()
  }

  const insets = useSafeAreaInsets()
  // A Bot/group header goes back to the roster; the roster header opens the
  // session drawer. The previous order made the roster branch unreachable
  // because chat always passes onOpenDrawer.
  const navBack = splitView ? undefined : (bot || room ? () => handleSelect(undefined) : (onOpenDrawer ?? onBack))
  const goalSteps = objects(room?.goal?.steps)
  const goalDoneCount = goalSteps.filter(step => text(step.status) === 'done').length
  const goalTitle = text(room?.goal?.title)
  const roomLeadBot = room && state ? state.bots.find(entry => entry.id === room.members[0]) : undefined
  const mainCount = state?.bots.filter(b => b.main).length ?? 0

  const headerMoreActions: BotPopoverAction[] = []
  if (bot || room) {
    headerMoreActions.push({
      key: 'profile',
      icon: Info,
      label: s.bots.details,
      onPress: () => setDetailsOpen(true),
    })
    if (bot) {
      headerMoreActions.push({
        key: 'new-session',
        icon: Plus,
        label: s.bots.newSession,
        disabled: busy || Boolean(state?.readOnly),
        onPress: () => void perform('bot-new-part', { botId: bot.id }),
      })
    }
    headerMoreActions.push({
      key: 'edit',
      icon: Pencil,
      label: s.bots.edit,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => setEditor({ kind: bot ? 'bot' : 'room', id: selectedId }),
    })
    if (bot && (!bot.main || mainCount > 1)) {
      headerMoreActions.push({
        key: 'main',
        icon: ArrowLeftRight,
        label: bot.main ? s.bots.removeMain : s.bots.replaceMain,
        disabled: busy || Boolean(state?.readOnly),
        onPress: () => void perform('set-main', { id: bot.id, main: !bot.main }),
      })
    }
    if (room) {
      headerMoreActions.push({
        key: 'stop-room',
        icon: Square,
        label: s.bots.stop,
        disabled: busy || Boolean(state?.readOnly),
        onPress: () => void perform('stop-room-work', { roomId: room.id }),
      })
    }
    headerMoreActions.push({
      key: 'copy-id',
      icon: Copy,
      label: s.bots.copyId,
      onPress: () => {
        const id = bot?.id ?? room?.id ?? ''
        if (id) void Clipboard.setStringAsync(id)
      },
    })
    if ((bot && canDeleteBot(state, bot)) || room) {
      headerMoreActions.push({
        key: 'delete',
        icon: Trash2,
        label: s.bots.delete,
        danger: true,
        disabled: busy || Boolean(state?.readOnly),
        onPress: () => {
          const targetId = bot?.id ?? room?.id
          if (!targetId) return
          Alert.alert(s.bots.delete, s.bots.deleteHint, [
            { text: s.bots.cancel, style: 'cancel' },
            {
              text: s.bots.delete,
              style: 'destructive',
              onPress: () => void perform(bot ? 'delete-bot' : 'delete-room', { id: targetId }),
            },
          ])
        },
      })
    }
  }

  const header = selectedId && (bot || room) ? (
    <View style={[styles.headerBar, { paddingTop: insets.top + 8, minHeight: 54 + insets.top }]}>
      <View style={styles.headerSide}>
        {navBack !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={onOpenDrawer ? s.chat.openHostSessions : s.common.back}
            onPress={navBack}
            hitSlop={8}
            style={({ pressed }) => [styles.headerSideChip, pressed && { opacity: 0.72 }]}
          >
            <ChevronLeft size={22} color={colors.ink} strokeWidth={2.1} />
          </Pressable>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bot?.name ?? room?.name ?? s.bots.title}
        onPress={() => setDetailsOpen(true)}
        style={({ pressed }) => [styles.headerPill, pressed && { opacity: 0.82, transform: [{ scale: 0.98 }] }]}
      >
        {bot ? (
          <BotAvatar bot={bot} size={26} />
        ) : roomLeadBot ? (
          <BotAvatar bot={roomLeadBot} size={26} />
        ) : (
          <Users size={18} color={colors.primary} />
        )}
        <Text numberOfLines={1} style={styles.headerPillName}>
          {goalTitle || (bot?.name ?? room?.name ?? s.bots.title)}
        </Text>
        {bot && <BotAgentBadge engine={bot.engine ?? engineOfModel(bot.model || bot.appliedModel)} size={14} />}
        {room?.goal !== undefined && goalSteps.length > 0 && (
          <Text style={styles.headerPillGoalCount}>
            {goalDoneCount}/{goalSteps.length}
          </Text>
        )}
      </Pressable>

      <View style={styles.headerSide}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.sessions.moreActions}
          onPress={() => setChatMoreOpen(true)}
          hitSlop={8}
          style={({ pressed }) => [styles.headerSideChip, pressed && { opacity: 0.72 }]}
        >
          <MoreHorizontal size={20} color={colors.ink} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  ) : (
    <TopBar
      title={device?.name ?? s.bots.title}
      titleLines={1}
      centered={80}
      titleAccessory={null}
      backIcon={onOpenDrawer ? Menu : undefined}
      backLabel={onOpenDrawer ? s.chat.openHostSessions : undefined}
      onBack={navBack}
      onTitlePress={onDeviceInfo}
      action={
        <IconButton
          dense
          label={s.settings.more}
          icon={MoreVertical}
          onPress={onMore}
        />
      }
    />
  )

  const slideX = enterAnim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] })
  const fadeOpacity = enterAnim.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] })

  return (
    <KeyboardInset>
      <View style={styles.flex}>
        <BlurHeaderFrame header={header} inset>
          {selectedId === undefined ? (
            <BotSidebarSection
              searchQuery={rosterSearch}
              onSearchChange={setRosterSearch}
              onSelectBot={id => handleSelect(id)}
            />
          ) : (
            <Animated.View style={[styles.flex, { opacity: fadeOpacity, transform: [{ translateX: slideX }] }]}>
              {visibleError !== undefined && (
                <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 6 }}>
                  <Text accessibilityRole="alert" style={styles.error}>{visibleError}</Text>
                  <Button label={s.bots.retry} onPress={retry} />
                </View>
              )}
              {session && state && clientValue ? (
                <BotConversation
                  key={`${selectedId}:${session.sessionId}`}
                  bot={bot}
                  room={room}
                  state={state}
                  session={session}
                  client={clientValue}
                  busy={busy}
                  active={active}
                  perform={perform}
                  onSelectBot={id => handleSelect(id)}
                />
              ) : loading || (connectionPhase === 'connected' && targetSessionId && !openError) ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : state === undefined ? (
                <ScrollView contentContainerStyle={{ padding: 16 }}>
                  <DsBotInstallCard error={visibleError} onRetry={retry} />
                </ScrollView>
              ) : state.bots.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  title={s.bots.empty}
                  body={s.bots.emptyHint}
                  action={
                    <Button
                      label={s.bots.newBot}
                      disabled={busy || Boolean(state.readOnly)}
                      onPress={() => setEditor({ kind: 'bot' })}
                    />
                  }
                />
              ) : (
                <EmptyState
                  icon={Bot}
                  title={s.bots.sessionUnavailable}
                  body={visibleError ?? s.bots.sessionUnavailable}
                  action={<Button label={s.bots.back} onPress={() => handleSelect(undefined)} />}
                />
              )}
            </Animated.View>
          )}
        </BlurHeaderFrame>
        <BotFloatingPopover
          visible={chatMoreOpen}
          actions={headerMoreActions}
          onClose={() => setChatMoreOpen(false)}
          anchor="top-right"
        />
        {!drawerOpen && <BotModalsHost />}
      </View>
    </KeyboardInset>
  )
}
