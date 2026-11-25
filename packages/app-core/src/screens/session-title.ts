import { HANDOFF_COMMENT_PREFIX, handoffPreviewTitle } from '../lib/handoff-preview'
import { strings } from '../locales/i18n'
import type { RemoteSession } from '../types'

type SessionMetadataRecord = Record<string, unknown>
type ProjectionRecord = Record<string, unknown>

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

export function resolveSessionDisplayTitle(session: RemoteSession): string | undefined {
  const title = sessionTitleCandidate(session)
  if (!title?.startsWith(HANDOFF_COMMENT_PREFIX)) return title

  // A shortened title and a longer first-message preview can coexist on the same thread.
  const summary = trimString(session.projections?.values?.summary)
  return handoffPreviewTitle(title)
    ?? (summary && summary !== title ? handoffPreviewTitle(summary) : undefined)
    ?? strings.handoff.title
}
