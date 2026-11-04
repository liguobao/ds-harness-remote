import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  ActivityIndicator,
  Dimensions,
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
  Bot,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit2,
  Folder,
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

type SchedulePreset = 'daily' | 'workdays' | 'weekly' | 'monthly' | 'hourly' | 'minutely' | 'once'

/** Preset -> concrete Host selector kind. */
function presetToKind(preset: SchedulePreset): TimingKind {
  if (preset === 'workdays' || preset === 'weekly') return 'weekly'
  if (preset === 'hourly' || preset === 'minutely') return 'every'
  if (preset === 'monthly') return 'cron'
  if (preset === 'once') return 'at'
  return 'daily'
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
  const sessionModels = useAppStore(state => state.sessionModels)
  const createSession = useAppStore(state => state.createSession)

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
  const [formPreset, setFormPreset] = useState<SchedulePreset>('daily')
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
    title !== undefined && title !== null && title.trim() !== '' && title !== sessionId
      ? title
      : sessionId.slice(-8)

  const [formModel, setFormModel] = useState('')
  const [formWorkspaceId, setFormWorkspaceId] = useState('')
  const [formTargetMode, setFormTargetMode] = useState<'current' | 'existing' | 'new'>('current')
  const [formTriggerMode, setFormTriggerMode] = useState<'scheduled' | 'now'>('scheduled')
  const [expandedRow, setExpandedRow] = useState<'sendTo' | 'repeat' | 'time' | 'model' | 'project' | null>(null)

  const modelOptions = useMemo(
    () => (sessionModels?.groups ?? []).flatMap(group => group.models.map(model => ({ id: model.id, name: model.name }))),
    [sessionModels],
  )
  const currentModelLabel =
    formModel !== '' ? formModel : sessionModels?.current.model ?? modelOptions[0]?.name ?? '—'
  const pickedWorkspace = workspaces.find(workspace => workspace.workspaceId === formWorkspaceId)
  const targetSessionId = formTargetSessionId
  const sendToLabel =
    formTargetMode === 'new'
      ? strings.automation.sendToNew
      : formTargetMode === 'existing'
        ? strings.automation.sendToExisting
        : strings.automation.sendToFixed

  const toggleRow = (row: 'sendTo' | 'repeat' | 'time' | 'model' | 'project'): void => {
    setExpandedRow(current => (current === row ? null : row))
  }

  const effectiveKind: TimingKind = presetToKind(formPreset)
  const effectiveInterval = formPreset === 'hourly' ? 60 : formPreset === 'minutely' ? 1 : formIntervalMinutes

  const modelRowRef = useRef<View>(null)
  const projectRowRef = useRef<View>(null)
  const sendToRowRef = useRef<View>(null)
  const repeatRowRef = useRef<View>(null)
  const timeRowRef = useRef<View>(null)
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number; width: number } | null>(null)
  const windowHeight = Dimensions.get('window').height

  const openPickerAt = (row: 'sendTo' | 'repeat' | 'time' | 'model' | 'project', ref: RefObject<View | null>): void => {
    if (expandedRow === row) {
      setExpandedRow(null)
      setPickerAnchor(null)
      return
    }
    ref.current?.measureInWindow((x, y, width, height) => {
      const maxTop = Math.max(spacing.md, windowHeight - 320)
      // Golden-ratio panel, right-aligned to the row so it sits under its control.
      const panelWidth = Math.max(168, Math.round(width * 0.618))
      setPickerAnchor({
        top: Math.min(y + height + 4, maxTop),
        left: x + width - panelWidth,
        width: panelWidth,
      })
      setExpandedRow(row)
    })
  }

  /** Floating picker content for the currently open row. */
  const picker = useMemo(() => {
    const close = (): void => setExpandedRow(null)
    if (expandedRow === 'model') {
      return {
        title: strings.automation.model,
        options: modelOptions.map(model => ({ key: model.id, label: model.name, active: currentModelLabel === model.name })),
        select: (key: string) => {
          const found = modelOptions.find(model => model.id === key)
          if (found !== undefined) setFormModel(found.name)
          close()
        },
      }
    }
    if (expandedRow === 'project') {
      return {
        title: strings.automation.selectProject,
        options: workspaces.map(workspace => ({
          key: workspace.workspaceId,
          label: workspace.title,
          active: formWorkspaceId === workspace.workspaceId,
        })),
        select: (key: string) => {
          setFormWorkspaceId(key)
          close()
        },
      }
    }
    if (expandedRow === 'sendTo') {
      return {
        title: strings.automation.sendTo,
        options: ([
          { key: 'new', label: strings.automation.sendToNew },
          { key: 'current', label: strings.automation.sendToFixed },
          { key: 'existing', label: strings.automation.sendToExisting },
        ] as const).map(option => ({ key: option.key, label: option.label, active: formTargetMode === option.key })),
        select: (key: string) => {
          setFormTargetMode(key as 'current' | 'existing' | 'new')
          close()
        },
      }
    }
    if (expandedRow === 'repeat') {
      return {
        title: strings.automation.formFrequency,
        options: ([
          { key: 'daily', label: strings.automation.presetDaily },
          { key: 'workdays', label: strings.automation.presetWorkdays },
          { key: 'weekly', label: strings.automation.presetWeekly },
          { key: 'monthly', label: strings.automation.presetMonthly },
          { key: 'hourly', label: strings.automation.presetHourly },
          { key: 'minutely', label: strings.automation.presetMinutely },
          { key: 'once', label: strings.automation.presetOnce },
        ] as const).map(option => ({ key: option.key, label: option.label, active: formPreset === option.key })),
        select: (key: string) => {
          setTimingDirty(true)
          setFormPreset(key as SchedulePreset)
          setFormKind(presetToKind(key as SchedulePreset))
          close()
        },
      }
    }
    if (expandedRow === 'time') {
      if (effectiveKind === 'at') {
        return {
          title: strings.automation.timingOnce,
          options: [15, 30, 60, 120].map(value => ({
            key: String(value),
            label: value >= 60 ? `${value / 60} ${strings.automation.hourUnit}` : `${value} ${strings.automation.minuteUnit}`,
            active: formDelayMinutes === value,
          })),
          select: (key: string) => {
            setTimingDirty(true)
            setFormDelayMinutes(Number(key))
            close()
          },
        }
      }
      return {
        title: strings.automation.formTime,
        options: ['08:00', '09:00', '12:00', '18:00'].map(value => ({
          key: value,
          label: value,
          active: formTime === value,
        })),
        select: (key: string) => {
          setTimingDirty(true)
          setFormTime(key)
          close()
        },
      }
    }
    return null
  }, [
    expandedRow,
    modelOptions,
    currentModelLabel,
    workspaces,
    formWorkspaceId,
    formTargetMode,
    formPreset,
    effectiveKind,
    formDelayMinutes,
    formTime,
    strings,
  ])

  const currentKindLabel = useMemo(() => {
    if (formPreset === 'workdays') return strings.automation.presetWorkdays
    if (formPreset === 'weekly') return strings.automation.presetWeekly
    if (formPreset === 'monthly') return strings.automation.presetMonthly
    if (formPreset === 'hourly') return strings.automation.presetHourly
    if (formPreset === 'minutely') return strings.automation.presetMinutely
    if (formPreset === 'once') return strings.automation.presetOnce
    return strings.automation.presetDaily
  }, [formPreset, strings])

  /** Preview of the next three local runs for the chosen preset. */
  const nextRunsLabel = useMemo(() => {
    const stamps: Date[] = []
    const hours = Number(formTime.split(':')[0])
    const minutes = Number(formTime.split(':')[1])
    const base = new Date()
    if (formPreset === 'minutely') {
      for (let i = 1; i <= 3; i += 1) stamps.push(new Date(base.getTime() + i * 60_000))
    } else if (formPreset === 'hourly') {
      for (let i = 1; i <= 3; i += 1) stamps.push(new Date(base.getTime() + i * 3_600_000))
    } else if (formPreset === 'once') {
      stamps.push(new Date(base.getTime() + (formDelayMinutes ?? 15) * 60_000))
    } else if (formPreset === 'monthly') {
      for (let i = 0; i <= 3 && stamps.length < 3; i += 1) {
        const candidate = new Date(base)
        candidate.setMonth(base.getMonth() + i, 1)
        candidate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0)
        if (candidate.getTime() <= base.getTime()) continue
        stamps.push(candidate)
      }
    } else {
      const weekdays = formPreset === 'workdays' ? [1, 2, 3, 4, 5] : formWeekdays
      for (let day = 0; day < 21 && stamps.length < 3; day += 1) {
        const candidate = new Date(base)
        candidate.setDate(base.getDate() + day)
        candidate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0)
        if (candidate.getTime() <= base.getTime()) continue
        if (formPreset === 'weekly' || formPreset === 'workdays') {
          const weekday = candidate.getDay() === 0 ? 7 : candidate.getDay()
          if (!weekdays.includes(weekday)) continue
        }
        stamps.push(candidate)
      }
    }
    if (stamps.length === 0) return '—'
    return stamps
      .map(
        at =>
          `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
      )
      .join(' · ')
  }, [formPreset, formTime, formWeekdays, formDelayMinutes])

  const nextRunsText =
    formTriggerMode === 'now' ? strings.automation.triggerNowHint : nextRunsLabel

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
    setFormPreset('daily')
    setFormTargetMode('current')
    setFormTriggerMode('scheduled')
    setFormModel('')
    setFormWorkspaceId('')
    setExpandedRow(null)
    setPickerAnchor(null)
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
    setFormTargetMode('existing')
    setFormTimeZone(tz)
    setFormTargetMode('existing')
    setFormTriggerMode('scheduled')
    setExpandedRow(null)
    setPickerAnchor(null)
    setTimingDirty(false)

    if (task.kind === 'daily') {
      setFormKind('daily')
      setFormPreset('daily')
      setFormTime((task.time || '09:00').substring(0, 5))
    } else if (task.kind === 'every') {
      const minutes = Math.round((task.everySeconds || 3600) / 60)
      setFormKind('every')
      setFormPreset(minutes >= 60 ? 'hourly' : 'minutely')
      setFormIntervalMinutes(minutes)
    } else if (task.kind === 'weekly') {
      const days = task.weekdays && task.weekdays.length > 0 ? [...task.weekdays] : [1, 2, 3, 4, 5]
      const workdays = days.length === 5 && days.every(day => day <= 5)
      setFormKind('weekly')
      setFormPreset(workdays ? 'workdays' : 'weekly')
      setFormTime((task.time || '09:00').substring(0, 5))
      setFormWeekdays(days)
    } else if (task.kind === 'cron') {
      const expression = task.expression || '0 9 1 * *'
      setFormKind('cron')
      setFormPreset('monthly')
      setFormCronExpression(expression)
      const match = /^(\d{1,2}) (\d{1,2}) 1 \* \*$/u.exec(expression.trim())
      if (match !== null) {
        setFormTime(`${String(Number(match[2])).padStart(2, '0')}:${String(Number(match[1])).padStart(2, '0')}`)
      }
    } else {
      setFormKind('at')
      setFormPreset('once')
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

    if (formTriggerMode === 'scheduled' && ['daily', 'workdays', 'weekly', 'monthly'].includes(formPreset)) {
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
        let sid = targetSessionId
        if (formTargetMode === 'new') {
          const created = await createSession(formWorkspaceId || undefined)
          sid = created ? useAppStore.getState().selectedSession?.sessionId ?? '' : ''
        }
        if (!sid) {
          Alert.alert(strings.automation.title, strings.automation.sendTo)
          return
        }

        const req: ScheduleCreateRequest = {
          title: formTitle.trim(),
          prompt: formPrompt.trim(),
        }
        if (formTriggerMode === 'now') {
          req.after_seconds = 2
        } else if (formPreset === 'daily') {
          req.daily = { time: `${formTime.trim()}:00.000`, time_zone: tz }
        } else if (formPreset === 'workdays') {
          req.weekly = { time: `${formTime.trim()}:00.000`, time_zone: tz, weekdays: [1, 2, 3, 4, 5] }
        } else if (formPreset === 'weekly') {
          req.weekly = {
            time: `${formTime.trim()}:00.000`,
            time_zone: tz,
            weekdays: formWeekdays.length > 0 ? formWeekdays : [1, 2, 3, 4, 5],
          }
        } else if (formPreset === 'monthly') {
          const parsed = /^(\d{1,2}) (\d{1,2}) 1 \* \*$/u.exec(formCronExpression.trim())
          const [monthHour, monthMinute] = formTime.split(':')
          req.cron = parsed === null
            ? { expression: formCronExpression.trim(), time_zone: tz }
            : { expression: `${Number(monthMinute)} ${Number(monthHour)} 1 * *`, time_zone: tz }
        } else if (formPreset === 'hourly') {
          req.every_seconds = Math.max(60, (formIntervalMinutes || 60) * 60)
        } else if (formPreset === 'minutely') {
          req.every_seconds = 60
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
          if (formPreset === 'daily') {
            change = { kind: 'daily', daily: { time: `${formTime.trim()}:00.000`, time_zone: tz } }
          } else if (formPreset === 'workdays') {
            change = { kind: 'weekly', weekly: { time: `${formTime.trim()}:00.000`, time_zone: tz, weekdays: [1, 2, 3, 4, 5] } }
          } else if (formPreset === 'weekly') {
            change = {
              kind: 'weekly',
              weekly: {
                time: `${formTime.trim()}:00.000`,
                time_zone: tz,
                weekdays: formWeekdays.length > 0 ? formWeekdays : [1, 2, 3, 4, 5],
              },
            }
          } else if (formPreset === 'monthly') {
            const parsed = /^(\d{1,2}) (\d{1,2}) 1 \* \*$/u.exec(formCronExpression.trim())
            const [monthHour, monthMinute] = formTime.split(':')
            change = {
              kind: 'cron',
              cron: {
                expression: parsed === null ? formCronExpression.trim() : `${Number(monthMinute)} ${Number(monthHour)} 1 * *`,
                time_zone: tz,
              },
            }
          } else if (formPreset === 'hourly' || formPreset === 'minutely') {
            change = {
              kind: 'every',
              every_seconds: formPreset === 'hourly' ? Math.max(60, (formIntervalMinutes || 60) * 60) : 60,
            }
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
            <View style={styles.formHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.common.cancel}
                onPress={() => {
                  formTokenRef.current++
                  setFormMode(null)
                }}
                hitSlop={8}
                style={[styles.headerBtn, styles.formBackBtn]}
              >
                <ArrowLeft size={20} color={colors.ink} />
              </Pressable>
              <View style={styles.formHeaderText}>
                <Text style={styles.formEyebrow}>{strings.automation.title}</Text>
                <Text style={styles.formTitleLeft} numberOfLines={1}>
                  {formMode === 'create' ? strings.automation.newTask : strings.automation.editTask}
                </Text>
              </View>
            </View>

            <ScrollView
              contentContainerStyle={styles.formContainer}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {/* 1. 任务 */}
              <View style={styles.formCard}>
                <View style={styles.cardBody}>
                  <TextInput
                    value={formTitle}
                    onChangeText={setFormTitle}
                    placeholder={strings.automation.name}
                    placeholderTextColor={colors.muted}
                    maxLength={120}
                    style={styles.titleInput}
                    selectionColor={colors.primary}
                  />
                </View>
                <View style={styles.cardDivider} />
                <View style={styles.cardBody}>
                  <TextInput
                    value={formPrompt}
                    onChangeText={setFormPrompt}
                    placeholder={strings.automation.instruction}
                    placeholderTextColor={colors.muted}
                    multiline
                    style={styles.promptInput}
                    selectionColor={colors.primary}
                  />
                </View>
                <View style={styles.cardDivider} />
                <Pressable
                  ref={modelRowRef}
                  accessibilityRole="button"
                  onPress={() => openPickerAt('model', modelRowRef)}
                  style={styles.paramRow}
                >
                  <View style={styles.modelLabel}>
                    <Bot size={14} color={colors.muted} />
                    <Text style={styles.modelName} numberOfLines={1}>{currentModelLabel}</Text>
                  </View>
                  <ChevronDown size={16} color={colors.subtle} />
                </Pressable>
              </View>


              {/* 2. 设置 */}
              <View style={styles.formCard}>
                <Pressable
                  ref={projectRowRef}
                  accessibilityRole="button"
                  onPress={() => openPickerAt('project', projectRowRef)}
                  style={styles.paramRow}
                >
                  <Text style={styles.rowLabel}>{strings.automation.project}</Text>
                  <View style={styles.dropdown}>
                    <Text style={styles.dropdownText} numberOfLines={1}>
                      {pickedWorkspace?.title ?? strings.automation.selectProject}
                    </Text>
                    <ChevronDown size={14} color={colors.muted} />
                  </View>
                </Pressable>
                <View style={styles.cardDivider} />
                <Pressable
                  ref={sendToRowRef}
                  accessibilityRole="button"
                  onPress={() => openPickerAt('sendTo', sendToRowRef)}
                  style={styles.paramRow}
                >
                  <Text style={styles.rowLabel}>{strings.automation.sendTo}</Text>
                  <View style={styles.dropdown}>
                    <Text style={styles.dropdownText} numberOfLines={1}>{sendToLabel}</Text>
                    <ChevronDown size={14} color={colors.muted} />
                  </View>
                </Pressable>
                {formTargetMode === 'existing' && (
                  <View style={styles.optionWrap}>
                    {availableSessions.map(session => {
                      const active = formTargetSessionId === session.sessionId
                      return (
                        <Pressable
                          key={session.sessionId}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => setFormTargetSessionId(session.sessionId)}
                          style={[styles.optionChip, active && styles.optionChipActive]}
                        >
                          <Text
                            style={[styles.optionChipText, active && styles.optionChipTextActive]}
                            numberOfLines={1}
                          >
                            {sessionLabel(session.sessionId, session.title)}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                )}

                {formMode === 'create' && <View style={styles.cardDivider} />}
                {formMode === 'create' && (
                <View style={styles.paramRow}>
                  <Text style={styles.rowLabel}>{strings.automation.trigger}</Text>
                  <View style={styles.triggerSegment}>
                    {([
                      { key: 'scheduled', label: strings.automation.triggerScheduled },
                      { key: 'now', label: strings.automation.triggerNow },
                    ] as const).map(option => {
                      const active = formTriggerMode === option.key
                      return (
                        <Pressable
                          key={option.key}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => setFormTriggerMode(option.key)}
                          style={[styles.triggerSegmentItem, active && styles.triggerSegmentItemActive]}
                        >
                          <Text style={[styles.triggerSegmentText, active && styles.triggerSegmentTextActive]}>{option.label}</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
                )}

                {formTriggerMode === 'scheduled' && (
                  <>
                    <View style={styles.cardDivider} />
                    <Pressable
                      ref={repeatRowRef}
                      accessibilityRole="button"
                      onPress={() => openPickerAt('repeat', repeatRowRef)}
                      style={styles.paramRow}
                    >
                      <Text style={styles.rowLabel}>{strings.automation.formFrequency}</Text>
                      <View style={styles.dropdown}>
                        <Text style={styles.dropdownText}>{currentKindLabel}</Text>
                        <ChevronDown size={14} color={colors.muted} />
                      </View>
                    </Pressable>

                    <View style={styles.cardDivider} />
                    {effectiveKind !== 'every' && (
                      <>
                        <Pressable
                          ref={timeRowRef}
                          accessibilityRole="button"
                          onPress={() => openPickerAt('time', timeRowRef)}
                          style={styles.paramRow}
                        >
                          <Text style={styles.rowLabel}>
                            {effectiveKind === 'at' ? strings.automation.timingOnce : strings.automation.formTime}
                          </Text>
                          <Text style={styles.rowValue}>
                            {effectiveKind === 'at'
                              ? `+${formDelayMinutes} ${strings.automation.minuteUnit}`
                              : formTime}
                          </Text>
                        </Pressable>
                      </>
                    )}
                    {formKind === 'weekly' && (
                      <>
                        <View style={styles.cardDivider} />
                        <View style={styles.cardBody}>
                          <Text style={styles.rowLabel}>{strings.automation.formWeekdays}</Text>
                          <View style={styles.weekdayRow}>
                            {localizedWeekdays.map(day => {
                              const selected = formWeekdays.includes(day.day)
                              return (
                                <Pressable
                                  key={day.day}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected }}
                                  onPress={() => handleToggleWeekday(day.day)}
                                  style={[styles.weekdayChip, selected && styles.optionChipActive]}
                                >
                                  <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                                    {day.label}
                                  </Text>
                                </Pressable>
                              )
                            })}
                          </View>
                        </View>
                      </>
                    )}
                    {formKind === 'cron' && (
                      <>
                        <View style={styles.cardDivider} />
                        <View style={styles.paramRow}>
                          <Text style={styles.rowLabel}>Cron</Text>
                          <TextInput
                            value={formCronExpression}
                            onChangeText={value => {
                              setTimingDirty(true)
                              setFormCronExpression(value)
                            }}
                            placeholder="0 9 * * *"
                            placeholderTextColor={colors.muted}
                            style={styles.rowValueInput}
                            selectionColor={colors.primary}
                          />
                        </View>
                      </>
                    )}

                    <View style={styles.cardDivider} />
                    <View style={styles.nextBlock}>
                      <View style={styles.nextHead}>
                        <Text style={styles.rowLabel}>{strings.automation.formNextRuns}</Text>
                        <Text style={styles.nextValue} numberOfLines={2}>{nextRunsText}</Text>
                      </View>
                      <Text style={styles.nextHint}>{strings.automation.formLocalTime}</Text>
                    </View>
                  </>
                )}
              </View>
              <Text style={styles.formHint}>{strings.automation.projectHint}</Text>
            </ScrollView>

            <View style={styles.formFooter}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  formTokenRef.current++
                  setFormMode(null)
                }}
                style={({ pressed }) => [styles.footerCancelBtn, pressed && styles.pressedBg]}
              >
                <Text style={styles.footerCancelText}>{strings.common.cancel}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleSaveForm}
                disabled={submitting}
                style={({ pressed }) => [styles.footerSaveBtn, pressed && styles.pressedBg]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.footerSaveText}>{strings.automation.saveTask}</Text>
                )}
              </Pressable>
  
            <Modal
              visible={picker !== null}
              transparent
              animationType="none"
              onRequestClose={() => {
                setExpandedRow(null)
                setPickerAnchor(null)
              }}
            >
              <Pressable
                style={styles.pickerBackdrop}
                onPress={() => {
                  setExpandedRow(null)
                  setPickerAnchor(null)
                }}
              >
                <View
                  style={[
                    styles.pickerCard,
                    pickerAnchor === null
                      ? styles.pickerCardFallback
                      : { position: 'absolute', top: pickerAnchor.top, left: pickerAnchor.left, width: pickerAnchor.width },
                  ]}
                >
                  <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerScrollContent} nestedScrollEnabled>
                    {picker?.options.map((option, index) => (
                      <Pressable
                        key={option.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: option.active }}
                        onPress={() => {
                          picker.select(option.key)
                          setPickerAnchor(null)
                        }}
                        style={[styles.dropdownItem, index > 0 && styles.dropdownItemDivider]}
                      >
                        <Text
                          style={[styles.dropdownItemText, option.active && styles.dropdownItemTextActive]}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                        {option.active && <Check size={16} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </Pressable>
            </Modal>
          </View>
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
            <View style={styles.filterRow}>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.common.refresh}
                onPress={() => void loadTasks()}
                hitSlop={8}
                style={styles.refreshBtn}
              >
                <RefreshCw size={16} color={colors.muted} />
              </Pressable>
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
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
      gap: spacing.xs,
    },
    segmented: {
      flex: 1,
      flexDirection: 'row',
      padding: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.grouped,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
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
      paddingBottom: 120,
    },
    formHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    formBackBtn: {
      alignSelf: 'flex-start',
    },
    formHeaderText: { flex: 1 },
    formEyebrow: {
      ...type.caption,
      color: colors.muted,
      marginBottom: 2,
    },
    formTitleLeft: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: '700',
      color: colors.ink,
      includeFontPadding: false,
    },
    titleInput: {
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '600',
      color: colors.ink,
      paddingVertical: 6,
      includeFontPadding: false,
    },
    promptInput: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.ink,
      minHeight: 76,
      textAlignVertical: 'top',
      paddingVertical: 2,
    },
    cardDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
    },
    paramRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      minHeight: 52,
      paddingHorizontal: spacing.md,
    },
    paramLabel: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.muted,
    },
    paramValue: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.ink,
    },
    formHelper: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.muted,
      paddingHorizontal: spacing.md,
      marginTop: -spacing.sm,
      marginBottom: spacing.md,
    },
    nextRunsRow: {
      gap: 2,
    },
    nextRunsHint: {
      fontSize: 12,
      color: colors.subtle,
    },
    nextRunsValue: {
      fontSize: 13,
      color: colors.ink,
    },
    timeInlineInput: {
      ...type.bodyStrong,
      color: colors.primary,
      minWidth: 72,
      textAlign: 'right',
      paddingVertical: 0,
    },
    cardBody: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    rowLabel: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.muted,
    },
    rowValue: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.ink,
    },
    rowValueInput: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.ink,
      textAlign: 'right',
      minWidth: 72,
      paddingVertical: 0,
    },
    formHint: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.muted,
      marginTop: spacing.xs,
    },
    optionWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    optionChip: {
      height: 34,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    optionChipActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    optionChipText: {
      fontSize: 13,
      color: colors.ink,
    },
    optionChipTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    weekdayChip: {
      width: 40,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    nextBlock: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    nextHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    nextValue: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.ink,
      textAlign: 'right',
      flex: 1,
      marginLeft: spacing.sm,
    },
    nextHint: {
      fontSize: 12,
      color: colors.subtle,
      marginTop: 2,
    },
    sessionRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      paddingTop: spacing.xs,
      paddingRight: spacing.md,
    },
    optionChipGrid: {
      width: '48%',
      flexGrow: 0,
    },
    modelLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      flex: 1,
    },
    modelName: {
      fontSize: 14,
      color: colors.ink,
      flexShrink: 1,
    },
    optionEmpty: {
      fontSize: 13,
      color: colors.muted,
      paddingVertical: spacing.xs,
    },
    projectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: -spacing.sm,
      marginBottom: spacing.xs,
    },
    projectChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 32,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      maxWidth: '100%',
    },
    projectChipText: {
      fontSize: 13,
      color: colors.ink,
      flexShrink: 1,
    },
    dropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.background,
      maxWidth: '65%',
    },
    dropdownText: {
      fontSize: 14,
      color: colors.ink,
      flexShrink: 1,
    },
    triggerSegment: {
      flexDirection: 'row',
      padding: 2,
      borderRadius: 8,
      backgroundColor: colors.background,
    },
    triggerSegmentItem: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 5,
      borderRadius: 6,
    },
    triggerSegmentItemActive: {
      backgroundColor: colors.card,
      ...floatingShadow(colors),
    },
    triggerSegmentText: {
      fontSize: 13,
      color: colors.muted,
    },
    triggerSegmentTextActive: {
      color: colors.ink,
      fontWeight: '600',
    },
    weekdayRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    dropdownCard: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    dropdownScroll: {
      maxHeight: 220,
    },
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      minHeight: 44,
      paddingHorizontal: spacing.md,
    },
    dropdownItemDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    dropdownItemText: {
      fontSize: 14,
      color: colors.ink,
      flex: 1,
    },
    dropdownItemTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    dropdownEmpty: {
      fontSize: 13,
      color: colors.muted,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pickerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(15, 15, 15, 0.12)',
    },
    pickerCard: {
      maxHeight: 260,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      paddingVertical: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      ...floatingShadow(colors),
    },
    pickerCardFallback: {
      margin: spacing.lg,
    },
    pickerScroll: {
      maxHeight: 252,
    },
    pickerScrollContent: {
      paddingBottom: spacing.xs,
    },
    formFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
      backgroundColor: colors.background,
      ...floatingShadow(colors),
    },
    footerCancelBtn: {
      height: 44,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
    },
    footerCancelText: {
      ...type.bodyStrong,
      color: colors.ink,
    },
    footerSaveBtn: {
      height: 46,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.primary,
    },
    footerSaveText: {
      ...type.bodyStrong,
      color: colors.white,
    },
    formCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      marginBottom: spacing.md,
      overflow: 'hidden',
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
      paddingRight: spacing.md,
      marginTop: spacing.xs,
    },
    sessionPill: {
      height: 34,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
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
