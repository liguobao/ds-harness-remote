import { imagePreviewMetadata, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from './image-preview-metadata'
import type { HarnessSessionTools, WorkspaceFileStat } from './session-tools'

export type PreviewKind = 'text' | 'image' | 'pdf' | 'office' | 'unsupported'

export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024
export const PREVIEW_CHUNK_BYTES = 512 * 1024
export const MAX_OFFICE_SOURCE_BYTES = 50 * 1024 * 1024
export const MAX_MISSING_FONTS = 32
export const MAX_MISSING_FONT_NAME_LENGTH = 256

export const WORKSPACE_PREVIEW_TOO_LARGE = 'workspace-preview/too-large'
export const WORKSPACE_PREVIEW_CHANGED = 'workspace-preview/changed'
export const WORKSPACE_PREVIEW_INVALID = 'workspace-preview/invalid'
export const WORKSPACE_PREVIEW_UNSUPPORTED = 'workspace-preview/unsupported'

/** Matches RemoteClientError so callers can keep treating cancellation as cancellation. */
const ABORTED = 'RPC_ABORTED'

export interface WorkspacePreview {
  data: string
  mimeType: string
  missingFonts: string[]
}

const IMAGE_EXTENSION_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Types the Host converts through officeToPdf; nothing else is sent for conversion. */
const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'])

/** SVG and HTML are previewed as inert text; no renderer ever executes them. */
const TEXT_EXTENSIONS = new Set([
  'bat', 'c', 'cc', 'cfg', 'cmd', 'conf', 'cpp', 'cs', 'css', 'csv', 'cts', 'cxx',
  'fish', 'gql', 'go', 'graphql', 'h', 'hpp', 'htm', 'html', 'ini', 'java',
  'js', 'json', 'json5', 'jsonc', 'jsx', 'kt', 'kts', 'less', 'log', 'lua', 'm',
  'markdown', 'md', 'mdx', 'mjs', 'mts', 'php', 'pl', 'properties', 'ps1', 'py',
  'rb', 'rs', 'scss', 'sh', 'sql', 'svelte', 'svg', 'swift', 'tex', 'toml', 'ts',
  'tsv', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml', 'zsh',
])

const TEXT_NAMES = new Set([
  '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore', '.nvmrc',
  'authors', 'changelog', 'copying', 'dockerfile', 'gemfile', 'jenkinsfile',
  'license', 'makefile', 'notice', 'procfile', 'rakefile', 'readme', 'vagrantfile',
])

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]
const PDF_TRAILER = [0x25, 0x25, 0x45, 0x4f, 0x46]
const PDF_TRAILER_SEARCH_BYTES = 2048

export function classifyWorkspaceFile(path: string): PreviewKind {
  const extension = extensionOf(path)
  const kind = extensionKind(extension)
  if (kind !== undefined) return kind
  return extension === undefined && TEXT_NAMES.has(baseName(path).toLowerCase()) ? 'text' : 'unsupported'
}

export async function loadWorkspacePreview(
  tools: HarnessSessionTools,
  sessionId: string,
  path: string,
  kind: 'image' | 'pdf' | 'office',
  signal?: AbortSignal,
): Promise<WorkspacePreview> {
  if (kind === 'office') return loadOfficePreview(tools, sessionId, path, signal)
  assertActive(signal)
  const bytes = await readBoundedBytes(tools, sessionId, path, MAX_PREVIEW_BYTES, signal)
  return kind === 'image'
    ? { data: encodeBase64(bytes), mimeType: imagePreviewType(path, bytes), missingFonts: [] }
    : { data: encodeBase64(bytes), mimeType: pdfPreviewType(path, bytes), missingFonts: [] }
}

async function loadOfficePreview(
  tools: HarnessSessionTools,
  sessionId: string,
  path: string,
  signal?: AbortSignal,
): Promise<WorkspacePreview> {
  if (!OFFICE_EXTENSIONS.has(extensionOf(path) ?? '')) {
    throw unsupported('Only known Office document types can be converted for preview.')
  }
  assertActive(signal)
  const before = requireStat(await tools.statFile(sessionId, path, signal))
  if (before.bytes !== undefined && before.bytes > MAX_OFFICE_SOURCE_BYTES) {
    throw sizeLimit('The document exceeds the Office preview size limit.', { bytes: before.bytes, maxBytes: MAX_OFFICE_SOURCE_BYTES })
  }
  assertActive(signal)
  const generation = await tools.officeGeneration(signal)
  if (typeof generation !== 'string' || generation.length === 0) {
    throw invalid('The Host returned an invalid Office conversion generation.')
  }
  assertActive(signal)
  const preview = parseOfficeRender(await tools.renderOfficePdf(sessionId, path, signal), before, generation)
  assertActive(signal)
  const after = requireStat(await tools.statFile(sessionId, path, signal))
  if (!sameFileIdentity(before, after)) throw changed('The document changed while it was being converted.')
  assertActive(signal)
  return preview
}

async function readBoundedBytes(
  tools: HarnessSessionTools,
  sessionId: string,
  path: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  assertActive(signal)
  const before = requireStat(await tools.statFile(sessionId, path, signal))
  if (before.bytes !== undefined && before.bytes > limit) {
    throw sizeLimit('The file exceeds the preview size limit.', { bytes: before.bytes, maxBytes: limit })
  }
  const chunks: Uint8Array[] = []
  let total = before.bytes
  let read = 0
  let ended = false
  while (!ended) {
    assertActive(signal)
    if (total !== undefined && total > limit) {
      throw sizeLimit('The file exceeds the preview size limit.', { bytes: total, maxBytes: limit })
    }
    // Unknown sizes are read in fixed chunks; a known size is probed once at its declared end.
    const length = total === undefined
      ? Math.min(PREVIEW_CHUNK_BYTES, limit + 1 - read)
      : Math.min(PREVIEW_CHUNK_BYTES, Math.max(1, total - read))
    const chunk = parseChunk(await tools.readBytes(sessionId, path, read, length, signal), {
      absolutePath: before.absolutePath,
      version: before.version,
      offset: read,
      length,
      totalBytes: total,
    })
    if (chunk.totalBytes !== undefined) total = chunk.totalBytes
    read += chunk.data.byteLength
    chunks.push(chunk.data)
    if (read > limit) throw sizeLimit('The file exceeds the preview size limit.', { bytes: read, maxBytes: limit })
    if (total !== undefined && read > total) throw changed('The file grew while it was being read.')
    if (chunk.eof && total !== undefined && read !== total) throw changed('The file changed while it was being read.')
    ended = chunk.eof
  }
  assertActive(signal)
  const after = requireStat(await tools.statFile(sessionId, path, signal))
  if (!sameFileIdentity(before, after)) throw changed('The file changed while it was being read.')
  assertActive(signal)
  return concatBytes(chunks, read)
}

interface ChunkExpectation {
  absolutePath: string
  version: string
  offset: number
  length: number
  totalBytes?: number
}

function parseChunk(value: unknown, expected: ChunkExpectation): { data: Uint8Array; eof: boolean; totalBytes?: number } {
  if (!isRecord(value)) throw invalid('The Host returned an invalid file chunk.')
  if (value.absolutePath !== expected.absolutePath) throw invalid('The Host returned a file chunk for a different path.')
  if (value.version !== expected.version) throw changed('The file changed while it was being read.')
  if (value.offset !== expected.offset) throw invalid('The Host returned a file chunk at an unexpected offset.')
  if (typeof value.eof !== 'boolean') throw invalid('The Host returned an invalid file chunk boundary.')
  if (typeof value.data !== 'string') throw invalid('The Host returned an invalid file chunk payload.')
  const totalBytes = bytesOf(value.bytes)
  if (totalBytes !== undefined && expected.totalBytes !== undefined && totalBytes !== expected.totalBytes) {
    throw changed('The file size changed while it was being read.')
  }
  const data = decodeBase64(value.data, expected.length)
  if (data.byteLength > expected.length) throw invalid('The Host returned a file chunk larger than requested.')
  if (!value.eof && data.byteLength === 0) throw invalid('The Host returned an empty file chunk before the end of the file.')
  return { data, eof: value.eof, totalBytes }
}

function parseOfficeRender(value: unknown, source: WorkspaceFileStat, generation: string): WorkspacePreview {
  if (!isRecord(value)) throw invalid('The Host returned an invalid Office preview.')
  if (value.absolutePath !== source.absolutePath) throw invalid('The Host converted a different document.')
  if (value.version !== source.version) throw changed('The document changed while it was being converted.')
  if (value.generation !== generation) throw changed('The Office conversion engine changed during the preview.')
  if (value.offset !== 0 || value.eof !== true) throw invalid('The Host returned an incomplete Office preview.')
  if (typeof value.data !== 'string') throw invalid('The Host returned an invalid Office preview payload.')
  const declared = bytesOf(value.bytes)
  if (declared !== undefined && declared > MAX_PREVIEW_BYTES) {
    throw sizeLimit('The converted preview exceeds the preview size limit.', { bytes: declared, maxBytes: MAX_PREVIEW_BYTES })
  }
  if (value.data.length > base64Length(MAX_PREVIEW_BYTES)) {
    throw sizeLimit('The converted preview exceeds the preview size limit.', { maxBytes: MAX_PREVIEW_BYTES })
  }
  const data = decodeBase64(value.data, MAX_PREVIEW_BYTES)
  if (data.byteLength === 0) throw invalid('The Host returned an empty Office preview.')
  if (data.byteLength > MAX_PREVIEW_BYTES) {
    throw sizeLimit('The converted preview exceeds the preview size limit.', { bytes: data.byteLength, maxBytes: MAX_PREVIEW_BYTES })
  }
  if (declared !== undefined && declared !== data.byteLength) {
    throw invalid('The Host declared a different converted preview size.')
  }
  if (!startsWithBytes(data, PDF_MAGIC) || !containsPdfTrailer(data)) {
    throw invalid('The Host returned a converted preview that is not a complete PDF.')
  }
  return { data: value.data, mimeType: 'application/pdf', missingFonts: parseMissingFonts(value.missingFonts) }
}

function parseMissingFonts(value: unknown): string[] {
  if (!Array.isArray(value)
    || value.some(font => typeof font !== 'string' || font.length === 0 || font.length > MAX_MISSING_FONT_NAME_LENGTH)) {
    throw invalid('The Host returned an invalid missing font list.')
  }
  return value.slice(0, MAX_MISSING_FONTS)
}

function imagePreviewType(path: string, bytes: Uint8Array): string {
  const metadata = imagePreviewMetadata(bytes)
  if (!metadata.ok) {
    if (metadata.reason === 'too-large') {
      throw sizeLimit('The image exceeds the preview decoding budget.', {
        width: metadata.width,
        height: metadata.height,
        maxDimension: MAX_IMAGE_DIMENSION,
        maxPixels: MAX_IMAGE_PIXELS,
      })
    }
    if (metadata.reason === 'invalid') throw invalid('The image header cannot be read reliably.')
    throw unsupported('The file does not contain a supported image.')
  }
  const extension = extensionOf(path)
  if (extension === undefined) return metadata.mimeType
  const expected = IMAGE_EXTENSION_TYPES[extension]
  if (expected === undefined) throw unsupported('Only PNG, JPEG, GIF, and WebP images can be previewed.')
  if (expected !== metadata.mimeType) throw unsupported('The image content does not match its file extension.')
  return metadata.mimeType
}

function pdfPreviewType(path: string, bytes: Uint8Array): string {
  const extension = extensionOf(path)
  const kind = extensionKind(extension)
  if (kind !== undefined && kind !== 'pdf') throw unsupported('The file extension does not describe a PDF document.')
  if (!startsWithBytes(bytes, PDF_MAGIC)) throw unsupported('The file does not contain a PDF document.')
  return 'application/pdf'
}

function requireStat(value: unknown): WorkspaceFileStat {
  if (!isRecord(value)) throw invalid('The Host returned an invalid file status.')
  if (typeof value.absolutePath !== 'string' || value.absolutePath.length === 0) {
    throw invalid('The Host returned a file status without an absolute path.')
  }
  if (typeof value.version !== 'string' || value.version.length === 0) {
    throw invalid('The Host returned a file status without a version.')
  }
  const bytes = bytesOf(value.bytes)
  return { absolutePath: value.absolutePath, version: value.version, ...(bytes === undefined ? {} : { bytes }) }
}

function sameFileIdentity(before: WorkspaceFileStat, after: WorkspaceFileStat): boolean {
  if (before.absolutePath !== after.absolutePath || before.version !== after.version) return false
  return before.bytes === undefined || after.bytes === undefined || before.bytes === after.bytes
}

function bytesOf(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalid('The Host returned an invalid file size.')
  }
  return value
}

function containsPdfTrailer(bytes: Uint8Array): boolean {
  const start = Math.max(0, bytes.byteLength - PDF_TRAILER_SEARCH_BYTES)
  for (let index = bytes.byteLength - PDF_TRAILER.length; index >= start; index -= 1) {
    if (startsWithBytes(bytes.subarray(index), PDF_TRAILER)) return true
  }
  return false
}

function extensionOf(path: string): string | undefined {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : undefined
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/gu, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function extensionKind(extension: string | undefined): PreviewKind | undefined {
  if (extension === undefined) return undefined
  if (IMAGE_EXTENSION_TYPES[extension] !== undefined) return 'image'
  if (extension === 'pdf') return 'pdf'
  if (OFFICE_EXTENSIONS.has(extension)) return 'office'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  return undefined
}

function startsWithBytes(bytes: Uint8Array, pattern: readonly number[]): boolean {
  if (bytes.byteLength < pattern.length) return false
  for (let index = 0; index < pattern.length; index += 1) {
    if (bytes[index] !== pattern[index]) return false
  }
  return true
}

function concatBytes(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function base64Length(maxBytes: number): number {
  return 4 * Math.ceil(maxBytes / 3)
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.byteLength)))
  }
  return btoa(binary)
}

function decodeBase64(value: string, maxBytes: number): Uint8Array {
  if (value.length > base64Length(maxBytes)) throw invalid('The Host returned a preview payload larger than allowed.')
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw invalid('The Host returned malformed preview data.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (encodeBase64(bytes) !== value) throw invalid('The Host returned non-canonical preview data.')
  return bytes
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw previewError(ABORTED, 'The workspace preview was cancelled.')
}

function invalid(message: string): Error {
  return previewError(WORKSPACE_PREVIEW_INVALID, message)
}

function unsupported(message: string): Error {
  return previewError(WORKSPACE_PREVIEW_UNSUPPORTED, message)
}

function changed(message: string): Error {
  return previewError(WORKSPACE_PREVIEW_CHANGED, message)
}

function sizeLimit(message: string, details: Record<string, unknown>): Error {
  return previewError(WORKSPACE_PREVIEW_TOO_LARGE, message, details)
}

function previewError(code: string, message: string, details: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, details })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
