import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  ActivityIndicator,
  AccessibilityInfo,
  Alert,
  Animated,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { ArrowUp, Bot, Camera, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, CircleStop, Code2, Folder, Layers, ListTree, MessageSquare, Paperclip, Pencil, Plus, Shield, Terminal, Trash2, Images, RefreshCw, ShieldAlert, Sparkles, User, X } from 'lucide-react-native'
import Svg, { Path } from 'react-native-svg'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { requireSessionTools, useAppStore } from '../state/store'
import { hasVisibleMessageText } from '../state/event-reducer'
import { chatSections, mergeReplyReasoning, type ChatSection } from '../state/message-helpers'
import type { AgentPresetOption, ApprovalActivity, ChatImage, ChatItem, ChatMessage, ModelCatalogModel, ModelProviderGroup, PermissionSelect, PromptImage, QuestionActivity, RemoteSession, ToolActivity, ToolDisplayDetail, WorkspaceView } from '../types'
import { Button, IconButton, TopBar } from '../ui/components'
import { NativeMarkdown } from '../ui/markdown'
import { MentionPopover, detectMention, filterByQuery, fileMentionText, sessionMentionText, maskPersonalPath, splitDraftSegments, type MentionGroup, type MentionItem, type MentionType } from '../ui/mention-popover'
import { radius, spacing, type } from '../ui/theme'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../ui/fish-logo'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { strings as zhCN } from '../locales/i18n'
import { KeyboardInset } from '../ui/keyboard-inset'
import { sessionPermissions } from '../services/session-permissions'
import { BUILT_IN_PROMPTS, loadCustomPrompts, saveCustomPrompts, type CustomPrompt } from '../services/storage'
import type { SkillEntry } from '../services/session-tools'
import { SessionToolsPanel } from './session-tools-panel'
import { MessageActions } from './message-actions'
import { ChatTrajectory } from './chat-trajectory'
import { processSegments, processDetail, toolActivity, completedProcessTitle, toolDisplayName, type ProcessActivity } from './chat-process'
import { resolveSessionDisplayTitle } from './session-title'
import { promptImageFromBase64, promptImageFromAsset, sessionImageLimits, validatePromptImages } from './chat-images'

const EMPTY_CHAT_ITEMS: ChatItem[] = []

export function ChatScreen({ onBack, onNewSession, onOpenWorkspaces }: { onBack: () => void; onNewSession?: () => void; onOpenWorkspaces?: () => void }) {
  const session = useAppStore(state => state.selectedSession)
  const messages = useAppStore(state => session === undefined ? EMPTY_CHAT_ITEMS : state.messages[session.sessionId] ?? EMPTY_CHAT_ITEMS)
  const busy = useAppStore(state => state.busyAction)
  const connection = useAppStore(state => state.connection)
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
  const [draft, setDraft] = useState('')
  const [trajectory, setTrajectory] = useState(false)

  // Web-style blue marks: `/` commands and `@` references render in accent blue.
  const draftSegments = useMemo(() => splitDraftSegments(draft), [draft])
  const [images, setImages] = useState<PromptImage[]>([])
  const [pickingImages, setPickingImages] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [modePickerOpen, setModePickerOpen] = useState(false)
  const [permissionPickerOpen, setPermissionPickerOpen] = useState(false)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [toolPickerOpen, setToolPickerOpen] = useState(false)
  const [toolsMode, setToolsMode] = useState<'files' | 'terminal'>()
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
  const keyboardVisibleRef = useRef(false)
  const draftRef = useRef('')
  const selectionRef = useRef({ start: 0, end: 0 })
  /** Start index of the active `/` / `@` trigger inside the draft. */
  const mentionSpanRef = useRef(0)
  const [skillCatalog, setSkillCatalog] = useState<SkillEntry[]>()
  const [skillCatalogFailed, setSkillCatalogFailed] = useState(false)
  const [workspaceFileRefs, setWorkspaceFileRefs] = useState<WorkspaceFileRef[]>()
  const [fileListFailed, setFileListFailed] = useState(false)
  const skillRequestedRef = useRef<string | undefined>(undefined)
  const filesRequestedRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    keyboardVisibleRef.current = Keyboard.isVisible()
    const shown = Keyboard.addListener('keyboardDidShow', () => { keyboardVisibleRef.current = true })
    const hidden = Keyboard.addListener('keyboardDidHide', () => { keyboardVisibleRef.current = false })
    return () => { shown.remove(); hidden.remove() }
  }, [])
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
    if (session?.backend === 'codex' || connection.phase !== 'connected') return
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
  const listRef = useRef<FlatList<ChatSection>>(null)
  const lastStreamingScrollAt = useRef(0)
  const scrollFrameRef = useRef<number | null>(null)
  const scrollAnimatedRef = useRef(false)
  const laidOutSessionRef = useRef<string | undefined>(undefined)
  /** Keep the viewport on the latest turn until the user scrolls away. */
  const pinToBottomRef = useRef(true)
  /** Re-pin while the first session layout (markdown / images) is still settling. */
  const initialPinRef = useRef(true)
  const visibleMessages = useMemo(() => (session?.backend === 'codex' ? mergeReplyReasoning(messages) : messages).filter(item =>
    item.kind !== 'message' || (item.role !== 'system' && !item.context && (
      hasVisibleMessageText(item.text)
      || hasVisibleMessageText(item.reasoning ?? '')
      || (item.images?.length ?? 0) > 0))), [messages, session?.backend])
  const visibleSections = useMemo(() => chatSections(visibleMessages), [visibleMessages])
  const interleavedTurns = useMemo(() => {
    const seen = new Set<string>()
    const interleaved = new Set<string>()
    for (const section of visibleSections) if (section.kind === 'process') {
      if (seen.has(section.turn)) interleaved.add(section.turn)
      seen.add(section.turn)
    }
    return interleaved
  }, [visibleSections])
  const lastItem = visibleMessages.at(-1)
  const lastContentVersion = lastItem?.kind === 'message'
    ? `${lastItem.id}:${lastItem.text.length}:${lastItem.reasoning?.length ?? 0}`
    : undefined
  const sessionId = session?.sessionId
  const panelOpen = plusMenuOpen || modelPickerOpen || modePickerOpen || permissionPickerOpen
    || workspacePickerOpen || toolPickerOpen || toolsMode !== undefined || trajectory || mentionType !== null
    || promptsPickerOpen || promptsManagerOpen || promptEditing !== null

  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  const scrollToBottom = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated })
  }, [])

  // FlatList can report several content-size changes while markdown rows are
  // measuring. Coalesce those reports into one native scroll command so the
  // initial render does not monopolize the JS responder queue.
  const scheduleScrollToBottom = useCallback((animated: boolean) => {
    scrollAnimatedRef.current = scrollAnimatedRef.current || animated
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      const shouldAnimate = scrollAnimatedRef.current
      scrollAnimatedRef.current = false
      scrollToBottom(shouldAnimate)
    })
  }, [scrollToBottom])

  // Entering a session (or switching sessions) should land on the latest turn.
  useEffect(() => {
    setTrajectory(false)
    pinToBottomRef.current = true
    initialPinRef.current = true
    laidOutSessionRef.current = undefined
  }, [sessionId])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = null
    scrollAnimatedRef.current = false
  }, [])

  // A sheet or picker owns the user's next touch. Cancel a queued list jump
  // as soon as it opens so a streaming update cannot move the responder under
  // the panel.
  useEffect(() => {
    if (!panelOpen || scrollFrameRef.current === null) return
    cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = null
    scrollAnimatedRef.current = false
  }, [panelOpen])

  // Let the first layout frame finish before jumping to the end. This keeps
  // the top bar and Android back dispatch responsive while a large history
  // page is being mounted, without relying on the deprecated InteractionManager.
  useEffect(() => {
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    const timer = setTimeout(() => {
      if (pinToBottomRef.current || initialPinRef.current) scheduleScrollToBottom(false)
    }, 32)
    return () => clearTimeout(timer)
  }, [historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId, visibleMessages.length])

  // Loading older history prepends above the viewport — do not yank to the end.
  useEffect(() => {
    if (!historyLoadingOlder) return
    pinToBottomRef.current = false
    initialPinRef.current = false
  }, [historyLoadingOlder])

  // Scroll when a brand-new item is appended. Streaming deltas keep the same
  // item id, so this fires once per assistant step instead of once per chunk.
  useEffect(() => {
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    scheduleScrollToBottom(initialPinRef.current ? false : true)
  }, [visibleMessages.length, historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId])

  // While an assistant message is streaming, its text grows on every chunk.
  // Following it with animated scrolls piles up animation frames on the JS
  // thread (freezing back navigation and the keyboard). Snap to the end at
  // most ~10 Hz instead, without animation.
  useEffect(() => {
    if (panelOpen || visibleMessages.length === 0 || lastContentVersion === undefined || historyLoadingOlder) return
    if (!pinToBottomRef.current) return
    const now = Date.now()
    if (now - lastStreamingScrollAt.current < 100) return
    lastStreamingScrollAt.current = now
    scheduleScrollToBottom(false)
  }, [lastContentVersion, visibleMessages.length, historyLoadingOlder, panelOpen, scheduleScrollToBottom])

  const onListLayout = useCallback(() => {
    // A session switch can render the list before its viewport and markdown
    // rows have measured. Defer one extra frame so the initial jump reaches
    // the actual end rather than the pre-layout content height.
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (laidOutSessionRef.current === sessionId) return
    laidOutSessionRef.current = sessionId
    scheduleScrollToBottom(false)
  }, [historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId, visibleMessages.length])

  const onListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y
    const atBottom = distanceFromEnd <= 80
    pinToBottomRef.current = atBottom
  }, [])

  // Stable renderItem keeps FlatList rows from re-rendering on every streaming
  // delta; ChatItemView is memoized so only the changing row re-renders.
  const renderChatItem = useCallback(({ item }: { item: ChatSection }) => item.kind === 'process'
    ? <ChatProcessGroup items={item.items} foldAllowed={!interleavedTurns.has(item.turn)} busyAction={busy} onApproval={respondApproval} onQuestion={respondQuestion} />
    : <ChatItemView item={item.item} busyAction={busy} compact={false} onApproval={respondApproval} onQuestion={respondQuestion} />,
  [busy, respondApproval, respondQuestion, interleavedTurns])

  // Keep chat's back action at the top of the Android responder stack. The
  // navigator also handles back globally, but a freshly mounted FlatList can
  // otherwise win the first dispatch while its cells are being measured.
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
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
        return true
      }
      if (trajectory) { setTrajectory(false); return true }
      if (keyboardVisibleRef.current || Keyboard.isVisible()) {
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

  if (session === undefined) return null

  const submit = async () => {
    if (!connected || permissionSelecting) return
    const text = draft.trim()
    if (text.length === 0 && images.length === 0) return
    const submittedImages = images
    applyDraft('')
    setImages([])
    setMentionType(null)
    selectionRef.current = { start: 0, end: 0 }
    setSelection({ start: 0, end: 0 })
    if (!await sendMessage(text, submittedImages)) {
      applyDraft(draft)
      setImages(submittedImages)
      Alert.alert(zhCN.messageActions.failed, useAppStore.getState().error ?? zhCN.messageActions.unavailable)
    } else {
      const result = useAppStore.getState().commandResult
      if (result?.sessionId === session.sessionId && useAppStore.getState().selectedSession?.sessionId === session.sessionId) {
        Alert.alert(zhCN.mention.commandSection, result.text)
        useAppStore.setState({ commandResult: undefined })
      }
    }
  }

  const pickImages = async () => {
    const limits = sessionImageLimits(session)
    const remaining = limits === undefined ? 0 : Math.max(0, limits.maxImagesPerMessage - images.length)
    if (limits !== undefined && remaining === 0) {
      Alert.alert(zhCN.chat.imageLimitTitle, zhCN.chat.tooManyImages(limits.maxImagesPerMessage))
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
    const remaining = limits === undefined ? 0 : Math.max(0, limits.maxImagesPerMessage - images.length)
    if (limits !== undefined && remaining === 0) {
      Alert.alert(zhCN.chat.imageLimitTitle, zhCN.chat.tooManyImages(limits.maxImagesPerMessage))
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
    onBack()
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
  const connected = connection.phase === 'connected' && !reconnectingSession
  const hasActiveChatItem = visibleMessages.some(isActiveChatItem)
  const canStop = connected && (busy === 'send-message' || busy === 'stop-session' || session.running || hasActiveChatItem)
  const stopping = busy === 'stop-session'
  const replyActive = busy === 'send-message' || busy === 'stop-session' || session.running || hasActiveChatItem
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
    setToolsMode(mode)
  }

  const startNewSession = async () => {
    if (newSessionPending || busy !== undefined) return
    setNewSessionPending(true)
    try {
      const created = await createSession(currentWorkspace?.workspaceId)
      if (created) {
        onNewSession?.()
      } else {
        Alert.alert(zhCN.chat.newChatFailedTitle, zhCN.chat.newChatFailedBody)
      }
    } finally {
      setNewSessionPending(false)
    }
  }

  const sendPrompt = async (prompt: CustomPrompt) => {
    setPromptsPickerOpen(false)
    const ok = await sendMessage(prompt.text)
    if (ok) AccessibilityInfo.announceForAccessibility(zhCN.chat.toolPromptSent(prompt.title))
    else Alert.alert(zhCN.chat.toolPromptSendFailed, zhCN.chat.toolPromptSendFailed)
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

  const sessionBlank = visibleMessages.length === 0 && session.blank !== false

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
  return (
    <KeyboardInset>
      <TopBar
        title={sessionTitle(session)}
        titleLines={2}
        onBack={handleBack}
        action={<>
          <IconButton label={trajectory ? zhCN.trajectory.close : zhCN.trajectory.open}
            icon={trajectory ? MessageSquare : ListTree} dense tint={trajectory ? colors.primary : undefined}
            onPress={() => { Keyboard.dismiss(); setMentionType(null); setTrajectory(value => !value) }} />
          <IconButton label={zhCN.chat.newChat} icon={OfficialMenuIcons.newChat} dense onPress={() => void startNewSession()} disabled={newSessionPending || busy !== undefined} />
          {!connected && <IconButton label={zhCN.chat.reconnect} icon={RefreshCw} dense onPress={() => void reconnectCurrentSession()} disabled={connectionRetrying} />}
        </>}
      />
      {!connected && (
        <View style={styles.connectionBanner} accessibilityRole="alert">
          <View style={styles.connectionDot} />
          <Text style={styles.connectionBannerText}>{connectionRetrying ? zhCN.chat.reconnecting : zhCN.chat.offline}</Text>
        </View>
      )}

      {trajectory ? <ChatTrajectory key={session.sessionId} items={messages} renderImages={images => <ChatImages images={images} />} hasMore={historyHasMore} loading={historyLoadingOlder} loadOlder={() => void loadOlderHistory()} renderItem={item => <ChatItemView item={item} compact={false} busyAction={busy} onApproval={respondApproval} onQuestion={respondQuestion} />} /> : <FlatList
        ref={listRef}
        key={session.sessionId}
        style={styles.list}
        contentContainerStyle={[styles.listContent, visibleMessages.length === 0 && styles.emptyList]}
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
        onScroll={onListScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          initialPinRef.current = false
          Keyboard.dismiss()
        }}
        ListEmptyComponent={<WelcomeMessage />}
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
      />}

      {mentionType !== null && (
        <Pressable
          style={styles.mentionBackdrop}
          onPress={() => { closeMention(); Keyboard.dismiss() }}
          accessibilityRole="button"
          accessibilityLabel={zhCN.common.close}
        />
      )}
      <View style={styles.composerWrap}>

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
        {replyActive && (
          <View
            accessible
            accessibilityLabel={stopping ? zhCN.chat.stopping : session.backend === 'codex' ? zhCN.chat.codexGenerating : session.backend === 'cursor' ? zhCN.chat.cursorGenerating : session.backend === 'antigravity' ? zhCN.chat.antigravityGenerating : zhCN.chat.generating}
            accessibilityLiveRegion="polite"
            style={styles.replyStatus}
          >
            <Svg width={18} height={18} viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`} accessible={false}><Path d={FISH_LOGO_PATH} fill={colors.accent} /></Svg>
            <Text style={styles.replyStatusText}>{stopping ? zhCN.chat.stopping : session.backend === 'codex' ? zhCN.chat.codexGenerating : session.backend === 'cursor' ? zhCN.chat.cursorGenerating : session.backend === 'antigravity' ? zhCN.chat.antigravityGenerating : zhCN.chat.generating}</Text>
            {!stopping && <ReplyStatusDots />}
          </View>
        )}
        <View style={{ position: 'relative', zIndex: 20, elevation: 20 }}>
          {mentionType !== null && (
            <MentionPopover groups={mentionGroups} onDismiss={closeMention} emptyText={zhCN.mention.noMatches} />
          )}
        <View style={styles.composerCard}>
          <View style={styles.composerInputWrap}>
            {/* Native attributed text keeps references blue without an opaque Android value layer. */}
            <TextInput
              ref={composerInputRef}
              accessibilityLabel={session.backend === 'codex'
                ? zhCN.chat.codexMessageLabel
                : session.backend === 'cursor'
                  ? zhCN.chat.cursorMessageLabel
                  : session.backend === 'antigravity'
                    ? zhCN.chat.antigravityMessageLabel
                    : zhCN.chat.messageLabel}
              style={styles.composerInput}
              onChangeText={onChangeText}
              onSelectionChange={onSelectionChange}

              selection={selection}
              placeholder={session.backend === 'codex'
                ? zhCN.chat.codexPlaceholder
                : session.backend === 'cursor'
                  ? zhCN.chat.cursorPlaceholder
                  : session.backend === 'antigravity'
                    ? zhCN.chat.antigravityPlaceholder
                    : zhCN.chat.placeholder}
              placeholderTextColor={colors.muted}
              multiline
              maxLength={12_000}
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
              style={({ pressed }) => [styles.quickPromptsButton, pressed && styles.plusPressed, (!connected || permissionSelecting) && styles.plusDisabled]}
            >
              <Text style={styles.quickPromptsText} numberOfLines={1}>{zhCN.chat.quickPrompts}</Text>
            </Pressable>
            <View style={styles.composerSpacer} />
            {sessionModels !== undefined && (
              <Pressable accessibilityRole="button" accessibilityLabel={zhCN.chat.selectModel} onPress={() => setModelPickerOpen(true)} style={styles.modelChip}>
                <Sparkles size={14} color={colors.primary} />
                <Text style={styles.modelChipText} numberOfLines={1}>{currentModelLabel}</Text>
                {modelSelecting ? <ActivityIndicator size="small" color={colors.muted} /> : <ChevronDown size={14} color={colors.muted} />}
              </Pressable>
            )}
            {canStop
              ? <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zhCN.chat.stop}
                  accessibilityState={{ disabled: stopping, busy: stopping }}
                  disabled={stopping}
                  onPress={() => void stopSession()}
                  style={({ pressed }) => [styles.stopButton, pressed && !stopping && styles.stopPressed, stopping && styles.sendDisabled]}
                >
                  {stopping
                    ? <ActivityIndicator size="small" color={colors.white} />
                    : <CircleStop size={20} color={colors.white} />}
                </Pressable>
              : <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zhCN.chat.send}
                  accessibilityState={{ disabled: !connected || permissionSelecting || (draft.trim().length === 0 && images.length === 0) }}
                  disabled={!connected || permissionSelecting || (draft.trim().length === 0 && images.length === 0)}
                  onPress={() => void submit()}
                  style={({ pressed }) => [styles.sendButton, pressed && styles.sendPressed, (!connected || permissionSelecting || (draft.trim().length === 0 && images.length === 0)) && styles.sendDisabled]}
                >
                  <ArrowUp size={20} color={colors.white} />
                </Pressable>}
          </View>
        </View>
        </View>
        <Text style={styles.composerHint}>
          {session.backend === 'codex'
            ? zhCN.chat.codexPolicyHint
            : session.backend === 'cursor'
              ? zhCN.chat.cursorPolicyHint
              : session.backend === 'antigravity'
                ? zhCN.chat.antigravityPolicyHint
                : zhCN.chat.policyHint}
        </Text>
      </View>

      <Modal visible={plusMenuOpen} transparent animationType="fade" onRequestClose={closePlusMenu}>
        <ModalSurface onClose={closePlusMenu}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.moreActions}</Text><IconButton label={zhCN.common.close} icon={X} onPress={closePlusMenu} /></View>
            {sessionImageLimits(session) !== undefined && (
              <View style={styles.plusCardRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zhCN.chat.takePhoto}
                  accessibilityState={{ disabled: pickingImages }}
                  disabled={pickingImages}
                  onPress={() => { closePlusMenu(); void takePhoto() }}
                  style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, pickingImages && styles.plusMenuOptionDisabled]}
                >
                  <Camera size={22} color={colors.primary} />
                  <Text style={styles.plusCardText}>{zhCN.chat.takePhoto}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zhCN.chat.photos}
                  accessibilityState={{ disabled: pickingImages }}
                  disabled={pickingImages}
                  onPress={() => { closePlusMenu(); void pickImages() }}
                  style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, pickingImages && styles.plusMenuOptionDisabled]}
                >
                  <Images size={22} color={colors.primary} />
                  <Text style={styles.plusCardText}>{zhCN.chat.photos}</Text>
                </Pressable>
              </View>
            )}
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
            {session.backend !== 'codex' && session.backend !== 'cursor' && session.backend !== 'antigravity' && (
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
            {session.backend !== 'codex' && session.backend !== 'cursor' && session.backend !== 'antigravity' && connected && (
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
          key={`${session.sessionId}:${toolsMode}`}
          mode={toolsMode}
          sessionId={session.sessionId}
          onClose={() => setToolsMode(undefined)}
        />
      )}
      <PermissionPicker loading={permissionLoading} error={permissionError} onRetry={() => setPermissionRevision(v => v + 1)} visible={permissionPickerOpen} permissions={permissions} onClose={() => setPermissionPickerOpen(false)} onPick={pickPermission} />
      <ModePicker visible={modePickerOpen} options={agentPresetOptions} current={currentAgentPresetId} loading={agentPresetLoading} selecting={agentPresetSelecting} onClose={() => setModePickerOpen(false)} onPick={pickMode} />
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
    </KeyboardInset>
  )
}


function ModePicker({ visible, options, current, loading, selecting, onClose, onPick }: {
  visible: boolean
  options?: AgentPresetOption[]
  current?: string
  loading: boolean
  selecting: boolean
  onClose: () => void
  onPick: (preset: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalSurface onClose={onClose}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.selectMode}</Text><IconButton label={zhCN.common.close} icon={X} onPress={onClose} /></View>
          <ScrollView
            style={{ maxHeight: listMaxHeight }}
            contentContainerStyle={styles.modalListContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {options === undefined || options.length === 0 ? (
              loading
                ? <View style={styles.modeLoading}><ActivityIndicator color={colors.primary} /></View>
                : <Text style={styles.modelFailures}>{zhCN.chat.modeLoadFailed}</Text>
            ) : options.map(option => {
              const isCurrent = option.id === current
              const broken = option.broken !== undefined
              const description = agentPresetDescription(option)
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isCurrent, disabled: selecting || broken }}
                  disabled={selecting || broken}
                  onPress={() => onPick(option.id)}
                  style={[styles.permissionOption, isCurrent && styles.modelOptionCurrent, (selecting || broken) && styles.plusMenuOptionDisabled]}
                >
                  <View style={styles.permissionOptionCopy}>
                    <Text style={styles.permissionOptionName}>{agentPresetName(option)}</Text>
                    {description !== undefined && <Text style={styles.permissionOptionDescription}>{description}</Text>}
                  </View>
                  {isCurrent && <Check size={16} color={colors.primary} />}
                </Pressable>
              )
            })}
          </ScrollView>
      </ModalSurface>
    </Modal>
  )
}

function PermissionPicker({ visible, permissions, onClose, onPick, loading, error, onRetry }: {
  loading: boolean
  error?: string
  onRetry: () => void
  visible: boolean
  permissions?: PermissionSelect
  onClose: () => void
  onPick: (preset: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  if (permissions === undefined) return null
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalSurface onClose={onClose}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.approvalMode}</Text><IconButton label={zhCN.common.close} icon={X} onPress={onClose} /></View>
          <ScrollView
            style={{ maxHeight: listMaxHeight }}
            contentContainerStyle={styles.modalListContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {loading && <ActivityIndicator color={colors.primary} />}
            {error && <View><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><Button label={zhCN.tools.retry} onPress={onRetry} /></View>}
            {permissions.options.filter(option => option.value !== 'custom').map(option => {
              const current = option.value === permissions.currentValue
              return (
                <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: current }} onPress={() => onPick(option.value)} style={[styles.permissionOption, current && styles.modelOptionCurrent]}>
                  <View style={styles.permissionOptionCopy}><Text style={styles.permissionOptionName}>{permissionDisplayName(option.value, option.name)}</Text>{permissionDisplayDescription(option.value, option.description) !== undefined && <Text style={styles.permissionOptionDescription}>{permissionDisplayDescription(option.value, option.description)}</Text>}</View>
                  {current && <Check size={16} color={colors.primary} />}
                </Pressable>
              )
            })}
          </ScrollView>
      </ModalSurface>
    </Modal>
  )
}


function WorkspacePicker({ visible, workspaces, currentSessionId, sessionBackend, busy, onClose, onPick, onManage }: {
  visible: boolean
  workspaces: WorkspaceView[]
  currentSessionId: string
  sessionBackend?: WorkspaceView['backend']
  busy?: string
  onClose: () => void
  onPick: (workspace: WorkspaceView) => void
  onManage?: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  const options = workspaces.filter(workspace => (workspace.backend ?? 'harness') === (sessionBackend ?? 'harness'))
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalSurface onClose={onClose}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.selectWorkspace}</Text><IconButton label={zhCN.common.close} icon={X} onPress={onClose} /></View>
          <Text style={styles.pickerHint}>{zhCN.chat.moveSessionHint}</Text>
          <ScrollView
            style={{ maxHeight: listMaxHeight }}
            contentContainerStyle={styles.modalListContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {options.length === 0 ? (
              <View style={styles.pickerEmpty}>
                <Text style={styles.permissionOptionName}>{zhCN.chat.workspacePickerEmptyTitle}</Text>
                <Text style={styles.permissionOptionDescription}>{zhCN.chat.workspacePickerEmptyBody}</Text>
                {onManage !== undefined && <Button label={zhCN.chat.manageWorkspaces} onPress={() => { onClose(); onManage() }} />}
              </View>
            ) : options.map(workspace => {
              const isCurrent = workspace.sessionIds.includes(currentSessionId)
              return (
                <Pressable
                  key={workspace.workspaceId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isCurrent, disabled: busy !== undefined }}
                  disabled={busy !== undefined}
                  onPress={() => onPick(workspace)}
                  style={[styles.permissionOption, isCurrent && styles.modelOptionCurrent, busy !== undefined && styles.plusMenuOptionDisabled]}
                >
                  <View style={styles.permissionOptionCopy}>
                    <Text style={styles.permissionOptionName}>{workspace.title}</Text>
                    <Text style={styles.permissionOptionDescription} numberOfLines={1}>{workspace.path}</Text>
                  </View>
                  {isCurrent && <Check size={16} color={colors.primary} />}
                </Pressable>
              )
            })}
          </ScrollView>
      </ModalSurface>
    </Modal>
  )
}

function ToolAccessPicker({ visible, onClose, onPick }: {
  visible: boolean
  onClose: () => void
  onPick: (mode: 'files' | 'terminal') => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  const options = [
    { id: 'files' as const, icon: Folder, name: zhCN.tools.files, description: zhCN.chat.toolFilesDescription },
    { id: 'terminal' as const, icon: Terminal, name: zhCN.tools.terminal, description: zhCN.chat.toolTerminalDescription },
  ]
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalSurface onClose={onClose}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.toolAccess}</Text><IconButton label={zhCN.common.close} icon={X} onPress={onClose} /></View>
          <ScrollView
            style={{ maxHeight: listMaxHeight }}
            contentContainerStyle={styles.modalListContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {options.map(option => {
              const Icon = option.icon
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  onPress={() => onPick(option.id)}
                  style={({ pressed }) => [styles.permissionOption, pressed && styles.plusMenuOptionPressed]}
                >
                  <Icon size={20} color={colors.primary} />
                  <View style={styles.permissionOptionCopy}>
                    <Text style={styles.permissionOptionName}>{option.name}</Text>
                    <Text style={styles.permissionOptionDescription}>{option.description}</Text>
                  </View>
                  <ChevronRight size={16} color={colors.muted} />
                </Pressable>
              )
            })}
          </ScrollView>
      </ModalSurface>
    </Modal>
  )
}

function PromptsPicker({ visible, prompts, onClose, onPick, onManage }: {
  visible: boolean
  prompts: readonly CustomPrompt[]
  onClose: () => void
  onPick: (prompt: CustomPrompt) => void
  onManage: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalSurface onClose={onClose}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{zhCN.chat.toolPrompts}</Text>
          <IconButton label={zhCN.common.close} icon={X} onPress={onClose} />
        </View>
        <ScrollView
          style={{ maxHeight: Math.max(140, listMaxHeight - 56) }}
          contentContainerStyle={styles.modalListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {prompts.length === 0 ? (
            <View style={styles.pickerEmpty}>
              <Text style={styles.permissionOptionName}>{zhCN.chat.toolPromptEmptyTitle}</Text>
              <Text style={styles.permissionOptionDescription}>{zhCN.chat.toolPromptEmptyBody}</Text>
            </View>
          ) : prompts.map(prompt => (
            <Pressable
              key={prompt.id}
              accessibilityRole="button"
              accessibilityLabel={prompt.title}
              onPress={() => onPick(prompt)}
              style={({ pressed }) => [styles.permissionOption, pressed && styles.plusMenuOptionPressed]}
            >
              <View style={styles.permissionOptionCopy}>
                <Text style={styles.permissionOptionName}>{prompt.title}</Text>
                <Text style={styles.permissionOptionDescription} numberOfLines={2}>{prompt.text}</Text>
              </View>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={zhCN.chat.toolPromptEdit}
          onPress={onManage}
          style={({ pressed }) => [styles.effortRow, pressed && styles.plusMenuOptionPressed]}
        >
          <Text style={styles.effortRowLabel}>{zhCN.chat.toolPromptEdit}</Text>
          <View style={styles.plusMenuOptionValue}>
            <ChevronRight size={16} color={colors.muted} />
          </View>
        </Pressable>
      </ModalSurface>
    </Modal>
  )
}

function PromptsManager({ visible, prompts, promptsLoading, onBack, onClose, onAdd, onEdit, onDelete }: {
  visible: boolean
  prompts: readonly CustomPrompt[]
  promptsLoading?: boolean
  onBack: () => void
  onClose: () => void
  onAdd: () => void
  onEdit: (prompt: CustomPrompt) => void
  onDelete: (prompt: CustomPrompt) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onBack}>
      <ModalSurface onClose={onClose}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderCopy}>
            <IconButton label={zhCN.common.back} icon={ChevronLeft} onPress={onBack} />
            <Text style={styles.modalTitle} numberOfLines={1}>{zhCN.chat.toolPromptEdit}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <IconButton label={zhCN.chat.toolPromptAdd} icon={Plus} tint={colors.primary} onPress={onAdd} disabled={promptsLoading} />
            <IconButton label={zhCN.common.close} icon={X} onPress={onClose} />
          </View>
        </View>
        <ScrollView
          style={{ maxHeight: listMaxHeight }}
          contentContainerStyle={styles.modalListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {prompts.length === 0 ? (
            <View style={styles.pickerEmpty}>
              <Text style={styles.permissionOptionName}>{zhCN.chat.toolPromptEmptyTitle}</Text>
              <Text style={styles.permissionOptionDescription}>{zhCN.chat.toolPromptEmptyBody}</Text>
            </View>
          ) : prompts.map(prompt => (
            <View key={prompt.id} style={[styles.permissionOption, { paddingRight: 4 }]}>
              <View style={styles.permissionOptionCopy}>
                <Text style={styles.permissionOptionName}>{prompt.title}</Text>
                <Text style={styles.permissionOptionDescription} numberOfLines={2}>{prompt.text}</Text>
              </View>
              <IconButton label={zhCN.chat.toolPromptEditTitle(prompt.title)} icon={Pencil} onPress={() => onEdit(prompt)} dense disabled={promptsLoading} />
              <IconButton label={zhCN.common.delete} icon={Trash2} onPress={() => onDelete(prompt)} dense disabled={promptsLoading} />
            </View>
          ))}
        </ScrollView>
      </ModalSurface>
    </Modal>
  )
}

function PromptEditor({ visible, prompt, promptsLoading, onBack, onClose, onSave }: {
  visible: boolean
  prompt?: CustomPrompt
  promptsLoading?: boolean
  onBack: () => void
  onClose: () => void
  onSave: (title: string, text: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  useEffect(() => {
    if (!visible) return
    setTitle(prompt?.title ?? '')
    setText(prompt?.text ?? '')
  }, [visible, prompt?.id])
  const canSave = title.trim().length > 0 && text.trim().length > 0 && !promptsLoading
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onBack}>
      <ModalSurface onClose={onClose}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderCopy}>
            <IconButton label={zhCN.common.back} icon={ChevronLeft} onPress={onBack} />
            <Text style={styles.modalTitle} numberOfLines={1}>
              {prompt === undefined ? zhCN.chat.toolPromptAdd : zhCN.chat.toolPromptEditTitle(prompt.title)}
            </Text>
          </View>
          <IconButton label={zhCN.common.close} icon={X} onPress={onClose} />
        </View>
        <ScrollView style={{ maxHeight: listMaxHeight }} keyboardShouldPersistTaps="handled">
          <Text style={styles.promptInputLabel}>{zhCN.chat.toolPromptTitlePlaceholder}</Text>
          <TextInput
            accessibilityLabel={zhCN.chat.toolPromptTitlePlaceholder}
            placeholder={zhCN.chat.toolPromptTitlePlaceholder}
            placeholderTextColor={colors.muted}
            value={title}
            onChangeText={setTitle}
            style={styles.promptInput}
          />
          <Text style={[styles.promptInputLabel, { marginTop: 12 }]}>{zhCN.chat.toolPromptTextPlaceholder}</Text>
          <TextInput
            accessibilityLabel={zhCN.chat.toolPromptTextPlaceholder}
            placeholder={zhCN.chat.toolPromptTextPlaceholder}
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            multiline
            style={[styles.promptInput, styles.promptTextArea]}
          />
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={zhCN.chat.toolPromptSave}
          disabled={!canSave}
          onPress={() => onSave(title, text)}
          style={({ pressed }) => [styles.effortRow, { justifyContent: 'center', backgroundColor: canSave ? colors.primary : colors.surface, marginTop: 12 }, pressed && canSave && styles.plusMenuOptionPressed]}
        >
          <Check size={16} color={canSave ? colors.surface : colors.disabled} />
          <Text style={[styles.effortRowLabel, { color: canSave ? colors.surface : colors.disabled, marginLeft: 6 }]}>{zhCN.chat.toolPromptSave}</Text>
        </Pressable>
      </ModalSurface>
    </Modal>
  )
}

function ModelPicker({ visible, models, onClose, onPick }: {
  visible: boolean
  models?: import('../types').SessionModels
  onClose: () => void
  onPick: (group: ModelProviderGroup, model: ModelCatalogModel, reasoningEffort?: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  const [effortView, setEffortView] = useState(false)
  useEffect(() => {
    if (!visible) setEffortView(false)
  }, [visible])
  if (models === undefined) return null
  const currentGroup = models.groups.find(group => group.id === models.current.provider)
  const currentModel = currentGroup?.models.find(model => model.id === models.current.model)
  const efforts = currentModel?.reasoning?.efforts ?? []
  const activeEffortId = models.current.reasoningEffort ?? currentModel?.reasoning?.defaultEffort
  const activeEffort = efforts.find(effort => effort.id === activeEffortId)
  const showEffortRow = !effortView && efforts.length > 0
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalSurface onClose={onClose}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              {effortView && (
                <IconButton label={zhCN.common.back} icon={ChevronLeft} onPress={() => setEffortView(false)} />
              )}
              <Text style={styles.modalTitle} numberOfLines={1}>
                {effortView ? zhCN.chat.reasoningEffort : zhCN.chat.selectModel}
              </Text>
            </View>
            <IconButton label={zhCN.common.close} icon={X} onPress={onClose} />
          </View>
          <ScrollView
            style={{ maxHeight: showEffortRow ? Math.max(140, listMaxHeight - 56) : listMaxHeight }}
            contentContainerStyle={styles.modalListContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {!effortView ? (
              <>
                {models.groups.map(group => (
                  <View key={group.id} style={styles.modelGroupBlock}>
                    <Text style={styles.modelGroupTitle}>{group.name}</Text>
                    {group.models.map(model => {
                      const current = models.current.provider === group.id && models.current.model === model.id
                      return (
                        <Pressable
                          key={model.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: current }}
                          onPress={() => {
                            if (current) onPick(group, model, models.current.reasoningEffort)
                            else onPick(group, model)
                          }}
                          style={[styles.modelOption, current && styles.modelOptionCurrent]}
                        >
                          <View style={styles.modelOptionCopy}>
                            <Text style={styles.modelOptionName} numberOfLines={1}>{model.name}</Text>
                          </View>
                          {current && <Check size={16} color={colors.primary} />}
                        </Pressable>
                      )
                    })}
                  </View>
                ))}
                {models.failures.length > 0 && (
                  <Text style={styles.modelFailures}>{models.failures.map(failure => failure.message).join('; ')}</Text>
                )}
              </>
            ) : (
              <>
                {efforts.map(effort => {
                  const current = activeEffortId === effort.id
                  return (
                    <Pressable
                      key={effort.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: current }}
                      accessibilityLabel={zhCN.chat.reasoningEffortLabel(effort.name)}
                      onPress={() => {
                        if (currentGroup !== undefined && currentModel !== undefined) {
                          onPick(currentGroup, currentModel, effort.id)
                        }
                      }}
                      style={[styles.modelOption, current && styles.modelOptionCurrent]}
                    >
                      <View style={styles.modelOptionCopy}>
                        <Text style={styles.modelOptionName} numberOfLines={1}>{effort.name}</Text>
                      </View>
                      {current && <Check size={16} color={colors.primary} />}
                    </Pressable>
                  )
                })}
              </>
            )}
          </ScrollView>
          {showEffortRow && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={zhCN.chat.reasoningEffort}
              onPress={() => setEffortView(true)}
              style={({ pressed }) => [styles.effortRow, pressed && styles.plusMenuOptionPressed]}
            >
              <Text style={styles.effortRowLabel}>{zhCN.chat.reasoningEffort}</Text>
              <View style={styles.plusMenuOptionValue}>
                <Text style={styles.effortRowValue} numberOfLines={1}>{activeEffort?.name ?? zhCN.chat.reasoningEffortDefault}</Text>
                <ChevronRight size={16} color={colors.muted} />
              </View>
            </Pressable>
          )}
      </ModalSurface>
    </Modal>
  )
}

/**
 * Keep the dismiss target behind the sheet instead of nesting Pressables.
 * Android's responder negotiation can otherwise let the backdrop consume a
 * child press, which makes every option in a transparent modal look inert.
 */
export function ModalSurface({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.modalBackdrop} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={zhCN.common.close}
        onPress={onClose}
        pointerEvents="box-only"
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.modalSheet} pointerEvents="box-none">{children}</View>
    </View>
  )
}

/** Keep the picker sheet within ~70% of the screen while letting long catalogs scroll. */
export function usePickerListMaxHeight(): number {
  const { height } = useWindowDimensions()
  return Math.max(180, Math.round(height * 0.7) - 96)
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



function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 60_000) return zhCN.time.justNow
  if (delta < 3_600_000) return zhCN.time.minutesAgo(Math.floor(delta / 60_000))
  if (delta < 86_400_000) return zhCN.time.hoursAgo(Math.floor(delta / 3_600_000))
  return new Date(timestamp).toLocaleDateString(zhCN.time.locale)
}

/** Resolve image dimensions for files that arrive without picker metadata (document picker). */
function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
  })
}

/** Official built-in mode copy, mirroring the DSH client "ui-agent-preset" locales. */
function builtinPresetName(id: string): string | undefined {
  switch (id) {
    case 'standard': return zhCN.chat.presetStandardName
    case 'ptc': return zhCN.chat.presetPtcName
    case 'minimal': return zhCN.chat.presetMinimalName
    case 'cordis': return zhCN.chat.presetCordisName
    default: return undefined
  }
}

function builtinPresetDescription(id: string): string | undefined {
  switch (id) {
    case 'standard': return zhCN.chat.presetStandardDescription
    case 'ptc': return zhCN.chat.presetPtcDescription
    case 'minimal': return zhCN.chat.presetMinimalDescription
    case 'cordis': return zhCN.chat.presetCordisDescription
    default: return undefined
  }
}

/** Host roster name, with official Chinese copy for the built-in presets. */
function agentPresetName(option: AgentPresetOption): string {
  return builtinPresetName(option.id) ?? option.name ?? option.id
}

function agentPresetDescription(option: AgentPresetOption): string | undefined {
  return builtinPresetDescription(option.id) ?? option.description
}

/** Official Chinese copy for the permission presets (DSH "ui-permission-presets"). */
function permissionDisplayName(value: string, fallback?: string): string {
  switch (value) {
    case 'read-only': return zhCN.chat.permissionReadOnly
    case 'workspace-write': return zhCN.chat.permissionWorkspaceWrite
    case 'danger-full-access': return zhCN.chat.permissionFullAccess
    default: return fallback ?? value
  }
}

function permissionDisplayDescription(value: string, fallback?: string): string | undefined {
  switch (value) {
    case 'read-only': return zhCN.chat.permissionReadOnlyDescription
    case 'workspace-write': return zhCN.chat.permissionWorkspaceWriteDescription
    case 'danger-full-access': return zhCN.chat.permissionFullAccessDescription
    default: return fallback
  }
}

function sessionTitle(session: RemoteSession): string {
  const title = resolveSessionDisplayTitle(session)
  if (title !== undefined) return title
  if (session.blank && session.parentSessionId === undefined) return zhCN.sessions.untitled
  return session.parentSessionId === undefined ? zhCN.sessions.untitled : zhCN.sessions.child
}

/** ui-chat has two independent folds: activity ranges, then a normally ended whole Turn. */
const ChatProcessGroup = memo(function ChatProcessGroup({ items, foldAllowed, busyAction, onApproval, onQuestion }: {
  items: ChatItem[]
  foldAllowed: boolean
  busyAction?: string
  onApproval: (itemId: string, outcome: 'allowed-once' | 'rejected') => Promise<void>
  onQuestion: (itemId: string, selected: Record<string, string[]>) => Promise<void>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [open, setOpen] = useState(false)
  const backend = useAppStore(state => state.selectedSession?.backend)
  const last = items.at(-1)
  const codexClosed = backend === 'codex' && !items.some(isActiveChatItem)
    && last?.kind === 'message' && last.role === 'assistant'
  const end = items.find(item => item.turnEnd !== undefined)?.turnEnd
    ?? (codexClosed ? { reason: 'completed' as const, time: 0 } : undefined)
  const pending = items.some(item => (item.kind === 'approval' || item.kind === 'question') && item.outcome === undefined)
  const canFold = end?.reason === 'completed' && foldAllowed && !pending
  const answer = end?.reason === 'completed' && last?.kind === 'message' && last.role === 'assistant'
    && (hasVisibleMessageText(last.text) || (last.images?.length ?? 0) > 0) ? last : undefined
  const process: ChatItem[] = answer === undefined ? items : [
    ...items.slice(0, -1),
    ...(hasVisibleMessageText(answer.reasoning ?? '') ? [{ ...answer, text: '', images: undefined }] : []),
  ]
  const segments = useMemo(() => processSegments(process), [items, answer])
  const expanded = !canFold || open
  const label = end?.reason === 'stopped' ? zhCN.chatProcess.stopped
    : end?.reason === 'failed' ? zhCN.chat.failed : zhCN.chat.completed
  return <View style={styles.processGroup}>
    {end !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ expanded, disabled: !canFold || process.length === 0 }}
      disabled={!canFold || process.length === 0} onPress={() => setOpen(value => !value)}
      style={({ pressed }) => [styles.turnProcessHeader, pressed && styles.reasoningHeaderPressed]}>
      <Text style={styles.turnProcessLabel}>{label}</Text>
      {canFold && process.length > 0 && (expanded ? <ChevronUp size={17} color={colors.muted} /> : <ChevronDown size={17} color={colors.muted} />)}
    </Pressable>}
    {expanded && segments.map((segment, index) => segment.kind === 'response'
      ? <MessageBubble key={segment.key} item={segment.item} compact />
      : <ChatActivityGroup key={segment.key} items={segment.items} closed={end !== undefined || index < segments.length - 1}
          busyAction={busyAction} onApproval={onApproval} onQuestion={onQuestion} />)}
    {answer !== undefined && <MessageBubble item={{ ...answer, reasoning: undefined }} compact />}
  </View>
})

const ChatActivityGroup = memo(function ChatActivityGroup({ items, closed, busyAction, onApproval, onQuestion }: {
  items: ChatItem[]
  closed: boolean
  busyAction?: string
  onApproval: (itemId: string, outcome: 'allowed-once' | 'rejected') => Promise<void>
  onQuestion: (itemId: string, selected: Record<string, string[]>) => Promise<void>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { height } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const body = useRef<ScrollView>(null)
  const pending = items.some(item => (item.kind === 'approval' || item.kind === 'question') && item.outcome === undefined)
  const expanded = pending || open
  const tools = items.filter((item): item is ToolActivity => item.kind === 'tool')
  const activeTool = closed ? undefined : tools.findLast(item => item.state === 'running')
  const runningReasoning = closed ? undefined : items.findLast(item => item.kind === 'message' && item.streamingPhase === 'reasoning')
  const running = activeTool !== undefined || runningReasoning !== undefined
  const counts = new Map<ProcessActivity, number>()
  for (const tool of tools) counts.set(toolActivity(tool), (counts.get(toolActivity(tool)) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([kind]) => kind)
  const labels = zhCN.chatProcess.processActivity
  const label = pending ? labels.questions.running
    : running ? labels[activeTool === undefined ? 'thinking' : toolActivity(activeTool)].running
      : completedProcessTitle(ranked)
  const detail = activeTool !== undefined ? processDetail(activeTool)
    : runningReasoning && runningReasoning.kind === 'message' ? compactActivityText(runningReasoning.reasoning)?.slice(-160) : undefined
  return <View style={styles.processGroup}>
    <Pressable accessibilityRole="button" accessibilityLabel={detail === undefined ? label : `${label} · ${detail}`}
      accessibilityState={{ expanded, disabled: pending }} disabled={pending}
      onPress={() => setOpen(value => !value)}
      style={({ pressed }) => [styles.processHeader, pressed && styles.reasoningHeaderPressed]}>
      {expanded ? <ChevronUp size={17} color={colors.muted} /> : <ChevronDown size={17} color={colors.muted} />}
      <Text style={styles.processLabel} numberOfLines={1}>{label}{detail === undefined ? '' : ` · ${detail}`}</Text>
    </Pressable>
    {expanded && <ScrollView ref={body} style={{ maxHeight: Math.min(400, height / 2) }} nestedScrollEnabled
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onLayout={() => { if (running) body.current?.scrollToEnd({ animated: false }) }}
      contentContainerStyle={styles.processBody}>
      {items.map(item => item.kind === 'message' && item.role === 'assistant' && !hasVisibleMessageText(item.text)
        ? <View key={item.id} style={styles.activityReasoning}><NativeMarkdown text={item.reasoning ?? ''} /></View>
        : <ChatItemView key={item.id} item={item} compact={false} busyAction={busyAction} onApproval={onApproval} onQuestion={onQuestion} />)}
    </ScrollView>}
  </View>
})

const ChatItemView = memo(function ChatItemView({ item, busyAction, compact, onApproval, onQuestion }: {
  item: ChatItem
  busyAction?: string
  compact: boolean
  onApproval: (itemId: string, outcome: 'allowed-once' | 'rejected') => Promise<void>
  onQuestion: (itemId: string, selected: Record<string, string[]>) => Promise<void>
}) {
  if (item.kind === 'approval') return <ApprovalCard item={item} busy={busyAction === `approval:${item.id}`} onRespond={onApproval} />
  if (item.kind === 'question') return <QuestionCard item={item} busy={busyAction === `question:${item.id}`} onRespond={onQuestion} />
  if (item.kind === 'tool') return <ToolRow item={item} compact={compact} />
  if (!compact && item.role === 'assistant'
    && !hasVisibleMessageText(item.text)
    && hasVisibleMessageText(item.reasoning ?? '')) return <ReasoningDisclosure item={item} />
  return <MessageBubble item={item} compact={compact} />
})

function MessageBubble({ item, compact }: { item: ChatMessage; compact: boolean }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const user = item.role === 'user'
  const remote = item.role === 'assistant'
  const showReasoning = !compact && remote && hasVisibleMessageText(item.reasoning ?? '')
  const showText = hasVisibleMessageText(item.text)
  const showImages = item.images !== undefined && item.images.length > 0
  const showStreaming = item.streaming === true && item.streamingPhase !== 'reasoning'

  // Harness renders assistant prose directly on the conversation canvas.
  if (remote) {
    return (
      <View style={styles.assistantBlock}>
        {showReasoning && <ReasoningDisclosure item={item} />}
        {showImages && <ChatImages images={item.images!} />}
        {showText && (
          <View style={styles.assistantText}>
            <NativeMarkdown text={item.text} />
          </View>
        )}
        {showStreaming && (
          <View style={styles.assistantText}>
            <StreamingCursor />
          </View>
        )}
        {!item.streaming && showText && <MessageActions item={item} />}
      </View>
    )
  }

  if (user) return <View style={styles.userBlock}>
    <View style={styles.userBubble}>
      {showImages && <ChatImages images={item.images!} alignEnd />}
      {showText && <NativeMarkdown text={item.text} />}
    </View>
    <MessageActions item={item} />
  </View>

  return (
    <View style={[styles.messageRow, user && styles.messageRowUser]}>
      <View style={[styles.avatar, user ? styles.avatarUser : styles.avatarAssistant]}>
        {user ? (
          <User size={16} color={colors.white} />
        ) : (
          <Bot size={17} color={colors.primary} />
        )}
      </View>
      <View style={[styles.messageBody, user && styles.messageBodyUser]}>
        <Text style={styles.messageLabel}>{user ? zhCN.chat.you : zhCN.chat.system}</Text>
        {showImages && <ChatImages images={item.images!} alignEnd={user} />}
        {showText && <NativeMarkdown text={item.text} />}
        {showStreaming && <StreamingCursor />}
      </View>
    </View>
  )
}

function ReasoningDisclosure({ item }: { item: ChatMessage }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [expanded, setExpanded] = useState(false)
  const active = item.streamingPhase === 'reasoning'
  const label = active ? zhCN.chat.reasoningActive : zhCN.chat.reasoning
  const preview = compactActivityText(item.reasoning) ?? ''
  const actionLabel = expanded ? zhCN.chat.reasoningCollapse : zhCN.chat.reasoningExpand
  return (
    <View style={styles.reasoningCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${actionLabel}。${preview}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
        style={({ pressed }) => [styles.reasoningHeader, pressed && styles.reasoningHeaderPressed]}
      >
        <Sparkles size={16} color={active ? colors.accent : colors.muted} />
        <Text style={[styles.reasoningLabel, active && styles.reasoningLabelActive]}>{label}</Text>
        <Text style={styles.activitySeparator}>·</Text>
        <Text style={styles.reasoningPreview} numberOfLines={1}>{preview}</Text>
        {expanded
          ? <ChevronDown size={17} color={colors.muted} />
          : <ChevronRight size={17} color={colors.muted} />}
      </Pressable>
      {expanded && <View style={styles.reasoningBody}><NativeMarkdown text={item.reasoning ?? ''} /></View>}
    </View>
  )
}

function ToolRow({ item, compact }: { item: ToolActivity; compact: boolean }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [expanded, setExpanded] = useState(false)
  const stateText = item.state === 'running' ? zhCN.status.running : item.state === 'failed' ? zhCN.chat.failed : zhCN.chat.completed
  const detail = processDetail(item)
  const name = toolDisplayName(item)
  const hasDetail = !compact && (item.callDetail !== undefined || item.resultDetail !== undefined)
  return (
    <View style={[styles.toolCard, expanded && styles.toolCardExpanded]}>
      <Pressable
        accessibilityRole={hasDetail ? 'button' : undefined}
        accessibilityLabel={hasDetail ? (expanded ? zhCN.chat.toolCollapse(name) : zhCN.chat.toolExpand(name)) : undefined}
        accessibilityState={hasDetail ? { expanded } : undefined}
        disabled={!hasDetail}
        onPress={() => setExpanded(value => !value)}
        style={({ pressed }) => [styles.toolRow, pressed && hasDetail && styles.toolRowPressed]}
      >
        <View style={styles.toolIcon}>{/command|bash|shell|命令|终端/i.test(item.toolName)
          ? <Terminal size={16} color={colors.muted} /> : <Code2 size={16} color={colors.muted} />}</View>
        <View style={styles.toolCopy}>
          <Text style={styles.toolName} numberOfLines={1}>{name}</Text>
          {detail !== undefined && <Text style={styles.activitySeparator}>·</Text>}
          {detail !== undefined && <Text style={styles.toolSummary} numberOfLines={1}>{detail}</Text>}
        </View>
        {item.state === 'failed' && <Text style={styles.toolFailed}>{stateText}</Text>}
        {hasDetail && (expanded
          ? <ChevronDown size={17} color={colors.muted} />
          : <ChevronRight size={17} color={colors.muted} />)}
      </Pressable>
      {item.images !== undefined && item.images.length > 0 && <ChatImages images={item.images} tool />}
      {expanded && hasDetail && (
        <View style={styles.toolDetails}>
          {item.callDetail !== undefined && <ToolDetailView label={zhCN.chat.toolCall} detail={item.callDetail} />}
          {item.resultDetail !== undefined && <ToolDetailView label={zhCN.chat.toolResult} detail={item.resultDetail} />}
        </View>
      )}
    </View>
  )
}

function ChatImages({ images, alignEnd = false, tool = false }: { images: ChatImage[]; alignEnd?: boolean; tool?: boolean }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={[styles.messageImages, alignEnd && styles.messageImagesUser, tool && styles.toolImages]}>
      {images.map((image, index) => image.uri !== undefined
        ? <Image key={`${image.uri}:${index}`} source={{ uri: image.uri }} style={styles.messageImage} resizeMode="cover" />
        : (
            <View key={`${image.name ?? 'image'}:${index}`} style={styles.messageImagePlaceholder}>
              <Images size={20} color={colors.primary} />
              <Text style={styles.messageImageName} numberOfLines={1}>{image.name ?? zhCN.chat.unnamedImage}</Text>
            </View>
          ))}
    </View>
  )
}

function ToolDetailView({ label, detail }: { label: string; detail: ToolDisplayDetail }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.toolDetailBlock}>
      <Text style={styles.toolDetailLabel}>{label}</Text>
      {detail.format === 'markdown'
        ? <NativeMarkdown text={detail.text} />
        : <Text selectable style={styles.toolDetailCode}>{detail.text}</Text>}
      {detail.truncated && <Text style={styles.toolDetailTruncated}>{zhCN.chat.toolTruncated}</Text>}
    </View>
  )
}

function compactActivityText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const compact = value.replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim()
  return compact.length === 0 ? undefined : compact
}

function ApprovalCard({ item, busy, onRespond }: {
  item: ApprovalActivity
  busy: boolean
  onRespond: (itemId: string, outcome: 'allowed-once' | 'rejected') => Promise<void>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  if (item.outcome !== undefined) {
    const denied = item.outcome === 'rejected' || item.outcome === 'cancelled' || item.outcome === 'unavailable'
    const handledElsewhere = item.outcome === 'unavailable'
    return (
      <View style={styles.permissionResolved}>
        {denied && !handledElsewhere ? <X size={18} color={colors.danger} /> : <Check size={18} color={colors.success} />}
        <Text style={styles.permissionResolvedText}>{handledElsewhere ? zhCN.chat.approvalHandled : denied ? zhCN.chat.denied : zhCN.chat.allowedOnce}</Text>
      </View>
    )
  }
  return (
    <View style={styles.permissionCard} accessibilityRole="alert">
      <View style={styles.permissionHeader}>
        <View style={styles.permissionIcon}><ShieldAlert size={20} color={colors.warning} /></View>
        <View style={styles.permissionHeaderCopy}>
          <Text style={styles.permissionTitle}>{zhCN.chat.permissionTitle}</Text>
          <Text style={styles.permissionKind}>{zhCN.chat.hostOperation(item.toolName)}</Text>
        </View>
      </View>
      {item.reason !== undefined && (
        <View style={styles.permissionDetail}>
          <Text selectable style={styles.permissionText}>{item.reason}</Text>
        </View>
      )}
      <Text style={styles.permissionScope}>{zhCN.chat.permissionScope}</Text>
      <View style={styles.permissionActions}>
        <Button label={zhCN.chat.allowOnce} onPress={() => void onRespond(item.id, 'allowed-once')} loading={busy} />
        <Button label={zhCN.chat.deny} variant="quiet" onPress={() => void onRespond(item.id, 'rejected')} disabled={busy} />
      </View>
    </View>
  )
}

function QuestionCard({ item, busy, onRespond }: {
  item: QuestionActivity
  busy: boolean
  onRespond: (itemId: string, selected: Record<string, string[]>) => Promise<void>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (item.deadline === undefined || item.outcome !== undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [item.deadline, item.outcome])
  const remaining = item.deadline === undefined ? undefined : Math.max(0, Math.ceil((item.deadline - now) / 1000))

  if (item.outcome !== undefined) {
    return (
      <View style={styles.permissionResolved}>
        <Check size={18} color={colors.success} />
        <Text style={styles.permissionResolvedText}>{item.outcome === 'answered' ? zhCN.chat.answered : item.outcome === 'queued' ? zhCN.chat.questionQueued : zhCN.chat.questionCancelled}</Text>
      </View>
    )
  }

  const toggle = (questionId: string, label: string, multi: boolean) => {
    setSelected(current => {
      const values = current[questionId] ?? []
      const next = multi
        ? (values.includes(label) ? values.filter(value => value !== label) : [...values, label])
        : values.includes(label) ? [] : [label]
      return { ...current, [questionId]: next }
    })
  }

  const allAnswered = item.questions.every(question => (selected[question.id] ?? []).length > 0)

  return (
    <View style={styles.questionCard} accessibilityRole="alert">
      <View style={styles.permissionHeader}>
        <View style={styles.permissionIcon}><ShieldAlert size={20} color={colors.accent} /></View>
        <View style={styles.permissionHeaderCopy}>
          <Text style={styles.permissionTitle}>{zhCN.chat.questionTitle}</Text>
          <Text style={styles.permissionKind}>{item.questionState === 'continued' ? zhCN.chat.questionContinued : remaining === undefined ? zhCN.chat.answerToContinue : zhCN.chat.questionRemaining(remaining)}</Text>
        </View>
      </View>
      {item.questions.map(question => (
        <View key={question.id} style={styles.questionBlock}>
          <Text style={styles.questionText}>{question.question}</Text>
          {question.detail !== undefined && <Text selectable style={styles.questionDetail}>{question.detail}</Text>}
          {(question.options ?? []).map(option => {
            const chosen = (selected[question.id] ?? []).includes(option.label)
            return (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                onPress={() => toggle(question.id, option.label, question.multiSelect === true)}
                style={[styles.optionRow, chosen && styles.optionChosen]}
              >
                <View style={[styles.optionDot, chosen && styles.optionDotChosen]}>{chosen && <Check size={12} color={colors.white} />}</View>
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            )
          })}
        </View>
      ))}
      <Button label={zhCN.chat.submitAnswer} onPress={() => void onRespond(item.id, selected)} loading={busy} disabled={!allAnswered || (item.questionState === 'open' && remaining === 0)} />
    </View>
  )
}

function WelcomeMessage() {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.welcome}>
      <Svg
        width={76}
        height={(76 * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
        viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      >
        <Path d={FISH_LOGO_PATH} fill={colors.ink} />
      </Svg>
      <View style={styles.welcomeRow}>
        <Text style={styles.welcomeSlogan}>{zhCN.chat.welcomeSlogan}</Text>
        <View style={styles.welcomeBadge}>
          <Text style={styles.welcomeBadgeText}>{zhCN.chat.welcomeBadge}</Text>
        </View>
      </View>
    </View>
  )
}

function StreamingCursor() {
  const opacity = useRef(new Animated.Value(1)).current
  const styles = useThemedStyles(createStyles)

  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.2, duration: 450, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]))
    animation.start()
    return () => animation.stop()
  }, [opacity])

  return <Animated.View style={[styles.streamingCursor, { opacity }]} accessibilityLabel={zhCN.chat.generating} />
}

function ReplyStatusDots() {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const progress = useRef(new Animated.Value(0)).current
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (reduceMotion) return
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 3,
      duration: 900,
      useNativeDriver: true,
    }))
    animation.start()
    return () => animation.stop()
  }, [progress, reduceMotion])

  return (
    <View style={styles.replyDots} importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map(index => (
        <Animated.Text
          key={index}
          style={[styles.replyDot, { color: colors.accent, opacity: reduceMotion ? 1 : progress.interpolate({
              inputRange: [index, index + 0.5, index + 1],
              outputRange: [0.25, 1, 0.25],
              extrapolate: 'clamp',
            }) }]}
        >·</Animated.Text>
      ))}
    </View>
  )
}

function isActiveChatItem(item: ChatItem): boolean {
  if (item.turnEnd !== undefined) return false
  if (item.kind === 'message') return item.streaming === true
  if (item.kind === 'tool') return item.state === 'running'
  if (item.kind === 'approval' || item.kind === 'question') return item.outcome === undefined
  return false
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  modelChip: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.surfaceStrong },
  permissionChip: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  permissionChipDisabled: { opacity: 0.52 },
  modelChipText: { ...type.smallStrong, color: colors.ink, flexShrink: 1 },
  olderButton: { alignSelf: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  olderText: { ...type.smallStrong, color: colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
  // Keep the sheet above the full-screen dismiss target on Android. Without an
  // explicit stacking order, the transparent backdrop can win hit testing on
  // some RN/Android combinations even though it is rendered first.
  modalSheet: { zIndex: 1, elevation: 1, maxHeight: '70%', backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.md },
  modalHeaderCopy: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  modalTitle: { ...type.heading, color: colors.ink, flexShrink: 1 },
  modalListContent: { paddingBottom: spacing.xs },
  pickerHint: { ...type.caption, color: colors.muted, marginBottom: spacing.sm },
  pickerEmpty: { paddingVertical: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
  modelGroupBlock: { marginBottom: spacing.md },
  modelGroupTitle: { ...type.caption, color: colors.muted, textTransform: 'uppercase', marginBottom: spacing.xs },
  modelOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs },
  modelOptionCurrent: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  modelOptionCopy: { minWidth: 0, flex: 1 },
  modelOptionName: { ...type.small, color: colors.ink },
  permissionOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.xs },
  permissionOptionCopy: { flex: 1 },
  permissionOptionName: { ...type.small, color: colors.ink },
  permissionOptionDescription: { ...type.caption, color: colors.muted, marginTop: 2 },
  modelFailures: { ...type.caption, color: colors.danger, marginTop: spacing.sm },
  connectionBanner: { minHeight: 40, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, backgroundColor: colors.warningSoft, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  connectionDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.warning },
  connectionBannerText: { ...type.small, color: colors.ink, flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.xxs },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginVertical: spacing.xs },
  messageRowUser: { flexDirection: 'row-reverse' },
  assistantBlock: { alignSelf: 'stretch', gap: spacing.xxs, marginVertical: spacing.xs },
  assistantText: { paddingHorizontal: 0 },
  userBlock: { alignSelf: 'flex-end', maxWidth: '88%', marginVertical: spacing.sm },
  userBubble: { backgroundColor: colors.surfaceStrong, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  avatar: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  avatarUser: { backgroundColor: colors.primary },
  avatarAssistant: { backgroundColor: colors.primarySoft },
  remoteAvatarLogo: { width: 32, height: 32 },
  messageBody: { flex: 1, maxWidth: '88%' },
  messageBodyUser: { alignItems: 'flex-end' },
  messageLabel: { ...type.caption, color: colors.muted, marginBottom: 4 },
  messageImages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  messageImagesUser: { justifyContent: 'flex-end' },
  toolImages: { marginLeft: 32, marginRight: spacing.xs, marginBottom: spacing.sm },
  messageImage: { width: 132, height: 104, borderRadius: radius.md, backgroundColor: colors.surfaceStrong },
  messageImagePlaceholder: { width: 132, minHeight: 76, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', padding: spacing.sm, gap: spacing.xs },
  messageImageName: { ...type.caption, color: colors.primary, maxWidth: '100%' },
  reasoningCard: { alignSelf: 'stretch', borderRadius: radius.md, overflow: 'hidden' },
  reasoningHeader: { minHeight: 48, paddingHorizontal: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  reasoningHeaderPressed: { backgroundColor: colors.surfaceStrong },
  reasoningLabel: { ...type.smallStrong, color: colors.muted },
  reasoningLabelActive: { color: colors.accent },
  reasoningPreview: { ...type.small, color: colors.muted, flex: 1 },
  activitySeparator: { ...type.small, color: colors.subtle },
  reasoningBody: { backgroundColor: colors.surface, padding: spacing.sm, marginHorizontal: spacing.xs, marginBottom: spacing.xs, borderRadius: radius.sm },
  processGroup: { alignSelf: 'stretch' },
  processHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm },
  processLabel: { ...type.small, color: colors.muted, flex: 1 },
  turnProcessHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  turnProcessLabel: { ...type.small, color: colors.muted },
  activityReasoning: { paddingVertical: spacing.xs },
  processBody: { gap: spacing.xxs },
  streamingCursor: { width: 7, height: 16, backgroundColor: colors.accent, borderRadius: 2, marginTop: 3 },
  toolCard: { borderRadius: radius.md, overflow: 'hidden' },
  toolCardExpanded: { backgroundColor: colors.surface },
  toolRow: { minHeight: 48, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  toolRowPressed: { backgroundColor: colors.surfaceStrong },
  toolIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  toolCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolName: { ...type.small, color: colors.muted, flexShrink: 1 },
  toolSummary: { ...type.small, color: colors.muted, flex: 1 },
  toolStateGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  toolState: { ...type.caption, color: colors.success },
  toolFailed: { color: colors.danger },
  toolDetails: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, padding: spacing.sm, gap: spacing.md },
  toolDetailBlock: { gap: spacing.xs },
  toolDetailLabel: { ...type.caption, color: colors.muted },
  toolDetailCode: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20, color: colors.ink, backgroundColor: colors.surfaceStrong, borderRadius: radius.sm, padding: spacing.sm },
  toolDetailTruncated: { ...type.caption, color: colors.warning },
  permissionCard: { borderRadius: radius.lg, backgroundColor: colors.warningSoft, padding: spacing.md, gap: spacing.md, marginVertical: spacing.xs },
  questionCard: { borderRadius: radius.lg, backgroundColor: colors.accentSoft, padding: spacing.md, gap: spacing.md, marginVertical: spacing.xs },
  permissionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  permissionIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  permissionHeaderCopy: { flex: 1 },
  permissionTitle: { ...type.bodyStrong, color: colors.ink },
  permissionKind: { ...type.small, color: colors.muted },
  permissionDetail: { backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.sm },
  permissionCode: { fontFamily: 'monospace', fontSize: 14, lineHeight: 21, color: colors.ink },
  permissionText: { ...type.body, color: colors.ink },
  permissionScope: { ...type.caption, color: colors.muted },
  permissionActions: { gap: spacing.xs },
  permissionResolved: { borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.sm, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', marginVertical: spacing.xs },
  permissionResolvedText: { ...type.smallStrong, color: colors.ink },
  questionBlock: { gap: spacing.xs },
  questionText: { ...type.bodyStrong, color: colors.ink },
  questionDetail: { ...type.small, color: colors.muted },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  optionChosen: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionDot: { width: 20, height: 20, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  optionDotChosen: { borderColor: colors.accent, backgroundColor: colors.accent },
  optionLabel: { ...type.small, color: colors.ink, flex: 1 },
  welcome: { alignItems: 'center', paddingHorizontal: spacing.xl },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  welcomeSlogan: { ...type.heading, color: colors.ink },
  welcomeBadge: { borderRadius: radius.pill, backgroundColor: colors.surfaceStrong, paddingHorizontal: spacing.sm, paddingVertical: 3, marginTop: 2 },
  welcomeBadgeText: { fontSize: 11, fontWeight: '600', color: colors.muted },
  mentionBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.menuDismiss },
  composerWrap: { backgroundColor: colors.background, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },

  replyStatus: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  replyStatusText: { ...type.small, color: colors.accent },
  replyDots: { flexDirection: 'row', alignItems: 'center', marginLeft: -spacing.xs },
  replyDot: { ...type.caption, fontSize: 18, lineHeight: 18, fontWeight: '700' },
  imageTray: { gap: spacing.xs, paddingBottom: spacing.xs },
  imagePreviewWrap: { width: 72, height: 72 },
  imagePreview: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceStrong },
  removeImageButton: { position: 'absolute', right: -3, top: -3, width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  composerCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.background, paddingHorizontal: spacing.xs, paddingTop: spacing.xxs, paddingBottom: spacing.xs, gap: spacing.xxs },
  composerControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: 2 },
  composerSpacer: { flex: 1 },
  // Keep the actual target at the Android 48dp minimum. hitSlop is not
  // reliable when a control sits inside a clipped/native text-input surface.
  plusButton: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.surfaceStrong, alignItems: 'center', justifyContent: 'center' },
  quickPromptsButton: { minWidth: 48, flexShrink: 0, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.surfaceStrong, alignItems: 'center', justifyContent: 'center' },
  quickPromptsText: { ...type.smallStrong, color: colors.primary },
  plusPressed: { opacity: 0.7 },
  plusDisabled: { opacity: 0.52 },
  plusMenuOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.xs },
  plusMenuOptionPressed: { backgroundColor: colors.surfaceStrong },
  plusMenuOptionDisabled: { opacity: 0.5 },
  plusMenuOptionText: { ...type.body, color: colors.ink, flex: 1 },
  plusCardRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  plusCard: { flex: 1, minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingHorizontal: spacing.xxs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  plusCardText: { ...type.smallStrong, color: colors.ink },
  plusMenuOptionValue: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  plusMenuOptionValueText: { ...type.small, color: colors.muted, flexShrink: 1 },
  modeLoading: { paddingVertical: spacing.lg, alignItems: 'center' },
  effortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: spacing.xs },
  effortRowLabel: { ...type.smallStrong, color: colors.ink },
  effortRowValue: { ...type.small, color: colors.muted, flexShrink: 1 },
  composerInputWrap: { position: 'relative' },

  composerInput: { ...type.body, color: colors.ink, minHeight: 40, maxHeight: 126, paddingVertical: 8, paddingHorizontal: spacing.sm, textAlignVertical: 'top' },

  sendButton: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendPressed: { backgroundColor: colors.primaryPressed },
  stopButton: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  stopPressed: { opacity: 0.78 },
  sendDisabled: { backgroundColor: colors.disabled },
  composerHint: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: 5 },
  promptInputLabel: { ...type.caption, color: colors.muted, marginBottom: 4, marginTop: 4 },
  promptInput: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink, paddingHorizontal: spacing.sm, paddingVertical: 8, ...type.body, minHeight: 40 },
  promptTextArea: { minHeight: 88, textAlignVertical: 'top' },
  })
}
