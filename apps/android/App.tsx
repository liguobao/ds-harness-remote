import { hydrateBrowseMemory, useBrowseMemory, browseScope } from './src/services/browse-memory'
import { startBrowseTracking } from './src/services/browse-tracking'
import { useEffect, useRef, useState } from 'react'
import { AppState, BackHandler, Image, Linking, StyleSheet, Text, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { useLocales } from 'expo-localization'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChatScreen } from './src/screens/chat-screen'
import { ConnectionScreen, DeviceDetailScreen, DevicesScreen } from './src/screens/device-screens'
import { AboutScreen, HomeActionsMenu, ServerSetupScreen, SettingsScreen } from './src/screens/setup-screens'
import { WorkspacesScreen } from './src/screens/workspaces-screen'
import { stopConnectionRecovery, useAppStore } from './src/state/store'
import { ForegroundConnectionRecovery } from './src/services/connection-recovery'
import type { WorkspaceShortcut } from './src/types'
import {
  networkRouteForNativeType,
  shouldReconnectForNetworkRoute,
  type NetworkRoute,
} from './src/lib/network-route'
import { Button, ErrorBanner } from './src/ui/components'
import { useResponsiveLayout } from './src/ui/responsive'
import { radius, spacing, type } from './src/ui/theme'
import { ThemeProvider, useTheme, type ThemeColors } from './src/ui/theme-context'
import { useThemedStyles } from './src/ui/use-themed-styles'
import { strings as zhCN } from './src/locales/i18n'

type Route =
  | { name: 'server' }
  | { name: 'devices' }
  | { name: 'device'; deviceId: string; source?: 'workspaces' }
  | { name: 'connecting'; deviceId: string; focusWorkspaceKey?: string; sessionId?: string }
  | { name: 'workspaces'; focusWorkspaceKey?: string }
  | { name: 'chat' }
  | { name: 'settings' }
  | { name: 'about' }

export default function App() {
  const locales = useLocales()
  const syncSystemLocales = useAppStore(state => state.syncSystemLocales)
  const localeTags = locales.map(locale => locale.languageTag)
  const localeKey = localeTags.join('|')

  useEffect(() => {
    syncSystemLocales(localeTags)
  }, [localeKey, syncSystemLocales])

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AppShell />
      </SafeAreaProvider>
    </ThemeProvider>
  )
}

function AppShell() {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <>
      <ThemedStatusBar />
      <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
        <AppNavigator />
      </SafeAreaView>
    </>
  )
}

function ThemedStatusBar() {
  const { scheme } = useTheme()
  const statusBarVisible = useAppStore(state => state.statusBarVisible)
  return <StatusBar hidden={!statusBarVisible} style={scheme === 'dark' ? 'light' : 'dark'} />
}

function AppNavigator() {
  const bootPhase = useAppStore(state => state.bootPhase)
  const browseReady = useBrowseMemory(state => state.ready)
  const [pendingConversation, setPendingConversation] = useState<{deviceId: string; sessionId: string}>()
  const [linksReady, setLinksReady] = useState(false)
  const autoRestored = useRef(false)
  const config = useAppStore(state => state.config)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const error = useAppStore(state => state.error)
  const bootstrap = useAppStore(state => state.bootstrap)
  const reconnect = useAppStore(state => state.reconnect)
  const openSession = useAppStore(state => state.openSession)
  const reauthRequired = useAppStore(state => state.reauthRequired)
  const setOffline = useAppStore(state => state.setOffline)
  const clearError = useAppStore(state => state.clearError)
  const [routes, setRoutes] = useState<Route[]>([{ name: 'server' }])
  const [homeMenuOpen, setHomeMenuOpen] = useState(false)
  const didChooseInitialRoute = useRef(false)
  const backgrounded = useRef(false)
  const networkRoute = useRef<NetworkRoute | undefined>(undefined)
  const route = routes[routes.length - 1]!
  const routeRef = useRef(route)
  routeRef.current = route
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  const push = (next: Route) => setRoutes(current => [...current, next])
  const replace = (next: Route) => setRoutes(current => [...current.slice(0, -1), next])
  const pop = () => setRoutes(current => current.length > 1 ? current.slice(0, -1) : current)
  const reset = (next: Route) => setRoutes([next])

  const openDevice = (device: (typeof devices)[number]) => {
    if (selectedDevice?.deviceId === device.deviceId && useAppStore.getState().connection.phase === 'connected') {
      reset({ name: 'workspaces' })
      return
    }
    push(device.trusted && device.online
      ? { name: 'connecting', deviceId: device.deviceId }
      : { name: 'device', deviceId: device.deviceId })
  }

  const goHomeWorkspaces = (focusWorkspaceKey?: string) => reset({
    name: 'workspaces',
    ...(focusWorkspaceKey === undefined ? {} : { focusWorkspaceKey }),
  })
  // Workspaces is the post-connect home, so its back target is the device list.
  const backFromWorkspaces = () => {
    if (routes.length > 1) pop()
    else reset({ name: 'devices' })
  }
  const openHomeMenu = () => setHomeMenuOpen(true)

  /**
   * Saved shortcuts (favorites, or recent visits while Favorites is empty) land
   * in the conversation itself: open the workspace's most recently updated
   * session and stack it on top of the workspaces screen so back returns to the
   * workspace. Workspaces without any conversation yet fall back to revealing
   * the workspace.
   */
  const openShortcutSession = async (workspaceKey: string) => {
    const session = await useAppStore.getState().openFavoriteWorkspaceSession(workspaceKey)
    setRoutes(session === undefined
      ? [{ name: 'workspaces', focusWorkspaceKey: workspaceKey }]
      : [{ name: 'workspaces', focusWorkspaceKey: workspaceKey }, { name: 'chat' }])
  }

  // A home-screen shortcut connects to its host first when it is not the current one.
  const openShortcut = (shortcut: WorkspaceShortcut) => {
    const device = devices.find(item => item.deviceId === shortcut.deviceId)
    if (device === undefined) {
      useAppStore.getState().clearError()
      useAppStore.setState({ error: zhCN.app.deviceUnavailable })
      return
    }
    if (selectedDevice?.deviceId === device.deviceId
      && useAppStore.getState().connection.phase === 'connected') {
      void openShortcutSession(shortcut.key)
      return
    }
    push(device.trusted && device.online
      ? { name: 'connecting', deviceId: device.deviceId, focusWorkspaceKey: shortcut.key }
      : { name: 'device', deviceId: device.deviceId })
  }

  useEffect(() => {void hydrateBrowseMemory(); void bootstrap()}, [bootstrap])
  useEffect(() => {if (browseReady) return startBrowseTracking()}, [browseReady])

  const openKnownSession = async (id: string) => {
    const backend = id.startsWith('codex:') ? 'codex' : id.startsWith('cursor:') ? 'cursor' : id.startsWith('antigravity:') ? 'antigravity' : id.startsWith('pi:') ? 'pi' : id.startsWith('opencode:') ? 'opencode' : id.startsWith('claude:') ? 'claude' : 'harness'
    const expectedScope = browseScope(useAppStore.getState())
    await useAppStore.getState().refreshWorkspaces(backend)
    if (browseScope(useAppStore.getState()) !== expectedScope || useAppStore.getState().connection.phase !== 'connected') return
    const state = useAppStore.getState(), target = state.sessions.find(item => item.sessionId === id)
    if (target === undefined) {goHomeWorkspaces(); useAppStore.setState({error: zhCN.comfort.conversationMissing}); return}
    const pending = openSession(target)
    if (useAppStore.getState().selectedSession?.sessionId === id) setRoutes([{name: 'workspaces'}, {name: 'chat'}])
    const ok = await pending
    if (ok && routeRef.current.name === 'connecting') setRoutes([{name: 'workspaces'}, {name: 'chat'}])
  }
  useEffect(() => {
    const receive = (url: string) => {
      try {
        const link = new URL(url)
        if (link.protocol !== 'dshremote:' || link.hostname !== 'conversation') return
        const deviceId = link.searchParams.get('host'), sessionId = link.searchParams.get('session')
        if (deviceId && sessionId) setPendingConversation({deviceId, sessionId})
      } catch { /* Only known conversation links are accepted. */ }
    }
    const subscription = Linking.addEventListener('url', event => receive(event.url))
    void Linking.getInitialURL().then(url => {if (url) receive(url)}).finally(() => setLinksReady(true))
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (bootPhase !== 'ready' || !browseReady || !linksReady || !didChooseInitialRoute.current || reauthRequired || devices.length === 0) return
    if (pendingConversation !== undefined) {
      autoRestored.current = true
      const target = pendingConversation
      const device = devices.find(item => item.deviceId === target.deviceId && item.trusted)
      setPendingConversation(undefined)
      if (device === undefined) {useAppStore.setState({error: zhCN.comfort.unknownHost}); return}
      if (selectedDevice?.deviceId === device.deviceId && useAppStore.getState().connection.phase === 'connected') void openKnownSession(target.sessionId)
      else push({name: 'connecting', deviceId: device.deviceId, sessionId: target.sessionId})
      return
    }
    if (autoRestored.current || !didChooseInitialRoute.current || route.name !== 'devices') return
    autoRestored.current = true
    const memory = useBrowseMemory.getState(), last = memory.last
    if (!memory.resume || !last || routeRef.current.name !== 'devices') return
    const device = devices.find(item => item.deviceId === last.deviceId && item.trusted && item.online)
    if (device && browseScope({config, selectedDevice: device}) === last.scope) push({name: 'connecting', deviceId: device.deviceId, sessionId: last.sessionId})
  }, [bootPhase, browseReady, linksReady, devices, pendingConversation, reauthRequired, route.name])

  // Zhihu OAuth deep link: dshremote://oauth?token=... completes the
  // account authorization started from the server setup screen.
  useEffect(() => {
    const completeOAuth = useAppStore.getState().completeOAuth
    const handleOAuthUrl = (url: string) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'dshremote:' || parsed.hostname !== 'oauth') return
        const token = parsed.searchParams.get('token')
        const error = parsed.searchParams.get('error')
        if (error !== null) {
          useAppStore.getState().clearError()
          useAppStore.setState({ error: zhCN.app.oauthCancelled })
          return
        }
        if (token === null || token.length < 16) {
          useAppStore.getState().clearError()
          useAppStore.setState({ error: zhCN.app.oauthInvalid })
          return
        }
        void completeOAuth(token).then(ok => {
          if (ok) reset({ name: 'devices' })
        })
      } catch {
        // not a dshremote link; ignore
      }
    }
    const subscription = Linking.addEventListener('url', event => handleOAuthUrl(event.url))
    void Linking.getInitialURL().then(url => { if (url !== null) handleOAuthUrl(url) })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (bootPhase !== 'ready' || didChooseInitialRoute.current) return
    didChooseInitialRoute.current = true
    if (config === undefined || reauthRequired) {
      reset({ name: 'server' })
      return
    }
    // Resolve sign-in first; the optional resume preference runs after this route.
    reset({ name: 'devices' })
  }, [bootPhase, config, reauthRequired])

  // Session expired while already navigating — send the user to sign-in.
  useEffect(() => {
    if (bootPhase !== 'ready' || !reauthRequired) return
    if (route.name === 'server') return
    reset({ name: 'server' })
  }, [bootPhase, reauthRequired, route.name])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (homeMenuOpen) {
        setHomeMenuOpen(false)
        return true
      }
      // ConnectionScreen owns hardware back (and may swallow it while connecting).
      if (route.name === 'connecting') return false
      // The workspaces home steps back to the device list instead of exiting.
      if (routes.length <= 1) {
        if (route.name !== 'workspaces') return false
        reset({ name: 'devices' })
        return true
      }
      pop()
      return true
    })
    return () => subscription.remove()
  }, [homeMenuOpen, route.name, routes.length])

  useEffect(() => {
    const recovery = new ForegroundConnectionRecovery(
      useAppStore.getState,
      options => useAppStore.getState().reconnect(options),
      () => { void stopConnectionRecovery() },
    )
    const unsubscribe = useAppStore.subscribe(() => recovery.update())
    // The native service retains RN timers across Activity pause. Keep bounded
    // recovery enabled while asleep, using the already running service.
    recovery.setActive(true)
    return () => {
      recovery.setActive(false)
      unsubscribe()
      void stopConnectionRecovery()
    }
  }, [])

  useEffect(() => NetInfo.addEventListener(state => {
    const nextRoute = networkRouteForNativeType(state.type)
    const previousRoute = networkRoute.current
    // Preserve the last confirmed route across NetInfo's transient `unknown`
    // states so a later real local/remote move is still detected.
    if (nextRoute !== 'unknown') networkRoute.current = nextRoute
    if (state.isConnected === false) {
      console.info('[dsh-remote] Network reported unavailable')
      setOffline()
      return
    }
    const app = useAppStore.getState()
    if (app.connection.phase === 'offline' && app.connection.retryable !== false && app.selectedDevice !== undefined) {
      void reconnect()
      return
    }
    // A move onto/off the local network needs a fresh ICE negotiation. Without
    // it an existing Relay channel remains selected even after Wi-Fi is ready.
    if (shouldReconnectForNetworkRoute(previousRoute, nextRoute)
      && app.connection.phase === 'connected' && app.selectedDevice !== undefined) {
      console.info('[dsh-remote] Network route changed:', previousRoute, nextRoute)
      void reconnect()
    }
  }), [reconnect, setOffline])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') {
        backgrounded.current = true
        return
      }
      if (state !== 'active' || !backgrounded.current) return
      backgrounded.current = false
      // Keep healthy carriers, but verify an encrypted round trip before
      // trusting a socket that merely remained locally "open" while asleep.
      void useAppStore.getState().resumeConnection()
    })
    return () => subscription.remove()
  }, [reconnect])

  if (bootPhase === 'loading' || !browseReady) return <LoadingScreen />
  if (bootPhase === 'error') return <BootError onRetry={() => void bootstrap()} message={error} />

  const deviceForRoute = route.name === 'device' || route.name === 'connecting'
    ? devices.find(device => device.deviceId === route.deviceId) ?? selectedDevice
    : undefined
  const devicesIsRoot = route.name === 'devices' && routes.length === 1
  const homeMenuVisible = homeMenuOpen && (route.name === 'workspaces' || devicesIsRoot)

  return (
    <View style={styles.flex}>
      {route.name === 'server' && <ServerSetupScreen onBack={routes.length > 1 ? pop : undefined} onComplete={() => reset({ name: 'devices' })} />}
      {route.name === 'devices' && (
        <DevicesScreen
          onDevice={openDevice}
          onBack={devicesIsRoot ? undefined : pop}
          onMore={devicesIsRoot ? openHomeMenu : undefined}
          onShortcut={devicesIsRoot ? openShortcut : undefined}
        />
      )}
      {route.name === 'connecting' && deviceForRoute !== undefined && (
        <ConnectionScreen
          device={deviceForRoute}
          onBack={() => {
            if (routes.length > 1) pop()
            else reset({ name: 'devices' })
          }}
          onConnected={() => {
            if (route.sessionId !== undefined) void openKnownSession(route.sessionId)
            else if (route.focusWorkspaceKey === undefined) goHomeWorkspaces()
            else void openShortcutSession(route.focusWorkspaceKey)
          }}
        />
      )}
      {route.name === 'connecting' && deviceForRoute === undefined && <MissingRoute onBack={() => reset({ name: 'devices' })} />}
      {route.name === 'device' && deviceForRoute !== undefined && <DeviceDetailScreen
        device={deviceForRoute}
        onBack={pop}
        onConnect={() => replace({ name: 'connecting', deviceId: deviceForRoute.deviceId })}
        onWorkspaces={route.source === 'workspaces' ? undefined : goHomeWorkspaces}
      />}
      {route.name === 'device' && deviceForRoute === undefined && <MissingRoute onBack={() => reset({ name: 'devices' })} />}
      {route.name === 'workspaces' && <WorkspacesScreen
        onBack={backFromWorkspaces}
        onOpenDevices={() => reset({ name: 'devices' })}
        onSession={() => push({ name: 'chat' })}
        focusWorkspaceKey={route.focusWorkspaceKey}
        onDeviceInfo={() => {
          if (selectedDevice !== undefined) push({ name: 'device', deviceId: selectedDevice.deviceId, source: 'workspaces' })
        }}
      />}
      {route.name === 'chat' && <ChatScreen onBack={pop} onOpenDevices={() => reset({ name: 'devices' })} onOpenWorkspaces={focusWorkspaceKey => push({ name: 'workspaces', focusWorkspaceKey })} />}
      {route.name === 'settings' && <SettingsScreen onBack={pop} onReset={() => reset({ name: 'server' })} />}
      {route.name === 'about' && <AboutScreen onBack={pop} />}
      {error !== undefined && route.name !== 'connecting' && route.name !== 'chat' && (
        <View pointerEvents="box-none" style={[styles.globalError, { top: insets.top }]}>
          <ErrorBanner message={error} onDismiss={clearError} />
        </View>
      )}
      <HomeActionsMenu
        visible={homeMenuVisible}
        onClose={() => setHomeMenuOpen(false)}
        onDevices={route.name === 'workspaces'
          ? () => {
              setHomeMenuOpen(false)
              push({ name: 'devices' })
            }
          : undefined}
        onSettings={() => {
          setHomeMenuOpen(false)
          push({ name: 'settings' })
        }}
        onAbout={() => {
          setHomeMenuOpen(false)
          push({ name: 'about' })
        }}
      />
    </View>
  )
}

function LoadingScreen() {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  // The splash-like boot view must fit in landscape phones (~360dp tall)
  // without clipping; keep its portrait composition otherwise.
  const { landscape } = useResponsiveLayout()
  const padding = landscape ? spacing.lg : spacing.xxxl
  return (
    <View style={[styles.loadingScreen, { paddingTop: padding + insets.top, paddingBottom: padding + insets.bottom }]}>
      <View style={styles.loadingBrand}>
        <Image
          source={require('./assets/android-icon-foreground-adaptive.png')}
          style={[styles.logo, landscape && { width: 72, height: 72 }]}
          resizeMode="contain"
          accessible={false}
        />
        <Text style={styles.loadingTitle}>DSH Remote</Text>
        <Text style={styles.loadingCredit}>{zhCN.app.credit}</Text>
      </View>
      <View style={styles.loadingDetails}>
        <Text style={styles.loadingTagline}>{zhCN.app.loadingTagline}</Text>
        <View style={styles.loadingStatus} accessibilityRole="text">
          <View style={styles.loadingDot} />
          <Text style={styles.loadingStatusText}>{zhCN.app.loadingIdentity}</Text>
        </View>
      </View>
    </View>
  )
}

function BootError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.loadingTitle}>{zhCN.app.bootFailed}</Text>
      <Text style={styles.loadingBody}>{message ?? zhCN.app.secureStorageUnavailable}</Text>
      <View style={styles.retry}><Button label={zhCN.common.retry} onPress={onRetry} /></View>
    </View>
  )
}

function MissingRoute({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.loadingTitle}>{zhCN.app.deviceUnavailable}</Text>
      <Text style={styles.loadingBody}>{zhCN.app.deviceNoLongerTrusted}</Text>
      <View style={styles.retry}><Button label={zhCN.app.backToDevices} onPress={onBack} /></View>
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  globalError: { position: 'absolute', left: 0, right: 0, zIndex: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, backgroundColor: colors.background },
  loadingScreen: { flex: 1, width: '100%', maxWidth: 420, alignSelf: 'center', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl, backgroundColor: colors.background },
  loadingBrand: { alignItems: 'center' },
  loadingDetails: { width: '100%', alignItems: 'center' },
  logo: { width: 144, height: 144, marginBottom: spacing.md },
  loadingTitle: { ...type.title, color: colors.ink, textAlign: 'center' },
  loadingCredit: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },
  loadingTagline: { ...type.smallStrong, color: colors.ink, textAlign: 'center', alignSelf: 'stretch' },
  loadingStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, alignSelf: 'stretch', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, marginTop: spacing.xl, paddingTop: spacing.lg },
  loadingDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  loadingStatusText: { ...type.small, color: colors.muted },
  loadingBody: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },
  retry: { alignSelf: 'stretch', marginTop: spacing.xl },
  })
}
