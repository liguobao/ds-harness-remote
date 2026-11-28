import { extractHandoffOriginFromItems, formatHandoffPayload, type PendingHandoffDraft } from '../lib/handoff-context'
import { firstLineSnippet } from '../lib/handoff-preview'
import { isSessionInTargetWorkspace } from '../lib/handoff-workspace'
import { catalogMutationVersion, invalidateCatalogMetadata, mergeBackendPinnedSessionIds } from '../lib/session-backend'
import { isSubagentSession } from '../lib/session-kind'
import { isAbsoluteHostPath, isAcpManagedBackend } from '../lib/workspace-key'
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
  acpPermissionsValue,
  createAcpSession,
  createAntigravitySession,
  createCursorSession,
  createOpencodeSession,
  createClaudeSession,
  createHermesSession,
  createKimiSession,
  createPiSession,
  cursorNativeId,
  finalizeAssistantLive,
  foldAcpHistory,
  mergeAcpHistoryAndLive,
  readAcpHistory,
  reconcileAcpCachedPrompts,
} from '../services/cursor'
import { forkMessage } from '../services/message-actions'
import { readOpencodeHistory } from '../services/opencode'
import { readClaudeHistory } from '../services/claude'
import { loadHermesCatalog, mergeHermesCatalog, readHermesHistory } from '../services/hermes'
import { readKimiHistory } from '../services/kimi'
import { readPiHistory } from '../services/pi'
import { saveCodexPermissionPreset } from '../services/storage'
import * as browseMemoryModule from '../services/browse-memory'
import { browseKey, browseScope, getCachedSessionMessages, recordHandoffOrigin, saveSessionMessagesSnapshot, updateBrowseEntry, useBrowseMemory } from '../services/browse-memory'
import type { AgentBackend, ChatItem, RemoteSession, WorkspaceView } from '../types'
import { loadSavedCodexPermissions, withBestCodexPermission, withCodexPermissionState } from './codex-session-state'
import { foldHistory, settleTurnItems } from './event-reducer'
import { inboxRpcIds, mergeHistoryAndLive, oldestSeq, prependHistory, reconcileDeliveryStates, reconcileUserQuestionsProjection, reuseUnchangedChatItems } from './message-helpers'
import type { SessionAccess } from './session-runtime'
import { applyFeedback, latestHistoryLifecycle, record, withActiveCodexTurn } from './session-state'
import type { AppState, HandoffSessionResult } from './store-state'

const ACP_PAGE_SIZE = 60
const acpOlderHistory = new Map<string, import('../types').ChatItem[]>()

export function storeAcpPagedMessages(
  sessionId: string,
  merged: import('../types').ChatItem[],
): { tail: import('../types').ChatItem[]; historyHasMore: boolean; oldestLoadedSeq?: number } {
  const splitAt = Math.max(0, merged.length - ACP_PAGE_SIZE)
  const older = merged.slice(0, splitAt)
  const tail = merged.slice(splitAt)
  if (older.length > 0) acpOlderHistory.set(sessionId, older)
  else acpOlderHistory.delete(sessionId)
  return {
    tail,
    historyHasMore: older.length > 0,
    oldestLoadedSeq: older.length > 0 ? older.length : undefined,
  }
}

import { acpClientForBackend, hasAcpBackendFor } from './acp-backend-helpers'
export { acpClientForBackend, hasAcpBackendFor }

/** Session actions use the store's single connection/session runtime. */
export function createSessionActions({ get, set, runtime }: SessionAccess): Pick<AppState,
  'refreshSessionStatus' | 'syncHarnessCatalog' | 'openSession' | 'forkChatMessage' | 'quoteChatMessage' | 'rateMessage' | 'createSession' | 'loadSessionHandoffItems' | 'handoffSession' | 'forkSession' | 'archiveSession' | 'unarchiveSession' | 'pinSession' | 'unpinSession' | 'renameSession' | 'selectModel' | 'selectPermission' | 'loadAgentPresets' | 'selectAgentPreset' | 'loadOlderHistory'> {
  let modelSelectToken = 0
  let permissionSelectToken = 0
  let agentPresetLoadToken = 0
  let agentPresetSelectToken = 0
  // Track sessions currently displaying an offline browse-memory snapshot so
  // online read-only handoff loads never shortcut to stale offline messages.
  const offlineOnlySessionIds = new Set<string>()

  const isHarnessBackend = (backend?: RemoteSession['backend']) =>
    (backend ?? 'harness') === 'harness'

  const isHarnessTarget = (sessionId: string, backend?: RemoteSession['backend']) => {
    const target = get().sessions.find(item => item.sessionId === sessionId)
    const effectiveBackend = backend ?? target?.backend ?? 'harness'
    return isHarnessBackend(effectiveBackend) && (!target || isHarnessBackend(target.backend))
  }

  const persistCatalogState = () => {
    const state = get()
    if (!state.selectedDevice) return
    try {
      const scope = browseScope(state)
      if (!scope) return
      if (browseMemoryModule.saveBrowseCatalog?.(scope, state.workspaces, state.sessions, {
        pinnedSessionIds: state.pinnedSessionIds,
        archivedSessionIds: state.archivedSessionIds,
      })) void Promise.resolve(browseMemoryModule.flushBrowseMemory?.()).catch(() => undefined)
    } catch { /* ignore partial browse-memory mocks in unit tests */ }
  }

  const createAcpSessionForBackend = (
    backend: Exclude<AgentBackend, 'harness' | 'codex'>,
    acpSessionId: string,
    cwd?: string,
    title?: string,
  ): RemoteSession => {
    if (backend === 'cursor') return createCursorSession({ acpSessionId, cwd })
    if (backend === 'antigravity') return createAntigravitySession({ acpSessionId, cwd })
    if (backend === 'pi') return createPiSession({ acpSessionId, cwd })
    if (backend === 'opencode') return createOpencodeSession({ acpSessionId, cwd })
    if (backend === 'claude') return createClaudeSession({ acpSessionId, cwd })
    if (backend === 'hermes') return createHermesSession({ acpSessionId, cwd })
    if (backend === 'kimi') return createKimiSession({ acpSessionId, cwd })
    return createAcpSession({ backend, acpSessionId, cwd, title })
  }

  const applyDefaultAcpPermission = async (
    acpBackend: string,
    client: ReturnType<typeof acpClientForBackend>,
    session: RemoteSession,
    defaultPermission: AppState['defaultPermissionPreset'],
  ): Promise<RemoteSession> => {
    if (defaultPermission !== 'workspace-write' && defaultPermission !== 'danger-full-access') {
      return session
    }
    if (defaultPermission === 'workspace-write') return session
    try {
      const confirmed = await client.selectPermission(cursorNativeId(session), acpBackend, defaultPermission)
      const confirmedRecord = typeof confirmed === 'object' && confirmed !== null
        ? confirmed as Record<string, unknown>
        : undefined
      const effective = typeof confirmedRecord?.preset === 'string'
        ? confirmedRecord.preset
        : defaultPermission
      return {
        ...session,
        projections: {
          ...session.projections,
          values: {
            ...session.projections?.values,
            permissions: acpPermissionsValue(effective),
          },
        },
      }
    } catch {
      // Older Hosts may not support dsh/selectPermission; keep the safe default.
      return session
    }
  }

  const createOrReuseWorkspaceSession = async ({
    workspaceId,
    workspace,
    targetBackend,
    generation,
    excludeSavedDraft = false,
    excludeSessionId,
  }: {
    workspaceId?: string
    workspace: WorkspaceView | undefined
    targetBackend?: AgentBackend
    generation: number
    excludeSavedDraft?: boolean
    excludeSessionId?: string
  }): Promise<{ ok: true; session: RemoteSession; generation: number } | { ok: false; error?: string }> => {
    const defaultPermission = get().defaultPermissionPreset
    const initialHostId = get().selectedDevice?.deviceId
    const initialIdentityKey = get().selectedDevice?.identityKey
    const openOnSameHost = async (target: RemoteSession): Promise<{ ok: true; session: RemoteSession; generation: number } | { ok: false; error?: string }> => {
      const opened = await get().openSession(target)
      const currentState = get()
      if (generation === runtime.connectionGeneration) {
        return opened ? { ok: true, session: target, generation } : { ok: false, error: currentState.error }
      }
      const sameConnectedHost = currentState.connection.phase === 'connected'
        && currentState.selectedDevice?.deviceId === initialHostId
        && currentState.selectedDevice?.identityKey === initialIdentityKey
        && currentState.selectedSession?.sessionId === target.sessionId
        && (currentState.selectedSession?.backend ?? 'harness') === (target.backend ?? 'harness')
      if (opened && sameConnectedHost) {
        return { ok: true, session: target, generation: runtime.connectionGeneration }
      }
      return { ok: false }
    }
    set({ busyAction: 'create-session', error: undefined })
    try {
      const backend = targetBackend ?? workspace?.backend ?? 'harness'
      // Only an explicitly blank, idle conversation in this workspace is
      // reusable. Titles are not evidence that a conversation is empty.
      const state = get()
      const scope = excludeSavedDraft ? browseScope({ config: state.config, selectedDevice: state.selectedDevice }) : undefined
      const browseEntries = excludeSavedDraft ? useBrowseMemory.getState().entries : undefined
      const reusable = workspace === undefined ? undefined : state.sessions
        .filter(item => {
          if (!workspace.sessionIds.includes(item.sessionId)
            || (excludeSessionId !== undefined && item.sessionId === excludeSessionId)
            || (item.backend ?? 'harness') !== backend
            || item.blank !== true || item.running
            || state.sessionLifecycles[item.sessionId]?.running
            || isSubagentSession(item)
            || state.archivedSessionIds.includes(item.sessionId)
            || (state.messages[item.sessionId]?.length ?? 0) > 0
            || (state.selectedSession?.sessionId === item.sessionId
              && (state.selectedSession.blank === false || state.selectedSession.running))) {
            return false
          }
          if (excludeSavedDraft && scope !== undefined) {
            const entry = browseEntries?.[browseKey(scope, item.sessionId)]
            if (
              entry?.handoff !== undefined
              || (entry?.draft?.trim().length ?? 0) > 0
              || (entry?.images?.length ?? 0) > 0
              || (entry?.quotes?.length ?? 0) > 0
              || (entry?.messages?.length ?? 0) > 0
            ) return false
          }
          return true
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (reusable !== undefined) {
        return await openOnSameHost(reusable)
      }
      const existingPath = workspace?.path || get().workspaces.find(w => !!w.path)?.path
      const isWin = get().selectedDevice?.platform === 'windows'
      const cwd = existingPath || (isWin ? 'C:\\' : '/')
      if (backend === 'codex') {
        const client = runtime.connection.requireCodex()
        const result = record(await client.request('thread/start', {
          cwd,
          permissionPreset: defaultPermission === 'default' ? 'workspace-write' : defaultPermission,
        }))
        if (generation !== runtime.connectionGeneration) return { ok: false }
        const display = projectCodexThread(result.thread)
        if (display === undefined) throw new Error(zhCN.runtime.codexInvalidResponse)
        const effectivePreset = codexPermissionPresetFromResponse(result)
          ?? (defaultPermission === 'default' ? 'workspace-write' : defaultPermission)
        const created = codexSession(display, effectivePreset)
        const hostDeviceId = get().selectedDevice?.deviceId
        if (hostDeviceId === undefined) throw new Error(zhCN.runtime.connectHostFirst)
        await saveCodexPermissionPreset(hostDeviceId, display.nativeId, effectivePreset)
        if (generation !== runtime.connectionGeneration) return { ok: false }
        set(currentState => ({
          sessions: [created, ...currentState.sessions.filter(item => item.sessionId !== created.sessionId)],
          ...(workspace === undefined ? {} : {
            workspaces: currentState.workspaces.map(item => item.workspaceId === workspace.workspaceId
              ? { ...item, sessionIds: [created.sessionId, ...item.sessionIds.filter(id => id !== created.sessionId)] }
              : item),
          }),
          busyAction: undefined,
        }))
        return await openOnSameHost(created)
      }
      if (isAcpManagedBackend(backend)) {
        const client = acpClientForBackend(runtime.connection, backend)
        const created = await client.createSession(cwd, 'agent', backend)
        if (generation !== runtime.connectionGeneration) return { ok: false }
        const session = await applyDefaultAcpPermission(
          backend,
          client,
          createAcpSessionForBackend(backend, created.sessionId, cwd, workspace?.title),
          defaultPermission,
        )
        if (generation !== runtime.connectionGeneration) return { ok: false }
        set(currentState => ({
          sessions: [session, ...currentState.sessions.filter(item => item.sessionId !== session.sessionId)],
          ...(workspace === undefined ? {} : {
            workspaces: currentState.workspaces.map(item => item.workspaceId === workspace.workspaceId
              ? {
                ...item,
                sessionIds: [session.sessionId, ...item.sessionIds.filter(id => id !== session.sessionId)],
                updatedAt: new Date().toISOString(),
              }
              : item),
          }),
          busyAction: undefined,
        }))
        return await openOnSameHost(session)
      }
      const proxy = runtime.connection.requireProxy()
      const { sessionId } = await proxy.sessionCreate(workspaceId ?? workspace?.workspaceId)
      if (generation !== runtime.connectionGeneration) return { ok: false }
      if (defaultPermission !== 'default') {
        await proxy.sessionSelectPermission(sessionId, defaultPermission)
        if (generation !== runtime.connectionGeneration) return { ok: false }
      }
      const sessions = await proxy.sessionList()
      if (generation !== runtime.connectionGeneration) return { ok: false }
      const created = sessions.find(session => session.sessionId === sessionId)
      if (defaultPermission !== 'default') {
        const permissions = created?.projections?.values?.permissions
        if (typeof permissions !== 'object' || permissions === null || !('currentValue' in permissions) || permissions.currentValue !== defaultPermission) {
          throw new Error(zhCN.settings.defaultPermissionNotConfirmed)
        }
      }
      set(currentState => ({
        sessions: [
          ...currentState.sessions.filter(item => !isHarnessBackend(item.backend)),
          ...sessions,
        ],
        busyAction: undefined,
        ...(workspace === undefined ? {} : {
          workspaces: currentState.workspaces.map(item => item.workspaceId === workspace.workspaceId
            ? { ...item, sessionIds: [sessionId, ...item.sessionIds.filter(id => id !== sessionId)] }
            : item),
        }),
      }))
      if (created === undefined) return { ok: false }
      return await openOnSameHost(created)
    } catch (error) {
      if (generation !== runtime.connectionGeneration) return { ok: false }
      const message = friendlyError(error)
      set({ busyAction: undefined, error: message })
      return { ok: false, error: message }
    } finally {
      if (get().busyAction === 'create-session') set({ busyAction: undefined })
    }
  }

  return {
    /** Pull full `session/list` after a real catalog-change hint (or manual refresh). */
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
          // Preserve array identity when nothing moved so consumers do not
          // re-run memos on a no-op explicit refresh.
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

    /** Pull Harness workspaces + sessions after an event-driven membership change. */
    async syncHarnessCatalog() {
      if (get().connection.phase !== 'connected') return
      const generation = runtime.connectionGeneration
      const deviceId = get().selectedDevice?.deviceId
      const { config, identity } = get()
      let proxy: ReturnType<typeof runtime.connection.requireProxy>
      try {
        proxy = runtime.connection.requireProxy()
      } catch {
        return
      }
      const current = () => generation === runtime.connectionGeneration
        && get().config === config
        && get().identity === identity
        && get().connection.phase === 'connected'
        && get().selectedDevice?.deviceId === deviceId
        && (() => { try { return runtime.connection.requireProxy() === proxy } catch { return false } })()
      try {
        const metadataVersion = catalogMutationVersion(runtime.connection, 'harness')
        const [workspaces, rows] = await Promise.all([proxy.workspaceList(), proxy.sessionList()])
        if (!current() || metadataVersion !== catalogMutationVersion(runtime.connection, 'harness')) return
        set(state => {
          const byId = new Map(rows.map(item => [item.sessionId, item]))
          const marks: typeof state.sessionLifecycles = { ...state.sessionLifecycles }
          for (const row of state.sessions) {
            if ((row.backend ?? 'harness') !== 'harness') continue
            const fresh = byId.get(row.sessionId)
            if (fresh === undefined) continue
            const entry = marks[row.sessionId]
            const wasRunning = entry?.running ?? row.running
            if (wasRunning === fresh.running) continue
            marks[row.sessionId] = {
              seq: entry?.seq ?? -1,
              turn: entry?.turn,
              running: fresh.running,
              ...(fresh.running
                ? { finished: undefined }
                : { finished: entry?.finished === 'failed' ? 'failed' as const : 'completed' as const }),
            }
          }
          const nonHarnessWorkspaces = state.workspaces.filter(item => (item.backend ?? 'harness') !== 'harness')
          const nonHarnessSessions = state.sessions.filter(item => (item.backend ?? 'harness') !== 'harness')
          const selectedFresh = state.selectedSession === undefined
            ? undefined
            : byId.get(state.selectedSession.sessionId)
          const archivedSet = new Set(workspaces.archivedSessionIds ?? [])
          const currentPinned = state.pinnedSessionIds ?? []
          const nextPinnedSessionIds = workspaces.pinnedSessionIds !== undefined
            ? mergeBackendPinnedSessionIds(
                currentPinned,
                'harness',
                workspaces.pinnedSessionIds.filter(id => !archivedSet.has(id)),
              )
            : currentPinned.filter(id => !archivedSet.has(id))
          return {
            sessionLifecycles: marks,
            workspaces: [...nonHarnessWorkspaces, ...workspaces.items],
            sessions: [...nonHarnessSessions, ...rows],
            archivedSessionIds: workspaces.archivedSessionIds,
            pinnedSessionIds: nextPinnedSessionIds,
            ...(selectedFresh === undefined ? {} : { selectedSession: selectedFresh }),
          }
        })
        persistCatalogState()
      } catch { /* background catalog sync is best-effort */ }
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
      const canPersistSnapshot = () => Boolean(get().config?.baseUrl && get().selectedDevice?.identityKey)
      const memoryScope = browseScope(get())
      const cachedSnapshot = canPersistSnapshot() ? getCachedSessionMessages(memoryScope, session.sessionId) : undefined
      const inMemoryMessages = get().messages[session.sessionId]
      const preservedMessages = (inMemoryMessages && inMemoryMessages.length > 0)
        ? inMemoryMessages
        : (cachedSnapshot && cachedSnapshot.length > 0 ? cachedSnapshot : undefined)
      const syncHandoffOrigin = (items: readonly ChatItem[] | undefined) => {
        if (!canPersistSnapshot() || items === undefined || items.length === 0) return
        const detected = extractHandoffOriginFromItems(items)
        if (detected !== undefined) recordHandoffOrigin(memoryScope, session.sessionId, detected)
      }

      if (get().connection.phase !== 'connected') {
        offlineOnlySessionIds.add(session.sessionId)
        syncHandoffOrigin(preservedMessages)
        set(state => ({
          busyAction: undefined,
          selectedSession: session,
          sessions: state.sessions.some(item => item.sessionId === session.sessionId)
            ? state.sessions
            : [session, ...state.sessions],
          ...(preservedMessages !== undefined && state.messages[session.sessionId] !== preservedMessages ? {
            messages: {
              ...state.messages,
              [session.sessionId]: preservedMessages,
            }
          } : {}),
          error: undefined,
          historyLoadingOlder: false,
          sessionModels: undefined,
          modelSelecting: false,
          permissionSelecting: false,
          agentPresetOptions: undefined,
          agentPresetLoading: false,
          agentPresetSelecting: false,
          historyHasMore: false,
          oldestLoadedSeq: undefined,
        }))
        void runtime.rememberRecentWorkspace(session).catch(() => undefined)
        set(state => ({ currentWorkSessionIds: [...state.currentWorkSessionIds.filter(id => id !== session.sessionId), session.sessionId].slice(-32) }))
        return true
      }

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
        // Retain live/optimistic rows and pending approvals/questions, not a misleading gap in cached history.
        return contiguousCache ? existing : existing.filter(item => !cachedIds.has(item.id) || item.id.startsWith('local:') || item.kind === 'approval' || item.kind === 'question')
      }
      runtime.clearCodexRecoveryTimer()
      runtime.clearCursorRecoveryTimer()
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
        acpReadOnlySessionId: undefined,
        selectedSession: session,
        ...(preservedMessages !== undefined && state.messages[session.sessionId] !== preservedMessages ? {
          messages: {
            ...state.messages,
            [session.sessionId]: preservedMessages,
          }
        } : {}),
        historyHasMore: cachedPage?.historyHasMore ?? false,
        oldestLoadedSeq: cachedPage?.oldestLoadedSeq,
        error: undefined,
        historyLoadingOlder: false,
        sessionModels: undefined,
        modelSelecting: false,
        permissionSelecting: false,
        agentPresetOptions: undefined,
        agentPresetLoading: false,
        agentPresetSelecting: false,
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
          const recoveryDelaysMs = [1_500, 3_000, 6_000, 12_000] as const
          const nonRetryableRecoveryCodes = new Set([
            'FEATURE_NOT_SUPPORTED',
            'CODEX_AUTH_REQUIRED',
            'CODEX_THREAD_NOT_ALLOWED',
            'CODEX_BINARY_UNAVAILABLE',
            'CODEX_CLOSED',
            'THREAD_NOT_FOUND',
          ])
          const isCurrentCodexSession = () => current()
            && get().connection.phase === 'connected'
            && get().selectedSession?.sessionId === session.sessionId
          const applyCodexSnapshot = (
            read: Awaited<ReturnType<typeof readCodexSession>>,
            history: Awaited<ReturnType<typeof readCodexHistoryPage>>,
            savedPermissions: Awaited<ReturnType<typeof loadSavedCodexPermissions>>,
            recovering = false,
          ) => {
            const timeline = createCodexTimelineState({ ...read.thread, turns: [] })
            if (timeline === undefined) throw new Error(zhCN.runtime.codexInvalidResponse)
            runtime.activeCodexTimeline = withActiveCodexTurn(timeline, history.activeTurnId)
            const items = foldHistory(history.events, session.sessionId, true)
            set(state => {
              const latestSession = state.sessions.find(item => item.sessionId === session.sessionId) ?? session
              const baseSession = recovering ? latestSession : withBestCodexPermission(latestSession, undefined, savedPermissions)
              const nextSession = {
                ...baseSession,
                ...read.session,
                ...(history.activeTurnId !== undefined ? { running: true } : recovering ? { running: false } : {}),
              }
              const prevList = state.messages[session.sessionId]
              const codexMerged = mergeHistoryAndLive(items, browseLive(items, prevList ?? []))
              const codexSettled = history.activeTurnId !== undefined
                ? settleTurnItems(codexMerged, undefined, history.activeTurnId)
                : nextSession.running === false
                  ? settleTurnItems(codexMerged)
                  : codexMerged
              const nextList = reuseUnchangedChatItems(prevList, codexSettled)
              if (nextList !== prevList && canPersistSnapshot()) saveSessionMessagesSnapshot(memoryScope, session.sessionId, nextList)
              syncHandoffOrigin(nextList)
              return {
                selectedSession: state.selectedSession?.sessionId === session.sessionId ? nextSession : state.selectedSession,
                sessions: state.sessions.map(item => item.sessionId === session.sessionId ? nextSession : item),
                messages: nextList === prevList
                  ? state.messages
                  : {
                    ...state.messages,
                    [session.sessionId]: nextList,
                  },
                ...pageState(history.hasMore, oldestSeq(history.events)),
              }
            })
          }
          const applyCodexRefreshedHistory = (history: Awaited<ReturnType<typeof readCodexHistoryPage>>) => {
            const items = foldHistory(history.events, session.sessionId, true)
            const activeTurnId = history.activeTurnId !== undefined
              && !runtime.isCodexTurnCompleted(threadId, history.activeTurnId)
              ? history.activeTurnId
              : undefined
            if (runtime.activeCodexTimeline?.session.nativeId === threadId && activeTurnId !== undefined
              && runtime.activeCodexTimeline.activeTurnId === undefined) {
              runtime.activeCodexTimeline = withActiveCodexTurn(runtime.activeCodexTimeline, activeTurnId)
            }
            set(state => {
              const prevList = state.messages[session.sessionId]
              const effectiveActiveTurnId = activeTurnId ?? runtime.activeCodexTimeline?.activeTurnId
              const activeTurnKnown = effectiveActiveTurnId !== undefined
              const codexMerged = mergeHistoryAndLive(items, browseLive(items, prevList ?? []))
              const codexSettled = effectiveActiveTurnId !== undefined
                ? settleTurnItems(codexMerged, undefined, effectiveActiveTurnId)
                : settleTurnItems(codexMerged)
              const nextList = reuseUnchangedChatItems(prevList, codexSettled)
              if (nextList !== prevList && canPersistSnapshot()) saveSessionMessagesSnapshot(memoryScope, session.sessionId, nextList)
              syncHandoffOrigin(nextList)
              const syncRunning = (item: RemoteSession): RemoteSession => item.sessionId === session.sessionId
                ? { ...item, running: activeTurnKnown }
                : item
              return {
                selectedSession: state.selectedSession === undefined ? undefined : syncRunning(state.selectedSession),
                sessions: state.sessions.map(syncRunning),
                messages: nextList === prevList
                  ? state.messages
                  : {
                    ...state.messages,
                    [session.sessionId]: nextList,
                  },
                ...pageState(history.hasMore, oldestSeq(history.events)),
              }
            })
          }
          const openCodexSubscription = async (recovering: boolean) => {
            let subscribedStream: import('@dsh-remote/client-core').CodexStream | undefined
            let streamClosed = false
            let ready = false
            const stream = await client.subscribe(
              threadId,
              frame => { if (current()) runtime.enqueueCodexFrame(loadGeneration, frame) },
              // History reads can abort locally. An open must retain its ACK so
              // a superseded load can close the subscription created on the Host.
              undefined,
              reason => {
                streamClosed = true
                if (!current()) return
                if (subscribedStream !== undefined && runtime.activeCodexStream !== subscribedStream) return
                if (subscribedStream === undefined && runtime.activeCodexTimeline?.session.nativeId !== threadId) return
                runtime.activeCodexStream = undefined
                runtime.activeCodexTimeline = undefined
                set(state => ({
                  codexReadySessionId: undefined,
                  sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
                  selectedSession: state.selectedSession?.sessionId === session.sessionId
                    ? { ...state.selectedSession, running: false }
                    : state.selectedSession,
                  ...(reason === 'failed' ? { error: zhCN.runtime.codexUnavailable } : {}),
                }))
                if (ready && reason === 'failed' && get().connection.phase === 'connected'
                  && get().selectedSession?.sessionId === session.sessionId) {
                  scheduleCodexRecovery(0)
                }
              },
            )
            if (!current()) { await stream.close().catch(() => undefined); return }
            if (streamClosed) {
              await stream.close().catch(() => undefined)
              throw new Error(zhCN.runtime.codexUnavailable)
            }
            subscribedStream = stream
            runtime.activeCodexStream = stream
            if (stream.replayTruncated === true) {
              let refreshed: Awaited<ReturnType<typeof readCodexHistoryPage>>
              try {
                refreshed = await readCodexHistoryPage(client, threadId, undefined, 16, readAbort.signal)
              } catch (error) {
                if (runtime.activeCodexStream === stream) {
                  runtime.activeCodexStream = undefined
                  runtime.activeCodexTimeline = undefined
                }
                await stream.close().catch(() => undefined)
                throw error
              }
              if (!current()) {
                if (runtime.activeCodexStream === stream) runtime.activeCodexStream = undefined
                await stream.close().catch(() => undefined)
                return
              }
              if (streamClosed || runtime.activeCodexStream !== stream) {
                if (runtime.activeCodexStream === stream) runtime.activeCodexStream = undefined
                await stream.close().catch(() => undefined)
                throw new Error(zhCN.runtime.codexUnavailable)
              }
              applyCodexRefreshedHistory(refreshed)
            }
            ready = true
            set(state => ({
              ...(recovering ? {} : { busyAction: undefined }),
              codexReadySessionId: session.sessionId,
              ...(recovering && state.error === zhCN.runtime.codexUnavailable ? { error: undefined } : {}),
            }))
            void runtime.refreshCodexModels(session.sessionId)
          }
          const loadAndApplyCodexSnapshot = async (recovering: boolean, activeCheck: () => boolean) => {
            const savedPermissions = await loadSavedCodexPermissions(get().selectedDevice?.deviceId)
            if (!activeCheck()) return false
            const sessionWithPermission = withBestCodexPermission(session, undefined, savedPermissions)
            const permission = codexPermissionPreset(sessionWithPermission)
            const [read, history] = await Promise.all([
              readCodexSession(client, threadId, permission, readAbort.signal),
              readCodexHistoryPage(client, threadId, undefined, 16, readAbort.signal),
            ])
            if (!activeCheck()) return false
            applyCodexSnapshot(read, history, savedPermissions, recovering)
            return true
          }
          const scheduleCodexRecovery = (attempt: number) => {
            const delayMs = recoveryDelaysMs[attempt]
            if (delayMs === undefined) return
            runtime.scheduleCodexRecovery(delayMs, () => {
              void (async () => {
                const canRecover = () => isCurrentCodexSession()
                  && runtime.activeCodexStream === undefined
                  && !get().busyAction?.startsWith('session:')
                if (!canRecover()) return
                try {
                  if (!await loadAndApplyCodexSnapshot(true, canRecover)) return
                  await openCodexSubscription(true)
                } catch (error) {
                  if (!canRecover()) return
                  const code = typeof (error as { code?: unknown })?.code === 'string'
                    ? (error as { code: string }).code
                    : undefined
                  if (code !== undefined && nonRetryableRecoveryCodes.has(code)) return
                  if (attempt + 1 < recoveryDelaysMs.length) scheduleCodexRecovery(attempt + 1)
                }
              })()
            })
          }
          if (!await loadAndApplyCodexSnapshot(false, current)) return
          await openCodexSubscription(false)
          return
        }
        if (isAcpManagedBackend(session.backend)) {
          const acpBackend = session.backend
          await runtime.closeActiveCodexStream()
          await runtime.closeActiveCursorStream()
          if (!current()) return
          const existingMessages = get().messages[session.sessionId] ?? []
          const priorSelected = get().selectedSession
          const terminalRevision = runtime.acpTerminalRevisions.get(session.sessionId) ?? 0
          const preOpenRunning = session.running || (priorSelected?.sessionId === session.sessionId && priorSelected.running)
          // Retire or drop dead in-flight streaming chunks from the prior connection
          const cleanExisting = existingMessages.filter(item => !(item.kind === 'message' && (item.streaming || item.id === 'cursor-assistant-live' || item.id === 'cursor-user-live')))
          const initialAcpIds = new Set(cleanExisting.map(item => item.id))
          // History replaces the previous connection's projection. Retain existing displayed
          // messages so opening or reconnecting does not flash white, then in-place merge.
          set(state => ({
            selectedSession: {
              ...session,
              running: session.running || (state.selectedSession?.sessionId === session.sessionId && state.selectedSession.running),
            },
            sessionModels: undefined,
            historyHasMore: false,
            ...(cleanExisting.length !== existingMessages.length
              ? { messages: { ...state.messages, [session.sessionId]: cleanExisting } }
              : {}),
          }))
          const acpClient = acpClientForBackend(runtime.connection, acpBackend)
          const [details, readOnly] = await Promise.all([
            (async () => {
              if (typeof acpClient.loadSessionDetails === 'function') {
                try {
                  return await readAcpHistory(acpClient, cursorNativeId(session), acpBackend, readAbort.signal)
                } catch (err) {
                  if (acpBackend !== 'cursor') throw err
                  return { events: [] as unknown[] }
                }
              }
              const events = acpBackend === 'claude' ? await readClaudeHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'hermes' ? await readHermesHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'kimi' ? await readKimiHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'opencode' ? await readOpencodeHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'pi' ? await readPiHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'antigravity' ? await readAntigravityHistory(acpClient, cursorNativeId(session), readAbort.signal)
                : [] as unknown[]
              return { events }
            })(),
            runtime.ensureCursorStream(session, current).catch((error: unknown) => {
              if (!(error instanceof Error) || !('code' in error) || error.code !== 'CURSOR_SESSION_OWNED') throw error
              return true
            }),
          ])
          if (!current()) return
          // Every native-catalog ACP backend serves `dsh/sessionHistory`: a read
          // that reports an idle turn with no events means the session has no
          // history yet, so its first prompt has no predecessor to reconcile
          // against. Cursor is excluded: its history reader is optional on the
          // Host, which answers with an empty list even for a session that does
          // have history, so emptiness proves nothing there.
          if (acpBackend !== 'cursor' && details.running === false && details.events.length === 0) {
            runtime.emptyAcpHistory = { sessionId: session.sessionId, loadGeneration, connectionGeneration }
          } else if (runtime.emptyAcpHistory?.sessionId === session.sessionId) {
            runtime.emptyAcpHistory = undefined
          }
          const items = foldAcpHistory(details.events, session.sessionId)
          let enrichedSession: RemoteSession = {
            ...session,
            ...(details.modes?.currentModeId ? { agentPreset: details.modes.currentModeId } : {}),
            ...(details.availableCommands ? { availableCommands: details.availableCommands } : {}),
            projections: {
              ...session.projections,
              values: {
                ...session.projections?.values,
                permissions: details.permissionPreset
                  ? acpPermissionsValue(details.permissionPreset)
                  : (session.projections?.values?.permissions ?? acpPermissionsValue()),
              },
            },
          }
          set(state => {
            const prevList = state.messages[session.sessionId]
            const currentMessages = prevList ?? []
            const hasAcpHistory = details.events.length > 0 || acpBackend !== 'cursor'
            const currentLocals = new Map(currentMessages.filter(item => item.id.startsWith('local:')).map(item => [item.id, item]))
            const cached = hasAcpHistory ? cleanExisting.map(item => currentLocals.get(item.id) ?? item) : []
            const { history, confirmedIds, retainedIds } = reconcileAcpCachedPrompts(items, cached)
            const historyWithCachedTail = retainedIds.size === 0 ? history
              : [...history, ...currentMessages.filter(item => retainedIds.has(item.id))]
            const liveDeltas = currentMessages.filter(item => !retainedIds.has(item.id) && (!initialAcpIds.has(item.id)
              || (item.id.startsWith('local:') && !confirmedIds.has(item.id))
              || item.kind === 'approval' || item.kind === 'question'))
            const merged = hasAcpHistory
              ? mergeAcpHistoryAndLive(historyWithCachedTail, liveDeltas)
              : mergeHistoryAndLive(items, liveDeltas)
            const currentSession = state.selectedSession?.sessionId === session.sessionId
              ? state.selectedSession
              : state.sessions.find(item => item.sessionId === session.sessionId)
            const hasLiveTurnInFlight = merged.some(item =>
              (item.kind === 'message' && item.streaming === true)
              || ((item.kind === 'message' || item.kind === 'tool') && item.turn?.startsWith('acp-live:') && item.turnEnd === undefined),
            )
            const liveTurnSettled = liveDeltas.some(item =>
              (item.kind === 'message' || item.kind === 'tool') && item.turn?.startsWith('acp-live:') && item.turnEnd !== undefined,
            )
            const resolvedRunning = hasLiveTurnInFlight
              ? true
              : details.running === false
                ? false
                : details.running === true
                  ? (liveTurnSettled || (runtime.acpTerminalRevisions.get(session.sessionId) ?? 0) !== terminalRevision || (preOpenRunning && currentSession?.running === false) ? false : true)
                  : (currentSession?.running ?? session.running)
            const settled = resolvedRunning === false ? settleTurnItems(merged) : merged
            const paged = storeAcpPagedMessages(session.sessionId, settled)
            const nextList = reuseUnchangedChatItems(prevList, paged.tail)
            if (nextList !== prevList && canPersistSnapshot()) saveSessionMessagesSnapshot(memoryScope, session.sessionId, nextList)
            syncHandoffOrigin(settled)
            const active = state.selectedSession?.sessionId === session.sessionId
              ? { ...state.selectedSession, ...enrichedSession, running: resolvedRunning }
              : { ...enrichedSession, running: resolvedRunning }
            enrichedSession = active
            return {
              selectedSession: active,
              sessions: state.sessions.some(item => item.sessionId === session.sessionId)
                ? state.sessions.map(item => item.sessionId === session.sessionId ? active : item)
                : [active, ...state.sessions],
              messages: nextList === prevList
                ? state.messages
                : {
                  ...state.messages,
                  [session.sessionId]: nextList,
                },
              sessionModels: undefined,
              historyHasMore: paged.historyHasMore,
              oldestLoadedSeq: paged.oldestLoadedSeq,
              busyAction: undefined,
              acpReadOnlySessionId: readOnly ? session.sessionId : undefined,
              ...(details.modes?.availableModes
                ? {
                    agentPresetOptions: details.modes.availableModes.map(m => ({
                      id: m.id,
                      isDefault: m.id === 'default' || m.id === details.modes?.currentModeId,
                      ...(m.name !== undefined ? { name: m.name } : {}),
                      ...(m.description !== undefined ? { description: m.description } : {}),
                    })),
                  }
                : {}),
            }
          })
          if (readOnly) return
          if (acpBackend === 'antigravity') void runtime.refreshAntigravityModels(enrichedSession, current)
          else if (acpBackend === 'pi') void runtime.refreshPiModels(enrichedSession, current)
          else if (acpBackend === 'opencode') void runtime.refreshOpencodeModels(enrichedSession, current)
          else if (acpBackend === 'claude') void runtime.refreshClaudeModels(enrichedSession, current)
          else if (acpBackend === 'hermes') void runtime.refreshHermesModels(enrichedSession, current)
          else if (acpBackend === 'kimi') void runtime.refreshKimiModels(enrichedSession, current)
          else if (acpBackend === 'cursor') void runtime.refreshCursorModels(enrichedSession, current)
          else void runtime.refreshCustomAcpModels(enrichedSession, current)
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
          const userQuestionsSnapshot = latest.projections?.values?.userQuestions
          const prevList = state.messages[session.sessionId]
          const liveItems = browseLive(items, prevList ?? [])
          const historyRpcIds = new Set(items.flatMap(item => item.kind === 'message' && item.requestRpcId !== undefined ? [item.requestRpcId] : []))
          const queuedRpcIds = inboxSnapshot === undefined ? undefined : inboxRpcIds(inboxSnapshot)
          const reconciledLive = queuedRpcIds === undefined ? liveItems : reconcileDeliveryStates(
            liveItems,
            queuedRpcIds,
            historyRpcIds,
            runtime.connectionStartedAt,
          )
          // A prompt acknowledged on this connection can still be missing from
          // both history and the inbox (lost event after commit). Once the Host
          // proves the session is idle and neither source knows the requestId,
          // settle the optimistic row as unconfirmed instead of leaving the
          // composer stuck on "sending" forever. Late echoes still replace it.
          const runningNow = nextSession.running === true || authoritativeLifecycle?.running === true
          const settledLive = queuedRpcIds === undefined || runningNow ? reconciledLive : reconciledLive.map(item =>
            item.kind === 'message' && item.id.startsWith('local:')
            && (item.sendState === undefined || item.sendState === 'queued') && item.requestRpcId !== undefined
            && !queuedRpcIds.has(item.requestRpcId) && !historyRpcIds.has(item.requestRpcId)
              ? { ...item, sendState: 'unconfirmed' as const }
              : item,
          )
          const merged = applyFeedback(mergeHistoryAndLive(items, settledLive, history.throughSeq), ratings)
          const withQuestions = userQuestionsSnapshot === undefined
            ? merged
            : reconcileUserQuestionsProjection(merged, session.sessionId, userQuestionsSnapshot, inboxSnapshot)
          const hasRunningAskUserTool = items.some(item => item.kind === 'tool' && item.state === 'running' && (item.toolKey ?? item.toolName) === 'ask_user_question')
          const effectivelyRunning = nextSession.running || (authoritativeLifecycle === undefined && hasRunningAskUserTool)
          const activeTurn = authoritativeLifecycle?.turn
            ?? (effectivelyRunning ? [...items].reverse().find(item => item.turn !== undefined && item.turnEnd === undefined)?.turn : undefined)
          const restored = effectivelyRunning === false ? settleTurnItems(withQuestions)
            : activeTurn === undefined ? withQuestions : settleTurnItems(withQuestions, undefined, activeTurn)
          const nextList = reuseUnchangedChatItems(prevList, restored)
          if (nextList !== prevList && canPersistSnapshot()) saveSessionMessagesSnapshot(memoryScope, session.sessionId, nextList)
          syncHandoffOrigin(nextList)
          return {
            selectedSession: nextSession,
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? nextSession : item),
            ...(authoritativeLifecycle === undefined ? {} : { sessionLifecycles: { ...state.sessionLifecycles, [session.sessionId]: authoritativeLifecycle } }),
            historyLoadingOlder: false,
            feedbackBySession: ratings === undefined ? state.feedbackBySession : { ...state.feedbackBySession, [session.sessionId]: ratings },
            messages: nextList === prevList
              ? state.messages
              : { ...state.messages, [session.sessionId]: nextList },
            ...pageState(history.hasMore, oldestSeq(history.events)),
            busyAction: undefined,
          }
        })
        void runtime.refreshSessionModels(session.sessionId)
      }
      try {
        await load()
        if (!current()) return false
        offlineOnlySessionIds.delete(session.sessionId)
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
      if (get().connection.phase !== 'connected' || get().busyAction !== undefined || message.streaming) return false
      const source = get().selectedSession
      if (source?.sessionId !== message.sessionId) return false
      if (source.backend === 'codex') {
        if (typeof message.turn !== 'string' || !message.turn) return false
        return !!await get().forkSession(source.sessionId, source.backend, message.codexTurnId ?? message.turn, message.id)
      }
      if (!isHarnessBackend(source.backend)) return false
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

    quoteChatMessage(text, sessionId) {
      const targetId = sessionId ?? get().selectedSession?.sessionId
      if (!targetId || !text.trim()) return
      const scope = browseScope({ config: get().config, selectedDevice: get().selectedDevice })
      const key = browseKey(scope, targetId)
      const existing = useBrowseMemory.getState().entries[key]?.quotes ?? []
      updateBrowseEntry(scope, targetId, { quotes: [...existing, text.trim()] })
    },

    async createSession(workspaceId, targetBackend) {
      if (get().connection.phase !== 'connected') return false
      if (runtime.createSessionFlight !== undefined || get().busyAction === 'create-session') return false
      const task = (async () => {
        const generation = runtime.connectionGeneration
        const workspace = workspaceId === undefined ? undefined : get().workspaces.find(item => item.workspaceId === workspaceId)
        const outcome = await createOrReuseWorkspaceSession({ workspaceId, workspace, targetBackend, generation })
        return outcome.ok
      })()
      runtime.createSessionFlight = task
      void task.finally(() => { if (runtime.createSessionFlight === task) runtime.createSessionFlight = undefined })
      return task
    },

    async loadSessionHandoffItems(session) {
      const sid = session.sessionId
      if (!sid) return []
      const cached = [...(acpOlderHistory.get(sid) ?? []), ...(get().messages[sid] ?? [])]
      if (get().connection.phase !== 'connected') {
        if (cached.length > 0) return cached
        if (get().config?.baseUrl && get().selectedDevice?.identityKey) {
          return getCachedSessionMessages(browseScope(get()), sid) ?? []
        }
        return []
      }
      const isSelectedLiveSession = get().selectedSession?.sessionId === sid
        && (get().selectedSession?.backend ?? 'harness') === (session.backend ?? 'harness')
        && !offlineOnlySessionIds.has(sid)
      if (isSelectedLiveSession && cached.length > 0) return cached

      const finalizeReadOnlyItems = (items: ChatItem[]): ChatItem[] => {
        const running = get().sessionLifecycles[sid]?.running ?? session.running
        return running ? items : settleTurnItems(items)
      }
      const generation = runtime.connectionGeneration
      if (session.backend === 'codex') {
        const client = runtime.connection.requireCodex()
        const page = await readCodexHistoryPage(client, codexThreadId(session), undefined, 60)
        if (generation !== runtime.connectionGeneration) throw new Error(zhCN.runtime.hostClosed)
        return finalizeReadOnlyItems(foldHistory(page.events, sid, true))
      }
      if (isAcpManagedBackend(session.backend)) {
        const acpBackend = session.backend
        const acpClient = acpClientForBackend(runtime.connection, acpBackend)
        const details = typeof acpClient.loadSessionDetails === 'function'
          ? await (async () => {
              try {
                return await readAcpHistory(acpClient, cursorNativeId(session), acpBackend)
              } catch (error) {
                if (acpBackend !== 'cursor') throw error
                return { events: [] as unknown[] }
              }
            })()
          : {
              events: acpBackend === 'claude' ? await readClaudeHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'hermes' ? await readHermesHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'kimi' ? await readKimiHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'opencode' ? await readOpencodeHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'pi' ? await readPiHistory(acpClient, cursorNativeId(session))
                : acpBackend === 'antigravity' ? await readAntigravityHistory(acpClient, cursorNativeId(session))
                : [] as unknown[],
            }
        if (generation !== runtime.connectionGeneration) throw new Error(zhCN.runtime.hostClosed)
        return finalizeReadOnlyItems(foldAcpHistory(details.events, sid))
      }
      const proxy = runtime.connection.requireProxy()
      if (typeof proxy.sessionReadOnlyHistory !== 'function') {
        throw new Error(zhCN.handoff.loadHistoryFailed)
      }
      const history = await proxy.sessionReadOnlyHistory(
        sid,
        60,
        isSubagentSession(session) ? session.parentSessionId : undefined,
      )
      if (generation !== runtime.connectionGeneration) throw new Error(zhCN.runtime.hostClosed)
      return finalizeReadOnlyItems(foldHistory(history.events, sid, true))
    },

    async handoffSession(params) {
      if (get().connection.phase !== 'connected') {
        return { ok: false, error: zhCN.runtime.connectHostFirst }
      }
      if (runtime.createSessionFlight !== undefined || get().busyAction === 'create-session') {
        return { ok: false, error: zhCN.errors.AGENT_BUSY }
      }
      const run = async (): Promise<HandoffSessionResult> => {
        let activeGeneration = runtime.connectionGeneration
        const initialHostId = get().selectedDevice?.deviceId
        const initialIdentityKey = get().selectedDevice?.identityKey
        const initialScope = browseScope({ config: get().config, selectedDevice: get().selectedDevice })
        try {
          let targetWorkspace: WorkspaceView | undefined
          if (params.targetWorkspaceId !== undefined) {
            targetWorkspace = get().workspaces.find(
              item => item.workspaceId === params.targetWorkspaceId
                && (item.backend ?? 'harness') === params.targetBackend,
            )
          } else if (params.registerPath !== undefined) {
            const registerPath = params.registerPath.trim()
            if (!registerPath || registerPath.includes('\0') || !isAbsoluteHostPath(registerPath)) {
              return { ok: false, error: zhCN.handoff.noWorkspaceAvailable }
            }
            targetWorkspace = await get().workspaceCreate(registerPath, params.targetBackend)
            if (activeGeneration !== runtime.connectionGeneration || get().connection.phase !== 'connected') {
              return { ok: false, error: zhCN.runtime.hostClosed }
            }
            if (targetWorkspace === undefined) {
              return { ok: false, error: get().error ?? zhCN.handoff.noWorkspaceAvailable }
            }
          }

          if (targetWorkspace === undefined || (targetWorkspace.backend ?? 'harness') !== params.targetBackend) {
            return { ok: false, error: zhCN.handoff.noWorkspaceAvailable }
          }

          let created: RemoteSession
          let isExistingTarget = false
          if (params.targetSessionId !== undefined) {
            const trimmedTargetId = params.targetSessionId.trim()
            const existingTarget = trimmedTargetId.length > 0
              ? get().sessions.find(item => item.sessionId === trimmedTargetId)
              : undefined
            const validExistingTarget = existingTarget !== undefined
              && (existingTarget.backend ?? 'harness') === params.targetBackend
              && !isSubagentSession(existingTarget)
              && !get().archivedSessionIds.includes(existingTarget.sessionId)
              && existingTarget.sessionId !== params.packet.meta.sourceSessionId
              && isSessionInTargetWorkspace({
                session: existingTarget,
                targetBackend: params.targetBackend,
                workspace: targetWorkspace,
                registerPath: params.registerPath,
                hostPlatform: get().selectedDevice?.platform,
              })
            if (!validExistingTarget || existingTarget === undefined) {
              return { ok: false, error: zhCN.errors.SESSION_NOT_FOUND }
            }
            const opened = await get().openSession(existingTarget)
            const stateAfterOpen = get()
            const sameConnectedHost = stateAfterOpen.connection.phase === 'connected'
              && stateAfterOpen.selectedDevice?.deviceId === initialHostId
              && stateAfterOpen.selectedDevice?.identityKey === initialIdentityKey
              && stateAfterOpen.selectedSession?.sessionId === existingTarget.sessionId
              && (stateAfterOpen.selectedSession?.backend ?? 'harness') === (existingTarget.backend ?? 'harness')
            if (!opened || !sameConnectedHost) {
              if (activeGeneration !== runtime.connectionGeneration || stateAfterOpen.connection.phase !== 'connected') {
                return { ok: false, error: zhCN.runtime.hostClosed }
              }
              return { ok: false, error: stateAfterOpen.error ?? zhCN.runtime.hostClosed }
            }
            activeGeneration = runtime.connectionGeneration
            created = stateAfterOpen.sessions.find(item => item.sessionId === existingTarget.sessionId) ?? existingTarget
            isExistingTarget = true
          } else {
            const createdResult = await createOrReuseWorkspaceSession({
              workspaceId: targetWorkspace.workspaceId,
              workspace: targetWorkspace,
              targetBackend: params.targetBackend,
              generation: activeGeneration,
              excludeSavedDraft: true,
              excludeSessionId: params.packet.meta.sourceSessionId,
            })
            if (!createdResult.ok) {
              return { ok: false, error: createdResult.error ?? get().error }
            }
            activeGeneration = createdResult.generation
            if (activeGeneration !== runtime.connectionGeneration || get().connection.phase !== 'connected') {
              return { ok: false, error: zhCN.runtime.hostClosed }
            }
            created = createdResult.session
          }

          const handoffDraft: PendingHandoffDraft = {
            meta: params.packet.meta,
            contextBlock: params.packet.contextBlock,
          }
          const fallbackTitle = firstLineSnippet(params.instruction, 80)
          const persistConfirmedOrigin = () => {
            recordHandoffOrigin(initialScope, created.sessionId, {
              sourceBackend: params.packet.meta.sourceBackend,
              targetBackend: params.packet.meta.targetBackend,
              sourceSessionId: params.packet.meta.sourceSessionId,
              ...(params.packet.meta.sourceTitle !== undefined ? { sourceTitle: params.packet.meta.sourceTitle } : {}),
              ...(fallbackTitle !== undefined ? { fallbackTitle } : {}),
              preset: params.packet.meta.preset,
              createdAt: params.packet.meta.createdAt,
            })
          }
          const saveDraftFallback = () => {
            const existingEntry = isExistingTarget
              ? useBrowseMemory.getState().entries[browseKey(initialScope, created.sessionId)]
              : undefined
            const nextDraft = params.instruction.trim().length > 0
              ? params.instruction
              : (existingEntry?.draft ?? params.instruction)
            updateBrowseEntry(initialScope, created.sessionId, {
              draft: nextDraft,
              handoff: handoffDraft,
            })
          }

          if (params.mode === 'draft') {
            saveDraftFallback()
            return {
              ok: true,
              session: created,
              workspace: targetWorkspace,
              delivered: 'draft',
            }
          }

          const targetRunning = isExistingTarget
            && (get().sessionLifecycles[created.sessionId]?.running ?? created.running)
          if (targetRunning) {
            saveDraftFallback()
            return {
              ok: true,
              session: created,
              workspace: targetWorkspace,
              delivered: 'draft-fallback',
            }
          }

          const codexReady = params.targetBackend !== 'codex' || (
            get().codexReadySessionId === created.sessionId
            && runtime.activeCodexStream !== undefined
            && runtime.activeCodexTimeline?.session.nativeId === codexThreadId(created)
          )
          if (!codexReady) {
            saveDraftFallback()
            return {
              ok: true,
              session: created,
              workspace: targetWorkspace,
              delivered: 'draft-fallback',
            }
          }

          const payload = formatHandoffPayload(params.packet, params.instruction)
          const sendResult = await get().sendMessage(payload)
          if (activeGeneration !== runtime.connectionGeneration || get().connection.phase !== 'connected') {
            return { ok: false, error: zhCN.runtime.hostClosed }
          }
          if (sendResult === 'rejected') {
            saveDraftFallback()
            return {
              ok: true,
              session: created,
              workspace: targetWorkspace,
              delivered: 'draft-fallback',
            }
          }
          if (sendResult === 'kept') {
            persistConfirmedOrigin()
            // Never auto-retry or overwrite draft on 'kept'; timeline retains the row.
            return {
              ok: true,
              session: created,
              workspace: targetWorkspace,
              delivered: 'kept',
            }
          }
          persistConfirmedOrigin()
          return {
            ok: true,
            session: created,
            workspace: targetWorkspace,
            delivered: 'sent',
          }
        } catch (error) {
          return { ok: false, error: friendlyError(error) }
        }
      }
      let gate: Promise<boolean> | undefined
      const flight = (async (): Promise<HandoffSessionResult> => {
        try {
          return await run()
        } finally {
          if (gate !== undefined && runtime.createSessionFlight === gate) {
            runtime.createSessionFlight = undefined
          }
        }
      })()
      gate = flight.then(result => result.ok, () => false)
      runtime.createSessionFlight = gate
      return flight
    },

    async forkSession(sessionId, backend, lastTurnId, messageId) {
      if (get().connection.phase !== 'connected') return undefined
      const targetSession = get().sessions.find(item => item.sessionId === sessionId)
      const effectiveBackend = backend ?? targetSession?.backend
      if (lastTurnId !== undefined && (effectiveBackend !== 'codex' || !lastTurnId)) return undefined
      if (targetSession !== undefined && (effectiveBackend === 'codex' || isAcpManagedBackend(effectiveBackend))) {
        const generation = runtime.connectionGeneration
        set({ busyAction: `fork:${sessionId}`, error: undefined })
        try {
          let forked: RemoteSession
          if (effectiveBackend === 'codex') {
            const client = runtime.connection.requireCodex()
            const threadId = codexThreadId(targetSession)
            // Older Hosts project history with ordinal turn numbers. Resolve the
            // clicked item against the native thread before sending a mutation.
            if (messageId && lastTurnId && /^\d+$/.test(lastTurnId)) {
              const response = record(await client.request('thread/read', { threadId, includeTurns: true }))
              if (generation !== runtime.connectionGeneration) return undefined
              const thread = record(response.thread)
              const turn = thread.id === threadId && Array.isArray(thread.turns)
                ? thread.turns.map(record).find(candidate => Array.isArray(candidate.items)
                  && candidate.items.some(item => record(item).id === messageId))
                : undefined
              if (typeof turn?.id !== 'string' || !turn.id) throw new Error(zhCN.runtime.codexInvalidResponse)
              lastTurnId = turn.id
            }
            const result = record(await client.request('thread/fork', {
              threadId,
              ...(lastTurnId === undefined ? {} : { lastTurnId }),
            }))
            if (generation !== runtime.connectionGeneration) return undefined
            const display = projectCodexThread(result.thread)
            if (display === undefined || display.id === sessionId) throw new Error(zhCN.runtime.codexInvalidResponse)
            forked = codexSession(display, codexPermissionPresetFromResponse(result))
          } else {
            const client = acpClientForBackend(runtime.connection, effectiveBackend)
            const result = await client.forkSession(cursorNativeId(targetSession), effectiveBackend)
            if (generation !== runtime.connectionGeneration) return undefined
            forked = createAcpSessionForBackend(effectiveBackend, result.sessionId, targetSession.cwd)
          }
          set(state => ({
            sessions: [forked, ...state.sessions.filter(item => item.sessionId !== forked.sessionId)],
            workspaces: state.workspaces.map(w => w.sessionIds.includes(sessionId)
              ? { ...w, sessionIds: [forked.sessionId, ...w.sessionIds.filter(id => id !== forked.sessionId)] }
              : w),
            busyAction: undefined,
          }))
          await get().openSession(forked)
          return forked
        } catch (error) {
          if (generation !== runtime.connectionGeneration) return undefined
          set({ busyAction: undefined, error: friendlyError(error) })
          return undefined
        }
      }
      if (!isHarnessTarget(sessionId, backend)) return undefined
      const generation = runtime.connectionGeneration
      set({ busyAction: `fork:${sessionId}`, error: undefined })
      try {
        const proxy = runtime.connection.requireProxy()
        const { sessionId: childId } = await proxy.sessionFork(sessionId)
        if (generation !== runtime.connectionGeneration) return undefined
        const metadataVersion = catalogMutationVersion(runtime.connection, 'harness')
        const [sessions, workspaceList] = await Promise.all([proxy.sessionList(), proxy.workspaceList()])
        if (generation !== runtime.connectionGeneration) return undefined
        const created = sessions.find(s => s.sessionId === childId)
        set(state => {
          const metadataCurrent = metadataVersion === catalogMutationVersion(runtime.connection, 'harness')
          const archivedSet = new Set(workspaceList.archivedSessionIds ?? [])
          const currentPinned = state.pinnedSessionIds ?? []
          return {
            sessions: [
              ...(state.sessions ?? []).filter(item => !isHarnessBackend(item.backend)),
              ...sessions,
            ],
            workspaces: [
              ...(state.workspaces ?? []).filter(item => !isHarnessBackend(item.backend)),
              ...workspaceList.items,
            ],
            ...(metadataCurrent ? {
              archivedSessionIds: workspaceList.archivedSessionIds,
              pinnedSessionIds: workspaceList.pinnedSessionIds !== undefined
                ? mergeBackendPinnedSessionIds(
                    currentPinned,
                    'harness',
                    workspaceList.pinnedSessionIds.filter(id => !archivedSet.has(id)),
                  )
                : currentPinned.filter(id => !archivedSet.has(id)),
            } : {}),
            busyAction: undefined,
          }
        })
        persistCatalogState()
        if (created) {
          await get().openSession(created)
        }
        return created
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return undefined
        set({ busyAction: undefined, error: friendlyError(error) })
        return undefined
      }
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
          invalidateCatalogMetadata(runtime.connection, 'codex')
          set(state => ({
            sessions: state.sessions.filter(item => item.sessionId !== sessionId),
            workspaces: state.workspaces.map(workspace => ({
              ...workspace,
              sessionIds: workspace.sessionIds.filter(id => id !== sessionId),
            })),
            pinnedSessionIds: (state.pinnedSessionIds ?? []).filter(id => id !== sessionId),
            busyAction: undefined,
            ...(state.selectedSession?.sessionId === sessionId ? {
              selectedSession: undefined,
              sessionModels: undefined,
              permissionSelecting: false,
              modelSelecting: false,
              agentPresetOptions: undefined,
              agentPresetLoading: false,
              agentPresetSelecting: false,
            } : {}),
          }))
          persistCatalogState()
          return true
        }
        if (isAcpManagedBackend(session?.backend)) {
          if (session.backend !== 'opencode') throw new Error(`Native session archiving is unavailable for ${session.backend}.`)
          await runtime.connection.requireOpencode().archiveSession(cursorNativeId(session), 'opencode')
          if (generation !== runtime.connectionGeneration) return false
          if (get().selectedSession?.sessionId === sessionId) await runtime.closeActiveCursorStream()
          if (generation !== runtime.connectionGeneration) return false
          invalidateCatalogMetadata(runtime.connection, session.backend)
          set(state => ({
            sessions: state.sessions.filter(item => item.sessionId !== sessionId),
            workspaces: state.workspaces.map(workspace => ({
              ...workspace,
              sessionIds: workspace.sessionIds.filter(id => id !== sessionId),
            })),
            pinnedSessionIds: (state.pinnedSessionIds ?? []).filter(id => id !== sessionId),
            busyAction: undefined,
            ...(state.selectedSession?.sessionId === sessionId ? {
              selectedSession: undefined,
              sessionModels: undefined,
              permissionSelecting: false,
              modelSelecting: false,
              agentPresetOptions: undefined,
              agentPresetLoading: false,
              agentPresetSelecting: false,
            } : {}),
          }))
          persistCatalogState()
          return true
        }
        const proxy = runtime.connection.requireProxy()
        const archivedSessionIds = await proxy.workspaceArchiveSession(sessionId)
        if (generation !== runtime.connectionGeneration) return false
        invalidateCatalogMetadata(runtime.connection, 'harness')
        // The mutation returns the complete Host-confirmed archive set. Preserve
        // catalog membership, and do not let a second read hide a successful write.
        set(state => ({
          archivedSessionIds,
          pinnedSessionIds: (state.pinnedSessionIds ?? []).filter(id => id !== sessionId),
          busyAction: undefined,
          ...(state.selectedSession?.sessionId === sessionId ? {
            selectedSession: undefined,
            sessionModels: undefined,
            permissionSelecting: false,
            modelSelecting: false,
            agentPresetOptions: undefined,
            agentPresetLoading: false,
            agentPresetSelecting: false,
          } : {}),
        }))
        persistCatalogState()
        return true
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async unarchiveSession(sessionId, backend) {
      if (get().connection.phase !== 'connected') return false
      if (!isHarnessTarget(sessionId, backend)) return false
      const generation = runtime.connectionGeneration
      set({ busyAction: `unarchive:${sessionId}`, error: undefined })
      try {
        const proxy = runtime.connection.requireProxy()
        const archivedSessionIds = await proxy.workspaceUnarchiveSession(sessionId)
        if (generation !== runtime.connectionGeneration) return false
        invalidateCatalogMetadata(runtime.connection, 'harness')
        set({ archivedSessionIds, busyAction: undefined })
        persistCatalogState()
        return true
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async pinSession(sessionId, backend) {
      if (get().connection.phase !== 'connected') return false
      const targetSession = get().sessions.find(item => item.sessionId === sessionId)
      const effectiveBackend = backend ?? targetSession?.backend
      if (isAcpManagedBackend(effectiveBackend) && targetSession !== undefined) {
        const generation = runtime.connectionGeneration
        set({ busyAction: `pin:${sessionId}`, error: undefined })
        try {
          const updated = await acpClientForBackend(runtime.connection, effectiveBackend).pinSession(cursorNativeId(targetSession), effectiveBackend)
          if (generation !== runtime.connectionGeneration) return false
          invalidateCatalogMetadata(runtime.connection, effectiveBackend)
          set(state => ({
            pinnedSessionIds: mergeBackendPinnedSessionIds(state.pinnedSessionIds, effectiveBackend, updated),
            busyAction: undefined,
          }))
          persistCatalogState()
          return true
        } catch (error) {
          if (generation !== runtime.connectionGeneration) return false
          set({ busyAction: undefined, error: friendlyError(error) })
          return false
        }
      }
      if (!isHarnessTarget(sessionId, backend)) return false
      const generation = runtime.connectionGeneration
      set({ busyAction: `pin:${sessionId}`, error: undefined })
      try {
        const proxy = runtime.connection.requireProxy()
        const pinnedSessionIds = await proxy.workspacePinSession(sessionId)
        if (generation !== runtime.connectionGeneration) return false
        invalidateCatalogMetadata(runtime.connection, 'harness')
        set(state => ({
          pinnedSessionIds: mergeBackendPinnedSessionIds(state.pinnedSessionIds, 'harness', pinnedSessionIds),
          busyAction: undefined,
        }))
        persistCatalogState()
        return true
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async unpinSession(sessionId, backend) {
      if (get().connection.phase !== 'connected') return false
      const targetSession = get().sessions.find(item => item.sessionId === sessionId)
      const effectiveBackend = backend ?? targetSession?.backend
      if (isAcpManagedBackend(effectiveBackend) && targetSession !== undefined) {
        const generation = runtime.connectionGeneration
        set({ busyAction: `unpin:${sessionId}`, error: undefined })
        try {
          const updated = await acpClientForBackend(runtime.connection, effectiveBackend).unpinSession(cursorNativeId(targetSession), effectiveBackend)
          if (generation !== runtime.connectionGeneration) return false
          invalidateCatalogMetadata(runtime.connection, effectiveBackend)
          set(state => ({
            pinnedSessionIds: mergeBackendPinnedSessionIds(state.pinnedSessionIds, effectiveBackend, updated)
              .filter(id => id !== sessionId),
            busyAction: undefined,
          }))
          persistCatalogState()
          return true
        } catch (error) {
          if (generation !== runtime.connectionGeneration) return false
          set({ busyAction: undefined, error: friendlyError(error) })
          return false
        }
      }
      if (!isHarnessTarget(sessionId, backend)) return false
      const generation = runtime.connectionGeneration
      set({ busyAction: `unpin:${sessionId}`, error: undefined })
      try {
        const proxy = runtime.connection.requireProxy()
        const pinnedSessionIds = await proxy.workspaceUnpinSession(sessionId)
        if (generation !== runtime.connectionGeneration) return false
        invalidateCatalogMetadata(runtime.connection, 'harness')
        set(state => ({
          pinnedSessionIds: mergeBackendPinnedSessionIds(state.pinnedSessionIds, 'harness', pinnedSessionIds)
            .filter(id => id !== sessionId),
          busyAction: undefined,
        }))
        persistCatalogState()
        return true
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async renameSession(sessionId, title, backend) {
      if (get().connection.phase !== 'connected') return false
      if (!isHarnessTarget(sessionId, backend)) return false
      const generation = runtime.connectionGeneration
      const trimmed = title.trim()
      if (!trimmed) return false
      set({ busyAction: `rename:${sessionId}`, error: undefined })
      try {
        const proxy = runtime.connection.requireProxy()
        const result = await proxy.sessionRename(sessionId, trimmed)
        if (generation !== runtime.connectionGeneration) return false
        const updatedTitle = result?.title ?? trimmed
        set(state => ({
          busyAction: undefined,
          sessions: state.sessions.map(s => (s.sessionId === sessionId ? { ...s, title: updatedTitle } : s)),
          selectedSession: state.selectedSession?.sessionId === sessionId
            ? { ...state.selectedSession, title: updatedTitle }
            : state.selectedSession,
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
      const loadGeneration = runtime.sessionLoadGeneration
      const session = get().selectedSession
      if (session === undefined || get().connection.phase !== 'connected') return false
      if (get().acpReadOnlySessionId === session.sessionId) return false
      const token = ++modelSelectToken
      const isCurrent = () => token === modelSelectToken
        && generation === runtime.connectionGeneration
        && loadGeneration === runtime.sessionLoadGeneration
        && get().connection.phase === 'connected'
        && get().selectedSession?.sessionId === session.sessionId
      const releaseIfLatest = () => {
        if (token === modelSelectToken && get().modelSelecting) set({ modelSelecting: false })
      }
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
        if (isAcpManagedBackend(session.backend)) {
          const models = await selectAcpModel(acpClientForBackend(runtime.connection, session.backend), cursorNativeId(session), session.backend, selection)
          if (!isCurrent()) { releaseIfLatest(); return false }
          set({ sessionModels: models, modelSelecting: false })
          return true
        }
        const selected = await runtime.connection.requireProxy().sessionSelectModel(session.sessionId, selection)
        if (!isCurrent()) { releaseIfLatest(); return false }
        set(state => ({
          sessionModels: state.sessionModels === undefined ? undefined : { ...state.sessionModels, current: selected },
          modelSelecting: false,
        }))
        return true
      } catch (error) {
        if (!isCurrent()) { releaseIfLatest(); return false }
        set({ modelSelecting: false, error: friendlyError(error) })
        return false
      }
    },

    async selectPermission(preset) {
      const session = get().selectedSession
      if (session === undefined || get().connection.phase !== 'connected' || get().permissionSelecting) return false
      if (get().acpReadOnlySessionId === session.sessionId) return false
      const generation = runtime.connectionGeneration
      const loadGeneration = runtime.sessionLoadGeneration
      const token = ++permissionSelectToken
      const isCurrent = () => token === permissionSelectToken
        && generation === runtime.connectionGeneration
        && loadGeneration === runtime.sessionLoadGeneration
        && get().connection.phase === 'connected'
        && get().selectedSession?.sessionId === session.sessionId
      const releaseIfLatest = () => {
        if (token === permissionSelectToken && get().permissionSelecting) set({ permissionSelecting: false })
      }
      set({ permissionSelecting: true, error: undefined })
      try {
        if (isAcpManagedBackend(session.backend)) {
          const client = acpClientForBackend(runtime.connection, session.backend)
          const confirmed = await client.selectPermission(cursorNativeId(session), session.backend, preset)
          if (!isCurrent()) { releaseIfLatest(); return false }
          const confirmedRecord = typeof confirmed === 'object' && confirmed !== null ? confirmed as Record<string, unknown> : undefined
          const effective = typeof confirmedRecord?.preset === 'string' ? confirmedRecord.preset : preset
          const permissions = acpPermissionsValue(effective)
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
        }
        if (session.backend === 'codex') {
          if (!isCodexPermissionPreset(preset)) {
            throw new Error(zhCN.runtime.codexInvalidResponse)
          }
          const hostDeviceId = get().selectedDevice?.deviceId
          if (hostDeviceId === undefined) throw new Error(zhCN.runtime.connectHostFirst)
          const threadId = codexThreadId(session)
          const result = await runtime.connection.requireCodex().request('thread/resume', { threadId, permissionPreset: preset })
          if (!isCurrent()) { releaseIfLatest(); return false }
          const effectivePreset = codexPermissionPresetFromResponse(result) ?? preset
          await saveCodexPermissionPreset(hostDeviceId, threadId, effectivePreset)
          if (!isCurrent()) { releaseIfLatest(); return false }
          set(state => ({
            ...withCodexPermissionState(state, session.sessionId, effectivePreset),
            permissionSelecting: false,
          }))
          return true
        }
        const proxy = runtime.connection.requireProxy()
        await proxy.sessionSelectPermission(session.sessionId, preset)
        if (!isCurrent()) { releaseIfLatest(); return false }
        // Read back the official projection; never fabricate an accepted grant.
        const confirmed = (await proxy.sessionList()).find(item => item.sessionId === session.sessionId)
        if (!isCurrent()) { releaseIfLatest(); return false }
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
        if (!isCurrent()) { releaseIfLatest(); return false }
        set({ permissionSelecting: false, error: friendlyError(error) })
        return false
      }
    },

    async loadAgentPresets() {
      const session = get().selectedSession
      const backend = session?.backend
      if (get().connection.phase !== 'connected' || session === undefined || backend === 'codex') return false
      if (get().acpReadOnlySessionId === session.sessionId) return false
      if (get().agentPresetLoading) return false
      const sessionId = session.sessionId
      const generation = runtime.connectionGeneration
      const loadGeneration = runtime.sessionLoadGeneration
      const token = ++agentPresetLoadToken
      const isCurrent = () => token === agentPresetLoadToken
        && generation === runtime.connectionGeneration
        && loadGeneration === runtime.sessionLoadGeneration
        && get().connection.phase === 'connected'
        && get().selectedSession?.sessionId === sessionId
      const releaseIfLatest = () => {
        if (token === agentPresetLoadToken && get().agentPresetLoading) set({ agentPresetLoading: false })
      }
      set({ agentPresetLoading: true })
      try {
        if (isAcpManagedBackend(backend)) {
          const modes = await acpClientForBackend(runtime.connection, backend).sessionModes(cursorNativeId(session), backend)
          if (!isCurrent()) {
            releaseIfLatest()
            return false
          }
          const presets = modes.availableModes.map(mode => ({
            id: mode.id,
            isDefault: mode.id === 'default' || mode.id === modes.currentModeId,
            ...(mode.name !== undefined ? { name: mode.name } : {}),
            ...(mode.description !== undefined ? { description: mode.description } : {}),
          }))
          set({ agentPresetOptions: presets, agentPresetLoading: false })
          return true
        }
        const roster = await runtime.connection.requireProxy().agentPresetList()
        if (!isCurrent()) {
          releaseIfLatest()
          return false
        }
        set({ agentPresetOptions: [...roster.presets], agentPresetLoading: false })
        return true
      } catch (error) {
        if (!isCurrent()) {
          releaseIfLatest()
          return false
        }
        if (isAcpManagedBackend(backend)) {
          // Optional ACP mode discovery: unsupported backends/old Hosts degrade cleanly without an error banner.
          set({ agentPresetOptions: undefined, agentPresetLoading: false })
          return false
        }
        set({ agentPresetOptions: undefined, agentPresetLoading: false, error: friendlyError(error) })
        return false
      }
    },

    async selectAgentPreset(preset) {
      const session = get().selectedSession
      if (session === undefined || get().connection.phase !== 'connected') return false
      if (get().acpReadOnlySessionId === session.sessionId) return false
      if (session.backend === 'codex') return false
      const generation = runtime.connectionGeneration
      const loadGeneration = runtime.sessionLoadGeneration
      const token = ++agentPresetSelectToken
      const isCurrent = () => token === agentPresetSelectToken
        && generation === runtime.connectionGeneration
        && loadGeneration === runtime.sessionLoadGeneration
        && get().connection.phase === 'connected'
        && get().selectedSession?.sessionId === session.sessionId
      const releaseIfLatest = () => {
        if (token === agentPresetSelectToken && get().agentPresetSelecting) set({ agentPresetSelecting: false })
      }
      set({ agentPresetSelecting: true, error: undefined })
      try {
        const committed = isAcpManagedBackend(session.backend)
          ? await acpClientForBackend(runtime.connection, session.backend).setMode(cursorNativeId(session), session.backend, preset).then(res => res.currentModeId ?? preset)
          : await runtime.connection.requireProxy().agentPresetSelect(session.sessionId, preset)
        if (!isCurrent()) { releaseIfLatest(); return false }
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
        if (!isCurrent()) { releaseIfLatest(); return false }
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
      if (isAcpManagedBackend(session.backend)) {
        const buffered = acpOlderHistory.get(session.sessionId) ?? []
        if (buffered.length === 0) {
          set({ historyHasMore: false, historyLoadingOlder: false })
          return
        }
        const take = Math.max(0, buffered.length - ACP_PAGE_SIZE)
        const nextChunk = buffered.slice(take)
        const remaining = buffered.slice(0, take)
        if (remaining.length > 0) acpOlderHistory.set(session.sessionId, remaining)
        else acpOlderHistory.delete(session.sessionId)
        set(state => ({
          messages: {
            ...state.messages,
            [session.sessionId]: [...nextChunk, ...(state.messages[session.sessionId] ?? [])],
          },
          ...(state.selectedSession?.sessionId === session.sessionId ? {
            historyHasMore: remaining.length > 0,
            oldestLoadedSeq: remaining.length > 0 ? remaining.length : undefined,
            historyLoadingOlder: false,
          } : {}),
        }))
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
