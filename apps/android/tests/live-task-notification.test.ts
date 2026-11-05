import { describe, expect, it, vi } from 'vitest'

const { mockNativeService } = vi.hoisted(() => ({
  mockNativeService: {
    updateLiveTask: vi.fn(),
    clearLiveTask: vi.fn(),
    notifyTask: vi.fn(),
  },
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {
    DshRemoteForegroundService: mockNativeService,
  },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: () => {} }),
  },
}))

vi.mock('../src/state/store', () => ({
  useAppStore: {
    getState: () => ({}),
    subscribe: () => () => {},
  },
}))

vi.mock('../src/services/browse-memory', () => ({
  browseScope: () => 'scope',
  browseKey: (s: string, id: string) => s + id,
  useBrowseMemory: { getState: () => ({ ready: true, notifications: true, entries: {} }) },
  updateBrowseEntry: () => {},
  saveBrowseCatalog: () => {},
  browsePreference: () => {},
  flushBrowseMemory: () => {},
}))

import { backendBadge, pickActiveLiveTask } from '../src/services/browse-tracking'
import { foregroundService } from '../src/services/foreground-service'
import { strings } from '../src/locales/i18n'

describe('backendBadge', () => {
  it('maps all supported backends to single letter badges', () => {
    expect(backendBadge('hermes')).toBe('H')
    expect(backendBadge('claude')).toBe('C')
    expect(backendBadge('codex')).toBe('X')
    expect(backendBadge('opencode')).toBe('O')
    expect(backendBadge('pi')).toBe('P')
    expect(backendBadge('cursor')).toBe('U')
    expect(backendBadge('antigravity')).toBe('A')
  })

  it('handles case-insensitivity and whitespace', () => {
    expect(backendBadge('  HERMES  ')).toBe('H')
    expect(backendBadge('Claude')).toBe('C')
    expect(backendBadge('Antigravity')).toBe('A')
    expect(backendBadge('OPENCODE')).toBe('O')
  })

  it('defaults to D for deepseek harness / undefined / unknown', () => {
    expect(backendBadge()).toBe('D')
    expect(backendBadge('')).toBe('D')
    expect(backendBadge('unknown')).toBe('D')
  })
})

describe('pickActiveLiveTask', () => {
  const baseDevice = { deviceId: 'host-1' }

  it('returns undefined when no device is selected', () => {
    const task = pickActiveLiveTask({
      selectedDevice: undefined,
      connection: { phase: 'connected' },
      sessions: [{ sessionId: 's1', running: true, updatedAt: 100 }],
    })
    expect(task).toBeUndefined()
  })

  it('returns undefined when connection is not connected', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connecting' },
      sessions: [{ sessionId: 's1', running: true, updatedAt: 100 }],
    })
    expect(task).toBeUndefined()
  })

  it('returns undefined when sessions list is empty or has no active tasks', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connected' },
      sessions: [{ sessionId: 's1', running: false, updatedAt: 100 }],
    })
    expect(task).toBeUndefined()
  })

  it('picks a running session by session.running', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connected' },
      sessions: [{ sessionId: 's1', backend: 'hermes', title: '移动端自动化任务功能升级', running: true, updatedAt: 1000 }],
    })
    expect(task).toBeDefined()
    expect(task?.hostId).toBe('host-1')
    expect(task?.sessionId).toBe('s1')
    expect(task?.badge).toBe('H')
    expect(task?.title).toBe('移动端自动化任务功能升级')
    expect(task?.statusText).toBe(strings.comfort.liveTaskRunning)
    expect(task?.isWaitingInput).toBe(false)
    expect(task?.updatedAtMs).toBe(1000)
  })

  it('picks a running session by sessionLifecycles', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connected' },
      sessions: [{ sessionId: 's1', backend: 'claude', title: 'Refactoring', running: false, updatedAt: 2000 }],
      sessionLifecycles: {
        s1: { running: true },
      },
    })
    expect(task).toBeDefined()
    expect(task?.badge).toBe('C')
    expect(task?.isWaitingInput).toBe(false)
  })

  it('picks a session awaiting approval or question with isWaitingInput true', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connected' },
      sessions: [{ sessionId: 's1', backend: 'codex', title: 'Review PR', running: false, updatedAt: 3000 }],
      messages: {
        s1: [{ id: 'm1', kind: 'approval', outcome: undefined }],
      },
    })
    expect(task).toBeDefined()
    expect(task?.badge).toBe('X')
    expect(task?.isWaitingInput).toBe(true)
    expect(task?.statusText).toBe(strings.comfort.liveTaskWaiting)
  })

  it('prioritizes session waiting for input over running session', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connected' },
      sessions: [
        { sessionId: 's1', backend: 'hermes', title: 'Running Task', running: true, updatedAt: 5000 },
        { sessionId: 's2', backend: 'opencode', title: 'Waiting Task', running: false, updatedAt: 4000 },
      ],
      messages: {
        s2: [{ id: 'm1', kind: 'question', frameRpcId: 'rpc-1', outcome: undefined, questionState: 'open' }],
      },
    })
    expect(task).toBeDefined()
    expect(task?.sessionId).toBe('s2')
    expect(task?.badge).toBe('O')
    expect(task?.isWaitingInput).toBe(true)
  })

  it('prioritizes selected session when multiple sessions are running', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connected' },
      sessions: [
        { sessionId: 's1', backend: 'hermes', title: 'Task 1', running: true, updatedAt: 6000 },
        { sessionId: 's2', backend: 'claude', title: 'Task 2', running: true, updatedAt: 5000 },
      ],
      selectedSession: { sessionId: 's2' },
    })
    expect(task).toBeDefined()
    expect(task?.sessionId).toBe('s2')
    expect(task?.badge).toBe('C')
  })

  it('prioritizes most recently updated session when none is selected', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connected' },
      sessions: [
        { sessionId: 's1', backend: 'hermes', title: 'Task 1', running: true, updatedAt: 5000 },
        { sessionId: 's2', backend: 'claude', title: 'Task 2', running: true, updatedAt: 7000 },
      ],
    })
    expect(task).toBeDefined()
    expect(task?.sessionId).toBe('s2')
    expect(task?.badge).toBe('C')
  })

  it('falls back to default title when session title is empty or blank', () => {
    const task = pickActiveLiveTask({
      selectedDevice: baseDevice,
      connection: { phase: 'connected' },
      sessions: [{ sessionId: 's1', backend: 'pi', title: '   ', running: true, updatedAt: 100 }],
    })
    expect(task).toBeDefined()
    expect(task?.badge).toBe('P')
    expect(task?.title).toBe(strings.comfort.liveTaskDefaultTitle)
  })
})

describe('foregroundService safe fallback in Node test environment', () => {
  it('safely resolves updateLiveTask in Node test environment without throwing', async () => {
    await expect(
      foregroundService.updateLiveTask('host-1', 's1', 'H', 'Test', 'Running', false, 12345)
    ).resolves.toBeUndefined()
  })

  it('safely resolves clearLiveTask in Node test environment without throwing', async () => {
    await expect(foregroundService.clearLiveTask()).resolves.toBeUndefined()
  })
})

describe('live task notification locale resources', () => {
  const getLocales = async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const vm = await import('node:vm')
    const filePath = path.resolve(__dirname, '../plugins/with-remote-foreground-service.js')
    const code = fs.readFileSync(filePath, 'utf8')
    const match = code.match(/const stringLocales = (\{[\s\S]*?\n\})/)
    if (!match) throw new Error('stringLocales not found in with-remote-foreground-service.js')
    const sandbox = { result: {} as Record<string, Record<string, string>> }
    vm.runInNewContext('result = ' + match[1], sandbox)
    return sandbox.result
  }

  it('defines string resources for all supported locales', async () => {
    const stringLocales = await getLocales()

    const requiredKeys = [
      'ask_agent_process_text',
      'live_task_time_just_now',
      'live_task_time_minutes_ago',
      'live_task_time_hours_ago',
      'live_task_time_days_ago',
      'live_task_status_running',
      'live_task_status_waiting',
    ]

    const expectedLocales = [
      'values',
      'values-zh',
      'values-zh-rCN',
      'values-zh-rTW',
      'values-zh-rHK',
      'values-ja',
      'values-es',
      'values-fr',
      'values-de',
    ]

    for (const locale of expectedLocales) {
      const localeMap = stringLocales[locale]
      expect(localeMap, `missing locale ${locale}`).toBeDefined()
      if (!localeMap) continue
      for (const key of requiredKeys) {
        const val = localeMap[key]
        expect(val, `missing ${key} in ${locale}`).toBeDefined()
        expect(typeof val).toBe('string')
        expect(val?.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('contains valid integer formatting specifiers for relative time strings', async () => {
    const stringLocales = await getLocales()
    for (const locale of Object.keys(stringLocales)) {
      const stringsMap = stringLocales[locale]
      expect(stringsMap).toBeDefined()
      if (!stringsMap) continue
      expect(stringsMap.live_task_time_minutes_ago).toMatch(/%(?:1\$)?[d]/)
      expect(stringsMap.live_task_time_hours_ago).toMatch(/%(?:1\$)?[d]/)
      expect(stringsMap.live_task_time_days_ago).toMatch(/%(?:1\$)?[d]/)
    }
  })

  it('does not leak Chinese text into non-Chinese locales', async () => {
    const stringLocales = await getLocales()
    const chinesePattern = /[\u4e00-\u9fa5]/
    const nonChineseLocales = ['values', 'values-es', 'values-fr', 'values-de']
    for (const locale of nonChineseLocales) {
      const map = stringLocales[locale]
      expect(map).toBeDefined()
      if (!map) continue
      for (const [key, value] of Object.entries(map)) {
        expect(chinesePattern.test(value), `${locale}.${key} contains Chinese: ${value}`).toBe(false)
      }
    }
  })
})
