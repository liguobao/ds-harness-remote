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

it('restores encrypted scoped drafts and sanitized message snapshots without raw image bytes or execution authority', async () => {
  const a = await load()
  const scope = a.browseScope({config:{baseUrl:'https://example.com',account:'a'},selectedDevice:{deviceId:'host',identityKey:'key'}} as never)
  a.saveBrowseCatalog(scope, [], [session(3)])
  a.updateBrowseEntry(scope, 'codex:s', {draft:'private draft',starred:true,session:session(3),images:[{uri:'private-image'}] as never,
    messages: [{
      id: 'm1', kind: 'message', role: 'user', text: 'private answer',
      promptImages: [{ data: 'base64rawbytes', bytes: 100, width: 10, height: 10 }],
      images: [{ uri: 'data:image/png;base64,xxxx' }, { uri: 'file:///safe.png', attachmentId: 'att1' }]
    }] } as never)
  await a.flushBrowseMemory()
  const ciphertext = files.get('file:///app/remote-browse.enc')!
  expect(ciphertext).not.toMatch(/private|execution-authority|danger-full-access|do not replay/)
  const b = await load(), data = b.useBrowseMemory.getState(), entry = data.entries[b.browseKey(scope,'codex:s')]!
  expect(entry).toMatchObject({draft:'private draft',starred:true,session:{running:false,projections:{values:{remoteStatusKnown:false}}}})
  expect(entry.images).toBeUndefined(); expect(entry.session?.projections?.values?.permissions).toBeUndefined()
  expect(entry.messages).toBeDefined()
  expect(entry.messages).toHaveLength(1)
  expect(entry.messages![0]).toMatchObject({ id: 'm1', kind: 'message', text: 'private answer' })
  // Raw image bytes and data: URIs must be stripped
  expect((entry.messages![0] as any).promptImages).toBeUndefined()
  expect((entry.messages![0] as any).images[0].uri).toBeUndefined()
  expect((entry.messages![0] as any).images[1].uri).toBe('file:///safe.png')
  expect(data.entries[b.browseKey(scope+'other-account','codex:s')]).toBeUndefined()
  await b.clearBrowseMemory(); const c = await load(); expect(c.useBrowseMemory.getState().entries).toEqual({})
})

it('enforces MAX_CACHED_MESSAGES_PER_SESSION (30) limit on messages snapshot', async () => {
  const a = await load()
  const scope = 'scope-1'
  const msgs = Array.from({ length: 45 }, (_, i) => ({
    id: `msg-${i}`, kind: 'message' as const, role: 'user' as const, text: `hello ${i}`
  }))
  a.saveSessionMessagesSnapshot(scope, 's-long', msgs as never)
  await a.flushBrowseMemory()
  const b = await load()
  const cached = b.getCachedSessionMessages(scope, 's-long')
  expect(cached).toBeDefined()
  expect(cached).toHaveLength(30)
  expect(cached![0]!.id).toBe('msg-15')
  expect(cached![29]!.id).toBe('msg-44')
})

it('enforces MAX_CACHED_SESSIONS (10) LRU eviction across sessions', async () => {
  const a = await load()
  const scope = 'scope-lru'
  for (let i = 1; i <= 12; i++) {
    const id = `s-${i}`
    a.updateBrowseEntry(scope, id, {
      draft: `draft-${i}`,
      visitedAt: i * 1000,
      messages: [{ id: `m-${i}`, kind: 'message', text: `text-${i}` }] as never
    })
  }
  await a.flushBrowseMemory()
  const b = await load()
  const state = b.useBrowseMemory.getState()
  // Oldest two sessions (s-1, s-2) should have messages evicted, while drafts remain
  const entry1 = state.entries[b.browseKey(scope, 's-1')]!
  const entry2 = state.entries[b.browseKey(scope, 's-2')]!
  expect(entry1.draft).toBe('draft-1')
  expect(entry1.messages).toBeUndefined()
  expect(entry2.draft).toBe('draft-2')
  expect(entry2.messages).toBeUndefined()
  // Sessions 3 to 12 should retain their messages
  for (let i = 3; i <= 12; i++) {
    const entry = state.entries[b.browseKey(scope, `s-${i}`)]!
    expect(entry.messages).toBeDefined()
    expect(entry.messages).toHaveLength(1)
  }
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

it('persists group rounds with history and isolates scopes', async () => {
  const memory = await load()
  memory.saveGroupRound('host-a', 'room', 'range', [{ text: 'hello', nested: { private: true } }])
  expect(memory.getCachedGroupRound('host-b', 'room', 'range')).toBeUndefined()
  await memory.flushBrowseMemory()
  const restored = await load()
  expect(restored.getCachedGroupRound('host-a', 'room', 'range')).toEqual([{ text: 'hello' }])
  await restored.clearBrowseMemory()
  expect(restored.getCachedGroupRound('host-a', 'room', 'range')).toBeUndefined()
})
