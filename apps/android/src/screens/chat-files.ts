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
}

export interface UploadedFileRef {
  name: string
  path: string
  bytes: number
}

export type RpcCaller = (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>

export const MAX_SINGLE_FILE_BYTES = 512 * 1024 // 512 KB
export const MAX_TOTAL_FILES_BYTES = 2 * 1024 * 1024 // 2 MB
export const UPLOAD_CHUNK_BYTES = 64 * 1024 // 64 KiB protocol chunk

// Local memory ceilings also apply when an older Host omits imageLimits.
const MAX_DOCUMENT_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_DOCUMENT_IMAGES_BYTES = 32 * 1024 * 1024

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Pure TypeScript RFC 4648 base64 encoder that works uniformly across
 * Hermes, JavaScriptCore, browser, and Node.js without Buffer or btoa.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length
  const out: string[] = []
  let i = 0

  for (; i + 2 < len; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
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

function generateUploadId(): string {
  const rand = (): string => Math.random().toString(36).slice(2, 10)
  return `up_${Date.now().toString(36)}_${rand()}`
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

async function resolveFileBytes(file: StagedFile, signal?: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal)
  if (typeof file.content === 'string') {
    return new TextEncoder().encode(file.content)
  }
  if (file.uri) {
    const response = await fetch(file.uri, { signal })
    if (!response.ok) {
      throw new Error(`Failed to read file ${file.name} from ${file.uri}`)
    }
    const buffer = await response.arrayBuffer()
    throwIfAborted(signal)
    return new Uint8Array(buffer)
  }
  return new Uint8Array(0)
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
): Promise<UploadedFileRef> {
  // Reuse existing remotePath if already uploaded in an earlier attempt/retry
  if (typeof file.remotePath === 'string' && file.remotePath.trim().length > 0) {
    return { name: file.name, path: file.remotePath, bytes: file.size }
  }

  throwIfAborted(signal)

  const bytes = await resolveFileBytes(file, signal)
  const totalBytes = bytes.byteLength
  throwIfAborted(signal)

  const uploadId = generateUploadId()
  let committed = false

  try {
    const openRes = await rpc('workspace.upload.open', {
      sessionId,
      uploadId,
      name: file.name,
      totalBytes,
    }, signal)

    if (!isRecord(openRes)) throw new Error('workspace.upload.open returned a non-object')
    const chunkBytes = typeof openRes.chunkBytes === 'number' && openRes.chunkBytes > 0
      ? openRes.chunkBytes
      : UPLOAD_CHUNK_BYTES

    let offset = 0
    while (offset < totalBytes) {
      throwIfAborted(signal)
      const end = Math.min(offset + chunkBytes, totalBytes)
      const chunkData = bytesToBase64(bytes.subarray(offset, end))

      const chunkRes = await rpc('workspace.upload.chunk', {
        sessionId,
        uploadId,
        offset,
        data: chunkData,
      }, signal)
      if (!isRecord(chunkRes)) throw new Error('workspace.upload.chunk returned a non-object')
      offset = end
    }

    throwIfAborted(signal)
    const commitRes = await rpc('workspace.upload.commit', { sessionId, uploadId }, signal)
    if (!isRecord(commitRes)) throw new Error('workspace.upload.commit returned a non-object')

    const path = commitRes.path
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new Error('workspace.upload.commit returned no valid path')
    }

    committed = true
    const name = typeof commitRes.name === 'string' && commitRes.name.length > 0 ? commitRes.name : file.name
    const bytesCount = typeof commitRes.bytes === 'number' ? commitRes.bytes : totalBytes

    return { name, path, bytes: bytesCount }
  } catch (error) {
    if (!committed) {
      await abortUploadQuietly(rpc, sessionId, uploadId)
    }
    throw error
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
): Promise<UploadedFileRef[]> {
  const uploaded: UploadedFileRef[] = []
  for (const file of files) {
    if (signal?.aborted) throw new Error('upload-aborted')
    const result = await uploadStagedFileToWorkspace(rpc, sessionId, file, signal)
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
