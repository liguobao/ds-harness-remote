import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Check,
  ChevronRight,
  CircleCheck,
  Copy,
  FileDiff,
  GitBranch,
  MessageSquarePlus,
  MoveHorizontal,
  RefreshCw,
  TextWrap,
  X,
} from 'lucide-react-native'
import type {
  WorkspaceGitDiffResult,
  WorkspaceGitFileEntry,
  WorkspaceGitFileStatus,
  WorkspaceGitScope,
  WorkspaceGitStatusResult,
} from '@dsh-remote/protocol'
import {
  formatDiffReference,
  hunkQuoteRange,
  parseUnifiedDiff,
  type DiffLineRange,
  type ParsedDiffHunk,
  type ParsedDiffLine,
} from '../lib/unified-diff'
import { strings as t } from '../locales/i18n'
import { fetchWorkspaceGitDiff, fetchWorkspaceGitStatus } from '../services/workspace-git'
import { BlurHeaderFrame, Button, IconButton, TopBar } from '../ui/components'
import { monoFontFamily } from '../ui/platform-style'
import { useResponsiveLayout } from '../ui/responsive'
import { floatingShadow, radius, spacing, type, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { sessionToolsError } from './session-tools-error'

export interface WorkspaceChangesPanelProps {
  sessionId: string
  onClose: () => void
  onQuoteToComposer?: (reference: string) => void
  headerAccessory?: ReactNode
}

interface LineSelection {
  hunkIndex: number
  anchorIndex: number
  focusIndex: number
}

const COPY_FEEDBACK_MS = 1_800

function fileBasename(filePath: string): string {
  const index = filePath.lastIndexOf('/')
  return index >= 0 ? filePath.slice(index + 1) : filePath
}

function fileDirname(filePath: string): string {
  const index = filePath.lastIndexOf('/')
  return index >= 0 ? filePath.slice(0, index) : ''
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function statusBadgeMeta(
  status: WorkspaceGitFileStatus,
  colors: ThemeColors,
): { letter: string; background: string; foreground: string } {
  switch (status) {
    case 'modified':
      return { letter: 'M', background: colors.warningSoft, foreground: colors.warning }
    case 'added':
      return { letter: 'A', background: colors.successSoft, foreground: colors.success }
    case 'deleted':
      return { letter: 'D', background: colors.dangerSoft, foreground: colors.danger }
    case 'renamed':
      return { letter: 'R', background: colors.primarySoft, foreground: colors.primary }
    case 'copied':
      return { letter: 'C', background: colors.primarySoft, foreground: colors.primary }
    case 'untracked':
      return { letter: '?', background: colors.successSoft, foreground: colors.success }
    case 'unmerged':
      return { letter: 'U', background: colors.dangerSoft, foreground: colors.danger }
  }
}

function hunkRangeLabel(hunk: ParsedDiffHunk, fileDeleted: boolean): string {
  if (!fileDeleted && hunk.newCount > 0 && hunk.newStart > 0) {
    const end = hunk.newStart + hunk.newCount - 1
    return hunk.newCount === 1 ? `L${hunk.newStart}` : `L${hunk.newStart}–L${end}`
  }
  if (hunk.oldCount > 0 && hunk.oldStart > 0) {
    const end = hunk.oldStart + hunk.oldCount - 1
    return hunk.oldCount === 1 ? `-L${hunk.oldStart}` : `-L${hunk.oldStart}–L${end}`
  }
  if (hunk.newStart > 0) {
    return `L${hunk.newStart}`
  }
  return hunk.header
}

function resolveSelectedLineRange(
  hunk: ParsedDiffHunk,
  anchorIndex: number,
  focusIndex: number,
  fileDeleted: boolean,
): DiffLineRange | undefined {
  const startIdx = Math.min(anchorIndex, focusIndex)
  const endIdx = Math.max(anchorIndex, focusIndex)
  let minNew: number | undefined
  let maxNew: number | undefined
  let minAny: number | undefined
  let maxAny: number | undefined

  for (let index = startIdx; index <= endIdx; index += 1) {
    const line = hunk.lines[index]
    if (line === undefined || line.kind === 'meta') continue
    if (line.newLine !== undefined && line.newLine > 0) {
      minNew = minNew === undefined ? line.newLine : Math.min(minNew, line.newLine)
      maxNew = maxNew === undefined ? line.newLine : Math.max(maxNew, line.newLine)
    }
    const candidate = fileDeleted ? (line.oldLine ?? line.newLine) : (line.newLine ?? line.oldLine)
    if (candidate !== undefined && candidate > 0) {
      minAny = minAny === undefined ? candidate : Math.min(minAny, candidate)
      maxAny = maxAny === undefined ? candidate : Math.max(maxAny, candidate)
    }
  }

  if (!fileDeleted && minNew !== undefined && maxNew !== undefined) {
    return { start: minNew, end: maxNew }
  }
  if (minAny !== undefined && maxAny !== undefined) {
    return { start: minAny, end: maxAny }
  }
  return undefined
}

export function WorkspaceChangesPanel({
  sessionId,
  onClose,
  onQuoteToComposer,
  headerAccessory,
}: WorkspaceChangesPanelProps) {
  const { colors } = useTheme()
  const { width } = useResponsiveLayout()
  const insets = useSafeAreaInsets()
  const narrow = width < 520

  const [scope, setScope] = useState<WorkspaceGitScope>('all')
  const [status, setStatus] = useState<WorkspaceGitStatusResult>()
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string>()
  const [statusRevision, setStatusRevision] = useState(0)

  const [selectedFile, setSelectedFile] = useState<WorkspaceGitFileEntry>()
  const [diffResult, setDiffResult] = useState<WorkspaceGitDiffResult>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string>()
  const [diffRevision, setDiffRevision] = useState(0)

  const [wrap, setWrap] = useState(true)
  const [copiedPath, setCopiedPath] = useState(false)
  const [selection, setSelection] = useState<LineSelection>()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    if (copyTimerRef.current !== undefined) {
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = undefined
    }
  }, [])

  useEffect(() => {
    setScope('all')
    setStatus(undefined)
    setStatusError(undefined)
    setSelectedFile(undefined)
    setDiffResult(undefined)
    setDiffError(undefined)
    setSelection(undefined)
    setCopiedPath(false)
  }, [sessionId])

  useEffect(() => {
    const controller = new AbortController()
    setStatusLoading(true)
    setStatusError(undefined)
    void fetchWorkspaceGitStatus(sessionId, scope, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setStatus(result)
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setStatusError(sessionToolsError(error, 'changes'))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatusLoading(false)
      })
    return () => controller.abort()
  }, [sessionId, scope, statusRevision])

  const selectedPath = selectedFile?.path
  useEffect(() => {
    setSelection(undefined)
    setCopiedPath(false)
    if (selectedPath === undefined) {
      setDiffResult(undefined)
      setDiffError(undefined)
      setDiffLoading(false)
      return
    }
    const controller = new AbortController()
    setDiffLoading(true)
    setDiffError(undefined)
    setDiffResult(undefined)
    void fetchWorkspaceGitDiff({ sessionId, path: selectedPath, scope }, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setDiffResult(result)
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setDiffError(sessionToolsError(error, 'changes'))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiffLoading(false)
      })
    return () => controller.abort()
  }, [sessionId, scope, selectedPath, diffRevision])

  const parsedFiles = useMemo(
    () => (diffResult !== undefined ? parseUnifiedDiff(diffResult.diff) : []),
    [diffResult],
  )
  const allHunks = useMemo(
    () => parsedFiles.flatMap(file => file.hunks),
    [parsedFiles],
  )
  const isDiffBinary = diffResult?.isBinary === true || parsedFiles.some(file => file.isBinary)
  const isSelectedDeleted = selectedFile?.status === 'deleted'

  const selectedRange = useMemo(() => {
    if (selection === undefined) return undefined
    const hunk = allHunks[selection.hunkIndex]
    if (hunk === undefined) return undefined
    return resolveSelectedLineRange(hunk, selection.anchorIndex, selection.focusIndex, isSelectedDeleted)
  }, [allHunks, isSelectedDeleted, selection])

  const selectedReference = useMemo(() => {
    if (selectedFile === undefined || selectedRange === undefined) return undefined
    return formatDiffReference(selectedFile.path, selectedRange)
  }, [selectedFile, selectedRange])

  const handleScopeChange = useCallback((nextScope: WorkspaceGitScope) => {
    if (nextScope === scope) return
    setScope(nextScope)
    setSelectedFile(undefined)
    setSelection(undefined)
    setDiffResult(undefined)
    setDiffError(undefined)
  }, [scope])

  const handleBack = useCallback(() => {
    if (selectedFile !== undefined) {
      setSelectedFile(undefined)
      setSelection(undefined)
      setDiffResult(undefined)
      setDiffError(undefined)
      return
    }
    onClose()
  }, [onClose, selectedFile])

  const handleRefresh = useCallback(() => {
    if (selectedFile !== undefined) {
      setDiffRevision(v => v + 1)
    } else {
      setStatusRevision(v => v + 1)
    }
  }, [selectedFile])

  const handleCopyPath = useCallback(async (filePath: string) => {
    try {
      await Clipboard.setStringAsync(filePath)
      setCopiedPath(true)
      if (copyTimerRef.current !== undefined) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = undefined
        setCopiedPath(false)
      }, COPY_FEEDBACK_MS)
    } catch {
      // Ignore clipboard failures on restricted devices.
    }
  }, [])

  const handleToggleLine = useCallback((hunkIndex: number, lineIndex: number) => {
    setSelection(current => {
      if (current === undefined || current.hunkIndex !== hunkIndex) {
        return { hunkIndex, anchorIndex: lineIndex, focusIndex: lineIndex }
      }
      if (current.anchorIndex === lineIndex && current.focusIndex === lineIndex) {
        return undefined
      }
      return { hunkIndex, anchorIndex: current.anchorIndex, focusIndex: lineIndex }
    })
  }, [])

  const scopeOptions: ReadonlyArray<{ id: WorkspaceGitScope; label: string }> = [
    { id: 'all', label: t.tools.changesScopeAll },
    { id: 'unstaged', label: t.tools.changesScopeUnstaged },
    { id: 'staged', label: t.tools.changesScopeStaged },
  ]

  const codeSurfaceColor = colors.codeSurface ?? colors.surface
  const codeHeaderColor = colors.codeHeader ?? colors.surfaceStrong
  const onPrimaryColor = colors.onPrimary ?? colors.white

  const renderDiffLine = (hunkIndex: number, line: ParsedDiffLine, lineIndex: number) => {
    const selectable = onQuoteToComposer !== undefined
      && line.kind !== 'meta'
      && (line.newLine ?? line.oldLine) !== undefined
    const isSelected = selection !== undefined
      && selection.hunkIndex === hunkIndex
      && lineIndex >= Math.min(selection.anchorIndex, selection.focusIndex)
      && lineIndex <= Math.max(selection.anchorIndex, selection.focusIndex)

    const backgroundColor = isSelected
      ? colors.primarySoft
      : line.kind === 'add'
        ? colors.successSoft
        : line.kind === 'del'
          ? colors.dangerSoft
          : codeSurfaceColor

    const accentBarColor = isSelected
      ? colors.primary
      : line.kind === 'add'
        ? colors.success
        : line.kind === 'del'
          ? colors.danger
          : 'transparent'

    const sigil = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'context' ? ' ' : ''
    const sigilColor = line.kind === 'add'
      ? colors.success
      : line.kind === 'del'
        ? colors.danger
        : colors.muted

    const compactLineNumber = line.kind === 'meta'
      ? ''
      : String(isSelectedDeleted ? (line.oldLine ?? line.newLine ?? '') : (line.newLine ?? line.oldLine ?? ''))

    const rowStyle = [
      styles.diffLineRow,
      { backgroundColor, borderLeftColor: accentBarColor },
    ]

    const rowContent = (
      <>
        {narrow ? (
          <Text style={[styles.lineNumSingle, { color: isSelected ? colors.primary : colors.muted }]} numberOfLines={1}>
            {compactLineNumber}
          </Text>
        ) : (
          <>
            <Text style={[styles.lineNumDual, { color: isSelected ? colors.primary : colors.muted }]} numberOfLines={1}>
              {line.kind === 'meta' ? '' : String(line.oldLine ?? '')}
            </Text>
            <Text style={[styles.lineNumDual, { color: isSelected ? colors.primary : colors.muted }]} numberOfLines={1}>
              {line.kind === 'meta' ? '' : String(line.newLine ?? '')}
            </Text>
          </>
        )}
        <Text style={[styles.sigilCol, { color: sigilColor }]}>{sigil}</Text>
        <Text
          style={[
            styles.diffCodeText,
            wrap ? styles.diffCodeWrap : styles.diffCodeNoWrap,
            { color: line.kind === 'meta' ? colors.muted : colors.ink },
            line.kind === 'meta' && styles.metaLineText,
          ]}
        >
          {line.content.length === 0 ? ' ' : line.content}
        </Text>
      </>
    )

    if (!selectable) {
      return (
        <View key={lineIndex} style={rowStyle}>
          {rowContent}
        </View>
      )
    }

    return (
      <Pressable
        key={lineIndex}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        onPress={() => handleToggleLine(hunkIndex, lineIndex)}
        style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
      >
        {rowContent}
      </Pressable>
    )
  }

  const renderFileRow = ({ item }: { item: WorkspaceGitFileEntry }) => {
    const badge = statusBadgeMeta(item.status, colors)
    const dir = fileDirname(item.path)
    const subtitle = item.oldPath !== undefined ? `${item.oldPath} → ${item.path}` : dir
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setSelectedFile(item)}
        style={({ pressed }) => [
          styles.fileRow,
          { borderBottomColor: colors.separator },
          pressed && { backgroundColor: colors.surfaceStrong },
        ]}
      >
        <View style={[styles.statusBadge, { backgroundColor: badge.background }]}>
          <Text style={[styles.statusBadgeText, { color: badge.foreground }]}>{badge.letter}</Text>
        </View>
        <View style={styles.fileCopy}>
          <View style={styles.fileNameRow}>
            <Text style={[styles.fileName, { color: colors.ink }]} numberOfLines={1} ellipsizeMode="middle">
              {fileBasename(item.path)}
            </Text>
            {scope === 'all' && item.staged && (
              <View style={[styles.stagedTag, { backgroundColor: colors.primarySoft }]}>
                <Text style={[styles.stagedTagText, { color: colors.primary }]}>{t.tools.changesStagedBadge}</Text>
              </View>
            )}
          </View>
          {subtitle.length > 0 && (
            <Text style={[styles.fileDir, { color: colors.muted }]} numberOfLines={1} ellipsizeMode="middle">
              {subtitle}
            </Text>
          )}
        </View>
        <View style={styles.fileStats}>
          {item.isBinary ? (
            <View style={[styles.binTag, { backgroundColor: colors.surfaceStrong }]}>
              <Text style={[styles.binTagText, { color: colors.muted }]}>BIN</Text>
            </View>
          ) : (
            <>
              {item.additions !== null && item.additions > 0 && (
                <Text style={[styles.statAdd, { color: colors.success }]}>+{item.additions}</Text>
              )}
              {item.deletions !== null && item.deletions > 0 && (
                <Text style={[styles.statDel, { color: colors.danger }]}>-{item.deletions}</Text>
              )}
            </>
          )}
          <ChevronRight size={16} color={colors.subtle} />
        </View>
      </Pressable>
    )
  }

  const refreshBusy = selectedFile !== undefined ? diffLoading : statusLoading
  const diffAdditions = diffResult?.additions ?? selectedFile?.additions
  const diffDeletions = diffResult?.deletions ?? selectedFile?.deletions

  return (
    <BlurHeaderFrame
      inset
      header={
        <View>
          <TopBar
            title={selectedFile ? fileBasename(selectedFile.path) : t.tools.changes}
            titleLines={1}
            onBack={handleBack}
            action={
              <IconButton
                label={t.tools.refresh}
                icon={RefreshCw}
                onPress={handleRefresh}
                disabled={refreshBusy}
              />
            }
          />
          {headerAccessory}
        </View>
      }
    >
      {selectedFile === undefined ? (
        <View style={styles.container}>
          {status?.isGitRepo && (
            <View style={[styles.listTopSection, { borderBottomColor: colors.separator }]}>
              <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.summaryTopRow}>
                  <View style={styles.branchRow}>
                    <GitBranch size={15} color={colors.primary} />
                    <Text style={[styles.branchText, { color: colors.ink }]} numberOfLines={1} ellipsizeMode="tail">
                      {status.branch ?? status.headShortSha ?? 'HEAD'}
                    </Text>
                  </View>
                  <View style={styles.summaryStats}>
                    <Text style={[styles.statAdd, { color: colors.success }]}>+{status.totalAdditions}</Text>
                    <Text style={[styles.statDel, { color: colors.danger }]}>-{status.totalDeletions}</Text>
                  </View>
                </View>
                <Text style={[styles.summaryCount, { color: colors.muted }]}>
                  {t.tools.changesSummary(status.totalFiles)}
                </Text>
              </View>

              <View style={styles.scopeBar}>
                {scopeOptions.map(option => {
                  const active = scope === option.id
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => handleScopeChange(option.id)}
                      style={({ pressed }) => [
                        styles.scopePill,
                        active
                          ? { backgroundColor: colors.primarySoft, borderColor: colors.primary }
                          : { backgroundColor: colors.surfaceStrong, borderColor: 'transparent' },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.scopePillText,
                          { color: active ? colors.primary : colors.muted },
                          active && styles.scopePillTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>

              {status.truncated && (
                <View style={[styles.banner, { backgroundColor: colors.warningSoft }]}>
                  <Text style={[styles.bannerText, { color: colors.warning }]}>{t.tools.changesTruncated}</Text>
                </View>
              )}
            </View>
          )}

          {statusLoading && (
            <View style={styles.centerNotice}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.noticeText, { color: colors.muted }]}>{t.tools.changesLoading}</Text>
            </View>
          )}

          {!statusLoading && statusError !== undefined && (
            <View style={styles.centerNotice}>
              <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.danger }]}>
                {statusError}
              </Text>
              <Button label={t.tools.retry} onPress={() => setStatusRevision(v => v + 1)} />
            </View>
          )}

          {!statusLoading && statusError === undefined && status !== undefined && !status.isGitRepo && (
            <View style={styles.emptyWrap}>
              <View style={[styles.emptyIconBox, { backgroundColor: colors.surfaceStrong }]}>
                <GitBranch size={24} color={colors.muted} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.ink }]}>{t.tools.changesNotGitRepo}</Text>
            </View>
          )}

          {!statusLoading && statusError === undefined && status !== undefined && status.isGitRepo && (
            <FlatList
              data={status.files}
              keyExtractor={item => item.path}
              renderItem={renderFileRow}
              contentContainerStyle={[
                styles.listContent,
                status.files.length === 0 && styles.emptyListContent,
                { paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.md) },
              ]}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <View style={[styles.emptyIconBox, { backgroundColor: colors.successSoft }]}>
                    <CircleCheck size={24} color={colors.success} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.ink }]}>{t.tools.changesClean}</Text>
                </View>
              }
            />
          )}
        </View>
      ) : (
        <View style={styles.container}>
          <View style={[styles.diffToolbar, { backgroundColor: colors.surface, borderBottomColor: colors.separator }]}>
            <View style={styles.diffToolbarTop}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={selectedFile.path}
                onPress={() => { void handleCopyPath(selectedFile.path) }}
                style={({ pressed }) => [styles.copyPathButton, pressed && styles.pressed]}
              >
                <Text style={[styles.diffPathText, { color: colors.ink }]} numberOfLines={1} ellipsizeMode="middle">
                  {selectedFile.path}
                </Text>
                {copiedPath
                  ? <Check size={14} color={colors.success} />
                  : <Copy size={14} color={colors.muted} />}
              </Pressable>
              <View style={styles.summaryStats}>
                {isDiffBinary ? (
                  <View style={[styles.binTag, { backgroundColor: colors.surfaceStrong }]}>
                    <Text style={[styles.binTagText, { color: colors.muted }]}>BIN</Text>
                  </View>
                ) : (
                  <>
                    {diffAdditions !== null && diffAdditions !== undefined && (
                      <Text style={[styles.statAdd, { color: colors.success }]}>+{diffAdditions}</Text>
                    )}
                    {diffDeletions !== null && diffDeletions !== undefined && (
                      <Text style={[styles.statDel, { color: colors.danger }]}>-{diffDeletions}</Text>
                    )}
                  </>
                )}
              </View>
            </View>

            <View style={styles.diffToolbarActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: wrap }}
                onPress={() => setWrap(current => !current)}
                style={({ pressed }) => [
                  styles.toolbarPill,
                  { backgroundColor: colors.surfaceStrong, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                {wrap
                  ? <TextWrap size={14} color={colors.primary} />
                  : <MoveHorizontal size={14} color={colors.muted} />}
                <Text style={[styles.toolbarPillText, { color: wrap ? colors.ink : colors.muted }]}>
                  {wrap ? t.tools.changesWrapOn : t.tools.changesWrapOff}
                </Text>
              </Pressable>

              {onQuoteToComposer !== undefined && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onQuoteToComposer(formatDiffReference(selectedFile.path))}
                  style={({ pressed }) => [
                    styles.toolbarPill,
                    { backgroundColor: colors.primarySoft, borderColor: colors.primary },
                    pressed && styles.pressed,
                  ]}
                >
                  <MessageSquarePlus size={14} color={colors.primary} />
                  <Text style={[styles.toolbarPillText, { color: colors.primary, fontWeight: '600' }]}>
                    {t.tools.changesQuoteFile}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          {diffLoading && (
            <View style={styles.centerNotice}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.noticeText, { color: colors.muted }]}>{t.tools.changesDiffLoading}</Text>
            </View>
          )}

          {!diffLoading && diffError !== undefined && (
            <View style={styles.centerNotice}>
              <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.danger }]}>
                {diffError}
              </Text>
              <Button label={t.tools.retry} onPress={() => setDiffRevision(v => v + 1)} />
            </View>
          )}

          {!diffLoading && diffError === undefined && diffResult !== undefined && (
            <ScrollView
              style={styles.container}
              contentContainerStyle={[
                styles.diffScrollContent,
                {
                  paddingBottom: selectedReference !== undefined && onQuoteToComposer !== undefined
                    ? Math.max(96, insets.bottom + 84)
                    : Math.max(spacing.xl, insets.bottom + spacing.md),
                },
              ]}
            >
              {diffResult.truncated && (
                <View style={[styles.banner, { backgroundColor: colors.warningSoft }]}>
                  <Text style={[styles.bannerText, { color: colors.warning }]}>{t.tools.changesDiffTruncated}</Text>
                </View>
              )}

              {isDiffBinary ? (
                <View style={styles.emptyWrap}>
                  <View style={[styles.emptyIconBox, { backgroundColor: colors.surfaceStrong }]}>
                    <FileDiff size={24} color={colors.muted} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.ink }]}>{t.tools.changesBinary}</Text>
                </View>
              ) : allHunks.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <View style={[styles.emptyIconBox, { backgroundColor: colors.surfaceStrong }]}>
                    <FileDiff size={24} color={colors.muted} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.ink }]}>{t.tools.changesEmptyDiff}</Text>
                </View>
              ) : (
                <>
                  {onQuoteToComposer !== undefined && (
                    <Text style={[styles.selectionHint, { color: colors.muted }]}>
                      {t.tools.changesSelectionHint}
                    </Text>
                  )}
                  {allHunks.map((hunk, hunkIndex) => {
                    const hunkRange = hunkQuoteRange(hunk, isSelectedDeleted)
                    const linesBlock = (
                      <View style={wrap ? styles.linesWrap : styles.linesNoWrap}>
                        {hunk.lines.map((line, lineIndex) => renderDiffLine(hunkIndex, line, lineIndex))}
                      </View>
                    )
                    return (
                      <View
                        key={`${hunk.header}:${hunkIndex}`}
                        style={[
                          styles.hunkCard,
                          { backgroundColor: codeSurfaceColor, borderColor: colors.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.hunkHeader,
                            { backgroundColor: codeHeaderColor, borderBottomColor: colors.border },
                          ]}
                        >
                          <View style={styles.hunkHeaderMeta}>
                            <Text style={[styles.hunkRangeText, { color: colors.ink }]} numberOfLines={1}>
                              {hunkRangeLabel(hunk, isSelectedDeleted)}
                            </Text>
                            {hunk.context !== undefined && (
                              <Text style={[styles.hunkContextText, { color: colors.muted }]} numberOfLines={1}>
                                {hunk.context}
                              </Text>
                            )}
                          </View>
                          {onQuoteToComposer !== undefined && (
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => onQuoteToComposer(formatDiffReference(selectedFile.path, hunkRange))}
                              style={({ pressed }) => [
                                styles.hunkQuoteButton,
                                { backgroundColor: colors.primary },
                                pressed && styles.pressed,
                              ]}
                            >
                              <MessageSquarePlus size={13} color={onPrimaryColor} />
                              <Text style={[styles.hunkQuoteText, { color: onPrimaryColor }]} numberOfLines={1}>
                                {t.tools.changesQuoteModify}
                              </Text>
                            </Pressable>
                          )}
                        </View>

                        {wrap ? (
                          linesBlock
                        ) : (
                          <ScrollView
                            horizontal
                            nestedScrollEnabled
                            showsHorizontalScrollIndicator
                            contentContainerStyle={styles.horizontalScrollContent}
                          >
                            {linesBlock}
                          </ScrollView>
                        )}
                      </View>
                    )
                  })}
                </>
              )}
            </ScrollView>
          )}

          {selectedReference !== undefined && onQuoteToComposer !== undefined && (
            <View
              style={[
                styles.selectionBar,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.border,
                  paddingBottom: Math.max(spacing.sm, insets.bottom),
                },
                floatingShadow(colors, 'high'),
              ]}
            >
              <Text
                style={[styles.selectionRefText, { color: colors.ink }]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {selectedReference}
              </Text>
              <View style={styles.selectionBarActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSelection(undefined)}
                  style={({ pressed }) => [
                    styles.selectionClearButton,
                    { backgroundColor: colors.surfaceStrong },
                    pressed && styles.pressed,
                  ]}
                >
                  <X size={14} color={colors.muted} />
                  <Text style={[styles.selectionClearText, { color: colors.ink }]}>
                    {t.tools.changesSelectionClear}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onQuoteToComposer(selectedReference)
                    setSelection(undefined)
                  }}
                  style={({ pressed }) => [
                    styles.selectionQuoteButton,
                    { backgroundColor: colors.primary },
                    pressed && styles.pressed,
                  ]}
                >
                  <MessageSquarePlus size={14} color={onPrimaryColor} />
                  <Text style={[styles.selectionQuoteText, { color: onPrimaryColor }]}>
                    {t.tools.changesQuoteModify}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </BlurHeaderFrame>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listTopSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
    gap: spacing.xxs,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  branchRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  branchText: {
    ...type.smallStrong,
    flexShrink: 1,
  },
  summaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  summaryCount: {
    ...type.caption,
  },
  scopeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  scopePill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopePillText: {
    ...type.caption,
    fontSize: 13,
  },
  scopePillTextActive: {
    fontWeight: '600',
  },
  banner: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  bannerText: {
    ...type.caption,
    lineHeight: 17,
  },
  listContent: {
    paddingTop: spacing.xxs,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  fileRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  statusBadgeText: {
    fontFamily: monoFontFamily,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  fileCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  fileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fileName: {
    ...type.smallStrong,
    flexShrink: 1,
  },
  stagedTag: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    flexShrink: 0,
  },
  stagedTagText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    includeFontPadding: false,
  },
  fileDir: {
    ...type.caption,
    fontSize: 12,
  },
  fileStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  statAdd: {
    fontFamily: monoFontFamily,
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
  },
  statDel: {
    fontFamily: monoFontFamily,
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
  },
  binTag: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  binTagText: {
    fontFamily: monoFontFamily,
    fontSize: 11,
    fontWeight: '600',
    includeFontPadding: false,
  },
  centerNotice: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  noticeText: {
    ...type.small,
    textAlign: 'center',
  },
  errorText: {
    ...type.small,
    textAlign: 'center',
  },
  emptyWrap: {
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyIconBox: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...type.smallStrong,
    textAlign: 'center',
  },
  diffToolbar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  diffToolbarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  copyPathButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  diffPathText: {
    fontFamily: monoFontFamily,
    fontSize: 12,
    flexShrink: 1,
    includeFontPadding: false,
  },
  diffToolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  toolbarPill: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  toolbarPillText: {
    ...type.caption,
    fontSize: 12,
  },
  diffScrollContent: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  selectionHint: {
    ...type.caption,
    paddingHorizontal: spacing.xxs,
  },
  hunkCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  hunkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hunkHeaderMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  hunkRangeText: {
    fontFamily: monoFontFamily,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  hunkContextText: {
    fontFamily: monoFontFamily,
    fontSize: 11,
    includeFontPadding: false,
  },
  hunkQuoteButton: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  hunkQuoteText: {
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
  },
  horizontalScrollContent: {
    minWidth: '100%',
  },
  linesWrap: {
    width: '100%',
  },
  linesNoWrap: {
    minWidth: '100%',
  },
  diffLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderLeftWidth: 2,
    paddingVertical: 2,
    paddingRight: spacing.xs,
  },
  lineNumSingle: {
    width: 38,
    paddingRight: 6,
    textAlign: 'right',
    fontFamily: monoFontFamily,
    fontSize: 11,
    lineHeight: 19,
    flexShrink: 0,
    includeFontPadding: false,
  },
  lineNumDual: {
    width: 36,
    paddingRight: 6,
    textAlign: 'right',
    fontFamily: monoFontFamily,
    fontSize: 11,
    lineHeight: 19,
    flexShrink: 0,
    includeFontPadding: false,
  },
  sigilCol: {
    width: 14,
    textAlign: 'center',
    fontFamily: monoFontFamily,
    fontSize: 12,
    lineHeight: 19,
    fontWeight: '700',
    flexShrink: 0,
    includeFontPadding: false,
  },
  diffCodeText: {
    fontFamily: monoFontFamily,
    fontSize: 12.5,
    lineHeight: 19,
    includeFontPadding: false,
  },
  diffCodeWrap: {
    flex: 1,
    flexShrink: 1,
  },
  diffCodeNoWrap: {
    flexShrink: 0,
  },
  metaLineText: {
    fontStyle: 'italic',
  },
  selectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    gap: spacing.xs,
  },
  selectionRefText: {
    fontFamily: monoFontFamily,
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
  },
  selectionBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  selectionClearButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectionClearText: {
    ...type.caption,
    fontSize: 13,
    fontWeight: '500',
  },
  selectionQuoteButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  selectionQuoteText: {
    ...type.caption,
    fontSize: 13,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
  },
})
