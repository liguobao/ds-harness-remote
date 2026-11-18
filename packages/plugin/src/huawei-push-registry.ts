import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { withIdentityLock, type IdentityStore, type TrustedPeer } from './identity-store.js'
import type { AuthorizedPeerDevice } from './server-api.js'
import type { HuaweiPushServiceAccount } from './huawei-push-auth.js'
import { sendHuaweiWakeup, type HuaweiPushNoticeOptions } from './huawei-push-sender.js'

const recordSchema = z.object({ deviceId: z.string().min(1).max(128), identityKey: z.string().min(1).max(256), membershipId: z.string().min(1).max(256), token: z.string().min(1).max(4096) }).strict()
const fileSchema = z.object({ version: z.literal(1), hostId: z.string().min(1).max(128), records: z.array(recordSchema).max(256) }).strict()
type Registration = z.infer<typeof recordSchema>
export interface HuaweiPushPeer { deviceId: string; identityKey: string }

/** Tokens are scoped to the authenticated Noise identity, never request device IDs. */
export class HuaweiPushRegistry {
  private queue: Promise<void> = Promise.resolve()
  constructor(private readonly identities: IdentityStore, private readonly deviceFor: (id: string) => Promise<AuthorizedPeerDevice>) {}

  private run<T>(action: () => Promise<T>, lock = true): Promise<T> {
    const next = this.queue.then(() => lock ? withIdentityLock(this.identities.directory, async () => {
      await this.assertHostIdentity()
      return action()
    }) : action())
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }
  private async assertHostIdentity(): Promise<void> {
    try {
      const disk = JSON.parse(await readFile(join(this.identities.directory, 'device.json'), 'utf8')) as { deviceId?: unknown; publicKey?: unknown }
      const current = this.identities.current()
      if (disk.deviceId !== current.deviceId || disk.publicKey !== current.publicKey) throw new Error()
    } catch { throw new Error('Push identity unavailable') }
  }
  private async assertStoredPeer(peer: HuaweiPushPeer, membershipId: string): Promise<void> {
    try {
      const file = JSON.parse(await readFile(join(this.identities.directory, 'trusted-peers.json'), 'utf8')) as { peers?: unknown }
      if (!Array.isArray(file.peers) || !file.peers.some((item: unknown) => {
        if (typeof item !== 'object' || item === null) return false
        const record = item as Record<string, unknown>
        return record.deviceId === peer.deviceId && record.publicKey === peer.identityKey && record.membershipId === membershipId
      })) throw new Error()
    } catch { throw new Error('Push identity unavailable') }
  }
  private peer(peer: HuaweiPushPeer): TrustedPeer {
    const trusted = this.identities.trustedPeer(peer.deviceId)
    if (!trusted || trusted.publicKey !== peer.identityKey || !trusted.membershipId) throw new Error('Push identity unavailable')
    return trusted
  }
  private async authorized(peer: HuaweiPushPeer): Promise<TrustedPeer> {
    const trusted = this.peer(peer)
    const remote = await this.deviceFor(peer.deviceId)
    if (remote.role !== 'client' || remote.deviceId !== peer.deviceId || remote.identityKey !== peer.identityKey || remote.membershipId !== trusted.membershipId) throw new Error('Push identity unavailable')
    if (this.peer(peer).membershipId !== trusted.membershipId) throw new Error('Push identity unavailable')
    return trusted
  }
  async register(peer: HuaweiPushPeer, token: string): Promise<void> {
    if (typeof token !== 'string' || token.length < 1 || token.length > 4096 || /[\u0000-\u001f\u007f]/u.test(token)) throw new Error('Invalid push registration')
    const trusted = await this.authorized(peer)
    return this.run(async () => {
      if (this.peer(peer).membershipId !== trusted.membershipId) throw new Error('Push identity unavailable')
      await this.assertStoredPeer(peer, trusted.membershipId!)
      const records = (await this.read()).filter(record => record.deviceId !== peer.deviceId)
      if (records.length >= 256) throw new Error('Push registry full')
      records.push({ deviceId: peer.deviceId, identityKey: peer.identityKey, membershipId: trusted.membershipId!, token })
      await this.write(records)
    })
  }
  async unregister(peer: HuaweiPushPeer): Promise<void> {
    return this.run(async () => {
      const trusted = this.peer(peer)
      await this.assertStoredPeer(peer, trusted.membershipId!)
      const records = await this.read()
      await this.write(records.filter(record => record.deviceId !== peer.deviceId || record.identityKey !== peer.identityKey))
    })
  }
  async revoke<T>(deviceId: string, revoke: () => Promise<T>): Promise<T> {
    let attempted = false
    try {
      return await this.run(async () => {
        let result: T | undefined
        let failed = false
        attempted = true
        try { result = await revoke() } catch { failed = true }
        try { await this.write((await this.read()).filter(record => record.deviceId !== deviceId)) } catch { failed = true }
        if (failed) throw new Error('Push revocation incomplete')
        return result as T
      })
    } catch {
      if (!attempted) await revoke()
      throw new Error('Push revocation incomplete')
    }
  }
  /** Hold the queue across reset so no old connection can re-register during it. */
  async reset<T>(reset: () => Promise<T>): Promise<T> {
    return this.run(reset, false)
  }
  async registeredDeviceIds(): Promise<string[]> {
    return this.run(async () => (await this.read()).map(item => item.deviceId))
  }

  /** All failures are closed; an accepted HTTP request may still be in flight at revocation. */
  async send(
    deviceId: string,
    account: HuaweiPushServiceAccount,
    options?: HuaweiPushNoticeOptions,
  ): Promise<{ httpStatus: number | null } | undefined> {
    const record = await this.run(async () => (await this.read()).find(item => item.deviceId === deviceId))
    if (!record) return undefined
    const peer = { deviceId: record.deviceId, identityKey: record.identityKey }
    let trusted: TrustedPeer
    try { trusted = await this.authorized(peer) } catch { return undefined }
    if (trusted.membershipId !== record.membershipId) return undefined
    const token = await this.run(async () => {
      if (this.peer(peer).membershipId !== record.membershipId) return undefined
      await this.assertStoredPeer(peer, record.membershipId)
      const current = (await this.read()).find(item => item.deviceId === deviceId)
      if (!current || current.identityKey !== record.identityKey || current.membershipId !== record.membershipId || current.token !== record.token) return undefined
      return current.token
    })
    return token === undefined ? undefined : sendHuaweiWakeup(account, token, options)
  }
  private path(): string { return join(this.identities.directory, 'huawei-push.json') }
  private async read(): Promise<Registration[]> {
    let file
    try {
      const stat = await lstat(this.path())
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > 2_000_000) throw new Error('Push registry unavailable')
      file = await open(this.path(), constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('Push registry unavailable')
    }
    try {
      const parsed = fileSchema.parse(JSON.parse(await file.readFile('utf8')))
      if (parsed.hostId !== this.identities.current().deviceId) return []
      if (new Set(parsed.records.map(item => item.deviceId)).size !== parsed.records.length) throw new Error()
      return parsed.records
    } catch { throw new Error('Push registry unavailable') } finally { await file.close() }
  }
  private async write(records: Registration[]): Promise<void> {
    const path = this.path()
    const temporary = `${path}.${randomUUID()}.tmp`
    let handle
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      await handle.writeFile(JSON.stringify({ version: 1, hostId: this.identities.current().deviceId, records }))
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, path)
      await chmod(path, 0o600)
      const directory = await open(this.identities.directory, constants.O_RDONLY)
      try { await directory.sync() } finally { await directory.close() }
    } catch {
      await handle?.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw new Error('Push registry unavailable')
    }
  }
}
