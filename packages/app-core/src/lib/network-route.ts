export type NetworkRoute = 'local' | 'remote' | 'unknown'

export type PreferredTransport = 'lan' | 'p2p' | 'turn' | 'relay'

export function networkRouteForNativeType(type: string | null | undefined): NetworkRoute {
  if (type === 'wifi' || type === 'ethernet') return 'local'
  if (type === undefined || type === null || type === 'unknown' || type === 'none') return 'unknown'
  return 'remote'
}

/**
 * Only confirmed moves between local-capable and remote networks require a
 * fresh ICE negotiation. NetInfo reports `unknown` transiently during app
 * startup and Android network validation; treating that as a route change
 * tears down a healthy connection moments after it opens.
 */
export function shouldReconnectForNetworkRoute(
  previous: NetworkRoute | undefined,
  next: NetworkRoute,
): boolean {
  return previous !== undefined
    && previous !== 'unknown'
    && next !== 'unknown'
    && previous !== next
}

/**
 * Keep LAN first whenever the device is on a local-capable network. ICE still
 * validates the candidate pair; this only expresses the preferred order to
 * the Host and Server control plane.
 */
export function automaticPreferredTransports(route: NetworkRoute): PreferredTransport[] {
  if (route === 'remote') return ['p2p', 'turn', 'relay']
  return ['lan', 'p2p', 'turn', 'relay']
}

export function initialProbeTransports(preferredTransports: readonly PreferredTransport[]): PreferredTransport[] {
  // The connection progress must show every route that AdaptiveTransport is
  // allowed to use. Previously this returned only the first direct group
  // (LAN/P2P), so TURN and Relay disappeared from the UI even though they
  // remained active fallbacks in the transport state machine.
  return [...preferredTransports]
}
