import { loadAcpModels } from '../services/acp-models'
import type { AcpStream, CodexStream, CodexTimelineState } from '@dsh-remote/client-core'
import { isAcpManagedBackend, workspaceStableKey, type AcpCatalogFilterOptions, type AcpManagedBackend } from '../lib/workspace-key'
import { strings as zhCN } from '../locales/i18n'
import { loadAntigravityCatalog, mergeAntigravityCatalog } from '../services/antigravity'
import * as browseMemory from '../services/browse-memory'
import { codexModelSelectionFromSession, loadCodexModels } from '../services/codex'
import { cursorNativeId, loadCursorCatalog, loadCustomAcpCatalog, mergeCursorCatalog, mergeCustomAcpCatalog } from '../services/cursor'
import { loadOpencodeCatalog, loadOpencodeModels, mergeOpencodeCatalog } from '../services/opencode'
import { loadClaudeCatalog, loadClaudeModels, mergeClaudeCatalog } from '../services/claude'
import { loadHermesCatalog, loadHermesModels, mergeHermesCatalog } from '../services/hermes'
import { loadKimiCatalog, loadKimiModels, mergeKimiCatalog } from '../services/kimi'
import { loadPiCatalog, loadPiModels, mergePiCatalog } from '../services/pi'
import { AndroidRemoteRuntime } from '../services/remote-runtime'
import { saveRecentWorkspaces } from '../services/storage'
import type { ModelSelection, MuxStreamFrame, RemoteSession, WorkspaceShortcut, WorkspaceView } from '../types'
import { acpClientForBackend, acpUnavailableMessage } from './acp-backend-helpers'
import type { StoreAccess } from './store-state'

export interface SessionAccess extends StoreAccess {
  runtime: SessionRuntime
}

const MUX_FLUSH_MS = 100
const MUX_FLUSH_MAX = 250
const RECENT_WORKSPACE_LIMIT = 3
const CATALOG_SYNC_DEBOUNCE_MS = 300
const ACP_STREAM_RECOVERY_DELAYS_MS = [1_500, 3_000, 6_000, 12_000] as const
const ACP_NON_RETRYABLE_RECOVERY_CODES = new Set([
  'ACP_BACKEND_DISABLED',
  'ACP_CLOSED',
  'ACP_PROCESS_LIMIT',
  'CLIENT_CLOSED',
  'CURSOR_CLOSED',
  'CURSOR_SESSION_OWNED',
  'FEATURE_NOT_SUPPORTED',
  'TRANSPORT_CLOSED',
])

/** Owns mutable connection generations, active streams and event-coalescing state. */
export class SessionRuntime {
  readonly connection = new AndroidRemoteRuntime()
  activeCodexStream: CodexStream | undefined
  activeCodexTimeline: CodexTimelineState | undefined
  activeCursorStream: AcpStream | undefined
  acpFrameRevision = 0
  /** Last terminal (`prompt_completed` / `prompt_failed`) frame ordinal per session. */
  readonly acpTerminalRevisions = new Map<string, number>()
  readonly codexModelSelections = new Map<string, ModelSelection>()
  connectionGeneration = 0
  /** Rows created before this instant predate the current connection (reconcile scope). */
  connectionStartedAt = 0
  /** Consecutive WebRTC negotiation fallbacks on the current host (relay downgrade memory). */
  webRtcFallbackStreak = 0
  pendingMuxFrames: { generation: number; frame: MuxStreamFrame }[] = []
  muxFlushTimer: ReturnType<typeof setTimeout> | undefined
  private pendingCodexFrames: { generation: number; frame: { method: string; params: unknown } }[] = []
  private codexFlushTimer: ReturnType<typeof setTimeout> | undefined
  private codexRecoveryTimer: ReturnType<typeof setTimeout> | undefined
  private cursorRecoveryTimer: ReturnType<typeof setTimeout> | undefined
  private cursorStreamGeneration = 0
  private readonly completedCodexTurns = new Set<string>()
  historyCompactMode?: boolean
  readonly browsePages = new Map<string, {oldestLoadedSeq?: number; historyHasMore: boolean}>()
  sessionReadAbort: AbortController | undefined
  sessionReadRetry = false
  sessionLoadGeneration = 0
  emptyAcpHistory: { sessionId: string; loadGeneration: number; connectionGeneration: number } | undefined
  reconnectFlight: Promise<boolean> | undefined
  createSessionFlight: Promise<boolean> | undefined
  private catalogSyncTimer: ReturnType<typeof setTimeout> | undefined
  private catalogSyncInFlight = false
  private catalogSyncQueued = false

  constructor(private readonly store: StoreAccess) {}

  /** Keep native list scheduling outside the synchronous encrypted receive path. */
  enqueueCodexFrame(generation: number, frame: { method: string; params: unknown }): void {
    if (generation !== this.sessionLoadGeneration) return
    this.pendingCodexFrames.push({ generation, frame })
    // Completion and approvals observe every preceding delta before publishing.
    if (this.pendingCodexFrames.length >= MUX_FLUSH_MAX || frame.method === 'turn/completed'
      || frame.method.endsWith('/requestApproval')) {
      this.flushPendingCodexFrames()
    } else if (this.codexFlushTimer === undefined) {
      this.codexFlushTimer = setTimeout(() => this.flushPendingCodexFrames(), MUX_FLUSH_MS)
    }
  }

  flushPendingCodexFrames(): void {
    if (this.codexFlushTimer !== undefined) clearTimeout(this.codexFlushTimer)
    this.codexFlushTimer = undefined
    const pending = this.pendingCodexFrames
    this.pendingCodexFrames = []
    const frames = pending.filter(item => item.generation === this.sessionLoadGeneration).map(item => item.frame)
    if (frames.length > 0) this.store.get().handleCodexFrames(frames)
  }

  private clearPendingCodexFrames(): void {
    if (this.codexFlushTimer !== undefined) clearTimeout(this.codexFlushTimer)
    this.codexFlushTimer = undefined
    this.pendingCodexFrames = []
  }

  /**
   * Coalesce transport frames in one synchronous turn per 100 ms so React can
   * batch rendering. The hard cap bounds the backlog; direct handleMuxFrame
   * calls remain synchronous for state-machine consumers.
   */
  enqueueMuxFrame(generation: number, frame: MuxStreamFrame): void {
    this.pendingMuxFrames.push({ generation, frame })
    if (this.pendingMuxFrames.length >= MUX_FLUSH_MAX) {
      this.flushPendingMuxFrames()
      return
    }
    if (this.muxFlushTimer === undefined) {
      this.muxFlushTimer = setTimeout(() => this.flushPendingMuxFrames(), MUX_FLUSH_MS)
    }
  }

  /** Drain queued frames before any store read that must observe them. */
  flushPendingMuxFrames(): void {
    if (this.muxFlushTimer !== undefined) {
      clearTimeout(this.muxFlushTimer)
      this.muxFlushTimer = undefined
    }
    if (this.pendingMuxFrames.length === 0) return
    const queued = this.pendingMuxFrames
    this.pendingMuxFrames = []
    for (const entry of queued) {
      if (entry.generation !== this.connectionGeneration) continue
      try {
        this.store.get().handleMuxFrame(entry.frame)
      } catch {
        // One malformed frame must neither drop the rest of the batch nor escape
        // the flush (an uncaught throw in the RN runtime is fatal). Frame type
        // only — never payload contents.
        console.warn('mux frame dropped:', entry.frame.payload.type)
      }
    }
  }

  clearPendingMuxFrames(): void {
    if (this.muxFlushTimer !== undefined) {
      clearTimeout(this.muxFlushTimer)
      this.muxFlushTimer = undefined
    }
    this.pendingMuxFrames = []
    this.clearHarnessCatalogSync()
  }

  scheduleHarnessCatalogSync(): void {
    const state = this.store.get()
    if (state.connection.phase !== 'connected' || !state.hostSessionEvents) return
    const generation = this.connectionGeneration
    this.catalogSyncQueued = true
    if (this.catalogSyncTimer !== undefined) clearTimeout(this.catalogSyncTimer)
    this.catalogSyncTimer = setTimeout(() => {
      this.catalogSyncTimer = undefined
      void this.flushHarnessCatalogSync(generation)
    }, CATALOG_SYNC_DEBOUNCE_MS)
  }

  private async flushHarnessCatalogSync(generation: number): Promise<void> {
    if (generation !== this.connectionGeneration) return
    if (this.catalogSyncInFlight || !this.catalogSyncQueued) return
    const state = this.store.get()
    if (state.connection.phase !== 'connected' || !state.hostSessionEvents) {
      this.catalogSyncQueued = false
      return
    }
    this.catalogSyncQueued = false
    this.catalogSyncInFlight = true
    try {
      await state.syncHarnessCatalog()
    } finally {
      this.catalogSyncInFlight = false
      if (this.catalogSyncQueued && generation === this.connectionGeneration) {
        void this.flushHarnessCatalogSync(generation)
      }
    }
  }

  clearHarnessCatalogSync(): void {
    if (this.catalogSyncTimer !== undefined) {
      clearTimeout(this.catalogSyncTimer)
      this.catalogSyncTimer = undefined
    }
    this.catalogSyncQueued = false
  }

  private acpCatalogOptions(): AcpCatalogFilterOptions {
    const state = this.store.get()
    const scope = browseMemory.browseScope?.(state)
    return {
      deletedKeys: scope ? browseMemory.getDeletedAcpWorkspaceKeys?.(scope) : undefined,
      platform: state.selectedDevice?.platform,
    }
  }

  private async refreshAcpCatalog(spec: {
    backend: AcpManagedBackend
    has: () => boolean
    require: () => Parameters<typeof loadPiCatalog>[0]
    load: typeof loadPiCatalog
    merge: typeof mergePiCatalog
  }): Promise<void> {
    if (!spec.has()) return
    const client = spec.require()
    const deviceId = this.store.get().selectedDevice?.deviceId
    try {
      const options = this.acpCatalogOptions()
      const catalog = await spec.load(client, this.store.get().workspaces, undefined, options)
      if (!spec.has() || spec.require() !== client || this.store.get().selectedDevice?.deviceId !== deviceId) return
      this.store.set(state => {
        const merged = spec.merge(catalog, state.workspaces, state.sessions, this.acpCatalogOptions())
        return {
          workspaces: [...state.workspaces.filter(item => item.backend !== spec.backend), ...merged.workspaces],
          sessions: [...state.sessions.filter(item => item.backend !== spec.backend), ...merged.sessions],
          selectedSession: state.selectedSession?.backend === spec.backend
            ? merged.sessions.find(item => item.sessionId === state.selectedSession?.sessionId) ?? state.selectedSession
            : state.selectedSession,
        }
      })
    } catch { /* Keep the live projection while the backend is still persisting its summary. */ }
  }

  async refreshAntigravityCatalog(): Promise<void> {
    return this.refreshAcpCatalog({
      backend: 'antigravity',
      has: () => this.connection.hasAntigravity(),
      require: () => this.connection.requireAntigravity(),
      load: loadAntigravityCatalog,
      merge: mergeAntigravityCatalog,
    })
  }

  async refreshPiCatalog(): Promise<void> {
    return this.refreshAcpCatalog({
      backend: 'pi',
      has: () => this.connection.hasPi(),
      require: () => this.connection.requirePi(),
      load: loadPiCatalog,
      merge: mergePiCatalog,
    })
  }

  async refreshOpencodeCatalog(): Promise<void> {
    return this.refreshAcpCatalog({
      backend: 'opencode',
      has: () => this.connection.hasOpencode(),
      require: () => this.connection.requireOpencode(),
      load: loadOpencodeCatalog,
      merge: mergeOpencodeCatalog,
    })
  }

  async refreshClaudeCatalog(): Promise<void> {
    return this.refreshAcpCatalog({
      backend: 'claude',
      has: () => this.connection.hasClaude(),
      require: () => this.connection.requireClaude(),
      load: loadClaudeCatalog,
      merge: mergeClaudeCatalog,
    })
  }

  async refreshHermesCatalog(): Promise<void> {
    return this.refreshAcpCatalog({
      backend: 'hermes',
      has: () => this.connection.hasHermes(),
      require: () => this.connection.requireHermes(),
      load: loadHermesCatalog,
      merge: mergeHermesCatalog,
    })
  }

  async refreshKimiCatalog(): Promise<void> {
    return this.refreshAcpCatalog({
      backend: 'kimi',
      has: () => this.connection.hasKimi(),
      require: () => this.connection.requireKimi(),
      load: loadKimiCatalog,
      merge: mergeKimiCatalog,
    })
  }

  async refreshCursorCatalog(): Promise<void> {
    return this.refreshAcpCatalog({
      backend: 'cursor',
      has: () => this.connection.hasCursor(),
      require: () => this.connection.requireCursor(),
      load: loadCursorCatalog,
      merge: mergeCursorCatalog,
    })
  }

  async refreshCustomAcpCatalog(backend: AcpManagedBackend): Promise<void> {
    return this.refreshAcpCatalog({
      backend,
      has: () => this.connection.hasAcpBackend(backend),
      require: () => this.connection.requireAcpBackend(backend),
      load: (client, remembered, warmPath, options) => loadCustomAcpCatalog(backend, client, remembered, warmPath, options),
      merge: (catalog, workspaces, sessions, options) => mergeCustomAcpCatalog(backend, catalog, workspaces, sessions, options),
    })
  }

  clearCodexRecoveryTimer(): void {
    if (this.codexRecoveryTimer !== undefined) clearTimeout(this.codexRecoveryTimer)
    this.codexRecoveryTimer = undefined
  }

  scheduleCodexRecovery(delayMs: number, task: () => void): void {
    this.clearCodexRecoveryTimer()
    this.codexRecoveryTimer = setTimeout(() => {
      this.codexRecoveryTimer = undefined
      task()
    }, delayMs)
    this.codexRecoveryTimer.unref?.()
  }

  markCodexTurnCompleted(threadId: string, turnId: string): void {
    const key = `${threadId}:${turnId}`
    if (this.completedCodexTurns.has(key)) return
    this.completedCodexTurns.add(key)
    while (this.completedCodexTurns.size > 64) {
      const oldest = this.completedCodexTurns.keys().next().value
      if (oldest === undefined) break
      this.completedCodexTurns.delete(oldest)
    }
  }

  isCodexTurnCompleted(threadId: string, turnId: string): boolean {
    return this.completedCodexTurns.has(`${threadId}:${turnId}`)
  }

  async closeActiveCodexStream(notifyRemote = true): Promise<void> {
    this.clearCodexRecoveryTimer()
    this.clearPendingCodexFrames()
    const stream = this.activeCodexStream
    this.activeCodexStream = undefined
    this.activeCodexTimeline = undefined
    this.store.set({ codexReadySessionId: undefined })
    if (notifyRemote && stream !== undefined) await stream.close().catch(() => undefined)
  }

  clearCursorRecoveryTimer(): void {
    if (this.cursorRecoveryTimer !== undefined) clearTimeout(this.cursorRecoveryTimer)
    this.cursorRecoveryTimer = undefined
  }

  private scheduleCursorRecovery(delayMs: number, task: () => void): void {
    this.clearCursorRecoveryTimer()
    this.cursorRecoveryTimer = setTimeout(() => {
      this.cursorRecoveryTimer = undefined
      task()
    }, delayMs)
    this.cursorRecoveryTimer.unref?.()
  }

  async closeActiveCursorStream(notifyRemote = true): Promise<void> {
    this.cursorStreamGeneration++
    this.clearCursorRecoveryTimer()
    const stream = this.activeCursorStream
    this.activeCursorStream = undefined
    if (notifyRemote && stream !== undefined) await stream.close().catch(() => undefined)
  }

  async ensureCursorStream(
    session: RemoteSession,
    current: () => boolean = () => true,
    recoveryAttempt = 0,
  ): Promise<void> {
    const streamGeneration = ++this.cursorStreamGeneration
    this.clearCursorRecoveryTimer()
    const previous = this.activeCursorStream
    this.activeCursorStream = undefined
    if (previous !== undefined) await previous.close().catch(() => undefined)
    if (!current() || streamGeneration !== this.cursorStreamGeneration) return
    const client = acpClientForBackend(this.connection, session.backend ?? 'cursor')
    const nativeId = cursorNativeId(session)
    let openedStream: AcpStream | undefined
    let closedBeforeAssign: { streamId: string; reason: string } | undefined
    let nextAttempt = recoveryAttempt

    const canRecover = () => {
      if (!current() || streamGeneration !== this.cursorStreamGeneration) return false
      if (this.activeCursorStream !== undefined) return false
      const state = this.store.get()
      if (state.connection.phase !== 'connected') return false
      return state.selectedSession?.sessionId === session.sessionId
        && isAcpManagedBackend(state.selectedSession.backend)
    }

    const scheduleRecoveryAttempt = (attempt: number) => {
      const delayMs = ACP_STREAM_RECOVERY_DELAYS_MS[attempt]
      if (delayMs === undefined || !canRecover()) return
      this.scheduleCursorRecovery(delayMs, () => {
        if (!canRecover()) return
        const selected = this.store.get().selectedSession
        if (selected === undefined || selected.sessionId !== session.sessionId || !isAcpManagedBackend(selected.backend)) return
        void this.ensureCursorStream(selected, current, attempt + 1).catch(() => undefined)
      })
    }

    const handleClosed = (closed: { streamId: string; reason: string }) => {
      if (!current() || streamGeneration !== this.cursorStreamGeneration) return
      if (this.store.get().selectedSession?.sessionId !== session.sessionId) return
      if (this.activeCursorStream?.streamId !== closed.streamId) return
      this.activeCursorStream = undefined
      this.store.set(state => ({
        sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
        selectedSession: state.selectedSession?.sessionId === session.sessionId
          ? { ...state.selectedSession, running: false }
          : state.selectedSession,
        ...(closed.reason === 'failed' ? { error: acpUnavailableMessage(session.backend) } : {}),
      }))
      // Transport flaps can close the ACP stream while the secure channel is
      // still up. Re-open with bounded backoff so a downed backend cannot loop.
      if (closed.reason === 'peer-disconnected') return
      scheduleRecoveryAttempt(nextAttempt)
    }

    let stream: AcpStream
    try {
      stream = await client.openStream(
        nativeId,
        frame => {
          if (!current() || (openedStream === undefined && streamGeneration !== this.cursorStreamGeneration)) return
          if (openedStream !== undefined) nextAttempt = 0
          this.store.get().handleCursorFrame(frame)
        },
        closed => {
          if (openedStream === undefined) {
            closedBeforeAssign = closed
            return
          }
          handleClosed(closed)
        },
      )
    } catch (error) {
      if (recoveryAttempt > 0) {
        if (!current() || streamGeneration !== this.cursorStreamGeneration) return
        const code = typeof (error as { code?: unknown })?.code === 'string'
          ? (error as { code: string }).code
          : undefined
        if (code !== undefined && ACP_NON_RETRYABLE_RECOVERY_CODES.has(code)) return
        scheduleRecoveryAttempt(recoveryAttempt)
        return
      }
      throw error
    }
    if (!current() || streamGeneration !== this.cursorStreamGeneration) {
      await stream.close().catch(() => undefined)
      return
    }
    openedStream = stream
    this.activeCursorStream = stream
    if (closedBeforeAssign !== undefined) {
      const pending = closedBeforeAssign
      closedBeforeAssign = undefined
      handleClosed(pending)
    }
  }

  async refreshCustomAcpModels(session: RemoteSession, current: () => boolean): Promise<void> {
    if (!isAcpManagedBackend(session.backend)) return
    const generation = this.connectionGeneration
    try {
      const models = await loadAcpModels(this.connection.requireAcpBackend(session.backend), cursorNativeId(session), session.backend)
      if (!current() || generation !== this.connectionGeneration) return
      this.store.set(state => state.selectedSession?.sessionId === session.sessionId
        ? { sessionModels: models } : {})
    } catch { /* Optional model discovery must not prevent conversation recovery. */ }
  }

  async rememberRecentWorkspace(session: RemoteSession): Promise<void> {
    const state = this.store.get()
    const device = state.selectedDevice
    const workspace = state.workspaces.find(item => item.sessionIds.includes(session.sessionId))
    if (device === undefined || workspace === undefined) return
    const key = workspaceStableKey(workspace, device.platform)
    const entry: WorkspaceShortcut = {
      deviceId: device.deviceId,
      deviceName: device.name,
      key,
      workspaceId: workspace.workspaceId,
      backend: workspace.backend ?? 'harness',
      title: workspace.title,
      path: workspace.path,
      addedAt: Date.now(),
    }
    const next = [
      entry,
      ...state.recentWorkspaces.filter(item => !(item.deviceId === device.deviceId && item.key === key)),
    ].slice(0, RECENT_WORKSPACE_LIMIT)
    try {
      await saveRecentWorkspaces(next)
    } catch {
      // The shortcut list is a convenience; a storage failure must not fail the visit.
      return
    }
    this.store.set({ recentWorkspaces: next })
  }

  async refreshAntigravityModels(session: RemoteSession, current: () => boolean): Promise<void> {
    const generation = this.connectionGeneration
    try {
      const models = await loadAcpModels(this.connection.requireAntigravity(), cursorNativeId(session), 'antigravity')
      if (!current() || generation !== this.connectionGeneration) return
      this.store.set(state => state.selectedSession?.sessionId === session.sessionId
        ? { sessionModels: models } : {})
    } catch { /* Optional model discovery must not prevent conversation recovery. */ }
  }

  async refreshCursorModels(session: RemoteSession, current: () => boolean): Promise<void> {
    const generation = this.connectionGeneration
    try {
      const models = await loadAcpModels(this.connection.requireCursor(), cursorNativeId(session), 'cursor')
      if (!current() || generation !== this.connectionGeneration) return
      this.store.set(state => state.selectedSession?.sessionId === session.sessionId
        ? { sessionModels: models } : {})
    } catch { /* Optional model discovery must not prevent conversation recovery. */ }
  }

  async refreshPiModels(session: RemoteSession, current: () => boolean): Promise<void> {
    const generation = this.connectionGeneration
    try {
      const models = await loadPiModels(this.connection.requirePi(), cursorNativeId(session))
      if (!current() || generation !== this.connectionGeneration) return
      this.store.set(state => state.selectedSession?.sessionId === session.sessionId
        ? { sessionModels: models } : {})
    } catch { /* Optional model discovery must not prevent conversation recovery. */ }
  }

  async refreshOpencodeModels(session: RemoteSession, current: () => boolean): Promise<void> {
    const generation = this.connectionGeneration
    try {
      const models = await loadOpencodeModels(this.connection.requireOpencode(), cursorNativeId(session))
      if (!current() || generation !== this.connectionGeneration) return
      this.store.set(state => state.selectedSession?.sessionId === session.sessionId
        ? { sessionModels: models } : {})
    } catch { /* Optional model discovery must not prevent conversation recovery. */ }
  }

  async refreshClaudeModels(session: RemoteSession, current: () => boolean): Promise<void> {
    const generation = this.connectionGeneration
    try {
      const models = await loadClaudeModels(this.connection.requireClaude(), cursorNativeId(session))
      if (!current() || generation !== this.connectionGeneration) return
      this.store.set(state => state.selectedSession?.sessionId === session.sessionId
        ? { sessionModels: models } : {})
    } catch { /* Optional model discovery must not prevent conversation recovery. */ }
  }

  async refreshHermesModels(session: RemoteSession, current: () => boolean): Promise<void> {
    const generation = this.connectionGeneration
    try {
      const models = await loadHermesModels(this.connection.requireHermes(), cursorNativeId(session))
      if (!current() || generation !== this.connectionGeneration) return
      this.store.set(state => state.selectedSession?.sessionId === session.sessionId
        ? { sessionModels: models } : {})
    } catch { /* Optional model discovery must not prevent conversation recovery. */ }
  }

  async refreshKimiModels(session: RemoteSession, current: () => boolean): Promise<void> {
    const generation = this.connectionGeneration
    try {
      const models = await loadKimiModels(this.connection.requireKimi(), cursorNativeId(session))
      if (!current() || generation !== this.connectionGeneration) return
      this.store.set(state => state.selectedSession?.sessionId === session.sessionId
        ? { sessionModels: models } : {})
    } catch { /* Optional model discovery must not prevent conversation recovery. */ }
  }

  async refreshSessionModels(sessionId: string): Promise<void> {
    try {
      const models = await this.connection.requireProxy().sessionModels(sessionId)
      this.store.set(state => state.selectedSession?.sessionId === sessionId
        ? { sessionModels: models }
        : {})
    } catch {
      // ignored: the chat stays usable without a model catalog
    }
  }

  async refreshCodexModels(sessionId: string): Promise<void> {
    try {
      const session = this.store.get().selectedSession
      let models = await loadCodexModels(
        this.connection.requireCodex(),
        session?.sessionId === sessionId ? codexModelSelectionFromSession(session) : undefined,
      )
      const selected = this.codexModelSelections.get(sessionId)
      if (selected !== undefined && models.groups.some(provider => provider.id === selected.provider
        && provider.models.some(model => model.id === selected.model))) {
        models = { ...models, current: selected }
      }
      this.store.set(state => state.selectedSession?.sessionId === sessionId
        ? { sessionModels: models }
        : {})
    } catch {
      // ignored: text/image prompts can use the Host's current CodeX default
    }
  }
}
