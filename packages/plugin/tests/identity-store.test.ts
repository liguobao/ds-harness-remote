import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdentityInvalidError, IdentityStore, prepareDefaultIdentityDirectory, serverStorageDirectory } from '../src/identity-store.js'

import { ServerCredentialStore } from '../src/server-credentials.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('IdentityStore', () => {
  it('moves all Server roles without changing identities, trust or credential bytes, and serializes repeated migration', async () => {
    const home = await temporaryDirectory()
    const env = { DSH_HOME: home }
    const source = join(home, 'remote')
    const target = join(home, 'ds-harness-remote')
    const records: Array<{ directory: string; identity: Awaited<ReturnType<IdentityStore['loadOrCreate']>>; peers: unknown; files: Map<string, Buffer> }> = []
    for (const origin of ['https://first.example.com', 'https://second.example.com']) {
      for (const role of ['host', 'client'] as const) {
        const directory = serverStorageDirectory(source, origin, role)
        const store = new IdentityStore({ directory })
        const identity = await store.loadOrCreate('Host')
        await store.trustPeer({ deviceId: identity.deviceId, name: 'Peer', platform: 'linux', publicKey: identity.publicKey })
        await new ServerCredentialStore(directory).save({ serverUrl: origin, deviceId: identity.deviceId, authorizationMethod: 'owned_device', accessToken: 'fixture-access-token', accessTokenExpiresAt: 1, refreshToken: 'fixture-refresh-token', refreshTokenExpiresAt: 2 })
        const files = new Map<string, Buffer>()
        for (const file of await readdir(directory)) files.set(file, await readFile(join(directory, file)))
        records.push({ directory, identity, peers: store.listTrustedPeers(), files })
      }
    }
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await Promise.all(Array.from({ length: 3 }, () => prepareDefaultIdentityDirectory({ env })))).toEqual([target, target, target])
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const record of records) {
      const directory = record.directory.replace(source, target)
      for (const [file, bytes] of record.files) expect(await readFile(join(directory, file))).toEqual(bytes)
      const store = new IdentityStore({ directory })
      expect(await store.loadOrCreate('Host')).toEqual(record.identity)
      expect(store.listTrustedPeers()).toEqual(record.peers)
      if (process.platform !== 'win32') expect((await stat(join(directory, 'device.key'))).mode & 0o777).toBe(0o600)
    }
    expect(new IdentityStore({ env }).directory).toBe(target)
    expect(await prepareDefaultIdentityDirectory({ env })).toBe(target)
  })

  it('migrates interrupted peer writes for flat, host and client storage and cleans only known temporaries', async () => {
    for (const role of ['flat', 'host', 'client'] as const) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const directory = role === 'flat' ? source : serverStorageDirectory(source, 'https://example.com', role)
      const store = new IdentityStore({ directory })
      const identity = await store.loadOrCreate('Host')
      await store.trustPeer({ deviceId: identity.deviceId, name: 'Peer', platform: 'linux', publicKey: identity.publicKey })
      const peers = await readFile(join(directory, 'trusted-peers.json'))
      const temp = 'trusted-peers.json.33208.01a1b6d8-e8b5-7000-8000-000000000001.tmp'
      await writeFile(join(directory, temp), '{partial')
      const target = await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })
      const moved = directory.replace(source, target)
      expect(await readFile(join(moved, temp), 'utf8')).toBe('{partial')
      const reopened = new IdentityStore({ directory: moved })
      expect(await reopened.loadOrCreate('Host')).toEqual(identity)
      expect(await readFile(join(moved, 'trusted-peers.json'))).toEqual(peers)
      expect(await readdir(moved)).not.toContain(temp)
    }
  })

  it('rejects unknown or malformed peer temporary names without deleting them', async () => {
    for (const name of ['foreign.json.1.01a1b6d8-e8b5-7000-8000-000000000001.tmp', 'trusted-peers.json.other.tmp']) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      await new IdentityStore({ directory: source }).loadOrCreate('Host')
      await writeFile(join(source, name), 'keep')
      await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })).rejects.toMatchObject({ code: 'STORAGE_CONFLICT' })
      await new IdentityStore({ directory: source }).loadOrCreate('Host')
      expect(await readFile(join(source, name), 'utf8')).toBe('keep')
    }
  })

  it('refuses conflicting roots, lock records and symlinks without modifying either storage tree', async () => {
    for (const scenario of ['conflict', 'destination-race', 'identity-lock', 'refresh-lock', 'symlink']) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const target = join(home, 'ds-harness-remote')
      const original = await new IdentityStore({ directory: source }).loadOrCreate('Host')
      if (scenario === 'conflict') await mkdir(target)
      if (scenario === 'destination-race') vi.mocked(rename).mockImplementationOnce(async (_source, destination) => {
        await mkdir(destination)
        throw Object.assign(new IdentityInvalidError('destination appeared'), { code: 'EEXIST' })
      })
      if (scenario === 'identity-lock') await writeFile(join(source, 'device.lock'), String(process.pid))
      if (scenario === 'refresh-lock') await mkdir(join(source, 'server-credentials.json.refresh-lock'))
      if (scenario === 'symlink') await symlink(join(source, 'device.key'), join(source, 'linked'))
      await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } }), scenario).rejects.toBeInstanceOf(IdentityInvalidError)
      expect((await readFile(join(source, 'device.key'), 'utf8')).trim()).toBe(original.privateKey)
      if (!['conflict', 'destination-race'].includes(scenario)) await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    const directory = await temporaryDirectory()
    expect(await prepareDefaultIdentityDirectory({ directory })).toBe(directory)
  })

  it('moves an idle refresh queue marker and rejects an active queue holder', async () => {
    const home = await temporaryDirectory()
    const source = join(home, 'remote')
    await new IdentityStore({ directory: source }).loadOrCreate('Host')
    await new ServerCredentialStore(source).withRefreshLock(async () => undefined)
    const marker = join(source, 'server-credentials.json.refresh-lock')
    expect(await readFile(marker, 'utf8')).toBe('DSH_REFRESH_LOCK_V2\n')
    const holder = `${marker}.holder-${process.pid}-00000000-0000-7000-8000-000000000000`
    await writeFile(holder, `${process.pid}-00000000-0000-7000-8000-000000000000 1\n`)
    await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })).rejects.toMatchObject({ code: 'STORAGE_CONFLICT' })
    await rm(holder)
    expect(await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })).toBe(join(home, 'ds-harness-remote'))
    expect(await readFile(join(home, 'ds-harness-remote', 'server-credentials.json.refresh-lock'), 'utf8'))
      .toBe('DSH_REFRESH_LOCK_V2\n')
  })

  it('keeps using verified legacy identities, trust and authorization when the directory move fails', async () => {
    for (const code of ['EACCES', 'EPERM', 'EBUSY', 'EXDEV', 'EROFS', 'ENOSPC', 'EDQUOT']) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const env = { DSH_HOME: home }
      const store = new IdentityStore({ directory: source })
      const original = await store.loadOrCreate('Host')
      await store.trustPeer({ deviceId: original.deviceId, name: 'Peer', platform: 'linux', publicKey: original.publicKey })
      const credentials = await new ServerCredentialStore(source).save({ serverUrl: 'https://first.example.com', deviceId: original.deviceId, authorizationMethod: 'owned_device', accessToken: 'fixture-access-token', accessTokenExpiresAt: 1, refreshToken: 'fixture-refresh-token', refreshTokenExpiresAt: 2 })
      const bytes = await readFile(join(source, 'server-credentials.json'))
      vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('move unavailable'), { code }))
      expect(await prepareDefaultIdentityDirectory({ env }), code).toBe(source)
      // A subsequent default-store load must adopt the fallback, without retrying
      // the move or creating a replacement identity at the canonical path.
      const fallback = new IdentityStore({ env })
      expect(await fallback.loadOrCreate('Host'), code).toEqual(original)
      expect(fallback.directory).toBe(source)
      expect(fallback.listTrustedPeers()).toEqual(store.listTrustedPeers())
      expect(await new ServerCredentialStore(fallback.directory).load(credentials.serverUrl, original.deviceId)).toEqual(credentials)
      expect(await readFile(join(source, 'server-credentials.json'))).toEqual(bytes)
      await expect(stat(join(home, 'ds-harness-remote'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('refuses to replace missing or changed storage after a persisted legacy fallback and preserves 64-bit NTFS inode precision', async () => {
    for (const scenario of ['missing', 'replaced', 'float-pin', 'high-bit-ino']) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const original = await new IdentityStore({ directory: source }).loadOrCreate('Host')
      vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('move unavailable'), { code: 'EACCES' }))
      await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })
      const pinPath = join(home, '.ds-harness-remote-migration', 'legacy-root.json')
      if (scenario === 'float-pin') {
        await writeFile(pinPath, JSON.stringify({ schemaVersion: 1, dev: 1.5, ino: 2.5 }), { mode: 0o600 })
        await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } }), scenario).rejects.toBeInstanceOf(IdentityInvalidError)
        continue
      }
      if (scenario === 'high-bit-ino') {
        const pinned = JSON.parse(await readFile(pinPath, 'utf8')) as { dev: number | string; ino: number | string }
        const lowBitChanged = (BigInt(pinned.ino) ^ 1n).toString()
        await writeFile(pinPath, JSON.stringify({ schemaVersion: 1, dev: String(pinned.dev), ino: lowBitChanged }), { mode: 0o600 })
        await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } }), scenario).rejects.toThrow('changed after fallback')
        continue
      }
      const backup = join(home, 'preserved')
      await rename(source, backup)
      if (scenario === 'replaced') await new IdentityStore({ directory: source }).loadOrCreate('Other Host')
      await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } }), scenario).rejects.toBeInstanceOf(IdentityInvalidError)
      expect((await readFile(join(backup, 'device.key'), 'utf8')).trim()).toBe(original.privateKey)
      await expect(stat(join(home, 'ds-harness-remote'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('leaves foreign, mixed and inconsistent legacy contents untouched instead of claiming ownership', async () => {
    for (const scenario of ['foreign', 'empty', 'mixed', 'wrong-key', 'bad-peers', 'wrong-device', 'wrong-scope', 'unknown-role']) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      await mkdir(source)
      const env = { DSH_HOME: home }
      if (scenario === 'foreign') await writeFile(join(source, 'settings.json'), '{"owner":"other-plugin"}')
      if (!['foreign', 'empty'].includes(scenario)) {
        const origin = 'https://first.example.com'
        const directory = scenario === 'wrong-scope'
          ? join(source, 'servers', '0'.repeat(24), 'host')
          : scenario === 'unknown-role'
            ? join(source, 'servers', '0'.repeat(24), 'other')
            : serverStorageDirectory(source, origin, 'host')
        const identity = await new IdentityStore({ directory }).loadOrCreate('Host')
        if (scenario === 'mixed') await writeFile(join(directory, 'foreign.txt'), 'leave-this-alone')
        if (scenario === 'wrong-key') await writeFile(join(directory, 'device.key'), 'invalid-private-key')
        if (scenario === 'bad-peers') await writeFile(join(directory, 'trusted-peers.json'), '{"schemaVersion":1,"peers":[{}]}')
        if (scenario === 'wrong-device' || scenario === 'wrong-scope') {
          await new ServerCredentialStore(directory).save({ serverUrl: origin, deviceId: scenario === 'wrong-device' ? 'another-device' : identity.deviceId, authorizationMethod: 'owned_device', accessToken: 'fixture-access-token', accessTokenExpiresAt: 1, refreshToken: 'fixture-refresh-token', refreshTokenExpiresAt: 2 })
        }
      }
      const snapshot = async (directory: string): Promise<unknown> => {
        const values: Record<string, unknown> = {}
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          values[entry.name] = entry.isDirectory() ? await snapshot(join(directory, entry.name)) : await readFile(join(directory, entry.name))
        }
        return values
      }
      const before = await snapshot(source)
      await expect(prepareDefaultIdentityDirectory({ env }), scenario).rejects.toThrow('ownership could not be verified')
      expect(await snapshot(source), scenario).toEqual(before)
      await expect(stat(join(home, 'ds-harness-remote'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('creates and reloads one stable device identity', async () => {
    const directory = await temporaryDirectory()
    const first = await new IdentityStore({ directory }).loadOrCreate('Workstation')
    const second = await new IdentityStore({ directory }).loadOrCreate('Renamed workstation')
    expect(second).toMatchObject({ deviceId: first.deviceId, publicKey: first.publicKey, privateKey: first.privateKey, name: 'Renamed workstation' })
    expect(first.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    if (process.platform !== 'win32') {
      expect((await stat(join(directory, 'device.key'))).mode & 0o777).toBe(0o600)
    }
  })

  it('persists trusted peers without private material', async () => {
    const hostDirectory = await temporaryDirectory()
    const clientDirectory = await temporaryDirectory()
    const hostStore = new IdentityStore({ directory: hostDirectory })
    await hostStore.loadOrCreate('Host')
    const client = await new IdentityStore({ directory: clientDirectory }).loadOrCreate('Client')
    await hostStore.trustPeer({ deviceId: client.deviceId, name: client.name, platform: 'linux', publicKey: client.publicKey })
    const stored = await readFile(join(hostDirectory, 'trusted-peers.json'), 'utf8')
    expect(stored).toContain(client.publicKey)
    expect(stored).not.toContain(client.privateKey)
    expect(hostStore.isTrusted(client.deviceId, client.publicKey)).toBe(true)
  })

  it('reloads all trusted peers after discovering more than 256 hosts', async () => {
    const directory = await temporaryDirectory()
    const store = new IdentityStore({ directory })
    const identity = await store.loadOrCreate('Client')
    for (let index = 0; index < 301; index++) {
      await store.trustPeer({ deviceId: `host-${index}`, name: `Host ${index}`, platform: 'linux', publicKey: identity.publicKey })
    }
    const restarted = new IdentityStore({ directory })
    await expect(restarted.loadOrCreate('Client')).resolves.toMatchObject({ deviceId: identity.deviceId })
    expect(restarted.listTrustedPeers()).toEqual(store.listTrustedPeers())
    const file = join(directory, 'trusted-peers.json')
    const records = JSON.parse(await readFile(file, 'utf8'))
    records.peers[300].fingerprint = 'invalid'
    await writeFile(file, JSON.stringify(records), { mode: 0o600 })
    await expect(new IdentityStore({ directory }).loadOrCreate('Client')).rejects.toThrow(/invalid fingerprint/)
  })

  it('fails closed for incomplete or overly permissive identity files', async () => {
    const incomplete = await temporaryDirectory()
    await writeFile(join(incomplete, 'device.json'), '{}')
    await expect(new IdentityStore({ directory: incomplete }).loadOrCreate('Host')).rejects.toBeInstanceOf(IdentityInvalidError)

    if (process.platform !== 'win32') {
      const permissive = await temporaryDirectory()
      await new IdentityStore({ directory: permissive }).loadOrCreate('Host')
      await chmod(join(permissive, 'device.key'), 0o644)
      await expect(new IdentityStore({ directory: permissive }).loadOrCreate('Host')).rejects.toThrow(/0600/)
    }
  })

  it('isolates Host and Client identities by normalized Server origin', async () => {
    const root = await temporaryDirectory()
    const firstHost = serverStorageDirectory(root, 'https://one.example.com', 'host')
    const firstClient = serverStorageDirectory(root, 'https://one.example.com', 'client')
    const secondHost = serverStorageDirectory(root, 'https://two.example.com', 'host')
    expect(firstHost).not.toBe(firstClient)
    expect(firstHost).not.toBe(secondHost)
    expect(serverStorageDirectory(root, 'https://one.example.com/', 'host')).toBe(firstHost)
  })

  it('serializes concurrent first-time creation onto one key pair', async () => {
    const directory = await temporaryDirectory()
    // Two Stores over one directory model the real incident: a Desktop restart
    // overlapping the previous Host process, both reaching the "create" branch.
    const stores = Array.from({ length: 6 }, () => new IdentityStore({ directory }))
    const created = await Promise.all(stores.map(store => store.loadOrCreate('Workstation')))
    const [first] = created
    for (const identity of created) {
      expect(identity).toMatchObject({ deviceId: first!.deviceId, publicKey: first!.publicKey, privateKey: first!.privateKey })
    }
    // The pair left on disk must still be self-consistent.
    const reloaded = await new IdentityStore({ directory }).loadOrCreate('Workstation')
    expect(reloaded.publicKey).toBe(first!.publicKey)
    expect(reloaded.privateKey).toBe(first!.privateKey)
  })

  it('reports a mismatched key pair instead of silently minting a new identity', async () => {
    const directory = await temporaryDirectory()
    const original = await new IdentityStore({ directory }).loadOrCreate('Workstation')
    // Reproduce the incident's residue: overwrite the private key with an
    // unrelated one so the public key in device.json no longer matches.
    const other = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Other')
    await writeFile(join(directory, 'device.key'), `${other.privateKey}\n`)

    // Repair stays an explicit operator action: a silent rebuild would drop the
    // pinned peer trust and re-register the device without the user knowing.
    await expect(new IdentityStore({ directory }).loadOrCreate('Workstation'))
      .rejects.toThrow(/public and private keys do not match/)
    // The original record is left intact so the operator can still back it up.
    expect(JSON.parse(await readFile(join(directory, 'device.json'), 'utf8')).publicKey).toBe(original.publicKey)
  })

  it('keeps recovery material when the stored pair does not verify', async () => {
    const directory = await temporaryDirectory()
    const original = await new IdentityStore({ directory }).loadOrCreate('Workstation')
    const other = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Other')
    const residue = join(directory, 'device.key.57692.01a1a04a-7ced-7ffe-b382-e5a2e689f6ad.tmp')
    await writeFile(residue, `${original.privateKey}\n`)
    await writeFile(join(directory, 'device.key'), `${other.privateKey}\n`)

    await expect(new IdentityStore({ directory }).loadOrCreate('Workstation'))
      .rejects.toThrow(/public and private keys do not match/)
    // That temp is the only private key still matching device.json (#276), so a
    // failed verification must not delete it the way a successful one does.
    await expect(readFile(residue, 'utf8')).resolves.toContain(original.privateKey)
  })

  it('resets onto a fresh identity without leaving lock artifacts behind', async () => {
    const directory = await temporaryDirectory()
    const first = await new IdentityStore({ directory }).loadOrCreate('Workstation')
    const second = await new IdentityStore({ directory }).reset('Workstation')

    expect(second.deviceId).not.toBe(first.deviceId)
    expect((await readdir(directory)).sort()).toEqual(['device.json', 'device.key', 'trusted-peers.json'])
    await expect(new IdentityStore({ directory }).loadOrCreate('Workstation')).resolves.toMatchObject({
      deviceId: second.deviceId, publicKey: second.publicKey,
    })
  })

  it('clears temporary files left behind by an interrupted write', async () => {
    const directory = await temporaryDirectory()
    await new IdentityStore({ directory }).loadOrCreate('Workstation')
    const residue = join(directory, 'device.key.57692.01a1a04a-7ced-7ffe-b382-e5a2e689f6ad.tmp')
    await writeFile(residue, 'stale\n')

    await new IdentityStore({ directory }).loadOrCreate('Workstation')
    const remaining = (await readdir(directory)).filter(name => name.endsWith('.tmp'))
    expect(remaining).toEqual([])
  })

  it('self-heals uncredentialed unpeered corrupt or incomplete client identities including across legacy migration', async () => {
    const first = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Client 1')
    const second = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Client 2')

    for (const scenario of ['mismatched', 'device-only', 'key-only', 'legacy-upgrade', 'legacy-client-only'] as const) {
      if (scenario === 'legacy-client-only') {
        const home = await temporaryDirectory()
        const legacyRoot = join(home, 'remote')
        const serverUrl = 'https://dsh.r2049.cn'
        const legacyClientDir = serverStorageDirectory(legacyRoot, serverUrl, 'client')
        await mkdir(legacyClientDir, { recursive: true })
        await writeFile(join(legacyClientDir, 'device.json'), JSON.stringify({
          schemaVersion: 1,
          deviceId: first.deviceId,
          name: 'Client',
          publicKey: first.publicKey,
        }), { mode: 0o600 })
        await writeFile(join(legacyClientDir, 'device.key'), `${second.privateKey}\n`, { mode: 0o600 })

        const migratedRoot = await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })
        expect(migratedRoot).toBe(join(home, 'ds-harness-remote'))
        const migratedClientDir = serverStorageDirectory(migratedRoot, serverUrl, 'client')
        const healedClient = await new IdentityStore({ directory: migratedClientDir, role: 'client' }).loadOrCreate('Client')
        expect(healedClient.deviceId).not.toBe(first.deviceId)
        expect(await new IdentityStore({ directory: migratedClientDir, role: 'client' }).loadOrCreate('Client')).toEqual(healedClient)
        continue
      }
      if (scenario === 'legacy-upgrade') {
        const home = await temporaryDirectory()
        const legacyRoot = join(home, 'remote')
        const serverUrl = 'https://dsh.r2049.cn'
        const legacyHostDir = serverStorageDirectory(legacyRoot, serverUrl, 'host')
        const legacyClientDir = serverStorageDirectory(legacyRoot, serverUrl, 'client')
        const hostIdentity = await new IdentityStore({ directory: legacyHostDir, role: 'host' }).loadOrCreate('Host')
        await new ServerCredentialStore(legacyHostDir).save({
          serverUrl,
          deviceId: hostIdentity.deviceId,
          authorizationMethod: 'account',
          account: 'host@example.com',
          accessToken: 'fixture-access-token',
          accessTokenExpiresAt: 1,
          refreshToken: 'fixture-refresh-token',
          refreshTokenExpiresAt: 2,
        })
        const hostCredentialBytes = await readFile(join(legacyHostDir, 'server-credentials.json'))
        await mkdir(legacyClientDir, { recursive: true })
        await writeFile(join(legacyClientDir, 'device.json'), JSON.stringify({
          schemaVersion: 1,
          deviceId: first.deviceId,
          name: 'Client',
          publicKey: first.publicKey,
        }), { mode: 0o600 })
        await writeFile(join(legacyClientDir, 'device.key'), `${second.privateKey}\n`, { mode: 0o600 })

        const migratedRoot = await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })
        expect(migratedRoot).toBe(join(home, 'ds-harness-remote'))
        const migratedHostDir = serverStorageDirectory(migratedRoot, serverUrl, 'host')
        const migratedClientDir = serverStorageDirectory(migratedRoot, serverUrl, 'client')
        expect(await new IdentityStore({ directory: migratedHostDir, role: 'host' }).loadOrCreate('Host')).toEqual(hostIdentity)
        expect(await readFile(join(migratedHostDir, 'server-credentials.json'))).toEqual(hostCredentialBytes)
        const healedClient = await new IdentityStore({ directory: migratedClientDir, role: 'client' }).loadOrCreate('Client')
        expect(healedClient.deviceId).not.toBe(first.deviceId)
        expect(await new IdentityStore({ directory: migratedClientDir, role: 'client' }).loadOrCreate('Client')).toEqual(healedClient)
        continue
      }

      const directory = await temporaryDirectory()
      if (scenario !== 'key-only') {
        await writeFile(join(directory, 'device.json'), JSON.stringify({
          schemaVersion: 1,
          deviceId: first.deviceId,
          name: 'Client',
          publicKey: first.publicKey,
        }))
      }
      if (scenario !== 'device-only') {
        await writeFile(join(directory, 'device.key'), `${second.privateKey}\n`)
      }
      const healed = await new IdentityStore({ directory, role: 'client' }).loadOrCreate('Client')
      expect(healed.publicKey, scenario).toBeDefined()
      expect(healed.privateKey, scenario).toBeDefined()
      const reloaded = await new IdentityStore({ directory, role: 'client' }).loadOrCreate('Client')
      expect(reloaded, scenario).toEqual(healed)
    }
  })

  it('refuses to auto-heal when credentials, trusted peers, unreadable peer records, or host role exist without altering stored bytes', async () => {
    const first = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Device 1')
    const second = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Device 2')

    for (const scenario of ['credentials', 'trusted-peers', 'corrupt-peers', 'unknown-file', 'host-role'] as const) {
      const directory = await temporaryDirectory()
      await writeFile(join(directory, 'device.json'), JSON.stringify({
        schemaVersion: 1,
        deviceId: first.deviceId,
        name: 'Device',
        publicKey: first.publicKey,
      }), { mode: 0o600 })
      await writeFile(join(directory, 'device.key'), `${second.privateKey}\n`, { mode: 0o600 })
      if (scenario === 'credentials') {
        await new ServerCredentialStore(directory).save({
          serverUrl: 'https://dsh.r2049.cn',
          deviceId: first.deviceId,
          authorizationMethod: 'owned_device',
          accessToken: 'token-access-12345',
          accessTokenExpiresAt: Date.now() + 60000,
          refreshToken: 'token-refresh-12345',
          refreshTokenExpiresAt: Date.now() + 600000,
        })
      }
      if (scenario === 'trusted-peers') {
        await writeFile(join(directory, 'trusted-peers.json'), JSON.stringify({
          schemaVersion: 1,
          peers: [{
            deviceId: 'peer-device-id',
            name: 'Peer',
            platform: 'linux',
            publicKey: first.publicKey,
            fingerprint: first.fingerprint,
            trustedAt: Date.now(),
          }],
        }))
      }
      if (scenario === 'corrupt-peers') {
        await writeFile(join(directory, 'trusted-peers.json'), '{corrupt-peers-json')
      }
      if (scenario === 'unknown-file') {
        await writeFile(join(directory, 'server-credentials.json.bak'), 'keep-me')
      }

      const beforeEntries = (await readdir(directory)).sort()
      const beforeBytes = new Map(await Promise.all(
        beforeEntries.map(async name => [name, await readFile(join(directory, name))] as const),
      ))

      const role = scenario === 'host-role' ? 'host' : 'client'
      await expect(new IdentityStore({ directory, role }).loadOrCreate('Device'), scenario)
        .rejects.toThrow(IdentityInvalidError)

      const afterEntries = (await readdir(directory)).sort()
      expect(afterEntries, scenario).toEqual(beforeEntries)
      for (const [name, bytes] of beforeBytes) {
        expect(await readFile(join(directory, name)), `${scenario}:${name}`).toEqual(bytes)
      }
    }
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-plugin-'))
  directories.push(directory)
  return directory
}
