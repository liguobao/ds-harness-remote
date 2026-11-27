import { describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type { ConnectionNetworkDetails, ConnectionSnapshot } from '../src/types'

const storeState = vi.hoisted(() => ({
  selectedDevice: { deviceId: 'host-1' } as { deviceId: string } | undefined,
  connection: {
    phase: 'connected',
    stats: { mode: 'Relay' as const, connected: true },
  } as ConnectionSnapshot,
  connectionProbeOrder: [] as string[],
  connectionNetworkDetails: undefined as ConnectionNetworkDetails | undefined,
  refreshConnectionNetworkDetails: vi.fn(async () => undefined),
}))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: () => undefined,
    useRef: <T,>(value: T) => ({ current: value }),
    useState: <T,>(initial: T | (() => T)) => [typeof initial === 'function' ? (initial as () => T)() : initial, vi.fn()],
  }
})

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'ios' },
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

vi.mock('lucide-react-native', () => new Proxy({}, { get: (_target, prop) => String(prop) }))
vi.mock('../src/ui/animated-ellipsis', () => ({ AnimatedEllipsis: 'AnimatedEllipsis' }))
vi.mock('../src/ui/alert', () => ({ Alert: { alert: vi.fn() } }))
vi.mock('../src/ui/components', () => ({
  BlurHeaderFrame: 'BlurHeaderFrame',
  Button: 'Button',
  GroupCard: 'GroupCard',
  GroupRow: 'GroupRow',
  IconButton: 'IconButton',
  KeyValue: 'KeyValue',
  Screen: 'Screen',
  SectionTitle: 'SectionTitle',
  TopBar: 'TopBar',
}))
vi.mock('../src/ui/theme', () => ({
  floatingShadow: () => ({}),
  radius: { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, pill: 999 },
  spacing: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  type: { title: {}, heading: {}, body: {}, bodyStrong: {}, small: {}, smallStrong: {}, caption: {} },
}))
vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => ({ colors: {} }),
}))
vi.mock('../src/ui/responsive', () => ({
  useResponsiveLayout: () => ({ contentMaxWidth: 720, landscape: false }),
}))
vi.mock('../src/ui/use-themed-styles', () => ({
  useThemedStyles: (create: (colors: Record<string, string>) => unknown) => create({}),
}))
vi.mock('../src/screens/dsh-web-screen', () => ({ DshWebScreen: 'DshWebScreen' }))
vi.mock('../src/screens/device-rename-modal', () => ({ DeviceRenameModal: 'DeviceRenameModal' }))
vi.mock('../src/screens/connection-hero', () => ({ ConnectionHero: 'ConnectionHero' }))
vi.mock('../src/state/session-catalog-commands', () => ({ shouldPollSessionStatus: () => false }))
vi.mock('../src/state/store', () => ({
  requireConnectionRpc: vi.fn(),
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))

import { DeviceConnectionInfo, hasConnectionNetworkDetails } from '../src/screens/device-screens'
import { strings as zhCN } from '../src/locales/i18n'

type ElementNode = { type: unknown; props?: Record<string, unknown> }

function collectElements(node: unknown, predicate: (el: ElementNode) => boolean, out: ElementNode[] = []): ElementNode[] {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) collectElements(item, predicate, out)
    return out
  }
  const el = node as ElementNode
  if (predicate(el)) out.push(el)
  return collectElements(el.props?.children, predicate, out)
}

function findNetworkDetailsSection(tree: unknown): ElementNode | undefined {
  return collectElements(tree, el => el.type === 'View').find(view =>
    collectElements(view.props?.children, child =>
      child.type === 'SectionTitle' && child.props?.children === zhCN.devices.networkDetails,
    ).length > 0,
  )
}

describe('DeviceConnectionInfo network details section visibility', () => {
  it('omits the empty network details section in Relay mode when no detail rows are available', async () => {
    const relayDetails: ConnectionNetworkDetails = {
      controlChannelUrl: 'wss://relay.example.com/ws',
      controlChannelState: 'open',
      preferredTransports: ['relay'],
      negotiatedCapabilities: ['transport.relay'],
      webRtcEnabled: false,
      relay: { path: 'control' },
    }
    const detailsWithoutRelay: ConnectionNetworkDetails = {
      controlChannelUrl: 'wss://relay.example.com/ws',
      controlChannelState: 'open',
      preferredTransports: ['relay'],
      negotiatedCapabilities: ['transport.relay'],
      webRtcEnabled: false,
    }

    await runScenarios([
      {
        name: 'Relay without networkDetails or traffic hides network details section',
        run: () => {
          storeState.connection = { phase: 'connected', stats: { mode: 'Relay', connected: true } }
          storeState.connectionNetworkDetails = undefined
          expect(hasConnectionNetworkDetails(storeState.connection.stats, undefined)).toBe(false)
          const tree = DeviceConnectionInfo({ deviceId: 'host-1' })
          expect(findNetworkDetailsSection(tree)).toBeUndefined()
        },
      },
      {
        name: 'Relay with traffic stats renders non-empty network details section',
        run: () => {
          storeState.connection = { phase: 'connected', stats: { mode: 'Relay', connected: true, bytesSent: 128 } }
          storeState.connectionNetworkDetails = undefined
          expect(hasConnectionNetworkDetails(storeState.connection.stats, undefined)).toBe(true)
          const tree = DeviceConnectionInfo({ deviceId: 'host-1' })
          const section = findNetworkDetailsSection(tree)
          expect(section).toBeDefined()
          expect(collectElements(section, el => el.type === 'KeyValue').length).toBeGreaterThan(0)
        },
      },
      {
        name: 'Relay with networkDetails and relay renders non-empty network details section',
        run: () => {
          storeState.connection = { phase: 'connected', stats: { mode: 'Relay', connected: true } }
          storeState.connectionNetworkDetails = relayDetails
          expect(hasConnectionNetworkDetails(storeState.connection.stats, relayDetails)).toBe(true)
          const tree = DeviceConnectionInfo({ deviceId: 'host-1' })
          const section = findNetworkDetailsSection(tree)
          expect(section).toBeDefined()
          expect(collectElements(section, el => el.type === 'KeyValue').length).toBeGreaterThan(0)
        },
      },
      {
        name: 'Relay with networkDetails but relay undefined renders non-empty network details section',
        run: () => {
          storeState.connection = { phase: 'connected', stats: { mode: 'Relay', connected: true } }
          storeState.connectionNetworkDetails = detailsWithoutRelay
          expect(hasConnectionNetworkDetails(storeState.connection.stats, detailsWithoutRelay)).toBe(true)
          const tree = DeviceConnectionInfo({ deviceId: 'host-1' })
          const section = findNetworkDetailsSection(tree)
          expect(section).toBeDefined()
          expect(collectElements(section, el => el.type === 'KeyValue').length).toBeGreaterThan(0)
        },
      },
      {
        name: 'Non-Relay modes keep non-empty network details section even before networkDetails arrives',
        run: () => {
          for (const mode of ['LAN', 'P2P', 'TURN'] as const) {
            storeState.connection = { phase: 'connected', stats: { mode, connected: true } }
            storeState.connectionNetworkDetails = undefined
            expect(hasConnectionNetworkDetails(storeState.connection.stats, undefined)).toBe(true)
            const tree = DeviceConnectionInfo({ deviceId: 'host-1' })
            const section = findNetworkDetailsSection(tree)
            expect(section).toBeDefined()
            expect(collectElements(section, el => el.type === 'KeyValue').length).toBeGreaterThan(0)
          }
        },
      },
    ])
  })
})
