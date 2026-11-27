import { workspaceUploadMaxBytes } from './workspace-transfer-limits.js'
import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { RemoteClientCore } from '@dsh-remote/client-core'
import { z } from 'zod'
import { BINARY_UPLOAD_CHUNK_BYTES } from '@dsh-remote/protocol'

type UploadFeatures = { binaryUpload?: boolean; memberRelayUpload?: boolean }
const CHUNK = 64 * 1024

type UploadClient = Pick<RemoteClientCore, 'rpc'> & Partial<Pick<RemoteClientCore, 'getStats'>>
type UploadOutcome =
  | { status: 'accepted'; name: string; path: string; bytes: number }
  | { status: 'rejected' | 'unknown' }

/** Reuses the dedicated connection-owned uploader, never a filesystem RPC. */
export async function uploadRemoteFile(client: UploadClient, sessionId: string,
  localPath: string, name: string, signal: AbortSignal, assertCurrent: () => void, features: UploadFeatures = {}): Promise<UploadOutcome> {
  let file: FileHandle | undefined
  try {
    file = await open(localPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const handle = file
    const before = await handle.stat()
    if (!before.isFile()) return { status: 'rejected' }
    return await uploadWorkspaceSource(client, sessionId, name, before.size, signal, assertCurrent, features, async (offset, length) => {
      const buffer = Buffer.alloc(length)
      const read = await handle.read(buffer, 0, length, offset)
      return buffer.subarray(0, read.bytesRead)
    }, async () => {
      const after = await handle.stat()
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error('LOCAL_UPLOAD_FILE_CHANGED')
      }
    })
  } catch {
    return { status: 'rejected' }
  } finally {
    await file?.close()
  }
}

/** Desktop browser input already arrives as bytes. */
export async function uploadRemoteBuffer(client: UploadClient, sessionId: string, name: string,
  data: Uint8Array, signal: AbortSignal, assertCurrent: () => void, features: UploadFeatures = {}) {
  const result = await uploadWorkspaceSource(client, sessionId, name, data.byteLength, signal, assertCurrent, features,
    (offset, size) => data.subarray(offset, offset + size))
  if (result.status === 'accepted') return result
  throw new Error(result.status === 'unknown'
    ? 'The upload result is uncertain. Check the remote workspace before retrying.'
    : 'The file could not be uploaded to the selected CodeX workspace.')
}

async function uploadWorkspaceSource(client: UploadClient, sessionId: string, name: string,
  totalBytes: number, signal: AbortSignal, assertCurrent: () => void, features: UploadFeatures,
  read: (offset: number, length: number) => Uint8Array | Promise<Uint8Array>,
  beforeCommit?: () => Promise<void>,
): Promise<UploadOutcome> {
  const uploadId = randomUUID()
  const scope = { sessionId, uploadId }
  let remoteOpened = false
  const pending: Promise<boolean>[] = []
  let failed = false
  let committing = false
  const check = () => {
    signal.throwIfAborted()
    assertCurrent()
    if (totalBytes > workspaceUploadMaxBytes(client.getStats?.().mode, features.memberRelayUpload)) throw new Error('UPLOAD_TRANSPORT_LIMIT')
  }
  const call = async (method: string, params: object) => {
    check()
    const result = await client.rpc(method, params, signal)
    check()
    return result
  }
  try {
    check()
    remoteOpened = true
    const binary = features.binaryUpload === true
    const opened = z.object({
      uploadId: z.literal(uploadId),
      chunkBytes: z.number().int().min(1).max(binary ? BINARY_UPLOAD_CHUNK_BYTES : CHUNK),
      encoding: z.literal('binary-v1').optional(),
    })
      .parse(await call('workspace.upload.open', { ...scope, name, totalBytes, ...(binary ? { encoding: 'binary-v1' } : {}) }))
    if (opened.encoding !== (binary ? 'binary-v1' : undefined)) throw new Error('UPLOAD_ENCODING_MISMATCH')
    let offset = 0
    while (offset < totalBytes) {
      check()
      const length = Math.min(opened.chunkBytes, totalBytes - offset)
      const chunk = await read(offset, length)
      if (failed) throw new Error('UPLOAD_CHUNK_FAILED')
      if (chunk.length !== length) throw new Error('LOCAL_UPLOAD_FILE_CHANGED')
      const next = offset + chunk.length
      const ack = call(binary ? 'workspace.upload.chunk.binary' : 'workspace.upload.chunk', {
        ...scope, offset, data: binary ? chunk : Buffer.from(chunk).toString('base64'),
      }).then(result => {
        z.object({ uploadId: z.literal(uploadId), receivedBytes: z.literal(next) }).parse(result)
        return true
      }).catch(() => { failed = true; return false })
      pending.push(ack)
      if (pending.length >= (binary ? 4 : 1) && !await pending.shift()) throw new Error('UPLOAD_CHUNK_FAILED')
      offset = next
    }
    if (!(await Promise.all(pending)).every(Boolean)) throw new Error('UPLOAD_CHUNK_FAILED')
    await beforeCommit?.()
    check()
    committing = true
    const result = z.object({ name: z.string().min(1), path: z.string().min(1), bytes: z.literal(totalBytes) })
      .parse(await call('workspace.upload.commit', scope))
    return { status: 'accepted', ...result }
  } catch {
    await Promise.all(pending)
    if (remoteOpened) await client.rpc('workspace.upload.abort', scope, AbortSignal.timeout(5_000)).catch(() => undefined)
    return { status: committing ? 'unknown' : 'rejected' }
  }
}
