import { useEffect, useState } from 'react'
import { ArrowRightLeft, ChevronDown, ChevronUp, Folder, Wifi, X } from 'lucide-react-native'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { harnessDisplayName, type SessionHandoffOrigin } from '../../lib/handoff-preview'
import { strings } from '../../locales/i18n'
import { useAppStore } from '../../state/store'
import type { RemoteSession, WorkspaceView } from '../../types'
import { GroupCard, GroupRow, IconButton, StatusBadge } from '../../ui/components'
import { monoFontFamily } from '../../ui/platform-style'
import { spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { DeviceConnectionInfo } from '../device-screens'
import { usePickerListMaxHeight } from './modal'
import { SheetModal } from '../../ui/sheet'
import { sessionTitle } from './presentation'

export function SessionInfo({
  visible,
  session,
  workspace,
  handoffOrigin,
  onClose,
  onDismiss,
  runAfterClose,
  onOpenWorkspace,
  onOpenSession,
}: {
  visible: boolean
  session: RemoteSession
  workspace?: WorkspaceView
  handoffOrigin?: SessionHandoffOrigin
  onClose: () => void
  onDismiss?: () => void
  runAfterClose?: (action: () => void) => void
  onOpenWorkspace: () => void
  onOpenSession?: (session: RemoteSession) => void
}) {
  const { colors } = useTheme()
  const device = useAppStore(state => state.selectedDevice)
  const sessions = useAppStore(state => state.sessions)
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const maxHeight = usePickerListMaxHeight()
  const [networkExpanded, setNetworkExpanded] = useState(false)
  const backend = workspace?.backend ?? session.backend ?? 'harness'
  const backendLabel = (strings.workspaces as Record<string, unknown>)[backend === 'harness' ? 'dsh' : backend] as string ?? backend
  const summaryMeta = [
    workspace?.title ?? strings.chat.workspaceNone,
    backendLabel,
    device?.name,
  ].filter(Boolean).join(' · ')

  const originSession = handoffOrigin?.sourceSessionId !== undefined
    && handoffOrigin.sourceSessionId !== session.sessionId
    ? sessions.find(item => item.sessionId === handoffOrigin.sourceSessionId)
    : undefined
  const handoffDirection = handoffOrigin !== undefined
    ? `${harnessDisplayName(handoffOrigin.sourceBackend)} → ${harnessDisplayName(handoffOrigin.targetBackend ?? backend)}`
    : undefined
  const handoffSourceTitle = handoffOrigin?.sourceTitle
    ?? (originSession !== undefined ? sessionTitle(originSession) : undefined)

  useEffect(() => {
    if (!visible) setNetworkExpanded(false)
  }, [visible, session.sessionId])

  const runAction = (action: () => void) => {
    if (runAfterClose !== undefined) runAfterClose(action)
    else {
      onClose()
      action()
    }
  }

  return <SheetModal visible={visible} onClose={onClose} onDismiss={onDismiss}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>{strings.sessionInfo.title}</Text>
        <IconButton label={strings.common.close} icon={X} dense onPress={onClose} />
      </View>
      <ScrollView
        style={{ flexShrink: 1, maxHeight }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}
      >
        <View style={styles.summary}>
          <View style={styles.summaryTitleRow}>
            <Text selectable style={styles.sessionTitle}>{sessionTitle(session, handoffOrigin)}</Text>
            {session.running && <StatusBadge status="running" />}
          </View>
          <Text style={styles.summaryMeta} numberOfLines={2}>{summaryMeta}</Text>
          {workspace?.path !== undefined && (
            <Text selectable style={styles.summaryPath} numberOfLines={2}>{workspace.path}</Text>
          )}
          {session.cwd !== undefined && session.cwd !== workspace?.path && (
            <Text selectable style={styles.summaryPath} numberOfLines={2}>{session.cwd}</Text>
          )}
        </View>

        {handoffDirection !== undefined && (
          <GroupCard>
            <GroupRow
              first
              icon={ArrowRightLeft}
              label={strings.handoff.title}
              value={handoffDirection}
              detail={handoffSourceTitle !== undefined ? strings.handoff.originSessionDetail(handoffSourceTitle) : undefined}
              accessibilityLabel={originSession !== undefined && onOpenSession !== undefined
                ? strings.handoff.continueInOrigin(harnessDisplayName(originSession.backend ?? 'harness'))
                : strings.handoff.title}
              onPress={originSession !== undefined && onOpenSession !== undefined
                ? () => runAction(() => onOpenSession(originSession))
                : undefined}
            />
          </GroupCard>
        )}

        <GroupCard>
          <GroupRow
            first
            icon={Folder}
            label={strings.workspaces.title}
            value={workspace?.title ?? strings.chat.workspaceNone}
            onPress={() => runAction(onOpenWorkspace)}
          />
        </GroupCard>

        <GroupCard>
          <GroupRow
            first
            icon={Wifi}
            label={strings.devices.networkDetails}
            value={device?.name}
            chevron={false}
            accessory={networkExpanded
              ? <ChevronUp size={18} color={colors.muted} />
              : <ChevronDown size={18} color={colors.muted} />}
            onPress={() => setNetworkExpanded(value => !value)}
          />
          {networkExpanded && (
            <View style={styles.networkDetails}>
              <DeviceConnectionInfo deviceId={device?.deviceId} />
            </View>
          )}
        </GroupCard>
      </ScrollView>
  </SheetModal>
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...type.heading, color: colors.ink, flex: 1 },
  content: { gap: spacing.md },
  summary: { gap: 4, paddingHorizontal: spacing.xxs },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  sessionTitle: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
  summaryMeta: { ...type.small, color: colors.muted },
  summaryPath: { ...type.caption, fontFamily: monoFontFamily, color: colors.subtle },
  networkDetails: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
})
