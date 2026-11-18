import { object, objects, text, type BotObject } from '../../services/bot-catalog'
import { strings } from '../../locales/i18n'

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
    '24h': { label: strings.dsBotSettings.ranges['24h'], step: strings.dsBotSettings.steps.hour, windowMs: 24 * HOUR_MS, bucketKind: 'hour' },
    '7d': { label: strings.dsBotSettings.ranges['7d'], step: strings.dsBotSettings.steps.day, windowMs: 7 * DAY_MS, bucketKind: 'day' },
    '30d': { label: strings.dsBotSettings.ranges['30d'], step: strings.dsBotSettings.steps.day, windowMs: 30 * DAY_MS, bucketKind: 'day' },
    '12w': { label: strings.dsBotSettings.ranges['12w'], step: strings.dsBotSettings.steps.week, windowMs: 84 * DAY_MS, bucketKind: 'week' },
    '12m': { label: strings.dsBotSettings.ranges['12m'], step: strings.dsBotSettings.steps.month, windowMs: 365 * DAY_MS, bucketKind: 'month' },
    all: { label: strings.dsBotSettings.ranges.all, step: strings.dsBotSettings.steps.month, windowMs: Number.POSITIVE_INFINITY, bucketKind: 'month' },
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
        || (kind === 'other' ? strings.dsBotSettings.otherOwner : kind === 'room' ? strings.dsBotSettings.deletedGroup : strings.dsBotSettings.deletedBot)
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
      const modelName = text(metaObj.name) || text(metaObj.model) || strings.dsBotSettings.unknownModel
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
  { id: 'all', get label() { return strings.dsBotSettings.connectorCategories.all } },
  { id: 'dev', get label() { return strings.dsBotSettings.connectorCategories.dev } },
  { id: 'docs', get label() { return strings.dsBotSettings.connectorCategories.docs } },
  { id: 'work', get label() { return strings.dsBotSettings.connectorCategories.work } },
  { id: 'design', get label() { return strings.dsBotSettings.connectorCategories.design } },
  { id: 'data', get label() { return strings.dsBotSettings.connectorCategories.data } },
  { id: 'commerce', get label() { return strings.dsBotSettings.connectorCategories.commerce } },
  { id: 'search', get label() { return strings.dsBotSettings.connectorCategories.search } },
  { id: 'mail', get label() { return strings.dsBotSettings.connectorCategories.mail } },
]

/**
 * Complete 39-service DS-Bot 0.3.0 connector catalog matching `src/host/connectors/catalog.js`
 * and `src/client/i18n.js`.
 */
export const DS_BOT_CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  { id: 'github', name: 'GitHub', category: 'dev', get desc() { return strings.dsBotSettings.connectorDescriptions.github }, color: '#24292F', authKind: 'oauth' },
  { id: 'mail', get name() { return strings.dsBotSettings.connectorNames.mail }, category: 'mail', get desc() { return strings.dsBotSettings.connectorDescriptions.mail }, color: '#3B82F6', authKind: 'mail' },
  { id: 'notion', name: 'Notion', category: 'docs', get desc() { return strings.dsBotSettings.connectorDescriptions.notion }, color: '#191919', authKind: 'oauth' },
  { id: 'linear', name: 'Linear', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.linear }, color: '#5E6AD2', authKind: 'oauth' },
  { id: 'figma', name: 'Figma', category: 'design', get desc() { return strings.dsBotSettings.connectorDescriptions.figma }, color: '#F24E1E', authKind: 'oauth' },
  { id: 'slack', name: 'Slack', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.slack }, color: '#E01E5A', authKind: 'oauth' },
  { id: 'sentry', name: 'Sentry', category: 'dev', get desc() { return strings.dsBotSettings.connectorDescriptions.sentry }, color: '#6C5FC7', authKind: 'oauth' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'dev', get desc() { return strings.dsBotSettings.connectorDescriptions.cloudflare }, color: '#F38020', authKind: 'oauth' },
  { id: 'vercel', name: 'Vercel', category: 'dev', get desc() { return strings.dsBotSettings.connectorDescriptions.vercel }, color: '#171717', authKind: 'oauth' },
  { id: 'netlify', name: 'Netlify', category: 'dev', get desc() { return strings.dsBotSettings.connectorDescriptions.netlify }, color: '#00C7B7', authKind: 'oauth' },
  { id: 'postman', name: 'Postman', category: 'dev', get desc() { return strings.dsBotSettings.connectorDescriptions.postman }, color: '#FF6C37', authKind: 'oauth' },
  { id: 'dropbox', name: 'Dropbox', category: 'docs', get desc() { return strings.dsBotSettings.connectorDescriptions.dropbox }, color: '#0061FF', authKind: 'oauth' },
  { id: 'box', name: 'Box', category: 'docs', get desc() { return strings.dsBotSettings.connectorDescriptions.box }, color: '#0061D5', authKind: 'oauth' },
  { id: 'deepwiki', name: 'DeepWiki', category: 'docs', get desc() { return strings.dsBotSettings.connectorDescriptions.deepwiki }, color: '#2563EB', authKind: 'none' },
  { id: 'context7', name: 'Context7', category: 'docs', get desc() { return strings.dsBotSettings.connectorDescriptions.context7 }, color: '#10B981', authKind: 'none' },
  { id: 'mslearn', name: 'Microsoft Learn', category: 'docs', get desc() { return strings.dsBotSettings.connectorDescriptions.mslearn }, color: '#0078D4', authKind: 'none' },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', category: 'docs', get desc() { return strings.dsBotSettings.connectorDescriptions.cloudflareDocs }, color: '#F38020', authKind: 'none' },
  { id: 'atlassian', name: 'Atlassian', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.atlassian }, color: '#0052CC', authKind: 'oauth' },
  { id: 'intercom', name: 'Intercom', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.intercom }, color: '#0057FF', authKind: 'oauth' },
  { id: 'monday', name: 'monday.com', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.monday }, color: '#FF3D57', authKind: 'oauth' },
  { id: 'zapier', name: 'Zapier', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.zapier }, color: '#FF4A00', authKind: 'oauth' },
  { id: 'clickup', name: 'ClickUp', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.clickup }, color: '#7B68EE', authKind: 'oauth' },
  { id: 'todoist', name: 'Todoist', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.todoist }, color: '#E44332', authKind: 'oauth' },
  { id: 'attio', name: 'Attio', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.attio }, color: '#6366F1', authKind: 'oauth' },
  { id: 'asana', name: 'Asana', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.asana }, color: '#F06A6A', authKind: 'oauth' },
  { id: 'hubspot', name: 'HubSpot', category: 'work', get desc() { return strings.dsBotSettings.connectorDescriptions.hubspot }, color: '#FF7A59', authKind: 'oauth' },
  { id: 'canva', name: 'Canva', category: 'design', get desc() { return strings.dsBotSettings.connectorDescriptions.canva }, color: '#00C4CC', authKind: 'oauth' },
  { id: 'webflow', name: 'Webflow', category: 'design', get desc() { return strings.dsBotSettings.connectorDescriptions.webflow }, color: '#146EF5', authKind: 'oauth' },
  { id: 'wix', name: 'Wix', category: 'design', get desc() { return strings.dsBotSettings.connectorDescriptions.wix }, color: '#0C6EFC', authKind: 'oauth' },
  { id: 'miro', name: 'Miro', category: 'design', get desc() { return strings.dsBotSettings.connectorDescriptions.miro }, color: '#F59E0B', authKind: 'oauth' },
  { id: 'supabase', name: 'Supabase', category: 'data', get desc() { return strings.dsBotSettings.connectorDescriptions.supabase }, color: '#3ECF8E', authKind: 'oauth' },
  { id: 'neon', name: 'Neon', category: 'data', get desc() { return strings.dsBotSettings.connectorDescriptions.neon }, color: '#00C885', authKind: 'oauth' },
  { id: 'airtable', name: 'Airtable', category: 'data', get desc() { return strings.dsBotSettings.connectorDescriptions.airtable }, color: '#18BFFF', authKind: 'oauth' },
  { id: 'huggingface', name: 'Hugging Face', category: 'data', get desc() { return strings.dsBotSettings.connectorDescriptions.huggingface }, color: '#F59E0B', authKind: 'none' },
  { id: 'stripe', name: 'Stripe', category: 'commerce', get desc() { return strings.dsBotSettings.connectorDescriptions.stripe }, color: '#635BFF', authKind: 'oauth' },
  { id: 'paypal', name: 'PayPal', category: 'commerce', get desc() { return strings.dsBotSettings.connectorDescriptions.paypal }, color: '#00457C', authKind: 'oauth' },
  { id: 'square', name: 'Square', category: 'commerce', get desc() { return strings.dsBotSettings.connectorDescriptions.square }, color: '#006AFF', authKind: 'oauth' },
  { id: 'exa', name: 'Exa', category: 'search', get desc() { return strings.dsBotSettings.connectorDescriptions.exa }, color: '#254BF6', authKind: 'none' },
  { id: 'amap', get name() { return strings.dsBotSettings.connectorNames.amap }, category: 'search', get desc() { return strings.dsBotSettings.connectorDescriptions.amap }, color: '#2563EB', authKind: 'key' },
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
  { id: 'telegram', name: 'Telegram', get sub() { return strings.dsBotSettings.imDescriptions.telegram }, color: '#26A5E4', glyph: 'TG', fieldsHint: 'Bot Token' },
  { id: 'wechat', get name() { return strings.dsBotSettings.imNames.wechat }, get sub() { return strings.dsBotSettings.imDescriptions.wechat }, color: '#07C160', glyph: '微', get fieldsHint() { return strings.dsBotSettings.wechatFieldsHint } },
  { id: 'feishu', get name() { return strings.dsBotSettings.imNames.feishu }, get sub() { return strings.dsBotSettings.imDescriptions.feishu }, color: '#3370FF', glyph: '飞', fieldsHint: 'App ID + App Secret' },
  { id: 'dingtalk', get name() { return strings.dsBotSettings.imNames.dingtalk }, get sub() { return strings.dsBotSettings.imDescriptions.dingtalk }, color: '#0089FF', glyph: '钉', fieldsHint: 'Client ID + Client Secret' },
  { id: 'wecom', get name() { return strings.dsBotSettings.imNames.wecom }, get sub() { return strings.dsBotSettings.imDescriptions.wecom }, color: '#2B7FD9', glyph: '企', fieldsHint: 'Bot ID + Secret' },
  { id: 'qq', name: 'QQ', get sub() { return strings.dsBotSettings.imDescriptions.qq }, color: '#1EBAFC', glyph: 'QQ', fieldsHint: 'AppID + AppSecret' },
  { id: 'discord', name: 'Discord', get sub() { return strings.dsBotSettings.imDescriptions.discord }, color: '#5865F2', glyph: 'DC', fieldsHint: 'Bot Token' },
  { id: 'slack', name: 'Slack', get sub() { return strings.dsBotSettings.imDescriptions.slack }, color: '#E01E5A', glyph: 'SL', fieldsHint: 'Bot Token + App Token' },
]

export const DS_BOT_POPULAR_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', get desc() { return strings.dsBotSettings.providerDescriptions.deepseek } },
  { id: 'openrouter', name: 'OpenRouter', get desc() { return strings.dsBotSettings.providerDescriptions.openrouter } },
  { id: 'siliconflow', name: 'SiliconFlow (硅基流动)', get desc() { return strings.dsBotSettings.providerDescriptions.siliconflow } },
  { id: 'volcengine', name: '火山方舟 (Volcengine Ark)', get desc() { return strings.dsBotSettings.providerDescriptions.volcengine } },
  { id: 'dashscope', name: '阿里云百炼 (DashScope)', get desc() { return strings.dsBotSettings.providerDescriptions.dashscope } },
  { id: 'moonshot', name: 'Moonshot (Kimi)', get desc() { return strings.dsBotSettings.providerDescriptions.moonshot } },
  { id: 'zhipu', name: '智谱清言 (GLM)', get desc() { return strings.dsBotSettings.providerDescriptions.zhipu } },
  { id: 'minimax', name: 'MiniMax', get desc() { return strings.dsBotSettings.providerDescriptions.minimax } },
  { id: 'openai', name: 'OpenAI', get desc() { return strings.dsBotSettings.providerDescriptions.openai } },
  { id: 'anthropic', name: 'Anthropic', get desc() { return strings.dsBotSettings.providerDescriptions.anthropic } },
  { id: 'gemini', name: 'Google Gemini', get desc() { return strings.dsBotSettings.providerDescriptions.gemini } },
  { id: 'xai', name: 'xAI', get desc() { return strings.dsBotSettings.providerDescriptions.xai } },
]

export const DS_BOT_LOCAL_SERVERS = [
  { id: 'ollama', name: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1' },
  { id: 'lmstudio', name: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1' },
  { id: 'vllm', name: 'vLLM', endpoint: 'http://127.0.0.1:8000/v1' },
  { id: 'sglang', name: 'SGLang', endpoint: 'http://127.0.0.1:30000/v1' },
]
