import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight, Eye, EyeOff, History } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import { remoteHostVisibilityStrings, strings } from '../locales/i18n'
import type { Messages } from '../locales/types'
import type { ConnectionPhase, RemoteDevice } from '../types'
import { deviceVersionSubtitle, platformIcon } from '../lib/device-display'
import { hideOfflineHost, hostListScope, isHostHidden, unhideOfflineHost, useBrowseMemory } from '../services/browse-memory'
import { BlurHeaderFrame, GroupCard, GroupRow, IconButton, Screen, SectionTitle, TopBar } from '../ui/components'
import { Toggle } from '../ui/toggle'
import { useResponsiveLayout } from '../ui/responsive'
import { spacing, type, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

const EMPTY_HIDDEN_HOSTS: readonly string[] = []

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
  const config = useAppStore(state => state.config)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connection = useAppStore(state => state.connection)
  const refreshing = useAppStore(state => state.refreshing)
  const refreshDevices = useAppStore(state => state.refreshDevices)
  const hiddenHosts = useBrowseMemory(state => state.hiddenHosts)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { contentMaxWidth, landscape } = useResponsiveLayout()

  const scope = hostListScope(config)
  const hiddenIds = scope ? (hiddenHosts[scope] ?? EMPTY_HIDDEN_HOSTS) : EMPTY_HIDDEN_HOSTS
  const visibleDevices = devices.filter(device => !isHostHidden(device, hiddenIds, selectedDevice?.deviceId))
  const hiddenDevices = devices.filter(device => isHostHidden(device, hiddenIds, selectedDevice?.deviceId))

  const handlePressDevice = (device: RemoteDevice) => {
    const isCurrent = selectedDevice?.deviceId === device.deviceId
    const isConnected = isCurrent && connection.phase === 'connected'
    const canSwitch = device.trusted && device.online && !isConnected
    if (canSwitch) onSelectDevice(device)
    else onOpenDeviceDetail(device)
  }

  const renderHostRow = (device: RemoteDevice, index: number, hidden: boolean) => {
    const isCurrent = selectedDevice?.deviceId === device.deviceId
    const isConnected = isCurrent && connection.phase === 'connected'
    const canHideLocally = Boolean(scope) && !device.online && !isCurrent
    const Icon = platformIcon(device.platform)
    const status = hostStatus(device, isCurrent, connection.phase, colors, strings)

    if (!canHideLocally) {
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
    }

    return (
      <View key={device.deviceId}>
        {index > 0 && <View style={styles.rowSeparator} />}
        <View style={styles.hostRow}>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={[device.name, deviceVersionSubtitle(device), status.label].filter(Boolean).join(', ')}
            onPress={() => handlePressDevice(device)}
            style={({ pressed }) => [styles.hostMain, pressed && styles.hostMainPressed]}
          >
            <View style={styles.iconSlot}>
              <Icon size={21} color={isConnected ? colors.primary : colors.ink} strokeWidth={1.8} />
            </View>
            <View style={styles.labelColumn}>
              <Text
                numberOfLines={1}
                style={[styles.hostLabel, isConnected && { color: colors.primary }]}
              >
                {device.name}
              </Text>
              <Text numberOfLines={1} style={styles.hostDetail}>
                {deviceVersionSubtitle(device)}
              </Text>
            </View>
            <View style={styles.statusInline}>
              <View style={[styles.statusDot, { backgroundColor: status.dot }]} />
              <Text style={styles.statusText}>{status.label}</Text>
            </View>
            <ChevronRight size={19} color={colors.subtle} />
          </Pressable>
          <View style={styles.hostActions}>
            <IconButton
              dense
              label={hidden ? remoteHostVisibilityStrings.unhideOffline : remoteHostVisibilityStrings.hideOffline}
              icon={hidden ? Eye : EyeOff}
              tint={colors.muted}
              onPress={() => {
                if (hidden) unhideOfflineHost(scope, device.deviceId)
                else hideOfflineHost(scope, device.deviceId)
              }}
            />
          </View>
        </View>
      </View>
    )
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
                : visibleDevices.length === 0
                  ? <View style={styles.emptyBlock}>
                      <Text style={styles.emptyTitle}>{remoteHostVisibilityStrings.allHiddenTitle}</Text>
                      <Text style={styles.emptyBody}>{remoteHostVisibilityStrings.allHiddenSectionBody}</Text>
                    </View>
                  : visibleDevices.map((device, index) => renderHostRow(device, index, false))}
            </GroupCard>
            <Text style={styles.singleHostNote}>{strings.remoteHosts.singleHostShortHint}</Text>

            {hiddenDevices.length > 0 && (
              <>
                <SectionTitle>{remoteHostVisibilityStrings.hiddenSection(hiddenDevices.length)}</SectionTitle>
                <GroupCard>
                  {hiddenDevices.map((device, index) => renderHostRow(device, index, true))}
                </GroupCard>
                <Text style={styles.singleHostNote}>{remoteHostVisibilityStrings.hiddenHint}</Text>
              </>
            )}

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
    rowSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.md + 28 + spacing.sm },
    hostRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
    hostMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
      paddingVertical: 13,
      minHeight: 54,
    },
    hostMainPressed: { opacity: 0.72 },
    iconSlot: { width: 28, alignItems: 'center', justifyContent: 'center' },
    labelColumn: { flex: 1, gap: 2 },
    hostLabel: { ...type.bodyStrong, color: colors.ink },
    hostDetail: { ...type.small, color: colors.muted },
    hostActions: { flexDirection: 'row', alignItems: 'center' },
    statusInline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { ...type.caption, color: colors.muted },
    emptyBlock: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, gap: spacing.xs },
    emptyTitle: { ...type.bodyStrong, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.small, color: colors.muted, textAlign: 'center' },
  })
}
