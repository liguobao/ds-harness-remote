import { extractHandoffOriginFromItems } from '../lib/handoff-context'
import {
  harnessDisplayName,
  isHandoffRawText,
  parseHandoffPreview,
  type HandoffPreviewInfo,
  type SessionHandoffOrigin,
} from '../lib/handoff-preview'
import { strings } from '../locales/i18n'
import type { ChatItem, RemoteSession } from '../types'

type SessionMetadataRecord = Record<string, unknown>
type ProjectionRecord = Record<string, unknown>

export interface HandoffOriginBadgeInfo {
  isHandoff: boolean
  sourceBackend?: string
  targetBackend?: string
  origin?: SessionHandoffOrigin
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

function isRecord(value: unknown): value is ProjectionRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getMetadata(session: RemoteSession): SessionMetadataRecord | undefined {
  const values = session.projections?.values
  if (!isRecord(values)) return undefined
  const metadata = values.sessionListMetadata
  return isRecord(metadata) ? metadata : undefined
}

function pickProjectTitle(record: Record<string, unknown>): string | undefined {
  const keys = [
    'title',
    'sessionTitle',
    'conversationTitle',
    'label',
    'name',
  ] as const
  for (const key of keys) {
    const value = trimString(record[key])
    if (value !== undefined) return value
  }
  return undefined
}

function pickProjectTitleFromProjections(values: ProjectionRecord): string | undefined {
  const direct = pickProjectTitle(values)
  if (direct !== undefined) return direct

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && /title/i.test(key)) {
      const candidate = trimString(value)
      if (candidate !== undefined) return candidate
    }
  }

  const projectionContainers = ['summary', 'metadata', 'session', 'data', 'view'] as const
  for (const key of projectionContainers) {
    const nested = values[key]
    if (!isRecord(nested)) continue
    const nestedTitle = pickProjectTitle(nested)
    if (nestedTitle !== undefined) return nestedTitle
  }

  return undefined
}

function sessionTitleCandidate(session: RemoteSession): string | undefined {
  const metadata = getMetadata(session)
  const projectedTitle = trimString(metadata?.title)
  if (projectedTitle !== undefined) return projectedTitle

  const projectionValues = isRecord(session.projections?.values)
    ? session.projections.values
    : undefined
  const projectionTitle = projectionValues === undefined ? undefined : pickProjectTitleFromProjections(projectionValues)
  if (projectionTitle !== undefined) return projectionTitle

  const name = trimString((session as { name?: unknown }).name)
  if (name !== undefined) return name

  const label = trimString((session as { label?: unknown }).label)
  if (label !== undefined) return label

  const title = trimString(session.title)
  if (title !== undefined) return title

  return trimString(projectionValues?.summary)
    ?? trimString((session as { summary?: unknown }).summary)
}

function sessionSummaryCandidates(session: RemoteSession, primaryCandidate?: string): string[] {
  const results: string[] = []
  const seen = new Set<string>()
  const push = (value: unknown) => {
    const text = trimString(value)
    if (text === undefined || seen.has(text)) return
    seen.add(text)
    results.push(text)
  }
  push(primaryCandidate)
  push(sessionTitleCandidate(session))
  push(session.projections?.values?.summary)
  push((session as { summary?: unknown }).summary)
  push(session.title)
  return results
}

function previewOrigin(preview: HandoffPreviewInfo | undefined, session: RemoteSession): SessionHandoffOrigin | undefined {
  if (preview === undefined || preview.sourceBackend === undefined) return undefined
  return {
    sourceBackend: preview.sourceBackend,
    targetBackend: preview.targetBackend ?? session.backend ?? 'harness',
    ...(preview.sourceSessionId !== undefined ? { sourceSessionId: preview.sourceSessionId } : {}),
    ...(preview.sourceTitle !== undefined ? { sourceTitle: preview.sourceTitle } : {}),
    ...(preview.preset !== undefined ? { preset: preview.preset } : {}),
  }
}

function mergeOrigins(
  higher: SessionHandoffOrigin | undefined,
  lower: SessionHandoffOrigin | undefined,
): SessionHandoffOrigin | undefined {
  if (higher === undefined) return lower
  if (lower === undefined) return higher
  return {
    sourceBackend: higher.sourceBackend || lower.sourceBackend,
    targetBackend: higher.targetBackend ?? lower.targetBackend,
    sourceSessionId: higher.sourceSessionId ?? lower.sourceSessionId,
    sourceTitle: higher.sourceTitle ?? lower.sourceTitle,
    fallbackTitle: higher.fallbackTitle ?? lower.fallbackTitle,
    preset: higher.preset ?? lower.preset,
    createdAt: higher.createdAt ?? lower.createdAt,
  }
}

function parseBestPreviewInfo(candidates: readonly string[]): HandoffPreviewInfo | undefined {
  let merged: HandoffPreviewInfo | undefined
  for (const raw of candidates) {
    const parsed = parseHandoffPreview(raw)
    if (parsed === undefined) continue
    merged = merged === undefined
      ? parsed
      : {
          sourceBackend: merged.sourceBackend ?? parsed.sourceBackend,
          targetBackend: merged.targetBackend ?? parsed.targetBackend,
          sourceSessionId: merged.sourceSessionId ?? parsed.sourceSessionId,
          sourceTitle: merged.sourceTitle ?? parsed.sourceTitle,
          preset: merged.preset ?? parsed.preset,
        }
  }
  return merged
}

/**
 * Resolve cross-agent handoff origin metadata from loaded messages, persisted browse memory,
 * and raw preview/summary headers (highest to lowest priority).
 */
export function resolveSessionHandoffOrigin(
  session: RemoteSession,
  storedOrigin?: SessionHandoffOrigin,
  messages?: readonly ChatItem[],
): SessionHandoffOrigin | undefined {
  const fromMessages = extractHandoffOriginFromItems(messages)
  const previewInfo = parseBestPreviewInfo(sessionSummaryCandidates(session))
  const fromPreview = previewOrigin(previewInfo, session)
  return mergeOrigins(mergeOrigins(fromMessages, storedOrigin), fromPreview)
}

/** Resolve badge visibility and direction metadata for any cross-agent handoff session. */
export function resolveSessionHandoffBadge(
  session: RemoteSession,
  storedOrigin?: SessionHandoffOrigin,
  messages?: readonly ChatItem[],
): HandoffOriginBadgeInfo | undefined {
  const origin = resolveSessionHandoffOrigin(session, storedOrigin, messages)
  const candidates = sessionSummaryCandidates(session)
  const hasRawHandoff = candidates.some(isHandoffRawText)
  if (origin === undefined && !hasRawHandoff) return undefined
  const preview = parseBestPreviewInfo(candidates)
  const sourceBackend = origin?.sourceBackend ?? preview?.sourceBackend
  const targetBackend = origin?.targetBackend ?? preview?.targetBackend ?? (sourceBackend ? (session.backend ?? 'harness') : undefined)
  return {
    isHandoff: true,
    ...(sourceBackend !== undefined ? { sourceBackend } : {}),
    ...(targetBackend !== undefined ? { targetBackend } : {}),
    ...(origin !== undefined ? { origin } : {}),
  }
}

function formatHandoffDirectionTitle(sourceBackend?: string, targetBackend?: string): string | undefined {
  if (!sourceBackend) return undefined
  const from = harnessDisplayName(sourceBackend)
  if (targetBackend) {
    return `${from} → ${harnessDisplayName(targetBackend)}`
  }
  return strings.handoff.badgeFrom(from)
}

export function resolveSessionDisplayTitle(
  session: RemoteSession,
  storedOrigin?: SessionHandoffOrigin,
  messages?: readonly ChatItem[],
): string | undefined {
  const candidate = sessionTitleCandidate(session)
  const candidateIsRaw = candidate !== undefined && isHandoffRawText(candidate)
  if (candidate !== undefined && !candidateIsRaw) return candidate

  const badge = resolveSessionHandoffBadge(session, storedOrigin, messages)
  if (badge === undefined) return undefined

  const previewInfo = parseBestPreviewInfo(sessionSummaryCandidates(session, candidate))
  return badge.origin?.sourceTitle
    ?? previewInfo?.sourceTitle
    ?? badge.origin?.fallbackTitle
    ?? formatHandoffDirectionTitle(badge.sourceBackend, badge.targetBackend)
    ?? strings.handoff.title
}
