import { hydrateBrowseMemory, useBrowseMemory, browseKey, browsePreference, browseScope, saveHostMode } from './src/services/browse-memory'
import { startBrowseTracking } from './src/services/browse-tracking'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, AppState, BackHandler, Easing, Keyboard, Linking, PanResponder, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { useLocales } from 'expo-localization'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChatScreen } from './src/screens/chat-screen'
import { AttentionInboxSheet } from './src/screens/attention-inbox-sheet'
import { ChatAppearanceScreen } from './src/screens/chat-appearance-screen'
import { ConnectionScreen, DeviceDetailScreen } from './src/screens/device-screens'
import { HostSwitcherSheet } from './src/screens/host-switcher-sheet'
import { RemoteHostsScreen } from './src/screens/remote-hosts-screen'
import { AboutScreen, DiagnosticsScreen, HomeActionsMenu, ServerSetupScreen, SettingsScreen, useStartupUpdateCheck } from './src/screens/setup-screens'
import { stopConnectionRecovery, useAppStore } from './src/state/store'
import { useAttentionStore } from './src/state/attention-store'
import { useBotTeamStore } from './src/state/bot-store'
import { ForegroundConnectionRecovery } from './src/services/connection-recovery'
import { AttentionDeepLinkBuffer, type ParsedAttentionDeepLink } from './src/lib/attention-deeplink'
import { resolveStartupAutoConnect } from './src/lib/auto-connect'
import type { AttentionItem, AttentionMode } from '@dsh-remote/protocol'
import {
  isRouteActiveScreen,
  isSheetConnectionRoute,
  resolveTopLevelHardwareBack,
  shouldHideSplashScreen,
  shouldSuppressAutoSessionSelect,
  type AppRoute,
} from './src/lib/navigation'
import {
  networkRouteForNativeType,
  shouldReconnectForNetworkRoute,
  type NetworkRoute,
} from './src/lib/network-route'
import { Button, ErrorBanner } from './src/ui/components'
import { NavigationFocusProvider } from './src/ui/mention-popover'
import { easingCurve, motionTokens, shouldCommitEdgeSwipeBack, shouldStartEdgeSwipeBack } from './src/ui/motion'
import { dismissClosingSheets } from './src/ui/sheet'
import { spacing, type } from './src/ui/theme'
import { ThemeProvider, useTheme, type ThemeColors } from './src/ui/theme-context'
import { MermaidRendererHost } from './src/ui/mermaid/mermaid-renderer'
import { AlertHost } from './src/ui/alert'
import { useReduceMotion } from './src/ui/use-reduce-motion'
import { useThemedStyles } from './src/ui/use-themed-styles'
import { strings as zhCN } from './src/locales/i18n'
import { sessionBackendFromId } from './src/lib/session-backend'
// Keep the native first frame visible until boot completes. The native splash
// is the only startup view; the app then enters the login or chat route.
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

type Route = AppRoute

interface StackEntry {
  id: number
  route: Route
}

interface ExitingLayer {
  id: number
  route: Route
  index: number
}

interface NavigationState {
  stack: StackEntry[]
  exiting?: ExitingLayer
}

const noop = () => {}

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
        <AlertHost />
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
  const deepLinkBufferRef = useRef(new AttentionDeepLinkBuffer())
  const [pendingDeepLink, setPendingDeepLink] = useState<ParsedAttentionDeepLink>()
  const [linksReady, setLinksReady] = useState(false)
  const attentionInboxOpen = useAttentionStore(state => state.inboxOpen)
  const setAttentionInboxOpen = useAttentionStore(state => state.setInboxOpen)
  const autoRestored = useRef(false)
  const config = useAppStore(state => state.config)
  const devices = useAppStore(state => state.devices)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connectionPhase = useAppStore(state => state.connection.phase)
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
  const nextRouteId = useRef(1)
  const [navState, setNavState] = useState<NavigationState>(() => ({
    stack: [{ id: 0, route: { name: 'server' } }],
  }))
  const { stack, exiting: exitingLayer } = navState
  const routes = stack.map(entry => entry.route)
  const [initialRouteChosen, setInitialRouteChosen] = useState(false)
  const [resolvingKnownSession, setResolvingKnownSession] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
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
    if (shouldHideSplashScreen({ bootPhase, browseReady, initialRouteChosen })) {
      void SplashScreen.hideAsync().catch(() => undefined)
    }
  }, [bootPhase, browseReady, initialRouteChosen])

  const push = (next: Route) => {
    Keyboard.dismiss()
    dismissClosingSheets()
    const entry: StackEntry = { id: nextRouteId.current++, route: next }
    setNavState(current => ({
      stack: [...current.stack, entry],
      exiting: undefined,
    }))
  }
  const replace = (next: Route) => {
    Keyboard.dismiss()
    dismissClosingSheets()
    const freshId = nextRouteId.current++
    setNavState(current => {
      const top = current.stack[current.stack.length - 1]
      const id = top !== undefined && top.route.name === next.name ? top.id : freshId
      return {
        stack: [...current.stack.slice(0, -1), { id, route: next }],
        exiting: undefined,
      }
    })
  }
  const pop = () => {
    Keyboard.dismiss()
    setNavState(current => {
      if (current.stack.length <= 1) return current
      const poppedIndex = current.stack.length - 1
      const popped = current.stack[poppedIndex]!
      const nextStack = current.stack.slice(0, -1)
      if (popped.route.name === 'connecting') {
        return { stack: nextStack, exiting: undefined }
      }
      return {
        stack: nextStack,
        exiting: { id: popped.id, route: popped.route, index: poppedIndex },
      }
    })
  }
  const popEntryImmediate = (id: number) => {
    Keyboard.dismiss()
    setNavState(current => {
      if (current.stack.length <= 1) return current
      const top = current.stack[current.stack.length - 1]!
      if (top.id !== id) return current
      return { stack: current.stack.slice(0, -1), exiting: undefined }
    })
  }
  const clearExitingLayer = (id: number) => {
    setNavState(current => current.exiting?.id === id ? { ...current, exiting: undefined } : current)
  }
  const reset = (next: Route) => {
    Keyboard.dismiss()
    dismissClosingSheets()
    const freshId = nextRouteId.current++
    setNavState(current => {
      const root = current.stack[0]
      const id = root !== undefined && root.route.name === next.name ? root.id : freshId
      return { stack: [{ id, route: next }], exiting: undefined }
    })
  }

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

  const externalOpenRevision = useRef(0)
  const openKnownSession = async (id: string, mode: AttentionMode = 'agent') => {
    const revision = ++externalOpenRevision.current
    setResolvingKnownSession(true)
    try {
      const expectedScope = browseScope(useAppStore.getState())
      const isCurrent = () => revision === externalOpenRevision.current
        && browseScope(useAppStore.getState()) === expectedScope
        && useAppStore.getState().connection.phase === 'connected'

      if (mode === 'bot') {
        saveHostMode(expectedScope, 'bot')
        if (useBotTeamStore.getState().state === undefined) {
          await useBotTeamStore.getState().refresh(true)
          if (!isCurrent()) return
        }
        const botState = useBotTeamStore.getState().state
        const matchedBot = botState?.bots.find(item => item.sessionId === id || item.parts?.includes(id))
        const matchedRoom = botState?.rooms.find(
          item => item.sessionId === id || item.parts?.includes(id) || item.ownParts?.includes(id),
        )
        const botConversationId = matchedBot?.id ?? matchedRoom?.id ?? id
        useBotTeamStore.getState().setSelectedId(botConversationId)
        setAttentionInboxOpen(false)
        setHostSwitcherOpen(false)
        reset({ name: 'chat', botConversationId, externalOpenRevision: revision })
        return
      }

      const backend = sessionBackendFromId(id)
      const beforeRefresh = useAppStore.getState()
      if (!beforeRefresh.sessions.some(item => item.sessionId === id)) {
        await beforeRefresh.refreshWorkspaces(backend)
        if (!isCurrent()) return
      } else if (beforeRefresh.workspaceCatalog?.backend !== backend) {
        void beforeRefresh.refreshWorkspaces(backend)
      }
      const state = useAppStore.getState(), target = state.sessions.find(item => item.sessionId === id)
      if (target === undefined) {
        setHostSwitcherOpen(false)
        goHomeChat()
        useAppStore.setState({ error: zhCN.comfort.conversationMissing })
        return
      }
      const alreadyVisible = state.selectedSession?.sessionId === id
        && useBrowseMemory.getState().hostModes[expectedScope] !== 'bot'
      if (alreadyVisible) {
        saveHostMode(expectedScope, 'agent')
        setAttentionInboxOpen(false)
        setHostSwitcherOpen(false)
        setResolvingKnownSession(false)
        reset({ name: 'chat', externalOpenRevision: revision })
      }
      const ok = await openSession(target)
      if (!isCurrent()) return
      if (!alreadyVisible && ok && useAppStore.getState().selectedSession?.sessionId === id) {
        saveHostMode(expectedScope, 'agent')
        setAttentionInboxOpen(false)
        setHostSwitcherOpen(false)
        reset({ name: 'chat', externalOpenRevision: revision })
      } else if (!ok && routeRef.current.name === 'connecting') {
        setHostSwitcherOpen(false)
        goHomeChat()
      }
    } finally {
      if (revision === externalOpenRevision.current) {
        setResolvingKnownSession(false)
      }
    }
  }

  const openAttentionTarget = async (options: { token?: string }) => {
    const revision = ++externalOpenRevision.current
    setResolvingKnownSession(true)
    try {
      const expectedScope = browseScope(useAppStore.getState())
      const isCurrent = () => revision === externalOpenRevision.current
        && browseScope(useAppStore.getState()) === expectedScope
        && useAppStore.getState().connection.phase === 'connected'

      if (options.token !== undefined) {
        const resolved = await useAttentionStore.getState().resolveToken(options.token)
        if (!isCurrent()) return
        if (resolved.kind === 'session') {
          if (resolved.itemId !== undefined) {
            void useAttentionStore.getState().ackUnread([resolved.itemId])
          }
          await openKnownSession(resolved.sessionId, resolved.mode)
          return
        }
      }

      setHostSwitcherOpen(false)
      reset({ name: 'chat' })
      setAttentionInboxOpen(true)
    } finally {
      if (revision === externalOpenRevision.current) {
        setResolvingKnownSession(false)
      }
    }
  }

  const handleSelectAttentionItem = (item: AttentionItem) => {
    setAttentionInboxOpen(false)
    if (item.status === 'completed_unread' || item.status === 'failed_unread') {
      void useAttentionStore.getState().ackUnread([item.id])
    }
    void openKnownSession(item.sessionId, item.mode)
  }

  const handleSwitchAttentionHost = (device: (typeof devices)[number], targetItem?: AttentionItem) => {
    setAttentionInboxOpen(false)
    const alreadyConnected = selectedDevice?.deviceId === device.deviceId
      && useAppStore.getState().connection.phase === 'connected'
    if (alreadyConnected) {
      if (targetItem !== undefined) {
        if (targetItem.status === 'completed_unread' || targetItem.status === 'failed_unread') {
          void useAttentionStore.getState().ackUnread([targetItem.id])
        }
        void openKnownSession(targetItem.sessionId, targetItem.mode)
      } else {
        setAttentionInboxOpen(true)
      }
      return
    }
    if (!device.trusted || !device.online) {
      openDevice(device)
      return
    }
    push({
      name: 'connecting',
      deviceId: device.deviceId,
      sheet: true,
      ...(targetItem !== undefined
        ? { sessionId: targetItem.sessionId, sessionMode: targetItem.mode }
        : { openAttentionInbox: true }),
    })
  }

  useEffect(() => {
    const receive = (url: string) => {
      const parsed = deepLinkBufferRef.current.enqueueUrl(url)
      if (parsed !== null) setPendingDeepLink(parsed)
    }
    const subscription = Linking.addEventListener('url', event => receive(event.url))
    void Linking.getInitialURL().then(url => { if (url) receive(url) }).finally(() => setLinksReady(true))
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (bootPhase !== 'ready' || !bootstrapComplete || !browseReady || !linksReady || !didChooseInitialRoute.current || reauthRequired) return
    if (pendingDeepLink !== undefined) {
      autoRestored.current = true
      const target = deepLinkBufferRef.current.take() ?? pendingDeepLink
      const device = devices.find(item => item.deviceId === target.hostId && item.trusted)
      setPendingDeepLink(undefined)
      if (device === undefined) { useAppStore.setState({ error: zhCN.comfort.unknownHost }); return }
      const alreadyConnected = selectedDevice?.deviceId === device.deviceId
        && useAppStore.getState().connection.phase === 'connected'
      if (target.kind === 'conversation') {
        if (alreadyConnected) void openKnownSession(target.sessionId, target.mode)
        else push({ name: 'connecting', deviceId: device.deviceId, sessionId: target.sessionId, sessionMode: target.mode })
      } else {
        if (alreadyConnected) void openAttentionTarget({ token: target.token })
        else push({
          name: 'connecting',
          deviceId: device.deviceId,
          openAttentionInbox: true,
          ...(target.token !== undefined ? { attentionToken: target.token } : {}),
        })
      }
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
  }, [bootPhase, bootstrapComplete, browseReady, linksReady, devices, pendingDeepLink, reauthRequired, route.name])

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
      setInitialRouteChosen(true)
      return
    }
    // Resolve sign-in first; the optional resume preference runs after this route.
    reset({ name: 'chat' })
    setInitialRouteChosen(true)
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
    if (route.name !== 'server' && homeMenuOpen) {
      setHomeMenuOpen(false)
    }
  }, [route.name, hostSwitcherOpen, homeMenuOpen])

  const backFromRemoteHosts = () => {
    if (routes.length > 1) pop()
    else reset({ name: 'chat' })
  }

  const homeMenuVisible = homeMenuOpen && route.name === 'server'
  const backStateRef = useRef({
    signingOut,
    attentionInboxOpen,
    hostSwitcherOpen,
    homeMenuOpen: homeMenuVisible,
    route,
    routesLength: routes.length,
  })
  backStateRef.current = {
    signingOut,
    attentionInboxOpen,
    hostSwitcherOpen,
    homeMenuOpen: homeMenuVisible,
    route,
    routesLength: routes.length,
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const state = backStateRef.current
      const outcome = resolveTopLevelHardwareBack(state)
      switch (outcome.action) {
        case 'consume':
          return true
        case 'close-attention-inbox':
          setAttentionInboxOpen(false)
          return true
        case 'close-host-switcher':
          setHostSwitcherOpen(false)
          return true
        case 'close-home-menu':
          setHomeMenuOpen(false)
          return true
        case 'delegate':
          return false
        case 'pop':
          pop()
          return true
      }
    })
    return () => subscription.remove()
  }, [])

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
      void useAppStore.getState().resumeConnection().then(() => {
        if (useAppStore.getState().connection.phase === 'connected' && useBotTeamStore.getState().state !== undefined) {
          void useBotTeamStore.getState().refreshLive({ forceFull: true })
        }
      })
    })
    return () => subscription.remove()
  }, [reconnect])

  const resolveDeviceForRoute = (target: Route) => target.name === 'device' || target.name === 'connecting'
    ? devices.find(device => device.deviceId === target.deviceId)
      ?? (selectedDevice?.deviceId === target.deviceId ? selectedDevice : undefined)
    : undefined
  const deviceForRoute = resolveDeviceForRoute(route)
  const startupConnection = isSheetConnectionRoute(route)

  useEffect(() => {
    if (bootPhase === 'ready' && startupConnection && deviceForRoute === undefined) {
      pop()
    }
  }, [bootPhase, startupConnection, deviceForRoute])

  if (bootPhase === 'error') return <BootError onRetry={() => void bootstrap()} message={error} />
  if (bootPhase === 'loading' || !browseReady || !initialRouteChosen) return null

  const overlayVisible = attentionInboxOpen || hostSwitcherOpen || homeMenuVisible || (startupConnection && deviceForRoute !== undefined)
  const suppressAutoSelect = shouldSuppressAutoSessionSelect({
    botMode,
    routeName: route.name,
    connectionPhase,
    resolvingKnownSession: resolvingKnownSession || pendingDeepLink !== undefined,
  })

  const renderRouteScreen = (entry: Route, index: number, active: boolean, exiting: boolean) => {
    switch (entry.name) {
      case 'server':
        return (
          <ServerSetupScreen
            serverExpanded={serverEditorOpen}
            setServerExpanded={setServerEditorOpen}
            onMore={openHomeMenu}
            onBack={index > 0 ? pop : undefined}
            onComplete={() => {
              autoRestored.current = false
              reset({ name: 'chat' })
            }}
          />
        )
      case 'remote-hosts':
        return (
          <RemoteHostsScreen
            onBack={backFromRemoteHosts}
            onSelectDevice={openDevice}
            onOpenDeviceDetail={device => push({ name: 'device', deviceId: device.deviceId })}
            onSignedOut={() => reset({ name: 'server' })}
            autoConnectHost={autoConnectHost}
            onToggleAutoConnectHost={value => browsePreference({ autoConnectHost: value })}
          />
        )
      case 'connecting': {
        const entryDevice = resolveDeviceForRoute(entry)
        if (entryDevice === undefined) return <MissingRoute onBack={() => reset({ name: 'chat' })} />
        return (
          <ConnectionScreen
            device={entryDevice}
            onBack={exiting ? noop : () => {
              if (routes.length > 1) pop()
              else reset({ name: 'chat' })
            }}
            onConnected={exiting ? noop : () => {
              if (entry.openAttentionInbox || entry.attentionToken !== undefined) {
                void openAttentionTarget({ token: entry.attentionToken })
              } else if (entry.sessionId !== undefined) {
                void openKnownSession(entry.sessionId, entry.sessionMode ?? 'agent')
              } else if (entry.focusWorkspaceKey === undefined) {
                goHomeChat()
              } else {
                void openShortcutSession(entry.focusWorkspaceKey)
              }
            }}
          />
        )
      }
      case 'device': {
        const entryDevice = resolveDeviceForRoute(entry)
        if (entryDevice === undefined) return <MissingRoute onBack={() => reset({ name: 'chat' })} />
        return (
          <DeviceDetailScreen
            device={entryDevice}
            onBack={pop}
            onConnect={() => replace({ name: 'connecting', deviceId: entryDevice.deviceId })}
            onWorkspaces={goHomeChat}
          />
        )
      }
      case 'chat':
        return (
          <ChatScreen
            active={active}
            suppressAutoSelect={suppressAutoSelect}
            botMode={botMode}
            externalOpenRevision={entry.externalOpenRevision}
            botConversationId={entry.botConversationId}
            onBotModeChange={next => {
              saveHostMode(hostScope, next ? 'bot' : 'agent')
              setNavState(current => ({
                ...current,
                stack: current.stack.map(item => item.route.name === 'chat'
                  ? { ...item, route: { ...item.route, botConversationId: undefined } }
                  : item),
              }))
            }}
            onSelectBot={botConversationId => setNavState(current => ({
              ...current,
              stack: current.stack.map(item => item.route.name === 'chat'
                ? { ...item, route: { ...item.route, botConversationId } }
                : item),
            }))}
            onBack={pop}
            onOpenHostSwitcher={() => setHostSwitcherOpen(true)}
            onOpenAttentionInbox={() => setAttentionInboxOpen(true)}
            onOpenSettings={() => push({ name: 'settings' })}
            onOpenAbout={() => push({ name: 'about' })}
            onOpenDeviceInfo={() => {
              if (selectedDevice !== undefined) push({ name: 'device', deviceId: selectedDevice.deviceId })
              else setHostSwitcherOpen(true)
            }}
          />
        )
      case 'settings':
        return (
          <SettingsScreen
            active={active}
            onBack={pop}
            onSigningOutChange={setSigningOut}
            onReset={() => reset({ name: 'server' })}
            onOpenAppearance={() => push({ name: 'appearance' })}
            onOpenDiagnostics={() => push({ name: 'diagnostics' })}
            onOpenAbout={() => push({ name: 'about' })}
          />
        )
      case 'appearance':
        return <ChatAppearanceScreen active={active} onBack={pop} />
      case 'diagnostics':
        return <DiagnosticsScreen onBack={pop} />
      case 'about':
        return <AboutScreen onBack={pop} />
    }
  }

  const visibleLayers = [
    ...stack.map((entry, index) => ({ ...entry, index, exiting: false })),
    ...(exitingLayer !== undefined ? [{ ...exitingLayer, exiting: true }] : []),
  ]

  return (
    <View style={styles.flex}>
      {visibleLayers.map(layer => {
        if (isSheetConnectionRoute(layer.route)) return null
        const active = !layer.exiting && isRouteActiveScreen(routes, layer.index, overlayVisible)
        const canEdgeBack = Platform.OS === 'ios'
          && layer.index > 0
          && active
          && !signingOut
          && layer.route.name !== 'chat'
          && layer.route.name !== 'connecting'
        return (
          <RouteLayer
            key={layer.id}
            zIndex={layer.exiting ? Math.max(layer.index + 1, stack.length + 1) : layer.index + 1}
            animateEnter={layer.index > 0}
            active={active}
            exiting={layer.exiting}
            canEdgeBack={canEdgeBack}
            onEdgeBack={canEdgeBack ? () => popEntryImmediate(layer.id) : undefined}
            onExitComplete={layer.exiting ? () => clearExitingLayer(layer.id) : undefined}
          >
            {renderRouteScreen(layer.route, layer.index, active, layer.exiting)}
          </RouteLayer>
        )
      })}
      {error !== undefined && route.name !== 'connecting' && route.name !== 'diagnostics' && (
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
          if (route.name === 'connecting' && (route.openAttentionInbox || route.attentionToken !== undefined)) {
            void openAttentionTarget({ token: route.attentionToken })
            return
          }
          if (route.name === 'connecting' && route.sessionId !== undefined) {
            void openKnownSession(route.sessionId, route.sessionMode ?? 'agent')
            return
          }
          setHostSwitcherOpen(false)
          goHomeChat()
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
      <AttentionInboxSheet
        visible={attentionInboxOpen}
        onClose={() => setAttentionInboxOpen(false)}
        onSelectItem={handleSelectAttentionItem}
        onSwitchHost={handleSwitchAttentionHost}
        onOpenRemoteHosts={() => {
          setAttentionInboxOpen(false)
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

function RouteLayer({
  zIndex,
  animateEnter,
  active,
  exiting,
  canEdgeBack,
  onEdgeBack,
  onExitComplete,
  children,
}: {
  zIndex: number
  animateEnter: boolean
  active: boolean
  exiting: boolean
  canEdgeBack: boolean
  onEdgeBack?: () => void
  onExitComplete?: () => void
  children: ReactNode
}) {
  const { colors } = useTheme()
  const reduceMotion = useReduceMotion()
  const { width: windowWidth } = useWindowDimensions()
  const progress = useRef(new Animated.Value(animateEnter ? 0 : 1)).current
  const exitProgress = useRef(new Animated.Value(0)).current
  const swipeX = useRef(new Animated.Value(0)).current
  const enterAnimRef = useRef<Animated.CompositeAnimation | undefined>(undefined)
  const swipeAnimRef = useRef<Animated.CompositeAnimation | undefined>(undefined)
  const swipingOutRef = useRef(false)
  const unmountedRef = useRef(false)
  const onExitCompleteRef = useRef(onExitComplete)
  onExitCompleteRef.current = onExitComplete

  const canEdgeSwipe = Platform.OS === 'ios' && canEdgeBack && active && !exiting
  const gestureRef = useRef({
    canEdgeSwipe,
    reduceMotion,
    windowWidth,
    onEdgeBack,
  })
  gestureRef.current = {
    canEdgeSwipe,
    reduceMotion,
    windowWidth,
    onEdgeBack,
  }

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      enterAnimRef.current?.stop()
      swipeAnimRef.current?.stop()
    }
  }, [])

  const hasEnteredRef = useRef(!animateEnter)

  useEffect(() => {
    if (!animateEnter || exiting || hasEnteredRef.current) return
    progress.setValue(0)
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? motionTokens.duration.reduced : 220,
      easing: Easing.bezier(...easingCurve('expand')),
      useNativeDriver: true,
    })
    enterAnimRef.current = animation
    animation.start(({ finished }) => {
      if (finished) hasEnteredRef.current = true
    })
    return () => {
      animation.stop()
      if (enterAnimRef.current === animation) enterAnimRef.current = undefined
    }
  }, [animateEnter, exiting, progress, reduceMotion])

  useEffect(() => {
    if (!exiting) return
    enterAnimRef.current?.stop()
    swipingOutRef.current = false
    swipeAnimRef.current?.stop()
    exitProgress.setValue(0)
    let cancelled = false
    const animation = Animated.timing(exitProgress, {
      toValue: 1,
      duration: reduceMotion ? motionTokens.duration.reduced : 180,
      easing: Easing.bezier(...easingCurve('retreat')),
      useNativeDriver: true,
    })
    animation.start(() => {
      if (!cancelled) onExitCompleteRef.current?.()
    })
    return () => {
      cancelled = true
      animation.stop()
    }
  }, [exiting, exitProgress, reduceMotion])

  useEffect(() => {
    if (!canEdgeSwipe && !exiting) {
      swipingOutRef.current = false
      swipeAnimRef.current?.stop()
      swipeX.setValue(0)
    }
  }, [canEdgeSwipe, exiting, swipeX])

  const panResponder = useMemo(() => {
    const springBack = () => {
      swipeAnimRef.current?.stop()
      const anim = Animated.spring(swipeX, {
        toValue: 0,
        bounciness: motionTokens.spring.bounciness,
        speed: motionTokens.spring.speed,
        useNativeDriver: true,
      })
      swipeAnimRef.current = anim
      anim.start()
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        gestureRef.current.canEdgeSwipe
        && !swipingOutRef.current
        && shouldStartEdgeSwipeBack(gesture.x0, gesture.dx, gesture.dy),
      onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
        gestureRef.current.canEdgeSwipe
        && !swipingOutRef.current
        && shouldStartEdgeSwipeBack(gesture.x0, gesture.dx, gesture.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        swipeAnimRef.current?.stop()
      },
      onPanResponderMove: (_evt, gesture) => {
        if (!gestureRef.current.canEdgeSwipe || swipingOutRef.current) return
        swipeX.setValue(Math.max(0, gesture.dx))
      },
      onPanResponderRelease: (_evt, gesture) => {
        const { canEdgeSwipe: enabled, reduceMotion: reduced, windowWidth: width, onEdgeBack: goBack } = gestureRef.current
        if (!enabled || swipingOutRef.current) {
          springBack()
          return
        }
        if (shouldCommitEdgeSwipeBack(gesture.dx, gesture.vx, width)) {
          swipingOutRef.current = true
          swipeAnimRef.current?.stop()
          if (reduced || !Number.isFinite(width) || width <= 0) {
            goBack?.()
            return
          }
          const anim = Animated.timing(swipeX, {
            toValue: width,
            duration: 180,
            easing: Easing.bezier(...easingCurve('retreat')),
            useNativeDriver: true,
          })
          swipeAnimRef.current = anim
          anim.start(() => {
            if (!unmountedRef.current && swipingOutRef.current) goBack?.()
          })
          return
        }
        springBack()
      },
      onPanResponderTerminate: () => {
        if (!swipingOutRef.current) springBack()
      },
    })
  }, [swipeX])

  const enterTranslateX = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [animateEnter && !reduceMotion ? 24 : 0, 0] }),
    [animateEnter, progress, reduceMotion],
  )
  const exitTranslateX = useMemo(
    () => exitProgress.interpolate({ inputRange: [0, 1], outputRange: [0, reduceMotion ? 0 : 28] }),
    [exitProgress, reduceMotion],
  )
  const exitOpacity = useMemo(
    () => exitProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    [exitProgress],
  )
  const translateX = useMemo(
    () => Animated.add(Animated.add(enterTranslateX, swipeX), exitTranslateX),
    [enterTranslateX, exitTranslateX, swipeX],
  )

  const interactive = active && !exiting

  return (
    <Animated.View
      {...(canEdgeSwipe ? panResponder.panHandlers : undefined)}
      pointerEvents={interactive ? 'auto' : 'none'}
      accessibilityElementsHidden={!interactive}
      importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colors.background,
          zIndex,
          opacity: exiting ? exitOpacity : 1,
          transform: [{ translateX }],
        },
      ]}
    >
      <NavigationFocusProvider value={interactive}>{children}</NavigationFocusProvider>
    </Animated.View>
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
  globalError: { position: 'absolute', left: 0, right: 0, zIndex: 1000 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, backgroundColor: colors.background },
  loadingTitle: { ...type.title, color: colors.ink, textAlign: 'center' },
  loadingBody: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },
  retry: { alignSelf: 'stretch', marginTop: spacing.xl },
  })
}
