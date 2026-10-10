import { useEffect, useRef, useState } from 'react'
import * as Haptics from 'expo-haptics'
import { AccessibilityInfo, ActivityIndicator, Alert, Animated, BackHandler, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import { Archive, ArrowLeft, ChevronDown, ChevronRight, ChevronUp, CircleCheck, CirclePlus, Laptop, MessageSquareText, MoreVertical, Pencil, ShieldCheck, Trash2, X } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import type { ConnectionProbeTransport, ConnectionStage, RemoteDevice, RemoteSession, WorkspaceShortcut } from '../types'
import { workspaceStableKey } from '../lib/workspace-key'
import {
  Button,
  EmptyState,
  IconButton,
  KeyValue,
  ListRow,
  LoadingRows,
  RefreshAction,
  Screen,
  SectionTitle,
  StatusBadge,
  TopBar,
} from '../ui/components'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { strings as zhCN } from '../locales/i18n'
import { resolveSessionDisplayTitle } from './session-title'
import { DeviceRenameModal } from './device-rename-modal'

export function DevicesScreen({ onDevice, onBack, onMore, onShortcut }: {
  onDevice: (device: RemoteDevice) => void
  onBack?: () => void
  onMore?: () => void
  onShortcut?: (shortcut: WorkspaceShortcut) => void
}) {
  const devices = useAppStore(state => state.devices)
  const favoriteWorkspaces = useAppStore(state => state.favoriteWorkspaces)
  const recentWorkspaces = useAppStore(state => state.recentWorkspaces)
  const removeFavoriteWorkspace = useAppStore(state => state.removeFavoriteWorkspace)
  const connectedDevice = useAppStore(state => state.selectedDevice)
  const connectedWorkspaces = useAppStore(state => state.workspaces)
  const refreshing = useAppStore(state => state.refreshing)
  const refresh = useAppStore(state => state.refreshDevices)
  const forgetDevice = useAppStore(state => state.forgetDevice)
  const removalPending = useAppStore(state => state.busyAction?.startsWith('forget:') === true)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const isHome = onBack === undefined
  const [openRowId, setOpenRowId] = useState<string>()
  // Removed rows stay mounted until their exit animation ends; the store drops them at once.
  const [leaving, setLeaving] = useState<ReadonlyMap<string, LeavingDevice>>(() => new Map())
  const initialDeviceIds = useRef(new Set(devices.map(device => device.deviceId)))
  const deviceRows = mergeLeavingDevices(devices, leaving)

  const forgetLeaving = (deviceId: string) => setLeaving(current => {
    const next = new Map(current)
    next.delete(deviceId)
    return next
  })
  const removeDevice = async (device: RemoteDevice) => {
    // Register before the request so the row keeps its instance when the store removes it.
    const index = devices.findIndex(item => item.deviceId === device.deviceId)
    setLeaving(current => new Map(current).set(device.deviceId, { device, index }))
    const removed = await forgetDevice(device.deviceId)
    if (!removed) forgetLeaving(device.deviceId)
    setOpenRowId(undefined)
    return removed
  }

  const shortcutDeviceName = (shortcut: WorkspaceShortcut) =>
    devices.find(device => device.deviceId === shortcut.deviceId)?.name ?? shortcut.deviceName

  // Prefer the live title once this phone is connected to the owning host.
  const shortcutTitle = (shortcut: WorkspaceShortcut) => {
    if (connectedDevice?.deviceId !== shortcut.deviceId) return shortcut.title
    return connectedWorkspaces
      .find(workspace => workspaceStableKey(workspace, connectedDevice.platform) === shortcut.key)
      ?.title ?? shortcut.title
  }

  // Shortcuts are a home-screen surface; the secondary device page stays focused.
  const favorites = isHome
    ? [...favoriteWorkspaces].sort((left, right) => right.addedAt - left.addedAt)
    : []
  const recents = isHome
    ? [...recentWorkspaces].sort((left, right) => right.addedAt - left.addedAt)
    : []
  // With nothing saved yet, fall back to the workspaces visited most recently.
  const showingFavorites = favorites.length > 0
  const shortcuts = showingFavorites ? favorites : recents

  return (
    <View style={styles.flex}>
      <TopBar
        title={isHome ? 'DSH Remote' : zhCN.devices.myDevices}
        onBack={onBack}
        action={isHome && onMore !== undefined
          ? <IconButton label={zhCN.settings.more} icon={MoreVertical} onPress={onMore} />
          : undefined}
      />
      <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
        {isHome
          ? <>
              {shortcuts.length > 0 && onShortcut !== undefined && (
                <View>
                  <SectionTitle>{showingFavorites ? zhCN.devices.favorites : zhCN.devices.recent}</SectionTitle>
                  <View style={styles.favoriteLinks}>
                    {shortcuts.map(shortcut => (
                      <View key={`${shortcut.deviceId}:${shortcut.key}`} style={styles.favoriteRow}>
                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={showingFavorites
                            ? zhCN.devices.openFavorite(shortcutTitle(shortcut), shortcutDeviceName(shortcut))
                            : zhCN.devices.openRecent(shortcutTitle(shortcut), shortcutDeviceName(shortcut))}
                          onPress={() => onShortcut(shortcut)}
                          style={({ pressed }) => [styles.favoriteLink, pressed && styles.favoriteLinkPressed]}
                        >
                          <Text style={styles.favoriteLinkText} numberOfLines={1}>{shortcutTitle(shortcut)}</Text>
                          <Text style={styles.favoriteLinkMeta} numberOfLines={1}>· {shortcutDeviceName(shortcut)}</Text>
                        </Pressable>
                        {showingFavorites && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={zhCN.devices.removeFavorite(shortcutTitle(shortcut))}
                            hitSlop={8}
                            onPress={() => void removeFavoriteWorkspace(shortcut.deviceId, shortcut.key)}
                            style={({ pressed }) => [styles.favoriteRemove, pressed && styles.favoriteLinkPressed]}
                          >
                            <X size={16} color={colors.muted} />
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}
              <SectionTitle action={<RefreshAction refreshing={refreshing} onPress={() => void refresh()} />}>
                {zhCN.devices.myDevices}
              </SectionTitle>
            </>
          : <View style={styles.pageHeading}>
              <View>
                <Text style={styles.title}>{zhCN.devices.myDevices}</Text>
                <Text style={styles.subtitle}>{zhCN.devices.lead}</Text>
              </View>
              <RefreshAction refreshing={refreshing} onPress={() => void refresh()} />
            </View>}

        {refreshing && deviceRows.length === 0
          ? <LoadingRows />
          : deviceRows.length === 0
            ? <EmptyState
                icon={Laptop}
                title={zhCN.devices.emptyTitle}
                body={zhCN.devices.emptyBody}
              />
            : <View>{deviceRows.map(({ device, exiting }) => (
                <SwipeableDeviceRow
                  key={device.deviceId}
                  device={device}
                  open={openRowId === device.deviceId}
                  exiting={exiting}
                  animateIn={!initialDeviceIds.current.has(device.deviceId)}
                  locked={removalPending}
                  onOpenChange={open => setOpenRowId(current => open
                    ? device.deviceId
                    : current === device.deviceId ? undefined : current)}
                  onPress={() => {
                    // With a row open, a tap only dismisses it, as in platform swipe lists.
                    if (openRowId !== undefined) { setOpenRowId(undefined); return }
                    onDevice(device)
                  }}
                  onRemove={() => removeDevice(device)}
                  onExited={() => forgetLeaving(device.deviceId)}
                />
              ))}</View>}
      </Screen>
      {isHome && (
        <View style={styles.homeFooter}>
          <Text style={styles.homeFooterText}>{zhCN.devices.footer}</Text>
        </View>
      )}
    </View>
  )
}

interface LeavingDevice { device: RemoteDevice, index: number }

function mergeLeavingDevices(devices: RemoteDevice[], leaving: ReadonlyMap<string, LeavingDevice>) {
  const rows = devices.map(device => ({ device, exiting: false }))
  const present = new Set(devices.map(device => device.deviceId))
  const removed = [...leaving.values()]
    .filter(item => !present.has(item.device.deviceId))
    .sort((left, right) => left.index - right.index)
  for (const item of removed) {
    rows.splice(Math.max(0, Math.min(item.index, rows.length)), 0, { device: item.device, exiting: true })
  }
  return rows
}

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

function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])
  return reduceMotion
}

const SWIPE_ACTION_WIDTH = 96
const SWIPE_SPRING = { damping: 18, stiffness: 220, mass: 0.9, useNativeDriver: true } as const
const nudge = (value: Animated.Value, toValue: number, duration: number) =>
  Animated.timing(value, { toValue, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true })

function SwipeableDeviceRow({ device, open, exiting, animateIn, locked, onOpenChange, onPress, onRemove, onExited }: {
  device: RemoteDevice
  open: boolean
  exiting: boolean
  animateIn: boolean
  locked: boolean
  onOpenChange: (open: boolean) => void
  onPress: () => void
  onRemove: () => Promise<boolean>
  onExited: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const busy = useAppStore(state => state.busyAction === `forget:${device.deviceId}`)
  const reduceMotion = useReduceMotion()
  const offset = useRef(new Animated.Value(0)).current
  const armed = useRef(new Animated.Value(0)).current
  const presence = useRef(new Animated.Value(animateIn ? 0 : 1)).current
  const height = useRef(new Animated.Value(0)).current
  const [rowWidth, setRowWidth] = useState(360)
  const [collapsing, setCollapsing] = useState(false)
  const measuredHeight = useRef(0)
  const isOpen = useRef(false)
  const isArmed = useRef(false)
  const confirming = useRef(false)

  // The PanResponder is created once, so it reads the latest props through this ref.
  const latest = useRef({ rowWidth, reduceMotion, locked, busy, exiting, onOpenChange, requestRemove: async () => {} })

  const animate = (animation: Animated.CompositeAnimation, apply: () => void, done?: () => void) => {
    if (latest.current.reduceMotion) { apply(); done?.(); return }
    animation.start(({ finished }) => { if (finished) done?.() })
  }
  const settle = (toValue: number) =>
    animate(Animated.spring(offset, { ...SWIPE_SPRING, toValue }), () => offset.setValue(toValue))
  const setArmed = (next: boolean) => {
    if (isArmed.current === next) return
    isArmed.current = next
    if (next) void Haptics.selectionAsync().catch(() => undefined)
    animate(Animated.spring(armed, { ...SWIPE_SPRING, toValue: next ? 1 : 0 }), () => armed.setValue(next ? 1 : 0))
  }
  const setOpen = (next: boolean) => {
    isOpen.current = next
    settle(next ? -SWIPE_ACTION_WIDTH : 0)
    latest.current.onOpenChange(next)
  }

  const requestRemove = async () => {
    const state = latest.current
    if (confirming.current || state.locked || state.busy || state.exiting) return
    confirming.current = true
    setArmed(false)
    setOpen(true)
    try {
      if (!await confirmDeviceUnbind(device)) {
        setOpen(false)
        return
      }
      if (await onRemove()) return
      // A failed request keeps the row: close it with a short shake so the failure is felt.
      isOpen.current = false
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined)
      animate(Animated.sequence([
        Animated.spring(offset, { ...SWIPE_SPRING, toValue: 0 }),
        nudge(offset, -10, 60),
        nudge(offset, 8, 70),
        nudge(offset, -4, 60),
        nudge(offset, 0, 60),
      ]), () => offset.setValue(0))
    } finally {
      confirming.current = false
    }
  }
  latest.current = { rowWidth, reduceMotion, locked, busy, exiting, onOpenChange, requestRemove }

  const dragPosition = (dx: number) => {
    const raw = (isOpen.current ? -SWIPE_ACTION_WIDTH : 0) + dx
    if (raw > 0) return Math.min(12, raw * 0.15)
    if (raw >= -SWIPE_ACTION_WIDTH) return raw
    // Rubber band past the action so a long pull feels deliberate.
    return Math.max(-latest.current.rowWidth * 0.8, -SWIPE_ACTION_WIDTH + (raw + SWIPE_ACTION_WIDTH) * 0.6)
  }
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => {
      const state = latest.current
      if (state.locked || state.busy || state.exiting || confirming.current) return false
      return Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      offset.stopAnimation()
      latest.current.onOpenChange(true)
    },
    onPanResponderMove: (_, gesture) => {
      const next = dragPosition(gesture.dx)
      offset.setValue(next)
      setArmed(next <= -latest.current.rowWidth * 0.55)
    },
    onPanResponderRelease: (_, gesture) => {
      if (isArmed.current) { void latest.current.requestRemove(); return }
      const next = dragPosition(gesture.dx)
      setOpen(gesture.vx < -0.5 || (gesture.vx <= 0.5 && next < -SWIPE_ACTION_WIDTH / 2))
    },
    onPanResponderTerminate: () => {
      setArmed(false)
      setOpen(false)
    },
  })).current

  // Another row opened or the list was tapped: close this one.
  useEffect(() => {
    if (!open && isOpen.current && !confirming.current && !exiting) setOpen(false)
  }, [open])

  useEffect(() => {
    if (!animateIn) return
    animate(Animated.timing(presence, {
      toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }), () => presence.setValue(1))
  }, [])

  useEffect(() => {
    if (!exiting) return
    // Slide out first, then close the gap so the rows below glide up instead of jumping.
    animate(Animated.parallel([
      Animated.timing(offset, { toValue: -rowWidth, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(presence, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]), () => { offset.setValue(-rowWidth); presence.setValue(0) }, () => {
      height.setValue(measuredHeight.current)
      setCollapsing(true)
      animate(Animated.timing(height, {
        toValue: 0, duration: 180, easing: Easing.inOut(Easing.cubic), useNativeDriver: false,
      }), () => height.setValue(0), onExited)
    })
  }, [exiting])

  const travel = Math.max(SWIPE_ACTION_WIDTH + 1, rowWidth * 0.8)
  const iconOpacity = offset.interpolate({ inputRange: [-SWIPE_ACTION_WIDTH * 0.7, -16, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' })
  const iconScale = Animated.multiply(
    offset.interpolate({ inputRange: [-SWIPE_ACTION_WIDTH, -16, 0], outputRange: [1, 0.6, 0.6], extrapolate: 'clamp' }),
    armed.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }),
  )
  // Keep the icon centred in the revealed area while the row is pulled past the action width.
  const actionShift = offset.interpolate({
    inputRange: [-travel, -SWIPE_ACTION_WIDTH, 0],
    outputRange: [-(travel - SWIPE_ACTION_WIDTH) / 2, 0, 0],
    extrapolate: 'clamp',
  })
  const enterShift = presence.interpolate({ inputRange: [0, 1], outputRange: [exiting ? 0 : 8, 0] })
  const disabled = busy || locked || exiting

  return (
    <Animated.View
      style={collapsing ? { height, overflow: 'hidden' } : undefined}
      onLayout={event => {
        if (!collapsing) measuredHeight.current = event.nativeEvent.layout.height
        setRowWidth(event.nativeEvent.layout.width)
      }}
    >
      <Animated.View style={[styles.swipeRow, { opacity: presence, transform: [{ translateY: enterShift }] }]}>
        <View style={styles.swipeDeleteAction}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={zhCN.devices.forgetTitle(device.name)}
            disabled={disabled}
            onPress={() => void requestRemove()}
            style={styles.swipeDeleteButton}
          >
            <Animated.View style={[styles.swipeDeleteInner, { opacity: iconOpacity, transform: [{ translateX: actionShift }, { scale: iconScale }] }]}>
              {busy || exiting
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Trash2 size={20} color={colors.white} />}
              <Text style={styles.swipeDeleteText} numberOfLines={1}>{zhCN.devices.forget}</Text>
            </Animated.View>
          </Pressable>
        </View>
        <Animated.View style={[styles.swipeContent, { transform: [{ translateX: offset }] }]} {...responder.panHandlers}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={device.name}
            accessibilityActions={[{ name: 'delete', label: zhCN.devices.forget }]}
            onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'delete') void requestRemove() }}
            disabled={busy || exiting}
            onPress={onPress}
            style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
          >
            <View style={[styles.swipeContentInner, busy && styles.swipeContentBusy]}>
              <View style={styles.rowIcon}><Laptop size={21} color={colors.primary} /></View>
              <View style={styles.rowCopy}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{device.name}</Text>
                  <StatusBadge status={device.online ? 'online' : 'offline'} />
                </View>
                <View style={styles.rowDetailLine}>
                  <Text style={[styles.rowSubtitle, styles.rowInlineSubtitle]} numberOfLines={1}>{deviceSubtitle(device)}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>{lastSeenText(device.lastSeenAt)}</Text>
                </View>
              </View>
              <ChevronRight size={20} color={colors.subtle} />
            </View>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  )
}

const connectionStages = ['authenticating', 'transport', 'secure', 'loading'] as const satisfies readonly ConnectionStage[]
const CONNECTION_STUCK_MS = 3000

export function ConnectionScreen({ device, onBack, onConnected }: {
  device: RemoteDevice
  onBack: () => void
  onConnected: () => void
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

  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

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
      {showBack && (
        <View style={styles.connectionBack}>
          <IconButton label={zhCN.common.back} icon={ArrowLeft} onPress={cancel} />
        </View>
      )}
      <Screen>
        <View style={styles.connectionHero}>
          <View style={styles.connectionDeviceIcon}><Laptop size={30} color={colors.primary} /></View>
          <View style={styles.connectionHeading}>
            <Text accessibilityLiveRegion="polite" style={styles.connectionStatus}>
              {currentStage === 'ready' ? zhCN.devices.connectionReady : zhCN.devices.connecting}
            </Text>
            <Text style={styles.connectionDeviceName} numberOfLines={2}>{device.name}</Text>
          </View>
        </View>

        <View style={styles.connectionSteps}>
          {connectionStages.map((stage, index) => {
            const completed = index < currentIndex
            const active = index === currentIndex && !failed
            const stepFailed = index === currentIndex && failed
            const copy = zhCN.devices.connectionSteps[stage]
            return (
              <View key={stage} style={styles.connectionStep}>
                <View style={styles.stepMarker}>
                  <View style={[
                    styles.stepCircle,
                    completed && styles.stepCircleComplete,
                    active && styles.stepCircleActive,
                    stepFailed && styles.stepCircleFailed,
                  ]}>
                    {completed
                      ? <CircleCheck size={18} color={colors.white} />
                      : active
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <View style={[styles.stepDot, stepFailed && styles.stepDotFailed]} />}
                  </View>
                  {index < connectionStages.length - 1 && <View style={[styles.stepConnector, completed && styles.stepConnectorComplete]} />}
                </View>
                <View style={styles.stepCopy}>
                  <Text accessibilityLiveRegion={active ? 'polite' : 'none'} style={[styles.stepTitle, (active || completed) && styles.stepTitleCurrent]}>{copy.title}</Text>
                  {(stage !== 'transport' || connectionProbeOrder.length === 0) && <Text style={styles.stepBody}>{copy.body}</Text>}
                  {stage === 'transport' && connectionProbeOrder.length > 0 && (
                    <View style={styles.progressRoute}>
                      {connectionProbeOrder.map((transport, probeIndex) => (
                        <View key={`${transport}:${probeIndex}`} style={styles.progressRouteSegment}>
                          {probeIndex > 0 && <Text style={styles.progressRouteArrow}>→</Text>}
                          <Text style={[
                            styles.progressRouteLabel,
                            selectedProbe === transport && styles.progressRouteLabelActive,
                          ]}>
                            {probeTransportDiagnosticLabel(transport)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
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
  const connectionProbeOrder = useAppStore(state => state.connectionProbeOrder)
  const descriptor = useAppStore(state => state.hostDescriptor)
  const networkDetails = useAppStore(state => state.connectionNetworkDetails)
  const workspaces = useAppStore(state => state.workspaces)
  const refreshNetworkDetails = useAppStore(state => state.refreshConnectionNetworkDetails)
  const trust = useAppStore(state => state.trustDevice)
  const reconnect = useAppStore(state => state.reconnect)
  const [showNetworkDetails, setShowNetworkDetails] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const isSelected = selected?.deviceId === device.deviceId
  const isConnected = isSelected && connection.phase === 'connected'

  useEffect(() => {
    if (isConnected && showNetworkDetails) void refreshNetworkDetails()
  }, [isConnected, refreshNetworkDetails, showNetworkDetails])

  const trustAndContinue = async () => {
    if (await trust(device) && device.online) onConnect()
  }
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  return (
    <View style={styles.flex}>
      <TopBar title={zhCN.devices.title} onBack={onBack} />
      <Screen>
        <View style={styles.deviceHero}>
          <View style={styles.deviceIcon}><Laptop size={28} color={colors.primary} /></View>
          <View style={styles.deviceHeroCopy}>
            <Text style={styles.deviceName}>{device.name}</Text>
            <Text style={styles.devicePlatform}>{platformName(device.platform)}</Text>
          </View>
          <StatusBadge
            status={connectionBadgeStatus(isSelected, connection.phase, connection.stats.mode, device.online)}
          />
        </View>

        <Button label={zhCN.devices.rename} icon={Pencil} variant="quiet" onPress={() => setRenaming(true)} />

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
                  <KeyValue label={zhCN.devices.harness} value={descriptor?.version ?? zhCN.devices.unknownVersion} />
                  <KeyValue label={zhCN.devices.directory} value={descriptor?.cwd ?? zhCN.common.unavailable} mono />
                  {descriptor?.provider !== undefined && <KeyValue label={zhCN.devices.provider} value={descriptor.provider} />}
                  {descriptor?.model !== undefined && <KeyValue label={zhCN.devices.model} value={descriptor.model} />}
                  <View style={styles.contentCounts}>
                    <View style={styles.contentCount}><Text style={styles.contentCountValue}>{workspaces.length}</Text><Text style={styles.contentCountLabel}>{zhCN.devices.workspaces}</Text></View>
                    <View style={styles.contentCountDivider} />
                    <View style={styles.contentCount}><Text style={styles.contentCountValue}>{descriptor?.attachedSessions ?? 0}</Text><Text style={styles.contentCountLabel}>{zhCN.devices.conversations}</Text></View>
                  </View>
                </View>

                <SectionTitle>{zhCN.devices.secureConnection}</SectionTitle>
                <View style={styles.group}>
                  <KeyValue
                    label={zhCN.devices.path}
                    value={connectionPath(connection.stats.mode)}
                    onPress={() => setShowNetworkDetails(current => !current)}
                    expanded={showNetworkDetails}
                  />
                  {connectionProbeOrder.length > 0 && <KeyValue label={zhCN.devices.probeOrder} value={probeOrderText(connectionProbeOrder)} />}
                  <KeyValue label={zhCN.devices.encryption} value="Noise IK · ChaCha20-Poly1305" />
                </View>

                {showNetworkDetails && <View style={styles.networkDetails}>
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
                </View>}

                {onWorkspaces !== undefined && <View style={styles.primaryArea}><Button label={zhCN.devices.viewWorkspaces} icon={MessageSquareText} onPress={onWorkspaces} /></View>}
              </>}
      </Screen>
      {renaming && <DeviceRenameModal device={device} onClose={() => setRenaming(false)} />}
    </View>
  )
}

export function SessionsScreen({ onBack, onSession }: { onBack: () => void; onSession: (session: RemoteSession) => void }) {
  const sessions = useAppStore(state => state.sessions)
  const archivedSessionIds = useAppStore(state => state.archivedSessionIds)
  const busy = useAppStore(state => state.busyAction)
  const openSession = useAppStore(state => state.openSession)
  const createSession = useAppStore(state => state.createSession)
  const [showArchived, setShowArchived] = useState(false)

  const open = async (session: RemoteSession) => {
    if (await openSession(session)) onSession(session)
  }

  const archivedSet = new Set(archivedSessionIds)
  const active = sessions.filter(session => !archivedSet.has(session.sessionId))
  const archived = sessions.filter(session => archivedSet.has(session.sessionId))
  const creating = busy === 'create-session'
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  return (
    <View style={styles.flex}>
      <TopBar
        title={zhCN.sessions.title}
        onBack={onBack}
        action={<IconButton label={zhCN.sessions.new} icon={CirclePlus} tint={colors.primary} onPress={() => void createSession()} disabled={creating} />}
      />
      <Screen>
        <View style={styles.pageHeading}>
          <View><Text style={styles.title}>{zhCN.sessions.deviceTitle}</Text><Text style={styles.subtitle}>{zhCN.sessions.lead}</Text></View>
        </View>
        {creating && <Text style={styles.creatingText}>{zhCN.sessions.creating}</Text>}
        {active.length === 0 && archived.length === 0
          ? <EmptyState
              icon={MessageSquareText}
              title={zhCN.sessions.emptyTitle}
              body={zhCN.sessions.emptyBody}
              action={<Button label={zhCN.sessions.new} icon={CirclePlus} onPress={() => void createSession()} loading={creating} />}
            />
          : <View>
              {active.map(session => (
                <ListRow
                  key={session.sessionId}
                  title={sessionTitle(session)}
                  subtitle={session.cwd}
                  meta={updatedText(session.updatedAt)}
                  icon={MessageSquareText}
                  status={session.running ? <StatusBadge status="running" /> : undefined}
                  onPress={() => void open(session)}
                />
              ))}
              {archived.length > 0 && (
                <View style={styles.archivedSection}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showArchived }}
                    onPress={() => setShowArchived(current => !current)}
                    style={styles.archivedHeader}
                  >
                    <Archive size={16} color={colors.muted} />
                    <Text style={styles.archivedTitle}>{zhCN.sessions.archived(archived.length)}</Text>
                    {showArchived ? <ChevronUp size={16} color={colors.muted} /> : <ChevronDown size={16} color={colors.muted} />}
                  </Pressable>
                  {showArchived && archived.map(session => (
                    <ListRow
                      key={session.sessionId}
                      title={sessionTitle(session)}
                      subtitle={session.cwd}
                      meta={updatedText(session.updatedAt)}
                      icon={Archive}
                      onPress={() => void open(session)}
                    />
                  ))}
                </View>
              )}
            </View>}
      </Screen>
    </View>
  )
}

function sessionTitle(session: RemoteSession): string {
  const resolvedTitle = resolveSessionDisplayTitle(session)
  if (resolvedTitle !== undefined) return resolvedTitle
  return session.parentSessionId === undefined ? zhCN.sessions.untitled : zhCN.sessions.child
}

function platformName(platform: string): string {
  const names: Record<string, string> = { darwin: 'macOS', win32: 'Win', linux: 'Linux', android: 'Android' }
  return names[platform] ?? platform
}

function deviceSubtitle(device: RemoteDevice): string {
  return [
    platformName(device.platform),
    device.harnessVersion,
    device.clientVersion,
  ].filter(Boolean).join(' · ')
}

function updatedText(timestamp?: number): string {
  if (timestamp === undefined) return zhCN.time.unavailable
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 60_000) return zhCN.time.justNow
  if (delta < 3_600_000) return `${zhCN.time.minutesAgo(Math.floor(delta / 60_000))}${zhCN.time.updatedSuffix}`
  if (delta < 86_400_000) return `${zhCN.time.hoursAgo(Math.floor(delta / 3_600_000))}${zhCN.time.updatedSuffix}`
  return `${new Date(timestamp).toLocaleDateString(zhCN.time.locale)} ${zhCN.time.updatedSuffix}`
}

function lastSeenText(value?: number): string {
  if (value === undefined) return zhCN.time.lastSeenUnavailable
  if (!Number.isFinite(value)) return zhCN.time.lastSeenUnavailable
  const delta = Math.max(0, Date.now() - value)
  if (delta < 60_000) return zhCN.time.lastActive(zhCN.time.now)
  if (delta < 3_600_000) return zhCN.time.lastActive(zhCN.time.minutesAgo(Math.floor(delta / 60_000)))
  if (delta < 86_400_000) return zhCN.time.lastActive(zhCN.time.hoursAgo(Math.floor(delta / 3_600_000)))
  return zhCN.time.lastActive(new Date(value).toLocaleDateString(zhCN.time.locale))
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

function connectionBadgeStatus(
  isSelected: boolean,
  phase: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'offline',
  mode: string | undefined,
  deviceOnline: boolean,
): 'online' | 'offline' | 'lan' | 'relay' | 'p2p' | 'turn' | 'waiting' {
  if (!isSelected) return deviceOnline ? 'online' : 'offline'
  if (phase === 'connecting' || phase === 'reconnecting') return 'waiting'
  if (phase !== 'connected') return 'offline'
  if (mode === 'LAN') return 'lan'
  if (mode === 'P2P' || mode === 'WebRTC') return 'p2p'
  if (mode === 'TURN') return 'turn'
  if (mode === 'Relay') return 'relay'
  return 'online'
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  pageHeading: { paddingTop: spacing.xxl, paddingBottom: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...type.title, color: colors.ink },
  subtitle: { ...type.small, color: colors.muted, marginTop: 2 },
  homeFooter: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  homeFooterText: { ...type.small, color: colors.muted, textAlign: 'center' },
  favoriteLinks: { gap: spacing.xxs },
  favoriteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Two fixed columns so the "· machine" text starts at the same x on every row.
  favoriteLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xxs },
  favoriteRemove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  favoriteLinkPressed: { opacity: 0.6 },
  favoriteLinkText: { ...type.bodyStrong, color: colors.primary, textDecorationLine: 'underline', flexGrow: 2, flexShrink: 1, flexBasis: 0 },
  favoriteLinkMeta: { ...type.caption, color: colors.muted, flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  swipeRow: { position: 'relative', overflow: 'hidden' },
  swipeDeleteAction: { position: 'absolute', left: 0, right: 0, top: 6, bottom: 6, backgroundColor: colors.danger, borderRadius: radius.md, overflow: 'hidden', alignItems: 'flex-end' },
  swipeDeleteButton: { width: SWIPE_ACTION_WIDTH, height: '100%', alignItems: 'center', justifyContent: 'center' },
  swipeDeleteInner: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  swipeDeleteText: { ...type.caption, color: colors.white },
  swipeContent: { backgroundColor: colors.background },
  swipeContentInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swipeContentBusy: { opacity: 0.55 },
  listRow: { minHeight: 82, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  listRowPressed: { backgroundColor: colors.surface },
  rowIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  rowTitle: { ...type.bodyStrong, color: colors.ink, flex: 1 },
  rowDetailLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rowSubtitle: { ...type.small, color: colors.muted },
  rowInlineSubtitle: { flex: 1 },
  rowMeta: { ...type.caption, color: colors.subtle },
  connectionBack: { position: 'absolute', top: spacing.sm, left: spacing.sm, zIndex: 2 },
  connectionHero: { alignItems: 'center', paddingTop: spacing.xxxl, paddingBottom: spacing.xxl },
  connectionDeviceIcon: { width: 68, height: 68, borderRadius: radius.lg, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  connectionHeading: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xxs },
  connectionStatus: { ...type.smallStrong, color: colors.muted, textAlign: 'center' },
  connectionDeviceName: { ...type.title, color: colors.ink, textAlign: 'center' },
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
  progressRoute: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: spacing.sm },
  progressRouteSegment: { flexDirection: 'row', alignItems: 'center' },
  progressRouteArrow: { ...type.small, color: colors.subtle, paddingHorizontal: spacing.xxs },
  progressRouteLabel: { ...type.small, color: colors.muted },
  progressRouteLabelActive: { ...type.smallStrong, color: colors.success },
  deviceHero: { paddingVertical: spacing.xxl, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deviceIcon: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  deviceHeroCopy: { flex: 1 },
  deviceName: { ...type.title, color: colors.ink },
  devicePlatform: { ...type.small, color: colors.muted, marginTop: 2 },
  connectArea: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.lg },
  connectCopy: { ...type.body, color: colors.muted },
  trustHeader: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  trustIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  trustCopy: { flex: 1 },
  fingerprint: { ...type.caption, color: colors.primary, fontFamily: 'monospace', marginTop: spacing.xs },
  connectionError: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.dangerSoft, gap: spacing.sm },
  connectionErrorTitle: { ...type.bodyStrong, color: colors.ink },
  connectionErrorBody: { ...type.small, color: colors.muted },
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  primaryArea: { marginTop: spacing.xxl },
  secondaryArea: { marginTop: spacing.sm },
  contentCounts: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  contentCount: { flex: 1, alignItems: 'center' },
  contentCountValue: { ...type.heading, color: colors.ink },
  contentCountLabel: { ...type.caption, color: colors.muted, marginTop: 2 },
  contentCountDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: colors.separator },
  networkDetails: { marginTop: -spacing.sm },
  creatingText: { ...type.small, color: colors.muted, marginBottom: spacing.sm },
  archivedSection: { marginTop: spacing.lg },
  archivedHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  archivedTitle: { ...type.smallStrong, color: colors.muted, flex: 1 },
  connectionDetails: { marginTop: spacing.lg },
  })
}
