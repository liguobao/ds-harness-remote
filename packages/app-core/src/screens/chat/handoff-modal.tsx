import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Folder,
  FolderPlus,
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
import { Alert } from '../../ui/alert'
import { Button, ErrorBanner, IconButton } from '../../ui/components'
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

function defaultInstructionForPreset(preset: HandoffPreset): string {
  if (preset === 'review') return strings.handoff.defaultReviewInstruction
  if (preset === 'continue') return strings.handoff.defaultContinueInstruction
  return ''
}

export function handoffPresetLabel(preset: HandoffPreset): string {
  if (preset === 'review') return strings.handoff.presetReview
  if (preset === 'continue') return strings.handoff.presetContinue
  return strings.handoff.presetCustom
}

type WorkspaceChoice =
  | { mode: 'existing'; workspaceId: string }
  | { mode: 'register'; path: string }
  | undefined

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

  const [items, setItems] = useState<ChatItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState<string>()
  const [reloadToken, setReloadToken] = useState(0)
  const [targetBackend, setTargetBackend] = useState<AgentBackend | undefined>(() => targets[0])
  const [preset, setPreset] = useState<HandoffPreset>('review')
  const [instruction, setInstruction] = useState(() => strings.handoff.defaultReviewInstruction)
  const [workspaceChoice, setWorkspaceChoice] = useState<WorkspaceChoice>(undefined)
  const [refreshingTargetWorkspaces, setRefreshingTargetWorkspaces] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [submittingMode, setSubmittingMode] = useState<'send' | 'draft' | undefined>(undefined)
  const [submitError, setSubmitError] = useState<string>()

  const mountedRef = useRef(true)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const sourceSessionRef = useRef(sourceSession)
  sourceSessionRef.current = sourceSession
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const instructionEditedRef = useRef(false)
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
    instructionEditedRef.current = false
    workspaceTouchedRef.current = false
    refreshedBackendsRef.current.clear()
    setPreset('review')
    setInstruction(strings.handoff.defaultReviewInstruction)
    setTargetBackend(targetsRef.current[0])
    setWorkspaceChoice(undefined)
    setPreviewOpen(false)
    setSubmittingMode(undefined)
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
      preset,
    })
  }, [items, sourceBackend, targetBackend, sourceSession, sourceCwd, preset, loadingHistory, historyError])

  const hasHandoffContent = packet !== undefined && (packet.meta.turnsCount > 0 || packet.editedFiles.length > 0)
  const hasValidWorkspace = workspaceChoice !== undefined && (
    workspaceChoice.mode === 'register'
      ? workspaceChoice.path.trim().length > 0
      : workspaces.some(item => item.workspaceId === workspaceChoice.workspaceId && (item.backend ?? 'harness') === targetBackend)
  )
  const canSubmit = connected
    && !loadingHistory
    && historyError === undefined
    && hasHandoffContent
    && targetBackend !== undefined
    && hasValidWorkspace
    && submittingMode === undefined

  const handleClose = () => {
    if (submittingMode !== undefined) return
    onClose()
  }

  const handleSelectTarget = (backend: AgentBackend) => {
    if (submittingMode !== undefined || backend === targetBackend) return
    workspaceTouchedRef.current = false
    setSubmitError(undefined)
    setTargetBackend(backend)
  }

  const handleSelectPreset = (nextPreset: HandoffPreset) => {
    if (submittingMode !== undefined) return
    setPreset(nextPreset)
    if (!instructionEditedRef.current) {
      setInstruction(defaultInstructionForPreset(nextPreset))
    }
  }

  const handleSubmit = async (mode: 'send' | 'draft') => {
    if (submittingRef.current || !canSubmit || packet === undefined || targetBackend === undefined || workspaceChoice === undefined) return
    submittingRef.current = true
    setSubmittingMode(mode)
    setSubmitError(undefined)
    try {
      const result = await handoffSession({
        targetBackend,
        ...(workspaceChoice.mode === 'existing'
          ? { targetWorkspaceId: workspaceChoice.workspaceId }
          : { registerPath: workspaceChoice.path }),
        instruction: instruction.trim(),
        packet,
        mode,
      })
      if (!mountedRef.current || !visibleRef.current) return
      if (!result.ok) {
        setSubmitError(result.error ?? strings.errors.unknown)
        return
      }
      onClose()
      onCompleted?.(result)
      if (result.delivered === 'draft-fallback') {
        Alert.alert(strings.handoff.title, strings.handoff.draftFallbackNotice)
      } else {
        AccessibilityInfo.announceForAccessibility(strings.handoff.handoffSuccess)
      }
    } catch (error) {
      if (!mountedRef.current || !visibleRef.current) return
      setSubmitError(error instanceof Error ? error.message : strings.errors.unknown)
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmittingMode(undefined)
    }
  }

  const previewText = useMemo(
    () => (packet === undefined ? '' : formatHandoffContextPreview(packet.contextBlock)),
    [packet],
  )
  const sizeKb = packet === undefined ? '0.0' : Math.max(0.1, packet.summaryBytes / 1024).toFixed(1)
  const scrollMaxHeight = Math.max(160, listMaxHeight - 64)

  return (
    <SheetModal
      visible={visible}
      onClose={handleClose}
      onDismiss={onDismiss}
      avoidKeyboard
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>{strings.handoff.title}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>{strings.handoff.subtitle}</Text>
          {sourceSession !== undefined && (
            <Text style={styles.sourceMeta} numberOfLines={1}>
              {harnessDisplayName(sourceBackend)} · {sessionTitle(sourceSession)}
            </Text>
          )}
        </View>
        <IconButton
          label={strings.common.close}
          icon={X}
          dense
          disabled={submittingMode !== undefined}
          onPress={handleClose}
        />
      </View>

      <ScrollView
        style={{ flexShrink: 1, maxHeight: scrollMaxHeight }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {liveSourceRunning && (
          <View style={styles.warningBanner}>
            <AlertCircle size={16} color={colors.warning} />
            <Text style={styles.warningText}>{strings.handoff.sourceRunningHint}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{strings.handoff.targetAgent}</Text>
          {targets.length === 0 ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeText}>{strings.handoff.noTargetAgent}</Text>
            </View>
          ) : (
            <View style={styles.chipWrap}>
              {targets.map(backend => {
                const selected = backend === targetBackend
                const sameBackend = backend === sourceBackend
                return (
                  <Pressable
                    key={backend}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: submittingMode !== undefined }}
                    disabled={submittingMode !== undefined}
                    onPress={() => handleSelectTarget(backend)}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.chipSelected,
                      pressed && submittingMode === undefined && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {harnessDisplayName(backend)}
                    </Text>
                    {sameBackend && (
                      <View style={[styles.chipBadge, selected && styles.chipBadgeSelected]}>
                        <Text style={[styles.chipBadgeText, selected && styles.chipBadgeTextSelected]}>
                          {strings.handoff.sameBackendTag}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                )
              })}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{strings.handoff.presetLabel}</Text>
          <View style={styles.chipWrap}>
            {(['review', 'continue', 'custom'] as const).map(item => {
              const selected = item === preset
              return (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: submittingMode !== undefined }}
                  disabled={submittingMode !== undefined}
                  onPress={() => handleSelectPreset(item)}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipSelected,
                    pressed && submittingMode === undefined && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {handoffPresetLabel(item)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{strings.handoff.instructionLabel}</Text>
          <TextInput
            accessibilityLabel={strings.handoff.instructionLabel}
            value={instruction}
            onChangeText={value => {
              instructionEditedRef.current = true
              setInstruction(value)
            }}
            placeholder={strings.handoff.instructionPlaceholder}
            placeholderTextColor={colors.muted}
            editable={submittingMode === undefined}
            multiline
            style={styles.instructionInput}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>{strings.handoff.targetWorkspace}</Text>
            {refreshingTargetWorkspaces && <ActivityIndicator size="small" color={colors.primary} />}
          </View>

          {workspaceMatch?.matched !== undefined && (() => {
            const matched = workspaceMatch.matched
            const selected = workspaceChoice?.mode === 'existing' && workspaceChoice.workspaceId === matched.workspaceId
            const maskedPath = maskPersonalPath(matched.path)
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: submittingMode !== undefined }}
                disabled={submittingMode !== undefined}
                onPress={() => {
                  workspaceTouchedRef.current = true
                  setWorkspaceChoice({ mode: 'existing', workspaceId: matched.workspaceId })
                }}
                style={({ pressed }) => [
                  styles.workspaceOption,
                  selected && styles.workspaceOptionSelected,
                  pressed && submittingMode === undefined && styles.pressed,
                ]}
              >
                <Folder size={18} color={selected ? colors.primary : colors.muted} />
                <View style={styles.workspaceCopy}>
                  <View style={styles.workspaceBadgeRow}>
                    <View style={styles.matchedBadge}>
                      <Text style={styles.matchedBadgeText}>{strings.handoff.matchedWorkspace}</Text>
                    </View>
                  </View>
                  <Text style={styles.workspaceTitle} numberOfLines={1}>
                    {matched.title || maskedPath}
                  </Text>
                  <Text style={styles.workspacePath} numberOfLines={1} ellipsizeMode="middle">{maskedPath}</Text>
                </View>
                {selected && <Check size={17} color={colors.primary} />}
              </Pressable>
            )
          })()}

          {workspaceMatch?.canRegisterSourceCwd && sourceCwd !== undefined && (() => {
            const selected = workspaceChoice?.mode === 'register'
            const maskedSourceCwd = maskPersonalPath(sourceCwd)
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: submittingMode !== undefined }}
                disabled={submittingMode !== undefined}
                onPress={() => {
                  workspaceTouchedRef.current = true
                  setWorkspaceChoice({ mode: 'register', path: sourceCwd })
                }}
                style={({ pressed }) => [
                  styles.workspaceOption,
                  selected && styles.workspaceOptionSelected,
                  pressed && submittingMode === undefined && styles.pressed,
                ]}
              >
                <FolderPlus size={18} color={selected ? colors.primary : colors.muted} />
                <View style={styles.workspaceCopy}>
                  <Text style={styles.workspaceTitle}>{strings.handoff.registerSameCwd}</Text>
                  <Text style={styles.workspacePath} numberOfLines={2}>
                    {strings.handoff.registerSameCwdHint(maskedSourceCwd)}
                  </Text>
                </View>
                {selected && <Check size={17} color={colors.primary} />}
              </Pressable>
            )
          })()}

          {(workspaceMatch?.otherWorkspaces.length ?? 0) > 0 && (
            <View style={styles.otherWorkspacesBlock}>
              {workspaceMatch?.matched === undefined && (
                <Text style={styles.subLabel}>{strings.handoff.pickExistingWorkspace}</Text>
              )}
              {workspaceMatch!.otherWorkspaces.map(workspace => {
                const selected = workspaceChoice?.mode === 'existing' && workspaceChoice.workspaceId === workspace.workspaceId
                const maskedPath = maskPersonalPath(workspace.path)
                return (
                  <Pressable
                    key={workspace.workspaceId}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: submittingMode !== undefined }}
                    disabled={submittingMode !== undefined}
                    onPress={() => {
                      workspaceTouchedRef.current = true
                      setWorkspaceChoice({ mode: 'existing', workspaceId: workspace.workspaceId })
                    }}
                    style={({ pressed }) => [
                      styles.workspaceOption,
                      selected && styles.workspaceOptionSelected,
                      pressed && submittingMode === undefined && styles.pressed,
                    ]}
                  >
                    <Folder size={17} color={selected ? colors.primary : colors.muted} />
                    <View style={styles.workspaceCopy}>
                      <Text style={styles.workspaceTitle} numberOfLines={1}>
                        {workspace.title || maskedPath}
                      </Text>
                      <Text style={styles.workspacePath} numberOfLines={1}>{maskedPath}</Text>
                    </View>
                    {selected && <Check size={17} color={colors.primary} />}
                  </Pressable>
                )
              })}
            </View>
          )}

          {workspaceMatch !== undefined
            && workspaceMatch.matched === undefined
            && !workspaceMatch.canRegisterSourceCwd
            && workspaceMatch.otherWorkspaces.length === 0 && (
              <View style={styles.noticeCard}>
                <Text style={styles.noticeText}>{strings.handoff.noWorkspaceAvailable}</Text>
              </View>
            )}
        </View>

        <View style={styles.section}>
          {loadingHistory ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>{strings.handoff.loadingHistory}</Text>
            </View>
          ) : historyError !== undefined ? (
            <ErrorBanner
              message={historyError}
              onRetry={() => setReloadToken(value => value + 1)}
            />
          ) : !hasHandoffContent ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeText}>{strings.handoff.emptyHistory}</Text>
            </View>
          ) : packet !== undefined && (
            <View style={styles.contextCard}>
              <Text style={styles.contextSummary}>
                {packet.editedFiles.length > 0
                  ? strings.handoff.contextSummary(packet.meta.turnsCount, packet.editedFiles.length, sizeKb)
                  : strings.handoff.contextSummaryNoFiles(packet.meta.turnsCount, sizeKb)}
              </Text>
              {packet.meta.omittedTurns > 0 && (
                <Text style={styles.omittedNote}>
                  {strings.handoff.omittedTurnsNote(packet.meta.omittedTurns)}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: previewOpen }}
                onPress={() => setPreviewOpen(value => !value)}
                style={({ pressed }) => [styles.previewToggle, pressed && styles.pressed]}
              >
                <Eye size={14} color={colors.primary} />
                <Text style={styles.previewToggleText}>
                  {previewOpen ? strings.handoff.hidePreview : strings.handoff.previewToggle}
                </Text>
                {previewOpen
                  ? <ChevronUp size={15} color={colors.primary} />
                  : <ChevronDown size={15} color={colors.primary} />}
              </Pressable>

              {previewOpen && (
                <View style={styles.previewContainer}>
                  {packet.editedFiles.length > 0 && (
                    <View style={styles.editedFilesRow}>
                      {packet.editedFiles.slice(0, 8).map(file => (
                        <View key={file} style={styles.editedFileChip}>
                          <Text style={styles.editedFileText} numberOfLines={1}>
                            {maskPersonalPath(file)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <ScrollView
                    style={styles.previewScroll}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                  >
                    <Text selectable style={styles.previewCode}>{previewText}</Text>
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom > 0 ? spacing.xxs : 0 }]}>
        {submitError !== undefined && (
          <View accessibilityRole="alert" style={styles.submitErrorBanner}>
            <AlertCircle size={16} color={colors.danger} />
            <Text style={styles.submitErrorText}>{submitError}</Text>
          </View>
        )}
        <View style={styles.footerButtons}>
          <View style={styles.footerButtonSlot}>
            <Button
              label={strings.handoff.openAsDraft}
              variant="secondary"
              loading={submittingMode === 'draft'}
              disabled={!canSubmit}
              onPress={() => void handleSubmit('draft')}
            />
          </View>
          <View style={styles.footerButtonSlot}>
            <Button
              label={strings.handoff.sendAndContinue}
              variant="primary"
              loading={submittingMode === 'send'}
              disabled={!canSubmit}
              onPress={() => void handleSubmit('send')}
            />
          </View>
        </View>
      </View>
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
              {strings.handoff.cardTitle(harnessDisplayName(meta.sourceBackend), harnessDisplayName(meta.targetBackend))}
              {' · '}
              {handoffPresetLabel(meta.preset)}
              {' · '}
              {meta.filesCount > 0
                ? strings.handoff.cardStats(meta.turnsCount, meta.filesCount)
                : strings.handoff.cardStatsNoFiles(meta.turnsCount)}
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.heading, color: colors.ink },
  subtitle: { ...type.caption, color: colors.muted },
  sourceMeta: { ...type.caption, color: colors.primary, fontWeight: '500', marginTop: 1 },
  scrollContent: { gap: spacing.xs, paddingBottom: spacing.xxs },
  section: { gap: spacing.xxs + 1 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  sectionLabel: { ...type.smallStrong, color: colors.ink },
  subLabel: { ...type.caption, color: colors.muted },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...continuousRadius(radius.md),
    backgroundColor: colors.warningSoft,
  },
  warningText: { ...type.caption, color: colors.ink, flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  chipText: { ...type.small, fontWeight: '500', color: colors.ink },
  chipTextSelected: { color: colors.primary, fontWeight: '600' },
  chipBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceStrong,
  },
  chipBadgeSelected: {
    backgroundColor: colors.background,
  },
  chipBadgeText: { fontSize: 10.5, lineHeight: 14, fontWeight: '600', color: colors.muted },
  chipBadgeTextSelected: { color: colors.primary },
  instructionInput: {
    ...type.small,
    color: colors.ink,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    ...continuousRadius(radius.md),
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    minHeight: 68,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  otherWorkspacesBlock: { gap: spacing.xs },
  workspaceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    ...continuousRadius(radius.lg),
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  workspaceOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  workspaceCopy: { flex: 1, minWidth: 0, gap: 2 },
  workspaceBadgeRow: { flexDirection: 'row', alignItems: 'center' },
  matchedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceStrong,
  },
  matchedBadgeText: { fontSize: 10.5, lineHeight: 14, fontWeight: '600', color: colors.primary },
  workspaceTitle: { ...type.smallStrong, color: colors.ink },
  workspacePath: { ...type.caption, fontFamily: monoFontFamily, color: colors.muted },
  noticeCard: {
    padding: spacing.sm,
    ...continuousRadius(radius.md),
    backgroundColor: colors.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  noticeText: { ...type.small, color: colors.muted },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    ...continuousRadius(radius.md),
    backgroundColor: colors.surfaceStrong,
  },
  loadingText: { ...type.small, color: colors.muted },
  contextCard: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    ...continuousRadius(radius.lg),
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  contextSummary: { ...type.small, color: colors.ink, fontWeight: '500' },
  omittedNote: { ...type.caption, color: colors.muted },
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 2,
  },
  previewToggleText: { ...type.caption, fontWeight: '600', color: colors.primary },
  previewContainer: {
    ...continuousRadius(radius.md),
    backgroundColor: colors.surfaceStrong,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  editedFilesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  editedFileChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: '100%',
  },
  editedFileText: { fontFamily: monoFontFamily, fontSize: 11, lineHeight: 15, color: colors.ink },
  previewScroll: { maxHeight: 170 },
  previewCode: { fontFamily: monoFontFamily, fontSize: 11.5, lineHeight: 17, color: colors.ink },
  draftPreviewScrollContent: { paddingTop: spacing.xxs },
  footer: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  submitErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...continuousRadius(radius.md),
    backgroundColor: colors.dangerSoft,
  },
  submitErrorText: { ...type.caption, color: colors.danger, flex: 1 },
  footerButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footerButtonSlot: { flexGrow: 1, flexBasis: 135 },
  pressed: { opacity: 0.78 },
})
