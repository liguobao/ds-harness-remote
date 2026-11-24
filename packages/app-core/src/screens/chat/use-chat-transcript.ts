import { useMemo, useRef } from 'react'
import { isSubagentSession } from '../../lib/session-kind'
import { hasVisibleMessageText } from '../../state/event-reducer'
import type { ChatSection } from '../../state/message-helpers'
import { chatSections, inboxQueuedItems, inboxRpcIds, mergeReplyReasoning } from '../../state/message-helpers'
import { extractReferencedFiles, parseMarkdownBlocks } from '../../ui/markdown'
import { aggregateTurnUsageByTurn } from '../chat-process'
import type { ChatItem, RemoteSession, TeamMemberSnapshot, TeamTaskSnapshot } from '../../types'
import { chunkTranscriptSections, isSectionLive, type DisplayChatSection } from './transcript-chunks'
import { useSessionUiArtifacts } from './use-session-ui-artifacts'

const parseBlocksForChunk = (text: string) => parseMarkdownBlocks(text)

export function useChatTranscript({ session, sessions, messages, hostId }: { session: RemoteSession | undefined; sessions: RemoteSession[]; messages: ChatItem[]; hostId: string | undefined }) {
  const visibleMessages = useMemo(() => (session?.backend === 'codex' ? mergeReplyReasoning(messages) : messages).filter(item =>
    item.kind !== 'message' || (item.role !== 'system' && !item.context && !item.usageOnly && item.sendState !== 'queued'
      && (
        hasVisibleMessageText(item.text)
        || hasVisibleMessageText(item.reasoning ?? '')
        || (item.images?.length ?? 0) > 0
        || (item.files?.length ?? 0) > 0
        // Output-less failure turns keep an empty assistant row carrying only the
        // turnEnd reason — it must stay visible so the failure is explainable.
        || item.turnEnd !== undefined))), [messages, session?.backend])
  const turnUsageByTurn = useMemo(() => aggregateTurnUsageByTurn(messages), [messages])
  // Feed the previous list back so untouched groups keep their identity; the
  // streaming delta then only rebuilds the group that actually changed.
  // Track sessionId inline so switching sessions never scans the prior session's
  // sections on the first frame.
  const previousSectionsRef = useRef<{ sessionId: string | undefined; sections: readonly ChatSection[] }>({
    sessionId: undefined,
    sections: [],
  })
  const visibleSections = useMemo(() => {
    const prev = previousSectionsRef.current.sessionId === session?.sessionId
      ? previousSectionsRef.current.sections
      : []
    const next = chatSections(visibleMessages, prev)
    previousSectionsRef.current = { sessionId: session?.sessionId, sections: next }
    return next
  }, [visibleMessages, session?.sessionId])
  // Keep any turn that was ever observed live/streaming unchunked for the rest
  // of this session visit so turn completion never swaps FlatList row keys.
  const liveTurnKeysRef = useRef<{ sessionId: string | undefined; keys: Set<string> }>({
    sessionId: undefined,
    keys: new Set(),
  })
  const chunkCacheRef = useRef(new WeakMap<ChatSection, readonly DisplayChatSection[]>())
  const isSessionRunning = session?.running === true
  const chunkedSections = useMemo(() => {
    if (liveTurnKeysRef.current.sessionId !== session?.sessionId) {
      liveTurnKeysRef.current = { sessionId: session?.sessionId, keys: new Set() }
    }
    const liveKeys = liveTurnKeysRef.current.keys
    for (let i = 0; i < visibleSections.length; i += 1) {
      const sec = visibleSections[i]!
      if (isSectionLive(sec, i === visibleSections.length - 1, isSessionRunning)) {
        liveKeys.add(sec.key)
      }
    }
    return chunkTranscriptSections(visibleSections, {
      liveTurnKeys: liveKeys,
      isSessionRunning,
      backend: session?.backend,
      parseBlocks: parseBlocksForChunk,
      extractFiles: extractReferencedFiles,
      cache: chunkCacheRef.current,
    })
  }, [visibleSections, isSessionRunning, session?.sessionId, session?.backend])
  const { uiBySection, visibleUiIds } = useSessionUiArtifacts({
    messages,
    visibleSections,
    hostId,
    sessionId: session?.sessionId,
    backend: session?.backend,
  })
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
  return { visibleMessages, visibleSections, chunkedSections, turnUsageByTurn, uiBySection, visibleUiIds, queueItems, childSessions, teamState }
}
