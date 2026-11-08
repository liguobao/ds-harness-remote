import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, RefreshCw, SlidersHorizontal, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import { strings } from '../locales/i18n'
import type { Messages } from '../locales/types'
import type { ConnectionPhase, RemoteDevice } from '../types'
import { ConnectionScreen } from './device-screens'
import { platformIcon, switcherDeviceSubtitle } from '../lib/device-display'
import { ErrorBanner, GroupCard, GroupRow, IconButton } from '../ui/components'
import { useResponsiveLayout } from '../ui/responsive'
import { radius, spacing, type, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export interface HostSwitcherSheetProps {
  visible: boolean
  initialConnectingDevice?: RemoteDevice | undefined
  onClose: () => void
  onSelectDevice: (device: RemoteDevice) => void
  onManageHosts: () => void
  onConnected: () => void
}

/**
 * Bottom half-sheet that only lists remote Hosts. The dismiss target and the
 * sheet are siblings so Android's responder negotiation cannot swallow taps
 * on rows or the close button. Every row is a `GroupRow`, so the icon column,
 * the label start, the inset separators and the right edge match the cards
 * used elsewhere, and the trailing status text lands on one baseline.
 */
export function HostSwitcherSheet({ visible, onClose, onSelectDevice, onManageHosts, onConnected, initialConnectingDevice }: HostSwitcherSheetProps) {
  useAppStore(state => state.language)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connection = useAppStore(state => state.connection)
  const refreshing = useAppStore(state => state.refreshing)
  const refreshDevices = useAppStore(state => state.refreshDevices)
  const error = useAppStore(state => state.error)
  const clearError = useAppStore(state => state.clearError)
  const [chosenDevice, setChosenDevice] = useState<RemoteDevice>()
  const connectingDevice = chosenDevice ?? initialConnectingDevice
  const busy = connectingDevice !== undefined
  const dismiss = () => {
    setChosenDevice(undefined)
    onClose()
  }
  useEffect(() => {
    if (!visible) setChosenDevice(undefined)
  }, [visible])
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { sheetMaxHeight } = useResponsiveLayout()
  const insets = useSafeAreaInsets()

  // Opening the sheet quietly refreshes presence so the status dots are current.
  useEffect(() => {
    if (!visible) return
    if (useAppStore.getState().refreshing) return
    void refreshDevices()
  }, [visible, refreshDevices])

  return (
    <Modal visible={visible} transparent animationType='fade' onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.backdrop} pointerEvents='box-none'>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={strings.common.close}
          pointerEvents='box-only'
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
        />
        <View
          style={[styles.sheet, { maxHeight: sheetMaxHeight, paddingBottom: spacing.xxl + insets.bottom }]}
          pointerEvents='box-none'
        >
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <Text style={styles.title} numberOfLines={1}>{strings.remoteHosts.switchTitle}</Text>
            <View style={styles.headerActions}>
              {refreshing
                ? <ActivityIndicator size='small' color={colors.primary} style={{ marginHorizontal: 8 }} />
                : <IconButton label={strings.common.refresh} icon={RefreshCw} disabled={busy} onPress={() => void refreshDevices()} />}
              <IconButton label={strings.common.close} icon={X} onPress={dismiss} />
            </View>
          </View>
          {error !== undefined && connectingDevice === undefined && (
            <ErrorBanner
              message={error}
              onRetry={() => void refreshDevices()}
              onDismiss={clearError}
            />
          )}
          {connectingDevice !== undefined ? (
            <View style={{ height: Math.min(560, sheetMaxHeight - 110 - insets.bottom) }}>
              <ConnectionScreen
                embedded
                device={connectingDevice}
                onBack={() => {
                  setChosenDevice(undefined)
                  if (initialConnectingDevice !== undefined) onClose()
                }}
                onConnected={() => {
                  setChosenDevice(undefined)
                  onConnected()
                }}
              />
            </View>
          ) : <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <GroupCard>
              {devices.length === 0
                ? <View style={styles.emptyState}>
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
                        detail={switcherDeviceSubtitle(device, strings.remoteHosts.remoteTag)}
                        selected={isConnected}
                        chevron={false}
                        accessibilityLabel={device.name}
                        disabled={busy}
                        onPress={() => {
                          if (isConnected) onClose()
                          else if (device.trusted && device.online) setChosenDevice(device)
                          else onSelectDevice(device)
                        }}
                        accessory={
                          // The 20dp check slot is reserved on every row, so the
                          // online/offline text cannot drift between rows.
                          <View style={styles.trailingGroup}>
                            <View style={styles.statusRow}>
                              <View style={[styles.statusDot, { backgroundColor: status.dot }]} />
                              <Text style={[styles.statusText, isConnected && { color: colors.primary }]}>{status.label}</Text>
                            </View>
                            <View style={styles.checkSlot}>
                              {isConnected ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : null}
                            </View>
                          </View>
                        }
                      />
                    )
                  })}
            </GroupCard>
            <Text style={styles.hint}>{strings.remoteHosts.singleHostHint}</Text>
          </ScrollView>}
          {connectingDevice === undefined && <View style={styles.bottomCard}>
            <GroupCard>
              <GroupRow
                first
                icon={SlidersHorizontal}
                label={strings.remoteHosts.manageAction}
                onPress={onManageHosts}
                disabled={busy}
              />
            </GroupCard>
          </View>}
        </View>
      </View>
    </Modal>
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
    backdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
    sheet: {
      zIndex: 1,
      elevation: 1,
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      paddingTop: spacing.sm,
      gap: spacing.md,
    },
    grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.subtle, opacity: 0.45, alignSelf: 'center' },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, paddingHorizontal: spacing.lg },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    title: { ...type.heading, fontSize: 18, fontWeight: '700', color: colors.ink, flex: 1 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { gap: spacing.md, paddingHorizontal: spacing.lg },
    hint: { ...type.caption, color: colors.muted, paddingHorizontal: spacing.md },
    trailingGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { ...type.caption, color: colors.muted },
    checkSlot: { width: 20, alignItems: 'center', justifyContent: 'center' },
    bottomCard: { paddingHorizontal: spacing.lg },
    emptyState: { paddingVertical: spacing.xl, paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.xs },
    emptyTitle: { ...type.bodyStrong, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.small, color: colors.muted, textAlign: 'center' },
  })
}
