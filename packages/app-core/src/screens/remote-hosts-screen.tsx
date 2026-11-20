import { StyleSheet, Text, View } from 'react-native'
import { History } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import { strings } from '../locales/i18n'
import type { Messages } from '../locales/types'
import type { ConnectionPhase, RemoteDevice } from '../types'
import { deviceVersionSubtitle, platformIcon } from '../lib/device-display'
import { BlurHeaderFrame, GroupCard, GroupRow, Screen, SectionTitle, TopBar } from '../ui/components'
import { Toggle } from '../ui/toggle'
import { useResponsiveLayout } from '../ui/responsive'
import { spacing, type, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export interface RemoteHostsScreenProps {
  onBack: () => void
  onSelectDevice: (device: RemoteDevice) => void
  onOpenDeviceDetail: (device: RemoteDevice) => void
  onSignedOut: () => void
  autoConnectHost: boolean
  onToggleAutoConnectHost: (value: boolean) => void
}

/** Standalone remote-host management page; the existing DevicesScreen is untouched. */
export function RemoteHostsScreen({
  onBack,
  onSelectDevice,
  onOpenDeviceDetail,
  autoConnectHost,
  onToggleAutoConnectHost,
}: RemoteHostsScreenProps) {
  useAppStore(state => state.language)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connection = useAppStore(state => state.connection)
  const refreshing = useAppStore(state => state.refreshing)
  const refreshDevices = useAppStore(state => state.refreshDevices)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { contentMaxWidth, landscape } = useResponsiveLayout()

  const handlePressDevice = (device: RemoteDevice) => {
    const isCurrent = selectedDevice?.deviceId === device.deviceId
    const isConnected = isCurrent && connection.phase === 'connected'
    const canSwitch = device.trusted && device.online && !isConnected
    if (canSwitch) onSelectDevice(device)
    else onOpenDeviceDetail(device)
  }

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame
        header={
          <TopBar
            title={strings.remoteHosts.title}
            onBack={onBack}
            centered
          />
        }
      >
        <Screen refreshing={refreshing} onRefresh={() => void refreshDevices()}>
          <View style={[styles.contentColumn, landscape && { maxWidth: contentMaxWidth }]}>
            <SectionTitle>{strings.remoteHosts.sectionRemote}</SectionTitle>
            <GroupCard>
              {devices.length === 0
                ? <View style={styles.emptyBlock}>
                    <Text style={styles.emptyTitle}>{strings.devices.emptyTitle}</Text>
                    <Text style={styles.emptyBody}>{strings.devices.emptyBody}</Text>
                  </View>
                : devices.map((device, index) => {
                    const isCurrent = selectedDevice?.deviceId === device.deviceId
                    const isConnected = isCurrent && connection.phase === 'connected'
                    const Icon = platformIcon(device.platform)
                    const status = hostStatus(device, isCurrent, connection.phase, colors, strings)
                    return (
                      <GroupRow
                        key={device.deviceId}
                        first={index === 0}
                        icon={Icon}
                        label={device.name}
                        detail={deviceVersionSubtitle(device)}
                        selected={isConnected}
                        chevron
                        onPress={() => handlePressDevice(device)}
                        accessory={
                          <View style={styles.statusInline}>
                            <View style={[styles.statusDot, { backgroundColor: status.dot }]} />
                            <Text style={styles.statusText}>{status.label}</Text>
                          </View>
                        }
                      />
                    )
                  })}
            </GroupCard>
            <Text style={styles.singleHostNote}>{strings.remoteHosts.singleHostShortHint}</Text>

            <SectionTitle>{strings.remoteHosts.sectionStartup}</SectionTitle>
            <GroupCard>
              <GroupRow
                first
                icon={History}
                label={strings.remoteHosts.autoConnectTitle}
                detail={strings.remoteHosts.autoConnectDetail}
                chevron={false}
                accessory={
                  <Toggle
                    accessibilityLabel={strings.remoteHosts.autoConnectTitle}
                    value={autoConnectHost}
                    onValueChange={onToggleAutoConnectHost}
                    trackColor={{ false: colors.disabled, true: colors.primary }}
                    thumbColor={colors.white}
                  />
                }
              />
            </GroupCard>
          </View>
        </Screen>
      </BlurHeaderFrame>
    </View>
  )
}

interface HostStatus {
  dot: string
  label: string
}

function hostStatus(device: RemoteDevice, isCurrent: boolean, phase: ConnectionPhase, colors: ThemeColors, s: Messages): HostStatus {
  const connected = isCurrent && phase === 'connected'
  const connecting = isCurrent && (phase === 'connecting' || phase === 'reconnecting')
  if (connected) return { dot: colors.success, label: s.status.online }
  if (connecting) return { dot: colors.warning, label: s.status.waiting }
  if (device.online) return { dot: colors.success, label: s.status.online }
  return { dot: colors.disabled, label: s.status.offline }
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    contentColumn: { width: '100%', alignSelf: 'center' },
    singleHostNote: { ...type.caption, color: colors.muted, marginTop: spacing.xs, paddingHorizontal: spacing.md },
    statusInline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { ...type.caption, color: colors.muted },
    emptyBlock: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, gap: spacing.xs },
    emptyTitle: { ...type.bodyStrong, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.small, color: colors.muted, textAlign: 'center' },
  })
}
