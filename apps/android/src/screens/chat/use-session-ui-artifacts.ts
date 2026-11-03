import { useMemo, useRef } from 'react'
import { placeUiArtifacts, projectUiArtifacts, type UiArtifact } from '../../state/ui-artifacts'
import type { ChatItem } from '../../types'
import type { ChatSection } from '../../state/message-helpers'

export type SectionArtifacts = { cards: UiArtifact[]; pointers: UiArtifact[] }

const EMPTY_UI_BY_SECTION = new Map<string, SectionArtifacts>()
const EMPTY_UI_IDS = new Set<string>()

function sameArtifacts(a: readonly UiArtifact[], b: readonly UiArtifact[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (left === right) continue
    if (left === undefined || right === undefined) return false
    if (
      left.hostId !== right.hostId
      || left.sessionId !== right.sessionId
      || left.uiId !== right.uiId
      || left.version !== right.version
    ) return false
  }
  return true
}

export function useSessionUiArtifacts({
  messages,
  visibleSections,
  hostId,
  sessionId,
  backend,
}: {
  messages: readonly ChatItem[]
  visibleSections: readonly ChatSection[]
  hostId: string | undefined
  sessionId: string | undefined
  backend?: string
}) {
  const uiBySectionCache = useRef<ReadonlyMap<string, SectionArtifacts>>(EMPTY_UI_BY_SECTION)
  const visibleUiIdsCache = useRef<ReadonlySet<string>>(EMPTY_UI_IDS)
  const scopeRef = useRef<{ hostId?: string; sessionId?: string }>({ hostId, sessionId })

  // Synchronously invalidate caches when the scope changes during render,
  // before memoized calculations can mistakenly reuse the prior session's data.
  if (scopeRef.current.hostId !== hostId || scopeRef.current.sessionId !== sessionId) {
    scopeRef.current = { hostId, sessionId }
    uiBySectionCache.current = EMPTY_UI_BY_SECTION
    visibleUiIdsCache.current = EMPTY_UI_IDS
  }

  const rawArtifacts = useMemo(() => {
    if (hostId === undefined || sessionId === undefined
      || (backend !== undefined && backend !== 'harness')) return []
    return projectUiArtifacts(messages, hostId, sessionId)
  }, [messages, hostId, sessionId, backend])

  const uiBySection = useMemo<ReadonlyMap<string, SectionArtifacts>>(() => {
    if (hostId === undefined || sessionId === undefined
      || (backend !== undefined && backend !== 'harness')) return EMPTY_UI_BY_SECTION
    const next = placeUiArtifacts(rawArtifacts, visibleSections)
    if (next.size === 0) {
      uiBySectionCache.current = EMPTY_UI_BY_SECTION
      return EMPTY_UI_BY_SECTION
    }
    const previous = uiBySectionCache.current
    if (previous.size === 0) {
      uiBySectionCache.current = next
      return next
    }
    // `placeUiArtifacts` allocates fresh buckets on every run, so compare contents
    // to preserve referential stability and keep memoized rows from rerendering.
    let changed = next.size !== previous.size
    const stable = new Map<string, SectionArtifacts>()
    for (const [key, bucket] of next) {
      const old = previous.get(key)
      if (old !== undefined && sameArtifacts(old.cards, bucket.cards) && sameArtifacts(old.pointers, bucket.pointers)) {
        stable.set(key, old)
      } else {
        stable.set(key, bucket)
        changed = true
      }
    }
    if (!changed) return previous
    uiBySectionCache.current = stable
    return stable
  }, [rawArtifacts, visibleSections, hostId, sessionId, backend])

  const visibleUiIds = useMemo(() => {
    if (uiBySection.size === 0) return EMPTY_UI_IDS
    const next = new Set([...uiBySection.values()].flatMap(value => value.cards.map(card => card.uiId)))
    const cached = visibleUiIdsCache.current
    if (cached.size === next.size) {
      let identical = true
      for (const id of next) {
        if (!cached.has(id)) { identical = false; break }
      }
      if (identical) return cached
    }
    visibleUiIdsCache.current = next
    return next
  }, [uiBySection])

  return {
    rawArtifacts,
    uiBySection,
    visibleUiIds,
  }
}
