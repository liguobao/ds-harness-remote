import { isAcpManagedBackend } from '../lib/workspace-key'
import { strings } from '../locales/i18n'
import { AppState, Platform } from 'react-native'
import { useAttentionStore } from '../state/attention-store'
import { useBotTeamStore } from '../state/bot-store'
import { useAppStore } from '../state/store'
import type { AgentBackend } from '../types'
import { browseKey, browseScope, useBrowseMemory, updateBrowseEntry, saveBrowseCatalog, browsePreference, flushBrowseMemory } from './browse-memory'
import { createLiveSurfaceController } from './live-surface'

function isItemWaitingInput(session: { backend?: AgentBackend }, item: any): boolean {
  if (!item || item.outcome !== undefined) return false
  if (item.kind === 'approval') {
    return session.backend === 'codex'
      || isAcpManagedBackend(session.backend)
      || item.frameRpcId !== undefined
  }
  if (item.kind === 'question') {
    return item.questionState !== 'continued'
  }
  return false
}

/** Maps a backend identifier to the compact single-character badge shown in the live task notification. */
export function backendBadge(backend?: string): string {
  switch ((backend ?? '').trim().toLowerCase()) {
    case 'hermes': return 'H'
    case 'claude': return 'C'
    case 'codex': return 'X'
    case 'opencode': return 'O'
    case 'pi': return 'P'
    case 'cursor': return 'U'
    case 'antigravity': return 'A'
    case 'ds-bot': return 'B'
    default: return 'D'
  }
}

export interface LiveTaskSummary {
  hostId: string
  sessionId: string
  badge: string
  title: string
  statusText: string
  isWaitingInput: boolean
  updatedAtMs: number
  summary: string
  startedAtMs: number
  countText: string
}

interface LiveTaskEvaluationState {
  selectedDevice?: { deviceId: string }
  connection: { phase: string }
  sessions: any[]
  sessionLifecycles?: Record<string, any>
  messages?: Record<string, any[]>
  selectedSession?: { sessionId: string }
}

function taskPhase(state: LiveTaskEvaluationState, session: { sessionId: string; backend?: AgentBackend }) {
  const lifecycle = state.sessionLifecycles?.[session.sessionId]
  const sessionMessages = state.messages?.[session.sessionId] ?? []
  const pending = sessionMessages.find((item: any) => isItemWaitingInput(session, item))
  const current = sessionMessages.filter((item: any) => !item.turnEnd
    && (lifecycle?.turn === undefined || item.turn === lifecycle.turn))
  const tool = current.reverse().find((item: any) => item.kind === 'tool' && item.state === 'running')
  const thinking = current.some((item: any) => item.kind === 'message' && item.streaming && item.streamingPhase === 'reasoning')
  const collaborating = state.sessions.some(child => child.parentSessionId === session.sessionId
    && (state.sessionLifecycles?.[child.sessionId]?.running ?? child.running))
  const labels = strings.comfort
  let statusText = labels.liveTaskRunning
  if (pending) statusText = pending.kind === 'question' ? labels.liveTaskQuestion : labels.liveTaskWaiting
  else if (tool?.toolKey === 'codex.compaction') statusText = labels.liveTaskCompaction
  else if (collaborating || tool?.toolKey === 'codex.subagent') statusText = labels.liveTaskCollaboration
  else if (tool) statusText = labels.liveTaskTool
  else if (thinking) statusText = labels.liveTaskThinking
  return { statusText, isWaitingInput: Boolean(pending), startedAtMs: lifecycle?.running && lifecycle.startedAt > 0 ? lifecycle.startedAt : 0 }
}

export function pickActiveLiveTask(state: LiveTaskEvaluationState): LiveTaskSummary | undefined {
  const device = state.selectedDevice
  if (device === undefined || state.connection.phase !== 'connected' || !Array.isArray(state.sessions)) {
    return undefined
  }

  const lifecycles = state.sessionLifecycles ?? {}
  const messagesMap = state.messages ?? {}

  const candidates: {
    session: any
    isWaitingInput: boolean
    active: boolean
    isSelected: boolean
    updatedAt: number
  }[] = []

  for (const session of state.sessions) {
    if (!session || typeof session.sessionId !== 'string') continue
    const active = Boolean(lifecycles[session.sessionId]?.running ?? session.running)
    const sessionMessages = messagesMap[session.sessionId] ?? []
    const isWaitingInput = sessionMessages.some((item: any) => isItemWaitingInput(session, item))

    if (active || isWaitingInput) {
      candidates.push({
        session,
        isWaitingInput,
        active,
        isSelected: state.selectedSession?.sessionId === session.sessionId,
        updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
      })
    }
  }

  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => {
    // 1. Waiting for input before running
    if (a.isWaitingInput !== b.isWaitingInput) {
      return a.isWaitingInput ? -1 : 1
    }
    // 2. Currently selected session before others
    if (a.isSelected !== b.isSelected) {
      return a.isSelected ? -1 : 1
    }
    // 3. Most recently updated session first
    return b.updatedAt - a.updatedAt
  })

  const top = candidates[0]!
  const sessionMessages = messagesMap[top.session.sessionId] ?? []
  let summary = ''
  for (let index = sessionMessages.length - 1; index >= 0; index -= 1) {
    const item: any = sessionMessages[index]
    if (item?.kind === 'message' && item.role === 'assistant' && typeof item.text === 'string' && item.text.trim().length > 0) {
      summary = item.text.trim()
      break
    }
  }
  summary = summary
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/[`*_>#|]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240)

  const badge = backendBadge(top.session.backend)
  const title = (typeof top.session.title === 'string' && top.session.title.trim().length > 0)
    ? top.session.title.trim()
    : strings.comfort.liveTaskDefaultTitle
  const detail = taskPhase(state, top.session)
  const count = candidates.filter(item => item.active && !item.session.parentSessionId && item.session.origin !== 'subagent').length

  return {
    hostId: device.deviceId,
    sessionId: top.session.sessionId,
    badge,
    ...detail,
    countText: count > 1 ? strings.comfort.liveTaskCount(count) : '',
    title,
    updatedAtMs: typeof top.updatedAt === 'number' && top.updatedAt > 0 ? top.updatedAt : 0,
    summary,
  }
}

export function startBrowseTracking(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let previousCatalog: unknown, previousSessions: unknown, previousMessages: unknown, previousSelected: string | undefined
  let previousUpdated = 0
  let disposed = false
  let observing = false
  const running = new Map<string, boolean>()
  const completedSessionIds = new Set<string>()
  const liveSurface = createLiveSurfaceController()

  const observe = () => {
    if (observing) return
    observing = true
    try {
      observeInner()
    } finally {
      observing = false
    }
  }

  const observeInner = () => {
    const state = useAppStore.getState()
    const memory = useBrowseMemory.getState()
    const device = state.selectedDevice
    const connected = device !== undefined && state.connection.phase === 'connected'

    if (!connected || !memory.ready) {
      completedSessionIds.clear()
      running.clear()
      void liveSurface.sync({
        hostId: device?.deviceId,
        connected: false,
        appState: AppState.currentState,
        notificationsEnabled: memory.notifications,
        items: [],
        digest: null,
      })
      return
    }

    const scope = browseScope(state)
    if (previousCatalog !== state.workspaces || previousSessions !== state.sessions) {
      previousCatalog = state.workspaces
      previousSessions = state.sessions
      saveBrowseCatalog(scope, state.workspaces, state.sessions)
    }

    const selected = state.selectedSession
    const selectedKey = selected === undefined ? undefined : browseKey(scope, selected.sessionId)
    const messages = selected === undefined ? undefined : state.messages[selected.sessionId]
    if (
      selected !== undefined
      && !state.busyAction?.startsWith('session:')
      && (previousSelected !== selectedKey || previousMessages !== messages || previousUpdated !== selected.updatedAt)
    ) {
      previousSelected = selectedKey
      previousMessages = messages
      previousUpdated = selected.updatedAt
      const entry = memory.entries[browseKey(scope, selected.sessionId)]
      updateBrowseEntry(scope, selected.sessionId, {
        session: selected,
        visitedAt: Date.now(),
        ...(entry?.position?.atBottom !== false && AppState.currentState === 'active' ? { seenAt: selected.updatedAt } : {}),
        ...(messages && messages.length > 0 ? { messages } : {}),
      })
      browsePreference({ last: { scope, deviceId: device.deviceId, sessionId: selected.sessionId } })
    }

    // Track confirmed running -> idle transitions for legacy Hosts without attention.inbox.v1.
    const watchedSessions = new Set<string>()
    for (const session of state.sessions ?? []) {
      const id = browseKey(scope, session.sessionId)
      const entry = memory.entries[id]
      const known = session.backend !== 'codex' || state.sessionLifecycles?.[session.sessionId] !== undefined
      const active = Boolean(state.sessionLifecycles?.[session.sessionId]?.running ?? session.running)
      const watched = Boolean(entry?.starred || entry?.visitedAt !== undefined || selected?.sessionId === session.sessionId)
      if (watched) watchedSessions.add(session.sessionId)
      if (known) {
        if (running.get(id) === true && !active) {
          completedSessionIds.add(session.sessionId)
        } else if (active) {
          completedSessionIds.delete(session.sessionId)
        }
        running.set(id, active)
      }
    }

    if (disposed) return

    const attentionStore = useAttentionStore.getState()
    if (!attentionStore.supported) {
      attentionStore.syncLegacyFallback({
        sessions: state.sessions,
        sessionLifecycles: state.sessionLifecycles,
        messages: state.messages,
        workspaces: state.workspaces,
        botState: useBotTeamStore.getState().state,
        completedSessionIds,
      })
    }

    const latestAttention = useAttentionStore.getState()
    const activeMode = memory.hostModes?.[scope] === 'bot' ? 'bot' : 'agent'
    const activeSessionId = activeMode === 'bot'
      ? useBotTeamStore.getState().session?.sessionId ?? selected?.sessionId
      : selected?.sessionId

    void liveSurface.sync({
      hostId: device.deviceId,
      hostName: device.name,
      connected: true,
      appState: AppState.currentState,
      notificationsEnabled: memory.notifications,
      activeSessionId,
      activeMode,
      taskDetail: item => {
        if (item.mode !== 'agent') return undefined
        const session = state.sessions.find(row => row.sessionId === item.sessionId)
        return session ? taskPhase(state, session) : undefined
      },
      items: latestAttention.items,
      digest: latestAttention.digest,
      shouldNotifyItem: latestAttention.supported
        ? undefined
        : item => item.mode === 'bot' || watchedSessions.has(item.sessionId),
    })
  }

  const scheduleObserve = () => {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      observe()
    }, 800)
  }

  const flushPendingObserve = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    observe()
  }

  const heartbeat = Platform.OS === 'ios' ? setInterval(() => {
    if (AppState.currentState === 'active' && useAppStore.getState().connection.phase === 'connected') scheduleObserve()
  }, 60_000) : undefined
  const unsubscribeApp = useAppStore.subscribe(scheduleObserve)
  const unsubscribePreferences = useBrowseMemory.subscribe((next, prev) => {
    if (next.notifications !== prev.notifications) observe()
  })
  const unsubscribeBot = useBotTeamStore.subscribe(scheduleObserve)
  const unsubscribeAttention = useAttentionStore.subscribe((next, prev) => {
    if (next.items !== prev.items || next.digest !== prev.digest || next.supported !== prev.supported) {
      if (!disposed) observe()
    }
  })

  const background = AppState.addEventListener('change', phase => {
    if (phase === 'active') {
      scheduleObserve()
    } else {
      flushPendingObserve()
      void flushBrowseMemory()
    }
  })

  observe()

  return () => {
    if (heartbeat !== undefined) clearInterval(heartbeat)
    disposed = true
    unsubscribeApp()
    unsubscribeBot()
    unsubscribePreferences()
    unsubscribeAttention()
    background.remove()
    flushPendingObserve()
    void flushBrowseMemory()
    completedSessionIds.clear()
    running.clear()
    void liveSurface.dispose()
  }
}
