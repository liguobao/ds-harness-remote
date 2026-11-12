import { X } from 'lucide-react-native'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings } from '../../locales/i18n'
import { useAppStore } from '../../state/store'
import type { RemoteSession, WorkspaceView } from '../../types'
import { IconButton, KeyValue, SectionTitle } from '../../ui/components'
import { spacing, type } from '../../ui/theme'
import type { ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { DeviceConnectionInfo } from '../device-screens'
import { usePickerListMaxHeight } from './modal'
import { SheetModal } from '../../ui/sheet'
import { sessionTitle } from './presentation'

export function SessionInfo({ visible, session, workspace, onClose, onOpenWorkspace }: {
  visible: boolean
  session: RemoteSession
  workspace?: WorkspaceView
  onClose: () => void
  onOpenWorkspace: () => void
}) {
  const device = useAppStore(state => state.selectedDevice)
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const maxHeight = usePickerListMaxHeight()
  const backend = workspace?.backend ?? session.backend ?? 'harness'

  return <SheetModal visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>{strings.sessionInfo.title}</Text>
        <IconButton label={strings.common.close} icon={X} onPress={onClose} />
      </View>
      <ScrollView style={{ flexShrink: 1, maxHeight }} contentContainerStyle={{ paddingBottom: insets.bottom }}>
        <Text selectable style={styles.sessionTitle}>{sessionTitle(session)}</Text>
        <SectionTitle>{strings.sessionInfo.workspaceInfo}</SectionTitle>
        <KeyValue label={strings.workspaces.title} value={workspace?.title ?? strings.chat.workspaceNone} onPress={onOpenWorkspace} />
        <KeyValue label={strings.sessionInfo.host} value={device?.name ?? strings.common.unavailable} />
        <KeyValue label={strings.workspaces.type} value={strings.workspaces[backend === 'harness' ? 'dsh' : backend]} />
        <KeyValue label={strings.sessionInfo.workspaceDirectory} value={workspace?.path ?? strings.common.unavailable} mono />
        {session.cwd !== undefined && session.cwd !== workspace?.path && <KeyValue label={strings.sessionInfo.sessionDirectory} value={session.cwd} mono />}
        {workspace !== undefined && <KeyValue label={strings.devices.conversations} value={workspace.sessionIds.length.toLocaleString()} />}
        <DeviceConnectionInfo deviceId={device?.deviceId} />
      </ScrollView>
  </SheetModal>
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...type.heading, color: colors.ink, flex: 1 },
  sessionTitle: { ...type.bodyStrong, color: colors.ink },
})
