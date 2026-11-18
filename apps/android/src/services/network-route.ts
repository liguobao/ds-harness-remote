import NetInfo from '@react-native-community/netinfo'
import { automaticPreferredTransports, networkRouteForNativeType, type PreferredTransport } from '../lib/network-route'

/**
 * Reads the native network type before opening the encrypted transport. An
 * unknown result keeps LAN enabled: ICE host candidates remain safe and will
 * fall back to P2P, TURN, then Relay if no local route is available.
 */
export async function resolveAutomaticPreferredTransports(): Promise<PreferredTransport[]> {
  try {
    const state = await NetInfo.fetch()
    return automaticPreferredTransports(networkRouteForNativeType(state.type))
  } catch {
    return automaticPreferredTransports('unknown')
  }
}
