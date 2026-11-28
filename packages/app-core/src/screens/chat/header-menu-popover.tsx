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
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderCog,
  FolderPlus,
  Info,
  ListTree,
  MessageSquare,
  Pin,
  PinOff,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings } from '../../locales/i18n'
import type { WorkspaceView } from '../../types'
import { continuousRadius } from '../../ui/platform-style'
import { floatingShadow, spacing } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useReduceMotion } from '../../ui/use-reduce-motion'
import { useThemedStyles } from '../../ui/use-themed-styles'

export type HeaderPopoverView = 'menu' | 'workspace-from-menu' | 'workspace-standalone'

type PopoverPhase = 'unmounted' | 'open' | 'dismissing'

// `animationType="none"` dismisses on UIKit in 1-2 frames; this caps wait time if
// the native Modal never presented (e.g. closed before attaching to a window).
export const CHAT_HEADER_POPOVER_DISMISS_FALLBACK_MS = 180

interface MenuRowItem {
  key: string
  icon: LucideIcon
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
  const [phase, setPhase] = useState<PopoverPhase>(() => (visible ? 'open' : 'unmounted'))
  const phaseRef = useRef<PopoverPhase>(phase)
  phaseRef.current = phase
  const retainedViewRef = useRef<HeaderPopoverView>(view ?? 'menu')
  const retainedTitleRef = useRef<string>(sessionTitle)
  if (view !== null) {
    retainedViewRef.current = view
    retainedTitleRef.current = sessionTitle
  }
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const settleNativeDismiss = useCallback(() => {
    if (phaseRef.current !== 'dismissing') return
    phaseRef.current = 'unmounted'
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
    setPhase(current => (current === 'dismissing' ? 'unmounted' : current))
    onDismissRef.current?.()
  }, [])

  useEffect(() => {
    if (visible) {
      // Wait for an in-flight native iOS Modal dismissal to settle through
      // `unmounted` before re-opening so UIKit never receives a concurrent present.
      if (phase === 'dismissing') return
      if (phase !== 'open') setPhase('open')
      return
    }
    if (phase === 'open') {
      if (waitForNativeDismiss) {
        setPhase('dismissing')
      } else {
        setPhase('unmounted')
        onDismissRef.current?.()
      }
    }
  }, [visible, phase, waitForNativeDismiss])

  useEffect(() => {
    if (phase !== 'dismissing' || phaseRef.current !== 'dismissing') return
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
    }
    const timer = setTimeout(() => {
      if (dismissTimerRef.current === timer) {
        dismissTimerRef.current = undefined
      }
      settleNativeDismiss()
    }, CHAT_HEADER_POPOVER_DISMISS_FALLBACK_MS)
    dismissTimerRef.current = timer
    return () => {
      clearTimeout(timer)
      if (dismissTimerRef.current === timer) {
        dismissTimerRef.current = undefined
      }
    }
  }, [phase, settleNativeDismiss])

  useEffect(() => () => {
    phaseRef.current = 'unmounted'
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = undefined
    }
  }, [])

  useEffect(() => {
    if (phase !== 'open' || !visible) {
      anim.stopAnimation()
      anim.setValue(0)
      return
    }
    if (reduceMotion) {
      anim.stopAnimation()
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
  }, [anim, phase, reduceMotion, visible])

  if (phase === 'unmounted' || (!visible && !waitForNativeDismiss)) return null

  const interactive = visible && phase === 'open'
  const activeView = view ?? retainedViewRef.current
  const displayTitle = visible ? sessionTitle : retainedTitleRef.current
  const cardWidth = Math.min(288, Math.max(228, windowWidth - spacing.md * 2))
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] })
  const isWorkspaceView = activeView === 'workspace-from-menu' || activeView === 'workspace-standalone'
  const filteredWorkspaces = workspaces.filter(
    workspace => (workspace.backend ?? 'harness') === (sessionBackend ?? 'harness'),
  )

  const menuRows: MenuRowItem[] = [
    {
      key: 'add-to-workspace',
      icon: FolderPlus,
      label: strings.chat.addToWorkspace,
      trailingChevron: true,
      onPress: () => onChangeView('workspace-from-menu'),
    },
    {
      key: 'search-in-chat',
      icon: Search,
      label: strings.chat.searchInChat,
      disabled: !canSearch,
      onPress: () => runAfterClose(onSearchInChat),
    },
  ]
  if (canPin) {
    menuRows.push({
      key: 'pin',
      icon: isPinned ? PinOff : Pin,
      label: isPinned ? strings.sessions.unpinSession : strings.sessions.pinSession,
      disabled: !connected || busy !== undefined,
      onPress: () => runAfterClose(onTogglePin),
    })
  }
  menuRows.push({
    key: 'trajectory',
    icon: trajectory ? MessageSquare : ListTree,
    label: trajectory ? strings.trajectory.close : strings.trajectory.open,
    onPress: () => runAfterClose(onToggleTrajectory),
  })
  if (canHandoff) {
    menuRows.push({
      key: 'handoff',
      icon: ArrowRightLeft,
      label: strings.handoff.action,
      onPress: () => runAfterClose(onHandoff),
    })
  }
  menuRows.push({
    key: 'session-info',
    icon: Info,
    label: strings.sessionInfo.title,
    onPress: () => runAfterClose(onOpenSessionInfo),
  })
  if (canArchive) {
    menuRows.push({
      key: 'archive',
      icon: archived ? ArchiveRestore : Archive,
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
      visible={phase !== 'dismissing'}
      animationType="none"
      onRequestClose={() => {
        if (!interactive) return
        if (activeView === 'workspace-from-menu') onChangeView('menu')
        else onChangeView(null)
      }}
      onDismiss={waitForNativeDismiss ? settleNativeDismiss : onDismiss}
      statusBarTranslucent
    >
      {phase === 'dismissing' ? null : (
      <View style={styles.overlay} pointerEvents={interactive ? 'auto' : 'none'}>
        <Pressable
          style={StyleSheet.absoluteFill}
          disabled={!interactive}
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
                  {displayTitle}
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
                  const rowDisabled = Boolean(row.disabled) || !interactive
                  return (
                    <View key={row.key}>
                      {row.dividerBefore && <View style={styles.divider} />}
                      <Pressable
                        accessibilityRole="menuitem"
                        accessibilityLabel={row.accessibilityLabel ?? row.label}
                        accessibilityState={{ disabled: rowDisabled }}
                        disabled={rowDisabled}
                        onPress={row.onPress}
                        style={({ pressed }) => [
                          styles.row,
                          pressed && !rowDisabled && styles.rowPressed,
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
                          <ChevronRight size={17} color={colors.muted} strokeWidth={1.9} />
                        )}
                      </Pressable>
                    </View>
                  )
                })}
              </ScrollView>
            </>
          ) : (
            <>
              <View style={styles.subviewHeader}>
                {activeView === 'workspace-from-menu' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.common.back}
                    disabled={!interactive}
                    hitSlop={8}
                    onPress={() => onChangeView('menu')}
                    style={({ pressed }) => [styles.headerIconBtn, pressed && interactive && styles.rowPressed]}
                  >
                    <ChevronLeft size={19} color={colors.ink} strokeWidth={2} />
                  </Pressable>
                )}
                <Text numberOfLines={1} style={styles.subviewTitle}>
                  {activeView === 'workspace-from-menu' ? strings.chat.addToWorkspace : strings.chat.selectWorkspace}
                </Text>
                {activeView === 'workspace-standalone' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.common.close}
                    disabled={!interactive}
                    hitSlop={8}
                    onPress={() => onChangeView(null)}
                    style={({ pressed }) => [styles.headerIconBtn, pressed && interactive && styles.rowPressed]}
                  >
                    <X size={17} color={colors.muted} strokeWidth={2} />
                  </Pressable>
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
                    const disabled = busy !== undefined || !interactive
                    const displayTitleText = workspace.title?.trim() || workspace.path
                    const showPath = workspace.path.length > 0 && workspace.path !== displayTitleText
                    return (
                      <Pressable
                        key={workspace.workspaceId}
                        accessibilityRole="menuitem"
                        accessibilityLabel={displayTitleText}
                        accessibilityState={{ selected: isCurrent, disabled }}
                        disabled={disabled}
                        onPress={() => runAfterClose(() => onPickWorkspace(workspace))}
                        style={({ pressed }) => [
                          styles.wsRow,
                          isCurrent && styles.wsRowSelected,
                          pressed && !disabled && styles.rowPressed,
                          busy !== undefined && styles.rowDisabled,
                        ]}
                      >
                        <Folder
                          size={18}
                          color={isCurrent ? colors.primary : colors.muted}
                          strokeWidth={1.9}
                        />
                        <View style={styles.wsCopy}>
                          <Text
                            numberOfLines={1}
                            ellipsizeMode={showPath ? 'tail' : 'middle'}
                            style={[styles.wsTitle, isCurrent && styles.wsTitleSelected]}
                          >
                            {displayTitleText}
                          </Text>
                          {showPath && (
                            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.wsPath}>
                              {workspace.path}
                            </Text>
                          )}
                        </View>
                        {isCurrent && <Check size={17} color={colors.primary} strokeWidth={2.2} />}
                      </Pressable>
                    )
                  })
                )}
              </ScrollView>
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="menuitem"
                accessibilityLabel={strings.chat.manageWorkspaces}
                disabled={!interactive}
                onPress={() => runAfterClose(onManageWorkspaces)}
                style={({ pressed }) => [styles.row, pressed && interactive && styles.rowPressed]}
              >
                <FolderCog size={19} color={colors.ink} strokeWidth={1.9} />
                <Text numberOfLines={1} style={styles.rowLabel}>
                  {strings.chat.manageWorkspaces}
                </Text>
              </Pressable>
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
      backgroundColor: colors.primarySoft,
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
      color: colors.primary,
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
