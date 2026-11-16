import { useState } from 'react'
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
  Check,
  Folder,
  Globe,
  KeyRound,
  MessageSquareShare,
  Monitor,
  Plug,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  X,
} from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import {
  object,
  objects,
  text,
  type BotObject,
  type BotState,
} from '../../services/bot-catalog'
import {
  Button,
  GroupCard,
  GroupRow,
  IconButton,
  SectionTitle,
} from '../../ui/components'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ModalSurface } from '../chat/modal'
import { BotAvatar } from './avatar'
import {
  DS_BOT_CONNECTOR_CATALOG,
  DS_BOT_CONNECTOR_CATEGORIES,
  DS_BOT_IM_PLATFORMS,
  DS_BOT_RECOMMENDED_CONNECTOR_IDS,
  type ActivityYearSummary,
  type ConnectorCatalogItem,
  type ImPlatformCatalogItem,
  type UsageRangeId,
  type UsageViewSummary,
} from './ds-bot-usage-data'
import { formatCompactTokens, type BotPerformFn } from './shared-panels'

export function DsBotConnectorsSubpage({
  effectiveState,
}: {
  effectiveState: BotState
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSubStyles)
  const [connectorQuery, setConnectorQuery] = useState('')
  const [connectorCat, setConnectorCat] = useState('all')
  const [selectedConnector, setSelectedConnector] = useState<ConnectorCatalogItem | null>(null)
  const [customConnectorGuideOpen, setCustomConnectorGuideOpen] = useState(false)

  const renderConnectorRow = (conn: ConnectorCatalogItem, first: boolean) => {
    const remoteItems = objects(effectiveState.connectors?.items)
    const live = remoteItems.find(
      it => text(it.id) === conn.id || text(it.name).toLowerCase() === conn.name.toLowerCase(),
    )
    const isConnected = Boolean(live && (live.connected === true || text(live.status) === 'connected'))
    const toolCount = Number(live?.toolCount ?? live?.tools ?? 0)
    return (
      <View key={conn.id} style={[styles.connectorRow, !first && styles.topHairline]}>
        <View style={[styles.brandBadge, { backgroundColor: `${conn.color}18` }]}>
          <Text style={[styles.brandBadgeText, { color: conn.color }]}>
            {conn.name.slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{conn.name}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {isConnected && toolCount > 0 ? s.dsBotSettings.connectedTools(toolCount) : conn.desc}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isConnected ? s.dsBotSettings.connectedName(conn.name) : s.dsBotSettings.connectName(conn.name)}
          onPress={() => setSelectedConnector(conn)}
          style={({ pressed }) => [
            styles.connectBtn,
            isConnected && styles.connectBtnConnected,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text style={[styles.connectBtnText, isConnected && { color: colors.primary }]}>
            {isConnected ? s.dsBotSettings.connected : s.dsBotSettings.connect}
          </Text>
        </Pressable>
      </View>
    )
  }

  const q = connectorQuery.trim().toLowerCase()

  return (
    <>
      <View style={styles.searchToolbar}>
        <View style={styles.searchBox}>
          <Search size={16} color={colors.muted} />
          <TextInput
            value={connectorQuery}
            onChangeText={setConnectorQuery}
            placeholder={s.dsBotSettings.searchConnectors}
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
          />
          {Boolean(connectorQuery) && (
            <Pressable onPress={() => setConnectorQuery('')} hitSlop={8}>
              <X size={15} color={colors.muted} />
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setCustomConnectorGuideOpen(true)}
          style={({ pressed }) => [styles.inlineCreateBtn, pressed && { opacity: 0.75 }]}
        >
          <Plus size={15} color={colors.ink} />
          <Text style={styles.inlineCreateBtnText}>{s.dsBotSettings.custom}</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      >
        {DS_BOT_CONNECTOR_CATEGORIES.map(cat => {
          const on = connectorCat === cat.id
          return (
            <Pressable
              key={cat.id}
              onPress={() => setConnectorCat(cat.id)}
              style={[styles.smallPill, on && styles.smallPillActive]}
            >
              <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>
                {cat.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {connectorCat === 'all' && !q ? (
        <>
          <SectionTitle>{s.dsBotSettings.recommended}</SectionTitle>
          <GroupCard>
            {DS_BOT_RECOMMENDED_CONNECTOR_IDS.map(
              id => DS_BOT_CONNECTOR_CATALOG.find(c => c.id === id)!,
            )
              .filter(Boolean)
              .map((conn, idx) => renderConnectorRow(conn, idx === 0))}
          </GroupCard>

          {DS_BOT_CONNECTOR_CATEGORIES.filter(c => c.id !== 'all').map(cat => {
            const items = DS_BOT_CONNECTOR_CATALOG.filter(c => c.category === cat.id)
            if (items.length === 0) return null
            return (
              <View key={cat.id} style={{ gap: spacing.xs }}>
                <SectionTitle>{cat.label}</SectionTitle>
                <GroupCard>
                  {items.map((conn, idx) => renderConnectorRow(conn, idx === 0))}
                </GroupCard>
              </View>
            )
          })}
        </>
      ) : (
        (() => {
          const filtered = DS_BOT_CONNECTOR_CATALOG.filter(
            c =>
              (connectorCat === 'all' || c.category === connectorCat)
              && (!q || `${c.name} ${c.desc} ${c.id}`.toLowerCase().includes(q)),
          )
          if (filtered.length === 0) {
            return (
              <GroupCard>
                <View style={styles.emptyCardBox}>
                  <Text style={styles.mutedText}>{s.dsBotSettings.noMatchingConnectors}</Text>
                </View>
              </GroupCard>
            )
          }
          return (
            <GroupCard>
              {filtered.map((conn, idx) => renderConnectorRow(conn, idx === 0))}
            </GroupCard>
          )
        })()
      )}

      {selectedConnector && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedConnector(null)}>
          <ModalSurface onClose={() => setSelectedConnector(null)}>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.sheetTitle}>{selectedConnector.name}</Text>
                <IconButton label={s.common.close} icon={X} onPress={() => setSelectedConnector(null)} />
              </View>
              <Text style={styles.rowSub}>{selectedConnector.desc}</Text>
              <GroupCard>
                <GroupRow
                  first
                  icon={Plug}
                  label={s.dsBotSettings.authMethod}
                  value={
                    selectedConnector.authKind === 'oauth'
                      ? s.dsBotSettings.authOauth
                      : selectedConnector.authKind === 'mail'
                        ? s.dsBotSettings.authMail
                        : selectedConnector.authKind === 'key'
                          ? s.dsBotSettings.authKey
                          : s.dsBotSettings.authNone
                  }
                  chevron={false}
                />
                <GroupRow
                  icon={Monitor}
                  label={s.dsBotSettings.setupNotes}
                  detail={s.dsBotSettings.connectorSetupDetail}
                  chevron={false}
                />
              </GroupCard>
              <Button label={s.common.close} variant="secondary" onPress={() => setSelectedConnector(null)} />
            </View>
          </ModalSurface>
        </Modal>
      )}

      {customConnectorGuideOpen && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setCustomConnectorGuideOpen(false)}>
          <ModalSurface onClose={() => setCustomConnectorGuideOpen(false)}>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.sheetTitle}>{s.dsBotSettings.addCustomConnector}</Text>
                <IconButton label={s.common.close} icon={X} onPress={() => setCustomConnectorGuideOpen(false)} />
              </View>
              <Text style={styles.rowSub}>
                {s.dsBotSettings.customConnectorIntro}
              </Text>
              <GroupCard>
                <GroupRow
                  first
                  icon={Globe}
                  label={s.dsBotSettings.remoteMcp}
                  detail={s.dsBotSettings.remoteMcpDetail}
                  chevron={false}
                />
                <GroupRow
                  icon={Terminal}
                  label={s.dsBotSettings.localMcp}
                  detail={s.dsBotSettings.localMcpDetail}
                  chevron={false}
                />
              </GroupCard>
              <Text style={styles.helperNote}>
                {s.dsBotSettings.customConnectorNote}
              </Text>
              <Button label={s.common.close} variant="secondary" onPress={() => setCustomConnectorGuideOpen(false)} />
            </View>
          </ModalSurface>
        </Modal>
      )}
    </>
  )
}

export function DsBotImSubpage({
  effectiveState,
  mainBotName,
}: {
  effectiveState: BotState
  mainBotName: string
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSubStyles)
  const [selectedImPlatform, setSelectedImPlatform] = useState<ImPlatformCatalogItem | null>(null)
  const connectedImList = objects(effectiveState.im?.connections ?? effectiveState.im?.bots)

  return (
    <>
      {connectedImList.length > 0 && (
        <>
          <SectionTitle>{s.dsBotSettings.imConnectedTitle(connectedImList.length)}</SectionTitle>
          <GroupCard>
            {connectedImList.map((conn, idx) => {
              const cid = text(conn.id) || `im-${idx}`
              const platId = text(conn.platform)
              const plat = DS_BOT_IM_PLATFORMS.find(p => p.id === platId)
              const botTarget = effectiveState.bots.find(b => b.id === text(conn.botId))?.name ?? mainBotName
              const statusObj = object(effectiveState.imStatus?.[cid])
              const online = statusObj.connected === true || text(statusObj.state) === 'connected'
              return (
                <GroupRow
                  key={cid}
                  first={idx === 0}
                  icon={MessageSquareShare}
                  label={text(conn.name) || plat?.name || platId}
                  detail={s.dsBotSettings.imRoutesTo(botTarget)}
                  value={online ? s.dsBotSettings.running : s.dsBotSettings.configured}
                  chevron={false}
                />
              )
            })}
          </GroupCard>
        </>
      )}

      <SectionTitle>{s.dsBotSettings.choosePlatform}</SectionTitle>
      <GroupCard>
        {DS_BOT_IM_PLATFORMS.map((plat, idx) => {
          const configuredCount = connectedImList.filter(b => text(b.platform) === plat.id).length
          return (
            <View key={plat.id} style={[styles.connectorRow, idx > 0 && styles.topHairline]}>
              <View style={[styles.brandBadge, { backgroundColor: `${plat.color}18` }]}>
                <Text style={[styles.brandBadgeText, { color: plat.color }]}>{plat.glyph}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle}>{plat.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{plat.sub}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.dsBotSettings.connectName(plat.name)}
                onPress={() => setSelectedImPlatform(plat)}
                style={({ pressed }) => [
                  styles.connectBtn,
                  configuredCount > 0 && styles.connectBtnConnected,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text style={[styles.connectBtnText, configuredCount > 0 && { color: colors.primary }]}>
                  {configuredCount > 0 ? s.dsBotSettings.imConnectedCount(configuredCount) : s.dsBotSettings.connect}
                </Text>
              </Pressable>
            </View>
          )
        })}
      </GroupCard>

      {selectedImPlatform && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedImPlatform(null)}>
          <ModalSurface onClose={() => setSelectedImPlatform(null)}>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.sheetTitle}>{s.dsBotSettings.connectName(selectedImPlatform.name)}</Text>
                <IconButton label={s.common.close} icon={X} onPress={() => setSelectedImPlatform(null)} />
              </View>
              <Text style={styles.rowSub}>{selectedImPlatform.sub}</Text>
              <GroupCard>
                <GroupRow
                  first
                  icon={KeyRound}
                  label={s.dsBotSettings.requiredCredentials}
                  value={selectedImPlatform.fieldsHint}
                  chevron={false}
                />
                <GroupRow
                  icon={Monitor}
                  label={s.dsBotSettings.imSetupMethod}
                  detail={s.dsBotSettings.imSetupDetail(selectedImPlatform.name)}
                  chevron={false}
                />
              </GroupCard>
              <Button label={s.common.close} variant="secondary" onPress={() => setSelectedImPlatform(null)} />
            </View>
          </ModalSurface>
        </Modal>
      )}
    </>
  )
}

export function DsBotCapabilitiesSubpage({
  effectiveState,
  isLiveState,
  perform,
}: {
  effectiveState: BotState
  isLiveState: boolean
  perform: BotPerformFn
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSubStyles)
  const [capabilityBotId, setCapabilityBotId] = useState<string>(
    effectiveState.mainBotId ?? effectiveState.bots[0]?.id ?? '',
  )

  const targetBot =
    effectiveState.bots.find(b => b.id === capabilityBotId) ?? effectiveState.bots[0]
  const currentPerm = targetBot?.permission || 'default'

  return (
    <>
      <Text style={styles.helperNote}>
        {s.dsBotSettings.capabilitiesNote}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {effectiveState.bots.map(bot => {
          const on = bot.id === targetBot?.id
          return (
            <Pressable
              key={bot.id}
              onPress={() => setCapabilityBotId(bot.id)}
              style={[styles.smallPill, on && styles.smallPillActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
            >
              <BotAvatar bot={bot} size={18} />
              <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>{bot.name}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      <SectionTitle>{s.dsBotSettings.sectionToolPermissions}</SectionTitle>
      <GroupCard>
        {([
          { id: 'default', label: s.dsBotSettings.permDefault, desc: s.dsBotSettings.permDefaultDetail },
          { id: 'workspace-write', label: s.dsBotSettings.permWorkspaceWrite, desc: s.dsBotSettings.permWorkspaceWriteDetail },
          { id: 'danger-full-access', label: s.dsBotSettings.permFullAccess, desc: s.dsBotSettings.permFullAccessDetail },
        ] as const).map((opt, idx) => {
          const chosen = currentPerm === opt.id
          return (
            <GroupRow
              key={opt.id}
              first={idx === 0}
              icon={ShieldCheck}
              label={opt.label}
              detail={opt.desc}
              selected={chosen}
              chevron={false}
              disabled={!isLiveState || !targetBot}
              accessory={chosen ? <Check size={18} color={colors.primary} strokeWidth={2.2} /> : undefined}
              onPress={() => {
                if (targetBot) {
                  void perform('update-bot', { id: targetBot.id, permission: opt.id })
                }
              }}
            />
          )
        })}
      </GroupCard>

      <SectionTitle>{s.dsBotSettings.sectionBuiltinCapabilities}</SectionTitle>
      <GroupCard>
        <GroupRow
          first
          icon={Folder}
          label={s.dsBotSettings.capWorkspace}
          detail={s.dsBotSettings.capWorkspaceDetail}
          value={s.dsBotSettings.enabled}
          chevron={false}
        />
        <GroupRow
          icon={Globe}
          label={s.dsBotSettings.capWeb}
          detail={s.dsBotSettings.capWebDetail}
          value={effectiveState.browser !== false ? s.dsBotSettings.enabled : s.dsBotSettings.disabled}
          chevron={false}
        />
        <GroupRow
          icon={Users}
          label={s.dsBotSettings.capTeam}
          detail={s.dsBotSettings.capTeamDetail}
          value={targetBot?.private ? s.dsBotSettings.privateIsolated : s.dsBotSettings.enabled}
          chevron={false}
        />
        <GroupRow
          icon={CalendarClock}
          label={s.dsBotSettings.capMemory}
          detail={s.dsBotSettings.capMemoryDetail}
          value={effectiveState.memory !== false ? s.dsBotSettings.enabled : s.dsBotSettings.tasksAndSecretsOnly}
          chevron={false}
        />
      </GroupCard>

      {(effectiveState.capabilities ?? []).length > 0 && (
        <>
          <SectionTitle>{s.dsBotSettings.sectionSharedCapabilities}</SectionTitle>
          <GroupCard>
            {(effectiveState.capabilities ?? []).map((cap, idx) => {
              const cid = text(cap.id) || `cap-${idx}`
              const statusObj = object(effectiveState.capabilityStatuses?.[cid])
              const statusText = text(statusObj.state) || text(cap.kind) || s.dsBotSettings.ready
              return (
                <GroupRow
                  key={cid}
                  first={idx === 0}
                  icon={Sparkles}
                  label={text(cap.name) || cid}
                  detail={text(cap.description) || undefined}
                  value={statusText}
                  chevron={false}
                />
              )
            })}
          </GroupCard>
        </>
      )}
    </>
  )
}

export function DsBotComputerSubpage({
  effectiveState,
}: {
  effectiveState: BotState
}) {
  const styles = useThemedStyles(createSubStyles)
  return (
    <>
      <GroupCard>
        <GroupRow
          first
          icon={Monitor}
          label={s.dsBotSettings.allowComputerUse}
          detail={s.bots.computerDesc}
          value={effectiveState.computer?.enabled === true ? s.bots.computerIdle : s.dsBotSettings.disabled}
          chevron={false}
        />
      </GroupCard>

      <SectionTitle>{s.dsBotSettings.sectionComputerLevels}</SectionTitle>
      <GroupCard>
        {effectiveState.bots.map((bot, idx) => {
          const rawLevel = text(object(effectiveState.computer?.levels)[bot.id]) || 'off'
          const levelLabel =
            rawLevel === 'foreground'
              ? s.dsBotSettings.levelForeground
              : rawLevel === 'background'
                ? s.dsBotSettings.levelBackground
                : rawLevel === 'view'
                  ? s.dsBotSettings.levelView
                  : s.dsBotSettings.off
          return (
            <GroupRow
              key={bot.id}
              first={idx === 0}
              icon={Bot}
              label={bot.name}
              detail={bot.role || undefined}
              value={levelLabel}
              chevron={false}
            />
          )
        })}
      </GroupCard>
      <Text style={styles.helperNote}>
        {s.dsBotSettings.computerNote}
      </Text>
    </>
  )
}

export function DsBotUsageSubpage({
  effectiveState,
  usageData,
  usageLoading,
  usageRange,
  onChangeRange,
  usageView,
  activityYear,
}: {
  effectiveState: BotState
  usageData: BotObject | null
  usageLoading: boolean
  usageRange: UsageRangeId
  onChangeRange: (next: UsageRangeId) => void
  usageView: UsageViewSummary
  activityYear: ActivityYearSummary
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSubStyles)
  const [usageChartGroup, setUsageChartGroup] = useState<'owner' | 'model'>('owner')

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {(['24h', '7d', '30d', '12w', '12m', 'all'] as const).map(id => {
          const label = s.dsBotSettings.ranges[id]
          const on = usageRange === id
          return (
            <Pressable
              key={id}
              onPress={() => onChangeRange(id)}
              style={[styles.smallPill, on && styles.smallPillActive]}
            >
              <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>{label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {usageLoading && !usageData ? (
        <GroupCard>
          <View style={styles.loadingCardRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.mutedText}>{s.dsBotSettings.loadingUsage}</Text>
          </View>
        </GroupCard>
      ) : (
        <>
          <View style={styles.kpiGrid}>
            <GroupCard style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>
                {usageRange === 'all' ? s.dsBotSettings.allUsageTokens : s.dsBotSettings.recentTokens(usageView.rangeLabel)}
              </Text>
              <Text style={styles.kpiValue}>{formatCompactTokens(usageView.current.tokens)}</Text>
              <Text style={styles.kpiSub} numberOfLines={1}>
                {s.dsBotSettings.inputOutput(formatCompactTokens(usageView.current.input + usageView.current.cacheRead + usageView.current.cacheWrite), formatCompactTokens(usageView.current.output))}
              </Text>
            </GroupCard>

            <GroupCard style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>{s.dsBotSettings.cacheHitRate}</Text>
              <Text style={styles.kpiValue}>{`${usageView.current.hitRate}%`}</Text>
              <Text style={styles.kpiSub} numberOfLines={1}>
                {s.dsBotSettings.cacheHitInput(formatCompactTokens(usageView.current.cacheRead), formatCompactTokens(usageView.current.input))}
              </Text>
            </GroupCard>

            <GroupCard style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>{s.dsBotSettings.output}</Text>
              <Text style={styles.kpiValue}>{formatCompactTokens(usageView.current.output)}</Text>
              <Text style={styles.kpiSub} numberOfLines={1}>
                {usageView.current.tokens > 0
                  ? s.dsBotSettings.outputShare(usageView.rangeLabel, Math.round((usageView.current.output / usageView.current.tokens) * 100))
                  : s.dsBotSettings.noOutputTokens}
              </Text>
            </GroupCard>

            <GroupCard style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>{s.dsBotSettings.calls}</Text>
              <Text style={styles.kpiValue}>{usageView.current.calls.toLocaleString()}</Text>
              <Text style={styles.kpiSub} numberOfLines={1}>
                {s.dsBotSettings.stepPeak(usageView.stepLabel, formatCompactTokens(usageView.peakBucketTokens))}
              </Text>
            </GroupCard>
          </View>

          <GroupCard style={{ padding: 15, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={styles.rowTitle}>{s.dsBotSettings.tokenTrend}</Text>
                <Text style={styles.rowSub}>{`${formatCompactTokens(usageView.current.tokens)} Token`}</Text>
              </View>
              <View style={styles.inlinePills}>
                {([
                  ['owner', s.dsBotSettings.byBot],
                  ['model', s.dsBotSettings.byModel],
                ] as const).map(([id, label]) => {
                  const on = usageChartGroup === id
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setUsageChartGroup(id)}
                      style={[styles.smallPill, on && styles.smallPillActive]}
                    >
                      <Text style={[styles.smallPillText, on && styles.smallPillTextActive]}>{label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            <View style={styles.chartPlot}>
              {usageView.buckets.slice(-14).map(b => {
                const ratio =
                  usageView.peakBucketTokens > 0
                    ? Math.max(0.04, b.tokens / usageView.peakBucketTokens)
                    : 0
                return (
                  <View key={b.key} style={styles.chartCol}>
                    <View style={styles.chartBarTrack}>
                      {b.tokens > 0 && (
                        <View
                          style={[
                            styles.chartBarFill,
                            {
                              height: `${Math.round(ratio * 100)}%`,
                              backgroundColor: colors.primary,
                            },
                          ]}
                        />
                      )}
                    </View>
                    <Text style={styles.chartAxisLabel} numberOfLines={1}>
                      {b.label}
                    </Text>
                  </View>
                )
              })}
            </View>

            {(usageChartGroup === 'owner' ? usageView.byOwner : usageView.byModel).length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {(usageChartGroup === 'owner' ? usageView.byOwner : usageView.byModel)
                  .slice(0, 6)
                  .map(item => (
                    <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                      <Text style={styles.rowSub}>{item.name}</Text>
                    </View>
                  ))}
              </View>
            )}
          </GroupCard>

          <GroupCard style={{ padding: 15, gap: 12 }}>
            <Text style={styles.rowTitle}>{s.dsBotSettings.byBot}</Text>
            {usageView.byOwner.length === 0 ? (
              <Text style={styles.rowSub}>{s.dsBotSettings.noUsageInRange}</Text>
            ) : (
              usageView.byOwner.map(item => {
                const matchedBot = effectiveState.bots.find(b => b.id === item.id || b.name === item.name)
                return (
                  <View key={item.key} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {matchedBot ? (
                        <BotAvatar bot={matchedBot} size={28} />
                      ) : (
                        <View style={[styles.legendDot, { width: 12, height: 12, borderRadius: 6, backgroundColor: item.color }]} />
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.rowTitle}>{item.name}</Text>
                          <Text style={styles.rowTitle}>
                            {`${formatCompactTokens(item.tokens)} · ${item.sharePct}%`}
                          </Text>
                        </View>
                        <Text style={styles.rowSub}>
                          {s.dsBotSettings.callsInputOutput(item.calls, formatCompactTokens(item.input + item.cacheRead + item.cacheWrite), formatCompactTokens(item.output))}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.progressBarTrack}>
                      <View
                        style={[
                          styles.progressBarFill,
                          { width: `${Math.max(4, item.sharePct)}%`, backgroundColor: item.color },
                        ]}
                      />
                    </View>
                  </View>
                )
              })
            )}
          </GroupCard>

          <GroupCard style={{ padding: 15, gap: 12 }}>
            <Text style={styles.rowTitle}>{s.dsBotSettings.byModel}</Text>
            {usageView.byModel.length === 0 ? (
              <Text style={styles.rowSub}>{s.dsBotSettings.noUsageInRange}</Text>
            ) : (
              usageView.byModel.map(item => (
                <View key={item.key} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={[styles.legendDot, { width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }]} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                          {Boolean(item.sub) && (
                            <View style={styles.tagChip}>
                              <Text style={styles.tagChipText}>{item.sub}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.rowTitle}>
                          {`${formatCompactTokens(item.tokens)} · ${item.sharePct}%`}
                        </Text>
                      </View>
                      <Text style={styles.rowSub}>
                        {s.dsBotSettings.callsInputOutput(item.calls, formatCompactTokens(item.input + item.cacheRead + item.cacheWrite), formatCompactTokens(item.output))}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${Math.max(4, item.sharePct)}%`, backgroundColor: item.color },
                      ]}
                    />
                  </View>
                </View>
              ))
            )}
          </GroupCard>

          <GroupCard style={{ padding: 15, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.rowTitle}>{s.dsBotSettings.activity}</Text>
              <Text style={styles.rowSub}>{s.dsBotSettings.activeDays(activityYear.activeDays)}</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 3 }}>
                {activityYear.weeks.map((week, wIdx) => (
                  <View key={wIdx} style={{ gap: 3 }}>
                    {week.map(cell => {
                      const cellColors = [
                        colors.grouped,
                        `${colors.primary}38`,
                        `${colors.primary}70`,
                        `${colors.primary}B0`,
                        colors.primary,
                      ]
                      return (
                        <View
                          key={cell.date}
                          style={[
                            styles.heatCell,
                            { backgroundColor: cellColors[cell.level] },
                          ]}
                        />
                      )
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              <Text style={styles.chartAxisLabel}>{s.dsBotSettings.less}</Text>
              {[0, 1, 2, 3, 4].map(lvl => {
                const cellColors = [
                  colors.grouped,
                  `${colors.primary}38`,
                  `${colors.primary}70`,
                  `${colors.primary}B0`,
                  colors.primary,
                ]
                return (
                  <View
                    key={lvl}
                    style={[styles.heatCell, { backgroundColor: cellColors[lvl] }]}
                  />
                )
              })}
              <Text style={styles.chartAxisLabel}>{s.dsBotSettings.more}</Text>
            </View>
          </GroupCard>
        </>
      )}
    </>
  )
}

export function DsBotSecretsSubpage({
  effectiveState,
}: {
  effectiveState: BotState
}) {
  const styles = useThemedStyles(createSubStyles)
  return (
    <>
      <Text style={styles.helperNote}>
        {s.dsBotSettings.secretsNote}
      </Text>

      <SectionTitle>{s.dsBotSettings.secretsTitle((effectiveState.secrets ?? []).length)}</SectionTitle>
      <GroupCard>
        {(effectiveState.secrets ?? []).length === 0 ? (
          <View style={styles.emptyCardBox}>
            <Text style={styles.mutedText}>
              {s.dsBotSettings.noSecrets}
            </Text>
          </View>
        ) : (
          (effectiveState.secrets ?? []).map((sec, idx) => {
            const name = text(sec.name) || `SECRET_${idx}`
            const scopeText =
              Array.isArray(sec.bots) && sec.bots.length > 0
                ? s.dsBotSettings.secretBotsOnly(sec.bots.length)
                : s.dsBotSettings.secretAllBots
            return (
              <GroupRow
                key={name}
                first={idx === 0}
                icon={KeyRound}
                label={name}
                detail={text(sec.purpose) || scopeText}
                value={scopeText}
                chevron={false}
              />
            )
          })
        )}
      </GroupCard>
    </>
  )
}

const createSubStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    searchToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    searchBox: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      height: 40,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.ink,
      paddingVertical: 0,
    },
    connectorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    brandBadge: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandBadgeText: {
      fontSize: 13,
      fontWeight: '700',
    },
    connectBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.grouped,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    connectBtnConnected: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primarySoft,
    },
    connectBtnText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.ink,
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
    kpiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    kpiCard: {
      flexBasis: '47%',
      flexGrow: 1,
      padding: 14,
      gap: 4,
    },
    kpiLabel: {
      fontSize: 12,
      color: colors.muted,
    },
    kpiValue: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.ink,
      marginVertical: 2,
    },
    kpiSub: {
      fontSize: 11.5,
      color: colors.muted,
    },
    chartPlot: {
      height: 120,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 4,
      paddingTop: 8,
    },
    chartCol: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    chartBarTrack: {
      width: '100%',
      maxWidth: 22,
      height: 92,
      borderRadius: 5,
      backgroundColor: colors.grouped,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    chartBarFill: {
      width: '100%',
      borderRadius: 5,
    },
    chartAxisLabel: {
      fontSize: 10,
      color: colors.muted,
    },
    legendDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    progressBarTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.grouped,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      borderRadius: 3,
    },
    heatCell: {
      width: 11,
      height: 11,
      borderRadius: 2.5,
    },
  })
