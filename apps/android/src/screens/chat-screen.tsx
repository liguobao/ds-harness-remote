import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { ArrowDown, ArrowLeft, FileText, Layers, ListTree, Menu, MessageSquare, RefreshCw, Users, X } from 'lucide-react-native'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  FlatList,
  Image,
  Keyboard,
  Modal,
  NativeModules,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { shouldConfirmSwipeRightOpen, shouldStartSwipeRightToOpen } from '../lib/gesture-swipe-rules'
import { isSubagentSession } from '../lib/session-kind'
import { workspaceStableKey } from '../lib/workspace-key'
import { strings } from '../locales/i18n'
import { sessionPermissions } from '../services/session-permissions'
import type { CustomPrompt } from '../services/storage'
import { BUILT_IN_PROMPTS } from '../services/storage'
import type { ChatSection } from '../state/message-helpers'
import { chatImageConnectionGeneration, requireSessionTools, sessionChatImageLoader, useAppStore } from '../state/store'
import { type UiArtifact } from '../state/ui-artifacts'
import type {
  ChatItem,
  ModelCatalogModel,
  ModelProviderGroup,
  PermissionSelect,
  PromptImage,
  WorkspaceView
} from '../types'
import { AnimatedEllipsis } from '../ui/animated-ellipsis'
import { ChatImageProvider } from '../ui/chat-image'
import { BlurHeaderFrame, IconButton, TopBar } from '../ui/components'
import { KeyboardInset } from '../ui/keyboard-inset'
import { decodeSessionMentionUri, markdownFilePath, MarkdownLinkProvider, openSafeExternalUrl } from '../ui/markdown'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { useResponsiveLayout } from '../ui/responsive'
import { spacing } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { AutomationTasksModal } from './automation-tasks-modal'
import { ChatErrorBoundary } from './chat-error-boundary'
import {
  formatFileBytes,
  formatUploadedFilesPrompt,
  MAX_TOTAL_FILES_BYTES,
  type StagedFile
} from './chat-files'
import { ChatTrajectory } from './chat-trajectory'
import { ChatActionMenu } from './chat/action-menu'
import { ChildAgentPanel, TeamAgentPanel } from './chat/agents'
import { ChatComposer } from './chat/composer'
import {
  ChatImages,
  ChatItemView,
  ChatProcessGroup,
  isActiveChatItem,
  QueueDock,
  WelcomeMessage
} from './chat/messages'
import {
  agentPresetName,
  builtinPresetName,
  ModelPicker,
  ModePicker,
  permissionDisplayName,
  PermissionPicker,
  PromptEditor,
  PromptsManager,
  PromptsPicker,
  ToolAccessPicker,
  WorkspacePicker,
} from './chat/pickers'
import { sessionTitle } from './chat/presentation'
import { SessionActivityDock } from './chat/session-activity'
import { SessionInfo } from './chat/session-info'
import { createStyles } from './chat/styles'
import { useChatAttachments } from './chat/use-chat-attachments'
import { useChatBackHandler } from './chat/use-chat-back-handler'
import { useChatMentions } from './chat/use-chat-mentions'
import { useChatPrompts } from './chat/use-chat-prompts'
import { useChatScroll } from './chat/use-chat-scroll'
import { useChatTranscript } from './chat/use-chat-transcript'
import { useLiveSessionStatus } from './device-screens'
import { HostSessionsDrawer } from './host-sessions-drawer'
import { PluginsModal } from './plugins-modal'
import { SessionToolsPanel } from './session-tools-panel'

import { browseKey, browseScope, updateBrowseEntry, useBrowseMemory } from '../services/browse-memory'
import { formatQuoteText, QuotePreview } from '../ui/quote-preview'
const EMPTY_QUOTES: string[] = []
const EMPTY_IMAGES: PromptImage[] = []
const EMPTY_CHAT_ITEMS: ChatItem[] = []
const EMPTY_UI_ARTIFACTS: UiArtifact[] = []

/** Hard cap mirroring the largest backend prompt budget (ACP/CodeX 256 KiB). */
const LONG_DRAFT_MAX = 256_000

export function ChatScreen({ onBack, onOpenDevices, onNewSession, onOpenWorkspaces }: { onBack: () => void; onOpenDevices: () => void; onNewSession?: () => void; onOpenWorkspaces?: (focusWorkspaceKey?: string) => void }) {
  // New subagent children and running-state changes must reach `sessions`
  // without leaving the chat (the list screens unmount here).
  const session = useAppStore(state => state.selectedSession)
  useLiveSessionStatus(session !== undefined && (session.backend ?? 'harness') === 'harness')
  const hostId = useAppStore(state => state.selectedDevice?.deviceId)
  const hostPlatform = useAppStore(state => state.selectedDevice?.platform)
  const messages = useAppStore(state => session === undefined ? EMPTY_CHAT_ITEMS : state.messages[session.sessionId] ?? EMPTY_CHAT_ITEMS)
  const busy = useAppStore(state => state.busyAction)
  const codexReadySessionId = useAppStore(state => state.codexReadySessionId)
  const connection = useAppStore(state => state.connection)
  const imageGeneration = chatImageConnectionGeneration()
  const imageLoader = useMemo(() => session === undefined || connection.phase !== 'connected'
    ? undefined : sessionChatImageLoader(session), [session?.sessionId, session?.backend, hostId, imageGeneration, connection.phase])
  const historyHasMore = useAppStore(state => state.historyHasMore)
  const historyLoadingOlder = useAppStore(state => state.historyLoadingOlder)
  const sessionModels = useAppStore(state => state.sessionModels)
  const modelSelecting = useAppStore(state => state.modelSelecting)
  const permissionSelecting = useAppStore(state => state.permissionSelecting)
  const sendMessage = useAppStore(state => state.sendMessage)
  const stopSession = useAppStore(state => state.stopSession)
  const reconnect = useAppStore(state => state.reconnect)
  const openSession = useAppStore(state => state.openSession)
  const respondApproval = useAppStore(state => state.respondApproval)
  const respondQuestion = useAppStore(state => state.respondQuestion)
  const loadOlderHistory = useAppStore(state => state.loadOlderHistory)
  const selectModel = useAppStore(state => state.selectModel)
  const selectPermission = useAppStore(state => state.selectPermission)
  const loadAgentPresets = useAppStore(state => state.loadAgentPresets)
  const selectAgentPreset = useAppStore(state => state.selectAgentPreset)
  const createSession = useAppStore(state => state.createSession)
  const archiveSession = useAppStore(state => state.archiveSession)
  const workspaces = useAppStore(state => state.workspaces)
  const sessions = useAppStore(state => state.sessions)
  const agentPresetOptions = useAppStore(state => state.agentPresetOptions)
  const agentPresetLoading = useAppStore(state => state.agentPresetLoading)
  const agentPresetSelecting = useAppStore(state => state.agentPresetSelecting)
  const previewImageUri = useAppStore(state => state.previewImageUri)
  const setPreviewImageUri = useAppStore(state => state.setPreviewImageUri)
  const memoryScope = browseScope(useAppStore.getState())
  const memoryKey = browseKey(memoryScope, session?.sessionId ?? '')
  const draft = useBrowseMemory(state => state.entries[memoryKey]?.draft ?? '')
  const memoryError = useBrowseMemory(state => state.error)
  const setDraft = (value: string) => updateBrowseEntry(memoryScope, session?.sessionId ?? '', {draft: value})
  const [trajectory, setTrajectory] = useState(false)
  const [composingDuringRun, setComposingDuringRun] = useState(false)
  const [subagentsOpen, setSubagentsOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)

  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [automationTasksOpen, setAutomationTasksOpen] = useState(false)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const pluginsAvailable = useAppStore(state => state.connection.phase === 'connected')
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false)

  // Web-style blue marks: `/` commands and `@` references render in accent blue.
  const images = useBrowseMemory(state => state.entries[memoryKey]?.images ?? EMPTY_IMAGES)
  const setImages = (value: PromptImage[] | ((previous: PromptImage[]) => PromptImage[])) => {
    const previous = useBrowseMemory.getState().entries[memoryKey]?.images ?? EMPTY_IMAGES
    updateBrowseEntry(memoryScope, session?.sessionId ?? '', {images: typeof value === 'function' ? value(previous) : value})
  }
  const quotes = useBrowseMemory(state => state.entries[memoryKey]?.quotes ?? EMPTY_QUOTES)
  const setQuotes = (value: string[] | ((previous: string[]) => string[])) => {
    const previous = useBrowseMemory.getState().entries[memoryKey]?.quotes ?? EMPTY_QUOTES
    updateBrowseEntry(memoryScope, session?.sessionId ?? '', {quotes: typeof value === 'function' ? value(previous) : value})
  }
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [permissionPickerOpen, setPermissionPickerOpen] = useState(false)
  const mentionInput = useChatMentions({
    session, sessions, workspaces, connectionPhase: connection.phase, draft, setDraft,
    setPermissionPickerOpen, setModelPickerOpen,
  })
  const { composerInputRef, draftRef, mentionType, setMentionType, applyDraft, closeMention, resetSelection } = mentionInput
  const lastQuoteCountRef = useRef(quotes.length)
  useEffect(() => {
    if (quotes.length > lastQuoteCountRef.current) {
      composerInputRef.current?.focus()
    }
    lastQuoteCountRef.current = quotes.length
  }, [quotes.length, composerInputRef])

  useEffect(() => {
    if (NativeModules.DshProcessText?.getInitialText) {
      NativeModules.DshProcessText.getInitialText().then((text: string | null) => {
        if (text && text.trim().length > 0) {
          setQuotes(current => [...current, text.trim()])
          composerInputRef.current?.focus()
        }
      }).catch(() => {})
    }

    const sub = DeviceEventEmitter.addListener('onProcessText', (text: string) => {
      if (text && text.trim().length > 0) {
        setQuotes(current => [...current, text.trim()])
        composerInputRef.current?.focus()
      }
    })

    return () => {
      sub.remove()
    }
  }, [setQuotes, composerInputRef])
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const sessionGenerationRef = useRef(0)
  useLayoutEffect(() => {
    let lastSessionId = useAppStore.getState().selectedSession?.sessionId
    return useAppStore.subscribe((state) => {
      const currentId = state.selectedSession?.sessionId
      if (currentId !== lastSessionId) {
        lastSessionId = currentId
        sessionGenerationRef.current += 1
        setStagedFiles([])
      }
    })
  }, [])
  const { canAttachImages, attachmentPicking, pickImages, takePhoto, pickFiles } = useChatAttachments({
    session, memoryKey, images, setImages, stagedFiles, setStagedFiles, sessionGenerationRef,
  })
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [modePickerOpen, setModePickerOpen] = useState(false)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [toolPickerOpen, setToolPickerOpen] = useState(false)
  const [toolsMode, setToolsMode] = useState<'files' | 'terminal'>()
  const [fileLinkPath, setFileLinkPath] = useState<string>()
  const { promptsPickerOpen, setPromptsPickerOpen, customPrompts, promptEditing,
    setPromptEditing, promptsManagerOpen, setPromptsManagerOpen, promptsLoading, savePromptEdit, deletePrompt } = useChatPrompts(connection.phase)
  const [permissionOptions, setPermissionOptions] = useState<PermissionSelect['options']>()
  const [permissionError, setPermissionError] = useState<string>()
  const [permissionRevision, setPermissionRevision] = useState(0)
  const [permissionLoading, setPermissionLoading] = useState(false)
  const inlinePermissionOptions = session?.projections?.values?.permissions
  useEffect(() => {
    setPermissionOptions(undefined)
    setPermissionError(undefined)
    setPermissionLoading(false)
    if (session === undefined || session.backend === 'codex' || connection.phase !== 'connected') return
    const projected = sessionPermissions(session)
    if (projected === undefined || projected.options.length > 0) return
    const controller = new AbortController()
    setPermissionLoading(true)
    void Promise.resolve().then(() => requireSessionTools().permissionOptions(controller.signal))
      .then(options => { if (!controller.signal.aborted) setPermissionOptions(options) })
      .catch(() => { if (!controller.signal.aborted) setPermissionError(strings.tools.permissionUnavailable) })
      .finally(() => { if (!controller.signal.aborted) setPermissionLoading(false) })
    return () => controller.abort()
  }, [session?.sessionId, session?.backend, inlinePermissionOptions, connection.phase, permissionPickerOpen, permissionRevision])
  useEffect(() => { setToolsMode(undefined) }, [session?.sessionId, connection.phase])
  // The mode (agent-preset) roster is deployment-level; fetch it once per connection.
  useEffect(() => {
    if (connection.phase !== 'connected' || session?.backend === 'codex') return
    if (useAppStore.getState().agentPresetOptions !== undefined) return
    void loadAgentPresets()
  }, [connection.phase, session?.sessionId, session?.backend, loadAgentPresets])
  const [reconnectingSession, setReconnectingSession] = useState(false)
  const [newSessionPending, setNewSessionPending] = useState(false)
  const creatingSessionRef = useRef(false)
  const lastNewSessionTimeRef = useRef(0)
  const { visibleMessages, visibleSections, uiBySection, visibleUiIds, queueItems, childSessions, teamState } = useChatTranscript({ session, sessions, messages, hostId })
  const panelOpen = plusMenuOpen || modelPickerOpen || modePickerOpen || permissionPickerOpen
    || workspacePickerOpen || toolPickerOpen || toolsMode !== undefined || trajectory || mentionType !== null
    || promptsPickerOpen || promptsManagerOpen || promptEditing !== null || subagentsOpen || teamOpen || sessionInfoOpen
  const { listRef, viewability, awayFromLatest, newContent, jumpToLatest, beginSendScroll,
    onListLayout, onListContentSizeChange, onListScroll, onListDragEnd, onListMomentumEnd,
    onScrollBeginDrag, onMomentumScrollBegin } = useChatScroll({
    session, messages, visibleMessages, visibleSections, memoryScope, memoryKey,
    panelOpen, historyLoadingOlder, busy, setTrajectory,
  })

  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  // Landscape phones are short: keep the composer compact when the IME is up
  // and let the list use a readable centred column on wide windows.
  const { landscape, compactHeight, height, width, contentMaxWidth } = useResponsiveLayout()
  const compactComposer = landscape || compactHeight
  const composerInputMaxHeight = compactComposer ? Math.max(48, Math.min(96, Math.round(height * 0.22))) : 126
  // Tablets keep the session list visible beside the conversation. Short
  // landscape phone windows stay single-pane; a wide tablet keeps the split
  // even while the IME reduces the window height.
  const tabletSplit = width >= 760 && (height >= 520 || width >= 1000)
  useEffect(() => {
    if (tabletSplit) setSessionsOpen(false)
  }, [tabletSplit])
  const readableColumn = { width: '100%' as const, maxWidth: contentMaxWidth, alignSelf: 'center' as const }

  const openSessionsDrawer = useCallback(() => {
    Keyboard.dismiss()
    setMentionType(null)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
    setSessionsOpen(true)
  }, [setMentionType])

  // Swipe right gesture to open sessions drawer with haptic feedback
  const edgeSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_evt, g) => {
          if (tabletSplit || sessionsOpen) return false
          return shouldStartSwipeRightToOpen({ dx: g.dx, dy: g.dy, x0: g.x0 }, trajectory)
        },
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderRelease: (_evt, g) => {
          if (tabletSplit || sessionsOpen) return
          if (shouldConfirmSwipeRightOpen({ dx: g.dx, dy: g.dy, x0: g.x0, vx: g.vx })) {
            openSessionsDrawer()
          }
        },
      }),
    [sessionsOpen, tabletSplit, trajectory, openSessionsDrawer]
  )

  // Artifact changes must invalidate FlatList cells even when their section is
  // reused (a later turn can patch a card owned by an earlier turn).
  const renderChatItem = useCallback(({ item }: { item: ChatSection }) => item.kind === 'process'
    ? <ChatProcessGroup items={item.items} artifacts={uiBySection.get(item.key)?.cards ?? EMPTY_UI_ARTIFACTS} updatedArtifacts={uiBySection.get(item.key)?.pointers ?? EMPTY_UI_ARTIFACTS} availableUiIds={visibleUiIds} busyAction={busy} onApproval={respondApproval} onQuestion={respondQuestion} />
    : <ChatItemView item={item.item} busyAction={busy} compact={false} onApproval={respondApproval} onQuestion={respondQuestion} />,
  [busy, respondApproval, respondQuestion, uiBySection, visibleUiIds])

  // Keep chat's back action at the top of the Android responder stack. The
  // navigator also handles back globally, but a freshly mounted FlatList can
  // otherwise win the first dispatch while its cells are being measured.
  // Back inside a subagent child returns to its parent conversation (the
  // official subagent UI's navigation), instead of leaving the chat entirely.
  const backFromChat = () => {
    const parent = session !== undefined && isSubagentSession(session)
      ? sessions.find(item => item.sessionId === session.parentSessionId)
      : undefined
    if (parent !== undefined) {
      Keyboard.dismiss()
      void openSession(parent)
      return
    }
    Keyboard.dismiss()
    onBack()
  }
  const onBackRef = useRef(backFromChat)
  onBackRef.current = backFromChat
  useChatBackHandler(composerInputRef, () => onBackRef.current(), [
    { open: subagentsOpen, close: () => setSubagentsOpen(false) },
    { open: teamOpen, close: () => setTeamOpen(false) },
    { open: plusMenuOpen, close: () => { Keyboard.dismiss(); setPlusMenuOpen(false) } },
    { open: modelPickerOpen, close: () => setModelPickerOpen(false) },
    { open: modePickerOpen, close: () => setModePickerOpen(false) },
    { open: permissionPickerOpen, close: () => setPermissionPickerOpen(false) },
    { open: workspacePickerOpen, close: () => setWorkspacePickerOpen(false) },
    { open: toolPickerOpen, close: () => setToolPickerOpen(false) },
    { open: promptEditing !== null, close: () => { setPromptEditing(null); setPromptsManagerOpen(true) } },
    { open: promptsManagerOpen, close: () => { setPromptsManagerOpen(false); setPromptsPickerOpen(true) } },
    { open: promptsPickerOpen, close: () => setPromptsPickerOpen(false) },
    { open: toolsMode !== undefined, close: () => { setToolsMode(undefined); setFileLinkPath(undefined) } },
    { open: trajectory, close: () => setTrajectory(false) },
  ])

  const openLink = useCallback((href: string) => {
    // 1. Session reference navigation: dsh-session:<base64url>
    const targetSessionId = decodeSessionMentionUri(href)
    if (targetSessionId !== undefined) {
      const targetSession = sessions.find(candidate => candidate.sessionId === targetSessionId)
      if (targetSession !== undefined) {
        void openSession(targetSession)
      }
      return
    }

    // 2. Safe external web URLs (http, https, mailto, www.*)
    if (openSafeExternalUrl(href)) return

    // 3. Workspace file navigation remains unavailable on the Claude and Hermes backends
    if (session?.backend === 'claude' || session?.backend === 'hermes') return

    // 4. Workspace file link
    const path = markdownFilePath(href)
    if (path === undefined) return
    setFileLinkPath(path)
    setToolsMode('files')
  }, [openSession, session?.backend, sessions])

  const connected = connection.phase === 'connected' && !reconnectingSession
  const hasActiveChatItem = visibleMessages.some(isActiveChatItem)
  const replyActive = connected && (busy === 'send-message' || busy === 'stop-session' || (session?.running ?? false) || hasActiveChatItem)
  useEffect(() => {
    if (session === undefined) {
      onBack()
    }
  }, [session, onBack])

  useEffect(() => {
    if (!replyActive) setComposingDuringRun(false)
    else if (composingDuringRun) composerInputRef.current?.focus()
  }, [replyActive, composingDuringRun])
  if (session === undefined) return null

  const submit = async () => {
    if (!sendReady || permissionSelecting || session === undefined) return
    // Read the live ref: the render-closure `draft` can lag the last keystrokes
    // typed right before the tap, silently dropping the tail of the message.
    const submittedDraft = draftRef.current
    const text = submittedDraft.trim()
    const submittedQuotes = quotes
    const submittedImages = images
    const submittedFiles = stagedFiles
    if (text.length === 0 && submittedQuotes.length === 0 && images.length === 0 && stagedFiles.length === 0) return
    let promptWithQuotes = text
    if (submittedQuotes.length > 0) {
      const formattedQuotes = submittedQuotes.map(formatQuoteText).join('\n\n')
      promptWithQuotes = text.length > 0 ? `${formattedQuotes}\n\n${text}` : formattedQuotes
    }
    const promptText = submittedFiles.length > 0
      ? formatUploadedFilesPrompt(promptWithQuotes, submittedFiles)
      : promptWithQuotes
    if (promptText.length > LONG_DRAFT_MAX) {
      Alert.alert(strings.chat.draftTooLongTitle, strings.chat.draftTooLong(LONG_DRAFT_MAX))
      return
    }
    applyDraft('')
    setQuotes([])
    setImages([])
    setStagedFiles([])
    setMentionType(null)
    resetSelection()
    const targetSessionId = session.sessionId
    const sendSessionGen = sessionGenerationRef.current
    const restoreScrollAfterRejectedSend = beginSendScroll()
    const outcome = await sendMessage(promptText, submittedImages)
    if (outcome === 'rejected') {
      restoreScrollAfterRejectedSend()
      // Nothing was persisted (command failure): restore the draft without
      // clobbering input typed while the send was in flight.
      if (sessionGenerationRef.current === sendSessionGen && useAppStore.getState().selectedSession?.sessionId === targetSessionId) {
        const inFlight = useBrowseMemory.getState().entries[memoryKey]?.draft ?? ''
        setDraft(inFlight.length === 0 ? submittedDraft : `${submittedDraft}\n${inFlight}`)
        setQuotes(previous => previous.length === 0 ? submittedQuotes : [...submittedQuotes, ...previous])
        setImages(previous => previous.length === 0 ? submittedImages : [...submittedImages, ...previous])
        setStagedFiles(current => {
          const combined = [...submittedFiles, ...current]
          let acc = 0
          return combined.filter(f => {
            if (acc + f.size <= MAX_TOTAL_FILES_BYTES) {
              acc += f.size
              return true
            }
            return false
          })
        })
      }
      Alert.alert(strings.messageActions.failed, useAppStore.getState().error ?? strings.messageActions.unavailable)
    } else if (outcome === 'sent') {
      const result = useAppStore.getState().commandResult
      if (result?.sessionId === session.sessionId && useAppStore.getState().selectedSession?.sessionId === session.sessionId) {
        Alert.alert(strings.mention.commandSection, result.text)
        useAppStore.setState({ commandResult: undefined })
      }
    }
    // 'kept': the row stays in the timeline with an inline failed/unconfirmed
    // state and a retry affordance — no Alert and no draft restore.
  }

  const openPlusMenu = () => {
    // The composer TextInput often still owns focus when the user taps +.
    // Dismissing the IME first gives the transparent Modal the full window and
    // keeps its sheet (including the close target) out of the keyboard's touch
    // region on Android.
    Keyboard.dismiss()
    setPlusMenuOpen(true)
  }

  const closePlusMenu = () => {
    Keyboard.dismiss()
    setPlusMenuOpen(false)
  }

  const openPromptsPicker = () => {
    Keyboard.dismiss()
    setMentionType(null)
    setPromptsPickerOpen(true)
  }

  const handleBack = () => {
    Keyboard.dismiss()
    if (trajectory) {
      setTrajectory(false)
      return
    }
    onBackRef.current()
  }

  const pickModel = async (group: ModelProviderGroup, model: ModelCatalogModel, reasoningEffort?: string) => {
    setModelPickerOpen(false)
    await selectModel({
      provider: group.id,
      model: model.id,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    })
  }

  const reconnectCurrentSession = async () => {
    if (reconnectingSession) return
    setReconnectingSession(true)
    try {
      await reconnect()
    } finally {
      setReconnectingSession(false)
    }
  }

  const supportsModeSelection = !['codex', 'cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes'].includes(session.backend ?? 'harness')
  const currentAgentPresetId = session.agentPreset ?? agentPresetOptions?.find(option => option.isDefault)?.id
  const currentWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(session.sessionId))
  const workspaceLabel = currentWorkspace?.title ?? strings.chat.workspaceNone
  const currentPresetRow = agentPresetOptions?.find(option => option.id === currentAgentPresetId)
  const modeLabel = currentAgentPresetId === undefined
    ? strings.chat.modeDefault
    : currentPresetRow === undefined
      ? builtinPresetName(currentAgentPresetId) ?? currentAgentPresetId
      : agentPresetName(currentPresetRow)

  const connectionRetrying = reconnectingSession || connection.phase === 'connecting' || connection.phase === 'reconnecting'
  const sendReady = connected && !busy?.startsWith('session:')
    && (session.backend !== 'codex' || codexReadySessionId === session.sessionId)
  const hasComposerContent = draft.trim().length > 0 || quotes.length > 0 || images.length > 0 || stagedFiles.length > 0
  const compactRunning = replyActive && !hasComposerContent && !composingDuringRun
  const stopping = busy === 'stop-session'
  const composerDisabled = !connected || permissionSelecting
  const sendDisabled = !sendReady || permissionSelecting || !hasComposerContent
  const projectedPermissions = sessionPermissions(session)
  const permissions = projectedPermissions === undefined ? undefined : { ...projectedPermissions, options: permissionOptions ?? projectedPermissions.options }
  const currentPermission = permissions?.options.find(option => option.value === permissions.currentValue)
  const currentModel = sessionModels?.groups
    .find(group => group.id === sessionModels.current.provider)
    ?.models.find(model => model.id === sessionModels.current.model)
  const currentEffortId = sessionModels?.current.reasoningEffort ?? currentModel?.reasoning?.defaultEffort
  const currentEffortName = currentModel?.reasoning?.efforts.find(effort => effort.id === currentEffortId)?.name
    ?? currentEffortId
  const currentModelName = currentModel?.name ?? sessionModels?.current.model
  const currentModelLabel = currentEffortName === undefined
    ? currentModelName
    : `${currentModelName} · ${currentEffortName}`

  const pickMode = async (preset: string) => {
    setModePickerOpen(false)
    if (preset === session.agentPreset) return
    const applied = await selectAgentPreset(preset)
    if (!applied) {
      Alert.alert(
        strings.chat.modeLockedTitle,
        session.blank ? strings.chat.modeSelectFailedBody : strings.chat.modeLockedBody,
      )
    }
  }

  const pickToolMode = (mode: 'files' | 'terminal') => {
    setToolPickerOpen(false)
    setFileLinkPath(undefined)
    setToolsMode(mode)
  }

  const sessionBlank = visibleMessages.length === 0 && session.blank !== false

  const startNewSession = async () => {
    const now = Date.now()
    if (now - lastNewSessionTimeRef.current < 800) return
    if (creatingSessionRef.current || newSessionPending || busy !== undefined) return

    if (sessionBlank) {
      Keyboard.dismiss()
      setMentionType(null)
      applyDraft('')
      setImages([])
      return
    }

    creatingSessionRef.current = true
    lastNewSessionTimeRef.current = now
    setNewSessionPending(true)
    try {
      const created = await createSession(currentWorkspace?.workspaceId)
      if (created) {
        onNewSession?.()
      } else {
        Alert.alert(strings.chat.newChatFailedTitle, strings.chat.newChatFailedBody)
      }
    } finally {
      creatingSessionRef.current = false
      setNewSessionPending(false)
    }
  }

  const sendPrompt = async (prompt: CustomPrompt) => {
    setPromptsPickerOpen(false)
    const outcome = await sendMessage(prompt.text)
    if (outcome === 'sent') AccessibilityInfo.announceForAccessibility(strings.chat.toolPromptSent(prompt.title))
    else if (outcome === 'rejected') Alert.alert(strings.chat.toolPromptSendFailed, strings.chat.toolPromptSendFailed)
  }

  const moveSessionToWorkspace = async (workspace: WorkspaceView) => {
    const previousId = session.sessionId
    const opened = await createSession(workspace.workspaceId)
    if (!opened) {
      Alert.alert(strings.chat.moveFailedTitle, strings.chat.moveFailedBody)
      return
    }
    // A blank conversation carries nothing to lose: recreate it inside the
    // chosen workspace and archive the old placeholder so it reads as a move.
    if (sessionBlank) await archiveSession(previousId)
  }

  const pickWorkspace = (workspace: WorkspaceView) => {
    setWorkspacePickerOpen(false)
    if (workspace.sessionIds.includes(session.sessionId)) return
    if (sessionBlank) {
      void moveSessionToWorkspace(workspace)
      return
    }
    Alert.alert(
      strings.chat.moveStartedTitle,
      strings.chat.moveStartedBody(workspace.title),
      [
        { text: strings.common.cancel, style: 'cancel' },
        { text: strings.chat.moveStartedConfirm, onPress: () => void moveSessionToWorkspace(workspace) },
      ],
    )
  }

  const pickPermission = (preset: string) => {
    setPermissionPickerOpen(false)
    const apply = () => void selectPermission(preset)
    if (preset === 'danger-full-access') {
      Alert.alert(
        session.backend === 'codex' ? strings.chat.codexFullAccessTitle : strings.chat.fullAccessTitle,
        session.backend === 'codex' ? strings.chat.codexFullAccessBody : strings.chat.fullAccessBody,
        [
          { text: strings.common.cancel, style: 'cancel' },
          { text: strings.chat.enable, style: 'destructive', onPress: apply },
        ],
      )
    } else apply()
  }

  const header = <>
      <TopBar
        title={sessionTitle(session)}
        onTitlePress={() => { Keyboard.dismiss(); setMentionType(null); setSessionInfoOpen(true) }}
        titleLines={1}
        onBack={tabletSplit ? undefined : trajectory ? handleBack : openSessionsDrawer}
        backIcon={trajectory ? ArrowLeft : Menu}
        backLabel={trajectory ? strings.common.back : strings.chat.openHostSessions}
        action={<>
          <IconButton label={trajectory ? strings.trajectory.close : strings.trajectory.open}
            icon={trajectory ? MessageSquare : ListTree} dense tint={trajectory ? colors.primary : undefined}
            onPress={() => { Keyboard.dismiss(); setMentionType(null); setTrajectory(value => !value) }} />
          {childSessions.length > 0 && (
            <IconButton label={strings.chat.subagentsTitle(childSessions.length)}
              icon={Layers} dense tint={childSessions.some(item => item.running) ? colors.primary : undefined}
              onPress={() => { Keyboard.dismiss(); setMentionType(null); setSubagentsOpen(true) }} />
          )}
          {teamState !== undefined && teamState.members.length > 0 && (
            <IconButton label={strings.chat.teamTitle(teamState.members.length)}
              icon={Users} dense tint={teamState.members.some(item =>
                item.phase === 'active' && sessions.find(row => row.sessionId === item.id)?.running === true) ? colors.primary : undefined}
              onPress={() => { Keyboard.dismiss(); setMentionType(null); setTeamOpen(true) }} />
          )}
          <IconButton label={strings.chat.newChat} icon={OfficialMenuIcons.newChat} dense onPress={() => void startNewSession()} disabled={newSessionPending || busy !== undefined} />
          {!connected && <IconButton label={strings.chat.reconnect} icon={RefreshCw} dense onPress={() => void reconnectCurrentSession()} disabled={connectionRetrying} />}
        </>}
      />
      {!connected && (
        <View style={styles.connectionBanner} accessibilityRole="alert">
          <View style={styles.connectionDot} />
          <Text style={styles.connectionBannerText}>
            {connectionRetrying ? <>{strings.chat.reconnecting.replace(/…$/, '')}<AnimatedEllipsis /></> : strings.chat.offline}
          </Text>
        </View>
      )}
    </>
  return (
    <ChatImageProvider value={imageLoader}><MarkdownLinkProvider onLinkPress={openLink}><KeyboardInset>
      {memoryError !== undefined && <Text accessibilityRole="alert" style={{color: colors.danger, padding: 8}}>{memoryError}</Text>}
      <View style={[styles.splitRoot, tabletSplit && styles.splitRootWide]}>
        {tabletSplit && (
          <View style={styles.splitSidebar}>
            <HostSessionsDrawer
              inline
              onOpenWorkspaces={() => {
                Keyboard.dismiss()
                if (onOpenWorkspaces) onOpenWorkspaces()
                else onBack()
              }}
              onBack={onBack}
              backLabel={strings.chat.backToWorkspaces}
              onClose={() => Keyboard.dismiss()}
              onSelect={async next => { await openSession(next) }}
              onOpenAutomationTasks={() => setAutomationTasksOpen(true)}
              onOpenPlugins={pluginsAvailable ? () => setPluginsOpen(true) : undefined}
            />
          </View>
        )}
        <View style={styles.splitMain} {...edgeSwipeResponder.panHandlers}>
      {/* Messages scroll beneath the frosted header; the trajectory view keeps its own fixed search bar below it. */}
      <BlurHeaderFrame header={header} inset={trajectory}>{headerHeight => <ChatErrorBoundary key={session.sessionId} resetKey={session.sessionId}>{trajectory ? <ChatTrajectory key={session.sessionId} items={messages} renderImages={images => <ChatImages images={images} />} hasMore={historyHasMore} loading={historyLoadingOlder} loadOlder={() => void loadOlderHistory()} renderItem={item => <ChatItemView item={item} compact={false} busyAction={busy} onApproval={respondApproval} onQuestion={respondQuestion} />} /> : <>
        <FlatList
          ref={listRef}
          key={session.sessionId}
          style={[styles.list, readableColumn]}
          contentContainerStyle={[styles.listContent, { paddingTop: headerHeight + spacing.xl }, visibleMessages.length === 0 ? styles.emptyList : styles.shortConversation]}
          data={visibleSections}
          keyExtractor={item => item.key}
          renderItem={renderChatItem}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          updateCellsBatchingPeriod={16}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onLayout={onListLayout}
          onContentSizeChange={onListContentSizeChange}
          onScroll={onListScroll}
          onViewableItemsChanged={viewability}
          onScrollToIndexFailed={info => {
            listRef.current?.scrollToOffset({offset: Math.max(0, info.averageItemLength * info.index), animated: false})
          }}
          maintainVisibleContentPosition={{minIndexForVisible: 0}}
          scrollEventThrottle={16}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onListDragEnd}
          onMomentumScrollBegin={onMomentumScrollBegin}
          onMomentumScrollEnd={onListMomentumEnd}
          ListEmptyComponent={busy === `session:${session.sessionId}`
            ? <View style={{ padding: spacing.xl }}><ActivityIndicator size="large" color={colors.primary} /></View>
            : <WelcomeMessage />}
          ListHeaderComponent={historyHasMore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.older}
              disabled={historyLoadingOlder}
              onPress={() => void loadOlderHistory()}
              style={styles.olderButton}
            >
              {historyLoadingOlder
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={styles.olderText}>{strings.chat.older}</Text>}
            </Pressable>
          ) : undefined}
        />
        {/* Floats over the last row only while an older turn owns the viewport. */}
        {awayFromLatest && (
          <View pointerEvents="box-none" style={styles.latestTurnLayer}>
            <View pointerEvents="box-none" style={[readableColumn, styles.latestTurnColumn]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={newContent ? strings.comfort.newContent : strings.chat.jumpToLatest}
                onPress={jumpToLatest}
                hitSlop={6}
                style={({ pressed }) => [styles.latestTurnButton, pressed && styles.latestTurnButtonPressed]}
              >
                <ArrowDown size={20} color={colors.primary} strokeWidth={2.4} />
              </Pressable>
            </View>
          </View>
        )}
      </>}</ChatErrorBoundary>}</BlurHeaderFrame>


      {mentionType !== null && (
        <Pressable
          style={styles.mentionBackdrop}
          onPress={() => { closeMention(); Keyboard.dismiss() }}
          accessibilityRole="button"
          accessibilityLabel={strings.common.close}
        />
      )}
      <View style={styles.composerWrap}>
        <View style={[styles.composerInner, readableColumn]}>
        {connected && (session.backend === undefined || session.backend === 'harness') && <SessionActivityDock key={`${memoryKey}:${chatImageConnectionGeneration()}`} session={session} />}
        {queueItems.length > 0 && <QueueDock items={queueItems} />}

        {images.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.imageTray}>
            {images.map((image, index) => (
              <View key={`${image.uri}:${index}`} style={styles.imagePreviewWrap}>
                <Image source={{ uri: image.uri }} style={styles.imagePreview} resizeMode="cover" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.chat.removeImage(image.name ?? `${index + 1}`)}
                  onPress={() => setImages(current => current.filter((_, imageIndex) => imageIndex !== index))}
                  style={styles.removeImageButton}
                >
                  <X size={13} color={colors.white} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        {stagedFiles.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.fileTray}>
            {stagedFiles.map((file, index) => (
              <View key={`${file.id}:${index}`} style={styles.fileCard}>
                <FileText size={16} color={colors.primary} />
                <View style={styles.fileCardMeta}>
                  <Text style={styles.fileCardName} numberOfLines={1}>{file.name}</Text>
                  <Text style={styles.fileCardSize}>{formatFileBytes(file.size)}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={file.name ? `移除文件“${file.name}”` : '移除文件'}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  onPress={() => setStagedFiles(current => current.filter((_, fileIndex) => fileIndex !== index))}
                  style={styles.removeFileButton}
                >
                  <X size={13} color={colors.muted} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        <ChatComposer
          backend={session.backend} draft={draft} input={mentionInput}
          quotes={quotes} onRemoveQuote={index => setQuotes(current => current.filter((_, i) => i !== index))}
          replyActive={replyActive} stopping={stopping} compactRunning={compactRunning}
          hasComposerContent={hasComposerContent} connected={connected}
          composerDisabled={composerDisabled} sendDisabled={sendDisabled}
          compactComposer={compactComposer} composerInputMaxHeight={composerInputMaxHeight}
          model={{ available: sessionModels !== undefined, label: currentModelLabel, selecting: modelSelecting, onOpen: () => setModelPickerOpen(true) }}
          promptsPickerOpen={promptsPickerOpen} onExpand={() => setComposingDuringRun(true)}
          onOpenActions={openPlusMenu} onOpenPrompts={openPromptsPicker}
          onSubmit={() => void submit()} onStop={() => void stopSession()}
        />
        </View>
      </View>
        </View>
      </View>

      <ChatActionMenu
        visible={plusMenuOpen} onClose={closePlusMenu}
        canAttachImages={canAttachImages} attachmentPicking={attachmentPicking}
        takePhoto={takePhoto} pickImages={pickImages} pickFiles={pickFiles}
        onQuoteClipboard={() => {
          void Clipboard.getStringAsync().then(text => {
            if (text && text.trim().length > 0) {
              setQuotes(current => [...current, text.trim()])
              composerInputRef.current?.focus()
            }
          }).catch(() => {})
        }}
        workspaceLabel={workspaceLabel} modeLabel={modeLabel}
        supportsModeSelection={supportsModeSelection} agentPresetSelecting={agentPresetSelecting}
        toolsAvailable={connected && session.backend !== 'claude' && session.backend !== 'hermes'}
        permissionsAvailable={permissions !== undefined} permissionSelecting={permissionSelecting}
        permissionDisabled={permissionSelecting || (replyActive && !hasComposerContent)}
        permissionLabel={permissions === undefined ? undefined : permissionDisplayName(permissions.currentValue, currentPermission?.name)}
        onOpenWorkspace={() => setWorkspacePickerOpen(true)} onOpenMode={() => setModePickerOpen(true)}
        onOpenTools={() => setToolPickerOpen(true)} onOpenPermissions={() => setPermissionPickerOpen(true)}
      />

      <ModelPicker
        visible={modelPickerOpen}
        models={sessionModels}
        onClose={() => setModelPickerOpen(false)}
        onPick={pickModel}
      />
      {toolsMode !== undefined && connected && (
        <SessionToolsPanel
          key={`${session.sessionId}:${toolsMode}:${fileLinkPath ?? ''}`}
          mode={toolsMode}
          sessionId={session.sessionId}
          initialFile={toolsMode === 'files' ? fileLinkPath : undefined}
          onClose={() => { setToolsMode(undefined); setFileLinkPath(undefined) }}
        />
      )}
      <PermissionPicker loading={permissionLoading} error={permissionError} onRetry={() => setPermissionRevision(v => v + 1)} visible={permissionPickerOpen} permissions={permissions} onClose={() => setPermissionPickerOpen(false)} onPick={pickPermission} />
      <ModePicker visible={modePickerOpen} options={agentPresetOptions} current={currentAgentPresetId} loading={agentPresetLoading} selecting={agentPresetSelecting} onClose={() => setModePickerOpen(false)} onPick={pickMode} />
      <ChildAgentPanel visible={subagentsOpen} sessions={childSessions} onClose={() => setSubagentsOpen(false)}
        onOpen={session => { setSubagentsOpen(false); void openSession(session) }} />
      <TeamAgentPanel visible={teamOpen} members={teamState?.members ?? []} tasks={teamState?.tasks ?? []}
        sessions={sessions} onClose={() => setTeamOpen(false)}
        onOpen={session => { setTeamOpen(false); void openSession(session) }} />
      {sessionInfoOpen && <SessionInfo
        key={`${hostId}:${session.sessionId}`}
        session={session}
        workspace={currentWorkspace}
        onClose={() => setSessionInfoOpen(false)}
        onOpenWorkspace={() => {
          setSessionInfoOpen(false)
          if (onOpenWorkspaces !== undefined) onOpenWorkspaces(currentWorkspace === undefined ? undefined : workspaceStableKey(currentWorkspace, hostPlatform))
          else onBack()
        }}
      />}
      {sessionsOpen && !tabletSplit && <HostSessionsDrawer
        onOpenWorkspaces={() => {
          Keyboard.dismiss()
          setSessionsOpen(false)
          if (onOpenWorkspaces) onOpenWorkspaces()
          else onBack()
        }}
        onBack={() => {
          Keyboard.dismiss()
          setSessionsOpen(false)
          onOpenDevices()
        }}
        onClose={() => setSessionsOpen(false)}
        onOpenAutomationTasks={() => {
          setSessionsOpen(false)
          setAutomationTasksOpen(true)
        }}
        onOpenPlugins={pluginsAvailable ? () => {
          setSessionsOpen(false)
          setPluginsOpen(true)
        } : undefined}
        onSelect={async next => {
          const pending = openSession(next)
          const visible = useAppStore.getState().selectedSession?.sessionId === next.sessionId
          if (visible) {
            setSessionsOpen(false)
          }
          if (await pending && !visible) {
            setSessionsOpen(false)
          }
        }}
      />}
      <WorkspacePicker visible={workspacePickerOpen} workspaces={workspaces} currentSessionId={session.sessionId} sessionBackend={session.backend} busy={busy} onClose={() => setWorkspacePickerOpen(false)} onPick={pickWorkspace} onManage={onOpenWorkspaces} />
      <ToolAccessPicker visible={toolPickerOpen} onClose={() => setToolPickerOpen(false)} onPick={pickToolMode} />
      <PromptsPicker
        visible={promptsPickerOpen}
        prompts={customPrompts ?? BUILT_IN_PROMPTS}
        onClose={() => setPromptsPickerOpen(false)}
        onPick={prompt => void sendPrompt(prompt)}
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
          Alert.alert(strings.chat.toolPromptDeleteTitle(prompt.title), strings.chat.toolPromptDeleteBody, [
            { text: strings.common.cancel, style: 'cancel' },
            { text: strings.common.delete, style: 'destructive', onPress: () => void deletePrompt(prompt) },
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
      <Modal
        visible={previewImageUri !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImageUri(undefined)}
        statusBarTranslucent
      >
        <View style={styles.lightboxBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewImageUri(undefined)} />
          {previewImageUri !== undefined && (
            <Image
              source={{ uri: previewImageUri }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          )}
          <Pressable
            style={styles.lightboxClose}
            onPress={() => setPreviewImageUri(undefined)}
            accessibilityRole="button"
            accessibilityLabel={strings.common.close}
            hitSlop={12}
          >
            <X size={24} color="#ffffff" />
          </Pressable>
        </View>
      </Modal>
      <PluginsModal visible={pluginsOpen} onClose={() => setPluginsOpen(false)} />
      <AutomationTasksModal
        visible={automationTasksOpen}
        onClose={() => setAutomationTasksOpen(false)}
        onOpenSession={async targetSession => {
          setAutomationTasksOpen(false)
          await openSession(targetSession)
        }}
        onNewTask={async () => {
          setAutomationTasksOpen(false)
          await createSession(currentWorkspace?.workspaceId)
        }}
      />
    </KeyboardInset></MarkdownLinkProvider></ChatImageProvider>
  )
}

export { ModalSurface,usePickerListMaxHeight } from './chat/modal'
