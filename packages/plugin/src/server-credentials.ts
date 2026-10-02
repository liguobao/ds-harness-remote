import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { uuidV7 } from './ids.js'

const credentialSchema = z.object({
  schemaVersion: z.literal(1),
  serverUrl: z.string().url(),
  deviceId: z.string().min(1),
  authorizationMethod: z.enum(['account', 'host_registration_code', 'owned_device']),
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

  /** Serialize the complete read/refresh/write transaction across processes.
   * Never steal an old lock: a suspended owner may still consume a one-use token.
   * After a crash, stop all instances before removing the orphaned lock.
   */
  async withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    const lock = `${this.path}.refresh-lock`
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + 15_000
    for (;;) {
      try {
        await mkdir(lock, { mode: 0o700 })
        break
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
        if (Date.now() >= deadline) throw new ServerCredentialsBusyError()
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    try {
      return await operation()
    } finally {
      await rm(lock, { recursive: true })
    }
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
    await atomicWrite(this.path, `${JSON.stringify(record, null, 2)}\n`)
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
    super('Credential refresh is locked. Stop other instances; after a crash, stop all instances before removing server-credentials.json.refresh-lock and authorizing again.')
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
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
