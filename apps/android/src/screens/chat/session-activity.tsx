import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Check, CircleCheck, ChevronDown, ChevronUp, Circle, ClipboardList, Flag, ListChecks, PauseCircle, RefreshCw } from 'lucide-react-native'
import type { RemoteGatewayStream } from '@dsh-remote/client-core'
import type { BackgroundJob } from '../../services/session-tools'
import type { RemoteSession } from '../../types'
import { requireSessionTools } from '../../state/store'
import { strings } from '../../locales/i18n'
import { radius, spacing, type as typography, type ThemeColors } from '../../ui/theme'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'

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

/** Current Host projections only. No inferred goals or locally persisted task state. */
export function SessionActivityDock({ session }: { session: RemoteSession }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const copy = strings.sessionActivity
  const values = session.projections?.values
  const todos = todosFrom(values?.todos)
  const projection = record(values?.goal) ? values.goal : undefined
  const goal = record(projection?.goal) && typeof projection.goal.objective === 'string' ? projection.goal : undefined
  const [expanded, setExpanded] = useState<'todos' | 'goal' | 'jobs'>()
  const toggle = (section: 'todos' | 'goal' | 'jobs') => setExpanded(value => value === section ? undefined : section)
  const { height } = useWindowDimensions()
  const detailsHeight = Math.min(180, height * 0.24)
  const [jobs, setJobs] = useState<BackgroundJob[]>([])
  const [jobError, setJobError] = useState(false)
  const [jobsLoading, setJobsLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const activeJob = jobs.find(job => job.status === 'running' || job.status === 'stopping')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!activeJob) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [activeJob?.id])
  const seconds = activeJob?.startedAt ? Math.max(0, Math.floor((now - activeJob.startedAt) / 1000)) : undefined
  const elapsed = seconds === undefined ? undefined : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const completed = todos.filter(todo => todo.status === 'completed').length
  const current = todos.find(todo => todo.status === 'in_progress') ?? todos.find(todo => todo.status === 'pending')
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
    {todos.length > 0 && <Disclosure title={`${completed}/${todos.length}${current ? ` · ${copy.active}: ${current.content}` : ` · ${copy.complete}`}`} trailing={<View style={styles.inlineTrack}><View style={[styles.progressFill, completed === todos.length && styles.progressComplete, { width: `${completed / todos.length * 100}%` }]} /></View>}
      icon={completed === todos.length ? <CircleCheck size={18} color={colors.success} /> : <ListChecks size={18} color={colors.muted} />} open={expanded === 'todos'} onPress={() => toggle('todos')}>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${completed / todos.length * 100}%` }]} /></View>
      <ScrollView style={[styles.details, { maxHeight: detailsHeight }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {todos.map((todo, index) => <View key={index} style={styles.todo}>
          {todo.status === 'completed' ? <Check size={16} color={colors.success} /> : <Circle size={14} color={todo.status === 'in_progress' ? colors.primary : colors.muted} />}
          <Text style={styles.todoText}>{todo.content}<Text style={styles.muted}> · {phase(todo.status === 'in_progress' ? 'active' : todo.status)}</Text></Text>
        </View>)}
      </ScrollView>
    </Disclosure>}
    {goal && <Disclosure title={`${copy.goal} · ${goal.objective}`} trailing={<Text style={styles.status}>{phase(goal.phase)}</Text>}
      icon={goal.phase === 'paused' ? <PauseCircle size={18} color={colors.muted} /> : <Flag size={18} color={colors.muted} />}
      open={expanded === 'goal'} onPress={() => toggle('goal')}>
      <ScrollView style={[styles.details, { maxHeight: detailsHeight }]} nestedScrollEnabled>
        <Text selectable style={styles.detailText}>{String(goal.objective)}</Text>
        <Text style={styles.muted}>{phase(goal.phase)}{typeof projection?.roundsStarted === 'number' && typeof goal.maxGoalRounds === 'number' ? ` · ${projection.roundsStarted}/${goal.maxGoalRounds}` : ''}</Text>
        {record(goal.blockedReason) && typeof goal.blockedReason.message === 'string' && <Text selectable style={styles.detailText}>{goal.blockedReason.message}</Text>}
      </ScrollView>
    </Disclosure>}
    {(jobsLoading || jobError || jobs.length > 0) && <Disclosure title={activeJob ? activeJob.progress || activeJob.label : copy.viewJobs}
      trailing={<View style={styles.jobActions}>{elapsed && <Text style={styles.status}>{elapsed}</Text>}<Pressable accessibilityRole="button" accessibilityLabel={strings.common.refresh} onPress={() => { setRefreshing(true); setAttempt(value => value + 1) }} hitSlop={8}><RefreshCw size={16} color={colors.muted} /></Pressable></View>}
      icon={<ClipboardList size={18} color={colors.muted} />} open={expanded === 'jobs'} onPress={() => toggle('jobs')}>
      {jobsLoading && <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={copy.loading} />}
      {jobError && <Pressable accessibilityRole="button" onPress={() => { setRefreshing(true); setAttempt(value => value + 1) }} style={styles.retry}><Text style={styles.retryText}>{copy.retry}</Text></Pressable>}
      <FlatList data={jobs} keyExtractor={job => job.id} style={[styles.jobs, { maxHeight: detailsHeight }]} refreshing={refreshing} onRefresh={() => { setRefreshing(true); setAttempt(value => value + 1) }}
        nestedScrollEnabled keyboardShouldPersistTaps="handled" initialNumToRender={4} maxToRenderPerBatch={4}
        renderItem={({ item }) => <JobEntry job={item} sessionId={session.sessionId} status={phase(item.status)} />} />
    </Disclosure>}
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

function JobEntry({ job, sessionId, status }: { job: BackgroundJob; sessionId: string; status: string }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const copy = strings.sessionActivity
  const [open, setOpen] = useState(false)
  const [output, setOutput] = useState('')
  const [lost, setLost] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let stream: RemoteGatewayStream | undefined
    setOutput(''); setLost(false); setError(false); setLoading(true)
    let retained = ''
    void (async () => {
      try {
        const tools = requireSessionTools(sessionId)
        if (!tools.followJob) throw new Error('Job observation unavailable')
        stream = await tools.followJob(sessionId, job.id, controller.signal)
        if (controller.signal.aborted) return
        for await (const frame of stream) {
          if (controller.signal.aborted) return
          if (!record(frame)) throw new Error('Invalid job frame')
          setLoading(false)
          if (frame.type === 'output' && Array.isArray(frame.chunks)) {
            const text = frame.chunks.flatMap(chunk => record(chunk) && typeof chunk.text === 'string' ? [chunk.text] : []).join('')
            if (frame.lossy || frame.chunks.some(chunk => record(chunk) && chunk.gapBefore)) setLost(true)
            const next = retained + text
            if (next.length > 64000) setLost(true)
            retained = next.slice(-64000)
            setOutput(retained)
          }
        }
      } catch { if (!controller.signal.aborted) setError(true) }
      finally { if (!controller.signal.aborted) setLoading(false); await stream?.close().catch(() => {}) }
    })()
    return () => { controller.abort(); void stream?.close().catch(() => {}) }
  }, [open, sessionId, job.id, attempt])
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.jobHeader}>
      <View style={styles.jobCopy}><Text style={styles.title}>{job.label}</Text><Text style={styles.muted}>{job.id} · {status}</Text>
        {typeof job.progress === 'string' && <Text style={styles.muted}>{job.progress}</Text>}
        {typeof job.detail === 'string' && <Text style={styles.muted}>{job.detail}</Text>}
      </View>{open ? <ChevronUp size={16} color={colors.muted} /> : <ChevronDown size={16} color={colors.muted} />}
    </Pressable>
    {open && <View style={styles.output}>
      {loading && <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={copy.loading} />}
      {error && <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={styles.retry}><Text style={styles.retryText}>{copy.retry}</Text></Pressable>}
      {lost && <Text style={styles.muted}>{copy.truncated}</Text>}
      <Text selectable style={styles.outputText}>{output}</Text>
    </View>}
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
