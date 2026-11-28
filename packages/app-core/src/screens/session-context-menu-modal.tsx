import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { ArrowRightLeft } from 'lucide-react-native'
import { isAcpManagedBackend } from '../lib/workspace-key'
import { strings } from '../locales/i18n'
import type { RemoteSession } from '../types'
import { OfficialMenuIcons } from '../ui/official-menu-icons'
import { floatingShadow, radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

type MenuPhase = 'unmounted' | 'open' | 'dismissing'

// Native `animationType="fade"` takes ~250-300ms on UIKit; cap wait time if
// the Modal never presented while still settling before `createModalActionQueue`'s 700ms fallback.
export const SESSION_CONTEXT_MENU_DISMISS_FALLBACK_MS = 500

interface RetainedMenuSnapshot {
  session: RemoteSession
  sessionTitle: string
  isPinned: boolean
  isArchived: boolean
  canHandoff: boolean
}

export interface SessionContextMenuModalProps {
  session: RemoteSession | null
  sessionTitle: string
  isPinned: boolean
  isArchived: boolean
  canHandoff: boolean
  onClose: () => void
  onDismiss?: () => void
  runAfterClose: (action: () => void) => void
  onTogglePin: (session: RemoteSession, wasPinned: boolean) => void
  onRename: (session: RemoteSession) => void
  onFork: (session: RemoteSession) => void
  onHandoff: (session: RemoteSession) => void
  onToggleArchive: (session: RemoteSession, wasArchived: boolean) => void
  onCopySessionId: (session: RemoteSession) => void
}

export function SessionContextMenuModal({
  session,
  sessionTitle,
  isPinned,
  isArchived,
  canHandoff,
  onClose,
  onDismiss,
  runAfterClose,
  onTogglePin,
  onRename,
  onFork,
  onHandoff,
  onToggleArchive,
  onCopySessionId,
}: SessionContextMenuModalProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const visible = session !== null
  const waitForNativeDismiss = Platform.OS === 'ios'
  const [phase, setPhase] = useState<MenuPhase>(() => (visible ? 'open' : 'unmounted'))
  const phaseRef = useRef<MenuPhase>(phase)
  phaseRef.current = phase
  const retainedRef = useRef<RetainedMenuSnapshot | null>(
    session !== null ? { session, sessionTitle, isPinned, isArchived, canHandoff } : null,
  )
  if (session !== null) {
    retainedRef.current = { session, sessionTitle, isPinned, isArchived, canHandoff }
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
    }, SESSION_CONTEXT_MENU_DISMISS_FALLBACK_MS)
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

  if (phase === 'unmounted' || (!visible && !waitForNativeDismiss) || retainedRef.current === null) {
    return null
  }

  const interactive = visible && phase === 'open'
  const snapshot = retainedRef.current
  const target = snapshot.session
  const menuBackend = target.backend ?? 'harness'
  const canUseHarnessActions = menuBackend === 'harness'
  const canPinSession = menuBackend === 'harness' || isAcpManagedBackend(menuBackend)

  return (
    <Modal
      transparent
      animationType="fade"
      visible={phase !== 'dismissing'}
      onRequestClose={() => {
        if (!interactive) return
        onClose()
      }}
      onDismiss={waitForNativeDismiss ? settleNativeDismiss : onDismiss}
      statusBarTranslucent
    >
      <Pressable
        style={styles.menuBackdrop}
        disabled={!interactive}
        pointerEvents={interactive ? 'auto' : 'none'}
        onPress={() => {
          if (!interactive) return
          onClose()
        }}
      >
        <View style={styles.contextMenuCard} onStartShouldSetResponder={() => true}>
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle} numberOfLines={1}>
              {snapshot.sessionTitle}
            </Text>
          </View>

          {canPinSession && (
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel={snapshot.isPinned ? strings.sessions.unpinSession : strings.sessions.pinSession}
              disabled={!interactive}
              style={({ pressed }) => [styles.menuItem, pressed && interactive && styles.pressedBg]}
              onPress={() => {
                if (!interactive) return
                const wasPinned = snapshot.isPinned
                runAfterClose(() => onTogglePin(target, wasPinned))
              }}
            >
              {snapshot.isPinned ? (
                <OfficialMenuIcons.pinFill size={16} color={colors.ink} />
              ) : (
                <OfficialMenuIcons.pin size={16} color={colors.ink} />
              )}
              <Text style={styles.menuItemText}>
                {snapshot.isPinned ? strings.sessions.unpinSession : strings.sessions.pinSession}
              </Text>
            </Pressable>
          )}

          {canUseHarnessActions && (
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel={strings.sessions.renameSession}
              disabled={!interactive}
              style={({ pressed }) => [styles.menuItem, pressed && interactive && styles.pressedBg]}
              onPress={() => {
                if (!interactive) return
                runAfterClose(() => onRename(target))
              }}
            >
              <OfficialMenuIcons.edit size={16} color={colors.ink} />
              <Text style={styles.menuItemText}>{strings.sessions.renameSession}</Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel={strings.sessions.forkSession}
            disabled={!interactive}
            style={({ pressed }) => [styles.menuItem, pressed && interactive && styles.pressedBg]}
            onPress={() => {
              if (!interactive) return
              runAfterClose(() => onFork(target))
            }}
          >
            <OfficialMenuIcons.fork size={16} color={colors.ink} />
            <Text style={styles.menuItemText}>{strings.sessions.forkSession}</Text>
          </Pressable>

          {snapshot.canHandoff && (
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel={strings.handoff.action}
              disabled={!interactive}
              style={({ pressed }) => [styles.menuItem, pressed && interactive && styles.pressedBg]}
              onPress={() => {
                if (!interactive) return
                runAfterClose(() => onHandoff(target))
              }}
            >
              <ArrowRightLeft size={16} color={colors.ink} />
              <Text style={styles.menuItemText}>{strings.handoff.action}</Text>
            </Pressable>
          )}

          {canUseHarnessActions && (
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel={snapshot.isArchived ? strings.sessions.unarchiveSession : strings.sessions.archiveSession}
              disabled={!interactive}
              style={({ pressed }) => [styles.menuItem, pressed && interactive && styles.pressedBg]}
              onPress={() => {
                if (!interactive) return
                const wasArchived = snapshot.isArchived
                runAfterClose(() => onToggleArchive(target, wasArchived))
              }}
            >
              {snapshot.isArchived ? (
                <OfficialMenuIcons.unarchive size={16} color={colors.ink} />
              ) : (
                <OfficialMenuIcons.archive size={16} color={colors.ink} />
              )}
              <Text style={styles.menuItemText}>
                {snapshot.isArchived ? strings.sessions.unarchiveSession : strings.sessions.archiveSession}
              </Text>
            </Pressable>
          )}

          {/* 复制 Session ID 对所有会话可用 */}
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel={strings.sessions.copySessionId}
            disabled={!interactive}
            style={({ pressed }) => [styles.menuItem, pressed && interactive && styles.pressedBg]}
            onPress={() => {
              if (!interactive) return
              runAfterClose(() => onCopySessionId(target))
            }}
          >
            <OfficialMenuIcons.copy size={16} color={colors.ink} />
            <Text style={styles.menuItemText}>{strings.sessions.copySessionId}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  )
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    pressedBg: { backgroundColor: colors.surfaceStrong },
    menuBackdrop: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.md,
    },
    contextMenuCard: {
      width: '80%',
      maxWidth: 280,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      paddingVertical: spacing.xs,
      ...floatingShadow(colors, 'high'),
    },
    menuHeader: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      marginBottom: spacing.xxs,
    },
    menuTitle: {
      ...type.caption,
      fontWeight: '600',
      color: colors.muted,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    menuItemText: {
      ...type.body,
      color: colors.ink,
      flex: 1,
    },
  })
