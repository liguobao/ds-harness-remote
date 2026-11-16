import { expect, it, vi } from 'vitest'
import { uploadStagedFileToWorkspace, type RpcCaller } from '../src/screens/chat-files'
import { BINARY_UPLOAD_CHUNK_BYTES } from '@dsh-remote/protocol'
it('uses binary only with negotiated support, including raw chunks and bounded window', async () => {
  const content = 'x'.repeat(BINARY_UPLOAD_CHUNK_BYTES * 5 + 9)
  const calls: { method: string; params: any }[] = []
  const rpc: RpcCaller = Object.assign(async (method: string, params: any) => {
    calls.push({ method, params })
    if (method.endsWith('.open')) return { uploadId: params.uploadId, chunkBytes: BINARY_UPLOAD_CHUNK_BYTES, encoding: 'binary-v1' }
    if (method.endsWith('.commit')) return { name: 'file.bin', path: './file.bin', bytes: content.length }
    return { uploadId: params.uploadId, receivedBytes: params.offset + params.data.length }
  }, { supportsBinaryUpload: true })
  await uploadStagedFileToWorkspace(rpc, 's1', { id: 'f', name: 'file.bin', uri: '', size: content.length, content })
  expect(calls[0]!.params.encoding).toBe('binary-v1')
  const chunks = calls.filter(c => c.method === 'workspace.upload.chunk.binary')
  expect(chunks).toHaveLength(6)
  expect(chunks.map(c => c.params.offset)).toEqual([0, 1, 2, 3, 4, 5].map(i => i * BINARY_UPLOAD_CHUNK_BYTES))
  expect(chunks.every(c => c.params.data instanceof Uint8Array && c.params.data.length <= BINARY_UPLOAD_CHUNK_BYTES)).toBe(true)
})
it('keeps old Host requests unchanged and never probes binary with a mutation', async () => {
  const calls: any[] = []
  const rpc: RpcCaller = async (method, params) => {
    calls.push({ method, params })
    if (method.endsWith('.open')) return { chunkBytes: 65536 }
    if (method.endsWith('.commit')) return { path: './file.bin' }
    return {}
  }
  await uploadStagedFileToWorkspace(rpc, 's1', { id: 'f', name: 'file.bin', uri: '', size: 3, content: 'abc' })
  expect(calls[0].params).not.toHaveProperty('encoding')
  expect(calls[1]).toMatchObject({ method: 'workspace.upload.chunk', params: { data: 'YWJj' } })
})
it('aborts a mismatched binary negotiation without sending chunks or replaying open', async () => {
  const rpc: RpcCaller = Object.assign(vi.fn(async () => ({ chunkBytes: 65536 })), { supportsBinaryUpload: true })
  await expect(uploadStagedFileToWorkspace(rpc, 's1', { id: 'f', name: 'file.bin', uri: '', size: 3, content: 'abc' })).rejects.toThrow('negotiation')
  expect((rpc as any).mock.calls.map((c: any[]) => c[0])).toEqual(['workspace.upload.open', 'workspace.upload.abort'])
})
it('rejects incorrect confirmations and never commits or replays a failed chunk', async () => {
  const methods: string[] = []
  const rpc: RpcCaller = Object.assign(async (method: string, params: any) => {
    methods.push(method)
    if (method.endsWith('.open')) return { uploadId: params.uploadId, chunkBytes: BINARY_UPLOAD_CHUNK_BYTES, encoding: 'binary-v1' }
    if (method.endsWith('.binary')) return { uploadId: params.uploadId, receivedBytes: 0 }
    return {}
  }, { supportsBinaryUpload: true })
  await expect(uploadStagedFileToWorkspace(rpc, 's1', { id: 'f', uri: '', name: 'f.bin', size: 1, content: 'x' })).rejects.toThrow('acknowledgement')
  expect(methods).toEqual(['workspace.upload.open', 'workspace.upload.chunk.binary', 'workspace.upload.abort'])
})
