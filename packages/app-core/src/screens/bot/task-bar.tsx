import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ArrowDownToLine, Layers, Send, X } from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import { object, objects, text, type BotObject, type BotRemoteClient } from '../../services/bot-catalog'
import { Button, IconButton } from '../../ui/components'
import { NativeMarkdown } from '../../ui/markdown'
import { useResponsiveLayout } from '../../ui/responsive'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ModalSurface } from '../chat/modal'
import type { BotPerform } from './editor'
import { createBotStyles } from './styles'

const ACTIVE_TASK_STATUSES = new Set(['running', 'active', 'waiting_work', 'waiting_approval'])

export function BotTaskBar({
  botId,
  sessionId,
  tasks,
  canBackground,
  disabled,
  onMoveToBackground,
  onSelectTask,
}: {
  botId: string
  sessionId: string
  tasks: BotObject[]
  canBackground: boolean
  disabled: boolean
  onMoveToBackground: () => void
  onSelectTask: (task: BotObject) => void
}) {
  const localStyles = useThemedStyles(createTaskStyles)
  const { colors } = useTheme()
  if (!canBackground && tasks.length === 0) return null

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={localStyles.bar}
      contentContainerStyle={localStyles.barContent}
    >
      {canBackground && (
        <Pressable
          key={`bg:${botId}:${sessionId}`}
          disabled={disabled}
          onPress={onMoveToBackground}
          accessibilityRole="button"
          accessibilityLabel={s.bots.moveToBackground}
          style={({ pressed }) => [localStyles.bgChip, pressed && { opacity: 0.72 }]}
        >
          <ArrowDownToLine size={14} color={colors.primary} />
          <Text style={localStyles.bgChipText}>{s.bots.moveToBackground}</Text>
        </Pressable>
      )}
      {tasks.map((task, idx) => {
        const taskId = text(task.id)
        const label = text(task.name) || text(task.title) || text(task.label) || taskId || s.bots.taskItem(idx + 1)
        const status = text(task.status)
        const running = ACTIVE_TASK_STATUSES.has(status) || task.running === true
        return (
          <Pressable
            key={taskId || idx}
            onPress={() => onSelectTask(task)}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [localStyles.taskChip, pressed && { opacity: 0.72 }]}
          >
            <View style={[localStyles.statusDot, { backgroundColor: running ? colors.primary : colors.muted }]} />
            <Layers size={13} color={colors.muted} />
            <Text numberOfLines={1} style={localStyles.taskText}>{label}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

export function BotTaskDetailModal({
  task,
  botId,
  client,
  busy,
  onClose,
  perform,
}: {
  task: BotObject | undefined
  botId: string
  client?: BotRemoteClient
  busy: boolean
  onClose: () => void
  perform: BotPerform
}) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createTaskStyles)
  const { colors } = useTheme()
  const { sheetMaxHeight } = useResponsiveLayout()
  const taskId = task ? text(task.id) : ''
  const [items, setItems] = useState<BotObject[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [followup, setFollowup] = useState('')

  const status = task ? text(task.status) : ''
  const running = ACTIVE_TASK_STATUSES.has(status) || task?.running === true
  const title = task ? (text(task.name) || text(task.title) || text(task.label) || taskId) : s.bots.backgroundTasks
  const activeFetchRef = useRef<AbortController | undefined>(undefined)

  const fetchTaskPage = async (signal: AbortSignal) => {
    if (!client || !taskId) return
    setLoading(true)
    setLoadError(undefined)
    try {
      const value = object(await client.call('bot-task-read', { botId, taskId }, signal))
      if (!signal.aborted) {
        setItems(objects(value.items))
      }
    } catch (reason) {
      if (!signal.aborted) {
        setLoadError(reason instanceof Error ? reason.message : s.bots.unavailable)
      }
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!taskId) {
      activeFetchRef.current?.abort()
      activeFetchRef.current = undefined
      return
    }
    activeFetchRef.current?.abort()
    const controller = new AbortController()
    activeFetchRef.current = controller
    void fetchTaskPage(controller.signal)
    return () => {
      controller.abort()
      if (activeFetchRef.current === controller) activeFetchRef.current = undefined
    }
  }, [botId, taskId, client])

  const sendFollowup = async () => {
    const trimmed = followup.trim()
    if (!trimmed || !taskId || busy) return
    const result = await perform('bot-task-send', { botId, taskId, text: trimmed })
    if (result.ok) {
      setFollowup('')
      activeFetchRef.current?.abort()
      const controller = new AbortController()
      activeFetchRef.current = controller
      void fetchTaskPage(controller.signal)
    }
  }

  return (
    <Modal visible={task !== undefined} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <ModalSurface onClose={onClose}>
        <View style={localStyles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {status !== '' && <Text style={styles.muted}>{status}</Text>}
          </View>
          {running && (
            <Button
              variant="secondary"
              label={s.bots.stop}
              disabled={busy || !taskId}
              onPress={() => void perform('bot-stop-task', { botId, taskId })}
            />
          )}
          <IconButton label={s.common.close} icon={X} onPress={onClose} />
        </View>

        <ScrollView style={{ maxHeight: Math.max(220, sheetMaxHeight - 210) }} contentContainerStyle={localStyles.modalBody}>
          {loading && items.length === 0 ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : loadError ? (
            <Text style={styles.error}>{loadError}</Text>
          ) : items.length === 0 ? (
            <Text style={styles.muted}>{s.bots.none}</Text>
          ) : (
            items.map((item, idx) => (
              <View key={text(item.id) || idx} style={styles.card}>
                <Text style={styles.muted}>{text(item.kind) || text(item.role) || 'message'}</Text>
                {text(item.text) !== '' && <NativeMarkdown text={text(item.text)} />}
              </View>
            ))
          )}
        </ScrollView>

        <View style={localStyles.followupRow}>
          <TextInput
            value={followup}
            onChangeText={setFollowup}
            placeholder={s.bots.message}
            placeholderTextColor={colors.muted}
            style={[styles.input, { flex: 1 }]}
            editable={!busy}
            onSubmitEditing={() => void sendFollowup()}
          />
          <IconButton
            label={s.bots.send}
            icon={Send}
            disabled={busy || followup.trim().length === 0}
            onPress={() => void sendFollowup()}
          />
        </View>
      </ModalSurface>
    </Modal>
  )
}

const createTaskStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    bar: {
      flexGrow: 0,
      maxHeight: 44,
      marginBottom: 4,
    },
    barContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    bgChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primary,
    },
    bgChipText: {
      ...type.caption,
      color: colors.primary,
      fontWeight: '600',
    },
    taskChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 180,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    taskText: {
      ...type.caption,
      color: colors.ink,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    modalBody: {
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    followupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingTop: spacing.sm,
    },
  })
