import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRightLeft,
  Check,
  Eye,
  FileCode2,
  Folder,
  FolderPlus,
  History,
  MessageSquare,
  MoreHorizontal,
  Plus,
  X,
} from 'lucide-react-native'
import { useGatedStore } from '../../lib/gated-store'
import {
  buildHandoffPacket,
  parseHandoffMessage,
  type HandoffPreset,
  type PendingHandoffDraft,
} from '../../lib/handoff-context'
import {
  availableHandoffTargets,
  findLatestHandoffOrigin,
  matchTargetWorkspace,
  resolveHandoffTargetSessions,
} from '../../lib/handoff-workspace'
import { harnessDisplayName } from '../../lib/handoff-preview'
import { strings } from '../../locales/i18n'
import { useAppStore } from '../../state/store'
import { selectCustomAcpBackends, type HandoffSessionResult } from '../../state/store-state'
import type { AgentBackend, ChatItem, RemoteSession, WorkspaceView } from '../../types'
import { ErrorBanner, GroupCard, GroupRow, IconButton } from '../../ui/components'
import { maskPersonalPath } from '../../ui/mention-helpers'
import { continuousRadius, monoFontFamily } from '../../ui/platform-style'
import { SheetModal } from '../../ui/sheet'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { resolveSessionDisplayTitle } from '../session-title'
import { usePickerListMaxHeight } from './modal'
import { sessionTitle } from './presentation'

export { harnessDisplayName }

export function formatHandoffContextPreview(contextBlock: string): string {
  const parsed = parseHandoffMessage(contextBlock)
  if (parsed !== undefined) return parsed.contextBody
  return contextBlock
    .replace(/^<!--[^\r\n]*-->\r?\n?/u, '')
    .replace(/^<handoff_context>\r?\n?/u, '')
    .replace(/\r?\n?<\/handoff_context>\s*$/u, '')
    .trim()
}

export function handoffPresetLabel(preset: HandoffPreset): string {
  if (preset === 'review') return strings.handoff.presetReview
  if (preset === 'continue') return strings.handoff.presetContinue
  return strings.handoff.presetCustom
}

function splitEditedFilePath(path: string): { name: string; dir?: string } {
  const masked = maskPersonalPath(path)
  const sep = Math.max(masked.lastIndexOf('/'), masked.lastIndexOf('\\'))
  if (sep > 0 && sep < masked.length - 1) {
    return { name: masked.slice(sep + 1), dir: masked.slice(0, sep) }
  }
  return { name: masked }
}

type WorkspaceChoice =
  | { mode: 'existing'; workspaceId: string }
  | { mode: 'register'; path: string }
  | undefined

type SessionChoice =
  | { mode: 'new' }
  | { mode: 'existing'; sessionId: string }

type HandoffSubView = 'main' | 'target' | 'workspace' | 'session' | 'preview'

const VISIBLE_EDITED_FILES_CAP = 4

export const HandoffModal = memo(function HandoffModal({
  visible,
  sourceSession,
  sourceWorkspace,
  onClose,
  onDismiss,
  onCompleted,
}: {
  visible: boolean
  sourceSession?: RemoteSession
  sourceWorkspace?: WorkspaceView
  onClose: () => void
  onDismiss?: () => void
  onCompleted?: (result: HandoffSessionResult) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const listMaxHeight = usePickerListMaxHeight()

  const loadSessionHandoffItems = useGatedStore(useAppStore, state => state.loadSessionHandoffItems, visible)
  const refreshWorkspaces = useGatedStore(useAppStore, state => state.refreshWorkspaces, visible)
  const handoffSession = useGatedStore(useAppStore, state => state.handoffSession, visible)
  const workspaces = useGatedStore(useAppStore, state => state.workspaces, visible)
  const sessions = useGatedStore(useAppStore, state => state.sessions, visible)
  const archivedSessionIds = useGatedStore(useAppStore, state => state.archivedSessionIds, visible)
  const selectedDevice = useGatedStore(useAppStore, state => state.selectedDevice, visible)
  const connected = useGatedStore(useAppStore, state => state.connection.phase === 'connected', visible)
  const codexAvailable = useGatedStore(useAppStore, state => state.codexAvailable, visible)
  const cursorAvailable = useGatedStore(useAppStore, state => state.cursorAvailable, visible)
  const antigravityAvailable = useGatedStore(useAppStore, state => state.antigravityAvailable, visible)
  const piAvailable = useGatedStore(useAppStore, state => state.piAvailable, visible)
  const opencodeAvailable = useGatedStore(useAppStore, state => state.opencodeAvailable, visible)
  const claudeAvailable = useGatedStore(useAppStore, state => state.claudeAvailable, visible)
  const hermesAvailable = useGatedStore(useAppStore, state => state.hermesAvailable, visible)
  const kimiAvailable = useGatedStore(useAppStore, state => state.kimiAvailable, visible)
  const customAcpBackends = useGatedStore(useAppStore, selectCustomAcpBackends, visible)
  const liveSourceRunning = useGatedStore(useAppStore, state =>
    sourceSession === undefined
      ? false
      : (state.sessions.find(item => item.sessionId === sourceSession.sessionId)?.running ?? sourceSession.running),
    visible,
  )

  const sourceBackend: AgentBackend = sourceSession?.backend ?? sourceWorkspace?.backend ?? 'harness'
  const trimmedSessionCwd = sourceSession?.cwd?.trim()
  const trimmedWorkspacePath = sourceWorkspace?.path?.trim()
  const sourceCwd = (trimmedSessionCwd && trimmedSessionCwd.length > 0 ? trimmedSessionCwd : undefined)
    ?? (trimmedWorkspacePath && trimmedWorkspacePath.length > 0 ? trimmedWorkspacePath : undefined)

  const availability = useMemo(() => ({
    codexAvailable,
    cursorAvailable,
    antigravityAvailable,
    piAvailable,
    opencodeAvailable,
    claudeAvailable,
    hermesAvailable,
    kimiAvailable,
    customAcpBackends,
  }), [
    codexAvailable,
    cursorAvailable,
    antigravityAvailable,
    piAvailable,
    opencodeAvailable,
    claudeAvailable,
    hermesAvailable,
    kimiAvailable,
    customAcpBackends,
  ])

  const targets = useMemo(
    () => availableHandoffTargets(availability, sourceBackend),
    [availability, sourceBackend],
  )

  const [subView, setSubView] = useState<HandoffSubView>('main')
  const [items, setItems] = useState<ChatItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState<string>()
  const [reloadToken, setReloadToken] = useState(0)
  const [targetBackend, setTargetBackend] = useState<AgentBackend | undefined>(() => targets[0])
  const [workspaceChoice, setWorkspaceChoice] = useState<WorkspaceChoice>(undefined)
  const [sessionChoice, setSessionChoice] = useState<SessionChoice>({ mode: 'new' })
  const [refreshingTargetWorkspaces, setRefreshingTargetWorkspaces] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string>()

  const mountedRef = useRef(true)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const sourceSessionRef = useRef(sourceSession)
  sourceSessionRef.current = sourceSession
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const targetTouchedRef = useRef(false)
  const workspaceTouchedRef = useRef(false)
  const sessionTouchedRef = useRef(false)
  const refreshedBackendsRef = useRef<Set<AgentBackend>>(new Set())
  const refreshEpochRef = useRef(0)
  const submittingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const sourceSessionId = sourceSession?.sessionId

  // Reset transient modal form state when opening or switching source session.
  useEffect(() => {
    if (!visible || sourceSessionId === undefined) {
      refreshedBackendsRef.current.clear()
      refreshEpochRef.current += 1
      setTargetBackend(targetsRef.current[0])
      setWorkspaceChoice(undefined)
      setSessionChoice({ mode: 'new' })
      setItems([])
      return
    }
    targetTouchedRef.current = false
    workspaceTouchedRef.current = false
    sessionTouchedRef.current = false
    refreshedBackendsRef.current.clear()
    setSubView('main')
    setTargetBackend(targetsRef.current[0])
    setWorkspaceChoice(undefined)
    setSessionChoice({ mode: 'new' })
    setSubmitting(false)
    setSubmitError(undefined)
  }, [visible, sourceSessionId])

  // Keep selected target valid if host availability changes while open.
  useEffect(() => {
    if (!visible) return
    if (targets.length === 0) {
      setTargetBackend(undefined)
      return
    }
    if (targetBackend === undefined || !targets.includes(targetBackend)) {
      workspaceTouchedRef.current = false
      sessionTouchedRef.current = false
      setTargetBackend(targets[0])
    }
  }, [visible, targets, targetBackend])

  // Load source session history with cancellation guard.
  useEffect(() => {
    const activeSession = sourceSessionRef.current
    if (!visible || sourceSessionId === undefined || activeSession === undefined) return
    let cancelled = false
    setLoadingHistory(true)
    setHistoryError(undefined)
    setItems([])
    void loadSessionHandoffItems(activeSession)
      .then(loaded => {
        if (cancelled) return
        setItems(loaded)
      })
      .catch(error => {
        if (cancelled) return
        setHistoryError(error instanceof Error && error.message.trim().length > 0
          ? error.message
          : strings.handoff.loadHistoryFailed)
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible, sourceSessionId, reloadToken, loadSessionHandoffItems])

  // Lazily discover workspaces for the chosen target backend once per modal open.
  useEffect(() => {
    if (!visible || !connected || targetBackend === undefined) {
      setRefreshingTargetWorkspaces(false)
      return
    }
    if (refreshedBackendsRef.current.has(targetBackend)) {
      setRefreshingTargetWorkspaces(false)
      return
    }
    refreshedBackendsRef.current.add(targetBackend)
    const epoch = ++refreshEpochRef.current
    setRefreshingTargetWorkspaces(true)
    void refreshWorkspaces(targetBackend).finally(() => {
      if (mountedRef.current && refreshEpochRef.current === epoch) {
        setRefreshingTargetWorkspaces(false)
      }
    })
  }, [visible, connected, targetBackend, refreshWorkspaces])

  const workspaceMatch = useMemo(() => {
    if (targetBackend === undefined) return undefined
    return matchTargetWorkspace({
      workspaces,
      targetBackend,
      sourceCwd,
      hostPlatform: selectedDevice?.platform,
    })
  }, [workspaces, targetBackend, sourceCwd, selectedDevice?.platform])

  useEffect(() => {
    if (!visible || targetBackend === undefined || workspaceMatch === undefined) return
    if (workspaceMatch.matched !== undefined) {
      const matchedId = workspaceMatch.matched.workspaceId
      setWorkspaceChoice(current => {
        if (workspaceTouchedRef.current && current?.mode === 'existing') {
          const stillValid = workspaces.some(
            item => item.workspaceId === current.workspaceId && (item.backend ?? 'harness') === targetBackend,
          )
          if (stillValid) return current
        }
        return { mode: 'existing', workspaceId: matchedId }
      })
      return
    }
    if (workspaceMatch.canRegisterSourceCwd && sourceCwd !== undefined) {
      setWorkspaceChoice(current => {
        if (workspaceTouchedRef.current && current?.mode === 'existing') {
          const stillValid = workspaces.some(
            item => item.workspaceId === current.workspaceId && (item.backend ?? 'harness') === targetBackend,
          )
          if (stillValid) return current
        }
        return { mode: 'register', path: sourceCwd }
      })
      return
    }
    setWorkspaceChoice(current => {
      if (current?.mode === 'existing') {
        const stillValid = workspaces.some(
          item => item.workspaceId === current.workspaceId && (item.backend ?? 'harness') === targetBackend,
        )
        if (stillValid) return current
      }
      return undefined
    })
  }, [visible, targetBackend, workspaceMatch, sourceCwd, workspaces])

  const packet = useMemo(() => {
    if (sourceSession === undefined || targetBackend === undefined || loadingHistory || historyError !== undefined) {
      return undefined
    }
    return buildHandoffPacket({
      items,
      sourceBackend,
      targetBackend,
      sourceSessionId: sourceSession.sessionId,
      sourceTitle: resolveSessionDisplayTitle(sourceSession),
      cwd: sourceCwd,
      preset: 'custom',
    })
  }, [items, sourceBackend, targetBackend, sourceSession, sourceCwd, loadingHistory, historyError])

  const selectedExistingWorkspace = useMemo(() => {
    if (workspaceChoice?.mode !== 'existing') return undefined
    return workspaces.find(
      item => item.workspaceId === workspaceChoice.workspaceId && (item.backend ?? 'harness') === targetBackend,
    )
  }, [workspaceChoice, workspaces, targetBackend])

  const incomingOrigin = useMemo(() => findLatestHandoffOrigin(items), [items])

  // Auto-select the agent that handed context into this conversation so bounce-back flows (e.g. Claude -> Codex -> Claude) take one tap.
  useEffect(() => {
    if (!visible || loadingHistory || targetTouchedRef.current || incomingOrigin === undefined) return
    if (incomingOrigin.sourceSessionId === sourceSessionId) return
    if (!targets.includes(incomingOrigin.sourceBackend)) return
    setTargetBackend(current => {
      if (current === incomingOrigin.sourceBackend) return current
      workspaceTouchedRef.current = false
      sessionTouchedRef.current = false
      return incomingOrigin.sourceBackend
    })
  }, [visible, loadingHistory, incomingOrigin, targets, sourceSessionId])

  const hasHandoffContent = packet !== undefined && (packet.meta.turnsCount > 0 || packet.editedFiles.length > 0)
  const hasValidWorkspace = workspaceChoice !== undefined && (
    workspaceChoice.mode === 'register'
      ? workspaceChoice.path.trim().length > 0
      : selectedExistingWorkspace !== undefined
  )

  const targetSessionResolution = useMemo(() => {
    if (targetBackend === undefined || !hasValidWorkspace) {
      return { originSession: undefined, sessions: [] }
    }
    return resolveHandoffTargetSessions({
      items,
      sessions,
      targetBackend,
      targetWorkspace: selectedExistingWorkspace,
      registerPath: workspaceChoice?.mode === 'register' ? workspaceChoice.path : undefined,
      archivedSessionIds,
      sourceSessionId,
      hostPlatform: selectedDevice?.platform,
    })
  }, [
    items,
    sessions,
    targetBackend,
    hasValidWorkspace,
    selectedExistingWorkspace,
    workspaceChoice,
    archivedSessionIds,
    sourceSessionId,
    selectedDevice?.platform,
  ])

  useEffect(() => {
    if (!visible || targetBackend === undefined || !hasValidWorkspace) {
      setSessionChoice({ mode: 'new' })
      return
    }
    const eligibleIds = new Set(targetSessionResolution.sessions.map(item => item.session.sessionId))
    setSessionChoice(current => {
      if (sessionTouchedRef.current) {
        if (current.mode === 'new') return current
        if (eligibleIds.has(current.sessionId)) return current
      }
      if (targetSessionResolution.originSession !== undefined) {
        return { mode: 'existing', sessionId: targetSessionResolution.originSession.sessionId }
      }
      return { mode: 'new' }
    })
  }, [visible, targetBackend, hasValidWorkspace, targetSessionResolution])

  const selectedTargetOption = useMemo(() => {
    if (sessionChoice.mode !== 'existing') return undefined
    return targetSessionResolution.sessions.find(item => item.session.sessionId === sessionChoice.sessionId)
  }, [sessionChoice, targetSessionResolution])

  const canSubmit = connected
    && !loadingHistory
    && historyError === undefined
    && hasHandoffContent
    && targetBackend !== undefined
    && hasValidWorkspace
    && !submitting

  const handleClose = () => {
    if (submitting) return
    onClose()
  }

  const handleRequestClose = () => {
    if (submitting) return
    if (subView !== 'main') {
      setSubView('main')
      return
    }
    onClose()
  }

  const handleSelectTarget = (backend: AgentBackend) => {
    if (submitting) return
    targetTouchedRef.current = true
    if (backend !== targetBackend) {
      workspaceTouchedRef.current = false
      sessionTouchedRef.current = false
      setSubmitError(undefined)
      setTargetBackend(backend)
    }
    setSubView('main')
  }

  const handleSubmit = async () => {
    if (submittingRef.current || !canSubmit || packet === undefined || targetBackend === undefined || workspaceChoice === undefined) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(undefined)
    try {
      const targetSessionId = selectedTargetOption?.session.sessionId
      const result = await handoffSession({
        targetBackend,
        ...(workspaceChoice.mode === 'existing'
          ? { targetWorkspaceId: workspaceChoice.workspaceId }
          : { registerPath: workspaceChoice.path }),
        ...(targetSessionId !== undefined ? { targetSessionId } : {}),
        instruction: '',
        packet,
        mode: 'draft',
      })
      if (!mountedRef.current || !visibleRef.current) return
      if (!result.ok) {
        setSubmitError(result.error ?? strings.errors.unknown)
        return
      }
      onClose()
      onCompleted?.(result)
      AccessibilityInfo.announceForAccessibility(
        targetSessionId !== undefined
          ? strings.handoff.handoffExistingSuccess
          : strings.handoff.handoffSuccess,
      )
    } catch (error) {
      if (!mountedRef.current || !visibleRef.current) return
      setSubmitError(error instanceof Error ? error.message : strings.errors.unknown)
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  const previewText = useMemo(
    () => (packet === undefined ? '' : formatHandoffContextPreview(packet.contextBlock)),
    [packet],
  )
  const sizeKb = packet === undefined ? '0.0' : Math.max(0.1, packet.summaryBytes / 1024).toFixed(1)
  const hasWorkspaceOptions = Boolean(
    workspaceMatch !== undefined
    && (
      workspaceMatch.matched !== undefined
      || (workspaceMatch.canRegisterSourceCwd && sourceCwd !== undefined)
      || workspaceMatch.otherWorkspaces.length > 0
    ),
  )

  const targetRowValue = targetBackend === undefined
    ? strings.handoff.noTargetAgent
    : targetBackend === sourceBackend
      ? `${harnessDisplayName(targetBackend)} · ${strings.handoff.sameBackendTag}`
      : harnessDisplayName(targetBackend)

  const workspaceRowInfo = (() => {
    if (selectedExistingWorkspace !== undefined) {
      const maskedPath = maskPersonalPath(selectedExistingWorkspace.path)
      const isMatched = workspaceMatch?.matched?.workspaceId === selectedExistingWorkspace.workspaceId
      return {
        value: selectedExistingWorkspace.title || maskedPath,
        detail: isMatched ? strings.handoff.matchedWorkspaceDetail(maskedPath) : maskedPath,
      }
    }
    if (workspaceChoice?.mode === 'register' && sourceCwd !== undefined) {
      const maskedSourceCwd = maskPersonalPath(sourceCwd)
      return {
        value: strings.handoff.registerWorkspaceShort,
        detail: strings.handoff.registerSameCwdHint(maskedSourceCwd),
      }
    }
    return {
      value: strings.handoff.noWorkspaceShort,
      detail: strings.handoff.noWorkspaceAvailable,
    }
  })()

  const hasSessionOptions = targetSessionResolution.sessions.length > 0
  const sessionRowInfo = (() => {
    if (selectedTargetOption !== undefined) {
      const title = sessionTitle(selectedTargetOption.session)
      if (selectedTargetOption.isOrigin) {
        return {
          value: strings.handoff.originSessionTag,
          detail: strings.handoff.originSessionDetail(title),
        }
      }
      return {
        value: strings.handoff.existingSessionTag,
        detail: title,
      }
    }
    return {
      value: strings.handoff.newSessionTag,
      detail: hasSessionOptions
        ? strings.handoff.newSessionSwitchHint(targetSessionResolution.sessions.length)
        : strings.handoff.newSessionDetail,
    }
  })()

  const submitLabel = targetBackend === undefined
    ? strings.handoff.continueAction
    : selectedTargetOption?.isOrigin
      ? strings.handoff.continueInOrigin(harnessDisplayName(targetBackend))
      : selectedTargetOption !== undefined
        ? strings.handoff.continueInExisting(harnessDisplayName(targetBackend))
        : strings.handoff.continueInTarget(harnessDisplayName(targetBackend))

  const headerTitle = subView === 'target'
    ? strings.handoff.targetAgent
    : subView === 'workspace'
      ? strings.handoff.targetWorkspace
      : subView === 'session'
        ? strings.handoff.targetSession
        : subView === 'preview'
          ? strings.handoff.previewModalTitle
          : strings.handoff.title

  const scrollMaxHeight = Math.max(
    180,
    subView === 'main' ? listMaxHeight - 54 : listMaxHeight + 24,
  )

  return (
    <SheetModal
      visible={visible}
      onClose={handleClose}
      onRequestClose={handleRequestClose}
      onDismiss={onDismiss}
    >
      <View style={styles.header}>
        {subView !== 'main' && (
          <IconButton
            label={strings.common.back}
            icon={ArrowLeft}
            dense
            disabled={submitting}
            onPress={() => setSubView('main')}
          />
        )}
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>{headerTitle}</Text>
          {subView === 'main' && sourceSession !== undefined && (
            <Text style={styles.sourceMeta} numberOfLines={1}>
              {harnessDisplayName(sourceBackend)} · {sessionTitle(sourceSession)}
            </Text>
          )}
        </View>
        <IconButton
          label={strings.common.close}
          icon={X}
          dense
          disabled={submitting}
          onPress={handleClose}
        />
      </View>

      <ScrollView
        style={{ flexShrink: 1, maxHeight: scrollMaxHeight }}
        contentContainerStyle={[
          styles.scrollContent,
          subView !== 'main' && { paddingBottom: Math.max(spacing.sm, insets.bottom) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={subView === 'preview'}
        nestedScrollEnabled
      >
        {subView === 'main' && (
          <>
            {liveSourceRunning && (
              <View style={styles.warningBanner}>
                <AlertCircle size={16} color={colors.warning} />
                <Text style={styles.warningText}>{strings.handoff.sourceRunningHint}</Text>
              </View>
            )}

            <GroupCard>
              <GroupRow
                first
                icon={ArrowRightLeft}
                label={strings.handoff.targetAgent}
                value={targetRowValue}
                chevron={targets.length > 0}
                disabled={submitting || targets.length === 0}
                onPress={targets.length > 0 ? () => setSubView('target') : undefined}
              />
              {targetBackend !== undefined && (
                <GroupRow
                  icon={workspaceChoice?.mode === 'register' ? FolderPlus : Folder}
                  label={strings.handoff.targetWorkspace}
                  detail={workspaceRowInfo.detail}
                  value={refreshingTargetWorkspaces ? undefined : workspaceRowInfo.value}
                  accessory={refreshingTargetWorkspaces
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : undefined}
                  chevron={hasWorkspaceOptions}
                  disabled={submitting || !hasWorkspaceOptions}
                  onPress={hasWorkspaceOptions ? () => setSubView('workspace') : undefined}
                />
              )}
              {targetBackend !== undefined && hasValidWorkspace && (
                <GroupRow
                  icon={selectedTargetOption?.isOrigin ? History : MessageSquare}
                  label={strings.handoff.targetSession}
                  value={sessionRowInfo.value}
                  detail={sessionRowInfo.detail}
                  chevron={hasSessionOptions}
                  disabled={submitting || !hasSessionOptions}
                  onPress={hasSessionOptions ? () => setSubView('session') : undefined}
                />
              )}
            </GroupCard>

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>
                  {packet !== undefined && packet.editedFiles.length > 0
                    ? strings.handoff.editedFilesLabel
                    : strings.handoff.contextSectionTitle}
                </Text>
                {packet !== undefined && hasHandoffContent && (
                  <Text style={styles.sectionMeta}>
                    {strings.handoff.contextSummaryShort(packet.meta.turnsCount, sizeKb)}
                  </Text>
                )}
              </View>

              {loadingHistory ? (
                <GroupCard>
                  <View style={styles.loadingCard}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.loadingText}>{strings.handoff.loadingHistory}</Text>
                  </View>
                </GroupCard>
              ) : historyError !== undefined ? (
                <ErrorBanner
                  message={historyError}
                  onRetry={() => setReloadToken(value => value + 1)}
                />
              ) : !hasHandoffContent ? (
                <GroupCard>
                  <GroupRow
                    first
                    icon={FileCode2}
                    label={strings.handoff.emptyHistory}
                    chevron={false}
                  />
                </GroupCard>
              ) : packet !== undefined && (
                <GroupCard>
                  {packet.editedFiles.length > 0 ? (
                    <>
                      {packet.editedFiles.slice(0, VISIBLE_EDITED_FILES_CAP).map((file, index) => {
                        const { name, dir } = splitEditedFilePath(file)
                        return (
                          <GroupRow
                            key={file}
                            first={index === 0}
                            icon={FileCode2}
                            label={name}
                            detail={dir}
                            chevron={false}
                          />
                        )
                      })}
                      {packet.editedFiles.length > VISIBLE_EDITED_FILES_CAP && (
                        <GroupRow
                          icon={MoreHorizontal}
                          label={strings.handoff.moreEditedFiles(packet.editedFiles.length)}
                          chevron
                          onPress={() => setSubView('preview')}
                        />
                      )}
                    </>
                  ) : (
                    <GroupRow
                      first
                      icon={Folder}
                      label={strings.handoff.noEditedFiles}
                      detail={strings.handoff.workspaceFullAccessHint}
                      chevron={false}
                    />
                  )}
                  <GroupRow
                    icon={Eye}
                    label={strings.handoff.previewToggle}
                    detail={packet.meta.omittedTurns > 0
                      ? strings.handoff.omittedTurnsNote(packet.meta.omittedTurns)
                      : undefined}
                    chevron
                    onPress={() => setSubView('preview')}
                  />
                </GroupCard>
              )}
            </View>
          </>
        )}

        {subView === 'target' && (
          <GroupCard>
            {targets.map((backend, index) => {
              const selected = backend === targetBackend
              const sameBackend = backend === sourceBackend
              return (
                <GroupRow
                  key={backend}
                  first={index === 0}
                  label={harnessDisplayName(backend)}
                  detail={sameBackend ? strings.handoff.sameBackendHint : undefined}
                  selected={selected}
                  chevron={false}
                  accessory={selected ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                  onPress={() => handleSelectTarget(backend)}
                />
              )
            })}
          </GroupCard>
        )}

        {subView === 'workspace' && workspaceMatch !== undefined && (
          <View style={styles.subViewStack}>
            {workspaceMatch.matched !== undefined && (() => {
              const matched = workspaceMatch.matched
              const maskedPath = maskPersonalPath(matched.path)
              const selected = workspaceChoice?.mode === 'existing'
                && workspaceChoice.workspaceId === matched.workspaceId
              return (
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>{strings.handoff.matchedWorkspace}</Text>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={Folder}
                      label={matched.title || maskedPath}
                      detail={maskedPath}
                      selected={selected}
                      chevron={false}
                      accessory={selected ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                      onPress={() => {
                        workspaceTouchedRef.current = true
                        sessionTouchedRef.current = false
                        setWorkspaceChoice({ mode: 'existing', workspaceId: matched.workspaceId })
                        setSubView('main')
                      }}
                    />
                  </GroupCard>
                </View>
              )
            })()}

            {workspaceMatch.canRegisterSourceCwd && sourceCwd !== undefined && (() => {
              const maskedSourceCwd = maskPersonalPath(sourceCwd)
              const selected = workspaceChoice?.mode === 'register'
              return (
                <View style={styles.sectionBlock}>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={FolderPlus}
                      label={strings.handoff.registerSameCwd}
                      detail={strings.handoff.registerSameCwdHint(maskedSourceCwd)}
                      selected={selected}
                      chevron={false}
                      accessory={selected ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                      onPress={() => {
                        workspaceTouchedRef.current = true
                        sessionTouchedRef.current = false
                        setWorkspaceChoice({ mode: 'register', path: sourceCwd })
                        setSubView('main')
                      }}
                    />
                  </GroupCard>
                </View>
              )
            })()}

            {workspaceMatch.otherWorkspaces.length > 0 && (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>{strings.handoff.pickExistingWorkspace}</Text>
                <GroupCard>
                  {workspaceMatch.otherWorkspaces.map((workspace, index) => {
                    const maskedPath = maskPersonalPath(workspace.path)
                    const selected = workspaceChoice?.mode === 'existing'
                      && workspaceChoice.workspaceId === workspace.workspaceId
                    return (
                      <GroupRow
                        key={workspace.workspaceId}
                        first={index === 0}
                        icon={Folder}
                        label={workspace.title || maskedPath}
                        detail={maskedPath}
                        selected={selected}
                        chevron={false}
                        accessory={selected ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                        onPress={() => {
                          workspaceTouchedRef.current = true
                          sessionTouchedRef.current = false
                          setWorkspaceChoice({ mode: 'existing', workspaceId: workspace.workspaceId })
                          setSubView('main')
                        }}
                      />
                    )
                  })}
                </GroupCard>
              </View>
            )}
          </View>
        )}

        {subView === 'session' && (
          <View style={styles.subViewStack}>
            {targetSessionResolution.originSession !== undefined && (() => {
              const origin = targetSessionResolution.originSession
              const selected = sessionChoice.mode === 'existing'
                && sessionChoice.sessionId === origin.sessionId
              return (
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>{strings.handoff.originSessionSection}</Text>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={History}
                      label={sessionTitle(origin)}
                      detail={strings.handoff.originSessionHint}
                      selected={selected}
                      chevron={false}
                      accessory={selected ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                      onPress={() => {
                        sessionTouchedRef.current = true
                        setSessionChoice({ mode: 'existing', sessionId: origin.sessionId })
                        setSubView('main')
                      }}
                    />
                  </GroupCard>
                </View>
              )
            })()}

            <View style={styles.sectionBlock}>
              <GroupCard>
                <GroupRow
                  first
                  icon={Plus}
                  label={strings.handoff.newSessionTag}
                  detail={strings.handoff.newSessionDetail}
                  selected={sessionChoice.mode === 'new'}
                  chevron={false}
                  accessory={sessionChoice.mode === 'new' ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                  onPress={() => {
                    sessionTouchedRef.current = true
                    setSessionChoice({ mode: 'new' })
                    setSubView('main')
                  }}
                />
              </GroupCard>
            </View>

            {(() => {
              const nonOriginSessions = targetSessionResolution.sessions.filter(item => !item.isOrigin)
              if (nonOriginSessions.length === 0) return null
              return (
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>{strings.handoff.existingSessionsSection}</Text>
                  <GroupCard>
                    {nonOriginSessions.map((option, index) => {
                      const selected = sessionChoice.mode === 'existing'
                        && sessionChoice.sessionId === option.session.sessionId
                      return (
                        <GroupRow
                          key={option.session.sessionId}
                          first={index === 0}
                          icon={MessageSquare}
                          label={sessionTitle(option.session)}
                          selected={selected}
                          chevron={false}
                          accessory={selected ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                          onPress={() => {
                            sessionTouchedRef.current = true
                            setSessionChoice({ mode: 'existing', sessionId: option.session.sessionId })
                            setSubView('main')
                          }}
                        />
                      )
                    })}
                  </GroupCard>
                </View>
              )
            })()}
          </View>
        )}

        {subView === 'preview' && packet !== undefined && (
          <View style={styles.subViewStack}>
            {packet.editedFiles.length > 0 && (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>
                  {strings.handoff.allEditedFilesLabel(packet.editedFiles.length)}
                </Text>
                <GroupCard>
                  {packet.editedFiles.map((file, index) => {
                    const { name, dir } = splitEditedFilePath(file)
                    return (
                      <GroupRow
                        key={file}
                        first={index === 0}
                        icon={FileCode2}
                        label={name}
                        detail={dir}
                        chevron={false}
                      />
                    )
                  })}
                </GroupCard>
              </View>
            )}

            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>
                {strings.handoff.contextSummaryShort(packet.meta.turnsCount, sizeKb)}
              </Text>
              <View style={styles.previewContainer}>
                <Text selectable style={styles.previewCode}>{previewText}</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {subView === 'main' && (
        <View style={[styles.footer, { paddingBottom: insets.bottom > 0 ? spacing.xxs : 0 }]}>
          {submitError !== undefined && (
            <View accessibilityRole="alert" style={styles.submitErrorBanner}>
              <AlertCircle size={16} color={colors.danger} />
              <Text style={styles.submitErrorText}>{submitError}</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={submitLabel}
            accessibilityState={{ disabled: !canSubmit, busy: submitting }}
            disabled={!canSubmit}
            onPress={() => void handleSubmit()}
            style={({ pressed }) => [
              styles.submitButton,
              !canSubmit && styles.submitButtonDisabled,
              pressed && canSubmit && styles.submitButtonPressed,
            ]}
          >
            {submitting && (
              <ActivityIndicator size="small" color={colors.onPrimary ?? colors.white} />
            )}
            <Text numberOfLines={1} style={styles.submitButtonText}>
              {submitLabel}
            </Text>
          </Pressable>
        </View>
      )}
    </SheetModal>
  )
})

export const HandoffDraftPreviewModal = memo(function HandoffDraftPreviewModal({
  visible,
  draft,
  onClose,
}: {
  visible: boolean
  draft?: PendingHandoffDraft
  onClose: () => void
}) {
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const listMaxHeight = usePickerListMaxHeight()
  const previewText = useMemo(
    () => (draft === undefined ? '' : formatHandoffContextPreview(draft.contextBlock)),
    [draft],
  )
  const meta = draft?.meta

  return (
    <SheetModal visible={visible && draft !== undefined} onClose={onClose}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>{strings.handoff.previewModalTitle}</Text>
          {meta !== undefined && (
            <Text style={styles.subtitle} numberOfLines={2}>
              {[
                strings.handoff.cardTitle(harnessDisplayName(meta.sourceBackend), harnessDisplayName(meta.targetBackend)),
                meta.preset === 'custom' ? undefined : handoffPresetLabel(meta.preset),
                meta.filesCount > 0
                  ? strings.handoff.cardStats(meta.turnsCount, meta.filesCount)
                  : strings.handoff.cardStatsNoFiles(meta.turnsCount),
              ].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        <IconButton label={strings.common.close} icon={X} dense onPress={onClose} />
      </View>
      <ScrollView
        style={{ flexShrink: 1, maxHeight: Math.max(160, listMaxHeight - 24) }}
        contentContainerStyle={[styles.draftPreviewScrollContent, { paddingBottom: Math.max(spacing.sm, insets.bottom) }]}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        <View style={styles.previewContainer}>
          <Text selectable style={styles.previewCode}>{previewText}</Text>
        </View>
      </ScrollView>
    </SheetModal>
  )
})

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.heading, color: colors.ink },
  subtitle: { ...type.small, color: colors.muted },
  sourceMeta: { ...type.small, color: colors.muted },
  scrollContent: { gap: spacing.md, paddingBottom: spacing.xxs },
  subViewStack: { gap: spacing.md },
  sectionBlock: { gap: spacing.xs },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  sectionLabel: { ...type.smallStrong, color: colors.muted },
  sectionMeta: { ...type.caption, color: colors.muted },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...continuousRadius(radius.lg),
    backgroundColor: colors.warningSoft,
  },
  warningText: { ...type.small, color: colors.ink, flex: 1 },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  loadingText: { ...type.small, color: colors.muted },
  previewContainer: {
    ...continuousRadius(radius.xl),
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    padding: spacing.md,
  },
  previewCode: { fontFamily: monoFontFamily, fontSize: 12, lineHeight: 18, color: colors.ink },
  draftPreviewScrollContent: { paddingTop: spacing.xxs },
  footer: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  submitButton: {
    minHeight: 50,
    paddingHorizontal: spacing.xl,
    ...continuousRadius(radius.md),
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  submitButtonDisabled: {
    opacity: 0.52,
  },
  submitButtonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  submitButtonText: {
    ...type.bodyStrong,
    color: colors.onPrimary ?? colors.white,
  },
  submitErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...continuousRadius(radius.md),
    backgroundColor: colors.dangerSoft,
  },
  submitErrorText: { ...type.caption, color: colors.danger, flex: 1 },
})
