import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
    const dead = await deadPid()
    for (const role of ['flat', 'host', 'client'] as const) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const directory = role === 'flat' ? source : serverStorageDirectory(source, 'https://example.com', role)
      const store = new IdentityStore({ directory })
      const identity = await store.loadOrCreate('Host')
      await store.trustPeer({ deviceId: identity.deviceId, name: 'Peer', platform: 'linux', publicKey: identity.publicKey })
      const peers = await readFile(join(directory, 'trusted-peers.json'))
      const temps = [
        `trusted-peers.json.${dead}.01a1b6d8-e8b5-7000-8000-000000000001.tmp`,
        `server-credentials.json.${dead}.01a1b6d8-e8b5-7000-8000-000000000002.tmp`,
        `device.json.${dead}.01a1b6d8-e8b5-7000-8000-000000000003.tmp`,
        `device.key.${dead}.01a1b6d8-e8b5-7000-8000-000000000004.tmp`,
        `host-pairing.json.${dead}.01a1b6d8-e8b5-7000-8000-000000000005.tmp`,
        `pairing-host-only.json.${dead}.01a1b6d8-e8b5-7000-8000-000000000006.tmp`,
      ]
      for (const temp of temps) {
        await writeFile(join(directory, temp), '{partial', { mode: 0o600 })
      }
      const target = await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })
      const moved = directory.replace(source, target)
      for (const temp of temps) {
        expect(await readFile(join(moved, temp), 'utf8')).toBe('{partial')
      }
      const reopened = new IdentityStore({ directory: moved })
      expect(await reopened.loadOrCreate('Host')).toEqual(identity)
      expect(await readFile(join(moved, 'trusted-peers.json'))).toEqual(peers)
      const remaining = await readdir(moved)
      for (const temp of temps) {
        expect(remaining).not.toContain(temp)
      }
    }
  })

  it('preserves in-flight credential and peer temporary files owned by a live process until rename completes', async () => {
    const directory = await temporaryDirectory()
    const store = new IdentityStore({ directory })
    const identity = await store.loadOrCreate('Host')
    const inFlightCredTemp = `server-credentials.json.${process.pid}.01a1b6d8-e8b5-7000-8000-000000000002.tmp`
    const inFlightPeerTemp = `trusted-peers.json.${process.pid}.01a1b6d8-e8b5-7000-8000-000000000001.tmp`
    const dead = await deadPid()
    const staleCredTemp = `server-credentials.json.${dead}.01a1b6d8-e8b5-7000-8000-000000000003.tmp`
    await writeFile(join(directory, inFlightCredTemp), '{"schemaVersion":1}\n', { mode: 0o600 })
    await writeFile(join(directory, inFlightPeerTemp), '{"schemaVersion":1,"peers":[]}\n', { mode: 0o600 })
    await writeFile(join(directory, staleCredTemp), '{partial', { mode: 0o600 })

    // Concurrent loadOrCreate runs removeStaleTemporaries; live PID temps must survive so rename succeeds.
    expect(await new IdentityStore({ directory }).loadOrCreate('Host')).toEqual(identity)
    const afterLoad = await readdir(directory)
    expect(afterLoad).toContain(inFlightCredTemp)
    expect(afterLoad).toContain(inFlightPeerTemp)
    expect(afterLoad).not.toContain(staleCredTemp)
    await rename(join(directory, inFlightPeerTemp), join(directory, 'trusted-peers.json'))
    await rename(join(directory, inFlightCredTemp), join(directory, 'server-credentials.json'))

    // Migration must also refuse to move legacy storage while a live process has an unrenamed temp file.
    const home = await temporaryDirectory()
    const source = join(home, 'remote')
    const hostIdentity = await new IdentityStore({ directory: source }).loadOrCreate('Host')
    const liveMigrationTemp = join(source, inFlightCredTemp)
    const validCredPayload = JSON.stringify({
      schemaVersion: 1,
      serverUrl: 'https://dsh.r2049.cn',
      deviceId: hostIdentity.deviceId,
      authorizationMethod: 'account',
      account: 'host@example.com',
      accessToken: 'fixture-access-token',
      accessTokenExpiresAt: 1,
      refreshToken: 'fixture-refresh-token',
      refreshTokenExpiresAt: 2,
    })
    await writeFile(liveMigrationTemp, `${validCredPayload}\n`, { mode: 0o600 })
    await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })).rejects.toMatchObject({
      code: 'IDENTITY_LOCKED',
    })
    await rename(liveMigrationTemp, join(source, 'server-credentials.json'))
    await chmod(join(source, 'server-credentials.json'), 0o600)
    expect(await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })).toBe(join(home, 'ds-harness-remote'))
  })

  it('reclaims exited-owner identity and interrupted real-hash takeover locks during migration and runtime load while preserving live lock and concurrent takeover protection', async () => {
    const [deadOwner, deadContender, deadSecondContender] = await deadPids()
    expect(new Set([deadOwner, deadContender, deadSecondContender]).size).toBe(3)
    const lockRecord = `${deadOwner}\n`
    const takeoverRecord = `${deadContender}\n`
    const realTakeover = `device.lock.takeover-${createHash('sha256').update(lockRecord).digest('hex').slice(0, 16)}`
    const secondTakeover = `device.lock.takeover-${createHash('sha256').update(`${realTakeover}\n${takeoverRecord}`).digest('hex').slice(0, 16)}`
    const serverUrl = 'https://example.com'

    for (const role of ['flat', 'host', 'client'] as const) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const directory = role === 'flat' ? source : serverStorageDirectory(source, serverUrl, role)
      const store = new IdentityStore({ directory, role: role === 'flat' ? undefined : role })
      const identity = await store.loadOrCreate('Host')
      await store.trustPeer({ deviceId: identity.deviceId, name: 'Peer', platform: 'linux', publicKey: identity.publicKey })
      const credentials = await new ServerCredentialStore(directory).save({
        serverUrl,
        deviceId: identity.deviceId,
        authorizationMethod: 'owned_device',
        accessToken: 'fixture-access-token',
        accessTokenExpiresAt: 1,
        refreshToken: 'fixture-refresh-token',
        refreshTokenExpiresAt: 2,
      })
      const deviceJsonBytes = await readFile(join(directory, 'device.json'))
      const deviceKeyBytes = await readFile(join(directory, 'device.key'))
      const peersBytes = await readFile(join(directory, 'trusted-peers.json'))
      const credentialBytes = await readFile(join(directory, 'server-credentials.json'))

      await writeFile(join(directory, 'device.lock'), lockRecord, { mode: 0o600 })
      await writeFile(join(directory, realTakeover), takeoverRecord, { mode: 0o600 })
      await writeFile(join(directory, secondTakeover), `${deadSecondContender}\n`, { mode: 0o600 })

      const target = await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })
      expect(target).toBe(join(home, 'ds-harness-remote'))
      const moved = directory.replace(source, target)
      expect(await readdir(moved)).not.toContain('device.lock')
      expect(await readdir(moved)).not.toContain(realTakeover)
      expect(await readdir(moved)).not.toContain(secondTakeover)
      expect(await readFile(join(moved, 'device.json'))).toEqual(deviceJsonBytes)
      expect(await readFile(join(moved, 'device.key'))).toEqual(deviceKeyBytes)
      expect(await readFile(join(moved, 'trusted-peers.json'))).toEqual(peersBytes)
      expect(await readFile(join(moved, 'server-credentials.json'))).toEqual(credentialBytes)

      // Also verify direct runtime withIdentityLock recovery when device.lock and chained real-hash takeover files remain.
      await writeFile(join(moved, 'device.lock'), lockRecord, { mode: 0o600 })
      await writeFile(join(moved, realTakeover), takeoverRecord, { mode: 0o600 })
      await writeFile(join(moved, secondTakeover), `${deadSecondContender}\n`, { mode: 0o600 })
      const reopened = new IdentityStore({ directory: moved, role: role === 'flat' ? undefined : role })
      expect(await reopened.loadOrCreate('Host')).toEqual(identity)
      expect(reopened.listTrustedPeers()).toEqual(store.listTrustedPeers())
      expect(await new ServerCredentialStore(moved).load(serverUrl, identity.deviceId)).toEqual(credentials)
      expect(await readdir(moved)).not.toContain('device.lock')
      expect(await readdir(moved)).not.toContain(realTakeover)
      expect(await readdir(moved)).not.toContain(secondTakeover)
      expect(await readFile(join(moved, 'device.json'))).toEqual(deviceJsonBytes)
      expect(await readFile(join(moved, 'device.key'))).toEqual(deviceKeyBytes)
      expect(await readFile(join(moved, 'trusted-peers.json'))).toEqual(peersBytes)
      expect(await readFile(join(moved, 'server-credentials.json'))).toEqual(credentialBytes)
    }

    // Live lock owner or live concurrent takeover contender must reject with IDENTITY_LOCKED without altering any file.
    for (const liveScenario of ['live-lock-with-dead-takeover', 'dead-lock-with-live-takeover'] as const) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const hostDir = serverStorageDirectory(source, serverUrl, 'host')
      const store = new IdentityStore({ directory: hostDir, role: 'host' })
      const identity = await store.loadOrCreate('Host')
      await store.trustPeer({ deviceId: identity.deviceId, name: 'Peer', platform: 'linux', publicKey: identity.publicKey })
      await new ServerCredentialStore(hostDir).save({
        serverUrl,
        deviceId: identity.deviceId,
        authorizationMethod: 'owned_device',
        accessToken: 'fixture-access-token',
        accessTokenExpiresAt: 1,
        refreshToken: 'fixture-refresh-token',
        refreshTokenExpiresAt: 2,
      })
      const activeLockRecord = liveScenario === 'live-lock-with-dead-takeover' ? `${process.pid}\n` : lockRecord
      const activeTakeoverName = `device.lock.takeover-${createHash('sha256').update(activeLockRecord).digest('hex').slice(0, 16)}`
      const activeTakeoverRecord = liveScenario === 'live-lock-with-dead-takeover' ? `${deadContender}\n` : `${process.pid}\n`
      await writeFile(join(hostDir, 'device.lock'), activeLockRecord, { mode: 0o600 })
      await writeFile(join(hostDir, activeTakeoverName), activeTakeoverRecord, { mode: 0o600 })
      const beforeEntries = (await readdir(hostDir)).sort()
      const beforeBytes = new Map(await Promise.all(
        beforeEntries.map(async name => [name, await readFile(join(hostDir, name))] as const),
      ))

      await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } }), liveScenario).rejects.toMatchObject({
        code: 'IDENTITY_LOCKED',
      })
      expect((await readdir(hostDir)).sort(), liveScenario).toEqual(beforeEntries)
      for (const [name, bytes] of beforeBytes) {
        expect(await readFile(join(hostDir, name)), `${liveScenario}:${name}`).toEqual(bytes)
      }
      await expect(stat(join(home, 'ds-harness-remote'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('migrates valid host storage alongside an empty client directory, rotated client credential or uncredentialed broken flat root', async () => {
    const serverUrl = 'https://dsh.r2049.cn'
    for (const scenario of [
      'empty-client',
      'rotated-client-credential',
      'broken-flat-root',
      'corrupt-flat-json',
      'invalid-flat-schema',
      'corrupt-flat-key',
    ] as const) {
      const home = await temporaryDirectory()
      const source = join(home, 'remote')
      const hostDir = serverStorageDirectory(source, serverUrl, 'host')
      const clientDir = serverStorageDirectory(source, serverUrl, 'client')
      const hostIdentity = await new IdentityStore({ directory: hostDir, role: 'host' }).loadOrCreate('Host')
      await new ServerCredentialStore(hostDir).save({
        serverUrl,
        deviceId: hostIdentity.deviceId,
        authorizationMethod: 'account',
        account: 'host@example.com',
        accessToken: 'fixture-access-token',
        accessTokenExpiresAt: 1,
        refreshToken: 'fixture-refresh-token',
        refreshTokenExpiresAt: 2,
      })
      const hostCredentialBytes = await readFile(join(hostDir, 'server-credentials.json'))

      if (scenario === 'empty-client') {
        await mkdir(clientDir, { recursive: true })
      }
      if (scenario === 'rotated-client-credential') {
        const oldClient = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Old Client')
        await new IdentityStore({ directory: clientDir, role: 'client' }).loadOrCreate('Client')
        await new ServerCredentialStore(clientDir).save({
          serverUrl,
          deviceId: oldClient.deviceId,
          authorizationMethod: 'account',
          account: 'host@example.com',
          accessToken: 'stale-client-access-token',
          accessTokenExpiresAt: 1,
          refreshToken: 'stale-client-refresh-token',
          refreshTokenExpiresAt: 2,
        })
      }
      if (scenario === 'broken-flat-root') {
        const other = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Other')
        await new IdentityStore({ directory: source }).loadOrCreate('Flat')
        await writeFile(join(source, 'device.key'), `${other.privateKey}\n`, { mode: 0o600 })
      }
      if (scenario === 'corrupt-flat-json') {
        await new IdentityStore({ directory: source }).loadOrCreate('Flat')
        await writeFile(join(source, 'device.json'), '{corrupt-json', { mode: 0o600 })
      }
      if (scenario === 'invalid-flat-schema') {
        await new IdentityStore({ directory: source }).loadOrCreate('Flat')
        await writeFile(join(source, 'device.json'), '{"schemaVersion":99}', { mode: 0o600 })
      }
      if (scenario === 'corrupt-flat-key') {
        await new IdentityStore({ directory: source }).loadOrCreate('Flat')
        await writeFile(join(source, 'device.key'), 'not-a-32-byte-private-key\n', { mode: 0o600 })
      }

      const target = await prepareDefaultIdentityDirectory({ env: { DSH_HOME: home } })
      expect(target, scenario).toBe(join(home, 'ds-harness-remote'))
      const movedHostDir = serverStorageDirectory(target, serverUrl, 'host')
      expect(await new IdentityStore({ directory: movedHostDir, role: 'host' }).loadOrCreate('Host'), scenario).toEqual(hostIdentity)
      expect(await readFile(join(movedHostDir, 'server-credentials.json')), scenario).toEqual(hostCredentialBytes)
      if (scenario.includes('flat')) {
        const healedFlat = await new IdentityStore({ directory: target }).loadOrCreate('Flat')
        expect(healedFlat.publicKey, scenario).toBeDefined()
        expect(await new IdentityStore({ directory: movedHostDir, role: 'host' }).loadOrCreate('Host'), scenario).toEqual(hostIdentity)
      }
    }

    // Broken flat root without a verified scoped identity must still be rejected.
    const unverifiedHome = await temporaryDirectory()
    const unverifiedSource = join(unverifiedHome, 'remote')
    const unverifiedClientDir = serverStorageDirectory(unverifiedSource, serverUrl, 'client')
    const other = await new IdentityStore({ directory: await temporaryDirectory() }).loadOrCreate('Other')
    await new IdentityStore({ directory: unverifiedSource }).loadOrCreate('Flat')
    await writeFile(join(unverifiedSource, 'device.key'), `${other.privateKey}\n`, { mode: 0o600 })
    await mkdir(unverifiedClientDir, { recursive: true })
    await writeFile(join(unverifiedClientDir, 'device.json'), '{corrupt-client-json', { mode: 0o600 })
    await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: unverifiedHome } })).rejects.toMatchObject({
      code: 'IDENTITY_INVALID',
    })
    await expect(new IdentityStore({ directory: unverifiedSource }).loadOrCreate('Flat')).rejects.toThrow(IdentityInvalidError)

    // Flat root credential with mismatched deviceId must still be rejected even when a valid scoped host exists.
    const mismatchHome = await temporaryDirectory()
    const mismatchSource = join(mismatchHome, 'remote')
    const mismatchHostDir = serverStorageDirectory(mismatchSource, serverUrl, 'host')
    const validHost = await new IdentityStore({ directory: mismatchHostDir, role: 'host' }).loadOrCreate('Host')
    await new IdentityStore({ directory: mismatchSource }).loadOrCreate('Flat')
    await new ServerCredentialStore(mismatchSource).save({
      serverUrl,
      deviceId: validHost.deviceId,
      authorizationMethod: 'account',
      account: 'host@example.com',
      accessToken: 'fixture-access-token',
      accessTokenExpiresAt: 1,
      refreshToken: 'fixture-refresh-token',
      refreshTokenExpiresAt: 2,
    })
    await expect(prepareDefaultIdentityDirectory({ env: { DSH_HOME: mismatchHome } })).rejects.toMatchObject({
      code: 'IDENTITY_INVALID',
    })

    // Symlinked device.json in scoped host must not authorize flat root self-heal.
    const symlinkScopedRoot = await temporaryDirectory()
    const externalDir = await temporaryDirectory()
    const externalIdentity = await new IdentityStore({ directory: externalDir }).loadOrCreate('External')
    const symlinkHostDir = serverStorageDirectory(symlinkScopedRoot, serverUrl, 'host')
    await mkdir(symlinkHostDir, { recursive: true })
    await writeFile(join(symlinkHostDir, 'device.key'), `${externalIdentity.privateKey}\n`, { mode: 0o600 })
    await symlink(join(externalDir, 'device.json'), join(symlinkHostDir, 'device.json'))
    await new IdentityStore({ directory: symlinkScopedRoot }).loadOrCreate('Flat')
    const brokenFlatKey = `${other.privateKey}\n`
    await writeFile(join(symlinkScopedRoot, 'device.key'), brokenFlatKey, { mode: 0o600 })
    await expect(new IdentityStore({ directory: symlinkScopedRoot }).loadOrCreate('Flat')).rejects.toThrow(IdentityInvalidError)
    expect(await readFile(join(symlinkScopedRoot, 'device.key'), 'utf8')).toBe(brokenFlatKey)
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

    for (const scenario of ['credentials', 'trusted-peers', 'corrupt-peers', 'unknown-file', 'unexpected-servers-dir', 'host-role'] as const) {
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
      if (scenario === 'unexpected-servers-dir') {
        await mkdir(join(directory, 'servers'), { recursive: true })
      }

      const beforeEntries = (await readdir(directory)).sort()
      const beforeBytes = new Map(await Promise.all(
        beforeEntries
          .filter(name => name !== 'servers')
          .map(async name => [name, await readFile(join(directory, name))] as const),
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

let cachedDeadPids: Promise<[number, number, number]> | undefined

async function deadPids(): Promise<[number, number, number]> {
  cachedDeadPids ??= (async () => {
    const first = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 50)'], { stdio: 'ignore' })
    const second = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 50)'], { stdio: 'ignore' })
    const third = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await Promise.all([
      new Promise<void>(resolve => first.once('exit', () => resolve())),
      new Promise<void>(resolve => second.once('exit', () => resolve())),
      new Promise<void>(resolve => third.once('exit', () => resolve())),
    ])
    return [first.pid!, second.pid!, third.pid!]
  })()
  return cachedDeadPids
}

async function deadPid(): Promise<number> {
  const [first] = await deadPids()
  return first
}
