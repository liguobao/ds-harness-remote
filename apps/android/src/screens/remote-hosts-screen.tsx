import { Alert, ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Globe, History, RefreshCw, UserRound } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import { strings } from '../locales/i18n'
import type { Messages } from '../locales/types'
import type { ConnectionPhase, RemoteDevice } from '../types'
import { deviceVersionSubtitle, loginMethodDisplayLabel, platformIcon, serverHostLabel } from '../lib/device-display'
import { BlurHeaderFrame, GroupCard, GroupRow, Screen, SectionTitle, TopBar } from '../ui/components'
import { Toggle } from '../ui/toggle'
import { useResponsiveLayout } from '../ui/responsive'
import { radius, spacing, type, type ThemeColors } from '../ui/theme'
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
  onSignedOut,
  autoConnectHost,
  onToggleAutoConnectHost,
}: RemoteHostsScreenProps) {
  useAppStore(state => state.language)
  const config = useAppStore(state => state.config)
  const account = useAppStore(state => state.account)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connection = useAppStore(state => state.connection)
  const refreshing = useAppStore(state => state.refreshing)
  const refreshDevices = useAppStore(state => state.refreshDevices)
  const signOut = useAppStore(state => state.signOut)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { contentMaxWidth, landscape } = useResponsiveLayout()

  const serverHost = serverHostLabel(config?.baseUrl)
  const rawAccount = (account ?? config?.account ?? '').trim()
  const displayAccount = rawAccount
    ? (rawAccount.length > 20 && !rawAccount.includes('@')
        ? `${rawAccount.slice(0, 8)}…${rawAccount.slice(-6)}`
        : rawAccount)
    : (serverHost || strings.settings.notSignedIn)
  const accountSubtitle = [
    loginMethodDisplayLabel(config?.loginMethod, strings),
    serverHost,
  ].filter(Boolean).join(' · ')

  const handlePressDevice = (device: RemoteDevice) => {
    const isCurrent = selectedDevice?.deviceId === device.deviceId
    const isConnected = isCurrent && connection.phase === 'connected'
    const canSwitch = device.trusted && device.online && !isConnected
    if (canSwitch) onSelectDevice(device)
    else onOpenDeviceDetail(device)
  }

  const confirmSignOut = () => Alert.alert(
    strings.settings.signOutTitle,
    strings.settings.signOutBody,
    [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: strings.settings.signOut,
        style: 'destructive',
        onPress: () => { void (async () => { await signOut(); onSignedOut() })() },
      },
    ],
  )

  const handleOpenWebConsole = async () => {
    if (!config?.baseUrl) return
    try {
      await Linking.openURL(config.baseUrl)
    } catch {
      Alert.alert(strings.settings.linkFailedTitle, strings.settings.linkFailedBody)
    }
  }

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame
        header={
          <TopBar
            title={strings.remoteHosts.title}
            subtitle={strings.remoteHosts.subtitle}
            onBack={onBack}
            centered
          />
        }
      >
        <Screen refreshing={refreshing} onRefresh={() => void refreshDevices()}>
          <View style={[styles.contentColumn, landscape && { maxWidth: contentMaxWidth }]}>
            <SectionTitle>{strings.remoteHosts.sectionRemote}</SectionTitle>
            <GroupCard>
              <GroupRow
                first
                icon={UserRound}
                label={displayAccount}
                detail={accountSubtitle}
                chevron={false}
                accessory={
                  <View style={styles.accountActions}>
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel={strings.common.refresh}
                      accessibilityState={{ disabled: refreshing }}
                      disabled={refreshing}
                      onPress={() => void refreshDevices()}
                      style={({ pressed }) => [styles.refreshButton, pressed && styles.iconButtonPressed, refreshing && styles.disabled]}
                    >
                      {refreshing
                        ? <ActivityIndicator size='small' color={colors.primary} />
                        : <RefreshCw size={17} color={colors.muted} strokeWidth={1.9} />}
                    </Pressable>
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel={strings.remoteHosts.signOutShort}
                      onPress={confirmSignOut}
                      style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
                    >
                      <Text style={styles.signOutText}>{strings.remoteHosts.signOutShort}</Text>
                    </Pressable>
                  </View>
                }
              />

              {devices.length === 0
                ? <View style={[styles.emptyBlock, styles.divider]}>
                    <Text style={styles.emptyTitle}>{strings.devices.emptyTitle}</Text>
                    <Text style={styles.emptyBody}>{strings.devices.emptyBody}</Text>
                  </View>
                : devices.map(device => {
                    const isCurrent = selectedDevice?.deviceId === device.deviceId
                    const isConnected = isCurrent && connection.phase === 'connected'
                    const Icon = platformIcon(device.platform)
                    const status = hostStatus(device, isCurrent, connection.phase, colors, strings)
                    return (
                      <GroupRow
                        key={device.deviceId}
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

            <SectionTitle>{strings.remoteHosts.sectionOther}</SectionTitle>
            <GroupCard>
              <GroupRow
                first
                icon={Globe}
                label={strings.remoteHosts.webConsole}
                detail={serverHost || undefined}
                onPress={() => void handleOpenWebConsole()}
              />
            </GroupCard>

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
    accountActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    refreshButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceStrong },
    iconButtonPressed: { opacity: 0.6 },
    signOutButton: { minHeight: 32, paddingHorizontal: spacing.sm, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator },
    signOutButtonPressed: { backgroundColor: colors.surfaceStrong },
    signOutText: { ...type.smallStrong, color: colors.muted },
    disabled: { opacity: 0.5 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    statusInline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { ...type.caption, color: colors.muted },
    emptyBlock: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, gap: spacing.xs },
    emptyTitle: { ...type.bodyStrong, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.small, color: colors.muted, textAlign: 'center' },
  })
}
