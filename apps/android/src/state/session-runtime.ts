import { loadAcpModels } from '../services/acp-models'
import type { AcpStream, CodexStream, CodexTimelineState } from '@dsh-remote/client-core'
import { workspaceStableKey } from '../lib/workspace-key'
import { strings as zhCN } from '../locales/i18n'
import { loadAntigravityCatalog, mergeAntigravityCatalog } from '../services/antigravity'
import { loadCodexModels } from '../services/codex'
import { cursorNativeId } from '../services/cursor'
import { loadOpencodeCatalog, loadOpencodeModels, mergeOpencodeCatalog } from '../services/opencode'
import { loadClaudeCatalog, loadClaudeModels, mergeClaudeCatalog } from '../services/claude'
import { loadPiCatalog, loadPiModels, mergePiCatalog } from '../services/pi'
import { AndroidRemoteRuntime } from '../services/remote-runtime'
import { saveRecentWorkspaces } from '../services/storage'
import type { ModelSelection, MuxStreamFrame, RemoteSession, WorkspaceShortcut } from '../types'
import type { StoreAccess } from './store-state'

export interface SessionAccess extends StoreAccess {
  runtime: SessionRuntime
}

const MUX_FLUSH_MS = 100
const MUX_FLUSH_MAX = 250
const RECENT_WORKSPACE_LIMIT = 3

/** Owns mutable connection generations, active streams and event-coalescing state. */
export class SessionRuntime {
  readonly connection = new AndroidRemoteRuntime()
  activeCodexStream: CodexStream | undefined
  activeCodexTimeline: CodexTimelineState | undefined
  activeCursorStream: AcpStream | undefined
  readonly codexModelSelections = new Map<string, ModelSelection>()
  connectionGeneration = 0
  /** Rows created before this instant predate the current connection (reconcile scope). */
  connectionStartedAt = 0
  /** Queue-adoption bookkeeping: rpcIds the Host inbox has ever adopted, per session. */
  readonly adoptedQueueRpcIds = new Map<string, Set<string>>()
  /** Adopted rpcIds absent from the latest projection — one update of grace for the echo. */
  readonly vanishingQueueRpcIds = new Map<string, Set<string>>()
  pendingMuxFrames: { generation: number; frame: MuxStreamFrame }[] = []
  muxFlushTimer: ReturnType<typeof setTimeout> | undefined
  private pendingCodexFrames: { generation: number; frame: { method: string; params: unknown } }[] = []
  private codexFlushTimer: ReturnType<typeof setTimeout> | undefined
  readonly browsePages = new Map<string, {oldestLoadedSeq?: number; historyHasMore: boolean}>()
  sessionReadAbort: AbortController | undefined
  sessionReadRetry = false
  sessionLoadGeneration = 0
  reconnectFlight: Promise<boolean> | undefined

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
  }

  clearQueueAdoption(): void {
    // `adopted` is a Host-side fact (the durable queue received the prompt) and
    // survives reconnects; only the grace window restarts.
    this.vanishingQueueRpcIds.clear()
  }

  async refreshAntigravityCatalog(): Promise<void> {
    if (!this.connection.hasAntigravity()) return
    const client = this.connection.requireAntigravity()
    const deviceId = this.store.get().selectedDevice?.deviceId
    try {
      const catalog = await loadAntigravityCatalog(client, this.store.get().workspaces)
      if (!this.connection.hasAntigravity() || this.connection.requireAntigravity() !== client || this.store.get().selectedDevice?.deviceId !== deviceId) return
      this.store.set(state => {
        const merged = mergeAntigravityCatalog(catalog, state.workspaces, state.sessions)
        return {
          workspaces: [...state.workspaces.filter(item => item.backend !== 'antigravity'), ...merged.workspaces],
          sessions: [...state.sessions.filter(item => item.backend !== 'antigravity'), ...merged.sessions],
          selectedSession: state.selectedSession?.backend === 'antigravity'
            ? merged.sessions.find(item => item.sessionId === state.selectedSession?.sessionId) ?? state.selectedSession
            : state.selectedSession,
        }
      })
    } catch { /* Keep the live projection when AGY is still persisting its summary. */ }
  }

  async refreshPiCatalog(): Promise<void> {
    if (!this.connection.hasPi()) return
    const client = this.connection.requirePi()
    const deviceId = this.store.get().selectedDevice?.deviceId
    try {
      const catalog = await loadPiCatalog(client, this.store.get().workspaces)
      if (!this.connection.hasPi() || this.connection.requirePi() !== client || this.store.get().selectedDevice?.deviceId !== deviceId) return
      this.store.set(state => {
        const merged = mergePiCatalog(catalog, state.workspaces, state.sessions)
        return {
          workspaces: [...state.workspaces.filter(item => item.backend !== 'pi'), ...merged.workspaces],
          sessions: [...state.sessions.filter(item => item.backend !== 'pi'), ...merged.sessions],
          selectedSession: state.selectedSession?.backend === 'pi'
            ? merged.sessions.find(item => item.sessionId === state.selectedSession?.sessionId) ?? state.selectedSession
            : state.selectedSession,
        }
      })
    } catch { /* Keep the live projection when Pi is still persisting its summary. */ }
  }

  async refreshOpencodeCatalog(): Promise<void> {
    if (!this.connection.hasOpencode()) return
    const client = this.connection.requireOpencode()
    const deviceId = this.store.get().selectedDevice?.deviceId
    try {
      const catalog = await loadOpencodeCatalog(client, this.store.get().workspaces)
      if (!this.connection.hasOpencode() || this.connection.requireOpencode() !== client || this.store.get().selectedDevice?.deviceId !== deviceId) return
      this.store.set(state => {
        const merged = mergeOpencodeCatalog(catalog, state.workspaces, state.sessions)
        return {
          workspaces: [...state.workspaces.filter(item => item.backend !== 'opencode'), ...merged.workspaces],
          sessions: [...state.sessions.filter(item => item.backend !== 'opencode'), ...merged.sessions],
          selectedSession: state.selectedSession?.backend === 'opencode'
            ? merged.sessions.find(item => item.sessionId === state.selectedSession?.sessionId) ?? state.selectedSession
            : state.selectedSession,
        }
      })
    } catch { /* Keep the live projection when OpenCode is still persisting its summary. */ }
  }

  async refreshClaudeCatalog(): Promise<void> {
    if (!this.connection.hasClaude()) return
    const client = this.connection.requireClaude()
    const deviceId = this.store.get().selectedDevice?.deviceId
    try {
      const catalog = await loadClaudeCatalog(client, this.store.get().workspaces)
      if (!this.connection.hasClaude() || this.connection.requireClaude() !== client || this.store.get().selectedDevice?.deviceId !== deviceId) return
      this.store.set(state => {
        const merged = mergeClaudeCatalog(catalog, state.workspaces, state.sessions)
        return {
          workspaces: [...state.workspaces.filter(item => item.backend !== 'claude'), ...merged.workspaces],
          sessions: [...state.sessions.filter(item => item.backend !== 'claude'), ...merged.sessions],
          selectedSession: state.selectedSession?.backend === 'claude'
            ? merged.sessions.find(item => item.sessionId === state.selectedSession?.sessionId) ?? state.selectedSession
            : state.selectedSession,
        }
      })
    } catch { /* Keep the live projection when Claude is still persisting its summary. */ }
  }

  async closeActiveCodexStream(notifyRemote = true): Promise<void> {
    this.clearPendingCodexFrames()
    const stream = this.activeCodexStream
    this.activeCodexStream = undefined
    this.activeCodexTimeline = undefined
    if (notifyRemote && stream !== undefined) await stream.close().catch(() => undefined)
  }

  async closeActiveCursorStream(notifyRemote = true): Promise<void> {
    const stream = this.activeCursorStream
    this.activeCursorStream = undefined
    if (notifyRemote && stream !== undefined) await stream.close().catch(() => undefined)
  }

  async ensureCursorStream(session: RemoteSession, current: () => boolean = () => true): Promise<void> {
    await this.closeActiveCursorStream()
    if (!current()) return
    const client = session.backend === 'claude' ? this.connection.requireClaude() : session.backend === 'opencode'
      ? this.connection.requireOpencode()
      : session.backend === 'pi'
        ? this.connection.requirePi()
        : session.backend === 'antigravity' ? this.connection.requireAntigravity() : this.connection.requireCursor()
    const nativeId = cursorNativeId(session)
    const stream = await client.openStream(
      nativeId,
      frame => { if (current()) this.store.get().handleCursorFrame(frame) },
      closed => {
        if (!current()) return
        if (this.store.get().selectedSession?.sessionId !== session.sessionId) return
        if (this.activeCursorStream?.streamId !== stream.streamId) return
        this.activeCursorStream = undefined
        this.store.set(state => ({
          sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
          selectedSession: state.selectedSession?.sessionId === session.sessionId
            ? { ...state.selectedSession, running: false }
            : state.selectedSession,
          ...(closed.reason === 'failed' ? { error: session.backend === 'claude' ? zhCN.runtime.claudeUnavailable : session.backend === 'opencode' ? zhCN.runtime.opencodeUnavailable : session.backend === 'pi' ? zhCN.runtime.piUnavailable : session.backend === 'antigravity' ? zhCN.runtime.antigravityUnavailable : zhCN.runtime.cursorUnavailable } : {}),
        }))
        // Transport flaps can close the ACP stream while the secure channel is
        // still up. Re-open so the next prompt does not miss live frames.
        if (closed.reason === 'peer-disconnected') return
        const phase = this.store.get().connection.phase
        if (phase !== 'connected') return
        const selected = this.store.get().selectedSession
        if (selected?.sessionId !== session.sessionId || (selected.backend !== 'cursor' && selected.backend !== 'antigravity' && selected.backend !== 'pi' && selected.backend !== 'opencode' && selected.backend !== 'claude')) return
        void this.ensureCursorStream(selected, current).catch(() => undefined)
      },
    )
    if (!current()) { await stream.close().catch(() => undefined); return }
    this.activeCursorStream = stream
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
      let models = await loadCodexModels(this.connection.requireCodex())
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
