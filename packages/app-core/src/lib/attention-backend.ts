import type { AttentionItem } from '@dsh-remote/protocol'

export interface AttentionBackendIdentity {
  /** Stable filter key: 'harness' | 'codex' | 'antigravity' | 'hermes' | 'cursor' | 'claude' | 'opencode' | 'pi' | 'ds-bot' | 'acp:<id>' */
  key: string
  /** Canonical human-readable platform name (never generic 'Harness' or 'AGY'). */
  label: string
  /** Single-character notification/emblem glyph. */
  shortBadge: string
  /** Restrained brand accent dot/glyph tint in light mode. */
  accentLight: string
  /** Restrained brand accent dot/glyph tint in dark mode. */
  accentDark: string
}

export interface AttentionBackendFilterOption extends AttentionBackendIdentity {
  count: number
}

const KNOWN_BACKENDS: Readonly<Record<string, AttentionBackendIdentity>> = {
  harness: {
    key: 'harness',
    label: 'DeepSeek Harness',
    shortBadge: 'D',
    accentLight: '#3B5BDB',
    accentDark: '#7B95FF',
  },
  codex: {
    key: 'codex',
    label: 'Codex',
    shortBadge: 'X',
    accentLight: '#0F766E',
    accentDark: '#34D399',
  },
  antigravity: {
    key: 'antigravity',
    label: 'Antigravity',
    shortBadge: 'A',
    accentLight: '#6366F1',
    accentDark: '#818CF8',
  },
  hermes: {
    key: 'hermes',
    label: 'Hermes',
    shortBadge: 'H',
    accentLight: '#B45309',
    accentDark: '#FBBF24',
  },
  cursor: {
    key: 'cursor',
    label: 'Cursor',
    shortBadge: 'U',
    accentLight: '#0284C7',
    accentDark: '#38BDF8',
  },
  claude: {
    key: 'claude',
    label: 'Claude',
    shortBadge: 'C',
    accentLight: '#C2410C',
    accentDark: '#FB923C',
  },
  opencode: {
    key: 'opencode',
    label: 'OpenCode',
    shortBadge: 'O',
    accentLight: '#0D9488',
    accentDark: '#2DD4BF',
  },
  pi: {
    key: 'pi',
    label: 'Pi',
    shortBadge: 'P',
    accentLight: '#9D174D',
    accentDark: '#F472B6',
  },
  'ds-bot': {
    key: 'ds-bot',
    label: 'DS-Bot',
    shortBadge: 'B',
    accentLight: '#475569',
    accentDark: '#94A3B8',
  },
}

const CANONICAL_ORDER = new Map<string, number>([
  ['harness', 0],
  ['codex', 1],
  ['antigravity', 2],
  ['hermes', 3],
  ['cursor', 4],
  ['claude', 5],
  ['opencode', 6],
  ['pi', 7],
  ['ds-bot', 8],
])

function formatCustomAdapterLabel(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return 'ACP'
  const clipped = trimmed.slice(0, 24)
  if (/^[a-z0-9-]+$/u.test(clipped)) {
    return clipped
      .split('-')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }
  return clipped
}

/**
 * Resolves a single canonical brand identity (label, short glyph, accent colors,
 * and filter key) across DeepSeek Harness, Codex, Antigravity, Hermes, Cursor,
 * Claude, OpenCode, Pi, DS-Bot, and custom ACP adapters.
 */
export function resolveAttentionBackendIdentity(
  item: Pick<AttentionItem, 'backend' | 'acpAdapter'>,
): AttentionBackendIdentity {
  if (item.backend === 'ds-bot') return KNOWN_BACKENDS['ds-bot']!
  if (item.backend === 'codex') return KNOWN_BACKENDS.codex!
  if (item.backend === 'harness') return KNOWN_BACKENDS.harness!

  const rawAdapter = (item.acpAdapter ?? '').trim()
  const normalized = rawAdapter.toLowerCase()
  const known = Object.hasOwn(KNOWN_BACKENDS, normalized) ? KNOWN_BACKENDS[normalized] : undefined
  if (known !== undefined) return known

  if (normalized.length === 0) {
    return {
      key: 'acp',
      label: 'ACP',
      shortBadge: 'A',
      accentLight: '#475569',
      accentDark: '#94A3B8',
    }
  }

  const label = formatCustomAdapterLabel(rawAdapter)
  const glyphMatch = label.match(/[A-Za-z0-9]/u)
  return {
    key: `acp:${normalized}`,
    label,
    shortBadge: glyphMatch ? glyphMatch[0].toUpperCase() : 'A',
    accentLight: '#475569',
    accentDark: '#94A3B8',
  }
}

/** Builds deterministically ordered platform filter chips with counts from items. */
export function selectAttentionBackendFilters(
  items: readonly AttentionItem[],
): AttentionBackendFilterOption[] {
  const byKey = new Map<string, AttentionBackendFilterOption>()
  for (const item of items) {
    const meta = resolveAttentionBackendIdentity(item)
    const existing = byKey.get(meta.key)
    if (existing !== undefined) {
      existing.count += 1
    } else {
      byKey.set(meta.key, { ...meta, count: 1 })
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const rankLeft = CANONICAL_ORDER.get(left.key) ?? 100
    const rankRight = CANONICAL_ORDER.get(right.key) ?? 100
    if (rankLeft !== rankRight) return rankLeft - rankRight
    return left.label.localeCompare(right.label)
  })
}

/** Filters Attention Inbox items by canonical platform key ('all' keeps every platform). */
export function filterAttentionItemsByBackend(
  items: readonly AttentionItem[],
  backendKey: string,
): AttentionItem[] {
  if (backendKey === 'all') return [...items]
  return items.filter(item => resolveAttentionBackendIdentity(item).key === backendKey)
}
