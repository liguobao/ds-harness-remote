import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { uuidV7 } from './ids.js'

const credentialSchema = z.object({
  schemaVersion: z.literal(1),
  serverUrl: z.string().url(),
  deviceId: z.string().min(1),
  authorizationMethod: z.enum(['account', 'host_registration_code', 'owned_device', 'device_pairing']),
  accountKind: z.enum(['standard', 'device_only']).optional(),
  pairingRestricted: z.boolean().optional(),
  inboundOnly: z.boolean().optional(),
  account: z.string().min(1).max(254).optional(),
  accessToken: z.string().min(16),
  accessTokenExpiresAt: z.number().int().positive(),
  refreshToken: z.string().min(16),
  refreshTokenExpiresAt: z.number().int().positive(),
}).strict()

export interface ServerCredentials extends z.infer<typeof credentialSchema> {}

export class ServerCredentialStore {
  private readonly path: string

  constructor(directory: string) { this.path = join(directory, 'server-credentials.json') }

  /** Publish a complete owner record before the one-use refresh transaction starts. */
  async withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    const lock = `${this.path}.refresh-lock`
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + 15_000
    const owner = `${process.pid} ${uuidV7()}\n`
    for (;;) {
      try {
        await publishExclusive(lock, owner)
        break
      } catch (error) {
        if (!(await isLockContention(error, lock))) throw error
        if (await reclaimExitedRefreshOwner(lock)) continue
        if (Date.now() >= deadline) throw new ServerCredentialsBusyError()
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    try {
      return await operation()
    } finally {
      await rm(lock)
    }
  }

  async pairingHostOnly(): Promise<boolean> {
    const policy = await readPrivateJson(join(dirname(this.path), 'pairing-host-only.json'))
    if (policy === undefined) return false
    z.object({ hostOnly: z.literal(true) }).strict().parse(policy)
    return true
  }

  async restrictPairingHostOnly(): Promise<void> {
    await atomicWritePrivate(join(dirname(this.path), 'pairing-host-only.json'), '{"hostOnly":true}')
  }

  async load(serverUrl: string, deviceId: string): Promise<ServerCredentials | undefined> {
    if (!(await exists(this.path))) return undefined
    await assertPrivateMode(this.path)
    let parsed: ServerCredentials
    try {
      parsed = credentialSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      throw new ServerCredentialsInvalidError(`server credentials are invalid: ${safeMessage(error)}`)
    }
    return parsed.serverUrl === serverUrl && parsed.deviceId === deviceId ? parsed : undefined
  }

  async save(credentials: Omit<ServerCredentials, 'schemaVersion'>): Promise<ServerCredentials> {
    const record = credentialSchema.parse({ schemaVersion: 1, ...credentials })
    await atomicWritePrivate(this.path, `${JSON.stringify(record, null, 2)}\n`)
    return record
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }
}

export class ServerCredentialsInvalidError extends Error {
  readonly code = 'SERVER_CREDENTIALS_INVALID'
}

export class ServerCredentialsBusyError extends Error {
  readonly code = 'SERVER_CREDENTIALS_BUSY'
  constructor() {
    super('Credential refresh is locked. Stop other instances. If the lock has no valid owner, remove server-credentials.json.refresh-lock after all instances stop.')
  }
}

async function reclaimExitedRefreshOwner(lock: string): Promise<boolean> {
  const record = await readLockRecord(lock)
  if (record === undefined || !await ownerExited(record)) return false
  const claim = `${lock}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`
  try {
    await publishExclusive(claim, `${process.pid} ${uuidV7()}\n`)
  } catch (error) {
    if (!(await isLockContention(error, claim))) throw error
    const claimant = await readLockRecord(claim)
    if (claimant === undefined || !await ownerExited(claimant)) return false
    if (await readLockRecord(claim) !== claimant) return false
    await rm(claim, { force: true })
    return false
  }
  try {
    if (await readLockRecord(lock) !== record || !await ownerExited(record)) return false
    await rm(lock, { force: true })
    return true
  } finally {
    await rm(claim, { force: true })
  }
}

async function publishExclusive(path: string, record: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${uuidV7()}.tmp`
  await writeFile(temporary, record, { mode: 0o600, flag: 'wx' })
  try { await link(temporary, path) } finally { await rm(temporary, { force: true }) }
}

async function isLockContention(error: unknown, path: string): Promise<boolean> {
  if (!(error instanceof Error) || !('code' in error)) return false
  if (error.code === 'EEXIST') return true
  if (process.platform !== 'win32' || error.code !== 'EPERM') return false
  return exists(path)
}

async function readLockRecord(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') } catch { return undefined }
}

async function ownerExited(record: string): Promise<boolean> {
  const match = /^(\d+)(?: [0-9a-f-]{36})?\n$/.exec(record)
  if (match === null) return false
  const pid = Number(match[1])
  if (pid < 1 || pid > 2147483647 || pid === process.pid) return false
  try { process.kill(pid, 0); return false } catch (error) {
    if (process.platform === 'win32') return windowsOwnerExited(pid)
    return error instanceof Error && 'code' in error && error.code === 'ESRCH'
  }
}

async function windowsOwnerExited(pid: number): Promise<boolean> {
  const command = `$ErrorActionPreference = 'Stop'; $p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p) { 'ABSENT' } else { 'EXISTS' }`
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', command,
    ], { timeout: 5_000, windowsHide: true })
    return stdout.trim() === 'ABSENT'
  } catch { return false }
}

export async function atomicWritePrivate(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${uuidV7()}.tmp`
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
  await chmod(path, 0o600)
}

async function assertPrivateMode(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const mode = (await stat(path)).mode & 0o777
  if ((mode & 0o077) !== 0) throw new ServerCredentialsInvalidError('server credentials permissions must be 0600')
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function safeMessage(error: unknown): string { return error instanceof Error ? error.message : 'invalid credential data' }

export async function readPrivateJson(path: string): Promise<unknown | undefined> {
  if (!await exists(path)) return undefined
  await assertPrivateMode(path)
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}
