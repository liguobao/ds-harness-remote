import { mkdtemp, writeFile, readFile, readdir, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadRemoteBuffer, uploadRemoteFile } from '../src/remote-file-upload.js'
import { WorkspaceUploadHost } from '../src/workspace-upload.js'
import { RemoteSessionTools } from '../src/remote-session-tools.js'
import { RemoteTypertGateway } from '../src/remote-typert-gateway.js'
import type { ConnectedRemote } from '../src/client-runtime-contract.js'
import type { RemoteClientCore } from '@dsh-remote/client-core'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

afterEach(() => vi.restoreAllMocks())
describe('Remote upload tool transfer and receipts', () => {
  it('checks the actual client path before reading large files and stops after a path downgrade', async () => {
    await runScenarios(['LAN', 'P2P', 'TURN', 'Relay', undefined].map(initial => ({ name: initial ?? 'unknown', run: async () => {
      const root = await mkdtemp(join(tmpdir(), 'remote-upload-limit-'))
      const local = join(root, 'large.bin')
      await writeFile(local, '')
      await truncate(local, 21 * 1024 * 1024)
      let mode = initial
      const rpc = vi.fn(async (method: string, params: { uploadId: string }) => {
        if (method === 'workspace.upload.open') {
          mode = 'Relay'
          return { uploadId: params.uploadId, chunkBytes: 65536 }
        }
        return { aborted: true }
      })
      try {
        const result = await uploadRemoteFile({ rpc, getStats: () => ({ mode }) } as unknown as RemoteClientCore,
          'session', local, 'large.bin', new AbortController().signal, () => {})
        expect(result.status).toBe('rejected')
        expect(rpc.mock.calls.some(([method]) => method === 'workspace.upload.open')).toBe(initial === 'LAN' || initial === 'P2P')
        expect(rpc.mock.calls.some(([method]) => method === 'workspace.upload.chunk' || method === 'workspace.upload.commit')).toBe(false)
      } finally { await rm(root, { recursive: true, force: true }) }
    } })))
  })
  it('uses the real uploader without overwrites and cleans partial data on cancellation or source change', async () => {
    await runScenarios(['success', 'cancel', 'changed', 'unknown'].map(kind => ({ name: kind, run: async () => {
      const root = await mkdtemp(join(tmpdir(), 'remote-upload-tool-'))
      const local = join(root, 'source.bin')
      const remote = join(root, 'remote')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(remote)
      await writeFile(local, Buffer.alloc(140000, 7))
      await writeFile(join(remote, 'result.bin'), 'existing')
      const host = new WorkspaceUploadHost(async () => remote)
      const controller = new AbortController()
      const rpc = vi.fn(async (method: string, params: unknown) => {
        const result = await host.call(method, params)
        if (method === 'workspace.upload.chunk' && kind === 'cancel') controller.abort()
        if (method === 'workspace.upload.chunk' && kind === 'changed') await writeFile(local, 'changed')
        if (method === 'workspace.upload.commit' && kind === 'unknown') throw new Error('lost response')
        return result
      })
      try {
        const result = await uploadRemoteFile({ rpc } as unknown as RemoteClientCore, 'session', local, 'result.bin', controller.signal, () => {})
        expect(await readFile(join(remote, 'result.bin'), 'utf8')).toBe('existing')
        if (kind === 'success' || kind === 'unknown') {
          expect(result.status).toBe(kind === 'success' ? 'accepted' : 'unknown')
          expect(await readFile(join(remote, 'result (1).bin'))).toEqual(Buffer.alloc(140000, 7))
        } else expect(result.status).toBe('rejected')
        expect((await readdir(remote)).some(name => name.endsWith('.part'))).toBe(false)
      } finally { await host.closeAll(); await rm(root, { recursive: true, force: true }) }
    } })))
  })

  it('publishes Desktop CodeX bytes in the authorized workspace and never overwrites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remote-desktop-upload-'))
    const host = new WorkspaceUploadHost(async (sessionId) => sessionId === 'codex:thread' ? root : undefined)
    const rpc = vi.fn((method: string, params: unknown) => host.call(method, params))
    const client = { rpc, getStats: () => ({ mode: 'Relay' }) } as unknown as RemoteClientCore
    const signal = new AbortController().signal
    const bytes = Buffer.alloc(1024 * 1024 + 13, 7)
    try {
      await writeFile(join(root, 'notes.txt'), 'existing')
      await expect(uploadRemoteBuffer(client, 'codex:foreign', 'notes.txt', bytes, signal, () => {})).rejects.toThrow()
      await expect(uploadRemoteBuffer(client, 'codex:thread', 'notes.txt', bytes, signal, () => {}, { binaryUpload: true })).resolves.toMatchObject({
        path: './notes (1).txt', bytes: bytes.length,
      })
      expect(rpc.mock.calls.filter(([method]) => method === 'workspace.upload.chunk.binary')).toHaveLength(5)
      expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('existing')
      expect(await readFile(join(root, 'notes (1).txt'))).toEqual(bytes)
      expect(rpc.mock.calls.filter(([method]) => method === 'workspace.upload.commit')).toHaveLength(1)
    } finally {
      await host.closeAll()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('deduplicates upload operations and rejects foreign sessions before reading or transmitting local files', async () => {
    const invoke = vi.spyOn(RemoteTypertGateway.prototype, 'invoke').mockResolvedValue({ items: [] })
    vi.spyOn(RemoteTypertGateway.prototype, 'open').mockResolvedValue((async function* () {
      yield { type: 'baseline', value: { items: [{ workspaceId: 'workspace', title: 'Workspace', path: '/workspace', sessionIds: [] }] } }
    })())
    const rpc = vi.fn()
    const tools = new RemoteSessionTools(async (_host, signal, query) => query({ features: { remoteGateway: true }, client: { rpc } } as unknown as ConnectedRemote, signal))
    const args = { hostId: 'host', backend: 'harness', workspaceId: 'workspace', sessionId: 'foreign', operationId: 'upload_operation_001', localPath: '/never-read' }
    const signal = new AbortController().signal
    const [a, b] = await Promise.all([tools.run('remote_upload_file', args, signal), tools.run('remote_upload_file', args, signal)])
    expect(a).toEqual(b)
    expect(a).toMatchObject({ status: 'rejected' })
    expect(invoke).toHaveBeenCalledOnce()
    expect(rpc).not.toHaveBeenCalled()
    expect(await tools.run('remote_get_operation', { operationId: args.operationId }, signal)).toEqual(a)
    await expect(tools.run('remote_upload_file', { ...args, localPath: '/other' }, signal)).rejects.toThrow('OPERATION_ID_CONFLICT')
  })

  it('reports a missing local file as rejected without sending an abort RPC', async () => {
    const rpc = vi.fn()
    const result = await uploadRemoteFile({ rpc } as unknown as RemoteClientCore,
      'session', '/missing/local-file', 'file.bin', new AbortController().signal, () => {})
    expect(result).toEqual({ status: 'rejected' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
