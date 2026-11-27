vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { encryptFrame, fromBase64Url } from '@dsh-remote/crypto'
import type { AcpManagedBackend } from '../src/lib/workspace-key'
import type { AndroidRemoteRuntime } from '../src/services/remote-runtime'
import type { AppState } from '../src/state/store-state'
import type { RemoteSession, WorkspaceView } from '../src/types'

const { files, keys } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  keys: new Map<string, string>(),
}))

vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() }, Platform: { OS: 'android' } }))
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}))
vi.mock('expo-application', () => ({ applicationId: 'io.github.liguobao.dshremote' }))
vi.mock('expo-device', () => ({ modelName: 'TestPhone' }))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  randomUUID: () => globalThis.crypto.randomUUID(),
}))
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///app/',
  getInfoAsync: async (path: string) => ({ exists: files.has(path) }),
  readAsStringAsync: async (path: string) => files.get(path),
  writeAsStringAsync: async (path: string, value: string) => { files.set(path, value) },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    files.set(to, files.get(from)!)
    files.delete(from)
  },
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => keys.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { keys.set(key, value) },
  deleteItemAsync: async (key: string) => { keys.delete(key) },
}))
vi.mock('../src/services/foreground-service', () => ({
  foregroundService: { start: vi.fn(), stop: vi.fn(), update: vi.fn(), notifyTask: vi.fn(), updateLiveTask: vi.fn(), clearLiveTask: vi.fn() },
}))
vi.mock('../src/services/secure-transport', () => ({ SecureTransport: class {} }))
vi.mock('../src/services/compaction-store', () => ({ compactionStore: { load: vi.fn(), save: vi.fn(), clear: vi.fn() } }))
vi.mock('../src/state/store', () => ({ useAppStore: { getState: vi.fn() } }))

const ACP_BACKENDS: readonly AcpManagedBackend[] = [
  'cursor',
  'antigravity',
  'pi',
  'opencode',
  'claude',
  'hermes',
  'kimi',
]

const ALL_BACKENDS = ['harness', 'codex', ...ACP_BACKENDS] as const

async function loadModules() {
  vi.resetModules()
  const [workspaceKey, cursor, browseMemory, storage, workspaceActions, sessionRuntime, storeState] = await Promise.all([
    import('../src/lib/workspace-key'),
    import('../src/services/cursor'),
    import('../src/services/browse-memory'),
    import('../src/services/storage'),
    import('../src/state/workspace-actions'),
    import('../src/state/session-runtime'),
    import('../src/state/store-state'),
  ])
  await browseMemory.hydrateBrowseMemory()
  return { workspaceKey, cursor, browseMemory, storage, workspaceActions, sessionRuntime, storeState }
}

function createStoreHarness(
  modules: Awaited<ReturnType<typeof loadModules>>,
  options: { platform?: string; rootPath: string; hostRoots?: Array<{ path: string; title?: string }>; missingPaths?: Set<string> },
) {
  let state = {
    ...modules.storeState.initialData(),
    config: { baseUrl: 'https://remote.example.test', account: 'tester@example.test' },
    identity: { deviceId: 'phone-1', name: 'Phone', platform: 'android' as const, publicKey: 'pk', privateKey: 'sk' },
    selectedDevice: {
      deviceId: 'host-1',
      name: 'Host',
      platform: options.platform ?? 'linux',
      identityKey: 'host-key-1',
      membershipId: 'm1',
      online: true,
      trusted: true,
    },
    connection: { phase: 'connected' as const, stats: { mode: 'Relay' as const, connected: true } },
  } as unknown as AppState

  const get = () => state
  const set = (patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    const update = typeof patch === 'function' ? patch(state) : patch
    state = { ...state, ...update }
  }

  const hostRoots = new Map<string, Array<{ path: string; title?: string }>>()
  const sessionsByDir = new Map<string, Array<{ conversationId: string; title: string; updatedAt: number }>>()
  if (options.hostRoots) {
    for (const backend of ACP_BACKENDS) hostRoots.set(backend, [...options.hostRoots])
  }

  const acpClient = {
    call: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      const backend = String(params.backend ?? 'pi')
      if (method === 'dsh/workspaceList') {
        return hostRoots.get(backend) ?? []
      }
      if (method === 'dsh/sessionList') {
        const path = String(params.path ?? '')
        if (options.missingPaths?.has(path)) {
          throw Object.assign(new Error('The Cursor working directory must be an existing directory.'), {
            code: 'CURSOR_PATH_NOT_ALLOWED',
          })
        }
        return { items: sessionsByDir.get(`${backend}:${path}`) ?? [] }
      }
      return {}
    }),
  }

  const closeActiveCursorStream = vi.fn(async () => undefined)
  const runtime = new modules.sessionRuntime.SessionRuntime({ get, set })
  Object.assign(runtime.connection, {
    refreshBackends: vi.fn(async () => undefined),
    hasCodex: () => true,
    hasCursor: () => true,
    hasAntigravity: () => true,
    hasPi: () => true,
    hasOpencode: () => true,
    hasClaude: () => true,
    hasHermes: () => true,
    hasKimi: () => true,
    requireCursor: () => acpClient,
    requireAntigravity: () => acpClient,
    requirePi: () => acpClient,
    requireOpencode: () => acpClient,
    requireClaude: () => acpClient,
    requireHermes: () => acpClient,
    requireKimi: () => acpClient,
    requireProxy: () => ({
      workspaceCreate: vi.fn(),
      workspaceRename: vi.fn(),
      workspaceDelete: vi.fn(),
      workspaceInsertBefore: vi.fn(),
      workspaceList: vi.fn(async () => ({ items: [], archivedSessionIds: [] })),
      sessionList: vi.fn(async () => []),
      hostListDirectory: vi.fn(),
    }),
  })

  const actions = modules.workspaceActions.createWorkspaceActions({
    get,
    set,
    connection: runtime.connection as unknown as AndroidRemoteRuntime,
    getConnectionGeneration: () => runtime.connectionGeneration,
    closeActiveCursorStream,
  })
  set(actions)

  return {
    get,
    set,
    actions,
    runtime,
    acpClient,
    closeActiveCursorStream,
    setHostRoots(backend: AcpManagedBackend, items: Array<{ path: string; title?: string }>) {
      hostRoots.set(backend, items)
    },
    setHostSessions(backend: AcpManagedBackend, path: string, items: Array<{ conversationId: string; title: string; updatedAt: number }>) {
      sessionsByDir.set(`${backend}:${path}`, items)
    },
  }
}

beforeEach(() => {
  files.clear()
  keys.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Issue #447 ACP workspace management and persistence', () => {
  it('enables workspace manage actions for harness and every ACP backend, keeping codex read-only', async () => {
    const modules = await loadModules()
    for (const backend of ALL_BACKENDS) {
      const workspace: WorkspaceView = {
        workspaceId: `${backend}:cwd:%2Ftmp%2Fproj`,
        backend,
        path: '/tmp/proj',
        title: 'proj',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      expect(modules.workspaceKey.canManageWorkspace(workspace)).toBe(backend !== 'codex')
    }
    const defaultHarness: WorkspaceView = {
      workspaceId: 'default',
      path: '/tmp/proj',
      title: 'proj',
      sessionIds: [],
      createdAt: '',
      updatedAt: '',
    }
    expect(modules.workspaceKey.canManageWorkspace(defaultHarness)).toBe(true)
    expect(modules.workspaceKey.canManageWorkspace(undefined)).toBe(false)
    expect(modules.cursor.createHermesWorkspace('D:\\proj\\my-hermes-app').title).toBe('my-hermes-app')
    expect(modules.cursor.createHermesWorkspace('/srv/ws-hermes').title).toBe('ws-hermes')
    expect(modules.cursor.createKimiWorkspace('D:\\proj\\my-kimi-app').title).toBe('my-kimi-app')
    expect(modules.cursor.createKimiWorkspace('/srv/ws-kimi').title).toBe('ws-kimi')
  })

  it('persists ACP favorites and recent shortcuts across storage reloads', async () => {
    const modules = await loadModules()
    const shortcuts = ACP_BACKENDS.map(backend => ({
      deviceId: 'host-1',
      deviceName: 'Host',
      key: `${backend}:cwd:%2Ftmp%2Fws`,
      workspaceId: `${backend}:cwd:%2Ftmp%2Fws`,
      backend,
      title: `ws-${backend}`,
      path: '/tmp/ws',
      addedAt: 1000,
    }))
    await modules.storage.saveFavoriteWorkspaces(shortcuts)
    await modules.storage.saveRecentWorkspaces(shortcuts)

    const reloaded = await loadModules()
    const loadedFavs = await reloaded.storage.loadFavoriteWorkspaces()
    const loadedRecent = await reloaded.storage.loadRecentWorkspaces()
    expect(loadedFavs.map(item => item.backend)).toEqual([...ACP_BACKENDS])
    expect(loadedRecent.map(item => item.backend)).toEqual([...ACP_BACKENDS])
  })

  it('deletes workspaces across all 6 ACP backends, cleans shortcuts/streams, and prevents resurrection on refresh/runtime sync/cold restart', async () => {
    await runScenarios(
      ACP_BACKENDS.map(backend => ({
        name: `${backend} delete & cold restart`,
        run: async () => {
          files.clear()
          keys.clear()
          const targetPath = backend === 'cursor' ? '/tmp/acp-ws-cursor' : `/tmp/acp-ws-${backend}`
          const modules = await loadModules()
          const harness = createStoreHarness(modules, {
            platform: 'linux',
            rootPath: targetPath,
            hostRoots: [{ path: targetPath, title: `ws-${backend}` }],
          })
          harness.setHostSessions(backend, targetPath, [
            { conversationId: 'conv-1', title: 'Existing Chat', updatedAt: 1234 },
          ])

          const created = await harness.actions.workspaceCreate(targetPath, backend)
          expect(created).toBeDefined()
          expect(created?.backend).toBe(backend)

          // Attach active session, favorites, and recents matching the target workspace.
          const sessionId = `${backend}:conv-1`
          const activeSession: RemoteSession = {
            sessionId,
            nativeId: 'conv-1',
            backend,
            cwd: targetPath,
            updatedAt: 1234,
            running: false,
            blank: false,
            title: 'Existing Chat',
          }
          harness.set({
            workspaces: harness.get().workspaces.map(item =>
              item.workspaceId === created!.workspaceId ? { ...item, sessionIds: [sessionId] } : item),
            sessions: [activeSession],
            selectedSession: activeSession,
            messages: { [sessionId]: [{ id: 'm1', sessionId, kind: 'message', role: 'user', text: 'hi', createdAt: 1 }] },
            sessionModels: { current: { provider: backend, model: 'm' }, routable: false, groups: [], failures: [] },
          })
          await harness.actions.toggleFavoriteWorkspace(created!)
          await modules.storage.saveRecentWorkspaces([{
            deviceId: 'host-1',
            deviceName: 'Host',
            key: modules.workspaceKey.workspaceStableKey(created!, 'linux'),
            workspaceId: created!.workspaceId,
            backend,
            title: created!.title,
            path: targetPath,
            addedAt: 2000,
          }])
          harness.set({ recentWorkspaces: await modules.storage.loadRecentWorkspaces() })

          expect(await harness.actions.workspaceDelete(created!.workspaceId)).toBe(true)
          expect(harness.closeActiveCursorStream).toHaveBeenCalledTimes(1)
          expect(harness.get().workspaces.some(item => item.workspaceId === created!.workspaceId)).toBe(false)
          expect(harness.get().sessions.some(item => item.sessionId === sessionId)).toBe(false)
          expect(harness.get().selectedSession).toBeUndefined()
          expect(harness.get().sessionModels).toBeUndefined()
          expect(harness.get().messages[sessionId]).toBeUndefined()
          expect(harness.get().favoriteWorkspaces).toEqual([])
          expect(harness.get().recentWorkspaces).toEqual([])

          // Host still returns the directory on refreshWorkspaces and background catalog sync.
          await harness.actions.refreshWorkspaces(backend)
          expect(harness.get().workspaces.some(item => item.backend === backend && item.path === targetPath)).toBe(false)
          expect(harness.get().sessions.some(item => item.backend === backend)).toBe(false)

          if (backend === 'antigravity' || backend === 'pi' || backend === 'opencode' || backend === 'claude' || backend === 'hermes' || backend === 'kimi') {
            const methodMap = {
              antigravity: 'refreshAntigravityCatalog',
              pi: 'refreshPiCatalog',
              opencode: 'refreshOpencodeCatalog',
              claude: 'refreshClaudeCatalog',
              hermes: 'refreshHermesCatalog',
              kimi: 'refreshKimiCatalog',
            } as const
            const method = methodMap[backend as keyof typeof methodMap]
            await harness.runtime[method]()
            expect(harness.get().workspaces.some(item => item.backend === backend && item.path === targetPath)).toBe(false)
          }

          // Cold restart: reload modules from encrypted disk storage and reconnect.
          await modules.browseMemory.flushBrowseMemory()
          const restarted = await loadModules()
          const scope = restarted.browseMemory.browseScope({
            config: harness.get().config,
            selectedDevice: harness.get().selectedDevice,
          })
          const cachedAfterRestart = restarted.browseMemory.useBrowseMemory.getState().catalogs[scope]
          expect(cachedAfterRestart?.workspaces.some(item => item.backend === backend)).toBe(false)

          const reconnected = createStoreHarness(restarted, {
            platform: 'linux',
            rootPath: targetPath,
            hostRoots: [{ path: targetPath, title: `ws-${backend}` }],
          })
          reconnected.setHostSessions(backend, targetPath, [
            { conversationId: 'conv-1', title: 'Existing Chat', updatedAt: 1234 },
          ])
          await reconnected.actions.refreshWorkspaces(backend)
          expect(reconnected.get().workspaces.some(item => item.backend === backend && item.path === targetPath)).toBe(false)

          // Explicit recreation clears the tombstone and restores the workspace + sessions.
          const recreated = await reconnected.actions.workspaceCreate(targetPath, backend)
          expect(recreated?.path).toBe(targetPath)
          expect(reconnected.get().workspaces.some(item => item.backend === backend && item.path === targetPath)).toBe(true)
          if (backend !== 'cursor') {
            expect(reconnected.get().sessions.some(item => item.sessionId === sessionId)).toBe(true)
          }
        },
      })),
    )
  })

  it('normalizes Windows paths across deletes, trailing slashes, and legacy snapshots without deletedWorkspaces', async () => {
    const modules = await loadModules()
    const winPath = 'D:\\Repos\\MyApp'
    const harness = createStoreHarness(modules, {
      platform: 'win32',
      rootPath: winPath,
      hostRoots: [{ path: 'd:\\repos\\myapp\\', title: 'MyApp' }],
    })
    harness.setHostSessions('claude', 'd:\\repos\\myapp\\', [
      { conversationId: 'win-1', title: 'Win Session', updatedAt: 55 },
    ])

    const created = await harness.actions.workspaceCreate(winPath, 'claude')
    expect(created).toBeDefined()
    expect(await harness.actions.workspaceDelete(created!.workspaceId)).toBe(true)

    // Host later returns mixed case with trailing slash; tombstone still suppresses it.
    harness.setHostRoots('claude', [{ path: 'D:/repos/MyApp/', title: 'MyApp' }])
    await harness.actions.refreshWorkspaces('claude')
    expect(harness.get().workspaces.filter(item => item.backend === 'claude')).toEqual([])

    // Verify encrypted snapshot backward compatibility when deletedWorkspaces is absent in old payloads.
    await modules.browseMemory.flushBrowseMemory()
    const encPath = 'file:///app/remote-browse.enc'
    const secret = fromBase64Url(keys.get('dshremote.browse-key.v1')!)
    const legacyPayload = {
      entries: {},
      catalogs: {},
      hostModes: {},
      resume: false,
      notifications: true,
      autoConnectHost: true,
    }
    files.set(encPath, JSON.stringify(encryptFrame(secret, new TextEncoder().encode(JSON.stringify(legacyPayload)), 'dsh-remote-private-browse-v1')))
    const legacyReloaded = await loadModules()
    expect(legacyReloaded.browseMemory.useBrowseMemory.getState().deletedWorkspaces).toEqual({})
  })

  it('keeps stale remembered ACP directories deletable instead of breaking catalog refresh, while still rejecting invalid workspaceCreate', async () => {
    const modules = await loadModules()
    const validPath = '/tmp/valid-ws'
    const missingPath = '/tmp/deleted-on-host'
    const harness = createStoreHarness(modules, {
      platform: 'linux',
      rootPath: validPath,
      hostRoots: [{ path: validPath, title: 'valid-ws' }],
      missingPaths: new Set([missingPath]),
    })
    harness.setHostSessions('pi', validPath, [{ conversationId: 'p1', title: 'Valid Session', updatedAt: 10 }])
    const staleWorkspace = modules.cursor.createPiWorkspace(missingPath)
    harness.set({ workspaces: [staleWorkspace] })

    await harness.actions.refreshWorkspaces('pi')
    expect(harness.get().workspaceCatalog?.error).toBeUndefined()
    expect(harness.get().workspaces.map(item => item.path).sort()).toEqual([missingPath, validPath])
    expect(harness.get().sessions.map(item => item.sessionId)).toEqual(['pi:p1'])

    // Deleting the stale workspace succeeds and removes it from future refreshes.
    expect(await harness.actions.workspaceDelete(staleWorkspace.workspaceId)).toBe(true)
    await harness.actions.refreshWorkspaces('pi')
    expect(harness.get().workspaces.map(item => item.path)).toEqual([validPath])

    // Directly creating a missing directory still fails with an error and rolls back suppression if needed.
    const failed = await harness.actions.workspaceCreate(missingPath, 'pi')
    expect(failed).toBeUndefined()
    expect(harness.get().error).toContain('existing directory')
    const scope = modules.browseMemory.browseScope({
      config: harness.get().config,
      selectedDevice: harness.get().selectedDevice,
    })
    expect(modules.browseMemory.isDeletedAcpWorkspace(
      modules.browseMemory.getDeletedAcpWorkspaceKeys(scope),
      'pi',
      missingPath,
      'linux',
    )).toBe(true)
  })
})
