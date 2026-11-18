import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type AcpPermissionPreset = 'workspace-write' | 'danger-full-access'

export interface PersistedAcpWorkspaceEntry {
  path: string
  title?: string
  updatedAt: string
}

interface PersistedBackendState {
  workspaces: PersistedAcpWorkspaceEntry[]
  deletedPaths: string[]
  pinnedSessionIds: string[]
}

interface PersistedAcpStoreShape {
  version: 1
  backends: Record<string, PersistedBackendState>
  sessionPermissions: Record<string, AcpPermissionPreset>
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function emptyBackends(): Record<string, PersistedBackendState> {
  return Object.create(null) as Record<string, PersistedBackendState>
}

function emptyPermissions(): Record<string, AcpPermissionPreset> {
  return Object.create(null) as Record<string, AcpPermissionPreset>
}

function createEmptyStore(): PersistedAcpStoreShape {
  return {
    version: 1,
    backends: emptyBackends(),
    sessionPermissions: emptyPermissions(),
  }
}

/**
 * Lightweight Host-side persistence for ACP workspace lists, order, renames,
 * delete tombstones, pinned sessions, and session permission presets.
 * Never touches DSH SessionStore or Workspace database.
 */
export class AcpWorkspaceStore {
  private data: PersistedAcpStoreShape = createEmptyStore()
  private loaded = false
  private loadPromise?: Promise<void>
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath?: string) {}

  static inDirectory(directory?: string): AcpWorkspaceStore {
    return typeof directory === 'string' && directory.length > 0
      ? new AcpWorkspaceStore(join(directory, 'acp-state.json'))
      : new AcpWorkspaceStore()
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loadPromise ??= this.loadOnce().finally(() => { this.loadPromise = undefined })
    return this.loadPromise
  }

  private async loadOnce(): Promise<void> {
    if (this.filePath === undefined) {
      this.loaded = true
      return
    }
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      this.data = normalizeStore(parsed)
    } catch {
      this.data = createEmptyStore()
    }
    this.loaded = true
  }

  private getBackend(backend: string): PersistedBackendState | undefined {
    if (PROTOTYPE_KEYS.has(backend) || !Object.hasOwn(this.data.backends, backend)) return undefined
    return this.data.backends[backend]
  }

  private ensureBackend(backend: string): PersistedBackendState {
    if (PROTOTYPE_KEYS.has(backend)) {
      throw new Error(`Reserved ACP backend key: ${backend}`)
    }
    let entry = Object.hasOwn(this.data.backends, backend) ? this.data.backends[backend] : undefined
    if (entry === undefined) {
      entry = { workspaces: [], deletedPaths: [], pinnedSessionIds: [] }
      this.data.backends[backend] = entry
    }
    return entry
  }

  private async persist(): Promise<void> {
    if (this.filePath === undefined) return
    const filePath = this.filePath
    const snapshot = JSON.stringify(this.data, null, 2)
    const next = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(filePath), { recursive: true })
        const temp = `${filePath}.${process.pid}.tmp`
        await writeFile(temp, snapshot, 'utf8')
        await rename(temp, filePath)
      })
    this.writeChain = next
    return next
  }

  async listWorkspaces(backend: string): Promise<{ workspaces: PersistedAcpWorkspaceEntry[]; deletedPaths: Set<string> }> {
    await this.load()
    const entry = this.getBackend(backend)
    return {
      workspaces: (entry?.workspaces ?? []).map(item => ({ ...item })),
      deletedPaths: new Set(entry?.deletedPaths ?? []),
    }
  }

  async upsertWorkspace(backend: string, path: string, title?: string): Promise<PersistedAcpWorkspaceEntry> {
    await this.load()
    const entry = this.ensureBackend(backend)
    entry.deletedPaths = entry.deletedPaths.filter(item => item !== path)
    const now = new Date().toISOString()
    const existing = entry.workspaces.find(item => item.path === path)
    if (existing !== undefined) {
      if (title !== undefined && title.trim().length > 0) existing.title = title.trim()
      existing.updatedAt = now
      await this.persist()
      return { ...existing }
    }
    const created: PersistedAcpWorkspaceEntry = {
      path,
      ...(title !== undefined && title.trim().length > 0 ? { title: title.trim() } : {}),
      updatedAt: now,
    }
    entry.workspaces.push(created)
    await this.persist()
    return { ...created }
  }

  async renameWorkspace(backend: string, path: string, title: string): Promise<PersistedAcpWorkspaceEntry> {
    await this.load()
    const trimmed = title.trim()
    const entry = this.ensureBackend(backend)
    entry.deletedPaths = entry.deletedPaths.filter(item => item !== path)
    const now = new Date().toISOString()
    const existing = entry.workspaces.find(item => item.path === path)
    if (existing !== undefined) {
      existing.title = trimmed
      existing.updatedAt = now
      await this.persist()
      return { ...existing }
    }
    const created: PersistedAcpWorkspaceEntry = { path, title: trimmed, updatedAt: now }
    entry.workspaces.push(created)
    await this.persist()
    return { ...created }
  }

  async deleteWorkspace(backend: string, path: string): Promise<void> {
    await this.load()
    const entry = this.ensureBackend(backend)
    entry.workspaces = entry.workspaces.filter(item => item.path !== path)
    if (!entry.deletedPaths.includes(path)) entry.deletedPaths.push(path)
    await this.persist()
  }

  async reorderWorkspaces(backend: string, orderedPaths: string[]): Promise<string[]> {
    await this.load()
    const entry = this.ensureBackend(backend)
    const byPath = new Map(entry.workspaces.map(item => [item.path, item]))
    const next: PersistedAcpWorkspaceEntry[] = []
    const seen = new Set<string>()
    for (const path of orderedPaths) {
      if (seen.has(path)) continue
      seen.add(path)
      const existing = byPath.get(path)
      if (existing !== undefined) next.push(existing)
      else if (!entry.deletedPaths.includes(path)) {
        next.push({ path, updatedAt: new Date().toISOString() })
      }
    }
    for (const item of entry.workspaces) {
      if (!seen.has(item.path)) next.push(item)
    }
    entry.workspaces = next
    await this.persist()
    return next.map(item => item.path)
  }

  async getPinnedSessions(backend: string): Promise<string[]> {
    await this.load()
    return [...(this.getBackend(backend)?.pinnedSessionIds ?? [])]
  }

  async pinSession(backend: string, sessionId: string): Promise<string[]> {
    await this.load()
    const entry = this.ensureBackend(backend)
    entry.pinnedSessionIds = [sessionId, ...entry.pinnedSessionIds.filter(id => id !== sessionId)]
    await this.persist()
    return [...entry.pinnedSessionIds]
  }

  async unpinSession(backend: string, sessionId: string): Promise<string[]> {
    await this.load()
    const entry = this.ensureBackend(backend)
    entry.pinnedSessionIds = entry.pinnedSessionIds.filter(id => id !== sessionId)
    await this.persist()
    return [...entry.pinnedSessionIds]
  }

  async getSessionPermission(sessionId: string): Promise<AcpPermissionPreset | undefined> {
    await this.load()
    if (PROTOTYPE_KEYS.has(sessionId) || !Object.hasOwn(this.data.sessionPermissions, sessionId)) return undefined
    return this.data.sessionPermissions[sessionId]
  }

  async setSessionPermission(sessionId: string, preset: AcpPermissionPreset): Promise<void> {
    await this.load()
    if (PROTOTYPE_KEYS.has(sessionId)) {
      throw new Error(`Reserved ACP session key: ${sessionId}`)
    }
    this.data.sessionPermissions[sessionId] = preset
    await this.persist()
  }

  async getAllSessionPermissions(): Promise<Record<string, AcpPermissionPreset>> {
    await this.load()
    return { ...this.data.sessionPermissions }
  }
}

function normalizeStore(value: unknown): PersistedAcpStoreShape {
  if (!isRecord(value) || value.version !== 1) return createEmptyStore()
  const backends = emptyBackends()
  if (isRecord(value.backends)) {
    for (const [key, raw] of Object.entries(value.backends)) {
      if (PROTOTYPE_KEYS.has(key) || !isRecord(raw)) continue
      const workspaces: PersistedAcpWorkspaceEntry[] = Array.isArray(raw.workspaces)
        ? raw.workspaces.flatMap(item => (
            isRecord(item) && typeof item.path === 'string' && item.path.length > 0
              ? [{
                  path: item.path,
                  ...(typeof item.title === 'string' && item.title.trim() ? { title: item.title.trim() } : {}),
                  updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date(0).toISOString(),
                }]
              : []
          ))
        : []
      const deletedPaths = Array.isArray(raw.deletedPaths)
        ? raw.deletedPaths.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : []
      const pinnedSessionIds = Array.isArray(raw.pinnedSessionIds)
        ? raw.pinnedSessionIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : []
      backends[key] = { workspaces, deletedPaths, pinnedSessionIds }
    }
  }
  const sessionPermissions = emptyPermissions()
  if (isRecord(value.sessionPermissions)) {
    for (const [key, preset] of Object.entries(value.sessionPermissions)) {
      if (!PROTOTYPE_KEYS.has(key) && (preset === 'workspace-write' || preset === 'danger-full-access')) {
        sessionPermissions[key] = preset
      }
    }
  }
  return { version: 1, backends, sessionPermissions }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
