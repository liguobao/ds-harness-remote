import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SafeLogger } from '../src/logging.js'
import { createRpcRequest } from '@dsh-remote/protocol'
import { WorkspaceUploadHost, WORKSPACE_UPLOAD_AUTHORITY_TTL_MS, WORKSPACE_UPLOAD_BYTES, WORKSPACE_UPLOAD_CHUNK } from '../src/workspace-upload.js'
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

it('allows 1 GiB only on live direct paths and discards a large upload after relay fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-upload-path-'))
  directories.push(root)
  for (const initial of ['LAN', 'P2P', 'TURN', 'Relay', undefined]) {
    let mode = initial
    const host = new WorkspaceUploadHost(async () => root, undefined, () => mode)
    hosts.push(host)
    const params = request('large.bin', 1024 * 1024 * 1024)
    if (initial === 'LAN' || initial === 'P2P') {
      await host.call('workspace.upload.open', params)
      mode = 'Relay'
      await expect(host.call('workspace.upload.chunk', { sessionId: params.sessionId, uploadId: params.uploadId, offset: 0, data: 'YQ==' })).rejects.toMatchObject({ code: 'UPLOAD_LIMIT' })
    } else {
      await expect(host.call('workspace.upload.open', params)).rejects.toMatchObject({ code: 'UPLOAD_LIMIT' })
    }
    expect(await readdir(root)).toEqual([])
    await expect(host.call('workspace.upload.open', request('too-large', 1024 * 1024 * 1024 + 1))).rejects.toThrow()
  }
})

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

  it('bounds session-authority lookups between chunks but always revalidates before publication', async () => {
    const { root } = await setup()
    const clock = { now: 1_000 }
    const resolve = vi.fn(async () => root)
    const host = new WorkspaceUploadHost(resolve, undefined, () => 'Relay', () => clock.now)
    hosts.push(host)
    const p = request('paced', 6)
    expect(await host.call('workspace.upload.open', p)).toMatchObject({ uploadId: p.uploadId })
    const afterOpen = resolve.mock.calls.length
    await host.call('workspace.upload.chunk', { ...scope(p), offset: 0, data: 'YWJj' })
    await host.call('workspace.upload.chunk', { ...scope(p), offset: 3, data: 'ZGVm' })
    expect(resolve).toHaveBeenCalledTimes(afterOpen)
    expect(await host.call('workspace.upload.commit', scope(p))).toEqual({ name: 'paced', path: './paced', bytes: 6 })
    expect(resolve.mock.calls.length).toBeGreaterThanOrEqual(afterOpen + 1)
    expect(await readFile(join(root, 'paced'), 'utf8')).toBe('abcdef')
  })

  it('never publishes when the session authority is revoked between chunks', async () => {
    const { root } = await setup()
    let allowed = true
    const resolve = vi.fn(async () => allowed ? root : undefined)
    const host = new WorkspaceUploadHost(resolve, undefined, () => 'Relay', () => 1_000)
    hosts.push(host)
    const p = request('revoked', 3)
    await host.call('workspace.upload.open', p)
    allowed = false
    await host.call('workspace.upload.chunk', { ...scope(p), offset: 0, data: 'YWJj' })
    expect(await readdir(root)).toHaveLength(1)
    await expect(host.call('workspace.upload.commit', scope(p))).rejects.toMatchObject({ code: 'UPLOAD_WORKSPACE_CHANGED' })
    expect(await readdir(root)).toEqual([])
  })

  it('revalidates authority after the ttl even when chunks are small', async () => {
    const { root } = await setup()
    const clock = { now: 1_000 }
    const resolve = vi.fn(async () => root)
    const host = new WorkspaceUploadHost(resolve, undefined, () => 'Relay', () => clock.now)
    hosts.push(host)
    const p = request('ttl', 6)
    await host.call('workspace.upload.open', p)
    await host.call('workspace.upload.chunk', { ...scope(p), offset: 0, data: 'YWJj' })
    const beforeTtl = resolve.mock.calls.length
    clock.now += WORKSPACE_UPLOAD_AUTHORITY_TTL_MS
    await host.call('workspace.upload.chunk', { ...scope(p), offset: 3, data: 'ZGVm' })
    expect(resolve).toHaveBeenCalledTimes(beforeTtl + 1)
    expect(await host.call('workspace.upload.commit', scope(p))).toMatchObject({ bytes: 6 })
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
    const router = new RpcRouter(undefined, logger as unknown as SafeLogger,
      undefined, undefined, () => ['workspace.upload.v1'], undefined, undefined, undefined, undefined, undefined, host)
    for (const method of ['workspace.upload.open', 'workspace.upload.chunk', 'workspace.upload.commit', 'workspace.upload.abort'] as const) {
      const response = await router.handle(createRpcRequest(method, { ...request(), endpoint: '/private/uploaded-secret.txt' }))
      expect(response).toMatchObject({ type: 'rpc.error', payload: { code: 'INVALID_MESSAGE' } })
    }
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('uploaded-secret')
  })

  it('routes upload RPCs through the encrypted business router and cleans them on peer close', async () => {
    const { root, host } = await setup()
    const router = new RpcRouter(undefined, undefined, undefined, undefined, () => ['workspace.upload.v1'],
      undefined, undefined, undefined, undefined, undefined, host)
    const p = request()
    expect(await router.handle(createRpcRequest('workspace.upload.open', p))).toMatchObject({ type: 'rpc.response', payload: { result: { uploadId: p.uploadId } } })
    await router.closePeerStreams()
    expect(await readdir(root)).toEqual([])
    expect(await router.handle(createRpcRequest('workspace.upload.open', request()))).toMatchObject({ type: 'rpc.error', payload: { code: 'UPLOAD_CLOSED' } })
  })
})

it('negotiates binary chunks explicitly and preserves legacy open responses', async () => {
  const { host, root } = await setup()
  const legacy = request('legacy.bin', 3)
  expect(await host.call('workspace.upload.open', legacy)).toEqual({ uploadId: legacy.uploadId, chunkBytes: WORKSPACE_UPLOAD_CHUNK })
  await host.call('workspace.upload.chunk', { ...scope(legacy), offset: 0, data: 'AP8M' })
  await host.call('workspace.upload.commit', scope(legacy))
  const bytes = new Uint8Array(256 * 1024).map((_, i) => i % 251)
  const binary = { ...request('binary.bin', bytes.length), encoding: 'binary-v1' }
  expect(await host.call('workspace.upload.open', binary)).toEqual({ uploadId: binary.uploadId, chunkBytes: bytes.length, encoding: 'binary-v1' })
  await host.call('workspace.upload.chunk.binary', { ...scope(binary), offset: 0, data: bytes })
  await host.call('workspace.upload.commit', scope(binary))
  expect(await readFile(join(root, 'binary.bin'))).toEqual(Buffer.from(bytes))
  expect(await readFile(join(root, 'legacy.bin'))).toEqual(Buffer.from([0, 255, 12]))
})

it('rejects mixed encodings, wrong offsets and oversized binary chunks and discards partial data', async () => {
  const { host } = await setup()
  for (const [encoding, method, offset, data] of [
    [undefined, 'workspace.upload.chunk.binary', 0, new Uint8Array([1])],
    ['binary-v1', 'workspace.upload.chunk', 0, 'AQ=='],
    ['binary-v1', 'workspace.upload.chunk.binary', 1, new Uint8Array([1])],
    ['binary-v1', 'workspace.upload.chunk.binary', 0, new Uint8Array(256 * 1024 + 1)],
  ] as const) {
    const p = { ...request('bad.bin', 300000), ...(encoding ? { encoding } : {}) }
    await host.call('workspace.upload.open', p)
    await expect(host.call(method, { ...scope(p), offset, data })).rejects.toThrow()
    await expect(host.call('workspace.upload.commit', scope(p))).rejects.toThrow()
  }
})

it('advertises binary upload only with the base capability and a working upload service', async () => {
  const { host } = await setup()
  const describe = createRpcRequest('harness.transport.describe', {})
  for (const [base, service, expected] of [[true, true, true], [true, false, false], [false, true, false]] as const) {
    const router = new RpcRouter(128, undefined, undefined, undefined, () => [...(base ? ['workspace.upload.v1'] : []), 'workspace.upload.binary.v1'], undefined, undefined, undefined, undefined, undefined, service ? host : undefined)
    const response = await router.handle(describe)
    expect((response.payload as { result: { capabilities: string[] } }).result.capabilities.includes('workspace.upload.binary.v1')).toBe(expected)
  }
})
it('keeps binary uploads connection/session scoped after a foreign session attempts a chunk', async () => {
  const { host, root } = await setup()
  const p = { ...request('scoped.bin', 1), encoding: 'binary-v1' }
  await host.call('workspace.upload.open', p)
  await expect(host.call('workspace.upload.chunk.binary', { ...scope(p), sessionId: 'foreign', offset: 0, data: new Uint8Array([42]) })).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND' })
  await host.call('workspace.upload.chunk.binary', { ...scope(p), offset: 0, data: new Uint8Array([42]) })
  await host.call('workspace.upload.commit', scope(p))
  expect(await readFile(join(root, 'scoped.bin'))).toEqual(Buffer.from([42]))
})
it('carries binary chunks through the real client codec, RPC router and ordinary JSON responses', async () => {
  const { RemoteClientCore } = await import('@dsh-remote/client-core')
  const { encodeMessage, decodeMessage } = await import('@dsh-remote/protocol')
  const { host, root } = await setup()
  const router = new RpcRouter(128, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, host)
  let receive: ((data: Uint8Array) => void) | undefined
  const frames: Uint8Array[] = []
  const client = new RemoteClientCore({
    async connect() {},
    async send(data) { frames.push(data); receive?.(encodeMessage(await router.handle(decodeMessage(data)))) },
    onMessage(handler) { receive = handler; return () => { receive = undefined } },
    async close() {},
    getStats: () => ({ mode: 'LAN', connected: true }),
  })
  try {
    await client.connect()
    const data = new Uint8Array(256 * 1024).map((_, i) => i % 251)
    const p = { ...request('wire.bin', data.length), encoding: 'binary-v1' }
    await client.rpc('workspace.upload.open', p)
    await expect(client.rpc('workspace.upload.chunk.binary', { ...scope(p), offset: 0, data })).resolves.toEqual({ uploadId: p.uploadId, receivedBytes: data.length })
    await expect(client.rpc('workspace.upload.commit', scope(p))).resolves.toEqual({ name: 'wire.bin', path: './wire.bin', bytes: data.length })
    expect(frames[1]!.byteLength).toBeLessThan(data.length + 4096)
    expect(await readFile(join(root, 'wire.bin'))).toEqual(Buffer.from(data))
  } finally { await client.close() }
})
