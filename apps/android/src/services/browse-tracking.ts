import { strings } from '../locales/i18n'
import { AppState } from 'react-native'
import { useAppStore } from '../state/store'
import { browseKey, browseScope, useBrowseMemory, updateBrowseEntry, saveBrowseCatalog, browsePreference, flushBrowseMemory } from './browse-memory'
import { foregroundService } from './foreground-service'

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
}

interface LiveTaskEvaluationState {
  selectedDevice?: { deviceId: string }
  connection: { phase: string }
  sessions: any[]
  sessionLifecycles?: Record<string, any>
  messages?: Record<string, any[]>
  selectedSession?: { sessionId: string }
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
    const isWaitingInput = sessionMessages.some((item: any) =>
      (item.kind === 'approval' && item.outcome === undefined && (session.backend === 'codex' || item.frameRpcId !== undefined)) ||
      (item.kind === 'question' && item.frameRpcId !== undefined && item.outcome === undefined && item.questionState !== 'continued')
    )

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
  summary = summary.replace(/\s+/gu, ' ').slice(0, 240)

  const badge = backendBadge(top.session.backend)
  const title = (typeof top.session.title === 'string' && top.session.title.trim().length > 0)
    ? top.session.title.trim()
    : strings.comfort.liveTaskDefaultTitle
  const statusText = top.isWaitingInput
    ? strings.comfort.liveTaskWaiting
    : strings.comfort.liveTaskRunning

  return {
    hostId: device.deviceId,
    sessionId: top.session.sessionId,
    badge,
    title,
    statusText,
    isWaitingInput: top.isWaitingInput,
    updatedAtMs: typeof top.updatedAt === 'number' && top.updatedAt > 0 ? top.updatedAt : 0,
    summary,
  }
}

/** Observe display state only; this never submits, resumes or interrupts a turn. */
export function startBrowseTracking(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let previousCatalog: unknown, previousSessions: unknown, previousMessages: unknown, previousSelected: string | undefined
  let previousUpdated = 0
  let lastLiveTaskKey: string | undefined = undefined
  let liveTaskSyncTail: Promise<void> = Promise.resolve()
  const running = new Map<string, boolean>()
  const questions = new Set<string>()

  const observe = () => {
    const state = useAppStore.getState(), memory = useBrowseMemory.getState()
    const device = state.selectedDevice
    if (device === undefined || state.connection.phase !== 'connected' || !memory.ready) {
      if (lastLiveTaskKey !== undefined) {
        lastLiveTaskKey = undefined
        void foregroundService.clearLiveTask()
      }
      return
    }
    const scope = browseScope(state)
    if (previousCatalog !== state.workspaces || previousSessions !== state.sessions) {
      previousCatalog = state.workspaces; previousSessions = state.sessions
      saveBrowseCatalog(scope, state.workspaces, state.sessions)
    }
    const selected = state.selectedSession
    const selectedKey = selected === undefined ? undefined : browseKey(scope, selected.sessionId)
    const messages = selected === undefined ? undefined : state.messages[selected.sessionId]
    if (selected !== undefined && !state.busyAction?.startsWith('session:') && (previousSelected !== selectedKey || previousMessages !== messages || previousUpdated !== selected.updatedAt)) {
      previousSelected = selectedKey; previousMessages = messages; previousUpdated = selected.updatedAt
      const entry = memory.entries[browseKey(scope, selected.sessionId)]
      updateBrowseEntry(scope, selected.sessionId, {session: selected,
        visitedAt: Date.now(), ...(entry?.position?.atBottom !== false && AppState.currentState === 'active' ? {seenAt: selected.updatedAt} : {})})
      browsePreference({last: {scope, deviceId: device.deviceId, sessionId: selected.sessionId}})
    }
    for (const session of state.sessions) {
      const id = browseKey(scope, session.sessionId), entry = memory.entries[id]
      const known = session.backend !== 'codex' || state.sessionLifecycles[session.sessionId] !== undefined
      const active = state.sessionLifecycles[session.sessionId]?.running ?? session.running
      const watched = entry?.starred || entry?.visitedAt !== undefined || selected?.sessionId === session.sessionId
      const notify = memory.notifications && watched && (AppState.currentState !== 'active' || selected?.sessionId !== session.sessionId)
      if (known) {
        if (running.get(id) === true && !active && notify) foregroundService.notifyTask(device.deviceId, session.sessionId, session.title ?? 'Remote 对话', strings.comfort.taskEnded)
        running.set(id, active)
      }
      for (const item of state.messages[session.sessionId] ?? []) {
        const needsInput = (item.kind === 'approval' && item.outcome === undefined && (session.backend === 'codex' || item.frameRpcId !== undefined)) || (item.kind === 'question' && item.frameRpcId !== undefined && item.outcome === undefined && item.questionState !== 'continued')
        const questionKey = id + ':' + item.id
        if (needsInput && !questions.has(questionKey)) {
          questions.add(questionKey)
          if (notify) foregroundService.notifyTask(device.deviceId, session.sessionId, session.title ?? 'Remote 对话', strings.comfort.taskInput)
        }
      }
    }

    // Sync active live task lock screen notification
    const liveTask = pickActiveLiveTask(state)
    const taskKey = liveTask === undefined ? '' : JSON.stringify({
      h: liveTask.hostId,
      s: liveTask.sessionId,
      b: liveTask.badge,
      t: liveTask.title,
      st: liveTask.statusText,
      w: liveTask.isWaitingInput,
      u: liveTask.updatedAtMs,
      m: liveTask.summary,
    })

    if (taskKey !== lastLiveTaskKey) {
      const targetKey = taskKey
      liveTaskSyncTail = liveTaskSyncTail.then(async () => {
        if (targetKey !== '') {
          await foregroundService.updateLiveTask(
            liveTask!.hostId,
            liveTask!.sessionId,
            liveTask!.badge,
            liveTask!.title,
            liveTask!.statusText,
            liveTask!.isWaitingInput,
            liveTask!.updatedAtMs,
            liveTask!.summary,
          )
        } else {
          await foregroundService.clearLiveTask()
        }
        lastLiveTaskKey = targetKey
      }).catch(() => {
        // Allow retry on next observation if native bridge failed
      })
    }
  }

  const unsubscribe = useAppStore.subscribe(() => {
    if (timer !== undefined) return
    timer = setTimeout(() => {timer = undefined; observe()}, 800)
  })
  const background = AppState.addEventListener('change', phase => {if (phase !== 'active') void flushBrowseMemory()})
  observe()
  return () => {
    unsubscribe()
    background.remove()
    if (timer !== undefined) clearTimeout(timer)
    void flushBrowseMemory()
    lastLiveTaskKey = undefined
    void foregroundService.clearLiveTask()
  }
}
