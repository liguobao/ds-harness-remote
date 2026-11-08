import type { SessionAccess } from './session-runtime'
import type { AppState } from './store-state'
import type {
  ScheduleCatalogEntry,
  ScheduleCreateRequest,
  ScheduleDeliveryRecord,
  ScheduleRecord,
  ScheduleTimingChange,
  ScheduleUpdateRequest,
  ScheduleUpdateResult,
} from '../types'

export interface ScheduleActionDependencies extends SessionAccess {
  getConnectionGeneration?: () => number
}

export function createScheduleActions({
  get,
  set,
  runtime,
  getConnectionGeneration = () => runtime.connectionGeneration,
}: ScheduleActionDependencies): Pick<
  AppState,
  | 'loadScheduleTasks'
  | 'createScheduleTask'
  | 'updateScheduleTask'
  | 'toggleScheduleTask'
  | 'deleteScheduleTask'
  | 'loadScheduleHistory'
> {
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

    async createScheduleTask(sessionId: string, request: ScheduleCreateRequest): Promise<ScheduleRecord | null> {
      if (get().connection.phase !== 'connected') return null
      const generation = getConnectionGeneration()
      let record: ScheduleRecord
      try {
        const proxy = runtime.connection.requireProxy()
        record = await proxy.scheduleCreate(sessionId, request)
      } catch {
        return null
      }

      if (generation !== getConnectionGeneration()) return null

      // Attempt catalog refresh; if read fails, optimistically adopt the created task so the UI does not report failure
      try {
        const proxy = runtime.connection.requireProxy()
        const tasks = await proxy.scheduleCatalog()
        if (generation === getConnectionGeneration()) {
          set({ scheduleTasks: tasks, scheduleError: undefined })
        }
      } catch {
        if (generation === getConnectionGeneration()) {
          set(state => ({
            scheduleTasks: [
              ...state.scheduleTasks,
              {
                ...record,
                sessionId,
                status: 'active',
              },
            ],
          }))
        }
      }

      return record
    },

    async updateScheduleTask(
      sessionId: string,
      id: string,
      expected: ScheduleRecord,
      options?: { change?: ScheduleTimingChange; title?: string; prompt?: string }
    ): Promise<ScheduleUpdateResult | null> {
      if (get().connection.phase !== 'connected') return null
      const generation = getConnectionGeneration()
      try {
        const proxy = runtime.connection.requireProxy()
        const req: ScheduleUpdateRequest = {
          sessionId,
          id,
          expected,
          ...(options?.change ? { change: options.change } : {}),
          ...(options?.title !== undefined ? { title: options.title } : {}),
          ...(options?.prompt !== undefined ? { prompt: options.prompt } : {}),
        }
        const result = await proxy.scheduleUpdate(req)
        if (generation !== getConnectionGeneration()) return null
        if ('updated' in result && result.updated && 'record' in result) {
          set(state => ({
            scheduleTasks: state.scheduleTasks.map(t =>
              t.id === id && t.sessionId === sessionId
                ? { ...t, ...result.record, status: t.status }
                : t
            ),
          }))
        }
        return result
      } catch {
        return null
      }
    },

    async toggleScheduleTask(task: ScheduleCatalogEntry): Promise<boolean> {
      if (get().connection.phase !== 'connected') return false
      const generation = getConnectionGeneration()
      try {
        await Promise.resolve()
        const nextStatus = task.status === 'active' ? 'inactive' : 'active'
        if (generation !== getConnectionGeneration()) return false
        set(state => ({
          scheduleTasks: state.scheduleTasks.map(t =>
            t.id === task.id && t.sessionId === task.sessionId
              ? { ...t, status: nextStatus }
              : t
          ),
        }))
        return true
      } catch {
        return false
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
