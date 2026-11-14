import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import {
  AlignLeft,
  ArrowLeftRight,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  CopyPlus,
  Download,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react-native'
import { strings as s } from '../locales/i18n'
import { browseScope } from '../services/browse-memory'
import {
  canDeleteBot,
  object,
  objects,
  text,
  type BotEntry,
  type BotRemoteClient,
  type BotRoom,
  type BotState,
} from '../services/bot-catalog'
import { requireBotClient, useAppStore } from '../state/store'
import { useBotTeamStore } from '../state/bot-store'
import { Button, EmptyState, GroupCard, GroupRow, IconButton } from '../ui/components'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useResponsiveLayout } from '../ui/responsive'
import { useThemedStyles } from '../ui/use-themed-styles'
import { ModalSurface } from './chat/modal'
import { ConfirmDialog } from './chat/confirm-dialog'
import { resolveSessionDisplayTitle } from './session-title'
import { BotAgentBadge, engineOfModel } from './bot/agent-badge'
import { BotAvatar, BotAvatarWithBadge } from './bot/avatar'
import { BotEditor, type BotPerform } from './bot/editor'
import { BotFloatingPopover, type BotPopoverAction } from './bot/popover-menu'
import { BotProfilePage } from './bot/profile-page'

/** Load once on entry or reconnection; roster refreshes are otherwise explicit. */
export function useBotTeamLoad(enabled: boolean): void {
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const botScope = useAppStore(browseScope)
  const ensureScope = useBotTeamStore(state => state.ensureScope)
  const refresh = useBotTeamStore(state => state.refresh)

  useEffect(() => {
    ensureScope(botScope)
  }, [botScope, ensureScope])

  useEffect(() => {
    if (!enabled || !connected) return
    const controller = new AbortController()
    void refresh(false, controller.signal)
    return () => controller.abort()
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

function formatBotListTimestamp(updatedAt?: number): string {
  if (!updatedAt || !Number.isFinite(updatedAt) || updatedAt <= 0) return ''
  const date = new Date(updatedAt)
  const now = new Date()
  if (
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  ) {
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(s.time.locale, { month: 'short', day: 'numeric' })
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

type RosterFilter = 'all' | 'bots' | 'rooms' | 'agents'

export function BotSidebarSection({
  refreshing = false,
  onRefresh,
  searchQuery,
  onSearchChange,
  onSelectBot,
}: {
  refreshing?: boolean
  onRefresh?: () => void
  searchQuery: string
  onSearchChange: (q: string) => void
  showSearch?: boolean
  onSelectBot: (id: string) => void
}) {
  const { colors, scheme } = useTheme()
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

  const [filter, setFilter] = useState<RosterFilter>('all')
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)

  const query = searchQuery.trim().toLocaleLowerCase()
  const visibleError = actionError ?? error

  const sessionMap = useMemo(() => {
    const map = new Map<string, (typeof sessions)[number]>()
    for (const item of sessions) map.set(item.sessionId, item)
    return map
  }, [sessions])

  const visibleBots = useMemo(() => {
    return (state?.bots ?? [])
      .filter(entry => !(entry.hidden && entry.id !== selectedId && !entry.main))
      .filter(entry => !query || `${entry.name} ${entry.role} ${entry.preview ?? ''}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => {
        if (Boolean(a.main) !== Boolean(b.main)) return Number(Boolean(b.main)) - Number(Boolean(a.main))
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
        const ta = sessionMap.get(a.sessionId)?.updatedAt ?? 0
        const tb = sessionMap.get(b.sessionId)?.updatedAt ?? 0
        return tb - ta
      })
  }, [state?.bots, selectedId, query, sessionMap])

  const visibleRooms = useMemo(() => {
    return [...(state?.rooms ?? [])]
      .filter(entry => !(entry.hidden && entry.id !== selectedId))
      .filter(entry => !query || `${entry.name} ${entry.preview ?? ''}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
        const ta = sessionMap.get(a.sessionId || a.id)?.updatedAt ?? 0
        const tb = sessionMap.get(b.sessionId || b.id)?.updatedAt ?? 0
        return tb - ta
      })
  }, [state?.rooms, selectedId, query, sessionMap])

  const agents = state?.agents ?? []

  const filterLabel =
    filter === 'bots'
      ? s.bots.all
      : filter === 'rooms'
        ? s.bots.groups
        : filter === 'agents'
          ? 'DSH Agent'
          : s.bots.filterAll

  const filterActions: BotPopoverAction[] = [
    {
      key: 'all',
      icon: Bot,
      label: s.bots.filterAll,
      selected: filter === 'all',
      onPress: () => setFilter('all'),
    },
    {
      key: 'bots',
      icon: Bot,
      label: `${s.bots.all} (${state?.bots.length ?? 0})`,
      selected: filter === 'bots',
      onPress: () => setFilter('bots'),
    },
    {
      key: 'rooms',
      icon: Users,
      label: `${s.bots.groups} (${state?.rooms.length ?? 0})`,
      selected: filter === 'rooms',
      onPress: () => setFilter('rooms'),
    },
    ...(agents.length > 0
      ? [
          {
            key: 'agents',
            icon: Sparkles,
            label: 'DSH Agent',
            selected: filter === 'agents',
            onPress: () => setFilter('agents'),
          },
        ]
      : []),
  ]

  const createActions: BotPopoverAction[] = [
    {
      key: 'new-bot',
      icon: Plus,
      label: s.bots.newBot,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => setEditor({ kind: 'bot' }),
    },
    {
      key: 'new-room',
      icon: Users,
      label: s.bots.newGroup,
      disabled: busy || Boolean(state?.readOnly) || (state?.bots.length ?? 0) < 2,
      onPress: () => setEditor({ kind: 'room' }),
    },
    {
      key: 'new-agent',
      icon: Sparkles,
      label: agents.length > 0 ? `DSH Agent · ${s.sessions.newSession}` : 'DSH Agent',
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => {
        if (agents[0]) void perform('agent-session', { agentId: agents[0].id })
        else void perform('add-agent')
      },
    },
  ]

  const surfaceBg = scheme === 'light' ? '#FFFFFF' : colors.surface
  const filterPillBg = scheme === 'light' ? '#F2F2F7' : colors.grouped

  const showBots = filter === 'all' || filter === 'bots'
  const showRooms = filter === 'all' || filter === 'rooms'
  const showAgents = filter === 'all' || filter === 'agents'

  return (
    <View style={styles.container}>
      {state !== undefined && (
        <View style={styles.topActionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={filterLabel}
            onPress={() => setFilterMenuOpen(true)}
            style={({ pressed }) => [
              styles.filterPill,
              { backgroundColor: filterPillBg },
              pressed && styles.pressedFade,
            ]}
          >
            <Text style={styles.filterPillText}>{filterLabel}</Text>
            <ChevronDown size={14} color={colors.muted} strokeWidth={2.1} />
          </Pressable>

          <View style={[styles.topSearchCapsule, { backgroundColor: filterPillBg }]}>
            <Search size={15} color={colors.muted} strokeWidth={2} />
            <TextInput
              value={searchQuery}
              onChangeText={onSearchChange}
              placeholder={s.bots.search}
              placeholderTextColor={colors.muted}
              style={styles.topSearchInput}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.common.close}
                hitSlop={8}
                onPress={() => onSearchChange('')}
              >
                <X size={14} color={colors.muted} />
              </Pressable>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.bots.add}
            disabled={busy || Boolean(state.readOnly)}
            onPress={() => setCreateMenuOpen(true)}
            style={({ pressed }) => [
              styles.plusCircleBtn,
              { backgroundColor: surfaceBg },
              pressed && styles.pressedFade,
              (busy || Boolean(state.readOnly)) && styles.disabled,
            ]}
          >
            <Plus size={19} color={colors.ink} strokeWidth={2.1} />
          </Pressable>
        </View>
      )}

      <ScrollView
        alwaysBounceVertical
        refreshControl={onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        ) : undefined}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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

        {loading && state === undefined && visibleError === undefined && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {state === undefined && (!loading || visibleError !== undefined) && (
          <DsBotInstallCard error={visibleError} loading={loading} onRetry={() => void refresh(true)} />
        )}

        {state !== undefined && state.bots.length === 0 && state.rooms.length === 0 && (
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

        {state !== undefined && showBots && visibleBots.map(entry => {
          const isSelected = selectedId === entry.id
          const live = botLiveStatus(state, entry)
          const pendingQ = object(state.questions[entry.sessionId])
          const pendingQText = text(pendingQ.question) || text(pendingQ.header)
          const hasSnippetIcon = Boolean(pendingQText || entry.preview)
          const subtitle = pendingQText
            || (live.kind !== 'idle' ? live.label : (entry.preview || entry.role || s.bots.idle))
          const dotColor = live.kind === 'waiting'
            ? colors.warning
            : live.kind === 'working' || live.kind === 'away'
              ? colors.success
              : undefined
          const timeStr = formatBotListTimestamp(sessionMap.get(entry.sessionId)?.updatedAt)

          return (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={entry.main ? `${entry.name}, ${s.bots.main}` : entry.name}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelectBot(entry.id)}
              onLongPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                setContextMenu({ kind: 'bot', id: entry.id })
              }}
              style={({ pressed }) => [
                styles.inboxRow,
                isSelected && styles.rowSelected,
                pressed && styles.rowPressed,
              ]}
            >
              <BotAvatarWithBadge
                bot={entry}
                size={50}
                showMainStar
                statusColor={dotColor}
                badgeBorderColor={colors.surface}
              />

              <View style={styles.rowBody}>
                <View style={styles.rowTopLine}>
                  <View style={styles.rowTitleLeft}>
                    <Text numberOfLines={1} style={[styles.inboxTitle, isSelected && styles.rowNameSelected]}>
                      {entry.name}
                    </Text>
                    <BotAgentBadge engine={entry.engine ?? engineOfModel(entry.model || entry.appliedModel)} size={14} />
                    {entry.pinned && <OfficialMenuIcons.pinFill size={11} color={colors.muted} />}
                  </View>
                  {Boolean(timeStr) && <Text style={styles.inboxDate}>{timeStr}</Text>}
                </View>

                <View style={styles.rowSnippetLine}>
                  {hasSnippetIcon && (
                    <AlignLeft size={13} color={colors.muted} strokeWidth={1.8} style={styles.snippetIcon} />
                  )}
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.inboxSubtitle,
                      !pendingQText && (live.kind === 'working' || live.kind === 'away') && styles.rowSubtitleActive,
                      !pendingQText && live.kind === 'waiting' && styles.rowSubtitleWarning,
                    ]}
                  >
                    {subtitle}
                  </Text>
                </View>
              </View>
            </Pressable>
          )
        })}

        {state !== undefined && showRooms && visibleRooms.map(entry => {
          const isSelected = selectedId === entry.id
          const live = roomLiveStatus(state, entry)
          const timeStr = formatBotListTimestamp(sessionMap.get(entry.sessionId || entry.id)?.updatedAt)

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
                styles.inboxRow,
                isSelected && styles.rowSelected,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={[styles.groupAvatarBox, { backgroundColor: filterPillBg }]}>
                {entry.members.slice(0, 3).map((id, idx) => {
                  const member = state.bots.find(b => b.id === id)
                  return member ? (
                    <View key={id} style={{ position: 'absolute', left: 5 + idx * 8, top: 7 + (idx % 2) * 11 }}>
                      <BotAvatar bot={member} size={24} />
                    </View>
                  ) : null
                })}
                {entry.members.length === 0 && <Users color={colors.muted} size={22} />}
              </View>

              <View style={styles.rowBody}>
                <View style={styles.rowTopLine}>
                  <View style={styles.rowTitleLeft}>
                    <Text numberOfLines={1} style={[styles.inboxTitle, isSelected && styles.rowNameSelected]}>
                      {entry.name}
                    </Text>
                    {entry.pinned && <OfficialMenuIcons.pinFill size={11} color={colors.muted} />}
                  </View>
                  {Boolean(timeStr) && <Text style={styles.inboxDate}>{timeStr}</Text>}
                </View>

                <View style={styles.rowSnippetLine}>
                  <Users size={13} color={colors.muted} strokeWidth={1.8} style={styles.snippetIcon} />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.inboxSubtitle,
                      live.working && styles.rowSubtitleActive,
                      live.waiting && styles.rowSubtitleWarning,
                    ]}
                  >
                    {live.label}
                  </Text>
                </View>
              </View>
            </Pressable>
          )
        })}

        {state !== undefined && showAgents && agents.map(agent =>
          agent.sessions
            .filter(sid => {
              if (!query) return true
              const matched = sessionMap.get(sid)
              const title = (matched ? resolveSessionDisplayTitle(matched) : undefined) ?? s.sessions.untitled
              return title.toLocaleLowerCase().includes(query)
            })
            .slice(0, 8)
            .map(sid => {
              const matched = sessionMap.get(sid)
              const title = (matched ? resolveSessionDisplayTitle(matched) : undefined) ?? s.sessions.untitled
              const isSelected = selectedId === sid
              const timeStr = formatBotListTimestamp(matched?.updatedAt)
              return (
                <Pressable
                  key={sid}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => onSelectBot(sid)}
                  onLongPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
                    setContextMenu({ kind: 'agent', id: agent.id })
                  }}
                  style={({ pressed }) => [
                    styles.inboxRow,
                    isSelected && styles.rowSelected,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={[styles.groupAvatarBox, { backgroundColor: filterPillBg }]}>
                    <Sparkles size={22} color={colors.primary} />
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.rowTopLine}>
                      <Text numberOfLines={1} style={[styles.inboxTitle, isSelected && styles.rowNameSelected]}>
                        {title}
                      </Text>
                      {Boolean(timeStr) && <Text style={styles.inboxDate}>{timeStr}</Text>}
                    </View>
                    <Text numberOfLines={1} style={styles.inboxSubtitle}>
                      DSH Agent
                    </Text>
                  </View>
                </Pressable>
              )
            }),
        )}
      </ScrollView>

      <BotFloatingPopover
        visible={filterMenuOpen}
        actions={filterActions}
        onClose={() => setFilterMenuOpen(false)}
        anchor="top-left"
        topOffset={104}
      />
      <BotFloatingPopover
        visible={createMenuOpen}
        actions={createActions}
        onClose={() => setCreateMenuOpen(false)}
        anchor="top-right"
        topOffset={104}
      />
    </View>
  )
}

/** Shared modals for DS-Bot (Editor, Context Menu, Full-Screen Profile Page, Usage/Schedules Report). */
export function BotModalsHost() {
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

  const [deleteConfirm, setDeleteConfirm] = useState<{ kind: 'bot' | 'room'; id: string } | undefined>()
  const confirmDelete = (kind: 'bot' | 'room', id: string) => setDeleteConfirm({ kind, id })

  const menuBot = contextMenu?.kind === 'bot' ? state?.bots.find(b => b.id === contextMenu.id) : undefined
  const menuRoom = contextMenu?.kind === 'room' ? state?.rooms.find(r => r.id === contextMenu.id) : undefined
  const menuAgent = contextMenu?.kind === 'agent' ? state?.agents.find(a => a.id === contextMenu.id) : undefined
  const mainCount = state?.bots.filter(b => b.main).length ?? 0

  const contextActions: BotPopoverAction[] = []
  if (menuBot && !menuBot.tile) {
    contextActions.push({
      key: 'pin',
      icon: Pin,
      label: menuBot.pinned ? s.sessions.unpinSession : s.sessions.pinSession,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => void perform('set-flags', { id: menuBot.id, pinned: !menuBot.pinned }),
    })
  }
  if (menuRoom) {
    contextActions.push({
      key: 'pin',
      icon: Pin,
      label: menuRoom.pinned ? s.sessions.unpinSession : s.sessions.pinSession,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => void perform('set-flags', { id: menuRoom.id, pinned: !menuRoom.pinned }),
    })
  }
  if (menuBot || menuRoom) {
    contextActions.push({
      key: 'edit',
      icon: Pencil,
      label: s.bots.edit,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () =>
        setEditor({
          kind: contextMenu?.kind === 'bot' ? 'bot' : 'room',
          id: contextMenu?.id,
        }),
    })
  }
  if (menuBot && (!menuBot.main || mainCount > 1)) {
    contextActions.push({
      key: 'main',
      icon: ArrowLeftRight,
      label: menuBot.main ? s.bots.removeMain : s.bots.replaceMain,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => void perform('set-main', { id: menuBot.id, main: !menuBot.main }),
    })
  }
  if (menuBot) {
    contextActions.push({
      key: 'duplicate',
      icon: CopyPlus,
      label: s.bots.duplicate,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => void perform('duplicate-bot', { id: menuBot.id }),
    })
  }
  if (menuRoom) {
    contextActions.push({
      key: 'stop',
      icon: Square,
      label: s.bots.stop,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => void perform('stop-room-work', { roomId: menuRoom.id }),
    })
  }
  if (menuBot || menuRoom) {
    contextActions.push({
      key: 'copy-id',
      icon: Copy,
      label: s.bots.copyId,
      onPress: () => {
        const targetId = menuBot?.id ?? menuRoom?.id ?? ''
        if (targetId) void Clipboard.setStringAsync(targetId)
      },
    })
  }
  if (menuAgent) {
    contextActions.push({
      key: 'new-agent-session',
      icon: Plus,
      label: s.sessions.newSession,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => void perform('agent-session', { agentId: menuAgent.id }),
    })
  }
  if (canDeleteBot(state, menuBot) || menuRoom || menuAgent) {
    contextActions.push({
      key: 'delete',
      icon: Trash2,
      label: s.bots.delete,
      danger: true,
      disabled: busy || Boolean(state?.readOnly),
      onPress: () => {
        if (!contextMenu) return
        if (contextMenu.kind === 'agent') void perform('remove-agent', { agentId: contextMenu.id })
        else confirmDelete(contextMenu.kind, contextMenu.id)
      },
    })
  }

  return (
    <>
      <BotFloatingPopover
        visible={contextMenu !== undefined && contextActions.length > 0}
        actions={contextActions}
        onClose={() => setContextMenu(undefined)}
        anchor="top-right"
        topOffset={120}
      />

      {state !== undefined && (
        <BotProfilePage
          visible={detailsOpen && Boolean(detailBot || detailRoom)}
          covered={editor !== undefined}
          bot={detailBot}
          room={detailRoom}
          state={state}
          client={clientInstance}
          busy={busy}
          error={visibleError}
          runStats={runStats}
          onClose={() => setDetailsOpen(false)}
          onEdit={() => setEditor({ kind: detailBot ? 'bot' : 'room', id: (detailBot ?? detailRoom)?.id ?? selectedId })}
          perform={performAdapter}
        />
      )}

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

      <ConfirmDialog
        visible={deleteConfirm !== undefined}
        title={s.bots.delete}
        message={s.bots.deleteHint}
        onClose={() => setDeleteConfirm(undefined)}
        buttons={[
          { label: s.bots.cancel },
          {
            label: s.bots.delete,
            danger: true,
            onPress: () => {
              if (!deleteConfirm) return
              void perform(deleteConfirm.kind === 'bot' ? 'delete-bot' : 'delete-room', { id: deleteConfirm.id })
            },
          },
        ]}
      />
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

export function DsBotInstallCard({ error, loading = false, onRetry }: { error?: string; loading?: boolean; onRetry: () => void }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const rows = [
    { label: s.plugins.installDesktop, value: 'ds-bot' },
    { label: s.plugins.installCli, value: 'dsh plugin --profile web add -w ds-bot' },
    { label: s.plugins.installGithub, value: 'github:Fei2411/DS-Bot#main&path:/ds-bot' },
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
          disabled={loading}
          accessory={loading ? <ActivityIndicator size="small" color={colors.primary} /> : undefined}
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
    container: {
      flex: 1,
    },
    topActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 6,
    },
    filterPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 38,
      paddingHorizontal: 13,
      borderRadius: 19,
      flexShrink: 0,
    },
    filterPillText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.muted,
    },
    topSearchCapsule: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 38,
      paddingHorizontal: 12,
      borderRadius: 19,
      minWidth: 0,
    },
    topSearchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.ink,
      paddingVertical: 0,
      minWidth: 0,
    },
    plusCircleBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 10,
      paddingTop: 4,
      paddingBottom: 16,
      gap: 2,
    },
    inboxRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 10,
      paddingVertical: 11,
      minHeight: 72,
      borderRadius: 18,
    },
    rowSelected: {
      backgroundColor: colors.primarySoft,
    },
    rowPressed: {
      backgroundColor: colors.grouped,
    },
    groupAvatarBox: {
      width: 50,
      height: 50,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    rowTopLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8,
    },
    rowTitleLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
    },
    inboxTitle: {
      fontSize: 16.5,
      fontWeight: '600',
      color: colors.ink,
      flexShrink: 1,
    },
    rowNameSelected: {
      color: colors.primary,
    },
    inboxDate: {
      fontSize: 13,
      color: colors.muted,
      flexShrink: 0,
    },
    rowSnippetLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      minWidth: 0,
    },
    snippetIcon: {
      flexShrink: 0,
    },
    inboxSubtitle: {
      flex: 1,
      fontSize: 14,
      lineHeight: 19,
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
    bottomDock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 10,
    },
    dockGridBtn: {
      width: 44,
      height: 44,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    dockSearchCapsule: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    dockSearchInput: {
      flex: 1,
      fontSize: 15.5,
      color: colors.ink,
      paddingVertical: 0,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
      marginHorizontal: 6,
      marginBottom: 4,
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
      marginHorizontal: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceStrong,
    },
    readOnlyText: { ...type.caption, color: colors.muted },
    loadingWrap: { paddingVertical: spacing.xxl, alignItems: 'center' },
    emptyWrap: { paddingVertical: spacing.lg, paddingHorizontal: 8 },
    sectionBlock: { gap: 4, marginTop: 4, paddingHorizontal: 6 },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    pressedFade: { opacity: 0.72 },
    disabled: { opacity: 0.45 },
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
    statsHeading: {
      ...type.bodyStrong,
      color: colors.ink,
    },
    statsBody: {
      ...type.small,
      color: colors.ink,
    },
    reportRow: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: 4,
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
