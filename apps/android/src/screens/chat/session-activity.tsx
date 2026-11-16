import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { ChevronDown, ChevronUp, Flag, Layers, PauseCircle, Users } from 'lucide-react-native'
import type { RemoteGatewayStream } from '@dsh-remote/client-core'
import type { BackgroundJob } from '../../services/session-tools'
import type { RemoteSession, TeamMemberSnapshot, TeamTaskSnapshot } from '../../types'
import { IconJobOutline } from '../../ui/dsh-icons'
import { requireSessionTools, useAppStore } from '../../state/store'
import { strings } from '../../locales/i18n'
import { radius, spacing, type as typography, type ActivityDockMode, type ThemeColors } from '../../ui/theme'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { TaskProgressChecklist } from './task-progress-checklist'
import { BackgroundJobsCard, JobStatusGlyph, formatJobStats } from './background-jobs-card'
import { AgentStatusGlyph, AgentTeamCard, SubagentsCard, formatSubagentStats, formatTeamStats } from './agents'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }
function todosFrom(value: unknown): Todo[] {
  return Array.isArray(value) ? value.filter((item): item is Todo => record(item) && typeof item.content === 'string'
    && ['pending', 'in_progress', 'completed'].includes(String(item.status))) : []
}
function jobsFrom(value: unknown, sessionId: string): BackgroundJob[] {
  return Array.isArray(value) ? value.filter((item): item is BackgroundJob => record(item)
    && typeof item.id === 'string' && typeof item.label === 'string'
    && (item.owner === undefined || item.owner === sessionId)
    && ['running', 'stopping', 'completed', 'killed', 'failed'].includes(String(item.status)))
    .sort((a, b) => Number(b.status === 'running' || b.status === 'stopping') - Number(a.status === 'running' || a.status === 'stopping')
      || (typeof b.startedAt === 'number' ? b.startedAt : 0) - (typeof a.startedAt === 'number' ? a.startedAt : 0)) : []
}

export interface SessionActivityDockProps {
  session: RemoteSession
  childSessions?: RemoteSession[]
  teamState?: {
    members: TeamMemberSnapshot[]
    tasks: TeamTaskSnapshot[]
  }
  sessions?: RemoteSession[]
  onOpenSession?: (session: RemoteSession) => void
  mode?: ActivityDockMode
  initialJobs?: BackgroundJob[]
}

/** Current Host projections only. No inferred goals or locally persisted task state. */
export function SessionActivityDock({
  session,
  childSessions,
  teamState,
  sessions,
  onOpenSession,
  mode,
  initialJobs,
}: SessionActivityDockProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const copy = strings.sessionActivity
  const storeMode = typeof useAppStore === 'function'
    ? useAppStore(state => state.activityDockMode)
    : undefined
  const effectiveMode: ActivityDockMode = mode ?? storeMode ?? 'compact'
  const values = session.projections?.values
  const todos = todosFrom(values?.todos)
  const projection = record(values?.goal) ? values.goal : undefined
  const goal = record(projection?.goal) && typeof projection.goal.objective === 'string' ? projection.goal : undefined
  const [expanded, setExpanded] = useState<'todos' | 'goal' | 'jobs' | 'subagents' | 'team' | undefined>()
  const toggle = (section: 'todos' | 'goal' | 'jobs' | 'subagents' | 'team') => setExpanded(value => value === section ? undefined : section)
  const [activeModal, setActiveModal] = useState<'jobs' | 'subagents' | 'team' | undefined>()
  const { height } = useWindowDimensions()
  const detailsHeight = Math.min(180, height * 0.24)
  const modalDetailsHeight = Math.min(380, height * 0.52)
  const [jobs, setJobs] = useState<BackgroundJob[]>(() => initialJobs ?? [])
  const [jobError, setJobError] = useState(false)
  const [jobsLoading, setJobsLoading] = useState(initialJobs === undefined)
  const [attempt, setAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const phase = (value: unknown) => value === 'complete' || value === 'completed' ? copy.complete
    : value === 'paused' ? copy.paused : value === 'blocked' ? copy.blocked
      : value === 'failed' ? copy.failed : value === 'killed' ? copy.killed
        : value === 'stopping' ? copy.stopping : value === 'pending' ? copy.pending : copy.active

  useEffect(() => {
    setActiveModal(undefined)
  }, [session.sessionId, effectiveMode])

  useEffect(() => {
    const controller = new AbortController()
    let stream: RemoteGatewayStream | undefined
    setJobs(initialJobs ?? [])
    setJobError(false)
    setJobsLoading(initialJobs === undefined)
    void (async () => {
      try {
        const tools = requireSessionTools(session.sessionId)
        if (!tools.watchJobs) { setJobsLoading(false); setRefreshing(false); return }
        stream = await tools.watchJobs(session.sessionId, controller.signal)
        if (controller.signal.aborted) return
        for await (const frame of stream) {
          if (controller.signal.aborted) return
          if (!record(frame) || frame.type !== 'rows' || !Array.isArray(frame.jobs)) throw new Error('Invalid job roster')
          setJobs(jobsFrom(frame.jobs, session.sessionId))
          setJobsLoading(false)
        }
        if (!controller.signal.aborted) setJobError(true)
      } catch {
        if (!controller.signal.aborted) setJobError(true)
      } finally {
        if (!controller.signal.aborted) { setJobsLoading(false); setRefreshing(false) }
        await stream?.close?.().catch(() => {})
      }
    })()
    return () => { controller.abort(); void stream?.close?.().catch(() => {}) }
  }, [session.sessionId, attempt])

  const hasJobs = jobs.length > 0
  const hasSubagents = Boolean(childSessions && childSessions.length > 0)
  const hasTeam = Boolean(teamState !== undefined && teamState.members && teamState.members.length > 0)

  const jobStats = useMemo(() => formatJobStats(jobs), [jobs])
  const subagentStats = useMemo(() => formatSubagentStats(childSessions ?? []), [childSessions])
  const teamStats = useMemo(
    () => formatTeamStats(teamState?.members ?? [], sessions ?? []),
    [teamState?.members, sessions],
  )

  const isJobsActive = jobStats.runningCount > 0
  const isSubagentsActive = subagentStats.runningCount > 0
  const isTeamActive = teamStats.activeCount > 0
  const hasRunningTeamMember = useMemo(
    () => (teamState?.members ?? []).some(member => sessions?.find(s => s.sessionId === member.id)?.running === true),
    [teamState?.members, sessions],
  )
  const teamActiveGlyphStatus = hasRunningTeamMember ? 'running' : 'provisioning'

  const openModal = effectiveMode === 'compact'
    && ((activeModal === 'jobs' && hasJobs)
      || (activeModal === 'subagents' && hasSubagents)
      || (activeModal === 'team' && hasTeam))
    ? activeModal
    : undefined

  const jobsTitle = copy.backgroundJobs || copy.jobs
  const subagentsTitle = copy.subagents || strings.chat.subagentsTitle(subagentStats.totalCount).split(' · ')[0]
  const teamTitle = copy.team || strings.chat.teamTitle(teamStats.totalCount).split(' · ')[0]

  return <View style={styles.dock}>
    {todos.length > 0 && (
      <TaskProgressChecklist
        todos={todos}
        expanded={expanded === 'todos'}
        onToggle={() => toggle('todos')}
        maxHeight={detailsHeight}
      />
    )}
    {goal && <Disclosure title={`${copy.goal} · ${goal.objective}`} trailing={<Text style={styles.status}>{phase(goal.phase)}</Text>}
      icon={goal.phase === 'paused' ? <PauseCircle size={18} color={colors.muted} /> : <Flag size={18} color={colors.muted} />}
      open={expanded === 'goal'} onPress={() => toggle('goal')}>
      <ScrollView style={[styles.details, { maxHeight: detailsHeight }]} nestedScrollEnabled>
        <Text selectable style={styles.detailText}>{String(goal.objective)}</Text>
        <Text style={styles.muted}>{phase(goal.phase)}{typeof projection?.roundsStarted === 'number' && typeof goal.maxGoalRounds === 'number' ? ` · ${projection.roundsStarted}/${goal.maxGoalRounds}` : ''}</Text>
        {record(goal.blockedReason) && typeof goal.blockedReason.message === 'string' && <Text selectable style={styles.detailText}>{goal.blockedReason.message}</Text>}
      </ScrollView>
    </Disclosure>}

    {effectiveMode === 'compact' && (hasJobs || hasSubagents || hasTeam) && (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillBarScroll}
        contentContainerStyle={styles.pillBar}
        keyboardShouldPersistTaps="handled"
        testID="activity-pill-bar"
      >
        {hasJobs && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${jobsTitle} · ${jobStats.statsText}`}
            onPress={() => setActiveModal('jobs')}
            style={({ pressed }) => [
              styles.pill,
              isJobsActive && styles.pillActive,
              pressed && styles.pressed,
            ]}
            testID="activity-pill-jobs"
          >
            {isJobsActive ? (
              <JobStatusGlyph status={jobStats.activeJob?.status ?? 'running'} colors={colors} size={14} />
            ) : (
              <IconJobOutline size={14} color={colors.muted} />
            )}
            <Text style={[styles.pillText, isJobsActive && styles.pillTextActive]} numberOfLines={1}>
              {jobsTitle}
            </Text>
            <Text style={[styles.pillBadge, isJobsActive && styles.pillBadgeActive]} testID="activity-pill-jobs-badge">
              {jobStats.statsText}
            </Text>
          </Pressable>
        )}

        {hasSubagents && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${subagentsTitle} · ${subagentStats.statsText}`}
            onPress={() => setActiveModal('subagents')}
            style={({ pressed }) => [
              styles.pill,
              isSubagentsActive && styles.pillActive,
              pressed && styles.pressed,
            ]}
            testID="activity-pill-subagents"
          >
            {isSubagentsActive ? (
              <AgentStatusGlyph status="running" colors={colors} size={14} />
            ) : (
              <Layers size={14} color={colors.muted} />
            )}
            <Text style={[styles.pillText, isSubagentsActive && styles.pillTextActive]} numberOfLines={1}>
              {subagentsTitle}
            </Text>
            <Text style={[styles.pillBadge, isSubagentsActive && styles.pillBadgeActive]} testID="activity-pill-subagents-badge">
              {subagentStats.statsText}
            </Text>
          </Pressable>
        )}

        {hasTeam && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${teamTitle} · ${teamStats.statsText}`}
            onPress={() => setActiveModal('team')}
            style={({ pressed }) => [
              styles.pill,
              isTeamActive && styles.pillActive,
              pressed && styles.pressed,
            ]}
            testID="activity-pill-team"
          >
            {isTeamActive ? (
              <AgentStatusGlyph status={teamActiveGlyphStatus} colors={colors} size={14} />
            ) : (
              <Users size={14} color={colors.muted} />
            )}
            <Text style={[styles.pillText, isTeamActive && styles.pillTextActive]} numberOfLines={1}>
              {teamTitle}
            </Text>
            <Text style={[styles.pillBadge, isTeamActive && styles.pillBadgeActive]} testID="activity-pill-team-badge">
              {teamStats.statsText}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    )}

    {effectiveMode === 'cards' && (
      <>
        {(jobsLoading || jobError || hasJobs) && (
          <BackgroundJobsCard
            jobs={jobs}
            sessionId={session.sessionId}
            expanded={expanded === 'jobs'}
            onToggle={() => toggle('jobs')}
            loading={jobsLoading}
            error={jobError}
            onRefresh={() => { setRefreshing(true); setAttempt(value => value + 1) }}
            refreshing={refreshing}
            maxHeight={detailsHeight}
          />
        )}
        {hasSubagents && childSessions && (
          <SubagentsCard
            sessions={childSessions}
            expanded={expanded === 'subagents'}
            onToggle={() => toggle('subagents')}
            onOpen={onOpenSession}
            maxHeight={detailsHeight}
          />
        )}
        {hasTeam && teamState && (
          <AgentTeamCard
            members={teamState.members}
            tasks={teamState.tasks ?? []}
            sessions={sessions ?? []}
            expanded={expanded === 'team'}
            onToggle={() => toggle('team')}
            onOpen={onOpenSession}
            maxHeight={detailsHeight}
          />
        )}
      </>
    )}

    {openModal !== undefined && (
      <Modal
        visible
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setActiveModal(undefined)}
      >
        <View style={styles.modalOverlay} testID="activity-card-modal">
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={strings.common.close}
            onPress={() => setActiveModal(undefined)}
            testID="activity-card-modal-backdrop"
          />
          <View style={styles.modalContent} accessibilityViewIsModal>
            {openModal === 'jobs' && (
              <BackgroundJobsCard
                jobs={jobs}
                sessionId={session.sessionId}
                expanded
                onClose={() => setActiveModal(undefined)}
                loading={jobsLoading}
                error={jobError}
                onRefresh={() => { setRefreshing(true); setAttempt(value => value + 1) }}
                refreshing={refreshing}
                maxHeight={modalDetailsHeight}
              />
            )}
            {openModal === 'subagents' && childSessions && (
              <SubagentsCard
                sessions={childSessions}
                expanded
                onClose={() => setActiveModal(undefined)}
                onOpen={target => {
                  setActiveModal(undefined)
                  onOpenSession?.(target)
                }}
                maxHeight={modalDetailsHeight}
              />
            )}
            {openModal === 'team' && teamState?.members && (
              <AgentTeamCard
                members={teamState.members}
                tasks={teamState.tasks ?? []}
                sessions={sessions ?? []}
                expanded
                onClose={() => setActiveModal(undefined)}
                onOpen={target => {
                  setActiveModal(undefined)
                  onOpenSession?.(target)
                }}
                maxHeight={modalDetailsHeight}
              />
            )}
          </View>
        </View>
      </Modal>
    )}
  </View>
}

function Disclosure({ title, icon, open, onPress, children, trailing }: { trailing?: ReactNode; title: string; icon: ReactNode; open: boolean; onPress: () => void; children: ReactNode }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return <View style={styles.group}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={onPress}
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
      {icon}<Text numberOfLines={1} style={styles.summary}>{title}</Text>{trailing}
      {open ? <ChevronUp size={16} color={colors.muted} /> : <ChevronDown size={16} color={colors.muted} />}
    </Pressable>
    {open && children}
  </View>
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  dock: { gap: spacing.xxs, marginHorizontal: spacing.xs, marginBottom: spacing.xs },
  pillBarScroll: { flexGrow: 0, flexShrink: 0 },
  pillBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  pill: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  pillText: {
    ...typography.caption,
    color: colors.ink,
    fontWeight: '600',
  },
  pillTextActive: {
    color: colors.primary,
  },
  pillBadge: {
    ...typography.caption,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  pillBadgeActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.modalBackdrop ?? 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  modalContent: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  group: { borderRadius: radius.xl, backgroundColor: colors.card, overflow: 'hidden' },
  header: { minHeight: 44, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pressed: { backgroundColor: colors.surfaceStrong },
  title: { ...typography.smallStrong, color: colors.ink, flexShrink: 1 },
  summary: { ...typography.small, color: colors.ink, flex: 1 },
  status: { ...typography.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  inlineTrack: { width: 28, height: 3, borderRadius: 2, backgroundColor: colors.surfaceStrong },
  details: { maxHeight: 160, paddingHorizontal: spacing.sm, marginBottom: spacing.xs },
  jobs: { maxHeight: 220 },
  todo: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.xs, alignItems: 'flex-start' },
  todoText: { ...typography.small, color: colors.ink, flex: 1 },
  detailText: { ...typography.small, color: colors.ink, paddingBottom: spacing.xs },
  muted: { ...typography.caption, color: colors.muted },
  progressTrack: { height: 3, backgroundColor: colors.surfaceStrong, marginHorizontal: spacing.sm, marginBottom: spacing.xs, borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: colors.primary, borderRadius: 2 },
  progressComplete: { backgroundColor: colors.success },
  jobHeader: { minHeight: 48, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  jobCopy: { flex: 1, gap: spacing.xxs },
  output: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  outputText: { ...typography.small, color: colors.ink, fontFamily: 'monospace' },
  empty: { ...typography.small, color: colors.muted, padding: spacing.sm },
  jobActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  retry: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  retryText: { ...typography.small, color: colors.primary },
})
