import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
            {isConnected && toolCount > 0 ? `已连接 · ${toolCount} 个工具` : conn.desc}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${isConnected ? '已连接' : '连接'} ${conn.name}`}
          onPress={() => setSelectedConnector(conn)}
          style={({ pressed }) => [
            styles.connectBtn,
            isConnected && styles.connectBtnConnected,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text style={[styles.connectBtnText, isConnected && { color: colors.primary }]}>
            {isConnected ? '已连接' : '连接'}
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
            placeholder="搜索连接器"
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
          <Text style={styles.inlineCreateBtnText}>自定义</Text>
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
          <SectionTitle>推荐</SectionTitle>
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
                  <Text style={styles.mutedText}>没有匹配的连接器</Text>
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
                  label="认证方式"
                  value={
                    selectedConnector.authKind === 'oauth'
                      ? 'OAuth 浏览器授权'
                      : selectedConnector.authKind === 'mail'
                        ? 'IMAP / SMTP 授权码'
                        : selectedConnector.authKind === 'key'
                          ? 'API 密钥'
                          : '免密直连 MCP'
                  }
                  chevron={false}
                />
                <GroupRow
                  icon={Monitor}
                  label="配置说明"
                  detail="为保护第三方账号凭证安全，连接器授权与密钥填写需在电脑端 DS Bot「设置 → 连接器」中操作，连接后所有 Bot 即可在手机端对话中直接调用。"
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
                <Text style={styles.sheetTitle}>添加自定义连接器</Text>
                <IconButton label={s.common.close} icon={X} onPress={() => setCustomConnectorGuideOpen(false)} />
              </View>
              <Text style={styles.rowSub}>
                支持接入远程 HTTP MCP 地址、本地命令行 MCP 服务，或从 Claude Desktop、Cursor、VS Code 一键导入。
              </Text>
              <GroupCard>
                <GroupRow
                  first
                  icon={Globe}
                  label="远程 MCP 地址"
                  detail="支持 HTTP/SSE MCP 端点与自定义 Header 密钥"
                  chevron={false}
                />
                <GroupRow
                  icon={Terminal}
                  label="本地命令行 MCP"
                  detail="支持标准 stdio 协议的本地 MCP 服务进程"
                  chevron={false}
                />
              </GroupCard>
              <Text style={styles.helperNote}>
                由于自定义 MCP 涉及主机进程与本地配置读取，请在电脑端 DS Bot「设置 → 连接器 → + 自定义」中添加。
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
          <SectionTitle>{`已连接 · ${connectedImList.length}`}</SectionTitle>
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
                  detail={`消息交给 ${botTarget}`}
                  value={online ? '运行中' : '已配置'}
                  chevron={false}
                />
              )
            })}
          </GroupCard>
        </>
      )}

      <SectionTitle>选择平台</SectionTitle>
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
                accessibilityLabel={`连接 ${plat.name}`}
                onPress={() => setSelectedImPlatform(plat)}
                style={({ pressed }) => [
                  styles.connectBtn,
                  configuredCount > 0 && styles.connectBtnConnected,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text style={[styles.connectBtnText, configuredCount > 0 && { color: colors.primary }]}>
                  {configuredCount > 0 ? `已连接 (${configuredCount})` : '连接'}
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
                <Text style={styles.sheetTitle}>{`连接 ${selectedImPlatform.name}`}</Text>
                <IconButton label={s.common.close} icon={X} onPress={() => setSelectedImPlatform(null)} />
              </View>
              <Text style={styles.rowSub}>{selectedImPlatform.sub}</Text>
              <GroupCard>
                <GroupRow
                  first
                  icon={KeyRound}
                  label="所需凭据"
                  value={selectedImPlatform.fieldsHint}
                  chevron={false}
                />
                <GroupRow
                  icon={Monitor}
                  label="接入方式"
                  detail={`请在电脑端 DS Bot「设置 → IM → ${selectedImPlatform.name}」中完成绑定与扫码配对；连接后该平台的私聊和群消息将自动转发给对应 Bot。`}
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
        选择目标 Bot，管理其工作区权限预设及可用的内置工具能力。
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

      <SectionTitle>工具执行权限</SectionTitle>
      <GroupCard>
        {([
          { id: 'default', label: '标准权限（敏感操作需确认）', desc: '读写工作区外文件或执行高风险命令时询问你' },
          { id: 'workspace-write', label: '工作区内自动读写', desc: '允许在 Bot 工作文件夹内直接修改文件' },
          { id: 'danger-full-access', label: '完全权限（自动批准）', desc: '无需每次询问直接执行终端与文件操作' },
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
                if (!targetBot) return
                if (opt.id === 'danger-full-access') {
                  Alert.alert(opt.label, s.chat.permissionFullAccessDescription, [
                    { text: s.common.cancel, style: 'cancel' },
                    { text: s.bots.confirm, style: 'destructive', onPress: () => void perform('update-bot', { id: targetBot.id, permission: opt.id }) },
                  ])
                  return
                }
                void perform('update-bot', { id: targetBot.id, permission: opt.id })
              }}
            />
          )
        })}
      </GroupCard>

      <SectionTitle>内置能力模块</SectionTitle>
      <GroupCard>
        <GroupRow
          first
          icon={Folder}
          label="工作区文件与终端"
          detail="读取、编写代码文件，运行构建与终端命令"
          value="已启用"
          chevron={false}
        />
        <GroupRow
          icon={Globe}
          label="网络搜索与浏览器"
          detail="搜索网页、抓取正文及驱动专属浏览器标签页"
          value={effectiveState.browser !== false ? '已启用' : '已关闭'}
          chevron={false}
        />
        <GroupRow
          icon={Users}
          label="团队协作与群聊"
          detail="向其他 Bot 委派子任务、读取对话与群聊协作"
          value={targetBot?.private ? '隐私隔离' : '已启用'}
          chevron={false}
        />
        <GroupRow
          icon={CalendarClock}
          label="定时任务、长期记忆与密钥"
          detail="创建自动化提醒、跨对话记忆与安全使用环境变量密钥"
          value={effectiveState.memory !== false ? '已启用' : '仅任务/密钥'}
          chevron={false}
        />
      </GroupCard>

      {(effectiveState.capabilities ?? []).length > 0 && (
        <>
          <SectionTitle>已安装的共享能力与技能</SectionTitle>
          <GroupCard>
            {(effectiveState.capabilities ?? []).map((cap, idx) => {
              const cid = text(cap.id) || `cap-${idx}`
              const statusObj = object(effectiveState.capabilityStatuses?.[cid])
              const statusText = text(statusObj.state) || text(cap.kind) || '已就绪'
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
          label="允许 Bot 使用电脑"
          detail={s.bots.computerDesc}
          value={effectiveState.computer?.enabled === true ? s.bots.computerIdle : '已关闭'}
          chevron={false}
        />
      </GroupCard>

      <SectionTitle>各 Bot 电脑操控等级</SectionTitle>
      <GroupCard>
        {effectiveState.bots.map((bot, idx) => {
          const rawLevel = text(object(effectiveState.computer?.levels)[bot.id]) || 'off'
          const levelLabel =
            rawLevel === 'foreground'
              ? '可以动前台'
              : rawLevel === 'background'
                ? '后台操作'
                : rawLevel === 'view'
                  ? '只看'
                  : '关'
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
        电脑操控开关、系统辅助功能与屏幕录制授权仅限在电脑端 DS Bot 窗口内开启或撤销。
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
        {([
          ['24h', '24 小时'],
          ['7d', '7 天'],
          ['30d', '30 天'],
          ['12w', '12 周'],
          ['12m', '12 个月'],
          ['all', '全部用量'],
        ] as const).map(([id, label]) => {
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
            <Text style={styles.mutedText}>正在读取聊天记录…</Text>
          </View>
        </GroupCard>
      ) : (
        <>
          <View style={styles.kpiGrid}>
            <GroupCard style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>
                {usageRange === 'all' ? '全部用量 · Token' : `最近 ${usageView.rangeLabel} · Token`}
              </Text>
              <Text style={styles.kpiValue}>{formatCompactTokens(usageView.current.tokens)}</Text>
              <Text style={styles.kpiSub} numberOfLines={1}>
                {`输入 ${formatCompactTokens(usageView.current.input + usageView.current.cacheRead + usageView.current.cacheWrite)} · 输出 ${formatCompactTokens(usageView.current.output)}`}
              </Text>
            </GroupCard>

            <GroupCard style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>缓存命中率</Text>
              <Text style={styles.kpiValue}>{`${usageView.current.hitRate}%`}</Text>
              <Text style={styles.kpiSub} numberOfLines={1}>
                {`缓存命中 ${formatCompactTokens(usageView.current.cacheRead)} · 输入 ${formatCompactTokens(usageView.current.input)}`}
              </Text>
            </GroupCard>

            <GroupCard style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>输出</Text>
              <Text style={styles.kpiValue}>{formatCompactTokens(usageView.current.output)}</Text>
              <Text style={styles.kpiSub} numberOfLines={1}>
                {usageView.current.tokens > 0
                  ? `占最近 ${usageView.rangeLabel}全部用量的 ${Math.round((usageView.current.output / usageView.current.tokens) * 100)}%`
                  : '暂无输出 Token'}
              </Text>
            </GroupCard>

            <GroupCard style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>调用次数</Text>
              <Text style={styles.kpiValue}>{usageView.current.calls.toLocaleString()}</Text>
              <Text style={styles.kpiSub} numberOfLines={1}>
                {`${usageView.stepLabel} · 峰值 ${formatCompactTokens(usageView.peakBucketTokens)}`}
              </Text>
            </GroupCard>
          </View>

          <GroupCard style={{ padding: 15, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={styles.rowTitle}>Token 走势</Text>
                <Text style={styles.rowSub}>{`${formatCompactTokens(usageView.current.tokens)} Token`}</Text>
              </View>
              <View style={styles.inlinePills}>
                {([
                  ['owner', '按 Bot'],
                  ['model', '按模型'],
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
            <Text style={styles.rowTitle}>按 Bot</Text>
            {usageView.byOwner.length === 0 ? (
              <Text style={styles.rowSub}>这段时间没有用量。</Text>
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
                          {`${item.calls} 次调用 · 输入 ${formatCompactTokens(item.input + item.cacheRead + item.cacheWrite)} · 输出 ${formatCompactTokens(item.output)}`}
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
            <Text style={styles.rowTitle}>按模型</Text>
            {usageView.byModel.length === 0 ? (
              <Text style={styles.rowSub}>这段时间没有用量。</Text>
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
                        {`${item.calls} 次调用 · 输入 ${formatCompactTokens(item.input + item.cacheRead + item.cacheWrite)} · 输出 ${formatCompactTokens(item.output)}`}
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
              <Text style={styles.rowTitle}>活跃度</Text>
              <Text style={styles.rowSub}>{`近一年有 ${activityYear.activeDays} 天在用`}</Text>
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
              <Text style={styles.chartAxisLabel}>少</Text>
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
              <Text style={styles.chartAxisLabel}>多</Text>
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
        你的 Bot 请求过的密钥。Bot 永远看不到明文值：它们在 shell 里通过 $DSH_SECRET_NAME 使用，而且发给模型之前，每个值都会被替换成 [secret:NAME]。
      </Text>

      <SectionTitle>{`密钥 · ${(effectiveState.secrets ?? []).length}`}</SectionTitle>
      <GroupCard>
        {(effectiveState.secrets ?? []).length === 0 ? (
          <View style={styles.emptyCardBox}>
            <Text style={styles.mutedText}>
              还没有密钥。Bot 需要时，会在对话里弹出一张卡片，也可在电脑端 DS Bot 设置中添加。
            </Text>
          </View>
        ) : (
          (effectiveState.secrets ?? []).map((sec, idx) => {
            const name = text(sec.name) || `SECRET_${idx}`
            const scopeText =
              Array.isArray(sec.bots) && sec.bots.length > 0
                ? `仅 ${sec.bots.length} 个 Bot 可用`
                : '所有 Bot 可用'
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
