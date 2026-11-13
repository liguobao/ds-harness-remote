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
  { id: 'claude', name: 'Claude Code', cmd: 'claude-agent-acp', get desc() { return s.dsBotSettings.localAgentDescriptions.claude } },
  { id: 'codex', name: 'Codex', cmd: 'codex', get desc() { return s.dsBotSettings.localAgentDescriptions.codex } },
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', get desc() { return s.dsBotSettings.localAgentDescriptions.opencode } },
  { id: 'hermes', name: 'Hermes Agent', cmd: 'hermes', get desc() { return s.dsBotSettings.localAgentDescriptions.hermes } },
  { id: 'cursor', name: 'Cursor Agent', cmd: 'cursor-agent', get desc() { return s.dsBotSettings.localAgentDescriptions.cursor } },
  { id: 'pi', name: 'Pi', cmd: 'pi-acp', get desc() { return s.dsBotSettings.localAgentDescriptions.pi } },
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
      { id: 'general', label: s.bots.tabGeneral, detail: s.dsBotSettings.tabDetail.general, icon: SlidersHorizontal },
      { id: 'models', label: s.bots.tabModels, detail: s.dsBotSettings.tabDetail.models, icon: Cpu },
      { id: 'local-agents', label: s.bots.tabLocalAgents, detail: s.dsBotSettings.tabDetail.localAgents, icon: Terminal },
      { id: 'bots', label: s.bots.tabBots, detail: s.dsBotSettings.tabDetail.bots, icon: Bot },
      { id: 'groups', label: s.bots.tabGroups, detail: s.dsBotSettings.tabDetail.groups, icon: Users },
      { id: 'connectors', label: s.bots.tabConnectors, detail: s.dsBotSettings.tabDetail.connectors, icon: Plug },
      { id: 'im', label: s.bots.tabIm, detail: s.dsBotSettings.tabDetail.im, icon: MessageSquareShare },
      { id: 'capabilities', label: s.bots.tabCapabilities, detail: s.dsBotSettings.tabDetail.capabilities, icon: Sparkles },
      { id: 'browser', label: s.bots.tabBrowser, detail: s.dsBotSettings.tabDetail.browser, icon: Globe },
      { id: 'computer', label: s.bots.tabComputer, detail: s.dsBotSettings.tabDetail.computer, icon: Monitor },
      { id: 'schedules', label: s.bots.tabSchedules, detail: s.dsBotSettings.tabDetail.schedules, icon: CalendarClock },
      { id: 'usage', label: s.bots.tabUsage, detail: s.dsBotSettings.tabDetail.usage, icon: ChartNoAxesColumn },
      { id: 'secrets', label: s.bots.tabSecrets, detail: s.dsBotSettings.tabDetail.secrets, icon: KeyRound },
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
            : s.dsBotSettings.defaultValue
      case 'models':
        return configuredProviderCount > 0 ? s.dsBotSettings.providersCount(configuredProviderCount) : s.dsBotSettings.modelsCount(effectiveState.models.length)
      case 'local-agents': {
        const det = objects(localAgentsData?.detected).filter(d => d.installed === true || d.available === true).length
        const dshCount = effectiveState.agents.length
        return det + dshCount > 0 ? s.dsBotSettings.enabledCount(det + dshCount) : s.dsBotSettings.agentsCount(KNOWN_LOCAL_AGENTS.length)
      }
      case 'bots':
        return s.dsBotSettings.botsSummary(mainBotName, effectiveState.bots.length)
      case 'groups':
        return s.dsBotSettings.groupsCount(effectiveState.rooms.length)
      case 'connectors':
        return connectedConnectorItems.length > 0
          ? s.dsBotSettings.connectedCount(connectedConnectorItems.length)
          : s.dsBotSettings.connectorsCount(DS_BOT_CONNECTOR_CATALOG.length)
      case 'im':
        return connectedImList.length > 0 ? s.dsBotSettings.connectedCount(connectedImList.length) : s.dsBotSettings.platformsCount(8)
      case 'capabilities':
        return (effectiveState.capabilities ?? []).length > 0
          ? s.dsBotSettings.capabilitiesCount((effectiveState.capabilities ?? []).length)
          : s.dsBotSettings.perBotAccess
      case 'browser':
        return totalBrowserGrants > 0 ? s.dsBotSettings.browserGrantsCount(totalBrowserGrants) : s.dsBotSettings.noBrowserGrants
      case 'computer':
        return effectiveState.computer?.enabled === true ? s.dsBotSettings.on : s.dsBotSettings.off
      case 'schedules':
        return s.dsBotSettings.manageTasks
      case 'usage':
        return usageView.current.tokens > 0
          ? `${formatCompactTokens(usageView.current.tokens)} Token`
          : s.dsBotSettings.viewStats
      case 'secrets':
        return s.dsBotSettings.secretsCount((effectiveState.secrets ?? []).length)
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
          <SectionTitle>{s.dsBotSettings.pluginStatus}</SectionTitle>
          <GroupCard>
            <GroupRow
              first
              icon={CircleAlert}
              label={s.dsBotSettings.hostNotConnected}
              detail={
                selectedDevice
                  ? s.dsBotSettings.hostOffline(selectedDevice.name)
                  : s.bots.dsBotSettingsDisconnected
              }
              chevron={false}
            />
          </GroupCard>
          <DsBotInstallCard error={s.dsBotSettings.hostOfflineOrMissing} onRetry={() => void handleRetryAll()} />
        </View>
      )
    }

    if (isPluginDisabled) {
      return (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{s.dsBotSettings.pluginStatus}</SectionTitle>
          <GroupCard>
            <GroupRow
              first
              icon={CircleAlert}
              label={s.dsBotSettings.pluginDisabled}
              detail={s.dsBotSettings.pluginDisabledDetail}
              chevron={false}
            />
            <GroupRow
              icon={Sparkles}
              label={enablingPlugin ? s.dsBotSettings.enablingPlugin : s.dsBotSettings.enablePlugin}
              disabled={enablingPlugin}
              onPress={() => void handleEnableDsBot()}
            />
            <GroupRow
              icon={Plug}
              label={s.dsBotSettings.openPluginManager}
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
            <Text style={styles.mutedText}>{s.dsBotSettings.checkingPlugin}</Text>
          </View>
        </GroupCard>
      )
    }

    if (isPluginNotInstalled) {
      return (
        <View style={{ gap: spacing.xs }}>
          <SectionTitle>{s.dsBotSettings.pluginNotFound}</SectionTitle>
          <DsBotInstallCard
            error={visibleError ?? s.bots.notInstalled}
            onRetry={() => void handleRetryAll()}
          />
          <GroupCard>
            <GroupRow
              first
              icon={Plug}
              label={s.dsBotSettings.checkPluginManager}
              detail={s.dsBotSettings.checkPluginManagerDetail}
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

                  <SectionTitle>{s.dsBotSettings.sectionBasics}</SectionTitle>
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

                  <SectionTitle>{s.dsBotSettings.sectionTeam}</SectionTitle>
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

                  <SectionTitle>{s.dsBotSettings.sectionChannels}</SectionTitle>
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

                  <SectionTitle>{s.dsBotSettings.sectionPermissions}</SectionTitle>
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

                  <SectionTitle>{s.dsBotSettings.sectionTasks}</SectionTitle>
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
                    label={connected ? s.dsBotSettings.previewPluginMissing : s.dsBotSettings.previewNoHost}
                    detail={s.dsBotSettings.previewDetail}
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
                      detail={s.dsBotSettings.defaultModelDetail}
                      value={defaultBotModel ? defaultBotModel.split('/').pop() : s.dsBotSettings.defaultValue}
                      chevron
                      onPress={() => setDefaultModelPickerOpen(true)}
                    />
                  </GroupCard>

                  <SectionTitle>{s.dsBotSettings.sectionConversation}</SectionTitle>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Sparkles}
                      label={s.bots.showThinking}
                      detail={s.dsBotSettings.showThinkingDetail}
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
                      detail={s.dsBotSettings.enterToSendDetail}
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

                  <SectionTitle>{s.dsBotSettings.sectionLocation}</SectionTitle>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Folder}
                      label={s.bots.teamWorkspace}
                      detail={s.dsBotSettings.teamWorkspaceDetail}
                      value={effectiveState.workspaceId ? folderBasename(effectiveState.workspaceId) : s.dsBotSettings.defaultValue}
                      chevron
                      disabled={!isLiveState}
                      onPress={() => setTeamFolderPickerOpen(true)}
                    />
                  </GroupCard>

                  <SectionTitle>{s.dsBotSettings.sectionBotFolders}</SectionTitle>
                  <GroupCard>
                    {effectiveState.bots.map((bot, idx) => (
                      <GroupRow
                        key={bot.id}
                        first={idx === 0}
                        icon={Folder}
                        label={bot.name}
                        detail={bot.workDir ? folderBasename(bot.workDir) : s.dsBotSettings.followTeamWorkspace}
                        value={bot.private ? s.bots.privateBot : undefined}
                        chevron
                        disabled={!isLiveState}
                        onPress={() => setBotFolderTarget(bot)}
                      />
                    ))}
                  </GroupCard>

                  {(effectiveState.privateArchives ?? []).length > 0 && (
                    <>
                      <SectionTitle>{s.dsBotSettings.protectedArchives((effectiveState.privateArchives ?? []).length)}</SectionTitle>
                      <GroupCard>
                        {(effectiveState.privateArchives ?? []).map((arc, idx) => (
                          <GroupRow
                            key={text(arc.id) || `arc-${idx}`}
                            first={idx === 0}
                            icon={ShieldCheck}
                            label={text(arc.name) || s.dsBotSettings.deletedPrivateBot}
                            detail={s.dsBotSettings.protectedArchiveDetail}
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
                  <SectionTitle>{s.dsBotSettings.sectionConfiguredProviders}</SectionTitle>
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
                            detail={s.dsBotSettings.noProviderDetail}
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
                                {`${s.dsBotSettings.modelsCount(pmodels.length)} · ${configured ? s.dsBotSettings.keyConfigured : s.dsBotSettings.apiKeyRequired}`}
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

                  <SectionTitle>{s.dsBotSettings.sectionPopularProviders}</SectionTitle>
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
                          value={isConfigured ? s.dsBotSettings.ready : s.dsBotSettings.configureOnComputer}
                          chevron={false}
                        />
                      )
                    })}
                  </GroupCard>

                  <SectionTitle>{s.dsBotSettings.sectionLocalServers}</SectionTitle>
                  <GroupCard>
                    {DS_BOT_LOCAL_SERVERS.map((srv, idx) => (
                      <GroupRow
                        key={srv.id}
                        first={idx === 0}
                        icon={Terminal}
                        label={srv.name}
                        detail={srv.endpoint}
                        value={s.dsBotSettings.localEndpoint}
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
                    {s.dsBotSettings.localAgentsNote}
                  </Text>

                  <SectionTitle>{s.dsBotSettings.sectionNativeSessions}</SectionTitle>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Bot}
                      label="DSH Agent"
                      detail={s.dsBotSettings.dshAgentDetail}
                      value={effectiveState.agents.length > 0 ? s.dsBotSettings.added : s.dsBotSettings.notAdded}
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

                  <SectionTitle>{s.dsBotSettings.sectionLocalAgents}</SectionTitle>
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
                          value={ready ? s.dsBotSettings.ready : s.dsBotSettings.notDetected}
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
                      label={s.dsBotSettings.mainBot}
                      detail={s.dsBotSettings.mainBotDetail}
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
                        <Text style={styles.rowSub}>{s.dsBotSettings.motionDetail}</Text>
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
                                  <Text style={[styles.statusBadgeText, { color: colors.primary }]}>{s.dsBotSettings.mainBot}</Text>
                                </View>
                              )}
                              {bot.private && (
                                <View style={styles.statusBadge}>
                                  <Text style={styles.statusBadgeText}>{s.bots.privateBot}</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.rowSub} numberOfLines={1}>
                              {bot.instructions || (bot.model || effectiveState.defaultModel) || s.dsBotSettings.botCardHint}
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
                    {s.dsBotSettings.groupsTitle(effectiveState.rooms.length)}
                  </SectionTitle>

                  <GroupCard>
                    {effectiveState.rooms.length === 0 ? (
                      <View style={styles.emptyCardBox}>
                        <Text style={styles.rowTitle}>{s.dsBotSettings.noGroups}</Text>
                        <Text style={styles.mutedText}>{s.dsBotSettings.noGroupsHint}</Text>
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
                              <Text style={styles.rowSub}>{s.dsBotSettings.membersCount(room.members.length)}</Text>
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
                  <Text style={styles.sheetTitle}>{s.dsBotSettings.chooseMainBot}</Text>
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
