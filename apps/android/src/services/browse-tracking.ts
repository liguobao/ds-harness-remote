import { strings } from '../locales/i18n'
import { AppState } from 'react-native'
import { useAppStore } from '../state/store'
import { browseKey, browseScope, useBrowseMemory, updateBrowseEntry, saveBrowseCatalog, browsePreference, flushBrowseMemory } from './browse-memory'
import { foregroundService } from './foreground-service'

/** Observe display state only; this never submits, resumes or interrupts a turn. */
export function startBrowseTracking(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let previousCatalog: unknown, previousSessions: unknown, previousMessages: unknown, previousSelected: string | undefined
  let previousUpdated = 0
  const running = new Map<string, boolean>()
  const questions = new Set<string>()
  const observe = () => {
    const state = useAppStore.getState(), memory = useBrowseMemory.getState()
    const device = state.selectedDevice
    if (device === undefined || state.connection.phase !== 'connected' || !memory.ready) return
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
      updateBrowseEntry(scope, selected.sessionId, {session: selected, messages: state.messages[selected.sessionId] ?? [],
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
  }
  const unsubscribe = useAppStore.subscribe(() => {
    if (timer !== undefined) return
    timer = setTimeout(() => {timer = undefined; observe()}, 800)
  })
  const background = AppState.addEventListener('change', phase => {if (phase !== 'active') void flushBrowseMemory()})
  observe()
  return () => {unsubscribe(); background.remove(); if (timer !== undefined) clearTimeout(timer); void flushBrowseMemory()}
}
