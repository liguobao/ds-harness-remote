import * as Haptics from 'expo-haptics'
import { friendlyError } from '../lib/errors'
import { workspaceStableKey } from '../lib/workspace-key'
import { getVisibleWorkspaceSessions } from '../lib/workspace-sessions'
import { strings as zhCN } from '../locales/i18n'
import { loadAntigravityCatalog, mergeAntigravityCatalog } from '../services/antigravity'
import { createNativeRpcId } from '../services/rpc-id'
import { createCodexWorkspace, loadCodexCatalog } from '../services/codex'
import {
  createAntigravityWorkspace,
  createCursorWorkspace,
  createOpencodeWorkspace,
  createClaudeWorkspace,
  createHermesWorkspace,
  createPiWorkspace,
} from '../services/cursor'
import { loadOpencodeCatalog, mergeOpencodeCatalog } from '../services/opencode'
import { loadClaudeCatalog, mergeClaudeCatalog } from '../services/claude'
import { loadHermesCatalog, mergeHermesCatalog } from '../services/hermes'
import { loadPiCatalog, mergePiCatalog } from '../services/pi'
import type { AndroidRemoteRuntime } from '../services/remote-runtime'
import { saveFavoriteWorkspaces } from '../services/storage'
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
      const mutation = mutationGeneration
      const busyAction = get().busyAction
      const current = () => scope.current() && refresh === refreshGeneration
        && mutation === mutationGeneration && get().busyAction === busyAction
      set({ workspaceCatalog: { backend, loading: true } })
      try {
        await connection.refreshBackends()
        if (!current()) return
        let catalog: { workspaces: WorkspaceView[]; sessions: RemoteSession[] }
        let archivedSessionIds: string[] | undefined
        let pinnedSessionIds: string[] | undefined
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
            catalog = mergeAntigravityCatalog(await loadAntigravityCatalog(scope.bind(() => connection.requireAntigravity()), get().workspaces), get().workspaces, get().sessions)
            break
          case 'pi':
            catalog = mergePiCatalog(await loadPiCatalog(scope.bind(() => connection.requirePi()), get().workspaces), get().workspaces, get().sessions)
            break
          case 'opencode':
            catalog = mergeOpencodeCatalog(await loadOpencodeCatalog(scope.bind(() => connection.requireOpencode()), get().workspaces), get().workspaces, get().sessions)
            break
          case 'claude':
            catalog = mergeClaudeCatalog(await loadClaudeCatalog(scope.bind(() => connection.requireClaude()), get().workspaces), get().workspaces, get().sessions)
            break
          case 'cursor':
            catalog = { workspaces: get().workspaces.filter(item => item.backend === 'cursor'), sessions: get().sessions.filter(item => item.backend === 'cursor') }
            break
        }
        if (!current()) return
        set(state => ({
          codexAvailable: connection.hasCodex(),
          cursorAvailable: connection.hasCursor(),
          antigravityAvailable: connection.hasAntigravity(),
          piAvailable: connection.hasPi(),
          opencodeAvailable: connection.hasOpencode(),
          claudeAvailable: connection.hasClaude(),
          workspaces: [...state.workspaces.filter(item => (item.backend ?? 'harness') !== backend), ...catalog.workspaces],
          sessions: [...state.sessions.filter(item => (item.backend ?? 'harness') !== backend), ...catalog.sessions],
          ...(archivedSessionIds === undefined ? {} : { archivedSessionIds }),
          ...(pinnedSessionIds === undefined ? {} : { pinnedSessionIds }),
          selectedSession: catalog.sessions.find(item => item.sessionId === state.selectedSession?.sessionId) ?? state.selectedSession,
          workspaceCatalog: { backend, loading: false },
        }))
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
        if (target?.backend === 'cursor' || target?.backend === 'antigravity' || target?.backend === 'pi' || target?.backend === 'opencode' || target?.backend === 'claude' || target?.backend === 'hermes') {
          const nextTitle = title.trim()
          if (nextTitle.length === 0) throw new Error(zhCN.workspaces.namePlaceholder)
          set(state => ({
            workspaces: state.workspaces.map(item => item.workspaceId === workspaceId
              ? { ...item, title: nextTitle, updatedAt: new Date().toISOString() }
              : item),
            busyAction: undefined,
          }))
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
        if (target?.backend === 'cursor' || target?.backend === 'antigravity' || target?.backend === 'pi' || target?.backend === 'opencode' || target?.backend === 'claude' || target?.backend === 'hermes') {
          const sessionIds = new Set(target.sessionIds)
          const selected = get().selectedSession
          if (selected !== undefined && sessionIds.has(selected.sessionId)) {
            await closeActiveCursorStream()
            if (!scope.current()) return false
          }
          set(state => ({
            workspaces: state.workspaces.filter(item => item.workspaceId !== workspaceId),
            sessions: state.sessions.filter(session => !sessionIds.has(session.sessionId)),
            messages: Object.fromEntries(Object.entries(state.messages).filter(([id]) => !sessionIds.has(id))),
            selectedSession: state.selectedSession !== undefined && sessionIds.has(state.selectedSession.sessionId)
              ? undefined
              : state.selectedSession,
            sessionModels: state.selectedSession !== undefined && sessionIds.has(state.selectedSession.sessionId)
              ? undefined
              : state.sessionModels,
            busyAction: undefined,
          }))
          return true
        }
        const proxy = scope.bind(() => connection.requireProxy())
        await proxy.workspaceDelete(workspaceId)
        if (!scope.current()) return false
        set(state => ({
          workspaces: state.workspaces.filter(item => item.workspaceId !== workspaceId),
          sessions: state.sessions.filter(session => {
            const workspace = state.workspaces.find(item => item.workspaceId === workspaceId)
            return workspace === undefined || !workspace.sessionIds.includes(session.sessionId)
          }),
          busyAction: undefined,
        }))
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
        if (target?.backend === 'cursor' || target?.backend === 'antigravity' || target?.backend === 'pi' || target?.backend === 'opencode' || target?.backend === 'claude' || target?.backend === 'hermes' || before?.backend === 'cursor' || before?.backend === 'antigravity' || before?.backend === 'pi' || before?.backend === 'opencode' || before?.backend === 'claude' || before?.backend === 'hermes') {
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
            return { workspaces: items, busyAction: undefined }
          })
          return true
        }
        const proxy = scope.bind(() => connection.requireProxy())
        const workspaceIds = await proxy.workspaceInsertBefore(workspaceId, beforeWorkspaceId)
        if (!scope.current()) return false
        const byId = new Map(get().workspaces.map(item => [item.workspaceId, item]))
        set({
          workspaces: [
            ...workspaceIds.flatMap(id => byId.get(id) === undefined ? [] : [byId.get(id)!]),
            ...get().workspaces.filter(item => item.backend === 'codex' || item.backend === 'cursor' || item.backend === 'antigravity' || item.backend === 'pi' || item.backend === 'opencode' || item.backend === 'claude' || item.backend === 'hermes'),
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
          const workspace = createCursorWorkspace(path)
          set(state => ({
            workspaces: [...state.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace],
            busyAction: undefined,
          }))
          return workspace
        }
        if (backend === 'antigravity') {
          if (!connection.hasAntigravity()) throw new Error(zhCN.runtime.antigravityUnavailable)
          const workspace = createAntigravityWorkspace(path)
          const catalog = await loadAntigravityCatalog(scope.bind(() => connection.requireAntigravity()), [...get().workspaces, workspace], path)
          if (!scope.current()) return undefined
          let created = workspace
          set(state => {
            const merged = mergeAntigravityCatalog(catalog, state.workspaces, state.sessions)
            created = merged.workspaces.find(item => item.workspaceId === workspace.workspaceId) ?? workspace
            return {
              workspaces: [...state.workspaces.filter(item => item.backend !== 'antigravity'), ...merged.workspaces],
              sessions: [...state.sessions.filter(item => item.backend !== 'antigravity'), ...merged.sessions],
              busyAction: undefined,
            }
          })
          return created
        }
        if (backend === 'pi') {
          if (!connection.hasPi()) throw new Error(zhCN.runtime.piUnavailable)
          const workspace = createPiWorkspace(path)
          const catalog = await loadPiCatalog(scope.bind(() => connection.requirePi()), [...get().workspaces, workspace], path)
          if (!scope.current()) return undefined
          let created = workspace
          set(state => {
            const merged = mergePiCatalog(catalog, state.workspaces, state.sessions)
            created = merged.workspaces.find(item => item.workspaceId === workspace.workspaceId) ?? workspace
            return {
              workspaces: [...state.workspaces.filter(item => item.backend !== 'pi'), ...merged.workspaces],
              sessions: [...state.sessions.filter(item => item.backend !== 'pi'), ...merged.sessions],
              busyAction: undefined,
            }
          })
          return created
        }
        if (backend === 'opencode') {
          if (!connection.hasOpencode()) throw new Error(zhCN.runtime.opencodeUnavailable)
          const workspace = createOpencodeWorkspace(path)
          const catalog = await loadOpencodeCatalog(scope.bind(() => connection.requireOpencode()), [...get().workspaces, workspace], path)
          if (!scope.current()) return undefined
          let created = workspace
          set(state => {
            const merged = mergeOpencodeCatalog(catalog, state.workspaces, state.sessions)
            created = merged.workspaces.find(item => item.workspaceId === workspace.workspaceId) ?? workspace
            return {
              workspaces: [...state.workspaces.filter(item => item.backend !== 'opencode'), ...merged.workspaces],
              sessions: [...state.sessions.filter(item => item.backend !== 'opencode'), ...merged.sessions],
              busyAction: undefined,
            }
          })
          return created
        }
        if (backend === 'claude') {
          if (!connection.hasClaude()) throw new Error(zhCN.runtime.claudeUnavailable)
          const workspace = createClaudeWorkspace(path)
          const catalog = await loadClaudeCatalog(scope.bind(() => connection.requireClaude()), [...get().workspaces, workspace], path)
          if (!scope.current()) return undefined
          let created = workspace
          set(state => {
            const merged = mergeClaudeCatalog(catalog, state.workspaces, state.sessions)
            created = merged.workspaces.find(item => item.workspaceId === workspace.workspaceId) ?? workspace
            return {
              workspaces: [...state.workspaces.filter(item => item.backend !== 'claude'), ...merged.workspaces],
              sessions: [...state.sessions.filter(item => item.backend !== 'claude'), ...merged.sessions],
              busyAction: undefined,
            }
          })
          return created
        }
        if (backend === 'hermes') {
          if (!connection.hasHermes()) throw new Error(zhCN.runtime.hermesUnavailable)
          const workspace = createHermesWorkspace(path)
          const catalog = await loadHermesCatalog(scope.bind(() => connection.requireHermes()), [...get().workspaces, workspace], path)
          if (!scope.current()) return undefined
          let created = workspace
          set(state => {
            const merged = mergeHermesCatalog(catalog, state.workspaces, state.sessions)
            created = merged.workspaces.find(item => item.workspaceId === workspace.workspaceId) ?? workspace
            return {
              workspaces: [...state.workspaces.filter(item => item.backend !== 'hermes'), ...merged.workspaces],
              sessions: [...state.sessions.filter(item => item.backend !== 'hermes'), ...merged.sessions],
              busyAction: undefined,
            }
          })
          return created
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

/** Most recently updated conversation inside a workspace; undefined when it has none yet. */
function latestWorkspaceSession(sessions: RemoteSession[], workspace: WorkspaceView, archivedSessionIds: string[]): RemoteSession | undefined {
  let latest: RemoteSession | undefined
  for (const session of getVisibleWorkspaceSessions(workspace, sessions, archivedSessionIds)) {
    if (latest === undefined || session.updatedAt > latest.updatedAt) latest = session
  }
  return latest
}
