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
})
