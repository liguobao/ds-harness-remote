import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowRight, Bot, Menu, MoreVertical, Users } from 'lucide-react-native'
import { strings as s } from '../locales/i18n'
import { objects, text, type BotRemoteClient } from '../services/bot-catalog'
import { requireBotClient, useAppStore } from '../state/store'
import { markBotSessionId, useBotTeamStore } from '../state/bot-store'
import type { RemoteSession } from '../types'
import { BlurHeaderFrame, Button, EmptyState, IconButton, TopBar } from '../ui/components'
import { KeyboardInset } from '../ui/keyboard-inset'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { BotAgentBadge, engineOfModel } from './bot/agent-badge'
import { BotAvatar } from './bot/avatar'
import { BotConversation } from './bot/conversation'
import { type BotPerform } from './bot/editor'
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
  const openSession = useAppStore(store => store.openSession)

  useBotTeamPolling(true)

  const state = useBotTeamStore(store => store.state)
  const loading = useBotTeamStore(store => store.loading)
  const busy = useBotTeamStore(store => store.busy)
  const error = useBotTeamStore(store => store.error)
  const actionError = useBotTeamStore(store => store.actionError)
  const storeSelectedId = useBotTeamStore(store => store.selectedId)
  const setSelectedId = useBotTeamStore(store => store.setSelectedId)
  const setEditor = useBotTeamStore(store => store.setEditor)
  const setDetailsOpen = useBotTeamStore(store => store.setDetailsOpen)
  const clearErrors = useBotTeamStore(store => store.clearErrors)
  const refresh = useBotTeamStore(store => store.refresh)
  const performStore = useBotTeamStore(store => store.perform)

  const selectedId = propSelectedId ?? storeSelectedId

  useEffect(() => {
    if (propSelectedId !== undefined && propSelectedId !== storeSelectedId) {
      setSelectedId(propSelectedId)
    }
  }, [propSelectedId, storeSelectedId, setSelectedId])

  useEffect(() => {
    if (propSelectedId === undefined && storeSelectedId !== undefined) {
      onSelect(storeSelectedId)
    }
  }, [propSelectedId, storeSelectedId, onSelect])

  const handleSelect = (id?: string) => {
    setSelectedId(id)
    onSelect(id)
  }

  const [active, setActive] = useState(AppState.currentState === 'active')
  const [session, setSession] = useState<RemoteSession>()
  const [openError, setOpenError] = useState<string>()
  const [openAttempt, setOpenAttempt] = useState(0)
  const [rosterSearch, setRosterSearch] = useState('')
  const sessionOwner = useRef<string | undefined>(undefined)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setActive(next === 'active'))
    return () => sub.remove()
  }, [])

  let clientValue: BotRemoteClient | undefined
  let clientInitError: string | undefined
  try {
    clientValue = requireBotClient()
  } catch (reason) {
    clientInitError = reason instanceof Error ? reason.message : s.bots.unavailable
  }

  const bot = state?.bots.find(entry => entry.id === selectedId)
  const room = state?.rooms.find(entry => entry.id === selectedId)
  const isAgentSession = Boolean(selectedId && state?.agents.some(a => a.sessions.includes(selectedId)))
  const targetSessionId = bot?.sessionId ?? room?.sessionId ?? room?.id ?? (isAgentSession ? selectedId : undefined)

  useEffect(() => {
    setOpenError(undefined)
    if (!clientValue || !selectedId || !targetSessionId) {
      setSession(undefined)
      return
    }
    let cancelled = false
    const control = new AbortController()
    if (sessionOwner.current !== `${selectedId}:${targetSessionId}`) {
      setSession(undefined)
    }
    void (async () => {
      try {
        const resolved = await clientValue.resolveSession(selectedId, control.signal)
        markBotSessionId(resolved.session.sessionId)
        if (cancelled) return
        if (await openSession(resolved.session) && !cancelled && selectedRef.current === selectedId) {
          sessionOwner.current = `${selectedId}:${targetSessionId}`
          setSession(resolved.session)
        } else if (!cancelled) {
          setOpenError(useAppStore.getState().error ?? s.bots.sessionUnavailable)
        }
      } catch (reason) {
        if (!cancelled) {
          setOpenError(reason instanceof Error ? reason.message : s.bots.unavailable)
        }
      }
    })()
    return () => {
      cancelled = true
      control.abort()
    }
  }, [selectedId, targetSessionId, openSession, openAttempt, state?.bots, state?.rooms])

  const perform: BotPerform = (operation, payload) => performStore(operation, payload)
  const visibleError = actionError ?? openError ?? error ?? clientInitError

  const retry = () => {
    clearErrors()
    setOpenError(undefined)
    setOpenAttempt(v => v + 1)
    void refresh(true)
  }

  const insets = useSafeAreaInsets()
  const navBack = splitView ? undefined : (onOpenDrawer ?? (selectedId ? () => handleSelect(undefined) : onBack))
  const goalSteps = objects(room?.goal?.steps)
  const goalDoneCount = goalSteps.filter(step => text(step.status) === 'done').length
  const goalTitle = text(room?.goal?.title)
  const roomLeadBot = room && state ? state.bots.find(entry => entry.id === room.members[0]) : undefined

  const header = selectedId && (bot || room) ? (
    <View style={[styles.headerBar, { paddingTop: insets.top + 8, minHeight: 52 + insets.top }]}>
      <View style={styles.headerSide}>
        {navBack !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={onOpenDrawer ? s.chat.openHostSessions : s.common.back}
            onPress={navBack}
            hitSlop={8}
            style={({ pressed }) => [styles.headerSideChip, pressed && { opacity: 0.72 }]}
          >
            <Menu size={20} color={colors.ink} />
          </Pressable>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bot?.name ?? room?.name ?? s.bots.title}
        onPress={() => setDetailsOpen(true)}
        style={({ pressed }) => [styles.headerPill, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
      >
        {bot ? (
          <BotAvatar bot={bot} size={24} />
        ) : roomLeadBot ? (
          <BotAvatar bot={roomLeadBot} size={24} />
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
        <ArrowRight size={14} color={colors.muted} />
      </Pressable>

      <View style={styles.headerSide}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.bots.details}
          onPress={() => setDetailsOpen(true)}
          hitSlop={8}
          style={({ pressed }) => [styles.headerSideChip, pressed && { opacity: 0.72 }]}
        >
          <MoreVertical size={18} color={colors.ink} />
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

  return (
    <KeyboardInset>
      <View style={styles.flex}>
        <BlurHeaderFrame header={header} inset={selectedId !== undefined}>
          {selectedId === undefined ? (
            <BotSidebarSection
              searchQuery={rosterSearch}
              onSearchChange={setRosterSearch}
              showSearch
              onSelectBot={id => handleSelect(id)}
            />
          ) : (
            <View style={styles.flex}>
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
              ) : loading || (targetSessionId && !openError) ? (
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
            </View>
          )}
        </BlurHeaderFrame>
        {!drawerOpen && <BotModalsHost />}
      </View>
    </KeyboardInset>
  )
}
