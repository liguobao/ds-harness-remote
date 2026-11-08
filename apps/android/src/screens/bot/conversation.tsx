import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native'
import { ArrowUp, Plus, Square, Users } from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import { botMessageRequest, object, objects, text, type BotEntry, type BotRoom, type BotState, type BotRemoteClient, type BotObject } from '../../services/bot-catalog'
import { useAppStore } from '../../state/store'
import type { ChatItem, RemoteSession } from '../../types'
import { Button, IconButton } from '../../ui/components'
import { decodeSessionMentionUri, markdownFilePath, MarkdownLinkProvider, NativeMarkdown, openSafeExternalUrl } from '../../ui/markdown'
import { detectMention, MentionPopover, splitDraftSegments, type MentionGroup } from '../../ui/mention-popover'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ChatActivityGroup, ChatItemView, QueueDock } from '../chat/messages'
import { chatSections, inboxQueuedItems, inboxRpcIds, type ChatSection } from '../../state/message-helpers'
import { processSegments } from '../chat-process'
import { useSessionUiArtifacts } from '../chat/use-session-ui-artifacts'
import { IntelligentUiCard } from '../intelligent-ui-card'
import type { ToolActivity } from '../../types'
import type { UiArtifact } from '../../state/ui-artifacts'
import { buildBotMentionRows, type ReferenceChatCandidate } from './at-menu'
import { BotAvatar } from './avatar'
import { BotQuestion, BotSettledCard, BotViewCard } from './cards'
import { parseBotReplies } from './replies'
import { BotReplies, BotViaPill } from './reply-view'
import { BotAsideCard } from './aside'
import type { BotPerform } from './editor'
import { BotPlusMenuModal, ReferenceChatModal, ReferencedChatPills } from './reference-chat-modal'
import { createBotStyles } from './styles'
import { linkBotMentions, botMentionTarget } from './mentions'
import { SessionToolsPanel } from '../session-tools-panel'

const EMPTY: ChatItem[] = []
type BotChatRow =
  | { kind: 'item'; key: string; item: ChatItem; artifacts?: UiArtifact[] }
  | { kind: 'activity'; key: string; items: ChatItem[]; closed: boolean }
  | { kind: 'ui'; key: string; artifact: UiArtifact }
  | { kind: 'ui-pointer'; key: string; artifact: UiArtifact }
  | { kind: 'ui-unavailable'; key: string; item: ToolActivity }
export function BotConversation({ bot, room, state, client, session, busy, active, perform, onSelectBot }: {
  bot?: BotEntry; room?: BotRoom; state: BotState; client: BotRemoteClient; session: RemoteSession
  busy: boolean; active: boolean; perform: BotPerform; onSelectBot: (id: string) => void
}) {
  const transformText = useCallback((value: string) => linkBotMentions(value, state.bots, bot?.id), [state.bots, bot?.id])
  const styles = useThemedStyles(createBotStyles)
  const { colors } = useTheme()
  const messages = useAppStore(store => store.messages[session.sessionId] ?? EMPTY)
  const selected = useAppStore(store => store.selectedSession)
  const storeBusy = useAppStore(store => store.busyAction)
  const hasMore = useAppStore(store => store.historyHasMore)
  const olderLoading = useAppStore(store => store.historyLoadingOlder)
  const loadOlder = useAppStore(store => store.loadOlderHistory)
  const respondApproval = useAppStore(store => store.respondApproval)
  const respondQuestion = useAppStore(store => store.respondQuestion)
  const stopSession = useAppStore(store => store.stopSession)
  const [draft, setDraft] = useState('')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const selectionRef = useRef({ start: 0, end: 0 })
  const inputRef = useRef<TextInput>(null)
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const atSpanStartRef = useRef(0)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [referenceChatOpen, setReferenceChatOpen] = useState(false)
  const [stagedReferences, setStagedReferences] = useState<ReferenceChatCandidate[]>([])
  const [fileLinkPath, setFileLinkPath] = useState<string>()
  const sessions = useAppStore(store => store.sessions)
  const openSession = useAppStore(store => store.openSession)
  const connected = useAppStore(store => store.connection.phase === 'connected')
  const [progress, setProgress] = useState<BotObject[]>([])
  const [earlier, setEarlier] = useState<BotObject[]>([])
  const [cursor, setCursor] = useState<unknown>(undefined)
  const [olderBusy, setOlderBusy] = useState(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(true)
  const request = useRef(new AbortController())
  const list = useRef<FlatList<BotChatRow>>(null)
  const atEnd = useRef(true)
  const scrolling = useRef(false)
  const scrollFrame = useRef<number | undefined>(undefined)
  const followEnd = () => {
    if (!atEnd.current) return
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = requestAnimationFrame(() => { if (atEnd.current) list.current?.scrollToEnd({ animated: false }) })
  }
  useEffect(() => () => { if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current) }, [])
  const ready = selected?.sessionId === session.sessionId
  const onLinkPress = useCallback((href: string) => {
    // External URLs open in browser regardless of bot readiness or connection state
    if (openSafeExternalUrl(href)) return

    if (!ready || !connected) return
    const targetSessionId = decodeSessionMentionUri(href)
    if (targetSessionId !== undefined) {
      const matchedBot = state.bots.find(
        entry =>
          entry.sessionId === targetSessionId
          || entry.id === targetSessionId
          || entry.parts?.includes(targetSessionId),
      )
      if (matchedBot !== undefined) {
        if (matchedBot.id !== bot?.id) onSelectBot(matchedBot.id)
        return
      }
      const matchedSession = sessions.find(item => item.sessionId === targetSessionId)
      if (matchedSession !== undefined) {
        void openSession(matchedSession)
      }
      return
    }
    const target = botMentionTarget(href, state.bots)
    if (target !== undefined) {
      if (target !== bot?.id) onSelectBot(target)
      return
    }
    const path = markdownFilePath(href)
    if (path !== undefined) setFileLinkPath(path)
  }, [state.bots, bot?.id, onSelectBot, ready, connected, sessions, openSession])
  useEffect(() => { setFileLinkPath(undefined); setAtQuery(null); setPlusMenuOpen(false); setReferenceChatOpen(false); setStagedReferences([]) }, [session.sessionId])

  const draftSegments = useMemo(() => splitDraftSegments(draft), [draft])
  const updateAtMention = (nextText: string, cursor: number) => {
    const detected = detectMention(nextText, cursor)
    if (detected === undefined || detected.type !== 'context') {
      setAtQuery(null)
      return
    }
    atSpanStartRef.current = detected.start
    setAtQuery(detected.query)
  }
  const handleDraftChange = (nextText: string) => {
    if (nextText === draftRef.current) return
    const delta = nextText.length - draftRef.current.length
    draftRef.current = nextText
    setDraft(nextText)
    const cursor = Math.max(0, Math.min(nextText.length, selectionRef.current.end + delta))
    selectionRef.current = { start: cursor, end: cursor }
    setSelection({ start: cursor, end: cursor })
    updateAtMention(nextText, cursor)
  }
  const handleSelectionChange = (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
    const nextSel = event.nativeEvent.selection
    if (nextSel.start === selectionRef.current.start && nextSel.end === selectionRef.current.end) return
    selectionRef.current = nextSel
    setSelection(nextSel)
    if (nextSel.start === nextSel.end) updateAtMention(draftRef.current, nextSel.end)
  }
  const insertAtMention = (mentionText: string) => {
    const start = atSpanStartRef.current
    const end = selectionRef.current.end
    const current = draftRef.current
    const nextText = current.slice(0, start) + mentionText + current.slice(end)
    const nextCursor = start + mentionText.length
    draftRef.current = nextText
    setDraft(nextText)
    selectionRef.current = { start: nextCursor, end: nextCursor }
    setSelection({ start: nextCursor, end: nextCursor })
    setAtQuery(null)
    inputRef.current?.focus()
  }
  const handlePickReferencedChat = (_mentionText: string, candidate: ReferenceChatCandidate) => {
    setStagedReferences(current =>
      current.some(item => item.sessionId === candidate.sessionId)
        ? current
        : [...current, candidate],
    )
    setAtQuery(null)
    inputRef.current?.focus()
  }
  const botAtMentionGroups = useMemo<MentionGroup[]>(() => {
    if (atQuery === null) return []
    const rows = buildBotMentionRows({
      state,
      currentBotId: bot?.id,
      currentRoom: room,
      query: atQuery,
    })
    if (rows.length === 0) return []
    return [{
      key: 'bots',
      title: s.bots.title,
      items: rows.map(row => ({
        id: row.id,
        icon: row.bot
          ? ({ size = 16 }) => <BotAvatar bot={row.bot!} size={size + 6} />
          : Users,
        title: row.label,
        description: row.description,
        onPress: () => insertAtMention(row.text),
      })),
    }]
  }, [atQuery, state, bot?.id, room])
  const disabled = busy || !active || !ready
    || (bot !== undefined && bot.sessionId !== session.sessionId)
    || (room !== undefined && (room.sessionId || room.id) !== session.sessionId)
    || state.readOnly !== undefined
  useEffect(() => { setEarlier([]); setCursor(undefined); setProgress([]); setOlderBusy(false); setError(undefined); atEnd.current = true; scrolling.current = false; followEnd() }, [session.sessionId])
  useEffect(() => { mounted.current = true; request.current = new AbortController(); return () => { mounted.current = false; request.current.abort() } }, [session.sessionId])
  useEffect(() => {
    if (room === undefined || !active) return
    const control = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const value = await client.call('room-progress', { roomId: room.id }, control.signal)
        if (!control.signal.aborted) setProgress(objects(value).flatMap(entry => objects(entry.replies)))
      } catch { /* The parent state refresh reports connection and Host errors. */ }
      if (!control.signal.aborted) timer = setTimeout(() => void tick(), 2000)
    }
    void tick()
    return () => { control.abort(); clearTimeout(timer) }
  }, [client, room?.id, active])
  const send = async () => {
    const rawDraft = draft.trim()
    const prefix = stagedReferences.map(item => item.mentionText.trim()).join(' ')
    const submitted = [prefix, rawDraft].filter(Boolean).join(' ')
    if (!submitted || disabled) return
    atEnd.current = true
    followEnd()
    setError(undefined)
    try {
      const message = botMessageRequest(state, bot?.id ?? room?.id ?? '', submitted)
      const result = await perform(message.endpoint, message.payload)
      if (mounted.current && result.ok) {
        draftRef.current = ''
        setDraft(current => current.trim() === rawDraft ? '' : current)
        setStagedReferences([])
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : s.bots.unavailable) }
  }
  const earlierPage = async () => {
    if (olderBusy || bot === undefined || cursor === null) return
    atEnd.current = false
    setOlderBusy(true)
    setError(undefined)
    const signal = request.current.signal
    try {
      const value = object(await client.call('earlier', { sessionId: session.sessionId, ...(cursor === undefined ? {} : { cursor }) }, signal))
      if (!mounted.current || signal.aborted) return
      setEarlier(current => {
        const known = new Set(current.filter(entry => entry.kind === 'btw').map(entry => entry.id))
        const cards = objects(value.btw).filter(entry => entry.botId === bot.id && !known.has(entry.id)).map(entry => ({ ...entry, kind: 'btw', pageCursor: cursor }))
        return [...objects(value.items), ...cards.reverse(), ...current]
      })
      setCursor(value.cursor ?? null)
    } catch { if (mounted.current && !signal.aborted) setError(s.bots.earlierUnavailable) }
    finally { if (mounted.current && !signal.aborted) setOlderBusy(false) }
  }
  // A part can roll over while its aside is still answering. Current roster polls
  // no longer include it, so refresh only historical pages with a pending aside.
  const pendingAsidePages = JSON.stringify([...new Map(earlier.filter(entry => entry.kind === 'btw' && entry.status === 'answering').map(entry => [JSON.stringify(entry.pageCursor ?? null), entry.pageCursor ?? null])).values()])
  useEffect(() => {
    if (!active || !bot || pendingAsidePages === '[]') return
    const control = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        for (const pageCursor of JSON.parse(pendingAsidePages) as unknown[]) {
          const value = object(await client.call('earlier', { sessionId: session.sessionId, ...(pageCursor === null ? {} : { cursor: pageCursor }) }, control.signal))
          if (control.signal.aborted) return
          const cards = new Map(objects(value.btw).filter(card => card.botId === bot.id).map(card => [card.id, card]))
          setEarlier(current => current.map(entry => entry.kind === 'btw' && cards.has(entry.id) ? { ...cards.get(entry.id), kind: 'btw', pageCursor: entry.pageCursor } : entry))
        }
      } catch { /* Preserve the snapshot; the parent reports connection failures. */ }
      if (!control.signal.aborted) timer = setTimeout(() => void tick(), 3000)
    }
    void tick()
    return () => { control.abort(); clearTimeout(timer) }
  }, [active, bot?.id, client, session.sessionId, pendingAsidePages])
  const question = object(state.questions[session.sessionId])
  const view = object(state.views[session.sessionId])
  const closedCards = object(state.closedCards[session.sessionId])
  const approvals = state.approvals.filter(entry => entry.answerable === true && (room ? entry.roomId === room.id : entry.sessionId === session.sessionId))
  const hasDesktopPendingRequest = useMemo(() => {
    const hasConnector = Object.keys(object(state.connectorRequests[session.sessionId])).length > 0
    const hasMail = Object.keys(object(state.mailRequests[session.sessionId])).length > 0
    const computerAsks = object(state.computerLive?.asks)
    const computerHolds = object(state.computerLive?.holds)
    const hasComputer = Boolean(
      bot && (Object.keys(object(computerAsks[bot.id])).length > 0 || Object.keys(object(computerHolds[bot.id])).length > 0),
    )
    return hasConnector || hasMail || hasComputer
  }, [state.connectorRequests, state.mailRequests, state.computerLive, session.sessionId, bot])
  const inboxProjection = (session.projections?.values as Record<string, unknown> | undefined)?.inbox
  const queueItems = useMemo(() => {
    const inboxItems = inboxProjection === undefined ? [] : inboxQueuedItems(inboxProjection)
    const adopted = inboxRpcIds(inboxProjection)
    const pending = messages.flatMap(item =>
      item.kind === 'message'
      && item.role === 'user'
      && item.sendState === 'queued'
      && item.queuedAdopted !== true
      && (item.requestRpcId === undefined || !adopted.has(item.requestRpcId))
        ? [{ preview: item.text }]
        : [],
    )
    return [...inboxItems, ...pending]
  }, [inboxProjection, messages])
  const hidden = state.exchangeTurns[session.sessionId]
  const visible = useMemo(() => {
    const hiddenTurns = new Set(Array.isArray(hidden) ? hidden.map(String) : [])
    return messages.filter(item => item.kind === 'approval' || item.kind === 'question'
      || !(item.turn !== undefined && hiddenTurns.has(item.turn)))
  }, [messages, hidden])
  const hostId = useAppStore(store => store.selectedDevice?.deviceId)
  const previousSectionsRef = useRef<readonly ChatSection[]>([])
  useEffect(() => { previousSectionsRef.current = [] }, [session.sessionId])
  const visibleSections = useMemo(() => {
    const next = chatSections(visible, previousSectionsRef.current)
    previousSectionsRef.current = next
    return next
  }, [visible])
  const { uiBySection, visibleUiIds } = useSessionUiArtifacts({
    messages: visible,
    visibleSections,
    hostId,
    sessionId: session.sessionId,
    backend: session.backend,
  })

  const onSendPrompt = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim()
    if (!trimmed || disabled) return false
    try {
      const message = botMessageRequest(state, bot?.id ?? room?.id ?? '', trimmed)
      const result = await perform(message.endpoint, message.payload)
      return result.ok
    } catch {
      return false
    }
  }, [disabled, state, bot?.id, room?.id, perform])

  const isDisplayTool = (item: ChatItem): boolean => {
    if (item.kind !== 'tool') return false
    if (item.toolKey === 'show_view') return true
    if (item.toolKey === 'ask_user' && text(closedCards[item.id]) !== '') return true
    // A single Bot can relay a group round too; the payload determines presentation.
    if (item.state === 'finished') return (parseBotReplies(item.resultDetail?.text)?.length ?? 0) > 0
    return false
  }
  const rows: BotChatRow[] = visibleSections.flatMap((section): BotChatRow[] => {
    if (section.kind === 'item') {
      // Native system context/receipts can arrive without a turn identifier.
      // They still belong in a disclosure rather than the visible chat body.
      if (section.item.kind === 'message' && section.item.role === 'system') {
        return [{ kind: 'activity', key: `activity:${section.item.id}`, items: [section.item], closed: true }]
      }
      return [section]
    }
    const sectionUi = uiBySection.get(section.key)
    const cards = sectionUi?.cards ?? []
    const pointers = sectionUi?.pointers ?? []
    const unavailableUi = section.items.filter((item): item is ToolActivity =>
      item.kind === 'tool' && item.state === 'finished'
      && (item.toolKey === 'ui_render' || item.toolKey === 'ui_render_widget' || item.toolKey === 'ui_compose')
      && !visibleUiIds.has(item.id)
      && (typeof item.uiResultMeta !== 'object' || item.uiResultMeta === null
        || (item.uiResultMeta as { ok?: unknown }).ok !== false))

    const segments = processSegments(section.items)
    const lastResponseIndex = segments.map(s => s.kind).lastIndexOf('response')
    const closed = section.items.some(item => item.turnEnd !== undefined) || !selected?.running

    const sectionRows: BotChatRow[] = segments.flatMap((segment, index): BotChatRow[] => {
      if (segment.kind === 'response') {
        const attachArtifacts = index === lastResponseIndex && cards.length > 0
        return [{
          kind: 'item',
          key: segment.key,
          item: segment.item,
          ...(attachArtifacts ? { artifacts: cards } : {}),
        }]
      }
      // Cards and group replies stay visible; only intermediate activity folds.
      const result: BotChatRow[] = []
      let pending: ChatItem[] = []
      const flush = () => {
        if (pending.length) {
          result.push({
            kind: 'activity',
            key: `activity:${pending[0]!.id}`,
            items: pending,
            closed: closed || index < segments.length - 1,
          })
          pending = []
        }
      }
      for (const item of segment.items) {
        if (isDisplayTool(item) || item.kind === 'approval' || item.kind === 'question') {
          flush()
          result.push({ kind: 'item', key: item.id, item })
        } else {
          pending.push(item)
        }
      }
      flush()
      return result
    })

    if (lastResponseIndex === -1 && cards.length > 0) {
      for (const ui of cards) {
        sectionRows.push({
          kind: 'ui',
          key: `ui:${ui.hostId}:${ui.sessionId}:${ui.uiId}`,
          artifact: ui,
        })
      }
    }

    for (const pointer of pointers) {
      sectionRows.push({
        kind: 'ui-pointer',
        key: `ui-pointer:${pointer.uiId}:${pointer.version}`,
        artifact: pointer,
      })
    }
    for (const unavail of unavailableUi) {
      sectionRows.push({
        kind: 'ui-unavailable',
        key: `ui-unavailable:${unavail.id}`,
        item: unavail,
      })
    }

    return sectionRows
  })
  const onApproval: Parameters<typeof ChatItemView>[0]['onApproval'] = async (...args) => { if (!disabled) await respondApproval(...args) }
  const onQuestion: Parameters<typeof ChatItemView>[0]['onQuestion'] = async (...args) => { if (!disabled) await respondQuestion(...args) }
  const render = (item: ChatItem, artifacts?: UiArtifact[]) => {
    if (item.kind === 'tool' && item.toolKey === 'ask_user') {
      const closedStatus = text(closedCards[item.id])
      if (closedStatus !== '') {
        try {
          const args = object(JSON.parse(item.arguments ?? item.callDetail?.text ?? 'null'))
          return <BotSettledCard title={text(args.question) || text(args.header) || s.bots.question} closed={closedStatus} />
        } catch {
          return <BotSettledCard title={s.bots.question} closed={closedStatus} />
        }
      }
    }
    if (item.kind === 'tool' && item.toolKey === 'show_view') {
      // Settled and display-only views live in tool history; only the current
      // pending view has authority to submit, and is rendered in the footer.
      if (view.callId === item.id) return null
      const closedStatus = text(closedCards[item.id])
      if (closedStatus !== '') {
        try {
          const args = object(JSON.parse(item.arguments ?? item.callDetail?.text ?? 'null'))
          return <BotSettledCard title={text(args.title) || s.bots.question} closed={closedStatus} />
        } catch {
          return <BotSettledCard title={s.bots.question} closed={closedStatus} />
        }
      }
      try {
        const args = object(JSON.parse(item.arguments ?? item.callDetail?.text ?? 'null'))
        if (args.view !== undefined) return <BotViewCard pending={args} busy reply={() => {}} />
      } catch { /* Retain the native tool row if its args are unavailable. */ }
    }
    if (item.kind === 'tool' && item.state === 'finished') {
      const rows = parseBotReplies(item.resultDetail?.text)
      if (rows !== undefined && rows.length > 0) return <BotReplies rows={rows} />
    }
    return <ChatItemView item={item} compact={false} artifacts={artifacts} onSendPrompt={onSendPrompt} busyAction={storeBusy} onApproval={onApproval} onQuestion={onQuestion} />
  }
  return <MarkdownLinkProvider onLinkPress={onLinkPress} transformText={transformText}><View style={styles.flex}>
    <FlatList ref={list} data={ready ? rows : []} keyExtractor={item => item.key} renderItem={({ item, index }) => (
      <View style={{ paddingTop: index > 0 && rows[index - 1]?.kind !== 'activity' ? 8 : 0 }}>
        {item.kind === 'activity' ? (
          <ChatActivityGroup dense items={item.items} closed={item.closed} busyAction={storeBusy} onApproval={onApproval} onQuestion={onQuestion} />
        ) : item.kind === 'ui' ? (
          <IntelligentUiCard key={item.key} artifact={item.artifact} onSendPrompt={onSendPrompt} />
        ) : item.kind === 'ui-pointer' ? (
          <Text key={item.key} style={[styles.muted, { marginTop: 6, fontSize: 13 }]}>
            {item.artifact.title || 'Interactive UI'} updated to version {item.artifact.version}; see its original card above.
          </Text>
        ) : item.kind === 'ui-unavailable' ? (
          <Text key={item.key} style={[styles.error, { marginTop: 6, fontSize: 13 }]}>
            Interactive UI could not be restored from this Host result. Check the original tool output and history metadata.
          </Text>
        ) : (
          render(item.item, item.artifacts)
        )}
      </View>
    )}
      contentContainerStyle={styles.conversation} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onLayout={followEnd}
      onScrollBeginDrag={() => { scrolling.current = true; atEnd.current = false }}
      onScrollEndDrag={() => { scrolling.current = false }}
      onMomentumScrollBegin={() => { scrolling.current = true }}
      onMomentumScrollEnd={() => { scrolling.current = false }}
      onScroll={event => { if (!scrolling.current) return; const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 90 }}
      scrollEventThrottle={32} onContentSizeChange={followEnd}
      ListEmptyComponent={null}
      ListHeaderComponent={<View style={styles.section}>
        {earlier.map((entry, i) => entry.kind === 'btw' ? <BotAsideCard key={`btw:${text(entry.id)}`} card={entry} busy={disabled} cancel={() => void perform('btw-cancel', { sessionId: bot!.id, id: entry.id })} onDelete={() => void perform('btw-delete', { sessionId: bot!.id, id: entry.id })} /> : entry.kind === 'closed' ? <BotSettledCard key={i} title={text(entry.title) || text(object(entry.question).question) || s.bots.question} closed={text(entry.closed) || 'dismissed'} /> : entry.kind === 'view' ? <BotViewCard key={i} pending={entry} busy reply={() => {}} /> : <View key={i} style={styles.card}><View style={styles.row}><Text style={[styles.muted, styles.grow]}>{entry.kind === 'user' ? s.bots.yourAnswer : bot?.name}</Text>{text(entry.via) !== '' && <BotViaPill platform={text(entry.via)} />}</View><NativeMarkdown text={text(entry.text)} /></View>)}
        {hasMore && (
          <View style={styles.earlierTop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.bots.loadOlder}
              disabled={olderLoading || !ready}
              onPress={() => { atEnd.current = false; void loadOlder() }}
              style={({ pressed }) => [styles.earlierPill, pressed && { opacity: 0.72 }]}
            >
              <Text style={styles.earlierPillText}>{s.bots.loadOlder}</Text>
            </Pressable>
          </View>
        )}
      </View>}
      ListFooterComponent={<View style={styles.section}>
        {room && progress.length > 0 && <BotReplies rows={progress} />}
        {room?.paused && <View style={styles.section}><Text style={styles.body}>{s.bots.roomPaused}</Text><Button label={s.bots.roomContinue} disabled={disabled} onPress={() => void perform('room-continue', { roomId: room.id })} /></View>}
        {bot && objects(state.btwCards[bot.id]).filter(card => card.botId === bot.id && card.partId === session.sessionId).slice().reverse().map(card => <BotAsideCard key={text(card.id)} card={card} busy={disabled} cancel={() => void perform('btw-cancel', { sessionId: bot.id, id: card.id })} onDelete={() => void perform('btw-delete', { sessionId: bot.id, id: card.id })} />)}
        {approvals.map(approval => <View key={text(approval.id)} style={styles.card}><Text style={styles.heading}>{state.bots.find(entry => entry.id === approval.botId)?.name} · {text(approval.tool)}</Text><Text style={styles.body}>{text(approval.reason)}</Text><View style={styles.actions}><Button variant="secondary" label={s.bots.reject} disabled={disabled} onPress={() => void perform('approval-answer', { id: approval.id, choice: 'reject' })} /><Button label={s.bots.allow} disabled={disabled} onPress={() => void perform('approval-answer', { id: approval.id, choice: 'allow' })} /></View></View>)}
        {text(question.id) !== '' && <BotQuestion key={text(question.id)} question={question} busy={disabled} answer={answer => void perform('answer-question', { sessionId: session.sessionId, questionId: question.id, answer })} dismiss={() => void perform('dismiss-question', { sessionId: session.sessionId })} />}
        {text(view.id) !== '' && <BotViewCard key={text(view.id)} pending={view} busy={disabled} reply={(action, values) => void perform('view-reply', { sessionId: session.sessionId, viewId: view.id, action, values })} />}
        {hasDesktopPendingRequest && <View style={styles.card}><Text style={styles.muted}>{s.bots.desktopActionRequired}</Text></View>}
      </View>} />
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {queueItems.length > 0 && (
      <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
        <QueueDock items={queueItems} />
      </View>
    )}
    {atQuery !== null && botAtMentionGroups.length > 0 && (
      <View style={{ paddingHorizontal: 14 }}>
        <MentionPopover
          groups={botAtMentionGroups}
          onDismiss={() => setAtQuery(null)}
          emptyText={s.mention.noMatches}
        />
      </View>
    )}
    <View style={styles.composerOuter}>
      <View style={[styles.composerCard, stagedReferences.length > 0 && styles.composerCardWithPills]}>
        <ReferencedChatPills
          items={stagedReferences}
          onRemove={sid => setStagedReferences(current => current.filter(item => item.sessionId !== sid))}
        />
        <View style={styles.composerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.chat.moreActions}
            disabled={disabled}
            onPress={() => setPlusMenuOpen(true)}
            style={({ pressed }) => [styles.plusCircle, pressed && { opacity: 0.72 }, disabled && { opacity: 0.4 }]}
          >
            <Plus size={18} color={colors.ink} strokeWidth={2.1} />
          </Pressable>
          <TextInput
            ref={inputRef}
            accessibilityLabel={bot ? s.bots.askBot(bot.name) : room ? s.bots.askBot(room.name) : s.bots.message}
            placeholder={bot ? s.bots.askBot(bot.name) : room ? s.bots.askBot(room.name) : s.bots.message}
            placeholderTextColor={colors.muted}
            style={styles.composerInput}
            multiline
            editable={!disabled}
            selection={selection}
            onChangeText={handleDraftChange}
            onSelectionChange={handleSelectionChange}
          >
            <Text>
              {draftSegments.map((segment, index) => (
                <Text key={index} style={{ color: segment.token ? colors.primary : colors.ink }}>
                  {segment.text}
                </Text>
              ))}
            </Text>
          </TextInput>
          {selected?.running && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.bots.stop}
              disabled={disabled}
              onPress={() => void stopSession()}
              style={({ pressed }) => [styles.stopCircle, pressed && { opacity: 0.78 }]}
            >
              <Square size={12} color={colors.surface} fill={colors.surface} />
            </Pressable>
          )}
          {busy ? (
            <View style={styles.sendCircle}>
              <ActivityIndicator size="small" color={colors.surface} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.bots.send}
              disabled={disabled || (!draft.trim() && stagedReferences.length === 0)}
              onPress={() => void send()}
              style={({ pressed }) => [
                styles.sendCircle,
                (disabled || (!draft.trim() && stagedReferences.length === 0)) && styles.sendCircleDisabled,
                pressed && { opacity: 0.82 },
              ]}
            >
              <ArrowUp size={18} color={colors.surface} strokeWidth={2.4} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
    <BotPlusMenuModal
      visible={plusMenuOpen}
      onClose={() => setPlusMenuOpen(false)}
      onReferenceChat={() => setReferenceChatOpen(true)}
      onOpenSchedules={() => void perform('schedules')}
    />
    <ReferenceChatModal
      visible={referenceChatOpen}
      currentSessionId={session.sessionId}
      currentBotId={bot?.id}
      botState={state}
      onClose={() => setReferenceChatOpen(false)}
      onPick={(_mentionText, candidate) => handlePickReferencedChat(_mentionText, candidate)}
    />
    {fileLinkPath !== undefined && connected && ready && <SessionToolsPanel
      key={`${session.sessionId}:${fileLinkPath}`} mode="files" sessionId={session.sessionId}
      initialFile={fileLinkPath} onClose={() => setFileLinkPath(undefined)} />}
  </View></MarkdownLinkProvider>
}
