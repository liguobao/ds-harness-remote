import { friendlyError, isSessionAuthError } from '../lib/errors'
import { initialProbeTransports } from '../lib/network-route'
import { strings as zhCN } from '../locales/i18n'
import type { AntigravityCatalog } from '../services/antigravity'
import { loadAntigravityCatalog, mergeAntigravityCatalog } from '../services/antigravity'
import { loadCodexCatalog } from '../services/codex'
import { resolveAutomaticPreferredTransports } from '../services/network-route'
import type { OpencodeCatalog } from '../services/opencode'
import type { ClaudeCatalog } from '../services/claude'
import { loadOpencodeCatalog, mergeOpencodeCatalog } from '../services/opencode'
import { loadClaudeCatalog, mergeClaudeCatalog } from '../services/claude'
import type { PiCatalog } from '../services/pi'
import { loadPiCatalog, mergePiCatalog } from '../services/pi'
import { serverSession } from '../services/server-session'
import { saveLastConnectedDeviceId } from '../services/storage'
import type { RemoteSession, WorkspaceView } from '../types'
import { loadSavedCodexPermissions, withBestCodexPermission } from './codex-session-state'
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
      const sameHost = get().selectedDevice?.deviceId === device.deviceId
      // reconnect() marks recovery before delegating here. A direct connect starts
      // a new usage lifecycle even when choosing the same Host again.
      const recovering = sameHost && get().connection.phase === 'reconnecting'
      // In-memory ACP sessions belong to one Host; keep them only across its reconnect.
      set(state => ({
        ...(!recovering ? { currentWorkSessionIds: [] } : {}),
        ...(!sameHost ? { selectedSession: undefined, messages: {}, feedbackBySession: {} } : {}),
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
        workspaces: sameHost ? state.workspaces.filter(workspace => workspace.backend === 'cursor' || workspace.backend === 'antigravity' || workspace.backend === 'pi' || workspace.backend === 'opencode' || workspace.backend === 'claude') : [],
        sessions: sameHost ? state.sessions.filter(session => session.backend === 'cursor' || session.backend === 'antigravity' || session.backend === 'pi' || session.backend === 'opencode' || session.backend === 'claude') : [],
        archivedSessionIds: [],
        sessionModels: undefined,
        error: undefined,
      }))
      try {
        await runtime.connection.prepareConnection()
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
              void get().refreshWorkspaces()
            },
            onSecureHandshake: () => {
              if (generation !== runtime.connectionGeneration) return
              set(state => ({
                connectionStage: 'secure', connection: {
                  ...state.connection, stats: runtime.connection.getStats() ?? state.connection.stats,
                }
              }))
            },
            onClose: () => {
              if (generation !== runtime.connectionGeneration) return
              // Drop local stream handles so reconnect opens a fresh stream.
              void runtime.closeActiveCodexStream(false)
              void runtime.closeActiveCursorStream(false)
              if (get().connection.phase !== 'disconnected') {
                ++runtime.connectionGeneration
                ++runtime.sessionLoadGeneration
                set({
                  connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.hostClosed },
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
        const [hostDescriptor, workspaceList, sessions] = await Promise.all([
          proxy.hostDescribe(),
          proxy.workspaceList(),
          proxy.sessionList(),
        ])
        let codexCatalog = { workspaces: [] as WorkspaceView[], sessions: [] as RemoteSession[] }
        let codexError: string | undefined
        if (runtime.connection.hasCodex()) {
          try {
            codexCatalog = await loadCodexCatalog(runtime.connection.requireCodex())
          } catch (error) {
            codexError = friendlyError(error)
          }
        }
        let agyCatalog: AntigravityCatalog | undefined
        let agyError: string | undefined
        if (runtime.connection.hasAntigravity()) {
          try { agyCatalog = await loadAntigravityCatalog(runtime.connection.requireAntigravity(), get().workspaces) }
          catch (error) { agyError = friendlyError(error) }
        }
        let piCatalog: PiCatalog | undefined
        let piError: string | undefined
        if (runtime.connection.hasPi()) {
          try { piCatalog = await loadPiCatalog(runtime.connection.requirePi(), get().workspaces) }
          catch (error) { piError = friendlyError(error) }
        }
        let opencodeCatalog: OpencodeCatalog | undefined
        let opencodeError: string | undefined
        if (runtime.connection.hasOpencode()) {
          try { opencodeCatalog = await loadOpencodeCatalog(runtime.connection.requireOpencode(), get().workspaces) }
          catch (error) { opencodeError = friendlyError(error) }
        }
        let claudeCatalog: ClaudeCatalog | undefined
        let claudeError: string | undefined
        if (runtime.connection.hasClaude()) {
          try { claudeCatalog = await loadClaudeCatalog(runtime.connection.requireClaude(), get().workspaces) }
          catch (error) { claudeError = friendlyError(error) }
        }
        const savedCodexPermissions = await loadSavedCodexPermissions(device.deviceId)
        const connectionNetworkDetails = await runtime.connection.getNetworkDetails().catch(() => undefined)
        if (generation !== runtime.connectionGeneration) return false
        set(state => {
          const codexSessions = codexCatalog.sessions.map(session => {
            const previous = state.sessions.find(item => item.sessionId === session.sessionId)
              ?? (state.selectedSession?.sessionId === session.sessionId ? state.selectedSession : undefined)
            return withBestCodexPermission(session, previous, savedCodexPermissions)
          })
          const cursorWorkspaces = state.workspaces.filter(workspace => workspace.backend === 'cursor')
          const agy = mergeAntigravityCatalog(agyCatalog ?? { workspaces: [], sessions: [] }, state.workspaces, state.sessions)
          const antigravityWorkspaces = agy.workspaces
          const opc = mergeOpencodeCatalog(opencodeCatalog ?? { workspaces: [], sessions: [] }, state.workspaces, state.sessions)
          const claudeData = mergeClaudeCatalog(claudeCatalog ?? { workspaces: [], sessions: [] }, state.workspaces, state.sessions)
          const opencodeWorkspaces = opc.workspaces
          const claudeWorkspaces = claudeData.workspaces
          const cursorSessions = state.sessions.filter(session => session.backend === 'cursor')
          const antigravitySessions = agy.sessions
          const pi = mergePiCatalog(piCatalog ?? { workspaces: [], sessions: [] }, state.workspaces, state.sessions)
          const piWorkspaces = runtime.connection.hasPi() ? pi.workspaces : []
          const piSessions = pi.sessions
          const opencodeSessions = opc.sessions
          const claudeSessions = claudeData.sessions
          const combinedSessions = [...sessions, ...codexSessions, ...cursorSessions, ...antigravitySessions, ...piSessions, ...opencodeSessions, ...claudeSessions]
          const selectedSession = state.selectedSession === undefined
            ? undefined
            : combinedSessions.find(session => session.sessionId === state.selectedSession?.sessionId)
            ?? state.selectedSession
          return {
            hostDescriptor,
            codexAvailable: runtime.connection.hasCodex(),
            cursorAvailable: runtime.connection.hasCursor(),
            antigravityAvailable: runtime.connection.hasAntigravity(),
            piAvailable: runtime.connection.hasPi(),
            opencodeAvailable: runtime.connection.hasOpencode(),
            claudeAvailable: runtime.connection.hasClaude(),
            workspaces: [...workspaceList.items, ...codexCatalog.workspaces, ...cursorWorkspaces, ...antigravityWorkspaces, ...piWorkspaces, ...opencodeWorkspaces, ...claudeWorkspaces],
            archivedSessionIds: workspaceList.archivedSessionIds,
            sessions: combinedSessions,
            selectedSession,
            connectionStage: 'ready',
            connectionNetworkDetails,
            lastConnectedDeviceId: device.deviceId,
            pendingAutoConnectDeviceId: undefined,
            connection: { phase: 'connected', stats: runtime.connection.getStats() ?? { mode: 'Relay', connected: true } },
            ...(codexError === undefined && agyError === undefined && piError === undefined && opencodeError === undefined && claudeError === undefined ? {} : { error: codexError ?? agyError ?? piError ?? opencodeError ?? claudeError }),
          }
        })
        runtime.connectionStartedAt = Date.now()
        await saveLastConnectedDeviceId(device.deviceId)
        return true
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        await runtime.connection.close()
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
        await get().reconnect()
        return
      }
      if (generation !== runtime.connectionGeneration || current.connection.phase !== 'connected') return
      if (!healthy) await get().reconnect()
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
          connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.networkUnavailable },
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
