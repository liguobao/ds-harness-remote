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

  it('refuses to replace missing or changed storage after a persisted legacy fallback', async () => {
    for (const scenario of ['missing', 'replaced']) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const original = await new IdentityStore({ directory: source }).loadOrCreate('Host')
      vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('move unavailable'), { code: 'EACCES' }))
      await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })
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
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-plugin-'))
  directories.push(directory)
  return directory
}
