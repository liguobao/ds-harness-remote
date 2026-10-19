import { strings } from '../locales/i18n'
import { create } from 'zustand'
const filesystem = () => import('expo-file-system/legacy')
import { encryptFrame, decryptFrame, fromBase64Url, toBase64Url } from '@dsh-remote/crypto'
import type { ChatItem, PromptImage, RemoteDevice, RemoteSession, ServerConfig, WorkspaceView } from '../types'

export type ReadingPosition = { key?: string; offset: number; atBottom: boolean }
export type BrowseEntry = {
  draft?: string; images?: PromptImage[]; position?: ReadingPosition; starred?: boolean
  seenAt?: number; visitedAt?: number; session?: RemoteSession; messages?: ChatItem[]
}
type Snapshot = {
  entries: Record<string, BrowseEntry>
  catalogs: Record<string, { workspaces: WorkspaceView[]; sessions: RemoteSession[] }>
  resume: boolean; notifications: boolean
  last?: { scope: string; deviceId: string; sessionId: string }
}
type Memory = Snapshot & { ready: boolean; error?: string }
const empty = (): Snapshot => ({ entries: {}, catalogs: {}, resume: false, notifications: true })
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

/** Preview only: never persist approval handles, permissions, pending sends or image bytes. */
export function previewMessages(items: ChatItem[]): ChatItem[] {
  let bytes = 0
  return items.filter(item => item.kind === 'message' && item.role !== 'system' && item.sendState === undefined
    && item.queuedAdopted !== true && !item.id.startsWith('local:')).slice(-16).reverse().flatMap(item => {
    if (item.kind !== 'message') return []
    const text = item.text.length > 32_000 ? `${item.text.slice(0, 32_000)}\n\n${strings.comfort.cachePreview}` : item.text
    bytes += text.length * 3
    if (bytes > 128 * 1024) return []
    return [{ kind: 'message' as const, id: item.id, sessionId: item.sessionId, createdAt: item.createdAt,
      role: item.role, text, nativeSeq: item.nativeSeq, nativeTime: item.nativeTime }]
  }).reverse()
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
function snapshot(): Snapshot {
  const state = useBrowseMemory.getState()
  const hot = new Set(Object.entries(state.entries).sort((a, b) => (b[1].visitedAt ?? 0) - (a[1].visitedAt ?? 0)).slice(0, 12).map(([id]) => id))
  const entries = Object.fromEntries(Object.entries(state.entries).map(([id, value]) => [id, {
    draft: value.draft, position: value.position, starred: value.starred, seenAt: value.seenAt, visitedAt: value.visitedAt,
    session: value.session === undefined ? undefined : safeSession(value.session),
    messages: hot.has(id) ? previewMessages(value.messages ?? []) : undefined,
  }]))
  return {entries, catalogs: state.catalogs, resume: state.resume, notifications: state.notifications, last: state.last}
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
      useBrowseMemory.setState({...empty(), ...data, catalogs, ready: true})
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
export function browsePreference(patch: Partial<Pick<Snapshot, 'resume' | 'notifications' | 'last'>>): void {
  useBrowseMemory.setState(patch); schedule()
}
export async function clearBrowseMemory(includeDrafts = false): Promise<void> {
  ++epoch
  if (timer !== undefined) {clearTimeout(timer); timer = undefined}
  await writes
  if (includeDrafts) useBrowseMemory.setState({...empty(), error: undefined})
  else useBrowseMemory.setState(state => ({catalogs: {}, last: undefined, entries: Object.fromEntries(
    Object.entries(state.entries).map(([id, value]) => [id, {...value, messages: undefined, position: undefined}]))}))
  await flushBrowseMemory()
}
