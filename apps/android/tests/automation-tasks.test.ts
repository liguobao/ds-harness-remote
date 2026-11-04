import { describe, expect, it, vi } from 'vitest'
import { messageCatalogs } from '../src/locales/i18n'
import { createScheduleActions } from '../src/state/schedule-actions'
import type { ScheduleCatalogEntry } from '../src/types'

describe('Automation Tasks and Sidebar i18n', () => {
  it('has complete localized sidebar and automation keys in all 7 language catalogs', () => {
    const requiredSessionKeys = [
      'newSession',
      'workspaces',
      'viewOptions',
      'addWorkspace',
      'allSessions',
      'showMoreSessions',
      'groupBy',
      'groupByWorkspace',
      'groupByWorkspaceTree',
      'groupByList',
      'orderBy',
      'orderManual',
      'orderUpdated',
      'filterSessions',
      'filterHideArchived',
      'filterAll',
      'filterArchivedOnly',
      'manageWorkspacesPrompt',
      'goToWorkspaces',
    ] as const

    const requiredAutomationKeys = [
      'title',
      'nav',
      'newAction',
      'newTask',
      'searchPlaceholder',
      'clearSearch',
      'filterAll',
      'filterActive',
      'filterInactive',
      'empty',
      'emptyInactive',
      'noMatches',
      'loading',
      'loadError',
      'nextPrefix',
      'detailTitle',
      'detailRule',
      'detailRecords',
      'name',
      'instruction',
      'status',
      'statusActive',
      'statusInactive',
      'nextRun',
      'frequency',
      'taskId',
      'linkedSession',
      'openLinkedSession',
      'deleteTask',
      'deleteConfirmTitle',
      'deleteConfirmDesc',
      'deleteConfirm',
      'deletePending',
      'deleted',
      'deleteFailed',
      'noRecords',
      'frequencyOnce',
      'frequencyDaily',
      'frequencyWeekly',
      'frequencyEvery',
      'frequencyCron',
      'editTask',
      'pauseTask',
      'resumeTask',
      'taskPaused',
      'taskResumed',
      'editRule',
      'formTitle',
      'formPrompt',
      'formFrequency',
      'formTargetSession',
      'formTime',
      'formInterval',
      'formWeekdays',
      'timingDaily',
      'timingEvery',
      'timingWeekly',
      'timingOnce',
      'workdaysOnly',
      'unsupportedBackendTitle',
      'unsupportedBackendDesc',
      'saveSuccess',
      'saveFailed',
      'retry',
      'minuteUnit',
      'hourUnit',
    ] as const

    for (const [lang, catalog] of Object.entries(messageCatalogs)) {
      for (const key of requiredSessionKeys) {
        expect(catalog.sessions[key], `Missing sessions.${key} in ${lang}`).toBeDefined()
      }
      expect(catalog.automation, `Missing automation catalog in ${lang}`).toBeDefined()
      for (const key of requiredAutomationKeys) {
        expect(catalog.automation[key], `Missing automation.${key} in ${lang}`).toBeDefined()
      }
    }
  })

  it('creates schedule actions that load catalog entries and remove deleted items from state', async () => {
    const mockTasks: ScheduleCatalogEntry[] = [
      {
        id: 'task-1',
        sessionId: 'session-1',
        kind: 'daily',
        title: 'Morning Sync',
        prompt: 'Check build and pull requests',
        scheduledAt: '2026-10-27T01:00:00.000Z',
        status: 'active',
        time: '09:00:00.000',
        timeZone: 'Asia/Shanghai',
      },
      {
        id: 'task-2',
        sessionId: 'session-2',
        kind: 'at',
        title: 'Release Reminder',
        prompt: 'Tag v1.0.0',
        scheduledAt: '2026-10-28T12:00:00.000Z',
        status: 'inactive',
      },
    ]

    const proxy = {
      scheduleCatalog: vi.fn(async () => mockTasks),
      scheduleDelete: vi.fn(async (sessionId: string, id: string) => {
        if (id === 'task-1') return { id, deleted: true }
        return { id, deleted: false, code: 'schedule_not_found' }
      }),
    }

    let state: any = {
      connection: { phase: 'connected' },
      scheduleTasks: [],
      scheduleLoading: false,
      scheduleError: undefined,
    }

    const set = vi.fn((patch: any) => {
      if (typeof patch === 'function') {
        state = { ...state, ...patch(state) }
      } else {
        state = { ...state, ...patch }
      }
    })
    const get = vi.fn(() => state)
    const runtime: any = {
      connection: {
        requireProxy: () => proxy,
      },
    }

    const actions = createScheduleActions({ get, set, runtime })

    // Test loadScheduleTasks
    await actions.loadScheduleTasks()
    expect(proxy.scheduleCatalog).toHaveBeenCalled()
    expect(state.scheduleTasks).toHaveLength(2)
    expect(state.scheduleTasks[0].title).toBe('Morning Sync')

    // Test deleteScheduleTask
    const deleted = await actions.deleteScheduleTask('session-1', 'task-1')
    expect(deleted).toBe(true)
    expect(proxy.scheduleDelete).toHaveBeenCalledWith('session-1', 'task-1')
    expect(state.scheduleTasks).toHaveLength(1)
    expect(state.scheduleTasks[0].id).toBe('task-2')

    // Test failed delete
    const notDeleted = await actions.deleteScheduleTask('session-2', 'task-missing')
    expect(notDeleted).toBe(false)
  })

  it('rejects stale responses across connection generation changes and fetches history', async () => {
    let generation = 1
    const proxy = {
      scheduleCatalog: vi.fn(async () => {
        // simulate connection generation bump mid-flight
        generation = 2
        return [{ id: 'task-stale', title: 'Stale' }] as any
      }),
      scheduleHistory: vi.fn(async (_s: string, _id: string) => ({
        id: 'task-1',
        records: [
          {
            scheduledAt: '2026-10-27T01:00:00.000Z',
            deliveredAt: '2026-10-27T01:00:02.000Z',
            messageId: 'msg-1',
            prompt: 'Delivered prompt',
          },
        ],
      })),
    }

    let state: any = {
      connection: { phase: 'connected' },
      scheduleTasks: [],
      scheduleLoading: false,
      scheduleError: undefined,
    }
    const set = vi.fn((patch: any) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    })
    const get = vi.fn(() => state)
    const runtime: any = {
      connection: {
        requireProxy: () => proxy,
      },
    }

    const actions = createScheduleActions({
      get,
      set,
      runtime,
      getConnectionGeneration: () => generation,
    })

    // Load tasks with mid-flight generation change
    await actions.loadScheduleTasks()
    // State should NOT have adopted stale tasks because generation bumped
    expect(state.scheduleTasks).toHaveLength(0)

    // Load history
    const history = await actions.loadScheduleHistory('session-1', 'task-1')
    expect(history).toHaveLength(1)
    expect(history[0]?.messageId).toBe('msg-1')
  })

  it('creates a new schedule task and reloads catalog with generation protection', async () => {
    let generation = 1
    const newRecord = {
      id: 'task-new',
      kind: 'daily' as const,
      title: 'Daily Digest',
      prompt: 'Summarize news',
      time: '08:00:00.000',
      timeZone: 'UTC',
      scheduledAt: '2026-10-29T08:00:00.000Z',
    }
    const updatedCatalog: ScheduleCatalogEntry[] = [
      {
        ...newRecord,
        sessionId: 'session-1',
        status: 'active',
      },
    ]

    const proxy = {
      scheduleCreate: vi.fn(async () => newRecord),
      scheduleCatalog: vi.fn(async () => updatedCatalog),
    }

    let state: any = {
      connection: { phase: 'connected' },
      scheduleTasks: [],
      scheduleLoading: false,
      scheduleError: undefined,
    }
    const set = vi.fn((patch: any) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    })
    const get = vi.fn(() => state)
    const runtime: any = {
      connection: { requireProxy: () => proxy },
    }

    const actions = createScheduleActions({
      get,
      set,
      runtime,
      getConnectionGeneration: () => generation,
    })

    // Successful create
    const created = await actions.createScheduleTask('session-1', {
      title: 'Daily Digest',
      prompt: 'Summarize news',
      daily: { time: '08:00:00.000', time_zone: 'UTC' },
    })
    expect(created).toEqual(newRecord)
    expect(proxy.scheduleCreate).toHaveBeenCalledWith('session-1', {
      title: 'Daily Digest',
      prompt: 'Summarize news',
      daily: { time: '08:00:00.000', time_zone: 'UTC' },
    })
    expect(proxy.scheduleCatalog).toHaveBeenCalled()
    expect(state.scheduleTasks).toHaveLength(1)
    expect(state.scheduleTasks[0].id).toBe('task-new')

    // Stale generation during create
    proxy.scheduleCreate.mockImplementationOnce(async () => {
      generation = 2
      return newRecord
    })
    const staleResult = await actions.createScheduleTask('session-1', {
      title: 'Stale',
      prompt: 'Stale',
    })
    expect(staleResult).toBeNull()
  })

  it('updates an existing schedule task timing and handles conflicts with generation protection', async () => {
    let generation = 1
    const initialTask: ScheduleCatalogEntry = {
      id: 'task-1',
      sessionId: 'session-1',
      kind: 'daily',
      title: 'Old Title',
      prompt: 'Old Prompt',
      time: '08:00:00.000',
      timeZone: 'UTC',
      scheduledAt: '2026-10-29T08:00:00.000Z',
      status: 'active',
    }
    const updatedRecord = {
      id: 'task-1',
      kind: 'daily' as const,
      title: 'New Title',
      prompt: 'New Prompt',
      time: '09:00:00.000',
      timeZone: 'UTC',
      scheduledAt: '2026-10-29T09:00:00.000Z',
    }

    const proxy = {
      scheduleUpdate: vi.fn<any>(async () => ({
        id: 'task-1',
        updated: true,
        record: updatedRecord,
      })),
    }

    let state: any = {
      connection: { phase: 'connected' },
      scheduleTasks: [initialTask],
      scheduleLoading: false,
      scheduleError: undefined,
    }
    const set = vi.fn((patch: any) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    })
    const get = vi.fn(() => state)
    const runtime: any = {
      connection: { requireProxy: () => proxy },
    }

    const actions = createScheduleActions({
      get,
      set,
      runtime,
      getConnectionGeneration: () => generation,
    })

    const expectedRecord = {
      id: 'task-1',
      kind: 'daily' as const,
      title: 'Old Title',
      prompt: 'Old Prompt',
      time: '08:00:00.000',
      timeZone: 'UTC',
      scheduledAt: '2026-10-29T08:00:00.000Z',
    }

    // Successful update
    const result = await actions.updateScheduleTask('session-1', 'task-1', expectedRecord, {
      title: 'New Title',
      prompt: 'New Prompt',
      change: { kind: 'daily', daily: { time: '09:00:00.000', time_zone: 'UTC' } },
    })
    expect(result).toMatchObject({ id: 'task-1', updated: true })
    expect(state.scheduleTasks[0].title).toBe('New Title')
    expect(state.scheduleTasks[0].time).toBe('09:00:00.000')

    // Stale generation during update
    proxy.scheduleUpdate.mockImplementationOnce(async () => {
      generation = 2
      return { id: 'task-1', updated: true, record: updatedRecord }
    })
    const staleUpdate = await actions.updateScheduleTask('session-1', 'task-1', expectedRecord, {
      title: 'Stale',
    })
    expect(staleUpdate).toBeNull()

    // Conflict result from host
    proxy.scheduleUpdate.mockImplementationOnce(async () => ({
      id: 'task-1',
      updated: false,
      code: 'schedule_conflict' as const,
    }))
    const conflictResult = await actions.updateScheduleTask('session-1', 'task-1', expectedRecord, {
      title: 'Conflicted',
    })
    expect(conflictResult).toMatchObject({ id: 'task-1', updated: false, code: 'schedule_conflict' })

    // Title-only update: change is omitted
    proxy.scheduleUpdate.mockClear()
    proxy.scheduleUpdate.mockImplementationOnce(async (req: any) => ({
      id: 'task-1',
      updated: true,
      record: { ...updatedRecord, title: 'Title Only' },
    }))
    await actions.updateScheduleTask('session-1', 'task-1', expectedRecord, {
      title: 'Title Only',
    })
    expect(proxy.scheduleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Title Only',
      })
    )
    expect(proxy.scheduleUpdate.mock.calls[0][0].change).toBeUndefined()
  })

  it('createScheduleTask succeeds and updates state even if catalog refresh fails', async () => {
    const newRecord = {
      id: 'task-created',
      kind: 'daily' as const,
      title: 'Created Task',
      prompt: 'Prompt',
      time: '08:00:00.000',
      timeZone: 'UTC',
      scheduledAt: '2026-10-29T08:00:00.000Z',
    }
    const proxy = {
      scheduleCreate: vi.fn(async () => newRecord),
      scheduleCatalog: vi.fn(async () => {
        throw new Error('Network timeout during catalog refresh')
      }),
    }
    let state: any = {
      connection: { phase: 'connected' },
      scheduleTasks: [],
    }
    const set = vi.fn((patch: any) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    })
    const get = vi.fn(() => state)
    const runtime: any = { connection: { requireProxy: () => proxy } }

    const actions = createScheduleActions({
      get,
      set,
      runtime,
      getConnectionGeneration: () => 1,
    })

    const res = await actions.createScheduleTask('session-1', {
      title: 'Created Task',
      prompt: 'Prompt',
    })
    expect(res).toEqual(newRecord)
    expect(state.scheduleTasks).toHaveLength(1)
    expect(state.scheduleTasks[0].id).toBe('task-created')
    expect(state.scheduleTasks[0].status).toBe('active')
  })

  it('toggles schedule task active and inactive status with generation protection', async () => {
    let generation = 1
    const task: ScheduleCatalogEntry = {
      id: 'task-1',
      sessionId: 'session-1',
      kind: 'daily',
      title: 'Task',
      prompt: 'Prompt',
      time: '08:00:00.000',
      timeZone: 'UTC',
      scheduledAt: '2026-10-29T08:00:00.000Z',
      status: 'active',
    }

    let state: any = {
      connection: { phase: 'connected' },
      scheduleTasks: [task],
      scheduleLoading: false,
      scheduleError: undefined,
    }
    const set = vi.fn((patch: any) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    })
    const get = vi.fn(() => state)
    const runtime: any = {
      connection: { requireProxy: () => ({}) },
    }

    const actions = createScheduleActions({
      get,
      set,
      runtime,
      getConnectionGeneration: () => generation,
    })

    // Toggle from active to inactive
    const ok = await actions.toggleScheduleTask(task)
    expect(ok).toBe(true)
    expect(state.scheduleTasks[0].status).toBe('inactive')

    // Toggle from inactive to active
    const ok2 = await actions.toggleScheduleTask(state.scheduleTasks[0])
    expect(ok2).toBe(true)
    expect(state.scheduleTasks[0].status).toBe('active')

    // Stale generation
    let calls = 0
    const staleActions = createScheduleActions({
      get,
      set,
      runtime,
      getConnectionGeneration: () => {
        calls++
        return calls === 1 ? 1 : 2
      },
    })
    const ok3 = await staleActions.toggleScheduleTask(state.scheduleTasks[0])
    expect(ok3).toBe(false)
  })

})
