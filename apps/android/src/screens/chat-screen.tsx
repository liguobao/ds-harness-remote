import { SessionActivityDock } from './chat/session-activity'
import { ChatImageProvider } from '../ui/chat-image'
import { isSubagentSession } from '../lib/session-kind'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { AnimatedEllipsis } from '../ui/animated-ellipsis'
import { ArrowDown, ArrowLeft, ArrowUp, Camera, ChevronDown, ChevronRight, CircleStop, FileText, Folder, Images, Layers, ListTree, Menu, MessageSquare, Plus, RefreshCw, ShieldAlert, Sparkles, Terminal, Users, X, Zap } from 'lucide-react-native'
import {
  type StagedFile,
  documentImageReadBudget,
  readDocumentImageBase64,
  formatUploadedFilesPrompt,
  formatFileBytes,
  isTextFile,
  isValidUtf8Text,
  MAX_SINGLE_FILE_BYTES,
  MAX_TOTAL_FILES_BYTES,
} from './chat-files'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  BackHandler,
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
  TextInput,
  View,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { shouldConfirmSwipeRightOpen, shouldStartSwipeRightToOpen } from '../lib/gesture-swipe-rules'
import Svg,{ Path } from 'react-native-svg'
import { strings as zhCN } from '../locales/i18n'
import { sessionPermissions } from '../services/session-permissions'
import type { SkillEntry } from '../services/session-tools'
import type { CustomPrompt } from '../services/storage'
import { BUILT_IN_PROMPTS, loadCustomPrompts, saveCustomPrompts } from '../services/storage'
import { hasVisibleMessageText } from '../state/event-reducer'
import type { ChatSection } from '../state/message-helpers'
import {
  chatSections,
  computeStreamingSignature,
  inboxQueuedItems,
  inboxRpcIds,
  LATEST_EDGE_PX,
  mergeReplyReasoning,
} from '../state/message-helpers'
import { chatImageConnectionGeneration, requireSessionTools, sessionChatImageLoader, useAppStore } from '../state/store'
import { placeUiArtifacts, projectUiArtifacts, type UiArtifact } from '../state/ui-artifacts'
import type {
  ChatItem,
  ModelCatalogModel,
  ModelProviderGroup,
  PermissionSelect,
  PromptImage,
  TeamMemberSnapshot,
  TeamTaskSnapshot,
  WorkspaceView,
} from '../types'
import { BlurHeaderFrame, IconButton, TopBar } from '../ui/components'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../ui/fish-logo'
import { KeyboardInset } from '../ui/keyboard-inset'
import { decodeSessionMentionUri, markdownFilePath, MarkdownLinkProvider, openSafeExternalUrl } from '../ui/markdown'
import type { MentionGroup, MentionItem, MentionType } from '../ui/mention-popover'
import {
  detectMention,
  fileMentionText,
  filterByQuery,
  maskPersonalPath,
  MentionPopover,
  sessionMentionText,
  splitDraftSegments,
} from '../ui/mention-popover'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { useResponsiveLayout } from '../ui/responsive'
import { spacing } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { promptImageFromAsset, promptImageFromBase64, sessionImageLimits, validatePromptImages } from './chat-images'
import { ChatTrajectory } from './chat-trajectory'
import { ChatErrorBoundary } from './chat-error-boundary'
import { ChildAgentPanel, TeamAgentPanel } from './chat/agents'
import {
  ChatImages,
  ChatItemView,
  ChatProcessGroup,
  isActiveChatItem,
  QueueDock,
  ReplyStatusDots,
  WelcomeMessage,
} from './chat/messages'
import { ModalSurface, usePickerListMaxHeight } from './chat/modal'
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
import { relativeTime, sessionTitle } from './chat/presentation'
import { createStyles } from './chat/styles'
import { useLiveSessionStatus } from './device-screens'
import { SessionInfo } from './chat/session-info'
import { workspaceStableKey } from '../lib/workspace-key'
import { HostSessionsDrawer } from './host-sessions-drawer'
import { AutomationTasksModal } from './automation-tasks-modal'
import { PluginsModal } from './plugins-modal'
import { resolveSessionDisplayTitle } from './session-title'
import { SessionToolsPanel } from './session-tools-panel'

import { browseScope, browseKey, useBrowseMemory, updateBrowseEntry } from '../services/browse-memory'
import { InlineQuotePreview, QuoteMarkIcon, QuotePreview, formatQuoteDraftSnippet, formatQuoteText } from '../ui/quote-preview'
const EMPTY_QUOTES: string[] = []
const EMPTY_IMAGES: PromptImage[] = []
const EMPTY_CHAT_ITEMS: ChatItem[] = []
const EMPTY_UI_ARTIFACTS: UiArtifact[] = []
const EMPTY_UI_BY_SECTION = new Map<string, { cards: UiArtifact[]; pointers: UiArtifact[] }>()
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
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]
    const right = b[index]
    if (left === right) continue
    if (left === undefined || right === undefined) return false
    if (left.uiId !== right.uiId || left.version !== right.version) return false
  }
  return true
}

/** Soft hint threshold; the composer accepts longer input instead of silently truncating. */
const LONG_DRAFT_HINT = 12_000

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
  const retrySendMessage = useAppStore(state => state.retrySendMessage)
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
  const draftSegments = useMemo(() => splitDraftSegments(draft), [draft])
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
  const lastQuoteCountRef = useRef(quotes.length)
  useEffect(() => {
    if (quotes.length > lastQuoteCountRef.current) {
      composerInputRef.current?.focus()
    }
    lastQuoteCountRef.current = quotes.length
  }, [quotes.length])
  const [pickingImages, setPickingImages] = useState(false)
  const [pickingFiles, setPickingFiles] = useState(false)
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
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [modePickerOpen, setModePickerOpen] = useState(false)
  const [permissionPickerOpen, setPermissionPickerOpen] = useState(false)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [toolPickerOpen, setToolPickerOpen] = useState(false)
  const [toolsMode, setToolsMode] = useState<'files' | 'terminal'>()
  const [fileLinkPath, setFileLinkPath] = useState<string>()
  const [promptsPickerOpen, setPromptsPickerOpen] = useState(false)
  const [customPrompts, setCustomPrompts] = useState<readonly CustomPrompt[]>()
  const [promptEditing, setPromptEditing] = useState<CustomPrompt | 'new' | null>(null)
  const [promptsManagerOpen, setPromptsManagerOpen] = useState(false)
  const [promptsLoading, setPromptsLoading] = useState(false)
  const promptsLoadingRef = useRef(false)
  const promptMutatedRef = useRef(false)
  // `/` command and `@` reference popover state anchored to the composer cursor.
  const [mentionType, setMentionType] = useState<MentionType | null>(null)
  const [mentionQuery, setMentionQuery] = useState('')
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const composerInputRef = useRef<TextInput>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const selectionRef = useRef({ start: 0, end: 0 })
  /** Start index of the active `/` / `@` trigger inside the draft. */
  const mentionSpanRef = useRef(0)
  const [skillCatalog, setSkillCatalog] = useState<SkillEntry[]>()
  const [skillCatalogFailed, setSkillCatalogFailed] = useState(false)
  const [workspaceFileRefs, setWorkspaceFileRefs] = useState<WorkspaceFileRef[]>()
  const [fileListFailed, setFileListFailed] = useState(false)
  const skillRequestedRef = useRef<string | undefined>(undefined)
  const filesRequestedRef = useRef<string | undefined>(undefined)
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
      .catch(() => { if (!controller.signal.aborted) setPermissionError(zhCN.tools.permissionUnavailable) })
      .finally(() => { if (!controller.signal.aborted) setPermissionLoading(false) })
    return () => controller.abort()
  }, [session?.sessionId, session?.backend, inlinePermissionOptions, connection.phase, permissionPickerOpen, permissionRevision])
  useEffect(() => { setToolsMode(undefined) }, [session?.sessionId, connection.phase])
  // Composer quick prompts: load built-ins and saved entries once per connection.
  useEffect(() => {
    if (connection.phase !== 'connected') return
    if (customPrompts !== undefined || promptsLoadingRef.current) return
    promptsLoadingRef.current = true
    setPromptsLoading(true)
    let cancelled = false
    void loadCustomPrompts()
      .then(items => {
        if (cancelled || promptMutatedRef.current) return
        setCustomPrompts(items)
      })
      .finally(() => {
        promptsLoadingRef.current = false
        if (!cancelled) setPromptsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connection.phase, customPrompts])
  // The mode (agent-preset) roster is deployment-level; fetch it once per connection.
  useEffect(() => {
    if (connection.phase !== 'connected' || session?.backend === 'codex') return
    if (useAppStore.getState().agentPresetOptions !== undefined) return
    void loadAgentPresets()
  }, [connection.phase, session?.sessionId, session?.backend, loadAgentPresets])
  // `/` 技能目录与 `@` 文件树按会话懒加载一次；未拉取成功时技能分组回落到内置技能。
  useEffect(() => {
    setSkillCatalog(undefined)
    setSkillCatalogFailed(false)
    setWorkspaceFileRefs(undefined)
    setFileListFailed(false)
    skillRequestedRef.current = undefined
    filesRequestedRef.current = undefined
    setMentionType(null)
  }, [session?.sessionId])
  useEffect(() => {
    const sessionId = session?.sessionId
    if (mentionType === null || sessionId === undefined) return
    if (session?.backend === 'codex' || session?.backend === 'claude' || session?.backend === 'hermes' || connection.phase !== 'connected') return
    if (mentionType === 'command' && skillCatalog === undefined && skillRequestedRef.current !== sessionId) {
      skillRequestedRef.current = sessionId
      void Promise.resolve().then(() => requireSessionTools().listSkills(sessionId))
        .then(rows => { if (skillRequestedRef.current === sessionId) setSkillCatalog(rows) })
        .catch(() => { if (skillRequestedRef.current === sessionId) setSkillCatalogFailed(true) })
    }
    if (mentionType === 'context' && workspaceFileRefs === undefined && filesRequestedRef.current !== sessionId) {
      filesRequestedRef.current = sessionId
      void loadWorkspaceFileRefs(sessionId)
        .then(rows => { if (filesRequestedRef.current === sessionId) setWorkspaceFileRefs(rows) })
        .catch(() => { if (filesRequestedRef.current === sessionId) setFileListFailed(true) })
    }
  }, [mentionType, session?.sessionId, session?.backend, connection.phase, skillCatalog, workspaceFileRefs])
  const [reconnectingSession, setReconnectingSession] = useState(false)
  const [newSessionPending, setNewSessionPending] = useState(false)
  const runStartTimeRef = useRef<number | undefined>(undefined)
  const creatingSessionRef = useRef(false)
  const lastNewSessionTimeRef = useRef(0)
  const listRef = useRef<FlatList<ChatSection>>(null)
  const lastAutoScrollAt = useRef(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const listViewportRef = useRef({ width: 0, height: 0 })
  const listContentRef = useRef({ width: 0, height: 0 })
  const userScrollingRef = useRef(false)
  const hasTrailingScrollRef = useRef(false)
  const pendingScrollStreakRef = useRef(0)
  const scrollIntentGenerationRef = useRef(0)
  /** Keep the viewport on the latest turn until the user scrolls away. */
  const pinToBottomRef = useRef(true)
  /** Re-pin while the first session layout (markdown / images) is still settling. */
  const initialPinRef = useRef(true)
  const [newContent, setNewContent] = useState(false)
  const visibleAnchor = useRef<string | undefined>(undefined)
  const laidOutSessionRef = useRef<string | undefined>(undefined)
  const restoringPosition = useRef(false)
  const savedPosition = useRef(useBrowseMemory.getState().entries[memoryKey]?.position)
  const lastPositionSave = useRef(0)
  const lastContentVersion = useMemo(() => visibleMessageVersion(messages), [messages])
  const contentBefore = useRef<{key: string; version?: string}>({key: memoryKey})
  const viewability = useRef(({viewableItems}: {viewableItems: Array<{key: string}>}) => {
    visibleAnchor.current = viewableItems[0]?.key
  }).current
  /** Last reported scroll offset; content and viewport changes re-check the latest turn from it. */
  const listOffsetRef = useRef(0)
  /** Mirrors the floating jump button so scroll events only re-render on a crossing. */
  const awayFromLatestRef = useRef(false)
  const [awayFromLatest, setAwayFromLatest] = useState(false)
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
  const sessionId = session?.sessionId
  const panelOpen = plusMenuOpen || modelPickerOpen || modePickerOpen || permissionPickerOpen
    || workspacePickerOpen || toolPickerOpen || toolsMode !== undefined || trajectory || mentionType !== null
    || promptsPickerOpen || promptsManagerOpen || promptEditing !== null || subagentsOpen || teamOpen || sessionInfoOpen
  const autoScrollAllowedRef = useRef(false)
  autoScrollAllowedRef.current = !panelOpen && !historyLoadingOlder && sessionId !== undefined && visibleMessages.length > 0

  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  // Landscape phones are short: keep the composer compact when the IME is up
  // and let the list use a readable centred column on wide windows.
  const { landscape, compactHeight, height, width, contentMaxWidth } = useResponsiveLayout()
  const plusMenuListMaxHeight = usePickerListMaxHeight()
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
            Keyboard.dismiss()
            setMentionType(null)
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
            setSessionsOpen(true)
          }
        },
      }),
    [sessionsOpen, tabletSplit, trajectory]
  )

  const cancelPendingScroll = useCallback(() => {
    hasTrailingScrollRef.current = false
    pendingScrollStreakRef.current = 0
    if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current)
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    scrollTimerRef.current = null
    scrollFrameRef.current = null
  }, [])

  // Follow measured content and viewport changes (including the keyboard).
  // Keep a trailing command so the last streaming measurement is never lost,
  // while coalescing high-frequency deltas (~30 Hz) with no React state updates.
  const scheduleScrollToBottom = useCallback(() => {
    if (!pinToBottomRef.current && !initialPinRef.current) return
    if (userScrollingRef.current) return

    if (scrollTimerRef.current !== null || scrollFrameRef.current !== null) {
      hasTrailingScrollRef.current = true
      return
    }

    const runScroll = () => {
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        if (!autoScrollAllowedRef.current || userScrollingRef.current
          || (!pinToBottomRef.current && !initialPinRef.current)) {
          hasTrailingScrollRef.current = false
          pendingScrollStreakRef.current = 0
          return
        }
        lastAutoScrollAt.current = Date.now()
        // Nonanimated commands also keep native momentum callbacks reserved
        // for user flings, so they cannot disable following during a reply.
        listRef.current?.scrollToEnd({ animated: false })

        if (hasTrailingScrollRef.current && pendingScrollStreakRef.current < 2) {
          hasTrailingScrollRef.current = false
          pendingScrollStreakRef.current += 1
          scheduleScrollToBottom()
        } else {
          hasTrailingScrollRef.current = false
          pendingScrollStreakRef.current = 0
        }
      })
    }

    const elapsed = Date.now() - lastAutoScrollAt.current
    const delay = Math.max(0, 33 - elapsed)
    if (delay === 0) {
      runScroll()
    } else {
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null
        runScroll()
      }, delay)
    }
  }, [])

  // Following the latest turn is suspended once the user scrolls away, so the
  // floating button is the only way back without a manual fling. It follows
  // measured metrics rather than a gesture, so an older history page loading
  // above, a window resize or a running reply also re-check it.
  const syncLatestTurnIndicator = useCallback((distanceFromEnd: number) => {
    const away = !pinToBottomRef.current && !initialPinRef.current && distanceFromEnd > LATEST_EDGE_PX
    if (awayFromLatestRef.current === away) return
    awayFromLatestRef.current = away
    setAwayFromLatest(away)
  }, [])

  // Re-enable follow mode before jumping, so a reply that streams in right
  // after the tap keeps appending at the end. The queued follow pass also
  // re-asserts the end once the rows below finish re-measuring, which a single
  // scroll command cannot guarantee on a virtualized list.
  const jumpToLatest = useCallback(() => {
    scrollIntentGenerationRef.current++
    cancelPendingScroll()
    userScrollingRef.current = false
    pinToBottomRef.current = true
    initialPinRef.current = true
    awayFromLatestRef.current = false
    setAwayFromLatest(false)
    setNewContent(false)
    restoringPosition.current = false
    if (session !== undefined) {
      updateBrowseEntry(memoryScope, session.sessionId, {
        position: { offset: 0, atBottom: true }, seenAt: session.updatedAt,
      })
    }
    listRef.current?.scrollToEnd({ animated: false })
    scheduleScrollToBottom()
  }, [cancelPendingScroll, scheduleScrollToBottom, memoryScope, session?.sessionId, session?.updatedAt])

  // Restore reading position before the new list can emit scroll events.
  useLayoutEffect(() => {
    scrollIntentGenerationRef.current++
    cancelPendingScroll()
    setTrajectory(false)
    savedPosition.current = useBrowseMemory.getState().entries[memoryKey]?.position
    const bottom = savedPosition.current?.atBottom !== false
    pinToBottomRef.current = bottom
    initialPinRef.current = bottom
    restoringPosition.current = !bottom
    setNewContent(false)
    laidOutSessionRef.current = undefined
    userScrollingRef.current = false
    listViewportRef.current = { width: 0, height: 0 }
    listContentRef.current = { width: 0, height: 0 }
    listOffsetRef.current = 0
    awayFromLatestRef.current = !bottom
    setAwayFromLatest(!bottom)
  }, [memoryKey, cancelPendingScroll])

  useEffect(() => cancelPendingScroll, [cancelPendingScroll])

  // A sheet or picker owns the user's next touch. Cancel a queued list jump
  // as soon as it opens so a streaming update cannot move the responder under
  // the panel.
  useEffect(() => {
    if (panelOpen) cancelPendingScroll()
  }, [panelOpen, cancelPendingScroll])

  // Let the first layout frame finish before jumping to the end. This keeps
  // the top bar and Android back dispatch responsive while a large history
  // page is being mounted, without relying on the deprecated InteractionManager.
  useEffect(() => {
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    const timer = setTimeout(() => {
      if (pinToBottomRef.current || initialPinRef.current) scheduleScrollToBottom()
    }, 32)
    return () => clearTimeout(timer)
  }, [historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId, visibleMessages.length])

  // Loading older history prepends above the viewport — do not yank to the end.
  useEffect(() => {
    if (!historyLoadingOlder) return
    pinToBottomRef.current = false
    initialPinRef.current = false
  }, [historyLoadingOlder])

  // Streaming deltas keep the same item id, but update text length / reasoning.
  // Compute a cheap signature of the last item so streaming increments trigger auto-scroll.
  const streamingSignature = useMemo(() => computeStreamingSignature(visibleMessages), [visibleMessages])

  // Scroll when a brand-new item is appended or the last message receives streaming tokens.
  useEffect(() => {
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    scheduleScrollToBottom()
  }, [streamingSignature, visibleMessages.length, historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId])

  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const previous = listViewportRef.current
    if (previous.width === width && previous.height === height) return
    listViewportRef.current = { width, height }
    // The viewport can change while the content stays put (keyboard, rotation,
    // tablet split), which is exactly when the newest turn may leave the screen.
    syncLatestTurnIndicator(listContentRef.current.height - height - listOffsetRef.current)
    if (!autoScrollAllowedRef.current || (!pinToBottomRef.current && !initialPinRef.current)) return
    scheduleScrollToBottom()
  }, [scheduleScrollToBottom, syncLatestTurnIndicator])

  const onListContentSizeChange = useCallback((width: number, height: number) => {
    const previous = listContentRef.current
    if (previous.width === width && previous.height === height) return
    listContentRef.current = { width, height }
    syncLatestTurnIndicator(height - listViewportRef.current.height - listOffsetRef.current)
    if (!autoScrollAllowedRef.current || (!pinToBottomRef.current && !initialPinRef.current)) return
    scheduleScrollToBottom()
  }, [scheduleScrollToBottom, syncLatestTurnIndicator])

  const restoreReadingPosition = useCallback(() => {
    // A session switch can render the list before its viewport and markdown
    // rows have measured. Defer one extra frame so the initial jump reaches
    // the actual end rather than the pre-layout content height.
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (laidOutSessionRef.current === sessionId) return
    const position = savedPosition.current
    const anchorIndex = visibleSections.findIndex(item => item.key === position?.key)
    if (position?.atBottom === false && anchorIndex < 0 && busy?.startsWith('session:')) return
    laidOutSessionRef.current = sessionId
    if (position?.atBottom === false) {
      requestAnimationFrame(() => {
        if (anchorIndex >= 0) listRef.current?.scrollToIndex({index: anchorIndex, animated: false, viewPosition: 0})
        else listRef.current?.scrollToOffset({offset: position.key === undefined ? position.offset : 0, animated: false})
        restoringPosition.current = false
      })
    } else scheduleScrollToBottom()
  }, [historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId, visibleMessages.length, visibleSections, busy])
  useEffect(() => {restoreReadingPosition()}, [restoreReadingPosition])

  const onListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    listOffsetRef.current = contentOffset.y
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y
    // Content growth and IME resizing can also emit scroll events. Only a
    // user's drag/fling changes the intent to follow the latest response.
    if (restoringPosition.current) {
      syncLatestTurnIndicator(distanceFromEnd)
      return
    }
    const atBottom = distanceFromEnd <= LATEST_EDGE_PX
    if (userScrollingRef.current) {
      if (distanceFromEnd > LATEST_EDGE_PX) {
        pinToBottomRef.current = false
        initialPinRef.current = false
      } else {
        pinToBottomRef.current = true
      }
    } else if (atBottom) {
      pinToBottomRef.current = true
      initialPinRef.current = false
    }
    syncLatestTurnIndicator(distanceFromEnd)
    if (atBottom) setNewContent(false)
    if (session !== undefined && (Date.now() - lastPositionSave.current > 200 || atBottom)) {
      lastPositionSave.current = Date.now()
      updateBrowseEntry(memoryScope, session.sessionId, {position: {key: visibleAnchor.current, offset: contentOffset.y, atBottom},
        ...(atBottom ? {seenAt: session.updatedAt} : {})})
    }
  }, [memoryScope, session?.sessionId, session?.updatedAt, syncLatestTurnIndicator])
  useEffect(() => {
    if (contentBefore.current.key === memoryKey && contentBefore.current.version !== undefined
      && contentBefore.current.version !== lastContentVersion && !pinToBottomRef.current) setNewContent(true)
    contentBefore.current = {key: memoryKey, version: lastContentVersion}
  }, [lastContentVersion, memoryKey])

  const onListDragEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onListScroll(event)
    const velocityY = Math.abs(event.nativeEvent.velocity?.y ?? 0)
    if (velocityY <= 0.05) {
      userScrollingRef.current = false
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y
      if (distanceFromEnd <= LATEST_EDGE_PX) {
        pinToBottomRef.current = true
        initialPinRef.current = false
        scheduleScrollToBottom()
      }
    }
  }, [onListScroll, scheduleScrollToBottom])

  const onListMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onListScroll(event)
    userScrollingRef.current = false
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y
    if (distanceFromEnd <= LATEST_EDGE_PX) {
      pinToBottomRef.current = true
      initialPinRef.current = false
      scheduleScrollToBottom()
    }
  }, [onListScroll, scheduleScrollToBottom])

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
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (subagentsOpen) {
        setSubagentsOpen(false)
        return true
      }
      if (teamOpen) {
        setTeamOpen(false)
        return true
      }
      if (plusMenuOpen) {
        Keyboard.dismiss()
        setPlusMenuOpen(false)
        return true
      }
      if (modelPickerOpen) {
        setModelPickerOpen(false)
        return true
      }
      if (modePickerOpen) {
        setModePickerOpen(false)
        return true
      }
      if (permissionPickerOpen) {
        setPermissionPickerOpen(false)
        return true
      }
      if (workspacePickerOpen) {
        setWorkspacePickerOpen(false)
        return true
      }
      if (toolPickerOpen) {
        setToolPickerOpen(false)
        return true
      }
      if (promptEditing !== null) {
        setPromptEditing(null)
        setPromptsManagerOpen(true)
        return true
      }
      if (promptsManagerOpen) {
        setPromptsManagerOpen(false)
        setPromptsPickerOpen(true)
        return true
      }
      if (promptsPickerOpen) {
        setPromptsPickerOpen(false)
        return true
      }
      if (toolsMode !== undefined) {
        setToolsMode(undefined)
        setFileLinkPath(undefined)
        return true
      }
      if (trajectory) { setTrajectory(false); return true }
      // Dismiss the IME only while an input actually owns focus. A cached
      // "keyboard visible" flag (or Keyboard.isVisible(), fed by the same
      // events that Android can drop) once stale swallows every back press —
      // the "back does nothing" dead end. Focus state is authoritative.
      if (composerInputRef.current?.isFocused() === true) {
        Keyboard.dismiss()
        return true
      }
      Keyboard.dismiss()
      onBackRef.current()
      return true
    })
    return () => subscription.remove()
  }, [modePickerOpen, modelPickerOpen, permissionPickerOpen, plusMenuOpen, toolPickerOpen, toolsMode, workspacePickerOpen, trajectory, promptsPickerOpen, promptsManagerOpen, promptEditing])

  const skillItems: MentionItem[] = useMemo(() => (skillCatalog ?? []).map(row => ({
    id: `skill:${row.name}`,
    icon: OfficialMenuIcons.skill,
    title: row.name,
    description: row.modelInvocable ? row.description : `${zhCN.mention.skillUserOnly} · ${row.description}`,
    onPress: () => insertMentionText(`/${row.name} `),
  })), [skillCatalog])
  // 「@」菜单：对话 / 文件 两组，均支持模糊检索。
  const sessionItems: MentionItem[] = useMemo(() => sessions.filter(item => item.sessionId !== session?.sessionId && item.backend !== 'codex')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(item => {
      const title = resolveSessionDisplayTitle(item) ?? item.title ?? item.sessionId
      const owner = workspaces.find(workspace => workspace.sessionIds.includes(item.sessionId))
      return {
        id: item.sessionId,
        icon: OfficialMenuIcons.referenceSession,
        title,
        description: owner === undefined ? zhCN.chat.workspaceNone : `${owner.title} · ${maskPersonalPath(owner.path)}`,
        meta: relativeTime(item.updatedAt),
        onPress: () => insertMentionText(sessionMentionText(item.sessionId, title)),
      }
    }), [session?.sessionId, sessions, workspaces])
  const fileItems: MentionItem[] = useMemo(() => (workspaceFileRefs ?? []).map(ref => {
    const isDir = ref.kind === 'directory'
    const Icon = isDir ? OfficialMenuIcons.referenceFolder : OfficialMenuIcons.referenceFile
    return {
      id: ref.path,
      icon: Icon,
      title: ref.path,
      onPress: () => { const mention = fileMentionText(ref.path, isDir); if (mention !== undefined) insertMentionText(mention) },
    }
  }), [workspaceFileRefs])

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
  const activeRunStartTime = useMemo(() => {
    if (!replyActive) return undefined
    if (runStartTimeRef.current !== undefined) return runStartTimeRef.current
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const item = visibleMessages[i]
      if (item !== undefined && item.kind === 'message' && item.role === 'user') {
        return item.createdAt
      }
    }
    return undefined
  }, [replyActive, visibleMessages])

  useEffect(() => {
    if (!replyActive) {
      runStartTimeRef.current = undefined
    }
  }, [replyActive])

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
      Alert.alert(zhCN.chat.draftTooLongTitle, zhCN.chat.draftTooLong(LONG_DRAFT_MAX))
      return
    }
    applyDraft('')
    setQuotes([])
    setImages([])
    setStagedFiles([])
    setMentionType(null)
    selectionRef.current = { start: 0, end: 0 }
    setSelection({ start: 0, end: 0 })
    const targetSessionId = session.sessionId
    const sendSessionGen = sessionGenerationRef.current
    const sendGeneration = ++scrollIntentGenerationRef.current
    const previousPin = pinToBottomRef.current
    const previousInitialPin = initialPinRef.current
    const previousAway = awayFromLatestRef.current
    pinToBottomRef.current = true
    initialPinRef.current = true
    pendingScrollStreakRef.current = 0
    awayFromLatestRef.current = false
    setAwayFromLatest(false)
    setNewContent(false)
    scheduleScrollToBottom()
    runStartTimeRef.current = Date.now()
    const outcome = await sendMessage(promptText, submittedImages)
    if (outcome === 'rejected') {
      if (session.sessionId === targetSessionId && scrollIntentGenerationRef.current === sendGeneration) {
        cancelPendingScroll()
        pinToBottomRef.current = previousPin
        initialPinRef.current = previousInitialPin
        awayFromLatestRef.current = previousAway
        setAwayFromLatest(previousAway)
        if (previousPin || previousInitialPin) {
          scheduleScrollToBottom()
        }
      }
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
      Alert.alert(zhCN.messageActions.failed, useAppStore.getState().error ?? zhCN.messageActions.unavailable)
    } else if (outcome === 'sent') {
      const result = useAppStore.getState().commandResult
      if (result?.sessionId === session.sessionId && useAppStore.getState().selectedSession?.sessionId === session.sessionId) {
        Alert.alert(zhCN.mention.commandSection, result.text)
        useAppStore.setState({ commandResult: undefined })
      }
    }
    // 'kept': the row stays in the timeline with an inline failed/unconfirmed
    // state and a retry affordance — no Alert and no draft restore.
  }

  const pickImages = async () => {
    const limits = sessionImageLimits(session)
    const maxAllowed = limits?.maxImagesPerMessage ?? 4
    const remaining = Math.max(0, maxAllowed - images.length)
    if (remaining === 0) {
      Alert.alert(zhCN.chat.imageLimitTitle, zhCN.chat.tooManyImages(maxAllowed))
      return
    }
    setPickingImages(true)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        orderedSelection: true,
        allowsEditing: false,
        quality: 1,
        base64: true,
      })
      if (result.canceled) return
      const picked = result.assets.map(promptImageFromAsset)
      const next = [...images, ...picked]
      const problem = validatePromptImages(next, limits)
      if (problem !== undefined) {
        Alert.alert(zhCN.chat.imageLimitTitle, problem)
        return
      }
      setImages(next)
    } catch {
      Alert.alert(zhCN.chat.imagePickerFailedTitle, zhCN.chat.imagePickerFailedBody)
    } finally {
      setPickingImages(false)
    }
  }

  const takePhoto = async () => {
    const limits = sessionImageLimits(session)
    const maxAllowed = limits?.maxImagesPerMessage ?? 4
    const remaining = Math.max(0, maxAllowed - images.length)
    if (remaining === 0) {
      Alert.alert(zhCN.chat.imageLimitTitle, zhCN.chat.tooManyImages(maxAllowed))
      return
    }
    setPickingImages(true)
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        Alert.alert(zhCN.chat.cameraPermissionTitle, zhCN.chat.cameraPermissionBody)
        return
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        base64: true,
      })
      if (result.canceled) return
      const picked = result.assets.map(promptImageFromAsset)
      const next = [...images, ...picked]
      const problem = validatePromptImages(next, limits)
      if (problem !== undefined) {
        Alert.alert(zhCN.chat.imageLimitTitle, problem)
        return
      }
      setImages(next)
    } catch {
      Alert.alert(zhCN.chat.imagePickerFailedTitle, zhCN.chat.imagePickerFailedBody)
    } finally {
      setPickingImages(false)
    }
  }

  const canAttachImages = sessionImageLimits(session) !== undefined
    || session.backend === 'antigravity' || session.backend === 'cursor' || session.backend === 'codex'

  const pickFiles = async () => {
    const targetSessionId = session.sessionId
    const capturedGen = sessionGenerationRef.current
    setPickingFiles(true)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets) return

      if (sessionGenerationRef.current !== capturedGen || useAppStore.getState().selectedSession?.sessionId !== targetSessionId) return

      const newStagedFiles: StagedFile[] = []
      const newImages: PromptImage[] = []
      const limits = sessionImageLimits(session)
      const imageBudget = documentImageReadBudget(limits)
      const currentImages = useBrowseMemory.getState().entries[memoryKey]?.images ?? EMPTY_IMAGES
      let stagedImagesCount = currentImages.length
      let stagedImagesBytes = currentImages.reduce((acc, img) => acc + img.bytes, 0)
      let stagedTextBytes = stagedFiles.reduce((acc, f) => acc + f.size, 0)

      for (const asset of result.assets) {
        const name = asset.name ?? 'file'
        const ext = name.split(/[?#]/, 1)[0]?.split('.').at(-1)?.toLowerCase()
        const isImage = asset.mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext ?? '')

        if (isImage && !canAttachImages) {
          Alert.alert(zhCN.chat.imageLimitTitle, zhCN.chat.unsupportedImage(name))
          continue
        }

        const fileObj = new File(asset.uri)
        let realSize = 0
        try {
          const statSize = fileObj.size
          if (typeof statSize === 'number' && Number.isFinite(statSize) && statSize > 0) {
            realSize = statSize
          }
        } catch {
          realSize = 0
        }

        if (realSize <= 0) {
          Alert.alert(zhCN.chat.filePickerFailedTitle, `无法获取 ${name} 的真实磁盘大小。`)
          continue
        }

        if (isImage) {
          const maxAllowed = limits?.maxImagesPerMessage ?? 4
          if (stagedImagesCount >= maxAllowed) {
            Alert.alert(zhCN.chat.imageLimitTitle, zhCN.chat.tooManyImages(maxAllowed))
            continue
          }
          if (realSize > imageBudget.maxImageBytes) {
            Alert.alert(zhCN.chat.imageLimitTitle, zhCN.chat.imageTooLarge(name, formatFileBytes(imageBudget.maxImageBytes)))
            continue
          }
          if (stagedImagesBytes + realSize > imageBudget.maxMessageImageBytes) {
            Alert.alert(zhCN.chat.imageLimitTitle, zhCN.chat.imagesTooLarge(formatFileBytes(imageBudget.maxMessageImageBytes)))
            continue
          }
          try {
            const base64 = await readDocumentImageBase64(fileObj, stagedImagesBytes, limits)
            const imgDim = await imageSize(asset.uri)
            const image = promptImageFromBase64({
              uri: asset.uri,
              base64,
              ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
              name,
              width: imgDim.width,
              height: imgDim.height,
            })
            newImages.push(image)
            stagedImagesCount += 1
            stagedImagesBytes += image.bytes
          } catch {
            Alert.alert(zhCN.chat.imagePickerFailedTitle, zhCN.chat.imagePickerFailedBody)
          }
        } else if (isTextFile(name, asset.mimeType)) {
          if (realSize > MAX_SINGLE_FILE_BYTES) {
            Alert.alert(zhCN.chat.filePickerFailedTitle, `${name} 超过单文件大小上限 (${formatFileBytes(MAX_SINGLE_FILE_BYTES)})`)
            continue
          }
          if (stagedTextBytes + realSize > MAX_TOTAL_FILES_BYTES) {
            Alert.alert(zhCN.chat.filePickerFailedTitle, `本次选择的文件合计超过上限 (${formatFileBytes(MAX_TOTAL_FILES_BYTES)})，后续文件已停止读取。`)
            break
          }
          try {
            const textContent = await fileObj.text()
            if (!isValidUtf8Text(textContent)) {
              Alert.alert(zhCN.chat.filePickerFailedTitle, `“${name}” 包含非有效 UTF-8 字符或控制字符，已跳过。`)
              continue
            }
            newStagedFiles.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name,
              size: realSize,
              mimeType: asset.mimeType ?? 'text/plain',
              uri: asset.uri,
              content: textContent,
            })
            stagedTextBytes += realSize
          } catch {
            Alert.alert(zhCN.chat.filePickerFailedTitle, `无法读取 ${name}，请确保为有效的 UTF-8 文本文件。`)
          }
        } else {
          Alert.alert(zhCN.chat.filePickerFailedTitle, `暂不支持二进制文件 “${name}”，请选择代码或文本文件。`)
        }
      }

      if (sessionGenerationRef.current !== capturedGen || useAppStore.getState().selectedSession?.sessionId !== targetSessionId) return

      if (newImages.length > 0) {
        setImages(current => {
          const nextImages = [...current, ...newImages]
          const problem = validatePromptImages(nextImages, limits)
          if (problem !== undefined) {
            Alert.alert(zhCN.chat.imageLimitTitle, problem)
            return current
          }
          return nextImages
        })
      }

      if (newStagedFiles.length > 0) {
        setStagedFiles(current => {
          let currentBytes = current.reduce((acc, f) => acc + f.size, 0)
          const accepted: StagedFile[] = []
          let exceeded = false
          for (const file of newStagedFiles) {
            if (currentBytes + file.size <= MAX_TOTAL_FILES_BYTES) {
              currentBytes += file.size
              accepted.push(file)
            } else {
              exceeded = true
            }
          }
          if (exceeded) {
            Alert.alert(zhCN.chat.filePickerFailedTitle, `部分文件超过总附件上限 (${formatFileBytes(MAX_TOTAL_FILES_BYTES)})，未能添加。`)
          }
          return [...current, ...accepted]
        })
      }
    } catch {
      Alert.alert(zhCN.chat.filePickerFailedTitle, zhCN.chat.filePickerFailedBody)
    } finally {
      setPickingFiles(false)
    }
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

  const quoteChatMessage = useAppStore(state => state.quoteChatMessage)
  const reconnectCurrentSession = async () => {
    if (reconnectingSession) return
    setReconnectingSession(true)
    try {
      await reconnect()
    } finally {
      setReconnectingSession(false)
    }
  }

  useEffect(() => {
    // 1. Initial process text intent when opening the app from native selection toolbar
    const dshProcessText = NativeModules.DshProcessText
    if (dshProcessText?.getInitialText) {
      dshProcessText.getInitialText()
        .then((text: string | null) => {
          if (text && text.trim().length > 0) {
            quoteChatMessage(text.trim(), session.sessionId)
            composerInputRef.current?.focus()
          }
        })
        .catch(() => undefined)
    }

    // 2. Runtime process text event when selecting text while app is active
    const sub = DeviceEventEmitter.addListener('onProcessText', (text: string) => {
      if (text && text.trim().length > 0) {
        quoteChatMessage(text.trim(), session.sessionId)
        composerInputRef.current?.focus()
      }
    })

    return () => {
      sub.remove()
    }
  }, [session.sessionId, quoteChatMessage])

  const currentAgentPresetId = session.agentPreset ?? agentPresetOptions?.find(option => option.isDefault)?.id
  const currentWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(session.sessionId))
  const workspaceLabel = currentWorkspace?.title ?? zhCN.chat.workspaceNone
  const currentPresetRow = agentPresetOptions?.find(option => option.id === currentAgentPresetId)
  const modeLabel = currentAgentPresetId === undefined
    ? zhCN.chat.modeDefault
    : currentPresetRow === undefined
      ? builtinPresetName(currentAgentPresetId) ?? currentAgentPresetId
      : agentPresetName(currentPresetRow)

  const connectionRetrying = reconnectingSession || connection.phase === 'connecting' || connection.phase === 'reconnecting'
  const sendReady = connected && !busy?.startsWith('session:')
    && (session.backend !== 'codex' || codexReadySessionId === session.sessionId)
  const hasComposerContent = draft.trim().length > 0 || quotes.length > 0 || images.length > 0 || stagedFiles.length > 0
  const canStop = connected && (busy === 'send-message' || busy === 'stop-session' || session.running || hasActiveChatItem) && !hasComposerContent
  const compactRunning = canStop && !composingDuringRun
  const stopping = busy === 'stop-session'
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
        zhCN.chat.modeLockedTitle,
        session.blank ? zhCN.chat.modeSelectFailedBody : zhCN.chat.modeLockedBody,
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
        Alert.alert(zhCN.chat.newChatFailedTitle, zhCN.chat.newChatFailedBody)
      }
    } finally {
      creatingSessionRef.current = false
      setNewSessionPending(false)
    }
  }

  const sendPrompt = async (prompt: CustomPrompt) => {
    setPromptsPickerOpen(false)
    runStartTimeRef.current = Date.now()
    const outcome = await sendMessage(prompt.text)
    if (outcome === 'sent') AccessibilityInfo.announceForAccessibility(zhCN.chat.toolPromptSent(prompt.title))
    else if (outcome === 'rejected') Alert.alert(zhCN.chat.toolPromptSendFailed, zhCN.chat.toolPromptSendFailed)
  }

  const persistPrompts = async (next: readonly CustomPrompt[]): Promise<boolean> => {
    if (promptsLoading) return false
    promptMutatedRef.current = true
    const previous = customPrompts ?? BUILT_IN_PROMPTS
    setCustomPrompts(next)
    // Built-ins are re-seeded on every load, so a deleted one only stays gone
    // when its id is recorded; edited built-ins keep their id and are saved as
    // overrides inside `next`.
    const removed = BUILT_IN_PROMPTS
      .filter(item => !next.some(prompt => prompt.id === item.id))
      .map(item => item.id)
    try {
      await saveCustomPrompts(next, removed)
      return true
    } catch {
      setCustomPrompts(previous)
      Alert.alert(zhCN.chat.toolPromptSaveFailedTitle, zhCN.chat.toolPromptSaveFailedBody)
      return false
    }
  }

  const savePromptEdit = async (title: string, text: string) => {
    if (promptsLoading) return
    const editing = promptEditing
    const trimmedTitle = title.trim()
    const trimmedText = text.trim()
    if (trimmedTitle === '' || trimmedText === '') return
    const current = customPrompts ?? BUILT_IN_PROMPTS
    let ok = false
    if (editing === 'new') {
      ok = await persistPrompts([...current, { id: `prompt-${Date.now()}`, title: trimmedTitle, text: trimmedText }])
    } else if (editing !== null) {
      ok = await persistPrompts(current.map(item => item.id === editing.id ? { ...item, title: trimmedTitle, text: trimmedText } : item))
    }
    if (ok) {
      setPromptEditing(null)
      setPromptsManagerOpen(true)
    }
  }

  const deletePrompt = async (prompt: CustomPrompt) => {
    if (promptsLoading) return
    const current = customPrompts ?? BUILT_IN_PROMPTS
    await persistPrompts(current.filter(item => item.id !== prompt.id))
  }

  const moveSessionToWorkspace = async (workspace: WorkspaceView) => {
    const previousId = session.sessionId
    const opened = await createSession(workspace.workspaceId)
    if (!opened) {
      Alert.alert(zhCN.chat.moveFailedTitle, zhCN.chat.moveFailedBody)
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
      zhCN.chat.moveStartedTitle,
      zhCN.chat.moveStartedBody(workspace.title),
      [
        { text: zhCN.common.cancel, style: 'cancel' },
        { text: zhCN.chat.moveStartedConfirm, onPress: () => void moveSessionToWorkspace(workspace) },
      ],
    )
  }

  const pickPermission = (preset: string) => {
    setPermissionPickerOpen(false)
    const apply = () => void selectPermission(preset)
    if (preset === 'danger-full-access') {
      Alert.alert(
        session.backend === 'codex' ? zhCN.chat.codexFullAccessTitle : zhCN.chat.fullAccessTitle,
        session.backend === 'codex' ? zhCN.chat.codexFullAccessBody : zhCN.chat.fullAccessBody,
        [
          { text: zhCN.common.cancel, style: 'cancel' },
          { text: zhCN.chat.enable, style: 'destructive', onPress: apply },
        ],
      )
    } else apply()
  }

  const applyDraft = (next: string) => {
    draftRef.current = next
    setDraft(next)
  }

  const closeMention = () => setMentionType(null)

  const updateMention = (text: string, cursor: number) => {
    const detected = detectMention(text, cursor)
    if (detected === undefined) {
      setMentionType(null)
      return
    }
    mentionSpanRef.current = detected.start
    setMentionQuery(detected.query)
    setMentionType(detected.type)
  }

  /** Insert the picked command or reference text at the trigger span, keeping the caret behind it (web composer grammar). */
  const insertMentionText = (text: string) => {
    const start = mentionSpanRef.current
    const end = selectionRef.current.end
    const current = draftRef.current
    const next = current.slice(0, start) + text + current.slice(end)
    const cursor = start + text.length
    applyDraft(next)
    selectionRef.current = { start: cursor, end: cursor }
    setSelection({ start: cursor, end: cursor })
    setMentionType(null)
    composerInputRef.current?.focus()
  }

  const onChangeText = (next: string) => {
    if (next === draftRef.current) return
    // Keep the tracked caret in step with the edit so the controlled selection
    // never yanks the cursor; onSelectionChange refines it right afterwards.
    const delta = next.length - draftRef.current.length
    applyDraft(next)
    const cursor = Math.max(0, Math.min(next.length, selectionRef.current.end + delta))
    selectionRef.current = { start: cursor, end: cursor }
    setSelection({ start: cursor, end: cursor })
    updateMention(next, cursor)
  }

  const onSelectionChange = (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
    const next = event.nativeEvent.selection
    if (next.start === selectionRef.current.start && next.end === selectionRef.current.end) return
    selectionRef.current = next
    setSelection(next)
    if (next.start === next.end) updateMention(draftRef.current, next.end)
  }

  const runSessionExport = () => {
    setMentionType(null)
    const sessionId = session.sessionId
    void Promise.resolve().then(() => requireSessionTools().executeCommand(sessionId, '/export'))
      .then(result => {
        Alert.alert(zhCN.mention.exportTitle, result.text ?? (result.kind === 'success' ? zhCN.mention.exportTriggered : zhCN.mention.exportFailed))
      })
      .catch((error: unknown) => {
        Alert.alert(zhCN.mention.exportTitle, error instanceof Error && error.message.length > 0 ? error.message : zhCN.mention.exportFailed)
      })
  }

  // 「/」菜单：添加 / 指令 / 技能 三组，动作按 DeepSeek Harness Web 端绑定。
  const commandAddItems: MentionItem[] = [
    { id: 'file', icon: OfficialMenuIcons.file, title: zhCN.mention.file, description: zhCN.mention.fileDescription, onPress: () => insertMentionText('/file ') },
    { id: 'goal', icon: OfficialMenuIcons.goal, title: zhCN.mention.goal, description: zhCN.mention.goalDescription, onPress: () => insertMentionText('/goal ') },
    { id: 'plan', icon: OfficialMenuIcons.plan, title: zhCN.mention.plan, description: zhCN.mention.planDescription, onPress: () => insertMentionText('/plan ') },
    { id: 'feedback', icon: OfficialMenuIcons.feedback, title: zhCN.mention.feedback, description: zhCN.mention.feedbackDescription, onPress: () => insertMentionText('/feedback ') },
  ]
  const commandControlItems: MentionItem[] = [
    { id: 'compact', icon: OfficialMenuIcons.compact, title: zhCN.mention.compact, description: zhCN.mention.compactDescription, onPress: () => insertMentionText('/compact') },
    { id: 'permission', icon: OfficialMenuIcons.permission, title: zhCN.mention.permission, description: zhCN.mention.permissionDescription, onPress: () => { setMentionType(null); setPermissionPickerOpen(true) } },
    { id: 'model', icon: OfficialMenuIcons.model, title: zhCN.mention.model, description: zhCN.mention.modelDescription, onPress: () => { setMentionType(null); setModelPickerOpen(true) } },
    { id: 'export', icon: OfficialMenuIcons.export, title: zhCN.mention.export, description: zhCN.mention.exportDescription, onPress: runSessionExport },
  ]
  const mentionTexts = (item: MentionItem) => [item.title, item.description ?? '', item.meta ?? '']
  const mentionGroups: MentionGroup[] = mentionType === 'command'
    ? [
        { key: 'add', title: zhCN.mention.addSection, items: filterByQuery(commandAddItems, mentionQuery, mentionTexts).slice(0, 20) },
        { key: 'commands', title: zhCN.mention.commandSection, items: filterByQuery(commandControlItems, mentionQuery, mentionTexts).slice(0, 20) },
        {
          key: 'skills',
          title: zhCN.mention.skillSection,
          items: skillCatalog === undefined && skillCatalogFailed
            ? []
            : filterByQuery(skillItems, mentionQuery, mentionTexts).slice(0, 20),
        },
      ]
    : mentionType === 'context'
      ? [
          { key: 'sessions', title: zhCN.mention.sessionSection, items: filterByQuery(sessionItems, mentionQuery, mentionTexts).slice(0, 20) },
          {
            key: 'files',
            title: zhCN.mention.fileSection,
            items: fileListFailed ? [] : filterByQuery(fileItems, mentionQuery, mentionTexts).slice(0, 30),
          },
        ]
      : []
  const header = <>
      <TopBar
        title={sessionTitle(session)}
        onTitlePress={() => { Keyboard.dismiss(); setMentionType(null); setSessionInfoOpen(true) }}
        titleLines={1}
        onBack={tabletSplit ? undefined : trajectory ? handleBack : () => {
          Keyboard.dismiss()
          setMentionType(null)
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
          setSessionsOpen(true)
        }}
        backIcon={trajectory ? ArrowLeft : Menu}
        backLabel={trajectory ? zhCN.common.back : zhCN.chat.openHostSessions}
        action={<>
          <IconButton label={trajectory ? zhCN.trajectory.close : zhCN.trajectory.open}
            icon={trajectory ? MessageSquare : ListTree} dense tint={trajectory ? colors.primary : undefined}
            onPress={() => { Keyboard.dismiss(); setMentionType(null); setTrajectory(value => !value) }} />
          {childSessions.length > 0 && (
            <IconButton label={zhCN.chat.subagentsTitle(childSessions.length)}
              icon={Layers} dense tint={childSessions.some(item => item.running) ? colors.primary : undefined}
              onPress={() => { Keyboard.dismiss(); setMentionType(null); setSubagentsOpen(true) }} />
          )}
          {teamState !== undefined && teamState.members.length > 0 && (
            <IconButton label={zhCN.chat.teamTitle(teamState.members.length)}
              icon={Users} dense tint={teamState.members.some(item =>
                item.phase === 'active' && sessions.find(row => row.sessionId === item.id)?.running === true) ? colors.primary : undefined}
              onPress={() => { Keyboard.dismiss(); setMentionType(null); setTeamOpen(true) }} />
          )}
          <IconButton label={zhCN.chat.newChat} icon={OfficialMenuIcons.newChat} dense onPress={() => void startNewSession()} disabled={newSessionPending || busy !== undefined} />
          {!connected && <IconButton label={zhCN.chat.reconnect} icon={RefreshCw} dense onPress={() => void reconnectCurrentSession()} disabled={connectionRetrying} />}
        </>}
      />
      {!connected && (
        <View style={styles.connectionBanner} accessibilityRole="alert">
          <View style={styles.connectionDot} />
          <Text style={styles.connectionBannerText}>
            {connectionRetrying ? <>{zhCN.chat.reconnecting.replace(/…$/, '')}<AnimatedEllipsis /></> : zhCN.chat.offline}
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
              backLabel={zhCN.chat.backToWorkspaces}
              onClose={() => Keyboard.dismiss()}
              onSelect={async next => { await openSession(next) }}
              onNewSession={startNewSession}
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
          onScrollBeginDrag={() => {
            scrollIntentGenerationRef.current++
            cancelPendingScroll()
            userScrollingRef.current = true
            Keyboard.dismiss()
          }}
          onScrollEndDrag={onListDragEnd}
          onMomentumScrollBegin={() => {
            cancelPendingScroll()
            userScrollingRef.current = true
          }}
          onMomentumScrollEnd={onListMomentumEnd}
          ListEmptyComponent={busy === `session:${session.sessionId}`
            ? <View style={{ padding: spacing.xl }}><ActivityIndicator size="large" color={colors.primary} /></View>
            : <WelcomeMessage />}
          ListHeaderComponent={historyHasMore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={zhCN.chat.older}
              disabled={historyLoadingOlder}
              onPress={() => void loadOlderHistory()}
              style={styles.olderButton}
            >
              {historyLoadingOlder
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={styles.olderText}>{zhCN.chat.older}</Text>}
            </Pressable>
          ) : undefined}
        />
        {/* Floats over the last row only while an older turn owns the viewport. */}
        {awayFromLatest && (
          <View pointerEvents="box-none" style={styles.latestTurnLayer}>
            <View pointerEvents="box-none" style={[readableColumn, styles.latestTurnColumn]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={newContent ? zhCN.comfort.newContent : zhCN.chat.jumpToLatest}
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
          accessibilityLabel={zhCN.common.close}
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
                  accessibilityLabel={zhCN.chat.removeImage(image.name ?? `${index + 1}`)}
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
        {replyActive && (
          <View
            accessible
            accessibilityLabel={stopping ? zhCN.chat.stopping : session.backend === 'codex' ? zhCN.chat.codexGenerating : session.backend === 'cursor' ? zhCN.chat.cursorGenerating : session.backend === 'claude' ? zhCN.chat.claudeGenerating : session.backend === 'hermes' ? zhCN.chat.hermesGenerating : session.backend === 'opencode' ? zhCN.chat.opencodeGenerating : session.backend === 'pi' ? zhCN.chat.piGenerating : session.backend === 'antigravity' ? zhCN.chat.antigravityGenerating : zhCN.chat.generating}
            accessibilityLiveRegion="polite"
            style={styles.replyStatus}
          >
            <Svg width={18} height={18} viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`} accessible={false}><Path d={FISH_LOGO_PATH} fill={colors.accent} /></Svg>
            <Text style={styles.replyStatusText}>{stopping ? zhCN.chat.stopping : session.backend === 'codex' ? zhCN.chat.codexGenerating : session.backend === 'cursor' ? zhCN.chat.cursorGenerating : session.backend === 'claude' ? zhCN.chat.claudeGenerating : session.backend === 'hermes' ? zhCN.chat.hermesGenerating : session.backend === 'opencode' ? zhCN.chat.opencodeGenerating : session.backend === 'pi' ? zhCN.chat.piGenerating : session.backend === 'antigravity' ? zhCN.chat.antigravityGenerating : zhCN.chat.generating}</Text>
            {!stopping && <ReplyStatusDots />}
          </View>
        )}
        <View style={{ position: 'relative', zIndex: 20, elevation: 20 }}>
          {mentionType !== null && (
            <MentionPopover groups={mentionGroups} onDismiss={closeMention} emptyText={zhCN.mention.noMatches} />
          )}
        {compactRunning ? <View style={[styles.composerCard, styles.runningComposer]}>
          <Pressable accessibilityRole="button" accessibilityLabel={zhCN.chat.moreActions} onPress={openPlusMenu}
            style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed]}>
            <Plus size={22} color={colors.ink} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={zhCN.sessionActivity.composeRunning}
            onPress={() => setComposingDuringRun(true)} style={styles.runningComposerPrompt}>
            <Text style={styles.runningComposerText} numberOfLines={1}>{zhCN.sessionActivity.composeRunning}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={zhCN.chat.stop} disabled={stopping}
            accessibilityState={{ disabled: stopping, busy: stopping }} onPress={() => void stopSession()}
            style={({ pressed }) => [styles.stopButton, pressed && !stopping && styles.stopPressed]}>
            {stopping ? <ActivityIndicator size="small" color={colors.onInverse} /> : <CircleStop size={20} color={colors.onInverse} />}
          </Pressable>
        </View> : <View style={styles.composerCard}>
          <View style={styles.composerInputWrap}>
            {quotes.map((quoteText: string, index: number) => (
              <Pressable
                key={`inline-quote-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`${zhCN.chat.removeQuote}: ${quoteText}`}
                onPress={() => setQuotes(current => current.filter((_, i) => i !== index))}
                style={styles.composerInlineQuoteBadge}
              >
                <QuoteMarkIcon size={14} color={colors.primary} />
                <Text numberOfLines={1} style={[styles.composerInlineQuoteText, { color: colors.primary, maxWidth: 180 }]}>
                  “{formatQuoteDraftSnippet(quoteText, 14)}”
                </Text>
              </Pressable>
            ))}
            {/* Native attributed text keeps references blue without an opaque Android value layer. */}
            <TextInput
              ref={composerInputRef}
              accessibilityLabel={session.backend === 'codex'
                ? zhCN.chat.codexMessageLabel
                : session.backend === 'cursor'
                  ? zhCN.chat.cursorMessageLabel
                  : session.backend === 'claude' ? zhCN.chat.claudeMessageLabel : session.backend === 'hermes' ? zhCN.chat.hermesMessageLabel : session.backend === 'opencode' ? zhCN.chat.opencodeMessageLabel : session.backend === 'pi' ? zhCN.chat.piMessageLabel : session.backend === 'antigravity'
                    ? zhCN.chat.antigravityMessageLabel
                    : zhCN.chat.messageLabel}
              style={[styles.composerInput, compactComposer && { maxHeight: composerInputMaxHeight }]}
              onChangeText={onChangeText}
              onSelectionChange={onSelectionChange}
              onKeyPress={(event: { nativeEvent: { key: string } }) => {
                if (event.nativeEvent.key === 'Backspace' && draft.length === 0 && quotes.length > 0) {
                  setQuotes(current => current.slice(0, -1))
                }
              }}

              selection={selection}
              placeholder={session.backend === 'codex'
                ? zhCN.chat.codexPlaceholder
                : session.backend === 'cursor'
                  ? zhCN.chat.cursorPlaceholder
                  : session.backend === 'claude' ? zhCN.chat.claudePlaceholder : session.backend === 'hermes' ? zhCN.chat.hermesPlaceholder : session.backend === 'opencode' ? zhCN.chat.opencodePlaceholder : session.backend === 'pi' ? zhCN.chat.piPlaceholder : session.backend === 'antigravity'
                    ? zhCN.chat.antigravityPlaceholder
                    : zhCN.chat.placeholder}
              placeholderTextColor={colors.muted}
              multiline
              editable={connected && !permissionSelecting}
              selectionColor={colors.accent}
              cursorColor={colors.accent}
            >
              <Text>{draftSegments.map((segment, index) => <Text key={index} style={{ color: segment.token ? colors.primary : colors.ink }}>{segment.text}</Text>)}</Text>
            </TextInput>
          </View>
          <View style={styles.composerControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={zhCN.chat.moreActions}
              accessibilityState={{ disabled: !connected || permissionSelecting }}
              disabled={!connected || permissionSelecting}
              onPress={openPlusMenu}
              hitSlop={8}
              style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed, (!connected || permissionSelecting) && styles.plusDisabled]}
            >
              <Plus size={20} color={connected ? colors.ink : colors.disabled} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={zhCN.chat.quickPrompts}
              accessibilityState={{ disabled: !connected || permissionSelecting, expanded: promptsPickerOpen }}
              disabled={!connected || permissionSelecting}
              onPress={openPromptsPicker}
              hitSlop={{ top: 8, bottom: 8 }}
              style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed, (!connected || permissionSelecting) && styles.plusDisabled]}
            >
              <Zap size={18} color={connected ? colors.ink : colors.disabled} strokeWidth={1.9} />
            </Pressable>
            <View style={styles.composerSpacer} />
            {sessionModels !== undefined && (
              <Pressable accessibilityRole="button" accessibilityLabel={zhCN.chat.selectModel} onPress={() => setModelPickerOpen(true)} style={styles.modelChip}>
                <Text style={styles.modelChipText} numberOfLines={1}>{currentModelLabel}</Text>
                {modelSelecting ? <ActivityIndicator size="small" color={colors.muted} /> : <ChevronDown size={14} color={colors.muted} />}
              </Pressable>
            )}
            {canStop && draft.trim().length === 0 && images.length === 0 && stagedFiles.length === 0
              ? <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zhCN.chat.stop}
                  accessibilityState={{ disabled: stopping, busy: stopping }}
                  disabled={stopping}
                  onPress={() => void stopSession()}
                  style={({ pressed }) => [styles.stopButton, pressed && !stopping && styles.stopPressed, stopping && styles.sendDisabled]}
                >
                  {stopping
                    ? <ActivityIndicator size="small" color={colors.onInverse} />
                    : <CircleStop size={20} color={colors.onInverse} />}
                </Pressable>
              : <>
                {/* With text in the composer the primary action is the send
                    (queueing) button — tapping where Send lives must never stop
                    the running task (official InputBar behaviour). Stop stays
                    available as its own secondary button. */}
                {canStop && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={zhCN.chat.stop}
                    accessibilityState={{ disabled: stopping, busy: stopping }}
                    disabled={stopping}
                    onPress={() => void stopSession()}
                    style={({ pressed }) => [styles.stopButtonSmall, pressed && !stopping && styles.stopPressed, stopping && styles.sendDisabled]}
                  >
                    {stopping
                      ? <ActivityIndicator size="small" color={colors.white} />
                      : <CircleStop size={17} color={colors.onInverse} />}
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zhCN.chat.send}
                  accessibilityState={{ disabled: !sendReady || permissionSelecting || !hasComposerContent }}
                  disabled={!sendReady || permissionSelecting || !hasComposerContent}
                  onPress={() => void submit()}
                  style={({ pressed }) => [styles.sendButton, pressed && styles.sendPressed, (!sendReady || permissionSelecting || !hasComposerContent) && styles.sendDisabled]}
                >
                  <ArrowUp size={20} color={!sendReady || permissionSelecting || !hasComposerContent ? colors.subtle : colors.white} strokeWidth={2.4} />
                </Pressable>
                </>}
          </View>
        </View>}
        </View>
        {draft.length > LONG_DRAFT_HINT && (
          <Text style={styles.composerHint}>{zhCN.chat.draftLong(draft.length)}</Text>
        )}
        {/* Landscape phones leave almost no space above the IME once the
            composer is visible; keep the privacy note for roomier windows. */}
        {!compactComposer && (
          <Text style={styles.composerHint}>
            {session.backend === 'codex'
              ? zhCN.chat.codexPolicyHint
              : session.backend === 'cursor'
                ? zhCN.chat.cursorPolicyHint
                : session.backend === 'claude' ? zhCN.chat.claudePolicyHint : session.backend === 'hermes' ? zhCN.chat.hermesPolicyHint : session.backend === 'opencode' ? zhCN.chat.opencodePolicyHint : session.backend === 'pi' ? zhCN.chat.piPolicyHint : session.backend === 'antigravity'
                  ? zhCN.chat.antigravityPolicyHint
                  : zhCN.chat.policyHint}
          </Text>
        )}
        </View>
      </View>
        </View>
      </View>

      <Modal visible={plusMenuOpen} transparent animationType="fade" onRequestClose={closePlusMenu} statusBarTranslucent>
        <ModalSurface onClose={closePlusMenu}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.moreActions}</Text><IconButton label={zhCN.common.close} icon={X} onPress={closePlusMenu} /></View>
            <ScrollView
              style={{ maxHeight: plusMenuListMaxHeight }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
            <View style={styles.plusCardRow}>
              {canAttachImages && (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={zhCN.chat.takePhoto}
                    accessibilityState={{ disabled: pickingImages || pickingFiles }}
                    disabled={pickingImages || pickingFiles}
                    onPress={() => { closePlusMenu(); void takePhoto() }}
                    style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, (pickingImages || pickingFiles) && styles.plusMenuOptionDisabled]}
                  >
                    <Camera size={22} color={colors.primary} />
                    <Text style={styles.plusCardText}>{zhCN.chat.takePhoto}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={zhCN.chat.photos}
                    accessibilityState={{ disabled: pickingImages || pickingFiles }}
                    disabled={pickingImages || pickingFiles}
                    onPress={() => { closePlusMenu(); void pickImages() }}
                    style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, (pickingImages || pickingFiles) && styles.plusMenuOptionDisabled]}
                  >
                    <Images size={22} color={colors.primary} />
                    <Text style={styles.plusCardText}>{zhCN.chat.photos}</Text>
                  </Pressable>
                </>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={zhCN.chat.files}
                accessibilityState={{ disabled: pickingImages || pickingFiles }}
                disabled={pickingImages || pickingFiles}
                onPress={() => { closePlusMenu(); void pickFiles() }}
                style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, (pickingImages || pickingFiles) && styles.plusMenuOptionDisabled]}
              >
                <FileText size={22} color={colors.primary} />
                <Text style={styles.plusCardText}>{zhCN.chat.files}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={zhCN.messageActions.quote}
                onPress={() => {
                  closePlusMenu()
                  void Clipboard.getStringAsync().then((text: string) => {
                    if (text && text.trim().length > 0) {
                      setQuotes(current => [...current, text.trim()])
                      composerInputRef.current?.focus()
                    }
                  }).catch(() => {})
                }}
                style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed]}
              >
                <QuoteMarkIcon size={22} color={colors.primary} />
                <Text style={styles.plusCardText}>{zhCN.messageActions.quote}</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={zhCN.chat.openWorkspaces}
              onPress={() => { closePlusMenu(); setWorkspacePickerOpen(true) }}
              style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed]}
            >
              <Folder size={20} color={colors.primary} />
              <Text style={styles.plusMenuOptionText}>{zhCN.chat.openWorkspaces}</Text>
              <View style={styles.plusMenuOptionValue}>
                <Text style={styles.plusMenuOptionValueText} numberOfLines={1}>{workspaceLabel}</Text>
                <ChevronRight size={16} color={colors.muted} />
              </View>
            </Pressable>
            {session.backend !== 'codex' && session.backend !== 'cursor' && session.backend !== 'antigravity' && session.backend !== 'pi' && session.backend !== 'opencode' && session.backend !== 'claude' && session.backend !== 'hermes' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={zhCN.chat.selectMode}
                accessibilityState={{ disabled: agentPresetSelecting }}
                disabled={agentPresetSelecting}
                onPress={() => { closePlusMenu(); setModePickerOpen(true) }}
                style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed, agentPresetSelecting && styles.plusMenuOptionDisabled]}
              >
                <Layers size={20} color={colors.primary} />
                <Text style={styles.plusMenuOptionText}>{zhCN.chat.mode}</Text>
                <View style={styles.plusMenuOptionValue}>
                  {agentPresetSelecting
                    ? <ActivityIndicator size="small" color={colors.muted} />
                    : <Text style={styles.plusMenuOptionValueText} numberOfLines={1}>{modeLabel}</Text>}
                  <ChevronRight size={16} color={colors.muted} />
                </View>
              </Pressable>
            )}
            {connected && session.backend !== 'claude' && session.backend !== 'hermes' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={zhCN.chat.toolAccess}
                onPress={() => { closePlusMenu(); setToolPickerOpen(true) }}
                style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed]}
              >
                <Terminal size={20} color={colors.primary} />
                <Text style={styles.plusMenuOptionText}>{zhCN.chat.toolAccess}</Text>
                <ChevronRight size={16} color={colors.muted} />
              </Pressable>
            )}
            {permissions !== undefined && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={zhCN.chat.approvalMode}
                accessibilityState={{ disabled: permissionSelecting || canStop }}
                disabled={permissionSelecting || canStop}
                onPress={() => { closePlusMenu(); setPermissionPickerOpen(true) }}
                style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed, (permissionSelecting || canStop) && styles.plusMenuOptionDisabled]}
              >
                <ShieldAlert size={20} color={colors.primary} />
                <Text style={styles.plusMenuOptionText}>{zhCN.chat.approvalMode}</Text>
                <View style={styles.plusMenuOptionValue}>
                  {permissionSelecting
                    ? <ActivityIndicator size="small" color={colors.muted} />
                    : <Text style={styles.plusMenuOptionValueText} numberOfLines={1}>{permissionDisplayName(permissions.currentValue, currentPermission?.name)}</Text>}
                  <ChevronRight size={16} color={colors.muted} />
                </View>
              </Pressable>
            )}
            </ScrollView>
        </ModalSurface>
      </Modal>

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
        onNewSession={startNewSession}
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
          Alert.alert(zhCN.chat.toolPromptDeleteTitle(prompt.title), zhCN.chat.toolPromptDeleteBody, [
            { text: zhCN.common.cancel, style: 'cancel' },
            { text: zhCN.common.delete, style: 'destructive', onPress: () => void deletePrompt(prompt) },
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
            accessibilityLabel={zhCN.common.close}
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

interface WorkspaceFileRef {
  path: string
  kind: 'file' | 'directory'
}

/** Shallow workspace tree for the `@` file menu: root entries plus one directory level. */
async function loadWorkspaceFileRefs(sessionId: string): Promise<WorkspaceFileRef[]> {
  const tools = requireSessionTools()
  const refs: WorkspaceFileRef[] = []
  const root = await tools.listFiles(sessionId, '')
  const directories = root.entries.filter(entry => entry.type === 'directory' && !entry.name.startsWith('.'))
  for (const entry of root.entries) {
    if (entry.name.startsWith('.')) continue
    refs.push({ path: entry.name, kind: entry.type === 'directory' ? 'directory' : 'file' })
  }
  await Promise.all(directories.slice(0, 12).map(async directory => {
    try {
      const listing = await tools.listFiles(sessionId, directory.name)
      for (const entry of listing.entries) {
        if (entry.name.startsWith('.')) continue
        refs.push({ path: `${directory.name}/${entry.name}`, kind: entry.type === 'directory' ? 'directory' : 'file' })
      }
    } catch {
      // Unreadable directories are simply absent from the menu.
    }
  }))
  return refs
}

/** Resolve image dimensions for files that arrive without picker metadata (document picker). */
function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
  })
}

export { ModalSurface,usePickerListMaxHeight } from './chat/modal'

function visibleMessageVersion(items: ChatItem[]): string {
  const last = items[items.length - 1]
  return last === undefined ? '' : JSON.stringify(last)
}
