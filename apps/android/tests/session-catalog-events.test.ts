vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, StoreAccess } from '../src/state/store-state'
import type { RemoteSession, WorkspaceView } from '../src/types'

const mocks = vi.hoisted(() => ({
  storage: Object.fromEntries([
    'loadTrustedHosts', 'forgetHost', 'clearCodexPermissionPresets', 'clearDeviceCredentials',
    'saveServerConfig', 'clearLocalData', 'loadOrCreateIdentity', 'saveLanguagePreference',
    'saveCompactHistory', 'saveThemePreference', 'saveTypographyDensity', 'loadTypographyDensity',
    'saveActivityDockMode', 'loadActivityDockMode', 'saveStatusBarVisible', 'saveDefaultPermissionPreset',
    'saveFavoriteWorkspaces', 'saveRecentWorkspaces', 'loadCodexPermissionPresets', 'clearLastConnectedDeviceId',
    'saveCodexPermissionPreset',
  ].map(name => [name, vi.fn()])),
}))

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() }, Platform: { OS: 'android' } }))
vi.mock('expo-haptics', () => ({ notificationAsync: vi.fn(), NotificationFeedbackType: { Success: 'success' } }))
vi.mock('../src/services/secure-transport', () => ({ SecureTransport: class {} }))
vi.mock('../src/services/compaction-store', () => ({ compactionStore: { load: vi.fn(), save: vi.fn(), clear: vi.fn() } }))
vi.mock('../src/state/store', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('../src/services/storage', () => mocks.storage)
vi.mock('../src/services/foreground-service', () => ({
  foregroundService: { start: vi.fn(), stop: vi.fn(), update: vi.fn() },
}))
vi.mock('../src/services/browse-memory', () => ({
  browseKey: (scope: string, id: string) => scope + ':' + id,
  browseScope: () => 'scope',
  getCachedSessionMessages: () => undefined,
  saveSessionMessagesSnapshot: vi.fn(),
  updateBrowseEntry: vi.fn(),
  useBrowseMemory: { getState: () => ({ catalogs: {} }) },
}))
vi.mock('../src/services/codex', () => ({
  codexItemsToChat: vi.fn(() => []),
  codexPermissionPreset: vi.fn(),
  codexPermissionPresetFromResponse: vi.fn(),
  codexSession: vi.fn(),
  codexThreadId: vi.fn(),
  isCodexPermissionPreset: vi.fn(() => false),
  mergeCodexLive: vi.fn(),
  readCodexHistoryPage: vi.fn(),
  readCodexSession: vi.fn(),
  updateCodexSession: vi.fn(),
  withCodexPermission: vi.fn(),
}))
vi.mock('../src/services/cursor', () => ({
  applyCursorFrame: vi.fn(),
  createAntigravitySession: vi.fn(),
  createClaudeSession: vi.fn(),
  createCursorSession: vi.fn(),
  createHermesSession: vi.fn(),
  createOpencodeSession: vi.fn(),
  createPiSession: vi.fn(),
  cursorNativeId: vi.fn(),
  finalizeAssistantLive: vi.fn(),
  foldAcpHistory: vi.fn(() => []),
  mergeAcpHistoryAndLive: vi.fn(() => []),
}))

import { initialData } from '../src/state/store-state'
import { SessionRuntime } from '../src/state/session-runtime'
import { createSessionEventActions } from '../src/state/session-event-actions'
import { createSessionActions } from '../src/state/session-actions'
import { shouldPollSessionStatus } from '../src/state/session-catalog-commands'

const session = (id: string, overrides: Partial<RemoteSession> = {}): RemoteSession => ({
  sessionId: id,
  updatedAt: 100,
  running: false,
  blank: false,
  ...overrides,
})

const workspace = (id: string, sessionIds: string[], backend: WorkspaceView['backend'] = 'harness'): WorkspaceView => ({
  workspaceId: id,
  title: id,
  path: '/' + id,
  backend,
  sessionIds,
  createdAt: '',
  updatedAt: '',
})

function setupStore(overrides: Partial<AppState> = {}) {
  let state = {
    ...initialData(),
    config: { baseUrl: 'https://example.invalid', account: 'A' },
    identity: { deviceId: 'phone', publicKey: 'pk', secretKey: 'sk', createdAt: 0 },
    selectedDevice: { deviceId: 'host-1', name: 'Host', trusted: true, online: true },
    connection: { phase: 'connected' as const, stats: { mode: 'Relay' as const, connected: true } },
    hostSessionEvents: true,
    compactHistory: false,
    syncHarnessCatalog: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AppState
  const access: StoreAccess = {
    get: () => state,
    set: partial => {
      const next = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...next }
    },
  }
  const runtime = new SessionRuntime(access)
  const eventActions = createSessionEventActions({ ...access, runtime })
  const sessionActions = createSessionActions({ ...access, runtime })
  access.set({ ...eventActions, ...sessionActions })
  return { access, runtime, get: () => state }
}

describe('session catalog event sync', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('disables 8s session/list polling only when connected to a session-events host', () => {
    expect(shouldPollSessionStatus({ enabled: true, phase: 'connected', hostSessionEvents: true })).toBe(false)
    expect(shouldPollSessionStatus({ enabled: true, phase: 'connected', hostSessionEvents: false })).toBe(true)
    expect(shouldPollSessionStatus({ enabled: false, phase: 'connected', hostSessionEvents: false })).toBe(false)
    expect(shouldPollSessionStatus({ enabled: true, phase: 'offline', hostSessionEvents: false })).toBe(false)
  })

  it('updates running state, activity, error, title, and removals incrementally without catalog pulls', () => {
    const s1 = session('s1', { running: false, updatedAt: 100, title: 'Old' })
    const w1 = workspace('w1', ['s1'])
    const { get, runtime } = setupStore({ sessions: [s1], selectedSession: s1, workspaces: [w1] })
    const syncSpy = vi.fn(async () => undefined)
    get().syncHarnessCatalog = syncSpy

    const beforeList = get().sessions
    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/status', sessionId: 's1', running: false } })
    expect(get().sessions).toBe(beforeList)

    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/status', sessionId: 's1', running: true } })
    expect(get().sessions[0]?.running).toBe(true)
    expect(get().selectedSession?.running).toBe(true)
    expect(get().sessionLifecycles.s1?.running).toBe(true)

    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/error', sessionId: 's1', message: 'boom' } })
    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/status', sessionId: 's1', running: false } })
    expect(get().sessionLifecycles.s1).toMatchObject({ running: false, finished: 'failed' })

    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/activity', sessionId: 's1', updatedAt: 500 } })
    expect(get().sessions[0]?.updatedAt).toBe(500)
    expect(get().selectedSession?.updatedAt).toBe(500)

    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/projection', sessionId: 's1', key: 'title', value: 'New Title', seq: 2 } })
    expect(get().sessions[0]?.title).toBe('New Title')
    expect(get().sessions[0]?.projections?.values?.title).toBe('New Title')

    // Subagent child added -> visible immediately with zero RPC sync.
    get().handleMuxFrame({
      rpcId: '',
      payload: {
        type: 'session/added',
        session: session('sub-1', { parentSessionId: 's1', origin: 'subagent' }),
        known: false,
      },
    })
    expect(get().sessions.map(item => item.sessionId)).toEqual(['sub-1', 's1'])

    // Removal cleans both sessions and workspace.sessionIds.
    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/removed', sessionId: 's1' } })
    expect(get().sessions.map(item => item.sessionId)).toEqual(['sub-1'])
    expect(get().workspaces[0]?.sessionIds).toEqual([])

    vi.advanceTimersByTime(500)
    expect(syncSpy).not.toHaveBeenCalled()
    runtime.clearHarnessCatalogSync()
  })

  it('debounces catalog sync on unknown root session additions and cancels on disconnect', async () => {
    const { get, runtime } = setupStore({ sessions: [], workspaces: [workspace('w1', [])] })
    const syncSpy = vi.fn(async () => undefined)
    get().syncHarnessCatalog = syncSpy

    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/added', session: session('root-1') } })
    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/catalog-changed' } })
    expect(syncSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(syncSpy).toHaveBeenCalledTimes(1)

    // Clearing mux frames cancels pending sync before timer fires.
    get().handleMuxFrame({ rpcId: '', payload: { type: 'session/catalog-changed' } })
    runtime.clearPendingMuxFrames()
    await vi.advanceTimersByTimeAsync(500)
    expect(syncSpy).toHaveBeenCalledTimes(1)
  })

  it('syncHarnessCatalog updates harness workspaces and sessions without clobbering other backends', async () => {
    const codexWs = workspace('codex-1', ['codex-s1'], 'codex')
    const codexSess = session('codex-s1', { backend: 'codex' })
    const oldHarness = session('h1', { running: true })
    const { access, runtime, get } = setupStore({
      workspaces: [workspace('w1', ['h1']), codexWs],
      sessions: [oldHarness, codexSess],
      workspaceCatalog: { backend: 'codex', loading: false },
    })
    const proxy = {
      workspaceList: vi.fn(async () => ({
        items: [workspace('w1', ['h1', 'h2'])],
        archivedSessionIds: ['arch-1'],
        pinnedSessionIds: ['h2'],
      })),
      sessionList: vi.fn(async () => [
        session('h1', { running: false, updatedAt: 200 }),
        session('h2', { running: true, updatedAt: 300 }),
      ]),
    }
    vi.spyOn(runtime.connection, 'requireProxy').mockReturnValue(proxy as never)
    const actions = createSessionActions({ ...access, runtime })
    await actions.syncHarnessCatalog()

    expect(get().workspaceCatalog).toEqual({ backend: 'codex', loading: false })
    expect(get().workspaces.map(w => w.workspaceId)).toEqual(['codex-1', 'w1'])
    expect(get().sessions.map(s => s.sessionId)).toEqual(['codex-s1', 'h1', 'h2'])
    expect(get().archivedSessionIds).toEqual(['arch-1'])
    expect(get().pinnedSessionIds).toEqual(['h2'])
    expect(get().sessionLifecycles.h1).toMatchObject({ running: false, finished: 'completed' })
  })
})
