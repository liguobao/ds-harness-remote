import { hydrateBrowseMemory, useBrowseMemory, browseKey, browsePreference, browseScope, saveHostMode } from './src/services/browse-memory'
import { startBrowseTracking } from './src/services/browse-tracking'
import { useEffect, useRef, useState } from 'react'
import { AppState, BackHandler, Linking, StyleSheet, Text, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { useLocales } from 'expo-localization'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChatScreen } from './src/screens/chat-screen'
import { ConnectionScreen, DeviceDetailScreen } from './src/screens/device-screens'
import { HostSwitcherSheet } from './src/screens/host-switcher-sheet'
import { RemoteHostsScreen } from './src/screens/remote-hosts-screen'
import { AboutScreen, DiagnosticsScreen, HomeActionsMenu, ServerSetupScreen, SettingsScreen, useStartupUpdateCheck } from './src/screens/setup-screens'
import { stopConnectionRecovery, useAppStore } from './src/state/store'
import { ForegroundConnectionRecovery } from './src/services/connection-recovery'
import { resolveStartupAutoConnect } from './src/lib/auto-connect'
import {
  networkRouteForNativeType,
  shouldReconnectForNetworkRoute,
  type NetworkRoute,
} from './src/lib/network-route'
import { Button, ErrorBanner } from './src/ui/components'
import { spacing, type } from './src/ui/theme'
import { ThemeProvider, useTheme, type ThemeColors } from './src/ui/theme-context'
import { MermaidRendererHost } from './src/ui/mermaid/mermaid-renderer'
import { useThemedStyles } from './src/ui/use-themed-styles'
import { strings as zhCN } from './src/locales/i18n'
import { sessionBackendFromId } from './src/lib/session-backend'
// Keep the native first frame visible until boot completes. The native splash
// is the only startup view; the app then enters the login or chat route.
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

type Route =
  | { name: 'server' }
  | { name: 'remote-hosts' }
  | { name: 'device'; deviceId: string }
  | { name: 'connecting'; deviceId: string; sheet?: boolean; focusWorkspaceKey?: string; sessionId?: string }
  | { name: 'chat'; botConversationId?: string }
  | { name: 'settings' }
  | { name: 'diagnostics' }
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
        <MermaidRendererHost />
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
  const [bootstrapComplete, setBootstrapComplete] = useState(false)
  const [pendingConversation, setPendingConversation] = useState<{deviceId: string; sessionId: string}>()
  const [linksReady, setLinksReady] = useState(false)
  const autoRestored = useRef(false)
  const config = useAppStore(state => state.config)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const hostScope = browseScope({ config, selectedDevice })
  const botMode = useBrowseMemory(state => state.hostModes[hostScope] === 'bot')
  const autoConnectHost = useBrowseMemory(state => state.autoConnectHost)
  const error = useAppStore(state => state.error)
  const bootstrap = useAppStore(state => state.bootstrap)
  const reconnect = useAppStore(state => state.reconnect)
  const openSession = useAppStore(state => state.openSession)
  const reauthRequired = useAppStore(state => state.reauthRequired)
  const setOffline = useAppStore(state => state.setOffline)
  const clearError = useAppStore(state => state.clearError)
  const [routes, setRoutes] = useState<Route[]>([{ name: 'server' }])
  const [homeMenuOpen, setHomeMenuOpen] = useState(false)
  const [hostSwitcherOpen, setHostSwitcherOpen] = useState(false)
  const [serverEditorOpen, setServerEditorOpen] = useState(false)
  const didChooseInitialRoute = useRef(false)
  const backgrounded = useRef(false)
  const networkRoute = useRef<NetworkRoute | undefined>(undefined)
  const route = routes[routes.length - 1]!
  const routeRef = useRef(route)
  routeRef.current = route
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  useStartupUpdateCheck(bootPhase === 'ready')

  useEffect(() => {
    if (bootPhase === 'error' || (bootPhase === 'ready' && browseReady)) {
      void SplashScreen.hideAsync().catch(() => undefined)
    }
  }, [bootPhase, browseReady])

  const push = (next: Route) => setRoutes(current => [...current, next])
  const replace = (next: Route) => setRoutes(current => [...current.slice(0, -1), next])
  const pop = () => setRoutes(current => current.length > 1 ? current.slice(0, -1) : current)
  const reset = (next: Route) => setRoutes([next])

  const selectOfflineTrustedDevice = (device: (typeof devices)[number], preferredSessionId?: string) => {
    const state = useAppStore.getState()
    const scope = browseScope({ config: state.config, selectedDevice: device })
    const memory = useBrowseMemory.getState()
    const cached = device.trusted ? memory.catalogs[scope] : undefined
    const sameHost = state.selectedDevice?.deviceId === device.deviceId
    const nextSessions = sameHost && state.sessions.length > 0 ? state.sessions : cached?.sessions ?? []
    const nextWorkspaces = sameHost && state.workspaces.length > 0 ? state.workspaces : cached?.workspaces ?? []
    useAppStore.setState(current => ({
      selectedDevice: device,
      workspaces: nextWorkspaces,
      sessions: nextSessions,
      ...(!sameHost ? { selectedSession: undefined } : {}),
      connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } },
      error: undefined,
    }))
    const candidateId = preferredSessionId ?? (memory.last?.scope === scope ? memory.last.sessionId : undefined)
    const targetSession =
      (candidateId ? nextSessions.find(item => item.sessionId === candidateId) ?? memory.entries[browseKey(scope, candidateId)]?.session : undefined)
      ?? [...nextSessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
    if (targetSession !== undefined) {
      void openSession(targetSession)
    }
  }

  const openDevice = (device: (typeof devices)[number]) => {
    if (selectedDevice?.deviceId === device.deviceId && useAppStore.getState().connection.phase === 'connected') {
      reset({ name: 'chat' })
      return
    }
    if (device.trusted && !device.online) {
      selectOfflineTrustedDevice(device)
      reset({ name: 'chat' })
      return
    }
    push(device.trusted && device.online
      ? { name: 'connecting', deviceId: device.deviceId }
      : { name: 'device', deviceId: device.deviceId })
  }

  const goHomeChat = () => reset({ name: 'chat' })
  const openHomeMenu = () => setHomeMenuOpen(true)

  const openShortcutSession = async (workspaceKey: string) => {
    await useAppStore.getState().openFavoriteWorkspaceSession(workspaceKey)
    reset({ name: 'chat' })
  }

  useEffect(() => {
    let active = true
    void hydrateBrowseMemory()
    // bootPhase becomes ready before bootstrap's account wrapper finishes
    // refreshing the device directory. Restore only after that refresh settles.
    void bootstrap().then(() => { if (active) setBootstrapComplete(true) })
    return () => { active = false }
  }, [bootstrap])
  useEffect(() => {if (browseReady) return startBrowseTracking()}, [browseReady])

  const openKnownSession = async (id: string) => {
    const backend = sessionBackendFromId(id)
    const expectedScope = browseScope(useAppStore.getState())
    await useAppStore.getState().refreshWorkspaces(backend)
    if (browseScope(useAppStore.getState()) !== expectedScope || useAppStore.getState().connection.phase !== 'connected') return
    const state = useAppStore.getState(), target = state.sessions.find(item => item.sessionId === id)
    if (target === undefined) {goHomeChat(); useAppStore.setState({error: zhCN.comfort.conversationMissing}); return}
    const pending = openSession(target)
    if (useAppStore.getState().selectedSession?.sessionId === id) reset({ name: 'chat' })
    const ok = await pending
    if (ok && routeRef.current.name === 'connecting') reset({ name: 'chat' })
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
    if (bootPhase !== 'ready' || !bootstrapComplete || !browseReady || !linksReady || !didChooseInitialRoute.current || reauthRequired) return
    if (pendingConversation !== undefined && devices.length > 0) {
      autoRestored.current = true
      const target = pendingConversation
      const device = devices.find(item => item.deviceId === target.deviceId && item.trusted)
      setPendingConversation(undefined)
      if (device === undefined) {useAppStore.setState({error: zhCN.comfort.unknownHost}); return}
      if (selectedDevice?.deviceId === device.deviceId && useAppStore.getState().connection.phase === 'connected') void openKnownSession(target.sessionId)
      else push({name: 'connecting', deviceId: device.deviceId, sessionId: target.sessionId})
      return
    }
    if (autoRestored.current || !didChooseInitialRoute.current || route.name !== 'chat') return
    autoRestored.current = true
    const memory = useBrowseMemory.getState()
    if (routeRef.current.name !== 'chat') return
    const target = resolveStartupAutoConnect({
      devices,
      autoConnectHost: memory.autoConnectHost,
      resumeConversation: memory.resume,
      lastBrowse: memory.last,
      lastConnectedDeviceId: useAppStore.getState().lastConnectedDeviceId,
      hostModes: memory.hostModes,
      scopeForDevice: candidate => browseScope({ config, selectedDevice: candidate }),
    })
    if (target.kind === 'connect') {
      push({
        name: 'connecting',
        deviceId: target.device.deviceId,
        sheet: true,
        ...(target.sessionId === undefined ? {} : { sessionId: target.sessionId }),
      })
    } else if (useAppStore.getState().selectedDevice === undefined) {
      const offlineTargetId = memory.last?.deviceId ?? useAppStore.getState().lastConnectedDeviceId
      const offlineDevice =
        (offlineTargetId ? devices.find(item => item.deviceId === offlineTargetId && item.trusted) : undefined)
        ?? devices.find(item => item.trusted)
      if (offlineDevice !== undefined) {
        selectOfflineTrustedDevice(offlineDevice, memory.last?.sessionId)
      }
      if (offlineDevice === undefined || devices.some(item => item.trusted && item.online)) {
        setHostSwitcherOpen(true)
      }
    }
  }, [bootPhase, bootstrapComplete, browseReady, linksReady, devices, pendingConversation, reauthRequired, route.name])

  // Zhihu OAuth deep link: dshremote://oauth?token=... completes the
  // account authorization started from the server setup screen.
  useEffect(() => {
    const completeOAuth = useAppStore.getState().completeOAuth
    const handledOAuthUrl = { current: undefined as string | undefined }
    const handleOAuthUrl = (url: string) => {
      // Android may deliver the same deep link through both the activity
      // event and getInitialURL when returning from the browser. Handle it
      // once so the login screen does not restart its loading state.
      if (handledOAuthUrl.current === url) return
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'dshremote:' || parsed.hostname !== 'oauth') return
        handledOAuthUrl.current = url
        const token = parsed.searchParams.get('token')
        const error = parsed.searchParams.get('error')
        if (error !== null) {
          useAppStore.getState().clearError()
          useAppStore.setState({ error: zhCN.app.oauthCancelled, pendingOAuthBaseUrl: undefined, pendingOAuthLoginMethod: undefined, busyAction: undefined })
          return
        }
        if (token === null || token.length < 16) {
          useAppStore.getState().clearError()
          useAppStore.setState({ error: zhCN.app.oauthInvalid, pendingOAuthBaseUrl: undefined, pendingOAuthLoginMethod: undefined, busyAction: undefined })
          return
        }
        void completeOAuth(token).then(ok => {
          if (ok) {
            autoRestored.current = false
            reset({ name: 'chat' })
            // Keep the setup screen in its loading state until navigation is
            // scheduled, then release the one-shot OAuth state.
            useAppStore.setState({ pendingOAuthBaseUrl: undefined, pendingOAuthLoginMethod: undefined })
          }
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
    reset({ name: 'chat' })
  }, [bootPhase, config, reauthRequired])

  // Session expired while already navigating — send the user to sign-in.
  useEffect(() => {
    if (bootPhase !== 'ready' || !reauthRequired) return
    if (route.name === 'server') return
    reset({ name: 'server' })
  }, [bootPhase, reauthRequired, route.name])

  useEffect(() => {
    if (route.name !== 'chat' && hostSwitcherOpen) {
      setHostSwitcherOpen(false)
    }
  }, [route.name, hostSwitcherOpen])

  const backFromRemoteHosts = () => {
    if (routes.length > 1) pop()
    else reset({ name: 'chat' })
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (hostSwitcherOpen) {
        setHostSwitcherOpen(false)
        return true
      }
      if (homeMenuOpen) {
        setHomeMenuOpen(false)
        return true
      }
      // ConnectionScreen owns hardware back (and may swallow it while connecting).
      if (route.name === 'connecting') return false
      if (routes.length <= 1) {
        return false
      }
      pop()
      return true
    })
    return () => subscription.remove()
  }, [hostSwitcherOpen, homeMenuOpen, route.name, routes])

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

  if (bootPhase === 'error') return <BootError onRetry={() => void bootstrap()} message={error} />
  if (bootPhase === 'loading' || !browseReady) return null

  const deviceForRoute = route.name === 'device' || route.name === 'connecting'
    ? devices.find(device => device.deviceId === route.deviceId) ?? selectedDevice
    : undefined
  const startupConnection = route.name === 'connecting' && route.sheet === true
  const homeMenuVisible = homeMenuOpen && route.name === 'server'

  return (
    <View style={styles.flex}>
      {route.name === 'server' && (
        <ServerSetupScreen
          serverExpanded={serverEditorOpen}
          setServerExpanded={setServerEditorOpen}
          onMore={openHomeMenu}
          onBack={routes.length > 1 ? pop : undefined}
          onComplete={() => {
            autoRestored.current = false
            reset({ name: 'chat' })
          }}
        />
      )}
      {route.name === 'remote-hosts' && (
        <RemoteHostsScreen
          onBack={backFromRemoteHosts}
          onSelectDevice={openDevice}
          onOpenDeviceDetail={device => push({ name: 'device', deviceId: device.deviceId })}
          onSignedOut={() => reset({ name: 'server' })}
          autoConnectHost={autoConnectHost}
          onToggleAutoConnectHost={value => browsePreference({ autoConnectHost: value })}
        />
      )}
      {route.name === 'connecting' && !startupConnection && deviceForRoute !== undefined && (
        <ConnectionScreen
          device={deviceForRoute}
          onBack={() => {
            if (routes.length > 1) pop()
            else reset({ name: 'chat' })
          }}
          onConnected={() => {
            if (route.sessionId !== undefined) void openKnownSession(route.sessionId)
            else if (route.focusWorkspaceKey === undefined) goHomeChat()
            else void openShortcutSession(route.focusWorkspaceKey)
          }}
        />
      )}
      {route.name === 'connecting' && deviceForRoute === undefined && <MissingRoute onBack={() => reset({ name: 'chat' })} />}
      {route.name === 'device' && deviceForRoute !== undefined && (
        <DeviceDetailScreen
          device={deviceForRoute}
          onBack={pop}
          onConnect={() => replace({ name: 'connecting', deviceId: deviceForRoute.deviceId })}
          onWorkspaces={goHomeChat}
        />
      )}
      {route.name === 'device' && deviceForRoute === undefined && <MissingRoute onBack={() => reset({ name: 'chat' })} />}
      {(route.name === 'chat' || startupConnection) && (
        <ChatScreen
          botMode={botMode}
          botConversationId={route.name === 'chat' ? route.botConversationId : undefined}
          onBotModeChange={next => {
            saveHostMode(hostScope, next ? 'bot' : 'agent')
            setRoutes(current => current.map((entry, index) => index === current.length - 1 && entry.name === 'chat' ? { ...entry, botConversationId: undefined } : entry))
          }}
          onSelectBot={botConversationId => setRoutes(current => current.map((entry, index) => index === current.length - 1 && entry.name === 'chat' ? { ...entry, botConversationId } : entry))}
          onBack={pop}
          onOpenHostSwitcher={() => setHostSwitcherOpen(true)}
          onOpenSettings={() => push({ name: 'settings' })}
          onOpenAbout={() => push({ name: 'about' })}
          onOpenDeviceInfo={() => {
            if (selectedDevice !== undefined) push({ name: 'device', deviceId: selectedDevice.deviceId })
            else setHostSwitcherOpen(true)
          }}
        />
      )}
      {route.name === 'settings' && (
        <SettingsScreen
          onBack={pop}
          onReset={() => reset({ name: 'server' })}
          onOpenDiagnostics={() => push({ name: 'diagnostics' })}
          onOpenAbout={() => push({ name: 'about' })}
        />
      )}
      {route.name === 'diagnostics' && <DiagnosticsScreen onBack={pop} />}
      {route.name === 'about' && <AboutScreen onBack={pop} />}
      {error !== undefined && route.name !== 'connecting' && route.name !== 'chat' && route.name !== 'diagnostics' && (
        <View pointerEvents="box-none" style={[styles.globalError, { top: insets.top }]}>
          <ErrorBanner message={error} onDismiss={clearError} />
        </View>
      )}
      <HostSwitcherSheet
        visible={hostSwitcherOpen || (startupConnection && deviceForRoute !== undefined)}
        initialConnectingDevice={startupConnection ? deviceForRoute : undefined}
        onClose={() => {
          setHostSwitcherOpen(false)
          if (startupConnection) pop()
        }}
        onConnected={() => {
          setHostSwitcherOpen(false)
          if (route.name === 'connecting' && route.sessionId !== undefined) void openKnownSession(route.sessionId)
          else goHomeChat()
        }}
        onSelectDevice={device => {
          setHostSwitcherOpen(false)
          openDevice(device)
        }}
        onManageHosts={() => {
          setHostSwitcherOpen(false)
          push({ name: 'remote-hosts' })
        }}
      />
      <HomeActionsMenu
        visible={homeMenuVisible}
        onSwitchServer={route.name === 'server' ? () => {
          setHomeMenuOpen(false)
          setServerEditorOpen(true)
        } : undefined}
        onClose={() => setHomeMenuOpen(false)}
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
  return null
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
  loadingTitle: { ...type.title, color: colors.ink, textAlign: 'center' },
  loadingBody: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },
  retry: { alignSelf: 'stretch', marginTop: spacing.xl },
  })
}
