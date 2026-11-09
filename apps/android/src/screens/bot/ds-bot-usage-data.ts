import { object, objects, text, type BotObject } from '../../services/bot-catalog'

export type UsageRangeId = '24h' | '7d' | '30d' | '12w' | '12m' | 'all'

export interface UsageTotals {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  tokens: number
  calls: number
  hitRate: number
}

export interface UsageBucket {
  key: string
  label: string
  tokens: number
  calls: number
  byOwner: Record<string, number>
  byModel: Record<string, number>
}

export interface UsageGroupRow {
  key: string
  name: string
  sub?: string
  kind?: string
  id?: string
  deleted?: boolean
  color: string
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  tokens: number
  calls: number
  sharePct: number
}

export interface UsageViewSummary {
  rangeId: UsageRangeId
  rangeLabel: string
  stepLabel: string
  scanning: boolean
  total: UsageTotals
  current: UsageTotals
  previous: UsageTotals
  deltaPct: number | null
  peakBucketTokens: number
  buckets: UsageBucket[]
  byOwner: UsageGroupRow[]
  byModel: UsageGroupRow[]
}

export interface ActivityDayCell {
  date: string
  tokens: number
  level: 0 | 1 | 2 | 3 | 4
}

export interface ActivityYearSummary {
  weeks: ActivityDayCell[][]
  activeDays: number
  maxTokens: number
}

const CHART_COLORS = [
  '#4D6BFE',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#F97316',
  '#6366F1',
]

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

function emptyTotals(): UsageTotals {
  return {
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    tokens: 0,
    calls: 0,
    hitRate: 0,
  }
}

function finalizeTotals(t: UsageTotals): UsageTotals {
  t.tokens = t.input + t.cacheRead + t.cacheWrite + t.output
  const promptTotal = t.input + t.cacheRead + t.cacheWrite
  t.hitRate = promptTotal > 0 ? Math.round((t.cacheRead / promptTotal) * 100) : 0
  return t
}

function parseHourKey(hourKey: string): number {
  // Format from DS-Bot usage.js: "YYYY-MM-DD HH"
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2})$/.exec(hourKey.trim())
  if (!m) return Number.NaN
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const hour = Number(m[4])
  return Date.UTC(year, month, day, hour, 0, 0, 0)
}

function formatDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatShortDayLabel(dayKey: string): string {
  const parts = dayKey.split('-')
  if (parts.length < 3) return dayKey
  return `${Number(parts[1])}/${Number(parts[2])}`
}

export function buildDsBotUsageView(
  rawUsage: BotObject | null | undefined,
  rangeId: UsageRangeId,
): UsageViewSummary {
  const usage = object(rawUsage)
  const owners = objects(usage.owners)
  const models = objects(usage.models)
  const rawRows = Array.isArray(usage.rows) ? usage.rows.filter(Array.isArray) : []
  const nowStr = text(usage.now)
  const nowMs = parseHourKey(nowStr)
  const anchorMs = Number.isFinite(nowMs) ? nowMs : Date.now()
  const scanning = usage.scanning === true

  const rangeMeta: Record<UsageRangeId, { label: string; step: string; windowMs: number; bucketKind: 'hour' | 'day' | 'week' | 'month' }> = {
    '24h': { label: '24 小时', step: '按小时', windowMs: 24 * HOUR_MS, bucketKind: 'hour' },
    '7d': { label: '7 天', step: '按天', windowMs: 7 * DAY_MS, bucketKind: 'day' },
    '30d': { label: '30 天', step: '按天', windowMs: 30 * DAY_MS, bucketKind: 'day' },
    '12w': { label: '12 周', step: '按周', windowMs: 84 * DAY_MS, bucketKind: 'week' },
    '12m': { label: '12 个月', step: '按月', windowMs: 365 * DAY_MS, bucketKind: 'month' },
    all: { label: '全部用量', step: '按月', windowMs: Number.POSITIVE_INFINITY, bucketKind: 'month' },
  }

  const meta = rangeMeta[rangeId]
  const startMs = rangeId === 'all' ? Number.NEGATIVE_INFINITY : anchorMs - meta.windowMs
  const prevStartMs = rangeId === 'all' ? Number.NEGATIVE_INFINITY : startMs - meta.windowMs

  const total = emptyTotals()
  const current = emptyTotals()
  const previous = emptyTotals()

  const ownerAgg = new Map<number, UsageTotals>()
  const modelAgg = new Map<number, UsageTotals>()
  const bucketMap = new Map<string, UsageBucket>()

  const bucketKeyAndLabel = (rowMs: number, hourKey: string): { key: string; label: string } => {
    if (meta.bucketKind === 'hour') {
      const hh = hourKey.slice(11, 13) || '00'
      return { key: hourKey, label: `${hh}:00` }
    }
    const dayKey = hourKey.slice(0, 10)
    if (meta.bucketKind === 'day') {
      return { key: dayKey, label: formatShortDayLabel(dayKey) }
    }
    if (meta.bucketKind === 'week') {
      const d = new Date(rowMs)
      const dow = (d.getUTCDay() + 6) % 7
      const mondayMs = rowMs - dow * DAY_MS
      const k = formatDayKey(mondayMs)
      return { key: k, label: formatShortDayLabel(k) }
    }
    const ym = hourKey.slice(0, 7)
    return { key: ym, label: ym }
  }

  // Pre-seed buckets for 24h / 7d / 30d so the bar chart always renders a complete timeline
  if (rangeId === '24h') {
    for (let i = 23; i >= 0; i--) {
      const ms = anchorMs - i * HOUR_MS
      const d = new Date(ms)
      const k = `${formatDayKey(ms)} ${String(d.getUTCHours()).padStart(2, '0')}`
      bucketMap.set(k, { key: k, label: `${String(d.getUTCHours()).padStart(2, '0')}:00`, tokens: 0, calls: 0, byOwner: {}, byModel: {} })
    }
  } else if (rangeId === '7d' || rangeId === '30d') {
    const days = rangeId === '7d' ? 7 : 30
    const todayFloor = Math.floor(anchorMs / DAY_MS) * DAY_MS
    for (let i = days - 1; i >= 0; i--) {
      const ms = todayFloor - i * DAY_MS
      const k = formatDayKey(ms)
      bucketMap.set(k, { key: k, label: formatShortDayLabel(k), tokens: 0, calls: 0, byOwner: {}, byModel: {} })
    }
  }

  for (const r of rawRows) {
    const cells = r as unknown[]
    // Two possible formats:
    // 1) Official DS-Bot 0.3.0: [hour, ownerIdx, modelIdx, kindIdx, input, cacheRead, cacheWrite, output, calls]
    // 2) Legacy/fallback row: [ownerName, modelName, calls, input, output, cacheRead]
    const isOfficialTuple = typeof cells[1] === 'number' && cells.length >= 9
    if (isOfficialTuple) {
      const hourStr = text(cells[0])
      const ownerIdx = Number(cells[1] ?? 0)
      const modelIdx = Number(cells[2] ?? 0)
      const inp = Math.max(0, Number(cells[4] ?? 0))
      const cr = Math.max(0, Number(cells[5] ?? 0))
      const cw = Math.max(0, Number(cells[6] ?? 0))
      const out = Math.max(0, Number(cells[7] ?? 0))
      const calls = Math.max(0, Number(cells[8] ?? 0))
      const rowTokens = inp + cr + cw + out

      total.input += inp
      total.cacheRead += cr
      total.cacheWrite += cw
      total.output += out
      total.calls += calls

      const rowMs = parseHourKey(hourStr)
      if (!Number.isFinite(rowMs)) continue

      if (rowMs >= startMs && rowMs <= anchorMs + HOUR_MS) {
        current.input += inp
        current.cacheRead += cr
        current.cacheWrite += cw
        current.output += out
        current.calls += calls

        const o = ownerAgg.get(ownerIdx) ?? emptyTotals()
        o.input += inp
        o.cacheRead += cr
        o.cacheWrite += cw
        o.output += out
        o.calls += calls
        ownerAgg.set(ownerIdx, o)

        const m = modelAgg.get(modelIdx) ?? emptyTotals()
        m.input += inp
        m.cacheRead += cr
        m.cacheWrite += cw
        m.output += out
        m.calls += calls
        modelAgg.set(modelIdx, m)

        const { key: bKey, label: bLabel } = bucketKeyAndLabel(rowMs, hourStr)
        const b = bucketMap.get(bKey) ?? { key: bKey, label: bLabel, tokens: 0, calls: 0, byOwner: {}, byModel: {} }
        b.tokens += rowTokens
        b.calls += calls
        const ownerKey = String(ownerIdx)
        const modelKey = String(modelIdx)
        b.byOwner[ownerKey] = (b.byOwner[ownerKey] ?? 0) + rowTokens
        b.byModel[modelKey] = (b.byModel[modelKey] ?? 0) + rowTokens
        bucketMap.set(bKey, b)
      } else if (rangeId !== 'all' && rowMs >= prevStartMs && rowMs < startMs) {
        previous.input += inp
        previous.cacheRead += cr
        previous.cacheWrite += cw
        previous.output += out
        previous.calls += calls
      }
    } else {
      // Legacy fallback tuple
      const calls = Math.max(0, Number(cells[2] ?? 0))
      const inp = Math.max(0, Number(cells[3] ?? 0))
      const out = Math.max(0, Number(cells[4] ?? 0))
      const cr = Math.max(0, Number(cells[5] ?? 0))
      current.input += inp
      current.output += out
      current.cacheRead += cr
      current.calls += calls
      total.input += inp
      total.output += out
      total.cacheRead += cr
      total.calls += calls
    }
  }

  finalizeTotals(total)
  finalizeTotals(current)
  finalizeTotals(previous)

  const deltaPct =
    rangeId === 'all' || previous.tokens <= 0
      ? null
      : Math.round(((current.tokens - previous.tokens) / previous.tokens) * 100)

  const byOwner: UsageGroupRow[] = [...ownerAgg.entries()]
    .map(([idx, agg], i) => {
      finalizeTotals(agg)
      const metaObj = object(owners[idx])
      const kind = text(metaObj.kind) || 'bot'
      const rawName = text(metaObj.name)
      const name =
        rawName
        || (kind === 'other' ? '其他' : kind === 'room' ? '已删除的群聊' : '已删除的 Bot')
      return {
        key: text(metaObj.key) || `owner-${idx}`,
        name,
        kind,
        id: text(metaObj.id) || undefined,
        deleted: metaObj.deleted === true,
        color: CHART_COLORS[i % CHART_COLORS.length]!,
        ...agg,
        sharePct: current.tokens > 0 ? Math.round((agg.tokens / current.tokens) * 100) : 0,
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const byModel: UsageGroupRow[] = [...modelAgg.entries()]
    .map(([idx, agg], i) => {
      finalizeTotals(agg)
      const metaObj = object(models[idx])
      const modelName = text(metaObj.name) || text(metaObj.model) || '未知模型'
      const providerName = text(metaObj.providerName) || text(metaObj.provider)
      return {
        key: text(metaObj.key) || `model-${idx}`,
        name: modelName,
        sub: providerName || undefined,
        color: CHART_COLORS[i % CHART_COLORS.length]!,
        ...agg,
        sharePct: current.tokens > 0 ? Math.round((agg.tokens / current.tokens) * 100) : 0,
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const buckets = [...bucketMap.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const peakBucketTokens = buckets.reduce((max, b) => Math.max(max, b.tokens), 0)

  return {
    rangeId,
    rangeLabel: meta.label,
    stepLabel: meta.step,
    scanning,
    total,
    current,
    previous,
    deltaPct,
    peakBucketTokens,
    buckets,
    byOwner,
    byModel,
  }
}

export function buildDsBotActivityYear(rawUsage: BotObject | null | undefined, weeksCount = 24): ActivityYearSummary {
  const usage = object(rawUsage)
  const rawRows = Array.isArray(usage.rows) ? usage.rows.filter(Array.isArray) : []
  const nowStr = text(usage.now)
  const nowMs = parseHourKey(nowStr)
  const anchorMs = Number.isFinite(nowMs) ? nowMs : Date.now()

  const dayTokens = new Map<string, number>()
  const yearStartMs = anchorMs - 365 * DAY_MS

  for (const r of rawRows) {
    const cells = r as unknown[]
    if (typeof cells[1] !== 'number' || cells.length < 9) continue
    const hourStr = text(cells[0])
    const rowMs = parseHourKey(hourStr)
    if (!Number.isFinite(rowMs) || rowMs < yearStartMs) continue
    const dayKey = hourStr.slice(0, 10)
    const tok =
      Math.max(0, Number(cells[4] ?? 0))
      + Math.max(0, Number(cells[5] ?? 0))
      + Math.max(0, Number(cells[6] ?? 0))
      + Math.max(0, Number(cells[7] ?? 0))
    if (tok > 0) {
      dayTokens.set(dayKey, (dayTokens.get(dayKey) ?? 0) + tok)
    }
  }

  const activeDays = dayTokens.size
  const maxTokens = [...dayTokens.values()].reduce((m, v) => Math.max(m, v), 0)

  const todayFloor = Math.floor(anchorMs / DAY_MS) * DAY_MS
  const todayDow = (new Date(todayFloor).getUTCDay() + 6) % 7 // Monday = 0
  const currentWeekMonday = todayFloor - todayDow * DAY_MS
  const firstWeekMonday = currentWeekMonday - (weeksCount - 1) * 7 * DAY_MS

  const weeks: ActivityDayCell[][] = []
  for (let w = 0; w < weeksCount; w++) {
    const week: ActivityDayCell[] = []
    for (let d = 0; d < 7; d++) {
      const cellMs = firstWeekMonday + (w * 7 + d) * DAY_MS
      const date = formatDayKey(cellMs)
      const tokens = dayTokens.get(date) ?? 0
      let level: 0 | 1 | 2 | 3 | 4 = 0
      if (tokens > 0 && maxTokens > 0) {
        const ratio = tokens / maxTokens
        if (ratio >= 0.75) level = 4
        else if (ratio >= 0.45) level = 3
        else if (ratio >= 0.2) level = 2
        else level = 1
      }
      week.push({ date, tokens, level })
    }
    weeks.push(week)
  }

  return { weeks, activeDays, maxTokens }
}

export interface ConnectorCatalogItem {
  id: string
  name: string
  category: 'dev' | 'docs' | 'work' | 'design' | 'data' | 'commerce' | 'search' | 'mail'
  desc: string
  color: string
  authKind: 'oauth' | 'key' | 'none' | 'mail'
}

export const DS_BOT_RECOMMENDED_CONNECTOR_IDS = [
  'github',
  'mail',
  'notion',
  'linear',
  'figma',
  'slack',
] as const

export const DS_BOT_CONNECTOR_CATEGORIES: { id: string; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'dev', label: '开发' },
  { id: 'docs', label: '文档与文件' },
  { id: 'work', label: '工作' },
  { id: 'design', label: '设计' },
  { id: 'data', label: '数据' },
  { id: 'commerce', label: '商务' },
  { id: 'search', label: '搜索' },
  { id: 'mail', label: '邮件' },
]

/**
 * Complete 39-service DS-Bot 0.3.0 connector catalog matching `src/host/connectors/catalog.js`
 * and `src/client/i18n.js`.
 */
export const DS_BOT_CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  { id: 'github', name: 'GitHub', category: 'dev', desc: '代码仓库、Issue 和 Pull Request', color: '#24292F', authKind: 'oauth' },
  { id: 'mail', name: '邮箱', category: 'mail', desc: 'QQ、163、126、Gmail、iCloud 等 IMAP 邮箱', color: '#3B82F6', authKind: 'mail' },
  { id: 'notion', name: 'Notion', category: 'docs', desc: '页面、数据库和 Wiki 内容', color: '#191919', authKind: 'oauth' },
  { id: 'linear', name: 'Linear', category: 'work', desc: 'Issue、项目和迭代', color: '#5E6AD2', authKind: 'oauth' },
  { id: 'figma', name: 'Figma', category: 'design', desc: '设计文件、组件和评论', color: '#F24E1E', authKind: 'oauth' },
  { id: 'slack', name: 'Slack', category: 'work', desc: '频道和消息', color: '#E01E5A', authKind: 'oauth' },
  { id: 'sentry', name: 'Sentry', category: 'dev', desc: '错误、调用链和发布', color: '#6C5FC7', authKind: 'oauth' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'dev', desc: 'Workers、DNS 和账户资源', color: '#F38020', authKind: 'oauth' },
  { id: 'vercel', name: 'Vercel', category: 'dev', desc: '项目、部署和日志', color: '#171717', authKind: 'oauth' },
  { id: 'netlify', name: 'Netlify', category: 'dev', desc: '站点、部署和表单', color: '#00C7B7', authKind: 'oauth' },
  { id: 'postman', name: 'Postman', category: 'dev', desc: '集合、请求和工作区', color: '#FF6C37', authKind: 'oauth' },
  { id: 'dropbox', name: 'Dropbox', category: 'docs', desc: '文件和文件夹', color: '#0061FF', authKind: 'oauth' },
  { id: 'box', name: 'Box', category: 'docs', desc: '文件、文件夹和元数据', color: '#0061D5', authKind: 'oauth' },
  { id: 'deepwiki', name: 'DeepWiki', category: 'docs', desc: '公开代码仓库的文档', color: '#2563EB', authKind: 'none' },
  { id: 'context7', name: 'Context7', category: 'docs', desc: '库文档和代码示例', color: '#10B981', authKind: 'none' },
  { id: 'mslearn', name: 'Microsoft Learn', category: 'docs', desc: '微软产品文档', color: '#0078D4', authKind: 'none' },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', category: 'docs', desc: 'Cloudflare 产品文档', color: '#F38020', authKind: 'none' },
  { id: 'atlassian', name: 'Atlassian', category: 'work', desc: 'Jira 工单和 Confluence 页面', color: '#0052CC', authKind: 'oauth' },
  { id: 'intercom', name: 'Intercom', category: 'work', desc: '会话、联系人和文章', color: '#0057FF', authKind: 'oauth' },
  { id: 'monday', name: 'monday.com', category: 'work', desc: '看板、条目和工作流', color: '#FF3D57', authKind: 'oauth' },
  { id: 'zapier', name: 'Zapier', category: 'work', desc: 'Zap 和应用操作', color: '#FF4A00', authKind: 'oauth' },
  { id: 'clickup', name: 'ClickUp', category: 'work', desc: '任务、清单和文档', color: '#7B68EE', authKind: 'oauth' },
  { id: 'todoist', name: 'Todoist', category: 'work', desc: '任务和项目', color: '#E44332', authKind: 'oauth' },
  { id: 'attio', name: 'Attio', category: 'work', desc: 'CRM 记录、列表和备注', color: '#6366F1', authKind: 'oauth' },
  { id: 'asana', name: 'Asana', category: 'work', desc: '任务、项目和工作区', color: '#F06A6A', authKind: 'oauth' },
  { id: 'hubspot', name: 'HubSpot', category: 'work', desc: '联系人、交易和工单', color: '#FF7A59', authKind: 'oauth' },
  { id: 'canva', name: 'Canva', category: 'design', desc: '设计稿、文件夹和导出', color: '#00C4CC', authKind: 'oauth' },
  { id: 'webflow', name: 'Webflow', category: 'design', desc: '站点、页面和 CMS 内容', color: '#146EF5', authKind: 'oauth' },
  { id: 'wix', name: 'Wix', category: 'design', desc: '站点、页面和站点内容', color: '#0C6EFC', authKind: 'oauth' },
  { id: 'miro', name: 'Miro', category: 'design', desc: '白板和白板条目', color: '#F59E0B', authKind: 'oauth' },
  { id: 'supabase', name: 'Supabase', category: 'data', desc: '数据库、数据表和项目设置', color: '#3ECF8E', authKind: 'oauth' },
  { id: 'neon', name: 'Neon', category: 'data', desc: 'Postgres 数据库和分支', color: '#00C885', authKind: 'oauth' },
  { id: 'airtable', name: 'Airtable', category: 'data', desc: 'Bases、表和记录', color: '#18BFFF', authKind: 'oauth' },
  { id: 'huggingface', name: 'Hugging Face', category: 'data', desc: '模型、数据集和 Space', color: '#F59E0B', authKind: 'none' },
  { id: 'stripe', name: 'Stripe', category: 'commerce', desc: '支付、发票和客户', color: '#635BFF', authKind: 'oauth' },
  { id: 'paypal', name: 'PayPal', category: 'commerce', desc: '订单、支付和发票', color: '#00457C', authKind: 'oauth' },
  { id: 'square', name: 'Square', category: 'commerce', desc: '支付、订单和商品目录', color: '#006AFF', authKind: 'oauth' },
  { id: 'exa', name: 'Exa', category: 'search', desc: '面向 Agent 的网络搜索', color: '#254BF6', authKind: 'none' },
  { id: 'amap', name: '高德地图', category: 'search', desc: '中国地图、地点和路线', color: '#2563EB', authKind: 'key' },
]

export interface ImPlatformCatalogItem {
  id: string
  name: string
  sub: string
  color: string
  glyph: string
  fieldsHint: string
}

/**
 * 8 IM platforms in the exact order of DS-Bot `src/shared/im-platforms.js` (Screenshot 3).
 */
export const DS_BOT_IM_PLATFORMS: ImPlatformCatalogItem[] = [
  { id: 'telegram', name: 'Telegram', sub: '通过 @BotFather 获取 Bot Token 接入', color: '#26A5E4', glyph: 'TG', fieldsHint: 'Bot Token' },
  { id: 'wechat', name: '微信', sub: '扫码直接连接个人微信', color: '#07C160', glyph: '微', fieldsHint: '微信扫码授权' },
  { id: 'feishu', name: '飞书 / Lark', sub: '自建应用长连接模式，无需公网地址', color: '#3370FF', glyph: '飞', fieldsHint: 'App ID + App Secret' },
  { id: 'dingtalk', name: '钉钉', sub: '企业内部机器人 Stream 模式接收消息', color: '#0089FF', glyph: '钉', fieldsHint: 'Client ID + Client Secret' },
  { id: 'wecom', name: '企业微信', sub: '企业微信智能机器人长连接接入', color: '#2B7FD9', glyph: '企', fieldsHint: 'Bot ID + Secret' },
  { id: 'qq', name: 'QQ', sub: 'QQ 开放平台机器人接入群聊与私聊', color: '#1EBAFC', glyph: 'QQ', fieldsHint: 'AppID + AppSecret' },
  { id: 'discord', name: 'Discord', sub: 'Discord Bot 接入服务器频道与私信', color: '#5865F2', glyph: 'DC', fieldsHint: 'Bot Token' },
  { id: 'slack', name: 'Slack', sub: 'Slack Socket Mode 应用接入', color: '#E01E5A', glyph: 'SL', fieldsHint: 'Bot Token + App Token' },
]

export const DS_BOT_POPULAR_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', desc: 'DeepSeek-V3 / R1 官方接口' },
  { id: 'openrouter', name: 'OpenRouter', desc: '聚合多厂商主流大模型' },
  { id: 'siliconflow', name: 'SiliconFlow (硅基流动)', desc: '开源与国产模型高速推理' },
  { id: 'volcengine', name: '火山方舟 (Volcengine Ark)', desc: '豆包与 DeepSeek 企业级接入' },
  { id: 'dashscope', name: '阿里云百炼 (DashScope)', desc: '通义千问 Qwen 全系列模型' },
  { id: 'moonshot', name: 'Moonshot (Kimi)', desc: 'Kimi 长文本与多模态模型' },
  { id: 'zhipu', name: '智谱清言 (GLM)', desc: 'GLM-4.5 / 4.6 系列模型' },
  { id: 'minimax', name: 'MiniMax', desc: 'MiniMax-Text / M1 系列模型' },
  { id: 'openai', name: 'OpenAI', desc: 'GPT-4.1 / o3 / o4-mini 系列' },
  { id: 'anthropic', name: 'Anthropic', desc: 'Claude 4 Opus / Sonnet 系列' },
  { id: 'gemini', name: 'Google Gemini', desc: 'Gemini 2.5 Pro / Flash 系列' },
  { id: 'xai', name: 'xAI', desc: 'Grok 3 / Grok 4 系列模型' },
]

export const DS_BOT_LOCAL_SERVERS = [
  { id: 'ollama', name: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1' },
  { id: 'lmstudio', name: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1' },
  { id: 'vllm', name: 'vLLM', endpoint: 'http://127.0.0.1:8000/v1' },
  { id: 'sglang', name: 'SGLang', endpoint: 'http://127.0.0.1:30000/v1' },
]
