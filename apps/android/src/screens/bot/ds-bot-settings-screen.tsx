import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Alert } from '../../ui/alert'
import {
  Bot,
  CalendarClock,
  ChartNoAxesColumn,
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  Folder,
  Globe,
  KeyRound,
  MessageSquareShare,
  Monitor,
  Plug,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import {
  canDeleteBot,
  object,
  objects,
  parseBotState,
  text,
  type BotEntry,
  type BotObject,
  type BotRemoteClient,
  type BotRoom,
  type BotState,
} from '../../services/bot-catalog'
import {
  loadPluginInventory,
  setPluginEnabled,
  type PluginBundleView,
} from '../../services/plugin-inventory'
import { requireBotClient, useAppStore } from '../../state/store'
import { useBotTeamStore } from '../../state/bot-store'
import {
  BlurHeaderFrame,
  GroupCard,
  GroupRow,
  IconButton,
  RefreshAction,
  Screen,
  SectionTitle,
  TopBar,
} from '../../ui/components'
import { useResponsiveLayout } from '../../ui/responsive'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { Toggle } from '../../ui/toggle'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { DsBotInstallCard } from '../bot-sidebar-section'
import { ModalSurface } from '../chat/modal'
import { PluginsModal } from '../plugins-modal'
import { BotAgentBadge } from './agent-badge'
import { BotAvatarWithBadge } from './avatar'
import {
  DsBotCapabilitiesSubpage,
  DsBotComputerSubpage,
  DsBotConnectorsSubpage,
  DsBotImSubpage,
  DsBotSecretsSubpage,
  DsBotUsageSubpage,
} from './ds-bot-settings-subpages'
import {
  buildDsBotActivityYear,
  buildDsBotUsageView,
  DS_BOT_CONNECTOR_CATALOG,
  DS_BOT_LOCAL_SERVERS,
  DS_BOT_POPULAR_PROVIDERS,
  type UsageRangeId,
} from './ds-bot-usage-data'
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
  detail: string
  icon: LucideIcon
}

const KNOWN_LOCAL_AGENTS = [
  { id: 'claude', name: 'Claude Code', cmd: 'claude-agent-acp', desc: 'Anthropic Claude Code 命令行 Agent' },
  { id: 'codex', name: 'Codex', cmd: 'codex', desc: 'OpenAI Codex 本地编码 Agent' },
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', desc: 'OpenCode 终端编码 Agent' },
  { id: 'hermes', name: 'Hermes Agent', cmd: 'hermes', desc: 'Nous Research Hermes 本地 Agent' },
  { id: 'cursor', name: 'Cursor Agent', cmd: 'cursor-agent', desc: 'Cursor 命令行编码 Agent' },
  { id: 'pi', name: 'Pi', cmd: 'pi-acp', desc: 'Pi 极简命令行 Agent' },
]

const FALLBACK_PREVIEW_STATE: BotState = parseBotState({
  bots: [
    {
      id: 'chief',
      sessionId: 'chief',
      name: 'Chief',
      role: 'Chief of Staff',
      main: true,
      color: '#4D6BFE',
    },
  ],
  rooms: [],
  mainBotId: 'chief',
  mainBotIds: ['chief'],
  defaultModel: 'deepseek/deepseek-chat',
  prefs: { motion: 'lively', thinking: true, enterToSend: true },
})

/**
 * Secondary Settings screen for DS Bot, matching `SettingsScreen`'s GroupCard/GroupRow design
 * with a level-1 index page, missing/disabled `ds-bot` plugin reminder card, and 13 level-2 subpages:
 * 通用 / 模型 / 本地 Agent / Bot / 群聊 / 连接器 / IM / 能力 / 浏览器 / 电脑操控 / 定时任务 / 用量 / 密钥
 */
export function DsBotSettingsModal({
  visible,
  initialTab,
  onClose,
}: {
  visible: boolean
  initialTab?: DsBotSettingsTab
  onClose: () => void
}) {
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { contentMaxWidth, landscape } = useResponsiveLayout()
  const isDark = scheme === 'dark'

  const connected = useAppStore(store => store.connection.phase === 'connected')
  const selectedDevice = useAppStore(store => store.selectedDevice)
  const state = useBotTeamStore(store => store.state)
  const loading = useBotTeamStore(store => store.loading)
  const busy = useBotTeamStore(store => store.busy)
  const error = useBotTeamStore(store => store.error)
  const actionError = useBotTeamStore(store => store.actionError)
  const refresh = useBotTeamStore(store => store.refresh)
  const perform = useBotTeamStore(store => store.perform)

  const [subpage, setSubpage] = useState<DsBotSettingsTab | null>(initialTab ?? null)
  const [editorTarget, setEditorTarget] = useState<{ kind: 'bot' | 'room'; bot?: BotEntry; room?: BotRoom } | null>(null)
  const [defaultModelPickerOpen, setDefaultModelPickerOpen] = useState(false)
  const [mainBotPickerOpen, setMainBotPickerOpen] = useState(false)
  const [teamFolderPickerOpen, setTeamFolderPickerOpen] = useState(false)
  const [botFolderTarget, setBotFolderTarget] = useState<BotEntry | null>(null)
  const [pluginsModalOpen, setPluginsModalOpen] = useState(false)

  // Plugin prerequisite check state
  const [dsBotBundle, setDsBotBundle] = useState<PluginBundleView | null>(null)
  const [checkingPlugin, setCheckingPlugin] = useState(false)
  const [enablingPlugin, setEnablingPlugin] = useState(false)

  // Remote-fetched sub-views
  const [providersData, setProvidersData] = useState<BotObject[] | null>(null)
  const [localAgentsData, setLocalAgentsData] = useState<BotObject | null>(null)
  const [usageData, setUsageData] = useState<BotObject | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageRange, setUsageRange] = useState<UsageRangeId>('7d')

  let clientInstance: BotRemoteClient | undefined
  try {
    clientInstance = requireBotClient()
  } catch {
    clientInstance = undefined
  }

  const checkDsBotPluginStatus = useCallback(async () => {
    if (!connected) {
      setDsBotBundle(null)
      return
    }
    setCheckingPlugin(true)
    try {
      const inv = await loadPluginInventory()
      const found = inv.bundles.find(b => b.name === 'ds-bot') ?? null
      setDsBotBundle(found)
    } catch {
      // Ignore inventory check error; fall back to bot state
    } finally {
      setCheckingPlugin(false)
    }
  }, [connected])

  const handleRetryAll = useCallback(async () => {
    await Promise.all([checkDsBotPluginStatus(), refresh(true)])
  }, [checkDsBotPluginStatus, refresh])

  const handleEnableDsBot = useCallback(async () => {
    if (!dsBotBundle || enablingPlugin) return
    setEnablingPlugin(true)
    try {
      await setPluginEnabled('bundle', dsBotBundle.name, true)
      await handleRetryAll()
    } catch {
      // Handled via refresh/inventory state
    } finally {
      setEnablingPlugin(false)
    }
  }, [dsBotBundle, enablingPlugin, handleRetryAll])

  useEffect(() => {
    if (!visible) return
    setSubpage(initialTab ?? null)
    void checkDsBotPluginStatus()
    if (connected && !state) {
      void refresh(true)
    }
  }, [visible, initialTab, connected, state, checkDsBotPluginStatus, refresh])

  useEffect(() => {
    if (!visible || !clientInstance) return
    if (subpage === 'models' || subpage === null) {
      void clientInstance
        .call('providers')
        .then(res => setProvidersData(objects(object(res).providers)))
        .catch(() => setProvidersData([]))
    }
    if (subpage === 'local-agents' || subpage === null) {
      void clientInstance
        .call('local-agents')
        .then(res => setLocalAgentsData(object(res)))
        .catch(() => setLocalAgentsData(null))
    }
    if (subpage === 'usage' || subpage === null) {
      setUsageLoading(true)
      void clientInstance
        .call('usage', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
        .then(res => setUsageData(object(res)))
        .catch(() => setUsageData(null))
        .finally(() => setUsageLoading(false))
    }
  }, [visible, subpage, clientInstance])

  const effectiveState = state ?? FALLBACK_PREVIEW_STATE
  const isLiveState = state !== undefined

  const setPref = useCallback(
    async (patch: BotObject) => {
      if (!isLiveState) return
      await perform('set-prefs', patch)
    },
    [isLiveState, perform],
  )

  const tabs: TabItem[] = useMemo(
    () => [
      { id: 'general', label: s.bots.tabGeneral, detail: '默认模型、回复体验与工作文件夹', icon: SlidersHorizontal },
      { id: 'models', label: s.bots.tabModels, detail: '模型服务商、API 密钥与本地服务', icon: Cpu },
      { id: 'local-agents', label: s.bots.tabLocalAgents, detail: 'Claude Code、Codex、OpenCode 与原生会话', icon: Terminal },
      { id: 'bots', label: s.bots.tabBots, detail: '主 Bot、动画风格与团队成员管理', icon: Bot },
      { id: 'groups', label: s.bots.tabGroups, detail: '多 Bot 协作群聊、管理员与回复模式', icon: Users },
      { id: 'connectors', label: s.bots.tabConnectors, detail: 'GitHub、邮箱、Notion、Linear 等第三方服务', icon: Plug },
      { id: 'im', label: s.bots.tabIm, detail: '微信、飞书、钉钉、企微、QQ、Telegram 等平台', icon: MessageSquareShare },
      { id: 'capabilities', label: s.bots.tabCapabilities, detail: '按 Bot 配置工具权限与共享技能', icon: Sparkles },
      { id: 'browser', label: s.bots.tabBrowser, detail: '网页自动化与站点敏感操作预授权', icon: Globe },
      { id: 'computer', label: s.bots.tabComputer, detail: '屏幕查看与键鼠操控权限等级', icon: Monitor },
      { id: 'schedules', label: s.bots.tabSchedules, detail: '周期性简报、定时提醒与自动任务', icon: CalendarClock },
      { id: 'usage', label: s.bots.tabUsage, detail: 'Token 走势、缓存命中率与年度活跃度', icon: ChartNoAxesColumn },
      { id: 'secrets', label: s.bots.tabSecrets, detail: 'Bot 环境变量密钥与访问范围', icon: KeyRound },
    ],
    [],
  )

  const usageView = useMemo(
    () => buildDsBotUsageView(usageData, usageRange),
    [usageData, usageRange],
  )
  const activityYear = useMemo(
    () => buildDsBotActivityYear(usageData, 24),
    [usageData],
  )

  if (!visible) return null

  const prefs = object(effectiveState.prefs)
  const showThinking = prefs.thinking !== false && prefs.showThinking !== false
  const motion = text(prefs.motion) || text(prefs.animation) || 'lively'
  const enterToSend = prefs.enterToSend !== false
  const defaultBotModel = text(prefs.defaultBotModel) || effectiveState.defaultModel || ''

  const mainBot =
    effectiveState.bots.find(b => b.id === effectiveState.mainBotId)
    ?? effectiveState.bots.find(b => b.main)
    ?? effectiveState.bots[0]
  const mainBotName = mainBot?.name ?? 'Chief'

  const connectedConnectorItems = objects(effectiveState.connectors?.items).filter(
    it => it.connected === true || text(it.status) === 'connected',
  )
  const connectedImList = objects(effectiveState.im?.connections ?? effectiveState.im?.bots)
  const totalBrowserGrants = effectiveState.bots.reduce(
    (sum, b) => sum + (b.browserGrants?.length ?? 0),
    0,
  )
  const configuredProviderCount =
    providersData && providersData.length > 0
      ? providersData.length
      : new Set(
          effectiveState.models
            .map(m => text(m.provider) || text(m.ref).split('/')[0])
            .filter(Boolean),
        ).size

  const summaryForTab = (id: DsBotSettingsTab): string => {
    switch (id) {
      case 'general':
        return effectiveState.workspaceId
          ? folderBasename(effectiveState.workspaceId)
          : defaultBotModel
            ? defaultBotModel.split('/').pop() ?? ''
            : '默认'
      case 'models':
        return configuredProviderCount > 0 ? `${configuredProviderCount} 个服务商` : `${effectiveState.models.length} 个模型`
      case 'local-agents': {
        const det = objects(localAgentsData?.detected).filter(d => d.installed === true || d.available === true).length
        const dshCount = effectiveState.agents.length
        return det + dshCount > 0 ? `已启用 ${det + dshCount}` : `${KNOWN_LOCAL_AGENTS.length} 项`
      }
      case 'bots':
        return `${mainBotName} · ${effectiveState.bots.length} 个`
      case 'groups':
        return `${effectiveState.rooms.length} 个`
      case 'connectors':
        return connectedConnectorItems.length > 0
          ? `已连接 ${connectedConnectorItems.length}`
          : `${DS_BOT_CONNECTOR_CATALOG.length} 个`
      case 'im':
        return connectedImList.length > 0 ? `已连接 ${connectedImList.length}` : '8 个平台'
      case 'capabilities':
        return (effectiveState.capabilities ?? []).length > 0
          ? `${(effectiveState.capabilities ?? []).length} 项能力`
          : '按 Bot 授权'
      case 'browser':
        return totalBrowserGrants > 0 ? `${totalBrowserGrants} 项预授权` : '无预授权'
      case 'computer':
        return effectiveState.computer?.enabled === true ? '已开启' : '关'
      case 'schedules':
        return '管理任务'
      case 'usage':
        return usageView.current.tokens > 0
          ? `${formatCompactTokens(usageView.current.tokens)} Token`
          : '查看统计'
      case 'secrets':
        return `${(effectiveState.secrets ?? []).length} 个`
    }
  }

  const isPluginNotInstalled =
    connected && !isLiveState && (dsBotBundle?.available === false || (!loading && !checkingPlugin))
  const isPluginDisabled =
    connected && dsBotBundle?.available === true && dsBotBundle.enabled === false

  const activeTabItem = subpage ? tabs.find(t => t.id === subpage) ?? null : null
  const visibleError = actionError ?? error
  const switchColors = { trackColor: { false: colors.disabled, true: colors.primary }, thumbColor: colors.white } as const

  const handleBack = () => {
    if (subpage !== null) {
      setSubpage(null)
      return
    }
    onClose()
  }

  const renderPrerequisiteNotice = () => {
    if (isLiveState && !isPluginDisabled) return null

    if (!connected) {
      return (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>DS Bot 插件状态</SectionTitle>
          <GroupCard>
            <GroupRow
              first
              icon={CircleAlert}
              label="尚未连接远程电脑主机"
              detail={
                selectedDevice
                  ? `当前主机「${selectedDevice.name}」未连接。连接主机并安装 DS Bot 插件后即可同步全部设置。`
                  : s.bots.dsBotSettingsDisconnected
              }
              chevron={false}
            />
          </GroupCard>
          <DsBotInstallCard error="电脑端未连接或尚未安装 DS Bot 插件" onRetry={() => void handleRetryAll()} />
        </View>
      )
    }

    if (isPluginDisabled) {
      return (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>DS Bot 插件状态</SectionTitle>
          <GroupCard>
            <GroupRow
              first
              icon={CircleAlert}
              label="DS Bot 插件当前已停用"
              detail="电脑端已安装 DS Bot，但尚未启用。启用后即可在手机端管理全部 DS Bot 设置。"
              chevron={false}
            />
            <GroupRow
              icon={Sparkles}
              label={enablingPlugin ? '正在启用 DS Bot…' : '一键启用 DS Bot 插件'}
              disabled={enablingPlugin}
              onPress={() => void handleEnableDsBot()}
            />
            <GroupRow
              icon={Plug}
              label="打开插件管理"
              onPress={() => setPluginsModalOpen(true)}
            />
          </GroupCard>
        </View>
      )
    }

    if (loading || checkingPlugin) {
      return (
        <GroupCard>
          <View style={styles.loadingCardRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.mutedText}>正在检测电脑端 DS Bot 插件状态…</Text>
          </View>
        </GroupCard>
      )
    }

    if (isPluginNotInstalled) {
      return (
        <View style={{ gap: spacing.xs }}>
          <SectionTitle>未检测到 DS Bot 插件</SectionTitle>
          <DsBotInstallCard
            error={visibleError ?? s.bots.notInstalled}
            onRetry={() => void handleRetryAll()}
          />
          <GroupCard>
            <GroupRow
              first
              icon={Plug}
              label="前往插件管理检查状态"
              detail="查看电脑端已安装插件列表与启用状态"
              onPress={() => setPluginsModalOpen(true)}
            />
          </GroupCard>
        </View>
      )
    }

    return null
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleBack} statusBarTranslucent>
      <View style={styles.root}>
        <BlurHeaderFrame
          header={
            <TopBar
              title={activeTabItem ? activeTabItem.label : s.bots.dsBotSettingsTitle}
              onBack={handleBack}
              action={<RefreshAction refreshing={loading || checkingPlugin} onPress={() => void handleRetryAll()} />}
            />
          }
        >
          <Screen key={subpage ?? 'index'}>
            <View style={[styles.contentColumn, landscape && { maxWidth: contentMaxWidth }]}>
              {/* ==================== LEVEL 1: SETTINGS-STYLE INDEX PAGE ==================== */}
              {subpage === null && (
                <>
                  {renderPrerequisiteNotice()}

                  <SectionTitle>基础与模型</SectionTitle>
                  <GroupCard>
                    {tabs.slice(0, 3).map((item, idx) => (
                      <GroupRow
                        key={item.id}
                        first={idx === 0}
                        icon={item.icon}
                        label={item.label}
                        detail={item.detail}
                        value={summaryForTab(item.id)}
                        chevron
                        onPress={() => setSubpage(item.id)}
                      />
                    ))}
                  </GroupCard>

                  <SectionTitle>团队与协作</SectionTitle>
                  <GroupCard>
                    {tabs.slice(3, 5).map((item, idx) => (
                      <GroupRow
                        key={item.id}
                        first={idx === 0}
                        icon={item.icon}
                        label={item.label}
                        detail={item.detail}
                        value={summaryForTab(item.id)}
                        chevron
                        onPress={() => setSubpage(item.id)}
                      />
                    ))}
                  </GroupCard>

                  <SectionTitle>连接器与消息渠道</SectionTitle>
                  <GroupCard>
                    {tabs.slice(5, 7).map((item, idx) => (
                      <GroupRow
                        key={item.id}
                        first={idx === 0}
                        icon={item.icon}
                        label={item.label}
                        detail={item.detail}
                        value={summaryForTab(item.id)}
                        chevron
                        onPress={() => setSubpage(item.id)}
                      />
                    ))}
                  </GroupCard>

                  <SectionTitle>能力与操作授权</SectionTitle>
                  <GroupCard>
                    {tabs.slice(7, 10).map((item, idx) => (
                      <GroupRow
                        key={item.id}
                        first={idx === 0}
                        icon={item.icon}
                        label={item.label}
                        detail={item.detail}
                        value={summaryForTab(item.id)}
                        chevron
                        onPress={() => setSubpage(item.id)}
                      />
                    ))}
                  </GroupCard>

                  <SectionTitle>任务、统计与密钥</SectionTitle>
                  <GroupCard>
                    {tabs.slice(10, 13).map((item, idx) => (
                      <GroupRow
                        key={item.id}
                        first={idx === 0}
                        icon={item.icon}
                        label={item.label}
                        detail={item.detail}
                        value={summaryForTab(item.id)}
                        chevron
                        onPress={() => setSubpage(item.id)}
                      />
                    ))}
                  </GroupCard>
                </>
              )}

              {/* ==================== LEVEL 2 SUBPAGES ==================== */}
              {subpage !== null && !isLiveState && (
                <GroupCard>
                  <GroupRow
                    first
                    icon={CircleAlert}
                    label={connected ? '电脑端尚未安装或启用 DS Bot 插件' : '当前未连接电脑主机'}
                    detail="当前展示为默认预览配置；在电脑端安装并启用 ds-bot 后可实时读写。"
                    chevron={false}
                  />
                </GroupCard>
              )}

              {/* 1. 通用 (General — excludes computer window appearance & keep-awake) */}
              {subpage === 'general' && (
                <>
                  <SectionTitle>{s.bots.defaultModel}</SectionTitle>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Cpu}
                      label={s.bots.defaultModel}
                      detail="新建 Bot 时默认使用的模型"
                      value={defaultBotModel ? defaultBotModel.split('/').pop() : '默认'}
                      chevron
                      onPress={() => setDefaultModelPickerOpen(true)}
                    />
                  </GroupCard>

                  <SectionTitle>对话与回复</SectionTitle>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Sparkles}
                      label={s.bots.showThinking}
                      detail="在对话中展开模型的推理思考过程"
                      chevron={false}
                      accessory={
                        <Toggle
                          value={showThinking}
                          disabled={!isLiveState}
                          onValueChange={val => void setPref({ thinking: val })}
                          accessibilityLabel={s.bots.showThinking}
                          {...switchColors}
                        />
                      }
                    />
                    <GroupRow
                      icon={MessageSquareShare}
                      label={s.bots.enterToSend}
                      detail="按回车键直接发送消息"
                      chevron={false}
                      accessory={
                        <Toggle
                          value={enterToSend}
                          disabled={!isLiveState}
                          onValueChange={val => void setPref({ enterToSend: val })}
                          accessibilityLabel={s.bots.enterToSend}
                          {...switchColors}
                        />
                      }
                    />
                  </GroupCard>

                  <SectionTitle>位置</SectionTitle>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Folder}
                      label={s.bots.teamWorkspace}
                      detail="没有单独设置文件夹的 Bot 在这里工作。"
                      value={effectiveState.workspaceId ? folderBasename(effectiveState.workspaceId) : '默认'}
                      chevron
                      disabled={!isLiveState}
                      onPress={() => setTeamFolderPickerOpen(true)}
                    />
                  </GroupCard>

                  <SectionTitle>各 Bot 自己的文件夹</SectionTitle>
                  <GroupCard>
                    {effectiveState.bots.map((bot, idx) => (
                      <GroupRow
                        key={bot.id}
                        first={idx === 0}
                        icon={Folder}
                        label={bot.name}
                        detail={bot.workDir ? folderBasename(bot.workDir) : '跟随总工作区'}
                        value={bot.private ? s.bots.privateBot : undefined}
                        chevron
                        disabled={!isLiveState}
                        onPress={() => setBotFolderTarget(bot)}
                      />
                    ))}
                  </GroupCard>

                  {(effectiveState.privateArchives ?? []).length > 0 && (
                    <>
                      <SectionTitle>{`删除后仍受保护 · ${(effectiveState.privateArchives ?? []).length}`}</SectionTitle>
                      <GroupCard>
                        {(effectiveState.privateArchives ?? []).map((arc, idx) => (
                          <GroupRow
                            key={text(arc.id) || `arc-${idx}`}
                            first={idx === 0}
                            icon={ShieldCheck}
                            label={text(arc.name) || '已删除的隐私 Bot'}
                            detail="其他 Bot 不能读取它的文件夹、记忆或对话"
                            chevron={false}
                          />
                        ))}
                      </GroupCard>
                    </>
                  )}
                </>
              )}

              {/* 2. 模型 (Models / ProvidersPage) */}
              {subpage === 'models' && (
                <>
                  <SectionTitle>已配置服务商</SectionTitle>
                  {(() => {
                    const list =
                      providersData && providersData.length > 0
                        ? providersData
                        : (() => {
                            const map = new Map<string, BotObject[]>()
                            for (const m of effectiveState.models) {
                              const p = text(m.provider) || text(m.providerName) || text(m.ref).split('/')[0] || 'deepseek'
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
                        <GroupCard>
                          <GroupRow
                            first
                            icon={Cpu}
                            label={s.bots.noModel}
                            detail="请在电脑端 DS Bot 设置中添加模型服务商或配置 API Key"
                            chevron={false}
                          />
                        </GroupCard>
                      )
                    }
                    return list.map(prov => {
                      const pid = text(prov.id)
                      const pname = text(prov.name) || pid
                      const pmodels = objects(prov.models)
                      const configured = object(prov.key).configured !== false
                      return (
                        <GroupCard key={pid} style={{ padding: 14, gap: 10 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <BotAgentBadge engine={pid} size={22} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.rowTitle}>{pname}</Text>
                              <Text style={styles.rowSub}>
                                {pmodels.length} 个模型 · {configured ? '已配置密钥' : '需要 API Key'}
                              </Text>
                            </View>
                          </View>
                          {pmodels.length > 0 && (
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
                          )}
                        </GroupCard>
                      )
                    })
                  })()}

                  <SectionTitle>常用服务商</SectionTitle>
                  <GroupCard>
                    {DS_BOT_POPULAR_PROVIDERS.map((prov, idx) => {
                      const isConfigured =
                        (providersData ?? []).some(p => text(p.id).toLowerCase() === prov.id)
                        || effectiveState.models.some(m => text(m.provider).toLowerCase() === prov.id || text(m.ref).toLowerCase().startsWith(`${prov.id}/`))
                      return (
                        <GroupRow
                          key={prov.id}
                          first={idx === 0}
                          icon={Cpu}
                          label={prov.name}
                          detail={prov.desc}
                          value={isConfigured ? '已就绪' : '在电脑端配置'}
                          chevron={false}
                        />
                      )
                    })}
                  </GroupCard>

                  <SectionTitle>本地模型服务</SectionTitle>
                  <GroupCard>
                    {DS_BOT_LOCAL_SERVERS.map((srv, idx) => (
                      <GroupRow
                        key={srv.id}
                        first={idx === 0}
                        icon={Terminal}
                        label={srv.name}
                        detail={srv.endpoint}
                        value="本地接口"
                        chevron={false}
                      />
                    ))}
                  </GroupCard>
                </>
              )}

              {/* 3. 本地 Agent (Local Agents) */}
              {subpage === 'local-agents' && (
                <>
                  <Text style={styles.helperNote}>
                    将电脑上已安装的命令行编码 Agent 接入 DS Bot，各 Bot 可直接选用其作为底层运行模型。
                  </Text>

                  <SectionTitle>DeepSeek Harness 原生会话</SectionTitle>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Bot}
                      label="DSH Agent"
                      detail="在 Bot 侧栏中直接显示和切换原生 dsh 会话"
                      value={effectiveState.agents.length > 0 ? '已添加' : '未添加'}
                      disabled={!isLiveState || busy}
                      onPress={() => {
                        if (effectiveState.agents[0]) {
                          void perform('remove-agent', { agentId: effectiveState.agents[0].id })
                        } else {
                          void perform('add-agent', {})
                        }
                      }}
                    />
                  </GroupCard>

                  <SectionTitle>本地编码 Agent</SectionTitle>
                  <GroupCard>
                    {KNOWN_LOCAL_AGENTS.map((agent, idx) => {
                      const detectedList = objects(localAgentsData?.detected)
                      const matched = detectedList.find(d => text(d.id) === agent.id)
                      const hasModels = effectiveState.models.some(
                        m => text(m.provider) === agent.id || text(m.ref).startsWith(`${agent.id}/`),
                      )
                      const ready = Boolean(matched?.available ?? matched?.installed ?? hasModels)
                      const ver = text(matched?.version)
                      return (
                        <GroupRow
                          key={agent.id}
                          first={idx === 0}
                          icon={Terminal}
                          label={agent.name}
                          detail={ver ? `${agent.desc} · ${ver}` : `${agent.desc} (${text(matched?.command) || agent.cmd})`}
                          value={ready ? '已就绪' : '未检测到'}
                          chevron={false}
                        />
                      )
                    })}
                  </GroupCard>
                </>
              )}

              {/* 4. Bot (BotsPage — strictly aligned with Screenshot 1) */}
              {subpage === 'bots' && (
                <>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Bot}
                      label="主 Bot"
                      detail="群聊默认管理员；外部消息和自动任务默认交给它处理。"
                      value={mainBotName}
                      chevron
                      disabled={!isLiveState}
                      onPress={() => setMainBotPickerOpen(true)}
                    />
                  </GroupCard>

                  <GroupCard style={{ padding: 15, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{s.bots.botAnimation}</Text>
                        <Text style={styles.rowSub}>聊天与状态栏中 Bot 头像的呼吸和工作动效。</Text>
                      </View>
                      <View style={styles.inlinePills}>
                        {([
                          ['lively', s.bots.animLively],
                          ['normal', s.bots.animNormal],
                          ['quiet', s.bots.animQuiet],
                        ] as const).map(([id, label]) => {
                          const on = motion === id
                          return (
                            <Pressable
                              key={id}
                              disabled={!isLiveState}
                              onPress={() => void setPref({ motion: id })}
                              style={[styles.smallPill, on && styles.smallPillActive]}
                            >
                              <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>{label}</Text>
                            </Pressable>
                          )
                        })}
                      </View>
                    </View>
                  </GroupCard>

                  <SectionTitle
                    action={
                      <Pressable
                        accessibilityRole="button"
                        disabled={!isLiveState}
                        onPress={() => setEditorTarget({ kind: 'bot' })}
                        style={({ pressed }) => [
                          styles.inlineCreateBtn,
                          !isLiveState && { opacity: 0.45 },
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        <Plus size={15} color={colors.ink} />
                        <Text style={styles.inlineCreateBtnText}>{s.bots.newBot}</Text>
                      </Pressable>
                    }
                  >
                    {`Bot · ${effectiveState.bots.length}`}
                  </SectionTitle>

                  <GroupCard>
                    {effectiveState.bots.map((bot, idx) => (
                      <View
                        key={bot.id}
                        style={[
                          styles.botListRow,
                          idx > 0 && styles.topHairline,
                        ]}
                      >
                        <Pressable
                          disabled={!isLiveState}
                          onPress={() => setEditorTarget({ kind: 'bot', bot })}
                          style={({ pressed }) => [
                            { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
                            pressed && { opacity: 0.75 },
                          ]}
                        >
                          <BotAvatarWithBadge
                            bot={bot}
                            size={42}
                            showMainStar
                            badgeBorderColor={isDark ? colors.cardOpaque : '#FFFFFF'}
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <Text style={styles.rowTitle} numberOfLines={1}>{bot.name}</Text>
                              {Boolean(bot.role) && (
                                <Text style={styles.rowSub} numberOfLines={1}>{bot.role}</Text>
                              )}
                              {(bot.main || bot.id === effectiveState.mainBotId) && (
                                <View style={[styles.statusBadge, styles.statusBadgeReady]}>
                                  <Text style={[styles.statusBadgeText, { color: colors.primary }]}>主 Bot</Text>
                                </View>
                              )}
                              {bot.private && (
                                <View style={styles.statusBadge}>
                                  <Text style={styles.statusBadgeText}>{s.bots.privateBot}</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.rowSub} numberOfLines={1}>
                              {bot.instructions || (bot.model || effectiveState.defaultModel) || '点击管理模型、指令与文件夹'}
                            </Text>
                          </View>
                          <ChevronRight size={18} color={colors.subtle} />
                        </Pressable>
                        {isLiveState && canDeleteBot(effectiveState, bot) && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${s.bots.delete} ${bot.name}`}
                            disabled={busy}
                            hitSlop={8}
                            onPress={() => {
                              Alert.alert(s.bots.delete, s.bots.deleteHint, [
                                { text: s.bots.cancel, style: 'cancel' },
                                {
                                  text: s.bots.delete,
                                  style: 'destructive',
                                  onPress: () => void perform('delete-bot', { id: bot.id }),
                                },
                              ])
                            }}
                            style={({ pressed }) => [
                              { padding: 6 },
                              pressed && { opacity: 0.65 },
                              busy && { opacity: 0.4 },
                            ]}
                          >
                            <Trash2 size={17} color={colors.danger} />
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </GroupCard>
                </>
              )}

              {/* 5. 群聊 (GroupsPage) */}
              {subpage === 'groups' && (
                <>
                  <SectionTitle
                    action={
                      <Pressable
                        accessibilityRole="button"
                        disabled={!isLiveState || effectiveState.bots.length < 2}
                        onPress={() => setEditorTarget({ kind: 'room' })}
                        style={({ pressed }) => [
                          styles.inlineCreateBtn,
                          (!isLiveState || effectiveState.bots.length < 2) && { opacity: 0.45 },
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        <Plus size={15} color={colors.ink} />
                        <Text style={styles.inlineCreateBtnText}>{s.bots.newGroup}</Text>
                      </Pressable>
                    }
                  >
                    {`群聊 · ${effectiveState.rooms.length}`}
                  </SectionTitle>

                  <GroupCard>
                    {effectiveState.rooms.length === 0 ? (
                      <View style={styles.emptyCardBox}>
                        <Text style={styles.rowTitle}>还没有群聊。</Text>
                        <Text style={styles.mutedText}>在群聊里，几个 Bot 和你一起做一件事。</Text>
                      </View>
                    ) : (
                      effectiveState.rooms.map((room, idx) => {
                        const memberNames = room.members
                          .map(id => effectiveState.bots.find(b => b.id === id)?.name ?? id)
                          .join('、')
                        return (
                          <View
                            key={room.id}
                            style={[
                              styles.botListRow,
                              idx > 0 && styles.topHairline,
                            ]}
                          >
                            <Pressable
                              disabled={!isLiveState}
                              onPress={() => setEditorTarget({ kind: 'room', room })}
                              style={({ pressed }) => [
                                { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
                                pressed && { opacity: 0.75 },
                              ]}
                            >
                              <Users size={20} color={colors.ink} />
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={styles.rowTitle} numberOfLines={1}>{room.name}</Text>
                                <Text style={styles.rowSub} numberOfLines={1}>
                                  {memberNames || `${room.members.length} ${s.bots.members}`}
                                </Text>
                              </View>
                              <Text style={styles.rowSub}>{`${room.members.length} 成员`}</Text>
                              <ChevronRight size={18} color={colors.subtle} />
                            </Pressable>
                            {isLiveState && !effectiveState.readOnly && (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${s.bots.delete} ${room.name}`}
                                disabled={busy}
                                hitSlop={8}
                                onPress={() => {
                                  Alert.alert(s.bots.delete, s.bots.deleteHint, [
                                    { text: s.bots.cancel, style: 'cancel' },
                                    {
                                      text: s.bots.delete,
                                      style: 'destructive',
                                      onPress: () => void perform('delete-room', { id: room.id }),
                                    },
                                  ])
                                }}
                                style={({ pressed }) => [
                                  { padding: 6 },
                                  pressed && { opacity: 0.65 },
                                  busy && { opacity: 0.4 },
                                ]}
                              >
                                <Trash2 size={17} color={colors.danger} />
                              </Pressable>
                            )}
                          </View>
                        )
                      })
                    )}
                  </GroupCard>
                </>
              )}

              {/* 6. 连接器 (ConnectorsPage — strictly aligned with Screenshot 2) */}
              {subpage === 'connectors' && (
                <DsBotConnectorsSubpage effectiveState={effectiveState} />
              )}

              {/* 7. IM (ImPage — strictly aligned with Screenshot 3) */}
              {subpage === 'im' && (
                <DsBotImSubpage effectiveState={effectiveState} mainBotName={mainBotName} />
              )}

              {/* 8. 能力 (CapabilitiesPage) */}
              {subpage === 'capabilities' && (
                <DsBotCapabilitiesSubpage
                  effectiveState={effectiveState}
                  isLiveState={isLiveState}
                  perform={perform}
                />
              )}

              {/* 9. 浏览器 (BrowserSettingsPage — strictly aligned with Screenshot 4) */}
              {subpage === 'browser' && (
                <BotBrowserGrantsSection bots={effectiveState.bots} perform={perform} />
              )}

              {/* 10. 电脑操控 (ComputerPage) */}
              {subpage === 'computer' && (
                <DsBotComputerSubpage effectiveState={effectiveState} />
              )}

              {/* 11. 定时任务 (SchedulesPage) */}
              {subpage === 'schedules' && (
                <BotSchedulesPanel state={effectiveState} client={clientInstance} />
              )}

              {/* 12. 用量 (UsagePage — strictly aligned with Screenshot 5) */}
              {subpage === 'usage' && (
                <DsBotUsageSubpage
                  effectiveState={effectiveState}
                  usageData={usageData}
                  usageLoading={usageLoading}
                  usageRange={usageRange}
                  onChangeRange={setUsageRange}
                  usageView={usageView}
                  activityYear={activityYear}
                />
              )}

              {/* 13. 密钥 (SecretsPage) */}
              {subpage === 'secrets' && (
                <DsBotSecretsSubpage effectiveState={effectiveState} />
              )}
            </View>
          </Screen>
        </BlurHeaderFrame>

        {/* Main Bot Picker Modal */}
        {mainBotPickerOpen && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setMainBotPickerOpen(false)}>
            <ModalSurface onClose={() => setMainBotPickerOpen(false)}>
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.sheetTitle}>选择主 Bot</Text>
                  <IconButton label={s.common.close} icon={X} onPress={() => setMainBotPickerOpen(false)} />
                </View>
                <GroupCard>
                  {effectiveState.bots
                    .filter(b => !b.private)
                    .map((bot, idx) => {
                      const on = bot.id === mainBot?.id
                      return (
                        <GroupRow
                          key={bot.id}
                          first={idx === 0}
                          icon={Bot}
                          label={bot.name}
                          detail={bot.role || undefined}
                          selected={on}
                          chevron={false}
                          accessory={on ? <Check size={18} color={colors.primary} strokeWidth={2.2} /> : undefined}
                          onPress={() => {
                            setMainBotPickerOpen(false)
                            if (bot.id !== mainBot?.id) {
                              void perform('set-main', {
                                id: bot.id,
                                main: true,
                                primary: true,
                                ...(mainBot?.id ? { replace: mainBot.id } : {}),
                              })
                            }
                          }}
                        />
                      )
                    })}
                </GroupCard>
              </View>
            </ModalSurface>
          </Modal>
        )}

        {/* Default Model Picker Modal */}
        {defaultModelPickerOpen && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setDefaultModelPickerOpen(false)}>
            <ModalSurface onClose={() => setDefaultModelPickerOpen(false)}>
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.sheetTitle}>{s.bots.defaultModel}</Text>
                  <IconButton label={s.common.close} icon={X} onPress={() => setDefaultModelPickerOpen(false)} />
                </View>
                <ScrollView style={{ maxHeight: 380 }}>
                  <GroupCard>
                    {effectiveState.models.length === 0 ? (
                      <GroupRow
                        first
                        label={defaultBotModel || 'deepseek/deepseek-chat'}
                        selected
                        chevron={false}
                        accessory={<Check size={18} color={colors.primary} />}
                        onPress={() => setDefaultModelPickerOpen(false)}
                      />
                    ) : (
                      effectiveState.models.map((m, idx) => {
                        const ref = text(m.ref)
                        const label = text(m.name) || text(m.label) || ref
                        const on = defaultBotModel === ref
                        return (
                          <GroupRow
                            key={ref}
                            first={idx === 0}
                            label={label}
                            detail={ref}
                            selected={on}
                            chevron={false}
                            accessory={on ? <Check size={18} color={colors.primary} /> : undefined}
                            onPress={() => {
                              setDefaultModelPickerOpen(false)
                              void setPref({ defaultBotModel: ref })
                            }}
                          />
                        )
                      })
                    )}
                  </GroupCard>
                </ScrollView>
              </View>
            </ModalSurface>
          </Modal>
        )}

        {/* Team Workspace Folder Picker */}
        <BotFolderPickerModal
          visible={teamFolderPickerOpen}
          value={effectiveState.workspaceId}
          teamMode
          client={clientInstance}
          onClose={() => setTeamFolderPickerOpen(false)}
          onPick={folder => {
            if (folder) void perform('team-workspace', { path: folder })
          }}
        />

        {/* Per-Bot Working Folder Picker */}
        <BotFolderPickerModal
          visible={botFolderTarget !== null}
          value={botFolderTarget?.workDir}
          client={clientInstance}
          onClose={() => setBotFolderTarget(null)}
          onPick={folder => {
            if (botFolderTarget) {
              void perform('update-bot', { id: botFolderTarget.id, workDir: folder })
            }
          }}
        />

        {/* Single-Bot / Group Editor */}
        {isLiveState && editorTarget && clientInstance && (
          <BotEditor
            kind={editorTarget.kind}
            bot={editorTarget.bot}
            room={editorTarget.room}
            state={effectiveState}
            client={clientInstance}
            busy={busy}
            error={visibleError}
            perform={perform}
            onClose={() => setEditorTarget(null)}
          />
        )}

        {/* Plugins Management Modal */}
        <PluginsModal visible={pluginsModalOpen} onClose={() => setPluginsModalOpen(false)} />
      </View>
    </Modal>
  )
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    contentColumn: {
      width: '100%',
      alignSelf: 'center',
      gap: spacing.sm,
    },
    loadingCardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 20,
      paddingHorizontal: 16,
    },
    rowTitle: {
      ...type.bodyStrong,
      fontSize: 15,
      color: colors.ink,
    },
    rowSub: {
      ...type.small,
      fontSize: 12.5,
      color: colors.muted,
      marginTop: 2,
    },
    topHairline: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    inlinePills: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    smallPill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
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
      color: colors.white,
      fontWeight: '600',
    },
    inlineCreateBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    inlineCreateBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.ink,
    },
    botListRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
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
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
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
    emptyCardBox: {
      paddingVertical: 24,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    mutedText: {
      fontSize: 13.5,
      color: colors.muted,
      textAlign: 'center',
    },
    helperNote: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
      paddingHorizontal: 4,
    },
    sheetTitle: {
      ...type.heading,
      fontSize: 18,
      color: colors.ink,
    },
  })
