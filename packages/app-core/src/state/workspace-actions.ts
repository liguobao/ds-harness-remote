import * as Haptics from 'expo-haptics'
import { friendlyError } from '../lib/errors'
import { catalogMutationVersion, invalidateCatalogMetadata, mergeBackendPinnedSessionIds } from '../lib/session-backend'
import {
  filterVisibleAcpCatalog,
  isAcpManagedBackend,
  workspaceStableKey,
  type AcpCatalogFilterOptions,
} from '../lib/workspace-key'
import { getVisibleWorkspaceSessions } from '../lib/workspace-sessions'
import { strings as zhCN } from '../locales/i18n'
import { loadAntigravityCatalog, mergeAntigravityCatalog } from '../services/antigravity'
import * as browseMemory from '../services/browse-memory'
import { createNativeRpcId } from '../services/rpc-id'
import { createCodexWorkspace, loadCodexCatalog } from '../services/codex'
import {
  createAcpWorkspace,
  createAntigravityWorkspace,
  createCursorWorkspace,
  createOpencodeWorkspace,
  createClaudeWorkspace,
  createHermesWorkspace,
  createPiWorkspace,
  loadCursorCatalog,
  loadCustomAcpCatalog,
  mergeCursorCatalog,
  mergeCustomAcpCatalog,
} from '../services/cursor'
import { loadOpencodeCatalog, mergeOpencodeCatalog } from '../services/opencode'
import { loadClaudeCatalog, mergeClaudeCatalog } from '../services/claude'
import { loadHermesCatalog, mergeHermesCatalog } from '../services/hermes'
import { loadPiCatalog, mergePiCatalog } from '../services/pi'
import type { AndroidRemoteRuntime } from '../services/remote-runtime'
import { saveFavoriteWorkspaces, saveRecentWorkspaces } from '../services/storage'
import type { RemoteSession, WorkspaceView } from '../types'
import { loadSavedCodexPermissions, withBestCodexPermission } from './codex-session-state'
import type { AppState, StoreAccess } from './store-state'

interface WorkspaceAccess extends StoreAccess {
  connection: AndroidRemoteRuntime
  getConnectionGeneration(): number
  closeActiveCursorStream(notifyRemote?: boolean): Promise<void>
}

export function createWorkspaceActions({ set, get, connection, getConnectionGeneration, closeActiveCursorStream }: WorkspaceAccess): Pick<AppState,
  'refreshWorkspaces' | 'workspaceRename' | 'workspaceDelete' | 'workspaceMove' | 'toggleFavoriteWorkspace' | 'removeFavoriteWorkspace' | 'openFavoriteWorkspaceSession' | 'hostListDirectory' | 'workspaceCreate'> {
  let mutationGeneration = 0
  let refreshGeneration = 0

  function catalogOptions(): AcpCatalogFilterOptions {
    const state = get()
    const scope = browseMemory.browseScope?.(state)
    return {
      deletedKeys: scope ? browseMemory.getDeletedAcpWorkspaceKeys?.(scope) : undefined,
      platform: state.selectedDevice?.platform,
    }
  }

  function persistCatalogNow(): void {
    const state = get()
    if (!state.selectedDevice) return
    try {
      const scope = browseMemory.browseScope?.(state)
      if (!scope) return
      if (browseMemory.saveBrowseCatalog?.(scope, state.workspaces, state.sessions, {
        pinnedSessionIds: state.pinnedSessionIds,
        archivedSessionIds: state.archivedSessionIds,
      })) void Promise.resolve(browseMemory.flushBrowseMemory?.()).catch(() => undefined)
    } catch { /* ignore partial mock environments */ }
  }

  function clearDeletedShortcuts(target: WorkspaceView | undefined): void {
    const device = get().selectedDevice
    if (!target || !device) return
    const stableKey = workspaceStableKey(target, device.platform)
    const matchesTarget = (item: { deviceId: string; key: string; workspaceId: string }) =>
      item.deviceId === device.deviceId && (item.key === stableKey || item.workspaceId === target.workspaceId)
    const nextFavorites = get().favoriteWorkspaces.filter(item => !matchesTarget(item))
    const nextRecent = get().recentWorkspaces.filter(item => !matchesTarget(item))
    const favChanged = nextFavorites.length !== get().favoriteWorkspaces.length
    const recentChanged = nextRecent.length !== get().recentWorkspaces.length
    if (!favChanged && !recentChanged) return
    set({
      ...(favChanged ? { favoriteWorkspaces: nextFavorites } : {}),
      ...(recentChanged ? { recentWorkspaces: nextRecent } : {}),
    })
    if (favChanged) void Promise.resolve(saveFavoriteWorkspaces?.(nextFavorites)).catch(() => undefined)
    if (recentChanged) void Promise.resolve(saveRecentWorkspaces?.(nextRecent)).catch(() => undefined)
  }

  function captureConnection() {
    const generation = getConnectionGeneration()
    const deviceId = get().selectedDevice?.deviceId
    const { config, identity } = get()
    let sameBackend = () => true
    return {
      bind<T>(requireBackend: () => T): T {
        const client = requireBackend()
        const previous = sameBackend
        sameBackend = () => {
          try { return previous() && requireBackend() === client } catch { return false }
        }
        return client
      },
      current: () => generation === getConnectionGeneration()
        && get().config === config && get().identity === identity
        && get().connection.phase === 'connected'
        && get().selectedDevice?.deviceId === deviceId && sameBackend(),
    }
  }

  function beginMutation() {
    const scope = captureConnection()
    const operation = ++mutationGeneration
    const busyAction = get().busyAction
    return {
      bind: scope.bind,
      current: () => scope.current() && operation === mutationGeneration && get().busyAction === busyAction,
    }
  }

  return {
    async refreshWorkspaces(backend = get().workspaceCatalog?.backend ?? 'harness') {
      if (get().connection.phase !== 'connected') return
      const scope = captureConnection()
      const refresh = ++refreshGeneration
      const metadataVersion = catalogMutationVersion(connection, backend)
      const mutation = mutationGeneration
      const busyAction = get().busyAction
      const current = () => scope.current() && refresh === refreshGeneration
        && mutation === mutationGeneration && get().busyAction === busyAction
      set({ workspaceCatalog: { backend, loading: true } })
      try {
        await connection.refreshBackends()
        if (!current()) return
        let catalog: { workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] }
        let archivedSessionIds: string[] | undefined
        let pinnedSessionIds: string[] | undefined
        const filterOpts = catalogOptions()
        switch (backend) {
          case 'harness': {
            const proxy = scope.bind(() => connection.requireProxy())
            const [workspaces, sessions] = await Promise.all([proxy.workspaceList(), proxy.sessionList()])
            catalog = { workspaces: workspaces.items, sessions }
            archivedSessionIds = workspaces.archivedSessionIds
            pinnedSessionIds = workspaces.pinnedSessionIds
            break
          }
          case 'codex': {
            catalog = await loadCodexCatalog(scope.bind(() => connection.requireCodex()))
            const saved = await loadSavedCodexPermissions(get().selectedDevice?.deviceId)
            catalog.sessions = catalog.sessions.map(session => withBestCodexPermission(session,
              get().sessions.find(item => item.sessionId === session.sessionId)
                ?? (get().selectedSession?.sessionId === session.sessionId ? get().selectedSession : undefined), saved))
            break
          }
          case 'antigravity':
            catalog = mergeAntigravityCatalog(
              await loadAntigravityCatalog(scope.bind(() => connection.requireAntigravity()), get().workspaces, undefined, filterOpts),
              get().workspaces,
              get().sessions,
              filterOpts,
            )
            break
          case 'pi':
            catalog = mergePiCatalog(
              await loadPiCatalog(scope.bind(() => connection.requirePi()), get().workspaces, undefined, filterOpts),
              get().workspaces,
              get().sessions,
              filterOpts,
            )
            break
          case 'opencode':
            catalog = mergeOpencodeCatalog(
              await loadOpencodeCatalog(scope.bind(() => connection.requireOpencode()), get().workspaces, undefined, filterOpts),
              get().workspaces,
              get().sessions,
              filterOpts,
            )
            break
          case 'claude':
            catalog = mergeClaudeCatalog(
              await loadClaudeCatalog(scope.bind(() => connection.requireClaude()), get().workspaces, undefined, filterOpts),
              get().workspaces,
              get().sessions,
              filterOpts,
            )
            break
          case 'hermes':
            catalog = mergeHermesCatalog(
              await loadHermesCatalog(scope.bind(() => connection.requireHermes()), get().workspaces, undefined, filterOpts),
              get().workspaces,
              get().sessions,
              filterOpts,
            )
            break
          case 'cursor': {
            const cursorClient = (connection as unknown as { requireCursor?: () => Parameters<typeof loadCursorCatalog>[0] }).requireCursor
            if (typeof cursorClient === 'function') {
              catalog = mergeCursorCatalog(
                await loadCursorCatalog(scope.bind(() => cursorClient()), get().workspaces, undefined, filterOpts),
                get().workspaces,
                get().sessions,
                filterOpts,
              )
            } else {
              catalog = filterVisibleAcpCatalog(
                'cursor',
                get().workspaces.filter(item => item.backend === 'cursor'),
                get().sessions.filter(item => item.backend === 'cursor'),
                filterOpts.deletedKeys,
                filterOpts.platform,
              )
            }
            break
          }
          default: {
            if (isAcpManagedBackend(backend)) {
              const requireCustom = () => connection.requireAcpBackend(backend)
              catalog = mergeCustomAcpCatalog(
                backend,
                await loadCustomAcpCatalog(backend, scope.bind(requireCustom), get().workspaces, undefined, filterOpts),
                get().workspaces,
                get().sessions,
                filterOpts,
              )
            } else {
              catalog = { workspaces: [], sessions: [] }
            }
            break
          }
        }
        if (!current()) return
        if (metadataVersion !== catalogMutationVersion(connection, backend)) {
          set({ workspaceCatalog: { backend, loading: false } })
          return
        }
        set(state => {
          const nextArchived = archivedSessionIds ?? state.archivedSessionIds ?? []
          const archivedSet = new Set(nextArchived)
          const currentPinned = state.pinnedSessionIds ?? []
          const rawBackendPinned = backend === 'harness' ? pinnedSessionIds : catalog.pinnedSessionIds
          const nextPinnedSessionIds = rawBackendPinned !== undefined
            ? mergeBackendPinnedSessionIds(currentPinned, backend, rawBackendPinned)
                .filter(id => !archivedSet.has(id))
            : archivedSessionIds !== undefined
              ? currentPinned.filter(id => !archivedSet.has(id))
              : undefined
          return {
            hostWorkspaceGit: connection.hasWorkspaceGit?.() ?? false,
            codexAvailable: connection.hasCodex(),
            cursorAvailable: connection.hasCursor(),
            antigravityAvailable: connection.hasAntigravity(),
            piAvailable: connection.hasPi(),
            opencodeAvailable: connection.hasOpencode(),
            claudeAvailable: connection.hasClaude(),
            hermesAvailable: connection.hasHermes(),
            customAcpBackends: connection.customAcpBackends?.() ?? [],
            workspaces: [...state.workspaces.filter(item => (item.backend ?? 'harness') !== backend), ...catalog.workspaces],
            sessions: [...state.sessions.filter(item => (item.backend ?? 'harness') !== backend), ...catalog.sessions],
            ...(archivedSessionIds === undefined ? {} : { archivedSessionIds }),
            ...(nextPinnedSessionIds === undefined ? {} : { pinnedSessionIds: nextPinnedSessionIds }),
            selectedSession: catalog.sessions.find(item => item.sessionId === state.selectedSession?.sessionId) ?? state.selectedSession,
            workspaceCatalog: { backend, loading: false },
          }
        })
        persistCatalogNow()
      } catch (error) {
        if (!current()) return
        // A category failure stays with that category, including late tab switches.
        set({ workspaceCatalog: { backend, loading: false, error: friendlyError(error) } })
      } finally {
        if (scope.current() && refresh === refreshGeneration && get().workspaceCatalog?.loading) {
          set({ workspaceCatalog: { backend, loading: false } })
        }
      }
    },

    async workspaceRename(workspaceId, title) {
      if (get().connection.phase !== 'connected') return false
      set({ busyAction: `rename-workspace:${workspaceId}`, error: undefined })
      const scope = beginMutation()
      try {
        const target = get().workspaces.find(item => item.workspaceId === workspaceId)
        if (target?.backend === 'codex') {
          throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
        }
        if (target !== undefined && isAcpManagedBackend(target.backend)) {
          const nextTitle = title.trim()
          if (nextTitle.length === 0) throw new Error(zhCN.workspaces.namePlaceholder)
          const acpClient = acpClientFor(connection, target.backend)
          await ignoreMethodNotFound(() => acpClient?.renameWorkspace?.(target.path, target.backend!, nextTitle))
          if (!scope.current()) return false
          set(state => ({
            workspaces: state.workspaces.map(item => item.workspaceId === workspaceId
              ? { ...item, title: nextTitle, updatedAt: new Date().toISOString() }
              : item),
            busyAction: undefined,
          }))
          persistCatalogNow()
          return true
        }
        const proxy = scope.bind(() => connection.requireProxy())
        const workspace = await proxy.workspaceRename(workspaceId, title)
        if (!scope.current()) return false
        set(state => ({
          workspaces: state.workspaces.map(item => item.workspaceId === workspaceId ? workspace : item),
          busyAction: undefined,
        }))
        return true
      } catch (error) {
        if (!scope.current()) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async workspaceDelete(workspaceId) {
      if (get().connection.phase !== 'connected') return false
      set({ busyAction: `delete-workspace:${workspaceId}`, error: undefined })
      const scope = beginMutation()
      try {
        const target = get().workspaces.find(item => item.workspaceId === workspaceId)
        if (target?.backend === 'codex') {
          throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
        }
        if (target !== undefined && isAcpManagedBackend(target.backend)) {
          const targetBackend = target.backend
          const targetPath = target.path
          const acpClient = acpClientFor(connection, targetBackend)
          await ignoreMethodNotFound(() => acpClient?.deleteWorkspace?.(targetPath, targetBackend))
          if (!scope.current()) return false
          const sessionIds = new Set(target.sessionIds)
          const selected = get().selectedSession
          if (selected !== undefined && sessionIds.has(selected.sessionId)) {
            await closeActiveCursorStream()
            if (!scope.current()) return false
          }
          const currentState = get()
          const memScope = browseMemory.browseScope?.(currentState)
          if (memScope) {
            browseMemory.markDeletedAcpWorkspace?.(memScope, targetBackend, targetPath, currentState.selectedDevice?.platform)
          }
          invalidateCatalogMetadata(connection, targetBackend)
          set(state => ({
            workspaces: state.workspaces.filter(item => item.workspaceId !== workspaceId),
            sessions: state.sessions.filter(session => !sessionIds.has(session.sessionId)),
            pinnedSessionIds: (state.pinnedSessionIds ?? []).filter(id => !sessionIds.has(id)),
            messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => !sessionIds.has(id))),
            selectedSession: state.selectedSession !== undefined && sessionIds.has(state.selectedSession.sessionId)
              ? undefined
              : state.selectedSession,
            sessionModels: state.selectedSession !== undefined && sessionIds.has(state.selectedSession.sessionId)
              ? undefined
              : state.sessionModels,
            busyAction: undefined,
          }))
          clearDeletedShortcuts(target)
          persistCatalogNow()
          return true
        }
        const proxy = scope.bind(() => connection.requireProxy())
        await proxy.workspaceDelete(workspaceId)
        if (!scope.current()) return false
        const sessionIds = new Set(target?.sessionIds ?? [])
        invalidateCatalogMetadata(connection, 'harness')
        set(state => ({
          workspaces: state.workspaces.filter(item => item.workspaceId !== workspaceId),
          sessions: state.sessions.filter(session => !sessionIds.has(session.sessionId)),
          pinnedSessionIds: (state.pinnedSessionIds ?? []).filter(id => !sessionIds.has(id)),
          busyAction: undefined,
        }))
        clearDeletedShortcuts(target)
        persistCatalogNow()
        return true
      } catch (error) {
        if (!scope.current()) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async workspaceMove(workspaceId, beforeWorkspaceId) {
      if (get().connection.phase !== 'connected') return false
      set({ busyAction: `move-workspace:${workspaceId}`, error: undefined })
      const scope = beginMutation()
      try {
        const target = get().workspaces.find(item => item.workspaceId === workspaceId)
        const before = beforeWorkspaceId === undefined
          ? undefined
          : get().workspaces.find(item => item.workspaceId === beforeWorkspaceId)
        if (target?.backend === 'codex' || before?.backend === 'codex') {
          throw new Error(zhCN.runtime.codexWorkspaceReadOnly)
        }
        if (isAcpManagedBackend(target?.backend) || isAcpManagedBackend(before?.backend)) {
          const reorderBackend = isAcpManagedBackend(target?.backend) ? target.backend : before?.backend
          let reorderedItems: WorkspaceView[] = []
          set(state => {
            const items = state.workspaces.slice()
            const from = items.findIndex(item => item.workspaceId === workspaceId)
            if (from < 0) return { busyAction: undefined }
            const [workspace] = items.splice(from, 1)
            if (workspace === undefined) return { busyAction: undefined }
            const to = beforeWorkspaceId === undefined
              ? items.length
              : items.findIndex(item => item.workspaceId === beforeWorkspaceId)
            items.splice(to < 0 ? items.length : to, 0, workspace)
            reorderedItems = items
            return { workspaces: items, busyAction: undefined }
          })
          if (reorderBackend !== undefined && isAcpManagedBackend(reorderBackend)) {
            const acpClient = acpClientFor(connection, reorderBackend)
            const paths = reorderedItems.filter(w => w.backend === reorderBackend).map(w => w.path)
            if (paths.length > 0) {
              await ignoreMethodNotFound(() => acpClient?.reorderWorkspaces?.(reorderBackend, paths))
            }
          }
          persistCatalogNow()
          return true
        }
        const proxy = scope.bind(() => connection.requireProxy())
        const workspaceIds = await proxy.workspaceInsertBefore(workspaceId, beforeWorkspaceId)
        if (!scope.current()) return false
        const byId = new Map(get().workspaces.map(item => [item.workspaceId, item]))
        set({
          workspaces: [
            ...workspaceIds.flatMap(id => byId.get(id) === undefined ? [] : [byId.get(id)!]),
            ...get().workspaces.filter(item => item.backend === 'codex' || isAcpManagedBackend(item.backend)),
          ],
          busyAction: undefined,
        })
        return true
      } catch (error) {
        if (!scope.current()) return false
        set({ busyAction: undefined, error: friendlyError(error) })
        return false
      }
    },

    async toggleFavoriteWorkspace(workspace) {
      const device = get().selectedDevice
      if (device === undefined) return false
      const key = workspaceStableKey(workspace, device.platform)
      const current = get().favoriteWorkspaces
      const existing = current.some(item => item.deviceId === device.deviceId && item.key === key)
      const next = existing
        ? current.filter(item => !(item.deviceId === device.deviceId && item.key === key))
        : [...current, {
          deviceId: device.deviceId,
          deviceName: device.name,
          key,
          workspaceId: workspace.workspaceId,
          backend: workspace.backend ?? 'harness',
          title: workspace.title,
          path: workspace.path,
          addedAt: Date.now(),
        }]
      try {
        await saveFavoriteWorkspaces(next)
      } catch (error) {
        set({ error: friendlyError(error) })
        return existing
      }
      set({ favoriteWorkspaces: next })
      await Haptics.notificationAsync(existing
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success)
      return !existing
    },

    async removeFavoriteWorkspace(deviceId, key) {
      const current = get().favoriteWorkspaces
      const next = current.filter(item => !(item.deviceId === deviceId && item.key === key))
      if (next.length === current.length) return false
      try {
        await saveFavoriteWorkspaces(next)
      } catch (error) {
        set({ error: friendlyError(error) })
        return false
      }
      set({ favoriteWorkspaces: next })
      return true
    },

    async openFavoriteWorkspaceSession(key) {
      let state = get()
      if (state.connection.phase !== 'connected') return undefined
      const scope = captureConnection()
      const shortcut = [...state.favoriteWorkspaces, ...state.recentWorkspaces]
        .find(item => item.deviceId === state.selectedDevice?.deviceId && item.key === key)
      const remembered = state.workspaces.find(item => workspaceStableKey(item, state.selectedDevice?.platform) === key)
      const backend = shortcut?.backend ?? remembered?.backend ?? 'harness'
      await state.refreshWorkspaces(backend)
      state = get()
      if (!scope.current() || state.workspaceCatalog?.backend !== backend || state.workspaceCatalog.error) return undefined
      const workspace = state.workspaces.find(item => workspaceStableKey(item, state.selectedDevice?.platform) === key)
      if (workspace === undefined) return undefined
      const session = latestWorkspaceSession(state.sessions, workspace, state.archivedSessionIds)
      if (session === undefined) return undefined
      return await state.openSession(session) ? session : undefined
    },

    async hostListDirectory(path) {
      if (get().connection.phase !== 'connected') return undefined
      const scope = captureConnection()
      try {
        const result = await scope.bind(() => connection.requireProxy()).hostListDirectory(path)
        return scope.current() ? result : undefined
      } catch (error) {
        if (!scope.current()) return undefined
        set({ error: friendlyError(error) })
        return undefined
      }
    },

    async workspaceCreate(path, backend = 'harness') {
      if (get().connection.phase !== 'connected') return undefined
      set({
        busyAction: backend === 'codex'
          ? 'create-codex-workspace'
          : backend === 'cursor'
            ? 'create-cursor-workspace'
            : backend === 'pi' ? 'create-pi-workspace'
              : backend === 'antigravity'
                ? 'create-antigravity-workspace'
                : backend === 'opencode'
                  ? 'create-opencode-workspace'
                  : backend === 'claude'
                    ? 'create-claude-workspace'
                    : backend === 'hermes' ? 'create-hermes-workspace' : 'create-workspace',
        error: undefined,
      })
      const scope = beginMutation()
      try {
        if (backend === 'codex') {
          const workspace = await createCodexWorkspace(scope.bind(() => connection.requireCodex()), path, createNativeRpcId())
          if (!scope.current()) return undefined
          set(state => ({
            workspaces: [...state.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace],
            busyAction: undefined,
          }))
          return workspace
        }
        if (backend === 'cursor') {
          if (!connection.hasCursor()) throw new Error(zhCN.runtime.cursorUnavailable)
          const memScope = browseMemory.browseScope?.(get())
          const platform = get().selectedDevice?.platform
          if (memScope) browseMemory.unmarkDeletedAcpWorkspace?.(memScope, 'cursor', path, platform)
          const workspace = createCursorWorkspace(path)
          set(state => ({
            workspaces: [...state.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace],
            busyAction: undefined,
          }))
          persistCatalogNow()
          return workspace
        }
        const directoryBackends = {
          antigravity: {
            has: () => connection.hasAntigravity(),
            require: () => connection.requireAntigravity(),
            unavailable: zhCN.runtime.antigravityUnavailable,
            create: createAntigravityWorkspace,
            load: loadAntigravityCatalog,
            merge: mergeAntigravityCatalog,
          },
          pi: {
            has: () => connection.hasPi(),
            require: () => connection.requirePi(),
            unavailable: zhCN.runtime.piUnavailable,
            create: createPiWorkspace,
            load: loadPiCatalog,
            merge: mergePiCatalog,
          },
          opencode: {
            has: () => connection.hasOpencode(),
            require: () => connection.requireOpencode(),
            unavailable: zhCN.runtime.opencodeUnavailable,
            create: createOpencodeWorkspace,
            load: loadOpencodeCatalog,
            merge: mergeOpencodeCatalog,
          },
          claude: {
            has: () => connection.hasClaude(),
            require: () => connection.requireClaude(),
            unavailable: zhCN.runtime.claudeUnavailable,
            create: createClaudeWorkspace,
            load: loadClaudeCatalog,
            merge: mergeClaudeCatalog,
          },
          hermes: {
            has: () => connection.hasHermes(),
            require: () => connection.requireHermes(),
            unavailable: zhCN.runtime.hermesUnavailable,
            create: createHermesWorkspace,
            load: loadHermesCatalog,
            merge: mergeHermesCatalog,
          },
        } as const
        if (isAcpManagedBackend(backend)) {
          const entry = (directoryBackends as Record<string, {
            has: () => boolean
            require: () => Parameters<typeof loadPiCatalog>[0]
            unavailable: string
            create: (p: string, title?: string) => WorkspaceView
            load: typeof loadPiCatalog
            merge: typeof mergePiCatalog
          }>)[backend] ?? {
            has: () => connection.hasAcpBackend?.(backend) ?? (backend === 'cursor' && connection.hasCursor()),
            require: () => backend === 'cursor' ? connection.requireCursor() : connection.requireAcpBackend(backend),
            unavailable: zhCN.runtime.cursorUnavailable,
            create: (p: string, title?: string) => backend === 'cursor' ? createCursorWorkspace(p, title) : createAcpWorkspace(backend, p, title),
            load: (client: Parameters<typeof loadPiCatalog>[0], remembered: WorkspaceView[], warmPath?: string, opts?: AcpCatalogFilterOptions) =>
              backend === 'cursor' ? loadCursorCatalog(client, remembered, warmPath, opts) : loadCustomAcpCatalog(backend, client, remembered, warmPath, opts),
            merge: (cat: { workspaces: WorkspaceView[]; sessions: RemoteSession[] }, ws: WorkspaceView[], ss: RemoteSession[], opts?: AcpCatalogFilterOptions) =>
              backend === 'cursor' ? mergeCursorCatalog(cat, ws, ss, opts) : mergeCustomAcpCatalog(backend, cat, ws, ss, opts),
          }
          if (!entry.has()) throw new Error(entry.unavailable)
          const memScope = browseMemory.browseScope?.(get())
          const platform = get().selectedDevice?.platform
          const wasDeleted = memScope
            ? browseMemory.isDeletedAcpWorkspace?.(browseMemory.getDeletedAcpWorkspaceKeys?.(memScope), backend, path, platform) ?? false
            : false
          if (memScope) browseMemory.unmarkDeletedAcpWorkspace?.(memScope, backend, path, platform)
          const workspace = entry.create(path)
          try {
            const client = entry.require() as Parameters<typeof loadPiCatalog>[0] & { createWorkspace?: (p: string, b: string, t?: string) => Promise<unknown> }
            if (typeof client.createWorkspace === 'function') {
              await ignoreMethodNotFound(() => client.createWorkspace!(path, backend, workspace.title))
            }
            if (backend === 'cursor' && typeof (client as { createWorkspace?: unknown }).createWorkspace !== 'function') {
              // Preserve local Cursor workspace creation when older Host lacks persistence RPC.
              const catalog = await entry.load(scope.bind(entry.require), [...get().workspaces, workspace], path, catalogOptions()).catch(() => ({ workspaces: [workspace], sessions: [] }))
              if (!scope.current()) return undefined
              let created = workspace
              set(state => {
                const merged = entry.merge(catalog, state.workspaces, state.sessions, catalogOptions())
                created = merged.workspaces.find(item => item.workspaceId === workspace.workspaceId) ?? workspace
                return {
                  workspaces: [...state.workspaces.filter(item => item.backend !== backend), ...merged.workspaces],
                  sessions: [...state.sessions.filter(item => item.backend !== backend), ...merged.sessions],
                  busyAction: undefined,
                }
              })
              persistCatalogNow()
              return created
            }
            const catalog = await entry.load(scope.bind(entry.require), [...get().workspaces, workspace], path, catalogOptions())
            if (!scope.current()) {
              if (wasDeleted && memScope) browseMemory.markDeletedAcpWorkspace?.(memScope, backend, path, platform)
              return undefined
            }
            let created = workspace
            set(state => {
              const merged = entry.merge(catalog, state.workspaces, state.sessions, catalogOptions())
              created = merged.workspaces.find(item => item.workspaceId === workspace.workspaceId) ?? workspace
              return {
                workspaces: [...state.workspaces.filter(item => item.backend !== backend), ...merged.workspaces],
                sessions: [...state.sessions.filter(item => item.backend !== backend), ...merged.sessions],
                busyAction: undefined,
              }
            })
            if (memScope && created.path !== path) {
              browseMemory.unmarkDeletedAcpWorkspace?.(memScope, backend, created.path, platform)
            }
            persistCatalogNow()
            return created
          } catch (error) {
            if (wasDeleted && memScope) browseMemory.markDeletedAcpWorkspace?.(memScope, backend, path, platform)
            throw error
          }
        }
        const proxy = scope.bind(() => connection.requireProxy())
        const { workspace } = await proxy.workspaceCreate(path)
        if (!scope.current()) return undefined
        set(state => ({
          workspaces: [...state.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace],
          busyAction: undefined,
        }))
        return workspace
      } catch (error) {
        if (!scope.current()) return undefined
        set({ busyAction: undefined, error: friendlyError(error) })
        return undefined
      }
    },
  }
}

/** Best-effort Host ACP client resolver for optional persistence RPCs. */
function acpClientFor(connection: AndroidRemoteRuntime, backend?: string) {
  if (!backend) return undefined
  try {
    if (backend === 'cursor') return (connection as unknown as { requireCursor?: () => ReturnType<AndroidRemoteRuntime['requireCursor']> }).requireCursor?.()
    if (backend === 'antigravity') return (connection as unknown as { requireAntigravity?: () => ReturnType<AndroidRemoteRuntime['requireAntigravity']> }).requireAntigravity?.()
    if (backend === 'pi') return (connection as unknown as { requirePi?: () => ReturnType<AndroidRemoteRuntime['requirePi']> }).requirePi?.()
    if (backend === 'opencode') return (connection as unknown as { requireOpencode?: () => ReturnType<AndroidRemoteRuntime['requireOpencode']> }).requireOpencode?.()
    if (backend === 'claude') return (connection as unknown as { requireClaude?: () => ReturnType<AndroidRemoteRuntime['requireClaude']> }).requireClaude?.()
    if (backend === 'hermes') return (connection as unknown as { requireHermes?: () => ReturnType<AndroidRemoteRuntime['requireHermes']> }).requireHermes?.()
    return (connection as unknown as { requireAcpBackend?: (b: string) => ReturnType<AndroidRemoteRuntime['requireCursor']> }).requireAcpBackend?.(backend)
  } catch {
    return undefined
  }
}

async function ignoreMethodNotFound<T>(fn: () => Promise<T> | undefined): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
    if (code === 'METHOD_NOT_FOUND' || code === 'method-not-found') return undefined
    throw error
  }
}

/** Most recently updated conversation inside a workspace; undefined when it has none yet. */
function latestWorkspaceSession(sessions: RemoteSession[], workspace: WorkspaceView, archivedSessionIds: string[]): RemoteSession | undefined {
  let latest: RemoteSession | undefined
  for (const session of getVisibleWorkspaceSessions(workspace, sessions, archivedSessionIds)) {
    if (latest === undefined || session.updatedAt > latest.updatedAt) latest = session
  }
  return latest
}
