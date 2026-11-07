import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import {
  Bot,
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  ChevronRight,
  CirclePlus,
  Copy,
  Download,
  MoreHorizontal,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react-native'
import { strings as s } from '../locales/i18n'
import { browseScope } from '../services/browse-memory'
import {
  object,
  objects,
  text,
  type BotEntry,
  type BotObject,
  type BotRemoteClient,
  type BotRoom,
  type BotState,
} from '../services/bot-catalog'
import { requireBotClient, useAppStore } from '../state/store'
import { useBotTeamStore } from '../state/bot-store'
import { Button, EmptyState, GroupCard, GroupRow, IconButton, SectionTitle } from '../ui/components'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useResponsiveLayout } from '../ui/responsive'
import { useThemedStyles } from '../ui/use-themed-styles'
import { ModalSurface } from './chat/modal'
import { resolveSessionDisplayTitle } from './session-title'
import { BotAgentBadge, engineOfModel } from './bot/agent-badge'
import { BotAvatar } from './bot/avatar'
import { BotEditor, type BotPerform } from './bot/editor'

/** Shared polling hook so the sidebar and main Bot screen stay in sync. */
export function useBotTeamPolling(enabled: boolean): void {
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const botScope = useAppStore(browseScope)
  const ensureScope = useBotTeamStore(state => state.ensureScope)
  const refresh = useBotTeamStore(state => state.refresh)

  useEffect(() => {
    ensureScope(botScope)
  }, [botScope, ensureScope])

  useEffect(() => {
    if (!enabled || !connected) return
    let active = AppState.currentState === 'active'
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    const tick = async () => {
      if (disposed || !active) return
      await refresh(false, controller.signal)
      if (!disposed && active) {
        timer = setTimeout(() => void tick(), 3000)
      }
    }

    const sub = AppState.addEventListener('change', next => {
      const wasActive = active
      active = next === 'active'
      if (active && !wasActive && !disposed) {
        clearTimeout(timer)
        void tick()
      } else if (!active) {
        clearTimeout(timer)
      }
    })

    void tick()
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
      sub.remove()
    }
  }, [enabled, connected, botScope, refresh])
}

export function botLiveStatus(state: BotState, bot: BotEntry): { kind: 'idle' | 'working' | 'away' | 'waiting'; label: string } {
  const hasQuestion = state.questions[bot.sessionId] !== undefined
  const hasApproval = state.approvals.some(entry => entry.botId === bot.id || entry.sessionId === bot.sessionId)
  if (hasQuestion || hasApproval || state.activity[bot.id] === 'alert' || bot.waiting) {
    return { kind: 'waiting', label: s.bots.waiting }
  }
  const ownTurn = state.work.bots[bot.id] ?? state.activity[bot.id]
  if (ownTurn) {
    return { kind: 'working', label: s.bots.busy }
  }
  const roomEntries = Object.entries(state.work.rooms).flatMap(([roomId, list]) => {
    const arr = Array.isArray(list) ? list : []
    return arr.filter(item => object(item).botId === bot.id).map(() => roomId)
  })
  if (roomEntries.length > 0) {
    const roomName = state.rooms.find(r => r.id === roomEntries[0])?.name ?? s.bots.groups
    return { kind: 'away', label: `${roomName} · ${s.bots.busy}` }
  }
  const waitingObj = object(state.work.waiting[bot.id])
  const waitBots = Array.isArray(waitingObj.bots) ? waitingObj.bots : []
  const waitRooms = Array.isArray(waitingObj.rooms) ? waitingObj.rooms : []
  if (waitBots.length > 0 || waitRooms.length > 0) {
    return { kind: 'waiting', label: s.bots.waiting }
  }
  return { kind: 'idle', label: s.bots.idle }
}

export function roomLiveStatus(state: BotState, room: BotRoom): { working: boolean; waiting: boolean; label: string } {
  const hasApproval = state.approvals.some(entry => entry.roomId === room.id)
  const roomWork = state.work.rooms[room.id]
  const activeMembers = (Array.isArray(roomWork) ? roomWork : [])
    .map(entry => text(object(entry).botId))
    .filter(Boolean)
  if (hasApproval) {
    return { working: activeMembers.length > 0, waiting: true, label: s.bots.waiting }
  }
  if (activeMembers.length > 0) {
    const firstBot = state.bots.find(b => b.id === activeMembers[0])?.name ?? activeMembers[0]
    const extra = activeMembers.length > 1 ? ` +${activeMembers.length - 1}` : ''
    return { working: true, waiting: false, label: `${firstBot}${extra} · ${s.bots.busy}` }
  }
  const goalObj = room.goal
  if (goalObj && text(goalObj.status) === 'running') {
    return { working: true, waiting: false, label: text(goalObj.title) || s.bots.busy }
  }
  return {
    working: false,
    waiting: false,
    label: room.preview || room.members.map(id => state.bots.find(m => m.id === id)?.name ?? id).join(' · '),
  }
}

export function BotSidebarSection({
  searchQuery,
  onSearchChange,
  showSearch,
  onSelectBot,
}: {
  searchQuery: string
  onSearchChange: (q: string) => void
  showSearch: boolean
  onSelectBot: (id: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const sessions = useAppStore(state => state.sessions)
  const state = useBotTeamStore(store => store.state)
  const loading = useBotTeamStore(store => store.loading)
  const busy = useBotTeamStore(store => store.busy)
  const error = useBotTeamStore(store => store.error)
  const actionError = useBotTeamStore(store => store.actionError)
  const selectedId = useBotTeamStore(store => store.selectedId)
  const refresh = useBotTeamStore(store => store.refresh)
  const perform = useBotTeamStore(store => store.perform)
  const setEditor = useBotTeamStore(store => store.setEditor)
  const setContextMenu = useBotTeamStore(store => store.setContextMenu)

  const query = searchQuery.trim().toLocaleLowerCase()
  const visibleError = actionError ?? error

  const visibleBots = (state?.bots ?? [])
    .filter(entry => !(entry.hidden && entry.id !== selectedId && !entry.main))
    .filter(entry => !query || `${entry.name} ${entry.role} ${entry.preview ?? ''}`.toLocaleLowerCase().includes(query))

  const mainBots = visibleBots.filter(entry => entry.main)
  const regularBots = [...visibleBots.filter(entry => !entry.main)].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)),
  )

  const visibleRooms = [...(state?.rooms ?? [])]
    .filter(entry => !(entry.hidden && entry.id !== selectedId))
    .filter(entry => !query || `${entry.name} ${entry.preview ?? ''}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))

  const agents = state?.agents ?? []

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {showSearch && (
        <View style={styles.searchContainer}>
          <Search size={16} color={colors.muted} />
          <TextInput
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder={s.bots.search}
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoFocus
          />
          {searchQuery.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.common.close}
              hitSlop={8}
              onPress={() => onSearchChange('')}
            >
              <X size={15} color={colors.muted} />
            </Pressable>
          )}
        </View>
      )}

      {visibleError !== undefined && state !== undefined && (
        <View style={styles.errorBanner}>
          <Text accessibilityRole="alert" style={styles.errorText}>{visibleError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.bots.retry}
            onPress={() => void refresh(true)}
            style={({ pressed }) => [styles.retryPill, pressed && styles.pressedFade]}
          >
            <RefreshCw size={13} color={colors.primary} />
            <Text style={styles.retryPillText}>{s.bots.retry}</Text>
          </Pressable>
        </View>
      )}

      {state?.readOnly !== undefined && (
        <View style={styles.readOnlyBadge}>
          <Text style={styles.readOnlyText}>{s.bots.readOnly}: {state.readOnly}</Text>
        </View>
      )}

      {loading && state === undefined && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!loading && state === undefined && (
        <DsBotInstallCard error={visibleError} onRetry={() => void refresh(true)} />
      )}

      {state !== undefined && state.bots.length === 0 && (
        <View style={styles.emptyWrap}>
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
        </View>
      )}

      {/* 主 Bot 卡片区 (对齐 DS-Bot sidebar.js Main Tile + GroupCard 风格) */}
      {mainBots.length > 0 && (
        <View style={styles.sectionBlock}>
          <View style={styles.sidebarSectionHeader}>
            <Text style={styles.sidebarSectionTitle}>{s.bots.mainTitle}</Text>
          </View>
          <GroupCard>
            {mainBots.map((entry, index) => {
              const isSelected = selectedId === entry.id
              const live = state ? botLiveStatus(state, entry) : { kind: 'idle' as const, label: s.bots.idle }
              const subtitle = live.kind !== 'idle'
                ? live.label
                : (entry.preview || entry.role || s.bots.idle)
              const dotColor = live.kind === 'waiting'
                ? colors.warning
                : live.kind === 'working' || live.kind === 'away'
                  ? colors.success
                  : colors.subtle
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.name}, ${s.bots.main}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onSelectBot(entry.id)}
                  onLongPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                    setContextMenu({ kind: 'bot', id: entry.id })
                  }}
                  style={({ pressed }) => [
                    styles.botRow,
                    styles.mainBotRow,
                    index > 0 && styles.rowDivider,
                    isSelected && styles.rowSelected,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.avatarWrap}>
                    <BotAvatar bot={entry} size={44} />
                    <View style={[styles.avatarStatusDot, { backgroundColor: dotColor }]} />
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.rowTitleLine}>
                      <Text numberOfLines={1} style={[styles.mainBotName, isSelected && styles.rowNameSelected]}>
                        {entry.name}
                      </Text>
                      <BotAgentBadge engine={entry.engine ?? engineOfModel(entry.model || entry.appliedModel)} size={15} />
                      <Star size={13} color={colors.primary} fill={colors.primary} />
                      {Boolean(entry.role) && (
                        <View style={styles.roleChip}>
                          <Text numberOfLines={1} style={styles.roleChipText}>{entry.role}</Text>
                        </View>
                      )}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.rowSubtitle,
                        (live.kind === 'working' || live.kind === 'away') && styles.rowSubtitleActive,
                        live.kind === 'waiting' && styles.rowSubtitleWarning,
                      ]}
                    >
                      {subtitle}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={s.sessions.moreActions}
                    hitSlop={8}
                    onPress={e => {
                      e.stopPropagation()
                      setContextMenu({ kind: 'bot', id: entry.id })
                    }}
                    style={styles.moreBtn}
                  >
                    <MoreHorizontal size={17} color={colors.muted} />
                  </Pressable>
                </Pressable>
              )
            })}
          </GroupCard>
        </View>
      )}

      {/* 机器人列表 (Bots) */}
      {state !== undefined && (
        <View style={styles.sectionBlock}>
          <View style={styles.sidebarSectionHeader}>
            <Text style={styles.sidebarSectionTitle}>
              {s.bots.all}
              {regularBots.length > 0 ? ` (${regularBots.length})` : ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.bots.newBot}
              disabled={busy || Boolean(state.readOnly)}
              onPress={() => setEditor({ kind: 'bot' })}
              hitSlop={8}
              style={({ pressed }) => [styles.sectionActionBtn, pressed && styles.pressedFade]}
            >
              <CirclePlus size={15} color={colors.primary} strokeWidth={2} />
              <Text style={styles.sectionActionText}>{s.bots.newBot}</Text>
            </Pressable>
          </View>
          <GroupCard>
            {regularBots.length === 0 ? (
              <GroupRow
                first
                icon={Plus}
                label={s.bots.newBot}
                detail={s.bots.emptyHint}
                disabled={busy || Boolean(state.readOnly)}
                onPress={() => setEditor({ kind: 'bot' })}
              />
            ) : (
              regularBots.map((entry, index) => {
                const isSelected = selectedId === entry.id
                const live = botLiveStatus(state, entry)
                const subtitle = live.kind !== 'idle'
                  ? live.label
                  : (entry.preview || entry.role || s.bots.idle)
                const dotColor = live.kind === 'waiting'
                  ? colors.warning
                  : live.kind === 'working' || live.kind === 'away'
                    ? colors.success
                    : undefined
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityLabel={entry.name}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => onSelectBot(entry.id)}
                    onLongPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                      setContextMenu({ kind: 'bot', id: entry.id })
                    }}
                    style={({ pressed }) => [
                      styles.botRow,
                      index > 0 && styles.rowDivider,
                      isSelected && styles.rowSelected,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <View style={styles.avatarWrap}>
                      <BotAvatar bot={entry} size={36} />
                      {dotColor !== undefined && (
                        <View style={[styles.avatarStatusDotSmall, { backgroundColor: dotColor }]} />
                      )}
                    </View>
                    <View style={styles.rowBody}>
                      <View style={styles.rowTitleLine}>
                        <Text numberOfLines={1} style={[styles.rowName, isSelected && styles.rowNameSelected]}>
                          {entry.name}
                        </Text>
                        <BotAgentBadge engine={entry.engine ?? engineOfModel(entry.model || entry.appliedModel)} size={14} />
                        {entry.pinned && (
                          <OfficialMenuIcons.pinFill size={12} color={colors.muted} />
                        )}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.rowSubtitle,
                          (live.kind === 'working' || live.kind === 'away') && styles.rowSubtitleActive,
                          live.kind === 'waiting' && styles.rowSubtitleWarning,
                        ]}
                      >
                        {subtitle}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={s.sessions.moreActions}
                      hitSlop={8}
                      onPress={e => {
                        e.stopPropagation()
                        setContextMenu({ kind: 'bot', id: entry.id })
                      }}
                      style={styles.moreBtn}
                    >
                      <MoreHorizontal size={17} color={colors.muted} />
                    </Pressable>
                  </Pressable>
                )
              })
            )}
          </GroupCard>
        </View>
      )}

      {/* 群聊列表 (Rooms) */}
      {state !== undefined && (
        <View style={styles.sectionBlock}>
          <View style={styles.sidebarSectionHeader}>
            <Text style={styles.sidebarSectionTitle}>
              {s.bots.groups}
              {visibleRooms.length > 0 ? ` (${visibleRooms.length})` : ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.bots.newGroup}
              disabled={busy || Boolean(state.readOnly) || state.bots.length < 2}
              onPress={() => setEditor({ kind: 'room' })}
              hitSlop={8}
              style={({ pressed }) => [
                styles.sectionActionBtn,
                (busy || Boolean(state.readOnly) || state.bots.length < 2) && styles.disabled,
                pressed && styles.pressedFade,
              ]}
            >
              <CirclePlus size={15} color={colors.primary} strokeWidth={2} />
              <Text style={styles.sectionActionText}>{s.bots.newGroup}</Text>
            </Pressable>
          </View>
          <GroupCard>
            {visibleRooms.length === 0 ? (
              <GroupRow
                first
                icon={Users}
                label={s.bots.newGroup}
                detail={state.bots.length < 2 ? '至少需要 2 个 Bot 才能创建协同群聊' : s.bots.none}
                disabled={busy || Boolean(state.readOnly) || state.bots.length < 2}
                onPress={() => setEditor({ kind: 'room' })}
              />
            ) : (
              visibleRooms.map((entry, index) => {
                const isSelected = selectedId === entry.id
                const live = roomLiveStatus(state, entry)
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityLabel={entry.name}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => onSelectBot(entry.id)}
                    onLongPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                      setContextMenu({ kind: 'room', id: entry.id })
                    }}
                    style={({ pressed }) => [
                      styles.botRow,
                      index > 0 && styles.rowDivider,
                      isSelected && styles.rowSelected,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <View style={styles.groupAvatar}>
                      {entry.members.slice(0, 3).map((id, idx) => {
                        const member = state.bots.find(b => b.id === id)
                        return member ? (
                          <View key={id} style={{ position: 'absolute', left: idx * 7, top: (idx % 2) * 9 }}>
                            <BotAvatar bot={member} size={22} />
                          </View>
                        ) : null
                      })}
                      {entry.members.length === 0 && <Users color={colors.muted} size={22} />}
                    </View>
                    <View style={styles.rowBody}>
                      <View style={styles.rowTitleLine}>
                        <Text numberOfLines={1} style={[styles.rowName, isSelected && styles.rowNameSelected]}>
                          {entry.name}
                        </Text>
                        {entry.pinned && (
                          <OfficialMenuIcons.pinFill size={12} color={colors.muted} />
                        )}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.rowSubtitle,
                          live.working && styles.rowSubtitleActive,
                          live.waiting && styles.rowSubtitleWarning,
                        ]}
                      >
                        {live.label}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={s.sessions.moreActions}
                      hitSlop={8}
                      onPress={e => {
                        e.stopPropagation()
                        setContextMenu({ kind: 'room', id: entry.id })
                      }}
                      style={styles.moreBtn}
                    >
                      <MoreHorizontal size={17} color={colors.muted} />
                    </Pressable>
                  </Pressable>
                )
              })
            )}
          </GroupCard>
        </View>
      )}

      {/* DSH Agent 行 (对齐 DS-Bot v0.2.7 AgentRow) */}
      {state !== undefined && agents.length > 0 && (
        <View style={styles.sectionBlock}>
          <View style={styles.sidebarSectionHeader}>
            <Text style={styles.sidebarSectionTitle}>DSH Agent</Text>
          </View>
          <GroupCard>
            {agents.map(agent => (
              <View key={agent.id}>
                <GroupRow
                  first
                  icon={Sparkles}
                  label="DSH Agent"
                  detail={`${agent.sessions.length} ${s.devices.conversations}`}
                  chevron={false}
                  accessory={
                    <View style={styles.agentActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={s.sessions.newSession}
                        disabled={busy || Boolean(state.readOnly)}
                        onPress={() => void perform('agent-session', { agentId: agent.id })}
                        style={styles.moreBtn}
                      >
                        <Plus size={17} color={colors.primary} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={s.sessions.moreActions}
                        onPress={() => setContextMenu({ kind: 'agent', id: agent.id })}
                        style={styles.moreBtn}
                      >
                        <MoreHorizontal size={17} color={colors.muted} />
                      </Pressable>
                    </View>
                  }
                />
                {agent.sessions.slice(0, 5).map(sid => {
                  const matched = sessions.find(item => item.sessionId === sid)
                  const title = (matched ? resolveSessionDisplayTitle(matched) : undefined) ?? s.sessions.untitled
                  const isSelected = selectedId === sid
                  return (
                    <GroupRow
                      key={sid}
                      label={title}
                      selected={isSelected}
                      onPress={() => onSelectBot(sid)}
                    />
                  )
                })}
              </View>
            ))}
          </GroupCard>
        </View>
      )}

      {/* 团队工具 (Usage & Schedules) */}
      {state !== undefined && (
        <View style={styles.sectionBlock}>
          <View style={styles.sidebarSectionHeader}>
            <Text style={styles.sidebarSectionTitle}>{s.bots.manage}</Text>
          </View>
          <GroupCard>
            <GroupRow
              first
              icon={ChartNoAxesColumn}
              label={s.bots.usage}
              disabled={busy}
              onPress={() => void perform('usage', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
            />
            <GroupRow
              icon={CalendarDays}
              label={s.bots.schedules}
              disabled={busy}
              onPress={() => void perform('schedules')}
            />
            {agents.length === 0 && !state.readOnly && (
              <GroupRow
                icon={Sparkles}
                label="DSH Agent"
                detail={s.sessions.newSession}
                disabled={busy}
                onPress={() => void perform('add-agent')}
              />
            )}
          </GroupCard>
        </View>
      )}
    </ScrollView>
  )
}

/** Shared modals for DS-Bot (Editor, Context Menu, Details, Usage/Schedules Report). */
export function BotModalsHost() {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { sheetMaxHeight } = useResponsiveLayout()
  const state = useBotTeamStore(store => store.state)
  const busy = useBotTeamStore(store => store.busy)
  const error = useBotTeamStore(store => store.error)
  const actionError = useBotTeamStore(store => store.actionError)
  const selectedId = useBotTeamStore(store => store.selectedId)
  const editor = useBotTeamStore(store => store.editor)
  const detailsOpen = useBotTeamStore(store => store.detailsOpen)
  const report = useBotTeamStore(store => store.report)
  const contextMenu = useBotTeamStore(store => store.contextMenu)
  const runStats = useBotTeamStore(store => store.runStats)
  const setEditor = useBotTeamStore(store => store.setEditor)
  const setDetailsOpen = useBotTeamStore(store => store.setDetailsOpen)
  const setReport = useBotTeamStore(store => store.setReport)
  const setContextMenu = useBotTeamStore(store => store.setContextMenu)
  const perform = useBotTeamStore(store => store.perform)
  const loadRunStats = useBotTeamStore(store => store.loadRunStats)
  const appSessions = useAppStore(store => store.sessions)

  const visibleError = actionError ?? error
  const detailBot = state?.bots.find(entry => entry.id === selectedId)
  const detailRoom = state?.rooms.find(entry => entry.id === selectedId)

  useEffect(() => {
    if (!detailsOpen || !detailBot) return
    const control = new AbortController()
    void loadRunStats(detailBot.id, control.signal)
    return () => control.abort()
  }, [detailsOpen, detailBot?.id, loadRunStats])

  let clientInstance: BotRemoteClient | undefined
  try {
    clientInstance = requireBotClient()
  } catch {
    clientInstance = undefined
  }

  const performAdapter: BotPerform = (operation, payload) => perform(operation, payload)

  const confirmDelete = (kind: 'bot' | 'room', id: string) => {
    Alert.alert(s.bots.delete, s.bots.deleteHint, [
      { text: s.bots.cancel, style: 'cancel' },
      {
        text: s.bots.delete,
        style: 'destructive',
        onPress: () => void perform(kind === 'bot' ? 'delete-bot' : 'delete-room', { id }),
      },
    ])
  }

  const menuBot = contextMenu?.kind === 'bot' ? state?.bots.find(b => b.id === contextMenu.id) : undefined
  const menuRoom = contextMenu?.kind === 'room' ? state?.rooms.find(r => r.id === contextMenu.id) : undefined
  const menuAgent = contextMenu?.kind === 'agent' ? state?.agents.find(a => a.id === contextMenu.id) : undefined
  const mainCount = state?.bots.filter(b => b.main).length ?? 0

  return (
    <>
      {editor !== undefined && state !== undefined && clientInstance !== undefined && (
        <BotEditor
          key={`${editor.kind}:${editor.id ?? 'new'}`}
          kind={editor.kind}
          bot={state.bots.find(entry => entry.id === editor.id)}
          room={state.rooms.find(entry => entry.id === editor.id)}
          state={state}
          client={clientInstance}
          busy={busy}
          error={visibleError}
          perform={performAdapter}
          onClose={() => setEditor(undefined)}
        />
      )}

      {/* Bot / Room / Agent 上下文菜单 Sheet */}
      {contextMenu !== undefined && (menuBot || menuRoom || menuAgent) && (
        <Modal
          transparent
          visible
          animationType="fade"
          onRequestClose={() => setContextMenu(undefined)}
          statusBarTranslucent
        >
          <ModalSurface onClose={() => setContextMenu(undefined)}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderTitleWrap}>
                {menuBot && <BotAvatar bot={menuBot} size={36} />}
                <View style={styles.grow}>
                  <Text style={styles.sheetTitle} numberOfLines={1}>
                    {menuBot?.name ?? menuRoom?.name ?? 'DSH Agent'}
                  </Text>
                  {Boolean(menuBot?.role ?? menuRoom?.notice) && (
                    <Text style={styles.sheetSubtitle} numberOfLines={1}>
                      {menuBot?.role ?? menuRoom?.notice}
                    </Text>
                  )}
                </View>
              </View>
              <IconButton label={s.common.close} icon={X} onPress={() => setContextMenu(undefined)} />
            </View>
            <ScrollView style={{ maxHeight: sheetMaxHeight }} contentContainerStyle={styles.sheetBody}>
              <GroupCard>
                {menuBot && !menuBot.tile && (
                  <GroupRow
                    first
                    icon={Pin}
                    label={menuBot.pinned ? s.sessions.unpinSession : s.sessions.pinSession}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      const target = menuBot
                      setContextMenu(undefined)
                      void perform('set-flags', { id: target.id, pinned: !target.pinned })
                    }}
                  />
                )}
                {menuRoom && (
                  <GroupRow
                    first
                    icon={Pin}
                    label={menuRoom.pinned ? s.sessions.unpinSession : s.sessions.pinSession}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      const target = menuRoom
                      setContextMenu(undefined)
                      void perform('set-flags', { id: target.id, pinned: !target.pinned })
                    }}
                  />
                )}
                {(menuBot || menuRoom) && (
                  <GroupRow
                    first={Boolean(menuBot?.tile)}
                    icon={Pencil}
                    label={s.bots.edit}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      const target = contextMenu
                      setContextMenu(undefined)
                      setEditor({ kind: target.kind === 'bot' ? 'bot' : 'room', id: target.id })
                    }}
                  />
                )}
                {menuBot && (!menuBot.main || mainCount > 1) && (
                  <GroupRow
                    icon={Star}
                    label={menuBot.main ? s.bots.removeMain : s.bots.makeMain}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      const target = menuBot
                      setContextMenu(undefined)
                      void perform('set-main', { id: target.id, main: !target.main })
                    }}
                  />
                )}
                {menuBot && (
                  <GroupRow
                    icon={Copy}
                    label={s.bots.duplicate}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      const target = menuBot
                      setContextMenu(undefined)
                      void perform('duplicate-bot', { id: target.id })
                    }}
                  />
                )}
                {menuRoom && (
                  <GroupRow
                    icon={Square}
                    label={s.bots.stop}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      const target = menuRoom
                      setContextMenu(undefined)
                      void perform('stop-room-work', { roomId: target.id })
                    }}
                  />
                )}
                {(menuBot || menuRoom) && (
                  <GroupRow
                    icon={Copy}
                    label={s.sessions.copySessionId}
                    onPress={() => {
                      const sid = menuBot?.sessionId ?? menuRoom?.sessionId ?? menuRoom?.id ?? ''
                      setContextMenu(undefined)
                      if (sid) void Clipboard.setStringAsync(sid)
                    }}
                  />
                )}
                {menuAgent && (
                  <GroupRow
                    first
                    icon={Plus}
                    label={s.sessions.newSession}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      const target = menuAgent
                      setContextMenu(undefined)
                      void perform('agent-session', { agentId: target.id })
                    }}
                  />
                )}
              </GroupCard>

              {((menuBot && !menuBot.main) || menuRoom || menuAgent) && (
                <GroupCard>
                  <GroupRow
                    first
                    icon={Trash2}
                    label={s.bots.delete}
                    danger
                    chevron={false}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      const target = contextMenu
                      setContextMenu(undefined)
                      if (target.kind === 'agent') {
                        void perform('remove-agent', { agentId: target.id })
                      } else {
                        confirmDelete(target.kind, target.id)
                      }
                    }}
                  />
                </GroupCard>
              )}
            </ScrollView>
          </ModalSurface>
        </Modal>
      )}

      {/* Bot / Room 详情 Sheet (GroupCard / GroupRow 风格 + v0.2.7 run-stats & room goal) */}
      {detailsOpen && (detailBot || detailRoom) && (
        <Modal
          transparent
          visible
          animationType="slide"
          onRequestClose={() => setDetailsOpen(false)}
          statusBarTranslucent
        >
          <ModalSurface onClose={() => setDetailsOpen(false)}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderTitleWrap}>
                {detailBot ? <BotAvatar bot={detailBot} size={44} /> : <Users size={32} color={colors.primary} />}
                <View style={styles.grow}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.sheetTitle}>{detailBot?.name ?? detailRoom?.name}</Text>
                    {detailBot && (
                      <BotAgentBadge
                        engine={detailBot.engine ?? engineOfModel(detailBot.model || detailBot.appliedModel)}
                        size={16}
                      />
                    )}
                  </View>
                  {Boolean(detailBot?.role ?? detailRoom?.notice) && (
                    <Text numberOfLines={2} style={styles.sheetSubtitle}>
                      {detailBot?.role ?? detailRoom?.notice}
                    </Text>
                  )}
                </View>
              </View>
              <IconButton label={s.common.close} icon={X} onPress={() => setDetailsOpen(false)} />
            </View>
            <ScrollView style={{ maxHeight: sheetMaxHeight }} contentContainerStyle={styles.sheetBody}>
              {visibleError && <Text style={styles.errorText}>{visibleError}</Text>}

              {/* v0.2.7 Run Stats (tokenUsage) */}
              {detailBot && runStats && isNonEmptyObject(object(runStats.tokenUsage)) && (
                <GroupCard>
                  <View style={styles.statsBlock}>
                    <Text style={styles.statsHeading}>{s.bots.usage}</Text>
                    <Text style={styles.statsBody}>
                      {s.bots.inputTokens}: {Number(object(runStats.tokenUsage).inputTokens ?? 0).toLocaleString()} · {s.bots.outputTokens}: {Number(object(runStats.tokenUsage).outputTokens ?? 0).toLocaleString()}
                    </Text>
                  </View>
                </GroupCard>
              )}

              {/* v0.2.7 Room Goal 控制 */}
              {detailRoom?.goal && isNonEmptyObject(detailRoom.goal) && (
                <GroupCard>
                  <View style={styles.statsBlock}>
                    <Text style={styles.statsHeading}>
                      {s.sessionActivity.goal}: {text(detailRoom.goal.title) || text(detailRoom.goal.status)}
                    </Text>
                    <View style={styles.goalButtonsRow}>
                      {text(detailRoom.goal.status) === 'running' ? (
                        <Button
                          variant="secondary"
                          icon={Pause}
                          label={s.automation.pauseTask}
                          disabled={busy || Boolean(state?.readOnly)}
                          onPress={() => void perform('goal-control', { roomId: detailRoom.id, action: 'pause' })}
                        />
                      ) : text(detailRoom.goal.status) === 'paused' ? (
                        <Button
                          variant="secondary"
                          icon={Play}
                          label={s.automation.resumeTask}
                          disabled={busy || Boolean(state?.readOnly)}
                          onPress={() => void perform('goal-control', { roomId: detailRoom.id, action: 'resume' })}
                        />
                      ) : null}
                      <Button
                        variant="secondary"
                        icon={Square}
                        label={s.bots.stop}
                        disabled={busy || Boolean(state?.readOnly)}
                        onPress={() => void perform('goal-control', { roomId: detailRoom.id, action: 'stop' })}
                      />
                    </View>
                  </View>
                </GroupCard>
              )}

              <GroupCard>
                <GroupRow
                  first
                  icon={Pencil}
                  label={s.bots.edit}
                  disabled={busy || Boolean(state?.readOnly)}
                  onPress={() => {
                    setDetailsOpen(false)
                    setEditor({ kind: detailBot ? 'bot' : 'room', id: selectedId })
                  }}
                />
                {detailBot && !detailBot.tile && (
                  <GroupRow
                    icon={Pin}
                    label={detailBot.pinned ? s.sessions.unpinSession : s.sessions.pinSession}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => void perform('set-flags', { id: detailBot.id, pinned: !detailBot.pinned })}
                  />
                )}
                {detailRoom && (
                  <GroupRow
                    icon={Pin}
                    label={detailRoom.pinned ? s.sessions.unpinSession : s.sessions.pinSession}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => void perform('set-flags', { id: detailRoom.id, pinned: !detailRoom.pinned })}
                  />
                )}
                {detailBot && (!detailBot.main || mainCount > 1) && (
                  <GroupRow
                    icon={Star}
                    label={detailBot.main ? s.bots.removeMain : s.bots.makeMain}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => void perform('set-main', { id: detailBot.id, main: !detailBot.main })}
                  />
                )}
                {detailBot && (
                  <GroupRow
                    icon={Copy}
                    label={s.bots.duplicate}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => void perform('duplicate-bot', { id: detailBot.id })}
                  />
                )}
              </GroupCard>

              {detailBot && (
                <>
                  <View style={styles.sidebarSectionHeader}>
                    <Text style={styles.sidebarSectionTitle}>{s.bots.sessions}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={s.bots.newSession}
                      disabled={busy || Boolean(state?.readOnly)}
                      onPress={() => void perform('bot-new-part', { botId: detailBot.id })}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.sectionActionBtn,
                        (busy || Boolean(state?.readOnly)) && styles.disabled,
                        pressed && styles.pressedFade,
                      ]}
                    >
                      <CirclePlus size={15} color={colors.primary} strokeWidth={2} />
                      <Text style={styles.sectionActionText}>{s.bots.newSession}</Text>
                    </Pressable>
                  </View>
                  <GroupCard>
                    {[
                      detailBot.sessionId,
                      ...(detailBot.parts ?? []).filter(id => id !== detailBot.sessionId).slice().reverse(),
                    ].map((partId, index, list) => {
                      const current = index === 0
                      const matched = appSessions.find(item => item.sessionId === partId)
                      const label =
                        matched?.title && matched.title.trim() !== ''
                          ? matched.title
                          : s.bots.sessionNumber(list.length - index)
                      return (
                        <GroupRow
                          key={partId}
                          first={index === 0}
                          label={label}
                          detail={current ? s.bots.currentSession : s.bots.openEarlierSession}
                          selected={current}
                          chevron={!current}
                          disabled={current || busy || Boolean(state?.readOnly)}
                          onPress={
                            current
                              ? undefined
                              : () => void perform('bot-open-part', { botId: detailBot.id, sessionId: partId })
                          }
                        />
                      )
                    })}
                  </GroupCard>
                </>
              )}

              {detailRoom && detailRoom.members.length > 0 && (
                <>
                  <SectionTitle>{s.bots.members}</SectionTitle>
                  <GroupCard>
                    {detailRoom.members.map((memberId, index) => {
                      const memberBot = state?.bots.find(entry => entry.id === memberId)
                      return (
                        <GroupRow
                          key={memberId}
                          first={index === 0}
                          label={memberBot?.name ?? memberId}
                          detail={memberBot?.role || undefined}
                          chevron={false}
                          accessory={
                            <IconButton
                              dense
                              label={s.bots.stop}
                              icon={Square}
                              disabled={busy || Boolean(state?.readOnly)}
                              onPress={() => void perform('stop-member-work', { roomId: detailRoom.id, botId: memberId })}
                            />
                          }
                        />
                      )
                    })}
                  </GroupCard>
                </>
              )}

              {((detailBot && !detailBot.main) || detailRoom) && (
                <GroupCard>
                  <GroupRow
                    first
                    icon={Trash2}
                    label={s.bots.delete}
                    danger
                    chevron={false}
                    disabled={busy || Boolean(state?.readOnly)}
                    onPress={() => {
                      if (selectedId) confirmDelete(detailBot ? 'bot' : 'room', selectedId)
                    }}
                  />
                </GroupCard>
              )}

              <Text style={styles.detailHint}>{s.bots.hostSettings}</Text>
            </ScrollView>
          </ModalSurface>
        </Modal>
      )}

      {/* 用量与定时任务报表 Sheet */}
      {report !== undefined && (
        <Modal
          transparent
          visible
          animationType="slide"
          onRequestClose={() => setReport(undefined)}
          statusBarTranslucent
        >
          <ModalSurface onClose={() => setReport(undefined)}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, styles.grow]}>{report.title}</Text>
              <IconButton label={s.common.close} icon={X} onPress={() => setReport(undefined)} />
            </View>
            <ScrollView style={{ maxHeight: sheetMaxHeight }} contentContainerStyle={styles.sheetBody}>
              <BotReportView kind={report.kind} state={state} value={report.value} />
            </ScrollView>
          </ModalSurface>
        </Modal>
      )}
    </>
  )
}

function BotReportView({ value, kind, state }: { value: unknown; kind: 'usage' | 'schedules'; state?: BotState }) {
  const styles = useThemedStyles(createStyles)
  const data = object(value)
  if (kind === 'schedules') {
    const tasks = objects(data.tasks)
    if (tasks.length === 0) return <Text style={styles.emptyCardText}>{s.bots.none}</Text>
    return (
      <GroupCard>
        {tasks.map((task, i) => {
          const ownerName = state?.bots.find(bot => bot.id === task.botId)?.name
            ?? state?.rooms.find(room => room.id === task.roomId)?.name
          const timeText = [text(task.scheduledAt) || text(task.time), text(task.timeZone), text(task.status) || text(task.state)].filter(Boolean).join(' · ')
          return (
            <View key={i} style={[styles.reportRow, i > 0 && styles.rowDivider]}>
              <Text style={styles.statsHeading}>{text(task.title) || s.bots.schedules}</Text>
              {Boolean(ownerName) && <Text style={styles.sheetSubtitle}>{ownerName}</Text>}
              {Boolean(text(task.prompt)) && <Text style={styles.statsBody}>{text(task.prompt)}</Text>}
              {Boolean(timeText) && <Text style={styles.sheetSubtitle}>{timeText}</Text>}
            </View>
          )
        })}
      </GroupCard>
    )
  }
  const rows = Array.isArray(data.rows) ? data.rows.filter(Array.isArray) : []
  const owners = objects(data.owners)
  if (rows.length === 0 || owners.length === 0) return <Text style={styles.emptyCardText}>{s.bots.none}</Text>
  return (
    <GroupCard>
      {owners.map((owner, index) => {
        const own = rows.filter(row => row[1] === index)
        const sum = (column: number) => own.reduce((total, row) => total + (typeof row[column] === 'number' ? row[column] : 0), 0)
        return (
          <View key={index} style={[styles.reportRow, index > 0 && styles.rowDivider]}>
            <Text style={styles.statsHeading}>{text(owner.name) || s.bots.title}</Text>
            <Text style={styles.statsBody}>
              {s.bots.inputTokens}: {sum(4).toLocaleString()} · {s.bots.outputTokens}: {sum(7).toLocaleString()}
            </Text>
            <Text style={styles.sheetSubtitle}>
              {s.bots.calls}: {sum(8).toLocaleString()}
            </Text>
          </View>
        )
      })}
    </GroupCard>
  )
}

function isNonEmptyObject(value: BotObject): boolean {
  return Object.keys(value).length > 0
}

export function DsBotInstallCard({ error, onRetry }: { error?: string; onRetry: () => void }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const rows = [
    { label: s.plugins.installDesktop, value: 'ds-bot' },
    { label: s.plugins.installCli, value: 'dsh plugin --profile web add -w ds-bot' },
    { label: 'GitHub 源码地址（无法连接 npm 时填入）', value: 'github:Fei2411/DS-Bot&path:/ds-bot' },
  ]
  return (
    <View style={styles.sectionBlock}>
      <GroupCard>
        <View style={styles.installCardBody}>
          <View style={styles.installHeaderRow}>
            <View style={styles.installIconBadge}>
              <Download size={18} color={colors.primary} />
            </View>
            <View style={styles.grow}>
              <Text style={styles.installTitle}>{s.plugins.installTitle}</Text>
              <Text style={styles.installStatusText}>{error ?? s.bots.notInstalled}</Text>
            </View>
          </View>
          <Text style={styles.installDescription}>{s.plugins.installHint}</Text>
          <View style={styles.installCopyList}>
            {rows.map(row => (
              <DsBotInstallCopyRow key={row.value} label={row.label} value={row.value} />
            ))}
          </View>
        </View>
        <GroupRow
          icon={RefreshCw}
          label={s.bots.retry}
          detail={s.plugins.installOnDesktop}
          onPress={onRetry}
        />
      </GroupCard>
    </View>
  )
}

function DsBotInstallCopyRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <View style={styles.installCopyRow}>
      <Text style={styles.installCopyLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${s.plugins.copy}: ${value}`}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => undefined)
          void Clipboard.setStringAsync(value).then(() => setCopied(true)).catch(() => undefined)
        }}
        style={({ pressed }) => [styles.installCodeBox, pressed && styles.rowPressed]}
      >
        <Text style={styles.installCodeText} selectable>{value}</Text>
        <View style={styles.installCopyAction}>
          {copied ? <Check size={15} color={colors.success} /> : <Copy size={15} color={colors.primary} />}
          {!copied && <Text style={styles.installCopyActionText}>{s.plugins.copy}</Text>}
        </View>
      </Pressable>
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xxl,
      gap: spacing.sm,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.md,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    searchInput: { flex: 1, ...type.body, fontSize: 15, color: colors.ink, paddingVertical: 0 },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: colors.dangerSoft,
    },
    errorText: { ...type.small, color: colors.danger, flex: 1 },
    retryPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
    },
    retryPillText: { ...type.caption, color: colors.primary, fontWeight: '600' },
    readOnlyBadge: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceStrong,
    },
    readOnlyText: { ...type.caption, color: colors.muted },
    loadingWrap: { paddingVertical: spacing.xxl, alignItems: 'center' },
    emptyWrap: { paddingVertical: spacing.lg },
    sectionBlock: { gap: 4, marginTop: 4 },
    sidebarSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      paddingTop: spacing.xs,
      paddingBottom: 2,
    },
    sidebarSectionTitle: {
      ...type.smallStrong,
      fontSize: 13,
      color: colors.muted,
    },
    sectionActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 2,
      paddingHorizontal: 6,
      borderRadius: radius.pill,
    },
    sectionActionText: { ...type.caption, color: colors.primary, fontWeight: '600' },
    botRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      minHeight: 58,
    },
    mainBotRow: {
      minHeight: 68,
      paddingVertical: 12,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    rowSelected: {
      backgroundColor: colors.primarySoft,
    },
    rowPressed: {
      backgroundColor: colors.surfaceStrong,
    },
    pressedFade: { opacity: 0.7 },
    disabled: { opacity: 0.45 },
    avatarWrap: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarStatusDot: {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: 11,
      height: 11,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    avatarStatusDotSmall: {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: 9,
      height: 9,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    groupAvatar: {
      width: 38,
      height: 34,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    rowTitleLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
    },
    mainBotName: {
      ...type.bodyStrong,
      fontSize: 16,
      color: colors.ink,
      flexShrink: 1,
    },
    rowName: {
      ...type.bodyStrong,
      fontSize: 15,
      color: colors.ink,
      flexShrink: 1,
    },
    rowNameSelected: {
      color: colors.primary,
    },
    roleChip: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      maxWidth: 96,
    },
    roleChipText: {
      ...type.caption,
      fontSize: 11,
      color: colors.muted,
    },
    rowSubtitle: {
      ...type.caption,
      fontSize: 12.5,
      lineHeight: 17,
      color: colors.muted,
    },
    rowSubtitleActive: {
      color: colors.primary,
      fontWeight: '500',
    },
    rowSubtitleWarning: {
      color: colors.warning,
      fontWeight: '500',
    },
    moreBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    emptyCardBlock: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
    },
    emptyCardText: {
      ...type.small,
      color: colors.muted,
      textAlign: 'center',
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingBottom: spacing.xs,
    },
    sheetHeaderTitleWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minWidth: 0,
    },
    sheetTitle: {
      ...type.heading,
      fontSize: 18,
      fontWeight: '700',
      color: colors.ink,
    },
    sheetSubtitle: {
      ...type.small,
      color: colors.muted,
      marginTop: 2,
    },
    sheetBody: {
      gap: spacing.md,
      paddingBottom: spacing.lg,
    },
    grow: { flex: 1, minWidth: 0 },
    statsBlock: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: 4,
    },
    statsHeading: {
      ...type.bodyStrong,
      color: colors.ink,
    },
    statsBody: {
      ...type.small,
      color: colors.ink,
    },
    goalButtonsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    reportRow: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: 4,
    },
    detailHint: {
      ...type.caption,
      color: colors.muted,
      paddingHorizontal: spacing.xs,
    },
    installCardBody: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },
    installHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    installIconBadge: {
      width: 36,
      height: 36,
      borderRadius: radius.lg,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    installTitle: {
      ...type.bodyStrong,
      fontSize: 15,
      color: colors.ink,
    },
    installStatusText: {
      ...type.caption,
      color: colors.muted,
      marginTop: 1,
    },
    installDescription: {
      ...type.small,
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
    },
    installCopyList: {
      gap: spacing.xs,
      marginTop: 2,
    },
    installCopyRow: {
      gap: 4,
    },
    installCopyLabel: {
      ...type.caption,
      fontSize: 12,
      color: colors.muted,
    },
    installCodeBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    installCodeText: {
      flex: 1,
      ...type.small,
      fontSize: 12.5,
      color: colors.ink,
    },
    installCopyAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },
    installCopyActionText: {
      ...type.caption,
      fontSize: 12,
      color: colors.primary,
      fontWeight: '600',
    },
  })
}
