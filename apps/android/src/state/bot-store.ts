import { create } from 'zustand'
import { strings as s } from '../locales/i18n'
import { browseScope } from '../services/browse-memory'
import {
  botSessionOwnerKey,
  isScopedKnownBotSessionId,
  markScopedBotSessionId,
  object,
  resolveBotTargetSessionId,
  text,
  trackScopedBotStateSessions,
  type BotObject,
  type BotOperation,
  type BotRemoteClient,
  type BotState,
} from '../services/bot-catalog'
import type { RemoteSession } from '../types'
import { getConnectionGeneration, requireBotClient, useAppStore } from './store'

export interface BotContextMenuTarget {
  kind: 'bot' | 'room' | 'agent'
  id: string
}

export interface BotEditorTarget {
  kind: 'bot' | 'room'
  id?: string
}

export interface BotReportTarget {
  title: string
  kind: 'usage' | 'schedules'
  value: unknown
}

export function currentBotScope(): string {
  return browseScope(useAppStore.getState())
}

export function markBotSessionId(sessionId: string | undefined, scope = currentBotScope()): void {
  markScopedBotSessionId(sessionId, scope)
}

export function trackBotStateSessions(state: BotState | undefined, scope = currentBotScope()): void {
  trackScopedBotStateSessions(state, scope)
}

export function isKnownBotSessionId(
  sessionId: string | undefined,
  state?: BotState,
  scope = currentBotScope(),
): boolean {
  return isScopedKnownBotSessionId(sessionId, scope, state)
}

interface BotTeamStoreState {
  scope: string
  state?: BotState
  session?: RemoteSession
  openedSessionKey?: string
  openError?: string
  openAttempt: number
  loading: boolean
  busy: boolean
  error?: string
  actionError?: string
  selectedId?: string
  editor?: BotEditorTarget
  detailsOpen: boolean
  report?: BotReportTarget
  contextMenu?: BotContextMenuTarget
  runStats?: BotObject | null
  ensureScope: (scope: string) => void
  setSelectedId: (id?: string) => void
  setEditor: (editor?: BotEditorTarget) => void
  setDetailsOpen: (open: boolean) => void
  setReport: (report?: BotReportTarget) => void
  setContextMenu: (target?: BotContextMenuTarget) => void
  clearErrors: () => void
  refresh: (force?: boolean, signal?: AbortSignal) => Promise<void>
  syncSelectedSession: (options?: { selectedId?: string; force?: boolean; signal?: AbortSignal }) => Promise<RemoteSession | undefined>
  retryOpenSession: () => Promise<void>
  perform: (operation: BotOperation, payload?: BotObject, signal?: AbortSignal) => Promise<{ ok: boolean; value?: unknown }>
  loadRunStats: (botId: string, signal?: AbortSignal) => Promise<void>
}

let activeRevision = 0
let activeOpenRevision = 0
let activeOpenAbort: AbortController | undefined
let activeOpenKey: string | undefined
let activeOpenPromise: Promise<RemoteSession | undefined> | undefined
let actionLocked = false
let sessionSyncActive = false
let lastObservedScope = ''
let lastObservedGen = -1
let lastObservedDeviceId = ''
let lastObservedConnected = false
let connectionEpoch = 0

function resetOpenTracking(): void {
  ++activeOpenRevision
  activeOpenAbort?.abort()
  activeOpenAbort = undefined
  activeOpenKey = undefined
  activeOpenPromise = undefined
}

function observeAppConnection(): { scope: string; connected: boolean; epoch: number } {
  const appState = useAppStore.getState()
  const scope = browseScope(appState)
  const connected = appState.connection.phase === 'connected'
  const gen = getConnectionGeneration()
  const deviceId = appState.selectedDevice?.deviceId ?? ''
  if (!connected) {
    lastObservedConnected = false
    return { scope, connected: false, epoch: connectionEpoch }
  }
  if (
    !lastObservedConnected
    || scope !== lastObservedScope
    || gen !== lastObservedGen
    || deviceId !== lastObservedDeviceId
  ) {
    ++connectionEpoch
    lastObservedConnected = true
    lastObservedScope = scope
    lastObservedGen = gen
    lastObservedDeviceId = deviceId
  }
  return { scope, connected: true, epoch: connectionEpoch }
}

function getClient(): { value?: BotRemoteClient; error?: string } {
  try {
    return { value: requireBotClient() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : s.bots.unavailable }
  }
}

export const useBotTeamStore = create<BotTeamStoreState>((set, get) => ({
  scope: '',
  state: undefined,
  session: undefined,
  openedSessionKey: undefined,
  openError: undefined,
  openAttempt: 0,
  loading: false,
  busy: false,
  error: undefined,
  actionError: undefined,
  selectedId: undefined,
  editor: undefined,
  detailsOpen: false,
  report: undefined,
  contextMenu: undefined,
  runStats: undefined,

  ensureScope: (nextScope: string) => {
    if (get().scope === nextScope) return
    ++activeRevision
    resetOpenTracking()
    actionLocked = false
    sessionSyncActive = false
    set({
      scope: nextScope,
      state: undefined,
      session: undefined,
      openedSessionKey: undefined,
      openError: undefined,
      openAttempt: 0,
      loading: false,
      busy: false,
      error: undefined,
      actionError: undefined,
      selectedId: undefined,
      editor: undefined,
      detailsOpen: false,
      report: undefined,
      contextMenu: undefined,
      runStats: undefined,
    })
  },

  setSelectedId: (id?: string) => {
    if (id === undefined) {
      resetOpenTracking()
      sessionSyncActive = false
      set({
        selectedId: undefined,
        session: undefined,
        openedSessionKey: undefined,
        openError: undefined,
        actionError: undefined,
        detailsOpen: false,
        runStats: undefined,
      })
      return
    }
    set({ selectedId: id, actionError: undefined, detailsOpen: false, runStats: undefined })
    if (sessionSyncActive && get().state !== undefined) {
      void get().syncSelectedSession({ selectedId: id })
    }
  },

  setEditor: (editor?: BotEditorTarget) => set({ editor, actionError: undefined }),
  setDetailsOpen: (detailsOpen: boolean) => set({ detailsOpen }),
  setReport: (report?: BotReportTarget) => set({ report }),
  setContextMenu: (contextMenu?: BotContextMenuTarget) => set({ contextMenu }),
  clearErrors: () => set({ error: undefined, actionError: undefined, openError: undefined }),

  refresh: async (force = false, signal?: AbortSignal) => {
    const scope = currentBotScope()
    get().ensureScope(scope)
    if (actionLocked && !force) {
      set({ loading: false })
      return
    }
    const client = getClient()
    if (!client.value) {
      set({ loading: false, error: client.error })
      return
    }
    const rev = ++activeRevision
    if (get().state === undefined) set({ loading: true })
    try {
      const next = await client.value.state(signal, true)
      if (rev !== activeRevision || get().scope !== scope) return
      trackBotStateSessions(next, scope)
      const currentSelected = get().selectedId
      const validIds = new Set([
        ...next.bots.map(b => b.id),
        ...next.rooms.map(r => r.id),
        ...next.agents.flatMap(a => a.sessions),
      ])
      const resolvedSelected = currentSelected !== undefined && validIds.has(currentSelected)
        ? currentSelected
        : (next.mainBotId
          ?? next.bots.find(b => b.tile)?.id
          ?? next.bots.find(b => b.main)?.id
          ?? next.bots[0]?.id
          ?? next.rooms[0]?.id)
      set({
        state: next,
        error: undefined,
        loading: false,
        selectedId: resolvedSelected,
      })
      if (sessionSyncActive && resolvedSelected !== undefined) {
        await get().syncSelectedSession({ selectedId: resolvedSelected, signal })
      }
    } catch (reason) {
      if (rev !== activeRevision || get().scope !== scope) return
      set({
        loading: false,
        error: reason instanceof Error ? reason.message : s.bots.unavailable,
      })
    }
  },

  syncSelectedSession: async (options = {}) => {
    sessionSyncActive = true
    const { scope, connected, epoch } = observeAppConnection()
    get().ensureScope(scope)
    const state = get().state
    const selectedId = options.selectedId !== undefined ? options.selectedId : get().selectedId
    const targetSessionId = resolveBotTargetSessionId(state, selectedId)
    if (!selectedId || !targetSessionId) {
      resetOpenTracking()
      if (get().session !== undefined || get().openedSessionKey !== undefined || get().openError !== undefined) {
        set({ session: undefined, openedSessionKey: undefined, openError: undefined })
      }
      return undefined
    }
    if (!connected) {
      return get().session
    }
    const client = getClient()
    if (!client.value) {
      set({ session: undefined, openedSessionKey: undefined, openError: client.error })
      return undefined
    }
    const sessionKey = botSessionOwnerKey(scope, epoch, selectedId, targetSessionId)!
    const currentSession = get().session
    const appSelectedSession = useAppStore.getState().selectedSession
    if (
      !options.force
      && get().openedSessionKey === sessionKey
      && currentSession?.sessionId === targetSessionId
      && appSelectedSession?.sessionId === targetSessionId
    ) {
      return currentSession
    }
    if (!options.force && activeOpenKey === sessionKey && activeOpenPromise !== undefined) {
      return activeOpenPromise
    }
    activeOpenAbort?.abort()
    const control = new AbortController()
    activeOpenAbort = control
    activeOpenKey = sessionKey
    const onExternalAbort = () => control.abort()
    options.signal?.addEventListener('abort', onExternalAbort, { once: true })
    const openRev = ++activeOpenRevision
    if (get().openedSessionKey !== sessionKey) {
      set({ session: undefined, openError: undefined })
    } else {
      set({ openError: undefined })
    }
    const task = (async (): Promise<RemoteSession | undefined> => {
      try {
        const resolved = await client.value!.resolveSession(selectedId, control.signal)
        trackBotStateSessions(resolved.state, scope)
        markBotSessionId(resolved.session.sessionId, scope)
        if (control.signal.aborted || openRev !== activeOpenRevision || get().scope !== scope) {
          return undefined
        }
        const latestSelected = options.selectedId !== undefined ? options.selectedId : get().selectedId
        if (latestSelected !== selectedId) return undefined
        const resolvedKey = botSessionOwnerKey(scope, epoch, selectedId, resolved.session.sessionId)!
        const opened = await useAppStore.getState().openSession(resolved.session)
        if (control.signal.aborted || openRev !== activeOpenRevision || get().scope !== scope) {
          return undefined
        }
        if (opened) {
          set(current => ({
            ...(current.state !== undefined && resolveBotTargetSessionId(current.state, selectedId) !== resolved.session.sessionId
              ? { state: resolved.state }
              : {}),
            session: resolved.session,
            openedSessionKey: resolvedKey,
            openError: undefined,
          }))
          return resolved.session
        }
        set({
          session: undefined,
          openedSessionKey: undefined,
          openError: useAppStore.getState().error ?? s.bots.sessionUnavailable,
        })
        return undefined
      } catch (reason) {
        if (control.signal.aborted || openRev !== activeOpenRevision || get().scope !== scope) {
          return undefined
        }
        set({
          session: undefined,
          openedSessionKey: undefined,
          openError: reason instanceof Error ? reason.message : s.bots.unavailable,
        })
        return undefined
      } finally {
        options.signal?.removeEventListener('abort', onExternalAbort)
        if (activeOpenAbort === control) {
          activeOpenAbort = undefined
          activeOpenKey = undefined
          activeOpenPromise = undefined
        }
      }
    })()
    activeOpenPromise = task
    return task
  },

  retryOpenSession: async () => {
    set(state => ({
      error: undefined,
      actionError: undefined,
      openError: undefined,
      openedSessionKey: undefined,
      openAttempt: state.openAttempt + 1,
    }))
    await get().refresh(true)
    await get().syncSelectedSession({ force: true })
  },

  perform: async (operation: BotOperation, payload?: BotObject, signal?: AbortSignal) => {
    const scope = currentBotScope()
    get().ensureScope(scope)
    const client = getClient()
    if (!client.value || actionLocked) return { ok: false }
    actionLocked = true
    ++activeRevision
    set({ busy: true, actionError: undefined })
    let result: { ok: boolean; value?: unknown } = { ok: false }
    try {
      const value = await client.value.call(operation, payload ?? null, signal)
      if (get().scope !== scope) return { ok: false }
      result = { ok: true, value }
      if (operation === 'create-bot' || operation === 'duplicate-bot' || operation === 'create-room') {
        const id = text(object(value).id)
        if (id) set({ selectedId: id, detailsOpen: false })
      }
      if (operation === 'agent-session') {
        const sessionId = text(object(value).sessionId)
        if (sessionId) set({ selectedId: sessionId, detailsOpen: false })
      }
      if (operation === 'bot-new-part' || operation === 'bot-open-part') {
        set({ detailsOpen: false })
      }
      if (operation === 'delete-bot' || operation === 'delete-room') {
        const deletedId = text(payload?.id)
        if (!deletedId || get().selectedId === deletedId) {
          set({ selectedId: undefined, detailsOpen: false })
        } else {
          set({ detailsOpen: false })
        }
      }
      if (operation === 'usage' || operation === 'schedules') {
        set({
          report: {
            title: operation === 'usage' ? s.bots.usage : s.bots.schedules,
            kind: operation,
            value,
          },
        })
      }
    } catch (reason) {
      if (get().scope === scope) {
        set({ actionError: reason instanceof Error ? reason.message : s.bots.unknownOutcome })
      }
    } finally {
      actionLocked = false
      if (get().scope === scope) {
        await get().refresh(true, signal)
        if (get().scope === scope) set({ busy: false })
      }
    }
    return result
  },

  loadRunStats: async (botId: string, signal?: AbortSignal) => {
    const client = getClient()
    if (!client.value) return
    try {
      const value = await client.value.call('run-stats', { botId }, signal)
      if (!signal?.aborted) {
        set({ runStats: object(value) })
      }
    } catch {
      // Older DS-Bot hosts may not expose run-stats; ignore silently.
    }
  },
}))

useAppStore.subscribe(appState => {
  if (appState.connection.phase !== 'connected') {
    lastObservedConnected = false
    if (useBotTeamStore.getState().openedSessionKey !== undefined) {
      resetOpenTracking()
      useBotTeamStore.setState({ openedSessionKey: undefined })
    }
  }
})
