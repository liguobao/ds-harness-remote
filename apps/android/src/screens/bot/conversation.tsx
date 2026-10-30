import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native'
import { ArrowUp, Square } from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import { botMessageRequest, object, objects, text, type BotEntry, type BotRoom, type BotState, type BotRemoteClient, type BotObject } from '../../services/bot-catalog'
import { useAppStore } from '../../state/store'
import type { ChatItem, RemoteSession } from '../../types'
import { Button, IconButton } from '../../ui/components'
import { markdownFilePath, MarkdownLinkProvider, NativeMarkdown, openSafeExternalUrl } from '../../ui/markdown'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ChatActivityGroup, ChatItemView } from '../chat/messages'
import { chatSections } from '../../state/message-helpers'
import { processSegments } from '../chat-process'
import { BotQuestion, BotViewCard } from './cards'
import { parseBotReplies } from './replies'
import { BotReplies } from './reply-view'
import { BotAsideCard } from './aside'
import type { BotPerform } from './editor'
import { createBotStyles } from './styles'
import { linkBotMentions, botMentionTarget } from './mentions'
import { SessionToolsPanel } from '../session-tools-panel'

const EMPTY: ChatItem[] = []
type BotChatRow = { kind: 'item'; key: string; item: ChatItem } | { kind: 'activity'; key: string; items: ChatItem[]; closed: boolean }
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
  const [fileLinkPath, setFileLinkPath] = useState<string>()
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
    const target = botMentionTarget(href, state.bots)
    if (target !== undefined) {
      if (target !== bot?.id) onSelectBot(target)
      return
    }
    const path = markdownFilePath(href)
    if (path !== undefined) setFileLinkPath(path)
  }, [state.bots, bot?.id, onSelectBot, ready, connected])
  useEffect(() => { setFileLinkPath(undefined) }, [session.sessionId])
  const disabled = busy || !active || !ready || (bot !== undefined && bot.sessionId !== session.sessionId) || state.readOnly !== undefined
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
    const submitted = draft.trim()
    if (!submitted || disabled) return
    atEnd.current = true
    followEnd()
    setError(undefined)
    try {
      const message = botMessageRequest(state, bot?.id ?? room?.id ?? '', submitted)
      const result = await perform(message.endpoint, message.payload)
      if (mounted.current && result.ok) setDraft(current => current.trim() === submitted ? '' : current)
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
  const approvals = state.approvals.filter(entry => entry.answerable === true && (room ? entry.roomId === room.id : entry.sessionId === session.sessionId))
  const hidden = state.exchangeTurns[session.sessionId]
  const hiddenTurns = new Set(Array.isArray(hidden) ? hidden.map(String) : [])
  const visible = messages.filter(item => item.kind === 'approval' || item.kind === 'question'
    || !(item.turn !== undefined && hiddenTurns.has(item.turn)))
  const isDisplayTool = (item: ChatItem): boolean => {
    if (item.kind !== 'tool') return false
    if (item.toolKey === 'show_view') return true
    // A single Bot can relay a group round too; the payload determines presentation.
    if (item.state === 'finished') return (parseBotReplies(item.resultDetail?.text)?.length ?? 0) > 0
    return false
  }
  const rows: BotChatRow[] = chatSections(visible).flatMap((section): BotChatRow[] => {
    if (section.kind === 'item') {
      // Native system context/receipts can arrive without a turn identifier.
      // They still belong in a disclosure rather than the visible chat body.
      if (section.item.kind === 'message' && section.item.role === 'system') {
        return [{ kind: 'activity', key: `activity:${section.item.id}`, items: [section.item], closed: true }]
      }
      return [section]
    }
    const segments = processSegments(section.items)
    const closed = section.items.some(item => item.turnEnd !== undefined) || !selected?.running
    return segments.flatMap((segment, index): BotChatRow[] => {
      if (segment.kind === 'response') return [{ kind: 'item', key: segment.key, item: segment.item }]
      // Cards and group replies stay visible; only intermediate activity folds.
      const result: BotChatRow[] = []
      let pending: ChatItem[] = []
      const flush = () => { if (pending.length) result.push({ kind: 'activity', key: `activity:${pending[0]!.id}`, items: pending, closed: closed || index < segments.length - 1 }); pending = [] }
      for (const item of segment.items) {
        if (isDisplayTool(item) || item.kind === 'approval' || item.kind === 'question') { flush(); result.push({ kind: 'item', key: item.id, item }) }
        else pending.push(item)
      }
      flush()
      return result
    })
  })
  const onApproval: Parameters<typeof ChatItemView>[0]['onApproval'] = async (...args) => { if (!disabled) await respondApproval(...args) }
  const onQuestion: Parameters<typeof ChatItemView>[0]['onQuestion'] = async (...args) => { if (!disabled) await respondQuestion(...args) }
  const render = (item: ChatItem) => {
    if (item.kind === 'tool' && item.toolKey === 'show_view') {
      // Settled and display-only views live in tool history; only the current
      // pending view has authority to submit, and is rendered in the footer.
      if (view.callId === item.id) return null
      try {
        const args = object(JSON.parse(item.arguments ?? item.callDetail?.text ?? 'null'))
        if (args.view !== undefined) return <BotViewCard pending={args} busy reply={() => {}} />
      } catch { /* Retain the native tool row if its args are unavailable. */ }
    }
    if (item.kind === 'tool' && item.state === 'finished') {
      const rows = parseBotReplies(item.resultDetail?.text)
      if (rows !== undefined && rows.length > 0) return <BotReplies rows={rows} />
    }
    return <ChatItemView item={item} compact={false} busyAction={storeBusy} onApproval={onApproval} onQuestion={onQuestion} />
  }
  return <MarkdownLinkProvider onLinkPress={onLinkPress} transformText={transformText}><View style={styles.flex}>
    <FlatList ref={list} data={ready ? rows : []} keyExtractor={item => item.key} renderItem={({ item, index }) => <View style={{ paddingTop: index > 0 && rows[index - 1]?.kind !== 'activity' ? 8 : 0 }}>{item.kind === 'activity' ? <ChatActivityGroup dense items={item.items} closed={item.closed} busyAction={storeBusy} onApproval={onApproval} onQuestion={onQuestion} /> : render(item.item)}</View>}
      contentContainerStyle={styles.conversation} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onLayout={followEnd}
      onScrollBeginDrag={() => { scrolling.current = true; atEnd.current = false }}
      onScrollEndDrag={() => { scrolling.current = false }}
      onMomentumScrollBegin={() => { scrolling.current = true }}
      onMomentumScrollEnd={() => { scrolling.current = false }}
      onScroll={event => { if (!scrolling.current) return; const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 90 }}
      scrollEventThrottle={32} onContentSizeChange={followEnd}
      ListEmptyComponent={<Text style={styles.muted}>{s.bots.noMessages}</Text>}
      ListHeaderComponent={<View style={styles.section}>
        {bot && !hasMore && cursor !== null && <Button variant="quiet" label={s.bots.loadOlder} disabled={olderBusy} onPress={() => void earlierPage()} />}
        {earlier.map((entry, i) => entry.kind === 'btw' ? <BotAsideCard key={`btw:${text(entry.id)}`} card={entry} busy={disabled} cancel={() => void perform('btw-cancel', { sessionId: bot!.id, id: entry.id })} /> : entry.kind === 'view' ? <BotViewCard key={i} pending={entry} busy reply={() => {}} /> : <View key={i} style={styles.card}><Text style={styles.muted}>{entry.kind === 'user' ? s.bots.yourAnswer : bot?.name}</Text><NativeMarkdown text={text(entry.text)} /></View>)}
        {hasMore && <Button variant="quiet" label={s.bots.loadOlder} disabled={olderLoading || !ready} onPress={() => { atEnd.current = false; void loadOlder() }} />}
      </View>}
      ListFooterComponent={<View style={styles.section}>
        {room && progress.length > 0 && <BotReplies rows={progress} />}
        {room?.paused && <View style={styles.section}><Text style={styles.body}>{s.bots.roomPaused}</Text><Button label={s.bots.roomContinue} disabled={disabled} onPress={() => void perform('room-continue', { roomId: room.id })} /></View>}
        {bot && objects(state.btwCards[bot.id]).filter(card => card.botId === bot.id && card.partId === session.sessionId).slice().reverse().map(card => <BotAsideCard key={text(card.id)} card={card} busy={disabled} cancel={() => void perform('btw-cancel', { sessionId: bot.id, id: card.id })} />)}
        {approvals.map(approval => <View key={text(approval.id)} style={styles.card}><Text style={styles.heading}>{state.bots.find(entry => entry.id === approval.botId)?.name} · {text(approval.tool)}</Text><Text style={styles.body}>{text(approval.reason)}</Text><View style={styles.actions}><Button variant="secondary" label={s.bots.reject} disabled={disabled} onPress={() => void perform('approval-answer', { id: approval.id, choice: 'reject' })} /><Button label={s.bots.allow} disabled={disabled} onPress={() => void perform('approval-answer', { id: approval.id, choice: 'allow' })} /></View></View>)}
        {text(question.id) !== '' && <BotQuestion key={text(question.id)} question={question} busy={disabled} answer={answer => void perform('answer-question', { sessionId: session.sessionId, questionId: question.id, answer })} dismiss={() => void perform('dismiss-question', { sessionId: session.sessionId })} />}
        {text(view.id) !== '' && <BotViewCard key={text(view.id)} pending={view} busy={disabled} reply={(action, values) => void perform('view-reply', { sessionId: session.sessionId, viewId: view.id, action, values })} />}
      </View>} />
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {bot && state.btwSupported && <Text style={[styles.muted, { paddingHorizontal: 12 }]}>{s.bots.btwHint}</Text>}
    <View style={styles.composer}>
      <TextInput accessibilityLabel={room ? s.bots.groupMessage : s.bots.message} placeholder={room ? s.bots.groupMessage : s.bots.message} placeholderTextColor={colors.muted} style={[styles.input, styles.draft]} multiline editable={!disabled} value={draft} onChangeText={setDraft} />
      {selected?.running && <IconButton label={s.bots.stop} icon={Square} disabled={disabled} onPress={() => void stopSession()} />}
      {busy ? <ActivityIndicator color={colors.primary} /> : <IconButton label={s.bots.send} icon={ArrowUp} tint={colors.primary} disabled={disabled || !draft.trim()} onPress={() => void send()} />}
    </View>
    {fileLinkPath !== undefined && connected && ready && <SessionToolsPanel
      key={`${session.sessionId}:${fileLinkPath}`} mode="files" sessionId={session.sessionId}
      initialFile={fileLinkPath} onClose={() => setFileLinkPath(undefined)} />}
  </View></MarkdownLinkProvider>
}
