import { encryptFrame, decryptFrame, fromBase64Url } from '@dsh-remote/crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type { RemoteSession, WorkspaceView } from '../src/types'

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

it('restores encrypted scoped drafts without message bodies, images or execution authority', async () => {
  const a = await load()
  const scope = a.browseScope({config:{baseUrl:'https://example.com',account:'a'},selectedDevice:{deviceId:'host',identityKey:'key'}} as never)
  a.saveBrowseCatalog(scope, [], [session(3)])
  a.updateBrowseEntry(scope, 'codex:s', {draft:'private draft',starred:true,session:session(3),images:[{uri:'private-image'}] as never,
    messages: [{kind:'message',text:'private answer'}] } as never)
  await a.flushBrowseMemory()
  const ciphertext = files.get('file:///app/remote-browse.enc')!
  expect(ciphertext).not.toMatch(/private|execution-authority|danger-full-access|do not replay/)
  const b = await load(), data = b.useBrowseMemory.getState(), entry = data.entries[b.browseKey(scope,'codex:s')]!
  expect(entry).toMatchObject({draft:'private draft',starred:true,session:{running:false,projections:{values:{remoteStatusKnown:false}}}})
  expect(entry.images).toBeUndefined(); expect(entry.session?.projections?.values?.permissions).toBeUndefined()
  expect(entry).not.toHaveProperty('messages')
  expect(data.entries[b.browseKey(scope+'other-account','codex:s')]).toBeUndefined()
  await b.clearBrowseMemory(); const c = await load(); expect(c.useBrowseMemory.getState().entries).toEqual({})
})

it('migrates repeated cached identities and workspace membership while retaining scoped drafts', async () => {
  const a = await load(), old = session(1), latest = session(3), other = {...old,sessionId:'codex:other',nativeId:'other'}
  const workspace = {workspaceId:'w',sessionIds:['codex:s','codex:s','codex:other']} as WorkspaceView
  a.saveBrowseCatalog('host-a',[workspace],[old,latest,old,other]); a.saveBrowseCatalog('host-b',[],[old])
  a.updateBrowseEntry('host-a','codex:s',{draft:'keep',starred:true,position:{offset:120,atBottom:false}})
  await a.flushBrowseMemory()
  const name = 'file:///app/remote-browse.enc', secret = fromBase64Url(keys.get('dshremote.browse-key.v1')!)
  const aad = 'dsh-remote-private-browse-v1'
  const legacy = JSON.parse(new TextDecoder().decode(decryptFrame(secret, JSON.parse(files.get(name)!), aad)))
  legacy.entries[a.browseKey('host-a','codex:s')].messages = [{text:'legacy private history'}]
  files.set(name, JSON.stringify(encryptFrame(secret, new TextEncoder().encode(JSON.stringify(legacy)), aad)))
  const b = await load(), state = b.useBrowseMemory.getState()
  expect(state.entries[b.browseKey('host-a','codex:s')]).not.toHaveProperty('messages')
  const migrated = JSON.parse(new TextDecoder().decode(decryptFrame(secret, JSON.parse(files.get(name)!), aad)))
  expect(migrated.entries[b.browseKey('host-a','codex:s')]).not.toHaveProperty('messages')
  expect(state.catalogs['host-a']?.sessions.map(s => s.sessionId)).toEqual(['codex:s','codex:other'])
  expect(state.catalogs['host-a']?.sessions[0]?.updatedAt).toBe(3)
  expect(state.catalogs['host-a']?.workspaces[0]?.sessionIds).toEqual(['codex:s','codex:other'])
  expect(state.catalogs['host-b']?.sessions[0]?.updatedAt).toBe(1)
  expect(state.entries[b.browseKey('host-a','codex:s')]).toMatchObject({draft:'keep',starred:true,position:{offset:120,atBottom:false}})
})

it('rejects tampered browsing-state ciphertext and leaves online history independent', async () => {
  const a = await load(); a.updateBrowseEntry('host','s',{draft:'secret'}); await a.flushBrowseMemory()
  const name='file:///app/remote-browse.enc', frame=JSON.parse(files.get(name)!)
  frame.ciphertext=frame.ciphertext.slice(0,-3)+'abc'; files.set(name,JSON.stringify(frame))
  const b=await load(); expect(b.useBrowseMemory.getState().error).toBeTruthy(); expect(b.useBrowseMemory.getState().entries).toEqual({})
})

it('defaults autoConnectHost to enabled, persists toggles and restores legacy snapshots', async () => {
  const name = 'file:///app/remote-browse.enc', aad = 'dsh-remote-private-browse-v1'
  const secret = () => fromBase64Url(keys.get('dshremote.browse-key.v1')!)
  const read = (): any => JSON.parse(new TextDecoder().decode(
    decryptFrame(secret(), JSON.parse(files.get(name)!), aad)))
  const rewrite = (mutate: (data: any) => void): void => {
    const data = read()
    mutate(data)
    files.set(name, JSON.stringify(encryptFrame(secret(), new TextEncoder().encode(JSON.stringify(data)), aad)))
  }
  await runScenarios([
    {
      name: 'a fresh install enables autoConnectHost',
      run: async () => {
        const a = await load()
        expect(a.useBrowseMemory.getState().autoConnectHost).toBe(true)
      },
    },
    {
      name: 'browsePreference persists an off and on toggle across reloads',
      run: async () => {
        const a = await load()
        a.browsePreference({ autoConnectHost: false })
        await a.flushBrowseMemory()
        expect(read().autoConnectHost).toBe(false)
        const b = await load()
        expect(b.useBrowseMemory.getState().autoConnectHost).toBe(false)
        b.browsePreference({ autoConnectHost: true })
        await b.flushBrowseMemory()
        expect(read().autoConnectHost).toBe(true)
        const c = await load()
        expect(c.useBrowseMemory.getState().autoConnectHost).toBe(true)
      },
    },
    {
      name: 'an old encrypted snapshot without autoConnectHost stays enabled',
      run: async () => {
        const a = await load()
        await a.flushBrowseMemory()
        rewrite(data => { delete data.autoConnectHost })
        const b = await load()
        expect(b.useBrowseMemory.getState().autoConnectHost).toBe(true)
      },
    },
    {
      name: 'a non-boolean autoConnectHost value is rejected in favor of the default',
      run: async () => {
        const a = await load()
        a.browsePreference({ autoConnectHost: false })
        await a.flushBrowseMemory()
        rewrite(data => { data.autoConnectHost = 'disabled' })
        const b = await load()
        expect(b.useBrowseMemory.getState().autoConnectHost).toBe(true)
      },
    },
  ], () => { files.clear(); keys.clear() })
})
