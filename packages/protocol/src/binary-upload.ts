import type { RemoteMessage } from './index.js'

export const BINARY_UPLOAD_CAPABILITY = 'workspace.upload.binary.v1' as const
export const BINARY_UPLOAD_CHUNK_BYTES = 256 * 1024
const BINARY_UPLOAD_MAGIC = new Uint8Array([0x44, 0x53, 0x48, 0x55, 0x50, 1, 0, 0])
const BINARY_UPLOAD_PREFIX_BYTES = 12
const BINARY_UPLOAD_MAX_HEADER_BYTES = 4096
const BINARY_UPLOAD_METHOD = 'workspace.upload.chunk.binary'

/** Dedicated RPC framing below Noise. Only the negotiated upload method may carry raw bytes. */
export function encodeBinaryUpload(message: RemoteMessage): Uint8Array | undefined {
  if (message.type !== 'rpc.request' || !isBinaryUploadRecord(message.payload) || message.payload.method !== BINARY_UPLOAD_METHOD) return undefined
  const params = message.payload.params
  if (!isBinaryUploadRecord(params) || !(params.data instanceof Uint8Array)) throw new Error('Binary upload requires bytes')
  const { data, ...metadata } = params
  if (!data.byteLength || data.byteLength > BINARY_UPLOAD_CHUNK_BYTES) throw new Error('Binary upload chunk exceeds limit')
  const header = new TextEncoder().encode(JSON.stringify({ ...message, payload: { method: BINARY_UPLOAD_METHOD, params: metadata } }))
  if (header.byteLength > BINARY_UPLOAD_MAX_HEADER_BYTES) throw new Error('Binary upload header exceeds limit')
  const frame = new Uint8Array(BINARY_UPLOAD_PREFIX_BYTES + header.byteLength + data.byteLength)
  frame.set(BINARY_UPLOAD_MAGIC)
  new DataView(frame.buffer).setUint32(8, header.byteLength, false)
  frame.set(header, BINARY_UPLOAD_PREFIX_BYTES)
  frame.set(data, BINARY_UPLOAD_PREFIX_BYTES + header.byteLength)
  return frame
}

export function decodeBinaryUpload(data: Uint8Array | string): unknown | undefined {
  if (typeof data === 'string' || data[0] !== BINARY_UPLOAD_MAGIC[0] || data[1] !== BINARY_UPLOAD_MAGIC[1] || data[2] !== BINARY_UPLOAD_MAGIC[2] || data[3] !== BINARY_UPLOAD_MAGIC[3]) return undefined
  if (data.byteLength < BINARY_UPLOAD_PREFIX_BYTES || !BINARY_UPLOAD_MAGIC.every((byte, index) => data[index] === byte)) throw new Error('Invalid binary upload prefix')
  const headerBytes = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(8, false)
  const chunkBytes = data.byteLength - BINARY_UPLOAD_PREFIX_BYTES - headerBytes
  if (!headerBytes || headerBytes > BINARY_UPLOAD_MAX_HEADER_BYTES || chunkBytes < 1 || chunkBytes > BINARY_UPLOAD_CHUNK_BYTES) throw new Error('Invalid binary upload bounds')
  const message: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(BINARY_UPLOAD_PREFIX_BYTES, BINARY_UPLOAD_PREFIX_BYTES + headerBytes)))
  if (!isBinaryUploadRecord(message) || message.type !== 'rpc.request' || !isBinaryUploadRecord(message.payload)
    || message.payload.method !== BINARY_UPLOAD_METHOD || !isBinaryUploadRecord(message.payload.params) || 'data' in message.payload.params) throw new Error('Invalid binary upload header')
  return { ...message, payload: { ...message.payload, params: { ...message.payload.params, data: data.subarray(BINARY_UPLOAD_PREFIX_BYTES + headerBytes) } } }
}

function isBinaryUploadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
