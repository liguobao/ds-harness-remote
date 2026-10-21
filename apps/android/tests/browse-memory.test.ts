import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChatItem, RemoteSession, WorkspaceView } from '../src/types'

const {files, keys} = vi.hoisted(() => ({files: new Map<string, string>(), keys: new Map<string, string>()}))
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///app/', getInfoAsync: async (p: string) => ({exists: files.has(p)}),
  readAsStringAsync: async (p: string) => files.get(p),
  writeAsStringAsync: async (p: string, value: string) => {files.set(p, value)},
  moveAsync: async ({from, to}: {from: string; to: string}) => {files.set(to, files.get(from)!); files.delete(from)},
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => keys.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {keys.set(key, value)},
}))
vi.mock('expo-crypto', () => ({getRandomBytes: (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n))}))
const load = async () => {vi.resetModules(); const memory = await import('../src/services/browse-memory'); await memory.hydrateBrowseMemory(); return memory}
const session = (updatedAt: number): RemoteSession => ({sessionId:'codex:s',nativeId:'s',backend:'codex',running:true,blank:false,updatedAt,
  projections:{values:{permissions:{currentValue:'danger-full-access'},remoteStatusKnown:true}}})
beforeEach(() => {vi.useFakeTimers(); files.clear(); keys.clear()})
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers()})

it('restores encrypted scoped drafts and text previews without images or execution authority', async () => {
  const a = await load()
  const scope = a.browseScope({config:{baseUrl:'https://example.com',account:'a'},selectedDevice:{deviceId:'host',identityKey:'key'}} as never)
  a.saveBrowseCatalog(scope, [], [session(3)])
  a.updateBrowseEntry(scope, 'codex:s', {draft:'private draft',starred:true,session:session(3),images:[{uri:'private-image'}] as never,
    messages:[{kind:'message',id:'confirmed',sessionId:'codex:s',role:'assistant',text:'private answer',createdAt:1},
      {kind:'message',id:'local:pending',sessionId:'codex:s',role:'user',text:'do not replay',createdAt:2,sendState:'unconfirmed'},
      {kind:'approval',id:'q',approvalId:'execution-authority'}] as ChatItem[]})
  await a.flushBrowseMemory()
  const ciphertext = files.get('file:///app/remote-browse.enc')!
  expect(ciphertext).not.toMatch(/private|execution-authority|danger-full-access|do not replay/)
  const b = await load(), data = b.useBrowseMemory.getState(), entry = data.entries[b.browseKey(scope,'codex:s')]!
  expect(entry).toMatchObject({draft:'private draft',starred:true,session:{running:false,projections:{values:{remoteStatusKnown:false}}}})
  expect(entry.images).toBeUndefined(); expect(entry.session?.projections?.values?.permissions).toBeUndefined()
  expect(entry.messages?.map(m => m.id)).toEqual(['confirmed'])
  expect(data.entries[b.browseKey(scope+'other-account','codex:s')]).toBeUndefined()
  await b.clearBrowseMemory(); expect(b.useBrowseMemory.getState().entries[b.browseKey(scope,'codex:s')]?.draft).toBe('private draft')
  await b.clearBrowseMemory(true); const c = await load(); expect(c.useBrowseMemory.getState().entries).toEqual({})
})

it('migrates repeated cached identities and workspace membership while retaining scoped drafts', async () => {
  const a = await load(), old = session(1), latest = session(3), other = {...old,sessionId:'codex:other',nativeId:'other'}
  const workspace = {workspaceId:'w',sessionIds:['codex:s','codex:s','codex:other']} as WorkspaceView
  a.saveBrowseCatalog('host-a',[workspace],[old,latest,old,other]); a.saveBrowseCatalog('host-b',[],[old])
  a.updateBrowseEntry('host-a','codex:s',{draft:'keep',starred:true,position:{offset:120,atBottom:false}})
  await a.flushBrowseMemory(); const b = await load(), state = b.useBrowseMemory.getState()
  expect(state.catalogs['host-a']?.sessions.map(s => s.sessionId)).toEqual(['codex:s','codex:other'])
  expect(state.catalogs['host-a']?.sessions[0]?.updatedAt).toBe(3)
  expect(state.catalogs['host-a']?.workspaces[0]?.sessionIds).toEqual(['codex:s','codex:other'])
  expect(state.catalogs['host-b']?.sessions[0]?.updatedAt).toBe(1)
  expect(state.entries[b.browseKey('host-a','codex:s')]).toMatchObject({draft:'keep',starred:true,position:{offset:120,atBottom:false}})
})

it('rejects tampered preview ciphertext and leaves online history independent', async () => {
  const a = await load(); a.updateBrowseEntry('host','s',{draft:'secret'}); await a.flushBrowseMemory()
  const name='file:///app/remote-browse.enc', frame=JSON.parse(files.get(name)!)
  frame.ciphertext=frame.ciphertext.slice(0,-3)+'abc'; files.set(name,JSON.stringify(frame))
  const b=await load(); expect(b.useBrowseMemory.getState().error).toBeTruthy(); expect(b.useBrowseMemory.getState().entries).toEqual({})
})
