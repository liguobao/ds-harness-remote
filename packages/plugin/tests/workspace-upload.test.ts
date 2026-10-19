import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SafeLogger } from '../src/logging.js'
import { createRpcRequest } from '@dsh-remote/protocol'
import { WorkspaceUploadHost, WORKSPACE_UPLOAD_BYTES, WORKSPACE_UPLOAD_CHUNK } from '../src/workspace-upload.js'
import { RpcRouter } from '../src/rpc-router.js'

const hosts: WorkspaceUploadHost[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.closeAll()))
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})
async function setup(resolve?: (id: string, signal: AbortSignal) => Promise<string | undefined>, ttl?: number) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-upload-test-'))
  directories.push(root)
  const host = new WorkspaceUploadHost(resolve ?? (async id => id === 'session-a' ? root : undefined), ttl)
  hosts.push(host)
  return { root, host }
}
function request(name = 'report.bin', totalBytes = 3) { return { sessionId: 'session-a', uploadId: randomUUID(), name, totalBytes } }
const scope = (p: ReturnType<typeof request>) => ({ sessionId: p.sessionId, uploadId: p.uploadId })
async function put(host: WorkspaceUploadHost, p = request(), bytes = Buffer.from([0, 255, 12])) {
  await host.call('workspace.upload.open', p)
  if (bytes.length) await host.call('workspace.upload.chunk', { ...scope(p), offset: 0, data: bytes.toString('base64') })
  return host.call('workspace.upload.commit', scope(p))
}

describe('workspace-root upload authority and lifecycle', () => {
  it('publishes exact binary bytes without overwriting files or following target symlinks, and commits idempotently', async () => {
    const { root, host } = await setup()
    await writeFile(join(root, 'report.bin'), 'existing')
    await symlink(join(root, 'report.bin'), join(root, 'report (1).bin'))
    const p = request()
    const result = { name: 'report (2).bin', path: './report (2).bin', bytes: 3 }
    expect(await put(host, p)).toEqual(result)
    expect(await host.call('workspace.upload.commit', scope(p))).toEqual(result)
    await host.call('workspace.upload.abort', scope(p))
    expect(await readFile(join(root, result.name))).toEqual(Buffer.from([0, 255, 12]))
    expect(await readFile(join(root, 'report.bin'), 'utf8')).toBe('existing')
    expect((await readdir(root)).some(name => name.endsWith('.part'))).toBe(false)
    expect(await put(host, request('empty', 0), Buffer.alloc(0))).toEqual({ name: 'empty', path: './empty', bytes: 0 })
  })

  it('rejects traversal, client paths, oversized files and unknown/relative workspace authority', async () => {
    const { root, host } = await setup()
    for (const name of ['../escape', '/tmp/escape', 'C:\\escape', '..', 'x\n.txt', 'NUL.txt', 'a.', 'a'.repeat(221)]) {
      await expect(host.call('workspace.upload.open', request(name))).rejects.toMatchObject({ code: 'UPLOAD_INVALID_NAME' })
    }
    await expect(host.call('workspace.upload.open', { ...request(), cwd: root })).rejects.toThrow()
    await expect(host.call('workspace.upload.open', request('huge', WORKSPACE_UPLOAD_BYTES + 1))).rejects.toThrow()
    await expect(host.call('workspace.upload.open', { ...request(), sessionId: 'unknown' })).rejects.toMatchObject({ code: 'UPLOAD_WORKSPACE_UNAVAILABLE' })
    const relative = await setup(async () => '.')
    await expect(relative.host.call('workspace.upload.open', request())).rejects.toMatchObject({ code: 'UPLOAD_WORKSPACE_UNAVAILABLE' })
    expect(await readdir(root)).toEqual([])
  })

  it('binds handles to session and peer; foreign requests cannot consume the real upload', async () => {
    const { root, host } = await setup()
    const peer = await setup(async () => root)
    const p = request()
    await host.call('workspace.upload.open', p)
    for (const other of [host, peer.host]) {
      await expect(other.call('workspace.upload.commit', { ...scope(p), ...(other === host ? { sessionId: 'other' } : {}) })).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' })
    }
    await host.call('workspace.upload.chunk', { ...scope(p), offset: 0, data: 'AP8M' })
    await host.call('workspace.upload.commit', scope(p))
    expect(await readFile(join(root, p.name))).toEqual(Buffer.from([0, 255, 12]))
  })

  it('rejects malformed base64, unordered/oversized chunks and incomplete commits, cleaning partial files', async () => {
    const { root, host } = await setup()
    for (const invalid of [{ offset: 1, data: 'YWJj' }, { offset: 0, data: 'YQ' }, { offset: 0, data: '!!!!' },
      { offset: 0, data: Buffer.alloc(WORKSPACE_UPLOAD_CHUNK + 1).toString('base64') }, { offset: 0, data: 'YWJjZA==' }]) {
      const p = request()
      await host.call('workspace.upload.open', p)
      await expect(host.call('workspace.upload.chunk', { ...scope(p), ...invalid })).rejects.toThrow()
      expect(await readdir(root)).toEqual([])
    }
    const p = request()
    await host.call('workspace.upload.open', p)
    await expect(host.call('workspace.upload.commit', scope(p))).rejects.toMatchObject({ code: 'UPLOAD_INCOMPLETE' })
    expect(await readdir(root)).toEqual([])
  })

  it('limits active reservations, serializes chunks, and frees quota on abort/disconnect', async () => {
    const { root, host } = await setup()
    const a = request('a', 6), b = request('b')
    await host.call('workspace.upload.open', a)
    await host.call('workspace.upload.open', b)
    await expect(host.call('workspace.upload.open', request())).rejects.toMatchObject({ code: 'UPLOAD_LIMIT' })
    await Promise.all([0, 3].map(offset => host.call('workspace.upload.chunk', { ...scope(a), offset, data: 'YWJj' })))
    await host.call('workspace.upload.commit', scope(a))
    expect(await readFile(join(root, 'a'), 'utf8')).toBe('abcabc')
    await host.call('workspace.upload.abort', scope(b))
    await host.call('workspace.upload.abort', scope(b))
    await host.call('workspace.upload.open', request('partial'))
    await host.closeAll()
    expect(await readdir(root)).toEqual(['a'])
    await expect(host.call('workspace.upload.open', request())).rejects.toMatchObject({ code: 'UPLOAD_CLOSED' })
  })

  it('expires abandoned reservations and cancels a late root resolution on disconnect', async () => {
    const { root, host } = await setup(undefined, 15)
    await host.call('workspace.upload.open', request())
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(await readdir(root)).toEqual([])
    let release!: (root: string) => void
    const pending = await setup(() => new Promise(resolve => { release = resolve }))
    const opening = pending.host.call('workspace.upload.open', request())
    await new Promise(resolve => setTimeout(resolve, 0))
    const closing = pending.host.closeAll()
    await expect(opening).rejects.toMatchObject({ code: 'UPLOAD_CLOSED' })
    await closing
    release(pending.root)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await readdir(pending.root)).toEqual([])
  })

  it('rejects changed session roots, symlink swaps and replaced directory identity before publication', async () => {
    const { root, host } = await setup()
    const p = request()
    await host.call('workspace.upload.open', p)
    const moved = `${root}-moved`
    directories.push(moved)
    await rename(root, moved)
    await mkdir(root)
    await expect(host.call('workspace.upload.chunk', { ...scope(p), offset: 0, data: 'YWJj' })).rejects.toMatchObject({ code: 'UPLOAD_WORKSPACE_CHANGED' })
    expect(await readdir(root)).toEqual([])
    await rm(root, { recursive: true })
    await symlink(moved, root)
    let current = root
    const changed = await setup(async () => current)
    const q = request('empty', 0)
    await changed.host.call('workspace.upload.open', q)
    current = changed.root
    await expect(changed.host.call('workspace.upload.commit', scope(q))).rejects.toThrow()
    expect((await readdir(changed.root)).length).toBe(0)
  })

  it('rejects retargeted root symlinks and substituted temporary entries without deleting substitutions', async () => {
    const target = await setup(), alternate = await setup()
    const alias = join(alternate.root, 'alias')
    await symlink(target.root, alias)
    const linked = await setup(async () => alias)
    const p = request('empty', 0)
    await linked.host.call('workspace.upload.open', p)
    await rm(alias)
    await symlink(linked.root, alias)
    await expect(linked.host.call('workspace.upload.commit', scope(p))).rejects.toMatchObject({ code: 'UPLOAD_WORKSPACE_CHANGED' })
    expect(await readdir(target.root)).toEqual([])
    const q = request('substitution', 0)
    await target.host.call('workspace.upload.open', q)
    const [temp] = await readdir(target.root)
    await rm(join(target.root, temp!))
    await writeFile(join(target.root, temp!), 'substituted')
    await expect(target.host.call('workspace.upload.commit', scope(q))).rejects.toMatchObject({ code: 'UPLOAD_WORKSPACE_CHANGED' })
    expect(await readFile(join(target.root, temp!), 'utf8')).toBe('substituted')
    expect(await readdir(target.root)).toEqual([temp])
  })

  it('never logs upload metadata supplied through invalid extra fields', async () => {
    const { host } = await setup()
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
    const router = new RpcRouter(undefined, undefined, logger as unknown as SafeLogger,
      undefined, undefined, () => ['workspace.upload.v1'], undefined, undefined, undefined, undefined, undefined, host)
    for (const method of ['workspace.upload.open', 'workspace.upload.chunk', 'workspace.upload.commit', 'workspace.upload.abort'] as const) {
      const response = await router.handle(createRpcRequest(method, { ...request(), endpoint: '/private/uploaded-secret.txt' }))
      expect(response).toMatchObject({ type: 'rpc.error', payload: { code: 'INVALID_MESSAGE' } })
    }
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('uploaded-secret')
  })

  it('routes upload RPCs through the encrypted business router and cleans them on peer close', async () => {
    const { root, host } = await setup()
    const router = new RpcRouter(undefined, undefined, undefined, undefined, undefined, () => ['workspace.upload.v1'],
      undefined, undefined, undefined, undefined, undefined, host)
    const p = request()
    expect(await router.handle(createRpcRequest('workspace.upload.open', p))).toMatchObject({ type: 'rpc.response', payload: { result: { uploadId: p.uploadId } } })
    await router.closePeerStreams()
    expect(await readdir(root)).toEqual([])
    expect(await router.handle(createRpcRequest('workspace.upload.open', request()))).toMatchObject({ type: 'rpc.error', payload: { code: 'UPLOAD_CLOSED' } })
  })
})
