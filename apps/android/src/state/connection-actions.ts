import { browseScope, browseKey, useBrowseMemory } from '../services/browse-memory'
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
export function createConnectionActions({ get, set, runtime }: SessionAccess): Pick<AppState,
  'connectDevice' | 'reconnect' | 'resumeConnection' | 'refreshConnectionNetworkDetails' | 'disconnect' | 'setOffline'> {
  return {
    async connectDevice(device, options = {}) {
      const { config, identity } = get()
      if (config === undefined || identity === undefined) return false
      const generation = ++runtime.connectionGeneration
      ++runtime.sessionLoadGeneration
      runtime.sessionReadAbort?.abort()
      const memory = useBrowseMemory.getState()
      const scope = browseScope({...get(), selectedDevice: device})
      const cached = device.trusted ? memory.catalogs[scope] : undefined
      const sameHost = get().selectedDevice?.deviceId === device.deviceId
      // reconnect() marks recovery before delegating here. A direct connect starts
      // a new usage lifecycle even when choosing the same Host again.
      const recovering = sameHost && get().connection.phase === 'reconnecting'
      // In-memory catalogs belong to one Host; keep them only across its reconnect.
      set(state => ({
        ...(!recovering ? { currentWorkSessionIds: [] } : {}),
        ...(!sameHost ? { selectedSession: undefined, messages: Object.fromEntries((cached?.sessions ?? []).map(s => [s.sessionId, memory.entries[browseKey(scope, s.sessionId)]?.messages ?? []])), feedbackBySession: {} } : {}),
        sessionLifecycles: {},
        sessionProjectionSeqs: {},
        permissionSelecting: false,
        modelSelecting: false,
        busyAction: undefined,
        selectedDevice: device,
        connection: { phase: 'connecting', stats: { mode: 'Disconnected', connected: false } },
        connectionStage: 'authenticating',
        connectionProbeOrder: [],
        connectionNetworkDetails: undefined,
        hostDescriptor: undefined,
        codexAvailable: false,
        cursorAvailable: false,
        antigravityAvailable: false,
        piAvailable: false,
        opencodeAvailable: false,
        claudeAvailable: false,
        workspaceCatalog: undefined,
        workspaces: sameHost ? state.workspaces : cached?.workspaces ?? [],
        sessions: sameHost ? state.sessions : cached?.sessions ?? [],
        archivedSessionIds: sameHost ? state.archivedSessionIds : [],
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
        const forceRelay = options.forceRelay === true || preference === 'relay'
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
            fetchIceServers: async connectionId => api.turnCredentials(connectionId),
            preferredTransports: [...preferredTransports],
            forceRelay,
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
              if (get().connection.phase !== 'disconnected') {
                ++runtime.connectionGeneration
                ++runtime.sessionLoadGeneration
                set({
                  connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.hostClosed,
                    retryable: closeOptions?.retryable !== false },
                  codexAvailable: false,
                  cursorAvailable: false,
                  antigravityAvailable: false,
                  piAvailable: false,
                  opencodeAvailable: false,
                  claudeAvailable: false,
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
        set({
          hostDescriptor,
          codexAvailable: runtime.connection.hasCodex(),
          cursorAvailable: runtime.connection.hasCursor(),
          antigravityAvailable: runtime.connection.hasAntigravity(),
          piAvailable: runtime.connection.hasPi(),
          opencodeAvailable: runtime.connection.hasOpencode(),
          claudeAvailable: runtime.connection.hasClaude(),
          connectionStage: 'ready',
          connectionNetworkDetails,
          lastConnectedDeviceId: device.deviceId,
          pendingAutoConnectDeviceId: undefined,
          connection: { phase: 'connected', stats: runtime.connection.getStats() ?? { mode: 'Relay', connected: true } },
        })
        runtime.connectionStartedAt = Date.now()
        await saveLastConnectedDeviceId(device.deviceId)
        return true
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        console.warn('[dsh-remote] Connection setup failed at stage:', get().connectionStage)
        await runtime.connection.close({ preserveRecovery: recovering && !isSessionAuthError(error) })
        if (isSessionAuthError(error)) {
          await get().requireReauth(friendlyError(error))
          return false
        }
        const message = friendlyError(error)
        set({
          connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: message },
          codexAvailable: false,
          cursorAvailable: false,
          antigravityAvailable: false,
          piAvailable: false,
          opencodeAvailable: false,
          claudeAvailable: false,
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
      const healthy = await runtime.connection.checkHealth()
      const current = get()
      if (current.selectedDevice?.deviceId !== selectedDevice.deviceId) return
      // onClose may have invalidated the generation while the probe was in
      // flight. Resume must still recover that newly confirmed offline state.
      if (current.connection.phase === 'offline') {
        if (current.connection.retryable === false) return
        await get().reconnect()
        return
      }
      if (generation !== runtime.connectionGeneration || current.connection.phase !== 'connected') return
      if (!healthy) {
        console.info('[dsh-remote] Resume health check failed; reconnecting')
        await get().reconnect()
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
      runtime.clearQueueAdoption()
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
        codexAvailable: false,
        cursorAvailable: false,
        antigravityAvailable: false,
        piAvailable: false,
        opencodeAvailable: false,
        claudeAvailable: false,
        workspaceCatalog: undefined,
        workspaces: [],
        archivedSessionIds: [],
        sessions: [],
        selectedSession: undefined,
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
        runtime.clearQueueAdoption()
        set({
          connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.networkUnavailable,
            ...(get().connection.retryable === false ? { retryable: false } : {}) },
          codexAvailable: false,
          busyAction: undefined,
          cursorAvailable: false,
          antigravityAvailable: false,
          piAvailable: false,
          opencodeAvailable: false,
          claudeAvailable: false,
        })
      }
    },
  }
}
