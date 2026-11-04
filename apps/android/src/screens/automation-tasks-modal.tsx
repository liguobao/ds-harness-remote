import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Edit2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import type {
  RemoteSession,
  ScheduleCatalogEntry,
  ScheduleCreateRequest,
  ScheduleKind,
  ScheduleRecord,
  ScheduleTimingChange,
} from '../types'
import { strings } from '../locales/i18n'
import { floatingShadow, radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export interface AutomationTasksModalProps {
  visible: boolean
  onClose: () => void
  onOpenSession: (session: RemoteSession) => Promise<void>
  onNewTask?: () => Promise<void>
}

type StatusFilter = 'all' | 'active' | 'inactive'
type FormMode = 'create' | 'edit' | null
type TimingKind = 'daily' | 'every' | 'weekly' | 'at' | 'cron'

interface EditSnapshot {
  expected: ScheduleRecord
  sessionId: string
  id: string
  timeZone: string
  originalKind: ScheduleKind
}

function extractExpectedRecord(entry: ScheduleCatalogEntry): ScheduleRecord {
  const base = {
    id: entry.id,
    title: entry.title,
    prompt: entry.prompt,
    scheduledAt: entry.scheduledAt,
  }
  switch (entry.kind) {
    case 'after':
      return { ...base, kind: 'after', afterSeconds: entry.afterSeconds ?? 60 }
    case 'at':
      return { ...base, kind: 'at' }
    case 'every':
      return { ...base, kind: 'every', everySeconds: entry.everySeconds ?? 60 }
    case 'daily':
      return { ...base, kind: 'daily', time: entry.time ?? '09:00:00.000', timeZone: entry.timeZone ?? 'UTC' }
    case 'weekly':
      return { ...base, kind: 'weekly', time: entry.time ?? '09:00:00.000', timeZone: entry.timeZone ?? 'UTC', weekdays: entry.weekdays ?? [1, 2, 3, 4, 5] }
    case 'cron':
      return { ...base, kind: 'cron', expression: entry.expression ?? '* * * * *', timeZone: entry.timeZone ?? 'UTC' }
  }
}

export function AutomationTasksModal({
  visible,
  onClose,
  onOpenSession,
  onNewTask,
}: AutomationTasksModalProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()

  const tasks = useAppStore(state => state.scheduleTasks)
  const loading = useAppStore(state => state.scheduleLoading)
  const error = useAppStore(state => state.scheduleError)
  const loadTasks = useAppStore(state => state.loadScheduleTasks)
  const deleteTask = useAppStore(state => state.deleteScheduleTask)
  const createScheduleTask = useAppStore(state => state.createScheduleTask)
  const updateScheduleTask = useAppStore(state => state.updateScheduleTask)
  const toggleScheduleTask = useAppStore(state => state.toggleScheduleTask)
  const sessions = useAppStore(state => state.sessions)
  const selectedSession = useAppStore(state => state.selectedSession)
  const workspaces = useAppStore(state => state.workspaces)
  const language = useAppStore(state => state.language)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'rule' | 'records'>('rule')
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)

  // Form states and snapshots
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [editSnapshot, setEditSnapshot] = useState<EditSnapshot | null>(null)
  const [timingDirty, setTimingDirty] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formTargetSessionId, setFormTargetSessionId] = useState('')
  const [formKind, setFormKind] = useState<TimingKind>('daily')
  const [formTime, setFormTime] = useState('09:00')
  const [formTimeZone, setFormTimeZone] = useState('')
  const [formIntervalMinutes, setFormIntervalMinutes] = useState(60)
  const [formWeekdays, setFormWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [formDelayMinutes, setFormDelayMinutes] = useState(30)
  const [formCronExpression, setFormCronExpression] = useState('0 9 * * *')
  const [submitting, setSubmitting] = useState(false)

  const formTokenRef = useRef(0)

  const currentWorkspace = useMemo(() => {
    if (!selectedSession) return undefined
    return workspaces.find(w => w.sessionIds.includes(selectedSession.sessionId))
  }, [selectedSession, workspaces])

  const currentBackend = selectedSession?.backend ?? currentWorkspace?.backend
  const isNonNativeBackend = Boolean(currentBackend && currentBackend !== 'harness')

  useEffect(() => {
    if (visible) {
      if (!isNonNativeBackend) {
        void loadTasks()
      }
    } else {
      setSelectedTaskId(null)
      setSearch('')
      setStatusFilter('all')
      setFormMode(null)
      setEditSnapshot(null)
      setTimingDirty(false)
      formTokenRef.current++
    }
  }, [visible, isNonNativeBackend, loadTasks])

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId),
    [tasks, selectedTaskId]
  )

  const linkedSession = useMemo(() => {
    if (!selectedTask) return undefined
    return sessions.find(s => s.sessionId === selectedTask.sessionId)
  }, [selectedTask, sessions])

  const availableSessions = useMemo(() => {
    return sessions.filter(s => {
      const b = s.backend ?? workspaces.find(w => w.sessionIds.includes(s.sessionId))?.backend
      return b === undefined || b === 'harness'
    })
  }, [sessions, workspaces])

  const localizedWeekdays = useMemo(() => {
    try {
      const locale = language === 'zh-CN' ? 'zh-CN' : language === 'en-US' ? 'en-US' : (language || 'zh-CN')
      const formatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
      return [1, 2, 3, 4, 5, 6, 7].map(day => {
        // 2026-01-04 is Sunday (day 0), 2026-01-05 is Monday (day 1)
        const d = new Date(2026, 0, 4 + day)
        return { day, label: formatter.format(d) }
      })
    } catch {
      return [
        { day: 1, label: '1' },
        { day: 2, label: '2' },
        { day: 3, label: '3' },
        { day: 4, label: '4' },
        { day: 5, label: '5' },
        { day: 6, label: '6' },
        { day: 7, label: '7' },
      ]
    }
  }, [language])

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tasks
      .filter(t => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false
        if (!query) return true
        return (
          (t.title || '').toLowerCase().includes(query) ||
          (t.prompt || '').toLowerCase().includes(query) ||
          (t.sessionId || '').toLowerCase().includes(query)
        )
      })
      .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
  }, [tasks, search, statusFilter])

  /** Sessions without a human title carry the raw id as their title. */
  const sessionLabel = (sessionId: string, title?: string | null): string =>
    title !== undefined && title !== null && title !== '' && !title.startsWith('session-')
      ? title
      : sessionId.slice(-8)

  const emptyTitle = useMemo(() => {
    if (statusFilter === 'inactive' && search.trim() === '') {
      return strings.automation.emptyInactive
    }
    if (tasks.length === 0) {
      return strings.automation.empty
    }
    return strings.automation.noMatches
  }, [statusFilter, search, tasks.length])

  const openCreateForm = () => {
    formTokenRef.current++
    setFormTitle('')
    setFormPrompt('')
    const defaultSid = (selectedSession && (selectedSession.backend === undefined || selectedSession.backend === 'harness'))
      ? selectedSession.sessionId
      : (availableSessions[0]?.sessionId || '')
    setFormTargetSessionId(defaultSid)
    setFormKind('daily')
    setFormTime('09:00')
    setFormTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')
    setFormIntervalMinutes(60)
    setFormWeekdays([1, 2, 3, 4, 5])
    setFormDelayMinutes(30)
    setFormCronExpression('0 9 * * *')
    setEditSnapshot(null)
    setTimingDirty(false)
    setFormMode('create')
  }

  const openEditForm = (task: ScheduleCatalogEntry) => {
    formTokenRef.current++
    const expected = extractExpectedRecord(task)
    const tz = task.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    setEditSnapshot({
      expected,
      sessionId: task.sessionId,
      id: task.id,
      timeZone: tz,
      originalKind: task.kind,
    })
    setFormTitle(task.title || '')
    setFormPrompt(task.prompt || '')
    setFormTargetSessionId(task.sessionId)
    setFormTimeZone(tz)
    setTimingDirty(false)

    if (task.kind === 'daily') {
      setFormKind('daily')
      setFormTime((task.time || '09:00').substring(0, 5))
    } else if (task.kind === 'every') {
      setFormKind('every')
      setFormIntervalMinutes(Math.round((task.everySeconds || 3600) / 60))
    } else if (task.kind === 'weekly') {
      setFormKind('weekly')
      setFormTime((task.time || '09:00').substring(0, 5))
      setFormWeekdays(task.weekdays && task.weekdays.length > 0 ? [...task.weekdays] : [1, 2, 3, 4, 5])
    } else if (task.kind === 'cron') {
      setFormKind('cron')
      setFormCronExpression(task.expression || '0 9 * * *')
    } else {
      setFormKind('at')
      setFormDelayMinutes(30)
    }
    setFormMode('edit')
  }

  const handleToggleWeekday = (day: number) => {
    setTimingDirty(true)
    setFormWeekdays(prev => {
      if (prev.includes(day)) {
        if (prev.length <= 1) return prev
        return prev.filter(d => d !== day).sort((a, b) => a - b)
      }
      return [...prev, day].sort((a, b) => a - b)
    })
  }

  const handleSaveForm = async () => {
    if (!formTitle.trim()) {
      Alert.alert(strings.automation.title, strings.automation.formTitle)
      return
    }
    if (!formPrompt.trim()) {
      Alert.alert(strings.automation.title, strings.automation.formPrompt)
      return
    }

    if (formKind === 'daily' || formKind === 'weekly') {
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(formTime.trim())) {
        Alert.alert(strings.automation.title, '请输入有效的 24 小时制时间（格式如 09:30）')
        return
      }
    }

    const currentToken = formTokenRef.current
    const tz = formTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

    setSubmitting(true)
    try {
      if (formMode === 'create') {
        const sid = formTargetSessionId || availableSessions[0]?.sessionId
        if (!sid) {
          Alert.alert(strings.automation.title, strings.automation.formTargetSession)
          return
        }

        const req: ScheduleCreateRequest = {
          title: formTitle.trim(),
          prompt: formPrompt.trim(),
        }
        if (formKind === 'daily') {
          req.daily = { time: `${formTime.trim()}:00.000`, time_zone: tz }
        } else if (formKind === 'every') {
          req.every_seconds = Math.max(60, formIntervalMinutes * 60)
        } else if (formKind === 'weekly') {
          req.weekly = {
            time: `${formTime.trim()}:00.000`,
            time_zone: tz,
            weekdays: formWeekdays.length > 0 ? formWeekdays : [1, 2, 3, 4, 5],
          }
        } else if (formKind === 'cron') {
          req.cron = { expression: formCronExpression.trim(), time_zone: tz }
        } else {
          req.after_seconds = Math.max(60, formDelayMinutes * 60)
        }

        const res = await createScheduleTask(sid, req)
        if (formTokenRef.current !== currentToken) return
        if (res) {
          setFormMode(null)
          Alert.alert(strings.automation.title, strings.automation.saveSuccess)
        } else {
          Alert.alert(strings.automation.title, strings.automation.saveFailed)
        }
      } else if (formMode === 'edit' && editSnapshot) {
        let change: ScheduleTimingChange | undefined
        if (timingDirty) {
          if (formKind === 'daily') {
            change = { kind: 'daily', daily: { time: `${formTime.trim()}:00.000`, time_zone: tz } }
          } else if (formKind === 'every') {
            change = { kind: 'every', every_seconds: Math.max(60, formIntervalMinutes * 60) }
          } else if (formKind === 'weekly') {
            change = {
              kind: 'weekly',
              weekly: {
                time: `${formTime.trim()}:00.000`,
                time_zone: tz,
                weekdays: formWeekdays.length > 0 ? formWeekdays : [1, 2, 3, 4, 5],
              },
            }
          } else if (formKind === 'cron') {
            change = { kind: 'cron', cron: { expression: formCronExpression.trim(), time_zone: tz } }
          } else {
            const targetInstant = new Date(Date.now() + formDelayMinutes * 60000).toISOString()
            change = { kind: 'at', at: targetInstant }
          }
        }

        const res = await updateScheduleTask(editSnapshot.sessionId, editSnapshot.id, editSnapshot.expected, {
          title: formTitle.trim(),
          prompt: formPrompt.trim(),
          ...(change ? { change } : {}),
        })
        if (formTokenRef.current !== currentToken) return
        if (res && 'updated' in res && res.updated) {
          setFormMode(null)
          Alert.alert(strings.automation.title, strings.automation.saveSuccess)
        } else if (res && 'code' in res && res.code === 'schedule_conflict') {
          Alert.alert(
            strings.automation.title,
            '此任务已被其他会话或投递更新，请刷新重试以保留最新更改。'
          )
        } else {
          Alert.alert(strings.automation.title, strings.automation.saveFailed)
        }
      }
    } finally {
      if (formTokenRef.current === currentToken) {
        setSubmitting(false)
      }
    }
  }

  const handleToggleActive = async () => {
    if (!selectedTask || toggling) return
    setToggling(true)
    try {
      const ok = await toggleScheduleTask(selectedTask)
      if (ok) {
        Alert.alert(
          strings.automation.title,
          selectedTask.status === 'active' ? strings.automation.taskPaused : strings.automation.taskResumed
        )
      }
    } finally {
      setToggling(false)
    }
  }

  const handleDelete = () => {
    if (!selectedTask || deleting) return
    Alert.alert(
      strings.automation.deleteConfirmTitle,
      strings.automation.deleteConfirmDesc,
      [
        { text: strings.common.cancel, style: 'cancel' },
        {
          text: strings.automation.deleteConfirm,
          style: 'destructive',
          onPress: async () => {
            setDeleting(true)
            try {
              const ok = await deleteTask(selectedTask.sessionId, selectedTask.id)
              if (ok) {
                setSelectedTaskId(null)
                await loadTasks()
              } else {
                Alert.alert(strings.common.unknown, strings.automation.deleteFailed)
              }
            } finally {
              setDeleting(false)
            }
          },
        },
      ]
    )
  }

  const handleOpenLinkedSession = async () => {
    if (!linkedSession) return
    onClose()
    await onOpenSession(linkedSession)
  }

  const formatFrequency = (task: ScheduleCatalogEntry): string => {
    switch (task.kind) {
      case 'after':
      case 'at':
        return strings.automation.frequencyOnce
      case 'daily': {
        const time = (task.time || '').replace(/\.\d+$/, '').replace(/:00$/, '')
        return strings.automation.frequencyDaily(time, task.timeZone)
      }
      case 'weekly': {
        const weekdaysStr = (task.weekdays || []).join(', ')
        const time = (task.time || '').replace(/\.\d+$/, '').replace(/:00$/, '')
        return strings.automation.frequencyWeekly(weekdaysStr, time, task.timeZone)
      }
      case 'every': {
        const sec = task.everySeconds || 60
        if (sec % 3600 === 0) {
          const hours = sec / 3600
          return strings.automation.frequencyEvery(hours, strings.automation.hourUnit)
        }
        const mins = Math.round(sec / 60)
        return strings.automation.frequencyEvery(mins, strings.automation.minuteUnit)
      }
      case 'cron':
        return strings.automation.frequencyCron(task.expression || '')
      default:
        return strings.automation.frequencyOnce
    }
  }

  const formatNextRun = (scheduledAt?: string): { absolute: string; relative: string } => {
    if (!scheduledAt) return { absolute: '', relative: '' }
    const time = Date.parse(scheduledAt)
    if (Number.isNaN(time)) return { absolute: scheduledAt, relative: '' }
    const diff = time - Date.now()

    let absolute = ''
    try {
      absolute = new Intl.DateTimeFormat(language === 'en-US' ? 'en-US' : 'zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(time)
    } catch {
      absolute = new Date(time).toLocaleString()
    }

    let relative = ''
    const absDiff = Math.abs(diff)
    if (absDiff < 60000) {
      relative = strings.time.now
    } else {
      const mins = Math.round(absDiff / 60000)
      if (mins < 60) {
        relative = diff > 0 ? `+${mins}m` : `-${mins}m`
      } else {
        const hours = Math.round(mins / 60)
        if (hours < 24) {
          relative = diff > 0 ? `+${hours}h` : `-${hours}h`
        } else {
          const days = Math.round(hours / 24)
          relative = diff > 0 ? `+${days}d` : `-${days}d`
        }
      }
    }

    return { absolute, relative: `(${relative})` }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Unsupported Backend View */}
        {isNonNativeBackend ? (
          <View style={styles.flex}>
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.common.close}
                onPress={onClose}
                hitSlop={8}
                style={styles.headerBtn}
              >
                <ArrowLeft size={20} color={colors.ink} />
              </Pressable>
              <Text style={styles.headerTitle}>{strings.automation.title}</Text>
              <View style={styles.headerRightSpacer} />
            </View>
            <View style={styles.centerContainer}>
              <AlertCircle size={52} color={colors.muted} style={styles.emptyIcon} />
              <Text style={styles.unsupportedHeading}>{strings.automation.unsupportedBackendTitle}</Text>
              <Text style={styles.unsupportedBody}>{strings.automation.unsupportedBackendDesc}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.emptyActionBtn, pressed && styles.pressedBg]}
              >
                <Text style={styles.emptyActionBtnText}>{strings.common.back}</Text>
              </Pressable>
            </View>
          </View>
        ) : formMode !== null ? (
          /* Create / Edit Form View */
          <View style={styles.flex}>
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.common.cancel}
                onPress={() => {
                  formTokenRef.current++
                  setFormMode(null)
                }}
                hitSlop={8}
                style={styles.headerBtn}
              >
                <ArrowLeft size={20} color={colors.ink} />
              </Pressable>
              <Text style={styles.headerTitle}>
                {formMode === 'create' ? strings.automation.newTask : strings.automation.editTask}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.workspaces.saveName}
                onPress={handleSaveForm}
                disabled={submitting}
                hitSlop={8}
                style={[styles.headerBtn, styles.saveHeaderBtn]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Check size={18} color={colors.white} />
                )}
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
              {/* Task Name */}
              <View style={styles.formCard}>
                <Text style={styles.formLabel}>{strings.automation.formTitle}</Text>
                <TextInput
                  value={formTitle}
                  onChangeText={setFormTitle}
                  placeholder={strings.automation.name}
                  placeholderTextColor={colors.muted}
                  maxLength={120}
                  style={styles.formInput}
                  selectionColor={colors.primary}
                />
              </View>

              {/* Task Instruction / Prompt */}
              <View style={styles.formCard}>
                <Text style={styles.formLabel}>{strings.automation.formPrompt}</Text>
                <TextInput
                  value={formPrompt}
                  onChangeText={setFormPrompt}
                  placeholder={strings.automation.instruction}
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={4}
                  style={[styles.formInput, styles.formInputMultiline]}
                  selectionColor={colors.primary}
                />
              </View>

              {/* Target Session (Create mode only) */}
              {formMode === 'create' && availableSessions.length > 0 && (
                <View style={styles.formCard}>
                  <Text style={styles.formLabel}>{strings.automation.formTargetSession}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll}>
                    {availableSessions.map(s => {
                      const active = formTargetSessionId === s.sessionId
                      return (
                        <Pressable
                          key={s.sessionId}
                          accessibilityRole="button"
                          onPress={() => setFormTargetSessionId(s.sessionId)}
                          style={[styles.sessionPill, active && styles.sessionPillActive]}
                        >
                          <MessageSquare size={13} color={active ? colors.white : colors.muted} />
                          <Text style={[styles.sessionPillText, active && styles.sessionPillTextActive]} numberOfLines={1}>
                            {sessionLabel(s.sessionId, s.title)}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Timing Kind Selector */}
              <View style={styles.formCard}>
                <Text style={styles.formLabel}>{strings.automation.formFrequency}</Text>
                <View style={styles.kindSelectorRow}>
                  <View style={styles.kindRow}>
                    {([
                      { key: 'daily', label: strings.automation.timingDaily },
                      { key: 'every', label: strings.automation.timingEvery },
                    ] as const).map(k => (
                      <Pressable
                        key={k.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: formKind === k.key }}
                        onPress={() => {
                          setTimingDirty(true)
                          setFormKind(k.key)
                        }}
                        style={[styles.kindPill, formKind === k.key && styles.kindPillActive]}
                      >
                        <Text style={[styles.kindPillText, formKind === k.key && styles.kindPillTextActive]}>
                          {k.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.kindRow}>
                    {([
                      { key: 'weekly', label: strings.automation.timingWeekly },
                      { key: 'at', label: strings.automation.timingOnce },
                    ] as const).map(k => (
                      <Pressable
                        key={k.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: formKind === k.key }}
                        onPress={() => {
                          setTimingDirty(true)
                          setFormKind(k.key)
                        }}
                        style={[styles.kindPill, formKind === k.key && styles.kindPillActive]}
                      >
                        <Text style={[styles.kindPillText, formKind === k.key && styles.kindPillTextActive]}>
                          {k.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Timing Options */}
                {formKind === 'daily' && (
                  <View style={styles.timingDetailBox}>
                    <Text style={styles.fieldSubLabel}>{strings.automation.formTime} (HH:mm)</Text>
                    <View style={styles.presetTimeRow}>
                      {['08:00', '09:00', '12:00', '18:00', '21:00'].map(t => (
                        <Pressable
                          key={t}
                          accessibilityRole="button"
                          onPress={() => {
                            setTimingDirty(true)
                            setFormTime(t)
                          }}
                          style={[styles.timeChip, formTime === t && styles.timeChipActive]}
                        >
                          <Text style={[styles.timeChipText, formTime === t && styles.timeChipTextActive]}>{t}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      value={formTime}
                      onChangeText={t => {
                        setTimingDirty(true)
                        setFormTime(t)
                      }}
                      placeholder="09:00"
                      placeholderTextColor={colors.muted}
                      maxLength={5}
                      style={styles.timeInput}
                    />
                  </View>
                )}

                {formKind === 'every' && (
                  <View style={styles.timingDetailBox}>
                    <Text style={styles.fieldSubLabel}>{strings.automation.formInterval}</Text>
                    <View style={styles.presetTimeRow}>
                      {[
                        { label: `15 ${strings.automation.minuteUnit}`, val: 15 },
                        { label: `30 ${strings.automation.minuteUnit}`, val: 30 },
                        { label: `1 ${strings.automation.hourUnit}`, val: 60 },
                        { label: `2 ${strings.automation.hourUnit}`, val: 120 },
                        { label: `4 ${strings.automation.hourUnit}`, val: 240 },
                        { label: `24 ${strings.automation.hourUnit}`, val: 1440 },
                      ].map(item => (
                        <Pressable
                          key={item.val}
                          accessibilityRole="button"
                          onPress={() => {
                            setTimingDirty(true)
                            setFormIntervalMinutes(item.val)
                          }}
                          style={[styles.timeChip, formIntervalMinutes === item.val && styles.timeChipActive]}
                        >
                          <Text style={[styles.timeChipText, formIntervalMinutes === item.val && styles.timeChipTextActive]}>
                            {item.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                {formKind === 'weekly' && (
                  <View style={styles.timingDetailBox}>
                    <Text style={styles.fieldSubLabel}>{strings.automation.formWeekdays}</Text>
                    <View style={styles.presetTimeRow}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setTimingDirty(true)
                          setFormWeekdays([1, 2, 3, 4, 5])
                        }}
                        style={[
                          styles.timeChip,
                          formWeekdays.length === 5 && formWeekdays.every(d => d <= 5) && styles.timeChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.timeChipText,
                            formWeekdays.length === 5 && formWeekdays.every(d => d <= 5) && styles.timeChipTextActive,
                          ]}
                        >
                          {strings.automation.workdaysOnly}
                        </Text>
                      </Pressable>
                    </View>
                    <View style={styles.weekdaysPillRow}>
                      {localizedWeekdays.map(d => {
                        const selected = formWeekdays.includes(d.day)
                        return (
                          <Pressable
                            key={d.day}
                            accessibilityRole="button"
                            onPress={() => handleToggleWeekday(d.day)}
                            style={[styles.weekdayCircle, selected && styles.weekdayCircleActive]}
                          >
                            <Text style={[styles.weekdayCircleText, selected && styles.weekdayCircleTextActive]}>
                              {d.label}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                    <Text style={[styles.fieldSubLabel, { marginTop: spacing.sm }]}>{strings.automation.formTime} (HH:mm)</Text>
                    <TextInput
                      value={formTime}
                      onChangeText={t => {
                        setTimingDirty(true)
                        setFormTime(t)
                      }}
                      placeholder="09:00"
                      placeholderTextColor={colors.muted}
                      maxLength={5}
                      style={styles.timeInput}
                    />
                  </View>
                )}

                {formKind === 'at' && (
                  <View style={styles.timingDetailBox}>
                    <Text style={styles.fieldSubLabel}>{strings.automation.timingOnce}</Text>
                    <View style={styles.presetTimeRow}>
                      {[
                        { label: `15 ${strings.automation.minuteUnit}`, val: 15 },
                        { label: `30 ${strings.automation.minuteUnit}`, val: 30 },
                        { label: `1 ${strings.automation.hourUnit}`, val: 60 },
                        { label: `2 ${strings.automation.hourUnit}`, val: 120 },
                      ].map(item => (
                        <Pressable
                          key={item.val}
                          accessibilityRole="button"
                          onPress={() => {
                            setTimingDirty(true)
                            setFormDelayMinutes(item.val)
                          }}
                          style={[styles.timeChip, formDelayMinutes === item.val && styles.timeChipActive]}
                        >
                          <Text style={[styles.timeChipText, formDelayMinutes === item.val && styles.timeChipTextActive]}>
                            +{item.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}

                {formKind === 'cron' && (
                  <View style={styles.timingDetailBox}>
                    <Text style={styles.fieldSubLabel}>Cron 表达式 (分 时 日 月 周)</Text>
                    <TextInput
                      value={formCronExpression}
                      onChangeText={t => {
                        setTimingDirty(true)
                        setFormCronExpression(t)
                      }}
                      placeholder="0 9 * * *"
                      placeholderTextColor={colors.muted}
                      style={styles.formInput}
                  selectionColor={colors.primary}
                    />
                  </View>
                )}
              </View>

              {/* Submit Button */}
              <Pressable
                accessibilityRole="button"
                onPress={handleSaveForm}
                disabled={submitting}
                style={({ pressed }) => [styles.submitFormBtn, pressed && styles.pressedBg]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.submitFormBtnText}>
                    {formMode === 'create' ? strings.automation.newAction : strings.workspaces.saveName}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        ) : selectedTask !== undefined ? (
          /* Detail view */
          <View style={styles.flex}>
            {/* Detail Header */}
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.common.back}
                onPress={() => setSelectedTaskId(null)}
                hitSlop={8}
                style={styles.headerBtn}
              >
                <ArrowLeft size={20} color={colors.ink} />
              </Pressable>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {selectedTask.title || strings.automation.detailTitle}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.automation.editTask}
                onPress={() => openEditForm(selectedTask)}
                hitSlop={8}
                style={styles.headerBtn}
              >
                <Edit2 size={18} color={colors.ink} />
              </Pressable>
            </View>

            {/* Detail Tabs */}
            <View style={styles.tabBar}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setActiveTab('rule')}
                style={[styles.tabItem, activeTab === 'rule' && styles.tabItemActive]}
              >
                <Text style={[styles.tabText, activeTab === 'rule' && styles.tabTextActive]}>
                  {strings.automation.detailRule}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setActiveTab('records')}
                style={[styles.tabItem, activeTab === 'records' && styles.tabItemActive]}
              >
                <Text style={[styles.tabText, activeTab === 'records' && styles.tabTextActive]}>
                  {strings.automation.detailRecords}
                </Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.detailContent}>
              {activeTab === 'rule' ? (
                <>
                  <View style={styles.card}>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{strings.automation.name}</Text>
                      <Text style={styles.fieldValue}>{selectedTask.title}</Text>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{strings.automation.instruction}</Text>
                      <Text style={styles.fieldValue}>{selectedTask.prompt}</Text>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>{strings.automation.status}</Text>
                      <View
                        style={[
                          styles.statusBadge,
                          selectedTask.status === 'active' ? styles.statusBadgeActive : styles.statusBadgeInactive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            selectedTask.status === 'active' ? styles.statusTextActive : styles.statusTextInactive,
                          ]}
                        >
                          {selectedTask.status === 'active'
                            ? strings.automation.statusActive
                            : strings.automation.statusInactive}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{strings.automation.frequency}</Text>
                      <Text style={styles.fieldValue}>{formatFrequency(selectedTask)}</Text>
                    </View>

                    {selectedTask.status === 'active' && (
                      <>
                        <View style={styles.divider} />
                        <View style={styles.fieldGroup}>
                          <Text style={styles.fieldLabel}>{strings.automation.nextRun}</Text>
                          <Text style={styles.fieldValue}>
                            {formatNextRun(selectedTask.scheduledAt).absolute}{' '}
                            <Text style={styles.fieldValueMuted}>
                              {formatNextRun(selectedTask.scheduledAt).relative}
                            </Text>
                          </Text>
                        </View>
                      </>
                    )}

                    <View style={styles.divider} />

                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>{strings.automation.taskId}</Text>
                      <Text style={styles.fieldValueCode}>{selectedTask.id}</Text>
                    </View>
                  </View>

                  {/* Pause / Resume & Edit Action Buttons */}
                  <View style={styles.actionRowContainer}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={selectedTask.status === 'active' ? strings.automation.pauseTask : strings.automation.resumeTask}
                      onPress={handleToggleActive}
                      disabled={toggling}
                      style={({ pressed }) => [
                        styles.toggleActiveBtn,
                        selectedTask.status === 'active' ? styles.togglePauseBtn : styles.toggleResumeBtn,
                        pressed && styles.pressedBg,
                      ]}
                    >
                      {selectedTask.status === 'active' ? (
                        <Pause size={16} color={colors.warning} />
                      ) : (
                        <Play size={16} color={colors.success} />
                      )}
                      <Text
                        style={[
                          styles.toggleActiveBtnText,
                          { color: selectedTask.status === 'active' ? colors.warning : colors.success },
                        ]}
                      >
                        {selectedTask.status === 'active' ? strings.automation.pauseTask : strings.automation.resumeTask}
                      </Text>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={strings.automation.editRule}
                      onPress={() => openEditForm(selectedTask)}
                      style={({ pressed }) => [styles.editRuleBtn, pressed && styles.pressedBg]}
                    >
                      <Edit2 size={16} color={colors.primary} />
                      <Text style={styles.editRuleBtnText}>{strings.automation.editRule}</Text>
                    </Pressable>
                  </View>

                  {/* Linked Session Section */}
                  <View style={styles.card}>
                    <Text style={styles.cardHeaderTitle}>{strings.automation.linkedSession}</Text>
                    <View style={styles.linkedSessionRow}>
                      <MessageSquare size={16} color={colors.muted} />
                      <Text style={styles.linkedSessionTitle} numberOfLines={1}>
                        {sessionLabel(selectedTask.sessionId, linkedSession?.title)}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void handleOpenLinkedSession()}
                      style={({ pressed }) => [styles.actionButton, pressed && styles.pressedBg]}
                    >
                      <Text style={styles.actionButtonText}>
                        {strings.automation.openLinkedSession}
                      </Text>
                    </Pressable>
                  </View>

                  {/* Delete Button */}
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleDelete}
                    disabled={deleting}
                    style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressedBg]}
                  >
                    <Trash2 size={16} color={colors.danger} />
                    <Text style={styles.deleteBtnText}>
                      {deleting ? strings.automation.deletePending : strings.automation.deleteTask}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <View style={styles.card}>
                  {selectedTask.lastDelivery !== undefined ? (
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>
                        {strings.automation.detailRecords}
                      </Text>
                      <Text style={styles.fieldValue}>
                        {formatNextRun(selectedTask.lastDelivery.deliveredAt).absolute}
                      </Text>
                      <Text style={styles.fieldValueCode}>
                        Message: {selectedTask.lastDelivery.messageId}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>{strings.automation.noRecords}</Text>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        ) : (
          /* List view */
          <View style={styles.flex}>
            {/* Top Header */}
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.common.close}
                onPress={onClose}
                hitSlop={8}
                style={styles.headerBtn}
              >
                <ArrowLeft size={20} color={colors.ink} />
              </Pressable>
              <Text style={styles.headerTitle}>{strings.automation.title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.automation.newTask}
                onPress={openCreateForm}
                hitSlop={8}
                style={[styles.headerBtn, styles.headerBtnPrimary]}
              >
                <Plus size={20} color={colors.white} />
              </Pressable>
            </View>
            <Text style={styles.subtitle}>{strings.automation.subtitle}</Text>

            {/* Error Banner if error occurred */}
            {Boolean(error) && (
              <View style={styles.errorBanner}>
                <AlertCircle size={16} color={colors.danger} />
                <Text style={styles.errorBannerText} numberOfLines={2}>
                  {strings.automation.loadError}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void loadTasks()}
                  style={styles.errorRetryBtn}
                >
                  <Text style={styles.errorRetryBtnText}>{strings.automation.retry}</Text>
                </Pressable>
              </View>
            )}

            {/* Search Input */}
            <View style={styles.searchWrapper}>
              <Search size={15} color={colors.muted} style={styles.searchIcon} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={strings.automation.searchPlaceholder}
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
              />
              {search.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.automation.clearSearch}
                  onPress={() => setSearch('')}
                  hitSlop={8}
                >
                  <X size={15} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {/* Filter Tabs */}
            <View style={styles.segmented}>
              {(['all', 'active', 'inactive'] as const).map(f => (
                <Pressable
                  key={f}
                  accessibilityRole="button"
                  accessibilityState={{ selected: statusFilter === f }}
                  onPress={() => setStatusFilter(f)}
                  style={[styles.segment, statusFilter === f && styles.segmentActive]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      statusFilter === f && styles.segmentTextActive,
                    ]}
                  >
                    {f === 'all'
                      ? strings.automation.filterAll
                      : f === 'active'
                        ? strings.automation.filterActive
                        : strings.automation.filterInactive}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Task List or Empty State */}
            {loading && tasks.length === 0 ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>{strings.automation.loading}</Text>
              </View>
            ) : rows.length === 0 ? (
              <ScrollView
                contentContainerStyle={styles.emptyScroll}
                refreshControl={
                  <RefreshControl
                    refreshing={loading}
                    onRefresh={() => void loadTasks()}
                    tintColor={colors.muted}
                    colors={[colors.primary]}
                  />
                }
              >
                <Clock size={56} color={colors.subtle} style={styles.emptyIcon} />
                <Text style={styles.emptyHeading}>{emptyTitle}</Text>
              </ScrollView>
            ) : (
              <ScrollView
                contentContainerStyle={styles.listContainer}
                refreshControl={
                  <RefreshControl
                    refreshing={loading}
                    onRefresh={() => void loadTasks()}
                    tintColor={colors.muted}
                    colors={[colors.primary]}
                  />
                }
              >
                <View style={styles.listCard}>
                  {rows.map((task, index) => {
                    const nextRun = formatNextRun(task.scheduledAt)
                    const active = task.status === 'active'
                    return (
                      <Pressable
                        key={task.id}
                        accessibilityRole="button"
                        onPress={() => setSelectedTaskId(task.id)}
                        style={({ pressed }) => [
                          styles.taskRow,
                          index > 0 && styles.taskRowDivided,
                          pressed && styles.pressedBg,
                        ]}
                      >
                        <View style={styles.taskIconBox}>
                          <Clock size={17} color={active ? colors.primary : colors.muted} />
                        </View>
                        <View style={styles.taskContent}>
                          <View style={styles.taskTitleRow}>
                            <Text style={styles.taskTitle} numberOfLines={1}>
                              {task.title}
                            </Text>
                            <Text
                              style={[
                                styles.taskBadge,
                                active ? styles.taskBadgeActive : styles.taskBadgeInactive,
                              ]}
                            >
                              {active
                                ? strings.automation.statusActive
                                : strings.automation.statusInactive}
                            </Text>
                          </View>
                          <Text style={styles.taskMetaText} numberOfLines={1}>
                            {formatFrequency(task)}
                            {active ? ` · ${nextRun.absolute} ${nextRun.relative}` : ''}
                          </Text>
                        </View>
                        <ChevronRight size={16} color={colors.subtle} />
                      </Pressable>
                    )
                  })}
                </View>
              </ScrollView>
            )}
          </View>
        )}
      </View>
    </Modal>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    headerBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      ...floatingShadow(colors),
    },
    saveHeaderBtn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    headerRightSpacer: { width: 44 },
    headerTitle: {
      ...type.heading,
      fontSize: 17,
      fontWeight: '700',
      color: colors.ink,
      flex: 1,
      textAlign: 'center',
      marginHorizontal: spacing.sm,
    },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    newBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary,
      width: 'auto',
      paddingHorizontal: spacing.md,
      height: 44,
      borderRadius: radius.pill,
      borderWidth: 0,
      gap: 4,
    },
    newBtnText: { ...type.smallStrong, color: colors.white },
    subtitle: {
      ...type.caption,
      color: colors.muted,
      textAlign: 'center',
      paddingHorizontal: spacing.lg,
      marginTop: -spacing.xxs,
      marginBottom: spacing.sm,
    },
    headerBtnPrimary: {
      backgroundColor: colors.primary,
    },
    segmented: {
      flexDirection: 'row',
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
      padding: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    segment: {
      flex: 1,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
    },
    segmentActive: {
      backgroundColor: colors.card,
      ...floatingShadow(colors),
    },
    segmentText: { ...type.small, fontSize: 14, color: colors.muted, fontWeight: '600' },
    segmentTextActive: { color: colors.ink, fontWeight: '600' },
    emptyScroll: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    searchWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.grouped,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      height: 46,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    searchIcon: { marginRight: spacing.xs },
    searchInput: { flex: 1, ...type.body, color: colors.ink, paddingVertical: 0 },
    listContainer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
    listCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      overflow: 'hidden',
    },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    taskRowDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    taskIconBox: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
    },
    taskContent: { flex: 1 },
    taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    taskTitle: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
    taskBadge: {
      ...type.caption,
      fontSize: 11,
      fontWeight: '600',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    taskBadgeActive: { color: colors.success, backgroundColor: colors.successSoft },
    taskBadgeInactive: { color: colors.muted, backgroundColor: colors.surfaceStrong },
    taskMetaText: { ...type.caption, color: colors.muted, marginTop: 2 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
    statusBadgeText: { ...type.caption, fontWeight: '600' },
    statusBadgeActive: { backgroundColor: colors.successSoft },
    statusTextActive: { color: colors.success },
    statusBadgeInactive: { backgroundColor: colors.surfaceStrong },
    statusTextInactive: { color: colors.muted },
    centerContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    loadingText: { ...type.body, color: colors.muted, marginTop: spacing.md },
    emptyIcon: { marginBottom: spacing.md },
    emptyHeading: { ...type.body, color: colors.muted, textAlign: 'center', marginBottom: spacing.lg },
    unsupportedHeading: {
      ...type.heading,
      fontSize: 18,
      fontWeight: '700',
      color: colors.ink,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    unsupportedBody: {
      ...type.body,
      color: colors.muted,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: spacing.xl,
    },
    emptyActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.xl,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.inverse,
    },
    emptyActionBtnText: { ...type.bodyStrong, color: colors.onInverse },
    tabBar: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      paddingHorizontal: spacing.md,
    },
    tabItem: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      marginRight: spacing.sm,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabItemActive: { borderBottomColor: colors.ink },
    tabText: { ...type.body, color: colors.muted },
    tabTextActive: { ...type.bodyStrong, color: colors.ink },
    detailContent: { padding: spacing.md, paddingBottom: spacing.xxl },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    cardHeaderTitle: { ...type.bodyStrong, color: colors.ink, marginBottom: spacing.sm },
    fieldGroup: { marginVertical: spacing.xs },
    fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.xs },
    fieldLabel: { ...type.caption, color: colors.muted, marginBottom: 2 },
    fieldSubLabel: { ...type.caption, color: colors.muted, marginBottom: spacing.xs, fontWeight: '600' },
    fieldValue: { ...type.body, color: colors.ink },
    fieldValueMuted: { ...type.caption, color: colors.muted },
    fieldValueCode: { ...type.caption, color: colors.muted, fontFamily: 'monospace' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginVertical: spacing.xs },
    linkedSessionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    linkedSessionTitle: { ...type.body, color: colors.ink, flex: 1 },
    actionButton: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.pill,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xs,
    },
    actionButtonText: { ...type.bodyStrong, color: colors.ink },
    actionRowContainer: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    toggleActiveBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
    },
    togglePauseBtn: {
      backgroundColor: colors.warningSoft,
      borderColor: colors.warning,
    },
    toggleResumeBtn: {
      backgroundColor: colors.successSoft,
      borderColor: colors.success,
    },
    toggleActiveBtnText: { ...type.bodyStrong },
    editRuleBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primary,
    },
    editRuleBtnText: { ...type.bodyStrong, color: colors.primary },
    deleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.pill,
      backgroundColor: colors.dangerSoft,
      marginTop: spacing.sm,
    },
    deleteBtnText: { ...type.bodyStrong, color: colors.danger },
    emptyText: { ...type.body, color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg },
    pressedBg: { opacity: 0.7 },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      gap: spacing.xs,
    },
    errorBannerText: { ...type.caption, color: colors.danger, flex: 1 },
    errorRetryBtn: {
      backgroundColor: colors.danger,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    errorRetryBtnText: { ...type.caption, color: colors.white, fontWeight: '600' },
    formContainer: {
      padding: spacing.md,
      paddingBottom: spacing.xxl,
    },
    formCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    formLabel: {
      ...type.bodyStrong,
      color: colors.ink,
      marginBottom: spacing.xs,
    },
    formInput: {
      backgroundColor: colors.background,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      ...type.body,
      color: colors.ink,
    },
    formInputMultiline: {
      minHeight: 88,
      textAlignVertical: 'top',
    },
    pillScroll: {
      marginTop: spacing.xs,
    },
    sessionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 240,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      backgroundColor: colors.grouped,
      marginRight: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    sessionPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    sessionPillText: {
      ...type.small,
      color: colors.muted,
      maxWidth: 160,
    },
    sessionPillTextActive: {
      color: colors.white,
      fontWeight: '600',
    },
    kindSelectorRow: {
      gap: spacing.xs,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },
    kindRow: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    kindPill: {
      flex: 1,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.grouped,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    kindPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    kindPillText: {
      ...type.small,
      color: colors.muted,
    },
    kindPillTextActive: {
      color: colors.white,
      fontWeight: '600',
    },
    timingDetailBox: {
      backgroundColor: colors.grouped,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginTop: spacing.xs,
    },
    presetTimeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    timeChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    timeChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    timeChipText: {
      ...type.caption,
      color: colors.ink,
      fontWeight: '600',
    },
    timeChipTextActive: {
      color: colors.white,
    },
    timeInput: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      ...type.bodyStrong,
      color: colors.ink,
      width: 100,
      textAlign: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    weekdaysPillRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginVertical: spacing.xs,
    },
    weekdayCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    weekdayCircleActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    weekdayCircleText: {
      ...type.small,
      fontWeight: '600',
      color: colors.muted,
    },
    weekdayCircleTextActive: {
      color: colors.white,
    },
    submitFormBtn: {
      backgroundColor: colors.primary,
      height: 50,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.sm,
      ...floatingShadow(colors),
    },
    submitFormBtnText: {
      ...type.bodyStrong,
      color: colors.white,
    },
  })
}
