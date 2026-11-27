import { cursorNativeId, finalizeAssistantLive, foldAcpHistory, mergeAcpHistoryAndLive, readAcpHistory } from '../services/cursor'
import { browseScope, saveSessionMessagesSnapshot, useBrowseMemory } from '../services/browse-memory'
import { friendlyError, isSessionAuthError } from '../lib/errors'
import { initialProbeTransports, type PreferredTransport } from '../lib/network-route'
import { invalidateCatalogMetadata, registerAcpBackendId } from '../lib/session-backend'
import { isAcpManagedBackend } from '../lib/workspace-key'
import { strings as zhCN } from '../locales/i18n'
import { resolveAutomaticPreferredTransports } from '../services/network-route'
import { serverSession } from '../services/server-session'
import { sessionFileStatCache } from '../services/file-stat-cache'
import { saveLastConnectedDeviceId } from '../services/storage'
import { useAttentionStore } from './attention-store'
import { isTerminalLocalMessage } from './message-helpers'
import { acpClientForBackend, storeAcpPagedMessages } from './session-actions'
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
      sessionFileStatCache.clear()
      const memory = useBrowseMemory.getState()
      const scope = browseScope({...get(), selectedDevice: device})
      const cached = device.trusted ? memory.catalogs[scope] : undefined
      // Register cached custom backend prefixes before the first Harness refresh.
      for (const item of [...(cached?.workspaces ?? []), ...(cached?.sessions ?? [])]) {
        if (item.backend !== undefined) registerAcpBackendId(item.backend)
      }
      const sameHost = get().selectedDevice?.deviceId === device.deviceId
      if (!sameHost) {
        runtime.webRtcFallbackStreak = 0
        void useAttentionStore.getState().detachConnection()
      }
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
        agentPresetSelecting: false,
        agentPresetLoading: false,
        busyAction: undefined,
        codexReadySessionId: undefined,
        selectedDevice: device,
        connection: { phase: 'connecting', stats: { mode: 'Disconnected', connected: false } },
        connectionStage: 'authenticating',
        connectionProbeOrder: [],
        connectionNetworkDetails: undefined,
        hostDescriptor: undefined,
        hostSessionEvents: false,
        hostWorkspaceGit: false,
        codexAvailable: false,
        cursorAvailable: false,
        antigravityAvailable: false,
        piAvailable: false,
        opencodeAvailable: false,
        claudeAvailable: false,
        hermesAvailable: false,
        kimiAvailable: false,
        workspaceCatalog: undefined,
        workspaces: sameHost ? state.workspaces : cached?.workspaces ?? [],
        sessions: sameHost ? state.sessions : cached?.sessions ?? [],
        archivedSessionIds: sameHost ? state.archivedSessionIds : cached?.archivedSessionIds ?? [],
        pinnedSessionIds: sameHost ? state.pinnedSessionIds : cached?.pinnedSessionIds ?? [],
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
        const requestedTransports: readonly PreferredTransport[] = preference === 'turn'
          ? ['turn', 'relay'] as const
          : await resolveAutomaticPreferredTransports()
        // A failure remembered on cellular must not suppress LAN negotiation
        // after returning to Wi-Fi (or during an unknown startup network state).
        const relayOnlyActive = !requestedTransports.includes('lan')
          && (get().relayOnlyUntil ?? 0) > Date.now()
        const forceRelay = options.forceRelay === true || preference === 'relay' || relayOnlyActive
        const preferredTransports = forceRelay ? ['relay'] as const : requestedTransports
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
            liveTransportUpgrade: !forceRelay && preference === 'auto',
            onTransportUpgraded: () => {
              if (generation !== runtime.connectionGeneration) return
              void get().refreshConnectionNetworkDetails()
            },
            onWebRtcFallback: () => {
              if (generation !== runtime.connectionGeneration) return
              // Repeated negotiation failures on this host: remember to go
              // straight to the relay data plane for a while.
              runtime.webRtcFallbackStreak += 1
              if (runtime.webRtcFallbackStreak >= 2 && !preferredTransports.includes('lan')) {
                set({ relayOnlyUntil: Date.now() + RELAY_DOWNGRADE_MS })
              }
            },
            onOpencodeArchived: nativeId => {
              if (generation !== runtime.connectionGeneration) return
              const sessionId = `opencode:${nativeId}`
              invalidateCatalogMetadata(runtime.connection, 'opencode')
              set(state => ({
                sessions: state.sessions.filter(item => item.sessionId !== sessionId),
                workspaces: state.workspaces.map(workspace => ({ ...workspace, sessionIds: workspace.sessionIds.filter(id => id !== sessionId) })),
                pinnedSessionIds: (state.pinnedSessionIds ?? []).filter(id => id !== sessionId),
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
              void useAttentionStore.getState().detachConnection(generation)
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
                  hostWorkspaceGit: false,
                  codexAvailable: false,
                  cursorAvailable: false,
                  antigravityAvailable: false,
                  piAvailable: false,
                  opencodeAvailable: false,
                  claudeAvailable: false,
                  hermesAvailable: false,
                  kimiAvailable: false,
                  permissionSelecting: false,
                  modelSelecting: false,
                  agentPresetSelecting: false,
                  agentPresetLoading: false,
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
          hostWorkspaceGit: runtime.connection.hasWorkspaceGit?.() ?? false,
          codexAvailable: runtime.connection.hasCodex(),
          cursorAvailable: runtime.connection.hasCursor(),
          antigravityAvailable: runtime.connection.hasAntigravity(),
          piAvailable: runtime.connection.hasPi(),
          opencodeAvailable: runtime.connection.hasOpencode(),
          claudeAvailable: runtime.connection.hasClaude(),
          hermesAvailable: runtime.connection.hasHermes(),
          kimiAvailable: runtime.connection.hasKimi(),
          customAcpBackends: runtime.connection.customAcpBackends?.() ?? [],
          connectionStage: 'ready',
          connectionNetworkDetails,
          lastConnectedDeviceId: device.deviceId,
          pendingAutoConnectDeviceId: undefined,
          connection: { phase: 'connected', stats: connectedStats },
          ...(connectedStats.mode !== 'Relay' && connectedStats.mode !== 'Disconnected' ? { relayOnlyUntil: undefined } : {}),
        })
        runtime.connectionStartedAt = Date.now()
        void useAttentionStore.getState().attachConnection({
          hostId: device.deviceId,
          generation,
          advertisedSupported: runtime.connection.hasAttentionInbox?.() === true,
          client: runtime.connection.getAttentionClient?.(),
        })
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
          hostWorkspaceGit: false,
          codexAvailable: false,
          cursorAvailable: false,
          antigravityAvailable: false,
          piAvailable: false,
          opencodeAvailable: false,
          claudeAvailable: false,
          hermesAvailable: false,
          kimiAvailable: false,
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
      const restoreHealthySessionState = async () => {
        await get().refreshConnectionNetworkDetails()
        if (generation !== runtime.connectionGeneration || get().connection.phase !== 'connected') return
        const selected = get().selectedSession
        if (
          selected?.backend === 'codex'
          && !get().busyAction?.startsWith('session:')
          && (runtime.activeCodexStream === undefined || get().codexReadySessionId !== selected.sessionId)
        ) {
          void get().openSession(selected)
        } else if (
          isAcpManagedBackend(selected?.backend)
          && !get().busyAction?.startsWith('session:')
          && runtime.activeCursorStream === undefined
        ) {
          void get().openSession(selected)
        } else if (selected && isAcpManagedBackend(selected.backend) && selected.running && runtime.activeCursorStream !== undefined
          && !get().busyAction?.startsWith('session:') && get().busyAction !== 'send-message') {
          // The live subscription is still open. Closing it via openSession drops
          // in-flight deltas, approvals and prompt_completed, and the reopen would
          // discard the already streamed reply. Reconcile read-only with Host truth.
          const stream = runtime.activeCursorStream
          const frameRevision = runtime.acpFrameRevision
          const sessionGeneration = runtime.sessionLoadGeneration
          const messagesAtRead = get().messages[selected.sessionId]
          void readAcpHistory(acpClientForBackend(runtime.connection, selected.backend), cursorNativeId(selected), selected.backend).then(details => {
            // Settle only if Host explicitly ended the turn, nothing streamed or mutated
            // messages while reading, and the stream/connection/session generation is unchanged.
            if (details.running !== false || generation !== runtime.connectionGeneration || sessionGeneration !== runtime.sessionLoadGeneration
              || stream !== runtime.activeCursorStream || frameRevision !== runtime.acpFrameRevision
              || get().busyAction?.startsWith('session:') || get().busyAction === 'send-message'
              || get().messages[selected.sessionId] !== messagesAtRead
              || get().selectedSession?.sessionId !== selected.sessionId || get().connection.phase !== 'connected') return
            const folded = foldAcpHistory(details.events, selected.sessionId)
            const canPersistSnapshot = Boolean(get().config?.baseUrl && get().selectedDevice?.identityKey)
            const memoryScope = browseScope(get())
            set(state => {
              const active = state.selectedSession
              if (!active || active.sessionId !== selected.sessionId || state.messages[selected.sessionId] !== messagesAtRead) return {}
              const updated = { ...active, running: false }
              const existing = state.messages[selected.sessionId] ?? []
              if (folded.length > 0) {
                // Host confirmed the turn ended and no live frames arrived while reading,
                // so the persisted transcript supersedes stale partial live/optimistic rows;
                // retain only terminal local rows and approval/question cards absent from history.
                const preserved = existing.filter(item =>
                  isTerminalLocalMessage(item) || item.kind === 'approval' || item.kind === 'question')
                const merged = mergeAcpHistoryAndLive(folded, preserved)
                const paged = storeAcpPagedMessages(selected.sessionId, merged)
                if (canPersistSnapshot) saveSessionMessagesSnapshot(memoryScope, selected.sessionId, paged.tail)
                return {
                  selectedSession: updated,
                  sessions: state.sessions.map(item => item.sessionId === selected.sessionId ? updated : item),
                  messages: { ...state.messages, [selected.sessionId]: paged.tail },
                  historyHasMore: paged.historyHasMore,
                  oldestLoadedSeq: paged.oldestLoadedSeq,
                }
              }
              // Backends without history replay (e.g. legacy Cursor) return empty events:
              // settle the active live rows in place instead of dropping earlier messages.
              const settled = finalizeAssistantLive(existing).map(item =>
                item.kind === 'tool' && item.state === 'running' ? { ...item, state: 'finished' as const } : item)
              if (canPersistSnapshot) saveSessionMessagesSnapshot(memoryScope, selected.sessionId, settled)
              return {
                selectedSession: updated,
                sessions: state.sessions.map(item => item.sessionId === selected.sessionId ? updated : item),
                messages: { ...state.messages, [selected.sessionId]: settled },
              }
            })
          }).catch(() => undefined)
        }
        if (get().transportPreference === 'auto') {
          const nextPreferred: readonly string[] = await resolveAutomaticPreferredTransports().catch(() => [])
          if (generation !== runtime.connectionGeneration || get().connection.phase !== 'connected') return
          void runtime.connection.promoteTransport({ preferLan: nextPreferred.includes('lan') })
        }
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
          await restoreHealthySessionState()
        }
      }
      else {
        await restoreHealthySessionState()
      }
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
      void useAttentionStore.getState().detachConnection()
      sessionFileStatCache.clear()
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
        hostWorkspaceGit: false,
        codexAvailable: false,
        cursorAvailable: false,
        antigravityAvailable: false,
        piAvailable: false,
        opencodeAvailable: false,
        claudeAvailable: false,
        hermesAvailable: false,
        kimiAvailable: false,
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
        permissionSelecting: false,
        modelSelecting: false,
        agentPresetOptions: undefined,
        agentPresetLoading: false,
        agentPresetSelecting: false,
        historyHasMore: false,
        historyLoadingOlder: false,
        oldestLoadedSeq: undefined,
      })
    },

    setOffline() {
      if (get().connection.phase !== 'disconnected') {
        runtime.flushPendingMuxFrames()
        ++runtime.connectionGeneration
        ++runtime.sessionLoadGeneration
        runtime.clearPendingMuxFrames()
        runtime.clearHarnessCatalogSync()
        void useAttentionStore.getState().detachConnection()
        sessionFileStatCache.clear()
        void runtime.closeActiveCodexStream(false)
        void runtime.closeActiveCursorStream(false)
        set(state => ({
          connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, error: zhCN.runtime.networkUnavailable,
            ...(state.connection.retryable === false ? { retryable: false } : {}) },
          hostSessionEvents: false,
          hostWorkspaceGit: false,
          codexAvailable: false,
          busyAction: undefined,
          permissionSelecting: false,
          modelSelecting: false,
          agentPresetSelecting: false,
          agentPresetLoading: false,
          cursorAvailable: false,
          antigravityAvailable: false,
          piAvailable: false,
          opencodeAvailable: false,
          claudeAvailable: false,
          hermesAvailable: false,
          kimiAvailable: false,
          sessions: state.sessions.map(item =>
            (isAcpManagedBackend(item.backend) || item.backend === 'codex') && item.running ? { ...item, running: false } : item,
          ),
          selectedSession: state.selectedSession !== undefined
            && (isAcpManagedBackend(state.selectedSession.backend) || state.selectedSession.backend === 'codex')
            && state.selectedSession.running
            ? { ...state.selectedSession, running: false }
            : state.selectedSession,
        }))
      }
    },
  }
}
