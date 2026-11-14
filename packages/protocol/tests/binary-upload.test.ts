import { expect, it } from 'vitest'
import { BINARY_UPLOAD_CHUNK_BYTES, createRpcRequest, decodeMessage, encodeMessage } from '../src/index.js'
const params = (data = new Uint8Array([0, 255, 123])) => ({ sessionId: '会话', uploadId: '018f4321-1234-7123-8123-123456789abc', offset: 0, data })
it('round trips raw upload bytes, ids and metadata without changing JSON RPC', () => {
  for (const size of [1, 65536, BINARY_UPLOAD_CHUNK_BYTES]) {
    const message = createRpcRequest('workspace.upload.chunk.binary', params(new Uint8Array(size).map((_, i) => i % 251)))
    const encoded = encodeMessage(message)
    expect(encoded.length).toBeLessThan(size + 4096)
    expect(decodeMessage(encoded)).toEqual(message)
    // Views may start at a nonzero byte offset.
    const backing = new Uint8Array(encoded.length + 7); backing.set(encoded, 7)
    expect(decodeMessage(backing.subarray(7))).toEqual(message)
  }
  const legacy = createRpcRequest('workspace.upload.chunk', { ...params(), data: 'AP97' })
  expect(new TextDecoder().decode(encodeMessage(legacy))).toBe(JSON.stringify(legacy))
  expect(decodeMessage(encodeMessage(legacy))).toEqual(legacy)
})
it('rejects truncated, oversized, version-mismatched and non-upload binary frames', () => {
  const frame = encodeMessage(createRpcRequest('workspace.upload.chunk.binary', params()))
  for (const end of [4, 8, 11, frame.length - 3]) expect(() => decodeMessage(frame.subarray(0, end))).toThrow()
  const version = frame.slice(); version[5] = 2
  expect(() => decodeMessage(version)).toThrow()
  const oversizedHeader = frame.slice(); new DataView(oversizedHeader.buffer).setUint32(8, 4097)
  expect(() => decodeMessage(oversizedHeader)).toThrow()
  expect(() => encodeMessage(createRpcRequest('workspace.upload.chunk.binary', params(new Uint8Array(BINARY_UPLOAD_CHUNK_BYTES + 1))))).toThrow()
  expect(() => encodeMessage(createRpcRequest('workspace.upload.chunk.binary', params(new Uint8Array())))).toThrow()
  const header = new TextDecoder().decode(frame.subarray(12, frame.length - 3)).replace('workspace.upload.chunk.binary', 'workspace.upload.abort')
  const bytes = new TextEncoder().encode(header), bad = new Uint8Array(12 + bytes.length + 3)
  bad.set(frame.subarray(0, 8)); new DataView(bad.buffer).setUint32(8, bytes.length); bad.set(bytes, 12); bad.set([1, 2, 3], 12 + bytes.length)
  expect(() => decodeMessage(bad)).toThrow()
})
