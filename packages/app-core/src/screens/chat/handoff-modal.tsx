import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
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
  MoreHorizontal,
  X,
} from 'lucide-react-native'
import {
  buildHandoffPacket,
  parseHandoffMessage,
  type HandoffPreset,
  type PendingHandoffDraft,
} from '../../lib/handoff-context'
import { availableHandoffTargets, matchTargetWorkspace } from '../../lib/handoff-workspace'
import { strings } from '../../locales/i18n'
import { useAppStore } from '../../state/store'
import { selectCustomAcpBackends, type HandoffSessionResult } from '../../state/store-state'
import type { AgentBackend, ChatItem, RemoteSession, WorkspaceView } from '../../types'
import { Button, ErrorBanner, GroupCard, GroupRow, IconButton } from '../../ui/components'
import { maskPersonalPath } from '../../ui/mention-helpers'
import { continuousRadius, monoFontFamily } from '../../ui/platform-style'
import { SheetModal } from '../../ui/sheet'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { resolveSessionDisplayTitle } from '../session-title'
import { usePickerListMaxHeight } from './modal'
import { sessionTitle } from './presentation'

export function harnessDisplayName(value: AgentBackend): string {
  switch (value) {
    case 'harness': return 'DeepSeek'
    case 'codex': return 'Codex'
    case 'claude': return 'Claude'
    case 'hermes': return 'Hermes'
    case 'cursor': return 'Cursor'
    case 'antigravity': return 'Antigravity'
    case 'opencode': return 'OpenCode'
    case 'pi': return 'Pi'
    default: return value
  }
}

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

type HandoffSubView = 'main' | 'target' | 'workspace' | 'preview'

const VISIBLE_EDITED_FILES_CAP = 4

export function HandoffModal({
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

  const loadSessionHandoffItems = useAppStore(state => state.loadSessionHandoffItems)
  const refreshWorkspaces = useAppStore(state => state.refreshWorkspaces)
  const handoffSession = useAppStore(state => state.handoffSession)
  const workspaces = useAppStore(state => state.workspaces)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const codexAvailable = useAppStore(state => state.codexAvailable)
  const cursorAvailable = useAppStore(state => state.cursorAvailable)
  const antigravityAvailable = useAppStore(state => state.antigravityAvailable)
  const piAvailable = useAppStore(state => state.piAvailable)
  const opencodeAvailable = useAppStore(state => state.opencodeAvailable)
  const claudeAvailable = useAppStore(state => state.claudeAvailable)
  const hermesAvailable = useAppStore(state => state.hermesAvailable)
  const customAcpBackends = useAppStore(selectCustomAcpBackends)
  const liveSourceRunning = useAppStore(state =>
    sourceSession === undefined
      ? false
      : (state.sessions.find(item => item.sessionId === sourceSession.sessionId)?.running ?? sourceSession.running),
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
    customAcpBackends,
  }), [
    codexAvailable,
    cursorAvailable,
    antigravityAvailable,
    piAvailable,
    opencodeAvailable,
    claudeAvailable,
    hermesAvailable,
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
  const workspaceTouchedRef = useRef(false)
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
      return
    }
    workspaceTouchedRef.current = false
    refreshedBackendsRef.current.clear()
    setSubView('main')
    setTargetBackend(targetsRef.current[0])
    setWorkspaceChoice(undefined)
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

  const hasHandoffContent = packet !== undefined && (packet.meta.turnsCount > 0 || packet.editedFiles.length > 0)
  const hasValidWorkspace = workspaceChoice !== undefined && (
    workspaceChoice.mode === 'register'
      ? workspaceChoice.path.trim().length > 0
      : selectedExistingWorkspace !== undefined
  )
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
    if (backend !== targetBackend) {
      workspaceTouchedRef.current = false
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
      const result = await handoffSession({
        targetBackend,
        ...(workspaceChoice.mode === 'existing'
          ? { targetWorkspaceId: workspaceChoice.workspaceId }
          : { registerPath: workspaceChoice.path }),
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
      AccessibilityInfo.announceForAccessibility(strings.handoff.handoffSuccess)
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

  const headerTitle = subView === 'target'
    ? strings.handoff.targetAgent
    : subView === 'workspace'
      ? strings.handoff.targetWorkspace
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
          <Button
            label={targetBackend !== undefined
              ? strings.handoff.continueInTarget(harnessDisplayName(targetBackend))
              : strings.handoff.continueAction}
            variant="primary"
            loading={submitting}
            disabled={!canSubmit}
            onPress={() => void handleSubmit()}
          />
        </View>
      )}
    </SheetModal>
  )
}

export function HandoffDraftPreviewModal({
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
}

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
