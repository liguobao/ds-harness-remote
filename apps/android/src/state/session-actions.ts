import { isSubagentSession } from '../lib/session-kind'
import { selectAcpModel } from '../services/acp-models'
import { createCodexTimelineState, projectCodexThread } from '@dsh-remote/client-core'
import { friendlyError, isRecoverableTransportError, isRpcTimeoutError, isStreamTimeoutError } from '../lib/errors'
import { strings as zhCN } from '../locales/i18n'
import { readAntigravityHistory } from '../services/antigravity'
import {
  codexPermissionPreset,
  codexPermissionPresetFromResponse,
  codexSession,
  codexThreadId,
  isCodexPermissionPreset,
  readCodexHistoryPage,
  readCodexSession,
} from '../services/codex'
import {
  createAntigravitySession,
  createCursorSession,
  createOpencodeSession,
  createClaudeSession,
  createPiSession,
  cursorNativeId,
  foldAcpHistory,
  mergeAcpHistoryAndLive,
} from '../services/cursor'
import { forkMessage } from '../services/message-actions'
import { readOpencodeHistory, selectOpencodeModel } from '../services/opencode'
import { readClaudeHistory, selectClaudeModel } from '../services/claude'
import { readPiHistory, selectPiModel } from '../services/pi'
import { saveCodexPermissionPreset } from '../services/storage'
import { browseKey, browseScope } from '../services/browse-memory'
import type { RemoteSession } from '../types'
import { loadSavedCodexPermissions, withBestCodexPermission, withCodexPermissionState } from './codex-session-state'
import { foldHistory, settleTurnItems } from './event-reducer'
import { inboxRpcIds, mergeHistoryAndLive, oldestSeq, prependHistory, reconcileDeliveryStates } from './message-helpers'
import type { SessionAccess } from './session-runtime'
import { applyFeedback, latestHistoryLifecycle, record, withActiveCodexTurn } from './session-state'
import type { AppState } from './store-state'

/** Session actions use the store's single connection/session runtime. */
export function createSessionActions({ get, set, runtime }: SessionAccess): Pick<AppState,
  'refreshSessionStatus' | 'openSession' | 'forkChatMessage' | 'rateMessage' | 'createSession' | 'archiveSession' | 'selectModel' | 'selectPermission' | 'loadAgentPresets' | 'selectAgentPreset' | 'loadOlderHistory'> {
  return {
    async refreshSessionStatus() {
      if (get().connection.phase !== 'connected') return
      try {
        const rows = await runtime.connection.requireProxy().sessionList()
        set(state => {
          const known = new Set(state.sessions.map(item => item.sessionId))
          const marks: typeof state.sessionLifecycles = { ...state.sessionLifecycles }
          for (const row of state.sessions) {
            const fresh = rows.find(item => item.sessionId === row.sessionId)
            if (fresh === undefined) continue
            const entry = marks[row.sessionId]
            const wasRunning = entry?.running ?? row.running
            if (wasRunning === fresh.running) continue
            marks[row.sessionId] = {
              seq: entry?.seq ?? -1,
              turn: entry?.turn,
              running: fresh.running,
              // A run that ended while the list was watching leaves the "done"
              // reminder; a fresh run clears it. Failure precision needs the
              // turn/end frame (followed sessions), which keeps `failed` marks.
              ...(fresh.running
                ? { finished: undefined }
                : { finished: entry?.finished === 'failed' ? 'failed' as const : 'completed' as const }),
            }
          }
          let changed = false
          const updated = state.sessions.map(row => {
            const fresh = rows.find(item => item.sessionId === row.sessionId)
            if (fresh === undefined || (fresh.running === row.running && fresh.updatedAt === row.updatedAt)) return row
            changed = true
            return { ...row, running: fresh.running, updatedAt: fresh.updatedAt }
          })
          const added = rows.filter(item => !known.has(item.sessionId))
          const selectedFresh = state.selectedSession === undefined
            ? undefined
            : rows.find(item => item.sessionId === state.selectedSession?.sessionId)
          // Preserve array identity when nothing moved: the 8s refresh otherwise
          // hands consumers a fresh `sessions` reference and re-runs their memos.
          return {
            sessionLifecycles: marks,
            ...(changed || added.length > 0
              ? { sessions: added.length > 0 ? [...added, ...updated] : updated }
              : {}),
            ...(state.selectedSession !== undefined && selectedFresh !== undefined
              && (selectedFresh.running !== state.selectedSession.running || selectedFresh.updatedAt !== state.selectedSession.updatedAt)
              ? { selectedSession: { ...state.selectedSession, running: selectedFresh.running, updatedAt: selectedFresh.updatedAt } }
              : {}),
          }
        })
      } catch { /* status refresh is best-effort */ }
    },

    async openSession(session) {
      runtime.flushPendingMuxFrames()
      runtime.flushPendingCodexFrames()
      const compact = get().compactHistory
      const historyModeChanged = runtime.historyCompactMode !== undefined && runtime.historyCompactMode !== compact
      if (historyModeChanged) {
        runtime.browsePages.clear()
        set(state => ({ messages: Object.fromEntries(Object.entries(state.messages).map(([id, items]) =>
          [id, items.filter(item => item.kind === 'approval' || item.kind === 'question'
            || (item.kind === 'tool' && item.state === 'running')
            || (item.kind === 'message' && (item.sendState !== undefined || item.streaming)))])) }))
      }
      runtime.historyCompactMode = compact
      const hostId = get().selectedDevice?.deviceId ?? ''
      const pageScope = browseScope(get()) + (get().compactHistory ? ':compact' : ':full')
      const pageKey = (id: string) => browseKey(pageScope, id)
      const previous = get().selectedSession
      if (!historyModeChanged && previous !== undefined && !get().busyAction?.startsWith('session:') && !get().historyLoadingOlder) {
        runtime.browsePages.set(pageKey(previous.sessionId), {
          oldestLoadedSeq: get().oldestLoadedSeq, historyHasMore: get().historyHasMore,
        })
        if (runtime.browsePages.size > 32) runtime.browsePages.delete(runtime.browsePages.keys().next().value!)
      }
      const cachedPage = runtime.browsePages.get(pageKey(session.sessionId))
      const cachedIds = new Set((get().messages[session.sessionId] ?? []).map(item => item.id))
      let contiguousCache = false
      const browseLive = (items: import('../types').ChatItem[], existing: import('../types').ChatItem[]) => {
        contiguousCache = items.some(item => cachedIds.has(item.id))
        // When the tail no longer overlaps, pagination starts from the new tail.
        // Retain live/optimistic rows, not a misleading gap in cached history.
        return contiguousCache ? existing : existing.filter(item => !cachedIds.has(item.id) || item.id.startsWith('local:'))
      }
      runtime.sessionReadAbort?.abort()
      const readAbort = new AbortController()
      runtime.sessionReadAbort = readAbort
      const loadGeneration = ++runtime.sessionLoadGeneration
      const connectionGeneration = runtime.connectionGeneration
      const current = () => loadGeneration === runtime.sessionLoadGeneration
        && connectionGeneration === runtime.connectionGeneration && !readAbort.signal.aborted
      const pageState = (hasMore: boolean, oldest: number | undefined) => {
        // Already loaded older pages remain contiguous with a refreshed tail.
        const retained = cachedPage?.oldestLoadedSeq
        return contiguousCache && retained !== undefined && oldest !== undefined && retained <= oldest
          ? cachedPage! : { historyHasMore: hasMore, oldestLoadedSeq: oldest }
      }
      const finishOpen = async () => {
        void runtime.rememberRecentWorkspace(session).catch(() => undefined)
        if (!current() || get().selectedSession?.sessionId !== session.sessionId) return false
        set(state => ({ currentWorkSessionIds: [...state.currentWorkSessionIds.filter(id => id !== session.sessionId), session.sessionId].slice(-32) }))
        return true
      }
      // Reset per-session view state up front: `historyLoadingOlder` and the
      // model catalog belong to the previous session and must not leak into the
      // new one (stuck pagination spinners, codex prompts sent with the previous
      // session's model).
      set(state => ({
        busyAction: `session:${session.sessionId}`,
        codexReadySessionId: undefined,
        ...((session.backend === 'codex' || session.backend === undefined || session.backend === 'harness') ? {
          selectedSession: session,
          historyHasMore: cachedPage?.historyHasMore ?? false,
          oldestLoadedSeq: cachedPage?.oldestLoadedSeq,
        } : {}),
        error: undefined,
        historyLoadingOlder: false,
        sessionModels: undefined,
        modelSelecting: false,
        sessionLifecycles: state.sessionLifecycles[session.sessionId] === undefined
          ? state.sessionLifecycles
          : {
            ...state.sessionLifecycles,
            [session.sessionId]: { ...state.sessionLifecycles[session.sessionId]!, finished: undefined },
          },
      }))
      const load = async () => {
        await runtime.connection.configureHistory(compact)
        if (!current()) return
        if (session.backend === 'codex') {
          void runtime.closeActiveCodexStream()
          void runtime.closeActiveCursorStream()
          const client = runtime.connection.requireCodex()
          const threadId = codexThreadId(session)
          const savedPermissions = await loadSavedCodexPermissions(get().selectedDevice?.deviceId)
          if (!current()) return
          const sessionWithPermission = withBestCodexPermission(session, undefined, savedPermissions)
          const permission = codexPermissionPreset(sessionWithPermission)
          const [read, history] = await Promise.all([
            readCodexSession(client, threadId, permission, readAbort.signal),
            readCodexHistoryPage(client, threadId, undefined, 16, readAbort.signal),
          ])
          if (!current()) return
          const timeline = createCodexTimelineState({ ...read.thread, turns: [] })
          if (timeline === undefined) throw new Error(zhCN.runtime.codexInvalidResponse)
          runtime.activeCodexTimeline = withActiveCodexTurn(timeline, history.activeTurnId)
          const items = foldHistory(history.events, session.sessionId, true)
          const nextSession = {
            ...sessionWithPermission,
            ...read.session,
            ...(history.activeTurnId === undefined ? {} : { running: true }),
          }
          set(state => ({
            selectedSession: nextSession,
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? nextSession : item),
            messages: {
              ...state.messages,
              [session.sessionId]: mergeHistoryAndLive(items, browseLive(items, state.messages[session.sessionId] ?? [])),
            },
            ...pageState(history.hasMore, oldestSeq(history.events)),
          }))
          let streamClosed = false
          const stream = await client.subscribe(
            threadId,
            frame => { if (current()) runtime.enqueueCodexFrame(loadGeneration, frame) },
            // History reads can abort locally. An open must retain its ACK so
            // a superseded load can close the subscription created on the Host.
            undefined,
            reason => {
              streamClosed = true
              if (!current()) return
              if (runtime.activeCodexTimeline?.session.nativeId !== threadId) return
              runtime.activeCodexStream = undefined
              runtime.activeCodexTimeline = undefined
              set(state => ({
                codexReadySessionId: undefined,
                sessions: state.sessions.map(item => item.sessionId === session.sessionId ? {...item, running: false} : item),
                selectedSession: state.selectedSession?.sessionId === session.sessionId
                  ? state.selectedSession
                  : state.selectedSession,
                ...(reason === 'failed' ? { error: zhCN.runtime.codexUnavailable } : {}),
              }))
            },
          )
          if (!current()) { await stream.close().catch(() => undefined); return }
          if (streamClosed) throw new Error(zhCN.runtime.codexUnavailable)
          runtime.activeCodexStream = stream
          set({ busyAction: undefined, codexReadySessionId: session.sessionId })
          void runtime.refreshCodexModels(session.sessionId)
          return
        }
        if (session.backend === 'cursor' || session.backend === 'antigravity' || session.backend === 'pi' || session.backend === 'opencode' || session.backend === 'claude') {
          await runtime.closeActiveCodexStream()
          await runtime.closeActiveCursorStream()
          if (!current()) return
          const hasHistory = session.backend === 'antigravity' || session.backend === 'pi' || session.backend === 'opencode' || session.backend === 'claude'
          // History replaces the previous connection's projection. Start the new
          // subscription on an empty projection, so only this subscription's
          // deltas survive the load (and stale bubbles cannot suppress catchUp).
          set(state => ({
            selectedSession: session, sessionModels: undefined, historyHasMore: false,
            ...(hasHistory && state.messages[session.sessionId] !== undefined
              ? { messages: { ...state.messages, [session.sessionId]: [] } } : {}),
          }))
          const acpClient = session.backend === 'claude' ? runtime.connection.requireClaude() : session.backend === 'opencode'
            ? runtime.connection.requireOpencode()
            : session.backend === 'pi'
              ? runtime.connection.requirePi()
              : session.backend === 'antigravity' ? runtime.connection.requireAntigravity() : runtime.connection.requireCursor()
          const [history] = await Promise.all([
            session.backend === 'claude' ? readClaudeHistory(acpClient, cursorNativeId(session)) : session.backend === 'opencode'
              ? readOpencodeHistory(acpClient, cursorNativeId(session))
              : session.backend === 'pi'
                ? readPiHistory(acpClient, cursorNativeId(session))
                : session.backend === 'antigravity'
                  ? readAntigravityHistory(acpClient, cursorNativeId(session))
                  : Promise.resolve([] as unknown[]),
            runtime.ensureCursorStream(session, current),
          ])
          if (!current()) return
          const items = foldAcpHistory(history, session.sessionId)
          set(state => ({
            selectedSession: state.selectedSession?.sessionId === session.sessionId ? state.selectedSession : session,
            sessions: state.sessions.some(item => item.sessionId === session.sessionId)
              ? state.sessions
              : [session, ...state.sessions],
            messages: {
              ...state.messages,
              [session.sessionId]: hasHistory
                ? mergeAcpHistoryAndLive(items, state.messages[session.sessionId] ?? [])
                : mergeHistoryAndLive(items, state.messages[session.sessionId] ?? []),
            },
            sessionModels: undefined,
            historyHasMore: false,
            oldestLoadedSeq: undefined,
            busyAction: undefined,
          }))
          if (session.backend === 'antigravity') void runtime.refreshAntigravityModels(session, current)
          if (session.backend === 'pi') void runtime.refreshPiModels(session, current)
          if (session.backend === 'opencode') void runtime.refreshOpencodeModels(session, current)
          if (session.backend === 'claude') void runtime.refreshClaudeModels(session, current)
          if (session.backend === 'cursor') void runtime.refreshCursorModels(session, current)
          return
        }
        void runtime.closeActiveCodexStream()
        void runtime.closeActiveCursorStream()
        const [history, feedback] = await Promise.all([
          runtime.connection.requireProxy().sessionHistory(session.sessionId, undefined, 16, isSubagentSession(session) ? session.parentSessionId : undefined),
          // Older carriers may not expose feedback; history must remain usable.
          runtime.connection.requireProxy().messageFeedbackList(session.sessionId).catch(() => undefined),
        ])
        if (!current()) return
        // The follow snapshot's projections were emitted synchronously inside
        // sessionHistory — apply queued frames before reading them below, or the
        // delivery reconcile judges against a stale inbox.
        runtime.flushPendingMuxFrames()
        const ratings = feedback === undefined ? undefined : new Map(feedback.map(row => [row.messageId, row.rating]))
        const items = foldHistory(history.events, session.sessionId, true)
        set(state => {
          const latest = state.sessions.find(item => item.sessionId === session.sessionId)
            ?? (state.selectedSession?.sessionId === session.sessionId ? state.selectedSession : session)
          const lifecycle = latestHistoryLifecycle(history.events)
          const liveLifecycle = state.sessionLifecycles[session.sessionId]
          const authoritativeLifecycle = liveLifecycle !== undefined && liveLifecycle.seq > (history.throughSeq ?? lifecycle?.seq ?? -1)
            ? liveLifecycle : lifecycle
          const nextSession = { ...latest, running: authoritativeLifecycle?.running ?? latest.running }
          // Reconcile local delivery states against Host truth — only when a real
          // `inbox` snapshot exists (the key itself, not merely the projection
          // channel), and only for rows created before this connection. The
          // reconciliation marks, never deletes: a late `user/message` echo still
          // replaces the row by requestRpcId, so a misjudgment self-heals.
          const inboxSnapshot = latest.projections?.values?.inbox
          const merged = applyFeedback(mergeHistoryAndLive(items, browseLive(items, state.messages[session.sessionId] ?? []), history.throughSeq), ratings)
          const reconciled = inboxSnapshot === undefined ? merged : reconcileDeliveryStates(
            merged,
            inboxRpcIds(inboxSnapshot),
            new Set(items.flatMap(item => item.kind === 'message' && item.requestRpcId !== undefined ? [item.requestRpcId] : [])),
            runtime.connectionStartedAt,
          )
          const restored = nextSession.running === false ? settleTurnItems(reconciled)
            : authoritativeLifecycle?.turn === undefined ? reconciled : settleTurnItems(reconciled, undefined, authoritativeLifecycle.turn)
          return {
            selectedSession: nextSession,
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? nextSession : item),
            ...(authoritativeLifecycle === undefined ? {} : { sessionLifecycles: { ...state.sessionLifecycles, [session.sessionId]: authoritativeLifecycle } }),
            historyLoadingOlder: false,
            feedbackBySession: ratings === undefined ? state.feedbackBySession : { ...state.feedbackBySession, [session.sessionId]: ratings },
            messages: { ...state.messages, [session.sessionId]: restored },
            ...pageState(history.hasMore, oldestSeq(history.events)),
            busyAction: undefined,
          }
        })
        void runtime.refreshSessionModels(session.sessionId)
      }
      try {
        await load()
        if (!current()) return false
        return await finishOpen()
      } catch (error) {
        if (!current()) return false
        // A subagent address that never answers must not burn a full reconnect
        // cycle on every open; top-level session stalls still fall back to
        // forceRelay once (the pre-bounding recovery path).
        const transportRetry = (isRpcTimeoutError(error) || isRecoverableTransportError(error))
          && !(isStreamTimeoutError(error) && isSubagentSession(session))
          && !runtime.sessionReadRetry
        if (transportRetry) {
          if (runtime.reconnectFlight !== undefined) {
            set({ busyAction: undefined, error: friendlyError(error) })
            return false
          }
          // session.history is read-only, so it is safe to recover the stale
          // path with a fresh Relay-only connection and retry exactly once.
          // Mutating Harness calls deliberately do not use this path because a
          // timeout leaves their result unknown.
          const recovered = await get().reconnect({ forceRelay: true, restoreSession: false })
          if (runtime.sessionReadAbort !== readAbort || get().selectedDevice?.deviceId !== hostId) return false
          if (recovered) {
            // The replaced connection owns a new abort/generation scope.
            // Mark this bounded retry so another failed read cannot reconnect in a loop.
            runtime.sessionReadRetry = true
            try { return await get().openSession(session) }
            finally { runtime.sessionReadRetry = false }
          }
          set({ busyAction: undefined })
          return false
        }
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async forkChatMessage(message) {
      if (get().connection.phase !== 'connected' || get().busyAction !== undefined || get().selectedSession?.backend === 'codex') return false
      set({ busyAction: `fork:${message.id}`, error: undefined })
      try {
        const result = await forkMessage(message, runtime.connection.requireProxy())
        set({ sessions: result.sessions, workspaces: result.workspaces, busyAction: undefined })
        return await get().openSession(result.session)
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async rateMessage(message, rating) {
      if (get().connection.phase !== 'connected' || get().busyAction !== undefined || get().selectedSession?.backend === 'codex' || message.streaming) return false
      set({ busyAction: `feedback:${message.id}`, error: undefined })
      try {
        const saved = await runtime.connection.requireProxy().messageFeedbackPut(message.sessionId, message.id, rating)
        set(state => ({
          busyAction: undefined,
          feedbackBySession: state.feedbackBySession[message.sessionId] === undefined ? state.feedbackBySession : {
            ...state.feedbackBySession,
            [message.sessionId]: new Map(state.feedbackBySession[message.sessionId]).set(message.id, saved.rating),
          },
          messages: {
            ...state.messages,
            [message.sessionId]: (state.messages[message.sessionId] ?? []).map(item => item.id === message.id && item.kind === 'message' ? { ...item, feedback: saved.rating } : item),
          }
        }))
        return true
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async createSession(workspaceId) {
      if (get().connection.phase !== 'connected') return false
      if (runtime.createSessionFlight !== undefined || get().busyAction === 'create-session') return false
      const task = (async () => {
        const generation = runtime.connectionGeneration
        const defaultPermission = get().defaultPermissionPreset
        set({ busyAction: 'create-session', error: undefined })
        try {
          const workspace = workspaceId === undefined ? undefined : get().workspaces.find(item => item.workspaceId === workspaceId)
          if (workspace?.backend === 'codex') {
            const client = runtime.connection.requireCodex()
            const result = record(await client.request('thread/start', {
              cwd: workspace.path,
              permissionPreset: defaultPermission === 'default' ? 'workspace-write' : defaultPermission,
            }))
            if (generation !== runtime.connectionGeneration) return false
            const display = projectCodexThread(result.thread)
            if (display === undefined) throw new Error(zhCN.runtime.codexInvalidResponse)
            const effectivePreset = codexPermissionPresetFromResponse(result)
              ?? (defaultPermission === 'default' ? 'workspace-write' : defaultPermission)
            const created = codexSession(display, effectivePreset)
            const hostDeviceId = get().selectedDevice?.deviceId
            if (hostDeviceId === undefined) throw new Error(zhCN.runtime.connectHostFirst)
            await saveCodexPermissionPreset(hostDeviceId, display.nativeId, effectivePreset)
            if (generation !== runtime.connectionGeneration) return false
            set(state => ({
              sessions: [created, ...state.sessions.filter(item => item.sessionId !== created.sessionId)],
              workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
                ? { ...item, sessionIds: [created.sessionId, ...item.sessionIds.filter(id => id !== created.sessionId)] }
                : item),
              busyAction: undefined,
            }))
            return get().openSession(created)
          }
          if (workspace?.backend === 'cursor') {
            const created = await runtime.connection.requireCursor().createSession(workspace.path, 'agent', 'cursor')
            const session = createCursorSession({
              acpSessionId: created.sessionId,
              cwd: workspace.path,
              title: workspace.title,
            })
            set(state => ({
              sessions: [session, ...state.sessions.filter(item => item.sessionId !== session.sessionId)],
              workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
                ? {
                  ...item,
                  sessionIds: [session.sessionId, ...item.sessionIds.filter(id => id !== session.sessionId)],
                  updatedAt: new Date().toISOString(),
                }
                : item),
              busyAction: undefined,
            }))
            return get().openSession(session)
          }
          if (workspace?.backend === 'antigravity') {
            const created = await runtime.connection.requireAntigravity().createSession(workspace.path, 'agent', 'antigravity')
            const session = createAntigravitySession({
              acpSessionId: created.sessionId,
              cwd: workspace.path,
            })
            set(state => ({
              sessions: [session, ...state.sessions.filter(item => item.sessionId !== session.sessionId)],
              workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
                ? {
                  ...item,
                  sessionIds: [session.sessionId, ...item.sessionIds.filter(id => id !== session.sessionId)],
                  updatedAt: new Date().toISOString(),
                }
                : item),
              busyAction: undefined,
            }))
            return get().openSession(session)
          }
          if (workspace?.backend === 'pi') {
            const created = await runtime.connection.requirePi().createSession(workspace.path, 'agent', 'pi')
            if (generation !== runtime.connectionGeneration) return false
            const session = createPiSession({
              acpSessionId: created.sessionId,
              cwd: workspace.path,
            })
            set(state => ({
              sessions: [session, ...state.sessions.filter(item => item.sessionId !== session.sessionId)],
              workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
                ? {
                  ...item,
                  sessionIds: [session.sessionId, ...item.sessionIds.filter(id => id !== session.sessionId)],
                  updatedAt: new Date().toISOString(),
                }
                : item),
              busyAction: undefined,
            }))
            return get().openSession(session)
          }
          if (workspace?.backend === 'opencode') {
            const created = await runtime.connection.requireOpencode().createSession(workspace.path, 'agent', 'opencode')
            if (generation !== runtime.connectionGeneration) return false
            const session = createOpencodeSession({
              acpSessionId: created.sessionId,
              cwd: workspace.path,
            })
            set(state => ({
              sessions: [session, ...state.sessions.filter(item => item.sessionId !== session.sessionId)],
              workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
                ? {
                  ...item,
                  sessionIds: [session.sessionId, ...item.sessionIds.filter(id => id !== session.sessionId)],
                  updatedAt: new Date().toISOString(),
                }
                : item),
              busyAction: undefined,
            }))
            return get().openSession(session)
          }
          if (workspace?.backend === 'claude') {
            const created = await runtime.connection.requireClaude().createSession(workspace.path, 'agent', 'claude')
            if (generation !== runtime.connectionGeneration) return false
            const session = createClaudeSession({
              acpSessionId: created.sessionId,
              cwd: workspace.path,
            })
            set(state => ({
              sessions: [session, ...state.sessions.filter(item => item.sessionId !== session.sessionId)],
              workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
                ? {
                  ...item,
                  sessionIds: [session.sessionId, ...item.sessionIds.filter(id => id !== session.sessionId)],
                  updatedAt: new Date().toISOString(),
                }
                : item),
              busyAction: undefined,
            }))
            return get().openSession(session)
          }
          const proxy = runtime.connection.requireProxy()
          const { sessionId } = await proxy.sessionCreate(workspaceId)
          if (generation !== runtime.connectionGeneration) return false
          if (defaultPermission !== 'default') {
            await proxy.sessionSelectPermission(sessionId, defaultPermission)
            if (generation !== runtime.connectionGeneration) return false
          }
          const sessions = await proxy.sessionList()
          if (generation !== runtime.connectionGeneration) return false
          const created = sessions.find(session => session.sessionId === sessionId)
          if (defaultPermission !== 'default') {
            const permissions = created?.projections?.values?.permissions
            if (typeof permissions !== 'object' || permissions === null || !('currentValue' in permissions) || permissions.currentValue !== defaultPermission) {
              throw new Error(zhCN.settings.defaultPermissionNotConfirmed)
            }
          }
          set(state => ({
            sessions,
            busyAction: undefined,
            ...(workspace === undefined ? {} : {
              workspaces: state.workspaces.map(item => item.workspaceId === workspace.workspaceId
                ? { ...item, sessionIds: [sessionId, ...item.sessionIds.filter(id => id !== sessionId)] }
                : item),
            }),
          }))
          if (created === undefined) return false
          return get().openSession(created)
        } catch (error) {
          set({ busyAction: undefined, error: friendlyError(error) })
          return false
        }
      })()
      runtime.createSessionFlight = task
      void task.finally(() => { if (runtime.createSessionFlight === task) runtime.createSessionFlight = undefined })
      return task
    },

    async archiveSession(sessionId) {
      if (get().connection.phase !== 'connected') return false
      const generation = runtime.connectionGeneration
      set({ busyAction: `archive:${sessionId}`, error: undefined })
      try {
        const session = get().sessions.find(item => item.sessionId === sessionId)
        if (session?.backend === 'codex') {
          await runtime.connection.requireCodex().request('thread/archive', { threadId: codexThreadId(session) })
          if (generation !== runtime.connectionGeneration) return false
          if (runtime.activeCodexTimeline?.session.id === sessionId) await runtime.closeActiveCodexStream()
          if (generation !== runtime.connectionGeneration) return false
          set(state => ({
            sessions: state.sessions.filter(item => item.sessionId !== sessionId),
            workspaces: state.workspaces.map(workspace => ({
              ...workspace,
              sessionIds: workspace.sessionIds.filter(id => id !== sessionId),
            })),
            busyAction: undefined,
            selectedSession: state.selectedSession?.sessionId === sessionId ? undefined : state.selectedSession,
            sessionModels: state.selectedSession?.sessionId === sessionId ? undefined : state.sessionModels,
          }))
          return true
        }
        if (session?.backend === 'cursor' || session?.backend === 'antigravity' || session?.backend === 'pi' || session?.backend === 'opencode' || session?.backend === 'claude') {
          if (session.backend !== 'opencode') throw new Error(`Native session archiving is unavailable for ${session.backend}.`)
          await runtime.connection.requireOpencode().archiveSession(cursorNativeId(session), 'opencode')
          if (generation !== runtime.connectionGeneration) return false
          if (get().selectedSession?.sessionId === sessionId) await runtime.closeActiveCursorStream()
          if (generation !== runtime.connectionGeneration) return false
          set(state => ({
            sessions: state.sessions.filter(item => item.sessionId !== sessionId),
            workspaces: state.workspaces.map(workspace => ({
              ...workspace,
              sessionIds: workspace.sessionIds.filter(id => id !== sessionId),
            })),
            busyAction: undefined,
            selectedSession: state.selectedSession?.sessionId === sessionId ? undefined : state.selectedSession,
            sessionModels: state.selectedSession?.sessionId === sessionId ? undefined : state.sessionModels,
          }))
          return true
        }
        const proxy = runtime.connection.requireProxy()
        const archivedSessionIds = await proxy.workspaceArchiveSession(sessionId)
        if (generation !== runtime.connectionGeneration) return false
        // The mutation returns the complete Host-confirmed archive set. Preserve
        // catalog membership, and do not let a second read hide a successful write.
        set(state => ({
          archivedSessionIds,
          busyAction: undefined,
          selectedSession: state.selectedSession?.sessionId === sessionId ? undefined : state.selectedSession,
          sessionModels: state.selectedSession?.sessionId === sessionId ? undefined : state.sessionModels,
        }))
        return true
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async selectModel(selection) {
      const generation = runtime.connectionGeneration
      const session = get().selectedSession
      if (session === undefined || get().connection.phase !== 'connected') return false
      set({ modelSelecting: true, error: undefined })
      try {
        if (session.backend === 'codex') {
          if (selection.provider !== 'codex') throw new Error(zhCN.runtime.codexInvalidResponse)
          runtime.codexModelSelections.set(session.sessionId, selection)
          set(state => ({
            sessionModels: state.sessionModels === undefined ? undefined : { ...state.sessionModels, current: selection },
            modelSelecting: false,
          }))
          return true
        }
        if (session.backend === 'pi') {
          const models = await selectPiModel(runtime.connection.requirePi(), cursorNativeId(session), selection)
          if (generation !== runtime.connectionGeneration || get().selectedSession?.sessionId !== session.sessionId) return false
          set({ sessionModels: models, modelSelecting: false })
          return true
        }
        if (session.backend === 'opencode') {
          const models = await selectOpencodeModel(runtime.connection.requireOpencode(), cursorNativeId(session), selection)
          if (generation !== runtime.connectionGeneration || get().selectedSession?.sessionId !== session.sessionId) return false
          set({ sessionModels: models, modelSelecting: false })
          return true
        }
        if (session.backend === 'claude') {
          const models = await selectClaudeModel(runtime.connection.requireClaude(), cursorNativeId(session), selection)
          if (generation !== runtime.connectionGeneration || get().selectedSession?.sessionId !== session.sessionId) return false
          set({ sessionModels: models, modelSelecting: false })
          return true
        }
        if (session.backend === 'antigravity') {
          const models = await selectAcpModel(runtime.connection.requireAntigravity(), cursorNativeId(session), 'antigravity', selection)
          if (generation !== runtime.connectionGeneration || get().selectedSession?.sessionId !== session.sessionId) return false
          set({ sessionModels: models, modelSelecting: false })
          return true
        }
        if (session.backend === 'cursor') {
          const models = await selectAcpModel(runtime.connection.requireCursor(), cursorNativeId(session), 'cursor', selection)
          if (generation !== runtime.connectionGeneration || get().selectedSession?.sessionId !== session.sessionId) return false
          set({ sessionModels: models, modelSelecting: false })
          return true
        }
        const selected = await runtime.connection.requireProxy().sessionSelectModel(session.sessionId, selection)
        set(state => ({
          sessionModels: state.sessionModels === undefined ? undefined : { ...state.sessionModels, current: selected },
          modelSelecting: false,
        }))
        return true
      } catch (error) {
        if ((session.backend === 'cursor' || session.backend === 'pi' || session.backend === 'opencode' || session.backend === 'claude' || session.backend === 'antigravity') && (generation !== runtime.connectionGeneration || get().selectedSession?.sessionId !== session.sessionId)) return false
        set({ modelSelecting: false, error: friendlyError(error) })
        return false
      }
    },

    async selectPermission(preset) {
      const session = get().selectedSession
      if (session?.backend === 'cursor' || session?.backend === 'antigravity' || session?.backend === 'pi' || session?.backend === 'opencode' || session?.backend === 'claude') return false
      if (session === undefined || get().connection.phase !== 'connected' || get().permissionSelecting) return false
      const generation = runtime.connectionGeneration
      set({ permissionSelecting: true, error: undefined })
      try {
        if (session.backend === 'codex') {
          if (!isCodexPermissionPreset(preset)) {
            throw new Error(zhCN.runtime.codexInvalidResponse)
          }
          const hostDeviceId = get().selectedDevice?.deviceId
          if (hostDeviceId === undefined) throw new Error(zhCN.runtime.connectHostFirst)
          const threadId = codexThreadId(session)
          const result = await runtime.connection.requireCodex().request('thread/resume', { threadId, permissionPreset: preset })
          if (generation !== runtime.connectionGeneration) return false
          const effectivePreset = codexPermissionPresetFromResponse(result) ?? preset
          await saveCodexPermissionPreset(hostDeviceId, threadId, effectivePreset)
          set(state => ({
            ...withCodexPermissionState(state, session.sessionId, effectivePreset),
            permissionSelecting: false,
          }))
          return true
        }
        const proxy = runtime.connection.requireProxy()
        await proxy.sessionSelectPermission(session.sessionId, preset)
        // Read back the official projection; never fabricate an accepted grant.
        const confirmed = (await proxy.sessionList()).find(item => item.sessionId === session.sessionId)
        if (generation !== runtime.connectionGeneration) return false
        const permissions = confirmed?.projections?.values?.permissions
        if (typeof permissions !== 'object' || permissions === null || !('currentValue' in permissions) || permissions.currentValue !== preset) {
          throw new Error('The Host did not confirm the selected permission preset.')
        }
        set(state => {
          const update = (item: RemoteSession): RemoteSession => {
            if (item.sessionId !== session.sessionId) return item
            return {
              ...item,
              projections: { ...item.projections, values: { ...item.projections?.values, permissions } },
            }
          }
          return {
            sessions: state.sessions.map(update),
            selectedSession: state.selectedSession === undefined ? undefined : update(state.selectedSession),
            permissionSelecting: false,
          }
        })
        return true
      } catch (error) {
        set({ permissionSelecting: false, error: friendlyError(error) })
        return false
      }
    },

    async loadAgentPresets() {
      const backend = get().selectedSession?.backend
      if (backend === 'cursor' || backend === 'antigravity' || backend === 'pi' || backend === 'opencode' || backend === 'claude') return false
      if (get().connection.phase !== 'connected') return false
      if (get().agentPresetLoading) return false
      set({ agentPresetLoading: true, error: undefined })
      try {
        const roster = await runtime.connection.requireProxy().agentPresetList()
        set({ agentPresetOptions: [...roster.presets], agentPresetLoading: false })
        return true
      } catch (error) {
        set({ agentPresetLoading: false, error: friendlyError(error) })
        return false
      }
    },

    async selectAgentPreset(preset) {
      const session = get().selectedSession
      if (session === undefined || get().connection.phase !== 'connected') return false
      if (session.backend === 'codex' || session.backend === 'cursor' || session.backend === 'antigravity' || session.backend === 'pi' || session.backend === 'opencode' || session.backend === 'claude') return false
      set({ agentPresetSelecting: true, error: undefined })
      try {
        const committed = await runtime.connection.requireProxy().agentPresetSelect(session.sessionId, preset)
        set(state => {
          const update = (item: RemoteSession): RemoteSession =>
            item.sessionId === session.sessionId ? { ...item, agentPreset: committed } : item
          return {
            sessions: state.sessions.map(update),
            selectedSession: state.selectedSession === undefined ? undefined : update(state.selectedSession),
            agentPresetSelecting: false,
          }
        })
        return true
      } catch (error) {
        set({ agentPresetSelecting: false, error: friendlyError(error) })
        return false
      }
    },

    async loadOlderHistory() {
      runtime.flushPendingMuxFrames()
      const session = get().selectedSession
      const beforeSeq = get().oldestLoadedSeq
      if (session === undefined || beforeSeq === undefined || get().historyLoadingOlder || !get().historyHasMore || get().busyAction?.startsWith('session:')) return
      const generation = runtime.sessionLoadGeneration
      const connectionGeneration = runtime.connectionGeneration
      const current = () => generation === runtime.sessionLoadGeneration && connectionGeneration === runtime.connectionGeneration
      if (session.backend === 'cursor' || session.backend === 'antigravity' || session.backend === 'pi' || session.backend === 'opencode' || session.backend === 'claude') {
        set({ historyHasMore: false, historyLoadingOlder: false })
        return
      }
      set({ historyLoadingOlder: true })
      try {
        const page = session.backend === 'codex'
          ? await readCodexHistoryPage(runtime.connection.requireCodex(), codexThreadId(session), beforeSeq, 60)
          : await runtime.connection.requireProxy().sessionHistory(session.sessionId, beforeSeq, 60, isSubagentSession(session) ? session.parentSessionId : undefined)
        if (!current()) return
        const items = foldHistory(page.events, session.sessionId, true)
        const older = oldestSeq(page.events)
        set(state => ({
          messages: {
            ...state.messages,
            [session.sessionId]: applyFeedback(prependHistory(items, state.messages[session.sessionId] ?? []), session.backend === 'codex' ? undefined : state.feedbackBySession[session.sessionId]),
          },
          ...(state.selectedSession?.sessionId === session.sessionId ? {
            historyHasMore: page.hasMore,
            oldestLoadedSeq: older ?? state.oldestLoadedSeq,
            historyLoadingOlder: false,
          } : {}),
        }))
      } catch (error) {
        if (!current()) return
        set(state => state.selectedSession?.sessionId === session.sessionId
          ? { historyLoadingOlder: false, error: friendlyError(error) } : {})
      }
    },
  }
}
