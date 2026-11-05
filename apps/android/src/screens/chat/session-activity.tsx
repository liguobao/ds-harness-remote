import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { ChevronDown, ChevronUp, Flag, PauseCircle } from 'lucide-react-native'
import type { RemoteGatewayStream } from '@dsh-remote/client-core'
import type { BackgroundJob } from '../../services/session-tools'
import type { RemoteSession, TeamMemberSnapshot, TeamTaskSnapshot } from '../../types'
import { requireSessionTools, useAppStore } from '../../state/store'
import { strings } from '../../locales/i18n'
import { radius, spacing, type as typography, type ThemeColors } from '../../ui/theme'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { TaskProgressChecklist, type TodoItem } from './task-progress-checklist'
import { BackgroundJobsCard } from './background-jobs-card'
import { AgentTeamCard, SubagentsCard } from './agents'

/** Live-control slice supplied by the app store for Harness subagents. */
interface SubagentStoreSlice {
  busyAction?: string
  interruptSubagent: (childSessionId: string, parentSessionId: string) => Promise<boolean | void>
  promptSubagent: (childSessionId: string, text: string, parentSessionId: string) => Promise<boolean | void>
}

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
}

/** Current Host projections only. No inferred goals or locally persisted task state. */
export function SessionActivityDock({
  session,
  childSessions,
  teamState,
  sessions,
  onOpenSession,
}: SessionActivityDockProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const copy = strings.sessionActivity
  const store = useAppStore() as unknown as SubagentStoreSlice
  const canControl = session.backend === undefined || session.backend === 'harness'
  const values = session.projections?.values
  const todos = todosFrom(values?.todos)
  const projection = record(values?.goal) ? values.goal : undefined
  const goal = record(projection?.goal) && typeof projection.goal.objective === 'string' ? projection.goal : undefined
  const [expanded, setExpanded] = useState<'todos' | 'goal' | 'jobs' | 'subagents' | 'team' | undefined>()
  const toggle = (section: 'todos' | 'goal' | 'jobs' | 'subagents' | 'team') => setExpanded(value => value === section ? undefined : section)
  const { height } = useWindowDimensions()
  const detailsHeight = Math.min(180, height * 0.24)
  const [jobs, setJobs] = useState<BackgroundJob[]>([])
  const [jobError, setJobError] = useState(false)
  const [jobsLoading, setJobsLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const phase = (value: unknown) => value === 'complete' || value === 'completed' ? copy.complete
    : value === 'paused' ? copy.paused : value === 'blocked' ? copy.blocked
      : value === 'failed' ? copy.failed : value === 'killed' ? copy.killed
        : value === 'stopping' ? copy.stopping : value === 'pending' ? copy.pending : copy.active

  useEffect(() => {
    const controller = new AbortController()
    let stream: RemoteGatewayStream | undefined
    setJobs([])
    setJobError(false)
    setJobsLoading(true)
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
        await stream?.close().catch(() => {})
      }
    })()
    return () => { controller.abort(); void stream?.close().catch(() => {}) }
  }, [session.sessionId, attempt])

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
    {(jobsLoading || jobError || jobs.length > 0) && (
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
    {childSessions && childSessions.length > 0 && (
      <SubagentsCard
        sessions={childSessions}
        parentSessionId={session.sessionId}
        expanded={expanded === 'subagents'}
        onToggle={() => toggle('subagents')}
        onOpen={onOpenSession}
        maxHeight={detailsHeight}
        canControl={canControl}
        onStop={child => store.interruptSubagent(child.sessionId, session.sessionId)}
        onPrompt={(child, text) => store.promptSubagent(child.sessionId, text, session.sessionId)}
        busyAction={store.busyAction}
      />
    )}
    {teamState !== undefined && teamState.members && teamState.members.length > 0 && (
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
