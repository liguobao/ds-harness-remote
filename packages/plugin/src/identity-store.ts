import { createHash } from 'node:crypto'
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fromBase64Url, generateKeyPair } from '@dsh-remote/crypto'
import { z } from 'zod'
import { uuidV7 } from './ids.js'

const identitySchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().uuid(),
  name: z.string().min(1).max(80),
  publicKey: z.string().min(1),
}).strict()

const trustedPeerSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1).max(80),
  platform: z.string().min(1).max(40),
  publicKey: z.string().min(1),
  fingerprint: z.string().min(1),
  trustedAt: z.number().int().nonnegative(),
  membershipId: z.string().min(1).optional(),
}).strict()

const trustedPeersSchema = z.object({
  schemaVersion: z.literal(1),
  peers: z.array(trustedPeerSchema).max(256),
}).strict()

export interface HostIdentity {
  schemaVersion: 1
  deviceId: string
  name: string
  publicKey: string
  privateKey: string
  fingerprint: string
}

export interface TrustedPeer {
  deviceId: string
  name: string
  platform: string
  publicKey: string
  fingerprint: string
  trustedAt: number
  membershipId?: string
}

export interface IdentityStoreOptions {
  directory?: string
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
}

export type RemoteDeviceRole = 'host' | 'client'

export class IdentityInvalidError extends Error {
  readonly code = 'IDENTITY_INVALID'
}

export class IdentityStore {
  readonly directory: string
  private identity?: HostIdentity
  private peers = new Map<string, TrustedPeer>()

  constructor(options: IdentityStoreOptions = {}) {
    const env = options.env ?? process.env
    const dshHome = env.DSH_HOME || join(options.homeDirectory ?? homedir(), '.dsh')
    this.directory = options.directory ?? join(dshHome, 'remote')
  }

  async loadOrCreate(deviceName: string): Promise<HostIdentity> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const devicePath = join(this.directory, 'device.json')
    const keyPath = join(this.directory, 'device.key')
    // Creation writes two files that must agree. Without a cross-process lock a
    // Desktop restart overlapping the previous Host reaches the "create" branch
    // twice; each writes its own key pair and the directory ends up holding one
    // process's device.json beside another's device.key. That mismatch fails
    // closed forever — every later start throws before registering the control
    // route — so serialize the whole read-create-verify cycle.
    const release = await acquireIdentityLock(this.directory)
    try {
      await removeStaleTemporaries(this.directory)
      const [hasDevice, hasKey] = await Promise.all([exists(devicePath), exists(keyPath)])
      if (hasDevice !== hasKey) {
        throw new IdentityInvalidError('device identity is incomplete; repair it explicitly before reconnecting')
      }

      if (!hasDevice) {
        const keys = generateKeyPair()
        const record = { schemaVersion: 1 as const, deviceId: uuidV7(), name: deviceName, publicKey: keys.publicKey }
        // Write the key first: a crash between the two leaves device.key alone,
        // which the incomplete-pair guard above reports explicitly, instead of
        // leaving a device.json whose published public key has no private half.
        await atomicTextWrite(keyPath, `${keys.privateKey}\n`, 0o600)
        await atomicJsonWrite(devicePath, record, 0o600)
      }

      return await this.readIdentity(devicePath, keyPath, deviceName)
    } finally {
      await release()
    }
  }

  private async readIdentity(devicePath: string, keyPath: string, deviceName: string): Promise<HostIdentity> {
    await assertPrivateMode(keyPath)
    try {
      let record = identitySchema.parse(JSON.parse(await readFile(devicePath, 'utf8')))
      const privateKey = (await readFile(keyPath, 'utf8')).trim()
      const regenerated = generateKeyPair(fromBase64Url(privateKey))
      if (regenerated.publicKey !== record.publicKey) {
        throw new IdentityInvalidError('device public and private keys do not match')
      }
      if (record.name !== deviceName) {
        record = { ...record, name: deviceName }
        await atomicJsonWrite(devicePath, record, 0o600)
      }
      this.identity = { ...record, privateKey, fingerprint: fingerprint(record.publicKey) }
      await this.loadPeers()
      return this.identity
    } catch (error: unknown) {
      if (error instanceof IdentityInvalidError) throw error
      throw new IdentityInvalidError(`device identity is invalid: ${safeErrorMessage(error)}`)
    }
  }

  current(): HostIdentity {
    if (this.identity === undefined) throw new Error('identity store has not been loaded')
    return this.identity
  }

  async reset(deviceName: string): Promise<HostIdentity> {
    await rm(this.directory, { recursive: true, force: true })
    this.identity = undefined
    this.peers.clear()
    return this.loadOrCreate(deviceName)
  }

  listTrustedPeers(): TrustedPeer[] {
    return [...this.peers.values()].map(peer => ({ ...peer }))
  }

  trustedPeer(deviceId: string): TrustedPeer | undefined {
    const peer = this.peers.get(deviceId)
    return peer === undefined ? undefined : { ...peer }
  }

  isTrusted(deviceId: string, publicKey: string): boolean {
    return this.peers.get(deviceId)?.publicKey === publicKey
  }

  async trustPeer(input: Omit<TrustedPeer, 'fingerprint' | 'trustedAt'>): Promise<TrustedPeer> {
    this.current()
    const peer: TrustedPeer = {
      ...input,
      fingerprint: fingerprint(input.publicKey),
      trustedAt: Date.now(),
    }
    this.peers.set(peer.deviceId, peer)
    await this.savePeers()
    return { ...peer }
  }

  async revokePeer(deviceId: string): Promise<boolean> {
    const removed = this.peers.delete(deviceId)
    if (removed) await this.savePeers()
    return removed
  }

  private async loadPeers(): Promise<void> {
    const path = join(this.directory, 'trusted-peers.json')
    if (!(await exists(path))) {
      await atomicJsonWrite(path, { schemaVersion: 1, peers: [] }, 0o600)
    }
    const parsed = trustedPeersSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    const peers = new Map<string, TrustedPeer>()
    for (const peer of parsed.peers) {
      if (peer.fingerprint !== fingerprint(peer.publicKey)) {
        throw new IdentityInvalidError(`trusted peer ${peer.deviceId} has an invalid fingerprint`)
      }
      if (peers.has(peer.deviceId)) throw new IdentityInvalidError(`trusted peer ${peer.deviceId} is duplicated`)
      peers.set(peer.deviceId, peer)
    }
    this.peers = peers
  }

  private async savePeers(): Promise<void> {
    await atomicJsonWrite(join(this.directory, 'trusted-peers.json'), {
      schemaVersion: 1,
      peers: [...this.peers.values()],
    }, 0o600)
  }
}

export function serverStorageDirectory(root: string, serverUrl: string, role: RemoteDeviceRole): string {
  const origin = new URL(serverUrl).origin
  const scope = createHash('sha256').update(origin).digest('hex').slice(0, 24)
  return join(root, 'servers', scope, role)
}

export function fingerprint(publicKey: string): string {
  const compact = createHash('sha256').update(fromBase64Url(publicKey)).digest('hex').slice(0, 12).toUpperCase()
  return compact.match(/.{1,4}/g)!.join(' ')
}

async function assertPrivateMode(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const mode = (await stat(path)).mode & 0o777
  if ((mode & 0o077) !== 0) {
    throw new IdentityInvalidError(`private key permissions must be 0600, got ${mode.toString(8).padStart(3, '0')}`)
  }
}

async function atomicJsonWrite(path: string, value: unknown, mode: number): Promise<void> {
  await atomicTextWrite(path, `${JSON.stringify(value, null, 2)}\n`, mode)
}

async function atomicTextWrite(path: string, value: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${uuidV7()}.tmp`
  await writeFile(temporary, value, { encoding: 'utf8', mode, flag: 'wx' })
  await chmod(temporary, mode)
  await rename(temporary, path)
  await chmod(path, mode)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'invalid identity data'
}

/**
 * Serialize identity creation across processes sharing one `~/.dsh`.
 *
 * A `wx`-created lock file is the whole mechanism: the first process to create
 * it wins, everyone else retries. The lock records pid and creation time so a
 * lock left behind by a crash can be reclaimed once it is old enough, and so a
 * same-process re-entry (HMR reload) never deadlocks on itself.
 */
const LOCK_FILE_NAME = 'device.lock'
const LOCK_TIMEOUT_MS = 15_000
const LOCK_STALE_MS = 60_000
const LOCK_RETRY_MS = 25

async function acquireIdentityLock(directory: string): Promise<() => Promise<void>> {
  const lockPath = join(directory, LOCK_FILE_NAME)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }))
      await handle.close()
      let released = false
      return async () => {
        if (released) return
        released = true
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error
      if (await reclaimStaleLock(lockPath)) continue
      if (Date.now() >= deadline) {
        throw new IdentityInvalidError('device identity is locked by another process; stop other DSH instances and retry')
      }
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}

/** Remove a lock whose owner is gone or has held it past the staleness bound. */
async function reclaimStaleLock(lockPath: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: unknown; at?: unknown }
    const heldSince = typeof owner.at === 'number' ? Date.now() - owner.at : Number.POSITIVE_INFINITY
    const ownerPid = typeof owner.pid === 'number' ? owner.pid : undefined
    // A holder past the bound, or one whose process no longer exists, is debris.
    if (heldSince < LOCK_STALE_MS && ownerPid !== undefined && isProcessAlive(ownerPid)) return false
    await unlink(lockPath)
    return true
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return true
    // An unreadable lock is treated as debris from a crash.
    await unlink(lockPath).catch(() => undefined)
    return true
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return isNodeError(error) && error.code === 'EPERM'
  }
}

/** Drop temp files a previous interrupted write left beside the identity pair. */
async function removeStaleTemporaries(directory: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return
  }
  await Promise.all(entries
    .filter(name => name.startsWith('device.json.') || name.startsWith('device.key.'))
    .filter(name => name.endsWith('.tmp'))
    .map(name => unlink(join(directory, name)).catch(() => undefined)))
}
