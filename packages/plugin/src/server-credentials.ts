import { execFile } from 'node:child_process'
import { chmod, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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

  /** Each process owns one queue record. A dead process cannot hold the queue. */
  async withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    const lock = `${this.path}.refresh-lock`
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + 15_000
    await ensureQueueMarker(lock, deadline)
    const id = `${process.pid}-${uuidV7()}`
    const holder = `${lock}.holder-${id}`
    // Publish intent first. A later contender must see this record before it chooses a ticket.
    await publishExclusive(holder, `${id} choosing\n`)
    try {
      const ticket = 1 + (await participants(lock)).reduce((max, entry) => Math.max(max, entry.ticket ?? 0), 0)
      if (!Number.isSafeInteger(ticket)) throw new ServerCredentialsBusyError()
      await atomicWritePrivate(holder, `${id} ${ticket}\n`)
      for (;;) {
        const entries = await participants(lock)
        const preceding = entries.some(entry => entry.id !== id && (entry.ticket === undefined
          || entry.ticket < ticket || (entry.ticket === ticket && entry.id < id)))
        if (!preceding) break
        if (Date.now() >= deadline) throw new ServerCredentialsBusyError()
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return await operation()
    } finally {
      await rm(holder, { force: true })
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
    super('Credential refresh is busy. Stop other instances. Remove a legacy refresh lock only after every instance stops.')
  }
}

export const SERVER_CREDENTIALS_QUEUE_MARKER = 'DSH_REFRESH_LOCK_V2\n'

async function ensureQueueMarker(lock: string, deadline: number): Promise<void> {
  // Old versions use this path as their lock. Keep them outside the new queue.
  for (;;) {
    try {
      await publishExclusive(lock, SERVER_CREDENTIALS_QUEUE_MARKER)
      return
    } catch (error) {
      if (!(await isLockContention(error, lock))) throw error
      if (await readQueueMarker(lock) === SERVER_CREDENTIALS_QUEUE_MARKER) return
      if (Date.now() >= deadline) throw new ServerCredentialsBusyError()
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}

interface QueueParticipant { id: string; ticket?: number }

async function participants(lock: string): Promise<QueueParticipant[]> {
  const prefix = `${basename(lock)}.holder-`
  const entries = await readdir(dirname(lock))
  const result: QueueParticipant[] = []
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue
    if (name.endsWith('.tmp')) continue
    const id = name.slice(prefix.length)
    if (!/^\d+-[0-9a-f-]{36}$/.test(id)) throw new ServerCredentialsBusyError()
    const path = join(dirname(lock), name)
    const record = await readLockRecord(path)
    if (record === undefined) continue
    const match = new RegExp(`^${id} (choosing|[1-9]\\d*)\\n$`).exec(record)
    if (match === null) throw new ServerCredentialsBusyError()
    const pid = Number(id.slice(0, id.indexOf('-')))
    // A unique path cannot become a new owner's record. Dead records can leave the queue.
    if (await ownerExited(pid)) {
      await rm(path, { force: true })
      continue
    }
    const ticket = match[1] === 'choosing' ? undefined : Number(match[1])
    if (ticket !== undefined && !Number.isSafeInteger(ticket)) throw new ServerCredentialsBusyError()
    result.push({ id, ...(ticket === undefined ? {} : { ticket }) })
  }
  return result
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
  try { return await readFile(path, 'utf8') } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function readQueueMarker(lock: string): Promise<string | undefined> {
  try { return await readLockRecord(lock) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EISDIR') return undefined
    throw error
  }
}

async function ownerExited(pid: number): Promise<boolean> {
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
