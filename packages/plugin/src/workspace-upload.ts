import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, open, realpath, stat, unlink, type FileHandle } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { RpcError } from './safe-error.js'

export const WORKSPACE_UPLOAD_BYTES = 20 * 1024 * 1024
export const WORKSPACE_UPLOAD_CHUNK = 64 * 1024
const scope = z.object({ sessionId: z.string().min(1).max(512), uploadId: z.string().uuid() }).strict()
const openParams = scope.extend({ name: z.string().min(1), totalBytes: z.number().int().min(0).max(WORKSPACE_UPLOAD_BYTES) }).strict()
const chunkParams = scope.extend({ offset: z.number().int().min(0), data: z.string().min(1).max(Math.ceil(WORKSPACE_UPLOAD_CHUNK / 3) * 4) }).strict()
type Result = { name: string; path: string; bytes: number }
type Upload = {
  sessionId: string; name: string; totalBytes: number; received: number; touched: number
  root: string; sourceRoot: string; dev: number; ino: number; temp: string; handle: FileHandle
}

/** One authenticated peer owns this bounded, ephemeral upload service. */
export class WorkspaceUploadHost {
  private readonly uploads = new Map<string, Upload>()
  private readonly completed = new Map<string, { sessionId: string; result: Result; touched: number }>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false

  constructor(
    private readonly resolveRoot: (sessionId: string, signal: AbortSignal) => Promise<string | undefined>,
    private readonly ttlMs = 120_000,
  ) {
    this.timer = setInterval(() => { void this.serialize(() => this.expire()).catch(() => undefined) }, Math.min(ttlMs, 30_000))
    this.timer.unref()
  }

  call(method: string, input: unknown): Promise<unknown> {
    return this.serialize(async () => {
      if (this.closed) throw failure('UPLOAD_CLOSED')
      await this.expire()
      try {
        switch (method) {
          case 'workspace.upload.open': return await this.begin(input)
          case 'workspace.upload.chunk': return await this.append(input)
          case 'workspace.upload.commit': return await this.commit(input)
          case 'workspace.upload.abort': {
            const p = scope.parse(input)
            const upload = this.uploads.get(p.uploadId)
            if (upload && upload.sessionId !== p.sessionId) throw failure('UPLOAD_NOT_FOUND')
            if (upload) await this.discard(p.uploadId, upload)
            return { aborted: true }
          }
          default: throw failure('METHOD_NOT_FOUND')
        }
      } catch (error) {
        // Invalid transfer input cannot leave an active partial file indefinitely.
        const p = scope.safeParse(input && typeof input === 'object'
          ? { sessionId: (input as Record<string, unknown>).sessionId, uploadId: (input as Record<string, unknown>).uploadId } : input)
        const upload = p.success ? this.uploads.get(p.data.uploadId) : undefined
        if (p.success && upload?.sessionId === p.data.sessionId) await this.discard(p.data.uploadId, upload)
        if (error instanceof z.ZodError || error instanceof RpcError) throw error
        throw failure('UPLOAD_FAILED')
      }
    })
  }

  closeAll(): Promise<void> {
    this.closed = true
    this.lifetime.abort()
    clearInterval(this.timer)
    return this.serialize(async () => {
      await Promise.all([...this.uploads].map(([id, upload]) => this.discard(id, upload)))
      this.completed.clear()
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async begin(input: unknown) {
    const p = openParams.parse(input)
    if (!validName(p.name)) throw failure('UPLOAD_INVALID_NAME')
    if (this.uploads.has(p.uploadId) || this.completed.has(p.uploadId)) throw failure('UPLOAD_ID_IN_USE')
    if (this.uploads.size >= 2) throw failure('UPLOAD_LIMIT')
    const sourceRoot = await this.sessionRoot(p.sessionId)
    this.assertLive()
    if (!sourceRoot || !isAbsolute(sourceRoot)) throw failure('UPLOAD_WORKSPACE_UNAVAILABLE')
    const root = await realpath(sourceRoot)
    const directory = await stat(root)
    if (!directory.isDirectory()) throw failure('UPLOAD_WORKSPACE_UNAVAILABLE')
    const temp = join(root, `.dsh-upload-${randomUUID()}.part`)
    const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600)
    const upload: Upload = { ...p, received: 0, touched: Date.now(), root, sourceRoot, dev: directory.dev, ino: directory.ino, temp, handle }
    this.uploads.set(p.uploadId, upload)
    await this.validateRoot(upload)
    return { uploadId: p.uploadId, chunkBytes: WORKSPACE_UPLOAD_CHUNK }
  }

  private async append(input: unknown) {
    const p = chunkParams.parse(input)
    const upload = this.requireUpload(p)
    const data = Buffer.from(p.data, 'base64')
    if (!data.length || data.length > WORKSPACE_UPLOAD_CHUNK || data.toString('base64') !== p.data
      || p.offset !== upload.received || upload.received + data.length > upload.totalBytes) throw failure('UPLOAD_INVALID_CHUNK')
    await this.validateRoot(upload)
    let written = 0
    while (written < data.length) {
      const result = await upload.handle.write(data, written, data.length - written, upload.received + written)
      if (!result.bytesWritten) throw failure('UPLOAD_FAILED')
      written += result.bytesWritten
    }
    this.assertLive()
    upload.received += data.length
    upload.touched = Date.now()
    return { uploadId: p.uploadId, receivedBytes: upload.received }
  }

  private async commit(input: unknown): Promise<Result> {
    const p = scope.parse(input)
    const prior = this.completed.get(p.uploadId)
    if (prior) {
      if (prior.sessionId !== p.sessionId) throw failure('UPLOAD_NOT_FOUND')
      return prior.result
    }
    const upload = this.requireUpload(p)
    if (upload.received !== upload.totalBytes) throw failure('UPLOAD_INCOMPLETE')
    await this.validateRoot(upload)
    await upload.handle.sync()
    const original = await upload.handle.stat()
    const temp = await lstat(upload.temp)
    if (!temp.isFile() || temp.dev !== original.dev || temp.ino !== original.ino || temp.size !== upload.totalBytes) throw failure('UPLOAD_WORKSPACE_CHANGED')
    const extension = extname(upload.name)
    const stem = upload.name.slice(0, upload.name.length - extension.length)
    for (let suffix = 0; suffix < 10_000; suffix++) {
      await this.validateRoot(upload)
      const name = suffix === 0 ? upload.name : `${stem} (${suffix})${extension}`
      try {
        // Hard-link publication is atomic and fails if *any* target entry exists.
        await link(upload.temp, join(upload.root, name))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
      const result = { name, path: `./${name}`, bytes: upload.totalBytes }
      // Publication is the commit point. Abort/disconnect may only remove the temp.
      this.completed.set(p.uploadId, { sessionId: p.sessionId, result, touched: Date.now() })
      if (this.completed.size > 64) this.completed.delete(this.completed.keys().next().value!)
      await this.discard(p.uploadId, upload)
      return result
    }
    throw failure('UPLOAD_NAME_CONFLICT')
  }

  private requireUpload(p: { uploadId: string; sessionId: string }): Upload {
    const upload = this.uploads.get(p.uploadId)
    if (!upload || upload.sessionId !== p.sessionId) throw failure('UPLOAD_NOT_FOUND')
    return upload
  }

  private assertLive() { if (this.closed) throw failure('UPLOAD_CLOSED') }

  private async sessionRoot(sessionId: string): Promise<string | undefined> {
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15_000)])
    let onAbort!: () => void
    try {
      signal.throwIfAborted()
      return await Promise.race([
        this.resolveRoot(sessionId, signal),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(failure(this.closed ? 'UPLOAD_CLOSED' : 'UPLOAD_TIMEOUT'))
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
        }),
      ])
    } finally { if (onAbort) signal.removeEventListener('abort', onAbort) }
  }

  private async validateRoot(upload: Upload) {
    const current = await this.sessionRoot(upload.sessionId)
    this.assertLive()
    if (current !== upload.sourceRoot || await realpath(current!) !== upload.root || await realpath(upload.root) !== upload.root) throw failure('UPLOAD_WORKSPACE_CHANGED')
    const directory = await stat(upload.root)
    if (!directory.isDirectory() || directory.dev !== upload.dev || directory.ino !== upload.ino) throw failure('UPLOAD_WORKSPACE_CHANGED')
  }

  private async discard(id: string, upload: Upload) {
    this.uploads.delete(id)
    const original = await upload.handle.stat().catch(() => undefined)
    await upload.handle.close().catch(() => undefined)
    // Do not follow a replaced root or remove a substituted temporary entry.
    try {
      const root = await lstat(upload.root)
      const temp = await lstat(upload.temp)
      if (original && root.isDirectory() && root.dev === upload.dev && root.ino === upload.ino
        && temp.isFile() && temp.dev === original.dev && temp.ino === original.ino) await unlink(upload.temp)
    } catch { /* Missing/replaced directories are never followed during cleanup. */ }
  }

  private async expire() {
    const cutoff = Date.now() - this.ttlMs
    await Promise.all([...this.uploads].filter(([, u]) => u.touched <= cutoff).map(([id, u]) => this.discard(id, u)))
    for (const [id, entry] of this.completed) if (entry.touched <= cutoff) this.completed.delete(id)
  }
}

function failure(code: string) { return new RpcError(code, 'The workspace upload could not be completed.') }
function validName(name: string): boolean {
  return Buffer.byteLength(name, 'utf8') <= 220 && name !== '.' && name !== '..'
    && !/[/\\\x00-\x1f\x7f<>:"|?*]/u.test(name) && !/[. ]$/u.test(name)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name) && !name.startsWith('.dsh-upload-')
}
