import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { File as LocalFile } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { AccessibilityInfo, ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Image as ImageIcon, MessageCircle, Paperclip, Users, X } from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import { BUILT_IN_PROMPTS, type CustomPrompt } from '../../services/storage'
import { botMessageRequest, formatBotSubmission, isBotObject, object, objects, pausedWorksList, pendingBotRequests, text, type BotEntry, type BotRoom, type BotState, type BotRemoteClient, type BotObject, type BotOperation } from '../../services/bot-catalog'
import {
  BOT_STAGED_IMAGE_TYPES,
  BOT_STAGED_MAX_BYTES,
  base64ToBytes,
  downloadBotFileChunked,
  sanitizeBotFileName,
  saveBotDownloadedFile,
  stageBotFile,
  stageBotImage,
} from '../../services/bot-media'
import { pollRoomRows, preferredRoomRows, ROOM_ROWS_INTERVAL_MS, ROOM_ROWS_LEGACY_INTERVAL_MS, ROOM_ROWS_LEGACY_MISSES, type RoomRowsPoll } from '../../services/bot-room-rows'
import { useAppStore } from '../../state/store'
import { useBotTeamStore } from '../../state/bot-store'
import type { ChatItem, RemoteSession } from '../../types'
import { Alert } from '../../ui/alert'
import { Button } from '../../ui/components'
import { decodeSessionMentionUri, markdownFilePath, MarkdownLinkProvider, NativeMarkdown, openSafeExternalUrl } from '../../ui/markdown'
import { detectMention, type MentionGroup } from '../../ui/mention-popover'
import { useResponsiveLayout } from '../../ui/responsive'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ChatComposer, type ComposerInputBridge } from '../chat/composer'
import { applyQuickPromptDraft } from '../chat/composer-gate'
import { type ExpandedComposerProps } from '../chat/expanded-composer'
import { ChatActivityGroup, ChatItemView, QueueDock, isActiveChatItem } from '../chat/messages'
import { PromptEditor, PromptsManager, PromptsPicker } from '../chat/pickers'
import { createStyles as createChatStyles } from '../chat/styles'
import { useChatPrompts } from '../chat/use-chat-prompts'
import { chatSections, inboxQueuedItems, inboxRpcIds, type ChatSection } from '../../state/message-helpers'
import { processSegments, shouldShowTurnResponseActions } from '../chat-process'
import { useSessionUiArtifacts } from '../chat/use-session-ui-artifacts'
import { IntelligentUiCard } from '../intelligent-ui-card'
import type { ToolActivity } from '../../types'
import type { UiArtifact } from '../../state/ui-artifacts'
import { buildBotMentionRows, type ReferenceChatCandidate } from './at-menu'
import { BotAvatar } from './avatar'
import { BotQuestion, BotSettledCard, BotViewCard } from './cards'
import {
  BotApprovalCard,
  BotBlockedCard,
  BotBrowserHandoffCard,
  BotComputerAskCard,
  BotConnectorRequestCard,
  BotLearningCard,
  BotMailSendCard,
  BotSecretRequestCard,
  BotWorkPausedCard,
} from './interactive-cards'
import { parseBotReplyPayload, parseRelayRange } from './replies'
import { BotReplies, BotViaPill, type BotMentionContext } from './reply-view'
import { BotAsideCard } from './aside'
import type { BotPerform } from './editor'
import { BotPlusMenuModal, ReferenceChatModal, ReferencedChatPills } from './reference-chat-modal'
import { BotSideChatSheet } from './side-chat-panel'
import { BotTaskBar, BotTaskDetailModal } from './task-bar'
import { createBotStyles } from './styles'
import { linkBotMentions, botMentionTarget } from './mentions'
import { BotMessageActionsContext } from '../message-actions'
import { SessionToolsPanel } from '../session-tools-panel'

import { browseScope, browseKey, updateBrowseEntry, useBrowseMemory, saveGroupRound } from '../../services/browse-memory'

const EMPTY: ChatItem[] = []
type BotChatRow =
  | { kind: 'item'; key: string; item: ChatItem; artifacts?: UiArtifact[]; showActions?: boolean }
  | { kind: 'activity'; key: string; items: ChatItem[]; closed: boolean }
  | { kind: 'ui'; key: string; artifact: UiArtifact }
  | { kind: 'ui-pointer'; key: string; artifact: UiArtifact }
  | { kind: 'ui-unavailable'; key: string; item: ToolActivity }
export function BotConversation({ bot, room, state, client, session, busy, active, perform, onSelectBot, onExpandedComposerChange }: {
  bot?: BotEntry; room?: BotRoom; state: BotState; client?: BotRemoteClient; session: RemoteSession
  busy: boolean; active: boolean; perform: BotPerform; onSelectBot: (id: string) => void
  onExpandedComposerChange?: (props: ExpandedComposerProps | null) => void
}) {
  const transformText = useCallback((value: string) => linkBotMentions(value, state.bots, bot?.id), [state.bots, bot?.id])
  const botById = useCallback((id: string) => state.bots.find(entry => entry.id === id), [state.bots])
  const mentions = useMemo(() => ({ bots: state.bots, selfId: bot?.id, onPress: (id: string) => onSelectBot(id) }), [state.bots, bot?.id, onSelectBot])
  const styles = useThemedStyles(createBotStyles)
  const chatStyles = useThemedStyles(createChatStyles)
  const { colors } = useTheme()
  const { compactHeight, height, landscape, contentMaxWidth } = useResponsiveLayout()
  const compactComposer = landscape || compactHeight
  const composerInputMaxHeight = compactComposer ? Math.max(48, Math.min(96, Math.round(height * 0.22))) : 126
  const readableColumn = { width: '100%' as const, maxWidth: contentMaxWidth, alignSelf: 'center' as const }
  const messages = useAppStore(store => store.messages[session.sessionId] ?? EMPTY)
  const selected = useAppStore(store => store.selectedSession)
  const storeBusy = useAppStore(store => store.busyAction)
  const quickPromptActionMode = useAppStore(store => store.quickPromptActionMode)
  const setQuickPromptActionMode = useAppStore(store => store.setQuickPromptActionMode)
  const hasMore = useAppStore(store => store.historyHasMore)
  const olderLoading = useAppStore(store => store.historyLoadingOlder)
  const loadOlder = useAppStore(store => store.loadOlderHistory)
  const respondApproval = useAppStore(store => store.respondApproval)
  const respondQuestion = useAppStore(store => store.respondQuestion)
  const stopSession = useAppStore(store => store.stopSession)
  const refreshLive = useBotTeamStore(store => store.refreshLive)
  const feedConnected = useBotTeamStore(store => store.feedConnected)
  const roomFeedTick = useBotTeamStore(store => (room ? (store.roomFeedSeq[room.id] ?? 0) : 0))
  const memoryScope = useAppStore(browseScope)
  const logicalOwnerId = bot?.id ?? room?.id ?? session.sessionId
  const savedDraft = useBrowseMemory(store => store.entries[browseKey(memoryScope, logicalOwnerId)]?.draft ?? '')
  const [draft, setDraft] = useState(savedDraft)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const selectionRef = useRef({ start: 0, end: 0 })
  const inputRef = useRef<TextInput>(null)
  const sendingRef = useRef(false)
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const atSpanStartRef = useRef(0)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [composerExpanded, setComposerExpanded] = useState(false)
  const expandedActivatedRef = useRef(false)
  const [referenceChatOpen, setReferenceChatOpen] = useState(false)
  const [stagedReferences, setStagedReferences] = useState<ReferenceChatCandidate[]>([])
  const [stagedImages, setStagedImages] = useState<Array<{ id: string; mediaType: string; data: string; name?: string }>>([])
  const [stagedFiles, setStagedFiles] = useState<Array<{ id: string; name: string; data: string }>>([])
  const [sideChatOpen, setSideChatOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined)
  const selectedTask = useMemo(
    () => (selectedTaskId ? objects(bot?.tasks).find(t => text(t.id) === selectedTaskId) : undefined),
    [bot?.tasks, selectedTaskId],
  )
  const [fileLinkPath, setFileLinkPath] = useState<string>()
  const sessions = useAppStore(store => store.sessions)
  const openSession = useAppStore(store => store.openSession)
  const connected = useAppStore(store => store.connection.phase === 'connected')
  const { promptsPickerOpen, setPromptsPickerOpen, customPrompts, promptEditing,
    setPromptEditing, promptsManagerOpen, setPromptsManagerOpen, promptsLoading, savePromptEdit, deletePrompt } = useChatPrompts(connected ? 'connected' : 'disconnected')
  const [progress, setProgress] = useState<BotObject[]>([])
  const [speaking, setSpeaking] = useState<string[]>([])
  const [earlier, setEarlier] = useState<BotObject[]>([])
  const [cursor, setCursor] = useState<unknown>(undefined)
  const [olderBusy, setOlderBusy] = useState(false)
  const olderBusyRef = useRef(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(true)
  const request = useRef(new AbortController())
  const list = useRef<FlatList<BotChatRow>>(null)
  const atEnd = useRef(true)
  const scrolling = useRef(false)
  const scrollFrame = useRef<number | undefined>(undefined)
  const cancelFollowEnd = () => {
    if (scrollFrame.current !== undefined) {
      cancelAnimationFrame(scrollFrame.current)
      scrollFrame.current = undefined
    }
  }
  const followEnd = () => {
    if (!atEnd.current || scrolling.current) return
    cancelFollowEnd()
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = undefined
      if (atEnd.current && !scrolling.current) list.current?.scrollToEnd({ animated: false })
    })
  }
  useEffect(() => () => { if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current) }, [])
  const ready = selected?.sessionId === session.sessionId
  const onLinkPress = useCallback((href: string) => {
    if (href.startsWith('https://bots.local/')) {
      if (!ready || !connected) return
      const target = botMentionTarget(href, state.bots)
      if (target !== undefined && target !== bot?.id) onSelectBot(target)
      return
    }
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
    const path = markdownFilePath(href)
    if (path !== undefined) setFileLinkPath(path)
  }, [state.bots, bot?.id, onSelectBot, ready, connected, sessions, openSession])
  const applyDraft = useCallback((nextText: string) => {
    draftRef.current = nextText
    setDraft(nextText)
    updateBrowseEntry(memoryScope, logicalOwnerId, { draft: nextText })
  }, [memoryScope, logicalOwnerId])
  useEffect(() => {
    const initialDraft = useBrowseMemory.getState().entries[browseKey(memoryScope, logicalOwnerId)]?.draft ?? ''
    draftRef.current = initialDraft
    selectionRef.current = { start: initialDraft.length, end: initialDraft.length }
    setDraft(initialDraft)
    setFileLinkPath(undefined)
    setAtQuery(null)
    setPlusMenuOpen(false)
    setComposerExpanded(false)
    setPromptsPickerOpen(false)
    setReferenceChatOpen(false)
    setStagedReferences([])
    setStagedImages([])
    setStagedFiles([])
    setSideChatOpen(false)
    setSelectedTaskId(undefined)
  }, [memoryScope, logicalOwnerId])

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
    applyDraft(nextText)
    const cursor = Math.max(0, Math.min(nextText.length, selectionRef.current.end + delta))
    selectionRef.current = { start: cursor, end: cursor }
    updateAtMention(nextText, cursor)
  }
  const handleSelectionChange = (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
    const nextSel = event.nativeEvent.selection
    if (nextSel.start === selectionRef.current.start && nextSel.end === selectionRef.current.end) return
    selectionRef.current = nextSel
    if (nextSel.start === nextSel.end) updateAtMention(draftRef.current, nextSel.end)
  }
  const insertAtMention = (mentionText: string) => {
    const start = Math.max(0, Math.min(draftRef.current.length, atSpanStartRef.current))
    const end = Math.max(start, Math.min(draftRef.current.length, selectionRef.current.end))
    const current = draftRef.current
    const nextText = current.slice(0, start) + mentionText + current.slice(end)
    const nextCursor = start + mentionText.length
    applyDraft(nextText)
    selectionRef.current = { start: nextCursor, end: nextCursor }
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
  const inputDisabled = !active || !ready
    || (bot !== undefined && bot.sessionId !== session.sessionId)
    || (room !== undefined && (room.sessionId || room.id) !== session.sessionId)
    || state.readOnly !== undefined
  const disabled = busy || inputDisabled || !connected || client === undefined
  useEffect(() => { olderBusyRef.current = false; setEarlier([]); setCursor(undefined); setProgress([]); setSpeaking([]); setOlderBusy(false); setError(undefined); atEnd.current = true; scrolling.current = false; followEnd() }, [session.sessionId])
  useEffect(() => { mounted.current = true; request.current = new AbortController(); return () => { mounted.current = false; request.current.abort() } }, [session.sessionId])
  useEffect(() => {
    if (room === undefined || !active || !connected || client === undefined) {
      setSpeaking([])
      if (!connected) setProgress([])
      return
    }
    const control = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const value = await client.call('room-progress', { roomId: room.id }, control.signal)
        if (!control.signal.aborted) {
          setSpeaking([...new Set(objects(value).flatMap(entry => Array.isArray(entry.speaking) ? entry.speaking.filter((id): id is string => typeof id === 'string') : typeof entry.speaking === 'string' ? [entry.speaking] : []))])
          const store = useAppStore.getState()
          if (store.config?.baseUrl && store.selectedDevice?.identityKey) {
            for (const entry of objects(value)) {
              if (typeof entry.callId === 'string') saveGroupRound(browseScope(store), session.sessionId, `call:${entry.callId}`, objects(entry.replies))
            }
          }
        }
        if (!control.signal.aborted) setProgress(objects(value).filter(entry => {
          const call = (useAppStore.getState().messages[session.sessionId] ?? []).find(item => item.id === entry.callId)
          return call?.kind !== 'tool' || (call.state !== 'finished' && call.state !== 'failed')
        }).flatMap(entry => objects(entry.replies)))
      } catch { /* The parent state refresh reports connection and Host errors. */ }
      if (!control.signal.aborted) timer = setTimeout(() => void tick(), feedConnected ? 15_000 : 2_000)
    }
    void tick()
    return () => { control.abort(); clearTimeout(timer) }
  }, [client, room?.id, session.sessionId, active, connected, feedConnected, roomFeedTick])
  const pickBotImages = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        orderedSelection: true,
        allowsEditing: false,
        quality: 0.9,
        base64: true,
      })
      if (result.canceled || !result.assets) return
      const picked: Array<{ id: string; mediaType: string; data: string; name?: string }> = []
      for (const asset of result.assets) {
        const mediaType = asset.mimeType ?? 'image/jpeg'
        const data = asset.base64 ?? ''
        if (!BOT_STAGED_IMAGE_TYPES.has(mediaType) || !data) continue
        try {
          if (base64ToBytes(data).byteLength > BOT_STAGED_MAX_BYTES) continue
        } catch {
          continue
        }
        picked.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          mediaType,
          data,
          ...(asset.fileName ? { name: sanitizeBotFileName(asset.fileName, 'image.jpg') } : {}),
        })
      }
      if (picked.length > 0) setStagedImages(current => [...current, ...picked])
    } catch {
      Alert.alert(s.chat.filePickerFailedTitle, s.chat.filePickerFailedBody)
    }
  }

  const pickBotFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets) return
      const picked: Array<{ id: string; name: string; data: string }> = []
      for (const asset of result.assets) {
        const name = sanitizeBotFileName(asset.name, 'file')
        if (typeof asset.size === 'number' && asset.size > BOT_STAGED_MAX_BYTES) {
          Alert.alert(s.chat.filePickerFailedTitle, s.chat.fileSizeUnavailable(name))
          continue
        }
        const data = await new LocalFile(asset.uri).base64()
        if (base64ToBytes(data).byteLength > BOT_STAGED_MAX_BYTES) continue
        picked.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          data,
        })
      }
      if (picked.length > 0) setStagedFiles(current => [...current, ...picked])
    } catch {
      Alert.alert(s.chat.filePickerFailedTitle, s.chat.filePickerFailedBody)
    }
  }

  const onDownloadPresented = useCallback(async (file: BotObject, fallbackSessionId?: string) => {
    if (!client) return
    const activeRequest = request.current
    const signal = activeRequest.signal
    const fileSessionId = text(file.sessionId) || fallbackSessionId || session.sessionId
    const seq = typeof file.seq === 'number' ? file.seq : undefined
    const index = typeof file.index === 'number' ? file.index : 0
    const attachmentId = text(file.attachmentId) || undefined
    const name = text(file.name) || text(file.path).split(/[\\/]/).pop() || 'file'
    try {
      await client.negotiate(signal)
      if (!mounted.current || signal.aborted) return
      const downloaded = await downloadBotFileChunked(
        client,
        { sessionId: fileSessionId, attachmentId, seq, index, name },
        { chunked: client.hasCapability('file-download-chunks'), signal },
      )
      if (!mounted.current || signal.aborted) return
      await saveBotDownloadedFile(downloaded)
    } catch (reason) {
      if (!mounted.current || signal.aborted) return
      setError(reason instanceof Error ? reason.message : s.bots.unavailable)
    }
  }, [client, session.sessionId])

  const sendSubmission = async (rawText: string, clearDraft: boolean): Promise<boolean> => {
    if (sendingRef.current || disabled) return false
    const rawDraft = rawText.trim()
    const submittedRefs = stagedReferences
    const submittedImages = clearDraft ? stagedImages : []
    const submittedFiles = clearDraft ? stagedFiles : []
    const submitted = formatBotSubmission(rawDraft, submittedRefs.map(item => item.mentionText))
    const hasMedia = submittedImages.length > 0 || submittedFiles.length > 0
    if (!submitted && !hasMedia) return false
    sendingRef.current = true
    atEnd.current = true
    followEnd()
    setError(undefined)
    let message: { endpoint: BotOperation; payload: BotObject }
    try {
      message = submitted
        ? botMessageRequest(state, bot?.id ?? room?.id ?? session.sessionId, submitted)
        : {
            endpoint: 'send',
            payload: { sessionId: bot?.id ?? room?.id ?? session.sessionId, text: '' },
          }
      if (!submitted && state.readOnly !== undefined) {
        throw new Error(s.bots.sessionUnavailable)
      }
    } catch (reason) {
      sendingRef.current = false
      setError(reason instanceof Error ? reason.message : s.bots.unavailable)
      return false
    }
    const sendSessionId = session.sessionId
    const activeRequest = request.current
    if (clearDraft) {
      applyDraft('')
      selectionRef.current = { start: 0, end: 0 }
      setAtQuery(null)
      setStagedImages([])
      setStagedFiles([])
    }
    setStagedReferences([])
    const restoreFailedDraft = () => {
      if (!mounted.current || activeRequest.signal.aborted || session.sessionId !== sendSessionId) return
      if (clearDraft) {
        const typedWhileInFlight = draftRef.current.trim()
        const restoredDraft = typedWhileInFlight
          ? (rawDraft ? `${rawDraft}\n${typedWhileInFlight}` : typedWhileInFlight)
          : rawDraft
        applyDraft(restoredDraft)
        selectionRef.current = { start: restoredDraft.length, end: restoredDraft.length }
      }
      if (submittedRefs.length > 0) {
        setStagedReferences(current => {
          const existing = new Set(current.map(item => item.sessionId))
          return [...submittedRefs.filter(item => !existing.has(item.sessionId)), ...current]
        })
      }
      if (submittedImages.length > 0) {
        setStagedImages(current => [...submittedImages, ...current])
      }
      if (submittedFiles.length > 0) {
        setStagedFiles(current => [...submittedFiles, ...current])
      }
    }
    try {
      let payload = message.payload
      if (message.endpoint === 'send' && hasMedia) {
        const imageIds = await Promise.all(
          submittedImages.map(img => stageBotImage(client, img, activeRequest.signal)),
        )
        const fileIds = await Promise.all(
          submittedFiles.map(file => stageBotFile(client, file, activeRequest.signal)),
        )
        payload = {
          ...payload,
          ...(imageIds.length > 0 ? { images: imageIds } : {}),
          ...(fileIds.length > 0 ? { files: fileIds } : {}),
          requestId: `bot-send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }
      }
      const result = await perform(message.endpoint, payload)
      if (!result.ok) {
        restoreFailedDraft()
        return false
      }
      return true
    } catch (reason) {
      if (mounted.current && !activeRequest.signal.aborted && session.sessionId === sendSessionId) {
        restoreFailedDraft()
        setError(reason instanceof Error ? reason.message : s.bots.unavailable)
      }
      return false
    } finally {
      sendingRef.current = false
    }
  }
  const send = () => sendSubmission(draftRef.current, true)
  const pickQuickPrompt = async (prompt: CustomPrompt) => {
    setPromptsPickerOpen(false)
    if (quickPromptActionMode === 'fill') {
      const { draft: nextDraft, cursor } = applyQuickPromptDraft(draftRef.current, prompt.text)
      applyDraft(nextDraft)
      selectionRef.current = { start: cursor, end: cursor }
      updateAtMention(nextDraft, cursor)
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    if (!connected) {
      Alert.alert(s.chat.toolPromptSendFailed, s.chat.offlineNotice)
      return
    }
    if (disabled) {
      Alert.alert(s.chat.toolPromptSendFailed, s.chat.toolPromptSendFailed)
      return
    }
    const sent = await sendSubmission(prompt.text, false)
    if (sent) AccessibilityInfo.announceForAccessibility(s.chat.toolPromptSent(prompt.title))
    else Alert.alert(s.chat.toolPromptSendFailed, s.chat.toolPromptSendFailed)
  }
  const earlierPage = async () => {
    if (olderBusyRef.current || (!bot && !room) || !client || cursor === null) return
    olderBusyRef.current = true
    atEnd.current = false
    setOlderBusy(true)
    setError(undefined)
    const signal = request.current.signal
    try {
      if (room !== undefined) {
        const ownParts = room.ownParts ?? []
        const currentPartIdx = ownParts.indexOf(session.sessionId)
        const initialPart = currentPartIdx > 0 ? currentPartIdx - 1 : ownParts.length - 1
        const defaultCursor = cursor === undefined && initialPart >= 0
          ? { part: initialPart }
          : cursor
        const value = object(await client.call('room-chat', {
          roomId: room.id,
          ...(defaultCursor === undefined ? {} : { cursor: defaultCursor }),
        }, signal))
        if (!mounted.current || signal.aborted) return
        setEarlier(current => {
          const knownItems = new Set(current.filter(entry => typeof entry.id === 'string').map(entry => `${text(entry.kind)}:${text(entry.id)}`))
          const items = objects(value.items).filter(entry => typeof entry.id !== 'string' || !knownItems.has(`${text(entry.kind)}:${text(entry.id)}`))
          return [...items, ...current]
        })
        setCursor(value.cursor ?? null)
        return
      }
      if (!bot) return
      const value = object(await client.call('earlier', { sessionId: session.sessionId, ...(cursor === undefined ? {} : { cursor }) }, signal))
      if (!mounted.current || signal.aborted) return
      setEarlier(current => {
        const knownBtw = new Set(current.filter(entry => entry.kind === 'btw').map(entry => entry.id))
        const cards = objects(value.btw).filter(entry => entry.botId === bot.id && !knownBtw.has(entry.id)).map(entry => ({ ...entry, kind: 'btw', pageCursor: cursor }))
        const knownItems = new Set(current.filter(entry => typeof entry.id === 'string').map(entry => `${text(entry.kind)}:${text(entry.id)}`))
        const items = objects(value.items).filter(entry => typeof entry.id !== 'string' || !knownItems.has(`${text(entry.kind)}:${text(entry.id)}`))
        return [...items, ...cards.reverse(), ...current]
      })
      setCursor(value.cursor ?? null)
    } catch { if (mounted.current && !signal.aborted) setError(s.bots.earlierUnavailable) }
    finally {
      olderBusyRef.current = false
      if (mounted.current && !signal.aborted) setOlderBusy(false)
    }
  }
  // A part can roll over while its aside is still answering. Current roster polls
  // no longer include it, so refresh only historical pages with a pending aside.
  const pendingAsidePages = JSON.stringify([...new Map(earlier.filter(entry => entry.kind === 'btw' && entry.status === 'answering').map(entry => [JSON.stringify(entry.pageCursor ?? null), entry.pageCursor ?? null])).values()])
  useEffect(() => {
    if (!active || !connected || !client || !bot || pendingAsidePages === '[]') return
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
  }, [active, connected, bot?.id, client, session.sessionId, pendingAsidePages])
  const question = object(state.questions[session.sessionId] ?? state.questions[logicalOwnerId])
  const view = object(state.views[session.sessionId] ?? state.views[logicalOwnerId])
  const closedCards = object(state.closedCards[session.sessionId] ?? state.closedCards[logicalOwnerId])
  const approvals = state.approvals.filter(entry => {
    if (entry.answerable === false || text(object(entry.review).status) === 'reviewing') return false
    if (room) return entry.roomId === room.id
    return entry.roomId === undefined && (entry.sessionId === session.sessionId || (bot !== undefined && entry.botId === bot.id))
  })
  const pendingSecretRequests = useMemo(() => {
    if (!bot) return []
    return pendingBotRequests(state.secretRequests, bot.id, session.sessionId).filter(req => text(req.id) !== '')
  }, [bot, state.secretRequests, session.sessionId])
  const pendingConnectorRequests = useMemo(() => {
    if (!bot) return []
    return pendingBotRequests(state.connectorRequests, bot.id, session.sessionId).filter(req => text(req.id) !== '')
  }, [bot, state.connectorRequests, session.sessionId])
  const pendingMailRequests = useMemo(() => {
    if (!bot) return []
    return pendingBotRequests(state.mailRequests, bot.id, session.sessionId).filter(req => text(req.id) !== '')
  }, [bot, state.mailRequests, session.sessionId])
  const pendingLearning = useMemo(() => {
    if (!bot) return []
    return objects(state.learning?.[bot.id]).filter(item => text(item.id) !== '')
  }, [bot, state.learning])
  const pendingComputerAsks = useMemo(() => {
    const asks = object(state.computerLive?.asks)
    return Object.values(asks).filter((entry): entry is BotObject => {
      if (!isBotObject(entry) || text(entry.id) === '') return false
      if (room) return text(entry.roomId) === room.id
      return bot !== undefined && text(entry.botId) === bot.id && !text(entry.roomId)
    })
  }, [state.computerLive, bot, room])
  const pendingBrowserHold = useMemo(() => {
    if (!bot) return undefined
    const hold = object(state.browserHolds?.[bot.id] ?? state.browserHolds?.[session.sessionId])
    return Object.keys(hold).length > 0 && text(hold.callId) !== '' ? hold : undefined
  }, [bot, state.browserHolds, session.sessionId])
  const pendingPausedWorks = useMemo(
    () => pausedWorksList(state.work.paused, bot?.id, session.sessionId, room?.id),
    [state.work.paused, bot?.id, session.sessionId, room?.id],
  )
  const hasComputerHold = useMemo(() => {
    const ownerId = bot?.id ?? session.sessionId
    const computerHolds = object(state.computerLive?.holds)
    const matchesTarget = (entry: unknown): boolean => {
      if (!isBotObject(entry)) return false
      if (bot && text(entry.botId) === bot.id) return true
      if (room && text(entry.roomId) === room.id) return true
      return false
    }
    return Boolean(
      Object.keys(object(computerHolds[ownerId])).length > 0
      || Object.values(computerHolds).some(matchesTarget),
    )
  }, [state.computerLive, bot, room, session.sessionId])
  const botAttentionBlocked = Boolean(
    bot !== undefined && (
      bot.blocked !== undefined
      || Boolean(bot.sessionMissing)
      || text(object(bot.failures?.[session.sessionId]).code) === 'OVERFLOW'
    ),
  )
  const hasDesktopPendingRequest = Boolean(
    hasComputerHold
    || botAttentionBlocked
    || pendingSecretRequests.length > 0
    || pendingConnectorRequests.length > 0
    || pendingMailRequests.length > 0
    || pendingLearning.length > 0
    || pendingComputerAsks.length > 0
    || pendingBrowserHold !== undefined
    || pendingPausedWorks.length > 0,
  )
  const activeBtwCards = useMemo(
    () => (bot ? objects(state.btwCards[bot.id]).filter(card => card.botId === bot.id && card.partId === session.sessionId) : []),
    [bot, state.btwCards, session.sessionId],
  )
  const hasPendingBtw = activeBtwCards.some(card => card.status === 'answering')
  const interactiveSignal = useMemo(() => {
    const parts = [selected?.running === true ? '1' : '0']
    for (const item of messages) {
      if (item.kind === 'approval') {
        parts.push(`a:${item.id}:${item.outcome ?? 'open'}`)
      } else if (
        item.kind === 'tool'
        && (
          item.toolKey === 'ask_user'
          || item.toolKey === 'show_view'
          || item.toolKey === 'request_connector'
          || item.toolKey === 'mail_send'
          || item.toolKey?.startsWith('computer_')
        )
      ) {
        parts.push(`t:${item.id}:${item.state}`)
      }
    }
    return parts.join('|')
  }, [messages, selected?.running])
  const prevInteractiveSignalRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    prevInteractiveSignalRef.current = undefined
  }, [session.sessionId])
  useEffect(() => {
    if (!active || !connected || !ready) return
    const prev = prevInteractiveSignalRef.current
    prevInteractiveSignalRef.current = interactiveSignal
    if (prev === undefined || prev === interactiveSignal) return
    void refreshLive({ forceFull: true })
  }, [active, connected, ready, interactiveSignal, refreshLive])
  const hasLiveFooterWork = Boolean(
    selected?.running
    || hasPendingBtw
    || text(question.id) !== ''
    || text(view.id) !== ''
    || approvals.length > 0
    || hasDesktopPendingRequest
    || room !== undefined,
  )
  useEffect(() => {
    if (!active || !connected || !ready) return
    const control = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const intervalMs = feedConnected
      ? (hasLiveFooterWork ? 8_000 : 15_000)
      : (hasLiveFooterWork ? 1_500 : 3_000)
    const tick = async () => {
      await refreshLive({ forceFull: hasPendingBtw })
      if (!control.signal.aborted) {
        timer = setTimeout(() => void tick(), intervalMs)
      }
    }
    timer = setTimeout(() => void tick(), intervalMs)
    return () => {
      control.abort()
      clearTimeout(timer)
    }
  }, [active, connected, ready, session.sessionId, hasLiveFooterWork, hasPendingBtw, feedConnected, refreshLive])
  const questionId = text(question.id)
  const viewId = text(view.id)
  const approvalsKey = approvals.map(entry => text(entry.id)).join(',')
  const btwKey = activeBtwCards.map(card => `${text(card.id)}:${text(card.status)}`).join(',')
  useEffect(() => {
    if (atEnd.current) followEnd()
  }, [questionId, viewId, approvalsKey, btwKey, room?.paused, hasDesktopPendingRequest])
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
    return messages.filter(item => !(item.kind === 'message' && item.usageOnly === true)
      && (item.kind === 'approval' || item.kind === 'question'
        || !(item.turn !== undefined && hiddenTurns.has(item.turn))))
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
      const message = botMessageRequest(state, bot?.id ?? room?.id ?? session.sessionId, trimmed)
      const result = await perform(message.endpoint, message.payload)
      return result.ok
    } catch {
      return false
    }
  }, [disabled, state, bot?.id, room?.id, session.sessionId, perform])

  const isDisplayTool = (item: ChatItem): boolean => {
    if (item.kind !== 'tool') return false
    if (item.toolKey === 'show_view') return true
    if (item.toolKey === 'ask_user' && text(closedCards[item.id]) !== '') return true
    // A single Bot can relay a group round too; the payload determines presentation.
    if (item.state === 'finished' && parseRelayRange(item.resultDetail?.text)) return true
    if (item.state === 'finished') return (parseBotReplyPayload(item.resultDetail?.text)?.rows.length ?? 0) > 0
    return false
  }
  const rows: BotChatRow[] = visibleSections.flatMap((section, sectionIndex): BotChatRow[] => {
    if (section.kind === 'item') {
      // Native system context/receipts can arrive without a turn identifier.
      // They still belong in a disclosure rather than the visible chat body.
      if (section.item.kind === 'message' && section.item.role === 'system') {
        return []
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
    const turnEnded = section.items.some(item => item.turnEnd !== undefined)
    const hasActiveItem = section.items.some(isActiveChatItem)
    const isTurnRunning = sectionIndex === visibleSections.length - 1 && (selected?.running === true || storeBusy === 'stop-session')

    const sectionRows: BotChatRow[] = segments.flatMap((segment, index): BotChatRow[] => {
      if (segment.kind === 'response') {
        const attachArtifacts = index === lastResponseIndex && cards.length > 0
        const showActions = shouldShowTurnResponseActions({
          segmentIndex: index,
          lastResponseIndex,
          turnEnded,
          hasActiveItem,
          isTurnRunning,
        })
        return [{
          kind: 'item',
          key: segment.key,
          item: segment.item,
          showActions,
          ...(attachArtifacts ? { artifacts: cards } : {}),
        }]
      }
      // Cards and group replies stay visible; only intermediate activity folds.
      const result: BotChatRow[] = []
      for (const item of segment.items) {
        if (isDisplayTool(item) || item.kind === 'approval' || item.kind === 'question') {
          result.push({ kind: 'item', key: item.id, item })
        }
      }
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
  const onApproval: Parameters<typeof ChatItemView>[0]['onApproval'] = async (...args) => {
    if (disabled) return
    await respondApproval(...args)
    void refreshLive({ forceFull: true })
  }
  const onQuestion: Parameters<typeof ChatItemView>[0]['onQuestion'] = async (...args) => {
    if (disabled) return
    await respondQuestion(...args)
    void refreshLive({ forceFull: true })
  }
  const hasEarlierParts = Boolean(
    (bot
      && (bot.parts ?? []).some(id => id !== session.sessionId)
      && bot.parts?.[0] !== session.sessionId)
    || (room
      && (room.ownParts ?? []).some(id => id !== session.sessionId)
      && room.ownParts?.[0] !== session.sessionId),
  )
  const showLoadOlder = hasMore || (hasEarlierParts && cursor !== null && client !== undefined)
  const updateAtEnd = (nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent
    atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 90
  }
  const render = (item: ChatItem, artifacts?: UiArtifact[], showActions?: boolean) => {
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
      const range = parseRelayRange(item.resultDetail?.text)
      if (range) {
        return (
          <BotLedgerReplies
            key={`${session.sessionId}:${item.id}`}
            client={client}
            sessionId={session.sessionId}
            callId={item.id}
            range={range}
            botOf={botById}
            mentions={mentions}
            adminId={text(room?.admin)}
            onDownloadPresented={file => void onDownloadPresented(file, session.sessionId)}
            fallback={null}
          />
        )
      }
      const payload = parseBotReplyPayload(item.resultDetail?.text)
      if (payload !== undefined && payload.rows.length > 0) {
        return (
          <BotReplies
            rows={payload.rows}
            botOf={botById}
            mentions={mentions}
            adminId={text(room?.admin)}
            onDownloadPresented={file => void onDownloadPresented(file, session.sessionId)}
          />
        )
      }
    }
    if (item.kind === 'tool') return null
    return <ChatItemView item={item} compact={false} showActions={showActions} artifacts={artifacts} onSendPrompt={onSendPrompt} busyAction={storeBusy} onApproval={onApproval} onQuestion={onQuestion} userBubble={room !== undefined} />
  }
  const composerLabel = bot ? s.bots.askBot(bot.name) : room ? s.bots.askBot(room.name) : s.bots.message
  const hasComposerContent = draft.trim().length > 0 || stagedReferences.length > 0 || stagedImages.length > 0 || stagedFiles.length > 0
  const replyActive = Boolean(selected?.running)
  const stopping = storeBusy === 'stop-session'
  const composerSendDisabled = disabled || !hasComposerContent

  const draftChangeRef = useRef(handleDraftChange)
  draftChangeRef.current = handleDraftChange
  const selectionChangeRef = useRef(handleSelectionChange)
  selectionChangeRef.current = handleSelectionChange
  const sendRef = useRef(send)
  sendRef.current = send
  const stopRef = useRef(stopSession)
  stopRef.current = stopSession

  const composerInputBridge = useMemo<ComposerInputBridge>(() => ({
    composerInputRef: inputRef,
    mentionType: atQuery !== null && botAtMentionGroups.length > 0 ? 'context' : null,
    mentionGroups: botAtMentionGroups,
    closeMention: () => setAtQuery(null),
    onChangeText: next => draftChangeRef.current(next),
    onSelectionChange: event => selectionChangeRef.current(event),
  }), [atQuery, botAtMentionGroups])

  useEffect(() => {
    if (composerExpanded) expandedActivatedRef.current = true
    if (!expandedActivatedRef.current) return
    onExpandedComposerChange?.({
      visible: composerExpanded,
      onClose: () => setComposerExpanded(false),
      draft,
      input: {
        onChangeText: next => draftChangeRef.current(next),
        onSelectionChange: event => selectionChangeRef.current(event),
      },
      accessibilityLabel: composerLabel,
      placeholder: composerLabel,
      highlightMentionTokens: false,
      replyActive,
      stopping,
      sending: busy,
      sendDisabled: composerSendDisabled,
      onSubmit: () => void sendRef.current(),
      onStop: () => void stopRef.current(),
    })
  }, [
    onExpandedComposerChange,
    composerExpanded,
    draft,
    composerLabel,
    replyActive,
    stopping,
    busy,
    composerSendDisabled,
  ])

  useEffect(() => () => {
    expandedActivatedRef.current = false
    onExpandedComposerChange?.(null)
  }, [onExpandedComposerChange])

  return <BotMessageActionsContext.Provider value={true}><MarkdownLinkProvider onLinkPress={onLinkPress} transformText={transformText}><View style={styles.flex}>
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
          render(item.item, item.artifacts, item.showActions)
        )}
      </View>
    )}
      contentContainerStyle={styles.conversation} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onLayout={followEnd}
      onScrollBeginDrag={() => { scrolling.current = true; cancelFollowEnd() }}
      onScrollEndDrag={event => {
        updateAtEnd(event.nativeEvent)
        if (Math.abs(event.nativeEvent.velocity?.y ?? 0) <= 0.05) {
          scrolling.current = false
        }
      }}
      onMomentumScrollBegin={() => { scrolling.current = true; cancelFollowEnd() }}
      onMomentumScrollEnd={event => { scrolling.current = false; updateAtEnd(event.nativeEvent) }}
      onScroll={event => { if (!scrolling.current) return; updateAtEnd(event.nativeEvent) }}
      scrollEventThrottle={32} onContentSizeChange={followEnd}
      ListEmptyComponent={null}
      ListHeaderComponent={<View style={styles.section}>
        {showLoadOlder && (
          <View style={styles.earlierTop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.bots.loadOlder}
              disabled={olderLoading || olderBusy || !ready || !connected}
              onPress={() => {
                atEnd.current = false
                if (hasMore) void loadOlder()
                else void earlierPage()
              }}
              style={({ pressed }) => [styles.earlierPill, pressed && { opacity: 0.72 }]}
            >
              <Text style={styles.earlierPillText}>{s.bots.loadOlder}</Text>
            </Pressable>
          </View>
        )}
        {earlier.map((entry, i) => entry.kind === 'btw' ? <BotAsideCard key={`btw:${text(entry.id)}`} card={entry} busy={disabled} cancel={() => void perform('btw-cancel', { sessionId: bot!.id, id: entry.id })} onDelete={() => void perform('btw-delete', { sessionId: bot!.id, cardId: entry.id })} /> : entry.kind === 'closed' ? <BotSettledCard key={i} title={text(entry.title) || text(object(entry.question).question) || s.bots.question} closed={text(entry.closed) || 'dismissed'} /> : entry.kind === 'view' ? <BotViewCard key={i} pending={entry} busy reply={() => {}} /> : <View key={i} style={styles.card}><View style={styles.row}><Text style={[styles.muted, styles.grow]}>{entry.kind === 'user' ? s.bots.yourAnswer : text(entry.name) || state.bots.find(b => b.id === text(entry.botId))?.name || bot?.name || room?.name}</Text>{text(entry.via) !== '' && <BotViaPill platform={text(entry.via)} />}</View><NativeMarkdown text={text(entry.text)} /></View>)}
      </View>}
      ListFooterComponent={<View style={styles.section}>
        {room && progress.length > 0 && (
          <BotReplies
            rows={progress}
            botOf={botById}
            mentions={mentions}
            adminId={text(room?.admin)}
            onDownloadPresented={file => void onDownloadPresented(file, session.sessionId)}
          />
        )}
        {room && speaking.map(id => <View key={id} style={styles.row}><ActivityIndicator size="small" /><Text style={styles.muted}>{state.bots.find(bot => bot.id === id)?.name ?? id} · {s.bots.relayTyping}</Text></View>)}
        {bot && objects(state.btwCards[bot.id]).filter(card => card.botId === bot.id && card.partId === session.sessionId).slice().reverse().map(card => <BotAsideCard key={text(card.id)} card={card} busy={disabled} cancel={() => void perform('btw-cancel', { sessionId: bot.id, id: card.id })} onDelete={() => void perform('btw-delete', { sessionId: bot.id, cardId: card.id })} />)}
        {viewId !== '' && (
          <BotViewCard
            key={viewId}
            pending={view}
            busy={disabled}
            reply={(action, values) => void perform('view-reply', { sessionId: session.sessionId, viewId: view.id, action, values })}
            dismiss={() => void perform('dismiss-view', { sessionId: session.sessionId })}
          />
        )}
      </View>} />
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {viewId !== '' && (
      <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={text(view.title) || s.bots.viewCardJump}
          onPress={() => list.current?.scrollToEnd({ animated: true })}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 14,
              backgroundColor: colors.primarySoft,
            },
            pressed && { opacity: 0.72 },
          ]}
        >
          <Text style={[styles.muted, { color: colors.primary, fontWeight: '600' }]}>
            {text(view.title) || s.bots.viewCardJump}
          </Text>
        </Pressable>
      </View>
    )}
    {(Boolean(room?.paused) || approvals.length > 0 || questionId !== '' || hasDesktopPendingRequest) && (
      <ScrollView
        style={{ maxHeight: Math.round(height * 0.44), paddingHorizontal: 14, marginBottom: 6 }}
        contentContainerStyle={styles.section}
        keyboardShouldPersistTaps="handled"
      >
        {room?.paused && (
          <View style={styles.card}>
            <Text style={styles.body}>{s.bots.roomPaused}</Text>
            <Button
              label={s.bots.roomContinue}
              disabled={disabled}
              onPress={() => void perform(room.idlePaused ? 'resume-room-pause' : 'room-continue', { roomId: room.id })}
            />
          </View>
        )}
        {botAttentionBlocked && bot !== undefined && (
          <BotBlockedCard bot={bot} sessionId={session.sessionId} disabled={disabled} perform={perform} />
        )}
        {approvals.map(approval => (
          <BotApprovalCard
            key={text(approval.id)}
            approval={approval}
            bot={state.bots.find(entry => entry.id === approval.botId)}
            disabled={disabled}
            perform={perform}
          />
        ))}
        {questionId !== '' && (
          <BotQuestion
            key={questionId}
            question={question}
            busy={disabled}
            answer={answer => void perform('answer-question', { sessionId: session.sessionId, questionId: question.id, answer })}
            dismiss={() => void perform('dismiss-question', { sessionId: session.sessionId })}
          />
        )}
        {pendingComputerAsks.map(ask => (
          <BotComputerAskCard
            key={`cua:${text(ask.id)}`}
            ask={ask}
            botName={state.bots.find(entry => entry.id === text(ask.botId))?.name}
            disabled={disabled}
            perform={perform}
          />
        ))}
        {bot !== undefined && pendingBrowserHold !== undefined && (
          <BotBrowserHandoffCard
            botId={bot.id}
            hold={pendingBrowserHold}
            disabled={disabled}
            perform={perform}
          />
        )}
        {pendingSecretRequests.map(req => (
          <BotSecretRequestCard
            key={`sec:${text(req.id)}`}
            request={req}
            disabled={disabled}
            perform={perform}
          />
        ))}
        {pendingMailRequests.map(req => (
          <BotMailSendCard
            key={`mail:${text(req.id)}`}
            request={req}
            disabled={disabled}
            perform={perform}
          />
        ))}
        {pendingConnectorRequests.map(req => (
          <BotConnectorRequestCard
            key={`conn:${text(req.id)}`}
            request={req}
            disabled={disabled}
            perform={perform}
          />
        ))}
        {pendingPausedWorks.map((work, idx) => (
          <BotWorkPausedCard
            key={`paused:${text(work.id) || idx}`}
            work={work}
            state={state}
            disabled={disabled}
            perform={perform}
          />
        ))}
        {pendingLearning.map(proposal => (
          <BotLearningCard
            key={`learn:${text(proposal.id)}`}
            proposal={proposal}
            disabled={disabled}
            perform={perform}
          />
        ))}
        {hasComputerHold && (
          <View style={styles.card}>
            <Text style={styles.muted}>{s.bots.desktopActionRequired}</Text>
          </View>
        )}
      </ScrollView>
    )}
    {bot !== undefined && (
      <BotTaskBar
        botId={bot.id}
        sessionId={session.sessionId}
        tasks={objects(bot.tasks)}
        canBackground={Boolean(state.work.canBackground?.[bot.id])}
        disabled={disabled}
        onMoveToBackground={() => void perform('bot-move-to-background', { botId: bot.id, sessionId: session.sessionId })}
        onSelectTask={task => setSelectedTaskId(text(task.id) || undefined)}
      />
    )}
    {bot !== undefined && objects(state.sideChats?.[bot.id]).length > 0 && (
      <View style={{ paddingHorizontal: 14, paddingBottom: 4, flexDirection: 'row' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.bots.sideChat}
          onPress={() => setSideChatOpen(true)}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 14,
              backgroundColor: colors.surfaceStrong,
            },
            pressed && { opacity: 0.72 },
          ]}
        >
          <MessageCircle size={13} color={colors.primary} />
          <Text style={[styles.muted, { color: colors.ink, fontWeight: '600' }]}>
            {s.bots.sideChat} ({objects(state.sideChats?.[bot.id]).length})
          </Text>
        </Pressable>
      </View>
    )}
    {queueItems.length > 0 && (
      <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
        <QueueDock items={queueItems} />
      </View>
    )}
    <View style={chatStyles.composerWrap}>
      <View style={[chatStyles.composerInner, readableColumn]}>
        <ReferencedChatPills
          items={stagedReferences}
          onRemove={sid => setStagedReferences(current => current.filter(item => item.sessionId !== sid))}
        />
        {(stagedImages.length > 0 || stagedFiles.length > 0) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 6, paddingBottom: 6 }}>
            {stagedImages.map(img => (
              <View key={img.id} style={[styles.row, { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.surfaceStrong }]}>
                <ImageIcon size={13} color={colors.primary} />
                <Text numberOfLines={1} style={[styles.muted, { maxWidth: 140 }]}>{img.name || s.chat.unnamedImage}</Text>
                <Pressable hitSlop={6} onPress={() => setStagedImages(cur => cur.filter(item => item.id !== img.id))}>
                  <X size={13} color={colors.muted} />
                </Pressable>
              </View>
            ))}
            {stagedFiles.map(file => (
              <View key={file.id} style={[styles.row, { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.surfaceStrong }]}>
                <Paperclip size={13} color={colors.primary} />
                <Text numberOfLines={1} style={[styles.muted, { maxWidth: 140 }]}>{file.name}</Text>
                <Pressable hitSlop={6} onPress={() => setStagedFiles(cur => cur.filter(item => item.id !== file.id))}>
                  <X size={13} color={colors.muted} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        <ChatComposer
          draft={draft}
          input={composerInputBridge}
          accessibilityLabel={composerLabel}
          placeholder={composerLabel}
          highlightMentionTokens={false}
          replyActive={replyActive}
          stopping={stopping}
          sending={busy}
          hasComposerContent={hasComposerContent}
          connected={connected}
          editable={!inputDisabled}
          composerDisabled={disabled}
          sendDisabled={composerSendDisabled}
          compactComposer={compactComposer}
          composerInputMaxHeight={composerInputMaxHeight}
          onOpenExpand={() => setComposerExpanded(true)}
          onOpenActions={() => {
            Keyboard.dismiss()
            setAtQuery(null)
            setPlusMenuOpen(true)
          }}
          onOpenPrompts={() => {
            Keyboard.dismiss()
            setAtQuery(null)
            setPromptsPickerOpen(true)
          }}
          onSubmit={() => void send()}
          onStop={() => void stopSession()}
        />
      </View>
    </View>
    <BotPlusMenuModal
      visible={plusMenuOpen}
      onClose={() => setPlusMenuOpen(false)}
      onReferenceChat={() => setReferenceChatOpen(true)}
      onPickImages={() => void pickBotImages()}
      onPickFiles={() => void pickBotFiles()}
      onOpenSideChat={bot ? () => setSideChatOpen(true) : undefined}
      onOpenSchedules={() => void perform('schedules')}
    />
    {bot !== undefined && (
      <BotSideChatSheet
        visible={sideChatOpen}
        botId={bot.id}
        botName={bot.name}
        sideChats={state.sideChats?.[bot.id]}
        busy={disabled}
        onClose={() => setSideChatOpen(false)}
        perform={perform}
      />
    )}
    {bot !== undefined && (
      <BotTaskDetailModal
        task={selectedTask}
        botId={bot.id}
        client={client}
        busy={disabled}
        onClose={() => setSelectedTaskId(undefined)}
        perform={perform}
      />
    )}
    <ReferenceChatModal
      visible={referenceChatOpen}
      currentSessionId={session.sessionId}
      currentBotId={bot?.id}
      botState={state}
      onClose={() => setReferenceChatOpen(false)}
      onPick={(_mentionText, candidate) => handlePickReferencedChat(_mentionText, candidate)}
    />
    <PromptsPicker
      visible={promptsPickerOpen}
      prompts={customPrompts ?? BUILT_IN_PROMPTS}
      actionMode={quickPromptActionMode}
      onToggleActionMode={mode => {
        void setQuickPromptActionMode(mode).catch(() => {
          Alert.alert(s.settings.quickPromptActionMode, s.settings.quickPromptActionSaveFailed)
        })
      }}
      onClose={() => setPromptsPickerOpen(false)}
      onPick={prompt => void pickQuickPrompt(prompt)}
      onManage={() => { setPromptsPickerOpen(false); setPromptsManagerOpen(true) }}
    />
    <PromptsManager
      visible={promptsManagerOpen}
      prompts={customPrompts ?? BUILT_IN_PROMPTS}
      promptsLoading={promptsLoading}
      onBack={() => { setPromptsManagerOpen(false); setPromptsPickerOpen(true) }}
      onClose={() => setPromptsManagerOpen(false)}
      onAdd={() => { setPromptsManagerOpen(false); setPromptEditing('new') }}
      onEdit={prompt => { setPromptsManagerOpen(false); setPromptEditing(prompt) }}
      onDelete={prompt => {
        Alert.alert(s.chat.toolPromptDeleteTitle(prompt.title), s.chat.toolPromptDeleteBody, [
          { text: s.common.cancel, style: 'cancel' },
          { text: s.common.delete, style: 'destructive', onPress: () => void deletePrompt(prompt) },
        ])
      }}
    />
    <PromptEditor
      visible={promptEditing !== null}
      prompt={promptEditing === 'new' || promptEditing === null ? undefined : promptEditing}
      promptsLoading={promptsLoading}
      onBack={() => { setPromptEditing(null); setPromptsManagerOpen(true) }}
      onClose={() => setPromptEditing(null)}
      onSave={(title, text) => void savePromptEdit(title, text)}
    />
    {fileLinkPath !== undefined && connected && ready && <SessionToolsPanel
      key={`${session.sessionId}:${fileLinkPath}`} mode="files" sessionId={session.sessionId}
      initialFile={fileLinkPath} showTabs={false} onClose={() => setFileLinkPath(undefined)} />}
  </View></MarkdownLinkProvider></BotMessageActionsContext.Provider>
}

function BotLedgerReplies({ client, sessionId, callId, range, botOf, mentions, adminId, onDownloadPresented, fallback }: {
  client?: BotRemoteClient; sessionId: string; callId: string; range: { from: number; to?: number; anchor?: string }
  botOf?: (botId: string) => BotEntry | undefined; mentions?: BotMentionContext; adminId?: string; onDownloadPresented?: (file: BotObject) => void; fallback: React.ReactNode
}) {
  const scope = useAppStore(browseScope)
  const canCache = useAppStore(state => Boolean(state.config?.baseUrl && state.selectedDevice?.identityKey))
  const round = JSON.stringify([range.from, range.to, range.anchor])
  const liveRows = useBrowseMemory(state => canCache ? state.entries[browseKey(scope, sessionId)]?.groupRounds?.[`call:${callId}`] : undefined)
  const cachedRows = useBrowseMemory(state => canCache ? state.entries[browseKey(scope, sessionId)]?.groupRounds?.[round] : undefined)
  const [loadError, setLoadError] = useState<string>()
  const [rows, setRows] = useState<BotObject[]>()
  const shown = preferredRoomRows(liveRows ?? cachedRows, rows)
  useEffect(() => {
    const control = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setLoadError(undefined)
    setRows(undefined)
    if (!client) return
    let misses = 0
    const tick = async () => {
      let poll: RoomRowsPoll
      try {
        poll = await pollRoomRows((endpoint, payload, signal) => client.call(endpoint, payload, signal),
          { roomId: sessionId, callId, range }, control.signal)
      } catch (error) {
        if (control.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : s.bots.unavailable)
        return
      }
      if (control.signal.aborted) return
      if (poll.rows !== undefined) {
        misses = 0
        setRows(poll.rows)
        if (canCache) saveGroupRound(scope, sessionId, round, poll.rows)
      } else if (poll.legacy) {
        // An older Host only knows the rounds still running; a settled one is gone.
        // A Host that did not answer at all gets retried instead of counted.
        if (poll.answered) misses += 1
      }
      if (!poll.open) return
      if (poll.legacy && misses >= ROOM_ROWS_LEGACY_MISSES) return
      timer = setTimeout(() => void tick(), poll.legacy ? ROOM_ROWS_LEGACY_INTERVAL_MS : ROOM_ROWS_INTERVAL_MS)
    }
    void tick()
    return () => { control.abort(); if (timer) clearTimeout(timer) }
  }, [client, sessionId, callId, scope, canCache, round])
  return <View>
    {shown.length ? <BotReplies rows={shown} botOf={botOf} mentions={mentions} adminId={adminId} onDownloadPresented={onDownloadPresented} /> : fallback}
    {loadError && <Text accessibilityRole="alert">{loadError}</Text>}
  </View>
}
