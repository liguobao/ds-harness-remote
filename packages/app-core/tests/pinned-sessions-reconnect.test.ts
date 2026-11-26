import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsFiles = new Map<string, string>()
let savedSecureKey: string | null = null

vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}))

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test-docs/',
  writeAsStringAsync: vi.fn(async (path: string, content: string) => {
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
import { createWorkspaceActions } from '../src/state/workspace-actions'
import type { SessionAccess } from '../src/state/session-runtime'
import { disconnected, type AppState } from '../src/state/store-state'
import type { RemoteDevice, RemoteSession, WorkspaceView } from '../src/types'

const hostDevice: RemoteDevice = {
  deviceId: 'host-1',
  name: 'Dev Host',
  role: 'host',
  online: true,
  trusted: true,
  identityKey: 'ed25519:host-key-1',
  platform: 'darwin',
}

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
  createdAt: 100,
  updatedAt: 200,
  cwd: '/repo/demo',
}

describe('pinned session persistence across Host reconnect (#627)', () => {
  beforeEach(async () => {
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
  })

  it('persists pinnedSessionIds in encrypted browse-memory and filters deleted ACP workspaces', async () => {
    const scope = browseScope({
      config: { baseUrl: 'https://relay.example', account: 'acct-1' },
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
      createdAt: 100,
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

  it('restores pinnedSessionIds on reconnect and preserves them when workspaceList omits pinnedSessionIds', async () => {
    const proxy = {
      hostDescribe: vi.fn(async () => ({
        version: '1.0.0',
        cwd: '/repo/demo',
        attachedSessions: 1,
        canOpenPath: true,
      })),
      workspaceList: vi.fn(async () => ({
        items: [sampleWorkspace],
        archivedSessionIds: [] as string[],
      })),
      sessionList: vi.fn(async () => [sampleSession]),
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
      customAcpBackends: vi.fn(() => []),
      hasAttentionInbox: vi.fn(() => false),
      getAttentionClient: vi.fn(() => undefined),
    }

    const runtimeMock = {
      connectionGeneration: 0,
      sessionLoadGeneration: 0,
      sessionReadAbort: undefined,
      clearHarnessCatalogSync: vi.fn(),
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
      config: { baseUrl: 'https://relay.example', account: 'acct-1' },
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
    state = { ...state, ...connectionActions, ...workspaceActions }

    expect(await state.connectDevice(hostDevice)).toBe(true)
    await state.refreshWorkspaces('harness')

    // Simulate pinning a session and persisting to browse-memory
    set({ pinnedSessionIds: ['s-1', 'cursor:c-1'] })
    const scope = browseScope(state)
    saveBrowseCatalog(scope, state.workspaces, state.sessions, {
      pinnedSessionIds: state.pinnedSessionIds,
      archivedSessionIds: state.archivedSessionIds,
    })

    // Disconnect clears active state
    await state.disconnect()
    expect(state.pinnedSessionIds).toEqual([])

    // Reconnect hydrates pinnedSessionIds from browse-memory immediately
    expect(await state.connectDevice(hostDevice)).toBe(true)
    expect(state.pinnedSessionIds).toEqual(['s-1', 'cursor:c-1'])

    // Subsequent catalog refresh whose baseline omits pinnedSessionIds keeps pinned sessions intact
    await state.refreshWorkspaces('harness')
    expect(state.pinnedSessionIds).toEqual(['s-1', 'cursor:c-1'])
  })
})
