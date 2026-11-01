import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type { AppState, StoreAccess } from '../src/state/store-state'
import type { AndroidRemoteRuntime } from '../src/services/remote-runtime'
import type { WorkspaceView } from '../src/types'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), reconcile: vi.fn(), createContext: vi.fn(), signInWith: vi.fn(),
  storage: Object.fromEntries([
    'loadTrustedHosts', 'forgetHost', 'clearCodexPermissionPresets', 'clearDeviceCredentials',
    'saveServerConfig', 'clearLocalData', 'loadOrCreateIdentity', 'saveLanguagePreference',
    'saveCompactHistory', 'saveThemePreference', 'saveTypographyDensity', 'loadTypographyDensity', 'saveStatusBarVisible', 'saveDefaultPermissionPreset', 'saveFavoriteWorkspaces',
    'saveRecentWorkspaces', 'loadCodexPermissionPresets', 'clearLastConnectedDeviceId',
  ].map(name => [name, vi.fn()])),
  createCodex: vi.fn(), loadCodex: vi.fn(), loadAgy: vi.fn(), loadPi: vi.fn(), loadOpencode: vi.fn(), loadClaude: vi.fn(), loadHermes: vi.fn(),
}))
vi.mock('expo-haptics', () => ({ notificationAsync: vi.fn(), NotificationFeedbackType: { Success: 'success' } }))
vi.mock('../src/services/storage', () => mocks.storage)
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate: mocks.authenticate } }))
vi.mock('../src/services/device-directory', () => ({ reconcileTrustedDevices: mocks.reconcile }))
vi.mock('../src/services/login', () => ({
  loginFlow: { createContext: mocks.createContext, signInWith: mocks.signInWith },
  passwordLoginChannel: { busyAction: 'login' },
}))
vi.mock('../src/services/rpc-id', () => ({ createNativeRpcId: () => 'test-rpc' }))
vi.mock('../src/services/codex', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/codex')>(),
  createCodexWorkspace: mocks.createCodex, loadCodexCatalog: mocks.loadCodex,
}))
vi.mock('../src/services/antigravity', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/antigravity')>(), loadAntigravityCatalog: mocks.loadAgy,
}))
vi.mock('../src/services/claude', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/claude')>(), loadClaudeCatalog: mocks.loadClaude,
}))
vi.mock('../src/services/pi', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/pi')>(), loadPiCatalog: mocks.loadPi,
}))
vi.mock('../src/services/hermes', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/hermes')>(), loadHermesCatalog: mocks.loadHermes,
}))
vi.mock('../src/services/opencode', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/opencode')>(), loadOpencodeCatalog: mocks.loadOpencode,
}))
import { RemoteServerApi } from '../src/services/api'
import { createAccountActions } from '../src/state/account-actions'
import { createWorkspaceActions } from '../src/state/workspace-actions'
import { initialData } from '../src/state/store-state'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const authError = () => Object.assign(new Error('old authorization'), { code: 'AUTH_INVALID' })
const workspace = (id: string, backend: WorkspaceView['backend'] = 'harness'): WorkspaceView => ({
  workspaceId: id, title: id, path: `/${id}`, backend, sessionIds: [], createdAt: '', updatedAt: '',
})
function storeFixture() {
  let state = {
    ...initialData(), config: { baseUrl: 'https://example.invalid', account: 'A' },
    identity: { deviceId: 'phone' }, languagePreference: 'system', themePreference: 'system',
    statusBarVisible: true, defaultPermissionPreset: 'default', disconnect: vi.fn(async () => undefined),
  } as unknown as AppState
  const access: StoreAccess = {
    get: () => state,
    set: partial => { state = { ...state, ...typeof partial === 'function' ? partial(state) : partial } },
  }
  return access
}
function accountFixture() {
  const store = storeFixture()
  store.set(createAccountActions(store))
  return store
}
function prepare() {
  vi.resetAllMocks()
  mocks.storage.loadTrustedHosts!.mockResolvedValue([])
  mocks.storage.loadCodexPermissionPresets!.mockResolvedValue({})
  mocks.storage.loadOrCreateIdentity!.mockResolvedValue({ deviceId: 'new-phone' })
  mocks.authenticate.mockResolvedValue({ api: { removeSelf: vi.fn() } })
  mocks.reconcile.mockResolvedValue({ devices: [], missingTrustedDeviceIds: [] })
  mocks.createContext.mockResolvedValue({ baseUrl: 'https://example.invalid' })
  mocks.signInWith.mockResolvedValue({ account: 'B', loginMethod: 'password' })
}
beforeEach(prepare)
afterEach(() => vi.restoreAllMocks())

describe('account directory operation isolation', () => {
  it('saves a validated server and isolates old credentials while rejecting failed switches', async () => {
    await runScenarios(['new-server', 'same-server', 'unavailable', 'invalid'].map(name => ({
      name,
      run: async () => {
        prepare()
        const health = vi.spyOn(RemoteServerApi.prototype, 'health').mockResolvedValue(undefined)
        if (name === 'unavailable') health.mockRejectedValue(new Error('unavailable'))
        const store = accountFixture()
        const previous = store.get().config
        store.set({ pendingOAuthBaseUrl: previous!.baseUrl, pendingOAuthLoginMethod: 'google-oauth' })
        mocks.storage.loadTrustedHosts!.mockResolvedValue([{ deviceId: 'old-host' }])
        const target = name === 'same-server' ? previous!.baseUrl : name === 'invalid' ? 'http://public.example.com' : 'https://new.example.com/'
        const saved = await store.get().selectServer(target)
        if (name === 'new-server') {
          expect(saved).toBe('https://new.example.com')
          expect(mocks.storage.saveServerConfig).toHaveBeenCalledWith({ baseUrl: saved })
          expect(store.get().disconnect).toHaveBeenCalledOnce()
          expect(mocks.storage.clearDeviceCredentials).toHaveBeenCalledOnce()
          expect(mocks.storage.forgetHost).toHaveBeenCalledWith('old-host')
          expect(mocks.storage.clearCodexPermissionPresets).toHaveBeenCalledWith('old-host')
          expect(store.get()).toMatchObject({ config: { baseUrl: saved }, reauthRequired: true, devices: [] })
          expect(store.get().pendingOAuthBaseUrl).toBeUndefined()
          expect(store.get().pendingOAuthLoginMethod).toBeUndefined()
          expect(store.get().account).toBeUndefined()
        } else {
          expect(saved).toBe(name === 'same-server' ? previous!.baseUrl : undefined)
          expect(store.get().config).toBe(previous)
          expect(store.get().disconnect).not.toHaveBeenCalled()
          expect(mocks.storage.clearDeviceCredentials).not.toHaveBeenCalled()
          expect(mocks.storage.saveServerConfig).not.toHaveBeenCalled()
        }
        health.mockRestore()
      },
    })))
  })

  it('ignores old directory success and authentication failures after account or identity replacement', async () => {
    await runScenarios(['config', 'identity'].flatMap(change => ['success', 'auth-error', 'network-error'].map(outcome => ({
      name: `${change}/${outcome}`,
      run: async () => {
        const store = accountFixture()
        const response = deferred<any>()
        mocks.reconcile.mockReturnValueOnce(response.promise)
        const pending = store.get().refreshDevices()
        await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenCalledOnce())
        store.set({ [change]: change === 'config' ? { baseUrl: 'https://new.invalid', account: 'B' } : { deviceId: 'replacement' } } as Partial<AppState>)
        store.set({ devices: [{ deviceId: 'B' }] as AppState['devices'], error: 'new error', refreshing: true, busyAction: 'new action' })
        const expected = store.get()
        if (outcome === 'success') response.resolve({ devices: [{ deviceId: 'A' }], missingTrustedDeviceIds: ['B'] })
        else response.reject(outcome === 'auth-error' ? authError() : new Error('old network failure'))
        await pending
        expect(store.get()).toEqual(expected)
        expect(mocks.storage.forgetHost).not.toHaveBeenCalled()
        expect(mocks.storage.clearCodexPermissionPresets).not.toHaveBeenCalled()
        expect(mocks.storage.clearDeviceCredentials).not.toHaveBeenCalled()
        expect(store.get().disconnect).not.toHaveBeenCalled()
      },
    }))), prepare)
  })

  it('lets only the newest directory refresh publish or trigger reauthorization', async () => {
    await runScenarios(['success', 'auth-error'].map(outcome => ({ name: outcome, run: async () => {
      const store = accountFixture()
      const old = deferred<any>()
      mocks.reconcile.mockReturnValueOnce(old.promise)
      const pending = store.get().refreshDevices()
      await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenCalledOnce())
      mocks.reconcile.mockResolvedValueOnce({ devices: [{ deviceId: 'latest' }], missingTrustedDeviceIds: [] })
      await store.get().refreshDevices()
      if (outcome === 'success') old.resolve({ devices: [], missingTrustedDeviceIds: ['latest'] })
      else old.reject(authError())
      await pending
      expect(store.get().devices).toEqual([{ deviceId: 'latest' }])
      expect(store.get().refreshing).toBe(false)
      expect(store.get().reauthRequired).toBe(false)
      expect(mocks.storage.forgetHost).not.toHaveBeenCalled()
    } })), prepare)
  })

  it('invalidates refresh immediately and drains credential writes or cleanup before account transitions', async () => {
    await runScenarios(['authenticate', 'cleanup'].flatMap(stage => ['login', 'sign-out', 'reset', 'reauth'].map(transition => ({
      name: `${stage}/${transition}`,
      run: async () => {
        const store = accountFixture()
        const gate = deferred<any>()
        if (stage === 'authenticate') mocks.authenticate.mockReturnValueOnce(gate.promise)
        else {
          mocks.reconcile.mockResolvedValueOnce({ devices: [{ deviceId: 'old' }], missingTrustedDeviceIds: ['removed-1', 'removed-2'] })
          mocks.storage.forgetHost!.mockReturnValueOnce(gate.promise)
        }
        const refreshing = store.get().refreshDevices()
        await vi.waitFor(() => expect(stage === 'authenticate' ? mocks.authenticate : mocks.storage.forgetHost).toHaveBeenCalledOnce())
        const changing = transition === 'login' ? store.get().configureServer('https://example.invalid', 'B', 'password')
          : transition === 'sign-out' ? store.get().signOut()
            : transition === 'reset' ? store.get().resetLocalData() : store.get().requireReauth('reauth')
        expect(store.get().refreshing).toBe(false)
        await Promise.resolve()
        expect(mocks.signInWith).not.toHaveBeenCalled()
        expect(mocks.storage.clearLocalData).not.toHaveBeenCalled()
        expect(mocks.storage.clearDeviceCredentials).not.toHaveBeenCalled()
        gate.resolve({ api: {} })
        await Promise.all([refreshing, changing])
        expect(mocks.storage.clearCodexPermissionPresets).not.toHaveBeenCalled()
        expect(mocks.storage.forgetHost).toHaveBeenCalledTimes(stage === 'cleanup' ? 1 : 0)
        expect(store.get().devices).toEqual([])
        expect(store.get().account).toBe(transition === 'login' ? 'B' : undefined)
        expect(store.get().reauthRequired).toBe(transition === 'reauth')
      },
    }))), prepare)
  })

  it('still removes every revoked pin sequentially and handles current authorization failures', async () => {
    await runScenarios(['cleanup', 'auth-error'].map(name => ({ name, run: async () => {
      const store = accountFixture()
      if (name === 'auth-error') mocks.reconcile.mockRejectedValueOnce(authError())
      else mocks.reconcile.mockResolvedValueOnce({ devices: [{ deviceId: 'valid' }], missingTrustedDeviceIds: ['one', 'two'] })
      await store.get().refreshDevices()
      expect(store.get().refreshing).toBe(false)
      if (name === 'auth-error') {
        expect(store.get().reauthRequired).toBe(true)
        expect(mocks.storage.clearDeviceCredentials).toHaveBeenCalledOnce()
        expect(store.get().disconnect).toHaveBeenCalledOnce()
      } else {
        expect(store.get().devices).toEqual([{ deviceId: 'valid' }])
        expect(mocks.storage.forgetHost!.mock.calls).toEqual([['one'], ['two']])
        expect(mocks.storage.clearCodexPermissionPresets!.mock.calls).toEqual([['one'], ['two']])
        expect(mocks.storage.clearCodexPermissionPresets!.mock.invocationCallOrder[0]).toBeLessThan(mocks.storage.forgetHost!.mock.invocationCallOrder[1]!)
      }
    } })), prepare)
  })
})

function workspaceFixture() {
  const store = storeFixture()
  let generation = 1
  let backend: object = {}
  const proxy = {
    workspaceCreate: vi.fn(), workspaceRename: vi.fn(), workspaceDelete: vi.fn(), workspaceInsertBefore: vi.fn(),
    workspaceList: vi.fn(async () => ({ items: [], archivedSessionIds: [] })), sessionList: vi.fn(async () => []), hostListDirectory: vi.fn(),
  }
  const runtime = {
    refreshBackends: vi.fn(), requireProxy: () => backend === proxy ? proxy : backend,
    hasCodex: () => false, hasCursor: () => true, hasAntigravity: () => true, hasPi: () => true, hasOpencode: () => true, hasClaude: () => true, hasHermes: () => true,
    requireCodex: () => backend, requireAntigravity: () => backend, requirePi: () => backend, requireOpencode: () => backend, requireClaude: () => backend, requireHermes: () => backend,
  }
  backend = proxy
  const close = vi.fn(async () => undefined)
  store.set({ connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
    selectedDevice: { deviceId: 'host-A' } as AppState['selectedDevice'], workspaces: [workspace('existing')] })
  store.set(createWorkspaceActions({ ...store, connection: runtime as unknown as AndroidRemoteRuntime,
    getConnectionGeneration: () => generation, closeActiveCursorStream: close }))
  return { ...store, proxy, close, switchHost: () => { ++generation }, replaceBackend: () => { backend = {} } }
}
const backendCases = ['harness', 'codex', 'antigravity', 'pi', 'opencode'] as const
function createRequest(fixture: ReturnType<typeof workspaceFixture>, backend: typeof backendCases[number]) {
  return backend === 'harness' ? fixture.proxy.workspaceCreate : backend === 'codex' ? mocks.createCodex
    : backend === 'antigravity' ? mocks.loadAgy : backend === 'pi' ? mocks.loadPi : mocks.loadOpencode
}
function createResponse(backend: typeof backendCases[number], id: string) {
  const value = workspace(id, backend)
  return backend === 'harness' ? { workspace: value } : backend === 'codex' ? value : { workspaces: [value], sessions: [] }
}

describe('workspace operation isolation', () => {
  it('loads only the requested backend and keeps other catalogs and failures isolated', async () => {
    const loaders = { codex: mocks.loadCodex, antigravity: mocks.loadAgy, pi: mocks.loadPi, opencode: mocks.loadOpencode, claude: mocks.loadClaude, hermes: mocks.loadHermes }
    await runScenarios((['harness', 'codex', 'cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes'] as const).flatMap(backend =>
      ['success', 'error'].map(outcome => ({ name: `${backend}/${outcome}`, run: async () => {
        const fixture = workspaceFixture()
        const other = workspace('other', backend === 'codex' ? 'harness' : 'codex')
        fixture.set({ workspaces: [other], error: 'unrelated error' })
        const loader = backend === 'harness' ? fixture.proxy.workspaceList : backend === 'cursor' ? undefined : loaders[backend]
        if (outcome === 'error') loader?.mockRejectedValueOnce(new Error('category unavailable'))
        else loader?.mockResolvedValueOnce(backend === 'harness'
          ? { items: [workspace('loaded')], archivedSessionIds: [] }
          : { workspaces: [workspace('loaded', backend)], sessions: [] })
        await fixture.get().refreshWorkspaces(backend)
        expect(fixture.proxy.workspaceList).toHaveBeenCalledTimes(backend === 'harness' ? 1 : 0)
        for (const [name, load] of Object.entries(loaders)) expect(load).toHaveBeenCalledTimes(backend === name ? 1 : 0)
        expect(fixture.get().workspaces).toContainEqual(other)
        expect(fixture.get().error).toBe('unrelated error')
        expect(fixture.get().workspaceCatalog).toEqual({ backend, loading: false,
          ...(outcome === 'error' && backend !== 'cursor' ? { error: 'category unavailable' } : {}) })
      } }))), prepare)
  })

  it('ignores catalog results and failures after another category opens', async () => {
    await runScenarios(['success', 'error'].map(outcome => ({ name: outcome, run: async () => {
      const fixture = workspaceFixture()
      const old = deferred<any>()
      mocks.loadOpencode.mockReturnValueOnce(old.promise)
      const pending = fixture.get().refreshWorkspaces('opencode')
      await vi.waitFor(() => expect(mocks.loadOpencode).toHaveBeenCalledOnce())
      mocks.loadCodex.mockResolvedValueOnce({ workspaces: [workspace('selected', 'codex')], sessions: [] })
      await fixture.get().refreshWorkspaces('codex')
      const expected = fixture.get()
      if (outcome === 'success') old.resolve({ workspaces: [workspace('retired', 'opencode')], sessions: [] })
      else old.reject(new Error('retired category failure'))
      await pending
      expect(fixture.get()).toEqual(expected)
      expect(fixture.get().workspaceCatalog).toEqual({ backend: 'codex', loading: false })
    } })), prepare)
  })

  it('rejects stale creation success/errors for every asynchronous backend and preserves successor state', async () => {
    await runScenarios(backendCases.flatMap(backend => ['host', 'backend', 'account', 'new-operation', 'busy', 'offline'].flatMap(change => ['success', 'error'].map(outcome => ({
      name: `${backend}/${change}/${outcome}`, run: async () => {
        const fixture = workspaceFixture()
        const response = deferred<any>()
        const request = createRequest(fixture, backend).mockReturnValueOnce(response.promise)
        const pending = fixture.get().workspaceCreate('/old', backend)
        expect(request).toHaveBeenCalledOnce()
        if (change === 'host') fixture.switchHost()
        if (change === 'backend') fixture.replaceBackend()
        if (change === 'account') fixture.set({ config: { baseUrl: 'https://other.invalid' } })
        if (change === 'offline') fixture.set({ connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } } })
        let successor: Promise<unknown> | undefined
        const next = deferred<any>()
        if (change === 'new-operation') {
          request.mockReturnValueOnce(next.promise)
          successor = fixture.get().workspaceCreate('/new', backend)
        } else if (change === 'busy') fixture.set({ busyAction: 'new operation' })
        fixture.set({ workspaces: [workspace('new')], error: 'new error' })
        const expected = fixture.get()
        if (outcome === 'success') response.resolve(createResponse(backend, 'old'))
        else response.reject(new Error('old failure'))
        expect(await pending).toBeUndefined()
        expect(fixture.get()).toEqual(expected)
        if (successor) {
          next.resolve(createResponse(backend, 'new'))
          expect(await successor).toBeDefined()
          expect(fixture.get().busyAction).toBeUndefined()
        }
      },
    })))), prepare)
  })

  it('retains normal creation and current error handling for all backends', async () => {
    await runScenarios(backendCases.flatMap(backend => ['success', 'error'].map(outcome => ({ name: `${backend}/${outcome}`, run: async () => {
      const fixture = workspaceFixture()
      const request = createRequest(fixture, backend)
      if (outcome === 'success') request.mockResolvedValueOnce(createResponse(backend, 'created'))
      else request.mockRejectedValueOnce(new Error('current failure'))
      const result = await fixture.get().workspaceCreate('/created', backend)
      expect(fixture.get().busyAction).toBeUndefined()
      if (outcome === 'success') {
        expect(result).toBeDefined()
        expect(fixture.get().workspaces.some(item => item.workspaceId === 'created')).toBe(true)
      } else {
        expect(result).toBeUndefined()
        expect(fixture.get().error).toBe('current failure')
      }
    } }))), prepare)
  })

  it('ignores retired rename/delete/move/directory and catalog completions, including errors', async () => {
    await runScenarios(['rename', 'delete', 'move', 'directory', 'refresh'].flatMap(operation => ['success', 'error'].map(outcome => ({
      name: `${operation}/${outcome}`, run: async () => {
        const fixture = workspaceFixture()
        const response = deferred<any>()
        const request = operation === 'rename' ? fixture.proxy.workspaceRename : operation === 'delete' ? fixture.proxy.workspaceDelete
          : operation === 'move' ? fixture.proxy.workspaceInsertBefore : operation === 'directory' ? fixture.proxy.hostListDirectory : fixture.proxy.workspaceList
        request.mockReturnValueOnce(response.promise)
        const pending = operation === 'rename' ? fixture.get().workspaceRename('existing', 'new title')
          : operation === 'delete' ? fixture.get().workspaceDelete('existing') : operation === 'move' ? fixture.get().workspaceMove('existing')
            : operation === 'directory' ? fixture.get().hostListDirectory('/') : fixture.get().refreshWorkspaces()
        await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
        fixture.switchHost()
        fixture.set({ workspaces: [workspace('new')], error: 'new error' })
        const expected = fixture.get()
        if (outcome === 'error') response.reject(new Error('old error'))
        else response.resolve(operation === 'rename' ? workspace('existing') : operation === 'move' ? ['existing']
          : operation === 'refresh' ? { items: [workspace('old')], archivedSessionIds: ['old-session'] } : undefined)
        await pending
        expect(fixture.get()).toEqual(expected)
      },
    }))), prepare)
  })
})
