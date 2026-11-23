import type { ChatFile } from '../../types'
import { getFileGlyph } from '../../ui/file-glyph'

const MESSAGE_FILE_PREFIX = '.dsh-remote-message-file/'
const ATTACHMENT_ID_RE = /^sha256:[a-f0-9]{64}$/u
const EXTENSION_RE = /\.([a-z0-9]{1,12})$/iu

const KNOWN_EXTENSIONLESS_FILES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.nvmrc',
  'authors',
  'changelog',
  'copying',
  'dockerfile',
  'gemfile',
  'jenkinsfile',
  'license',
  'makefile',
  'notice',
  'procfile',
  'rakefile',
  'readme',
  'vagrantfile',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripLeadingDotSlash(value: string): string {
  let out = value.trim()
  while (out.startsWith('./') || out.startsWith('.\\')) {
    out = out.slice(2)
  }
  return out
}

/**
 * Validate a literal relative workspace file path without URI decoding or `#` fragment
 * splitting, since upload references (`@path`) preserve literal `%`, `#`, and `%20`.
 */
function sanitizeLiteralSubmittedPath(rawPath: string): string | undefined {
  const path = stripLeadingDotSlash(rawPath)
  if (
    path.length === 0
    || path.startsWith('/')
    || path.startsWith('\\')
    || /[\u0000-\u001f\u007f]/u.test(path)
    || /^[\\/]{2}/u.test(path)
    || /^[a-zA-Z]:/u.test(path)
    || /(?:^|[/\\])[a-zA-Z]:/u.test(path)
    || /^[a-z][a-z\d+.-]*:/iu.test(path)
    || /(?:^|[/\\])\.\.(?:[/\\]|$)/u.test(path)
  ) {
    return undefined
  }
  return path
}

function baseNameOf(path: string): string {
  const clean = path.replace(/[\\/]+$/u, '')
  return clean.split(/[\\/]/u).pop() ?? clean
}

function isRecognizedSubmittedFilename(path: string): boolean {
  const base = baseNameOf(path)
  if (base.length === 0) return false
  if (EXTENSION_RE.test(base)) return true
  return KNOWN_EXTENSIONLESS_FILES.has(base.toLowerCase())
}

/**
 * Validate a Host `type: 'file'` user message attachment block using the exact
 * boundaries enforced by `packages/plugin/src/message-file-attachment.ts`.
 */
export function parseMessageFileAttachmentBlock(block: unknown): ChatFile | undefined {
  if (!isRecord(block) || block.type !== 'file' || !isRecord(block.attachment)) return undefined
  const ref = block.attachment
  if (
    typeof ref.attachmentId !== 'string'
    || !ATTACHMENT_ID_RE.test(ref.attachmentId)
    || typeof ref.name !== 'string'
    || ref.name.length === 0
    || ref.name.length > 255
    || ref.name === '.'
    || ref.name === '..'
    || /[\\/\x00-\x1f]/u.test(ref.name)
    || typeof ref.bytes !== 'number'
    || !Number.isSafeInteger(ref.bytes)
    || ref.bytes < 0
  ) {
    return undefined
  }
  return {
    path: `${MESSAGE_FILE_PREFIX}${ref.attachmentId}/${ref.name}`,
    name: ref.name,
    bytes: ref.bytes,
    attachmentId: ref.attachmentId,
    source: 'attachment',
  }
}

export function isMessageFilePath(path: string): boolean {
  return path.startsWith(MESSAGE_FILE_PREFIX)
}

export function formatUploadedChatFiles(
  uploaded: readonly { name: string; path: string; bytes: number }[],
): ChatFile[] {
  const result: ChatFile[] = []
  const seen = new Set<string>()
  for (const entry of uploaded) {
    const path = sanitizeLiteralSubmittedPath(entry.path) ?? sanitizeLiteralSubmittedPath(entry.name)
    if (path === undefined) continue
    if (seen.has(path)) continue
    seen.add(path)
    const name = entry.name.trim() || baseNameOf(path)
    const bytes = typeof entry.bytes === 'number' && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0
      ? entry.bytes
      : undefined
    result.push({
      path,
      name,
      ...(bytes === undefined ? {} : { bytes }),
      source: 'upload',
    })
  }
  return result
}

/**
 * Parse a standalone line composed exclusively of `@path` or `@"path"` file references.
 * Any non-file token (emails, `@alice` mentions, prose) rejects the entire line.
 */
export function parseTrailingSubmittedFileTokens(line: string): ChatFile[] | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined

  const files: ChatFile[] = []
  const seen = new Set<string>()
  let index = 0
  const len = trimmed.length

  while (index < len) {
    while (index < len && /\s/u.test(trimmed[index]!)) {
      index += 1
    }
    if (index >= len) break
    if (trimmed[index] !== '@') return undefined
    index += 1
    if (index >= len) return undefined

    let rawTarget = ''
    if (trimmed[index] === '"') {
      index += 1
      let closed = false
      while (index < len) {
        const ch = trimmed[index]!
        if (ch === '\\' && index + 1 < len) {
          const next = trimmed[index + 1]!
          if (next === '"' || next === '\\') {
            rawTarget += next
            index += 2
            continue
          }
        }
        if (ch === '"') {
          index += 1
          closed = true
          break
        }
        rawTarget += ch
        index += 1
      }
      if (!closed) return undefined
      if (index < len && !/\s/u.test(trimmed[index]!)) return undefined
    } else {
      const start = index
      while (index < len && !/\s/u.test(trimmed[index]!)) {
        index += 1
      }
      rawTarget = trimmed.slice(start, index)
      if (rawTarget.includes('"')) return undefined
    }

    const path = sanitizeLiteralSubmittedPath(rawTarget)
    if (path === undefined || !isRecognizedSubmittedFilename(path)) {
      return undefined
    }
    if (!seen.has(path)) {
      seen.add(path)
      files.push({
        path,
        name: baseNameOf(path),
        source: 'reference',
      })
    }
  }

  return files.length > 0 ? files : undefined
}

function splitTrailingParagraph(text: string): { head: string; tail: string } {
  const normalized = text.replace(/\r\n/gu, '\n')
  const trimmedEnd = normalized.replace(/\s+$/u, '')
  const sepIndex = trimmedEnd.lastIndexOf('\n\n')
  if (sepIndex < 0) {
    return { head: '', tail: trimmedEnd }
  }
  return {
    head: trimmedEnd.slice(0, sepIndex).replace(/\s+$/u, ''),
    tail: trimmedEnd.slice(sepIndex + 2).trim(),
  }
}

function sameFilePaths(parsed: readonly ChatFile[], explicit: readonly ChatFile[]): boolean {
  const parsedPaths = parsed.map(item => item.path)
  const explicitPaths = explicit.map(item => stripLeadingDotSlash(item.path))
  if (parsedPaths.length !== explicitPaths.length) return false
  const explicitSet = new Set(explicitPaths)
  return parsedPaths.every(path => explicitSet.has(path))
}

/**
 * Extract displayable submitted file cards from explicit `ChatMessage.files`
 * plus conservative trailing `@path` upload lines without mutating `item.text`.
 */
export function extractUserSubmittedFiles(
  text: string,
  explicitFiles?: readonly ChatFile[],
): { files: ChatFile[]; displayText: string } {
  const merged: ChatFile[] = []
  const indexByPath = new Map<string, number>()

  const pushFile = (file: ChatFile) => {
    const existingIndex = indexByPath.get(file.path)
    if (existingIndex === undefined) {
      indexByPath.set(file.path, merged.length)
      merged.push(file)
      return
    }
    const existing = merged[existingIndex]!
    if (existing.bytes === undefined && file.bytes !== undefined) {
      merged[existingIndex] = { ...existing, bytes: file.bytes }
    }
  }

  for (const file of explicitFiles ?? []) {
    pushFile(file)
  }

  const { head, tail } = splitTrailingParagraph(text)
  const tailFiles = parseTrailingSubmittedFileTokens(tail)
  const explicitUploads = (explicitFiles ?? []).filter(file => file.source === 'upload')

  if (tailFiles !== undefined) {
    if (explicitUploads.length > 0) {
      if (sameFilePaths(tailFiles, explicitUploads)) {
        return { files: merged, displayText: head }
      }
      return { files: merged, displayText: text }
    }
    for (const file of tailFiles) {
      pushFile(file)
    }
    return { files: merged, displayText: head }
  }

  return { files: merged, displayText: text }
}

export function formatSubmittedFileSize(bytes: number): string | undefined {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return undefined
  if (bytes < 1024) return `${Math.round(bytes)}B`
  const kb = bytes / 1024
  if (kb < 1024) {
    const formatted = kb >= 100 ? Math.round(kb).toString() : kb.toFixed(1)
    return `${formatted.replace(/\.0$/u, '')}KB`
  }
  const mb = kb / 1024
  if (mb < 1024) {
    return `${mb.toFixed(2).replace(/\.?0+$/u, '')}MB`
  }
  const gb = mb / 1024
  return `${gb.toFixed(2).replace(/\.?0+$/u, '')}GB`
}

export function formatSubmittedFileMeta(
  path: string,
  bytes?: number,
): { typeLabel: string; sizeLabel?: string; fullLabel: string } {
  const base = baseNameOf(path)
  const match = EXTENSION_RE.exec(base)
  const ext = match?.[1]?.toUpperCase()
  const typeLabel = ext && ext.length <= 8
    ? ext
    : getFileGlyph(path).label.toUpperCase()
  const sizeLabel = bytes === undefined ? undefined : formatSubmittedFileSize(bytes)
  return {
    typeLabel,
    ...(sizeLabel === undefined ? {} : { sizeLabel }),
    fullLabel: sizeLabel === undefined ? typeLabel : `${typeLabel} ${sizeLabel}`,
  }
}
