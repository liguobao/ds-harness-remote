import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsFiles = new Map<string, string>()
let savedSecureKey: string | null = null
let diskWrites = 0

vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}))

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test-docs/',
  writeAsStringAsync: vi.fn(async (path: string, content: string) => {
    diskWrites++
    fsFiles.set(path, content)
  }),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    const content = fsFiles.get(from)
    if (content !== undefined) {
      fsFiles.set(to, content)
      fsFiles.delete(from)
    }
  }),
  getInfoAsync: vi.fn(async (path: string) => ({ exists: fsFiles.has(path) })),
  readAsStringAsync: vi.fn(async (path: string) => fsFiles.get(path) ?? ''),
}))

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async () => savedSecureKey),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    savedSecureKey = value
  }),
}))

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn(() => new Uint8Array(32).fill(9)),
}))

vi.mock('../src/services/storage', () => ({
  saveFavoriteWorkspaces: vi.fn(async () => undefined),
  saveRecentWorkspaces: vi.fn(async () => undefined),
  saveCodexPermissionPreset: vi.fn(async () => undefined),
  loadCodexPermissionPresets: vi.fn(async () => ({})),
  saveLastConnectedDeviceId: vi.fn(async () => undefined),
}))

vi.mock('../src/services/network-route', () => ({
  resolveAutomaticPreferredTransports: vi.fn(async () => ['relay']),
}))

vi.mock('../src/services/server-session', () => ({
  serverSession: {
    authenticate: vi.fn(async () => ({
      api: { turnCredentials: vi.fn(async () => []) },
      credentials: { accessToken: 'test-token' },
    })),
  },
}))

import { mergeBackendPinnedSessionIds } from '../src/lib/session-backend'
import {
  browseScope,
  clearBrowseMemory,
  flushBrowseMemory,
  hydrateBrowseMemory,
  markDeletedAcpWorkspace,
  saveBrowseCatalog,
  useBrowseMemory,
} from '../src/services/browse-memory'
import { createConnectionActions } from '../src/state/connection-actions'
import { createSessionActions } from '../src/state/session-actions'
import { createWorkspaceActions } from '../src/state/workspace-actions'
import type { SessionAccess } from '../src/state/session-runtime'
import { disconnected, initialData, type AppState } from '../src/state/store-state'
import type { RemoteDevice, RemoteSession, ServerConfig, WorkspaceView } from '../src/types'

const hostDevice = {
  deviceId: 'host-1',
  name: 'Dev Host',
  online: true,
  trusted: true,
  identityKey: 'ed25519:host-key-1',
  platform: 'darwin',
} as unknown as RemoteDevice

const testConfig = {
  baseUrl: 'https://relay.example',
  account: 'acct-1',
} as unknown as ServerConfig

const sampleWorkspace: WorkspaceView = {
  workspaceId: 'ws-1',
  path: '/repo/demo',
  title: 'Demo',
  sessionIds: ['s-1', 's-2'],
  createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z',
}

const sampleSession: RemoteSession = {
  sessionId: 's-1',
  title: 'Pinned Session',
  running: false,
  blank: false,
  updatedAt: 200,
  cwd: '/repo/demo',
}

describe('pinned session persistence across Host reconnect (#627)', () => {
  beforeEach(async () => {
    await flushBrowseMemory()
    fsFiles.clear()
    savedSecureKey = null
    useBrowseMemory.setState({ ready: false })
    await hydrateBrowseMemory()
    await clearBrowseMemory()
  })

  it('merges backend-scoped pinned session IDs without clobbering other backends', () => {
    const withHarness = mergeBackendPinnedSessionIds(['cursor:c-1', 's-old'], 'harness', ['s-1'])
    expect(withHarness).toEqual(['cursor:c-1', 's-1'])

    const withCustomAcp = mergeBackendPinnedSessionIds(withHarness, 'aider', ['a-1'])
    expect(withCustomAcp).toEqual(['cursor:c-1', 's-1', 'aider:a-1'])

    const afterHarnessUpdate = mergeBackendPinnedSessionIds(withCustomAcp, 'harness', ['s-2'])
    expect(afterHarnessUpdate).toEqual(['cursor:c-1', 'aider:a-1', 's-2'])

    const afterHarnessClear = mergeBackendPinnedSessionIds(afterHarnessUpdate, 'harness', [])
    expect(afterHarnessClear).toEqual(['cursor:c-1', 'aider:a-1'])
    expect(mergeBackendPinnedSessionIds([], 'aider', ['native:with-colon', 'aider:already-prefixed']))
      .toEqual(['aider:native:with-colon', 'aider:already-prefixed'])
  })

  it('persists pinnedSessionIds in encrypted browse-memory and filters deleted ACP workspaces', async () => {
    const scope = browseScope({
      config: testConfig,
      selectedDevice: hostDevice,
    })
    const cursorWs: WorkspaceView = {
      workspaceId: 'cursor:/repo/cursor-app',
      backend: 'cursor',
      path: '/repo/cursor-app',
      title: 'Cursor App',
      sessionIds: ['cursor:c-1'],
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
    }
    const cursorSession: RemoteSession = {
      sessionId: 'cursor:c-1',
      backend: 'cursor',
      title: 'Cursor Thread',
      running: false,
      blank: false,
      updatedAt: 300,
      cwd: '/repo/cursor-app',
    }

    saveBrowseCatalog(scope, [sampleWorkspace, cursorWs], [sampleSession, cursorSession], {
      pinnedSessionIds: ['s-1', 'cursor:c-1'],
      archivedSessionIds: ['s-2'],
    })
    // 3-arg calls preserve existing pinned/archived metadata
    saveBrowseCatalog(scope, [sampleWorkspace, cursorWs], [sampleSession, cursorSession])
    expect(useBrowseMemory.getState().catalogs[scope]?.pinnedSessionIds).toEqual(['s-1', 'cursor:c-1'])
    expect(useBrowseMemory.getState().catalogs[scope]?.archivedSessionIds).toEqual(['s-2'])

    await flushBrowseMemory()
    useBrowseMemory.setState({ catalogs: {}, ready: false })
    await hydrateBrowseMemory()

    expect(useBrowseMemory.getState().catalogs[scope]?.pinnedSessionIds).toEqual(['s-1', 'cursor:c-1'])
    expect(useBrowseMemory.getState().catalogs[scope]?.archivedSessionIds).toEqual(['s-2'])

    markDeletedAcpWorkspace(scope, 'cursor', '/repo/cursor-app', 'darwin')
    expect(useBrowseMemory.getState().catalogs[scope]?.pinnedSessionIds).toEqual(['s-1'])
  })

  it('does not truncate valid metadata or rewrite unchanged catalogs', async () => {
    const scope = browseScope({ config: testConfig, selectedDevice: hostDevice })
    const ids = Array.from({ length: 501 }, (_, i) => `s-${i}`)
    expect(saveBrowseCatalog(scope, [sampleWorkspace], [sampleSession], {
      pinnedSessionIds: ids, archivedSessionIds: ids,
    })).toBe(true)
    await flushBrowseMemory()
    const writesBefore = diskWrites
    expect(saveBrowseCatalog(scope, [sampleWorkspace], [sampleSession], {
      pinnedSessionIds: [...ids], archivedSessionIds: [...ids],
    })).toBe(false)
    expect(diskWrites).toBe(writesBefore)
    useBrowseMemory.setState({ catalogs: {}, ready: false })
    await hydrateBrowseMemory()
    expect(useBrowseMemory.getState().catalogs[scope]?.pinnedSessionIds).toEqual(ids)
    expect(useBrowseMemory.getState().catalogs[scope]?.archivedSessionIds).toEqual(ids)
  })

  it('persists real pin/unpin actions across reconnect, rejects stale reads and isolates Hosts', async () => {
    const proxy = {
      hostDescribe: vi.fn(async () => ({
        version: '1.0.0',
        cwd: '/repo/demo',
        attachedSessions: 1,
        canOpenPath: true,
      })),
      workspaceList: vi.fn(async (): Promise<{ items: WorkspaceView[]; archivedSessionIds: string[]; pinnedSessionIds?: string[] }> => ({
        items: [sampleWorkspace],
        archivedSessionIds: [],
      })),
      sessionList: vi.fn(async () => [sampleSession]),
      workspacePinSession: vi.fn(async (_id: string) => ['s-1']),
      workspaceUnpinSession: vi.fn(async (_id: string): Promise<string[]> => []),
    }

    const connectionMock = {
      prepareConnection: vi.fn(async () => undefined),
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      requireProxy: vi.fn(() => proxy),
      getNetworkDetails: vi.fn(async () => undefined),
      getStats: vi.fn(() => ({ mode: 'Relay' as const, connected: true })),
      refreshBackends: vi.fn(async () => undefined),
      hasSessionEvents: vi.fn(() => true),
      hasWorkspaceGit: vi.fn(() => false),
      hasCodex: vi.fn(() => false),
      hasCursor: vi.fn(() => false),
      hasAntigravity: vi.fn(() => false),
      hasPi: vi.fn(() => false),
      hasOpencode: vi.fn(() => false),
      hasClaude: vi.fn(() => false),
      hasHermes: vi.fn(() => false),
      hasKimi: vi.fn(() => false),
      customAcpBackends: vi.fn(() => []),
      hasAttentionInbox: vi.fn(() => false),
      getAttentionClient: vi.fn(() => undefined),
    }

    const runtimeMock = {
      connectionGeneration: 0,
      sessionLoadGeneration: 0,
      sessionReadAbort: undefined,
      clearHarnessCatalogSync: vi.fn(),
      flushPendingMuxFrames: vi.fn(),
      clearPendingMuxFrames: vi.fn(),
      webRtcFallbackStreak: 0,
      closeActiveCodexStream: vi.fn(async () => undefined),
      closeActiveCursorStream: vi.fn(async () => undefined),
      enqueueMuxFrame: vi.fn(),
      connectionStartedAt: 0,
      reconnectFlight: undefined,
      codexModelSelections: new Map<string, unknown>(),
      connection: connectionMock,
    }

    let state = {
      ...initialData(),
      config: testConfig,
      identity: { deviceId: 'mobile-1', publicKey: 'pk', secretKey: 'sk' },
      transportPreference: 'auto',
      connection: disconnected,
      selectedDevice: undefined,
      workspaces: [] as WorkspaceView[],
      sessions: [] as RemoteSession[],
      pinnedSessionIds: [] as string[],
      archivedSessionIds: [] as string[],
      favoriteWorkspaces: [],
      recentWorkspaces: [],
      messages: {},
    } as unknown as AppState

    const get = () => state
    const set = (updater: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
      const patch = typeof updater === 'function' ? updater(state) : updater
      state = { ...state, ...patch }
    }

    const connectionActions = createConnectionActions({
      get,
      set,
      runtime: runtimeMock as unknown as SessionAccess['runtime'],
    })
    const workspaceActions = createWorkspaceActions({
      get,
      set,
      connection: connectionMock as unknown as Parameters<typeof createWorkspaceActions>[0]['connection'],
      getConnectionGeneration: () => runtimeMock.connectionGeneration,
      closeActiveCursorStream: runtimeMock.closeActiveCursorStream,
    })
    const sessionActions = createSessionActions({ get, set, runtime: runtimeMock as unknown as SessionAccess['runtime'] })
    state = { ...state, ...connectionActions, ...workspaceActions, ...sessionActions }

    expect(await state.connectDevice(hostDevice)).toBe(true)
    await state.refreshWorkspaces('harness')

    // Simulate an older background read whose snapshot arrives after the real pin RPC.
    let resolveStale!: (value: Awaited<ReturnType<typeof proxy.workspaceList>>) => void
    proxy.workspaceList.mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve }))
    const stale = state.syncHarnessCatalog()
    expect(await state.pinSession('s-1')).toBe(true)
    expect(proxy.workspacePinSession).toHaveBeenCalledWith('s-1')
    resolveStale({ items: [sampleWorkspace], archivedSessionIds: [], pinnedSessionIds: [] })
    await stale
    expect(state.pinnedSessionIds).toEqual(['s-1'])

    const scope = browseScope(state)
    expect(useBrowseMemory.getState().catalogs[scope]?.pinnedSessionIds).toEqual(['s-1'])
    // Disconnect immediately, without a manual save.
    await state.disconnect()
    expect(state.pinnedSessionIds).toEqual([])
    expect(await state.connectDevice(hostDevice)).toBe(true)
    expect(state.pinnedSessionIds).toEqual(['s-1'])
    await state.refreshWorkspaces('harness')
    expect(state.pinnedSessionIds).toEqual(['s-1'])

    // Rehydrate from disk (simulates a fresh process rather than only an in-memory reconnect).
    await state.disconnect()
    await flushBrowseMemory()
    useBrowseMemory.setState({ catalogs: {}, ready: false })
    await hydrateBrowseMemory()
    expect(await state.connectDevice(hostDevice)).toBe(true)
    expect(state.pinnedSessionIds).toEqual(['s-1'])

    // Switching Host must not import another Host's pins.
    const otherHost = { ...hostDevice, deviceId: 'host-2', identityKey: 'ed25519:host-key-2' }
    expect(await state.connectDevice(otherHost)).toBe(true)
    expect(state.pinnedSessionIds).toEqual([])
    expect(await state.connectDevice(hostDevice)).toBe(true)
    expect(state.pinnedSessionIds).toEqual(['s-1'])

    // A stale foreground refresh must not resurrect an unpinned session.
    let resolveRefresh!: (value: Awaited<ReturnType<typeof proxy.workspaceList>>) => void
    let started!: () => void
    const refreshStarted = new Promise<void>(resolve => { started = resolve })
    proxy.workspaceList.mockImplementationOnce(() => new Promise(resolve => {
      resolveRefresh = resolve
      started()
    }))
    const staleRefresh = state.refreshWorkspaces('harness')
    await refreshStarted
    expect(await state.unpinSession('s-1')).toBe(true)
    resolveRefresh({ items: [sampleWorkspace], archivedSessionIds: [], pinnedSessionIds: ['s-1'] })
    await staleRefresh
    expect(state.pinnedSessionIds).toEqual([])
    await state.disconnect()
    expect(await state.connectDevice(hostDevice)).toBe(true)
    expect(state.pinnedSessionIds).toEqual([])

    // An explicit empty host response is authoritative, unlike an omitted field.
    expect(await state.pinSession('s-1')).toBe(true)
    proxy.workspaceList.mockResolvedValueOnce({ items: [sampleWorkspace], archivedSessionIds: [], pinnedSessionIds: [] })
    await state.refreshWorkspaces('harness')
    expect(state.pinnedSessionIds).toEqual([])
  })
})
