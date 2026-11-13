import { browseScope, useBrowseMemory } from '../services/browse-memory'
import { friendlyError, isSessionAuthError } from '../lib/errors'
import { initialProbeTransports } from '../lib/network-route'
import { strings as zhCN } from '../locales/i18n'
import { resolveAutomaticPreferredTransports } from '../services/network-route'
import { serverSession } from '../services/server-session'
import { saveLastConnectedDeviceId } from '../services/storage'
import type { SessionAccess } from './session-runtime'
import type { AppState } from './store-state'
import { disconnected } from './store-state'

/** Connection actions use the store's single connection/session runtime. */
const RELAY_DOWNGRADE_MS = 10 * 60_000

export function createConnectionActions({ get, set, runtime }: SessionAccess): Pick<AppState,
  'connectDevice' | 'reconnect' | 'resumeConnection' | 'refreshConnectionNetworkDetails' | 'disconnect' | 'setOffline'> {
  return {
    async connectDevice(device, options = {}) {
      const { config, identity } = get()
      if (config === undefined || identity === undefined) return false
      const generation = ++runtime.connectionGeneration
      ++runtime.sessionLoadGeneration
      runtime.sessionReadAbort?.abort()
      runtime.clearHarnessCatalogSync()
      const memory = useBrowseMemory.getState()
      const scope = browseScope({...get(), selectedDevice: device})
      const cached = device.trusted ? memory.catalogs[scope] : undefined
      const sameHost = get().selectedDevice?.deviceId === device.deviceId
      if (!sameHost) runtime.webRtcFallbackStreak = 0
      // reconnect() marks recovery before delegating here. A direct connect starts
      // a new usage lifecycle even when choosing the same Host again.
      const recovering = sameHost && get().connection.phase === 'reconnecting'
      // In-memory catalogs belong to one Host; keep them only across its reconnect.
      set(state => ({
        ...(!recovering ? { currentWorkSessionIds: [] } : {}),
        ...(!sameHost ? { selectedSession: undefined, messages: {}, feedbackBySession: {}, relayOnlyUntil: undefined } : {}),
        sessionLifecycles: {},
        sessionProjectionSeqs: {},
        permissionSelecting: false,
        modelSelecting: false,
        busyAction: undefined,
        codexReadySessionId: undefined,
        selectedDevice: device,
        connection: { phase: 'connecting', stats: { mode: 'Disconnected', connected: false } },
        connectionStage: 'authenticating',
        connectionProbeOrder: [],
        connectionNetworkDetails: undefined,
        hostDescriptor: undefined,
        hostSessionEvents: false,
        codexAvailable: false,
        cursorAvailable: false,
        antigravityAvailable: false,
        piAvailable: false,
        opencodeAvailable: false,
        claudeAvailable: false,
        hermesAvailable: false,
        workspaceCatalog: undefined,
        workspaces: sameHost ? state.workspaces : cached?.workspaces ?? [],
        sessions: sameHost ? state.sessions : cached?.sessions ?? [],
        archivedSessionIds: sameHost ? state.archivedSessionIds : [],
        pinnedSessionIds: sameHost ? state.pinnedSessionIds : [],
        sessionModels: undefined,
        error: undefined,
      }))
      try {
        await runtime.connection.prepareConnection(recovering)
        if (generation !== runtime.connectionGeneration) return false
        await runtime.closeActiveCodexStream(false)
        await runtime.closeActiveCursorStream(false)
        const { api, credentials } = await serverSession.authenticate(config.baseUrl, identity)
        const preference = get().transportPreference
        const relayOnlyActive = (get().relayOnlyUntil ?? 0) > Date.now()
        const forceRelay = options.forceRelay === true || preference === 'relay' || relayOnlyActive
        const preferredTransports = forceRelay
          ? ['relay'] as const
          : preference === 'turn'
            ? ['turn', 'relay'] as const
            : await resolveAutomaticPreferredTransports()
        if (generation !== runtime.connectionGeneration) return false
        set({ connectionStage: 'transport', connectionProbeOrder: initialProbeTransports(preferredTransports) })
        await runtime.connection.connect(
          config.baseUrl,
          identity,
          device,
          credentials.accessToken,
          frame => runtime.enqueueMuxFrame(generation, frame),
          {
            refreshAccessToken: async () => (await serverSession.authenticate(config.baseUrl, identity)).credentials.accessToken,
            fetchIceServers: async connectionId => api.turnCredentials(connectionId),
            preferredTransports: [...preferredTransports],
            forceRelay,
            onWebRtcFallback: () => {
              if (generation !== runtime.connectionGeneration) return
              // Repeated negotiation failures on this host: remember to go
              // straight to the relay data plane for a while.
              runtime.webRtcFallbackStreak += 1
              if (runtime.webRtcFallbackStreak >= 2) {
                set({ relayOnlyUntil: Date.now() + RELAY_DOWNGRADE_MS })
              }
            },
            onOpencodeArchived: nativeId => {
              if (generation !== runtime.connectionGeneration) return
              const sessionId = `opencode:${nativeId}`
              set(state => ({
                sessions: state.sessions.filter(item => item.sessionId !== sessionId),
                workspaces: state.workspaces.map(workspace => ({ ...workspace, sessionIds: workspace.sessionIds.filter(id => id !== sessionId) })),
              }))
              if (get().workspaceCatalog?.backend === 'opencode') void get().refreshWorkspaces('opencode')
            },
            onSecureHandshake: () => {
              if (generation !== runtime.connectionGeneration) return
              set(state => ({
                connectionStage: 'secure', connection: {
                  ...state.connection, stats: runtime.connection.getStats() ?? state.connection.stats,
                }
              }))
            },
            onClose: closeOptions => {
              if (generation !== runtime.connectionGeneration) return
              // Drop local stream handles so reconnect opens a fresh stream.
              void runtime.closeActiveCodexStream(false)
              void runtime.closeActiveCursorStream(false)
              runtime.clearHarnessCatalogSync()
              if (get().connection.phase !== 'disconnected') {
                ++runtime.connectionGeneration
                ++runtime.sessionLoadGeneration
                // An established P2P/LAN/TURN path dropping is the unstable
                // network case: remember relay-only for a while so recovery
                // reconnects instantly over the relay instead of re-climbing
                // LAN -> P2P -> TURN every time.
                if (closeOptions?.lastTransport === 'lan' || closeOptions?.lastTransport === 'p2p' || closeOptions?.lastTransport === 'turn') {
                  set({ relayOnlyUntil: Date.now() + RELAY_DOWNGRADE_MS })
                }
                set({
                  connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.hostClosed,
                    retryable: closeOptions?.retryable !== false },
                  connectionStage: undefined,
                  hostSessionEvents: false,
                  codexAvailable: false,
                  cursorAvailable: false,
                  antigravityAvailable: false,
                  piAvailable: false,
                  opencodeAvailable: false,
                  claudeAvailable: false,
                  hermesAvailable: false,
                  busyAction: undefined,
                })
              }
            },
          },
        )
        if (generation !== runtime.connectionGeneration) return false
        set({ connectionStage: 'loading' })
        const proxy = runtime.connection.requireProxy()
        // Catalogs belong to the category the user opens, not connection setup.
        const hostDescriptor = await proxy.hostDescribe()
        const connectionNetworkDetails = await runtime.connection.getNetworkDetails().catch(() => undefined)
        if (generation !== runtime.connectionGeneration) return false
        const connectedStats = runtime.connection.getStats() ?? { mode: 'Relay', connected: true }
        runtime.webRtcFallbackStreak = 0
        set({
          hostDescriptor,
          hostSessionEvents: runtime.connection.hasSessionEvents(),
          codexAvailable: runtime.connection.hasCodex(),
          cursorAvailable: runtime.connection.hasCursor(),
          antigravityAvailable: runtime.connection.hasAntigravity(),
          piAvailable: runtime.connection.hasPi(),
          opencodeAvailable: runtime.connection.hasOpencode(),
          claudeAvailable: runtime.connection.hasClaude(),
        hermesAvailable: runtime.connection.hasHermes(),
          connectionStage: 'ready',
          connectionNetworkDetails,
          lastConnectedDeviceId: device.deviceId,
          pendingAutoConnectDeviceId: undefined,
          connection: { phase: 'connected', stats: connectedStats },
          ...(connectedStats.mode !== 'Relay' && connectedStats.mode !== 'Disconnected' ? { relayOnlyUntil: undefined } : {}),
        })
        runtime.connectionStartedAt = Date.now()
        await saveLastConnectedDeviceId(device.deviceId)
        return true
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        // Capture before close(): the carrier's close handler clears it.
        const failedStage = get().connectionStage
        console.warn('[dsh-remote] Connection setup failed at stage:', failedStage, error)
        await runtime.connection.close({ preserveRecovery: recovering && !isSessionAuthError(error) })
        if (isSessionAuthError(error)) {
          await get().requireReauth(friendlyError(error))
          return false
        }
        const message = friendlyError(error)
        const errorCode = error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
          ? (error as Error & { code: string }).code
          : undefined
        const retryable = error instanceof Error && typeof (error as Error & { retryable?: unknown }).retryable === 'boolean'
          ? (error as Error & { retryable: boolean }).retryable
          : undefined
        // Failure inside transport negotiation means P2P/TURN could not
        // establish: remember relay-only so the automatic retry (and the next
        // manual attempt) skips the multi-second WebRTC wait entirely.
        set({
          connection: {
            phase: 'offline',
            stats: { mode: 'Disconnected', connected: false },
            error: message,
            ...(errorCode !== undefined ? { errorCode } : {}),
            ...(retryable !== undefined ? { retryable } : {}),
          },
          connectionStage: undefined,
          ...(failedStage === 'transport' ? { relayOnlyUntil: Date.now() + RELAY_DOWNGRADE_MS } : {}),
          codexAvailable: false,
          cursorAvailable: false,
          antigravityAvailable: false,
          piAvailable: false,
          opencodeAvailable: false,
          claudeAvailable: false,
          hermesAvailable: false,
          error: message,
        })
        return false
      }
    },

    reconnect(options = {}) {
      if (runtime.reconnectFlight !== undefined) return runtime.reconnectFlight
      const device = get().selectedDevice
      const phase = get().connection.phase
      if (device === undefined || phase === 'connecting' || phase === 'reconnecting') return Promise.resolve(false)
      set(state => ({ connection: { ...state.connection, phase: 'reconnecting', error: undefined } }))
      const task = (async () => {
        if (!await get().connectDevice(device, options)) return false
        const session = get().selectedSession
        if (options.restoreSession !== false && session !== undefined) return get().openSession(session)
        return true
      })()
      runtime.reconnectFlight = task
      void task.finally(() => { if (runtime.reconnectFlight === task) runtime.reconnectFlight = undefined })
      return task
    },

    async resumeConnection() {
      const { selectedDevice, connection } = get()
      if (selectedDevice === undefined) return
      if (connection.phase === 'offline') {
        if (connection.retryable === false) return
        await get().reconnect()
        return
      }
      if (connection.phase !== 'connected') return
      const generation = runtime.connectionGeneration
      // Both probes may race onClose, explicit disconnect or Host replacement.
      const canContinueAfterProbe = async () => {
        const current = get()
        if (current.selectedDevice?.deviceId !== selectedDevice.deviceId) return false
        // onClose can invalidate the generation while confirming a retryable
        // offline carrier. Recover it before rejecting stale probe results.
        if (current.connection.phase === 'offline') {
          if (current.connection.retryable !== false) await get().reconnect()
          return false
        }
        return generation === runtime.connectionGeneration && current.connection.phase === 'connected'
      }
      const healthy = await runtime.connection.checkHealth().catch(() => false)
      if (!await canContinueAfterProbe()) return
      if (!healthy) {
        const retryHealthy = await runtime.connection.checkHealth().catch(() => false)
        if (!await canContinueAfterProbe()) return
        if (!retryHealthy) {
          console.info('[dsh-remote] Resume health check failed; reconnecting')
          await get().reconnect()
        } else {
          console.info('[dsh-remote] Resume health restored after retry')
          await get().refreshConnectionNetworkDetails()
        }
      }
      else await get().refreshConnectionNetworkDetails()
    },

    async refreshConnectionNetworkDetails() {
      if (get().connection.phase !== 'connected') return
      const details = await runtime.connection.getNetworkDetails().catch(() => undefined)
      if (details !== undefined && get().connection.phase === 'connected') {
        set(state => ({
          connectionNetworkDetails: details,
          connection: { ...state.connection, stats: runtime.connection.getStats() ?? state.connection.stats },
        }))
      }
    },

    async disconnect() {
      runtime.flushPendingMuxFrames()
      ++runtime.connectionGeneration
      ++runtime.sessionLoadGeneration
      runtime.reconnectFlight = undefined
      runtime.clearPendingMuxFrames()
      runtime.clearHarnessCatalogSync()
      await runtime.closeActiveCodexStream(false)
      await runtime.closeActiveCursorStream(false)
      await runtime.connection.close()
      runtime.codexModelSelections.clear()
      set({
        connection: disconnected,
        connectionStage: undefined,
        connectionProbeOrder: [],
        connectionNetworkDetails: undefined,
        selectedDevice: undefined,
        hostDescriptor: undefined,
        hostSessionEvents: false,
        codexAvailable: false,
        cursorAvailable: false,
        antigravityAvailable: false,
        piAvailable: false,
        opencodeAvailable: false,
        claudeAvailable: false,
        hermesAvailable: false,
        workspaceCatalog: undefined,
        workspaces: [],
        archivedSessionIds: [],
        pinnedSessionIds: [],
        sessions: [],
        selectedSession: undefined,
        scheduleTasks: [],
        scheduleLoading: false,
        scheduleError: undefined,
        currentWorkSessionIds: [],
        sessionLifecycles: {},
        sessionProjectionSeqs: {},
        sessionModels: undefined,
        historyHasMore: false,
        historyLoadingOlder: false,
        oldestLoadedSeq: undefined,
      })
    },

    setOffline() {
      if (get().connection.phase !== 'disconnected') {
        runtime.flushPendingMuxFrames()
        ++runtime.sessionLoadGeneration
        runtime.clearPendingMuxFrames()
        runtime.clearHarnessCatalogSync()
        set({
          connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.networkUnavailable,
            ...(get().connection.retryable === false ? { retryable: false } : {}) },
          hostSessionEvents: false,
          codexAvailable: false,
          busyAction: undefined,
          cursorAvailable: false,
          antigravityAvailable: false,
          piAvailable: false,
          opencodeAvailable: false,
          claudeAvailable: false,
          hermesAvailable: false,
        })
      }
    },
  }
}
