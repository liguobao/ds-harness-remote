import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, RefreshCw, SlidersHorizontal, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import { remoteHostVisibilityStrings, strings } from '../locales/i18n'
import type { Messages } from '../locales/types'
import type { ConnectionPhase, RemoteDevice } from '../types'
import { ConnectionScreen } from './device-screens'
import { platformIcon, platformName } from '../lib/device-display'
import { hostListScope, isHostHidden, useBrowseMemory } from '../services/browse-memory'
import { ErrorBanner, GroupCard, GroupRow, IconButton } from '../ui/components'
import { useResponsiveLayout } from '../ui/responsive'
import { radius, spacing, type, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { SheetModal } from '../ui/sheet'

const EMPTY_HIDDEN_HOSTS: readonly string[] = []

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
  const config = useAppStore(state => state.config)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connection = useAppStore(state => state.connection)
  const refreshing = useAppStore(state => state.refreshing)
  const refreshDevices = useAppStore(state => state.refreshDevices)
  const error = useAppStore(state => state.error)
  const clearError = useAppStore(state => state.clearError)
  const hiddenHosts = useBrowseMemory(state => state.hiddenHosts)
  const scope = hostListScope(config)
  const hiddenIds = scope ? (hiddenHosts[scope] ?? EMPTY_HIDDEN_HOSTS) : EMPTY_HIDDEN_HOSTS
  const visibleDevices = devices.filter(device => !isHostHidden(device, hiddenIds, selectedDevice?.deviceId))
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
  const { sheetMaxHeight, sheetAsDialog } = useResponsiveLayout()
  const insets = useSafeAreaInsets()

  // Opening the sheet quietly refreshes presence so the status dots are current.
  useEffect(() => {
    if (!visible) return
    if (useAppStore.getState().refreshing) return
    void refreshDevices()
  }, [visible, refreshDevices])

  return (
    <SheetModal
      visible={visible}
      onClose={dismiss}
      backdropStyle={styles.backdrop}
      sheetStyle={[
        styles.sheet,
        sheetAsDialog ? { paddingTop: spacing.lg, paddingBottom: spacing.lg } : undefined,
      ]}
    >
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
          ) : <View style={styles.listViewport}>
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
                  : visibleDevices.length === 0
                    ? <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>{remoteHostVisibilityStrings.allHiddenTitle}</Text>
                        <Text style={styles.emptyBody}>{remoteHostVisibilityStrings.allHiddenManageBody}</Text>
                      </View>
                    : visibleDevices.map((device, index) => {
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
                            detail={`${strings.remoteHosts.remoteTag} · ${platformName(device.platform)}`}
                            selected={isConnected}
                            chevron={false}
                            accessibilityLabel={[device.name, status.label, device.harnessVersion].filter(Boolean).join(', ')}
                            disabled={busy}
                            onPress={() => {
                              if (isConnected) onClose()
                              else if (device.trusted && device.online) setChosenDevice(device)
                              else onSelectDevice(device)
                            }}
                            accessory={
                              <View style={styles.trailingGroup}>
                                <View style={styles.statusLine}>
                                  <View style={[styles.statusDot, { backgroundColor: status.dot }]} />
                                  <Text numberOfLines={1} style={[styles.statusText, isConnected && { color: colors.primary }]}>{status.label}</Text>
                                  <View style={styles.checkSlot}>
                                    {isConnected ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : null}
                                  </View>
                                </View>
                                {device.harnessVersion ? <Text numberOfLines={1} style={styles.version}>{device.harnessVersion}</Text> : null}
                              </View>
                            }
                          />
                        )
                      })}
              </GroupCard>
              <Text style={styles.hint}>{strings.remoteHosts.singleHostHint}</Text>
            </ScrollView>
          </View>}
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
    </SheetModal>
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
      // Rows and the footer own their horizontal insets; the sheet itself has
      // never added any, so keep the shared surface's padding out of the way.
      paddingHorizontal: 0,
      paddingTop: 0,
      gap: spacing.md,
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, paddingHorizontal: spacing.lg },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    title: { ...type.heading, fontSize: 18, fontWeight: '700', color: colors.ink, flex: 1 },
    // Match GroupCard at the viewport edge when the list is taller than the sheet.
    listViewport: { flexShrink: 1, marginHorizontal: spacing.lg, borderRadius: radius.xl, overflow: 'hidden' },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { gap: spacing.md },
    hint: { ...type.caption, color: colors.muted, paddingHorizontal: spacing.md },
    trailingGroup: { alignItems: 'flex-end', maxWidth: '48%' },
    statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { ...type.caption, color: colors.muted, flexShrink: 1 },
    version: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'right', fontVariant: ['tabular-nums'] },
    checkSlot: { width: 20, alignItems: 'center', justifyContent: 'center' },
    bottomCard: { paddingHorizontal: spacing.lg },
    emptyState: { paddingVertical: spacing.xl, paddingHorizontal: spacing.md, alignItems: 'center', gap: spacing.xs },
    emptyTitle: { ...type.bodyStrong, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.small, color: colors.muted, textAlign: 'center' },
  })
}
