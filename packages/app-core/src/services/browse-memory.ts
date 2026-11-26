import { strings } from '../locales/i18n'
import { create } from 'zustand'
const filesystem = () => import('expo-file-system/legacy')
import { encryptFrame, decryptFrame, fromBase64Url, toBase64Url } from '@dsh-remote/crypto'
import { parseHandoffMessage, parseHandoffMeta, type PendingHandoffDraft } from '../lib/handoff-context'
import { firstLineSnippet, isHandoffRawText, type SessionHandoffOrigin } from '../lib/handoff-preview'
import { acpWorkspaceSuppressionKey, isAcpManagedBackend, isDeletedAcpWorkspace } from '../lib/workspace-key'
import type { AgentBackend, ChatImage, ChatItem, PromptImage, RemoteDevice, RemoteSession, ServerConfig, WorkspaceView } from '../types'

export { isDeletedAcpWorkspace }

export type ReadingPosition = { key?: string; offset: number; atBottom: boolean }
export type BrowseEntry = {
  draft?: string; images?: PromptImage[]; quotes?: string[]; handoff?: PendingHandoffDraft
  position?: ReadingPosition; starred?: boolean
  seenAt?: number; visitedAt?: number; session?: RemoteSession
  groupRounds?: Record<string, Record<string, string | number | boolean | null>[]>
  messages?: ChatItem[]
}
export type CatalogSnapshot = {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
  pinnedSessionIds?: string[]
  archivedSessionIds?: string[]
}
type Snapshot = {
  entries: Record<string, BrowseEntry>
  catalogs: Record<string, CatalogSnapshot>
  deletedWorkspaces: Record<string, string[]>
  hostModes: Record<string, 'agent' | 'bot'>
  handoffOrigins: Record<string, Record<string, SessionHandoffOrigin>>
  resume: boolean; notifications: boolean; autoConnectHost: boolean
  last?: { scope: string; deviceId: string; sessionId: string }
}
type Memory = Snapshot & { ready: boolean; error?: string }
const empty = (): Snapshot => ({ entries: {}, catalogs: {}, deletedWorkspaces: {}, hostModes: {}, handoffOrigins: {}, resume: false, notifications: true, autoConnectHost: true })
export const useBrowseMemory = create<Memory>(() => ({ ...empty(), ready: false }))
export const browseScope = (state: {config?: ServerConfig; selectedDevice?: RemoteDevice}): string => JSON.stringify([
  state.config?.baseUrl, state.config?.account, state.selectedDevice?.deviceId, state.selectedDevice?.identityKey,
])
export const browseKey = (scope: string, id: string): string => JSON.stringify([scope, id])
let key: Uint8Array | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let writes = Promise.resolve()
let epoch = 0
const file = (fs: typeof import('expo-file-system/legacy')) => `${fs.documentDirectory}remote-browse.enc`
const keyName = 'dshremote.browse-key.v1'
const aad = 'dsh-remote-private-browse-v1'

export const MAX_CACHED_MESSAGES_PER_SESSION = 30
export const MAX_CACHED_SESSIONS = 10
const MAX_DELETED_WORKSPACES_PER_SCOPE = 500
const MAX_HANDOFF_ORIGINS_PER_SCOPE = 500
const MAX_TEXT_CHARS = 32768

const capText = (text?: string): string | undefined =>
  text && text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text

const sanitizeImages = (images?: ChatImage[]): ChatImage[] | undefined =>
  images?.map(img =>
    img.uri?.startsWith('data:') ? { ...img, uri: undefined } : { ...img },
  )

export function sanitizeCachedMessage(item: ChatItem): ChatItem {
  if (item.kind === 'message') {
    return {
      ...item,
      promptImages: undefined,
      images: sanitizeImages(item.images),
      text: capText(item.text) ?? '',
      reasoning: capText(item.reasoning),
    }
  }
  if (item.kind === 'tool') {
    return {
      ...item,
      images: sanitizeImages(item.images),
      callDetail: item.callDetail
        ? { ...item.callDetail, text: capText(item.callDetail.text) ?? '' }
        : item.callDetail,
      resultDetail: item.resultDetail
        ? { ...item.resultDetail, text: capText(item.resultDetail.text) ?? '' }
        : item.resultDetail,
      uiResultMeta: undefined,
    }
  }
  return { ...item }
}

export function isValidCachedChatItem(item: unknown): item is ChatItem {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.kind === 'string' &&
    ['message', 'tool', 'approval', 'question'].includes(candidate.kind)
}

export function sanitizeCachedMessages(items?: ChatItem[]): ChatItem[] | undefined {
  if (!items || !Array.isArray(items) || items.length === 0) return undefined
  const valid = items.filter(isValidCachedChatItem)
  if (valid.length === 0) return undefined
  return valid.slice(-MAX_CACHED_MESSAGES_PER_SESSION).map(sanitizeCachedMessage)
}

export function enforceSessionMessageLimits(
  entries: Record<string, BrowseEntry>,
): Record<string, BrowseEntry> {
  const lru = (entry: BrowseEntry): number =>
    entry.visitedAt ?? entry.seenAt ?? entry.session?.updatedAt ?? 0

  const entriesWithMessages = Object.entries(entries).filter(
    ([_, entry]) =>
      (entry.messages && entry.messages.length > 0)
      || Object.keys(entry.groupRounds ?? {}).length > 0
      || (entry.images && entry.images.length > 0),
  )

  if (entriesWithMessages.length <= MAX_CACHED_SESSIONS) return entries

  entriesWithMessages.sort((a, b) => lru(b[1]) - lru(a[1]))
  const allowedKeys = new Set(
    entriesWithMessages.slice(0, MAX_CACHED_SESSIONS).map(([k]) => k),
  )

  const next: Record<string, BrowseEntry> = {}
  for (const [k, entry] of Object.entries(entries)) {
    if ((entry.messages || entry.groupRounds || entry.images) && !allowedKeys.has(k)) {
      const { messages: _dropped, groupRounds: _rounds, images: _images, ...rest } = entry
      next[k] = rest
    } else {
      next[k] = entry
    }
  }
  return next
}

function safeSession(session: RemoteSession): RemoteSession {
  return { sessionId: session.sessionId, nativeId: session.nativeId, backend: session.backend,
    title: session.title, cwd: session.cwd, updatedAt: session.updatedAt, blank: session.blank,
    parentSessionId: session.parentSessionId, running: false,
    projections: {values: {remoteStatusKnown: false, codexStatus: 'unknown'}} }
}
function sanitizeHandoffOrigin(value: unknown): SessionHandoffOrigin | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const sourceBackend = typeof record.sourceBackend === 'string' ? record.sourceBackend.trim() : ''
  if (!sourceBackend) return undefined
  const targetBackend = typeof record.targetBackend === 'string' && record.targetBackend.trim()
    ? record.targetBackend.trim()
    : undefined
  const sourceSessionId = typeof record.sourceSessionId === 'string' && record.sourceSessionId.trim()
    ? record.sourceSessionId.trim()
    : undefined
  const rawTitle = typeof record.sourceTitle === 'string'
    ? record.sourceTitle.replace(/\s+/gu, ' ').trim().slice(0, 200)
    : undefined
  const sourceTitle = rawTitle && !isHandoffRawText(rawTitle) ? rawTitle : undefined
  const fallbackTitle = typeof record.fallbackTitle === 'string'
    ? firstLineSnippet(record.fallbackTitle, 120)
    : undefined
  const preset = record.preset === 'review' || record.preset === 'continue' || record.preset === 'custom'
    ? record.preset
    : undefined
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) && record.createdAt >= 0
    ? record.createdAt
    : undefined
  return {
    sourceBackend,
    ...(targetBackend !== undefined ? { targetBackend } : {}),
    ...(sourceSessionId !== undefined ? { sourceSessionId } : {}),
    ...(sourceTitle !== undefined ? { sourceTitle } : {}),
    ...(fallbackTitle !== undefined ? { fallbackTitle } : {}),
    ...(preset !== undefined ? { preset } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  }
}

function capScopeHandoffOrigins(
  map: Record<string, SessionHandoffOrigin>,
): Record<string, SessionHandoffOrigin> {
  const entries = Object.entries(map)
  if (entries.length <= MAX_HANDOFF_ORIGINS_PER_SCOPE) return map
  entries.sort((a, b) => (b[1].createdAt ?? 0) - (a[1].createdAt ?? 0))
  return Object.fromEntries(entries.slice(0, MAX_HANDOFF_ORIGINS_PER_SCOPE))
}

function sanitizeHandoffOrigins(
  value: unknown,
): Record<string, Record<string, SessionHandoffOrigin>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, Record<string, SessionHandoffOrigin>> = {}
  for (const [scope, rawMap] of Object.entries(value)) {
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) continue
    const cleanScope: Record<string, SessionHandoffOrigin> = {}
    for (const [sessionId, origin] of Object.entries(rawMap)) {
      if (!sessionId) continue
      const sanitized = sanitizeHandoffOrigin(origin)
      if (sanitized !== undefined) cleanScope[sessionId] = sanitized
    }
    if (Object.keys(cleanScope).length > 0) {
      result[scope] = capScopeHandoffOrigins(cleanScope)
    }
  }
  return result
}

function handoffOriginEqual(a: SessionHandoffOrigin | undefined, b: SessionHandoffOrigin): boolean {
  if (a === undefined) return false
  return a.sourceBackend === b.sourceBackend
    && a.targetBackend === b.targetBackend
    && a.sourceSessionId === b.sourceSessionId
    && a.sourceTitle === b.sourceTitle
    && a.fallbackTitle === b.fallbackTitle
    && a.preset === b.preset
    && a.createdAt === b.createdAt
}

function sanitizeDeletedWorkspaces(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string[]> = {}
  for (const [scope, items] of Object.entries(value)) {
    if (!Array.isArray(items)) continue
    const deduped = [...new Set(items.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      .slice(-MAX_DELETED_WORKSPACES_PER_SCOPE)
    if (deduped.length > 0) result[scope] = deduped
  }
  return result
}

function sanitizeCatalogSessionIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

function filterCatalogByDeletedKeys(
  catalog: Snapshot['catalogs'][string],
  deletedKeys?: ReadonlySet<string>,
  platform?: string,
): Snapshot['catalogs'][string] {
  if (!deletedKeys || deletedKeys.size === 0) return catalog
  const removedSessionIds = new Set<string>()
  const keptWorkspaces = catalog.workspaces.filter(workspace => {
    const suppressed = workspace.backend !== undefined
      && isAcpManagedBackend(workspace.backend)
      && isDeletedAcpWorkspace(deletedKeys, workspace.backend, workspace.path, platform)
    if (suppressed) {
      for (const id of workspace.sessionIds) removedSessionIds.add(id)
      return false
    }
    return true
  })
  const keptSessionIds = new Set(keptWorkspaces.flatMap(workspace => workspace.sessionIds))
  const keptSessions = catalog.sessions.filter(session => {
    if (keptSessionIds.has(session.sessionId)) return true
    if (removedSessionIds.has(session.sessionId)) return false
    if (
      session.backend !== undefined
      && isAcpManagedBackend(session.backend)
      && session.cwd !== undefined
      && isDeletedAcpWorkspace(deletedKeys, session.backend, session.cwd, platform)
    ) {
      removedSessionIds.add(session.sessionId)
      return false
    }
    return true
  })
  const pinnedSessionIds = catalog.pinnedSessionIds?.filter(id => !removedSessionIds.has(id))
  const archivedSessionIds = catalog.archivedSessionIds?.filter(id => !removedSessionIds.has(id))
  return {
    workspaces: keptWorkspaces,
    sessions: keptSessions,
    ...(pinnedSessionIds !== undefined ? { pinnedSessionIds } : {}),
    ...(archivedSessionIds !== undefined ? { archivedSessionIds } : {}),
  }
}

function restoreCatalog(catalog: Snapshot['catalogs'][string], deletedKeys?: ReadonlySet<string>): Snapshot['catalogs'][string] {
  // Earlier clients may have cached repeated native catalog rows. Keep drafts/stars
  // keyed by the same ID while restoring one preview per backend and thread.
  const sessions = new Map<string, RemoteSession>()
  for (const session of catalog.sessions) {
    const id = JSON.stringify([session.backend ?? 'harness', session.sessionId])
    const previous = sessions.get(id)
    if (previous === undefined || session.updatedAt > previous.updatedAt) sessions.set(id, safeSession(session))
  }
  const pinnedSessionIds = sanitizeCatalogSessionIds(catalog.pinnedSessionIds)
  const archivedSessionIds = sanitizeCatalogSessionIds(catalog.archivedSessionIds)
  return filterCatalogByDeletedKeys(
    {
      sessions: [...sessions.values()],
      workspaces: catalog.workspaces.map(workspace => ({
        ...workspace,
        sessionIds: [...new Set(workspace.sessionIds)],
      })),
      ...(pinnedSessionIds !== undefined ? { pinnedSessionIds } : {}),
      ...(archivedSessionIds !== undefined ? { archivedSessionIds } : {}),
    },
    deletedKeys,
  )
}
const MAX_DRAFT_IMAGES = 4
const MAX_DRAFT_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_DRAFT_IMAGE_BASE64_CHARS = Math.ceil(MAX_DRAFT_IMAGE_BYTES / 3) * 4 + 4
const MAX_DRAFT_QUOTES = 20
const DRAFT_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function sanitizeDraftImages(images?: PromptImage[]): PromptImage[] | undefined {
  if (!Array.isArray(images) || images.length === 0) return undefined
  const valid = images
    .filter((img): img is PromptImage =>
      typeof img === 'object' && img !== null
      && typeof img.uri === 'string' && img.uri.length > 0
      && typeof img.mediaType === 'string' && DRAFT_IMAGE_MEDIA_TYPES.has(img.mediaType)
      && typeof img.data === 'string' && img.data.length > 0 && img.data.length <= MAX_DRAFT_IMAGE_BASE64_CHARS
      && typeof img.bytes === 'number' && Number.isFinite(img.bytes) && img.bytes > 0 && img.bytes <= MAX_DRAFT_IMAGE_BYTES
      && typeof img.width === 'number' && Number.isFinite(img.width) && img.width > 0
      && typeof img.height === 'number' && Number.isFinite(img.height) && img.height > 0)
    .slice(0, MAX_DRAFT_IMAGES)
    .map(img => ({
      uri: img.uri,
      mediaType: img.mediaType,
      data: img.data,
      bytes: img.bytes,
      width: img.width,
      height: img.height,
      ...(typeof img.name === 'string' ? { name: img.name } : {}),
    }))
  return valid.length === 0 ? undefined : valid
}

function sanitizeDraftQuotes(quotes?: string[]): string[] | undefined {
  if (!Array.isArray(quotes) || quotes.length === 0) return undefined
  const valid = quotes
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, MAX_DRAFT_QUOTES)
    .map(item => capText(item) ?? '')
    .filter(item => item.length > 0)
  return valid.length === 0 ? undefined : valid
}

function sanitizePendingHandoff(value: unknown): PendingHandoffDraft | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.contextBlock !== 'string'
    || candidate.contextBlock.length === 0
    || candidate.contextBlock.length > MAX_TEXT_CHARS
  ) {
    return undefined
  }
  const meta = parseHandoffMeta(candidate.meta)
  if (meta === undefined) return undefined
  if (parseHandoffMessage(candidate.contextBlock) === undefined) return undefined
  return {
    meta: {
      ...meta,
      ...(meta.sourceTitle !== undefined ? { sourceTitle: capText(meta.sourceTitle) } : {}),
      ...(meta.cwd !== undefined ? { cwd: capText(meta.cwd) } : {}),
    },
    contextBlock: candidate.contextBlock,
  }
}

function savedEntry(value: BrowseEntry): BrowseEntry {
  const messages = sanitizeCachedMessages(value.messages)
  const images = sanitizeDraftImages(value.images)
  const quotes = sanitizeDraftQuotes(value.quotes)
  const handoff = sanitizePendingHandoff(value.handoff)
  return { draft: value.draft, position: value.position, starred: value.starred,
    seenAt: value.seenAt, visitedAt: value.visitedAt,
    session: value.session === undefined ? undefined : safeSession(value.session),
    groupRounds: sanitizeGroupRounds(value.groupRounds),
    ...(images !== undefined ? { images } : {}),
    ...(quotes !== undefined ? { quotes } : {}),
    ...(handoff !== undefined ? { handoff } : {}),
    ...(messages !== undefined ? { messages } : {}) }
}
function snapshot(): Snapshot {
  const state = useBrowseMemory.getState()
  const entries = Object.fromEntries(Object.entries(state.entries).map(([id, value]) => [id, savedEntry(value)]))
  const limitedEntries = enforceSessionMessageLimits(entries)
  return {
    entries: limitedEntries,
    catalogs: state.catalogs,
    deletedWorkspaces: sanitizeDeletedWorkspaces(state.deletedWorkspaces),
    hostModes: state.hostModes,
    handoffOrigins: sanitizeHandoffOrigins(state.handoffOrigins),
    resume: state.resume,
    notifications: state.notifications,
    autoConnectHost: state.autoConnectHost,
    last: state.last,
  }
}
export function flushBrowseMemory(): Promise<void> {
  if (timer !== undefined) {clearTimeout(timer); timer = undefined}
  if (!useBrowseMemory.getState().ready || key === undefined) return writes
  const data = snapshot(), captured = epoch, secret = key
  writes = writes.catch(() => undefined).then(async () => {
    if (captured !== epoch) return
    const encoded = new TextEncoder().encode(JSON.stringify(data))
    const encrypted = JSON.stringify(encryptFrame(secret, encoded, aad))
    const FileSystem = await filesystem()
    await FileSystem.writeAsStringAsync(`${file(FileSystem)}.tmp`, encrypted)
    await FileSystem.moveAsync({from: `${file(FileSystem)}.tmp`, to: file(FileSystem)})
  }).catch(() => {useBrowseMemory.setState({error: strings.comfort.cacheSaveFailed})})
  return writes
}
function schedule() {
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {void flushBrowseMemory()}, 600)
}
export async function hydrateBrowseMemory(): Promise<void> {
  if (useBrowseMemory.getState().ready) return
  try {
    const SecureStore = await import('expo-secure-store')
    const Crypto = await import('expo-crypto')
    const FileSystem = await filesystem()
    const savedKey = await SecureStore.getItemAsync(keyName)
    if (savedKey === null) {
      key = Crypto.getRandomBytes(32)
      await SecureStore.setItemAsync(keyName, toBase64Url(key), {keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})
    } else key = fromBase64Url(savedKey)
    const info = await FileSystem.getInfoAsync(file(FileSystem))
    if (info.exists) {
      const encrypted = JSON.parse(await FileSystem.readAsStringAsync(file(FileSystem)))
      const data = JSON.parse(new TextDecoder().decode(decryptFrame(key, encrypted, aad))) as Snapshot
      const deletedWorkspaces = sanitizeDeletedWorkspaces(data.deletedWorkspaces)
      const handoffOrigins = sanitizeHandoffOrigins(data.handoffOrigins)
      const catalogs = Object.fromEntries(
        Object.entries(data.catalogs ?? {}).map(([scope, catalog]) => [
          scope,
          restoreCatalog(catalog, new Set(deletedWorkspaces[scope] ?? [])),
        ]),
      )
      const entries = Object.fromEntries(Object.entries(data.entries ?? {}).map(([id, value]) => [id, savedEntry(value)]))
      const limitedEntries = enforceSessionMessageLimits(entries)
      useBrowseMemory.setState({
        ...empty(),
        ...data,
        autoConnectHost: typeof data.autoConnectHost === 'boolean' ? data.autoConnectHost : true,
        entries: limitedEntries,
        catalogs,
        deletedWorkspaces,
        handoffOrigins,
        ready: true,
      })
      if (Object.values(data.entries ?? {}).some(value => value.messages && !value.messages.every(isValidCachedChatItem))) {
        await flushBrowseMemory()
      }
    } else useBrowseMemory.setState({ready: true})
  } catch {useBrowseMemory.setState({ready: true, error: strings.comfort.cacheRestoreFailed})}
}
export function updateBrowseEntry(scope: string, id: string, patch: Partial<BrowseEntry>): void {
  const entryKey = browseKey(scope, id)
  useBrowseMemory.setState(state => ({entries: {...state.entries, [entryKey]: {...state.entries[entryKey], ...patch}}}))
  schedule()
}
export function getDeletedAcpWorkspaceKeys(scope: string): ReadonlySet<string> {
  return new Set(useBrowseMemory.getState().deletedWorkspaces?.[scope] ?? [])
}
export function markDeletedAcpWorkspace(scope: string, backend: AgentBackend, path: string, platform?: string): void {
  if (!isAcpManagedBackend(backend)) return
  const deletionKey = acpWorkspaceSuppressionKey(backend, path, platform)
  useBrowseMemory.setState(state => {
    const existing = state.deletedWorkspaces?.[scope] ?? []
    const nextList = existing.includes(deletionKey)
      ? existing
      : [...existing, deletionKey].slice(-MAX_DELETED_WORKSPACES_PER_SCOPE)
    const nextDeleted = { ...state.deletedWorkspaces, [scope]: nextList }
    const existingCatalog = state.catalogs?.[scope]
    const nextCatalog = existingCatalog === undefined
      ? undefined
      : filterCatalogByDeletedKeys(existingCatalog, new Set([deletionKey]), platform)
    return {
      deletedWorkspaces: nextDeleted,
      ...(nextCatalog === undefined ? {} : { catalogs: { ...state.catalogs, [scope]: nextCatalog } }),
    }
  })
  schedule()
}
export function unmarkDeletedAcpWorkspace(scope: string, backend: AgentBackend, path: string, platform?: string): void {
  if (!isAcpManagedBackend(backend)) return
  useBrowseMemory.setState(state => {
    const existing = state.deletedWorkspaces?.[scope]
    if (!existing || existing.length === 0) return {}
    const filtered = existing.filter(item => !isDeletedAcpWorkspace(new Set([item]), backend, path, platform))
    if (filtered.length === existing.length) return {}
    const nextDeleted = { ...state.deletedWorkspaces }
    if (filtered.length === 0) delete nextDeleted[scope]
    else nextDeleted[scope] = filtered
    return { deletedWorkspaces: nextDeleted }
  })
  schedule()
}
export function saveBrowseCatalog(
  scope: string,
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  meta?: { pinnedSessionIds?: readonly string[]; archivedSessionIds?: readonly string[] },
): boolean {
  const existing = useBrowseMemory.getState().catalogs[scope]
  const pinnedSessionIds = meta?.pinnedSessionIds !== undefined
    ? sanitizeCatalogSessionIds(meta.pinnedSessionIds)
    : existing?.pinnedSessionIds
  const archivedSessionIds = meta?.archivedSessionIds !== undefined
    ? sanitizeCatalogSessionIds(meta.archivedSessionIds)
    : existing?.archivedSessionIds
  const catalog: CatalogSnapshot = {
    workspaces,
    sessions: sessions.map(safeSession),
    ...(pinnedSessionIds !== undefined ? { pinnedSessionIds } : {}),
    ...(archivedSessionIds !== undefined ? { archivedSessionIds } : {}),
  }
  if (JSON.stringify(existing) === JSON.stringify(catalog)) return false
  useBrowseMemory.setState(state => ({catalogs: {...state.catalogs, [scope]: catalog}}))
  schedule()
  return true
}
export function saveSessionMessagesSnapshot(scope: string, id: string, messages: ChatItem[]): void {
  updateBrowseEntry(scope, id, { messages: sanitizeCachedMessages(messages) })
}
export function getCachedSessionMessages(scope: string, id: string): ChatItem[] | undefined {
  return useBrowseMemory.getState().entries[browseKey(scope, id)]?.messages
}
export function browsePreference(patch: Partial<Pick<Snapshot, 'resume' | 'autoConnectHost' | 'notifications' | 'last'>>): void {
  useBrowseMemory.setState(patch); schedule()
}
export async function clearBrowseMemory(): Promise<void> {
  ++epoch
  if (timer !== undefined) {clearTimeout(timer); timer = undefined}
  await writes
  useBrowseMemory.setState({...empty(), error: undefined})
  await flushBrowseMemory()
}

/** Local display preference, isolated by server, account, device and pinned identity. */
export function saveHostMode(scope: string, mode: 'agent' | 'bot'): void {
  useBrowseMemory.setState(state => ({hostModes: {...state.hostModes, [scope]: mode}}))
  void flushBrowseMemory()
}

export function getHandoffOrigin(scope: string, sessionId: string): SessionHandoffOrigin | undefined {
  return useBrowseMemory.getState().handoffOrigins[scope]?.[sessionId]
}

export function recordHandoffOrigin(
  scope: string,
  sessionId: string,
  origin: SessionHandoffOrigin,
): void {
  if (!scope || !sessionId) return
  const incoming = sanitizeHandoffOrigin(origin)
  if (incoming === undefined) return
  const currentScopeMap = useBrowseMemory.getState().handoffOrigins[scope]
  const existing = currentScopeMap?.[sessionId]
  const merged: SessionHandoffOrigin = existing === undefined
    ? incoming
    : {
        sourceBackend: incoming.sourceBackend || existing.sourceBackend,
        targetBackend: incoming.targetBackend ?? existing.targetBackend,
        sourceSessionId: incoming.sourceSessionId ?? existing.sourceSessionId,
        sourceTitle: incoming.sourceTitle ?? existing.sourceTitle,
        fallbackTitle: incoming.fallbackTitle ?? existing.fallbackTitle,
        preset: incoming.preset ?? existing.preset,
        createdAt: incoming.createdAt ?? existing.createdAt,
      }
  if (handoffOriginEqual(existing, merged)) return
  useBrowseMemory.setState(state => {
    const scopeMap = state.handoffOrigins[scope] ?? {}
    const nextScopeMap = capScopeHandoffOrigins({ ...scopeMap, [sessionId]: merged })
    return {
      handoffOrigins: { ...state.handoffOrigins, [scope]: nextScopeMap },
    }
  })
  schedule()
}

// Keep the same session LRU, encryption and reset lifecycle as ordinary history.
function sanitizeGroupRounds(value: BrowseEntry['groupRounds']): BrowseEntry['groupRounds'] {
  if (!value || typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value).slice(-30).flatMap(([id, rows]) => {
    if (!Array.isArray(rows)) return []
    const safe = rows.slice(-32).filter(row => row && typeof row === 'object').map(row =>
      Object.fromEntries(Object.entries(row).slice(0, 24).flatMap<[string, string | number | boolean | null]>(([field, v]) =>
        typeof v === 'string' ? [[field, v.slice(0, 2048)]] :
          v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ? [[field, v]] : [])))
    return [[id, safe]]
  }))
}
export function getCachedGroupRound(scope: string, id: string, round: string) {
  return useBrowseMemory.getState().entries[browseKey(scope, id)]?.groupRounds?.[round]
}
export function saveGroupRound(scope: string, id: string, round: string, rows: Record<string, unknown>[]): void {
  // A poll that catches the round before any member spoke knows nothing the persisted
  // rows do not; storing that empty array made the live overlay shadow the fetched rows.
  if (rows.length === 0) return
  const entry = useBrowseMemory.getState().entries[browseKey(scope, id)]
  const rounds = { ...entry?.groupRounds }
  delete rounds[round]
  const safe = sanitizeGroupRounds({ [round]: rows as NonNullable<BrowseEntry['groupRounds']>[string] })!
  updateBrowseEntry(scope, id, { groupRounds: sanitizeGroupRounds({ ...rounds, ...safe }), visitedAt: Date.now() })
}
