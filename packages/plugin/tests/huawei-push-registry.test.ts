import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdentityStore } from '../src/identity-store.js'
import { HuaweiPushRegistry } from '../src/huawei-push-registry.js'
import type { AuthorizedPeerDevice } from '../src/server-api.js'
import type { HuaweiPushServiceAccount } from '../src/huawei-push-auth.js'

vi.mock('../src/huawei-push-sender.js', () => ({ sendHuaweiWakeup: vi.fn(async () => ({ httpStatus: 200 })) }))
import { sendHuaweiWakeup } from '../src/huawei-push-sender.js'

const dirs: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'push-registry-')); dirs.push(directory)
  const identities = new IdentityStore({ directory })
  await identities.loadOrCreate('host')
  await identities.trustPeer({ deviceId: 'client-a', publicKey: 'a2V5YQ', membershipId: 'member', name: 'client', platform: 'harmony' })
  const peer = { deviceId: 'client-a', identityKey: 'a2V5YQ' }
  const remote = { ...peer, role: 'client', name: 'client', platform: 'harmony', membershipId: 'member' } as AuthorizedPeerDevice
  const lookup = vi.fn(async () => remote)
  return { directory, identities, peer, remote, lookup, registry: new HuaweiPushRegistry(identities, lookup) }
}
const account = {} as HuaweiPushServiceAccount

describe('Huawei push registration authority', () => {
  it('binds registration to the trusted identity and uses a private atomic record', async () => {
    const { registry, peer, directory } = await setup()
    await expect(registry.register({ ...peer, identityKey: 'other' }, 'token')).rejects.toThrow()
    await registry.register(peer, 'token')
    expect((await stat(join(directory, 'huawei-push.json'))).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(join(directory, 'huawei-push.json'), 'utf8')).records[0].deviceId).toBe(peer.deviceId)
    await registry.send(peer.deviceId, account)
    expect(sendHuaweiWakeup).toHaveBeenCalledTimes(1)
  })
  it('fails closed when the server revokes, changes key or is unavailable', async () => {
    const { registry, peer, lookup, remote } = await setup()
    await registry.register(peer, 'token')
    lookup.mockRejectedValueOnce(new Error('offline'))
    expect(await registry.send(peer.deviceId, account)).toBeUndefined()
    lookup.mockResolvedValueOnce({ ...remote, identityKey: 'other' })
    expect(await registry.send(peer.deviceId, account)).toBeUndefined()
    lookup.mockResolvedValueOnce({ ...remote, membershipId: 'other' })
    expect(await registry.send(peer.deviceId, account)).toBeUndefined()
    expect(sendHuaweiWakeup).not.toHaveBeenCalled()
  })
  it('revokes trust even when the token registry is corrupt', async () => {
    const { registry, peer, identities, directory } = await setup()
    await registry.register(peer, 'token')
    await writeFile(join(directory, 'huawei-push.json'), '{broken', { mode: 0o600 })
    await expect(registry.revoke(peer.deviceId, () => identities.revokePeer(peer.deviceId))).rejects.toThrow()
    expect(identities.trustedPeer(peer.deviceId)).toBeUndefined()
  })
  it('revocation proceeds while authority lookup is pending and blocks the registration', async () => {
    const { registry, peer, identities, lookup, remote } = await setup()
    let finish!: (value: AuthorizedPeerDevice) => void
    lookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = registry.register(peer, 'token')
    await registry.revoke(peer.deviceId, () => identities.revokePeer(peer.deviceId))
    finish(remote)
    await expect(pending).rejects.toThrow()
    expect(sendHuaweiWakeup).not.toHaveBeenCalled()
  })
  it('does not send if revocation races an in-progress authority lookup', async () => {
    const { registry, peer, identities, lookup, remote } = await setup()
    await registry.register(peer, 'token')
    let finish!: (value: AuthorizedPeerDevice) => void
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    lookup.mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve }) })
    const pending = registry.send(peer.deviceId, account)
    await entered
    await registry.revoke(peer.deviceId, () => identities.revokePeer(peer.deviceId))
    finish(remote)
    expect(await pending).toBeUndefined()
    expect(sendHuaweiWakeup).not.toHaveBeenCalled()
  })
  it('serializes revocation and reset with registration', async () => {
    const { registry, peer, identities } = await setup()
    await registry.register(peer, 'token')
    await registry.revoke(peer.deviceId, () => identities.revokePeer(peer.deviceId))
    await expect(registry.register(peer, 'new')).rejects.toThrow()
    expect(await registry.send(peer.deviceId, account)).toBeUndefined()
    await identities.trustPeer({ deviceId: peer.deviceId, publicKey: peer.identityKey, membershipId: 'member', name: 'client', platform: 'harmony' })
    await registry.register(peer, 'new')
    await registry.reset(() => identities.reset('host'))
    expect(await registry.send(peer.deviceId, account)).toBeUndefined()
    expect(sendHuaweiWakeup).not.toHaveBeenCalled()
  })
})
