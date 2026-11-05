import { useEffect } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, SlidersHorizontal, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import { strings } from '../locales/i18n'
import type { Messages } from '../locales/types'
import type { ConnectionPhase, RemoteDevice } from '../types'
import { platformIcon, switcherDeviceSubtitle } from '../lib/device-display'
import { GroupCard, GroupRow, IconButton } from '../ui/components'
import { useResponsiveLayout } from '../ui/responsive'
import { radius, spacing, type, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export interface HostSwitcherSheetProps {
  visible: boolean
  onClose: () => void
  onSelectDevice: (device: RemoteDevice) => void
  onManageHosts: () => void
}

/**
 * Bottom half-sheet that only lists remote Hosts. The dismiss target and the
 * sheet are siblings so Android's responder negotiation cannot swallow taps
 * on rows or the close button.
 */
export function HostSwitcherSheet({ visible, onClose, onSelectDevice, onManageHosts }: HostSwitcherSheetProps) {
  useAppStore(state => state.language)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connection = useAppStore(state => state.connection)
  const refreshDevices = useAppStore(state => state.refreshDevices)
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.common.close}
          pointerEvents="box-only"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View
          style={[styles.sheet, { maxHeight: sheetMaxHeight, paddingBottom: spacing.xxl + insets.bottom }]}
          pointerEvents="box-none"
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{strings.remoteHosts.switchTitle}</Text>
            <IconButton label={strings.common.close} icon={X} onPress={onClose} />
          </View>
          <ScrollView
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
                    const PlatformIcon = platformIcon(device.platform)
                    const status = hostStatus(device, isCurrent, connection.phase, colors, strings)
                    return (
                      <Pressable
                        key={device.deviceId}
                        accessibilityRole="button"
                        accessibilityLabel={device.name}
                        accessibilityState={{ selected: isCurrent }}
                        onPress={() => {
                          if (isConnected) onClose()
                          else onSelectDevice(device)
                        }}
                        style={({ pressed }) => [
                          styles.deviceRow,
                          index > 0 && styles.deviceRowDivider,
                          pressed && styles.deviceRowPressed,
                        ]}
                      >
                        <View style={styles.deviceGlyph}>
                          <PlatformIcon size={21} color={isConnected ? colors.primary : colors.ink} strokeWidth={1.8} />
                        </View>
                        <View style={styles.deviceRowCopy}>
                          <Text style={[styles.deviceRowName, isConnected && styles.deviceRowNameConnected]} numberOfLines={1}>
                            {device.name}
                          </Text>
                          <Text style={styles.deviceRowSubtitle} numberOfLines={1}>
                            {switcherDeviceSubtitle(device, strings.remoteHosts.remoteTag)}
                          </Text>
                        </View>
                        <View style={styles.statusRow}>
                          <View style={[styles.statusDot, { backgroundColor: status.dot }]} />
                          <Text style={styles.statusText}>{status.label}</Text>
                        </View>
                        {isCurrent && <Check size={18} color={colors.primary} strokeWidth={2.2} />}
                      </Pressable>
                    )
                  })}
            </GroupCard>
            <Text style={styles.hint}>{strings.remoteHosts.singleHostHint}</Text>
          </ScrollView>
          <GroupCard>
            <GroupRow
              first
              icon={SlidersHorizontal}
              label={strings.remoteHosts.manageAction}
              chevron
              onPress={onManageHosts}
            />
          </GroupCard>
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
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.subtle, opacity: 0.45, alignSelf: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    title: { ...type.heading, fontSize: 18, fontWeight: '700', color: colors.ink, flex: 1 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { gap: spacing.md },
    hint: { ...type.caption, color: colors.muted },
    deviceRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    deviceRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    deviceRowPressed: { backgroundColor: colors.surfaceStrong },
    deviceGlyph: { width: 24, alignItems: 'center', justifyContent: 'center' },
    deviceRowCopy: { flex: 1, minWidth: 0, gap: 3 },
    deviceRowName: { ...type.bodyStrong, color: colors.ink },
    deviceRowNameConnected: { color: colors.primary },
    deviceRowSubtitle: { ...type.small, color: colors.muted },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusText: { ...type.caption, color: colors.muted },
    emptyState: { paddingVertical: spacing.xl, paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.xs },
    emptyTitle: { ...type.bodyStrong, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.small, color: colors.muted, textAlign: 'center' },
  })
}
