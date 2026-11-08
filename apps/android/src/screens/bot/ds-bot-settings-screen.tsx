import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  Bot,
  CalendarClock,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Folder,
  Globe,
  KeyRound,
  MessageSquareShare,
  Monitor,
  Plug,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Users,
  X,
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
  type BotRemoteClient,
  type BotRoom,
} from '../../services/bot-catalog'
import { requireBotClient } from '../../state/store'
import { useBotTeamStore } from '../../state/bot-store'
import { IconButton } from '../../ui/components'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { Toggle } from '../../ui/toggle'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ModalSurface } from '../chat/modal'
import { BotAgentBadge, engineOfModel } from './agent-badge'
import { BotAvatar, BotAvatarWithBadge } from './avatar'
import { BotEditor } from './editor'
import {
  BotBrowserGrantsSection,
  BotFolderPickerModal,
  BotSchedulesPanel,
  folderBasename,
  formatCompactTokens,
} from './shared-panels'

export type DsBotSettingsTab =
  | 'general'
  | 'models'
  | 'local-agents'
  | 'bots'
  | 'groups'
  | 'connectors'
  | 'im'
  | 'capabilities'
  | 'browser'
  | 'computer'
  | 'schedules'
  | 'usage'
  | 'secrets'

interface TabItem {
  id: DsBotSettingsTab
  label: string
  icon: LucideIcon
}

const KNOWN_LOCAL_AGENTS = [
  { id: 'claude', name: 'Claude Code', cmd: 'claude-agent-acp' },
  { id: 'codex', name: 'Codex', cmd: 'codex' },
  { id: 'gemini', name: 'Gemini CLI', cmd: 'gemini' },
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode' },
  { id: 'hermes', name: 'Hermes Agent', cmd: 'hermes' },
  { id: 'cursor', name: 'Cursor Agent', cmd: 'cursor-agent' },
  { id: 'pi', name: 'Pi', cmd: 'pi-acp' },
  { id: 'kimi', name: 'Kimi CLI', cmd: 'kimi' },
  { id: 'qwen', name: 'Qwen Code', cmd: 'qwen' },
]

const FEATURED_CONNECTORS = [
  { id: 'github', name: 'GitHub', category: 'dev', desc: 'Issues, PRs, repositories & actions' },
  { id: 'notion', name: 'Notion', category: 'docs', desc: 'Pages, databases & workspace search' },
  { id: 'linear', name: 'Linear', category: 'work', desc: 'Issues, projects & cycles' },
  { id: 'figma', name: 'Figma', category: 'design', desc: 'Design files, nodes & variables' },
  { id: 'slack', name: 'Slack', category: 'work', desc: 'Channels, messages & threads' },
  { id: 'postgres', name: 'PostgreSQL', category: 'data', desc: 'Schema inspection & read queries' },
  { id: 'brave-search', name: 'Brave Search', category: 'search', desc: 'Web & news search via MCP' },
]

const IM_PLATFORMS = [
  { id: 'weixin', name: '微信', sub: '扫码直接连接个人微信' },
  { id: 'feishu', name: '飞书 / Lark', sub: '长连接接收消息，无需公网地址' },
  { id: 'dingtalk', name: '钉钉', sub: 'Stream 模式接收群与单聊消息' },
  { id: 'wecom', name: '企业微信', sub: '智能机器人长连接模式' },
  { id: 'qq', name: 'QQ', sub: 'QQ 开放平台机器人' },
  { id: 'telegram', name: 'Telegram', sub: 'BotFather Token 接入' },
  { id: 'discord', name: 'Discord', sub: 'Discord Bot 接入频道与私信' },
  { id: 'slack', name: 'Slack', sub: 'Socket Mode 应用接入' },
]

/**
 * Full 13-Tab Global DS-Bot Settings Screen modeled strictly on DS-Bot's `settings.js`:
 * 通用 / 模型 / 本地 Agent / Bot / 群聊 / 连接器 / IM / 能力 / 浏览器 / 电脑操控 / 定时任务 / 用量 / 密钥
 */
export function DsBotSettingsModal({
  visible,
  initialTab = 'general',
  onClose,
}: {
  visible: boolean
  initialTab?: DsBotSettingsTab
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(createStyles)
  const isDark = scheme === 'dark'
  const canvasBg = isDark ? colors.background : '#F6F7F9'
  const cardBg = isDark ? colors.cardOpaque : '#FFFFFF'

  const state = useBotTeamStore(store => store.state)
  const busy = useBotTeamStore(store => store.busy)
  const error = useBotTeamStore(store => store.error)
  const actionError = useBotTeamStore(store => store.actionError)
  const refresh = useBotTeamStore(store => store.refresh)
  const perform = useBotTeamStore(store => store.perform)

  const [tab, setTab] = useState<DsBotSettingsTab>(initialTab)
  const [editorTarget, setEditorTarget] = useState<{ kind: 'bot' | 'room'; bot?: BotEntry; room?: BotRoom } | null>(null)
  const [defaultModelPickerOpen, setDefaultModelPickerOpen] = useState(false)
  const [teamFolderPickerOpen, setTeamFolderPickerOpen] = useState(false)

  // Remote-fetched sub-views
  const [providersData, setProvidersData] = useState<BotObject[] | null>(null)
  const [localAgentsData, setLocalAgentsData] = useState<BotObject | null>(null)
  const [usageData, setUsageData] = useState<BotObject | null>(null)
  const [usageRange, setUsageRange] = useState<'24h' | '7d' | '30d'>('7d')
  const [connectorQuery, setConnectorQuery] = useState('')
  const [connectorCat, setConnectorCat] = useState('all')

  let clientInstance: BotRemoteClient | undefined
  try {
    clientInstance = requireBotClient()
  } catch {
    clientInstance = undefined
  }

  useEffect(() => {
    if (!visible) return
    setTab(initialTab)
    if (!state) void refresh()
  }, [visible, initialTab, state, refresh])

  useEffect(() => {
    if (!visible || !clientInstance) return
    if (tab === 'models') {
      void clientInstance
        .call('providers')
        .then(res => setProvidersData(objects(object(res).providers)))
        .catch(() => setProvidersData([]))
    } else if (tab === 'local-agents') {
      void clientInstance
        .call('local-agents')
        .then(res => setLocalAgentsData(object(res)))
        .catch(() => setLocalAgentsData(null))
    } else if (tab === 'usage') {
      void clientInstance
        .call('usage', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, range: usageRange })
        .then(res => setUsageData(object(res)))
        .catch(() => setUsageData(null))
    }
  }, [visible, tab, usageRange, clientInstance])

  const tabs: TabItem[] = useMemo(
    () => [
      { id: 'general', label: s.bots.tabGeneral, icon: SlidersHorizontal },
      { id: 'models', label: s.bots.tabModels, icon: Cpu },
      { id: 'local-agents', label: s.bots.tabLocalAgents, icon: Terminal },
      { id: 'bots', label: s.bots.tabBots, icon: Bot },
      { id: 'groups', label: s.bots.tabGroups, icon: Users },
      { id: 'connectors', label: s.bots.tabConnectors, icon: Plug },
      { id: 'im', label: s.bots.tabIm, icon: MessageSquareShare },
      { id: 'capabilities', label: s.bots.tabCapabilities, icon: Sparkles },
      { id: 'browser', label: s.bots.tabBrowser, icon: Globe },
      { id: 'computer', label: s.bots.tabComputer, icon: Monitor },
      { id: 'schedules', label: s.bots.tabSchedules, icon: CalendarClock },
      { id: 'usage', label: s.bots.tabUsage, icon: ChartNoAxesColumn },
      { id: 'secrets', label: s.bots.tabSecrets, icon: KeyRound },
    ],
    [],
  )

  const setPref = useCallback(
    async (patch: BotObject) => {
      await perform('set-prefs', patch)
    },
    [perform],
  )

  if (!visible) return null

  const prefs = object(state?.prefs)
  const layout = text(prefs.layout) || 'bubble'
  const showThinking = prefs.showThinking !== false
  const animation = text(prefs.animation) || 'normal'
  const enterToSend = prefs.enterToSend !== false
  const defaultBotModel = text(prefs.defaultBotModel) || state?.defaultModel || ''

  const activeTabItem = tabs.find(t => t.id === tab) ?? tabs[0]!
  const visibleError = actionError ?? error

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: canvasBg }]}>
        {/* Top Bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.common.back}
            onPress={onClose}
            style={[styles.circleBtn, { backgroundColor: cardBg }]}
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
          <Text style={styles.topTitle}>{s.bots.dsBotSettingsTitle}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Horizontal 13-Category Navigation Strip (matches all 13 DS-Bot Settings sections) */}
        <View style={styles.navStripWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.navStripScroll}
          >
            {tabs.map(item => {
              const Icon = item.icon
              const active = item.id === tab
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(item.id)}
                  style={[
                    styles.navChip,
                    { backgroundColor: active ? colors.ink : cardBg },
                  ]}
                >
                  <Icon size={15} color={active ? colors.surface : colors.muted} />
                  <Text
                    style={[
                      styles.navChipText,
                      { color: active ? colors.surface : colors.ink },
                      active && { fontWeight: '600' },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>

        {Boolean(visibleError) && <Text style={styles.errorBanner}>{visibleError}</Text>}

        {!state ? (
          <View style={styles.centerEmpty}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.mutedText}>{s.bots.dsBotSettingsDisconnected}</Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 36 }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.pageTitle}>{activeTabItem.label}</Text>

            {/* 1. 通用 (General) */}
            {tab === 'general' && (
              <View style={{ gap: 16 }}>
                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.rowTitle}>{s.bots.layoutLabel}</Text>
                    <View style={styles.inlinePills}>
                      {([
                        ['bubble', s.bots.layoutBubble],
                        ['flat', s.bots.layoutFlat],
                      ] as const).map(([id, label]) => {
                        const on = layout === id
                        return (
                          <Pressable
                            key={id}
                            onPress={() => void setPref({ layout: id })}
                            style={[styles.smallPill, on && styles.smallPillActive]}
                          >
                            <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>{label}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>

                  <View style={styles.divider} />
                  <View style={styles.rowBetween}>
                    <Text style={styles.rowTitle}>{s.bots.showThinking}</Text>
                    <Toggle
                      value={showThinking}
                      onValueChange={val => void setPref({ showThinking: val })}
                      accessibilityLabel={s.bots.showThinking}
                    />
                  </View>

                  <View style={styles.divider} />
                  <View style={styles.rowBetween}>
                    <Text style={styles.rowTitle}>{s.bots.botAnimation}</Text>
                    <View style={styles.inlinePills}>
                      {([
                        ['quiet', s.bots.animQuiet],
                        ['normal', s.bots.animNormal],
                        ['lively', s.bots.animLively],
                      ] as const).map(([id, label]) => {
                        const on = animation === id
                        return (
                          <Pressable
                            key={id}
                            onPress={() => void setPref({ animation: id })}
                            style={[styles.smallPill, on && styles.smallPillActive]}
                          >
                            <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>{label}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>

                  <View style={styles.divider} />
                  <View style={styles.rowBetween}>
                    <Text style={styles.rowTitle}>{s.bots.enterToSend}</Text>
                    <Toggle
                      value={enterToSend}
                      onValueChange={val => void setPref({ enterToSend: val })}
                      accessibilityLabel={s.bots.enterToSend}
                    />
                  </View>
                </View>

                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>{s.bots.defaultModel}</Text>
                  <Pressable
                    onPress={() => setDefaultModelPickerOpen(true)}
                    style={[styles.groupCard, styles.rowBetween, { backgroundColor: cardBg }]}
                  >
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {defaultBotModel || s.bots.defaultModel}
                    </Text>
                    <ChevronDown size={18} color={colors.muted} />
                  </Pressable>
                </View>

                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>{s.bots.teamWorkspace}</Text>
                  <Pressable
                    onPress={() => setTeamFolderPickerOpen(true)}
                    style={[styles.groupCard, styles.rowBetween, { backgroundColor: cardBg }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        {state.workspaceId ? folderBasename(state.workspaceId) : s.bots.teamWorkspace}
                      </Text>
                      {Boolean(state.workspaceId) && (
                        <Text style={styles.rowSub} numberOfLines={1}>{state.workspaceId}</Text>
                      )}
                    </View>
                    <ChevronDown size={18} color={colors.muted} />
                  </Pressable>
                </View>
              </View>
            )}

            {/* 2. 模型 (Models / ProvidersPage) */}
            {tab === 'models' && (
              <View style={{ gap: 12 }}>
                {(() => {
                  const list =
                    providersData && providersData.length > 0
                      ? providersData
                      : (() => {
                          const map = new Map<string, BotObject[]>()
                          for (const m of state.models) {
                            const p = text(m.provider) || text(m.providerName) || text(m.ref).split('/')[0] || 'default'
                            const arr = map.get(p) ?? []
                            arr.push(m)
                            map.set(p, arr)
                          }
                          return [...map].map(([id, models]) => ({
                            id,
                            name: text(models[0]?.providerName) || id,
                            models,
                            key: { configured: true },
                          }))
                        })()

                  if (list.length === 0) {
                    return (
                      <View style={[styles.groupCard, styles.emptyBox, { backgroundColor: cardBg }]}>
                        <Text style={styles.mutedText}>{s.bots.noModel}</Text>
                      </View>
                    )
                  }
                  return list.map(prov => {
                    const pid = text(prov.id)
                    const pname = text(prov.name) || pid
                    const pmodels = objects(prov.models)
                    const configured = object(prov.key).configured !== false
                    return (
                      <View key={pid} style={[styles.groupCard, { backgroundColor: cardBg, padding: 14, gap: 10 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <BotAgentBadge engine={pid} size={20} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>{pname}</Text>
                            <Text style={styles.rowSub}>
                              {pmodels.length} {s.bots.model} · {configured ? '已就绪' : '需要 API Key'}
                            </Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {pmodels.slice(0, 12).map(m => {
                            const mname = text(m.name) || text(m.id) || text(m.ref)
                            return (
                              <View key={mname} style={styles.tagChip}>
                                <Text style={styles.tagChipText}>{mname}</Text>
                              </View>
                            )
                          })}
                        </View>
                      </View>
                    )
                  })
                })()}
              </View>
            )}

            {/* 3. 本地 Agent (Local Agents) */}
            {tab === 'local-agents' && (
              <View style={{ gap: 12 }}>
                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {KNOWN_LOCAL_AGENTS.map((agent, idx) => {
                    const detectedList = objects(localAgentsData?.detected)
                    const matched = detectedList.find(d => text(d.id) === agent.id)
                    const hasModels = state.models.some(m => text(m.provider) === agent.id || text(m.ref).startsWith(`${agent.id}/`))
                    const ready = Boolean(matched?.available ?? matched?.installed ?? hasModels)
                    return (
                      <View key={agent.id}>
                        {idx > 0 && <View style={styles.divider} />}
                        <View style={styles.rowBetween}>
                          <BotAgentBadge engine={agent.id} size={22} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>{agent.name}</Text>
                            <Text style={styles.rowSub}>{text(matched?.command) || agent.cmd}</Text>
                          </View>
                          <View style={[styles.statusBadge, ready && styles.statusBadgeReady]}>
                            <Text style={[styles.statusBadgeText, ready && { color: colors.primary }]}>
                              {ready ? '已就绪' : '主机端检测'}
                            </Text>
                          </View>
                        </View>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* 4. Bot (BotsPage) */}
            {tab === 'bots' && (
              <View style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-start' }}>
                  <Pressable
                    onPress={() => setEditorTarget({ kind: 'bot' })}
                    style={[styles.actionBtn, { backgroundColor: cardBg }]}
                  >
                    <Plus size={16} color={colors.ink} />
                    <Text style={styles.actionBtnText}>{s.bots.newBot}</Text>
                  </Pressable>
                </View>

                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {state.bots.map((bot, idx) => (
                    <Pressable
                      key={bot.id}
                      onPress={() => setEditorTarget({ kind: 'bot', bot })}
                      style={({ pressed }) => [styles.rowBetween, idx > 0 && styles.topDivider, pressed && { opacity: 0.75 }]}
                    >
                      <BotAvatarWithBadge bot={bot} size={40} showMainStar badgeBorderColor={cardBg} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{bot.name}</Text>
                          {bot.main && (
                            <View style={[styles.statusBadge, styles.statusBadgeReady]}>
                              <Text style={[styles.statusBadgeText, { color: colors.primary }]}>{s.bots.main}</Text>
                            </View>
                          )}
                          {bot.hidden && (
                            <View style={styles.statusBadge}>
                              <Text style={styles.statusBadgeText}>{s.bots.hideFromSidebar}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {[bot.role, bot.model || state.defaultModel].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <ChevronRight size={17} color={colors.muted} />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* 5. 群聊 (GroupsPage) */}
            {tab === 'groups' && (
              <View style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-start' }}>
                  <Pressable
                    disabled={state.bots.length < 2}
                    onPress={() => setEditorTarget({ kind: 'room' })}
                    style={[styles.actionBtn, { backgroundColor: cardBg }, state.bots.length < 2 && { opacity: 0.45 }]}
                  >
                    <Plus size={16} color={colors.ink} />
                    <Text style={styles.actionBtnText}>{s.bots.newGroup}</Text>
                  </Pressable>
                </View>

                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {state.rooms.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.mutedText}>{s.bots.none}</Text>
                    </View>
                  ) : (
                    state.rooms.map((room, idx) => (
                      <Pressable
                        key={room.id}
                        onPress={() => setEditorTarget({ kind: 'room', room })}
                        style={({ pressed }) => [styles.rowBetween, idx > 0 && styles.topDivider, pressed && { opacity: 0.75 }]}
                      >
                        <View style={[styles.iconSquare, { backgroundColor: colors.grouped }]}>
                          <Users size={18} color={colors.ink} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>{room.name}</Text>
                          <Text style={styles.rowSub}>
                            {room.members.length} {s.bots.members}
                            {room.hidden ? ` · ${s.bots.hideFromSidebar}` : ''}
                          </Text>
                        </View>
                        <ChevronRight size={17} color={colors.muted} />
                      </Pressable>
                    ))
                  )}
                </View>
              </View>
            )}

            {/* 6. 连接器 (ConnectorsPage) */}
            {tab === 'connectors' && (
              <View style={{ gap: 12 }}>
                <View style={[styles.searchBox, { backgroundColor: cardBg }]}>
                  <Search size={16} color={colors.muted} />
                  <TextInput
                    value={connectorQuery}
                    onChangeText={setConnectorQuery}
                    placeholder="搜索连接器…"
                    placeholderTextColor={colors.muted}
                    style={styles.searchInput}
                  />
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {[
                    ['all', '全部'],
                    ['dev', '开发'],
                    ['docs', '文档与文件'],
                    ['work', '工作'],
                    ['design', '设计'],
                    ['data', '数据'],
                    ['search', '搜索'],
                  ].map(([id, label]) => {
                    const on = connectorCat === id
                    return (
                      <Pressable key={id} onPress={() => setConnectorCat(id!)} style={[styles.smallPill, on && styles.smallPillActive]}>
                        <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>{label}</Text>
                      </Pressable>
                    )
                  })}
                </ScrollView>

                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {FEATURED_CONNECTORS.filter(
                    c =>
                      (connectorCat === 'all' || c.category === connectorCat)
                      && (!connectorQuery.trim() || `${c.name} ${c.desc}`.toLowerCase().includes(connectorQuery.trim().toLowerCase())),
                  ).map((conn, idx) => {
                    const remoteItems = objects(state.connectors?.items)
                    const live = remoteItems.find(it => text(it.id) === conn.id || text(it.name).toLowerCase() === conn.name.toLowerCase())
                    const connected = Boolean(live && (live.connected === true || text(live.status) === 'connected'))
                    return (
                      <View key={conn.id} style={[styles.rowBetween, idx > 0 && styles.topDivider]}>
                        <View style={[styles.iconSquare, { backgroundColor: colors.grouped }]}>
                          <Plug size={17} color={connected ? colors.primary : colors.ink} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>{conn.name}</Text>
                          <Text style={styles.rowSub}>{conn.desc}</Text>
                        </View>
                        <View style={[styles.statusBadge, connected && styles.statusBadgeReady]}>
                          <Text style={[styles.statusBadgeText, connected && { color: colors.primary }]}>
                            {connected ? '已连接' : '桌面端配置'}
                          </Text>
                        </View>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* 7. IM (ImPage) */}
            {tab === 'im' && (
              <View style={{ gap: 12 }}>
                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {IM_PLATFORMS.map((plat, idx) => {
                    const configuredBots = objects(state.im?.bots).filter(b => text(b.platform) === plat.id)
                    return (
                      <View key={plat.id} style={[styles.rowBetween, idx > 0 && styles.topDivider]}>
                        <View style={[styles.iconSquare, { backgroundColor: colors.grouped }]}>
                          <MessageSquareShare size={17} color={configuredBots.length > 0 ? colors.primary : colors.ink} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>{plat.name}</Text>
                          <Text style={styles.rowSub}>{plat.sub}</Text>
                        </View>
                        <View style={[styles.statusBadge, configuredBots.length > 0 && styles.statusBadgeReady]}>
                          <Text style={[styles.statusBadgeText, configuredBots.length > 0 && { color: colors.primary }]}>
                            {configuredBots.length > 0 ? `${configuredBots.length} 已连接` : '桌面端接入'}
                          </Text>
                        </View>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* 8. 能力 (CapabilitiesPage) */}
            {tab === 'capabilities' && (
              <View style={{ gap: 12 }}>
                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {(state.capabilities ?? []).length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.mutedText}>还没有共享能力（MCP 服务或技能）。</Text>
                    </View>
                  ) : (
                    (state.capabilities ?? []).map((cap, idx) => {
                      const cid = text(cap.id) || `cap-${idx}`
                      const statusObj = object(state.capabilityStatuses?.[cid])
                      const statusText = text(statusObj.state) || text(cap.kind) || 'ready'
                      return (
                        <View key={cid} style={[styles.rowBetween, idx > 0 && styles.topDivider]}>
                          <Sparkles size={18} color={colors.primary} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>{text(cap.name) || cid}</Text>
                            <Text style={styles.rowSub}>{text(cap.description) || statusText}</Text>
                          </View>
                          <View style={styles.statusBadge}>
                            <Text style={styles.statusBadgeText}>{statusText}</Text>
                          </View>
                        </View>
                      )
                    })
                  )}
                </View>
              </View>
            )}

            {/* 9. 浏览器 (BrowserSettingsPage) */}
            {tab === 'browser' && (
              <BotBrowserGrantsSection bots={state.bots} perform={perform} />
            )}

            {/* 10. 电脑操控 (ComputerPage) */}
            {tab === 'computer' && (
              <View style={{ gap: 12 }}>
                <View style={[styles.groupCard, { backgroundColor: cardBg, padding: 15, gap: 6 }]}>
                  <Text style={styles.rowTitle}>允许 Bot 使用电脑</Text>
                  <Text style={styles.rowSub}>{s.bots.computerDesc}</Text>
                  <View style={{ marginTop: 6, flexDirection: 'row' }}>
                    <View style={[styles.statusBadge, state.computer?.enabled === true && styles.statusBadgeReady]}>
                      <Text style={styles.statusBadgeText}>
                        {state.computer?.enabled === true ? s.bots.computerIdle : s.bots.computerDisabled}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {state.bots.map((bot, idx) => {
                    const level = text(object(state.computer?.levels)[bot.id]) || 'off'
                    return (
                      <View key={bot.id} style={[styles.rowBetween, idx > 0 && styles.topDivider]}>
                        <BotAvatar bot={bot} size={32} />
                        <Text style={[styles.rowTitle, { flex: 1 }]}>{bot.name}</Text>
                        <Text style={styles.rowSub}>{level === 'off' ? '关' : level}</Text>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* 11. 定时任务 (SchedulesPage — matches Figure 2 earlier) */}
            {tab === 'schedules' && (
              <BotSchedulesPanel state={state} client={clientInstance} />
            )}

            {/* 12. 用量 (UsagePage) */}
            {tab === 'usage' && (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([
                    ['24h', '24 小时'],
                    ['7d', '7 天'],
                    ['30d', '30 天'],
                  ] as const).map(([id, label]) => {
                    const on = usageRange === id
                    return (
                      <Pressable key={id} onPress={() => setUsageRange(id)} style={[styles.smallPill, on && styles.smallPillActive]}>
                        <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>{label}</Text>
                      </Pressable>
                    )
                  })}
                </View>

                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {(() => {
                    const rows = Array.isArray(usageData?.rows) ? usageData!.rows.filter(Array.isArray) : []
                    if (rows.length === 0) {
                      return (
                        <View style={styles.emptyBox}>
                          <Text style={styles.mutedText}>这个时间段还没有模型调用。</Text>
                        </View>
                      )
                    }
                    return rows.map((r, idx) => {
                      const cells = r as unknown[]
                      const totalTok = Number(cells[3] ?? 0) + Number(cells[4] ?? 0) + Number(cells[5] ?? 0)
                      return (
                        <View key={idx} style={[styles.rowBetween, idx > 0 && styles.topDivider]}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>
                              {text(cells[0])} · {text(cells[1])}
                            </Text>
                            <Text style={styles.rowSub}>
                              {Number(cells[2] ?? 0)} 次调用 · 输入 {formatCompactTokens(Number(cells[3] ?? 0))} · 输出 {formatCompactTokens(Number(cells[4] ?? 0))}
                            </Text>
                          </View>
                          <Text style={styles.rowTitle}>{formatCompactTokens(totalTok)}</Text>
                        </View>
                      )
                    })
                  })()}
                </View>
              </View>
            )}

            {/* 13. 密钥 (SecretsPage) */}
            {tab === 'secrets' && (
              <View style={{ gap: 12 }}>
                <Text style={styles.helperNote}>
                  密钥保存在主机加密存储中。Bot 可通过环境变量 $DSH_SECRET_NAME 或工具参数 [secret:NAME] 使用，不会看到明文。
                </Text>
                <View style={[styles.groupCard, { backgroundColor: cardBg }]}>
                  {(state.secrets ?? []).length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.mutedText}>还没有保存密钥。</Text>
                    </View>
                  ) : (
                    (state.secrets ?? []).map((sec, idx) => {
                      const name = text(sec.name) || `SECRET_${idx}`
                      return (
                        <View key={name} style={[styles.rowBetween, idx > 0 && styles.topDivider]}>
                          <KeyRound size={17} color={colors.primary} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>{name}</Text>
                            <Text style={styles.rowSub}>{text(sec.purpose) || '所有 Bot 可用'}</Text>
                          </View>
                        </View>
                      )
                    })
                  )}
                </View>
              </View>
            )}
          </ScrollView>
        )}

        {/* Default Model Picker Modal */}
        {state && defaultModelPickerOpen && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setDefaultModelPickerOpen(false)}>
            <ModalSurface onClose={() => setDefaultModelPickerOpen(false)}>
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.pageTitle}>{s.bots.defaultModel}</Text>
                  <IconButton label={s.common.close} icon={X} onPress={() => setDefaultModelPickerOpen(false)} />
                </View>
                <ScrollView style={{ maxHeight: 380 }}>
                  {state.models.map(m => {
                    const ref = text(m.ref)
                    const label = text(m.name) || text(m.label) || ref
                    const on = defaultBotModel === ref
                    return (
                      <Pressable
                        key={ref}
                        onPress={() => {
                          setDefaultModelPickerOpen(false)
                          void setPref({ defaultBotModel: ref })
                        }}
                        style={styles.rowBetween}
                      >
                        <Text style={[styles.rowTitle, { flex: 1 }]}>{label}</Text>
                        {on && <Check size={18} color={colors.primary} />}
                      </Pressable>
                    )
                  })}
                </ScrollView>
              </View>
            </ModalSurface>
          </Modal>
        )}

        {/* Team Workspace Folder Picker */}
        {state && (
          <BotFolderPickerModal
            visible={teamFolderPickerOpen}
            value={state.workspaceId}
            teamMode
            client={clientInstance}
            onClose={() => setTeamFolderPickerOpen(false)}
            onPick={folder => {
              if (folder) void perform('team-workspace', { folder })
            }}
          />
        )}

        {/* Single-Bot / Group Editor */}
        {state && editorTarget && clientInstance && (
          <BotEditor
            kind={editorTarget.kind}
            bot={editorTarget.bot}
            room={editorTarget.room}
            state={state}
            client={clientInstance}
            busy={busy}
            error={visibleError}
            perform={perform}
            onClose={() => setEditorTarget(null)}
          />
        )}
      </View>
    </Modal>
  )
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    circleBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    topTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.ink,
    },
    navStripWrap: {
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    navStripScroll: {
      paddingHorizontal: 14,
      gap: 8,
    },
    navChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    navChipText: {
      fontSize: 13.5,
      fontWeight: '500',
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 14,
      gap: 14,
    },
    pageTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.ink,
    },
    groupCard: {
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    rowTitle: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.ink,
    },
    rowSub: {
      fontSize: 12.5,
      color: colors.muted,
      marginTop: 2,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginLeft: 15,
    },
    topDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    inlinePills: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    smallPill: {
      paddingHorizontal: 11,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.grouped,
    },
    smallPillActive: {
      backgroundColor: colors.primary,
    },
    smallPillText: {
      fontSize: 12.5,
      fontWeight: '500',
      color: colors.ink,
    },
    smallPillTextActive: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
    sectionBlock: {
      gap: 6,
    },
    sectionLabel: {
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.muted,
      paddingHorizontal: 4,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    actionBtnText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: colors.ink,
    },
    tagChip: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: colors.grouped,
    },
    tagChipText: {
      fontSize: 12,
      color: colors.ink,
    },
    statusBadge: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.grouped,
    },
    statusBadgeReady: {
      backgroundColor: colors.primarySoft,
    },
    statusBadgeText: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.muted,
    },
    iconSquare: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      height: 40,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.ink,
      paddingVertical: 0,
    },
    emptyBox: {
      paddingVertical: 24,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerEmpty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingHorizontal: 32,
    },
    mutedText: {
      fontSize: 14,
      color: colors.muted,
      textAlign: 'center',
    },
    helperNote: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
      paddingHorizontal: 4,
    },
    errorBanner: {
      fontSize: 13,
      color: colors.danger,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
  })
