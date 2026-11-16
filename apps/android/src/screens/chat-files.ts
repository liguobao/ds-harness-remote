import { BINARY_UPLOAD_CHUNK_BYTES } from '@dsh-remote/protocol'
import type { ImageAttachmentLimits } from '../types'

/**
 * Chat file staging, workspace upload, and prompt formatting helpers.
 *
 * Implements:
 * 1. Host-side workspace staging through the `workspace.upload.*` RPC protocol:
 *    - workspace.upload.open   { sessionId, uploadId, name, totalBytes }
 *    - workspace.upload.chunk  { sessionId, uploadId, offset, data(base64) }
 *    - workspace.upload.commit { sessionId, uploadId }
 *    - workspace.upload.abort  { sessionId, uploadId } (cleanup on error)
 * 2. @path reference-based prompt formatting so the Agent reads files via host tools
 *    rather than having massive file bodies injected into the prompt.
 */

export interface StagedFile {
  id: string
  name: string
  size: number
  mimeType?: string
  uri: string
  content?: string
  remotePath?: string
  durationMs?: number
}

export interface UploadedFileRef {
  name: string
  path: string
  bytes: number
}

export interface UploadProgress {
  fileIndex: number
  fileCount: number
  fileName: string
  bytesSent: number
  totalBytes: number
}

export type RpcCaller = ((method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>) & { supportsBinaryUpload?: boolean }

export const MAX_INLINE_TEXT_BYTES = 512 * 1024 // 512 KB
export const MAX_TOTAL_INLINE_TEXT_BYTES = 2 * 1024 * 1024 // 2 MB
export const MAX_SINGLE_FILE_BYTES = MAX_INLINE_TEXT_BYTES
export const MAX_TOTAL_FILES_BYTES = MAX_TOTAL_INLINE_TEXT_BYTES
export const UPLOAD_CHUNK_BYTES = 64 * 1024 // 64 KiB protocol chunk
export const MAX_RELAY_UPLOAD_BYTES = 20 * 1024 * 1024 // 20 MiB
export const MAX_DIRECT_UPLOAD_BYTES = 1024 * 1024 * 1024 // 1 GiB
export const MAX_FALLBACK_BUFFER_BYTES = 32 * 1024 * 1024 // 32 MiB cap when native File.open is unavailable

// Local memory ceilings also apply when an older Host omits imageLimits.
const MAX_DOCUMENT_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_DOCUMENT_IMAGES_BYTES = 32 * 1024 * 1024
const MAX_UPLOAD_NAME_UTF8_BYTES = 220

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function isDirectTransportMode(mode: string | undefined): boolean {
  return mode === 'LAN' || mode === 'P2P'
}

/** Matches Host workspaceUploadMaxBytes(mode): 1 GiB over LAN/P2P, 20 MiB otherwise. */
export function workspaceUploadMaxBytes(mode: string | undefined): number {
  return isDirectTransportMode(mode) ? MAX_DIRECT_UPLOAD_BYTES : MAX_RELAY_UPLOAD_BYTES
}

/**
 * Pure TypeScript RFC 4648 base64 encoder that works uniformly across
 * Hermes, JavaScriptCore, browser, and Node.js without Buffer or btoa.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length
  const out: string[] = []
  let i = 0

  for (; i + 2 < len; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | (bytes[i + 2]!)
    out.push(
      B64_ALPHABET[(n >>> 18) & 0x3f]! +
        B64_ALPHABET[(n >>> 12) & 0x3f]! +
        B64_ALPHABET[(n >>> 6) & 0x3f]! +
        B64_ALPHABET[n & 0x3f]!,
    )
  }

  if (i < len) {
    const a = bytes[i]!
    const b = i + 1 < len ? bytes[i + 1]! : 0
    const n = (a << 16) | (b << 8)
    const c1 = B64_ALPHABET[(n >>> 18) & 0x3f]!
    const c2 = B64_ALPHABET[(n >>> 12) & 0x3f]!
    const c3 = i + 1 < len ? B64_ALPHABET[(n >>> 6) & 0x3f]! : '='
    out.push(`${c1}${c2}${c3}=`)
  }

  return out.join('')
}

/** Generate an RFC 4122 UUID v4 required by Host workspace.upload.* schema validation. */
export function generateUploadId(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripLeadingDotSlash(value: string): string {
  let out = value.trim()
  while (out.startsWith('./')) {
    out = out.slice(2)
  }
  return out
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('upload-aborted')
    error.name = 'AbortError'
    throw error
  }
}

async function abortUploadQuietly(rpc: RpcCaller, sessionId: string, uploadId: string): Promise<void> {
  try {
    const cleanupSignal = AbortSignal.timeout(5_000)
    await rpc('workspace.upload.abort', { sessionId, uploadId }, cleanupSignal)
  } catch {
    // Cleanup errors must not mask the original failure.
  }
}

interface ChunkReader {
  totalBytes: number
  read(offset: number, length: number): Promise<Uint8Array>
  readBase64?(offset: number, length: number): Promise<string>
  close(): Promise<void> | void
}

async function openFileChunkReader(file: StagedFile, signal?: AbortSignal): Promise<ChunkReader> {
  throwIfAborted(signal)
  if (typeof file.content === 'string') {
    const bytes = new TextEncoder().encode(file.content)
    return {
      totalBytes: bytes.byteLength,
      async read(offset, length) {
        return bytes.subarray(offset, Math.min(offset + length, bytes.byteLength))
      },
      close() {},
    }
  }
  if (file.uri) {
    try {
      const fsMod = await import('expo-file-system')
      if (typeof fsMod.File === 'function' && fsMod.FileMode?.ReadOnly !== undefined) {
        const localFile = new fsMod.File(file.uri)
        // Native bounded range encoding avoids copying every byte through Hermes.
        const legacy = file.uri.startsWith('file://')
          ? await import('expo-file-system/legacy').catch(() => undefined)
          : undefined
        const handle = localFile.open(fsMod.FileMode.ReadOnly)
        const size = handle.size ?? localFile.size ?? file.size
        if (typeof size === 'number' && Number.isFinite(size) && size >= 0) {
          return {
            totalBytes: size,
            ...(legacy ? {
              readBase64: (offset: number, length: number) => legacy.readAsStringAsync(file.uri, {
                encoding: legacy.EncodingType.Base64, position: offset, length,
              }),
            } : {}),
            async read(_offset, length) {
              const chunk = handle.readBytes(length)
              if (chunk.byteLength === 0 && length > 0) {
                throw new Error(`Unexpected end of file while reading ${file.name}`)
              }
              return chunk
            },
            close() {
              try {
                handle.close()
              } catch {
                // Ignore close failures during cleanup.
              }
            },
          }
        }
        try {
          handle.close()
        } catch {
          // Ignore close failures during fallback.
        }
      }
    } catch {
      // Fall back to fetch when native FileHandle is unavailable (e.g. tests or non-file URIs).
    }

    if (file.size > MAX_FALLBACK_BUFFER_BYTES) {
      throw new Error(`File ${file.name} (${file.size} bytes) exceeds safe in-memory fallback limit`)
    }
    const response = await fetch(file.uri, { signal })
    if (!response.ok) {
      throw new Error(`Failed to read file ${file.name} from ${file.uri}`)
    }
    const contentLengthHeader = response.headers?.get?.('content-length')
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN
    if (Number.isFinite(contentLength) && contentLength > MAX_FALLBACK_BUFFER_BYTES) {
      throw new Error(`File ${file.name} (${contentLength} bytes) exceeds safe in-memory fallback limit`)
    }
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_FALLBACK_BUFFER_BYTES) {
      throw new Error(`File ${file.name} (${buffer.byteLength} bytes) exceeds safe in-memory fallback limit`)
    }
    throwIfAborted(signal)
    const bytes = new Uint8Array(buffer)
    return {
      totalBytes: bytes.byteLength,
      async read(offset, length) {
        return bytes.subarray(offset, Math.min(offset + length, bytes.byteLength))
      },
      close() {},
    }
  }
  return {
    totalBytes: 0,
    async read() {
      return new Uint8Array(0)
    },
    close() {},
  }
}

/**
 * Upload a staged file to the host workspace root using the official
 * `workspace.upload.*` protocol.
 */
export async function uploadStagedFileToWorkspace(
  rpc: RpcCaller,
  sessionId: string,
  file: StagedFile,
  signal?: AbortSignal,
  onProgress?: (bytesSent: number, totalBytes: number) => void,
): Promise<UploadedFileRef> {
  // Reuse existing remotePath if already uploaded in an earlier attempt/retry
  if (typeof file.remotePath === 'string' && file.remotePath.trim().length > 0) {
    onProgress?.(file.size, file.size)
    return { name: file.name, path: file.remotePath, bytes: file.size }
  }

  throwIfAborted(signal)

  const reader = await openFileChunkReader(file, signal)
  const totalBytes = reader.totalBytes
  const binary = rpc.supportsBinaryUpload === true
  const uploadId = generateUploadId()
  let committed = false
  let opened = false
  // Keep at most four negotiated chunks (1 MiB for binary) in flight. Sends remain in offset order.
  const pending: Promise<{ end: number; error?: unknown; failed: boolean }>[] = []
  let chunkFailed = false
  let chunkError: unknown

  try {
    throwIfAborted(signal)
    const openRes = await rpc('workspace.upload.open', {
      sessionId,
      uploadId,
      name: file.name,
      totalBytes,
      ...(binary ? { encoding: 'binary-v1' } : {}),
    }, signal)
    opened = true

    if (!isRecord(openRes)) throw new Error('workspace.upload.open returned a non-object')
    const chunkBytes = openRes.chunkBytes === undefined ? UPLOAD_CHUNK_BYTES : openRes.chunkBytes
    if (typeof chunkBytes !== 'number' || !Number.isSafeInteger(chunkBytes)
      || chunkBytes < 1 || chunkBytes > (binary ? BINARY_UPLOAD_CHUNK_BYTES : UPLOAD_CHUNK_BYTES)) throw new Error('Invalid upload chunk size')

    if (binary && (openRes.encoding !== 'binary-v1' || openRes.uploadId !== uploadId)) throw new Error('Binary upload negotiation failed')
    onProgress?.(0, totalBytes)

    let offset = 0
    while (offset < totalBytes || pending.length > 0) {
      // Read serially and enqueue in order; overlap reads/encoding with RPC round trips.
      while (offset < totalBytes && pending.length < 4) {
        throwIfAborted(signal)
        if (chunkFailed) throw chunkError
        const sliceLength = Math.min(chunkBytes, totalBytes - offset)
        const data = binary ? await reader.read(offset, sliceLength) : reader.readBase64
          ? await reader.readBase64(offset, sliceLength)
          : bytesToBase64(await reader.read(offset, sliceLength))
        const bytesRead = typeof data === 'string'
          ? data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
          : data.byteLength
        if (bytesRead !== sliceLength) throw new Error(`Unexpected chunk length while reading ${file.name}`)
        throwIfAborted(signal)
        if (chunkFailed) throw chunkError
        const end = offset + bytesRead
        // Attach rejection handling immediately, including for later chunks in the window.
        const request = rpc(binary ? 'workspace.upload.chunk.binary' : 'workspace.upload.chunk', { sessionId, uploadId, offset, data }, signal)
          .then(result => {
            if (!isRecord(result)) throw new Error('workspace.upload.chunk returned a non-object')
            if (binary && (result.uploadId !== uploadId || result.receivedBytes !== end)) throw new Error('Invalid binary upload acknowledgement')
            return { end, failed: false }
          }).catch(error => {
            chunkFailed = true
            chunkError = error
            return { end, failed: true, error }
          })
        pending.push(request)
        offset = end
      }
      const acknowledged = await pending.shift()!
      if (acknowledged.failed) throw acknowledged.error
      onProgress?.(acknowledged.end, totalBytes)
    }

    throwIfAborted(signal)
    const commitRes = await rpc('workspace.upload.commit', { sessionId, uploadId }, signal)
    if (!isRecord(commitRes)) throw new Error('workspace.upload.commit returned a non-object')

    const path = commitRes.path
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new Error('workspace.upload.commit returned no valid path')
    }

    if (binary && (typeof commitRes.name !== 'string' || commitRes.path !== `./${commitRes.name}` || commitRes.bytes !== totalBytes)) throw new Error('Invalid binary upload commit')
    committed = true
    const name = typeof commitRes.name === 'string' && commitRes.name.length > 0 ? commitRes.name : file.name
    const bytesCount = typeof commitRes.bytes === 'number' ? commitRes.bytes : totalBytes

    return { name, path, bytes: bytesCount }
  } catch (error) {
    // Settle the bounded window before aborting; never commit after a failed chunk.
    await Promise.all(pending)
    if (opened && !committed) {
      await abortUploadQuietly(rpc, sessionId, uploadId)
    }
    throw error
  } finally {
    await reader.close()
  }
}

/**
 * Upload multiple staged files sequentially to the host workspace root.
 */
export async function uploadStagedFilesToWorkspace(
  rpc: RpcCaller,
  sessionId: string,
  files: StagedFile[],
  signal?: AbortSignal,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadedFileRef[]> {
  const uploaded: UploadedFileRef[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!
    throwIfAborted(signal)
    onProgress?.({
      fileIndex: index,
      fileCount: files.length,
      fileName: file.name,
      bytesSent: 0,
      totalBytes: file.size,
    })
    const result = await uploadStagedFileToWorkspace(
      rpc,
      sessionId,
      file,
      signal,
      (bytesSent, totalBytes) => {
        onProgress?.({
          fileIndex: index,
          fileCount: files.length,
          fileName: file.name,
          bytesSent,
          totalBytes,
        })
      },
    )
    file.remotePath = result.path
    uploaded.push(result)
  }
  return uploaded
}

/**
 * Format prompt with @path references for staged/uploaded files.
 * Quoting rules match desktop: filenames containing spaces use `@"path"`,
 * otherwise plain `@path`. Leading `./` is stripped for clean agent invocation.
 */
export function formatUploadedFilesReferencePrompt(
  userText: string,
  files: { name: string; path?: string }[],
): string {
  if (files.length === 0) return userText

  const refs = files.map(file => {
    const raw = file.path ?? file.name
    const clean = stripLeadingDotSlash(raw)
    const target = clean.length > 0 ? clean : file.name
    if (/[\s"]/.test(target)) {
      const escaped = target.replace(/"/g, '\\"')
      return `@"${escaped}"`
    }
    return `@${target}`
  })

  const refLine = refs.join(' ')
  const trimmed = userText.replace(/\s+$/, '')
  if (trimmed.length === 0) return refLine
  return `${trimmed}\n\n${refLine}`
}

export function documentImageReadBudget(limits?: ImageAttachmentLimits) {
  return {
    maxImageBytes: Math.min(limits?.maxImageBytes ?? MAX_DOCUMENT_IMAGE_BYTES, MAX_DOCUMENT_IMAGE_BYTES),
    maxMessageImageBytes: Math.min(limits?.maxMessageImageBytes ?? MAX_DOCUMENT_IMAGES_BYTES, MAX_DOCUMENT_IMAGES_BYTES),
  }
}

/** Guard actual disk bytes before allocating base64; picker metadata is not authoritative. */
export async function readDocumentImageBase64(
  file: { readonly size: number; base64(): Promise<string> },
  stagedBytes: number,
  limits?: ImageAttachmentLimits,
): Promise<string> {
  const budget = documentImageReadBudget(limits)
  const size = file.size
  const fits = (bytes: number) => Number.isSafeInteger(bytes) && bytes > 0
    && Number.isSafeInteger(stagedBytes) && stagedBytes >= 0
    && bytes <= budget.maxImageBytes && stagedBytes + bytes <= budget.maxMessageImageBytes
  if (!fits(size)) throw new Error('document-image-budget-exceeded')
  const base64 = await file.base64()
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  if (!fits(Math.floor(base64.length * 3 / 4) - padding)) throw new Error('document-image-budget-exceeded')
  return base64
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const
const BYTE_UNIT_STEP = 1024

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts',
  'jsx', 'tsx', 'py', 'pyw', 'java', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
  'rs', 'go', 'rb', 'php', 'swift', 'kt', 'kts', 'sh', 'bash', 'zsh',
  'bat', 'cmd', 'ps1', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'csv', 'tsv',
  'sql', 'log', 'env', 'diff', 'patch', 'graphql', 'proto', 'properties',
  'gradle', 'cmake', 'dockerfile', 'makefile', 'r', 'lua', 'dart', 'scala'
])

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', '3gp', 'flv', 'wmv', 'ts', 'mts',
])

const MIME_TO_EXTENSION: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
  'video/3gpp': '.3gp',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'application/zip': '.zip',
  'application/pdf': '.pdf',
}

export function isTextFile(fileName: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('text/')) return true
  if (mimeType === 'application/json' || mimeType === 'application/xml' || mimeType === 'application/javascript') return true
  const baseName = fileName.split(/[?#]/, 1)[0] ?? fileName
  const ext = baseName.split('.').at(-1)?.toLowerCase() ?? ''
  if (TEXT_EXTENSIONS.has(ext)) return true
  const lower = baseName.toLowerCase()
  if (lower === 'dockerfile' || lower === 'makefile' || lower === 'license' || lower === 'readme') return true
  return false
}

export function isVideoFile(fileName: string, mimeType?: string | null): boolean {
  if (mimeType?.toLowerCase().startsWith('video/')) return true
  const baseName = fileName.split(/[?#]/, 1)[0] ?? fileName
  const ext = baseName.split('.').at(-1)?.toLowerCase() ?? ''
  return VIDEO_EXTENSIONS.has(ext)
}

/**
 * Normalize a picker filename so it satisfies Host `workspace.upload.open`
 * rules (no path separators/reserved characters, UTF-8 <= 220 bytes).
 */
export function sanitizeUploadFileName(
  rawName: string | null | undefined,
  mimeType?: string | null,
  uri?: string,
): string {
  const fromUri = uri ? uri.split(/[?#]/, 1)[0]?.split(/[\\/]/).pop() : undefined
  const rawBase = rawName && rawName.trim().length > 0 ? rawName.split(/[\\/]/).pop() : fromUri
  let base = rawBase ?? ''
  base = base.replace(/[\x00-\x1f\x7f]/gu, '').replace(/[<>:"|?*]/gu, '_').replace(/[. ]+$/u, '').trim()
  if (base.startsWith('.dsh-upload-')) {
    base = `_${base.slice(1)}`
  }
  if (base === '' || base === '.' || base === '..') {
    base = mimeType?.toLowerCase().startsWith('video/') ? 'video' : 'file'
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(base)) {
    base = `file_${base}`
  }

  const normalizedMime = mimeType?.toLowerCase().split(';', 1)[0]?.trim()
  const inferredExt = normalizedMime ? MIME_TO_EXTENSION[normalizedMime] : undefined
  const uriExtMatch = fromUri?.match(/(\.[a-zA-Z0-9]{1,10})$/u)?.[1]?.toLowerCase()
  const hasExt = /\.[^.]+$/u.test(base)
  if (!hasExt && (inferredExt || uriExtMatch)) {
    base = `${base}${inferredExt ?? uriExtMatch}`
  }

  const encoder = new TextEncoder()
  if (encoder.encode(base).byteLength <= MAX_UPLOAD_NAME_UTF8_BYTES) {
    return base
  }

  const dotIdx = base.lastIndexOf('.')
  const ext = dotIdx > 0 ? base.slice(dotIdx) : ''
  const extBytes = encoder.encode(ext).byteLength
  const stemBudget = Math.max(1, MAX_UPLOAD_NAME_UTF8_BYTES - (extBytes < MAX_UPLOAD_NAME_UTF8_BYTES ? extBytes : 0))
  const safeExt = extBytes < MAX_UPLOAD_NAME_UTF8_BYTES ? ext : ''
  const chars = Array.from(safeExt ? base.slice(0, dotIdx) : base)
  let stem = ''
  let usedBytes = 0
  for (const ch of chars) {
    const chBytes = encoder.encode(ch).byteLength
    if (usedBytes + chBytes > stemBudget) break
    stem += ch
    usedBytes += chBytes
  }
  stem = stem.replace(/[. ]+$/u, '') || 'file'
  return `${stem}${safeExt}`
}

export function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0:00'
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Check if text contains null bytes or replacement characters indicating binary/decode corruption. */
export function isValidUtf8Text(text: string): boolean {
  if (text.includes('\0')) return false
  if (text.includes('\uFFFD')) return false
  return true
}

export function formatFileBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unitIndex = 0
  while (value >= BYTE_UNIT_STEP && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTE_UNIT_STEP
    unitIndex += 1
  }
  if (unitIndex === 0) return `${Math.round(value)} ${BYTE_UNITS[unitIndex]}`
  const rounded = Math.round(value * 10) / 10
  const formatted = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)
  return `${formatted} ${BYTE_UNITS[unitIndex]}`
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeFileContent(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Legacy prompt formatter: embeds file content directly into `<uploaded_files>`.
 * Kept for fallback compatibility.
 */
export function formatUploadedFilesPrompt(userText: string, files: StagedFile[]): string {
  const stagedFiles = Array.isArray(files) ? files : []
  if (stagedFiles.length === 0) return userText

  const fileBlocks = stagedFiles.map(file => {
    const attrs = `name="${escapeAttribute(file.name)}" size="${file.size}"`
    const body = escapeFileContent(file.content ?? '')
    return `<file ${attrs}>\n${body}\n</file>`
  }).join('\n')

  const uploadedBlock = `<uploaded_files>\n${fileBlocks}\n</uploaded_files>`
  const trimmed = userText.trim()
  if (trimmed.length === 0) {
    return `I have attached the following file(s) for you to review:\n\n${uploadedBlock}`
  }
  return `${trimmed}\n\n${uploadedBlock}`
}
