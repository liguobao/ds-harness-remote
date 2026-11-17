export type AppRoute =
  | { name: 'server' }
  | { name: 'remote-hosts' }
  | { name: 'device'; deviceId: string }
  | { name: 'connecting'; deviceId: string; sheet?: boolean; focusWorkspaceKey?: string; sessionId?: string }
  | { name: 'chat'; botConversationId?: string; externalOpenRevision?: number }
  | { name: 'settings' }
  | { name: 'diagnostics' }
  | { name: 'about' }

export type ConnectionPhaseLike = 'offline' | 'disconnected' | 'connecting' | 'reconnecting' | 'connected'

/**
 * Sheet-style startup/auto-connect overlays (`sheet: true`) keep the underlying
 * ChatScreen visible and show HostSwitcherSheet above it instead of mounting
 * a full-screen ConnectionScreen.
 */
export function isSheetConnectionRoute(route: AppRoute): boolean {
  return route.name === 'connecting' && route.sheet === true
}

/**
 * Index of the top-most full-screen route in the navigation stack. When the
 * stack top is a sheet-style connecting overlay, the screen underneath (`chat`)
 * remains the visible full-screen base.
 */
export function effectiveTopScreenIndex(routes: readonly AppRoute[]): number {
  if (routes.length === 0) return -1
  const lastIndex = routes.length - 1
  if (lastIndex > 0 && isSheetConnectionRoute(routes[lastIndex]!)) {
    return lastIndex - 1
  }
  return lastIndex
}

/**
 * A route layer is interactive only when it is the effective full-screen top
 * and no global overlay (host switcher, home actions menu) covers it.
 */
export function isRouteActiveScreen(
  routes: readonly AppRoute[],
  index: number,
  overlayOpen: boolean,
): boolean {
  return !overlayOpen && index === effectiveTopScreenIndex(routes)
}

/**
 * Keep the native splash screen visible until boot completes AND the initial
 * route (`server` vs `chat`) has been committed, preventing a 1-frame flash
 * of the wrong initial screen.
 */
export function shouldHideSplashScreen(params: {
  bootPhase: string
  browseReady: boolean
  initialRouteChosen: boolean
}): boolean {
  if (params.bootPhase === 'error') return true
  return params.bootPhase === 'ready' && params.browseReady && params.initialRouteChosen
}

/**
 * Suppress ChatScreen's automatic session selection while a host connection is
 * in flight, a deep-link/resume session is being resolved, or the user is in
 * DS-Bot mode. Allowing auto-select during `connecting` picks a stale cached
 * session before the live catalog arrives and blocks live history loading.
 */
export function shouldSuppressAutoSessionSelect(params: {
  botMode: boolean
  routeName: AppRoute['name']
  connectionPhase: ConnectionPhaseLike
  resolvingKnownSession: boolean
}): boolean {
  if (params.botMode) return true
  if (params.resolvingKnownSession) return true
  if (params.routeName === 'connecting') return true
  if (params.connectionPhase === 'connecting' || params.connectionPhase === 'reconnecting') {
    return true
  }
  return false
}

export type HardwareBackOutcome =
  | { action: 'consume' }
  | { action: 'close-host-switcher' }
  | { action: 'close-home-menu' }
  | { action: 'delegate' }
  | { action: 'pop' }

/**
 * Deterministic top-level Android hardware back resolution used by AppNavigator
 * so listener re-subscription never reorders BackHandler precedence.
 */
export function resolveTopLevelHardwareBack(params: {
  signingOut?: boolean
  hostSwitcherOpen: boolean
  homeMenuOpen: boolean
  route: AppRoute
  routesLength: number
}): HardwareBackOutcome {
  if (params.signingOut) return { action: 'consume' }
  if (params.hostSwitcherOpen) return { action: 'close-host-switcher' }
  if (params.homeMenuOpen) return { action: 'close-home-menu' }
  if (params.route.name === 'connecting') return { action: 'delegate' }
  if (params.routesLength <= 1) return { action: 'delegate' }
  return { action: 'pop' }
}
