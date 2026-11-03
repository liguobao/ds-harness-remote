import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { ChevronDown, ChevronUp, RefreshCw, Square, Terminal } from 'lucide-react-native'
import type { RemoteGatewayStream } from '@dsh-remote/client-core'
import { IconJobOutline } from '../../ui/dsh-icons'
import { strings } from '../../locales/i18n'
import { radius, spacing, type as typography, type ThemeColors } from '../../ui/theme'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import type { BackgroundJob } from '../../services/session-tools'
import { requireSessionTools } from '../../state/store'

export type JobStatusKind = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Format elapsed seconds to M:SS */
export function formatJobDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Pure derivation of background job statistics */
export function formatJobStats(jobs: readonly BackgroundJob[]): {
  runningCount: number
  totalCount: number
  statsText: string
  activeJob: BackgroundJob | null
} {
  const runningCount = jobs.filter(j => j.status === 'running' || j.status === 'stopping').length
  const totalCount = jobs.length
  const activeJob = jobs.find(j => j.status === 'running' || j.status === 'stopping') ?? null
  return {
    runningCount,
    totalCount,
    statsText: runningCount > 0 ? `${runningCount}/${totalCount}` : `${totalCount}`,
    activeJob,
  }
}

/** Localized status label matching sessionActivity dictionary */
export function jobStatusLabel(
  status: JobStatusKind | string,
  copy: typeof strings.sessionActivity,
): string {
  switch (status) {
    case 'running': return copy.active
    case 'stopping': return copy.stopping
    case 'completed': return copy.complete
    case 'killed': return copy.killed
    case 'failed': return copy.failed
    default: return copy.active
  }
}

/**
 * Status glyph matching DeepSeek Harness visual semantics:
 * - running: blue animated rotating spinner (same as checklist in_progress)
 * - stopping: amber/orange pulse spinner
 * - completed: green circular badge with checkmark
 * - killed: muted circular badge with stop square
 * - failed: red circular badge with exclamation / cross
 */
export const JobStatusGlyph = memo(function JobStatusGlyph({
  status,
  colors,
  size = 16,
}: {
  status: JobStatusKind | string
  colors: ThemeColors
  size?: number
}) {
  const spinAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (status !== 'running' && status !== 'stopping') return
    const animation = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: status === 'stopping' ? 2000 : 1500,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
        isInteraction: false,
      }),
    )
    animation.start()
    return () => animation.stop()
  }, [status, spinAnim])

  if (status === 'completed') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="job-glyph-completed">
        <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <Circle cx="8" cy="8" r="7" fill={colors.success} />
          <Path
            d="M4.5 8.2L6.8 10.5L11.5 5.5"
            stroke="#FFFFFF"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    )
  }

  if (status === 'running') {
    const spin = spinAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    })
    return (
      <Animated.View
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}
        testID="job-glyph-running"
      >
        <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <Circle cx="8" cy="8" r="6" stroke={colors.primary} strokeWidth={1.8} opacity={0.25} />
          <Circle
            cx="8"
            cy="8"
            r="6"
            stroke={colors.primary}
            strokeWidth={1.8}
            strokeDasharray="10 30"
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
    )
  }

  if (status === 'stopping') {
    const spin = spinAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    })
    return (
      <Animated.View
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}
        testID="job-glyph-stopping"
      >
        <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <Circle cx="8" cy="8" r="6" stroke={colors.warning ?? '#F59E0B'} strokeWidth={1.8} opacity={0.3} />
          <Circle
            cx="8"
            cy="8"
            r="6"
            stroke={colors.warning ?? '#F59E0B'}
            strokeWidth={1.8}
            strokeDasharray="8 24"
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
    )
  }

  if (status === 'killed') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="job-glyph-killed">
        <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <Circle cx="8" cy="8" r="7" fill={colors.muted} />
          <Rect x="5" y="5" width="6" height="6" rx="1" fill="#FFFFFF" />
        </Svg>
      </View>
    )
  }

  // failed or other
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="job-glyph-failed">
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Circle cx="8" cy="8" r="7" fill={colors.danger ?? '#EF4444'} />
        <Path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" />
      </Svg>
    </View>
  )
})

/**
 * Log viewer panel streaming output from `job.follow` with offset resume support
 */
export const JobLogPanel = memo(function JobLogPanel({
  sessionId,
  jobId,
  testID = 'job-log-panel',
}: {
  sessionId: string
  jobId: string
  testID?: string
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const copy = strings.sessionActivity

  const [output, setOutput] = useState('')
  const [lost, setLost] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const cursorRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    let stream: RemoteGatewayStream | undefined
    setLoading(true)
    setError(false)

    void (async () => {
      try {
        const tools = requireSessionTools(sessionId)
        if (!tools.followJob) throw new Error('Job observation unavailable')

        stream = await tools.followJob(sessionId, jobId, controller.signal, cursorRef.current)
        if (controller.signal.aborted) return

        for await (const frame of stream) {
          if (controller.signal.aborted) return
          if (!record(frame)) continue

          setLoading(false)

          if (frame.type === 'opened' && typeof frame.from === 'number') {
            cursorRef.current = frame.from
            if (frame.from > 0) setLost(true)
          } else if (frame.type === 'output' && Array.isArray(frame.chunks)) {
            const text = frame.chunks
              .flatMap(chunk => (record(chunk) && typeof chunk.text === 'string' ? [chunk.text] : []))
              .join('')

            if (frame.lossy === true || frame.chunks.some(chunk => record(chunk) && chunk.gapBefore === true)) {
              setLost(true)
            }

            if (typeof frame.next === 'number') {
              cursorRef.current = frame.next
            }

            setOutput(prev => {
              const combined = prev + text
              if (combined.length > 64000) {
                setLost(true)
                return combined.slice(-64000)
              }
              return combined
            })
          }
        }
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
        await stream?.close().catch(() => {})
      }
    })()

    return () => {
      controller.abort()
      void stream?.close().catch(() => {})
    }
  }, [sessionId, jobId, attempt])

  return (
    <View style={styles.logPanel} testID={testID}>
      <View style={styles.logHeader}>
        <View style={styles.logHeaderTitleRow}>
          <Terminal size={12} color={colors.muted} />
          <Text style={styles.logHeaderTitle}>{copy.jobOutput}</Text>
        </View>
        {lost && <Text style={styles.logLostNotice}>{copy.truncated}</Text>}
      </View>

      {loading && output.length === 0 && (
        <View style={styles.logLoadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.logLoadingText}>{copy.waitingOutput}</Text>
        </View>
      )}

      {error && output.length === 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAttempt(a => a + 1)}
          style={styles.retry}
          testID={`${testID}-retry`}
        >
          <Text style={styles.retryText}>{copy.retry}</Text>
        </Pressable>
      )}

      {output.length > 0 ? (
        <ScrollView style={styles.logScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          <Text selectable style={styles.logText} testID={`${testID}-text`}>
            {output}
          </Text>
        </ScrollView>
      ) : !loading && !error ? (
        <Text style={styles.logEmptyText}>{copy.noOutput}</Text>
      ) : null}
    </View>
  )
})

/**
 * Single Job Item Card with status glyph, metadata, stop button and expandable log panel
 */
export const BackgroundJobItem = memo(function BackgroundJobItem({
  job,
  sessionId,
  onKill,
  killing = false,
  testID,
}: {
  job: BackgroundJob
  sessionId: string
  onKill: (jobId: string) => Promise<void>
  killing?: boolean
  testID: string
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const copy = strings.sessionActivity

  const [logsOpen, setLogsOpen] = useState(false)
  const isKillable = job.status === 'running' || job.status === 'stopping'
  const isStopping = job.status === 'stopping' || killing

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!isKillable) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isKillable])

  const elapsedSeconds = job.startedAt ? Math.max(0, Math.floor((now - job.startedAt) / 1000)) : undefined
  const elapsedText = elapsedSeconds !== undefined ? formatJobDuration(elapsedSeconds) : undefined

  return (
    <View style={styles.jobItem} testID={testID}>
      <View style={styles.jobItemMainRow}>
        <View style={styles.glyphWrap}>
          <JobStatusGlyph status={isStopping && job.status === 'running' ? 'stopping' : job.status} colors={colors} />
        </View>

        <View style={styles.jobInfo}>
          <Text style={styles.jobLabel} numberOfLines={1}>
            {job.label}
          </Text>
          <View style={styles.jobMetaRow}>
            <Text style={styles.jobMetaText}>
              {job.id} · {jobStatusLabel(isStopping && job.status === 'running' ? 'stopping' : job.status, copy)}
            </Text>
            {elapsedText && <Text style={styles.jobDurationText}>{elapsedText}</Text>}
          </View>
          {typeof job.progress === 'string' && job.progress.length > 0 && (
            <Text style={styles.jobProgressText} numberOfLines={1}>
              {job.progress}
            </Text>
          )}
          {typeof job.detail === 'string' && job.detail.length > 0 && (
            <Text style={styles.jobDetailText} numberOfLines={2}>
              {job.detail}
            </Text>
          )}
        </View>

        <View style={styles.jobActions}>
          {isKillable && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.stopJob}
              disabled={isStopping}
              onPress={() => onKill(job.id)}
              style={({ pressed }) => [
                styles.stopBtn,
                pressed && styles.stopBtnPressed,
                isStopping && styles.stopBtnDisabled,
              ]}
              testID={`${testID}-kill-btn`}
            >
              {isStopping ? (
                <ActivityIndicator size={12} color={colors.warning ?? '#F59E0B'} />
              ) : (
                <Square size={12} color={colors.danger ?? '#EF4444'} fill={colors.danger ?? '#EF4444'} />
              )}
              <Text
                style={[
                  styles.stopBtnText,
                  isStopping && { color: colors.muted },
                ]}
              >
                {isStopping ? copy.stoppingJob : copy.stopJob}
              </Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={logsOpen ? copy.hideLogs : copy.jobLogs}
            accessibilityState={{ expanded: logsOpen }}
            onPress={() => setLogsOpen(prev => !prev)}
            style={({ pressed }) => [styles.logsBtn, pressed && styles.logsBtnPressed]}
            testID={`${testID}-logs-btn`}
          >
            <Text style={styles.logsBtnText}>{logsOpen ? copy.hideLogs : copy.jobLogs}</Text>
          </Pressable>
        </View>
      </View>

      {logsOpen && (
        <JobLogPanel
          sessionId={sessionId}
          jobId={job.id}
          testID={`${testID}-logs`}
        />
      )}
    </View>
  )
})

export interface BackgroundJobsCardProps {
  jobs: readonly BackgroundJob[]
  sessionId: string
  expanded?: boolean
  onToggle?: () => void
  defaultExpanded?: boolean
  loading?: boolean
  error?: boolean
  onRefresh?: () => void
  refreshing?: boolean
  maxHeight?: number
  testID?: string
}

/**
 * 1:1 DeepSeek Harness Background Jobs Card matching TaskProgressChecklist design:
 * - Card container with border, rounded corners and surface elevation
 * - Header showing icon, title, running/total badge, active job timer, refresh button and chevron
 * - Expandable list of jobs with live animated glyphs, job details, kill action and log panels
 */
export const BackgroundJobsCard = memo(function BackgroundJobsCard({
  jobs,
  sessionId,
  expanded,
  onToggle,
  defaultExpanded = false,
  loading = false,
  error = false,
  onRefresh,
  refreshing = false,
  maxHeight,
  testID = 'background-jobs-card',
}: BackgroundJobsCardProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const copy = strings.sessionActivity
  const { height } = useWindowDimensions()

  const [internalOpen, setInternalOpen] = useState(defaultExpanded)
  const isControlled = expanded !== undefined
  const isOpen = isControlled ? expanded : internalOpen

  const handleToggle = () => {
    if (!isControlled) {
      setInternalOpen(prev => !prev)
    }
    onToggle?.()
  }

  const { runningCount, totalCount, statsText, activeJob } = useMemo(() => formatJobStats(jobs), [jobs])
  const listMaxHeight = maxHeight ?? Math.min(260, height * 0.32)

  const [killingIds, setKillingIds] = useState<Record<string, boolean>>({})

  const handleKill = async (jobId: string) => {
    try {
      setKillingIds(prev => ({ ...prev, [jobId]: true }))
      const tools = requireSessionTools(sessionId)
      if (tools.killJob) {
        await tools.killJob(sessionId, jobId)
      }
    } finally {
      setKillingIds(prev => ({ ...prev, [jobId]: false }))
    }
  }

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!activeJob) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [activeJob?.id])

  const elapsedSeconds = activeJob?.startedAt ? Math.max(0, Math.floor((now - activeJob.startedAt) / 1000)) : undefined
  const elapsedText = elapsedSeconds !== undefined ? formatJobDuration(elapsedSeconds) : undefined

  return (
    <View style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.backgroundJobs || copy.jobs} · ${statsText}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={handleToggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        testID={`${testID}-header`}
      >
        <View style={styles.leadIcon}>
          <IconJobOutline size={16} color={colors.muted} />
        </View>

        <Text style={styles.title} numberOfLines={1}>
          {copy.backgroundJobs || copy.jobs}
        </Text>

        <View style={styles.progressContainer}>
          <Text style={styles.progress} testID={`${testID}-progress`}>
            {statsText}
          </Text>
          {elapsedText && <Text style={styles.headerElapsed}>{elapsedText}</Text>}
        </View>

        <View style={styles.headerTrailing}>
          {onRefresh && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.common.refresh}
              onPress={onRefresh}
              hitSlop={8}
              style={styles.refreshBtn}
              testID={`${testID}-refresh-btn`}
            >
              {refreshing ? (
                <ActivityIndicator size={14} color={colors.primary} />
              ) : (
                <RefreshCw size={14} color={colors.muted} />
              )}
            </Pressable>
          )}

          <View style={styles.chevron}>
            {isOpen ? (
              <ChevronUp size={16} color={colors.muted} />
            ) : (
              <ChevronDown size={16} color={colors.muted} />
            )}
          </View>
        </View>
      </Pressable>

      {isOpen && (
        <View style={styles.contentWrap} testID={`${testID}-content`}>
          <View style={styles.divider} />

          {loading && jobs.length === 0 && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.statusText}>{copy.loading}</Text>
            </View>
          )}

          {error && (
            <Pressable
              accessibilityRole="button"
              onPress={onRefresh}
              style={styles.retry}
              testID={`${testID}-error-retry`}
            >
              <Text style={styles.retryText}>{copy.retry}</Text>
            </Pressable>
          )}

          {jobs.length === 0 && !loading && !error && (
            <Text style={styles.emptyText}>{copy.noJobs}</Text>
          )}

          {jobs.length > 0 && (
            <ScrollView
              style={[styles.list, { maxHeight: listMaxHeight }]}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {jobs.map((job, index) => (
                <BackgroundJobItem
                  key={job.id}
                  job={job}
                  sessionId={sessionId}
                  onKill={handleKill}
                  killing={killingIds[job.id] === true}
                  testID={`${testID}-item-${index}`}
                />
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  )
})

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    header: {
      minHeight: 44,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    pressed: {
      backgroundColor: colors.surfaceStrong,
    },
    leadIcon: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      ...typography.smallStrong,
      color: colors.ink,
      flexShrink: 1,
    },
    progressContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingLeft: spacing.xxs,
    },
    progress: {
      ...typography.small,
      color: colors.muted,
      fontVariant: ['tabular-nums'],
    },
    headerElapsed: {
      ...typography.caption,
      color: colors.muted,
      fontVariant: ['tabular-nums'],
    },
    headerTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    refreshBtn: {
      padding: spacing.xxs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chevron: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contentWrap: {
      paddingBottom: spacing.xs,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginHorizontal: spacing.sm,
      marginBottom: spacing.xs,
    },
    list: {
      paddingHorizontal: spacing.sm,
    },
    jobItem: {
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    jobItemMainRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
    },
    glyphWrap: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    jobInfo: {
      flex: 1,
      gap: 2,
    },
    jobLabel: {
      ...typography.smallStrong,
      color: colors.ink,
      lineHeight: 18,
    },
    jobMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    jobMetaText: {
      ...typography.caption,
      color: colors.muted,
      fontVariant: ['tabular-nums'],
    },
    jobDurationText: {
      ...typography.caption,
      color: colors.muted,
      fontVariant: ['tabular-nums'],
    },
    jobProgressText: {
      ...typography.caption,
      color: colors.primary,
    },
    jobDetailText: {
      ...typography.caption,
      color: colors.muted,
    },
    jobActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xxs,
    },
    stopBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: spacing.xs,
      paddingVertical: 3,
      borderRadius: radius.sm,
      backgroundColor: colors.dangerSoft,
    },
    stopBtnPressed: {
      opacity: 0.7,
    },
    stopBtnDisabled: {
      opacity: 0.5,
    },
    stopBtnText: {
      ...typography.caption,
      color: colors.danger ?? '#EF4444',
      fontWeight: '600',
    },
    logsBtn: {
      paddingHorizontal: spacing.xs,
      paddingVertical: 3,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceStrong,
    },
    logsBtnPressed: {
      opacity: 0.7,
    },
    logsBtnText: {
      ...typography.caption,
      color: colors.ink,
    },
    logPanel: {
      marginTop: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.xs,
      gap: spacing.xxs,
    },
    logHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 2,
    },
    logHeaderTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    logHeaderTitle: {
      ...typography.caption,
      color: colors.muted,
      fontWeight: '600',
    },
    logLostNotice: {
      ...typography.caption,
      color: colors.warning ?? '#F59E0B',
      fontSize: 11,
    },
    logLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.xs,
    },
    logLoadingText: {
      ...typography.caption,
      color: colors.muted,
    },
    logScroll: {
      maxHeight: 140,
    },
    logText: {
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 16,
      color: colors.ink,
    },
    logEmptyText: {
      ...typography.caption,
      color: colors.muted,
      paddingVertical: spacing.xxs,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
    },
    statusText: {
      ...typography.small,
      color: colors.muted,
    },
    emptyText: {
      ...typography.small,
      color: colors.muted,
      textAlign: 'center',
      paddingVertical: spacing.sm,
    },
    retry: {
      minHeight: 36,
      paddingHorizontal: spacing.sm,
      justifyContent: 'center',
      alignItems: 'center',
    },
    retryText: {
      ...typography.small,
      color: colors.primary,
    },
  })
