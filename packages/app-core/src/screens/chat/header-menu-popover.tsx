import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings } from '../../locales/i18n'
import type { WorkspaceView } from '../../types'
import type { UiIconComponent } from '../../ui/components'
import { DuotoneIcons, MotionPressable } from '../../ui/duotone-icons'
import { continuousRadius } from '../../ui/platform-style'
import { floatingShadow, spacing } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useReduceMotion } from '../../ui/use-reduce-motion'
import { useThemedStyles } from '../../ui/use-themed-styles'

export type HeaderPopoverView = 'menu' | 'workspace-from-menu' | 'workspace-standalone'

interface MenuRowItem {
  key: string
  icon: UiIconComponent
  label: string
  accessibilityLabel?: string
  trailingChevron?: boolean
  danger?: boolean
  disabled?: boolean
  dividerBefore?: boolean
  onPress: () => void
}

export interface ChatHeaderMenuPopoverProps {
  view: HeaderPopoverView | null
  onChangeView: (next: HeaderPopoverView | null) => void
  onDismiss?: () => void
  runAfterClose: (action: () => void) => void
  sessionTitle: string
  sessionId: string
  workspaces: readonly WorkspaceView[]
  sessionBackend?: WorkspaceView['backend']
  busy?: string
  connected: boolean
  canSearch: boolean
  canPin: boolean
  isPinned: boolean
  trajectory: boolean
  canHandoff: boolean
  canArchive: boolean
  archived: boolean
  onSearchInChat: () => void
  onTogglePin: () => void
  onToggleTrajectory: () => void
  onHandoff: () => void
  onOpenSessionInfo: () => void
  onToggleArchive: () => void
  onPickWorkspace: (workspace: WorkspaceView) => void
  onManageWorkspaces: () => void
}

export function ChatHeaderMenuPopover({
  view,
  onChangeView,
  onDismiss,
  runAfterClose,
  sessionTitle,
  sessionId,
  workspaces,
  sessionBackend,
  busy,
  connected,
  canSearch,
  canPin,
  isPinned,
  trajectory,
  canHandoff,
  canArchive,
  archived,
  onSearchInChat,
  onTogglePin,
  onToggleTrajectory,
  onHandoff,
  onOpenSessionInfo,
  onToggleArchive,
  onPickWorkspace,
  onManageWorkspaces,
}: ChatHeaderMenuPopoverProps) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const { colors, scheme } = useTheme()
  const reduceMotion = useReduceMotion()
  const styles = useThemedStyles(createStyles)
  const anim = useRef(new Animated.Value(0)).current
  const visible = view !== null
  const waitForNativeDismiss = Platform.OS === 'ios'
  const [dismissing, setDismissing] = useState(false)
  const dismissingRef = useRef(false)
  const prevVisibleRef = useRef(visible)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const settleNativeDismiss = useCallback(() => {
    if (!dismissingRef.current) return
    dismissingRef.current = false
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
    setDismissing(false)
    onDismissRef.current?.()
  }, [])

  useEffect(() => {
    const wasVisible = prevVisibleRef.current
    prevVisibleRef.current = visible
    if (visible) {
      if (dismissTimerRef.current !== undefined) {
        clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = undefined
      }
      dismissingRef.current = false
      setDismissing(false)
      return
    }
    if (wasVisible && waitForNativeDismiss) {
      dismissingRef.current = true
      setDismissing(true)
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = undefined
        settleNativeDismiss()
      }, 180)
    }
  }, [visible, waitForNativeDismiss, settleNativeDismiss])

  useEffect(() => () => {
    dismissingRef.current = false
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
  }, [])

  useEffect(() => {
    if (!visible) {
      anim.setValue(0)
      return
    }
    if (reduceMotion) {
      anim.setValue(1)
      return
    }
    anim.setValue(0)
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [anim, reduceMotion, visible])

  const showDismissHost = !visible && waitForNativeDismiss && (dismissing || prevVisibleRef.current)
  if (!visible && !showDismissHost) return null

  const cardWidth = Math.min(288, Math.max(228, windowWidth - spacing.md * 2))
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] })
  const isWorkspaceView = view === 'workspace-from-menu' || view === 'workspace-standalone'
  const filteredWorkspaces = workspaces.filter(
    workspace => (workspace.backend ?? 'harness') === (sessionBackend ?? 'harness'),
  )

  const menuRows: MenuRowItem[] = [
    {
      key: 'add-to-workspace',
      icon: DuotoneIcons.FolderPlus,
      label: strings.chat.addToWorkspace,
      trailingChevron: true,
      onPress: () => onChangeView('workspace-from-menu'),
    },
    {
      key: 'search-in-chat',
      icon: DuotoneIcons.Search,
      label: strings.chat.searchInChat,
      disabled: !canSearch,
      onPress: () => runAfterClose(onSearchInChat),
    },
  ]
  if (canPin) {
    menuRows.push({
      key: 'pin',
      icon: isPinned ? DuotoneIcons.PinOff : DuotoneIcons.Pin,
      label: isPinned ? strings.sessions.unpinSession : strings.sessions.pinSession,
      disabled: !connected || busy !== undefined,
      onPress: () => runAfterClose(onTogglePin),
    })
  }
  menuRows.push({
    key: 'trajectory',
    icon: trajectory ? DuotoneIcons.MessageSquare : DuotoneIcons.ListTree,
    label: trajectory ? strings.trajectory.close : strings.trajectory.open,
    onPress: () => runAfterClose(onToggleTrajectory),
  })
  if (canHandoff) {
    menuRows.push({
      key: 'handoff',
      icon: DuotoneIcons.ArrowRightLeft,
      label: strings.handoff.action,
      onPress: () => runAfterClose(onHandoff),
    })
  }
  menuRows.push({
    key: 'session-info',
    icon: DuotoneIcons.Info,
    label: strings.sessionInfo.title,
    onPress: () => runAfterClose(onOpenSessionInfo),
  })
  if (canArchive) {
    menuRows.push({
      key: 'archive',
      icon: archived ? DuotoneIcons.ArchiveRestore : DuotoneIcons.Archive,
      label: archived ? strings.sessions.unarchiveSession : strings.sessions.archiveSession,
      danger: !archived,
      disabled: !connected || busy !== undefined,
      dividerBefore: true,
      onPress: () => runAfterClose(onToggleArchive),
    })
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={() => {
        if (!visible) return
        if (view === 'workspace-from-menu') onChangeView('menu')
        else onChangeView(null)
      }}
      onDismiss={waitForNativeDismiss ? settleNativeDismiss : onDismiss}
      statusBarTranslucent
    >
      {!visible ? null : (
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => onChangeView(null)}
          accessibilityRole="button"
          accessibilityLabel={strings.common.close}
        />
        <Animated.View
          style={[
            styles.card,
            scheme === 'light' ? styles.cardLight : styles.cardDark,
            {
              top: insets.top + 54,
              right: spacing.md,
              width: cardWidth,
              opacity: anim,
              transform: [{ scale }],
            },
          ]}
        >
          {!isWorkspaceView ? (
            <>
              <View style={styles.captionWrap}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.captionText}>
                  {sessionTitle}
                </Text>
              </View>
              <View style={styles.divider} />
              <ScrollView
                style={{ maxHeight: Math.min(460, windowHeight * 0.65) }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {menuRows.map(row => {
                  const Icon = row.icon
                  const iconColor = row.danger ? colors.danger : colors.ink
                  return (
                    <View key={row.key}>
                      {row.dividerBefore && <View style={styles.divider} />}
                      <MotionPressable
                        accessibilityRole="menuitem"
                        accessibilityLabel={row.accessibilityLabel ?? row.label}
                        accessibilityState={{ disabled: row.disabled }}
                        disabled={row.disabled}
                        onPress={row.onPress}
                        scaleTo={0.98}
                        surfaceColor={colors.elevated}
                        style={({ pressed }) => [
                          styles.row,
                          pressed && !row.disabled && styles.rowPressed,
                          row.disabled && styles.rowDisabled,
                        ]}
                      >
                        <Icon size={19} color={iconColor} strokeWidth={1.9} />
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={[styles.rowLabel, row.danger && styles.rowLabelDanger]}
                        >
                          {row.label}
                        </Text>
                        {row.trailingChevron && (
                          <DuotoneIcons.ChevronRight size={17} color={colors.muted} strokeWidth={1.9} />
                        )}
                      </MotionPressable>
                    </View>
                  )
                })}
              </ScrollView>
            </>
          ) : (
            <>
              <View style={styles.subviewHeader}>
                {view === 'workspace-from-menu' && (
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.common.back}
                    hitSlop={8}
                    scaleTo={0.92}
                    surfaceColor={colors.elevated}
                    onPress={() => onChangeView('menu')}
                    style={({ pressed }) => [styles.headerIconBtn, pressed && styles.rowPressed]}
                  >
                    <DuotoneIcons.ChevronLeft size={19} color={colors.ink} strokeWidth={2} />
                  </MotionPressable>
                )}
                <Text numberOfLines={1} style={styles.subviewTitle}>
                  {view === 'workspace-from-menu' ? strings.chat.addToWorkspace : strings.chat.selectWorkspace}
                </Text>
                {view === 'workspace-standalone' && (
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.common.close}
                    hitSlop={8}
                    scaleTo={0.92}
                    surfaceColor={colors.elevated}
                    onPress={() => onChangeView(null)}
                    style={({ pressed }) => [styles.headerIconBtn, pressed && styles.rowPressed]}
                  >
                    <DuotoneIcons.X size={17} color={colors.muted} strokeWidth={2} />
                  </MotionPressable>
                )}
              </View>
              <View style={styles.divider} />
              <ScrollView
                style={{ maxHeight: Math.min(340, windowHeight * 0.48) }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {filteredWorkspaces.length === 0 ? (
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyTitle}>{strings.chat.workspacePickerEmptyTitle}</Text>
                    <Text style={styles.emptyBody}>{strings.chat.workspacePickerEmptyBody}</Text>
                  </View>
                ) : (
                  filteredWorkspaces.map(workspace => {
                    const isCurrent = workspace.sessionIds.includes(sessionId)
                    const disabled = busy !== undefined
                    const displayTitle = workspace.title?.trim() || workspace.path
                    const showPath = workspace.path.length > 0 && workspace.path !== displayTitle
                    return (
                      <MotionPressable
                        key={workspace.workspaceId}
                        accessibilityRole="menuitem"
                        accessibilityLabel={displayTitle}
                        accessibilityState={{ selected: isCurrent, disabled }}
                        disabled={disabled}
                        scaleTo={0.98}
                        surfaceColor={isCurrent ? colors.surfaceStrong : colors.elevated}
                        onPress={() => runAfterClose(() => onPickWorkspace(workspace))}
                        style={({ pressed }) => [
                          styles.wsRow,
                          isCurrent && styles.wsRowSelected,
                          pressed && !disabled && styles.rowPressed,
                          disabled && styles.rowDisabled,
                        ]}
                      >
                        <DuotoneIcons.Folder
                          size={18}
                          color={isCurrent ? colors.ink : colors.muted}
                          strokeWidth={1.9}
                        />
                        <View style={styles.wsCopy}>
                          <Text
                            numberOfLines={1}
                            ellipsizeMode={showPath ? 'tail' : 'middle'}
                            style={[styles.wsTitle, isCurrent && styles.wsTitleSelected]}
                          >
                            {displayTitle}
                          </Text>
                          {showPath && (
                            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.wsPath}>
                              {workspace.path}
                            </Text>
                          )}
                        </View>
                        {isCurrent && <DuotoneIcons.Check size={17} color={colors.ink} strokeWidth={2.2} />}
                      </MotionPressable>
                    )
                  })
                )}
              </ScrollView>
              <View style={styles.divider} />
              <MotionPressable
                accessibilityRole="menuitem"
                accessibilityLabel={strings.chat.manageWorkspaces}
                scaleTo={0.98}
                surfaceColor={colors.elevated}
                onPress={() => runAfterClose(onManageWorkspaces)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <DuotoneIcons.FolderCog size={19} color={colors.ink} strokeWidth={1.9} />
                <Text numberOfLines={1} style={styles.rowLabel}>
                  {strings.chat.manageWorkspaces}
                </Text>
              </MotionPressable>
            </>
          )}
        </Animated.View>
      </View>
      )}
    </Modal>
  )
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
    },
    card: {
      position: 'absolute',
      ...continuousRadius(24),
      paddingVertical: 8,
      paddingHorizontal: 6,
      ...floatingShadow(colors),
      shadowOpacity: 0.14,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    cardLight: {
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(0, 0, 0, 0.06)',
    },
    cardDark: {
      backgroundColor: colors.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    captionWrap: {
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 10,
    },
    captionText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginHorizontal: 8,
      marginVertical: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 46,
      paddingHorizontal: 14,
      paddingVertical: 8,
      ...continuousRadius(16),
    },
    rowPressed: {
      backgroundColor: colors.surfaceStrong,
    },
    rowDisabled: {
      opacity: 0.4,
    },
    rowLabel: {
      flex: 1,
      fontSize: 16,
      fontWeight: '400',
      color: colors.ink,
    },
    rowLabelDanger: {
      color: colors.danger,
    },
    subviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 40,
      paddingHorizontal: 8,
      paddingBottom: 4,
    },
    headerIconBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subviewTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.ink,
      paddingHorizontal: 4,
    },
    wsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 50,
      paddingHorizontal: 12,
      paddingVertical: 8,
      ...continuousRadius(16),
    },
    wsRowSelected: {
      backgroundColor: colors.surfaceStrong,
    },
    wsCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    wsTitle: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.ink,
    },
    wsTitleSelected: {
      color: colors.ink,
      fontWeight: '600',
    },
    wsPath: {
      fontSize: 12,
      color: colors.muted,
    },
    emptyWrap: {
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 4,
    },
    emptyTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.ink,
    },
    emptyBody: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
  })
