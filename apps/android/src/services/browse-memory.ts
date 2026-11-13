import { strings } from '../locales/i18n'
import { create } from 'zustand'
const filesystem = () => import('expo-file-system/legacy')
import { encryptFrame, decryptFrame, fromBase64Url, toBase64Url } from '@dsh-remote/crypto'
import type { ChatImage, ChatItem, PromptImage, RemoteDevice, RemoteSession, ServerConfig, WorkspaceView } from '../types'

export type ReadingPosition = { key?: string; offset: number; atBottom: boolean }
export type BrowseEntry = {
  draft?: string; images?: PromptImage[]; quotes?: string[]; position?: ReadingPosition; starred?: boolean
  seenAt?: number; visitedAt?: number; session?: RemoteSession
  groupRounds?: Record<string, Record<string, string | number | boolean | null>[]>
  messages?: ChatItem[]
}
type Snapshot = {
  entries: Record<string, BrowseEntry>
  catalogs: Record<string, { workspaces: WorkspaceView[]; sessions: RemoteSession[] }>
  hostModes: Record<string, 'agent' | 'bot'>
  resume: boolean; notifications: boolean; autoConnectHost: boolean
  last?: { scope: string; deviceId: string; sessionId: string }
}
type Memory = Snapshot & { ready: boolean; error?: string }
const empty = (): Snapshot => ({ entries: {}, catalogs: {}, hostModes: {}, resume: false, notifications: true, autoConnectHost: true })
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
    ([_, entry]) => (entry.messages && entry.messages.length > 0) || Object.keys(entry.groupRounds ?? {}).length > 0,
  )

  if (entriesWithMessages.length <= MAX_CACHED_SESSIONS) return entries

  entriesWithMessages.sort((a, b) => lru(b[1]) - lru(a[1]))
  const allowedKeys = new Set(
    entriesWithMessages.slice(0, MAX_CACHED_SESSIONS).map(([k]) => k),
  )

  const next: Record<string, BrowseEntry> = {}
  for (const [k, entry] of Object.entries(entries)) {
    if ((entry.messages || entry.groupRounds) && !allowedKeys.has(k)) {
      const { messages: _dropped, groupRounds: _rounds, ...rest } = entry
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
function restoreCatalog(catalog: Snapshot['catalogs'][string]): Snapshot['catalogs'][string] {
  // Earlier clients may have cached repeated native catalog rows. Keep drafts/stars
  // keyed by the same ID while restoring one preview per backend and thread.
  const sessions = new Map<string, RemoteSession>()
  for (const session of catalog.sessions) {
    const id = JSON.stringify([session.backend ?? 'harness', session.sessionId])
    const previous = sessions.get(id)
    if (previous === undefined || session.updatedAt > previous.updatedAt) sessions.set(id, safeSession(session))
  }
  return {sessions: [...sessions.values()], workspaces: catalog.workspaces.map(workspace => ({
    ...workspace, sessionIds: [...new Set(workspace.sessionIds)],
  }))}
}
function savedEntry(value: BrowseEntry): BrowseEntry {
  const messages = sanitizeCachedMessages(value.messages)
  return { draft: value.draft, position: value.position, starred: value.starred,
    seenAt: value.seenAt, visitedAt: value.visitedAt,
    session: value.session === undefined ? undefined : safeSession(value.session),
    groupRounds: sanitizeGroupRounds(value.groupRounds),
    ...(messages !== undefined ? { messages } : {}) }
}
function snapshot(): Snapshot {
  const state = useBrowseMemory.getState()
  const entries = Object.fromEntries(Object.entries(state.entries).map(([id, value]) => [id, savedEntry(value)]))
  const limitedEntries = enforceSessionMessageLimits(entries)
  return {entries: limitedEntries, catalogs: state.catalogs, hostModes: state.hostModes, resume: state.resume, notifications: state.notifications, autoConnectHost: state.autoConnectHost, last: state.last}
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
      const catalogs = Object.fromEntries(Object.entries(data.catalogs).map(([scope, catalog]) => [scope, restoreCatalog(catalog)]))
      const entries = Object.fromEntries(Object.entries(data.entries).map(([id, value]) => [id, savedEntry(value)]))
      const limitedEntries = enforceSessionMessageLimits(entries)
      useBrowseMemory.setState({...empty(), ...data, autoConnectHost: typeof data.autoConnectHost === 'boolean' ? data.autoConnectHost : true, entries: limitedEntries, catalogs, ready: true})
      if (Object.values(data.entries).some(value => value.messages && !value.messages.every(isValidCachedChatItem))) {
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
export function saveBrowseCatalog(scope: string, workspaces: WorkspaceView[], sessions: RemoteSession[]): void {
  const catalog = {workspaces, sessions: sessions.map(safeSession)}
  if (JSON.stringify(useBrowseMemory.getState().catalogs[scope]) === JSON.stringify(catalog)) return
  useBrowseMemory.setState(state => ({catalogs: {...state.catalogs, [scope]: catalog}}))
  schedule()
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
