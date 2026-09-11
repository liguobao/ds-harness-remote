import { useEffect, useRef, useState } from 'react'
import { AppState, BackHandler, Image, Linking, StyleSheet, Text, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { useLocales } from 'expo-localization'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ChatScreen } from './src/screens/chat-screen'
import { ConnectionScreen, DeviceDetailScreen, DevicesScreen, SessionsScreen } from './src/screens/device-screens'
import { AboutScreen, HomeActionsMenu, ServerSetupScreen, SettingsScreen } from './src/screens/setup-screens'
import { WorkspacesScreen } from './src/screens/workspaces-screen'
import { useAppStore } from './src/state/store'
import {
  networkRouteForNativeType,
  shouldReconnectForNetworkRoute,
  type NetworkRoute,
} from './src/lib/network-route'
import { Button, ErrorBanner } from './src/ui/components'
import { radius, spacing, type } from './src/ui/theme'
import { ThemeProvider, useTheme, type ThemeColors } from './src/ui/theme-context'
import { useThemedStyles } from './src/ui/use-themed-styles'
import { strings as zhCN } from './src/locales/i18n'

type Route =
  | { name: 'server' }
  | { name: 'devices' }
  | { name: 'device'; deviceId: string; source?: 'workspaces' }
  | { name: 'connecting'; deviceId: string }
  | { name: 'workspaces' }
  | { name: 'sessions' }
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
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <AppNavigator />
      </SafeAreaView>
    </>
  )
}

function ThemedStatusBar() {
  const { scheme } = useTheme()
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
}

function AppNavigator() {
  const bootPhase = useAppStore(state => state.bootPhase)
  const config = useAppStore(state => state.config)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const error = useAppStore(state => state.error)
  const bootstrap = useAppStore(state => state.bootstrap)
  const reconnect = useAppStore(state => state.reconnect)
  const consumePendingAutoConnect = useAppStore(state => state.consumePendingAutoConnect)
  const reauthRequired = useAppStore(state => state.reauthRequired)
  const setOffline = useAppStore(state => state.setOffline)
  const clearError = useAppStore(state => state.clearError)
  const [routes, setRoutes] = useState<Route[]>([{ name: 'server' }])
  const [homeMenuOpen, setHomeMenuOpen] = useState(false)
  const didChooseInitialRoute = useRef(false)
  const networkRoute = useRef<NetworkRoute | undefined>(undefined)
  const route = routes[routes.length - 1]!
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

  const goHomeWorkspaces = () => reset({ name: 'workspaces' })
  const openHomeMenu = () => setHomeMenuOpen(true)

  useEffect(() => { void bootstrap() }, [bootstrap])

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
    const autoConnectDeviceId = consumePendingAutoConnect()
    if (autoConnectDeviceId !== undefined) {
      reset({ name: 'connecting', deviceId: autoConnectDeviceId })
      return
    }
    // Not yet connected — pick a host first; workspaces becomes home after connect.
    reset({ name: 'devices' })
  }, [bootPhase, config, consumePendingAutoConnect, reauthRequired])

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
      if (routes.length <= 1) return false
      pop()
      return true
    })
    return () => subscription.remove()
  }, [homeMenuOpen, route.name, routes.length])

  useEffect(() => NetInfo.addEventListener(state => {
    const nextRoute = networkRouteForNativeType(state.type)
    const previousRoute = networkRoute.current
    // Preserve the last confirmed route across NetInfo's transient `unknown`
    // states so a later real local/remote move is still detected.
    if (nextRoute !== 'unknown') networkRoute.current = nextRoute
    if (state.isConnected === false) {
      setOffline()
      return
    }
    const app = useAppStore.getState()
    if (app.connection.phase === 'offline' && app.selectedDevice !== undefined) {
      void reconnect()
      return
    }
    // A move onto/off the local network needs a fresh ICE negotiation. Without
    // it an existing Relay channel remains selected even after Wi-Fi is ready.
    if (shouldReconnectForNetworkRoute(previousRoute, nextRoute)
      && app.connection.phase === 'connected' && app.selectedDevice !== undefined) {
      void reconnect()
    }
  }), [reconnect, setOffline])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && useAppStore.getState().connection.phase === 'offline') void reconnect()
    })
    return () => subscription.remove()
  }, [reconnect])

  if (bootPhase === 'loading') return <LoadingScreen />
  if (bootPhase === 'error') return <BootError onRetry={() => void bootstrap()} message={error} />

  const deviceForRoute = route.name === 'device' || route.name === 'connecting'
    ? devices.find(device => device.deviceId === route.deviceId) ?? selectedDevice
    : undefined
  const devicesIsRoot = route.name === 'devices' && routes.length === 1
  const homeMenuVisible = homeMenuOpen && route.name === 'workspaces'

  return (
    <View style={styles.flex}>
      {error !== undefined && route.name !== 'connecting' && <ErrorBanner message={error} onDismiss={clearError} />}
      {route.name === 'server' && <ServerSetupScreen onBack={routes.length > 1 ? pop : undefined} onComplete={() => reset({ name: 'devices' })} />}
      {route.name === 'devices' && (
        <DevicesScreen
          onDevice={openDevice}
          onBack={devicesIsRoot ? undefined : pop}
        />
      )}
      {route.name === 'connecting' && deviceForRoute !== undefined && (
        <ConnectionScreen
          device={deviceForRoute}
          onBack={() => {
            if (routes.length > 1) pop()
            else reset({ name: 'devices' })
          }}
          onConnected={goHomeWorkspaces}
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
        onSession={() => push({ name: 'chat' })}
        onMore={openHomeMenu}
        onDeviceInfo={() => {
          if (selectedDevice !== undefined) push({ name: 'device', deviceId: selectedDevice.deviceId, source: 'workspaces' })
        }}
      />}
      {route.name === 'sessions' && <SessionsScreen onBack={pop} onSession={() => push({ name: 'chat' })} />}
      {route.name === 'chat' && <ChatScreen onBack={pop} />}
      {route.name === 'settings' && <SettingsScreen onBack={pop} onReset={() => reset({ name: 'server' })} />}
      {route.name === 'about' && <AboutScreen onBack={pop} />}
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
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.loadingScreen}>
      <View style={styles.loadingBrand}>
        <Image
          source={require('./assets/android-icon-foreground-adaptive.png')}
          style={styles.logo}
          resizeMode="contain"
          accessible={false}
        />
        <Text style={styles.loadingTitle}>DSH Remote</Text>
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
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.center}>
      <Text style={styles.loadingTitle}>{zhCN.app.bootFailed}</Text>
      <Text style={styles.loadingBody}>{message ?? zhCN.app.secureStorageUnavailable}</Text>
      <View style={styles.retry}><Button label={zhCN.common.retry} onPress={onRetry} /></View>
    </View>
  )
}

function MissingRoute({ onBack }: { onBack: () => void }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.center}>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, backgroundColor: colors.background },
  loadingScreen: { flex: 1, width: '100%', maxWidth: 420, alignSelf: 'center', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl, backgroundColor: colors.background },
  loadingBrand: { alignItems: 'center' },
  loadingDetails: { width: '100%', alignItems: 'center' },
  logo: { width: 144, height: 144, marginBottom: spacing.md },
  loadingTitle: { ...type.title, color: colors.ink, textAlign: 'center' },
  loadingTagline: { ...type.smallStrong, color: colors.ink, textAlign: 'center', alignSelf: 'stretch' },
  loadingStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, alignSelf: 'stretch', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, marginTop: spacing.xl, paddingTop: spacing.lg },
  loadingDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  loadingStatusText: { ...type.small, color: colors.muted },
  loadingBody: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },
  retry: { alignSelf: 'stretch', marginTop: spacing.xl },
  })
}
