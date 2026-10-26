import type { SessionAccess } from './session-runtime'
import type { AppState } from './store-state'
import type { ScheduleDeliveryRecord } from '../types'

export interface ScheduleActionDependencies extends SessionAccess {
  getConnectionGeneration?: () => number
}

export function createScheduleActions({
  get,
  set,
  runtime,
  getConnectionGeneration = () => runtime.connectionGeneration,
}: ScheduleActionDependencies): Pick<AppState, 'loadScheduleTasks' | 'deleteScheduleTask' | 'loadScheduleHistory'> {
  let requestSeq = 0

  return {
    async loadScheduleTasks() {
      if (get().connection.phase !== 'connected') return
      const generation = getConnectionGeneration()
      const seq = ++requestSeq
      set({ scheduleLoading: true, scheduleError: undefined })
      try {
        const proxy = runtime.connection.requireProxy()
        const tasks = await proxy.scheduleCatalog()
        if (generation !== getConnectionGeneration() || seq !== requestSeq) return
        set({ scheduleTasks: tasks, scheduleLoading: false, scheduleError: undefined })
      } catch (error) {
        if (generation !== getConnectionGeneration() || seq !== requestSeq) return
        set({
          scheduleLoading: false,
          scheduleError: error instanceof Error ? error.message : 'Could not load tasks',
        })
      }
    },

    async deleteScheduleTask(sessionId: string, id: string): Promise<boolean> {
      const generation = getConnectionGeneration()
      try {
        const proxy = runtime.connection.requireProxy()
        const result = await proxy.scheduleDelete(sessionId, id)
        if (generation !== getConnectionGeneration()) return false
        if (result.deleted) {
          set(state => ({
            scheduleTasks: state.scheduleTasks.filter(t => !(t.sessionId === sessionId && t.id === id)),
          }))
          return true
        }
        return false
      } catch {
        return false
      }
    },

    async loadScheduleHistory(sessionId: string, id: string): Promise<ScheduleDeliveryRecord[]> {
      if (get().connection.phase !== 'connected') return []
      const generation = getConnectionGeneration()
      try {
        const proxy = runtime.connection.requireProxy()
        const res = await proxy.scheduleHistory(sessionId, id)
        if (generation !== getConnectionGeneration()) return []
        return Array.isArray(res.records) ? res.records : []
      } catch {
        return []
      }
    },
  }
}
