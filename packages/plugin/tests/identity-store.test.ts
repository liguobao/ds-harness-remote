import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IdentityInvalidError, IdentityStore, serverStorageDirectory } from '../src/identity-store.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('IdentityStore', () => {
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
