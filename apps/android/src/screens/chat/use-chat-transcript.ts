import { useEffect, useMemo, useRef } from 'react'
import { isSubagentSession } from '../../lib/session-kind'
import { hasVisibleMessageText } from '../../state/event-reducer'
import type { ChatSection } from '../../state/message-helpers'
import { chatSections, inboxQueuedItems, inboxRpcIds, mergeReplyReasoning } from '../../state/message-helpers'
import { placeUiArtifacts, projectUiArtifacts, type UiArtifact } from '../../state/ui-artifacts'
import type { ChatItem, RemoteSession, TeamMemberSnapshot, TeamTaskSnapshot } from '../../types'

const EMPTY_UI_BY_SECTION = new Map<string, SectionArtifacts>()
const EMPTY_UI_IDS = new Set<string>()

type SectionArtifacts = { cards: UiArtifact[]; pointers: UiArtifact[] }

/**
 * Artifact identity is `uiId` plus `version`: a ui_patch can only advance the
 * version, so equal pairs mean equal content. Used to keep the per-section
 * buckets referentially stable across streaming deltas.
 */
function sameArtifacts(a: readonly UiArtifact[], b: readonly UiArtifact[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0;index < a.length;index += 1) {
    const left = a[index]
    const right = b[index]
    if (left === right) continue
    if (left === undefined || right === undefined) return false
    if (left.uiId !== right.uiId || left.version !== right.version) return false
  }
  return true
}

export function useChatTranscript({ session, sessions, messages, hostId }: { session: RemoteSession | undefined; sessions: RemoteSession[]; messages: ChatItem[]; hostId: string | undefined }) {
  const visibleMessages = useMemo(() => (session?.backend === 'codex' ? mergeReplyReasoning(messages) : messages).filter(item =>
    item.kind !== 'message' || (item.role !== 'system' && !item.context && item.sendState !== 'queued'
      && (
        hasVisibleMessageText(item.text)
        || hasVisibleMessageText(item.reasoning ?? '')
        || (item.images?.length ?? 0) > 0
        // Output-less failure turns keep an empty assistant row carrying only the
        // turnEnd reason — it must stay visible so the failure is explainable.
        || item.turnEnd !== undefined))), [messages, session?.backend])
  // Feed the previous list back so untouched groups keep their identity; the
  // streaming delta then only rebuilds the group that actually changed.
  const previousSectionsRef = useRef<readonly ChatSection[]>([])
  const visibleSections = useMemo(() => {
    const next = chatSections(visibleMessages, previousSectionsRef.current)
    previousSectionsRef.current = next
    return next
  }, [visibleMessages])
  const uiBySectionCache = useRef<ReadonlyMap<string, SectionArtifacts>>(EMPTY_UI_BY_SECTION)
  const uiBySection = useMemo<ReadonlyMap<string, SectionArtifacts>>(() => {
    if (hostId === undefined || session === undefined
      || (session.backend !== undefined && session.backend !== 'harness')) return EMPTY_UI_BY_SECTION
    const next = placeUiArtifacts(projectUiArtifacts(messages, hostId, session.sessionId), visibleSections)
    if (next.size === 0) {
      uiBySectionCache.current = EMPTY_UI_BY_SECTION
      return EMPTY_UI_BY_SECTION
    }
    const previous = uiBySectionCache.current
    if (previous.size === 0) {
      uiBySectionCache.current = next
      return next
    }
    // `placeUiArtifacts` allocates a fresh bucket and fresh arrays on every run,
    // so an unchanged card would still hand ChatProcessGroup a new prop and
    // defeat its memo. An equal bucket is reusable as-is.
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
  }, [messages, hostId, session?.sessionId, session?.backend, visibleSections])
  const visibleUiIdsCache = useRef<ReadonlySet<string>>(EMPTY_UI_IDS)
  const visibleUiIds = useMemo(() => {
    if (uiBySection.size === 0) return EMPTY_UI_IDS
    const next = new Set([...uiBySection.values()].flatMap(value => value.cards.map(card => card.uiId)))
    // Identical members -> identical reference, so memoized rows keep their props.
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

  // The caches above describe one transcript. Switching sessions must drop them,
  // otherwise the first render of the next session would compare against a
  // foreign list (harmless for correctness, wasteful for memory).
  useEffect(() => {
    previousSectionsRef.current = []
    uiBySectionCache.current = EMPTY_UI_BY_SECTION
    visibleUiIdsCache.current = EMPTY_UI_IDS
  }, [session?.sessionId])
  // Queued prompts: the Host `inbox` projection is authoritative (includes
  // items queued from other devices); local `queued` rows are the fallback for
  // Hosts without projections. Rows in this state are hidden from the timeline.
  const inboxProjection = (session?.projections?.values as Record<string, unknown> | undefined)?.inbox
  const queueItems = useMemo(() => {
    const inboxItems = inboxProjection === undefined ? [] : inboxQueuedItems(inboxProjection)
    const adopted = inboxRpcIds(inboxProjection)
    const pending = messages.flatMap(item => item.kind === 'message' && item.role === 'user' && item.sendState === 'queued'
      && item.queuedAdopted !== true
      && (item.requestRpcId === undefined || !adopted.has(item.requestRpcId)) ? [{ preview: item.text }] : [])
    // Union (the official QueueDock's pendingQueue behaviour): inbox rows are
    // authoritative and local rows not yet adopted by the projection cover the
    // lag window, so a queued prompt is never invisible on both ends. Only
    // inbox rows carry the host item id needed for queue actions.
    return [...inboxItems, ...pending]
  }, [inboxProjection, messages])
  // Fork ancestry does not make a conversation a subagent child.
  const childSessions = useMemo(
    () => sessions.filter(item => isSubagentSession(item) && item.parentSessionId === session?.sessionId),
    [sessions, session?.sessionId])
  // Agent team: the `agentTeam` projection carries the durable roster
  // (member name + role description + phase) and the task board (subject +
  // status + owning member). This is the team view — distinct from the
  // subagent child-session list above.
  const teamState = useMemo(() => {
    const raw = (session?.projections?.values as Record<string, unknown> | undefined)?.agentTeam
    if (typeof raw !== 'object' || raw === null) return undefined
    const record = raw as Record<string, unknown>
    const members = Array.isArray(record.members) ? record.members.filter((entry): entry is TeamMemberSnapshot =>
      typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).id === 'string') : []
    const tasks = Array.isArray(record.tasks) ? record.tasks.filter((entry): entry is TeamTaskSnapshot =>
      typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).id === 'string') : []
    return { members, tasks } satisfies { members: TeamMemberSnapshot[]; tasks: TeamTaskSnapshot[] }
  }, [session?.projections?.values])
  return { visibleMessages, visibleSections, uiBySection, visibleUiIds, queueItems, childSessions, teamState }
}
