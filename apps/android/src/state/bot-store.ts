import { create } from 'zustand'
import { strings as s } from '../locales/i18n'
import { browseScope } from '../services/browse-memory'
import {
  object,
  text,
  type BotObject,
  type BotOperation,
  type BotRemoteClient,
  type BotState,
} from '../services/bot-catalog'
import { requireBotClient, useAppStore } from './store'

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

const knownBotSessionIdsByScope = new Map<string, Set<string>>()

export function currentBotScope(): string {
  return browseScope(useAppStore.getState())
}

function scopeSet(scope: string): Set<string> {
  let set = knownBotSessionIdsByScope.get(scope)
  if (!set) {
    set = new Set<string>()
    knownBotSessionIdsByScope.set(scope, set)
  }
  return set
}

export function markBotSessionId(sessionId: string | undefined, scope = currentBotScope()): void {
  if (!sessionId || !scope) return
  scopeSet(scope).add(sessionId)
}

export function trackBotStateSessions(state: BotState | undefined, scope = currentBotScope()): void {
  if (!state || !scope) return
  const target = scopeSet(scope)
  for (const bot of state.bots) {
    if (bot.sessionId) target.add(bot.sessionId)
  }
  for (const room of state.rooms) {
    const primarySessionId = room.sessionId || room.id
    if (primarySessionId) target.add(primarySessionId)
    if (room.ownParts) {
      for (const part of room.ownParts) {
        if (part) target.add(part)
      }
    }
  }
}

export function isKnownBotSessionId(
  sessionId: string | undefined,
  state?: BotState,
  scope = currentBotScope(),
): boolean {
  if (!sessionId || !scope) return false
  if (state) {
    trackBotStateSessions(state, scope)
  }
  return knownBotSessionIdsByScope.get(scope)?.has(sessionId) ?? false
}

interface BotTeamStoreState {
  scope: string
  state?: BotState
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
  perform: (operation: BotOperation, payload?: BotObject, signal?: AbortSignal) => Promise<{ ok: boolean; value?: unknown }>
  loadRunStats: (botId: string, signal?: AbortSignal) => Promise<void>
}

let activeRevision = 0
let actionLocked = false

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
    actionLocked = false
    set({
      scope: nextScope,
      state: undefined,
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
    set({ selectedId: id, actionError: undefined, detailsOpen: false, runStats: undefined })
  },

  setEditor: (editor?: BotEditorTarget) => set({ editor, actionError: undefined }),
  setDetailsOpen: (detailsOpen: boolean) => set({ detailsOpen }),
  setReport: (report?: BotReportTarget) => set({ report }),
  setContextMenu: (contextMenu?: BotContextMenuTarget) => set({ contextMenu }),
  clearErrors: () => set({ error: undefined, actionError: undefined }),

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
    } catch (reason) {
      if (rev !== activeRevision || get().scope !== scope) return
      set({
        loading: false,
        error: reason instanceof Error ? reason.message : s.bots.unavailable,
      })
    }
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
