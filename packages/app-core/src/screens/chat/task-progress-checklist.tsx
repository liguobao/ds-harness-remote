import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
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
import Svg, { Circle, Path } from 'react-native-svg'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { IconChecklistOutline } from '../../ui/dsh-icons'
import { strings } from '../../locales/i18n'
import { radius, spacing, type as typography, type ThemeColors } from '../../ui/theme'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  status: TodoStatus
}

export type TaskGlyphKind = 'hollow-circle' | 'blue-circle' | 'checkmark'

/** Map status to glyph visual semantic */
export function taskStatusGlyphKind(status: TodoStatus): TaskGlyphKind {
  switch (status) {
    case 'completed': return 'checkmark'
    case 'in_progress': return 'blue-circle'
    case 'pending': return 'hollow-circle'
  }
}

/** Pure progress derivation for task checklist */
export function formatTaskProgress(todos: readonly TodoItem[]): {
  done: number
  total: number
  progressText: string
  activeItem: TodoItem | null
} {
  const done = todos.filter(t => t.status === 'completed').length
  const total = todos.length
  const activeItem = todos.find(t => t.status === 'in_progress') ?? null
  return {
    done,
    total,
    progressText: `${done}/${total}`,
    activeItem,
  }
}

/** Localized status label matching sessionActivity dictionary */
export function taskStatusLabel(
  status: TodoStatus,
  copy: typeof strings.sessionActivity,
): string {
  switch (status) {
    case 'completed': return copy.complete
    case 'in_progress': return copy.active
    case 'pending': return copy.pending
  }
}

export interface TaskProgressChecklistProps {
  todos: readonly TodoItem[]
  expanded?: boolean
  onToggle?: () => void
  defaultExpanded?: boolean
  maxHeight?: number
  testID?: string
}

/**
 * Task status glyph matching DeepSeek Harness StateDot appearance="step":
 * - pending: hollow circle (空心圆)
 * - in_progress: blue circle with animated rotating spinner (蓝色圆圈)
 * - completed: green circular badge with checkmark (完成后显示勾选)
 */
export const TaskStatusGlyph = memo(function TaskStatusGlyph({
  status,
  colors,
  size = 16,
}: {
  status: TodoStatus
  colors: ThemeColors
  size?: number
}) {
  const spinAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (status !== 'in_progress') return
    const animation = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1500,
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
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="glyph-completed">
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

  if (status === 'in_progress') {
    const spin = spinAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    })
    return (
      <Animated.View
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}
        testID="glyph-in-progress"
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

  // pending: hollow circle
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="glyph-pending">
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Circle cx="8" cy="8" r="6" stroke={colors.muted} strokeWidth={1.5} fill="none" />
      </Svg>
    </View>
  )
})

/**
 * 1:1 DeepSeek Harness Task Progress Checklist (TodoPanel) for mobile:
 * - Task list: displays the steps planned by AI
 * - Task status: hollow circle (pending), blue circle (in_progress), checkmark (completed)
 * - Progress stats: 0/n indicating 0 out of n completed
 * - Real-time updates: dynamic reactive rendering on session projection changes
 * - Collapsible / expandable: user can fold or expand to view detailed tasks
 */
export const TaskProgressChecklist = memo(function TaskProgressChecklist({
  todos,
  expanded,
  onToggle,
  defaultExpanded = false,
  maxHeight,
  testID = 'task-progress-checklist',
}: TaskProgressChecklistProps) {
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

  if (!todos || todos.length === 0) return null

  const { done: completed, total, progressText } = useMemo(() => formatTaskProgress(todos), [todos])
  const listMaxHeight = maxHeight ?? Math.min(220, height * 0.28)

  const statusLabel = (status: TodoStatus) => {
    switch (status) {
      case 'completed': return copy.complete
      case 'in_progress': return copy.active
      case 'pending': return copy.pending
    }
  }

  return (
    <View style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.taskChecklist || copy.todos} · ${progressText}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={handleToggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        testID={`${testID}-header`}
      >
        <View style={styles.leadIcon}>
          <IconChecklistOutline size={16} color={colors.muted} />
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {copy.taskChecklist || copy.todos}
        </Text>
        <View style={styles.progressContainer}>
          <Text style={styles.progress} testID={`${testID}-progress`}>
            {progressText}
          </Text>
        </View>
        <View style={styles.chevron}>
          {isOpen ? (
            <ChevronUp size={16} color={colors.muted} />
          ) : (
            <ChevronDown size={16} color={colors.muted} />
          )}
        </View>
      </Pressable>

      {isOpen && (
        <View style={styles.contentWrap} testID={`${testID}-content`}>
          <View style={styles.divider} />
          <ScrollView
            style={[styles.list, { maxHeight: listMaxHeight }]}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {todos.map((todo, index) => (
              <View
                key={`${index}:${todo.content}`}
                style={styles.item}
                accessible={true}
                accessibilityRole="text"
                accessibilityLabel={`${todo.content} · ${statusLabel(todo.status)}`}
                testID={`${testID}-item-${index}`}
              >
                <View style={styles.glyphWrap}>
                  <TaskStatusGlyph status={todo.status} colors={colors} />
                </View>
                <Text style={styles.itemContent}>
                  {todo.content}
                </Text>
              </View>
            ))}
          </ScrollView>
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
      alignItems: 'flex-start',
      paddingLeft: spacing.xxs,
    },
    progress: {
      ...typography.small,
      color: colors.muted,
      fontVariant: ['tabular-nums'],
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
    item: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      minHeight: 32,
    },
    glyphWrap: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    itemContent: {
      ...typography.small,
      color: colors.ink,
      flex: 1,
      lineHeight: 20,
    },
  })
