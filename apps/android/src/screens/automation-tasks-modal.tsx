import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import type { RemoteSession, ScheduleCatalogEntry } from '../types'
import { strings } from '../locales/i18n'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export interface AutomationTasksModalProps {
  visible: boolean
  onClose: () => void
  onOpenSession: (session: RemoteSession) => Promise<void>
  onNewTask: () => Promise<void>
}

type StatusFilter = 'all' | 'active' | 'inactive'

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
  const sessions = useAppStore(state => state.sessions)
  const language = useAppStore(state => state.language)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'rule' | 'records'>('rule')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (visible) {
      void loadTasks()
    } else {
      setSelectedTaskId(null)
      setSearch('')
      setStatusFilter('all')
    }
  }, [visible, loadTasks])

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId),
    [tasks, selectedTaskId]
  )

  const linkedSession = useMemo(() => {
    if (!selectedTask) return undefined
    return sessions.find(s => s.sessionId === selectedTask.sessionId)
  }, [selectedTask, sessions])

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

  const emptyTitle = useMemo(() => {
    if (statusFilter === 'inactive' && search.trim() === '') {
      return strings.automation.emptyInactive
    }
    if (tasks.length === 0) {
      return strings.automation.empty
    }
    return strings.automation.noMatches
  }, [statusFilter, search, tasks.length])

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
          return strings.automation.frequencyEvery(hours, 'h')
        }
        const mins = Math.round(sec / 60)
        return strings.automation.frequencyEvery(mins, 'm')
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
        {/* Detail view */}
        {selectedTask !== undefined ? (
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
                accessibilityLabel={strings.automation.deleteTask}
                onPress={handleDelete}
                hitSlop={8}
                style={styles.headerBtn}
              >
                <Trash2 size={18} color={colors.danger} />
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

                  {/* Linked Session Section */}
                  <View style={styles.card}>
                    <Text style={styles.cardHeaderTitle}>{strings.automation.linkedSession}</Text>
                    <View style={styles.linkedSessionRow}>
                      <MessageSquare size={16} color={colors.muted} />
                      <Text style={styles.linkedSessionTitle} numberOfLines={1}>
                        {linkedSession?.title || selectedTask.sessionId}
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
              <View style={styles.headerRight}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.common.refresh}
                  onPress={() => void loadTasks()}
                  hitSlop={8}
                  style={styles.headerBtn}
                >
                  <RefreshCw size={17} color={colors.muted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.automation.newAction}
                  onPress={() => {
                    onClose()
                    void onNewTask()
                  }}
                  hitSlop={8}
                  style={[styles.headerBtn, styles.newBtn]}
                >
                  <Plus size={16} color="#ffffff" />
                  <Text style={styles.newBtnText}>{strings.automation.newAction}</Text>
                </Pressable>
              </View>
            </View>

            {/* Filter Tabs */}
            <View style={styles.filterTabsRow}>
              {(['all', 'active', 'inactive'] as const).map(f => (
                <Pressable
                  key={f}
                  accessibilityRole="button"
                  onPress={() => setStatusFilter(f)}
                  style={[styles.filterTab, statusFilter === f && styles.filterTabActive]}
                >
                  <Text
                    style={[
                      styles.filterTabText,
                      statusFilter === f && styles.filterTabTextActive,
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

            {/* Task List or Empty State */}
            {loading && tasks.length === 0 ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>{strings.automation.loading}</Text>
              </View>
            ) : rows.length === 0 ? (
              <View style={styles.centerContainer}>
                <Clock size={48} color={colors.muted} style={styles.emptyIcon} />
                <Text style={styles.emptyHeading}>{emptyTitle}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onClose()
                    void onNewTask()
                  }}
                  style={({ pressed }) => [styles.emptyActionBtn, pressed && styles.pressedBg]}
                >
                  <Plus size={16} color={colors.ink} />
                  <Text style={styles.emptyActionBtnText}>{strings.automation.newTask}</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.listContainer}>
                {rows.map(task => {
                  const nextRun = formatNextRun(task.scheduledAt)
                  return (
                    <Pressable
                      key={task.id}
                      accessibilityRole="button"
                      onPress={() => setSelectedTaskId(task.id)}
                      style={({ pressed }) => [styles.taskRow, pressed && styles.pressedBg]}
                    >
                      <View style={styles.taskIconSlot}>
                        <Clock size={18} color={task.status === 'active' ? colors.ink : colors.muted} />
                      </View>
                      <View style={styles.taskContent}>
                        <Text style={styles.taskTitle} numberOfLines={1}>
                          {task.title}
                        </Text>
                        <View style={styles.taskMetaRow}>
                          <View
                            style={[
                              styles.smallBadge,
                              task.status === 'active' ? styles.statusBadgeActive : styles.statusBadgeInactive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.smallBadgeText,
                                task.status === 'active' ? styles.statusTextActive : styles.statusTextInactive,
                              ]}
                            >
                              {task.status === 'active'
                                ? strings.automation.statusActive
                                : strings.automation.statusInactive}
                            </Text>
                          </View>
                          <Text style={styles.taskMetaText} numberOfLines={1}>
                            {formatFrequency(task)}
                          </Text>
                          {task.status === 'active' && (
                            <Text style={styles.taskMetaNext} numberOfLines={1}>
                              {strings.automation.nextPrefix}
                              {nextRun.absolute} {nextRun.relative}
                            </Text>
                          )}
                        </View>
                      </View>
                      <ChevronRight size={16} color={colors.muted} />
                    </Pressable>
                  )
                })}
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
    container: { flex: 1, backgroundColor: colors.surface },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    headerBtn: {
      padding: spacing.xs,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      ...type.heading,
      fontSize: 17,
      fontWeight: '600',
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
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      borderRadius: radius.sm,
      gap: 4,
    },
    newBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
    filterTabsRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.xs,
    },
    filterTab: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.sm,
      backgroundColor: colors.background,
    },
    filterTabActive: { backgroundColor: colors.ink },
    filterTabText: { ...type.caption, color: colors.muted, fontWeight: '500' },
    filterTabTextActive: { color: colors.surface, fontWeight: '600' },
    searchWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      height: 38,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    searchIcon: { marginRight: spacing.xs },
    searchInput: { flex: 1, ...type.body, color: colors.ink, paddingVertical: 0 },
    listContainer: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      gap: spacing.sm,
    },
    taskIconSlot: { width: 24, alignItems: 'center', justifyContent: 'center' },
    taskContent: { flex: 1 },
    taskTitle: { ...type.bodyStrong, color: colors.ink, marginBottom: 2 },
    taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    taskMetaText: { ...type.caption, color: colors.muted },
    taskMetaNext: { ...type.caption, color: colors.muted },
    smallBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
    smallBadgeText: { fontSize: 11, fontWeight: '600' },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
    statusBadgeText: { fontSize: 12, fontWeight: '600' },
    statusBadgeActive: { backgroundColor: '#e6f7ed' },
    statusTextActive: { color: '#18794e' },
    statusBadgeInactive: { backgroundColor: colors.background },
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
    emptyActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.separator,
      backgroundColor: colors.surface,
    },
    emptyActionBtnText: { ...type.bodyStrong, color: colors.ink },
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
      backgroundColor: colors.background,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    cardHeaderTitle: { ...type.bodyStrong, color: colors.ink, marginBottom: spacing.sm },
    fieldGroup: { marginVertical: spacing.xs },
    fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.xs },
    fieldLabel: { ...type.caption, color: colors.muted, marginBottom: 2 },
    fieldValue: { ...type.body, color: colors.ink },
    fieldValueMuted: { ...type.caption, color: colors.muted },
    fieldValueCode: { ...type.caption, color: colors.muted, fontFamily: 'monospace' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginVertical: spacing.xs },
    linkedSessionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    linkedSessionTitle: { ...type.body, color: colors.ink, flex: 1 },
    actionButton: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.separator,
      borderRadius: radius.sm,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xs,
    },
    actionButtonText: { ...type.bodyStrong, color: colors.ink },
    deleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.surface,
      marginTop: spacing.sm,
    },
    deleteBtnText: { ...type.bodyStrong, color: colors.danger },
    emptyText: { ...type.body, color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg },
    pressedBg: { opacity: 0.7 },
  })
}
