import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { ChevronDown, ChevronRight, ChevronUp, Layers, Users, X } from 'lucide-react-native'
import { strings } from '../../locales/i18n'
import type { RemoteSession, TeamMemberSnapshot, TeamTaskSnapshot } from '../../types'
import * as theme from '../../ui/theme'
import type { ThemeColors } from '../../ui/theme'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'

const { radius, spacing } = theme
const typography = theme.type
import { resolveSessionDisplayTitle } from '../session-title'
import { createStyles as createLegacyStyles } from './styles'

function SimpleModalSurface({ onClose, colors, children }: { onClose: () => void; colors: ThemeColors; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={{ backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', maxHeight: 480, borderWidth: 1, borderColor: colors.border }}>
        {children}
      </View>
    </View>
  )
}

/** Split a team member label into role and task ("你是X。任务：Y" / "You are X. Task: Y"). */
export function parseAgentLabel(raw: string | undefined): { role?: string; task: string } {
  const text = (raw ?? '').replace(/\s+/gu, ' ').trim()
  const zh = /^你是(.+?)(?:。|，|,|：)(?:你的任务|任务)[：:]\s*(.+)$/u.exec(text)
  if (zh?.[1] !== undefined && zh[2] !== undefined) return { role: zh[1].trim(), task: zh[2].trim() }
  const en = /^You are (?:an?|the)\s+(.+?)(?:\.|。)\s*(?:Your task|Task)[：:]\s*(.+)$/iu.exec(text)
  if (en?.[1] !== undefined && en[2] !== undefined) return { role: en[1].trim(), task: en[2].trim() }
  return { task: text }
}

/** Pure derivation of subagent statistics */
export function formatSubagentStats(sessions: readonly RemoteSession[]): {
  runningCount: number
  totalCount: number
  statsText: string
} {
  const runningCount = sessions.filter(s => s.running === true).length
  const totalCount = sessions.length
  return {
    runningCount,
    totalCount,
    statsText: runningCount > 0 ? `${runningCount}/${totalCount}` : `${totalCount}`,
  }
}

/** Pure derivation of agent-team statistics */
export function formatTeamStats(
  members: readonly TeamMemberSnapshot[],
  sessions: readonly RemoteSession[] = [],
): {
  activeCount: number
  totalCount: number
  statsText: string
} {
  const activeCount = members.filter(member => {
    if (member.phase === 'provisioning') return true
    const session = sessions.find(s => s.sessionId === member.id)
    return session?.running === true
  }).length
  const totalCount = members.length
  return {
    activeCount,
    totalCount,
    statsText: activeCount > 0 ? `${activeCount}/${totalCount}` : `${totalCount}`,
  }
}

export type AgentGlyphStatus = 'running' | 'provisioning' | 'failed' | 'completed' | 'idle' | 'pending'

/**
 * Status glyph matching TaskStatusGlyph / JobStatusGlyph visual semantics:
 * - running: blue animated rotating spinner
 * - provisioning: orange animated rotating pulse spinner
 * - failed: red circular badge with exclamation / cross
 * - completed: green circular badge with checkmark
 * - idle / pending: muted circular outline
 */
export const AgentStatusGlyph = memo(function AgentStatusGlyph({
  status,
  colors,
  size = 16,
  testID,
}: {
  status: AgentGlyphStatus | string
  colors: ThemeColors
  size?: number
  testID?: string
}) {
  const spinAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (status !== 'running' && status !== 'provisioning') return
    const animation = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: status === 'provisioning' ? 2000 : 1500,
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
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID={testID ?? 'agent-glyph-completed'}>
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
        testID={testID ?? 'agent-glyph-running'}
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

  if (status === 'provisioning') {
    const spin = spinAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    })
    return (
      <Animated.View
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}
        testID={testID ?? 'agent-glyph-provisioning'}
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

  if (status === 'failed') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID={testID ?? 'agent-glyph-failed'}>
        <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <Circle cx="8" cy="8" r="7" fill={colors.danger ?? '#EF4444'} />
          <Path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      </View>
    )
  }

  // idle or pending: static circle
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID={testID ?? 'agent-glyph-idle'}>
      <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <Circle cx="8" cy="8" r="6" stroke={colors.muted} strokeWidth={1.5} fill="none" />
      </Svg>
    </View>
  )
})

export interface SubagentsCardProps {
  sessions: readonly RemoteSession[]
  expanded?: boolean
  onToggle?: () => void
  defaultExpanded?: boolean
  maxHeight?: number
  onOpen?: (session: RemoteSession) => void
  testID?: string
}

/**
 * Collapsible Subagents Card matching TaskProgressChecklist / BackgroundJobsCard style:
 * - Card container with border, rounded corners and card background
 * - Collapsible header (minHeight: 44) with Layers icon, title, running/total badge and chevron
 * - Expandable scroll view listing child sessions with glyphs, role/task parse and navigation chevron
 */
export const SubagentsCard = memo(function SubagentsCard({
  sessions,
  expanded,
  onToggle,
  defaultExpanded = false,
  maxHeight,
  onOpen,
  testID = 'subagents-card',
}: SubagentsCardProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createCardStyles)
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

  if (!sessions || sessions.length === 0) return null

  const { totalCount, statsText } = useMemo(() => formatSubagentStats(sessions), [sessions])
  const listMaxHeight = maxHeight ?? Math.min(260, height * 0.32)
  const title = copy.subagents || strings.chat.subagentsTitle(totalCount).split(' · ')[0]

  return (
    <View style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} · ${statsText}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={handleToggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        testID={`${testID}-header`}
      >
        <View style={styles.leadIcon}>
          <Layers size={16} color={colors.muted} />
        </View>

        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>

        <View style={styles.progressContainer}>
          <Text style={styles.progress} testID={`${testID}-progress`}>
            {statsText}
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
            {sessions.map((item, index) => {
              const parsed = parseAgentLabel(resolveSessionDisplayTitle(item) ?? item.title)
              const role = (parsed.role && parsed.role.trim().length > 0) ? parsed.role.trim() : (item.title && item.title.trim().length > 0) ? item.title.trim() : strings.sessions.child
              const isRunning = item.running === true
              const glyphStatus = isRunning ? 'running' : 'idle'
              const stateLabel = isRunning ? strings.status.running : strings.sessions.child

              return (
                <Pressable
                  key={item.sessionId}
                  accessibilityRole="button"
                  accessibilityLabel={`${role} ${parsed.task} · ${stateLabel}`}
                  onPress={() => onOpen?.(item)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  testID={`${testID}-item-${index}`}
                >
                  <View style={styles.glyphWrap}>
                    <AgentStatusGlyph status={glyphStatus} colors={colors} />
                  </View>
                  <View style={styles.rowCopy}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowRole} numberOfLines={1}>{role}</Text>
                      <Text style={isRunning ? styles.statusRunning : styles.statusIdle}>{stateLabel}</Text>
                    </View>
                    {parsed.task.length > 0 && (
                      <Text style={styles.rowTask} numberOfLines={2}>{parsed.task}</Text>
                    )}
                  </View>
                  <ChevronRight size={15} color={colors.subtle ?? colors.muted} />
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}
    </View>
  )
})

export interface AgentTeamCardProps {
  members: readonly TeamMemberSnapshot[]
  tasks?: readonly TeamTaskSnapshot[]
  sessions?: readonly RemoteSession[]
  expanded?: boolean
  onToggle?: () => void
  defaultExpanded?: boolean
  maxHeight?: number
  onOpen?: (session: RemoteSession) => void
  testID?: string
}

/**
 * Collapsible Agent Team Card matching TaskProgressChecklist / BackgroundJobsCard style:
 * - Card container with border, rounded corners and card background
 * - Collapsible header (minHeight: 44) with Users icon, title, active/total badge and chevron
 * - Expandable scroll view listing members with glyphs, claimed tasks, error details and navigation chevron
 */
export const AgentTeamCard = memo(function AgentTeamCard({
  members,
  tasks = [],
  sessions = [],
  expanded,
  onToggle,
  defaultExpanded = false,
  maxHeight,
  onOpen,
  testID = 'agent-team-card',
}: AgentTeamCardProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createCardStyles)
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

  if (!members || members.length === 0) return null

  const { totalCount, statsText } = useMemo(
    () => formatTeamStats(members, sessions),
    [members, sessions],
  )
  const listMaxHeight = maxHeight ?? Math.min(260, height * 0.32)
  const title = copy.team || strings.chat.teamTitle(totalCount).split(' · ')[0]

  const taskStatusLabel = (status: TeamTaskSnapshot['status']) =>
    status === 'completed'
      ? strings.chat.teamTaskCompleted
      : status === 'in_progress'
        ? strings.chat.teamTaskInProgress
        : strings.chat.teamTaskPending

  return (
    <View style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} · ${statsText}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={handleToggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        testID={`${testID}-header`}
      >
        <View style={styles.leadIcon}>
          <Users size={16} color={colors.muted} />
        </View>

        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>

        <View style={styles.progressContainer}>
          <Text style={styles.progress} testID={`${testID}-progress`}>
            {statsText}
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
            {members.map((member, index) => {
              const session = sessions.find(item => item.sessionId === member.id)
              const owned = tasks.filter(task => task.ownerId === member.id && task.status !== 'deleted')
              const active = owned.find(task => task.status === 'in_progress')
                ?? owned.find(task => task.status === 'pending')
                ?? owned[0]

              const liveRunning = session?.running === true
              let glyphStatus: AgentGlyphStatus = 'idle'
              let stateLabel = strings.chat.teamIdle
              let stateStyle = styles.statusIdle

              if (member.phase === 'failed') {
                glyphStatus = 'failed'
                stateLabel = strings.chat.teamPhaseFailed
                stateStyle = styles.statusFailed
              } else if (member.phase === 'provisioning') {
                glyphStatus = 'provisioning'
                stateLabel = strings.chat.teamPhaseProvisioning
                stateStyle = styles.statusProvisioning
              } else if (liveRunning) {
                glyphStatus = 'running'
                stateLabel = strings.status.running
                stateStyle = styles.statusRunning
              }

              const description = typeof member.description === 'string' ? member.description.trim() : ''
              const role = description.length > 0
                ? description
                : member.name === 'lead'
                  ? strings.chat.teamLead
                  : typeof member.name === 'string' && member.name.length > 0
                    ? member.name
                    : member.id

              const content = (
                <>
                  <View style={styles.glyphWrap}>
                    <AgentStatusGlyph status={glyphStatus} colors={colors} />
                  </View>
                  <View style={styles.rowCopy}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowRole} numberOfLines={1}>{role}</Text>
                      <Text style={stateStyle}>{stateLabel}</Text>
                    </View>
                    {active !== undefined && typeof active.subject === 'string' && (
                      <Text style={styles.rowTask} numberOfLines={2}>
                        {active.subject} · {taskStatusLabel(active.status)}
                      </Text>
                    )}
                    {owned.length > 1 && (
                      <Text style={styles.rowTask}>{strings.chat.teamMoreTasks(owned.length)}</Text>
                    )}
                    {member.phase === 'failed' && typeof member.error === 'string' && member.error.length > 0 && (
                      <Text style={[styles.rowTask, styles.errorText]} numberOfLines={2}>{member.error}</Text>
                    )}
                  </View>
                  {session !== undefined ? (
                    <ChevronRight size={15} color={colors.subtle ?? colors.muted} />
                  ) : (
                    <View style={{ width: 15 }} />
                  )}
                </>
              )

              return session === undefined ? (
                <View
                  key={member.id}
                  style={styles.row}
                  accessibilityLabel={`${role} ${active?.subject ?? ''} · ${stateLabel}`}
                  testID={`${testID}-item-${index}`}
                >
                  {content}
                </View>
              ) : (
                <Pressable
                  key={member.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${role} ${active?.subject ?? ''} · ${stateLabel}`}
                  onPress={() => onOpen?.(session)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  testID={`${testID}-item-${index}`}
                >
                  {content}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}
    </View>
  )
})

/** Legacy popover listing the session's subagent (child) conversations (retained for backward compatibility). */
export function ChildAgentPanel({ visible, sessions, onClose, onOpen }: {
  visible: boolean
  sessions: RemoteSession[]
  onClose: () => void
  onOpen: (session: RemoteSession) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createLegacyStyles)
  const listMaxHeight = 360
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SimpleModalSurface onClose={onClose} colors={colors}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{strings.chat.subagentsTitle(sessions.length)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={onClose} hitSlop={8}>
            <X size={18} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView style={[styles.subagentList, { maxHeight: listMaxHeight }]} keyboardShouldPersistTaps="handled">
          {sessions.map(item => {
            const parsed = parseAgentLabel(resolveSessionDisplayTitle(item) ?? item.title)
            const role = parsed.role ?? item.title ?? strings.sessions.child
            return (
              <Pressable
                key={item.sessionId}
                accessibilityRole="button"
                accessibilityLabel={`${role} ${parsed.task}`}
                onPress={() => onOpen(item)}
                style={({ pressed }) => [styles.subagentRow, pressed && styles.resendRowPressed]}
              >
                <View style={styles.teamRowCopy}>
                  <View style={styles.teamRowTitleLine}>
                    <Text style={styles.teamRowRole} numberOfLines={1}>{role}</Text>
                    {item.running
                      ? <Text style={styles.subagentRunning}>{strings.status.running}</Text>
                      : <Text style={styles.subagentIdle}>{strings.sessions.child}</Text>}
                  </View>
                  {parsed.task.length > 0 && (
                    <Text style={styles.teamRowTask} numberOfLines={2}>{parsed.task}</Text>
                  )}
                </View>
                <ChevronRight size={15} color={colors.subtle} />
              </Pressable>
            )
          })}
        </ScrollView>
      </SimpleModalSurface>
    </Modal>
  )
}

/** Legacy agent-team popover (retained for backward compatibility). */
export function TeamAgentPanel({ visible, members, tasks, sessions, onClose, onOpen }: {
  visible: boolean
  members: TeamMemberSnapshot[]
  tasks: TeamTaskSnapshot[]
  sessions: RemoteSession[]
  onClose: () => void
  onOpen: (session: RemoteSession) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createLegacyStyles)
  const listMaxHeight = 360
  const taskStatusLabel = (status: TeamTaskSnapshot['status']) => status === 'completed'
    ? strings.chat.teamTaskCompleted
    : status === 'in_progress'
      ? strings.chat.teamTaskInProgress
      : strings.chat.teamTaskPending
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SimpleModalSurface onClose={onClose} colors={colors}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{strings.chat.teamTitle(members.length)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={onClose} hitSlop={8}>
            <X size={18} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView style={[styles.subagentList, { maxHeight: listMaxHeight }]} keyboardShouldPersistTaps="handled">
          {members.map(member => {
            const session = sessions.find(item => item.sessionId === member.id)
            const owned = tasks.filter(task => task.ownerId === member.id && task.status !== 'deleted')
            const active = owned.find(task => task.status === 'in_progress')
              ?? owned.find(task => task.status === 'pending')
              ?? owned[0]
            const liveRunning = session?.running === true
            const stateLabel = member.phase === 'failed'
              ? strings.chat.teamPhaseFailed
              : member.phase === 'provisioning'
                ? strings.chat.teamPhaseProvisioning
                : liveRunning
                  ? strings.status.running
                  : strings.chat.teamIdle
            const stateStyle = member.phase === 'failed'
              ? styles.subagentRunningFailed
              : member.phase === 'provisioning'
                ? styles.subagentProvisioning
                : liveRunning
                  ? styles.subagentRunning
                  : styles.subagentIdle
            const description = typeof member.description === 'string' ? member.description.trim() : ''
            const role = description.length > 0
              ? description
              : member.name === 'lead' ? strings.chat.teamLead
                : typeof member.name === 'string' && member.name.length > 0 ? member.name : member.id
            const row = (
              <View style={styles.teamRowCopy}>
                <View style={styles.teamRowTitleLine}>
                  <Text style={styles.teamRowRole} numberOfLines={1}>{role}</Text>
                  <Text style={stateStyle}>{stateLabel}</Text>
                </View>
                {active !== undefined && typeof active.subject === 'string' && (
                  <Text style={styles.teamRowTask} numberOfLines={2}>
                    {active.subject} · {taskStatusLabel(active.status)}
                  </Text>
                )}
                {owned.length > 1 && (
                  <Text style={styles.teamRowTask}>{strings.chat.teamMoreTasks(owned.length)}</Text>
                )}
                {member.phase === 'failed' && typeof member.error === 'string' && member.error.length > 0 && (
                  <Text style={styles.teamRowTask} numberOfLines={2}>{member.error}</Text>
                )}
              </View>
            )
            return session === undefined
              ? <View key={member.id} style={styles.subagentRow} accessibilityLabel={`${role} ${active?.subject ?? ''} ${stateLabel}`}>
                {row}
                <View style={{ width: 15 }} />
              </View>
              : <Pressable
                key={member.id}
                accessibilityRole="button"
                accessibilityLabel={`${role} ${active?.subject ?? ''} ${stateLabel}`}
                onPress={() => onOpen(session)}
                style={({ pressed }) => [styles.subagentRow, pressed && styles.resendRowPressed]}
              >
                {row}
                <ChevronRight size={15} color={colors.subtle} />
              </Pressable>
          })}
        </ScrollView>
      </SimpleModalSurface>
    </Modal>
  )
}

const createCardStyles = (colors: ThemeColors) =>
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
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      minHeight: 48,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    rowPressed: {
      backgroundColor: colors.surfaceStrong,
    },
    glyphWrap: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    rowCopy: {
      flex: 1,
      gap: 2,
    },
    rowTitleLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    rowRole: {
      ...typography.smallStrong,
      color: colors.ink,
      flexShrink: 1,
    },
    rowTask: {
      ...typography.small,
      color: colors.muted,
      lineHeight: 18,
    },
    statusRunning: {
      ...typography.caption,
      color: colors.primary,
    },
    statusProvisioning: {
      ...typography.caption,
      color: colors.warning ?? '#F59E0B',
    },
    statusFailed: {
      ...typography.caption,
      color: colors.danger ?? '#EF4444',
    },
    statusIdle: {
      ...typography.caption,
      color: colors.muted,
    },
    errorText: {
      color: colors.danger ?? '#EF4444',
    },
  })