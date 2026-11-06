import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
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
  // Discovery can persist multiple pages; reading must accept every record we write.
  peers: z.array(trustedPeerSchema),
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
    await ensureDirectory(this.directory)
    // Creation writes two files that must agree. Without a cross-process lock a
    // Desktop restart overlapping the previous Host reaches the "create" branch
    // twice; each writes its own key pair and the directory ends up holding one
    // process's device.json beside another's device.key. That mismatch fails
    // closed forever — every later start throws before registering the control
    // route — so serialize the whole read-create-verify cycle.
    return withIdentityLock(this.directory, () => this.loadOrCreateLocked(deviceName))
  }

  private async loadOrCreateLocked(deviceName: string): Promise<HostIdentity> {
    const devicePath = join(this.directory, 'device.json')
    const keyPath = join(this.directory, 'device.key')
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

    const identity = await this.readIdentity(devicePath, keyPath, deviceName)
    // Only a verified pair makes the leftovers dead weight. In the #276 residue
    // the surviving device.key.*.tmp is the only private key that still matches
    // device.json, so a failed verification keeps it for manual recovery.
    await removeStaleTemporaries(this.directory)
    return identity
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

  /**
   * Replace the identity. Runs in the same lock domain as creation, so a reset
   * can never interleave with another process's read-create-verify. The lock
   * file lives outside `removeIdentityRecords`, so resetting cannot delete a
   * lock another process holds — and cannot leave itself unprotected either.
   */
  async reset(deviceName: string): Promise<HostIdentity> {
    await ensureDirectory(this.directory)
    return withIdentityLock(this.directory, async () => {
      this.identity = undefined
      this.peers.clear()
      await removeIdentityRecords(this.directory)
      return this.loadOrCreateLocked(deviceName)
    })
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
 * Serialize every read-create-verify cycle that touches `directory`.
 *
 * The lock is a `wx`-created `device.lock` holding the owner's pid. It is
 * removed by exactly two parties: its owner, once the operation finished, and a
 * contender that proved the recorded process no longer exists. Those are the
 * only two cases in which no live owner can be mid-operation, which is what
 * makes both removals safe:
 *
 * - Age is never evidence of abandonment. A holder suspended for minutes is
 *   still the holder, and letting a successor take over would hand the
 *   critical section to two processes at once — the failure this lock exists to
 *   prevent. A holder that resumes therefore still owns its lock and can only
 *   ever remove its own.
 * - A lock whose record cannot be read yet (the file is created before its
 *   pid lands) is treated as held, never reclaimed: deleting it would admit a
 *   second creator while the first is still running.
 * - Takeover is arbitrated through a claim file named after the dead record, so
 *   two contenders cannot both reclaim, and the claimant re-reads the lock
 *   under the claim to confirm it is still the record whose owner it proved
 *   gone. A lock acquired after a takeover has a different record, hence a
 *   different claim name, so it can never be the one a stale claim removes.
 */
const LOCK_FILE_NAME = 'device.lock'
const LOCK_TIMEOUT_MS = 15_000
const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200

async function withIdentityLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = join(directory, LOCK_FILE_NAME)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let delay = LOCK_RETRY_INITIAL_MS
  for (;;) {
    try {
      // One call, so the window in which a contender can read the path without
      // its record is the only unprotected state — and that state is waited on.
      await writeFile(lockPath, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      break
    } catch (error: unknown) {
      if (!(await isLockContention(error, lockPath))) throw error
      if (await takeOverLockOfExitedOwner(lockPath)) continue
    }
    if (Date.now() >= deadline) {
      throw new IdentityInvalidError('device identity is locked by another process; stop other DSH instances and retry')
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS)
  }
  try {
    return await operation()
  } finally {
    // Safe by the invariant above: no contender reclaims a lock whose owner is
    // still running, so this path still names our own lock.
    await rm(lockPath, { force: true })
  }
}

/** Whether an exclusive create failed because the lock already exists. */
async function isLockContention(error: unknown, lockPath: string): Promise<boolean> {
  if (!isNodeError(error)) return false
  if (error.code === 'EEXIST') return true
  // Windows reports a held exclusive create as EPERM; confirm by looking.
  if (error.code !== 'EPERM' || process.platform !== 'win32') return false
  return exists(lockPath)
}

/**
 * Remove a lock whose recorded owner is proven gone, and report whether this
 * call did it. An unreadable or malformed record is not proof of anything and
 * is left alone for its owner or an operator to resolve.
 */
async function takeOverLockOfExitedOwner(lockPath: string): Promise<boolean> {
  const record = await readLockRecord(lockPath)
  if (record === undefined || !ownerExited(record)) return false
  const claimPath = `${lockPath}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`
  try {
    await writeFile(claimPath, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  } catch (error: unknown) {
    // Another contender is reclaiming this same record; it removes the lock.
    if (await isLockContention(error, claimPath)) return false
    throw error
  }
  try {
    if (await readLockRecord(lockPath) !== record || !ownerExited(record)) return false
    await rm(lockPath, { force: true })
    return true
  } finally {
    await rm(claimPath, { force: true }).catch(() => undefined)
  }
}

async function readLockRecord(lockPath: string): Promise<string | undefined> {
  try {
    return await readFile(lockPath, 'utf8')
  } catch {
    return undefined
  }
}

/** Whether the owner a `<pid>\n` record names is proven gone. */
function ownerExited(record: string): boolean {
  if (!/^\d+\n$/.test(record)) return false
  const pid = Number(record.trim())
  if (pid === 0 || pid > 2147483647) return false
  // Our own pid means re-entry from the same process (a second store, an HMR
  // reload). Waiting is correct: the operation does finish and release.
  if (pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error: unknown) {
    // ESRCH proves the process is gone; EPERM means it exists under another
    // user and must be treated as a live owner.
    return isNodeError(error) && error.code === 'ESRCH'
  }
}

async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
}

/** Drop every identity record, leaving the lock files in place. */
async function removeIdentityRecords(directory: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return
  }
  await Promise.all(entries
    .filter(name => !isLockArtifact(name))
    .map(name => rm(join(directory, name), { recursive: true, force: true })))
}

function isLockArtifact(name: string): boolean {
  return name === LOCK_FILE_NAME || name.startsWith(`${LOCK_FILE_NAME}.takeover-`)
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
