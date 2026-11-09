import { useEffect, useRef, useState } from 'react'
import { AnimatedEllipsis } from '../ui/animated-ellipsis'
import { ActivityIndicator, Alert, BackHandler, StyleSheet, Text, View } from 'react-native'
import { ArrowLeft, Check, ChevronRight, Laptop, MessageSquareText, Monitor, Pencil, Server, ShieldCheck, Trash2, type LucideIcon } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import type { ConnectionProbeTransport, ConnectionStage, RemoteDevice } from '../types'
import {
  BlurHeaderFrame,
  Button,
  GroupCard,
  GroupRow,
  IconButton,
  KeyValue,
  Screen,
  SectionTitle,
  TopBar,
} from '../ui/components'
import { floatingShadow, radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useResponsiveLayout } from '../ui/responsive'
import { useThemedStyles } from '../ui/use-themed-styles'
import { strings as zhCN } from '../locales/i18n'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DeviceRenameModal } from './device-rename-modal'
import { ConnectionHero } from './connection-hero'

function confirmDeviceUnbind(device: RemoteDevice): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const finish = (confirmed: boolean) => {
      if (settled) return
      settled = true
      resolve(confirmed)
    }
    Alert.alert(zhCN.devices.forgetTitle(device.name), zhCN.devices.forgetBody, [
      { text: zhCN.common.cancel, style: 'cancel', onPress: () => finish(false) },
      { text: zhCN.devices.forget, style: 'destructive', onPress: () => finish(true) },
    ], { cancelable: true, onDismiss: () => finish(false) })
  })
}

const SWIPE_ACTION_WIDTH = 96

/** Keep visible session lists honest: refresh execution status while mounted. */
export function useLiveSessionStatus(enabled = true): void {
  const phase = useAppStore(state => state.connection.phase)
  useEffect(() => {
    if (!enabled || phase !== 'connected') return
    void useAppStore.getState().refreshSessionStatus()
    const timer = setInterval(() => { void useAppStore.getState().refreshSessionStatus() }, 8_000)
    return () => clearInterval(timer)
  }, [phase, enabled])
}

const connectionStages = ['authenticating', 'transport', 'secure', 'loading'] as const satisfies readonly ConnectionStage[]
const CONNECTION_STUCK_MS = 3000

export function ConnectionScreen({ device, onBack, onConnected, embedded = false }: {
  device: RemoteDevice
  onBack: () => void
  onConnected: () => void
  embedded?: boolean
}) {
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connection = useAppStore(state => state.connection)
  const connectionStage = useAppStore(state => state.connectionStage)
  const connectionProbeOrder = useAppStore(state => state.connectionProbeOrder)
  const connect = useAppStore(state => state.connectDevice)
  const disconnect = useAppStore(state => state.disconnect)
  const clearError = useAppStore(state => state.clearError)
  const [attempt, setAttempt] = useState(0)
  const [stuck, setStuck] = useState(false)
  const launchedAttempt = useRef(-1)
  const completedAttempt = useRef(-1)
  const leaving = useRef(false)
  const onConnectedRef = useRef(onConnected)
  onConnectedRef.current = onConnected

  useEffect(() => () => {
    leaving.current = true
    if (embedded && launchedAttempt.current >= 0 && completedAttempt.current !== launchedAttempt.current) void disconnect()
  }, [disconnect, embedded])

  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { landscape, compactHeight } = useResponsiveLayout()
  // The hero is the first block of a ScrollView; a compact landscape window
  // wastes its scarce height on the old 40/32dp padding pair.
  const compactHero = landscape || compactHeight

  useEffect(() => {
    const current = useAppStore.getState()
    if (current.selectedDevice?.deviceId === device.deviceId && current.connection.phase === 'connected') {
      if (completedAttempt.current !== attempt) {
        completedAttempt.current = attempt
        onConnectedRef.current()
      }
      return
    }
    if (current.selectedDevice?.deviceId === device.deviceId
      && (current.connection.phase === 'connecting' || current.connection.phase === 'reconnecting')) return
    if (launchedAttempt.current === attempt) return
    launchedAttempt.current = attempt
    let active = true
    void connect(device).then(async connected => {
      if (!connected) return
      // Match the Plugin hand-off: let assistive technology and the visible
      // progress state announce completion before replacing this screen.
      await new Promise(resolve => setTimeout(resolve, 220))
      if (active && !leaving.current && completedAttempt.current !== attempt) {
        completedAttempt.current = attempt
        onConnectedRef.current()
      }
    })
    return () => { active = false }
  }, [attempt, connect, connection.phase, device, selectedDevice?.deviceId])

  const currentStage = connectionStage ?? 'authenticating'
  const selectedProbe = probeTransportForMode(connection.stats.mode)
  const currentIndex = currentStage === 'ready'
    ? connectionStages.length
    : Math.max(0, connectionStages.indexOf(currentStage))
  const failed = selectedDevice?.deviceId === device.deviceId
    && connection.phase === 'offline'
    && connection.error !== undefined
  const showBack = failed || stuck

  // Reveal cancel after a stage stalls, or immediately on failure.
  useEffect(() => {
    if (failed) {
      setStuck(true)
      return
    }
    if (currentStage === 'ready') {
      setStuck(false)
      return
    }
    setStuck(false)
    const timer = setTimeout(() => setStuck(true), CONNECTION_STUCK_MS)
    return () => clearTimeout(timer)
  }, [attempt, currentStage, failed])

  const cancel = () => {
    leaving.current = true
    void disconnect()
    onBack()
  }
  const cancelRef = useRef(cancel)
  cancelRef.current = cancel

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!showBack) return true
      cancelRef.current()
      return true
    })
    return () => subscription.remove()
  }, [showBack])

  const retry = () => {
    clearError()
    setAttempt(value => value + 1)
  }

  return (
    <View style={styles.flex}>
      {showBack && !embedded && (
        <View style={[styles.connectionBack, { top: insets.top + spacing.xs }]}>
          <IconButton label={zhCN.common.back} icon={ArrowLeft} onPress={cancel} />
        </View>
      )}
      <Screen fill>
        <View style={[styles.connectionHero, compactHero && styles.connectionHeroCompact, embedded && styles.connectionHeroEmbedded]}>
          {!embedded && <ConnectionHero
            secured={currentIndex > connectionStages.indexOf('secure')}
            ready={currentStage === 'ready'}
            failed={failed}
          />}
          <View style={styles.connectionHeading}>
            <View style={styles.connectionStatusLine}>
              <View style={[styles.connectionStatusDot, currentStage === 'ready' && styles.connectionStatusDotReady, failed && styles.connectionStatusDotFailed]} />
              <Text accessibilityLiveRegion="polite" style={[styles.connectionStatus, failed && styles.connectionStatusFailed]}>
                {failed ? zhCN.devices.connectionInterrupted : currentStage === 'ready' ? zhCN.devices.connectionReady : zhCN.devices.connecting}
                {currentStage !== 'ready' && !failed && <AnimatedEllipsis />}
              </Text>
            </View>
            <Text style={styles.connectionDeviceName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{device.name}</Text>
            <View style={styles.connectionVersions}>
              <View style={styles.versionItem}>
                <Text style={styles.versionLabel}>{zhCN.devices.harnessShort}</Text>
                <Text style={styles.versionValue} numberOfLines={1}>{device.harnessVersion ?? zhCN.devices.unknownVersion}</Text>
              </View>
              <View style={styles.versionItem}>
                <Text style={styles.versionLabel}>{zhCN.devices.pluginShort}</Text>
                <Text style={styles.versionValue} numberOfLines={1}>{device.clientVersion ?? zhCN.devices.unknownVersion}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.connectionSteps}>
          {connectionStages.map((stage, index) => {
            const done = index < currentIndex
            const active = index === currentIndex && !failed
            const stepFailed = index === currentIndex && failed
            const copy = zhCN.devices.connectionSteps[stage]
            return (
              <View key={stage} style={styles.connectionStep}>
                <View style={styles.stepMarker}>
                  <View style={[styles.stepCircle, done && styles.stepCircleComplete, active && styles.stepCircleActive, stepFailed && styles.stepCircleFailed]}>
                    {done
                      ? <Check size={18} color={colors.white} />
                      : active
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <View style={[styles.stepDot, stepFailed && styles.stepDotFailed]} />}
                  </View>
                  {index < connectionStages.length - 1 && <View style={[styles.stepConnector, done && styles.stepConnectorComplete]} />}
                </View>
                <View style={styles.stepCopy}>
                  <Text accessibilityLiveRegion={active ? 'polite' : 'none'} style={[styles.stepTitle, (active || done) && styles.stepTitleCurrent]}>{copy.title}</Text>
                  {(stage !== 'transport' || connectionProbeOrder.length === 0) && <Text style={styles.stepBody}>{copy.body}</Text>}
                  {stage === 'transport' && connectionProbeOrder.length > 0 && (
                    <View style={styles.progressRoute}>
                      {connectionProbeOrder.map((transport, probeIndex) => (
                        <View key={`${transport}:${probeIndex}`} style={styles.progressRouteSegment}>
                          {probeIndex > 0 && <ChevronRight size={12} color={colors.subtle} />}
                          <Text style={[styles.progressRouteLabel, selectedProbe === transport && styles.progressRouteLabelActive]}>
                            {probeTransportDiagnosticLabel(transport)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {stepFailed && connection.error !== undefined && <Text style={styles.stepBodyFailed}>{connection.error}</Text>}
                </View>
              </View>
            )
          })}
        </View>
        {failed && (
          <View style={styles.connectionError}>
            <Text style={styles.connectionErrorTitle}>{zhCN.devices.connectionInterrupted}</Text>
            <Text style={styles.connectionErrorBody}>{connection.error}</Text>
            <Button label={zhCN.devices.retryConnection} variant="secondary" onPress={retry} />
          </View>
        )}
        {embedded && showBack && <Button label={zhCN.common.back} variant="secondary" onPress={cancel} />}
        {!embedded && <View style={styles.connectionBottomSpace} />}
      </Screen>
    </View>
  )
}

export function DeviceDetailScreen({ device, onBack, onConnect, onWorkspaces }: {
  device: RemoteDevice
  onBack: () => void
  onConnect: () => void
  onWorkspaces?: () => void
}) {
  const selected = useAppStore(state => state.selectedDevice)
  const connection = useAppStore(state => state.connection)
  const descriptor = useAppStore(state => state.hostDescriptor)
  const workspaces = useAppStore(state => state.workspaces)
  const trust = useAppStore(state => state.trustDevice)
  const forgetDevice = useAppStore(state => state.forgetDevice)
  const forgetBusy = useAppStore(state => state.busyAction === `forget:${device.deviceId}`)
  const reconnect = useAppStore(state => state.reconnect)
  const [renaming, setRenaming] = useState(false)
  const isSelected = selected?.deviceId === device.deviceId
  const isConnected = isSelected && connection.phase === 'connected'

  const trustAndContinue = async () => {
    if (await trust(device) && device.online) onConnect()
  }
  const handleForgetDevice = async () => {
    if (!await confirmDeviceUnbind(device)) return
    if (await forgetDevice(device.deviceId)) onBack()
  }
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  // Read-only diagnostics stay a readable column on wide landscape displays.
  const { contentMaxWidth, landscape } = useResponsiveLayout()

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame header={<TopBar title={zhCN.devices.title} onBack={onBack} />}>
        <Screen>
          <View style={[styles.contentColumn, landscape && { maxWidth: contentMaxWidth }]}>
            <View style={styles.deviceHero}>
              <View style={styles.deviceIcon}>{(() => { const PlatformIcon = platformIcon(device.platform); return <PlatformIcon size={28} color={colors.primary} strokeWidth={1.8} /> })()}</View>
              <View style={styles.deviceHeroCopy}>
                <Text style={styles.deviceName}>{device.name}</Text>
                <IconButton label={`${zhCN.devices.rename} ${device.name}`} icon={Pencil} tint={colors.primary} dense onPress={() => setRenaming(true)} />
              </View>
              <Text style={styles.devicePlatform}>{platformName(device.platform)}</Text>
            </View>

            {connection.error !== undefined && isSelected && (
              <View style={styles.connectionError}>
                <Text style={styles.connectionErrorTitle}>{zhCN.devices.connectionInterrupted}</Text>
                <Text style={styles.connectionErrorBody}>{connection.error}</Text>
                <Button label={zhCN.common.retry} variant="secondary" onPress={() => void reconnect()} />
              </View>
            )}

            {!device.trusted
              ? <View style={styles.connectArea}>
                  <View style={styles.trustHeader}>
                    <View style={styles.trustIcon}><ShieldCheck size={22} color={colors.primary} /></View>
                    <View style={styles.trustCopy}>
                      <Text style={styles.connectCopy}>{zhCN.devices.trustExplanation}</Text>
                      {device.fingerprint !== undefined && <Text selectable style={styles.fingerprint}>{device.fingerprint}</Text>}
                    </View>
                  </View>
                  <Button label={zhCN.devices.trust} onPress={() => void trustAndContinue()} />
                </View>
              : !isConnected
                ? <View style={styles.connectArea}>
                    <Text style={styles.connectCopy}>{device.online ? zhCN.devices.connectReady : zhCN.devices.offlineHelp}</Text>
                    <Button label={zhCN.devices.secureConnect} onPress={onConnect} disabled={!device.online} />
                  </View>
                : <>
                    <SectionTitle>{zhCN.devices.info}</SectionTitle>
                    <View style={styles.group}>
                      <KeyValue label={zhCN.devices.harnessShort} value={descriptor?.version ?? device.harnessVersion ?? zhCN.devices.unknownVersion} />
                      <KeyValue label={zhCN.devices.plugin} value={device.clientVersion ?? zhCN.devices.unknownVersion} />
                      <KeyValue label={zhCN.devices.directory} value={descriptor?.cwd ?? zhCN.common.unavailable} mono />
                      {descriptor?.provider !== undefined && <KeyValue label={zhCN.devices.provider} value={descriptor.provider} />}
                      {descriptor?.model !== undefined && <KeyValue label={zhCN.devices.model} value={descriptor.model} />}
                      <View style={styles.contentCounts}>
                        <View style={styles.contentCount}><Text style={styles.contentCountValue}>{workspaces.length}</Text><Text style={styles.contentCountLabel}>{zhCN.devices.workspaces}</Text></View>
                        <View style={styles.contentCountDivider} />
                        <View style={styles.contentCount}><Text style={styles.contentCountValue}>{descriptor?.attachedSessions ?? 0}</Text><Text style={styles.contentCountLabel}>{zhCN.devices.conversations}</Text></View>
                      </View>
                    </View>

                    <DeviceConnectionInfo deviceId={device.deviceId} />

                    {onWorkspaces !== undefined && <View style={styles.primaryArea}><Button label={zhCN.devices.viewWorkspaces} icon={MessageSquareText} onPress={onWorkspaces} /></View>}
                  </>}

            <View style={styles.primaryArea}>
              <GroupCard>
                <GroupRow
                  first
                  icon={Trash2}
                  label={zhCN.devices.forget}
                  danger
                  chevron={false}
                  disabled={forgetBusy}
                  onPress={() => void handleForgetDevice()}
                />
              </GroupCard>
            </View>
          </View>
        </Screen>
      </BlurHeaderFrame>
      {renaming && <DeviceRenameModal device={device} onClose={() => setRenaming(false)} />}
    </View>
  )
}

/** Read-only diagnostics shared by Host details and conversation information. */
export function DeviceConnectionInfo({ deviceId }: { deviceId?: string }) {
  const selectedId = useAppStore(state => state.selectedDevice?.deviceId)
  const connection = useAppStore(state => state.connection)
  const connectionProbeOrder = useAppStore(state => state.connectionProbeOrder)
  const networkDetails = useAppStore(state => state.connectionNetworkDetails)
  const refreshNetworkDetails = useAppStore(state => state.refreshConnectionNetworkDetails)
  const styles = useThemedStyles(createStyles)
  const isConnected = deviceId !== undefined && selectedId === deviceId && connection.phase === 'connected'

  useEffect(() => {
    if (isConnected) void refreshNetworkDetails()
  }, [deviceId, isConnected, refreshNetworkDetails])

  if (!isConnected) return <>
    <SectionTitle>{zhCN.devices.secureConnection}</SectionTitle>
    <KeyValue label={zhCN.devices.path} value={zhCN.status.disconnected} />
  </>

  return <>
    <SectionTitle>{zhCN.devices.secureConnection}</SectionTitle>
    <View style={styles.group}>
      <KeyValue
        label={zhCN.devices.path}
        value={connectionPath(connection.stats.mode)}
      />
      {connectionProbeOrder.length > 0 && <KeyValue label={zhCN.devices.probeOrder} value={probeOrderText(connectionProbeOrder)} />}
      <KeyValue label={zhCN.devices.encryption} value="Noise IK · ChaCha20-Poly1305" />
    </View>

    <View style={styles.networkDetails}>
      <SectionTitle>{zhCN.devices.networkDetails}</SectionTitle>
      <View style={styles.group}>
        <KeyValue label={zhCN.devices.phoneEndpoint} value={networkDetails?.webRtc?.localAddress ?? zhCN.devices.relayEndpointUnavailable} mono={networkDetails?.webRtc?.localAddress !== undefined} />
        <KeyValue label={zhCN.devices.computerEndpoint} value={networkDetails?.webRtc?.remoteAddress ?? zhCN.devices.relayEndpointUnavailable} mono={networkDetails?.webRtc?.remoteAddress !== undefined} />
        {networkDetails !== undefined && <KeyValue label={zhCN.devices.connectionServer} value={controlServerName(networkDetails.controlChannelUrl)} mono />}
        {networkDetails?.webRtc?.protocol !== undefined && <KeyValue label={zhCN.devices.networkProtocol} value={protocolText(networkDetails.webRtc.protocol, networkDetails.webRtc.relayProtocol)} />}
        {networkDetails?.webRtc !== undefined && <KeyValue label={zhCN.devices.candidatePath} value={candidatePathText(networkDetails.webRtc.localCandidateType, networkDetails.webRtc.localAddressScope, networkDetails.webRtc.remoteCandidateType, networkDetails.webRtc.remoteAddressScope)} />}
        {networkDetails?.webRtc?.currentRoundTripTimeMs !== undefined && <KeyValue label={zhCN.devices.roundTripTime} value={`${networkDetails.webRtc.currentRoundTripTimeMs.toLocaleString()} ms`} />}
        {networkDetails?.webRtc?.availableOutgoingBitrate !== undefined && <KeyValue label={zhCN.devices.availableBitrate} value={formatBitrate(networkDetails.webRtc.availableOutgoingBitrate)} />}
        {networkDetails !== undefined && <KeyValue label={zhCN.devices.connectedAt} value={networkDetails.connectedAt === undefined ? zhCN.common.unavailable : new Date(networkDetails.connectedAt).toLocaleString()} />}
        {(connection.stats.bytesSent !== undefined || connection.stats.bytesReceived !== undefined) && <KeyValue label={zhCN.devices.traffic} value={`${formatBytes(connection.stats.bytesSent ?? 0)} ${zhCN.devices.sent} · ${formatBytes(connection.stats.bytesReceived ?? 0)} ${zhCN.devices.received}`} />}
      </View>
    </View>
  </>
}

function platformName(platform: string): string {
  const names: Record<string, string> = { darwin: 'macOS', win32: 'Win', linux: 'Linux', android: 'Android' }
  return names[platform] ?? platform
}

function platformIcon(platform: string): LucideIcon {
  if (platform === 'win32') return Monitor
  if (platform === 'linux') return Server
  return Laptop
}

function connectionPath(mode: string | undefined): string {
  const names: Record<string, string> = {
    Relay: zhCN.status.relay,
    WebRTC: zhCN.status.p2p,
    P2P: zhCN.status.p2p,
    LAN: zhCN.status.lan,
    TURN: zhCN.status.turn,
    Disconnected: zhCN.status.disconnected,
  }
  return mode === undefined ? zhCN.common.unavailable : names[mode] ?? mode
}

function controlServerName(value: string): string {
  try { return new URL(value).host }
  catch { return zhCN.common.unavailable }
}

function protocolText(protocol: string, relayProtocol?: string): string {
  return relayProtocol === undefined
    ? protocol.toUpperCase()
    : `${protocol.toUpperCase()} · TURN/${relayProtocol.toUpperCase()}`
}

function candidatePathText(localType?: string, localScope?: string, remoteType?: string, remoteScope?: string): string {
  const candidate = (candidateType?: string, scope?: string) => [candidateType, scope].filter(Boolean).join(' · ') || zhCN.common.unknown
  return `${candidate(localType, localScope)} → ${candidate(remoteType, remoteScope)}`
}

function formatBitrate(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mbps`
  if (value >= 1_000) return `${Math.round(value / 1_000)} Kbps`
  return `${Math.round(value)} bps`
}

function formatBytes(value: number): string {
  if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)} MB`
  if (value >= 1_024) return `${(value / 1_024).toFixed(1)} KB`
  return `${value} B`
}

function probeOrderText(order: readonly ConnectionProbeTransport[]): string {
  return order.map(probeTransportDiagnosticLabel).join(' → ')
}

function probeTransportDiagnosticLabel(transport: ConnectionProbeTransport): string {
  return zhCN.devices.connectionProbeDetails[transport]
}

function probeTransportForMode(mode: string | undefined): ConnectionProbeTransport | undefined {
  if (mode === 'LAN') return 'lan'
  if (mode === 'P2P') return 'p2p'
  if (mode === 'TURN') return 'turn'
  if (mode === 'Relay') return 'relay'
  return undefined
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  // Reading cap applied by the info screens only in landscape; portrait and
  // phone widths stay below the cap.
  contentColumn: { width: '100%', alignSelf: 'center' },
  pageHeading: { paddingTop: spacing.xxl, paddingBottom: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...type.title, color: colors.ink },
  subtitle: { ...type.small, color: colors.muted, marginTop: 2 },
  homeFooter: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  homeFooterText: { ...type.small, color: colors.muted, textAlign: 'center' },
  favoriteRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  favoriteRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  favoriteLink: { flex: 1, minWidth: 0, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs },
  favoriteRemove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  favoriteLinkPressed: { opacity: 0.6 },
  favoriteLinkContent: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  favoriteLinkText: { ...type.body, color: colors.ink, flex: 1, minWidth: 0 },
  favoriteLinkMeta: { ...type.caption, color: colors.muted, maxWidth: '45%', textAlign: 'right' },
  deviceSummary: { ...type.small, color: colors.muted, fontWeight: '500' },
  deviceCard: { marginTop: spacing.xxs, backgroundColor: colors.card },
  flatCard: { backgroundColor: colors.card },
  deviceRowName: { ...type.bodyStrong, fontSize: 16, lineHeight: 22, color: colors.ink, flex: 1, minWidth: 0, marginRight: spacing.sm },
  deviceStatus: { ...type.body, fontSize: 16, lineHeight: 22, color: colors.muted },
  deviceStatusOnline: { color: colors.success },
  deviceRowSubtitle: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted, flex: 1, minWidth: 0, marginRight: spacing.sm },
  deviceRowMeta: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'right' },
  swipeRow: { position: 'relative', overflow: 'hidden' },
  swipeDeleteAction: { position: 'absolute', left: 0, right: 0, top: 6, bottom: 6, backgroundColor: colors.danger, borderRadius: radius.md, overflow: 'hidden', alignItems: 'flex-end' },
  swipeDeleteButton: { width: SWIPE_ACTION_WIDTH, height: '100%', alignItems: 'center', justifyContent: 'center' },
  swipeDeleteInner: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  swipeDeleteText: { ...type.caption, color: colors.white },
  swipeContent: { backgroundColor: colors.background },
  swipeContentCard: { backgroundColor: colors.cardOpaque },
  // Inset so the red layer never bleeds through the card's anti-aliased corners.
  swipeDeleteActionCard: { top: 2, bottom: 2, left: 2, right: 2, borderRadius: radius.lg },
  deviceRow: { minHeight: 64, flexDirection: 'row' },
  deviceRowInner: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md, paddingRight: spacing.md, paddingVertical: spacing.md, gap: spacing.md },
  deviceRowCopy: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 3 },
  deviceRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  deviceGlyph: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  deviceStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  deviceStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.disabled },
  deviceStatusDotOnline: { backgroundColor: colors.success },
  swipeContentInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swipeContentBusy: { opacity: 0.55 },
  listRow: { minHeight: 82, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  listRowPressed: { backgroundColor: colors.surface },
  compactStatusSlot: { width: 24, marginRight: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  statusDotFailed: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  statusDotFailedLarge: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.danger },
  statusDotDone: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  statusDotDoneLarge: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.success },
  rowIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  rowTitle: { ...type.bodyStrong, color: colors.ink, flex: 1 },
  rowDetailLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rowSubtitle: { ...type.small, color: colors.muted },
  rowInlineSubtitle: { flex: 1 },
  rowMeta: { ...type.caption, color: colors.muted },
  compactSessionContent: { backgroundColor: colors.background },
  compactSessionPressTarget: { minHeight: 64, paddingLeft: 32, paddingRight: spacing.xs, alignItems: 'stretch' },
  compactSessionPressed: { backgroundColor: colors.surfaceStrong },
  compactSessionRow: { flexDirection: 'row', alignItems: 'stretch' },
  compactSessionCopy: { flex: 1, minWidth: 0, gap: 4, justifyContent: 'center', paddingVertical: spacing.sm },
  compactSessionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  compactSessionTitle: { ...type.body, fontSize: 16, color: colors.ink, flex: 1 },
  compactSessionMeta: { ...type.small, fontSize: 13, color: colors.subtle },
  compactSessionRunning: { color: colors.primary },
  connectionBack: { position: 'absolute', top: spacing.sm, left: spacing.md, zIndex: 2, width: 46, height: 46, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, ...floatingShadow(colors) },
  connectionHero: { flexGrow: 1, alignItems: 'center', justifyContent: 'flex-end', paddingTop: spacing.xl, paddingBottom: spacing.xxl + spacing.xs, gap: spacing.xl },
  connectionHeroEmbedded: { flexGrow: 0, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.sm },
  connectionBottomSpace: { flexGrow: 1.4 },
  connectionHeroCompact: { paddingTop: spacing.xs, paddingBottom: spacing.md, gap: spacing.sm },
  connectionHeading: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xs },
  connectionStatusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connectionStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  connectionStatusDotReady: { backgroundColor: colors.success },
  connectionStatusDotFailed: { backgroundColor: colors.danger },
  connectionStatus: { ...type.small, color: colors.muted, textAlign: 'center' },
  connectionStatusFailed: { color: colors.danger },
  connectionDeviceName: { ...type.title, color: colors.ink, textAlign: 'center', alignSelf: 'stretch', paddingHorizontal: spacing.xs },
  connectionVersions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: spacing.md, marginTop: 2 },
  versionItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  versionLabel: { ...type.small, color: colors.subtle },
  versionValue: { ...type.small, color: colors.muted },
  connectionSteps: { marginTop: spacing.xs },
  connectionStep: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  stepMarker: { width: 30, alignItems: 'center' },
  stepCircle: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.surfaceStrong, alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: colors.primarySoft },
  stepCircleComplete: { backgroundColor: colors.primary },
  stepCircleFailed: { backgroundColor: colors.dangerSoft },
  stepDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.subtle },
  stepDotFailed: { backgroundColor: colors.danger },
  stepConnector: { width: 2, flex: 1, minHeight: spacing.xxl, marginVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.separator },
  stepConnectorComplete: { backgroundColor: colors.primary },
  stepCopy: { flex: 1, paddingBottom: spacing.xl },
  stepTitle: { ...type.bodyStrong, color: colors.muted },
  stepTitleCurrent: { color: colors.ink },
  stepBody: { ...type.small, color: colors.muted, marginTop: 2 },
  stepBodyFailed: { ...type.caption, color: colors.danger },
  progressRoute: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: spacing.sm },
  progressRouteSegment: { flexDirection: 'row', alignItems: 'center' },
  progressRouteLabel: { ...type.small, color: colors.muted },
  progressRouteLabelActive: { ...type.smallStrong, color: colors.success },
  deviceHero: { paddingVertical: spacing.xxl, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deviceIcon: { width: 56, height: 56, borderRadius: radius.xl, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  deviceHeroCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  deviceName: { ...type.title, color: colors.ink, flexShrink: 1 },
  devicePlatform: { ...type.small, color: colors.muted, maxWidth: '30%', flexShrink: 1, textAlign: 'right' },
  connectArea: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.card, gap: spacing.lg },
  connectCopy: { ...type.body, color: colors.muted },
  trustHeader: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  trustIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  trustCopy: { flex: 1 },
  fingerprint: { ...type.caption, color: colors.primary, fontFamily: 'monospace', marginTop: spacing.xs },
  connectionError: { padding: spacing.md, borderRadius: radius.xl, backgroundColor: colors.dangerSoft, gap: spacing.sm },
  connectionErrorTitle: { ...type.bodyStrong, color: colors.ink },
  connectionErrorBody: { ...type.small, color: colors.muted },
  group: { borderRadius: radius.xl, backgroundColor: colors.card, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator },
  primaryArea: { marginTop: spacing.xxl },
  secondaryArea: { marginTop: spacing.sm },
  contentCounts: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  contentCount: { flex: 1, alignItems: 'center' },
  contentCountValue: { ...type.heading, color: colors.ink },
  contentCountLabel: { ...type.caption, color: colors.muted, marginTop: 2 },
  contentCountDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: colors.separator },
  networkDetails: { marginTop: -spacing.sm },
  connectionDetails: { marginTop: spacing.lg },
  })
}
