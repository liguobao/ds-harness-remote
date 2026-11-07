import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { CalendarDays, MessageSquare, Search, X } from 'lucide-react-native'
import { strings } from '../../locales/i18n'
import type { BotState } from '../../services/bot-catalog'
import { useAppStore } from '../../state/store'
import { useBotTeamStore } from '../../state/bot-store'
import { GroupCard, GroupRow, IconButton } from '../../ui/components'
import { OfficialMenuIcons } from '../../ui/official-menu-icons'
import { useResponsiveLayout } from '../../ui/responsive'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ModalSurface } from '../chat/modal'
import { relativeTime } from '../chat/presentation'
import { buildReferenceChatGroups, type ReferenceChatCandidate } from './at-menu'
import { BotAvatar } from './avatar'

export function BotPlusMenuModal({
  visible,
  onClose,
  onReferenceChat,
  onOpenSchedules,
}: {
  visible: boolean
  onClose: () => void
  onReferenceChat: () => void
  onOpenSchedules?: () => void
}) {
  const styles = useThemedStyles(createStyles)
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <ModalSurface onClose={onClose}>
        <View style={styles.header}>
          <Text style={styles.title}>{strings.chat.moreActions}</Text>
          <IconButton label={strings.common.close} icon={X} onPress={onClose} />
        </View>
        <View style={styles.sheetBody}>
          <GroupCard>
            <GroupRow
              first
              icon={MessageSquare}
              label="引用对话"
              detail="将其他 Bot 对话或 DSH 会话作为上下文"
              onPress={() => {
                onClose()
                onReferenceChat()
              }}
            />
            {onOpenSchedules !== undefined && (
              <GroupRow
                icon={CalendarDays}
                label={strings.bots.schedules}
                detail={strings.bots.manage}
                onPress={() => {
                  onClose()
                  onOpenSchedules()
                }}
              />
            )}
          </GroupCard>
        </View>
      </ModalSurface>
    </Modal>
  )
}

export function ReferenceChatModal({
  visible,
  currentSessionId,
  currentBotId,
  botState: propBotState,
  onClose,
  onPick,
}: {
  visible: boolean
  currentSessionId?: string
  currentBotId?: string
  botState?: BotState
  onClose: () => void
  onPick: (mentionText: string, candidate: ReferenceChatCandidate) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { sheetMaxHeight } = useResponsiveLayout()
  const sessions = useAppStore(state => state.sessions)
  const workspaces = useAppStore(state => state.workspaces)
  const archivedSessionIds = useAppStore(state => state.archivedSessionIds)
  const storeBotState = useBotTeamStore(state => state.state)
  const refreshBotState = useBotTeamStore(state => state.refresh)
  const effectiveBotState = propBotState ?? storeBotState

  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!visible) {
      setQuery('')
      return
    }
    if (effectiveBotState === undefined) {
      void refreshBotState(false)
    }
  }, [visible, effectiveBotState, refreshBotState])

  const groups = useMemo(
    () =>
      buildReferenceChatGroups({
        state: effectiveBotState,
        sessions,
        workspaces,
        currentSessionId,
        currentBotId,
        archivedSessionIds,
        query,
      }),
    [effectiveBotState, sessions, workspaces, currentSessionId, currentBotId, archivedSessionIds, query],
  )

  const isEmpty = groups.bots.length === 0 && groups.conversations.length === 0

  const handleSelect = (item: ReferenceChatCandidate) => {
    void Haptics.selectionAsync().catch(() => undefined)
    onPick(item.mentionText, item)
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <ModalSurface onClose={onClose}>
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text style={styles.title}>引用对话</Text>
            <Text style={styles.subtitle}>选择一段其他 Bot 对话或 DSH 会话作为上下文</Text>
          </View>
          <IconButton label={strings.common.close} icon={X} onPress={onClose} />
        </View>

        <View style={styles.searchBar}>
          <Search size={16} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={strings.bots.search}
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.common.close}
              hitSlop={8}
              onPress={() => setQuery('')}
            >
              <X size={15} color={colors.muted} />
            </Pressable>
          )}
        </View>

        <ScrollView
          style={{ maxHeight: Math.max(240, sheetMaxHeight - 150) }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isEmpty && (
            <GroupCard>
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>{strings.mention.noMatches}</Text>
              </View>
            </GroupCard>
          )}

          {groups.bots.length > 0 && (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionHeading}>{strings.bots.title}</Text>
              <GroupCard>
                {groups.bots.map((item, index) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={item.mentionLabel}
                    onPress={() => handleSelect(item)}
                    style={({ pressed }) => [
                      styles.candidateRow,
                      index > 0 && styles.rowDivider,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    {item.bot ? (
                      <BotAvatar bot={item.bot} size={34} />
                    ) : (
                      <View style={styles.sessionIconWrap}>
                        <OfficialMenuIcons.referenceSession size={16} color={colors.primary} />
                      </View>
                    )}
                    <View style={styles.candidateBody}>
                      <View style={styles.candidateTitleRow}>
                        <Text numberOfLines={1} style={styles.candidateTitle}>
                          {item.mentionLabel}
                        </Text>
                        {item.updatedAt !== undefined && (
                          <Text style={styles.candidateTime}>{relativeTime(item.updatedAt)}</Text>
                        )}
                      </View>
                      {item.description !== undefined && (
                        <Text numberOfLines={1} style={styles.candidateDesc}>
                          {item.description}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </GroupCard>
            </View>
          )}

          {groups.conversations.length > 0 && (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionHeading}>{strings.mention.sessionSection}</Text>
              <GroupCard>
                {groups.conversations.map((item, index) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    onPress={() => handleSelect(item)}
                    style={({ pressed }) => [
                      styles.candidateRow,
                      index > 0 && styles.rowDivider,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <View style={styles.sessionIconWrap}>
                      <OfficialMenuIcons.referenceSession size={16} color={colors.primary} />
                    </View>
                    <View style={styles.candidateBody}>
                      <View style={styles.candidateTitleRow}>
                        <Text numberOfLines={1} style={styles.candidateTitle}>
                          {item.title}
                        </Text>
                        {item.updatedAt !== undefined && (
                          <Text style={styles.candidateTime}>{relativeTime(item.updatedAt)}</Text>
                        )}
                      </View>
                      {item.description !== undefined && (
                        <Text numberOfLines={1} style={styles.candidateDesc}>
                          {item.description}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </GroupCard>
            </View>
          )}
        </ScrollView>
      </ModalSurface>
    </Modal>
  )
}

export function ReferencedChatPills({
  items,
  onRemove,
}: {
  items: readonly ReferenceChatCandidate[]
  onRemove: (sessionId: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  if (items.length === 0) return null
  return (
    <View style={styles.pillsContainer}>
      <ScrollView
        horizontal
        style={styles.pillsScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsRow}
        keyboardShouldPersistTaps="handled"
      >
        {items.map(item => (
          <View key={item.sessionId} style={styles.referencePill}>
            {item.bot ? (
              <BotAvatar bot={item.bot} size={18} />
            ) : (
              <MessageSquare size={14} color={colors.primary} />
            )}
            <Text numberOfLines={1} style={styles.referencePillText}>
              引用：{item.mentionLabel}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${strings.common.delete} ${item.mentionLabel}`}
              hitSlop={8}
              onPress={() => onRemove(item.sessionId)}
              style={styles.referencePillRemove}
            >
              <X size={13} color={colors.primary} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingBottom: spacing.xs,
    },
    grow: { flex: 1, minWidth: 0 },
    title: {
      ...type.heading,
      fontSize: 18,
      fontWeight: '700',
      color: colors.ink,
    },
    subtitle: {
      ...type.caption,
      color: colors.muted,
      marginTop: 2,
    },
    sheetBody: {
      paddingBottom: spacing.md,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      height: 42,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      marginBottom: spacing.xs,
    },
    searchInput: {
      flex: 1,
      ...type.body,
      fontSize: 15,
      color: colors.ink,
      paddingVertical: 0,
    },
    scrollContent: {
      gap: spacing.sm,
      paddingBottom: spacing.lg,
    },
    sectionBlock: {
      gap: 6,
    },
    sectionHeading: {
      ...type.smallStrong,
      fontSize: 13,
      color: colors.muted,
      paddingHorizontal: spacing.xs,
    },
    candidateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      minHeight: 54,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    rowPressed: {
      backgroundColor: colors.surfaceStrong,
    },
    sessionIconWrap: {
      width: 34,
      height: 34,
      borderRadius: radius.md,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    candidateBody: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    candidateTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
    },
    candidateTitle: {
      ...type.bodyStrong,
      fontSize: 15,
      color: colors.ink,
      flex: 1,
    },
    candidateTime: {
      ...type.caption,
      color: colors.subtle,
    },
    candidateDesc: {
      ...type.caption,
      fontSize: 12.5,
      color: colors.muted,
    },
    emptyWrap: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    emptyText: {
      ...type.small,
      color: colors.muted,
    },
    pillsContainer: {
      flexGrow: 0,
      flexShrink: 0,
    },
    pillsScroll: {
      flexGrow: 0,
    },
    pillsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 4,
      paddingTop: 2,
      paddingBottom: 2,
    },
    referencePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 260,
      paddingLeft: 10,
      paddingRight: 8,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primary,
    },
    referencePillText: {
      ...type.smallStrong,
      fontSize: 13,
      color: colors.primary,
      flexShrink: 1,
    },
    referencePillRemove: {
      padding: 2,
    },
  })
}
