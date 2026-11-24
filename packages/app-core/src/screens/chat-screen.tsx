import { useAttentionStore } from '../state/attention-store'
import * as Haptics from 'expo-haptics'
import { ArrowDown, ArrowLeft, ArrowRightLeft, FileText, Film, Menu, MessageSquare, MoreHorizontal, RefreshCw, X } from 'lucide-react-native'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  BackHandler,
  DeviceEventEmitter,
  Easing,
  FlatList,
  Image,
  Keyboard,
  Modal,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { Alert } from '../ui/alert'
import { shouldConfirmSwipeRightOpen, shouldStartSwipeRightToOpen } from '../lib/gesture-swipe-rules'
import { formatHandoffPayload, type PendingHandoffDraft } from '../lib/handoff-context'
import { isSubagentSession } from '../lib/session-kind'
import { applyChangeQuoteDraft } from '../lib/unified-diff'
import { isAcpManagedBackend, workspaceStableKey } from '../lib/workspace-key'
import { strings } from '../locales/i18n'
import { sessionPermissions } from '../services/session-permissions'
import type { CustomPrompt } from '../services/storage'
import { BUILT_IN_PROMPTS } from '../services/storage'
import type { ChatSection } from '../state/message-helpers'
import { isKnownBotSessionId, useBotTeamStore } from '../state/bot-store'
import { chatImageConnectionGeneration, requireConnectionRpc, requireSessionTools, sessionChatImageLoader, useAppStore } from '../state/store'
import { type UiArtifact } from '../state/ui-artifacts'
import type {
  ChatFile,
  ChatItem,
  ModelCatalogModel,
  ModelProviderGroup,
  PermissionSelect,
  PromptImage,
  RemoteSession,
  WorkspaceView
} from '../types'
import { AnimatedEllipsis } from '../ui/animated-ellipsis'
import { ChatImageProvider } from '../ui/chat-image'
import { BlurHeaderFrame, IconButton, TopBar } from '../ui/components'
import { KeyboardInset } from '../ui/keyboard-inset'
import { decodeSessionMentionUri, markdownFilePath, MarkdownLinkProvider, openSafeExternalUrl } from '../ui/markdown'
import { NavigationFocusProvider, useNavigationFocused } from '../ui/mention-popover'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { useResponsiveLayout } from '../ui/responsive'
import { spacing } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { easingCurve, resolveMotion, type Rect } from '../ui/motion'
import { triggerLightHaptic } from '../ui/haptics'
import { useReduceMotion } from '../ui/use-reduce-motion'
import { AutomationTasksModal } from './automation-tasks-modal'
import { ChatErrorBoundary } from './chat-error-boundary'
import {
  formatDurationMs,
  formatFileBytes,
  formatUploadedFilesPrompt,
  formatUploadedFilesReferencePrompt,
  isDirectTransportMode,
  isVideoFile,
  uploadStagedFilesToWorkspace,
  workspaceUploadMaxBytes,
  type StagedFile,
  type UploadProgress
} from './chat-files'
import { ChatTrajectory } from './chat-trajectory'
import { ChatActionMenu } from './chat/action-menu'
import { shouldLoadAgentPresets } from './chat/agent-presets-gate'
import { createModalActionQueue } from './chat/modal-action-queue'
import { BACKEND_CHAT_TEXT_KEYS, ChatComposer } from './chat/composer'
import { applyQuickPromptDraft, composerEditable, submitIntent } from './chat/composer-gate'
import { ExpandedComposer } from './chat/expanded-composer'
import {
  ChatImages,
  ChatItemView,
  ChatProcessGroup,
  isActiveChatItem,
  MarkdownChunkRow,
  QueueDock,
  ReplyStatusBanner,
  WelcomeMessage
} from './chat/messages'
import type { DisplayChatSection } from './chat/transcript-chunks'
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
import { HandoffDraftPreviewModal, HandoffModal, harnessDisplayName } from './chat/handoff-modal'
import { SessionInfo } from './chat/session-info'
import { createStyles } from './chat/styles'
import { formatUploadedChatFiles } from './chat/submitted-files'
import { useChatAttachments } from './chat/use-chat-attachments'
import { useChatBackHandler } from './chat/use-chat-back-handler'
import { useChatMentions } from './chat/use-chat-mentions'
import { useChatPrompts } from './chat/use-chat-prompts'
import { useChatScroll } from './chat/use-chat-scroll'
import { useChatTranscript } from './chat/use-chat-transcript'
import { BotModeScreen } from './bot-mode-screen'
import { useLiveSessionStatus } from './device-screens'
import { HostSessionsDrawer } from './host-sessions-drawer'
import { PluginsModal } from './plugins-modal'
import { ReferenceChatModal, ReferencedChatPills } from './bot/reference-chat-modal'
import type { ReferenceChatCandidate } from './bot/at-menu'
import { SessionToolsPanel, type SessionToolsMode } from './session-tools-panel'
import { FileViewerModal } from './workspace-file-viewer'

import { browseKey, browseScope, updateBrowseEntry, useBrowseMemory } from '../services/browse-memory'
import { formatQuoteText, QuotePreview } from '../ui/quote-preview'
const EMPTY_QUOTES: string[] = []
const EMPTY_IMAGES: PromptImage[] = []
const EMPTY_CHAT_ITEMS: ChatItem[] = []
const EMPTY_UI_ARTIFACTS: UiArtifact[] = []

/** Hard cap mirroring the largest backend prompt budget (ACP/CodeX 256 KiB). */
const LONG_DRAFT_MAX = 256_000
const NOOP = () => {}
const FALSE_REF: RefObject<boolean> = { current: false }

function useEdgeSwipeOpen(
  splitNav: boolean,
  drawerOpenRef: RefObject<boolean>,
  trajectoryRef: RefObject<boolean>,
  openSessionsDrawer: () => void,
) {
  const edgeSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_evt, g) => {
          if (splitNav || drawerOpenRef.current) return false
          return shouldStartSwipeRightToOpen({ dx: g.dx, dy: g.dy, x0: g.x0 }, trajectoryRef.current)
        },
        onMoveShouldSetPanResponderCapture: (_evt, g) => {
          if (splitNav || drawerOpenRef.current) return false
          return shouldStartSwipeRightToOpen({ dx: g.dx, dy: g.dy, x0: g.x0 }, trajectoryRef.current)
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_evt, g) => {
          if (splitNav || drawerOpenRef.current) return
          if (shouldConfirmSwipeRightOpen({ dx: g.dx, dy: g.dy, x0: g.x0, vx: g.vx })) {
            openSessionsDrawer()
          }
        },
      }),
    [splitNav, drawerOpenRef, trajectoryRef, openSessionsDrawer],
  )
  const swipeStartRef = useRef<{ x0: number; y0: number; t0: number } | undefined>(undefined)
  return useMemo(
    () => ({
      ...edgeSwipeResponder.panHandlers,
      onTouchStart: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
        swipeStartRef.current = { x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, t0: Date.now() }
      },
      onTouchEnd: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
        const start = swipeStartRef.current
        swipeStartRef.current = undefined
        if (start === undefined || splitNav || drawerOpenRef.current) return
        const dx = e.nativeEvent.pageX - start.x0
        const dy = e.nativeEvent.pageY - start.y0
        const dt = Math.max(16, Date.now() - start.t0)
        const vx = dx / dt
        if (
          shouldStartSwipeRightToOpen({ dx, dy, x0: start.x0 }, trajectoryRef.current)
          && shouldConfirmSwipeRightOpen({ dx, dy, x0: start.x0, vx })
        ) {
          openSessionsDrawer()
        }
      },
    }),
    [edgeSwipeResponder, splitNav, drawerOpenRef, trajectoryRef, openSessionsDrawer],
  )
}

function ComposerFocusGate({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  const parentFocused = useNavigationFocused()
  return <NavigationFocusProvider value={parentFocused && !disabled}>{children}</NavigationFocusProvider>
}

/** Keeps an unopened SheetModal picker completely unmounted until first requested. */
function LazySheetHost({ visible, render }: { visible: boolean; render: () => ReactNode }) {
  const openedRef = useRef(visible)
  if (visible) openedRef.current = true
  if (!openedRef.current) return null
  return <>{render()}</>
}

function BotChatImageProvider({ hostId, connected, children }: {
  hostId: string | undefined
  connected: boolean
  children: ReactNode
}) {
  const session = useAppStore(state => state.selectedSession)
  const imageGeneration = chatImageConnectionGeneration()
  const imageLoader = useMemo(
    () => session === undefined || !connected ? undefined : sessionChatImageLoader(session),
    [session?.sessionId, session?.backend, hostId, imageGeneration, connected],
  )
  return <ChatImageProvider value={imageLoader}>{children}</ChatImageProvider>
}

function BotModeBackHandler({
  active,
  splitNav,
  drawerOpenRef,
  drawerBackRef,
  onOpenSessionsDrawer,
  onBack,
}: {
  active: boolean
  splitNav: boolean
  drawerOpenRef: RefObject<boolean>
  drawerBackRef: RefObject<(() => boolean) | undefined>
  onOpenSessionsDrawer: () => void
  onBack: () => void
}) {
  const latestRef = useRef({ active, splitNav, onOpenSessionsDrawer, onBack })
  latestRef.current = { active, splitNav, onOpenSessionsDrawer, onBack }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const { active: isActive, splitNav: isSplit, onOpenSessionsDrawer: openDrawer, onBack: leave } = latestRef.current
      if (!isActive) return false
      if (!isSplit && drawerOpenRef.current) {
        return drawerBackRef.current?.() ?? false
      }
      if (!isSplit && !drawerOpenRef.current) {
        Keyboard.dismiss()
        openDrawer()
        return true
      }
      Keyboard.dismiss()
      leave()
      return true
    })
    return () => subscription.remove()
  }, [drawerOpenRef, drawerBackRef])
  return null
}

export function ChatScreen({
  active = true,
  suppressAutoSelect = false,
  onBack = NOOP,
  onOpenDevices: _onOpenDevices,
  onNewSession,
  onOpenWorkspaces,
  onOpenDeviceInfo,
  onOpenHostSwitcher,
  onOpenAttentionInbox,
  onOpenSettings,
  onOpenAbout,
  botMode = false,
  externalOpenRevision,
  botConversationId,
  onBotModeChange,
  onSelectBot,
}: {
  active?: boolean
  suppressAutoSelect?: boolean
  onBack?: () => void
  onOpenDevices?: () => void
  onNewSession?: () => void
  onOpenWorkspaces?: (focusWorkspaceKey?: string) => void
  onOpenDeviceInfo?: () => void
  onOpenHostSwitcher?: () => void
  onOpenAttentionInbox?: () => void
  onOpenSettings?: () => void
  onOpenAbout?: () => void
  botMode?: boolean
  externalOpenRevision?: number
  botConversationId?: string
  onBotModeChange?: (botMode: boolean) => void
  onSelectBot?: (id?: string) => void
}) {
  const styles = useThemedStyles(createStyles)
  const { splitNav } = useResponsiveLayout()
  const hostId = useAppStore(state => state.selectedDevice?.deviceId)
  const pluginsAvailable = useAppStore(state => state.connection.phase === 'connected')

  const [sessionsOpen, setSessionsOpen] = useState(true)
  const [drawerEntrance, setDrawerEntrance] = useState<'immediate' | 'slide'>('immediate')
  // Cold start parks the sidebar full-screen before any page is chosen; swiping
  // or pressing back must not drop the user into an arbitrary conversation.
  const [drawerSwipeUnlocked, setDrawerSwipeUnlocked] = useState(false)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [automationTasksOpen, setAutomationTasksOpen] = useState(false)
  const [handoffTarget, setHandoffTarget] = useState<{ session: RemoteSession; workspace?: WorkspaceView } | undefined>(undefined)

  const drawerBackRef = useRef<(() => boolean) | undefined>(undefined)
  const drawerCloseRef = useRef<((options?: { withHaptic?: boolean; force?: boolean }) => void) | undefined>(undefined)
  const drawerOpenRef = useRef(sessionsOpen && !splitNav)
  drawerOpenRef.current = sessionsOpen && !splitNav
  const splitNavRef = useRef(splitNav)
  splitNavRef.current = splitNav
  const cancelScrollRef = useRef<(() => void) | undefined>(undefined)
  const onDrawerClosedRef = useRef<(() => void) | undefined>(undefined)
  const closeMentionRef = useRef<(() => void) | undefined>(undefined)
  const openFileLinkRef = useRef<((path: string) => void) | undefined>(undefined)
  const lastAgentSessionByScopeRef = useRef<Record<string, RemoteSession | undefined>>({})
  const selectRequestSeqRef = useRef(0)

  const onBackPropRef = useRef(onBack)
  onBackPropRef.current = onBack
  const onNewSessionRef = useRef(onNewSession)
  onNewSessionRef.current = onNewSession
  const onOpenWorkspacesRef = useRef(onOpenWorkspaces)
  onOpenWorkspacesRef.current = onOpenWorkspaces
  const onOpenDeviceInfoRef = useRef(onOpenDeviceInfo)
  onOpenDeviceInfoRef.current = onOpenDeviceInfo
  const onOpenHostSwitcherRef = useRef(onOpenHostSwitcher)
  onOpenHostSwitcherRef.current = onOpenHostSwitcher
  const onOpenSettingsRef = useRef(onOpenSettings)
  onOpenSettingsRef.current = onOpenSettings
  const onOpenAboutRef = useRef(onOpenAbout)
  onOpenAboutRef.current = onOpenAbout
  const onBotModeChangeRef = useRef(onBotModeChange)
  onBotModeChangeRef.current = onBotModeChange
  const onSelectBotRef = useRef(onSelectBot)
  onSelectBotRef.current = onSelectBot

  const markConversationChosen = useCallback(() => setDrawerSwipeUnlocked(true), [])

  const lastHostIdRef = useRef(hostId)
  useEffect(() => {
    if (hostId === lastHostIdRef.current) return
    lastHostIdRef.current = hostId
    closeMentionRef.current?.()
    cancelScrollRef.current?.()
    setDrawerSwipeUnlocked(false)
    setDrawerEntrance('immediate')
    setSessionsOpen(true)
    setHandoffTarget(undefined)
  }, [hostId])

  // Explicit navigation must also reveal an already selected conversation.
  // A revision (rather than session identity) handles repeated notification taps.
  useEffect(() => {
    if (externalOpenRevision === undefined) return
    setDrawerSwipeUnlocked(true)
    setSessionsOpen(false)
  }, [externalOpenRevision])

  // splitNav (from useResponsiveLayout) keeps the session list visible beside
  // the conversation. Short landscape phone windows stay single-pane; a wide
  // tablet keeps the split even while the IME reduces the window height.
  useEffect(() => {
    if (splitNav) setSessionsOpen(false)
  }, [splitNav])

  const prevOverlayDrawerOpenRef = useRef(sessionsOpen && !splitNav)
  useEffect(() => {
    const overlayOpen = sessionsOpen && !splitNav
    const wasOverlayOpen = prevOverlayDrawerOpenRef.current
    prevOverlayDrawerOpenRef.current = overlayOpen
    if (overlayOpen && !wasOverlayOpen) {
      cancelScrollRef.current?.()
    } else if (!overlayOpen && wasOverlayOpen) {
      onDrawerClosedRef.current?.()
    }
  }, [sessionsOpen, splitNav])

  const openSessionsDrawer = useCallback(() => {
    if (typeof Keyboard.isVisible !== 'function' || Keyboard.isVisible()) Keyboard.dismiss()
    closeMentionRef.current?.()
    cancelScrollRef.current?.()
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
    // Reached from a conversation, so the sidebar may be swiped away again.
    setDrawerSwipeUnlocked(true)
    setDrawerEntrance('slide')
    setSessionsOpen(true)
  }, [])

  const stableOnBack = useCallback(() => onBackPropRef.current(), [])
  const stableOnNewSession = useCallback(() => onNewSessionRef.current?.(), [])
  const stableOnOpenWorkspaces = useCallback((focusWorkspaceKey?: string) => onOpenWorkspacesRef.current?.(focusWorkspaceKey), [])
  const stableOnOpenHostSwitcher = useCallback(() => onOpenHostSwitcherRef.current?.(), [])
  const stableOnOpenAbout = useCallback(() => onOpenAboutRef.current?.(), [])
  const stableOnBotModeChange = useCallback((nextBotMode: boolean) => onBotModeChangeRef.current?.(nextBotMode), [])
  const handleBotSelect = useCallback((id?: string) => onSelectBotRef.current?.(id), [])
  const handleBotDeviceInfo = useCallback(() => onOpenDeviceInfoRef.current?.(), [])
  const handleBotMore = useCallback(() => onOpenSettingsRef.current?.(), [])

  const handleDrawerSelectBot = useCallback((id: string) => {
    markConversationChosen()
    onSelectBotRef.current?.(id)
  }, [markConversationChosen])
  const handleDrawerOpenDeviceInfo = useCallback(() => {
    Keyboard.dismiss()
    onOpenDeviceInfoRef.current?.()
  }, [])
  const handleDrawerOpenWorkspaces = useCallback(() => {
    Keyboard.dismiss()
    onOpenWorkspacesRef.current?.()
  }, [])
  const handleDrawerBack = useCallback(() => {
    Keyboard.dismiss()
    setSessionsOpen(false)
  }, [])
  const handleInlineDrawerClose = useCallback(() => {
    Keyboard.dismiss()
  }, [])
  const handleOverlayDrawerClose = useCallback(() => {
    setDrawerSwipeUnlocked(true)
    setSessionsOpen(false)
  }, [])
  const handleDrawerOpenAutomationTasks = useCallback(() => {
    Keyboard.dismiss()
    setAutomationTasksOpen(true)
  }, [])
  const handleDrawerOpenPlugins = useCallback(() => {
    Keyboard.dismiss()
    setPluginsOpen(true)
  }, [])
  const handleDrawerOpenHostSwitcher = useCallback(() => {
    Keyboard.dismiss()
    onOpenHostSwitcherRef.current?.()
  }, [])
  const handleDrawerOpenSettings = useCallback(() => {
    Keyboard.dismiss()
    onOpenSettingsRef.current?.()
  }, [])

  const scheduleOverlayDrawerClose = useCallback((seq: number) => {
    requestAnimationFrame(() => {
      if (selectRequestSeqRef.current !== seq) return
      if (splitNavRef.current) return
      if (drawerCloseRef.current !== undefined) {
        drawerCloseRef.current({ withHaptic: false, force: true })
      } else {
        setDrawerSwipeUnlocked(true)
        setSessionsOpen(false)
      }
    })
  }, [])

  const handleDrawerSelect = useCallback(async (next: RemoteSession) => {
    const seq = ++selectRequestSeqRef.current
    if (splitNavRef.current) markConversationChosen()
    const pending = useAppStore.getState().openSession(next)
    onBotModeChangeRef.current?.(false)
    const visible = useAppStore.getState().selectedSession?.sessionId === next.sessionId
    if (!splitNavRef.current && visible) {
      scheduleOverlayDrawerClose(seq)
    }
    if (await pending && !splitNavRef.current && !visible) {
      scheduleOverlayDrawerClose(seq)
    }
  }, [markConversationChosen, scheduleOverlayDrawerClose])

  const openLink = useCallback((href: string) => {
    // 1. Session reference navigation: dsh-session:<base64url>
    const targetSessionId = decodeSessionMentionUri(href)
    if (targetSessionId !== undefined) {
      const matchedBot = useBotTeamStore.getState().state?.bots.find(entry => entry.sessionId === targetSessionId)
      if (matchedBot !== undefined) {
        onBotModeChangeRef.current?.(true)
        onSelectBotRef.current?.(matchedBot.id)
        return
      }
      const storeState = useAppStore.getState()
      const targetSession = storeState.sessions.find(candidate => candidate.sessionId === targetSessionId)
      if (targetSession !== undefined) {
        void storeState.openSession(targetSession)
      }
      return
    }

    // 2. Safe external web URLs (http, https, mailto, www.*)
    if (openSafeExternalUrl(href)) return

    // 3. Workspace file link
    const path = markdownFilePath(href)
    if (path === undefined) return
    openFileLinkRef.current?.(path)
  }, [])

  const switchToAgentMode = useCallback(() => {
    const storeState = useAppStore.getState()
    const botTeamState = useBotTeamStore.getState().state
    const memoryScope = browseScope(storeState)
    const candidates = storeState.sessions.filter(
      item => !storeState.archivedSessionIds.includes(item.sessionId)
        && !isKnownBotSessionId(item.sessionId, botTeamState, memoryScope),
    )
    const remembered = lastAgentSessionByScopeRef.current[memoryScope]
    const preferred = remembered
      ? candidates.find(item => item.sessionId === remembered.sessionId && (item.backend ?? 'harness') === (remembered.backend ?? 'harness'))
      : undefined
    const target = preferred ?? [...candidates].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
    if (target !== undefined) {
      void storeState.openSession(target)
    } else if (storeState.selectedSession !== undefined && isKnownBotSessionId(storeState.selectedSession.sessionId, botTeamState, memoryScope)) {
      useAppStore.setState({ selectedSession: undefined })
    }
    onBotModeChangeRef.current?.(false)
  }, [])

  const closePluginsModal = useCallback(() => setPluginsOpen(false), [])
  const closeAutomationTasksModal = useCallback(() => setAutomationTasksOpen(false), [])
  const handleOpenHandoff = useCallback((target: RemoteSession, workspace?: WorkspaceView) => {
    Keyboard.dismiss()
    setHandoffTarget({ session: target, workspace })
  }, [])
  const closeHandoffModal = useCallback(() => setHandoffTarget(undefined), [])
  const handleHandoffCompleted = useCallback(() => {
    markConversationChosen()
    if (!splitNavRef.current) setSessionsOpen(false)
    onBotModeChangeRef.current?.(false)
  }, [markConversationChosen])
  const handleAutomationOpenSession = useCallback(async (targetSession: RemoteSession) => {
    markConversationChosen()
    const opened = await useAppStore.getState().openSession(targetSession)
    onBotModeChangeRef.current?.(false)
    if (opened && !splitNavRef.current) setSessionsOpen(false)
    setAutomationTasksOpen(false)
  }, [markConversationChosen])
  const handleAutomationNewTask = useCallback(async () => {
    markConversationChosen()
    const storeState = useAppStore.getState()
    const currentSession = storeState.selectedSession
    const defaultTaskWorkspaceId =
      (currentSession === undefined
        ? undefined
        : storeState.workspaces.find(w => w.sessionIds.includes(currentSession.sessionId))?.workspaceId)
      ?? storeState.workspaces[0]?.workspaceId
    const created = await storeState.createSession(defaultTaskWorkspaceId)
    onBotModeChangeRef.current?.(false)
    if (created && !splitNavRef.current) setSessionsOpen(false)
    setAutomationTasksOpen(false)
  }, [markConversationChosen])

  const botSwipeRightTouchProps = useEdgeSwipeOpen(splitNav, drawerOpenRef, FALSE_REF, openSessionsDrawer)

  const hasOpenWorkspaces = onOpenWorkspaces !== undefined
  const hasOpenHostSwitcher = onOpenHostSwitcher !== undefined
  const hasOpenAbout = onOpenAbout !== undefined
  const hasNewSession = onNewSession !== undefined
  const hasBotModeChange = onBotModeChange !== undefined

  const openAttentionInbox = useCallback(() => {
    Keyboard.dismiss()
    if (onOpenAttentionInbox) onOpenAttentionInbox()
    else useAttentionStore.getState().setInboxOpen(true)
  }, [onOpenAttentionInbox])

  const renderDrawer = (inlineMode: boolean) => (
    <HostSessionsDrawer
      key={inlineMode ? 'inline-navigation' : 'navigation-drawer'}
      inline={inlineMode}
      open={inlineMode ? true : sessionsOpen}
      entrance={inlineMode ? 'immediate' : drawerEntrance}
      backRef={inlineMode ? undefined : drawerBackRef}
      closeRef={inlineMode ? undefined : drawerCloseRef}
      onUnlockDismissible={inlineMode ? undefined : markConversationChosen}
      botMode={botMode}
      onBotModeChange={hasBotModeChange ? stableOnBotModeChange : undefined}
      dismissible={inlineMode || drawerSwipeUnlocked}
      onSelectBot={handleDrawerSelectBot}
      onOpenDeviceInfo={handleDrawerOpenDeviceInfo}
      onOpenWorkspaces={handleDrawerOpenWorkspaces}
      onBack={inlineMode ? undefined : handleDrawerBack}
      backLabel={strings.chat.backToChat}
      onClose={inlineMode ? handleInlineDrawerClose : handleOverlayDrawerClose}
      onOpenAutomationTasks={handleDrawerOpenAutomationTasks}
      onOpenPlugins={pluginsAvailable ? handleDrawerOpenPlugins : undefined}
      onOpenHostSwitcher={hasOpenHostSwitcher ? handleDrawerOpenHostSwitcher : undefined}
      onOpenAbout={hasOpenAbout ? stableOnOpenAbout : undefined}
      onOpenAttentionInbox={openAttentionInbox}
      onOpenSettings={handleDrawerOpenSettings}
      onSelect={handleDrawerSelect}
      onHandoffSession={handleOpenHandoff}
    />
  )

  return (
    <MarkdownLinkProvider onLinkPress={openLink} canStatFiles={pluginsAvailable}>
      <View style={styles.flex}>
        <NavigationFocusProvider value={active && (!sessionsOpen || splitNav)}>
          <KeyboardInset>
            <View
              key="chat-layout"
              collapsable={false}
              style={[styles.splitRoot, splitNav && styles.splitRootWide]}
              pointerEvents={sessionsOpen && !splitNav ? 'none' : 'auto'}
              accessibilityElementsHidden={sessionsOpen && !splitNav}
              importantForAccessibility={sessionsOpen && !splitNav ? 'no-hide-descendants' : 'auto'}
            >
              {splitNav && <View style={styles.splitSidebar}>{renderDrawer(true)}</View>}
              {botMode ? (
                <BotChatImageProvider hostId={hostId} connected={pluginsAvailable}>
                  <BotModeBackHandler
                    active={active}
                    splitNav={splitNav}
                    drawerOpenRef={drawerOpenRef}
                    drawerBackRef={drawerBackRef}
                    onOpenSessionsDrawer={openSessionsDrawer}
                    onBack={stableOnBack}
                  />
                  <View style={styles.splitMain} {...botSwipeRightTouchProps}>
                    <BotModeScreen
                      selectedId={botConversationId}
                      onSelect={handleBotSelect}
                      onAgentMode={switchToAgentMode}
                      onOpenDrawer={openSessionsDrawer}
                      onDeviceInfo={handleBotDeviceInfo}
                      onMore={handleBotMore}
                      splitView={splitNav}
                      drawerOpen={sessionsOpen || splitNav}
                      screenActive={active && (!sessionsOpen || splitNav)}
                    />
                  </View>
                </BotChatImageProvider>
              ) : (
                <ChatConversationPane
                  active={active}
                  suppressAutoSelect={suppressAutoSelect}
                  splitNav={splitNav}
                  drawerOpenRef={drawerOpenRef}
                  drawerBackRef={drawerBackRef}
                  cancelScrollRef={cancelScrollRef}
                  onDrawerClosedRef={onDrawerClosedRef}
                  closeMentionRef={closeMentionRef}
                  openFileLinkRef={openFileLinkRef}
                  lastAgentSessionByScopeRef={lastAgentSessionByScopeRef}
                  onOpenLink={openLink}
                  onOpenSessionsDrawer={openSessionsDrawer}
                  onOpenHandoff={handleOpenHandoff}
                  onBack={stableOnBack}
                  onNewSession={hasNewSession ? stableOnNewSession : undefined}
                  onOpenWorkspaces={hasOpenWorkspaces ? stableOnOpenWorkspaces : undefined}
                  onOpenHostSwitcher={hasOpenHostSwitcher ? stableOnOpenHostSwitcher : undefined}
                />
              )}
            </View>
          </KeyboardInset>
        </NavigationFocusProvider>
        {!splitNav && renderDrawer(false)}
        {pluginsOpen && <PluginsModal visible={pluginsOpen} onClose={closePluginsModal} />}
        {automationTasksOpen && (
          <AutomationTasksModal
            visible={automationTasksOpen}
            onClose={closeAutomationTasksModal}
            onOpenSession={handleAutomationOpenSession}
            onNewTask={handleAutomationNewTask}
          />
        )}
        {handoffTarget !== undefined && (
          <HandoffModal
            visible={handoffTarget !== undefined}
            sourceSession={handoffTarget?.session}
            sourceWorkspace={handoffTarget?.workspace}
            onClose={closeHandoffModal}
            onCompleted={handleHandoffCompleted}
          />
        )}
      </View>
    </MarkdownLinkProvider>
  )
}

interface ChatConversationPaneProps {
  active: boolean
  suppressAutoSelect: boolean
  splitNav: boolean
  drawerOpenRef: RefObject<boolean>
  drawerBackRef: RefObject<(() => boolean) | undefined>
  cancelScrollRef: MutableRefObject<(() => void) | undefined>
  onDrawerClosedRef: MutableRefObject<(() => void) | undefined>
  closeMentionRef: MutableRefObject<(() => void) | undefined>
  openFileLinkRef: MutableRefObject<((path: string) => void) | undefined>
  lastAgentSessionByScopeRef: MutableRefObject<Record<string, RemoteSession | undefined>>
  onOpenLink: (href: string) => void
  onOpenSessionsDrawer: () => void
  onOpenHandoff: (session: RemoteSession, workspace?: WorkspaceView) => void
  onBack: () => void
  onNewSession?: () => void
  onOpenWorkspaces?: (focusWorkspaceKey?: string) => void
  onOpenHostSwitcher?: () => void
}

const ChatConversationPane = memo(function ChatConversationPane({
  active,
  suppressAutoSelect,
  splitNav,
  drawerOpenRef,
  drawerBackRef,
  cancelScrollRef,
  onDrawerClosedRef,
  closeMentionRef,
  openFileLinkRef,
  lastAgentSessionByScopeRef,
  onOpenLink,
  onOpenSessionsDrawer,
  onOpenHandoff,
  onBack,
  onNewSession,
  onOpenWorkspaces,
  onOpenHostSwitcher,
}: ChatConversationPaneProps) {
  const reduceMotion = useReduceMotion()
  const session = useAppStore(state => state.selectedSession)
  const archivedSessionIds = useAppStore(state => state.archivedSessionIds)
  // Legacy Hosts keep the 8s poll; event-capable Hosts use `$events` + `session/control`.
  // Keep this mounted in chat so subagent/running updates still arrive when list screens unmount.
  useLiveSessionStatus(session !== undefined && (session.backend ?? 'harness') === 'harness')
  const hostId = useAppStore(state => state.selectedDevice?.deviceId)
  const hostPlatform = useAppStore(state => state.selectedDevice?.platform)
  const messages = useAppStore(state => session === undefined ? EMPTY_CHAT_ITEMS : state.messages[session.sessionId] ?? EMPTY_CHAT_ITEMS)
  const storeError = useAppStore(state => state.error)
  const clearError = useAppStore(state => state.clearError)
  const busy = useAppStore(state => state.busyAction)
  const codexReadySessionId = useAppStore(state => state.codexReadySessionId)
  const acpReadOnly = useAppStore(state => state.acpReadOnlySessionId !== undefined
    && state.acpReadOnlySessionId === state.selectedSession?.sessionId)
  const connection = useAppStore(state => state.connection)
  const hostWorkspaceGit = useAppStore(state => state.hostWorkspaceGit)
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
  const cancelCompaction = useAppStore(state => state.cancelCompaction)
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
  const unarchiveSession = useAppStore(state => state.unarchiveSession)
  const workspaces = useAppStore(state => state.workspaces)
  const sessions = useAppStore(state => state.sessions)
  const agentPresetOptions = useAppStore(state => state.agentPresetOptions)
  const agentPresetLoading = useAppStore(state => state.agentPresetLoading)
  const agentPresetSelecting = useAppStore(state => state.agentPresetSelecting)
  const quickPromptActionMode = useAppStore(state => state.quickPromptActionMode)
  const setQuickPromptActionMode = useAppStore(state => state.setQuickPromptActionMode)
  const previewImageUri = useAppStore(state => state.previewImageUri)
  const setPreviewImageUri = useAppStore(state => state.setPreviewImageUri)
  // Lightbox grows from the tap instead of a whole-screen cross fade.
  const lightboxMotion = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (previewImageUri === undefined) return
    lightboxMotion.setValue(0)
    const animation = Animated.timing(lightboxMotion, {
      toValue: 1,
      duration: resolveMotion('fullscreen', reduceMotion).duration,
      easing: Easing.bezier(...easingCurve('expand')),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [previewImageUri, lightboxMotion, reduceMotion])
  const memoryScope = browseScope(useAppStore.getState())
  const memoryKey = browseKey(memoryScope, session?.sessionId ?? '')
  const draft = useBrowseMemory(state => state.entries[memoryKey]?.draft ?? '')
  const memoryError = useBrowseMemory(state => state.error)
  const setDraft = (value: string) => updateBrowseEntry(memoryScope, session?.sessionId ?? '', {draft: value})
  const [trajectory, setTrajectory] = useState(false)
  const trajectoryRef = useRef(trajectory)
  trajectoryRef.current = trajectory
  // Enter-only motion for the transcript <-> trajectory swap. Both views keep
  // their own scroll state; only the incoming view moves.
  const trajectoryMotion = useRef(new Animated.Value(1)).current
  const trajectoryMountedRef = useRef(false)
  useEffect(() => {
    if (!trajectoryMountedRef.current) {
      trajectoryMountedRef.current = true
      return
    }
    trajectoryMotion.setValue(0)
    const animation = Animated.timing(trajectoryMotion, {
      toValue: 1,
      duration: resolveMotion('fullscreen', reduceMotion).duration,
      easing: Easing.bezier(...easingCurve('expand')),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [trajectory, trajectoryMotion, reduceMotion])

  const [pendingHandoffPreviewOpen, setPendingHandoffPreviewOpen] = useState(false)
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false)

  // Web-style blue marks: `/` commands and `@` references render in accent blue.
  const images = useBrowseMemory(state => state.entries[memoryKey]?.images ?? EMPTY_IMAGES)
  const setImages = (value: PromptImage[] | ((previous: PromptImage[]) => PromptImage[])) => {
    const previous = useBrowseMemory.getState().entries[memoryKey]?.images ?? EMPTY_IMAGES
    updateBrowseEntry(memoryScope, session?.sessionId ?? '', {images: typeof value === 'function' ? value(previous) : value})
  }
  const quotes = useBrowseMemory(state => state.entries[memoryKey]?.quotes ?? EMPTY_QUOTES)
  const setQuotes = useCallback((value: string[] | ((previous: string[]) => string[])) => {
    const previous = useBrowseMemory.getState().entries[memoryKey]?.quotes ?? EMPTY_QUOTES
    updateBrowseEntry(memoryScope, session?.sessionId ?? '', {quotes: typeof value === 'function' ? value(previous) : value})
  }, [memoryKey, memoryScope, session?.sessionId])
  const pendingHandoff = useBrowseMemory(state => state.entries[memoryKey]?.handoff)
  const setPendingHandoff = (value?: PendingHandoffDraft) => {
    updateBrowseEntry(memoryScope, session?.sessionId ?? '', { handoff: value })
  }
  useEffect(() => {
    if (pendingHandoff === undefined) setPendingHandoffPreviewOpen(false)
  }, [pendingHandoff, session?.sessionId, hostId])
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [permissionPickerOpen, setPermissionPickerOpen] = useState(false)
  const mentionInput = useChatMentions({
    session, sessions, workspaces, connectionPhase: connection.phase, draft, setDraft,
    setPermissionPickerOpen, setModelPickerOpen,
  })
  const { composerInputRef, draftRef, mentionType, setMentionType, applyDraft, closeMention, resetSelection } = mentionInput
  useEffect(() => {
    closeMentionRef.current = closeMention
    return () => {
      if (closeMentionRef.current === closeMention) closeMentionRef.current = undefined
    }
  }, [closeMentionRef, closeMention])
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
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>()
  const uploadingRef = useRef(false)
  const uploadControllerRef = useRef<AbortController | undefined>(undefined)
  const sessionGenerationRef = useRef(0)
  useLayoutEffect(() => {
    let lastSessionId = useAppStore.getState().selectedSession?.sessionId
    return useAppStore.subscribe((state) => {
      const currentId = state.selectedSession?.sessionId
      if (currentId !== lastSessionId) {
        lastSessionId = currentId
        sessionGenerationRef.current += 1
        uploadControllerRef.current?.abort()
        setUploadProgress(prev => (prev === undefined ? prev : undefined))
        setStagedFiles(prev => (prev.length === 0 ? prev : []))
      }
    })
  }, [])
  useEffect(() => () => { uploadControllerRef.current?.abort() }, [])
  useEffect(() => {
    if (connection.phase !== 'connected') uploadControllerRef.current?.abort()
  }, [connection.phase])
  const { attachmentPicking, pickImages, takePhoto, pickFiles } = useChatAttachments({
    session, memoryKey, images, setImages, stagedFiles, setStagedFiles, sessionGenerationRef,
  })
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const plusMenuActions = useRef(createModalActionQueue(Platform.OS === 'ios')).current
  useEffect(() => () => plusMenuActions.cancel(), [plusMenuActions])
  const sessionInfoActions = useRef(createModalActionQueue(Platform.OS === 'ios')).current
  useEffect(() => () => sessionInfoActions.cancel(), [sessionInfoActions])
  const fileViewerActions = useRef(createModalActionQueue(Platform.OS === 'ios')).current
  useEffect(() => () => fileViewerActions.cancel(), [fileViewerActions])
  const quoteFocusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (quoteFocusTimerRef.current !== undefined) {
      clearTimeout(quoteFocusTimerRef.current)
      quoteFocusTimerRef.current = undefined
    }
  }, [])
  const [sheetAnchor, setSheetAnchor] = useState<Rect>()
  const composerAnchorRef = useRef<View>(null)
  const [referenceChatOpen, setReferenceChatOpen] = useState(false)
  const [stagedReferences, setStagedReferences] = useState<ReferenceChatCandidate[]>([])
  const [modePickerOpen, setModePickerOpen] = useState(false)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [toolPickerOpen, setToolPickerOpen] = useState(false)
  const [toolsMode, setToolsMode] = useState<SessionToolsMode>()
  const [filesInitialPath, setFilesInitialPath] = useState<string>()
  const [previewFilePath, setPreviewFilePath] = useState<string>()
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
    if (session === undefined || (session.backend !== undefined && session.backend !== 'harness') || connection.phase !== 'connected') return
    const projected = sessionPermissions(session)
    if (projected === undefined || projected.options.length > 0) return
    const controller = new AbortController()
    setPermissionLoading(true)
    void Promise.resolve().then(() => requireSessionTools(session.sessionId).permissionOptions(controller.signal))
      .then(options => { if (!controller.signal.aborted) setPermissionOptions(options) })
      .catch(() => { if (!controller.signal.aborted) setPermissionError(strings.tools.permissionUnavailable) })
      .finally(() => { if (!controller.signal.aborted) setPermissionLoading(false) })
    return () => controller.abort()
  }, [session?.sessionId, session?.backend, inlinePermissionOptions, connection.phase, permissionPickerOpen, permissionRevision])
  // A carrier drop must not close the full-screen editor: the draft stays
  // editable offline, so only a conversation change collapses it.
  useEffect(() => {
    setToolsMode(undefined)
    setPreviewFilePath(undefined)
    setFilesInitialPath(undefined)
  }, [session?.sessionId, connection.phase])
  useEffect(() => { setComposerExpanded(false) }, [session?.sessionId])
  // Fetch mode options only when a non-Codex session is active.
  // ACP sessions already receive modes from dsh/sessionHistory during openSession,
  // so avoid racing openSession or re-querying once populated.
  const hasAgentPresets = agentPresetOptions !== undefined
  const isOpeningAcpSession = session !== undefined && isAcpManagedBackend(session.backend) && busy === `session:${session.sessionId}`
  useEffect(() => {
    if (!shouldLoadAgentPresets({
      phase: connection.phase,
      sessionId: session?.sessionId,
      backend: session?.backend,
      hasPresets: hasAgentPresets,
      isOpeningAcpSession,
      storeError: useAppStore.getState().error,
    })) return
    void loadAgentPresets()
  }, [connection.phase, session?.sessionId, session?.backend, hasAgentPresets, isOpeningAcpSession, loadAgentPresets])
  const [composerExpanded, setComposerExpanded] = useState(false)
  const [reconnectingSession, setReconnectingSession] = useState(false)
  const [newSessionPending, setNewSessionPending] = useState(false)
  const creatingSessionRef = useRef(false)
  const lastNewSessionTimeRef = useRef(0)
  const { visibleMessages, chunkedSections, turnUsageByTurn, uiBySection, visibleUiIds, queueItems, childSessions, teamState } = useChatTranscript({ session, sessions, messages, hostId })
  const panelOpen = composerExpanded || plusMenuOpen || modelPickerOpen || modePickerOpen || permissionPickerOpen
    || workspacePickerOpen || toolPickerOpen || toolsMode !== undefined || previewFilePath !== undefined || trajectory || mentionType !== null
    || promptsPickerOpen || promptsManagerOpen || promptEditing !== null || sessionInfoOpen
    || pendingHandoffPreviewOpen
  const { listRef, displaySections, maintainVisibleContentPosition, viewability, awayFromLatest, newContent, jumpToLatest, beginSendScroll,
    onListLayout, onListContentSizeChange, onListScroll, onListDragEnd, onListMomentumEnd,
    onScrollBeginDrag, onMomentumScrollBegin } = useChatScroll({
    session, messages, visibleMessages, visibleSections: chunkedSections, memoryScope, memoryKey,
    panelOpen, historyLoadingOlder, busy, setTrajectory,
    drawerOpenRef, cancelScrollRef, onDrawerClosedRef,
  })

  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  // Landscape phones are short: keep the composer compact when the IME is up
  // and let the list use a readable centred column on wide windows.
  const { landscape, compactHeight, height, contentMaxWidth } = useResponsiveLayout()
  const compactComposer = landscape || compactHeight
  const composerInputMaxHeight = compactComposer ? Math.max(48, Math.min(96, Math.round(height * 0.22))) : 126
  const readableColumn = { width: '100%' as const, maxWidth: contentMaxWidth, alignSelf: 'center' as const }

  // Swipe right gesture to open sessions drawer with haptic feedback
  const swipeRightTouchProps = useEdgeSwipeOpen(splitNav, drawerOpenRef, trajectoryRef, onOpenSessionsDrawer)

  const stopping = busy === 'stop-session'
  const lastDisplaySectionKey = displaySections[displaySections.length - 1]?.key
  // Artifact changes must invalidate FlatList cells even when their section is
  // reused (a later turn can patch a card owned by an earlier turn).
  const renderChatItem = useCallback(({ item }: { item: DisplayChatSection }) => {
    if (item.kind === 'markdown-chunk') {
      const uiEntry = uiBySection.get(item.sourceKey)
      return (
        <MarkdownChunkRow
          section={item}
          artifacts={uiEntry?.cards ?? EMPTY_UI_ARTIFACTS}
          updatedArtifacts={uiEntry?.pointers ?? EMPTY_UI_ARTIFACTS}
          availableUiIds={visibleUiIds}
          turnUsage={item.turn !== undefined ? turnUsageByTurn.get(item.turn) : undefined}
        />
      )
    }
    if (item.kind === 'process-prefix') {
      return (
        <ChatProcessGroup
          items={item.items}
          artifacts={EMPTY_UI_ARTIFACTS}
          updatedArtifacts={EMPTY_UI_ARTIFACTS}
          availableUiIds={visibleUiIds}
          isTurnRunning={false}
          hiddenResponseItemId={item.hiddenResponseItemId}
          onApproval={respondApproval}
          onQuestion={respondQuestion}
        />
      )
    }
    if (item.kind === 'process') {
      return (
        <ChatProcessGroup
          items={item.items}
          artifacts={uiBySection.get(item.key)?.cards ?? EMPTY_UI_ARTIFACTS}
          updatedArtifacts={uiBySection.get(item.key)?.pointers ?? EMPTY_UI_ARTIFACTS}
          availableUiIds={visibleUiIds}
          isTurnRunning={item.key === lastDisplaySectionKey && (session?.running === true || stopping)}
          turnUsage={turnUsageByTurn.get(item.turn)}
          onApproval={respondApproval}
          onQuestion={respondQuestion}
        />
      )
    }
    return <ChatItemView item={item.item} compact={false} onApproval={respondApproval} onQuestion={respondQuestion} />
  }, [lastDisplaySectionKey, respondApproval, respondQuestion, session?.running, stopping, turnUsageByTurn, uiBySection, visibleUiIds])

  // Keep chat's back action at the top of the Android responder stack. The
  // navigator also handles back globally, but a freshly mounted FlatList can
  // otherwise win the first dispatch while its cells are being measured.
  // Back inside a subagent child returns to its parent conversation (the
  // official subagent UI's navigation), instead of leaving the chat entirely.
  const backFromChat = () => {
    if (!splitNav && drawerOpenRef.current) {
      return drawerBackRef.current?.() ?? false
    }
    const parent = session !== undefined && isSubagentSession(session)
      ? sessions.find(item => item.sessionId === session.parentSessionId)
      : undefined
    if (parent !== undefined) {
      Keyboard.dismiss()
      void openSession(parent)
      return true
    }
    if (!splitNav && !drawerOpenRef.current) {
      onOpenSessionsDrawer()
      return true
    }
    Keyboard.dismiss()
    onBack()
    return true
  }
  const onBackRef = useRef(backFromChat)
  onBackRef.current = backFromChat
  useChatBackHandler(composerInputRef, () => onBackRef.current(), [
    { open: pendingHandoffPreviewOpen, close: () => setPendingHandoffPreviewOpen(false) },
    { open: composerExpanded, close: () => setComposerExpanded(false) },
    { open: plusMenuOpen, close: () => { Keyboard.dismiss(); setPlusMenuOpen(false) } },
    { open: referenceChatOpen, close: () => setReferenceChatOpen(false) },
    { open: modelPickerOpen, close: () => setModelPickerOpen(false) },
    { open: modePickerOpen, close: () => setModePickerOpen(false) },
    { open: permissionPickerOpen, close: () => setPermissionPickerOpen(false) },
    { open: workspacePickerOpen, close: () => setWorkspacePickerOpen(false) },
    { open: toolPickerOpen, close: () => setToolPickerOpen(false) },
    { open: promptEditing !== null, close: () => { setPromptEditing(null); setPromptsManagerOpen(true) } },
    { open: promptsManagerOpen, close: () => { setPromptsManagerOpen(false); setPromptsPickerOpen(true) } },
    { open: promptsPickerOpen, close: () => setPromptsPickerOpen(false) },
    { open: previewFilePath !== undefined, close: () => setPreviewFilePath(undefined) },
    { open: toolsMode !== undefined, close: () => { setToolsMode(undefined); setFilesInitialPath(undefined) } },
    { open: trajectory, close: () => setTrajectory(false) },
  ], active, () => (!splitNav && drawerOpenRef.current ? (drawerBackRef.current?.() ?? false) : false))

  const botTeamState = useBotTeamStore(state => state.state)
  const connected = connection.phase === 'connected' && !reconnectingSession

  const openWorkspaceFile = useCallback((path: string) => {
    if (!connected) {
      Alert.alert(strings.tools.files, strings.chat.offlineNotice)
      return
    }
    setPreviewFilePath(path)
  }, [connected])

  useEffect(() => {
    openFileLinkRef.current = openWorkspaceFile
    return () => {
      if (openFileLinkRef.current === openWorkspaceFile) {
        openFileLinkRef.current = undefined
      }
    }
  }, [openFileLinkRef, openWorkspaceFile])

  const hasActiveChatItem = visibleMessages.some(isActiveChatItem)
  const replyActive = connected && (busy === 'send-message' || busy === 'stop-session' || (session?.running ?? false) || hasActiveChatItem)

  useEffect(() => {
    if (session !== undefined && !isKnownBotSessionId(session.sessionId, botTeamState, memoryScope)) {
      lastAgentSessionByScopeRef.current[memoryScope] = session
    }
  }, [session, botTeamState, memoryScope, lastAgentSessionByScopeRef])

  const findPreferredAgentSession = () => {
    const candidates = sessions.filter(
      item => !archivedSessionIds.includes(item.sessionId) && !isKnownBotSessionId(item.sessionId, botTeamState, memoryScope),
    )
    const remembered = lastAgentSessionByScopeRef.current[memoryScope]
    const preferred = remembered
      ? candidates.find(item => item.sessionId === remembered.sessionId && (item.backend ?? 'harness') === (remembered.backend ?? 'harness'))
      : undefined
    return preferred ?? [...candidates].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
  }

  const autoSelectingRef = useRef(false)
  useEffect(() => {
    if (suppressAutoSelect) return
    const sessionIsBot = session !== undefined && isKnownBotSessionId(session.sessionId, botTeamState, memoryScope)
    if (sessionIsBot) {
      useAppStore.setState({ selectedSession: undefined })
    }
    if ((session !== undefined && !sessionIsBot) || busy !== undefined || autoSelectingRef.current) return
    const target = findPreferredAgentSession()
    if (target) {
      autoSelectingRef.current = true
      void openSession(target).finally(() => {
        autoSelectingRef.current = false
      })
    }
  }, [suppressAutoSelect, session, connected, busy, sessions, archivedSessionIds, openSession, botTeamState, memoryScope])

  const sessionIsBot = session !== undefined && isKnownBotSessionId(session.sessionId, botTeamState, memoryScope)
  if (session === undefined || sessionIsBot) {
    const emptyHeader = (
      <TopBar
        title={strings.chat.newChat}
        titleLines={1}
        titleAlign="between"
        onBack={splitNav ? undefined : onOpenSessionsDrawer}
        backIcon={Menu}
        backLabel={strings.chat.openHostSessions}
        action={
          <>
            <IconButton
              label={strings.chat.newChat}
              icon={OfficialMenuIcons.newChat}
              dense
              onPress={() => void createSession(workspaces[0]?.workspaceId)}
              disabled={!connected || busy !== undefined}
            />
            {!connected && (
              <IconButton
                label={strings.chat.reconnect}
                icon={RefreshCw}
                dense
                onPress={() => {
                  if (onOpenHostSwitcher) onOpenHostSwitcher()
                  else void reconnect()
                }}
              />
            )}
          </>
        }
      />
    )
    return (
      <ChatImageProvider value={imageLoader}>
        <MarkdownLinkProvider onLinkPress={onOpenLink} onFilePress={openWorkspaceFile} canStatFiles={connected}>
          <View style={styles.splitMain} {...swipeRightTouchProps}>
            <BlurHeaderFrame header={emptyHeader}>
              {headerHeight => (
                <View style={[styles.list, readableColumn, styles.emptyList, { paddingTop: headerHeight + spacing.xl }]}>
                  {busy !== undefined ? (
                    <View style={{ padding: spacing.xl, alignItems: 'center' }}>
                      <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                  ) : (
                    <WelcomeMessage />
                  )}
                </View>
              )}
            </BlurHeaderFrame>
          </View>
        </MarkdownLinkProvider>
      </ChatImageProvider>
    )
  }

  const submit = async () => {
    if (session === undefined) return
    // Read the live ref: the render-closure `draft` can lag the last keystrokes
    // typed right before the tap, silently dropping the tail of the message.
    const submittedDraft = draftRef.current
    const rawText = submittedDraft.trim()
    const submittedReferences = stagedReferences
    const refPrefix = submittedReferences.map(item => item.mentionText.trim()).join(' ')
    const text = [refPrefix, rawText].filter(Boolean).join(' ')
    const submittedQuotes = quotes
    const submittedImages = images
    const submittedFiles = stagedFiles
    const submittedHandoff = pendingHandoff
    // Everything below this gate clears the composer, so an offline tap has to
    // stop here: the draft stays, no optimistic row is created and the manual
    // send after reconnection is the only submission path.
    const intent = submitIntent({
      connected, sendReady, permissionSelecting, uploading: uploadingRef.current,
      hasContent: text.length > 0 || submittedQuotes.length > 0 || images.length > 0 || stagedFiles.length > 0 || submittedHandoff !== undefined,
    })
    if (intent !== 'submit') return
    let promptWithQuotes = text
    if (submittedQuotes.length > 0) {
      const formattedQuotes = submittedQuotes.map(formatQuoteText).join('\n\n')
      promptWithQuotes = text.length > 0 ? `${formattedQuotes}\n\n${text}` : formattedQuotes
    }
    let userPromptBody = promptWithQuotes
    let uploadedFiles: ChatFile[] = []
    const targetSessionId = session.sessionId
    const sendSessionGen = sessionGenerationRef.current
    if (submittedFiles.length > 0) {
      const transportModeAtStart = useAppStore.getState().connection.stats.mode
      const maxBytesAtStart = workspaceUploadMaxBytes(transportModeAtStart)
      const oversizedFile = submittedFiles.find(
        file => !(typeof file.remotePath === 'string' && file.remotePath.trim().length > 0)
          && typeof file.content !== 'string'
          && file.size > maxBytesAtStart,
      )
      if (oversizedFile) {
        Alert.alert(
          strings.messageActions.failed,
          strings.chat.fileTooLargeForTransport(
            oversizedFile.name,
            formatFileBytes(maxBytesAtStart),
            isDirectTransportMode(transportModeAtStart),
          ),
        )
        return
      }
      let failingFile: StagedFile | undefined = submittedFiles[0]
      const controller = new AbortController()
      uploadControllerRef.current?.abort()
      uploadControllerRef.current = controller
      uploadingRef.current = true
      setUploadingFiles(true)
      setUploadProgress({
        fileIndex: 0,
        fileCount: submittedFiles.length,
        fileName: submittedFiles[0]?.name ?? '',
        bytesSent: 0,
        totalBytes: submittedFiles[0]?.size ?? 0,
      })
      try {
        const rpc = requireConnectionRpc()
        const uploaded = await uploadStagedFilesToWorkspace(
          rpc,
          session.sessionId,
          submittedFiles,
          controller.signal,
          progress => {
            failingFile = submittedFiles[progress.fileIndex] ?? failingFile
            if (!controller.signal.aborted && uploadControllerRef.current === controller) {
              setUploadProgress(progress)
            }
          },
        )
        // A navigation, session switch, reconnection or unmount during a long
        // upload must never leak the prompt into another conversation.
        if (controller.signal.aborted) return
        if (sessionGenerationRef.current !== sendSessionGen
          || useAppStore.getState().selectedSession?.sessionId !== targetSessionId) return
        if (useAppStore.getState().connection.phase !== 'connected') {
          Alert.alert(strings.messageActions.failed, strings.messageActions.unavailable)
          return
        }
        uploadedFiles = formatUploadedChatFiles(uploaded)
        userPromptBody = formatUploadedFilesReferencePrompt(promptWithQuotes, uploaded)
      } catch (uploadError) {
        // Aborted uploads already restored (or discarded) their composer state;
        // do not surface a cancellation as a failure.
        if (controller.signal.aborted || (uploadError as Error | undefined)?.name === 'AbortError') return
        const code = (uploadError as { code?: string })?.code
        const activeFile = failingFile ?? submittedFiles[0]
        const activeName = activeFile?.name ?? ''
        const transportMode = useAppStore.getState().connection.stats.mode
        const maxTransportBytes = workspaceUploadMaxBytes(transportMode)
        let errorMsg: string
        if (code === 'FEATURE_NOT_SUPPORTED' || code === 'UPLOAD_WORKSPACE_UNAVAILABLE') {
          errorMsg = strings.chat.uploadUnavailable
        } else if (code === 'UPLOAD_LIMIT' && (activeFile?.size ?? 0) > maxTransportBytes) {
          errorMsg = strings.chat.fileTooLargeForTransport(
            activeName,
            formatFileBytes(maxTransportBytes),
            isDirectTransportMode(transportMode),
          )
        } else {
          errorMsg = strings.chat.uploadFileFailed(activeName, (uploadError as Error).message)
        }
        Alert.alert(strings.messageActions.failed, errorMsg)
        return
      } finally {
        if (uploadControllerRef.current === controller) {
          uploadControllerRef.current = undefined
          uploadingRef.current = false
          setUploadingFiles(false)
          setUploadProgress(undefined)
        }
      }
    }
    const promptText = submittedHandoff !== undefined
      ? formatHandoffPayload(submittedHandoff, userPromptBody)
      : userPromptBody
    if (promptText.length > LONG_DRAFT_MAX) {
      Alert.alert(strings.chat.draftTooLongTitle, strings.chat.draftTooLong(LONG_DRAFT_MAX))
      return
    }
    applyDraft('')
    setQuotes([])
    setImages([])
    setStagedFiles([])
    setStagedReferences([])
    setPendingHandoff(undefined)
    setPendingHandoffPreviewOpen(false)
    setMentionType(null)
    resetSelection()
    const restoreScrollAfterRejectedSend = beginSendScroll()
    const outcome = await sendMessage(promptText, submittedImages, undefined, uploadedFiles)
    if (outcome === 'rejected') {
      restoreScrollAfterRejectedSend()
      // Nothing was persisted (command failure): restore the draft without
      // clobbering input typed while the send was in flight.
      if (sessionGenerationRef.current === sendSessionGen && useAppStore.getState().selectedSession?.sessionId === targetSessionId) {
        const inFlight = useBrowseMemory.getState().entries[memoryKey]?.draft ?? ''
        setDraft(inFlight.length === 0 ? submittedDraft : `${submittedDraft}\n${inFlight}`)
        setQuotes(previous => previous.length === 0 ? submittedQuotes : [...submittedQuotes, ...previous])
        setImages(previous => previous.length === 0 ? submittedImages : [...submittedImages, ...previous])
        setStagedReferences(previous => previous.length === 0 ? submittedReferences : [...submittedReferences, ...previous])
        if (submittedHandoff !== undefined && useBrowseMemory.getState().entries[memoryKey]?.handoff === undefined) {
          setPendingHandoff(submittedHandoff)
        }
        setStagedFiles(current => {
          const seen = new Set<string>()
          const restored: StagedFile[] = []
          for (const f of [...submittedFiles, ...current]) {
            if (seen.has(f.id)) continue
            seen.add(f.id)
            restored.push(f)
          }
          return restored
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
    // When the IME is currently open, measuring composerAnchorRef before the
    // keyboard settles yields a mid-screen y coordinate that would launch the
    // bottom sheet from an elevated anchor.
    const imeOpen = typeof Keyboard.isVisible === 'function' && Keyboard.isVisible()
    Keyboard.dismiss()
    const node = composerAnchorRef.current
    if (node === null || imeOpen) {
      setSheetAnchor(undefined)
      setPlusMenuOpen(true)
      return
    }
    // One frame of measurement so the sheet can grow out of the composer
    // instead of the screen edge; a missing measurement falls back to a
    // bottom rise inside SheetModal.
    node.measureInWindow((x, y, width, height) => {
      setSheetAnchor(width > 0 && height > 0 ? { x, y, width, height } : undefined)
      setPlusMenuOpen(true)
    })
  }

  const closePlusMenu = () => {
    Keyboard.dismiss()
    setPlusMenuOpen(false)
  }

  const runAfterPlusMenu = (action: () => void) => {
    const generation = sessionGenerationRef.current
    plusMenuActions.run(closePlusMenu, () => {
      if (sessionGenerationRef.current === generation) action()
    })
  }

  const closeSessionInfo = () => {
    setSessionInfoOpen(false)
  }

  const runAfterSessionInfo = (action: () => void) => {
    const generation = sessionGenerationRef.current
    sessionInfoActions.run(closeSessionInfo, () => {
      if (sessionGenerationRef.current === generation) action()
    })
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

  const supportsModeSelection = (session.backend ?? 'harness') === 'harness'
    || (session.backend !== 'codex' && agentPresetOptions !== undefined && agentPresetOptions.length > 0)
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
  const sendReady = connected && !acpReadOnly && !busy?.startsWith('session:')
    && (session.backend !== 'codex' || codexReadySessionId === session.sessionId)
  const hasComposerContent = draft.trim().length > 0 || quotes.length > 0 || images.length > 0 || stagedFiles.length > 0 || stagedReferences.length > 0 || pendingHandoff !== undefined
  const commandRunning = busy === 'command'
  const stopOrCancel = () => {
    if (!commandRunning) { void stopSession(); return }
    // A tracked /compact can run for minutes; the stop control asks the Host to
    // cancel it and keeps observing the confirmed terminal state.
    void cancelCompaction().then(cancelled => { if (!cancelled) void stopSession() })
  }
  // Action entries (attachments, tools, prompts) still need the channel, but the
  // text field itself only blocks on composer-local states so an offline draft
  // can be typed, edited and kept for the manual send after reconnection.
  const inputEditable = composerEditable({ permissionSelecting, uploading: uploadingFiles })
  const composerDisabled = !connected || acpReadOnly || permissionSelecting || uploadingFiles
  const sendDisabled = !sendReady || permissionSelecting || !hasComposerContent || uploadingFiles
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
    if (!connected || preset === session.agentPreset) return
    const applied = await selectAgentPreset(preset)
    if (!applied) {
      Alert.alert(
        strings.chat.modeLockedTitle,
        session.blank ? strings.chat.modeSelectFailedBody : strings.chat.modeLockedBody,
      )
    }
  }

  const pickToolMode = (mode: SessionToolsMode) => {
    setToolPickerOpen(false)
    setFilesInitialPath(undefined)
    setToolsMode(mode)
  }

  const quoteChangeToComposer = (reference: string) => {
    const { draft: nextDraft, cursor } = applyChangeQuoteDraft(
      draftRef.current,
      reference,
      strings.tools.changesQuotePrompt,
    )
    applyDraft(nextDraft)
    mentionInput.setCursor(cursor)
    setMentionType(null)
    const generation = sessionGenerationRef.current
    setToolsMode(undefined)
    if (quoteFocusTimerRef.current !== undefined) clearTimeout(quoteFocusTimerRef.current)
    quoteFocusTimerRef.current = setTimeout(() => {
      quoteFocusTimerRef.current = undefined
      if (sessionGenerationRef.current === generation) {
        composerInputRef.current?.focus()
      }
    }, Platform.OS === 'ios' ? 280 : 80)
  }

  const sessionBlank = visibleMessages.length === 0 && session.blank !== false

  const startNewSession = async () => {
    if (!connected) {
      Alert.alert(strings.chat.newChatFailedTitle, strings.chat.offlineNotice)
      return
    }
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

  const pickQuickPrompt = async (prompt: CustomPrompt) => {
    setPromptsPickerOpen(false)
    if (quickPromptActionMode === 'fill') {
      const { draft: nextDraft, cursor } = applyQuickPromptDraft(draftRef.current, prompt.text)
      applyDraft(nextDraft)
      mentionInput.setCursor(cursor)
      setMentionType(null)
      requestAnimationFrame(() => composerInputRef.current?.focus())
      return
    }
    if (!connected) {
      Alert.alert(strings.chat.toolPromptSendFailed, strings.chat.offlineNotice)
      return
    }
    const outcome = await sendMessage(prompt.text)
    if (outcome === 'sent') AccessibilityInfo.announceForAccessibility(strings.chat.toolPromptSent(prompt.title))
    else if (outcome === 'rejected') Alert.alert(strings.chat.toolPromptSendFailed, strings.chat.toolPromptSendFailed)
  }

  const moveSessionToWorkspace = async (workspace: WorkspaceView) => {
    if (!connected) {
      Alert.alert(strings.chat.moveFailedTitle, strings.chat.offlineNotice)
      return
    }
    const previousId = session.sessionId
    const opened = await createSession(workspace.workspaceId)
    if (!opened) {
      Alert.alert(strings.chat.moveFailedTitle, strings.chat.moveFailedBody)
      return
    }
    // A blank conversation carries nothing to lose: recreate it inside the
    // chosen workspace and archive or drop the old placeholder so it reads as a move.
    if (sessionBlank && useAppStore.getState().selectedSession?.sessionId !== previousId) {
      const supportsNativeArchive = session.backend === undefined
        || session.backend === 'harness'
        || session.backend === 'codex'
        || session.backend === 'opencode'
      if (supportsNativeArchive) {
        await archiveSession(previousId)
      } else {
        useAppStore.setState(state => ({
          sessions: state.sessions.filter(item => item.sessionId !== previousId),
          workspaces: state.workspaces.map(item => ({
            ...item,
            sessionIds: item.sessionIds.filter(id => id !== previousId),
          })),
        }))
      }
    }
  }

  const pickWorkspace = (workspace: WorkspaceView) => {
    setWorkspacePickerOpen(false)
    if (!connected) {
      Alert.alert(strings.chat.moveFailedTitle, strings.chat.offlineNotice)
      return
    }
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

  const sessionBackend = session.backend ?? 'harness'
  const canArchiveSession = !isSubagentSession(session)
    && (sessionBackend === 'harness' || sessionBackend === 'codex' || sessionBackend === 'opencode')
  const sessionArchived = sessionBackend === 'harness' && archivedSessionIds.includes(session.sessionId)

  const toggleArchiveCurrentSession = () => {
    if (!connected || busy !== undefined) return
    const targetId = session.sessionId
    const targetBackend = session.backend
    if (sessionArchived) {
      void unarchiveSession(targetId, targetBackend).then(ok => {
        if (!ok && useAppStore.getState().error === undefined) {
          Alert.alert(strings.sessions.unarchiveSession, strings.sessions.unarchiveFailed)
        }
      })
      return
    }
    Alert.alert(
      strings.sessions.archiveTitle,
      strings.sessions.archiveBody,
      [
        { text: strings.common.cancel, style: 'cancel' },
        {
          text: strings.sessions.archive,
          style: 'destructive',
          onPress: () => {
            const state = useAppStore.getState()
            if (state.busyAction !== undefined) return
            void archiveSession(targetId).then(ok => {
              if (ok) {
                const selectedId = useAppStore.getState().selectedSession?.sessionId
                if (selectedId === undefined || selectedId === targetId) setTrajectory(false)
              } else if (useAppStore.getState().error === undefined) {
                Alert.alert(strings.sessions.archiveSession, strings.sessions.archiveFailed)
              }
            })
          },
        },
      ],
    )
  }

  const canHandoffCurrentSession = connected && !isSubagentSession(session) && (messages.length > 0 || !session.blank)
  const hasComposerTray = images.length > 0 || stagedFiles.length > 0 || uploadingFiles || stagedReferences.length > 0 || pendingHandoff !== undefined
  const composerHeaderSlot = hasComposerTray ? (
    <>
      {pendingHandoff !== undefined && (
        <View style={styles.handoffDraftRow}>
          <View style={styles.handoffDraftChip}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.handoff.pendingChipTitle(
                harnessDisplayName(pendingHandoff.meta.sourceBackend),
                harnessDisplayName(pendingHandoff.meta.targetBackend),
              )}
              onPress={() => setPendingHandoffPreviewOpen(true)}
              style={styles.handoffDraftChipTrigger}
            >
              <ArrowRightLeft size={14} color={colors.primary} />
              <Text numberOfLines={1} style={styles.handoffDraftChipText}>
                {strings.handoff.pendingChipTitle(
                  harnessDisplayName(pendingHandoff.meta.sourceBackend),
                  harnessDisplayName(pendingHandoff.meta.targetBackend),
                )}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.handoff.removePendingHandoff}
              hitSlop={8}
              onPress={() => setPendingHandoff(undefined)}
              style={styles.handoffDraftChipRemove}
            >
              <X size={13} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      )}
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
                <X size={12} color={colors.white} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      {stagedFiles.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.fileTray}>
          {stagedFiles.map((file, index) => {
            const video = isVideoFile(file.name, file.mimeType)
            const sizeLine = file.durationMs !== undefined
              ? `${formatFileBytes(file.size)} · ${formatDurationMs(file.durationMs)}`
              : formatFileBytes(file.size)
            return (
              <View key={`${file.id}:${index}`} style={styles.fileCard}>
                {video ? <Film size={16} color={colors.primary} /> : <FileText size={16} color={colors.primary} />}
                <View style={styles.fileCardMeta}>
                  <Text style={styles.fileCardName} numberOfLines={1}>{file.name}</Text>
                  <Text style={styles.fileCardSize}>{sizeLine}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={file.name ? strings.chat.removeFile(file.name) : strings.chat.unnamedFile}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  onPress={() => setStagedFiles(current => current.filter((_, fileIndex) => fileIndex !== index))}
                  style={styles.removeFileButton}
                >
                  <X size={13} color={colors.muted} />
                </Pressable>
              </View>
            )
          })}
        </ScrollView>
      )}
      {uploadingFiles && (
        <View style={styles.uploadStatusRow}>
          <Text style={[styles.fileCardSize, { flexShrink: 1 }]} numberOfLines={1}>
            {uploadProgress && uploadProgress.totalBytes > 0
              ? strings.chat.uploadingFileProgress(
                  uploadProgress.fileCount > 1
                    ? `(${uploadProgress.fileIndex + 1}/${uploadProgress.fileCount}) ${uploadProgress.fileName}`
                    : uploadProgress.fileName,
                  Math.min(100, Math.round((uploadProgress.bytesSent / uploadProgress.totalBytes) * 100)),
                )
              : strings.chat.uploadingFile(uploadProgress?.fileName ?? stagedFiles[0]?.name ?? '')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.cancelUpload}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => {
              triggerLightHaptic()
              uploadControllerRef.current?.abort()
            }}
          >
            <Text style={[styles.fileCardSize, { color: colors.primary, fontWeight: '600' }]}>{strings.chat.cancelUpload}</Text>
          </Pressable>
        </View>
      )}
      <ReferencedChatPills
        items={stagedReferences}
        onRemove={sid => setStagedReferences(current => current.filter(item => item.sessionId !== sid))}
      />
    </>
  ) : undefined

  const header = <>
      <TopBar
        title={sessionTitle(session)}
        subtitle={sessionModels !== undefined ? (currentModelLabel || strings.chat.selectModel) : undefined}
        subtitleLabel={strings.chat.selectModel}
        subtitleAccessory={modelSelecting
          ? <View style={{ width: 13, height: 13, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="small" color={colors.muted} style={{ transform: [{ scale: 0.65 }] }} /></View>
          : undefined}
        onSubtitlePress={sessionModels !== undefined ? () => { Keyboard.dismiss(); setMentionType(null); setModelPickerOpen(true) } : undefined}
        titleLines={1}
        titleAlign="between"
        onBack={trajectory ? handleBack : (splitNav ? undefined : onOpenSessionsDrawer)}
        backIcon={trajectory ? ArrowLeft : Menu}
        backLabel={trajectory ? strings.common.back : strings.chat.openHostSessions}
        action={<>
          {trajectory
            ? (
              <IconButton
                label={strings.trajectory.close}
                icon={MessageSquare}
                dense
                tint={colors.primary}
                onPress={() => { Keyboard.dismiss(); setMentionType(null); setTrajectory(false) }}
              />
            )
            : (
              <IconButton
                label={strings.chat.newChat}
                icon={OfficialMenuIcons.newChat}
                dense
                onPress={() => void startNewSession()}
                disabled={(sessionBlank && !hasComposerContent) || newSessionPending || busy !== undefined}
              />
            )}
          <IconButton
            label={strings.sessions.moreActions}
            icon={MoreHorizontal}
            dense
            onPress={() => { Keyboard.dismiss(); setMentionType(null); setSessionInfoOpen(true) }}
          />
        </>}
      />
      {!connected && (
        <Pressable style={styles.connectionBanner} accessibilityRole="button"
          accessibilityLabel={connectionRetrying ? strings.chat.reconnecting : strings.chat.offline}
          accessibilityState={{ disabled: connectionRetrying, busy: connectionRetrying }}
          accessibilityLiveRegion="polite" disabled={connectionRetrying}
          onPress={() => void reconnectCurrentSession()}>
          <View style={styles.connectionDot} />
          <Text style={styles.connectionBannerText} numberOfLines={1}>
            {connectionRetrying ? <>{strings.chat.reconnecting.replace(/…$/, '')}<AnimatedEllipsis /></> : strings.chat.offline}
          </Text>
        </Pressable>
      )}
      {acpReadOnly && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <View style={styles.errorDot} />
          <Text style={styles.errorBannerText}>{strings.errors.CURSOR_SESSION_OWNED}</Text>
        </View>
      )}
      {storeError !== undefined && (
        <Pressable
          style={styles.errorBanner}
          accessibilityRole="alert"
          accessibilityLabel={storeError}
          onPress={clearError}
        >
          <View style={styles.errorDot} />
          <Text style={styles.errorBannerText} numberOfLines={2}>
            {storeError}
          </Text>
          <X size={14} color={colors.danger} />
        </Pressable>
      )}
      {memoryError !== undefined && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <View style={styles.errorDot} />
          <Text style={styles.errorBannerText} numberOfLines={2}>
            {memoryError}
          </Text>
        </View>
      )}
    </>
  const showSyncBanner = connected && busy === `session:${session.sessionId}`
  return (
    <ChatImageProvider value={imageLoader}>
      <MarkdownLinkProvider onLinkPress={onOpenLink} onFilePress={openWorkspaceFile} canStatFiles={connected}>
      <View style={styles.splitMain} {...swipeRightTouchProps}>
        {/* Messages scroll beneath the frosted header; the trajectory view keeps its own fixed search bar below it. */}
        <BlurHeaderFrame header={header} inset={trajectory}>{headerHeight => <ChatErrorBoundary resetKey={session.sessionId}><Animated.View style={[{ flex: 1 }, { opacity: trajectoryMotion, transform: [{ translateY: trajectoryMotion.interpolate({ inputRange: [0, 1], outputRange: [resolveMotion('fullscreen', reduceMotion).translate, 0] }) }] }]}>{trajectory ? <ChatTrajectory key={session.sessionId} items={messages} renderImages={images => <ChatImages images={images} />} hasMore={historyHasMore} loading={historyLoadingOlder} loadOlder={() => void loadOlderHistory()} renderItem={item => <ChatItemView item={item} compact={false} busyAction={busy} onApproval={respondApproval} onQuestion={respondQuestion} />} /> : <>
        {showSyncBanner && (
          <View pointerEvents="none" style={[styles.syncBanner, { position: 'absolute', top: headerHeight, left: 0, right: 0, zIndex: 5 }]} accessibilityRole="summary">
            <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.7 }] }} />
            <Text style={styles.connectionBannerText} numberOfLines={1}>
              {strings.chat.syncingHistory}
            </Text>
          </View>
        )}
        <FlatList
          ref={listRef}
          style={[styles.list, readableColumn]}
          contentContainerStyle={[styles.listContent, { paddingTop: headerHeight + spacing.xl }, visibleMessages.length === 0 ? styles.emptyList : styles.shortConversation]}
          data={displaySections}
          keyExtractor={item => item.key}
          renderItem={renderChatItem}
          initialNumToRender={2}
          maxToRenderPerBatch={1}
          updateCellsBatchingPeriod={32}
          windowSize={3}
          removeClippedSubviews={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onLayout={onListLayout}
          onContentSizeChange={onListContentSizeChange}
          onScroll={onListScroll}
          onViewableItemsChanged={viewability}
          onScrollToIndexFailed={info => {
            listRef.current?.scrollToOffset({offset: Math.max(0, info.averageItemLength * info.index), animated: false})
          }}
          maintainVisibleContentPosition={maintainVisibleContentPosition}
          scrollEventThrottle={16}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onListDragEnd}
          onMomentumScrollBegin={onMomentumScrollBegin}
          onMomentumScrollEnd={onListMomentumEnd}
          ListEmptyComponent={busy === `session:${session.sessionId}`
            ? <View style={{ padding: spacing.xl }}><ActivityIndicator size="large" color={colors.primary} /></View>
            : <WelcomeMessage policyHint={strings.chat[(BACKEND_CHAT_TEXT_KEYS[session.backend ?? 'harness'] ?? BACKEND_CHAT_TEXT_KEYS.harness).policyHint]} />}
          ListFooterComponent={replyActive ? (
            <ReplyStatusBanner
              label={stopping
                ? strings.chat.stopping
                : strings.chat[(BACKEND_CHAT_TEXT_KEYS[session.backend ?? 'harness'] ?? BACKEND_CHAT_TEXT_KEYS.harness).generating]}
              stopping={stopping}
            />
          ) : undefined}
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
      </>}</Animated.View></ChatErrorBoundary>}</BlurHeaderFrame>


      {mentionType !== null && (
        <Pressable
          style={styles.mentionBackdrop}
          onPress={() => { closeMention(); Keyboard.dismiss() }}
          accessibilityRole="button"
          accessibilityLabel={strings.common.close}
        />
      )}
      <View ref={composerAnchorRef} collapsable={false} style={styles.composerWrap}>
        <View style={[styles.composerInner, readableColumn]}>
        {connected && (session.backend === undefined || session.backend === 'harness' || Boolean(session.projections?.values?.todos) || Boolean(session.projections?.values?.goal) || childSessions.length > 0 || (teamState !== undefined && teamState.members.length > 0)) && (
          <SessionActivityDock
            session={session}
            connectionGeneration={chatImageConnectionGeneration()}
            childSessions={childSessions}
            teamState={teamState}
            sessions={sessions}
            onOpenSession={targetSession => void openSession(targetSession)}
          />
        )}
        {queueItems.length > 0 && <QueueDock items={queueItems} />}
        <ComposerFocusGate disabled={composerExpanded}>
          <ChatComposer
            backend={session.backend} draft={draft} input={mentionInput}
            quotes={quotes} onRemoveQuote={index => setQuotes(current => current.filter((_, i) => i !== index))}
            headerSlot={composerHeaderSlot}
            replyActive={replyActive && !acpReadOnly} stopping={stopping} commandRunning={commandRunning}
            hasComposerContent={hasComposerContent} connected={connected} editable={inputEditable}
            composerDisabled={composerDisabled} sendDisabled={sendDisabled}
            compactComposer={compactComposer} composerInputMaxHeight={composerInputMaxHeight}
            onOpenExpand={() => setComposerExpanded(true)}
            onOpenActions={openPlusMenu}
            onOpenPrompts={openPromptsPicker}
            onSubmit={() => void submit()} onStop={stopOrCancel}
          />
        </ComposerFocusGate>
        </View>
      </View>
      <ExpandedComposer
        visible={composerExpanded}
        onClose={() => setComposerExpanded(false)}
        backend={session.backend}
        draft={draft}
        quotes={quotes}
        onRemoveQuote={index => setQuotes(current => current.filter((_, i) => i !== index))}
        hasAttachments={images.length > 0 || stagedFiles.length > 0 || stagedReferences.length > 0 || pendingHandoff !== undefined}
        input={mentionInput}
        replyActive={replyActive && !acpReadOnly}
        stopping={stopping}
        sendDisabled={sendDisabled}
        onSubmit={() => void submit()}
        onStop={stopOrCancel}
      />
      </View>

      <LazySheetHost
        visible={plusMenuOpen}
        render={() => (
          <ChatActionMenu
            visible={plusMenuOpen} onClose={closePlusMenu} anchor={sheetAnchor}
            onDismiss={plusMenuActions.onDismiss} runAfterClose={runAfterPlusMenu}
            attachmentPicking={attachmentPicking}
            takePhoto={takePhoto} pickImages={pickImages} pickFiles={pickFiles}
            workspaceLabel={workspaceLabel} modeLabel={modeLabel}
            supportsModeSelection={supportsModeSelection} agentPresetSelecting={agentPresetSelecting}
            toolsAvailable={connected}
            permissionsAvailable={permissions !== undefined} permissionSelecting={permissionSelecting}
            permissionDisabled={permissionSelecting || (replyActive && !hasComposerContent)}
            permissionLabel={permissions === undefined ? undefined : permissionDisplayName(permissions.currentValue, currentPermission?.name)}
            onReferenceChat={(session.backend ?? 'harness') === 'harness' ? () => setReferenceChatOpen(true) : undefined}
            onOpenWorkspace={() => setWorkspacePickerOpen(true)} onOpenMode={() => setModePickerOpen(true)}
            onOpenTools={() => setToolPickerOpen(true)} onOpenPermissions={() => setPermissionPickerOpen(true)}
          />
        )}
      />

      {referenceChatOpen && (
        <ReferenceChatModal
          visible={referenceChatOpen}
          currentSessionId={session.sessionId}
          botState={botTeamState}
          onClose={() => setReferenceChatOpen(false)}
          onPick={(_mentionText, candidate) => {
            setStagedReferences(current =>
              current.some(item => item.sessionId === candidate.sessionId)
                ? current
                : [...current, candidate],
            )
          }}
        />
      )}

      <LazySheetHost
        visible={modelPickerOpen}
        render={() => (
          <ModelPicker
            visible={modelPickerOpen}
            models={sessionModels}
            onClose={() => setModelPickerOpen(false)}
            onPick={pickModel}
          />
        )}
      />
      {toolsMode !== undefined && connected && (
        <SessionToolsPanel
          key={`${session.sessionId}:${filesInitialPath ?? ''}`}
          mode={toolsMode}
          sessionId={session.sessionId}
          initialPath={toolsMode === 'files' ? filesInitialPath : undefined}
          changesSupported={hostWorkspaceGit}
          onClose={() => { setToolsMode(undefined); setFilesInitialPath(undefined) }}
          onQuoteToComposer={quoteChangeToComposer}
        />
      )}
      <FileViewerModal
        visible={previewFilePath !== undefined && connected}
        sessionId={session.sessionId}
        file={previewFilePath ?? ''}
        onClose={() => setPreviewFilePath(undefined)}
        onDismiss={fileViewerActions.onDismiss}
        onOpenDirectory={dir => {
          const generation = sessionGenerationRef.current
          fileViewerActions.run(
            () => setPreviewFilePath(undefined),
            () => {
              if (sessionGenerationRef.current !== generation) return
              setFilesInitialPath(dir)
              setToolsMode('files')
            },
          )
        }}
      />
      <LazySheetHost
        visible={permissionPickerOpen}
        render={() => (
          <PermissionPicker loading={permissionLoading} error={permissionError} onRetry={() => setPermissionRevision(v => v + 1)} visible={permissionPickerOpen} permissions={permissions} onClose={() => setPermissionPickerOpen(false)} onPick={pickPermission} />
        )}
      />
      <LazySheetHost
        visible={modePickerOpen}
        render={() => (
          <ModePicker visible={modePickerOpen} options={agentPresetOptions} current={currentAgentPresetId} loading={agentPresetLoading} selecting={agentPresetSelecting} onClose={() => setModePickerOpen(false)} onPick={pickMode} />
        )}
      />
      <LazySheetHost
        visible={sessionInfoOpen}
        render={() => (
          <SessionInfo
            visible={sessionInfoOpen}
            session={session}
            workspace={currentWorkspace}
            trajectory={trajectory}
            archived={sessionArchived}
            archiveDisabled={!connected || busy !== undefined}
            onClose={closeSessionInfo}
            onDismiss={sessionInfoActions.onDismiss}
            runAfterClose={runAfterSessionInfo}
            onOpenWorkspace={() => {
              if (onOpenWorkspaces !== undefined) onOpenWorkspaces(currentWorkspace === undefined ? undefined : workspaceStableKey(currentWorkspace, hostPlatform))
              else onOpenSessionsDrawer()
            }}
            onToggleTrajectory={() => {
              Keyboard.dismiss()
              setMentionType(null)
              setTrajectory(value => !value)
            }}
            onHandoff={canHandoffCurrentSession ? () => onOpenHandoff(session, currentWorkspace) : undefined}
            onToggleArchive={canArchiveSession ? toggleArchiveCurrentSession : undefined}
          />
        )}
      />
      <LazySheetHost
        visible={workspacePickerOpen}
        render={() => (
          <WorkspacePicker visible={workspacePickerOpen} workspaces={workspaces} currentSessionId={session.sessionId} sessionBackend={session.backend} busy={busy} onClose={() => setWorkspacePickerOpen(false)} onPick={pickWorkspace} onManage={() => { setWorkspacePickerOpen(false); onOpenSessionsDrawer() }} />
        )}
      />
      <LazySheetHost
        visible={toolPickerOpen}
        render={() => (
          <ToolAccessPicker visible={toolPickerOpen} supportsChanges={hostWorkspaceGit} onClose={() => setToolPickerOpen(false)} onPick={pickToolMode} />
        )}
      />
      <LazySheetHost
        visible={promptsPickerOpen}
        render={() => (
          <PromptsPicker
            visible={promptsPickerOpen}
            prompts={customPrompts ?? BUILT_IN_PROMPTS}
            actionMode={quickPromptActionMode}
            onToggleActionMode={mode => {
              void setQuickPromptActionMode(mode).catch(() => {
                Alert.alert(strings.settings.quickPromptActionMode, strings.settings.quickPromptActionSaveFailed)
              })
            }}
            onClose={() => setPromptsPickerOpen(false)}
            onPick={prompt => void pickQuickPrompt(prompt)}
            onManage={() => { setPromptsPickerOpen(false); setPromptsManagerOpen(true) }}
          />
        )}
      />
      <LazySheetHost
        visible={promptsManagerOpen}
        render={() => (
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
        )}
      />
      <LazySheetHost
        visible={promptEditing !== null}
        render={() => (
          <PromptEditor
            visible={promptEditing !== null}
            prompt={promptEditing === 'new' || promptEditing === null ? undefined : promptEditing}
            promptsLoading={promptsLoading}
            onBack={() => { setPromptEditing(null); setPromptsManagerOpen(true) }}
            onClose={() => setPromptEditing(null)}
            onSave={(title, text) => void savePromptEdit(title, text)}
          />
        )}
      />
      {previewImageUri !== undefined && (
        <Modal
          visible
          transparent
          animationType="none"
          onRequestClose={() => setPreviewImageUri(undefined)}
          statusBarTranslucent
        >
          <View style={styles.lightboxBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewImageUri(undefined)} />
            <Animated.Image
              source={{ uri: previewImageUri }}
              style={[styles.lightboxImage, {
                opacity: lightboxMotion,
                transform: [{ scale: lightboxMotion.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
              }]}
              resizeMode="contain"
            />
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
      )}
      <HandoffDraftPreviewModal
        visible={pendingHandoffPreviewOpen && pendingHandoff !== undefined}
        draft={pendingHandoff}
        onClose={() => setPendingHandoffPreviewOpen(false)}
      />
      </MarkdownLinkProvider>
    </ChatImageProvider>
  )
})

export { ModalSurface,usePickerListMaxHeight } from './chat/modal'
