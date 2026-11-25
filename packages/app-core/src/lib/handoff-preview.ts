export const HANDOFF_COMMENT_PREFIX = '<!-- dsh-handoff:v1 '
export const HANDOFF_MARKER_PREFIX = '<!-- dsh-handoff:'

export interface SessionHandoffOrigin {
  sourceBackend: string
  targetBackend?: string
  sourceSessionId?: string
  sourceTitle?: string
  fallbackTitle?: string
  preset?: 'review' | 'continue' | 'custom'
  createdAt?: number
}

export interface HandoffPreviewInfo {
  sourceBackend?: string
  targetBackend?: string
  sourceSessionId?: string
  sourceTitle?: string
  preset?: 'review' | 'continue' | 'custom'
}

export function harnessDisplayName(value: string): string {
  switch (value) {
    case 'harness': return 'DeepSeek'
    case 'codex': return 'Codex'
    case 'claude': return 'Claude'
    case 'hermes': return 'Hermes'
    case 'cursor': return 'Cursor'
    case 'antigravity': return 'Antigravity'
    case 'opencode': return 'OpenCode'
    case 'pi': return 'Pi'
    default: return value
  }
}

export function isHandoffRawText(raw?: string): boolean {
  if (typeof raw !== 'string') return false
  const trimmed = raw.trimStart()
  if (trimmed.length === 0) return false
  return trimmed.startsWith(HANDOFF_MARKER_PREFIX)
    || (trimmed.length >= 10 && HANDOFF_MARKER_PREFIX.startsWith(trimmed))
    || trimmed.startsWith('<handoff_context>')
}

export function firstLineSnippet(raw: string | undefined, maxChars = 60): string | undefined {
  if (typeof raw !== 'string' || maxChars <= 0) return undefined
  for (const line of raw.split(/\r?\n/u)) {
    const collapsed = line.replace(/\s+/gu, ' ').trim()
    if (collapsed.length === 0 || isHandoffRawText(collapsed)) continue
    if (collapsed.length <= maxChars) return collapsed
    if (maxChars === 1) return '…'
    return `${collapsed.slice(0, maxChars - 1).trimEnd()}…`
  }
  return undefined
}

function decodeCompleteJsonField(header: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`, 'u')
  const match = re.exec(header)
  if (!match) return undefined
  try {
    const value: unknown = JSON.parse(match[1]!)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function decodeTruncatedJsonField(header: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*\\\\?)$`, 'u')
  const match = re.exec(header)
  if (!match) return undefined
  let candidate = match[1]!
  // A short preview can terminate mid-escape (e.g. `\u00` or trailing `\`); trim back up to 6 chars until valid JSON.
  for (let trim = 0; trim <= 6 && candidate.length > 0; trim += 1) {
    try {
      const value: unknown = JSON.parse(`"${candidate}"`)
      if (typeof value === 'string') return value
    } catch {
      candidate = candidate.slice(0, -1)
    }
  }
  return undefined
}

function normalizeTitleValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  return collapsed.length > 0 && !isHandoffRawText(collapsed) ? collapsed : undefined
}

function normalizePresetValue(value: unknown): 'review' | 'continue' | 'custom' | undefined {
  return value === 'review' || value === 'continue' || value === 'custom' ? value : undefined
}

/**
 * Parse available metadata from a raw handoff header or truncated first-message preview.
 * Tolerates leading whitespace, old/new JSON key orders, and mid-string truncation.
 */
export function parseHandoffPreview(preview: string): HandoffPreviewInfo | undefined {
  const trimmed = preview.trimStart()
  if (!trimmed.startsWith(HANDOFF_MARKER_PREFIX)) return undefined
  if (!trimmed.startsWith(HANDOFF_COMMENT_PREFIX)) return {}

  const header = trimmed.slice(HANDOFF_COMMENT_PREFIX.length, 4096).split(/ -->|[\r\n]/u, 1)[0]!
  try {
    const parsed: unknown = JSON.parse(header)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      const sourceBackend = typeof record.sourceBackend === 'string' && record.sourceBackend.trim()
        ? record.sourceBackend.trim() : undefined
      const targetBackend = typeof record.targetBackend === 'string' && record.targetBackend.trim()
        ? record.targetBackend.trim() : undefined
      const sourceSessionId = typeof record.sourceSessionId === 'string' && record.sourceSessionId.trim()
        ? record.sourceSessionId.trim() : undefined
      const sourceTitle = typeof record.sourceTitle === 'string'
        ? normalizeTitleValue(record.sourceTitle) : undefined
      const preset = normalizePresetValue(record.preset)
      return {
        ...(sourceBackend !== undefined ? { sourceBackend } : {}),
        ...(targetBackend !== undefined ? { targetBackend } : {}),
        ...(sourceSessionId !== undefined ? { sourceSessionId } : {}),
        ...(sourceTitle !== undefined ? { sourceTitle } : {}),
        ...(preset !== undefined ? { preset } : {}),
      }
    }
  } catch {
    // Fall through to partial field extraction for truncated previews.
  }

  const sourceBackend = decodeCompleteJsonField(header, 'sourceBackend')?.trim() || undefined
  const targetBackend = decodeCompleteJsonField(header, 'targetBackend')?.trim() || undefined
  const sourceSessionId = decodeCompleteJsonField(header, 'sourceSessionId')?.trim() || undefined
  const rawTitle = decodeCompleteJsonField(header, 'sourceTitle') ?? decodeTruncatedJsonField(header, 'sourceTitle')
  const sourceTitle = normalizeTitleValue(rawTitle)
  const preset = normalizePresetValue(decodeCompleteJsonField(header, 'preset'))
  return {
    ...(sourceBackend !== undefined ? { sourceBackend } : {}),
    ...(targetBackend !== undefined ? { targetBackend } : {}),
    ...(sourceSessionId !== undefined ? { sourceSessionId } : {}),
    ...(sourceTitle !== undefined ? { sourceTitle } : {}),
    ...(preset !== undefined ? { preset } : {}),
  }
}

/** A thread preview can end mid-header, after or inside the title before the closing comment. */
export function handoffPreviewTitle(preview: string): string | undefined {
  return parseHandoffPreview(preview)?.sourceTitle
}

/** Replace any raw handoff envelope string with its clean display title or fallback. */
export function sanitizeHandoffDisplayTitle(
  raw: string | undefined,
  fallbackTitle?: string,
): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (!isHandoffRawText(trimmed)) return trimmed
  return parseHandoffPreview(trimmed)?.sourceTitle ?? fallbackTitle
}
